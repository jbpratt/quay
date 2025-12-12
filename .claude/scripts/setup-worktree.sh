#!/bin/bash
# Create a git worktree for a JIRA issue
# Usage: setup-worktree.sh <ISSUE-KEY>

set -e

ISSUE_KEY="$1"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ -z "$ISSUE_KEY" ]; then
  echo -e "${RED}Error: Issue key required${NC}"
  echo "Usage: $0 <ISSUE-KEY>"
  echo "Example: $0 PROJQUAY-1234"
  exit 1
fi

# Validate issue key format (PROJECT-NUMBER)
if ! echo "$ISSUE_KEY" | grep -qE '^[A-Z]+-[0-9]+$'; then
  echo -e "${RED}Error: Invalid issue key format${NC}"
  echo "Expected format: PROJECT-1234 (e.g., PROJQUAY-1234)"
  exit 1
fi

# Get repository name from current directory
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")

# Define worktree path
WORKTREE_PATH="../${REPO_NAME}-${ISSUE_KEY}"

# Check if worktree already exists
if [ -d "$WORKTREE_PATH" ]; then
  echo -e "${YELLOW}Worktree already exists at: $WORKTREE_PATH${NC}"

  # Check if it's a valid git worktree
  if git worktree list | grep -q "$WORKTREE_PATH"; then
    cd "$WORKTREE_PATH"
    CURRENT_BRANCH=$(git branch --show-current)
    echo -e "${GREEN}Existing worktree is valid${NC}"
    echo "Branch: $CURRENT_BRANCH"
    echo "Path: $WORKTREE_PATH"
    exit 0
  else
    echo -e "${RED}Error: Directory exists but is not a valid git worktree${NC}"
    echo "Please remove the directory manually or choose a different location"
    exit 1
  fi
fi

# Check if dev branch exists, fall back to master if not
BASE_BRANCH="dev"
if ! git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
  echo -e "${YELLOW}Warning: '$BASE_BRANCH' branch not found, checking for 'master'${NC}"
  BASE_BRANCH="master"
  if ! git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
    echo -e "${RED}Error: Neither 'dev' nor 'master' branch exists${NC}"
    exit 1
  fi
fi

# Get the current branch to avoid conflicts
CURRENT_BRANCH=$(git branch --show-current)

# If current branch is the same as base branch, create worktree from commit instead
if [ "$CURRENT_BRANCH" = "$BASE_BRANCH" ]; then
  echo "Creating worktree for $ISSUE_KEY..."
  echo "Base branch: $BASE_BRANCH (using commit reference)"

  # Create worktree using commit hash instead of branch name to avoid conflict
  BASE_COMMIT=$(git rev-parse "$BASE_BRANCH")
  if ! git worktree add --detach "$WORKTREE_PATH" "$BASE_COMMIT" 2>&1; then
    echo -e "${RED}Error: Failed to create worktree${NC}"
    exit 1
  fi
else
  echo "Creating worktree for $ISSUE_KEY..."
  echo "Base branch: $BASE_BRANCH"

  # Create worktree normally
  if ! git worktree add "$WORKTREE_PATH" "$BASE_BRANCH" 2>&1; then
    echo -e "${RED}Error: Failed to create worktree${NC}"
    exit 1
  fi
fi

# Navigate to worktree and create feature branch
cd "$WORKTREE_PATH"

# Check if branch already exists locally or remotely
if git rev-parse --verify "$ISSUE_KEY" >/dev/null 2>&1; then
  echo -e "${YELLOW}Branch '$ISSUE_KEY' already exists locally, checking it out${NC}"
  git checkout "$ISSUE_KEY"
elif git ls-remote --heads origin "$ISSUE_KEY" | grep -q "$ISSUE_KEY"; then
  echo -e "${YELLOW}Branch '$ISSUE_KEY' exists remotely, checking it out${NC}"
  git checkout -b "$ISSUE_KEY" "origin/$ISSUE_KEY"
else
  echo "Creating new branch: $ISSUE_KEY"
  git checkout -b "$ISSUE_KEY"
fi

# Return to original directory
cd - >/dev/null

echo -e "${GREEN}✓ Worktree created successfully${NC}"
echo ""
echo "Worktree path: $WORKTREE_PATH"
echo "Branch: $ISSUE_KEY"
echo ""
echo "To switch to the worktree:"
echo "  cd $WORKTREE_PATH"
echo ""
echo "To remove the worktree when done:"
echo "  git worktree remove $WORKTREE_PATH"
