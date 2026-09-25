package bitbucketbuildtrigger

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/quay/quay/config-tool/pkg/lib/shared"
)

const (
	goodConsumerKey    = "QUAY_FIXTURE_ONLY-bitbucket-good-key"
	goodConsumerSecret = "QUAY_FIXTURE_ONLY-bitbucket-good-secret"
)

// newBitbucketOAuthMockServer mimics Bitbucket's OAuth token endpoint: the
// "code is not valid" error only comes back for a recognized consumer key and
// secret, mirroring how a real client id determines the error shape Bitbucket returns.
func newBitbucketOAuthMockServer(t *testing.T) string {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clientID, clientSecret, _ := r.BasicAuth()
		w.Header().Set("Content-Type", "application/json")
		if clientID == goodConsumerKey && clientSecret == goodConsumerSecret {
			w.Write([]byte(`{"error_description":"The specified code is not valid."}`))
			return
		}
		w.Write([]byte(`{"error_description":"invalid_client"}`))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// TestValidateSchema tests the ValidateSchema function
func TestValidateBitbucketBuildTrigger(t *testing.T) {

	reset := shared.SetBitbucketTokenURLForTesting(newBitbucketOAuthMockServer(t))
	t.Cleanup(reset)

	// Define test data
	var tests = []struct {
		name   string
		config map[string]interface{}
		want   string
	}{

		{name: "BuildSupportOff", config: map[string]interface{}{}, want: "valid"},
		{name: "BuildSupportOnBitbucketOff", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true}, want: "valid"},
		{name: "BuildSupportOnBitbucketOnMissingFields", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_BITBUCKET_BUILD": true}, want: "invalid"},
		{name: "BuildSupportOnBitbucketOnMissingConsumerKey", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_BITBUCKET_BUILD": true, "BITBUCKET_TRIGGER_CONFIG": map[string]interface{}{}}, want: "invalid"},
		{name: "BuildSupportOnBitbucketOnEmptyConsumerKey", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_BITBUCKET_BUILD": true, "BITBUCKET_TRIGGER_CONFIG": map[string]interface{}{"CONSUMER_KEY": ""}}, want: "invalid"},
		{name: "BuildSupportOnBitbucketOnMissingConsumerSecret", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_BITBUCKET_BUILD": true, "BITBUCKET_TRIGGER_CONFIG": map[string]interface{}{"CONSUMER_KEY": ""}}, want: "invalid"},
		{name: "BuildSupportOnBitbucketOnEmptyConsumerSecret", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_BITBUCKET_BUILD": true, "BITBUCKET_TRIGGER_CONFIG": map[string]interface{}{"CONSUMER_KEY": "", "CONSUMER_SECRET": ""}}, want: "invalid"},
		{name: "BuildSupportOnBitbucketOnInvalidConfig", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_BITBUCKET_BUILD": true, "BITBUCKET_TRIGGER_CONFIG": map[string]interface{}{"CONSUMER_KEY": "QUAY_FIXTURE_ONLY-bitbucket-bad-key", "CONSUMER_SECRET": "QUAY_FIXTURE_ONLY-bitbucket-bad-secret"}}, want: "invalid"},
		{name: "BuildSupportOnBitbucketOnValidConfig", config: map[string]interface{}{"FEATURE_BUILD_SUPPORT": true, "FEATURE_BITBUCKET_BUILD": true, "BITBUCKET_TRIGGER_CONFIG": map[string]interface{}{"CONSUMER_KEY": goodConsumerKey, "CONSUMER_SECRET": goodConsumerSecret}}, want: "valid"},
	}

	// Iterate through tests
	for _, tt := range tests {

		// Run specific test
		t.Run(tt.name, func(t *testing.T) {

			// Get validation result
			fg, err := NewBitbucketBuildTriggerFieldGroup(tt.config)
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
