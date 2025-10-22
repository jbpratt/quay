# Component Patterns with PatternFly

## Table of Contents
- [Component Structure](#component-structure)
- [Lazy Loading Pattern](#lazy-loading-pattern)
- [Suspense Pattern](#suspense-pattern)
- [PatternFly Components](#patternfly-components)
- [Test IDs for Cypress](#test-ids-for-cypress)
- [Common Patterns](#common-patterns)

---

## Component Structure

### Standard Component Template

```typescript
import React, { useState, useCallback, useMemo } from 'react';
import { Card, CardTitle, CardBody, Button } from '@patternfly/react-core';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { FeatureData } from '~types/feature';

/**
 * MyComponent - Brief description
 * @param id - The feature ID
 * @param onAction - Optional callback when action is performed
 */
interface MyComponentProps {
    id: number;
    onAction?: () => void;
}

/**
 * MyComponent displays feature data in a PatternFly card
 */
export const MyComponent: React.FC<MyComponentProps> = ({ id, onAction }) => {
    // 1. State
    const [state, setState] = useState<string>('');

    // 2. Data fetching
    const { data } = useSuspenseQuery({
        queryKey: ['feature', id],
        queryFn: () => featureApi.getFeature(id),
    });

    // 3. Computed values
    const processedData = useMemo(() => {
        return data.items.map(item => ({
            ...item,
            formatted: item.value.toFixed(2),
        }));
    }, [data.items]);

    // 4. Event handlers
    const handleAction = useCallback(() => {
        setState('updated');
        onAction?.();
    }, [onAction]);

    // 5. Render
    return (
        <Card data-testid="my-component">
            <CardTitle>Feature Details</CardTitle>
            <CardBody>
                <p>{data.name}</p>
                <Button onClick={handleAction} data-testid="action-button">
                    Action
                </Button>
            </CardBody>
        </Card>
    );
};

// 6. Default export
export default MyComponent;
```

**Order matters:**
1. State declarations (`useState`)
2. Data fetching (`useSuspenseQuery`)
3. Computed values (`useMemo`)
4. Event handlers (`useCallback`)
5. Render logic
6. Default export at bottom

---

## Lazy Loading Pattern

### When to Lazy Load

Lazy load components that are:
- Heavy (DataTables, charts, rich text editors)
- Not immediately visible (modals, tabs)
- Route components

### How to Lazy Load

```typescript
// Route file: routes/reports/index.tsx
import { createFileRoute } from '@tanstack/react-router';
import { lazy } from 'react';

// Lazy load the component
const ReportPage = lazy(() => import('@/features/reports/components/ReportPage'));

export const Route = createFileRoute('/reports/')({
    component: ReportPage,
    loader: () => ({ crumb: 'Reports' }),
});
```

### Lazy Load in Component

```typescript
import React, { lazy, Suspense } from 'react';
import { Button } from '@patternfly/react-core';
import { SuspenseLoader } from '~components/SuspenseLoader';

const HeavyChart = lazy(() => import('./HeavyChart'));

export const Dashboard: React.FC = () => {
    const [showChart, setShowChart] = React.useState(false);

    return (
        <div>
            <Button onClick={() => setShowChart(true)}>
                Show Chart
            </Button>
            {showChart && (
                <SuspenseLoader>
                    <HeavyChart />
                </SuspenseLoader>
            )}
        </div>
    );
};
```

---

## Suspense Pattern

### SuspenseLoader Component

```typescript
// components/SuspenseLoader/SuspenseLoader.tsx
import React, { Suspense } from 'react';
import { Spinner } from '@patternfly/react-core';

interface SuspenseLoaderProps {
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

export const SuspenseLoader: React.FC<SuspenseLoaderProps> = ({
    children,
    fallback
}) => {
    const defaultFallback = (
        <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '200px'
        }}>
            <Spinner size="xl" />
        </div>
    );

    return (
        <Suspense fallback={fallback || defaultFallback}>
            {children}
        </Suspense>
    );
};
```

### Usage Pattern

```typescript
import { SuspenseLoader } from '~components/SuspenseLoader';
import { DataContent } from './DataContent';

export const Page: React.FC = () => {
    return (
        <SuspenseLoader>
            <DataContent />  {/* Uses useSuspenseQuery */}
        </SuspenseLoader>
    );
};
```

**CRITICAL: No Early Returns**

```typescript
// ❌ NEVER DO THIS - Causes layout shift
export const BadComponent: React.FC = () => {
    const { data, isLoading } = useQuery(...);

    if (isLoading) {
        return <Spinner />;  // Layout shift!
    }

    return <div>{data.name}</div>;
};

// ✅ ALWAYS DO THIS - Consistent layout
export const GoodComponent: React.FC = () => {
    // Parent wraps in <SuspenseLoader>
    const { data } = useSuspenseQuery(...);

    return <div>{data.name}</div>;
};
```

---

## PatternFly Components

### Common Components

```typescript
import {
    // Layout
    Page,
    PageSection,
    Grid,
    GridItem,
    Stack,
    StackItem,

    // Content containers
    Card,
    CardTitle,
    CardBody,
    CardFooter,

    // Data display
    DataList,
    DataListItem,
    DescriptionList,
    DescriptionListGroup,

    // Feedback
    Alert,
    AlertGroup,
    Spinner,
    EmptyState,

    // Forms
    Form,
    FormGroup,
    TextInput,
    Select,
    Checkbox,

    // Actions
    Button,
    Dropdown,
    MenuToggle,

    // Navigation
    Nav,
    NavList,
    NavItem,
    Breadcrumb,
    BreadcrumbItem,

    // Overlays
    Modal,
    ModalVariant,
    Drawer,
    Popover,
} from '@patternfly/react-core';
```

### PatternFly Page Layout

```typescript
import { Page, PageSection, Card } from '@patternfly/react-core';

export const MyPage: React.FC = () => {
    return (
        <Page>
            <PageSection variant="light">
                <h1>Page Title</h1>
            </PageSection>
            <PageSection>
                <Card>
                    <CardBody>
                        Main content
                    </CardBody>
                </Card>
            </PageSection>
        </Page>
    );
};
```

### PatternFly Grid

```typescript
import { Grid, GridItem, Card } from '@patternfly/react-core';

export const GridExample: React.FC = () => {
    return (
        <Grid hasGutter>
            <GridItem span={12} md={6} lg={4}>
                <Card>Card 1</Card>
            </GridItem>
            <GridItem span={12} md={6} lg={4}>
                <Card>Card 2</Card>
            </GridItem>
            <GridItem span={12} md={6} lg={4}>
                <Card>Card 3</Card>
            </GridItem>
        </Grid>
    );
};
```

---

## Test IDs for Cypress

### Add data-testid to All Interactive Elements

```typescript
import { Button, Card, TextInput } from '@patternfly/react-core';

export const MyForm: React.FC = () => {
    return (
        <Card data-testid="my-form-card">
            <CardBody>
                <TextInput
                    id="name"
                    data-testid="name-input"
                    aria-label="Name"
                />
                <Button
                    data-testid="submit-button"
                    onClick={handleSubmit}
                >
                    Submit
                </Button>
            </CardBody>
        </Card>
    );
};
```

### Naming Convention

- **Container**: `{feature}-{component}` → `user-profile-card`
- **Input**: `{field}-input` → `email-input`
- **Button**: `{action}-button` → `submit-button`
- **List item**: `{type}-item-{id}` → `user-item-123`

---

## Common Patterns

### Modal Pattern

```typescript
import { Modal, ModalVariant, Button } from '@patternfly/react-core';

export const MyModal: React.FC = () => {
    const [isOpen, setIsOpen] = React.useState(false);

    return (
        <>
            <Button onClick={() => setIsOpen(true)} data-testid="open-modal">
                Open Modal
            </Button>
            <Modal
                variant={ModalVariant.medium}
                title="Modal Title"
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                data-testid="my-modal"
            >
                Modal content
            </Modal>
        </>
    );
};
```

### Alert Pattern

```typescript
import { Alert, AlertGroup, AlertActionCloseButton } from '@patternfly/react-core';

export const MyComponent: React.FC = () => {
    const [alerts, setAlerts] = React.useState<Array<{ key: string; message: string }>>([]);

    const addAlert = (message: string) => {
        setAlerts(prev => [...prev, { key: Date.now().toString(), message }]);
    };

    const removeAlert = (key: string) => {
        setAlerts(prev => prev.filter(alert => alert.key !== key));
    };

    return (
        <>
            <AlertGroup isToast>
                {alerts.map(alert => (
                    <Alert
                        key={alert.key}
                        variant="success"
                        title={alert.message}
                        actionClose={
                            <AlertActionCloseButton onClose={() => removeAlert(alert.key)} />
                        }
                    />
                ))}
            </AlertGroup>
            <Button onClick={() => addAlert('Success!')}>
                Show Alert
            </Button>
        </>
    );
};
```

### Empty State Pattern

```typescript
import { EmptyState, EmptyStateIcon, EmptyStateBody, Button } from '@patternfly/react-core';
import { SearchIcon } from '@patternfly/react-icons';

export const NoResults: React.FC = () => {
    return (
        <EmptyState>
            <EmptyStateIcon icon={SearchIcon} />
            <h2>No results found</h2>
            <EmptyStateBody>
                Try adjusting your search criteria
            </EmptyStateBody>
            <Button variant="primary">Clear filters</Button>
        </EmptyState>
    );
};
```

---

## Best Practices

✅ **DO:**
- Use `React.FC<Props>` for all components
- Lazy load heavy components
- Use Suspense boundaries
- Add `data-testid` to interactive elements
- Use PatternFly components consistently
- Follow component structure order
- Document props with JSDoc

❌ **DON'T:**
- Don't use early returns for loading states
- Don't mix PatternFly with other UI libraries
- Don't create custom components when PatternFly has one
- Don't forget `data-testid` attributes
- Don't inline event handlers (use `useCallback`)
