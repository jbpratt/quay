---
name: patternfly-frontend-guidelines
description: Frontend development guidelines for React/TypeScript applications with PatternFly. Modern patterns including Suspense, lazy loading, useSuspenseQuery, file organization with features directory, PatternFly styling, TanStack Router, Cypress e2e testing, performance optimization, and TypeScript best practices. Use when creating components, pages, features, fetching data, styling with PatternFly, routing, testing with Cypress, or working with frontend code.
---

# PatternFly Frontend Development Guidelines

## Purpose

Comprehensive guide for modern React development with PatternFly, emphasizing Suspense-based data fetching, lazy loading, proper file organization, Cypress e2e testing, and performance optimization.

## When to Use This Skill

- Creating new components or pages
- Building new features
- Fetching data with TanStack Query
- Setting up routing with TanStack Router
- Styling components with PatternFly
- Writing Cypress e2e tests
- Performance optimization
- Organizing frontend code
- TypeScript best practices

---

## Quick Start

### New Component Checklist

Creating a component? Follow this checklist:

- [ ] Use `React.FC<Props>` pattern with TypeScript
- [ ] Lazy load if heavy component: `React.lazy(() => import())`
- [ ] Wrap in `<SuspenseLoader>` for loading states
- [ ] Use `useSuspenseQuery` for data fetching
- [ ] Import aliases: `@/`, `~types`, `~components`, `~features`
- [ ] Styles: Use PatternFly components and CSS-in-JS patterns
- [ ] Use `useCallback` for event handlers passed to children
- [ ] Default export at bottom
- [ ] No early returns with loading spinners
- [ ] Use PatternFly's `Alert` component for notifications
- [ ] Add `data-testid` attributes for Cypress selectors

### New Feature Checklist

Creating a feature? Set up this structure:

- [ ] Create `features/{feature-name}/` directory
- [ ] Create subdirectories: `api/`, `components/`, `hooks/`, `helpers/`, `types/`, `__tests__/`
- [ ] Create API service file: `api/{feature}Api.ts`
- [ ] Set up TypeScript types in `types/`
- [ ] Create route in `routes/{feature-name}/index.tsx`
- [ ] Lazy load feature components
- [ ] Use Suspense boundaries
- [ ] Export public API from feature `index.ts`
- [ ] Write Cypress e2e tests in `cypress/e2e/{feature-name}.cy.ts`

---

## Import Aliases Quick Reference

| Alias | Resolves To | Example |
|-------|-------------|---------|
| `@/` | `src/` | `import { apiClient } from '@/lib/apiClient'` |
| `~types` | `src/types` | `import type { User } from '~types/user'` |
| `~components` | `src/components` | `import { SuspenseLoader } from '~components/SuspenseLoader'` |
| `~features` | `src/features` | `import { authApi } from '~features/auth'` |

---

## Common Imports Cheatsheet

```typescript
// React & Lazy Loading
import React, { useState, useCallback, useMemo } from 'react';
const Heavy = React.lazy(() => import('./Heavy'));

// PatternFly Components
import {
    Card,
    CardTitle,
    CardBody,
    Button,
    Alert,
    Grid,
    GridItem,
    Spinner
} from '@patternfly/react-core';

// TanStack Query (Suspense)
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query';

// TanStack Router
import { createFileRoute } from '@tanstack/react-router';

// Project Components
import { SuspenseLoader } from '~components/SuspenseLoader';

// Hooks
import { useAuth } from '@/hooks/useAuth';

// Types
import type { Post } from '~types/post';
```

---

## Topic Guides

### 🎨 Component Patterns

**Modern React components use:**
- `React.FC<Props>` for type safety
- `React.lazy()` for code splitting
- `SuspenseLoader` for loading states
- Named const + default export pattern
- PatternFly components for consistent UI

**Key Concepts:**
- Lazy load heavy components (DataTables, charts, editors)
- Always wrap lazy components in Suspense
- Use SuspenseLoader component (with fade animation)
- Component structure: Props → Hooks → Handlers → Render → Export
- Add `data-testid` for Cypress testing

**[📖 Complete Guide: resources/component-patterns.md](resources/component-patterns.md)**

---

### 📊 Data Fetching

**PRIMARY PATTERN: useSuspenseQuery**
- Use with Suspense boundaries
- Cache-first strategy (check cache before API)
- Replaces `isLoading` checks
- Type-safe with generics

