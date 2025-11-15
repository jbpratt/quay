---
name: quay-commit-formatter
description: Enforces Quay commit format combining conventional commit types with Quay subsystems. Format is type(subsystem) message (PROJQUAY-####). Includes smart subsystem detection from changed files. Use when creating commits, writing commit messages, or working with git commit, JIRA tickets, PROJQUAY tickets, or the /commit command.
---

# Quay Commit Formatter

## Purpose

Ensures all commits in the Quay repository follow the required format that combines conventional commit types with Quay-specific subsystems and JIRA ticket references.

## When to Use This Skill

- Creating a new git commit
- Writing commit messages
- Using the `/commit` slash command
- Formatting commit messages for pull requests
- Reviewing commit message format

---

## Commit Format Specification

### Required Format

```
type(subsystem): message (PROJQUAY-####)

[optional body explaining why this change was made]
```

### Format Rules

- **Type**: Conventional commit type (see types below)
- **Subsystem**: Quay component subsystem (see subsystems below)
- **Message**: Clear, concise description of what changed
- **Ticket**: JIRA ticket reference in format `PROJQUAY-####` (required)
- **Subject line**: Maximum 70 characters
- **Body**: Optional, wrapped at 80 characters, explains WHY (not what)

### Examples

**Good commits:**
```
fix(data): prevent race condition in repository deletion (PROJQUAY-1234)

This adds proper locking to prevent concurrent deletion attempts
that could corrupt the database state.
```

```
feat(web): add dark mode toggle to settings panel (PROJQUAY-5678)
```

```
chore(endpoints): refactor API v2 authentication middleware (PROJQUAY-9012)

Extracted common auth logic to reduce duplication across endpoints.
```

**Bad commits:**
```
❌ Fix bug (PROJQUAY-1234)
   Missing: type in format, subsystem

❌ fix: update data layer
   Missing: subsystem, JIRA ticket

❌ fix(data): prevent race condition in repository deletion when multiple workers try to delete at the same time and cause issues (PROJQUAY-1234)
   Problem: Subject line exceeds 70 characters

❌ updated stuff
   Missing: everything - type, subsystem, JIRA ticket, proper message
```

---

## Conventional Commit Types

Use these conventional commit types:

- **fix**: Bug fix (user-facing or internal)
- **feat**: New feature or enhancement
- **chore**: Maintenance, refactoring, cleanup (no functional changes)
- **ci**: CI/CD pipeline changes
- **ui**: UI-specific changes (consider using `feat(web)` or `fix(web)`)
- **docs**: Documentation updates
- **test**: Test additions or modifications
- **deps**: Dependency updates
- **db**: Database schema or migration changes
- **refactor**: Code refactoring without behavior change
- **perf**: Performance improvements
- **build**: Build system changes

Most common: **fix**, **feat**, **chore**

---

## Quay Subsystems

Choose the appropriate subsystem based on which component is affected:

- **api**: Core API logic and shared API utilities
- **data**: Database layer, ORM models, data access (`data/` directory)
- **auth**: Authentication and authorization (`auth/` directory)
- **endpoints**: API endpoints and routes (`endpoints/` directory)
- **workers**: Background workers and job processors (`workers/` directory)
- **buildman**: Container build system (`buildman/` directory)
- **storage**: Storage backends and abstractions (`storage/` directory)
- **web**: Frontend React application (`web/` directory)

---

## Smart Subsystem Detection

When creating a commit, analyze the changed files to suggest the appropriate subsystem:

### Detection Rules

Run `git diff --name-only` to see changed files, then map to subsystems:

| File Path Pattern | Subsystem |
|------------------|-----------|
| `data/**` | data |
| `endpoints/**` | endpoints |
| `web/**` | web |
| `workers/**` | workers |
| `auth/**` | auth |
| `buildman/**` | buildman |
| `storage/**` | storage |
| Files outside specific dirs | api (general) |

### Multiple Subsystems Changed

If changes span multiple subsystems:
1. **Identify primary subsystem**: Which has the most significant changes?
2. **Ask user**: "Changes affect both 'data' and 'endpoints'. Which is primary?"
3. **Default**: Use the subsystem with the most modified files

### Examples

```bash
# Changed files: data/model/repository.py, data/database.py
# Suggested subsystem: data
git commit -m "fix(data): handle null values in repository queries (PROJQUAY-1234)"

# Changed files: web/src/components/Settings.tsx, web/src/routes/settings.tsx
# Suggested subsystem: web
git commit -m "feat(web): add export functionality to settings (PROJQUAY-5678)"

# Changed files: endpoints/api/repository.py, data/model/repository.py
# Multiple subsystems → Ask user or use primary
git commit -m "fix(endpoints): validate repository names before creation (PROJQUAY-9012)"
```

---

## JIRA Ticket Requirements

### Format

- **Pattern**: `PROJQUAY-####` where #### is the ticket number
- **Required**: Every commit must reference a JIRA ticket
- **Placement**: At the end of subject line in parentheses

### Examples

```
✅ fix(data): prevent null pointer in user lookup (PROJQUAY-1234)
✅ feat(web): add pagination to repository list (PROJQUAY-5678)
❌ fix(data): prevent null pointer in user lookup (PROJ-1234) - Wrong project
❌ fix(data): prevent null pointer in user lookup - Missing ticket
```

### Finding Your JIRA Ticket

If you don't have a JIRA ticket:
1. Check the issue/PR description for ticket reference
2. Search JIRA for related work
3. Create a new ticket if needed (use `/create-issue` command)
4. Ask user if uncertain

---

## Pre-Commit Validation Checklist

Before committing, verify:

- [ ] **Type** is a valid conventional commit type (fix, feat, chore, etc.)
- [ ] **Subsystem** matches one of the Quay subsystems
- [ ] **Subsystem** accurately reflects the changed files
- [ ] **Message** clearly describes what changed (not why)
- [ ] **JIRA ticket** is in `PROJQUAY-####` format
- [ ] **Subject line** is 70 characters or less
- [ ] **Body** (if present) explains WHY the change was made
- [ ] **Body** (if present) is wrapped at 80 characters
- [ ] Message uses imperative mood ("add" not "added" or "adds")

---

## Integration with /commit Command

When using the `/commit` slash command:

1. **Review changes**: Shows modified files via `git diff --name-only`

2. **Detect subsystem**: Analyzes file paths and suggests subsystem
   ```
   Based on changes in web/src/components/, suggested subsystem: web
   ```

3. **Prompt for commit details**:
   - Type: fix, feat, chore, etc.
   - Subsystem: Suggested based on files (can override)
   - Message: Brief description
   - JIRA ticket: PROJQUAY-#### format

4. **Format message**: Combines into required format
   ```
   type(subsystem): message (PROJQUAY-####)
   ```

5. **Add body** (optional): If change needs explanation

6. **Validate**: Checks all format requirements

7. **Commit**: Creates commit with proper format

---

## Common Scenarios

### Scenario 1: Single Subsystem Change

```bash
# Changed files: data/model/user.py
git diff --name-only
# → data/model/user.py

# Detected subsystem: data
# Suggested format:
fix(data): handle null email addresses in user model (PROJQUAY-1234)
```

### Scenario 2: Multiple Files, Same Subsystem

```bash
# Changed files: web/src/components/A.tsx, web/src/components/B.tsx, web/src/routes/index.tsx
git diff --name-only
# → All in web/

# Detected subsystem: web
# Suggested format:
feat(web): add new repository browsing interface (PROJQUAY-5678)
```

### Scenario 3: Multiple Subsystems

```bash
# Changed files: data/model/repository.py, endpoints/api/repository.py, web/src/components/Repo.tsx
git diff --name-only
# → data/, endpoints/, web/

# Analysis:
# - data: 1 file
# - endpoints: 1 file
# - web: 1 file

# Ask user: "Changes affect data, endpoints, and web. Which is the primary subsystem for this change?"
# User chooses: endpoints (the API change drove the others)

# Suggested format:
feat(endpoints): add repository tagging API endpoint (PROJQUAY-9012)

Added API support for repository tags, with corresponding data model
and frontend UI changes.
```

### Scenario 4: Configuration/Build Files

```bash
# Changed files: docker-compose.yaml, Makefile, requirements.txt
git diff --name-only
# → Root level config files

# No specific subsystem → use 'api' or 'build' depending on impact
# Suggested format:
chore(build): update docker-compose for local development (PROJQUAY-3456)
```

---

## Quick Reference

### Template

```
type(subsystem): imperative message (PROJQUAY-####)

[Optional body explaining motivation and context]
```

### Most Common Patterns

```
fix(subsystem): correct behavior X (PROJQUAY-####)
feat(subsystem): add feature Y (PROJQUAY-####)
chore(subsystem): refactor component Z (PROJQUAY-####)
```

### Subject Line Formula

```
[type]([subsystem]): [imperative verb] [what changed] ([PROJQUAY-####])
         ↓              ↓                    ↓              ↓
       fix           (data)      prevent race condition  (PROJQUAY-1234)
```

### Character Limits

- Subject: ≤ 70 characters (including JIRA ticket)
- Body: Wrap at 80 characters per line

---

## Tips for Writing Good Commit Messages

### DO ✅

- Use imperative mood: "add" not "added" or "adds"
- Be specific: "fix null pointer in user lookup" not "fix bug"
- Reference the component: Use correct subsystem
- Explain WHY in body (if needed): Motivation and context
- Keep subject concise: Stay under 70 characters

### DON'T ❌

- Don't use vague messages: "update stuff", "fix things"
- Don't include implementation details in subject: Put in body
- Don't forget JIRA ticket: Every commit needs one
- Don't use past tense: "added feature" → "add feature"
- Don't exceed character limits: Subject > 70 chars

---

## Troubleshooting

### "My subject line is too long"

- Remove unnecessary words: "the", "a", filler words
- Use abbreviations: "auth" instead of "authentication"
- Move details to body
- Focus on WHAT changed, not HOW

**Before:**
```
fix(data): prevent the race condition that occurs during repository deletion (PROJQUAY-1234)
[77 characters - too long!]
```

**After:**
```
fix(data): prevent race condition in repository deletion (PROJQUAY-1234)
[70 characters - perfect!]

Added locking mechanism to prevent concurrent deletion attempts.
```

### "I don't know which subsystem to use"

1. Run `git diff --name-only` to see changed files
2. Use the detection rules table above
3. If still unclear, use the most prominent directory
4. If spread across many, ask: "What's the primary purpose of this change?"

### "My changes affect multiple subsystems"

Choose the primary subsystem based on:
- Which subsystem has the core change?
- Which subsystem drove the need for other changes?
- Which subsystem would a developer search for this change?

Mention other subsystems in the body:
```
feat(endpoints): add repository search API (PROJQUAY-5678)

Adds new search endpoint with full-text query support. Also updates
data layer with search indexes and web UI with search interface.
```

### "I don't have a JIRA ticket"

1. Check PR/issue description for ticket reference
2. Search existing JIRA tickets for related work
3. Use `/create-issue` command to create new ticket
4. Ask project maintainers if no ticket exists

---

## Related Files

- `.claude/commands/commit.md` - Slash command for creating commits
- `CLAUDE.md` - Project-wide contribution guidelines
- `.claude/skills/skill-rules.json` - Skill activation rules

---

**Skill Status**: ACTIVE ✅
**Last Updated**: 2025-11-15
**Enforcement**: SUGGEST (proactive guidance, non-blocking)
