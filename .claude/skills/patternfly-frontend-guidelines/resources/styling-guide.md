# Styling Guide with PatternFly

## Table of Contents
- [PatternFly Design System](#patternfly-design-system)
- [Component Styling](#component-styling)
- [CSS Variables](#css-variables)
- [Custom Styles](#custom-styles)
- [Responsive Design](#responsive-design)
- [Best Practices](#best-practices)

---

## PatternFly Design System

### Using PatternFly Components

PatternFly provides a complete design system. **Always use PatternFly components first** before creating custom styles.

```typescript
import { Card, Button } from '@patternfly/react-core';

export const MyComponent: React.FC = () => {
    return (
        <Card>
            <CardBody>
                <Button variant="primary">Primary Action</Button>
                <Button variant="secondary">Secondary Action</Button>
                <Button variant="link">Link Action</Button>
            </CardBody>
        </Card>
    );
};
```

### Button Variants

```typescript
import { Button } from '@patternfly/react-core';

<Button variant="primary">Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="tertiary">Tertiary</Button>
<Button variant="danger">Danger</Button>
<Button variant="warning">Warning</Button>
<Button variant="link">Link</Button>
<Button variant="plain">Plain</Button>
<Button variant="control">Control</Button>
```

### Alert Variants

```typescript
import { Alert } from '@patternfly/react-core';

<Alert variant="success" title="Success!" />
<Alert variant="danger" title="Error!" />
<Alert variant="warning" title="Warning!" />
<Alert variant="info" title="Info" />
<Alert variant="custom" title="Custom" />
```

---

## Component Styling

### Using className Prop

```typescript
import { Card } from '@patternfly/react-core';
import styles from './MyComponent.module.css';

export const MyComponent: React.FC = () => {
    return (
        <Card className={styles.customCard}>
            <CardBody className={styles.customBody}>
                Content
            </CardBody>
        </Card>
    );
};
```

```css
/* MyComponent.module.css */
.customCard {
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.customBody {
    padding: var(--pf-v5-global--spacer--md);
}
```

### Inline Styles (Use Sparingly)

```typescript
import { Card } from '@patternfly/react-core';

export const MyComponent: React.FC = () => {
    return (
        <Card style={{ maxWidth: '600px', margin: '0 auto' }}>
            <CardBody>Content</CardBody>
        </Card>
    );
};
```

**Use inline styles only for:**
- Dynamic values (calculated widths, colors from props)
- One-off adjustments
- Quick prototyping

**Prefer CSS modules for:**
- Reusable styles
- Multiple style rules
- Complex selectors
- Media queries

---

## CSS Variables

### PatternFly Global Variables

PatternFly provides CSS variables for consistent theming:

```css
/* Spacing */
--pf-v5-global--spacer--xs: 0.25rem;
--pf-v5-global--spacer--sm: 0.5rem;
--pf-v5-global--spacer--md: 1rem;
--pf-v5-global--spacer--lg: 1.5rem;
--pf-v5-global--spacer--xl: 2rem;
--pf-v5-global--spacer--2xl: 3rem;

/* Colors */
--pf-v5-global--primary-color--100: #06c;
--pf-v5-global--danger-color--100: #c9190b;
--pf-v5-global--success-color--100: #3e8635;
--pf-v5-global--warning-color--100: #f0ab00;
--pf-v5-global--info-color--100: #2b9af3;

/* Font sizes */
--pf-v5-global--FontSize--xs: 0.75rem;
--pf-v5-global--FontSize--sm: 0.875rem;
--pf-v5-global--FontSize--md: 1rem;
--pf-v5-global--FontSize--lg: 1.125rem;
--pf-v5-global--FontSize--xl: 1.25rem;

/* Border radius */
--pf-v5-global--BorderRadius--sm: 3px;
--pf-v5-global--BorderRadius--lg: 8px;
```

### Using CSS Variables

```css
.myComponent {
    padding: var(--pf-v5-global--spacer--md);
    color: var(--pf-v5-global--primary-color--100);
    font-size: var(--pf-v5-global--FontSize--md);
    border-radius: var(--pf-v5-global--BorderRadius--sm);
}
```

### TypeScript with CSS Variables

```typescript
import { Card } from '@patternfly/react-core';

export const MyComponent: React.FC = () => {
    const cardStyle: React.CSSProperties = {
        padding: 'var(--pf-v5-global--spacer--lg)',
        backgroundColor: 'var(--pf-v5-global--BackgroundColor--100)',
    };

    return (
        <Card style={cardStyle}>
            <CardBody>Content</CardBody>
        </Card>
    );
};
```

---

## Custom Styles

### CSS Modules Pattern

```typescript
// MyComponent.tsx
import React from 'react';
import { Card, CardBody } from '@patternfly/react-core';
import styles from './MyComponent.module.css';

export const MyComponent: React.FC = () => {
    return (
        <Card className={styles.card}>
            <CardBody className={styles.body}>
                <h2 className={styles.title}>Title</h2>
                <p className={styles.content}>Content</p>
            </CardBody>
        </Card>
    );
};
```

```css
/* MyComponent.module.css */
.card {
    max-width: 800px;
    margin: 0 auto;
}

.body {
    padding: var(--pf-v5-global--spacer--lg);
}

.title {
    font-size: var(--pf-v5-global--FontSize--xl);
    font-weight: 700;
    margin-bottom: var(--pf-v5-global--spacer--md);
}

.content {
    color: var(--pf-v5-global--Color--200);
    line-height: 1.6;
}
```

### Combining Classes

```typescript
import clsx from 'clsx';
import styles from './MyComponent.module.css';

interface MyComponentProps {
    variant?: 'primary' | 'secondary';
    isActive?: boolean;
}

export const MyComponent: React.FC<MyComponentProps> = ({ variant, isActive }) => {
    return (
        <div className={clsx(
            styles.base,
            variant === 'primary' && styles.primary,
            variant === 'secondary' && styles.secondary,
            isActive && styles.active
        )}>
            Content
        </div>
    );
};
```

---

## Responsive Design

### PatternFly Grid Responsive Breakpoints

```typescript
import { Grid, GridItem } from '@patternfly/react-core';

export const ResponsiveGrid: React.FC = () => {
    return (
        <Grid hasGutter>
            {/* Full width on mobile, half on tablet, third on desktop */}
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

### Breakpoints

```typescript
// PatternFly breakpoints
// sm: 576px
// md: 768px
// lg: 992px
// xl: 1200px
// 2xl: 1450px

<GridItem
    span={12}      // mobile (default)
    sm={12}        // ≥576px
    md={6}         // ≥768px
    lg={4}         // ≥992px
    xl={3}         // ≥1200px
/>
```

### CSS Media Queries

```css
.component {
    padding: var(--pf-v5-global--spacer--md);
}

@media (min-width: 768px) {
    .component {
        padding: var(--pf-v5-global--spacer--lg);
    }
}

@media (min-width: 992px) {
    .component {
        padding: var(--pf-v5-global--spacer--xl);
    }
}
```

### Hide/Show at Breakpoints

```typescript
import { Stack, StackItem } from '@patternfly/react-core';

export const ResponsiveContent: React.FC = () => {
    return (
        <Stack>
            <StackItem className="pf-m-hidden pf-m-visible-on-lg">
                Desktop only content
            </StackItem>
            <StackItem className="pf-m-hidden-on-lg">
                Mobile/tablet only content
            </StackItem>
        </Stack>
    );
};
```

---

## Best Practices

### ✅ DO

**1. Use PatternFly components first:**
```typescript
import { Button } from '@patternfly/react-core';
<Button variant="primary">Submit</Button>
```

**2. Use CSS variables for consistency:**
```css
.myClass {
    padding: var(--pf-v5-global--spacer--md);
    color: var(--pf-v5-global--primary-color--100);
}
```

**3. Use CSS modules for custom styles:**
```typescript
import styles from './MyComponent.module.css';
<div className={styles.customClass}>...</div>
```

**4. Follow PatternFly spacing system:**
```css
/* xs: 4px, sm: 8px, md: 16px, lg: 24px, xl: 32px, 2xl: 48px */
margin: var(--pf-v5-global--spacer--md);
```

**5. Use responsive breakpoints:**
```typescript
<GridItem span={12} md={6} lg={4}>Content</GridItem>
```

---

### ❌ DON'T

**1. Don't recreate PatternFly components:**
```typescript
// ❌ Bad - custom button
<button className="custom-button">Submit</button>

// ✅ Good - PatternFly button
<Button variant="primary">Submit</Button>
```

**2. Don't use hardcoded values:**
```css
/* ❌ Bad */
.myClass {
    padding: 16px;
    color: #06c;
}

/* ✅ Good */
.myClass {
    padding: var(--pf-v5-global--spacer--md);
    color: var(--pf-v5-global--primary-color--100);
}
```

**3. Don't mix UI libraries:**
```typescript
// ❌ Bad - mixing libraries
import { Button } from '@mui/material';
import { Card } from '@patternfly/react-core';

// ✅ Good - consistent library
import { Button, Card } from '@patternfly/react-core';
```

**4. Don't use important excessively:**
```css
/* ❌ Bad */
.myClass {
    color: red !important;
    padding: 20px !important;
}

/* ✅ Good - increase specificity instead */
.card .myClass {
    color: red;
    padding: 20px;
}
```

---

## Quick Reference

| Need | PatternFly Solution |
|------|-------------------|
| Spacing | CSS variables: `--pf-v5-global--spacer--{size}` |
| Colors | CSS variables: `--pf-v5-global--{type}-color--100` |
| Custom styles | CSS modules |
| Responsive layout | Grid with span/md/lg props |
| Component variants | Use variant prop (Button, Alert, etc.) |
| Dynamic styles | Inline styles with CSS variables |
| Conditional classes | clsx utility |
| Hide/show responsive | PatternFly utility classes |

---

## Resources

- [PatternFly Design System](https://www.patternfly.org/)
- [PatternFly Components](https://www.patternfly.org/components/about-modal)
- [PatternFly CSS Variables](https://www.patternfly.org/developer-resources/global-css-variables)
- [PatternFly Layouts](https://www.patternfly.org/layouts/bullseye)
