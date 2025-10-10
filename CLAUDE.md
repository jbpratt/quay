# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quay is a container image registry that builds, stores, and distributes container images. It implements the Docker Registry Protocol v2 and OCI spec v1.1, providing features like ACLs, team management, geo-replicated storage, security vulnerability scanning via Clair, and continuous integration.

## Architecture

### Core Components

- **Flask Application** (`app.py`): Main application entry point that initializes Flask, sets up authentication (OAuth, LDAP, Keystone, OIDC, Google, GitHub), configures database connections, and registers blueprints
- **API Endpoints** (`endpoints/`): REST API organized into versioned endpoints (v1, v2) and specialized endpoints (oauth, keyserver, web, webhooks, building)
- **Workers** (`workers/`): Background job processors for various tasks:
  - `repositorygcworker.py`: Garbage collection for repositories
  - `storagereplication.py`: Geo-replication of storage
  - `notificationworker/`: Handles user notifications
  - `securityworker/`: Security scanning coordination
  - `repomirrorworker/`: Repository mirroring
  - `queueworker.py`: Generic queue processing
- **Data Layer** (`data/`):
  - `database.py`: Peewee ORM models for PostgreSQL/MySQL
  - `model/`: Business logic layer abstracting database operations
  - `registry_model/`: Registry-specific data models
  - `cache/`: Caching layer for model operations
- **Authentication** (`auth/`): Multiple auth mechanisms (OAuth, Basic, JWT, cookies, signed grants)
- **Storage** (`storage/`): Abstraction layer for different storage backends (S3, GCS, Swift, Ceph, local filesystem)
- **Build System** (`buildman/`): Container image build orchestration using gRPC
- **Frontend** (`web/`): React-based UI using PatternFly framework

### Database

- Uses Peewee ORM with support for PostgreSQL, MySQL, and SQLite (testing only)
- Alembic for schema migrations
- Read replica support for scaling reads
- Connection pooling via `playhouse.pool`

### Configuration

- Centralized configuration in `config.py`
- Environment-based overrides via `QUAY_OVERRIDE_CONFIG`
- Configuration stored in `conf/` directory
- Separate test configuration using `TEST=true` environment variable

## Development Commands

### Local Development Environment

```bash
# Start Quay with hot-reload (requires Docker/docker-compose)
make local-dev-up

# Start Quay with Clair security scanning
make local-dev-up-with-clair

# Stop local development environment
make local-dev-down

# Clean local development artifacts
make local-dev-clean

# Rebuild all Docker containers
make local-docker-rebuild
```

Access Quay at `http://localhost:8080` after starting. Frontend changes are hot-reloaded automatically.

### Testing

```bash
# Run all basic tests (unit + registry + certs)
make test

# Run unit tests only (fastest, uses SQLite)
make unit-test

# Run specific test file or module
TEST=true PYTHONPATH="." py.test -v path/to/test_file.py

# Run single test function
TEST=true PYTHONPATH="." py.test -v path/to/test_file.py::test_function_name

# Run registry protocol tests
make registry-test

# Run e2e tests
make e2e-test

# Run integration tests
make integration-test

# Run buildman tests
make buildman-test

# Run type checking
make types-test

# Full database test suite (requires running database)
TEST_DATABASE_URI=postgresql://user:pass@localhost:5432/quay make full-db-test

# Run tests with PostgreSQL in Docker
make test_postgres

# Run tests with specific markers
TEST=true PYTHONPATH="." py.test -m "not e2e" -v
```

### Frontend Development

```bash
# Install frontend dependencies (runs in Docker)
make node_modules

# Build frontend assets
make local-dev-build-frontend

# Frontend runs in watch mode by default during local-dev-up
```

### Code Quality

```bash
# Format code with black
make black

# Install pre-commit hooks (includes black, trailing whitespace, secret detection)
make install-pre-commit-hook

# Generate protobuf files for buildman
make generate-proto-py
```

### Building

```bash
# Build frontend and backend (no Docker)
make build

# Build Docker image
make docker-build
```

### Database Migrations

```bash
# Run database migrations
alembic upgrade head

# Create new migration
alembic revision -m "description"

# With test database
TEST=true alembic upgrade head
```

## Commit Format

All commits must reference a JIRA ticket and follow this format:

```
<subsystem>: <what changed> (PROJQUAY-####)

<why this change was made>
```

Example:
```
storage: add retry logic for S3 operations (PROJQUAY-1234)

this adds exponential backoff to handle transient S3 failures
```

- Subject line max 70 characters
- Body wrapped at 80 characters
- Subsystem examples: `api`, `data`, `auth`, `endpoints`, `workers`, `buildman`, `storage`, `web`

## Testing Notes

- Set `TEST=true` environment variable for all test commands
- Use `PYTHONPATH="."` to ensure imports work correctly
- SQLite is only for unit tests; full-db-test requires PostgreSQL/MySQL
- Mark integration/e2e tests with `@pytest.mark.e2e` decorator
- Tests ignore `buildman/` by default (use `--ignore=buildman/`)
- Test timeout is 3600 seconds (1 hour) by default
- Use `-x` flag to stop on first failure
- Database tests require `pg_trgm` extension: `CREATE EXTENSION pg_trgm;`

## Key Files

- `app.py`: Flask application initialization and setup
- `config.py`: Configuration management and defaults
- `data/database.py`: ORM models and database schema
- `initdb.py`: Database initialization and seeding
- `workers/worker.py`: Base worker class
- `endpoints/api/__init__.py`: API endpoint registration
- `web/package.json`: Frontend dependencies and build scripts
- `docker-compose.yaml`: Local development environment setup
- `tox.ini`: Test environment configuration
- `alembic.ini`: Database migration configuration

## Environment Variables

- `TEST=true`: Enable test mode
- `TEST_DATABASE_URI`: Database connection string for tests
- `SKIP_DB_SCHEMA=true`: Skip database schema validation (useful for migrations)
- `PYTHONPATH=.`: Ensure module imports work from repository root
- `QUAY_OVERRIDE_CONFIG`: JSON string to override configuration values
- `DOCKER_USER`: User ID for Docker operations (format: `uid:gid`)

## Backporting

If a JIRA ticket has `fixVersion` set to a specific version or `z-stream`, backport the change after merging by commenting on the PR:

```
/cherrypick redhat-3.6
```

This creates a new PR against the specified release branch.
