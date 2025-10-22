---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git diff:*)
argument-hint: [optional commit message]
description: Create a git commit following conventional commit format
---

# Create a Conventional Commit

Follow these steps to create a well-formatted commit:

1. **Review changes**: Run `git status` and `git diff --name-only` to show ONLY modified tracked files (not untracked files)

2. **Stage modified files**: Ask which modified files to stage, then stage them individually using `git add <file>` for each selected file. NEVER use `git add .`

3. **Create commit message**: Ask for:
   - **Type**: feat, fix, chore, ci, ui, docs, test, deps, web, db, sentry, dockerfile
   - **Scope** (optional): ui, oidc, web, etc.
   - **Description**: clear, concise summary
   - **Ticket** (optional): PROJQUAY-XXXX format

4. **Format**: Use conventional commit format:
   - With scope and ticket: `type(scope): description (PROJQUAY-XXXX)`
   - With scope only: `type(scope): description`
   - With ticket only: `type: description (PROJQUAY-XXXX)`
   - Basic: `type: description`

5. **Commit**: Create the commit using the formatted message with a heredoc:
   ```bash
   git commit --no-gpg-sign -m "$(cat <<'EOF'
   [formatted commit message]

   Co-authored-by: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

6. **Verify**: Run `git status` and show the commit message

$ARGUMENTS
