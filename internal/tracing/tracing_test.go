package tracing

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/baggage"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

type recordedSpan struct {
	name         string
	traceID      string
	parentSpanID string
	parentRemote bool
	serviceName  string
	attributes   map[string]string
	spanAttrs    map[string]string
}

type recordingExporter struct {
	mu       sync.Mutex
	spans    []recordedSpan
	shutdown bool
}

func (e *recordingExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	for _, span := range spans {
		record := recordedSpan{
			name:         span.Name(),
			traceID:      span.SpanContext().TraceID().String(),
			parentSpanID: span.Parent().SpanID().String(),
			parentRemote: span.Parent().IsRemote(),
			attributes:   make(map[string]string),
			spanAttrs:    make(map[string]string),
		}
		for _, resourceAttribute := range span.Resource().Attributes() {
			if resourceAttribute.Value.Type() == attribute.STRING {
				record.attributes[string(resourceAttribute.Key)] = resourceAttribute.Value.AsString()
			}
		}
		for _, spanAttribute := range span.Attributes() {
			if spanAttribute.Value.Type() == attribute.STRING {
				record.spanAttrs[string(spanAttribute.Key)] = spanAttribute.Value.AsString()
			}
		}
		record.serviceName = record.attributes["service.name"]
		e.spans = append(e.spans, record)
	}
	return nil
}

func (e *recordingExporter) Shutdown(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.shutdown = true
	return nil
}

func (e *recordingExporter) snapshot() ([]recordedSpan, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]recordedSpan(nil), e.spans...), e.shutdown
}

func preserveGlobals(t *testing.T) {
	t.Helper()

	oldProvider := otel.GetTracerProvider()
	oldPropagator := otel.GetTextMapPropagator()
	oldErrorHandler := otel.GetErrorHandler()
	t.Cleanup(func() {
		otel.SetTracerProvider(oldProvider)
		otel.SetTextMapPropagator(oldPropagator)
		otel.SetErrorHandler(oldErrorHandler)
	})
}

func newRecordingProvider(t *testing.T) (*Provider, *recordingExporter) {
	t.Helper()
	return newRecordingProviderWithEnv(t, nil)
}

func newRecordingProviderWithEnv(t *testing.T, env map[string]string) (*Provider, *recordingExporter) {
	t.Helper()
	preserveGlobals(t)
	clearOTELTestEnvironment(t)
	for name, value := range env {
		t.Setenv(name, value)
	}

	exporter := &recordingExporter{}
	provider, err := newProvider(t.Context(), func(context.Context) (sdktrace.SpanExporter, error) {
		return exporter, nil
	})
	require.NoError(t, err)

	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(t.Context()), time.Second)
		defer cancel()
		_ = provider.Shutdown(ctx)
	})

	return provider, exporter
}

func clearOTELTestEnvironment(t *testing.T) {
	t.Helper()
	for _, entry := range os.Environ() {
		name, _, _ := strings.Cut(entry, "=")
		if strings.HasPrefix(name, "OTEL_") {
			t.Setenv(name, "")
		}
	}
}

func TestNewProviderWithNoneExporter(t *testing.T) {
	preserveGlobals(t)
	clearOTELTestEnvironment(t)
	t.Setenv("OTEL_TRACES_EXPORTER", "none")

	provider, err := NewProvider(t.Context())
	require.NoError(t, err)
	require.NotNil(t, provider)
	assert.Same(t, provider.tracerProvider, otel.GetTracerProvider())
	require.NoError(t, provider.Shutdown(t.Context()))
}

func TestNewProviderRejectsInvalidExporter(t *testing.T) {
	preserveGlobals(t)
	clearOTELTestEnvironment(t)
	t.Setenv("OTEL_TRACES_EXPORTER", "invalid")

	provider, err := NewProvider(t.Context())
	assert.ErrorContains(t, err, "create OpenTelemetry span exporter")
	assert.Nil(t, provider)
}

func TestShutdownFlushesPendingSpans(t *testing.T) {
	provider, exporter := newRecordingProviderWithEnv(t, map[string]string{
		otelBSPScheduleDelayEnv: "60000",
	})

	_, span := provider.tracerProvider.Tracer("test").Start(t.Context(), "pending")
	span.End()
	spans, shutdown := exporter.snapshot()
	assert.Empty(t, spans)
	assert.False(t, shutdown)

	require.NoError(t, provider.Shutdown(t.Context()))
	spans, shutdown = exporter.snapshot()
	assert.Len(t, spans, 1)
	assert.True(t, shutdown)
}

func TestDefaultServiceName(t *testing.T) {
	provider, exporter := newRecordingProvider(t)

	_, span := provider.tracerProvider.Tracer("test").Start(t.Context(), "identity")
	span.End()
	require.NoError(t, provider.Shutdown(t.Context()))

	spans, _ := exporter.snapshot()
	require.Len(t, spans, 1)
	assert.Equal(t, "quay", spans[0].serviceName)
}

