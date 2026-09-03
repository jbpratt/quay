package gc_test

// End-to-end consistency between the registry (distribution + quay driver +
// quaydb middleware) and the garbage collector: SQLite is the only source of
// truth for manifests, and nothing a live tag or index references is ever
// collected. Exercises the scenarios from the "OMR v3 split brain" report.

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/distribution/distribution/v3/configuration"
	"github.com/distribution/distribution/v3/registry/handlers"
	"github.com/opencontainers/go-digest"
	"github.com/stretchr/testify/require"

	"github.com/quay/quay/internal/dal/dbcore"
	"github.com/quay/quay/internal/dal/metastore"
	"github.com/quay/quay/internal/gc"
	"github.com/quay/quay/internal/oci"
	"github.com/quay/quay/internal/oci/storage"
	"github.com/quay/quay/internal/oci/storage/local"
	registrymw "github.com/quay/quay/internal/registry/distribution/middleware"
)

const (
	mtOCIManifest = "application/vnd.oci.image.manifest.v1+json"
	mtOCIIndex    = "application/vnd.oci.image.index.v1+json"
	mtOCIConfig   = "application/vnd.oci.image.config.v1+json"
	mtOCILayer    = "application/vnd.oci.image.layer.v1.tar"
)

type registryEnv struct {
	t         *testing.T
	db        *sql.DB
	blobs     *local.Driver
	collector gc.Collector
	srv       *httptest.Server
}

