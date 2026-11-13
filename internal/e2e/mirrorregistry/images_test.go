package mirrorregistry_test

import (
	"io"
	"net/http"
	"testing"

	v1 "github.com/opencontainers/image-spec/specs-go/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/quay/quay/internal/e2e/mirrorregistry/internal/e2etest"
)

func TestImagesPageListsPushedTags(t *testing.T) {
	h := e2etest.New(t)
	const repository = "admin/e2e-images-page"
	image := pushImage(t, h, repository, "v1", []byte(`{"architecture":"amd64","os":"linux"}`), []byte("images page layer"))
	_, err := h.Registry().PutManifest(t.Context(), repository, "multi", singleChildIndex(t, image), v1.MediaTypeImageIndex)
	require.NoError(t, err)

	status, header, _ := get(t, h, "/images", false)
	assert.Equal(t, http.StatusUnauthorized, status)
	assert.Contains(t, header.Get("WWW-Authenticate"), "Basic realm=")

	status, _, body := get(t, h, "/images", true)
	require.Equal(t, http.StatusOK, status)
	assert.Contains(t, body, repository)
	assert.Contains(t, body, `data-label="Tag">multi</td><td class="pf-v6-c-table__td" data-label="Type">Index</td>`)
	assert.Contains(t, body, `data-label="Tag">v1</td><td class="pf-v6-c-table__td" data-label="Type">Image</td>`)
	assert.Contains(t, body, `data-copy="`+image.digest.String()+`"`)

	status, header, _ = get(t, h, "/images/assets/images.css", false)
	assert.Equal(t, http.StatusOK, status)
	assert.Equal(t, "text/css; charset=utf-8", header.Get("Content-Type"))
}

func get(t *testing.T, h *e2etest.Harness, path string, authenticated bool) (status int, header http.Header, body string) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, h.BaseURL()+path, http.NoBody)
	require.NoError(t, err)
	if authenticated {
		req.SetBasicAuth(h.Credentials())
	}
	resp, err := h.HTTPClient().Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, resp.Header, string(raw)
}
