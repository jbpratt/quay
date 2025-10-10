# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the new React-based UI for Quay, replacing the legacy AngularJS interface. Built with React 18, TypeScript, PatternFly 5, and React Query (TanStack Query). The application can run as a standalone web application or as a dynamic plugin for OpenShift Console.

## Development Commands

### Local Development

```bash
# Install dependencies
npm install

# Start dev server (with proxy to backend)
npm start
# Opens http://localhost:9000 with hot-reload enabled

# Start with mocked API (no backend required)
MOCK_API=true npm start

# Format code
npm format
```

**Backend Configuration**: Update webpack.dev.js proxy targets to point to your Quay backend. Default is `http://192.168.1.108:8080`.

The Quay backend must have CORS configured:
```yaml
# In Quay's config.yaml
CORS_ORIGIN: "http://localhost:9000"
```

### Testing

```bash
# Unit tests (watch mode)
npm test

# Integration tests (requires running app on port 9000)
npm run test:integration

# Start production build for integration testing
npm run start:integration
```

**Integration Tests**: Cypress-based e2e tests in `cypress/e2e/`. Default baseUrl is `http://localhost:9000`, configurable in `cypress.config.ts`. Tests expect Quay backend at `http://localhost:8080`.

### Building

```bash
# Production build (outputs to dist/)
npm run build

# Build as OpenShift Console plugin
npm run build-plugin

# Start plugin dev server
npm start-plugin
```

### Database Management (for integration tests)

```bash
# Dump current Quay DB state for tests
npm run quay:dump

# Seed test database and storage
npm run quay:seed
npm run quay:seed-db    # Database only
npm run quay:seed-storage  # Storage only
```

## Architecture

### Core Structure

- **Routes** (`src/routes/`): Top-level page components organized by feature
  - `StandaloneMain.tsx`: Main layout with header, sidebar, footer, and routing
  - `PluginMain.tsx`: OpenShift Console plugin entry point
  - `NavigationPath.tsx`: Centralized route path constants
  - Each feature has its own directory (e.g., `OrganizationsList/`, `RepositoriesList/`)

- **Components** (`src/components/`): Reusable UI components
  - `header/`: QuayHeader with user menu and notifications
  - `sidebar/`: QuaySidebar navigation
  - `footer/`: QuayFooter with version and docs link
  - `modals/`: Reusable modal dialogs
  - `toolbar/`: Table toolbars with search, filters, and actions
  - `errors/`: Error boundary and error pages

- **Hooks** (`src/hooks/`): Custom React hooks for data fetching and mutations
  - Named with `Use` prefix (e.g., `UseRepositories.ts`, `UseOrganizations.ts`)
  - Built on React Query for caching, loading states, and error handling
  - Each hook typically exports query/mutation functions and types

- **Resources** (`src/resources/`): API client layer using Axios
  - One file per API domain (e.g., `RepositoryResource.ts`, `OrganizationResource.ts`)
  - Handles HTTP requests, error handling, and response transformation
  - `ErrorHandling.ts`: Common error handling utilities

- **State** (`src/atoms/`): Global state management using Recoil
  - Atoms for auth, alerts, repositories, tags, organizations, etc.
  - `recoil-persist` used for localStorage persistence

- **Utils** (`src/libs/`): Utility modules
  - `axios.ts`: Configured Axios instance with CSRF token and auth interceptors
  - `utils.ts`: Common utilities (date formatting, permissions, etc.)

### Data Flow Pattern

1. **Component** imports custom hook from `src/hooks/`
2. **Hook** uses React Query to call resource function from `src/resources/`
3. **Resource** makes Axios HTTP request to Quay API
4. **Response** flows back through hook to component
5. **Global state** (Recoil atoms) used for cross-component state

Example:
```
RepositoriesList (component)
  → UseRepositories (hook)
    → RepositoryResource (API client)
      → Axios → Quay API
```

### Key Patterns

- **React Query**: All data fetching uses `useQuery` (reads) and `useMutation` (writes)
  - Query keys follow pattern: `['queryKey', ...params]`
  - Automatic caching, refetching, and invalidation

- **TypeScript**: Strict typing throughout
  - Interfaces defined inline with hooks or in resource files
  - Component props typed explicitly

- **PatternFly**: UI component library
  - Use PF components for consistency (Table, Modal, Form, etc.)
  - Custom styling via CSS files co-located with components

- **Routing**: React Router v6
  - Nested routes defined in `StandaloneMain.tsx`
  - Route paths centralized in `NavigationPath.tsx`

### Environment Variables

- `MOCK_API=true`: Use mocked API instead of real backend
- `REACT_QUAY_APP_API_URL`: Override backend URL (default: same origin)
- `NODE_ENV`: Set by webpack (development/production)

### Testing Strategy

- **Unit tests**: Component tests using React Testing Library, co-located with source
- **Integration tests**: Cypress e2e tests in `cypress/e2e/`
- Mock API implementation in `src/tests/fake-db/` for offline development

### Deployment Modes

1. **Standalone**: Full React SPA with own routing (default)
2. **OpenShift Console Plugin**: Embedded in OpenShift Console via dynamic plugin SDK
   - Uses `webpack.plugin.js` for build
   - Integrates with Console's auth and navigation

## Running Single Test

```bash
# Cypress integration test
npx cypress run --spec "cypress/e2e/test-name.cy.ts"

# Unit test (Jest via react-scripts)
npm test -- --testPathPattern=ComponentName
```

## Code Style

- ESLint configuration in `.eslintrc.js` (TypeScript + React + Prettier)
- Prettier for formatting: `npm run format`
- Imports should use `src/` prefix (configured in tsconfig.json)
