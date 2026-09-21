#!/usr/bin/env python3
"""
Decide whether a quay/quay master PR should get a backport-triage nudge.

Deterministic, no model call: the decision looks only at the CI-enforced
conventional-commit title grammar (.github/workflows/ci-lint.yaml:23) and the
set of changed paths.

Environment variables:
    PR_TITLE       - the pull request title
    CHANGED_FILES  - newline-separated list of changed file paths
    PR_BASE_REF    - the pull request's base branch (default: master)
    PR_STATE       - the pull request's state, e.g. open/closed (default: open)
    GITHUB_OUTPUT  - GitHub Actions output file (set automatically in CI)
"""

import os
import re
import sys

# Same grammar CI enforces: .github/workflows/ci-lint.yaml:23
TITLE_RE = re.compile(
    r"^(?:\[redhat-\d+\.\d+\] )?(?:PROJQUAY-\d+|QUAYIO-\d+|NO-ISSUE): "
    r"([a-z]+)(?:\(([^)]+)\))?: .+$"
)

EXCLUDED_PREFIXES = (".github/", "docs/", "agent_docs/")

# Kept in sync by hand with the marker literal in backport-nudge.yaml, which
# is the one production actually checks; this copy only backs the tests below.
MARKER = "<!-- backport-nudge -->"


def _is_notable(path):
    if path.startswith(EXCLUDED_PREFIXES):
        return False
    if path.endswith(".md"):
        return False
    return True


def decide(title, files, base_ref="master", state="open"):
    # The workflow_run trigger cannot filter on base ref or PR state the way
    # a direct pull_request_target trigger could, so it is checked here.
    if state != "open":
        return False
    if base_ref != "master":
        return False

    match = TITLE_RE.match(title)
    if not match:
        return False

    change_type, scope = match.group(1), match.group(2)
    if change_type != "fix":
        return False
    if scope == "ci":
        return False

    return any(_is_notable(f) for f in files)


def has_marker_comment(comment_bodies):
    """Idempotence check: does any existing PR comment already carry MARKER?"""
    return any(MARKER in (body or "") for body in comment_bodies)


def comment_action(comment_bodies):
    """Idempotent mutation decision: 'skip' if MARKER is already posted, else 'post'."""
    return "skip" if has_marker_comment(comment_bodies) else "post"


def main():
    title = os.environ.get("PR_TITLE", "")
    files = [f for f in os.environ.get("CHANGED_FILES", "").splitlines() if f]
    base_ref = os.environ.get("PR_BASE_REF", "master")
    state = os.environ.get("PR_STATE", "open")

    nudge = decide(title, files, base_ref, state)

    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as fh:
            fh.write(f"nudge={'true' if nudge else 'false'}\n")
    else:
        print(f"nudge={'true' if nudge else 'false'}")


if __name__ == "__main__":
    sys.exit(main())
