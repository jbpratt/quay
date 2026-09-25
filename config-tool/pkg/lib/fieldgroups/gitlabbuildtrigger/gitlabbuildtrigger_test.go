package gitlabbuildtrigger

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/quay/quay/config-tool/pkg/lib/shared"
)

const (
	goodClientID     = "QUAY_FIXTURE_ONLY-gitlab-good-id"
	goodClientSecret = "QUAY_FIXTURE_ONLY-gitlab-good-secret"
)

// newGitLabOAuthMockServer mimics the GitLab OAuth token endpoint that
// shared.ValidateGitLabOAuth checks: a recognized client id and secret gets
// "invalid_grant" (bad code, good client), anything else gets "invalid_client".
func newGitLabOAuthMockServer(t *testing.T) string {
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

// TestValidateGitLabBuildTrigger tests the Validate function
func TestValidateGitLabBuildTrigger(t *testing.T) {

	fakeEndpoint := newGitLabOAuthMockServer(t)

	// Define test data
	var tests = []struct {
		name   string
		config map[string]interface{}
		want   string
	}{

		{name: "FeatureBuildOff", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": false}, want: "valid"},
		{name: "FeatureGitlabBuildOff", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_GITLAB_BUILD": true}, want: "invalid"},
		{name: "Valid", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_GITLAB_BUILD": true, "GITLAB_TRIGGER_CONFIG": map[string]interface{}{
			"CLIENT_ID":       goodClientID,
			"CLIENT_SECRET":   goodClientSecret,
			"GITLAB_ENDPOINT": fakeEndpoint,
		}}, want: "valid"},
		{name: "BadCredentials", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_GITLAB_BUILD": true, "GITLAB_TRIGGER_CONFIG": map[string]interface{}{
			"CLIENT_ID":       "QUAY_FIXTURE_ONLY-gitlab-bad-id",
			"CLIENT_SECRET":   "QUAY_FIXTURE_ONLY-gitlab-bad-secret",
			"GITLAB_ENDPOINT": fakeEndpoint,
		}}, want: "invalid"},
		{name: "NoClientSecret", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_GITLAB_BUILD": true, "GITLAB_TRIGGER_CONFIG": map[string]interface{}{
			"CLIENT_ID":       "clientid",
			"GITLAB_ENDPOINT": fakeEndpoint,
		}}, want: "invalid"},
		{name: "NoClientID", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_GITLAB_BUILD": true, "GITLAB_TRIGGER_CONFIG": map[string]interface{}{
			"CLIENT_SECRET":   "clientsecret",
			"GITLAB_ENDPOINT": fakeEndpoint,
		}}, want: "invalid"},
		{name: "NoGitlabEndpoint", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_GITLAB_BUILD": true, "GITLAB_TRIGGER_CONFIG": map[string]interface{}{
			"CLIENT_ID":     goodClientID,
			"CLIENT_SECRET": goodClientSecret,
		}}, want: "invalid"},
		{name: "InvalidGitlabEndpoint", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_GITLAB_BUILD": true, "GITLAB_TRIGGER_CONFIG": map[string]interface{}{
			"CLIENT_ID":       "clientid",
			"CLIENT_SECRET":   "clientsecret",
			"GITLAB_ENDPOINT": "not_a_valid_endpoint",
		}}, want: "invalid"},
	}

	// Iterate through tests
	for _, tt := range tests {

		// Run specific test
		t.Run(tt.name, func(t *testing.T) {

			// Get validation result
			fg, err := NewGitLabBuildTriggerFieldGroup(tt.config)
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
