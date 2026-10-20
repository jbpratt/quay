import json
import os
import subprocess
import sys
import tempfile
import unittest

from tools import jira_lifecycle

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "jira_lifecycle.py")
FIXTURE_PATH = os.path.join(HERE, "fixtures", "jira_lifecycle.json")

with open(FIXTURE_PATH) as f:
    FIXTURE = json.load(f)

TRUSTED = "fake_maintainer"
UNTRUSTED = "fake_contributor"


def pr_event(title, action="opened", branch="master", author=TRUSTED, merged=False):
    return {
        "action": action,
        "pull_request": {
            "number": 90001,
            "title": title,
            "merged": merged,
            "base": {"ref": branch},
            "user": {"login": author},
        },
    }


def comment_event(
    body, commenter=TRUSTED, title="PROJQUAY-90001: fix(api): x", state="open", number=90001
):
    return {
        "action": "created",
        "issue": {
            "number": number,
            "title": title,
            "state": state,
            "pull_request": {"url": "https://api.github.com/repos/quay/quay/pulls/90001"},
        },
        "comment": {"body": body, "user": {"login": commenter}},
    }


def run_pr(*args, **kwargs):
    return jira_lifecycle.plan("pull_request_target", pr_event(*args, **kwargs), FIXTURE)


def run_comment(*args, **kwargs):
    return jira_lifecycle.plan("issue_comment", comment_event(*args, **kwargs), FIXTURE)


class TestValidation(unittest.TestCase):
    def test_valid_master_title_and_version(self):
        plan = run_pr("PROJQUAY-90001: fix(api): handle empty list")
        self.assertEqual(plan["result"], "valid")
        self.assertEqual(plan["key"], "PROJQUAY-90001")
        self.assertEqual(plan["transition"], {"id": "31", "to": "POST"})
        self.assertTrue(plan["dry_run"])

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
        self.assertIn("Target Version is quay-v3.18.z, expected quay-v5.0.0", plan["reasons"])

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
        plan = run_pr("PROJQUAY-90001: fix: x", author=UNTRUSTED)
        self.assertEqual(plan["result"], "valid")
        self.assertIsNone(plan["transition"])

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

    def test_unmerged_close_ignored(self):
        plan = run_pr("PROJQUAY-90002: fix: x", action="closed", merged=False)
        self.assertEqual(plan["result"], "ignored")
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
                "--jira-fixture",
                FIXTURE_PATH,
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
                    "--jira-fixture",
                    FIXTURE_PATH,
                ]
            )
