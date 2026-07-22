// Package tracing configures opt-in OpenTelemetry tracing for the Go server.
package tracing

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/contrib/exporters/autoexport"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

const (
	defaultServiceName               = "quay"
	defaultAttributeValueLengthLimit = 4096
	openTelemetryErrorLogInterval    = 30 * time.Second
	otelBSPScheduleDelayEnv          = "OTEL_BSP_SCHEDULE_DELAY"
	otelSpanAttributeValueLengthEnv  = "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT"
	otelAttributeValueLengthEnv      = "OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT"
	healthPath                       = "/healthz"
	metricsPath                      = "/metrics"
	v2AuthPath                       = "/v2/auth"
)

var positiveIntegerEnvironment = []string{
	otelBSPScheduleDelayEnv,
	"OTEL_BSP_EXPORT_TIMEOUT",
	"OTEL_BSP_MAX_QUEUE_SIZE",
	"OTEL_BSP_MAX_EXPORT_BATCH_SIZE",
}

var otlpHeaderEnvironment = []string{
	"OTEL_EXPORTER_OTLP_HEADERS",
	"OTEL_EXPORTER_OTLP_TRACES_HEADERS",
}

type spanExporterFactory func(context.Context) (sdktrace.SpanExporter, error)

// Provider owns the OpenTelemetry SDK provider and HTTP instrumentation.
type Provider struct {
	tracerProvider *sdktrace.TracerProvider
	propagator     propagation.TextMapPropagator
}

// NewProvider creates and globally installs an OpenTelemetry trace provider.
// Exporter, resource, sampler, and batch processor settings come from the
// standard OTEL_* environment variables.
func NewProvider(ctx context.Context) (*Provider, error) {
	return newProvider(ctx, func(ctx context.Context) (sdktrace.SpanExporter, error) {
		return autoexport.NewSpanExporter(ctx)
	})
}

func newProvider(ctx context.Context, exporterFactory spanExporterFactory) (*Provider, error) {
	if err := validateEnvironment(); err != nil {
		return nil, err
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceName(defaultServiceName)),
		resource.WithFromEnv(),
		resource.WithTelemetrySDK(),
	)
	if err != nil {
		return nil, fmt.Errorf("create OpenTelemetry resource: %w", err)
	}

	exporter, err := exporterFactory(ctx)
	if err != nil {
		return nil, fmt.Errorf("create OpenTelemetry span exporter: %w", err)
	}

	otel.SetErrorHandler(newErrorHandler())
	limits := sdktrace.NewSpanLimits()
	if !spanAttributeValueLengthConfigured() {
		limits.AttributeValueLengthLimit = defaultAttributeValueLengthLimit
	}

	tracerProvider := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithBatcher(exporter),
		sdktrace.WithRawSpanLimits(limits),
	)
	propagator := propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	)

	otel.SetTracerProvider(tracerProvider)
	otel.SetTextMapPropagator(propagator)

	return &Provider{
		tracerProvider: tracerProvider,
		propagator:     propagator,
	}, nil
}

// WrapHTTP instruments inbound HTTP requests while excluding probe endpoints.
func (p *Provider) WrapHTTP(handler http.Handler) http.Handler {
	if p == nil || p.tracerProvider == nil {
		return handler
	}

	return otelhttp.NewHandler(handler, "",
		otelhttp.WithTracerProvider(p.tracerProvider),
		otelhttp.WithPropagators(p.propagator),
		otelhttp.WithFilter(traceRequest),
		otelhttp.WithSpanNameFormatter(spanName),
	)
}

// Shutdown flushes pending spans and releases exporter resources.
func (p *Provider) Shutdown(ctx context.Context) error {
	if p == nil || p.tracerProvider == nil {
		return nil
	}
	return p.tracerProvider.Shutdown(ctx)
}

func traceRequest(r *http.Request) bool {
	return r.URL.Path != healthPath && r.URL.Path != metricsPath
}

func spanName(_ string, r *http.Request) string {
	method := normalizedMethod(r.Method)
	var route string
	switch {
	case r.URL.Path == v2AuthPath:
		route = v2AuthPath
	case strings.HasPrefix(r.URL.Path, "/v2/"):
		route = "/v2/*"
	case strings.HasPrefix(r.URL.Path, "/api/"):
		route = "/api/*"
	default:
		return method
	}
	return method + " " + route
}

func normalizedMethod(method string) string {
	switch method {
	case http.MethodConnect,
		http.MethodDelete,
		http.MethodGet,
		http.MethodHead,
		http.MethodOptions,
		http.MethodPatch,
		http.MethodPost,
		http.MethodPut,
		http.MethodTrace:
		return method
	default:
		return "_OTHER"
	}
}

func validateEnvironment() error {
	for _, name := range positiveIntegerEnvironment {
		value := os.Getenv(name)
		if value == "" {
			continue
		}
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed <= 0 {
			return fmt.Errorf("%s must be a positive integer", name)
		}
	}

	for _, name := range []string{
		otelSpanAttributeValueLengthEnv,
		otelAttributeValueLengthEnv,
	} {
		value := os.Getenv(name)
		if value == "" {
			continue
		}
		if _, err := strconv.Atoi(value); err != nil {
			return fmt.Errorf("%s must be an integer", name)
		}
	}

	for _, name := range otlpHeaderEnvironment {
		if err := validateOTLPHeaders(name, os.Getenv(name)); err != nil {
			return err
		}
	}
	return nil
}

func spanAttributeValueLengthConfigured() bool {
	return os.Getenv(otelSpanAttributeValueLengthEnv) != "" ||
		os.Getenv(otelAttributeValueLengthEnv) != ""
}

func validateOTLPHeaders(name, value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}

	for index, pair := range strings.Split(value, ",") {
		key, encodedValue, found := strings.Cut(pair, "=")
		if !found || !validHeaderName(strings.TrimSpace(key)) {
			return fmt.Errorf("%s contains an invalid header at position %d", name, index+1)
		}
		if _, err := url.PathUnescape(encodedValue); err != nil {
			return fmt.Errorf("%s contains an invalid encoded value at position %d", name, index+1)
		}
	}
	return nil
}

func validHeaderName(name string) bool {
	if name == "" {
		return false
	}
	for i := 0; i < len(name); i++ {
		if !validHeaderNameByte(name[i]) {
			return false
		}
	}
	return true
}

func validHeaderNameByte(c byte) bool {
	if (c >= 'a' && c <= 'z') ||
		(c >= 'A' && c <= 'Z') ||
		(c >= '0' && c <= '9') {
		return true
	}
	return strings.ContainsRune("!#$%&'*+-.^_`|~", rune(c))
}

type errorHandler struct {
	mu         sync.Mutex
	lastLogged time.Time
	suppressed uint64
	now        func() time.Time
}

func newErrorHandler() *errorHandler {
	return &errorHandler{now: time.Now}
}

func (h *errorHandler) Handle(err error) {
	now := h.now()
	h.mu.Lock()
	if !h.lastLogged.IsZero() && now.Sub(h.lastLogged) < openTelemetryErrorLogInterval {
		h.suppressed++
		h.mu.Unlock()
		return
	}
	suppressed := h.suppressed
	h.suppressed = 0
	h.lastLogged = now
	h.mu.Unlock()

	if suppressed > 0 {
		slog.Error("OpenTelemetry error", "err", err, "suppressed", suppressed)
		return
	}
	slog.Error("OpenTelemetry error", "err", err)
}
