# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cypress e2e test suite for Quay's React web UI. Tests verify end-user workflows against both real backend (server responses) and mocked API responses (stubbed responses). The test suite uses Cypress 13 with TypeScript and generates CTRF JSON reports for CI/CD integration.

## Commands

### Running Tests

```bash
# Run all e2e tests (from web/ directory)
npm run test:integration

# Run all e2e tests from cypress/ directory
npx cypress run

# Run specific test file
npx cypress run --spec "e2e/repository-delete.cy.ts"

# Open Cypress UI for interactive testing
npx cypress open

# Run with specific browser
npx cypress run --browser chrome
npx cypress run --browser firefox
```

### Database Seeding

```bash
# Seed test database and storage (from web/ directory)
npm run quay:seed

# Seed only database
npm run quay:seed-db

# Seed only storage
npm run quay:seed-storage

# Dump current Quay state to test fixtures
npm run quay:dump
```

**IMPORTANT**: Only dump test data after verifying NO confidential information is in the test instance.

### Prerequisites

- Quay backend running at `http://localhost:8080` (configure in `../cypress.config.ts`)
- Web UI running at `http://localhost:9000` for development
- PostgreSQL database accessible for seeding

## Architecture

### Directory Structure

- **e2e/**: Test specs, one file per page/feature (e.g., `repository-delete.cy.ts`, `teams-and-membership.cy.ts`)
- **support/**: Custom Cypress commands and global configuration
  - `commands.ts`: Custom commands (`cy.loginByCSRF`, `cy.getIframeBody`)
  - `e2e.ts`: Global beforeEach hooks (auto-intercepts status page)
- **fixtures/**: Mock JSON responses for stubbed API calls (e.g., `config.json`, `builds.json`)
- **test/**: Seed data for test Quay instance
  - `quay-db-data.txt`: PostgreSQL dump
  - `quay-storage-data/`: Blob storage files
  - `extra-config.yaml`: Additional test configuration
- **downloads/**: Cypress downloads directory
- **screenshots/**: Test failure screenshots
- **reports/**: CTRF JSON test reports

### Configuration

- **cypress.config.ts** (in `web/`): Main configuration
  - `baseUrl`: Web UI URL (default: `http://localhost:9000`)
  - `REACT_QUAY_APP_API_URL`: Backend API URL (default: `http://localhost:8080`)
  - `defaultCommandTimeout`: 25000ms
  - CTRF reporter outputs to `cypress/reports/ctrf-report.json`

### Custom Commands

```typescript
// Login via CSRF token (use in beforeEach)
cy.request('GET', `${Cypress.env('REACT_QUAY_APP_API_URL')}/csrf_token`)
  .then((response) => response.body.csrf_token)
  .then((token) => {
    cy.loginByCSRF(token);
  });

// Access iframe content
cy.getIframeBody('#my-iframe-selector').find('.element').click();
```

## Testing Strategy

### Server vs. Stubbed Responses

Tests use a **hybrid approach**: server responses for critical paths, stubbed responses for edge cases and error states.

**Server Responses** (Real Backend):
- ✅ Use for: Critical user workflows, integration testing, verifying actual backend behavior
- ❌ Avoid when: Testing error states, edge cases, performance-sensitive scenarios
- Requires: Database seeding via `cy.exec('npm run quay:seed')` in `beforeEach`
- Examples: Creating teams, deleting repositories, updating permissions

**Stubbed Responses** (Mocked):
- ✅ Use for: Error states, edge cases, specific UI states, feature flag testing
- ❌ Avoid when: Testing actual backend integration, critical user flows
- Setup: `cy.intercept()` to mock API calls
- Examples: 500 errors, disabled features, empty states

### Best Practices

#### 1. Minimize Seeding

**DON'T** seed unnecessarily. Seeding is expensive (slow, requires backend).

```typescript
// ❌ BAD: Seeds for every test even if not mutating
describe('Repository List Display', () => {
  beforeEach(() => {
    cy.exec('npm run quay:seed');  // Unnecessary for read-only tests
    // ...
  });

  it('displays repositories', () => {
    // This test only reads data, doesn't need fresh seed
  });
});

// ✅ GOOD: Only seed when testing mutations or when data state matters
describe('Repository List Display', () => {
  it('displays repositories', () => {
    // Use existing seeded data from previous test runs
    // OR use cy.intercept to mock the response
    cy.intercept('GET', '/api/v1/repository*', {fixture: 'repositories.json'});
    cy.visit('/repository');
  });
});
```

#### 2. Clean Up After Mutations

**CRITICAL**: Tests that create/modify data MUST clean up afterward to avoid polluting subsequent tests.

```typescript
// ❌ BAD: Creates team but never deletes it
it('creates new team', () => {
  cy.visit('/organization/testorg?tab=Teamsandmembership');
  cy.get('[data-testid="create-new-team-button"]').click();
  cy.get('[data-testid="new-team-name-input"]').type('newteam');
  cy.get('[data-testid="create-team-confirm"]').click();
  // Missing cleanup!
});

// ✅ GOOD: Cleans up created resources
it('creates new team', () => {
  const teamName = 'cypress-test-team-' + Date.now(); // Unique name

  cy.visit('/organization/testorg?tab=Teamsandmembership');
  cy.get('[data-testid="create-new-team-button"]').click();
  cy.get('[data-testid="new-team-name-input"]').type(teamName);
  cy.get('[data-testid="create-team-confirm"]').click();

  // Cleanup: Delete the team
  cy.request({
    method: 'DELETE',
    url: `${Cypress.env('REACT_QUAY_APP_API_URL')}/api/v1/organization/testorg/team/${teamName}`,
    failOnStatusCode: false,
  });
});

// ✅ BETTER: Use afterEach for cleanup
describe('Team Management', () => {
  const createdTeams = [];

  afterEach(() => {
    // Clean up all teams created during tests
    createdTeams.forEach((teamName) => {
      cy.request({
        method: 'DELETE',
        url: `${Cypress.env('REACT_QUAY_APP_API_URL')}/api/v1/organization/testorg/team/${teamName}`,
        failOnStatusCode: false,
      });
    });
    createdTeams.length = 0;
  });

  it('creates new team', () => {
    const teamName = 'cypress-test-team-' + Date.now();
    createdTeams.push(teamName);

    cy.visit('/organization/testorg?tab=Teamsandmembership');
    cy.get('[data-testid="create-new-team-button"]').click();
    cy.get('[data-testid="new-team-name-input"]').type(teamName);
    cy.get('[data-testid="create-team-confirm"]').click();
  });
});
```

#### 3. Prefer Mocking for Non-Critical Paths

```typescript
// ❌ BAD: Seeds entire DB just to test UI rendering
it('displays error message when API fails', () => {
  cy.exec('npm run quay:seed');
  // Then somehow trigger error... how?
});

// ✅ GOOD: Mock the error response
it('displays error message when API fails', () => {
  cy.intercept('GET', '/api/v1/repository/*/tags*', {
    statusCode: 500,
    body: {error: 'Internal server error'}
  }).as('getTagsError');

  cy.visit('/repository/testorg/testrepo?tab=tags');
  cy.wait('@getTagsError');
  cy.contains('Unable to load tags').should('exist');
});
```

#### 4. Use Descriptive Test Names

```typescript
// ❌ BAD
it('works', () => { /* ... */ });
it('test 1', () => { /* ... */ });

