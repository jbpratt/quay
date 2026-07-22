package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMiddlewareWrapsCanonicalRedirects(t *testing.T) {
	middlewareCalls := 0
	handlerCalls := 0
	handler := newHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		handlerCalls++
		w.WriteHeader(http.StatusNoContent)
	}), options{
		middleware: func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				middlewareCalls++
				next.ServeHTTP(w, r)
			})
		},
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x/../metrics", http.NoBody)
	handler.ServeHTTP(response, request)

	assert.Equal(t, http.StatusTemporaryRedirect, response.Code)
	assert.Equal(t, 1, middlewareCalls)
	assert.Zero(t, handlerCalls)
}
