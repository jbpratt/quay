package googlelogin

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/quay/quay/config-tool/pkg/lib/shared"
)

const (
	goodClientID     = "QUAY_FIXTURE_ONLY-google-good-id"
	goodClientSecret = "QUAY_FIXTURE_ONLY-google-good-secret"
)

// newGoogleOAuthMockServer mimics Google's OAuth token endpoint: a
// recognized client id and secret gets "invalid_grant" (bad code, good client),
// anything else gets "invalid_client".
func newGoogleOAuthMockServer(t *testing.T) string {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("client_id") == goodClientID && r.URL.Query().Get("client_secret") == goodClientSecret {
			w.Write([]byte(`{"error":"invalid_grant"}`))
			return
		}
		w.Write([]byte(`{"error":"invalid_client"}`))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// TestValidateGoogleLogin tests the Validate function
func TestValidateGoogleLogin(t *testing.T) {

	reset := shared.SetGoogleTokenURLForTesting(newGoogleOAuthMockServer(t))
	t.Cleanup(reset)

	// Define test data
	var tests = []struct {
		name   string
		config map[string]interface{}
		want   string
	}{

		{name: "GoogleLoginNotSpecified", config: map[string]interface{}{}, want: "valid"},
		{name: "GoogleLoginOnMissingConfig", config: map[string]interface{}{"FEATURE_GOOGLE_LOGIN": true}, want: "invalid"},
		{name: "GoogleLoginMissingFields", config: map[string]interface{}{"FEATURE_GOOGLE_LOGIN": true, "GOOGLE_LOGIN_CONFIG": map[string]interface{}{}}, want: "invalid"},
		{name: "GoogleLoginBadCredentials", config: map[string]interface{}{"FEATURE_GOOGLE_LOGIN": true, "GOOGLE_LOGIN_CONFIG": map[string]interface{}{"CLIENT_ID": "QUAY_FIXTURE_ONLY-google-bad-id", "CLIENT_SECRET": "QUAY_FIXTURE_ONLY-google-bad-secret"}}, want: "invalid"},
		{name: "GoogleLoginGoodCredentials", config: map[string]interface{}{"FEATURE_GOOGLE_LOGIN": true, "GOOGLE_LOGIN_CONFIG": map[string]interface{}{"CLIENT_ID": goodClientID, "CLIENT_SECRET": goodClientSecret}}, want: "valid"},
	}

	// Iterate through tests
	for _, tt := range tests {

		// Run specific test
		t.Run(tt.name, func(t *testing.T) {

			// Get validation result
			fg, err := NewGoogleLoginFieldGroup(tt.config)
			if err != nil && tt.want != "typeError" {
				t.Errorf("Expected %s. Received %s", tt.want, err.Error())
			}

			opts := shared.Options{
				Mode: "testing",
			}

			validationErrors := fg.Validate(opts)

			// Get result type
			received := ""
			if len(validationErrors) == 0 {
				received = "valid"
			} else {
				received = "invalid"
			}

			// Compare with expected
			if tt.want != received {
				t.Errorf("Expected %s. Received %s", tt.want, received)
			}

		})
	}
}
