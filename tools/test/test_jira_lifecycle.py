import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

from tools import jira_lifecycle

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(HERE), "jira_lifecycle.py")
FIXTURE_PATH = os.path.join(HERE, "fixtures", "jira_lifecycle.json")

with open(FIXTURE_PATH) as f:
    FIXTURE = json.load(f)
with open(jira_lifecycle.POLICY_PATH) as f:
    POLICY = json.load(f)

TRUSTED = "fake_maintainer"
UNTRUSTED = "fake_contributor"


def pr_event(
    title,
    action="opened",
    branch="master",
    author=TRUSTED,
    sender=TRUSTED,
    merged=False,
    number=90100,
):
    return {
        "action": action,
        "sender": {"login": sender},
        "pull_request": {
            "number": number,
            "title": title,
            "merged": merged,
            "base": {"ref": branch},
            "user": {"login": author},
        },
    }


def comment_event(
    body,
    commenter=TRUSTED,
    title="PROJQUAY-90001: fix(api): x",
    state="open",
    number=90001,
    sender=None,
):
    return {
        "action": "created",
        "sender": {"login": sender or commenter},
        "issue": {
            "number": number,
            "title": title,
            "state": state,
            "pull_request": {"url": "https://api.github.com/repos/quay/quay/pulls/90001"},
        },
        "comment": {"body": body, "user": {"login": commenter}},
    }


def run_pr(*args, **kwargs):
    return jira_lifecycle.plan(
        "pull_request_target",
        pr_event(*args, **kwargs),
        jira_lifecycle.FixtureSource(FIXTURE),
        POLICY,
    )


def run_comment(*args, **kwargs):
    return jira_lifecycle.plan(
        "issue_comment",
        comment_event(*args, **kwargs),
        jira_lifecycle.FixtureSource(FIXTURE),
        POLICY,
    )


class TestValidation(unittest.TestCase):
    def test_valid_master_title_and_version(self):
        plan = run_pr("PROJQUAY-90001: fix(api): handle empty list")
        self.assertEqual(plan["result"], "valid")
        self.assertEqual(plan["key"], "PROJQUAY-90001")
        self.assertEqual(plan["transition"], {"id": "31", "to": "POST"})
        self.assertTrue(plan["dry_run"])
        self.assertTrue(plan["shadow"])

    def test_release_prefix_and_version(self):
        plan = run_pr("[redhat-3.18] PROJQUAY-90003: fix(ui): sort tags", branch="redhat-3.18")
        self.assertEqual(plan["result"], "valid")
        self.assertEqual(plan["key"], "PROJQUAY-90003")
        self.assertEqual(plan["transition"], {"id": "31", "to": "POST"})

    def test_no_issue_and_quayio_skipped(self):
        for title in ("NO-ISSUE: docs(agents): x", "QUAYIO-123: feat(auth): x"):
            plan = run_pr(title)
            self.assertEqual(plan["result"], "skipped", title)
            self.assertIsNone(plan["transition"])

    def test_invalid_key(self):
        for title in ("projquay-90001: fix: x", "PROJQUAY-: fix: x", "OCPBUGS-1: fix: x"):
            plan = run_pr(title)
            self.assertEqual(plan["result"], "invalid", title)
            self.assertIsNone(plan["key"])

    def test_missing_closed_and_restricted_issue(self):
        for key in ("PROJQUAY-1", "PROJQUAY-90004", "PROJQUAY-90006"):
            plan = run_pr(f"{key}: fix: x")
            self.assertEqual(plan["result"], "invalid", key)
            self.assertIsNone(plan["transition"])

    def test_restricted_fields_not_in_output(self):
        plan = run_pr("PROJQUAY-90006: fix: x")
        text = json.dumps(plan)
        self.assertNotIn("FAKE-RESTRICTED-SUMMARY", text)
        self.assertNotIn("ASSIGNED", text)
        self.assertEqual(plan["reasons"], ["PROJQUAY-90006 was not found or is not accessible"])

    def test_wrong_target_version(self):
        plan = run_pr("PROJQUAY-90003: fix: x", branch="master")
        self.assertEqual(plan["result"], "invalid")
        self.assertIn("Target Version is quay-v3.18.z, expected quay-v5.1.0", plan["reasons"])

    def test_multiple_target_versions(self):
        plan = run_pr("PROJQUAY-90005: fix: x")
        self.assertEqual(plan["result"], "invalid")
        self.assertIsNone(plan["transition"])

    def test_unknown_branch_is_guidance(self):
        plan = run_pr("PROJQUAY-90001: fix: x", branch="redhat-3.9")
        self.assertEqual(plan["result"], "guidance")
        self.assertIsNone(plan["transition"])

    def test_unknown_base_branch_is_guidance(self):
        plan = run_comment("/jira refresh", number=90002)
        self.assertEqual(plan["result"], "guidance")
        self.assertIn("no Target Version is configured: base branch unknown", plan["reasons"])


