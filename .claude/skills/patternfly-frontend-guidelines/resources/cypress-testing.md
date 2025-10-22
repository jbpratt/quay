# Cypress E2E Testing Guide

## Table of Contents
- [Getting Started](#getting-started)
- [Test Structure](#test-structure)
- [Selectors Strategy](#selectors-strategy)
- [API Mocking](#api-mocking)
- [Custom Commands](#custom-commands)
- [Best Practices](#best-practices)
- [Common Patterns](#common-patterns)

---

## Getting Started

### Installation

```bash
npm install --save-dev cypress @testing-library/cypress
```

### Configuration

```typescript
// cypress.config.ts
import { defineConfig } from 'cypress';

export default defineConfig({
    e2e: {
        baseUrl: 'http://localhost:5173',
        viewportWidth: 1280,
        viewportHeight: 720,
        video: false,
        screenshotOnRunFailure: true,
        setupNodeEvents(on, config) {
            // implement node event listeners here
        },
    },
});
```

### Project Structure

```
cypress/
  e2e/
    auth/
      login.cy.ts
      signup.cy.ts
    posts/
      create-post.cy.ts
      view-posts.cy.ts
  fixtures/
    users.json
    posts.json
  support/
    commands.ts
    e2e.ts
```

---

## Test Structure

### Basic Test Template

```typescript
// cypress/e2e/posts/create-post.cy.ts
describe('Create Post', () => {
    beforeEach(() => {
        // Setup before each test
        cy.visit('/posts');
        cy.intercept('POST', '/api/posts', { fixture: 'posts/new-post.json' }).as('createPost');
    });

    it('should create a new post successfully', () => {
        // Arrange
        cy.findByTestId('create-post-button').click();

        // Act
        cy.findByTestId('title-input').type('My New Post');
        cy.findByTestId('content-input').type('This is the content');
        cy.findByTestId('submit-button').click();

        // Assert
        cy.wait('@createPost');
        cy.findByTestId('success-alert').should('be.visible');
        cy.findByTestId('post-title').should('contain', 'My New Post');
    });

    it('should show validation errors for empty fields', () => {
        cy.findByTestId('create-post-button').click();
        cy.findByTestId('submit-button').click();

        cy.findByTestId('title-error').should('be.visible');
        cy.findByTestId('content-error').should('be.visible');
    });
});
```

### AAA Pattern

**Arrange → Act → Assert**

```typescript
it('should filter posts by category', () => {
    // Arrange - Set up test data and state
    cy.intercept('GET', '/api/posts*', { fixture: 'posts.json' }).as('getPosts');
    cy.visit('/posts');
    cy.wait('@getPosts');

    // Act - Perform user actions
    cy.findByTestId('category-filter').click();
    cy.findByText('Technology').click();

    // Assert - Verify expected outcomes
    cy.findByTestId('post-list').find('[data-testid^="post-item-"]').should('have.length', 3);
    cy.findByTestId('post-item-1').should('contain', 'Technology');
});
```

---

## Selectors Strategy

### Priority Order

1. **data-testid** (BEST) - Stable, semantic
2. **role + accessible name** - Accessibility-focused
3. **label text** - For form elements
4. **text content** - For static content
5. **CSS selectors** (AVOID) - Fragile

### Using data-testid

```typescript
// Component
<Button data-testid="submit-button">Submit</Button>

// Test
cy.findByTestId('submit-button').click();
```

### Using Testing Library Queries

```typescript
// Install @testing-library/cypress
import '@testing-library/cypress/add-commands';

// By role
cy.findByRole('button', { name: /submit/i }).click();

// By label
cy.findByLabelText('Email').type('test@example.com');

// By text
cy.findByText('Welcome to the app').should('be.visible');

// By placeholder
cy.findByPlaceholderText('Enter your name').type('John');
```

### Naming Convention for data-testid

| Element Type | Pattern | Example |
|-------------|---------|---------|
| Button | `{action}-button` | `submit-button`, `cancel-button` |
| Input | `{field}-input` | `email-input`, `password-input` |
| Card/Container | `{feature}-{type}` | `user-profile-card`, `post-list` |
| List item | `{type}-item-{id?}` | `post-item`, `post-item-123` |
| Modal | `{name}-modal` | `confirm-delete-modal` |
| Alert | `{type}-alert` | `success-alert`, `error-alert` |

---

## API Mocking

### Basic Interception

```typescript
// Mock successful response
cy.intercept('GET', '/api/posts', { fixture: 'posts.json' }).as('getPosts');

// Mock error response
cy.intercept('POST', '/api/posts', {
    statusCode: 500,
    body: { error: 'Internal Server Error' }
}).as('createPostError');

// Mock with delay
cy.intercept('GET', '/api/posts', (req) => {
    req.reply({
        delay: 1000,
        fixture: 'posts.json'
    });
}).as('getPostsSlow');
```

### Fixtures

```json
// cypress/fixtures/posts.json
{
    "posts": [
        {
            "id": 1,
            "title": "First Post",
            "content": "This is the first post",
            "author": "John Doe"
        },
        {
            "id": 2,
            "title": "Second Post",
            "content": "This is the second post",
            "author": "Jane Smith"
        }
    ]
}
```

### Dynamic Responses

```typescript
cy.intercept('POST', '/api/posts', (req) => {
    // Modify request
    req.body.createdAt = new Date().toISOString();

    // Send custom response
    req.reply({
        statusCode: 201,
        body: {
            id: Date.now(),
            ...req.body
        }
    });
}).as('createPost');
```

### Wait for API Calls

```typescript
it('should load posts on page load', () => {
    cy.intercept('GET', '/api/posts*').as('getPosts');
    cy.visit('/posts');

    // Wait for API call to complete
    cy.wait('@getPosts').then((interception) => {
        expect(interception.response.statusCode).to.equal(200);
        expect(interception.response.body.posts).to.have.length.greaterThan(0);
    });

    cy.findByTestId('post-list').should('be.visible');
});
```

---

## Custom Commands

### Define Custom Commands

```typescript
// cypress/support/commands.ts
declare global {
    namespace Cypress {
        interface Chainable {
            /**
             * Login with username and password
             */
            login(email: string, password: string): Chainable<void>;

            /**
             * Get element by data-testid
             */
            getByTestId(testId: string): Chainable<JQuery<HTMLElement>>;

            /**
             * Fill form with data
             */
            fillForm(formData: Record<string, string>): Chainable<void>;
        }
    }
}

Cypress.Commands.add('login', (email: string, password: string) => {
    cy.visit('/login');
    cy.findByTestId('email-input').type(email);
    cy.findByTestId('password-input').type(password);
    cy.findByTestId('login-button').click();
    cy.url().should('not.include', '/login');
});

Cypress.Commands.add('getByTestId', (testId: string) => {
    return cy.get(`[data-testid="${testId}"]`);
});

Cypress.Commands.add('fillForm', (formData: Record<string, string>) => {
    Object.entries(formData).forEach(([field, value]) => {
        cy.findByTestId(`${field}-input`).type(value);
    });
});
```

### Use Custom Commands

```typescript
describe('User Flow', () => {
    it('should create post after login', () => {
        // Use custom login command
        cy.login('test@example.com', 'password123');

        // Use custom form fill command
        cy.findByTestId('create-post-button').click();
        cy.fillForm({
            title: 'My Post',
            content: 'Post content here'
        });
        cy.findByTestId('submit-button').click();

        cy.getByTestId('success-alert').should('be.visible');
    });
});
```

---

## Best Practices

### ✅ DO

**1. Test user journeys, not implementation:**
```typescript
// ✅ Good - tests user behavior
it('should allow user to complete checkout', () => {
    cy.findByTestId('add-to-cart-button').click();
    cy.findByTestId('cart-icon').click();
    cy.findByTestId('checkout-button').click();
    cy.fillForm({ /* payment info */ });
    cy.findByTestId('place-order-button').click();
    cy.findByText('Order confirmed').should('be.visible');
});

// ❌ Bad - tests implementation details
it('should update cart state when item added', () => {
    cy.window().its('store.cart.items').should('have.length', 0);
    // Testing internal state
});
```

**2. Use stable selectors:**
```typescript
// ✅ Good - stable data-testid
cy.findByTestId('submit-button').click();

// ❌ Bad - fragile CSS selector
cy.get('.btn.btn-primary.submit-btn').click();
```

**3. Mock API responses:**
```typescript
beforeEach(() => {
    cy.intercept('GET', '/api/posts', { fixture: 'posts.json' }).as('getPosts');
});
```

**4. Use beforeEach for common setup:**
```typescript
describe('Post Management', () => {
    beforeEach(() => {
        cy.login('test@example.com', 'password');
        cy.visit('/posts');
    });

    it('should create post', () => { /* ... */ });
    it('should edit post', () => { /* ... */ });
});
```

**5. Write descriptive test names:**
```typescript
// ✅ Good
it('should show validation error when email is invalid', () => {});

// ❌ Bad
it('test email validation', () => {});
```

---

### ❌ DON'T

**1. Don't use cy.wait() with arbitrary time:**
```typescript
// ❌ Bad - flaky
cy.findByTestId('button').click();
cy.wait(3000);  // Arbitrary wait
cy.findByTestId('result').should('be.visible');

// ✅ Good - wait for specific condition
cy.findByTestId('button').click();
cy.findByTestId('result').should('be.visible');
```

**2. Don't test external services:**
```typescript
// ❌ Bad - testing external API
it('should fetch real data from API', () => {
    cy.request('https://api.example.com/posts');
});

// ✅ Good - mock the API
it('should display posts from API', () => {
    cy.intercept('GET', '/api/posts', { fixture: 'posts.json' });
    cy.visit('/posts');
});
```

**3. Don't share state between tests:**
```typescript
// ❌ Bad - tests depend on each other
let userId;

it('should create user', () => {
    // ...
    userId = 123;
});

it('should update user', () => {
    cy.request(`/api/users/${userId}`);  // Depends on previous test
});

// ✅ Good - independent tests
it('should update user', () => {
    const userId = 123;  // Create own data
    cy.request(`/api/users/${userId}`);
});
```

**4. Don't use CSS selectors when data-testid is available:**
```typescript
// ❌ Bad
cy.get('.pf-c-card .pf-c-button.pf-m-primary').click();

// ✅ Good
cy.findByTestId('submit-button').click();
```

---

## Common Patterns

### Login Flow

```typescript
// Custom command
Cypress.Commands.add('login', (email: string, password: string) => {
    cy.session([email, password], () => {
        cy.visit('/login');
        cy.findByTestId('email-input').type(email);
        cy.findByTestId('password-input').type(password);
        cy.findByTestId('login-button').click();
        cy.url().should('not.include', '/login');
    });
});

// Use in tests
describe('Protected Pages', () => {
    beforeEach(() => {
        cy.login('test@example.com', 'password123');
    });

    it('should access dashboard', () => {
        cy.visit('/dashboard');
        cy.findByTestId('dashboard-content').should('be.visible');
    });
});
```

### Form Validation

```typescript
it('should validate form fields', () => {
    cy.findByTestId('create-form').within(() => {
        // Submit empty form
        cy.findByTestId('submit-button').click();

        // Check validation errors
        cy.findByTestId('name-error').should('be.visible')
            .and('contain', 'Name is required');
        cy.findByTestId('email-error').should('be.visible')
            .and('contain', 'Email is required');

        // Fill valid data
        cy.findByTestId('name-input').type('John Doe');
        cy.findByTestId('email-input').type('john@example.com');

        // Errors should disappear
        cy.findByTestId('name-error').should('not.exist');
        cy.findByTestId('email-error').should('not.exist');
    });
});
```

### Modal Interaction

```typescript
it('should confirm delete action in modal', () => {
    cy.findByTestId('delete-button').click();

    // Modal should appear
    cy.findByTestId('confirm-delete-modal').should('be.visible');

    // Cancel should close modal
    cy.findByTestId('cancel-button').click();
    cy.findByTestId('confirm-delete-modal').should('not.exist');

    // Try again and confirm
    cy.findByTestId('delete-button').click();
    cy.findByTestId('confirm-delete-modal').within(() => {
        cy.findByTestId('confirm-button').click();
    });

    // Verify deletion
    cy.findByTestId('success-alert').should('contain', 'Deleted successfully');
});
```

### Search and Filter

```typescript
it('should filter posts by search term', () => {
    cy.intercept('GET', '/api/posts*').as('getPosts');
    cy.visit('/posts');
    cy.wait('@getPosts');

    // Initial count
    cy.findByTestId('post-list').find('[data-testid^="post-item-"]')
        .should('have.length.greaterThan', 0);

    // Search
    cy.findByTestId('search-input').type('React');

    // Verify filtered results
    cy.findByTestId('post-list').find('[data-testid^="post-item-"]').each(($el) => {
        cy.wrap($el).should('contain', 'React');
    });
});
```

### File Upload

```typescript
it('should upload file', () => {
    cy.findByTestId('file-input').selectFile('cypress/fixtures/test-image.png');
    cy.findByTestId('file-name').should('contain', 'test-image.png');
    cy.findByTestId('upload-button').click();

    cy.wait('@uploadFile').its('response.statusCode').should('equal', 200);
    cy.findByTestId('upload-success').should('be.visible');
});
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Visit page | `cy.visit('/path')` |
| Get by test ID | `cy.findByTestId('my-button')` |
| Get by text | `cy.findByText('Submit')` |
| Get by role | `cy.findByRole('button', { name: /submit/i })` |
| Click element | `.click()` |
| Type text | `.type('text')` |
| Assert visible | `.should('be.visible')` |
| Assert text | `.should('contain', 'text')` |
| Mock API | `cy.intercept('GET', '/api/posts', { fixture: 'posts.json' })` |
| Wait for request | `cy.wait('@aliasName')` |
| Within scope | `.within(() => { ... })` |

---

## Resources

- [Cypress Documentation](https://docs.cypress.io/)
- [Testing Library Cypress](https://testing-library.com/docs/cypress-testing-library/intro/)
- [Cypress Best Practices](https://docs.cypress.io/guides/references/best-practices)
- [PatternFly Testing](https://www.patternfly.org/get-started/develop#testing)
