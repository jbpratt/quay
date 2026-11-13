package images

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/opencontainers/go-digest"
	v1 "github.com/opencontainers/image-spec/specs-go/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/quay/quay/internal/auth"
	"github.com/quay/quay/internal/bootstrap"
	"github.com/quay/quay/internal/dal/dbcore"
	"github.com/quay/quay/internal/dal/metastore"
	"github.com/quay/quay/internal/oci"
	repositorydal "github.com/quay/quay/internal/repository/dal"
)

const (
	testUser     = "admin"
	testPassword = "password"
)

type fixture struct {
	db      *sql.DB
	store   *metastore.SQLiteStore
	handler *Handler
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	db, err := dbcore.Setup(t.Context(), filepath.Join(t.TempDir(), "quay.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	_, err = bootstrap.AdminUser(t.Context(), db, testUser, testPassword)
	require.NoError(t, err)
	store, err := metastore.NewSQLiteStore(t.Context(), db, metastore.StoreConfig{CreatePrivateOnPush: true})
	require.NoError(t, err)
	return &fixture{
		db:    db,
		store: store,
		handler: NewHandler(Config{
			DB:         db,
			Store:      store,
			Verifier:   auth.NewDatabaseVerifier(db, auth.DatabaseVerifierConfig{}),
			Authorizer: repositorydal.NewAuthorizer(db, repositorydal.AuthorizerConfig{}),
			Realm:      "registry.test",
		}),
	}
}

// push stores a tagged manifest of mediaType in namespace/name and returns its digest.
func (f *fixture) push(t *testing.T, namespace, name, tag, mediaType string) digest.Digest {
	t.Helper()
	repoID, err := f.store.EnsureRepository(t.Context(), oci.RepositoryName{Namespace: namespace, Name: name})
	require.NoError(t, err)
	content := []byte(`{"schemaVersion":2,"mediaType":"` + mediaType + `","tag":"` + tag + `"}`)
	dgst := digest.FromBytes(content)
	_, err = f.store.PutManifest(t.Context(), repoID, oci.ManifestRecord{
		Digest: dgst, MediaType: mediaType, Content: content, Tag: tag,
	})
	require.NoError(t, err)
	return dgst
}

func (f *fixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	_, err := f.db.ExecContext(t.Context(), query, args...)
	require.NoError(t, err)
}

func (f *fixture) get(t *testing.T, user, password string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, PagePath, http.NoBody)
	if user != "" {
		req.SetBasicAuth(user, password)
	}
	rec := httptest.NewRecorder()
	f.handler.ServeHTTP(rec, req)
	return rec
}

func TestImagesRequiresCredentials(t *testing.T) {
	f := newFixture(t)
	f.push(t, testUser, "app", "v1", v1.MediaTypeImageManifest)

	for _, tc := range []struct{ name, user, password string }{
		{"missing", "", ""},
		{"wrong password", testUser, "wrong"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := f.get(t, tc.user, tc.password)
			assert.Equal(t, http.StatusUnauthorized, rec.Code)
			assert.Equal(t, `Basic realm="registry.test"`, rec.Header().Get("WWW-Authenticate"))
			assert.NotContains(t, rec.Body.String(), "admin/app")
		})
	}
}

func TestImagesListsOnlyPullableImageRepositories(t *testing.T) {
	f := newFixture(t)
	imageDigest := f.push(t, testUser, "app", "v1", v1.MediaTypeImageManifest)
	indexDigest := f.push(t, testUser, "app", "multi", v1.MediaTypeImageIndex)
	f.push(t, testUser, "app", "list", dockerManifestList)
	f.push(t, "bob", "secret", "v1", v1.MediaTypeImageManifest)
	f.push(t, "bob", "shared", "v1", v1.MediaTypeImageManifest)
	f.push(t, testUser, "chart", "v1", v1.MediaTypeImageManifest)
	f.exec(t, `UPDATE repository SET visibility_id = (SELECT id FROM visibility WHERE name = 'public') WHERE name = 'shared'`)
	f.exec(t, `UPDATE repository SET kind_id = (SELECT id FROM repositorykind WHERE name = 'application') WHERE name = 'chart'`)

	rec := f.get(t, testUser, testPassword)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	assert.Equal(t, "text/html; charset=utf-8", rec.Header().Get("Content-Type"))
	body := rec.Body.String()

	assert.Contains(t, body, `<span id="repo-0">admin/app</span>`)
	assert.Contains(t, body, `<span id="repo-1">bob/shared</span>`)
	assert.NotContains(t, body, "bob/secret")
	assert.NotContains(t, body, "admin/chart")

	assert.Contains(t, body, `data-label="Tag">multi</td><td class="pf-v6-c-table__td" data-label="Type">Index</td>`)
	assert.Contains(t, body, `data-label="Tag">list</td><td class="pf-v6-c-table__td" data-label="Type">Index</td>`)
	assert.Contains(t, body, `data-label="Tag">v1</td><td class="pf-v6-c-table__td" data-label="Type">Image</td>`)
	assert.Contains(t, body, `data-copy="`+indexDigest.String()+`"`)
	assert.Contains(t, body, ">sha256:"+imageDigest.Encoded()[:12]+"</code>")
	assert.NotContains(t, body, ">No images</h2>")
}

func TestImagesEmptyRegistry(t *testing.T) {
	f := newFixture(t)

	rec := f.get(t, testUser, testPassword)
	require.Equal(t, http.StatusOK, rec.Code)
	body := rec.Body.String()
	assert.Contains(t, body, ">No images</h2>")
	assert.NotContains(t, body, "data-filter")
}

func TestImagesEscapesNames(t *testing.T) {
	f := newFixture(t)
	f.push(t, testUser, `x"><script>alert(1)</script>`, `<img src=x onerror=alert(2)>`, v1.MediaTypeImageManifest)

	body := f.get(t, testUser, testPassword).Body.String()
	assert.NotContains(t, body, "<script>alert(1)")
	assert.NotContains(t, body, "<img src=x")
	assert.Contains(t, body, "&lt;script&gt;alert(1)&lt;/script&gt;")
	assert.Contains(t, body, "&lt;img src=x onerror=alert(2)&gt;")
}

func TestAssetHandlerServesEmbeddedFiles(t *testing.T) {
	for path, contentType := range map[string]string{
		"images.css":                           "text/css; charset=utf-8",
		"images.js":                            "text/javascript; charset=utf-8",
		"theme.js":                             "text/javascript; charset=utf-8",
		"RH_Logo_Quay_Black_UX-horizontal.svg": "image/svg+xml",
		"RH_Logo_Quay_White_UX-horizontal.svg": "image/svg+xml",
		"fonts/RedHatTextVF.woff2":             "font/woff2",
		"fonts/RedHatDisplayVF.woff2":          "font/woff2",
		"fonts/RedHatMonoVF.woff2":             "font/woff2",
	} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, AssetPrefix+path, http.NoBody)
			AssetHandler().ServeHTTP(rec, req)
			assert.Equal(t, http.StatusOK, rec.Code)
			assert.Equal(t, contentType, rec.Header().Get("Content-Type"))
			assert.NotZero(t, rec.Body.Len())
		})
	}
}
