# Local Build Support

This directory contains configuration for enabling Quay's container image build feature in local development environments.

## Prerequisites

1. **quay-builder binary**: Build from source at https://github.com/quay/quay-builder
   ```bash
   git clone https://github.com/quay/quay-builder.git
   cd quay-builder
   go build -o quay-builder ./cmd/quay-builder
   sudo mv quay-builder /usr/local/bin/
   ```

2. **buildah**: Install the buildah tool
   ```bash
   # Fedora/RHEL
   sudo dnf install buildah

   # Ubuntu/Debian
   sudo apt install buildah
   ```

## Quick Start

1. Enable build support:
   ```bash
   make enable-builds
   ```

2. Restart Quay to apply changes:
   ```bash
   docker-compose restart quay
   ```

3. The build feature should now be available in the Quay UI.

## Configuration

The `builds-config.yaml` file contains the build manager configuration:

| Setting | Description | Default |
|---------|-------------|---------|
| `CONTAINER_RUNTIME` | Container runtime to use (`docker` or `podman`) | `podman` |
| `BUILDAH_ISOLATION` | Buildah isolation mode (`chroot`, `rootless`, `oci`) | `chroot` |
| `BUILDER_BINARY_LOCATION` | Path to quay-builder binary | `/usr/local/bin/quay-builder` |
| `ALLOWED_WORKER_COUNT` | Maximum concurrent builds | `2` |
| `INSECURE` | Skip TLS verification | `true` |
| `DEBUG` | Enable debug logging | `true` |

## How It Works

The local build system uses the `popen` executor which:

1. Forks a `quay-builder` process locally
2. The builder connects to the build manager via gRPC
3. Builds are executed using `buildah` with `--isolation=chroot`
4. No privileged mode is required

This is ideal for:
- Local development and testing
- CI environments (GitHub Actions, etc.)
- Environments where Docker-in-Docker is not available

## Troubleshooting

### Builder binary not found

Set the path explicitly in `builds-config.yaml`:
```yaml
BUILDER_BINARY_LOCATION: /path/to/quay-builder
```

Or via environment variable:
```bash
export BUILDER_BINARY_LOCATION=/path/to/quay-builder
```

### Permission denied errors

Ensure buildah is configured for rootless operation:
```bash
# Check buildah info
buildah info

# Test a simple build
buildah bud --isolation=chroot -t test:latest .
```

### Build logs not appearing

Check that Redis is running and accessible:
```bash
docker-compose ps redis
```

## Related Documentation

- [Quay Build Manager](../../buildman/README.md)
- [quay-builder repository](https://github.com/quay/quay-builder)
- [Buildah documentation](https://github.com/containers/buildah)
