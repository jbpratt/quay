---
allowed-tools: Bash(jira:*), mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_type, mcp__playwright__browser_fill_form, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_wait_for, mcp__playwright__browser_press_key, mcp__playwright__browser_console_messages, mcp__context7__resolve-library-id, mcp__context7__get-library-docs, Read, Glob, Grep, TodoWrite
argument-hint: <issue-key>
description: Systematically plan a bug or feature based on a JIRA issue
---

# Create Plan from Issue

Systematically analyze a JIRA issue and create an actionable implementation plan. This command intelligently handles different issue types (UI bugs, UI features, backend bugs, etc.) and leverages appropriate tools.

## Issue Key

The JIRA issue to plan: `$ARGUMENTS`

## Planning Workflow

### Step 1: Fetch Issue Details

Retrieve the full issue information from JIRA:

```bash
jira issue view $ARGUMENTS
```

**Extract key information:**
- Issue type (Bug, Story, Task, etc.)
- Summary and description
- Component (ui, api, data, etc.)
- Priority
- Labels
- Comments with additional context

### Step 2: Classify the Issue

Analyze the issue to determine its category:

**UI Bug indicators:**
- Component is "ui" or "web"
- Keywords: rendering, display, UI, interface, button, form, modal, table, layout, styling, visual
- Describes visual or interaction problems

**UI Feature indicators:**
- Component is "ui" or "web"
- Issue type is Story or Task
- Keywords: add, create, implement, new page, new component, migrate, port
- Description mentions Angular or old UI (indicates React port)

**Backend Bug/Feature indicators:**
- Component is api, data, auth, endpoints, workers, buildman, storage
- Keywords: API, endpoint, database, authentication, background job, storage

### Step 3: Issue-Specific Planning

Based on the classification, follow the appropriate sub-workflow:

#### 3A. UI Bug Planning

1. **Understand the bug:**
   - What is the expected behavior?
   - What is the actual behavior?
   - Steps to reproduce (if provided)
   - Affected UI components or pages

2. **Create reproduction plan with Playwright:**
   - Navigate to http://localhost:9000
   - Login with credentials (user1/password) if needed
   - Navigate to the affected page/component
   - Perform actions to reproduce the bug
   - Take screenshots and snapshots to document the issue
   - Check browser console for errors

3. **Locate relevant code:**
   - Search for related components in `web/src/`
   - Identify the route or component files
   - Look for related test files in `web/cypress/e2e/`

4. **Create TodoList:**
   - Reproduce the bug with Playwright
   - Locate source code for affected component
   - Identify root cause
   - Implement fix
   - Add or update tests
   - Verify fix with Playwright

#### 3B. UI Feature Planning (React Port)

1. **Check if this is an Angular to React port:**
   - Look for references to Angular UI in description/comments
   - Search for "port", "migrate", "current UI", "new UI", or "Angular" keywords
   - If confirmed, locate the Angular component for reference

2. **Fetch PatternFly and React documentation:**
   - Use context7 to get PatternFly docs for relevant components
   - Get React best practices documentation
   - Example: If building a table, fetch PatternFly Table docs

   ```
   resolve-library-id: "@patternfly/react-core"
   get-library-docs: topic relevant to the feature (e.g., "Table", "Form", "Modal")
   ```

3. **Locate existing similar components:**
   - Search for similar patterns in `web/src/routes/`
   - Identify reusable components in `web/src/components/`
   - Check existing tests for similar features

4. **Create TodoList:**
   - Research Angular implementation (if applicable)
   - Review PatternFly documentation
   - Design component structure
   - Implement React component
   - Add routing (if new page)
   - Implement API integration
   - Write Cypress tests
   - Verify with Playwright

#### 3C. UI Feature Planning (New Feature)

1. **Fetch relevant documentation:**
   - Use context7 for PatternFly components needed
   - Get React/TypeScript docs if needed
   - Example libraries: @patternfly/react-core, react-router-dom

2. **Design the feature:**
   - What UI components are needed?
   - What user interactions are required?
   - What API endpoints are needed (if any)?
   - What state management is required?

3. **Locate integration points:**
   - Where does this fit in the navigation/routing?
   - What existing components can be reused?
   - What API calls are needed?

4. **Create TodoList:**
   - Review PatternFly documentation
   - Design component architecture
   - Implement components
   - Add routing/navigation
   - Implement API integration
   - Add state management
   - Write Cypress tests
   - Manual testing with Playwright

#### 3D. Backend Bug/Feature Planning

1. **Understand the backend issue:**
   - What API endpoints are affected?
   - What database tables/models are involved?
   - What background workers are involved?

2. **Locate relevant code:**
   - Search for endpoints in Python codebase
   - Find related database models
   - Identify worker code if applicable

3. **Create TodoList:**
   - Reproduce the issue (if bug)
   - Locate relevant code
   - Implement fix/feature
   - Add unit tests
   - Add integration tests (if applicable)
   - Test manually

### Step 4: Research Phase

**For UI issues, gather context:**
- Read existing component implementations
- Check PatternFly documentation via context7
- Review similar test patterns

**For backend issues, gather context:**
- Read existing endpoint implementations
- Check database schema
- Review existing tests

### Step 5: Create Comprehensive TodoList

Use the TodoWrite tool to create a structured plan with:
- Clear, actionable tasks
- Proper task ordering (research → design → implement → test)
- Both `content` and `activeForm` for each task

**Example TodoList structure:**
```
1. Fetch and analyze JIRA issue details (in_progress)
2. Reproduce bug with Playwright (pending)
3. Locate source code for affected component (pending)
4. Review PatternFly documentation (pending)
5. Implement fix (pending)
6. Write/update tests (pending)
7. Verify fix with manual testing (pending)
```

### Step 6: Documentation Lookup

**Common documentation needs:**

- **PatternFly Components**: Use context7 with "@patternfly/react-core"
  - Table, Form, Modal, Button, Select, etc.

- **React Router**: Use context7 with "react-router-dom"
  - For navigation and routing features

- **React Query**: Use context7 with "@tanstack/react-query"
  - For API data fetching patterns

- **TypeScript**: Use context7 with "typescript"
  - For type-related questions

**Example workflow:**
```
1. resolve-library-id "@patternfly/react-core"
2. get-library-docs with topic "Table" (for table-related features)
```

## Key Locations

- **React UI source**: `web/src/`
- **Routes**: `web/src/routes/`
- **Reusable components**: `web/src/components/`
- **API hooks**: `web/src/hooks/`
- **Cypress tests**: `web/cypress/e2e/`
- **Python API**: Root directory (various modules)
- **Test credentials**: `user1` / `password`
- **App URL**: `http://localhost:9000`

## Tips

- Always create a TodoList to track the planning and implementation
- For Angular to React ports, find the Angular component first for reference
- Use Playwright to verify UI bugs and test fixes
- Leverage context7 for up-to-date PatternFly and React documentation
- Check existing similar features in the codebase for patterns
- Consider accessibility when planning UI features
- Include both unit tests and e2e tests in the plan

## Example Usage

```
/create-plan-from-issue PROJQUAY-1234
```

This will:
1. Fetch PROJQUAY-1234 from JIRA
2. Analyze the issue type and components
3. Create a systematic implementation plan
4. Fetch relevant documentation if needed
5. Set up a TodoList to track progress
