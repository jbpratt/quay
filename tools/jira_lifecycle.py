#!/usr/bin/env python3
"""
Shadow-mode planner for a GitHub Actions replacement of the Prow jira-lifecycle-plugin.

Reads a GitHub event payload, looks the PR and its Jira issue up through a source
(a JSON fixture, or live GitHub and Jira GET requests), and prints a JSON plan.
It never writes to Jira or GitHub.
"""

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

TITLE_RE = re.compile(
    r"^(?:\[(?:redhat|mirror-registry)-[0-9]+\.[0-9]+\] )?(PROJQUAY-[0-9]+|QUAYIO-[0-9]+|NO-ISSUE): ",
    re.ASCII,
)
REFRESH_RE = re.compile(r"^/jira refresh[ \t]*\r?$", re.MULTILINE)
PR_URL_RE = re.compile(r"^https://github\.com/([\w.-]+/[\w.-]+)/pull/([0-9]+)", re.ASCII)
TARGET_VERSION_FIELD = "customfield_10855"
VALIDATE_ACTIONS = {"opened", "edited", "reopened"}
POLICY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "jira_lifecycle_policy.json")
GITHUB_API = "https://api.github.com"
JIRA_URL = "https://redhat.atlassian.net"


class PermissionCheckFailed(Exception):
    pass


class FixtureSource:
    """Serves PRs, issues and trusted users from a JSON fixture."""

    def __init__(self, fixture):
        self.fixture = fixture

    def is_trusted(self, user):
        return user in self.fixture["trusted_users"]

    def pull(self, number):
        return self.fixture["pulls"].get(str(number), {})

    def issue(self, key):
        return self.fixture["issues"].get(key)

    def other_linked_prs(self, key, number):
        prs = self.fixture["issues"][key].get("linked_prs", [])
        return [pr for pr in prs if pr["number"] != number]


def _get(url, headers):
    request = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


