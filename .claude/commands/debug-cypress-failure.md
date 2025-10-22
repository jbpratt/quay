---
allowed-tools: Bash(npm run test:integration:*), Bash(git log:*), Bash(git blame:*), Bash(git diff:*), Bash(ls:*), Read(//tmp/playwright-output/**), Read(//var/home/bpratt/git/quay/quay/web/cypress/screenshots/**), mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_type, mcp__playwright__browser_fill_form, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_wait_for, mcp__playwright__browser_press_key, mcp__playwright__browser_console_messages
argument-hint: <test-file>
description: Debug a Cypress e2e test failure
---

# Debug a Cypress e2e Test Failure

Systematically debug a failed Cypress test by running it, analyzing screenshots, using Playwright to reproduce the issue, and reviewing git history.

## Test File

The test file to debug: `$ARGUMENTS`

## Debugging Workflow

### Step 1: Run the Cypress Test

Run the specific Cypress test to reproduce the failure:

```bash
cd web && npm run test:integration -- --spec $ARGUMENTS
```

**What to observe:**
- Test failure messages and error output
- Assertion failures and stack traces
- Whether screenshots were captured (stored in `web/cypress/screenshots/`)

### Step 2: Analyze Cypress Screenshots

List and examine screenshots captured during the test failure:

```bash
ls -lah web/cypress/screenshots/
```

**Then read relevant screenshots:**
- Look for screenshots in subdirectories matching the test name
- Screenshots show the UI state at the time of failure
- Compare with expected behavior

### Step 3: Manual Reproduction with Playwright

Use Playwright MCP to manually reproduce the failure and investigate:

**3a. Navigate to the application:**
```
Navigate to: http://localhost:9000
```

**3b. Login (if needed for the test):**
- Username: `user1`
- Password: `password`
- Use browser_click, browser_type, or browser_fill_form as needed

**3c. Take snapshots and screenshots:**
- Use `browser_snapshot` to get accessible page structure
- Use `browser_take_screenshot` to capture visual state
- Save screenshots to `/tmp/playwright-output/` for later comparison

**3d. Navigate to the page being tested:**
- Based on the test file name, navigate to the relevant page
- Interact with UI elements mentioned in the test
- Check browser console for errors using `browser_console_messages`

**Examples:**
- `account-settings.cy.ts` → Navigate to user settings
- `repository-details.cy.ts` → Navigate to a repository page
- `org-list.cy.ts` → Navigate to organizations list

### Step 4: Git History Analysis

Analyze recent changes to understand what might have broken:

**4a. Find related source files:**
Based on the test file name, identify the corresponding source code:
- Test: `cypress/e2e/account-settings.cy.ts` → Source: `src/routes/AccountSettings/`
- Test: `cypress/e2e/repository-details.cy.ts` → Source: `src/routes/RepositoryDetails/`
- Test: `cypress/e2e/org-list.cy.ts` → Source: `src/routes/OrganizationsList/`

**4b. Check recent commits affecting the test:**
```bash
git log --oneline -20 --follow -- $ARGUMENTS
```

**4c. Check recent commits affecting source files:**
```bash
git log --oneline -20 --follow -- web/src/routes/<relevant-directory>/
```

**4d. Blame the test file to see recent changes:**
```bash
git blame $ARGUMENTS
```

**4e. Show recent changes to the test:**
```bash
git diff HEAD~5 -- $ARGUMENTS
```

**4f. Search for related recent commits:**
Based on the feature/component being tested, search git log for keywords

### Step 5: Screenshot Comparison

Compare screenshots from different sources:

1. **Cypress screenshots** (from test failure): `web/cypress/screenshots/`
2. **Playwright screenshots** (manual reproduction): `/tmp/playwright-output/`
3. **Expected behavior**: Based on PatternFly components and UI specs

**Questions to ask:**
- Are UI elements missing or misaligned?
- Are there console errors in the Playwright session?
- Does the manual reproduction show the same issue?
- Did recent commits change component structure or styles?

### Step 6: Root Cause Analysis

Based on the evidence gathered:

1. **Identify the failure point**: Which assertion or action failed?
2. **Determine the root cause**:
   - UI regression from recent code changes?
   - Test needs updating due to legitimate UI changes?
   - Timing issue (flaky test)?
   - Data seeding issue?
3. **Recommend fix**:
   - Update test selectors if UI structure changed
   - Fix UI bug if regression detected
   - Add wait conditions if timing issue
   - Update test data if data issue

## Key Locations

- **Cypress tests**: `web/cypress/e2e/`
- **Cypress screenshots**: `web/cypress/screenshots/`
- **Cypress config**: `web/cypress.config.ts`
- **Source code**: `web/src/routes/`
- **Playwright screenshots**: `/tmp/playwright-output/`
- **Test credentials**: `user1` / `password`
- **App URL**: `http://localhost:9000`
- **Backend URL**: `http://localhost:8080`

## Tips

- Cypress tests may use stubbed responses (mocked API) or server responses (real backend)
- Check `cypress/fixtures/` for mock data used in tests
- Review `cypress/support/` for custom commands
- Tests run against production build served on port 9000
- Use `npm run start:integration` to start the test server manually
- Default viewport: 1280x800 (configurable in `cypress.config.ts`)
- Screenshots are only captured on test failure by default