func setupRegistry(t *testing.T) *registryEnv {
	t.Helper()
	dir := t.TempDir()
	db, err := dbcore.Setup(t.Context(), filepath.Join(dir, "quay.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	store, err := metastore.NewSQLiteStore(t.Context(), db)
	require.NoError(t, err)

	storagePath := filepath.Join(dir, "storage")
	blobs, err := local.New(storagePath)
	require.NoError(t, err)

	locker := oci.NewBlobLockSet()
	collector := gc.NewCollector(gc.NewSQLiteStore(db), blobs, locker, slog.New(slog.DiscardHandler))

	local.Register()
	require.NoError(t, registrymw.Register())

	distCfg := &configuration.Configuration{
		Storage: configuration.Storage{
			local.Name(): local.Parameters(storagePath, store),
			"delete":     configuration.Parameters{"enabled": true},
			"maintenance": configuration.Parameters{
				"uploadpurging": map[interface{}]interface{}{"enabled": false},
			},
		},
	}
	distCfg.Middleware = map[string][]configuration.Middleware{
		"repository": {{
			Name:    registrymw.Name(),
			Options: registrymw.Parameters(store, locker, "library"),
		}},
	}
	srv := httptest.NewServer(handlers.NewApp(context.Background(), distCfg))
	t.Cleanup(srv.Close)

	return &registryEnv{t: t, db: db, blobs: blobs, collector: collector, srv: srv}
}

func (e *registryEnv) do(method, path, contentType string, body []byte) int {
	e.t.Helper()
	req, err := http.NewRequestWithContext(e.t.Context(), method, e.srv.URL+path, bytes.NewReader(body))
	require.NoError(e.t, err)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Accept", mtOCIManifest+", "+mtOCIIndex)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(e.t, err)
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	return resp.StatusCode
}

func (e *registryEnv) pushBlob(repo string, content []byte) digest.Digest {
	e.t.Helper()
	dgst := digest.FromBytes(content)
	start, err := http.NewRequestWithContext(e.t.Context(), http.MethodPost, e.srv.URL+"/v2/"+repo+"/blobs/uploads/", http.NoBody)
	require.NoError(e.t, err)
	resp, err := http.DefaultClient.Do(start)
	require.NoError(e.t, err)
	_ = resp.Body.Close()
	require.Equal(e.t, http.StatusAccepted, resp.StatusCode, "start upload")

	loc := resp.Header.Get("Location")
	sep := "?"
	if strings.Contains(loc, "?") {
		sep = "&"
	}
	put, err := http.NewRequestWithContext(e.t.Context(), http.MethodPut, loc+sep+"digest="+dgst.String(), bytes.NewReader(content))
	require.NoError(e.t, err)
	put.Header.Set("Content-Type", "application/octet-stream")
	resp, err = http.DefaultClient.Do(put)
	require.NoError(e.t, err)
	_ = resp.Body.Close()
	require.Equal(e.t, http.StatusCreated, resp.StatusCode, "complete upload")
	return dgst
}

// pushImage pushes a config blob, one layer, and an OCI manifest. An empty ref
// pushes the manifest by digest.
func (e *registryEnv) pushImage(repo, ref, seed string) (manifest []byte, dgst, layer digest.Digest) {
	e.t.Helper()
	config := []byte(`{"architecture":"amd64","os":"linux","rootfs":{"type":"layers","diff_ids":[]}}`)
	layerContent := []byte("layer-" + seed)
	cfgDgst := e.pushBlob(repo, config)
	layer = e.pushBlob(repo, layerContent)

	manifest, err := json.Marshal(map[string]any{
		"schemaVersion": 2,
		"mediaType":     mtOCIManifest,
		"config":        map[string]any{"mediaType": mtOCIConfig, "digest": cfgDgst, "size": len(config)},
		"layers":        []any{map[string]any{"mediaType": mtOCILayer, "digest": layer, "size": len(layerContent)}},
	})
	require.NoError(e.t, err)
	dgst = digest.FromBytes(manifest)
	if ref == "" {
		ref = dgst.String()
	}
	require.Equal(e.t, http.StatusCreated, e.do(http.MethodPut, manifestPath(repo, ref), mtOCIManifest, manifest), "manifest put")
	return manifest, dgst, layer
}

func (e *registryEnv) index(child []byte, childDgst digest.Digest) []byte {
	e.t.Helper()
	index, err := json.Marshal(map[string]any{
		"schemaVersion": 2,
		"mediaType":     mtOCIIndex,
		"manifests": []any{map[string]any{
			"mediaType": mtOCIManifest,
			"digest":    childDgst,
			"size":      len(child),
			"platform":  map[string]any{"architecture": "arm64", "os": "linux"},
		}},
	})
	require.NoError(e.t, err)
	return index
}

func (e *registryEnv) count(query string, args ...any) int {
	e.t.Helper()
	var n int
	require.NoError(e.t, e.db.QueryRowContext(e.t.Context(), query, args...).Scan(&n))
	return n
}

func (e *registryEnv) exec(query string) {
	e.t.Helper()
	_, err := e.db.ExecContext(e.t.Context(), query)
	require.NoError(e.t, err)
}

func (e *registryEnv) collect() gc.Stats {
	e.t.Helper()
	stats, err := e.collector.Collect(e.t.Context())
	require.NoError(e.t, err)
	return stats
}

func manifestPath(repo, ref string) string { return fmt.Sprintf("/v2/%s/manifests/%s", repo, ref) }
func blobPath(repo string, d digest.Digest) string {
	return fmt.Sprintf("/v2/%s/blobs/%s", repo, d)
}

const manifestBlobLinks = `SELECT COUNT(*) FROM manifestblob mb JOIN manifest m ON m.id = mb.manifest_id WHERE m.digest = ?`

func TestRegistry_ManifestPushIsDatabaseOnly(t *testing.T) {
	e := setupRegistry(t)
	const repo = "lib/app"

	content, dgst, _ := e.pushImage(repo, "latest", "a")

	_, err := e.blobs.Stat(t.Context(), dgst)
	require.ErrorIs(t, err, storage.ErrNotExist, "manifest bytes must not be written to blob storage")
	var stored string
	require.NoError(t, e.db.QueryRowContext(t.Context(), `SELECT manifest_bytes FROM manifest WHERE digest = ?`, dgst.String()).Scan(&stored))
	require.Equal(t, string(content), stored)
	require.Equal(t, http.StatusOK, e.do(http.MethodGet, manifestPath(repo, dgst.String()), "", nil))
}

func TestRegistry_ManifestAbsentFromDatabaseIsGone(t *testing.T) {
	e := setupRegistry(t)
	const repo = "lib/app"

	_, dgst, _ := e.pushImage(repo, "", "a")
	require.Equal(t, http.StatusOK, e.do(http.MethodHead, manifestPath(repo, dgst.String()), "", nil))

	// The reporter's experiment: remove the manifest from the database by hand.
	e.exec(`DELETE FROM tag; DELETE FROM manifestblob; DELETE FROM manifest`)
	require.Equal(t, http.StatusNotFound, e.do(http.MethodHead, manifestPath(repo, dgst.String()), "", nil))
	require.Equal(t, http.StatusNotFound, e.do(http.MethodGet, manifestPath(repo, dgst.String()), "", nil))
}

func TestRegistry_DeletedManifestNotServed(t *testing.T) {
	e := setupRegistry(t)
	const repo = "lib/del"

	_, dgst, _ := e.pushImage(repo, "latest", "x")
	require.Equal(t, http.StatusAccepted, e.do(http.MethodDelete, manifestPath(repo, dgst.String()), "", nil))
	require.Equal(t, http.StatusNotFound, e.do(http.MethodGet, manifestPath(repo, dgst.String()), "", nil))
	require.Equal(t, http.StatusNotFound, e.do(http.MethodHead, manifestPath(repo, dgst.String()), "", nil))
}

func TestRegistry_PushByDigestSurvivesGC(t *testing.T) {
	e := setupRegistry(t)
	const repo = "lib/app"

	_, dgst, layer := e.pushImage(repo, "", "a")
	require.Equal(t, 1, e.count(`SELECT COUNT(*) FROM tag WHERE hidden = 1 AND lifetime_end_ms IS NOT NULL`), "temp tag")

	stats := e.collect()
	require.Equal(t, 0, stats.ManifestsDeleted, "untagged manifest survives the next GC cycle")

	e.exec(`UPDATE uploadedblob SET expires_at = datetime('now', '-2 hours')`)
	stats = e.collect()
	require.Equal(t, 0, stats.BlobsDeleted, "layers stay protected through manifestblob")
	require.Equal(t, http.StatusOK, e.do(http.MethodGet, manifestPath(repo, dgst.String()), "", nil))
	require.Equal(t, http.StatusOK, e.do(http.MethodGet, blobPath(repo, layer), "", nil))
}

func TestRegistry_MultiArchPushWithGCBetweenChildAndIndex(t *testing.T) {
	e := setupRegistry(t)
	const repo = "lib/multi"

	child, childDgst, layer := e.pushImage(repo, "", "arm64")
	require.Equal(t, 0, e.collect().ManifestsDeleted, "child survives GC before the index arrives")
	require.Equal(t, http.StatusCreated, e.do(http.MethodPut, manifestPath(repo, "v1"), mtOCIIndex, e.index(child, childDgst)))

	var childBytes string
	require.NoError(t, e.db.QueryRowContext(t.Context(), `SELECT manifest_bytes FROM manifest WHERE digest = ?`, childDgst.String()).Scan(&childBytes))
	require.Equal(t, string(child), childBytes, "child content intact, no placeholder row")
	require.Equal(t, 2, e.count(manifestBlobLinks, childDgst.String()))

	e.exec(`UPDATE uploadedblob SET expires_at = datetime('now', '-2 hours')`)
	e.exec(`UPDATE tag SET lifetime_end_ms = 1 WHERE hidden = 1`) // temp tag long gone; index tag protects the child
	stats := e.collect()
	require.Equal(t, 0, stats.ManifestsDeleted)
	require.Equal(t, 0, stats.BlobsDeleted)
	require.Equal(t, http.StatusOK, e.do(http.MethodGet, manifestPath(repo, "v1"), "", nil))
	require.Equal(t, http.StatusOK, e.do(http.MethodGet, manifestPath(repo, childDgst.String()), "", nil))
	require.Equal(t, http.StatusOK, e.do(http.MethodGet, blobPath(repo, layer), "", nil))
}

func TestRegistry_IndexWithMissingChildRejected(t *testing.T) {
	e := setupRegistry(t)
	const repo = "lib/multi"

	child, childDgst, _ := e.pushImage(repo, "", "s390x")
	e.exec(`DELETE FROM tag; DELETE FROM manifestblob; DELETE FROM manifest`)

	require.Equal(t, http.StatusBadRequest, e.do(http.MethodPut, manifestPath(repo, "v1"), mtOCIIndex, e.index(child, childDgst)), "MANIFEST_BLOB_UNKNOWN")
	require.Equal(t, 0, e.count(`SELECT COUNT(*) FROM manifest`), "no placeholder rows")
}