**API Service Layer:**
- Create `features/{feature}/api/{feature}Api.ts`
- Use `apiClient` axios instance
- Centralized methods per feature
- Route format: `/form/route` (NOT `/api/form/route`)

**[📖 Complete Guide: resources/data-fetching.md](resources/data-fetching.md)**

---

### 📁 File Organization

**features/ vs components/:**
- `features/`: Domain-specific (posts, comments, auth)
- `components/`: Truly reusable (SuspenseLoader, CustomAppBar)

**Feature Subdirectories:**
```
features/
  my-feature/
    api/          # API service layer
    components/   # Feature components
    hooks/        # Custom hooks
    helpers/      # Utility functions
    types/        # TypeScript types
    __tests__/    # Feature unit tests
```

**[📖 Complete Guide: resources/file-organization.md](resources/file-organization.md)**

---

### 🎨 Styling

**PatternFly Approach:**
- Use PatternFly's component props for styling
- CSS-in-JS with styled-components or emotion (if needed)
- Follow PatternFly design tokens
- Custom styles: Use `className` with CSS modules

**PatternFly Grid:**
```typescript
<Grid hasGutter>
  <GridItem span={12} md={6}>  {/* ✅ PatternFly syntax */}
    <Card>Content</Card>
  </GridItem>
</Grid>
```

**[📖 Complete Guide: resources/styling-guide.md](resources/styling-guide.md)**

---

### 🛣️ Routing

**TanStack Router - Folder-Based:**
- Directory: `routes/my-route/index.tsx`
- Lazy load components
- Use `createFileRoute`
- Breadcrumb data in loader

**Example:**
```typescript
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

const MyPage = lazy(() => import('@/features/my-feature/components/MyPage'));

export const Route = createFileRoute('/my-route/')({
    component: MyPage,
    loader: () => ({ crumb: 'My Route' }),
});
```

**[📖 Complete Guide: resources/routing-guide.md](resources/routing-guide.md)**

---

### ⏳ Loading & Error States

**CRITICAL RULE: No Early Returns**

```typescript
// ❌ NEVER - Causes layout shift
if (isLoading) {
    return <Spinner />;
}

// ✅ ALWAYS - Consistent layout
<SuspenseLoader>
    <Content />
</SuspenseLoader>
```

**Why:** Prevents Cumulative Layout Shift (CLS), better UX

**Error Handling:**
- Use PatternFly `Alert` component for user feedback
- TanStack Query `onError` callbacks

**[📖 Complete Guide: resources/loading-and-error-states.md](resources/loading-and-error-states.md)**

---

### 🧪 Cypress E2E Testing

**Test Organization:**
- E2E tests: `cypress/e2e/{feature-name}.cy.ts`
- Component tests: `cypress/component/{component-name}.cy.tsx`
- Fixtures: `cypress/fixtures/{feature-name}.json`
- Support files: `cypress/support/commands.ts`

**Best Practices:**
- Use `data-testid` for stable selectors
- Create reusable custom commands
- Mock API responses with `cy.intercept()`
- Test user journeys, not implementation
- Follow AAA pattern (Arrange, Act, Assert)

**[📖 Complete Guide: resources/cypress-testing.md](resources/cypress-testing.md)**

---

### ⚡ Performance

**Optimization Patterns:**
- `useMemo`: Expensive computations (filter, sort, map)
- `useCallback`: Event handlers passed to children
- `React.memo`: Expensive components
- Debounced search (300-500ms)
- Memory leak prevention (cleanup in useEffect)

**[📖 Complete Guide: resources/performance.md](resources/performance.md)**

---

### 📘 TypeScript

**Standards:**
- Strict mode, no `any` type
- Explicit return types on functions
- Type imports: `import type { User } from '~types/user'`
- Component prop interfaces with JSDoc

**[📖 Complete Guide: resources/typescript-standards.md](resources/typescript-standards.md)**

---

### 🔧 Common Patterns

**Covered Topics:**
- React Hook Form with Zod validation
- DataTable wrapper contracts
- Modal component standards
- `useAuth` hook for current user
- Mutation patterns with cache invalidation

**[📖 Complete Guide: resources/common-patterns.md](resources/common-patterns.md)**

---

### 📚 Complete Examples