// ✅ GOOD
it('creates repository auto-prune policy based on number of tags', () => { /* ... */ });
it('displays validation error when repository name contains invalid characters', () => { /* ... */ });
```

#### 5. Avoid .only and .skip in Committed Code

```typescript
// ❌ BAD: Committed to repository
it.only('creates team', () => { /* ... */ });  // Skips all other tests
it.skip('deletes team', () => { /* ... */ });   // Test never runs

// ✅ GOOD: Use temporarily during development, remove before commit
it('creates team', () => { /* ... */ });
it('deletes team', () => { /* ... */ });
```

**Note**: Current codebase has several `.skip` and `.only` tests (e.g., `e2e/update-user.cy.ts:68`, `e2e/signin.cy.ts:47`). These should be fixed or removed.

#### 6. Use Unique Identifiers for Test Data

```typescript
// ❌ BAD: Hardcoded names cause conflicts
it('creates robot account', () => {
  cy.get('[data-testid="robot-name-input"]').type('testrobot');  // Collides!
});

// ✅ GOOD: Use timestamps or UUIDs
it('creates robot account', () => {
  const robotName = `robot-${Date.now()}`;
  cy.get('[data-testid="robot-name-input"]').type(robotName);
  // Remember to clean up!
});
```

### When to Seed

✅ **Seed when:**
- Testing mutations that require existing data (e.g., deleting a repository)
- Testing complex workflows spanning multiple API calls
- Testing permissions and access control with specific user roles
- Integration testing actual backend behavior

❌ **Don't seed when:**
- Testing UI-only behavior (rendering, navigation, form validation)
- Testing error states (use `cy.intercept` to mock errors)
- Testing feature flag behavior (mock config endpoint)
- Data can be easily mocked with fixtures

### When to Mock

✅ **Mock when:**
- Testing error responses (500, 404, 403, etc.)
- Testing edge cases (empty states, large datasets, malformed data)
- Testing feature flags and configuration (mock `/config` endpoint)
- Testing slow/expensive operations (builds, mirroring)
- Data structure is known and stable

❌ **Don't mock when:**
- Testing critical user workflows end-to-end
- Verifying actual backend integration
- Testing authentication/authorization flows
- Response structure is complex or frequently changing

## Common Patterns

### Login Before Each Test

```typescript
beforeEach(() => {
  cy.exec('npm run quay:seed');  // Only if test needs seeded data!
  cy.request('GET', `${Cypress.env('REACT_QUAY_APP_API_URL')}/csrf_token`)
    .then((response) => response.body.csrf_token)
    .then((token) => {
      cy.loginByCSRF(token);
    });
});
```

### Mock Feature Flags

```typescript
beforeEach(() => {
  cy.intercept('GET', '/config', (req) =>
    req.reply((res) => {
      res.body.features['REPO_MIRROR'] = true;  // Enable feature
      res.body.features['USER_CREATION'] = false;  // Disable feature
      return res;
    }),
  ).as('getConfig');
});
```

### Mock API Responses with Fixtures

```typescript
beforeEach(() => {
  cy.intercept('GET', '/api/v1/repository/*/builds', {
    fixture: 'builds.json'
  }).as('getBuilds');
});

