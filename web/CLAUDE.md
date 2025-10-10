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

- **State Management**: Modern approach using React Query + Context API
  - **React Query**: Server state management (API data, caching, background refetching)
    - Replaces most Recoil atoms that store server data
    - Automatic caching, invalidation, and optimistic updates
  - **React Context**: UI-only state (sidebar open/closed, alerts, current user)
    - Lightweight state that doesn't come from server
    - Examples: `SidebarContext`, `AlertContext`, `AuthContext`
  - **Legacy Recoil** (`src/atoms/`): Being phased out, avoid for new code
    - Some existing atoms remain during migration
    - Use React Query + Context for all new features

- **Utils** (`src/libs/`): Utility modules
  - `axios.ts`: Configured Axios instance with CSRF token and auth interceptors
  - `utils.ts`: Common utilities (date formatting, permissions, etc.)

### Data Flow Pattern

**Modern Pattern (Preferred for new code):**
1. **Component** uses `useSuspenseQuery` directly or via custom hook
2. **Query** calls resource function from `src/resources/`
3. **Resource** makes Axios HTTP request to Quay API
4. **Response** flows back through Suspense boundary to component
5. **UI state** managed via React Context (not server state)
6. **No loading states**: Suspense handles this automatically

Example (Modern):
```
RepositoriesList (component)
  → useSuspenseQuery + RepositoryResource
    → SuspenseLoader (boundary)
      → Axios → Quay API
```

**Legacy Pattern (Existing code):**
1. **Component** imports custom hook from `src/hooks/`
2. **Hook** uses `useQuery` to call resource function
3. **Resource** makes Axios HTTP request
4. **Component** handles `isLoading`, `isError` states manually

**Critical Rule**: No early returns with loading spinners! Use Suspense boundaries to prevent layout shift.

### Key Patterns

- **Suspense & Loading States**
  - **Preferred**: Use `useSuspenseQuery` with `<SuspenseLoader>` boundaries
  - **Never** use early returns with loading spinners (causes layout shift)
  - Wrap lazy-loaded components in Suspense boundaries
  - Example:
    ```tsx
    <SuspenseLoader>
      <MyComponent />  {/* Uses useSuspenseQuery internally */}
    </SuspenseLoader>
    ```

- **Component Patterns**
  - Use `React.FC<Props>` pattern for type safety
  - Lazy load heavy components: `const Heavy = React.lazy(() => import('./Heavy'))`
  - Always wrap lazy components in `<SuspenseLoader>`
  - Structure: Props interface → Component → Default export
  - Use `useCallback` for event handlers passed to children
  - Use `useMemo` for expensive computations (filtering, sorting, mapping)

- **React Query**: Server state management
  - **New code**: Use `useSuspenseQuery` (no loading states needed)
  - **Legacy code**: `useQuery` with manual `isLoading` handling
  - **Mutations**: Use `useMutation` for writes with optimistic updates
  - Query keys follow pattern: `['resource', ...params]`
  - Automatic caching, refetching, and invalidation
  - Example:
    ```tsx
    const { data } = useSuspenseQuery({
      queryKey: ['repositories', orgName],
      queryFn: () => RepositoryResource.getRepositories(orgName),
    });
    ```

- **TypeScript**: Strict typing throughout
  - Use `React.FC<Props>` for components
  - Explicit return types on functions
  - Type imports: `import type { User } from '~types/user'`
  - Component props interfaces with JSDoc
  - No `any` types allowed

- **PatternFly**: UI component library
  - Use PF components for consistency (Table, Modal, Form, etc.)
  - Custom styling via CSS files co-located with components
  - Follow PatternFly design patterns and accessibility guidelines

- **Routing**: React Router v6
  - Nested routes defined in `StandaloneMain.tsx`
  - Route paths centralized in `NavigationPath.tsx`
  - Lazy load route components for code splitting

- **Performance Optimization**
  - `useMemo`: Expensive computations (filter/sort/map large arrays)
  - `useCallback`: Event handlers passed to child components
  - `React.memo`: Expensive components that render frequently
  - Debounce search inputs (300-500ms)
  - Lazy load heavy components (DataGrid, charts, editors)
  - Clean up effects to prevent memory leaks

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

## Modern Development Guidelines

### Component Development Checklist

When creating a new component:
- [ ] Use `React.FC<Props>` pattern with TypeScript
- [ ] Lazy load if heavy component: `React.lazy(() => import())`
- [ ] Wrap in `<SuspenseLoader>` for loading states
- [ ] Use `useSuspenseQuery` for data fetching (not `useQuery`)
- [ ] Use `useCallback` for event handlers passed to children
- [ ] Use `useMemo` for expensive computations
- [ ] Default export at bottom of file
- [ ] **Never** use early returns with loading spinners
- [ ] Style with PatternFly components, CSS co-located

### Feature Development Structure

Organize new features using this structure:
```
src/
  features/
    my-feature/
      api/
        myFeatureApi.ts       # API service layer (Axios calls)
      components/
        MyFeature.tsx         # Main feature component
        SubComponent.tsx      # Related components
      hooks/
        useMyFeature.ts       # Custom hooks (if needed)
      helpers/
        myFeatureHelpers.ts   # Utility functions
      types/
        index.ts              # TypeScript types
      index.ts                # Public exports
```