class TestTransitions(unittest.TestCase):
    def test_untrusted_opened_validates_without_transition(self):
        plan = run_pr("PROJQUAY-90001: fix: x", sender=UNTRUSTED)
        self.assertEqual(plan["result"], "valid")
        self.assertIsNone(plan["transition"])

    def test_untrusted_sender_on_trusted_author_pr_no_transition(self):
        plan = run_pr("PROJQUAY-90001: fix: x", author=TRUSTED, sender=UNTRUSTED)
        self.assertEqual(plan["result"], "valid")
        self.assertIsNone(plan["transition"])
        self.assertIn(f"{UNTRUSTED} is not trusted, so no transition is planned", plan["reasons"])

    def test_trusted_sender_merges_untrusted_author_pr(self):
        plan = run_pr(
            "PROJQUAY-90002: fix: x",
            action="closed",
            merged=True,
            author=UNTRUSTED,
            sender=TRUSTED,
        )
        self.assertEqual(plan["result"], "valid")
        self.assertEqual(plan["transition"], {"id": "41", "to": "MODIFIED"})

    def test_trusted_merged_all_linked_merged(self):
        plan = run_pr("PROJQUAY-90002: fix: x", action="closed", merged=True)
        self.assertEqual(plan["result"], "valid")
        self.assertEqual(plan["transition"], {"id": "41", "to": "MODIFIED"})

    def test_merged_with_other_linked_pr_open(self):
        plan = run_pr("PROJQUAY-90007: fix: x", action="closed", merged=True)
        self.assertEqual(plan["result"], "valid")
        self.assertIsNone(plan["transition"])
        self.assertIn("another linked PR is not merged", plan["reasons"])

    def test_transition_chosen_by_destination_name(self):
        plan = run_pr("PROJQUAY-90008: fix: x")
        self.assertEqual(plan["result"], "valid")
        self.assertEqual(plan["transition"], {"id": "31", "to": "POST"})

    def test_no_transition_to_target(self):
        plan = run_pr("PROJQUAY-90009: fix: x")
        self.assertEqual(plan["result"], "valid")
        self.assertIsNone(plan["transition"])
        self.assertIn("no transition to POST from NEW", plan["reasons"])

    def test_unmerged_close_plans_new(self):
        plan = run_pr("PROJQUAY-90010: fix: x", action="closed", merged=False)
        self.assertEqual(plan["result"], "valid")
        self.assertEqual(plan["transition"], {"id": "51", "to": "NEW"})

    def test_unmerged_close_with_other_linked_pr_open(self):
        plan = run_pr("PROJQUAY-90007: fix: x", action="closed", merged=False)
        self.assertIsNone(plan["transition"])
        self.assertIn("another linked PR is still open", plan["reasons"])

    def test_unmerged_close_without_projquay_key_ignored(self):
        for title in ("NO-ISSUE: x", "QUAYIO-123: x"):
            plan = run_pr(title, action="closed", merged=False)
            self.assertEqual(plan["result"], "ignored", title)
            self.assertIsNone(plan["transition"])


class TestRefresh(unittest.TestCase):
    def test_trusted_refresh_repeats_post_plan(self):
        plan = run_comment("Target Version fixed.\n/jira refresh\n")
        self.assertEqual(plan["result"], "valid")
        self.assertEqual(plan["transition"], {"id": "31", "to": "POST"})

    def test_untrusted_refresh_ignored(self):
        plan = run_comment("/jira refresh", commenter=UNTRUSTED)
        self.assertEqual(plan["result"], "ignored")
        self.assertIsNone(plan["transition"])

    def test_other_comments_ignored(self):
        for body in ("lgtm", "please /jira refresh", "/jira refreshes", "`/jira refresh`"):
            plan = run_comment(body)
            self.assertEqual(plan["result"], "ignored", body)

    def test_refresh_on_closed_pr_ignored(self):
        plan = run_comment("/jira refresh", state="closed")
        self.assertEqual(plan["result"], "ignored")