it('displays builds', () => {
  cy.visit('/repository/testorg/testrepo?tab=builds');
  cy.wait('@getBuilds');
  cy.contains('build001').should('exist');
});
```

### Test Form Validation

```typescript
it('validates required fields', () => {
  cy.visit('/organization/testorg?tab=Teamsandmembership');
  cy.get('[data-testid="create-new-team-button"]').click();

  // Submit button should be disabled when required fields empty
  cy.get('[data-testid="create-team-confirm"]').should('be.disabled');

  // Fill required field
  cy.get('[data-testid="new-team-name-input"]').type('newteam');

  // Submit button should now be enabled
  cy.get('[data-testid="create-team-confirm"]').should('not.be.disabled');
});
```

## Debugging Tests

### Interactive Mode

```bash
npx cypress open
# Click on test file to run in interactive mode
# Use .only to focus on specific test during debugging
```

### Screenshots and Videos

- Failure screenshots: `cypress/screenshots/`
- Videos (if enabled): `cypress/videos/`

### Console Logs

```typescript
// Add debugging output
cy.log('Current URL:', cy.url());
cy.get('.my-element').then(($el) => {
  console.log('Element:', $el);
});
```

### Network Intercepts

```typescript
// Log all API calls
cy.intercept('/api/**', (req) => {
  console.log('API Request:', req.method, req.url);
  req.continue();
});
```

## Test Data Management

### Updating Seed Data

1. Start local Quay: `make local-dev-up` (from repository root)
2. Seed current test data: `npm run quay:seed` (from `web/`)
3. Make changes via Quay UI or API
4. Dump to fixtures: `npm run quay:dump` (from `web/`)
5. ⚠️ **VERIFY**: No confidential data in `cypress/test/quay-db-data.txt`
6. Commit updated seed data

### Fixture Organization

- `fixtures/config.json`: Default Quay configuration
- `fixtures/config-*.json`: Configuration variants (external login, feature flags)
- `fixtures/builds.json`, `fixtures/build-*.json`: Build-related responses
- `fixtures/security/*.json`: Security scanning reports
- `fixtures/*.json`: Other API response mocks

## CI/CD Integration

### CTRF Reporting

Tests generate CTRF JSON reports in `cypress/reports/ctrf-report.json`. This format is CI/CD friendly and supports:
- Test results aggregation
- Failure tracking
- Performance metrics

### Environment Variables

- `REACT_QUAY_APP_API_URL`: Backend API URL (set in `cypress.config.ts` env)
- `CLIENT`: Docker client for seed scripts (`docker` or `podman`)

## Known Issues

### Skipped Tests

Several tests are currently skipped (see `grep -r "it.skip" e2e/`):
- `e2e/org-oauth.cy.ts:841`: Bulk delete test
- `e2e/repository-visibility.cy.ts:22`: Sets public test
- `e2e/repository-state.cy.ts:30`: State switching test
- `e2e/signin.cy.ts:47,69`: Signin tests
- `e2e/repository-details.cy.ts:502`: Nested repositories test

### Focused Tests

- `e2e/update-user.cy.ts:68`: Has `.only` (should be fixed before merge)

## Quick Reference

```bash
# Development workflow
cd /path/to/quay/web
npm run quay:seed           # Seed test database
npm start                   # Start dev server at :9000
npx cypress open            # Open Cypress UI

# Run single test
npx cypress run --spec "e2e/teams-and-membership.cy.ts"

# Run with spec pattern
npx cypress run --spec "e2e/*team*.cy.ts"

# Update test data
npm run quay:dump           # After making changes to test Quay instance
```
