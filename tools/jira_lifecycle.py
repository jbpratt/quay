#!/usr/bin/env python3
"""
Dry-run planner for a GitHub Actions replacement of the Prow jira-lifecycle-plugin.

Reads a GitHub event payload and a Jira fixture and prints a JSON plan. It never
calls Jira or GitHub and never writes anywhere.
"""

import argparse
import json
import re
import sys

TITLE_RE = re.compile(
    r"^(?:\[(?:redhat|mirror-registry)-[0-9]+\.[0-9]+\] )?(PROJQUAY-[0-9]+|QUAYIO-[0-9]+|NO-ISSUE): ",
    re.ASCII,
)
REFRESH_RE = re.compile(r"^/jira refresh[ \t]*\r?$", re.MULTILINE)
TARGET_VERSION_FIELD = "customfield_10855"
VALIDATE_ACTIONS = {"opened", "edited", "reopened"}


def _ignored(reason):
    return {"result": "ignored", "reasons": [reason], "transition": None}


def _evaluate(title, branch, actor, target, fixture, require_all_merged=False):
    out = {"actor": actor, "branch": branch, "key": None, "transition": None}
    match = TITLE_RE.match(title)
    if not match:
        return {
            **out,
            "result": "invalid",
            "reasons": ["title has no PROJQUAY, QUAYIO or NO-ISSUE key"],
        }
    key = match.group(1)
    out["key"] = key
    if not key.startswith("PROJQUAY-"):
        return {
            **out,
            "result": "skipped",
            "reasons": [f"{key} is not handled by PROJQUAY automation"],
        }

    issue = fixture["issues"].get(key)
    if issue is None or issue.get("restricted"):
        # One reason for both, so a restricted issue's existence and fields stay private.
        return {
            **out,
            "result": "invalid",
            "reasons": [f"{key} was not found or is not accessible"],
        }

    reasons = []
    if issue["status"] not in fixture["valid_states"]:
        reasons.append(
            f"status {issue['status']} is not one of {', '.join(fixture['valid_states'])}"
        )
    expected = fixture["target_versions"].get(branch)
    if expected is None:
        if branch is None:
            reasons.append("no Target Version is configured: base branch unknown")
        else:
            reasons.append(f"no Target Version is configured for branch {branch}")
        return {**out, "result": "guidance", "reasons": reasons}
    versions = issue["fields"].get(TARGET_VERSION_FIELD) or []
    if versions != [expected]:
        reasons.append(f"Target Version is {', '.join(versions) or 'unset'}, expected {expected}")
    if reasons:
        return {**out, "result": "invalid", "reasons": reasons}

    # The fixture's trusted_users stands in for the live collaborator-permission API
    # (GET /repos/{owner}/{repo}/collaborators/{user}/permission, write or admin).
    if actor not in fixture["trusted_users"]:
        reasons.append(f"{actor} is not trusted, so no transition is planned")
    elif require_all_merged and not issue.get("all_linked_prs_merged"):
        reasons.append("another linked PR is not merged")
    else:
        transition = next((t for t in issue["transitions"] if t["to"] == target), None)
        if transition is None:
            reasons.append(f"no transition to {target} from {issue['status']}")
        out["transition"] = transition
    return {**out, "result": "valid", "reasons": reasons}


def _plan_pull_request(payload, fixture):
    pr = payload["pull_request"]
    action = payload.get("action")
    out = {"action": action, "pr": pr["number"]}
    if action == "closed":
        if not pr.get("merged"):
            return {**out, **_ignored("closed without merge")}
        target = "MODIFIED"
    elif action in VALIDATE_ACTIONS:
        target = "POST"
    else:
        return {**out, **_ignored(f"action {action} is not handled")}
    return {
        **out,
        **_evaluate(
            pr["title"],
            pr["base"]["ref"],
            payload["sender"]["login"],
            target,
            fixture,
            require_all_merged=action == "closed",
        ),
    }


def _plan_comment(payload, fixture):
    issue = payload["issue"]
    out = {"action": payload.get("action"), "pr": issue["number"]}
    if "pull_request" not in issue:
        return {**out, **_ignored("comment is not on a PR")}
    if not REFRESH_RE.search(payload["comment"]["body"]):
        return {**out, **_ignored("no /jira refresh command")}
    if issue["state"] != "open":
        return {**out, **_ignored("PR is not open")}
    actor = payload["comment"]["user"]["login"]
    if actor not in fixture["trusted_users"]:
        return {**out, **_ignored(f"{actor} is not trusted to run /jira refresh")}
    # issue_comment payloads carry no base branch; the fixture's pulls map stands in
    # for GET /repos/{owner}/{repo}/pulls/{number}.
    branch = fixture["pulls"].get(str(issue["number"]), {}).get("base")
    return {**out, **_evaluate(issue["title"], branch, actor, "POST", fixture)}


def plan(event, payload, fixture):
    if event == "pull_request_target":
        result = _plan_pull_request(payload, fixture)
    elif event == "issue_comment":
        result = _plan_comment(payload, fixture)
    else:
        result = _ignored(f"event {event} is not handled")
    return {**result, "dry_run": True, "event": event}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", required=True)
    parser.add_argument("--payload", required=True)
    parser.add_argument("--jira-fixture", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if not args.dry_run:
        parser.error("only --dry-run is supported")

    with open(args.payload) as f:
        payload = json.load(f)
    with open(args.jira_fixture) as f:
        fixture = json.load(f)
    json.dump(plan(args.event, payload, fixture), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