class TestInertInput(unittest.TestCase):
    MALICIOUS = "$(touch pwned) `touch pwned` ${{ github.token }}\n/jira refresh\n'; touch pwned #"

    def run_cli(self, event, payload, cwd):
        payload_path = os.path.join(cwd, "event.json")
        with open(payload_path, "w") as f:
            json.dump(payload, f)
        proc = subprocess.run(
            [
                sys.executable,
                SCRIPT,
                "--event",
                event,
                "--payload",
                payload_path,
                "--source",
                f"fixture:{FIXTURE_PATH}",
                "--dry-run",
            ],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True,
        )
        return proc.stdout

    def test_malicious_title_and_comment_stay_data(self):
        with tempfile.TemporaryDirectory() as cwd:
            out = self.run_cli(
                "pull_request_target", pr_event("PROJQUAY-90001: fix: " + self.MALICIOUS), cwd
            )
            self.assertEqual(json.loads(out)["result"], "valid")
            out = self.run_cli(
                "issue_comment",
                comment_event(self.MALICIOUS, title="NO-ISSUE: x " + self.MALICIOUS),
                cwd,
            )
            self.assertEqual(json.loads(out)["result"], "skipped")
            self.assertFalse(os.path.exists(os.path.join(cwd, "pwned")))
            self.assertNotIn("touch", out)

    def test_newline_in_title_does_not_inject_key(self):
        plan = run_pr("bad title\nPROJQUAY-90001: fix: x")
        self.assertEqual(plan["result"], "invalid")
        self.assertIsNone(plan["key"])

    def test_repeated_delivery_identical(self):
        with tempfile.TemporaryDirectory() as cwd:
            payload = pr_event("PROJQUAY-90002: fix: x", action="closed", merged=True)
            first = self.run_cli("pull_request_target", payload, cwd)
            second = self.run_cli("pull_request_target", payload, cwd)
        self.assertEqual(first, second)

    def test_requires_dry_run(self):
        with self.assertRaises(SystemExit):
            jira_lifecycle.main(
                [
                    "--event",
                    "issue_comment",
                    "--payload",
                    FIXTURE_PATH,
                    "--source",
                    f"fixture:{FIXTURE_PATH}",
                ]
            )


class TestPolicy(unittest.TestCase):
    def test_target_versions_mirror_plugin_config(self):
        expected = {"master": "quay-v5.1.0", "redhat-5.0": "quay-v5.0.z"}
        expected.update({f"redhat-3.{n}": f"quay-v3.{n}.z" for n in range(10, 19)})
        self.assertEqual(POLICY["target_versions"], expected)


GITHUB = "https://api.github.com/repos/quay/quay"
JIRA = "https://redhat.atlassian.net/rest/api/3/issue"
SECRETS = ("fake-github-token", "fake@example.com", "fake-jira-token")


class FakeAPI:
    def __init__(self, routes):
        self.routes = routes
        self.requests = []

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        if request.full_url not in self.routes:
            # LiveSource catches KeyError, so a missing route would pass as fail-closed.
            raise AssertionError(f"unexpected request {request.full_url}")
        body = self.routes[request.full_url]
        if isinstance(body, int):
            raise urllib.error.HTTPError(request.full_url, body, "error", {}, None)
        return io.BytesIO(json.dumps(body).encode())


def permission(user, level):
    return {f"{GITHUB}/collaborators/{user}/permission": {"permission": level, "role_name": level}}


def pull(number, title, base="master", state="open", merged=False, repo=GITHUB):
    return {
        f"{repo}/pulls/{number}": {
            "title": title,
            "base": {"ref": base},
            "state": state,
            "merged": merged,
        }
    }


def jira_issue(key, status="ASSIGNED", version="quay-v5.1.0", security=None, to="POST"):
    fields = {
        "status": {"name": status},
        "summary": "FAKE-LIVE-SUMMARY",
        "customfield_10855": [{"name": version, "id": "99"}],
    }
    if security:
        fields["security"] = {"name": security, "id": "77"}
    return {
        f"{JIRA}/{key}?fields=status,security,customfield_10855": {"key": key, "fields": fields},
        f"{JIRA}/{key}/transitions": {
            "transitions": [{"id": "61", "name": "Move", "to": {"name": to, "id": "5"}}]
        },
    }


def remote_links(key, *urls):
    return {f"{JIRA}/{key}/remotelink": [{"object": {"url": url}} for url in urls]}