class LiveSource:
    """Reads from the GitHub REST API and Jira Cloud REST v3 with GET requests only."""

    def __init__(self, repo, github_token, jira_email, jira_token):
        self.repo = repo
        self._github = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {github_token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        basic = base64.b64encode(f"{jira_email}:{jira_token}".encode()).decode()
        self._jira = {"Accept": "application/json", "Authorization": f"Basic {basic}"}

    def is_trusted(self, user):
        user = urllib.parse.quote(user, safe="")
        try:
            perm = _get(
                f"{GITHUB_API}/repos/{self.repo}/collaborators/{user}/permission", self._github
            )
            return perm["permission"] in ("admin", "write") or perm.get("role_name") == "maintain"
        except (OSError, ValueError, KeyError, TypeError) as e:
            raise PermissionCheckFailed from e

    def _pull(self, repo, number):
        return _get(f"{GITHUB_API}/repos/{repo}/pulls/{number}", self._github)

    def pull(self, number):
        pr = self._pull(self.repo, number)
        return {
            "title": pr["title"],
            "base": pr["base"]["ref"],
            "state": pr["state"],
            "merged": pr["merged"],
        }

    def issue(self, key):
        url = f"{JIRA_URL}/rest/api/3/issue/{key}"
        try:
            fields = _get(f"{url}?fields=status,security,{TARGET_VERSION_FIELD}", self._jira)[
                "fields"
            ]
            transitions = _get(f"{url}/transitions", self._jira)["transitions"]
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return None
            raise
        return {
            "status": fields["status"]["name"],
            "security": (fields.get("security") or {}).get("name", "default"),
            "target_versions": [v["name"] for v in fields.get(TARGET_VERSION_FIELD) or []],
            "transitions": [{"id": t["id"], "to": t["to"]["name"]} for t in transitions],
        }

    def other_linked_prs(self, key, number):
        links = _get(f"{JIRA_URL}/rest/api/3/issue/{key}/remotelink", self._jira)
        prs = []
        for link in links:
            match = PR_URL_RE.match(link.get("object", {}).get("url", ""))
            if not match:
                continue
            repo, linked = match.group(1), int(match.group(2))
            if repo.lower() == self.repo.lower() and linked == number:
                continue
            try:
                pr = self._pull(repo, linked)
                prs.append(
                    {"number": linked, "open": pr["state"] == "open", "merged": pr["merged"]}
                )
            except (OSError, ValueError, KeyError, TypeError):
                # An unreadable PR blocks both MODIFIED and NEW.
                prs.append({"number": linked, "open": True, "merged": False})
        return prs


def _ignored(reason):
    return {"result": "ignored", "reasons": [reason], "transition": None}


def _untrusted_reason(source, actor, reason):
    try:
        return None if source.is_trusted(actor) else reason
    except PermissionCheckFailed:
        return "permission check failed"


def _evaluate(pr, number, actor, target, source, policy, linked=None):
    branch = pr.get("base")
    out = {"actor": actor, "branch": branch, "key": None, "transition": None}
    match = TITLE_RE.match(pr["title"])
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

    issue = source.issue(key)
    if issue is None or issue.get("security", "default") not in policy["allowed_security_levels"]:
        # One reason for both, so a restricted issue's existence and fields stay private.
        return {
            **out,
            "result": "invalid",
            "reasons": [f"{key} was not found or is not accessible"],
        }

    reasons = []
    if issue["status"] not in policy["valid_states"]:
        reasons.append(
            f"status {issue['status']} is not one of {', '.join(policy['valid_states'])}"
        )
    expected = policy["target_versions"].get(branch)
    if expected is None:
        if branch is None:
            reasons.append("no Target Version is configured: base branch unknown")
        else:
            reasons.append(f"no Target Version is configured for branch {branch}")
        return {**out, "result": "guidance", "reasons": reasons}
    versions = issue["target_versions"]
    if versions != [expected]:
        reasons.append(f"Target Version is {', '.join(versions) or 'unset'}, expected {expected}")
    if reasons:
        return {**out, "result": "invalid", "reasons": reasons}

    untrusted = _untrusted_reason(
        source, actor, f"{actor} is not trusted, so no transition is planned"
    )
    if untrusted:
        reasons.append(untrusted)
    elif linked == "merged" and not all(p["merged"] for p in source.other_linked_prs(key, number)):
        reasons.append("another linked PR is not merged")
    elif linked == "open" and any(p["open"] for p in source.other_linked_prs(key, number)):
        reasons.append("another linked PR is still open")
    else:
        transition = next((t for t in issue["transitions"] if t["to"] == target), None)
        if transition is None:
            reasons.append(f"no transition to {target} from {issue['status']}")
        out["transition"] = transition
    return {**out, "result": "valid", "reasons": reasons}


def _plan_pull_request(payload, source, policy):
    event_pr = payload["pull_request"]
    number = event_pr["number"]
    action = payload.get("action")
    out = {"action": action, "pr": number}
    if action != "closed" and action not in VALIDATE_ACTIONS:
        return {**out, **_ignored(f"action {action} is not handled")}
    # The event is only a trigger: the source's view of the PR wins.
    pr = {
        "title": event_pr["title"],
        "base": event_pr["base"]["ref"],
        "merged": event_pr.get("merged"),
        **source.pull(number),
    }
    linked = None
    if action == "closed" and pr["merged"]:
        target, linked = policy["state_after_merge"], "merged"
    elif action == "closed":
        match = TITLE_RE.match(pr["title"])
        if not match or not match.group(1).startswith("PROJQUAY-"):
            return {**out, **_ignored("closed without merge")}
        target, linked = policy["state_after_close"], "open"
    else:
        target = policy["state_after_validation"]
    actor = payload["sender"]["login"]
    return {**out, **_evaluate(pr, number, actor, target, source, policy, linked)}


def _plan_comment(payload, source, policy):
    issue = payload["issue"]
    number = issue["number"]
    out = {"action": payload.get("action"), "pr": number}
    if "pull_request" not in issue:
        return {**out, **_ignored("comment is not on a PR")}
    if not REFRESH_RE.search(payload["comment"]["body"]):
        return {**out, **_ignored("no /jira refresh command")}
    # issue_comment payloads carry no base branch; the source supplies it.
    pr = {"title": issue["title"], "state": issue["state"], **source.pull(number)}
    if pr["state"] != "open":
        return {**out, **_ignored("PR is not open")}
    actor = payload["comment"]["user"]["login"]
    untrusted = _untrusted_reason(source, actor, f"{actor} is not trusted to run /jira refresh")
    if untrusted:
        return {**out, **_ignored(untrusted)}
    target = policy["state_after_validation"]
    return {**out, **_evaluate(pr, number, actor, target, source, policy)}


def plan(event, payload, source, policy):
    if event == "pull_request_target":
        result = _plan_pull_request(payload, source, policy)
    elif event == "issue_comment":
        result = _plan_comment(payload, source, policy)
    else:
        result = _ignored(f"event {event} is not handled")
    return {**result, "dry_run": True, "event": event, "shadow": True}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", required=True)
    parser.add_argument("--payload", required=True)
    parser.add_argument("--source", required=True, help="fixture:<path> or live")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if not args.dry_run:
        parser.error("only --dry-run is supported")

    if args.source == "live":
        source = LiveSource(
            os.environ["GITHUB_REPOSITORY"],
            os.environ["GITHUB_TOKEN"],
            os.environ["JIRA_EMAIL"],
            os.environ["JIRA_API_TOKEN"],
        )
    elif args.source.startswith("fixture:"):
        with open(args.source.removeprefix("fixture:")) as f:
            source = FixtureSource(json.load(f))
    else:
        parser.error("--source must be fixture:<path> or live")

    with open(args.payload) as f:
        payload = json.load(f)
    with open(POLICY_PATH) as f:
        policy = json.load(f)
    json.dump(plan(args.event, payload, source, policy), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
