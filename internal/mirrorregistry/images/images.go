// Package images serves a read-only HTML page listing the tagged images a
// signed-in user can pull. The page and its assets are embedded so it works
// without any network access beyond the registry itself.
package images

import (
	"bytes"
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"slices"

	"github.com/opencontainers/go-digest"
	v1 "github.com/opencontainers/image-spec/specs-go/v1"

	"github.com/quay/quay/internal/auth"
	"github.com/quay/quay/internal/dal/daldb"
	"github.com/quay/quay/internal/oci"
	"github.com/quay/quay/internal/repository"
	repositorydal "github.com/quay/quay/internal/repository/dal"
)

const (
	// PagePath is the route of the images page.
	PagePath = "/images"
	// AssetPrefix is the route prefix of the page's embedded assets.
	AssetPrefix = "/images/assets/"

	dockerManifestList = "application/vnd.docker.distribution.manifest.list.v2+json"
	shortDigestLength  = 12
)

//go:embed page.html
var pageHTML string

//go:embed assets/*.css assets/*.js assets/*.svg assets/fonts/*.woff2
var assets embed.FS

var page = template.Must(template.New("page").Parse(pageHTML))

// Store is the metadata the page reads.
type Store interface {
	ListRepositories(ctx context.Context) ([]oci.RepositoryName, error)
	ListTags(ctx context.Context, repoID int64) ([]string, error)
	GetTagDigest(ctx context.Context, repoID int64, tag string) (digest.Digest, error)
	GetManifestForServing(ctx context.Context, repoID int64, dgst digest.Digest) ([]byte, string, error)
}

// Config holds the page's dependencies.
type Config struct {
	DB         *sql.DB
	Store      Store
	Verifier   auth.Verifier
	Authorizer *repositorydal.Authorizer
	// Realm is the HTTP Basic challenge realm.
	Realm string
}

// Handler renders the images page for the authenticated caller.
type Handler struct {
	authn   *auth.BasicAuthenticator
	authz   *repositorydal.Authorizer
	queries *daldb.Queries
	store   Store
	realm   string
}

type repositoryView struct {
	Name string
	Tags []tagView
}

type tagView struct {
	Name        string
	Type        string
	Digest      string
	ShortDigest string
}

// NewHandler returns the images page handler.
func NewHandler(cfg Config) *Handler {
	return &Handler{
		authn:   auth.NewBasicAuthenticator(cfg.Verifier),
		authz:   cfg.Authorizer,
		queries: daldb.New(cfg.DB),
		store:   cfg.Store,
		realm:   cfg.Realm,
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	result := h.authn.Authenticate(r)
	if !result.Authenticated {
		w.Header().Set("WWW-Authenticate", fmt.Sprintf("Basic realm=%q", h.realm))
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}

	repos, err := h.pullableRepositories(r.Context(), &result.Principal)
	if err != nil {
		slog.Error("list images", "user", result.Principal.Username, "err", err)
		http.Error(w, "could not list images", http.StatusInternalServerError)
		return
	}
	var body bytes.Buffer
	if err := page.Execute(&body, repos); err != nil {
		slog.Error("render images page", "err", err)
		http.Error(w, "could not render images", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = body.WriteTo(w)
}

// pullableRepositories returns the image repositories principal can pull that
// have at least one visible tag. A repository name is only read back to the
// caller after the pull check passes.
func (h *Handler) pullableRepositories(ctx context.Context, principal *auth.Principal) ([]repositoryView, error) {
	names, err := h.store.ListRepositories(ctx)
	if err != nil {
		return nil, err
	}
	var repos []repositoryView
	for _, name := range names {
		row, err := h.queries.GetRepositoryAccessByNamespaceName(ctx, daldb.GetRepositoryAccessByNamespaceNameParams{
			Username: name.Namespace,
			Name:     name.Name,
		})
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("resolve repository %s: %w", name, err)
		}
		if row.KindID != repository.KindImage {
			continue
		}
		allowed, err := h.authz.CanPullRepository(ctx, principal, &repository.Repository{
			ID:               row.ID,
			Ref:              repository.Ref{Namespace: row.Namespace, Name: row.Name},
			Visibility:       repository.Visibility(row.Visibility),
			State:            row.State,
			KindID:           row.KindID,
			NamespaceEnabled: row.NamespaceEnabled,
		})
		if err != nil {
			return nil, fmt.Errorf("authorize repository %s: %w", name, err)
		}
		if !allowed {
			continue
		}
		tags, err := h.tags(ctx, row.ID)
		if err != nil {
			return nil, fmt.Errorf("list tags of %s: %w", name, err)
		}
		if len(tags) > 0 {
			repos = append(repos, repositoryView{Name: name.String(), Tags: tags})
		}
	}
	return repos, nil
}

func (h *Handler) tags(ctx context.Context, repoID int64) ([]tagView, error) {
	names, err := h.store.ListTags(ctx, repoID)
	if err != nil {
		return nil, err
	}
	slices.Sort(names)
	tags := make([]tagView, 0, len(names))
	for _, name := range names {
		dgst, err := h.store.GetTagDigest(ctx, repoID, name)
		if errors.Is(err, oci.ErrNotExist) {
			continue // expired or moved since ListTags
		}
		if err != nil {
			return nil, err
		}
		_, mediaType, err := h.store.GetManifestForServing(ctx, repoID, dgst)
		if errors.Is(err, oci.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		kind := "Image"
		if mediaType == v1.MediaTypeImageIndex || mediaType == dockerManifestList {
			kind = "Index"
		}
		short := dgst.String()
		if encoded := dgst.Encoded(); len(encoded) > shortDigestLength {
			short = dgst.Algorithm().String() + ":" + encoded[:shortDigestLength]
		}
		tags = append(tags, tagView{Name: name, Type: kind, Digest: dgst.String(), ShortDigest: short})
	}
	return tags, nil
}

// AssetHandler serves the page's embedded stylesheet, scripts, logos and
// fonts under AssetPrefix.
func AssetHandler() http.Handler {
	sub, err := fs.Sub(assets, "assets")
	if err != nil {
		panic(err)
	}
	files := http.FileServerFS(sub)
	return http.StripPrefix(AssetPrefix, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Go's built-in MIME table has no .woff2 entry and the runtime image
		// has no /etc/mime.types to fall back on.
		if path.Ext(r.URL.Path) == ".woff2" {
			w.Header().Set("Content-Type", "font/woff2")
		}
		files.ServeHTTP(w, r)
	}))
}