func TestEnvironmentResourceOverrides(t *testing.T) {
	provider, exporter := newRecordingProviderWithEnv(t, map[string]string{
		"OTEL_SERVICE_NAME":        "custom-quay",
		"OTEL_RESOURCE_ATTRIBUTES": "service.name=ignored,service.version=1.2.3,deployment.environment.name=test",
	})

	_, span := provider.tracerProvider.Tracer("test").Start(t.Context(), "identity")
	span.End()
	require.NoError(t, provider.Shutdown(t.Context()))

	spans, _ := exporter.snapshot()
	require.Len(t, spans, 1)
	assert.Equal(t, "custom-quay", spans[0].serviceName)
	assert.Equal(t, "1.2.3", spans[0].attributes["service.version"])
	assert.Equal(t, "test", spans[0].attributes["deployment.environment.name"])
}

func TestEnvironmentSamplerOverride(t *testing.T) {
	provider, exporter := newRecordingProviderWithEnv(t, map[string]string{
		"OTEL_TRACES_SAMPLER": "always_off",
	})

	_, span := provider.tracerProvider.Tracer("test").Start(t.Context(), "not-sampled")
	assert.False(t, span.SpanContext().IsSampled())
	span.End()
	require.NoError(t, provider.Shutdown(t.Context()))

	spans, _ := exporter.snapshot()
	assert.Empty(t, spans)
}

func TestWrapHTTPJoinsRemoteParentAndPropagatesBaggage(t *testing.T) {
	provider, exporter := newRecordingProvider(t)
	var baggageValue string
	handler := provider.WrapHTTP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		baggageValue = baggage.FromContext(r.Context()).Member("tenant").Value()
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/repository", http.NoBody)
	req.Header.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	req.Header.Set("baggage", "tenant=acme")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	require.NoError(t, provider.Shutdown(t.Context()))

	assert.Equal(t, http.StatusNoContent, response.Code)
	assert.Equal(t, "acme", baggageValue)
	spans, _ := exporter.snapshot()
	require.Len(t, spans, 1)
	assert.Equal(t, "4bf92f3577b34da6a3ce929d0e0e4736", spans[0].traceID)
	assert.Equal(t, "00f067aa0ba902b7", spans[0].parentSpanID)
	assert.True(t, spans[0].parentRemote)
}

func TestWrapHTTPHonorsUnsampledRemoteParent(t *testing.T) {
	provider, exporter := newRecordingProvider(t)
	handler := provider.WrapHTTP(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/repository", http.NoBody)
	req.Header.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	require.NoError(t, provider.Shutdown(t.Context()))

	assert.Equal(t, http.StatusNoContent, response.Code)
	spans, _ := exporter.snapshot()
	assert.Empty(t, spans)
}

func TestWrapHTTPUsesBoundedSpanNamesAndPreservesResponse(t *testing.T) {
	provider, exporter := newRecordingProvider(t)
	handler := provider.WrapHTTP(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Test", "preserved")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("response body"))
	}))

	tests := []struct {
		method string
		path   string
		name   string
	}{
		{method: http.MethodGet, path: "/v2/acme/repo/manifests/latest", name: "GET /v2/*"},
		{method: http.MethodPost, path: v2AuthPath, name: "POST /v2/auth"},
		{method: http.MethodPut, path: "/api/v1/repository", name: "PUT /api/*"},
		{method: http.MethodDelete, path: "/unknown/identifier", name: "DELETE"},
		{method: "EXTENSION-123", path: "/v2/acme/repo", name: "_OTHER /v2/*"},
		{method: "EXTENSION-456", path: "/unknown/identifier", name: "_OTHER"},
	}
	for _, test := range tests {
		request := httptest.NewRequestWithContext(t.Context(), test.method, test.path, http.NoBody)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)

		assert.Equal(t, http.StatusCreated, response.Code)
		assert.Equal(t, "preserved", response.Header().Get("X-Test"))
		assert.Equal(t, "response body", response.Body.String())
	}
	require.NoError(t, provider.Shutdown(t.Context()))

	spans, _ := exporter.snapshot()
	require.Len(t, spans, len(tests))
	for i, test := range tests {
		assert.Equal(t, test.name, spans[i].name)
	}
}

func TestWrapHTTPExcludesExactProbePaths(t *testing.T) {
	provider, exporter := newRecordingProvider(t)
	requests := 0
	handler := provider.WrapHTTP(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		w.WriteHeader(http.StatusAccepted)
	}))

	for _, path := range []string{healthPath, metricsPath} {
		response := httptest.NewRecorder()
		request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, http.NoBody)
		handler.ServeHTTP(response, request)
		assert.Equal(t, http.StatusAccepted, response.Code)
	}
	for _, path := range []string{"/healthz/", "/healthz-extra", "/metrics/", "/metrics-proxy"} {
		response := httptest.NewRecorder()
		request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, http.NoBody)
		handler.ServeHTTP(response, request)
		assert.Equal(t, http.StatusAccepted, response.Code)
	}
	require.NoError(t, provider.Shutdown(t.Context()))

	assert.Equal(t, 6, requests)
	spans, _ := exporter.snapshot()
	require.Len(t, spans, 4)
	for _, span := range spans {
		assert.Equal(t, http.MethodGet, span.name)
	}
}

