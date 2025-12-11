---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git diff:*)
argument-hint: [optional commit message]
description: Create a git commit following Quay's commit format with subsystem detection
---

# Create a Quay Commit

Follow these steps to create a well-formatted commit for the Quay project:

1. **Review changes**: Run `git status` and `git diff --name-only` to show ONLY modified tracked files (not untracked files)

2. **Detect subsystem**: Analyze changed file paths to suggest the appropriate Quay subsystem:
   - `data/**` → data
   - `endpoints/**` → endpoints
   - `web/**` → web
   - `workers/**` → workers
   - `auth/**` → auth
   - `buildman/**` → buildman
   - `storage/**` → storage
   - Other files → api (general)

   If multiple subsystems are affected, ask the user which is primary.

3. **Stage modified files**: Ask which modified files to stage, then stage them individually using `git add <file>` for each selected file. NEVER use `git add .`

4. **Create commit message**: Ask for:
   - **Type**: fix, feat, chore, ci, ui, docs, test, deps, db, refactor, perf, build
   - **Subsystem**: Use detected subsystem (allow override)
     - Valid subsystems: api, data, auth, endpoints, workers, buildman, storage, web
   - **Description**: Clear, concise summary (imperative mood)
   - **JIRA Ticket**: PROJQUAY-#### format (REQUIRED)
   - **Body** (optional): Explain WHY the change was made

5. **Format**: Use Quay commit format:
   ```
   type(subsystem): description (PROJQUAY-####)

   [optional body explaining why]
   ```

   **Requirements**:
   - Subject line max 70 characters (including JIRA ticket)
   - Body wrapped at 80 characters (if present)
   - Use imperative mood ("add" not "added")

   **Examples**:
   - `fix(data): prevent race condition in repo deletion (PROJQUAY-1234)`
   - `feat(web): add dark mode toggle to settings (PROJQUAY-5678)`
   - `chore(endpoints): refactor API v2 auth middleware (PROJQUAY-9012)`

6. **Commit**: Create the commit using the formatted message with a heredoc:
   ```bash
   git commit --no-gpg-sign -m "$(cat <<'EOF'
   [formatted commit message]

   Co-authored-by: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

7. **Verify**: Run `git status` and show the commit message

**Note**: All Quay commits MUST include a JIRA ticket in PROJQUAY-#### format. Use the `/create-issue` command if you need to create a new ticket.

**Important**: Always use `--no-gpg-sign` when committing. Claude cannot sign commits with a GPG key.

$ARGUMENTS
