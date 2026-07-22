package cmd

import (
	"bytes"
	"log/slog"
	"testing"
	"time"

	"github.com/quay/quay/internal/config"
	"github.com/stretchr/testify/assert"
)

func TestConfigureStandaloneSuperuser(t *testing.T) {
	t.Run("defaults follow initialized user", func(t *testing.T) {
		resolved := &config.Resolved{Config: config.NewDefault("localhost", "/data/storage")}

		configureStandaloneSuperuser(resolved, "custom-admin")

		assert.Equal(t, []string{"custom-admin"}, resolved.Config.SuperUsers)
	})

	t.Run("explicit config remains authoritative", func(t *testing.T) {
		resolved := &config.Resolved{
			Config:   config.NewDefault("localhost", "/data/storage"),
			FromFile: true,
		}
		resolved.Config.SuperUsers = []string{"configured-admin"}

		configureStandaloneSuperuser(resolved, "database-user")

		assert.Equal(t, []string{"configured-admin"}, resolved.Config.SuperUsers)
	})
}

func TestServeHasNoBootstrapCredentialFlags(t *testing.T) {
	cmd := newServeCmd()
	assert.Nil(t, cmd.Flags.Lookup("admin-username"))
	assert.Nil(t, cmd.Flags.Lookup("init-password"))
	assert.Nil(t, cmd.Flags.Lookup("init-password-stdin"))
}

func TestServeDefaultHostnameIncludesListenPort(t *testing.T) {
	cmd := newServeCmd()
	assert.Equal(t, "localhost:8443", cmd.Flags.Lookup("hostname").DefValue)
}

func TestNewTracingProviderHonorsFeatureFlag(t *testing.T) {
	t.Setenv("OTEL_TRACES_EXPORTER", "invalid")

	t.Run("absent", func(t *testing.T) {
		provider, err := newTracingProvider(t.Context(), &config.Config{})
		assert.NoError(t, err)
		assert.NotNil(t, provider)
	})

	t.Run("false", func(t *testing.T) {
		disabled := false
		provider, err := newTracingProvider(t.Context(), &config.Config{
			Features: config.Features{FeatureOTELTracing: &disabled},
		})
		assert.NoError(t, err)
		assert.NotNil(t, provider)
	})

	t.Run("true", func(t *testing.T) {
		enabled := true
		provider, err := newTracingProvider(t.Context(), &config.Config{
			Features: config.Features{FeatureOTELTracing: &enabled},
		})
		assert.Error(t, err)
		assert.Nil(t, provider)
	})
}

func TestNewTracingProviderWarnsAboutIgnoredLegacyConfig(t *testing.T) {
	t.Setenv("OTEL_TRACES_EXPORTER", "invalid")
	var output bytes.Buffer
	oldLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(oldLogger) })
	enabled := true

	provider, err := newTracingProvider(t.Context(), &config.Config{
		Features: config.Features{FeatureOTELTracing: &enabled},
		Extra: map[string]any{
			"OTEL_CONFIG":                map[string]any{"dt_api_token": "sentinel-secret"},
			"OTEL_TRACING_EXCLUDED_URLS": "/sensitive/path",
		},
	})

	assert.Error(t, err)
	assert.Nil(t, provider)
	assert.Contains(t, output.String(), "OTEL_CONFIG")
	assert.Contains(t, output.String(), "OTEL_TRACING_EXCLUDED_URLS")
	assert.NotContains(t, output.String(), "sentinel-secret")
	assert.NotContains(t, output.String(), "/sensitive/path")
}

func TestShutdownTracingAllowsNilProvider(t *testing.T) {
	assert.NotPanics(t, func() { shutdownTracing(nil) })
	assert.Equal(t, 5*time.Second, tracingShutdownTimeout)
}

func TestRegistryTLSHostnameRemovesOnlyPublicPort(t *testing.T) {
	tests := []struct {
		name, publicHostname, want string
	}{
		{name: "dns with port", publicHostname: "registry.example.com:9443", want: "registry.example.com"},
		{name: "dns without port", publicHostname: "registry.example.com", want: "registry.example.com"},
		{name: "ipv6 with port", publicHostname: "[2001:db8::1]:9443", want: "2001:db8::1"},
		{name: "ipv6 without port", publicHostname: "[2001:db8::1]", want: "2001:db8::1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := registryTLSHostname(tt.publicHostname)
			assert.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}