**Full working examples:**
- Modern component with all patterns
- Complete feature structure
- API service layer
- Route with lazy loading
- Suspense + useSuspenseQuery
- Form with validation
- Cypress e2e test

**[📖 Complete Guide: resources/complete-examples.md](resources/complete-examples.md)**

---

## Navigation Guide

| Need to... | Read this resource |
|------------|-------------------|
| Create a component | [component-patterns.md](resources/component-patterns.md) |
| Fetch data | [data-fetching.md](resources/data-fetching.md) |
| Organize files/folders | [file-organization.md](resources/file-organization.md) |
| Style components | [styling-guide.md](resources/styling-guide.md) |
| Set up routing | [routing-guide.md](resources/routing-guide.md) |
| Handle loading/errors | [loading-and-error-states.md](resources/loading-and-error-states.md) |
| Write Cypress tests | [cypress-testing.md](resources/cypress-testing.md) |
| Optimize performance | [performance.md](resources/performance.md) |
| TypeScript types | [typescript-standards.md](resources/typescript-standards.md) |
| Forms/Auth/DataTable | [common-patterns.md](resources/common-patterns.md) |
| See full examples | [complete-examples.md](resources/complete-examples.md) |

---

## Core Principles

1. **Lazy Load Everything Heavy**: Routes, DataTable, charts, editors
2. **Suspense for Loading**: Use SuspenseLoader, not early returns
3. **useSuspenseQuery**: Primary data fetching pattern for new code
4. **Features are Organized**: api/, components/, hooks/, helpers/, __tests__/ subdirs
5. **PatternFly Components**: Use PatternFly's design system consistently
6. **Import Aliases**: Use @/, ~types, ~components, ~features
7. **No Early Returns**: Prevents layout shift
8. **PatternFly Alert**: For all user notifications
9. **Cypress Testing**: Add data-testid and write e2e tests for user flows
10. **TypeScript Strict**: No any, explicit return types

---

## Quick Reference: File Structure

```
src/
  features/
    my-feature/
      api/
        myFeatureApi.ts       # API service
      components/
        MyFeature.tsx         # Main component
        SubComponent.tsx      # Related components
      hooks/
        useMyFeature.ts       # Custom hooks
        useSuspenseMyFeature.ts  # Suspense hooks
      helpers/
        myFeatureHelpers.ts   # Utilities
      types/
        index.ts              # TypeScript types
      __tests__/
        MyFeature.test.tsx    # Unit tests
      index.ts                # Public exports

  components/
    SuspenseLoader/
      SuspenseLoader.tsx      # Reusable loader
    CustomAppBar/
      CustomAppBar.tsx        # Reusable app bar

  routes/
    my-route/
      index.tsx               # Route component
      create/
        index.tsx             # Nested route

cypress/
  e2e/
    my-feature/
      user-flow.cy.ts         # E2E tests
  fixtures/
    my-feature.json           # Test data
  support/
    commands.ts               # Custom commands
```

---

## Modern Component Template (Quick Copy)

```typescript
import React, { useState, useCallback } from 'react';
import { Card, CardTitle, CardBody, Button } from '@patternfly/react-core';
import { useSuspenseQuery } from '@tanstack/react-query';
import { featureApi } from '../api/featureApi';
import type { FeatureData } from '~types/feature';

interface MyComponentProps {
    id: number;
    onAction?: () => void;
}

export const MyComponent: React.FC<MyComponentProps> = ({ id, onAction }) => {
    const [state, setState] = useState<string>('');

    const { data } = useSuspenseQuery({
        queryKey: ['feature', id],
        queryFn: () => featureApi.getFeature(id),
    });

    const handleAction = useCallback(() => {
        setState('updated');
        onAction?.();
    }, [onAction]);

    return (
        <Card data-testid="my-component">
            <CardTitle>Feature Details</CardTitle>
            <CardBody>
                <Button onClick={handleAction} data-testid="action-button">
                    Action
                </Button>
            </CardBody>
        </Card>
    );
};

export default MyComponent;
```

For complete examples, see [resources/complete-examples.md](resources/complete-examples.md)

---

## Related Skills

- **error-tracking**: Error tracking with Sentry (applies to frontend too)
- **backend-dev-guidelines**: Backend API patterns that frontend consumes

---

**Skill Status**: Modular structure with progressive loading for optimal context management
