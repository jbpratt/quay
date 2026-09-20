# Testing Guide

## Python Environment

A bare `pytest` resolves to whatever interpreter is first on `PATH`, which may
not match the checked-out branch's pins. Always run tests from a
checkout-local venv built from the current branch's own requirements:

```bash
python3.12 -m venv venv
./venv/bin/pip install -r requirements-dev.txt
```

The install compiles several packages from source (psycopg2, python-ldap,
lxml, grpcio); a compiler error here usually means a missing system header
(e.g. `libpq-dev`/`postgresql-devel`, `libldap2-dev`, `libsasl2-dev`), not a
requirements problem.

The Makefile already puts `./venv/bin` first on `PATH`
(`export PATH := ./venv/bin:$(PATH)`), so `make unit-test` and friends pick
this venv up automatically. To run pytest directly, call `./venv/bin/pytest`
(or `source venv/bin/activate` first and use plain `pytest`).

Confirm you're on the right interpreter before trusting results — `--version`
alone prints the same string for every venv, so use `-VV`, which prints the
path pytest was imported from:

```bash
./venv/bin/python -m pytest -VV   # path should be under this checkout's venv, not a shared one
```

Requirements pins diverge between `master` and the `redhat-X.Y` release
branches. A venv built for one branch is wrong for another — rebuild `venv`
after switching branches, or keep a separate worktree/venv per branch.

**Recognize an environment mismatch:** an import error at collection, or a
`TypeError` raised from inside a dependency rather than the code under test,
usually means the venv's pins don't match the branch. Both can also come from
a real defect (a missing import in your change, wrong arguments into a
library), so check the traceback and installed versions before assuming a
mismatch and rebuilding the venv.

## Test Commands

```bash
# Single test file
TEST=true PYTHONPATH="." ./venv/bin/pytest path/to/test.py -v

# Single test function
TEST=true PYTHONPATH="." ./venv/bin/pytest path/to/test.py::TestClass::test_function -v

# With short traceback
TEST=true PYTHONPATH="." ./venv/bin/pytest path/to/test.py -v --tb=short

# Quiet output (just pass/fail)
TEST=true PYTHONPATH="." ./venv/bin/pytest path/to/test.py -q --tb=no

# Pattern matching
TEST=true PYTHONPATH="." ./venv/bin/pytest path/to/test.py -k "keyword" -v
```

## Test Types

### Unit Tests
```bash
make unit-test
```
- Located throughout codebase in `test/` subdirectories
- Use SQLite in-memory database
- Fast, isolated tests

### Registry Tests
```bash
make registry-test
```
- Located in `test/registry/`
- Test Docker/OCI registry protocol
- Simulate Docker client operations

### Integration Tests
```bash
make integration-test
```
- Located in `test/integration/`
- Require running services

### E2E Tests (Frontend)
```bash
# Playwright (all new E2E tests must use Playwright)
cd web && pnpm run test:e2e

```

## Test Database

Tests use SQLite by default. For PostgreSQL tests:

```bash
make test_postgres TESTS=test/test_file.py
```

## Test Fixtures

### Common Test Users

Defined in `test/testconfig.py` and used throughout tests:
- `devtable` - Standard test user
- `public` - Public user
- `reader` - Read-only user
- `admin` - Admin user

### Test Repositories

- `devtable/simple` - Basic test repo
- `public/publicrepo` - Public repository
- `buynlarge/orgrepo` - Organization repository

## Writing Tests

### API Tests

```python
import pytest
from test.fixtures import *

class TestMyFeature:
    def test_example(self, app, initialized_db):
        with client_with_identity('devtable', app) as cl:
            result = cl.get('/api/v1/endpoint')
            assert result.status_code == 200
```

### Database Tests

```python
from data.model import user

def test_user_creation(initialized_db):
    new_user = user.create_user('testuser', 'password', 'test@example.com')
    assert new_user.username == 'testuser'
```

## Test Configuration

- `conftest.py` files contain pytest fixtures
- `test/testconfig.py` - Test user/repo configuration
- `tox.ini` - Tox test environments

## Key Test Directories

- `test/` - Main test directory
- `endpoints/api/test/` - API endpoint tests
- `endpoints/v2/test/` - Registry v2 tests
- `data/model/test/` - Model tests
- `auth/test/` - Auth tests
- `workers/test/` - Worker tests
- `web/playwright/` - Frontend Playwright tests (all new E2E tests go here)