**When to use `features/` vs `components/`:**
- `features/`: Domain-specific functionality (repositories, organizations, tags)
- `components/`: Truly reusable across features (SuspenseLoader, CustomAppBar, ErrorBoundary)

### Loading States Best Practices

**Modern Approach (Required for new code):**
```tsx
// ✅ CORRECT - Use Suspense boundaries
<SuspenseLoader>
  <MyComponent />  {/* Uses useSuspenseQuery internally */}
</SuspenseLoader>

// Inside MyComponent:
const { data } = useSuspenseQuery({
  queryKey: ['myData'],
  queryFn: fetchMyData,
});
```

**Legacy Approach (Avoid in new code):**
```tsx
// ❌ WRONG - Causes layout shift
const { data, isLoading } = useQuery(...);
if (isLoading) {
  return <LoadingSpinner />;  // This shifts the layout!
}
```

**Why?** Early returns cause Cumulative Layout Shift (CLS), poor UX, and accessibility issues.

### State Management Guidelines

**For Server Data (API responses):**
- Use React Query (`useSuspenseQuery`, `useMutation`)
- Automatic caching, invalidation, background refetching
- Example: repositories list, organization details, user profiles

**For UI State (local to app):**
- Use React Context API
- Examples: sidebar open/closed, current user, alerts
- Create context files in `src/contexts/`

**Avoid:**
- Recoil atoms for new code (legacy, being phased out)
- Redux (not used in this project)
- Storing server data in Context (use React Query instead)

### Performance Optimization Patterns

**When to use `useMemo`:**
```tsx
const filteredItems = useMemo(
  () => items.filter(item => item.active).sort((a, b) => a.name.localeCompare(b.name)),
  [items]
);
```

**When to use `useCallback`:**
```tsx
const handleClick = useCallback((id: string) => {
  // Handler logic
}, [dependency]);

<ChildComponent onClick={handleClick} />  // Prevents unnecessary re-renders
```

**Lazy Loading:**
```tsx
const HeavyComponent = React.lazy(() => import('./HeavyComponent'));

<SuspenseLoader>
  <HeavyComponent />
</SuspenseLoader>
```

### Comprehensive Guidelines

For detailed documentation on modern React patterns, data fetching, styling, routing, and more, reference the `frontend-dev-guidelines` skill:
```bash
# In Claude Code
/skills frontend-dev-guidelines
```

Topics covered in the skill:
- Component patterns and best practices
- Data fetching with useSuspenseQuery
- File organization (features/ structure)
- Styling with PatternFly
- Routing patterns
- Loading and error states
- Performance optimization
- TypeScript standards
- Complete working examples

## Running Single Test

```bash
# Cypress integration test
npx cypress run --spec "cypress/e2e/test-name.cy.ts"

# Unit test (Jest via react-scripts)
npm test -- --testPathPattern=ComponentName
```

## Code Style

### Formatting & Linting

- ESLint configuration in `.eslintrc.js` (TypeScript + React + Prettier)
- Prettier for formatting: `npm run format`
- Imports should use `src/` prefix (configured in tsconfig.json)

### TypeScript Standards

- **Strict mode enabled**: No `any` types
- **Component pattern**: Use `React.FC<Props>` for all components
- **Explicit return types**: Required on functions
- **Type imports**: Use `import type { User } from '~types/user'`
- **Props interfaces**: Define above component with JSDoc comments

Example:
```tsx
interface MyComponentProps {
  /** The unique identifier */
  id: string;
  /** Callback when action completes */
  onComplete?: () => void;
}

export const MyComponent: React.FC<MyComponentProps> = ({ id, onComplete }) => {
  // Component implementation
};

export default MyComponent;
```

### Import Organization

Organize imports in this order:
1. React and third-party libraries
2. PatternFly components
3. Internal components (using `src/` prefix)
4. Hooks
5. Resources/API
6. Types (using `import type`)
7. Styles

Example:
```tsx
import React, { useState, useCallback } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { useSuspenseQuery } from '@tanstack/react-query';

import { SuspenseLoader } from 'src/components/SuspenseLoader';
import { useAuth } from 'src/hooks/useAuth';
import { RepositoryResource } from 'src/resources/RepositoryResource';

import type { Repository } from 'src/types/Repository';

import './MyComponent.css';
```

### Performance Best Practices

- Use `useCallback` for event handlers passed to child components
- Use `useMemo` for expensive computations (filter, sort, map on large arrays)
- Use `React.memo` sparingly (only for expensive components)
- Lazy load heavy components (charts, editors, large tables)
- Always wrap lazy components in `<SuspenseLoader>`
- Debounce search inputs (300-500ms delay)
- Clean up effects to prevent memory leaks:
  ```tsx
  useEffect(() => {
    const subscription = api.subscribe();
    return () => subscription.unsubscribe();  // Cleanup
  }, []);
  ```