func TestDefaultSpanAttributeValueLengthLimit(t *testing.T) {
	provider, exporter := newRecordingProvider(t)
	handler := provider.WrapHTTP(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	longValue := strings.Repeat("x", defaultAttributeValueLengthLimit+128)

	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/"+longValue, http.NoBody)
	request.Header.Set("User-Agent", longValue)
	handler.ServeHTTP(httptest.NewRecorder(), request)
	require.NoError(t, provider.Shutdown(t.Context()))

	spans, _ := exporter.snapshot()
	require.Len(t, spans, 1)
	assert.Len(t, spans[0].spanAttrs["http.target"], defaultAttributeValueLengthLimit)
	assert.Len(t, spans[0].spanAttrs["user_agent.original"], defaultAttributeValueLengthLimit)
}

func TestSpanAttributeValueLengthEnvironmentOverride(t *testing.T) {
	provider, exporter := newRecordingProviderWithEnv(t, map[string]string{
		otelSpanAttributeValueLengthEnv: "16",
	})
	handler := provider.WrapHTTP(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/"+strings.Repeat("x", 64), http.NoBody)
	handler.ServeHTTP(httptest.NewRecorder(), request)
	require.NoError(t, provider.Shutdown(t.Context()))

	spans, _ := exporter.snapshot()
	require.Len(t, spans, 1)
	assert.Len(t, spans[0].spanAttrs["http.target"], 16)
}

func TestProviderZeroValueIsNoOp(t *testing.T) {
	provider := &Provider{}
	handler := http.NewServeMux()

	assert.Same(t, handler, provider.WrapHTTP(handler))
	assert.NoError(t, provider.Shutdown(t.Context()))
}

func TestNewProviderPropagatesExporterFactoryError(t *testing.T) {
	preserveGlobals(t)
	clearOTELTestEnvironment(t)
	wantErr := errors.New("exporter failed")
	provider, err := newProvider(t.Context(), func(context.Context) (sdktrace.SpanExporter, error) {
		return nil, wantErr
	})

	assert.ErrorIs(t, err, wantErr)
	assert.Nil(t, provider)
}

func TestProviderUsesW3CPropagators(t *testing.T) {
	provider, _ := newRecordingProvider(t)
	fields := provider.propagator.Fields()

	assert.ElementsMatch(t, propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	).Fields(), fields)
}

func TestRejectsUnsafeEnvironmentBeforeExporterCreation(t *testing.T) {
	tests := []struct {
		name  string
		env   string
		value string
	}{
		{name: "negative queue", env: "OTEL_BSP_MAX_QUEUE_SIZE", value: "-1"},
		{name: "zero delay", env: otelBSPScheduleDelayEnv, value: "0"},
		{name: "invalid batch size", env: "OTEL_BSP_MAX_EXPORT_BATCH_SIZE", value: "many"},
		{name: "invalid attribute limit", env: otelSpanAttributeValueLengthEnv, value: "many"},
		{name: "header uses colon syntax", env: "OTEL_EXPORTER_OTLP_HEADERS", value: "Authorization: Bearer sentinel-secret"},
		{name: "header has invalid escape", env: "OTEL_EXPORTER_OTLP_TRACES_HEADERS", value: "Authorization=Bearer%ZZsentinel-secret"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			preserveGlobals(t)
			clearOTELTestEnvironment(t)
			t.Setenv(test.env, test.value)
			exporterCalled := false

			provider, err := newProvider(t.Context(), func(context.Context) (sdktrace.SpanExporter, error) {
				exporterCalled = true
				return &recordingExporter{}, nil
			})

			assert.ErrorContains(t, err, test.env)
			assert.NotContains(t, err.Error(), "sentinel-secret")
			assert.Nil(t, provider)
			assert.False(t, exporterCalled)
		})
	}
}

func TestAcceptsValidOTLPHeaders(t *testing.T) {
	preserveGlobals(t)
	clearOTELTestEnvironment(t)
	t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=Bearer%20not-a-secret,X-Tenant=acme")

	provider, err := newProvider(t.Context(), func(context.Context) (sdktrace.SpanExporter, error) {
		return &recordingExporter{}, nil
	})
	require.NoError(t, err)
	require.NoError(t, provider.Shutdown(t.Context()))
}

func TestErrorHandlerRateLimitsRepeatedErrors(t *testing.T) {
	var output bytes.Buffer
	oldLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(oldLogger) })

	now := time.Unix(0, 0)
	handler := &errorHandler{now: func() time.Time { return now }}
	handler.Handle(errors.New("first"))
	handler.Handle(errors.New("second"))
	now = now.Add(openTelemetryErrorLogInterval)
	handler.Handle(errors.New("third"))

	assert.Equal(t, 2, strings.Count(output.String(), "msg=\"OpenTelemetry error\""))
	assert.Contains(t, output.String(), "suppressed=1")
}