class TestLiveSource(unittest.TestCase):
    def run_live(self, event, payload, *routes):
        api = FakeAPI({k: v for route in routes for k, v in route.items()})
        source = jira_lifecycle.LiveSource("quay/quay", *SECRETS)
        with mock.patch("urllib.request.urlopen", api):
            plan = jira_lifecycle.plan(event, payload, source, POLICY)
        self.assertTrue(api.requests)
        self.assertEqual({r.get_method() for r in api.requests}, {"GET"})
        text = json.dumps(plan)
        for secret in SECRETS:
            self.assertNotIn(secret, text)
        return plan

    def opened(self, *routes, sender=TRUSTED, title="PROJQUAY-90001: fix: x"):
        return self.run_live(
            "pull_request_target",
            pr_event(title, sender=sender, number=7),
            pull(7, title),
            *routes,
        )

    def test_write_permission_plans_transition(self):
        plan = self.opened(jira_issue("PROJQUAY-90001"), permission(TRUSTED, "write"))
        self.assertEqual(plan["result"], "valid")
        self.assertEqual(plan["transition"], {"id": "61", "to": "POST"})

    def test_read_permission_no_transition(self):
        plan = self.opened(
            jira_issue("PROJQUAY-90001"), permission(UNTRUSTED, "read"), sender=UNTRUSTED
        )
        self.assertIsNone(plan["transition"])
        self.assertIn(f"{UNTRUSTED} is not trusted, so no transition is planned", plan["reasons"])

    def test_permission_api_error_fails_closed(self):
        plan = self.opened(
            jira_issue("PROJQUAY-90001"), {f"{GITHUB}/collaborators/{TRUSTED}/permission": 500}
        )
        self.assertIsNone(plan["transition"])
        self.assertIn("permission check failed", plan["reasons"])

    def test_jira_not_found_and_disallowed_security_level_are_generic(self):
        key = "PROJQUAY-90001"
        not_found = {f"{JIRA}/{key}?fields=status,security,customfield_10855": 404}
        embargoed = jira_issue(key, security="FAKE-EMBARGOED-LEVEL")
        for routes in (not_found, embargoed):
            plan = self.opened(routes)
            self.assertEqual(plan["result"], "invalid")
            self.assertIsNone(plan["transition"])
            self.assertEqual(plan["reasons"], [f"{key} was not found or is not accessible"])
            text = json.dumps(plan)
            for leaked in ("FAKE-EMBARGOED-LEVEL", "FAKE-LIVE-SUMMARY", "ASSIGNED", "quay-v5.1.0"):
                self.assertNotIn(leaked, text)

    def test_jira_auth_failure_fails_the_run(self):
        unauthorized = {f"{JIRA}/PROJQUAY-90001?fields=status,security,customfield_10855": 401}
        with self.assertRaises(urllib.error.HTTPError):
            self.opened(unauthorized)

    def test_refresh_uses_refetched_base_branch(self):
        title = "[redhat-3.18] PROJQUAY-90003: fix: x"
        plan = self.run_live(
            "issue_comment",
            comment_event("/jira refresh", title="NO-ISSUE: stale title", number=7),
            pull(7, title, base="redhat-3.18"),
            permission(TRUSTED, "admin"),
            jira_issue("PROJQUAY-90003", version="quay-v3.18.z"),
        )
        self.assertEqual(plan["branch"], "redhat-3.18")
        self.assertEqual(plan["key"], "PROJQUAY-90003")
        self.assertEqual(plan["transition"], {"id": "61", "to": "POST"})

    def closed(self, key, merged, *routes):
        title = f"{key}: fix: x"
        return self.run_live(
            "pull_request_target",
            pr_event(title, action="closed", merged=merged, number=7),
            pull(7, title, state="closed", merged=merged),
            permission(TRUSTED, "write"),
            *routes,
        )

    def test_merged_close_with_other_linked_pr_open(self):
        key = "PROJQUAY-90002"
        plan = self.closed(
            key,
            True,
            jira_issue(key, status="POST", to="MODIFIED"),
            remote_links(
                key,
                "https://github.com/quay/quay/pull/7",
                "https://github.com/quay/quay-operator/pull/8",
                "https://redhat.atlassian.net/browse/PROJQUAY-1",
            ),
            pull(8, "x", repo="https://api.github.com/repos/quay/quay-operator"),
        )
        self.assertIsNone(plan["transition"])
        self.assertIn("another linked PR is not merged", plan["reasons"])

    def test_merged_close_with_unreadable_linked_pr(self):
        key = "PROJQUAY-90002"
        plan = self.closed(
            key,
            True,
            jira_issue(key, status="POST", to="MODIFIED"),
            remote_links(key, "https://github.com/quay/quay/pull/9"),
            {f"{GITHUB}/pulls/9": 404},
        )
        self.assertIsNone(plan["transition"])
        self.assertIn("another linked PR is not merged", plan["reasons"])

    def test_unmerged_close_plans_new(self):
        key = "PROJQUAY-90010"
        plan = self.closed(
            key,
            False,
            jira_issue(key, status="POST", to="NEW"),
            remote_links(key, "https://github.com/quay/quay/pull/7"),
        )
        self.assertEqual(plan["result"], "valid")
        self.assertEqual(plan["transition"], {"id": "61", "to": "NEW"})
