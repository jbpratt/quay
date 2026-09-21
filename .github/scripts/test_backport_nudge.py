import importlib.util
import os

MODULE_PATH = os.path.join(os.path.dirname(__file__), "backport_nudge.py")
spec = importlib.util.spec_from_file_location("backport_nudge", MODULE_PATH)
backport_nudge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backport_nudge)

decide = backport_nudge.decide
has_marker_comment = backport_nudge.has_marker_comment
comment_action = backport_nudge.comment_action
MARKER = backport_nudge.MARKER


def test_feat_title_is_noop():
    assert decide("NO-ISSUE: feat(ui): add a widget", ["web/src/widget.tsx"]) is False


def test_chore_title_is_noop():
    assert decide("PROJQUAY-1: chore(deps): bump requests", ["requirements.txt"]) is False


def test_fix_ci_scope_is_noop():
    assert decide("NO-ISSUE: fix(ci): retry flaky job", ["data/model/manifest.py"]) is False


def test_fix_with_docs_only_diff_is_noop():
    assert decide("PROJQUAY-2: fix: clarify install steps", ["docs/install.sh"]) is False


def test_fix_with_github_only_diff_is_noop():
    assert (
        decide(
            "PROJQUAY-3: fix: tighten workflow perms",
            [".github/workflows/ci.yaml", ".github/scripts/helper.py"],
        )
        is False
    )


def test_fix_with_agent_docs_only_diff_is_noop():
    assert decide("PROJQUAY-11: fix: correct routing map", ["agent_docs/api.txt"]) is False


def test_fix_with_markdown_file_is_noop():
    assert decide("PROJQUAY-12: fix: correct README", ["README.md"]) is False


def test_fix_web_with_web_paths_nudges():
    assert (
        decide("PROJQUAY-4: fix(web): correct tag list pagination", ["web/src/routes/tags.tsx"])
        is True
    )


def test_bare_fix_with_no_scope_nudges():
    assert (
        decide("PROJQUAY-5: fix: correct manifest digest lookup", ["data/model/manifest.py"])
        is True
    )


def test_redhat_prefixed_title_with_matching_base_ref_is_noop():
    assert (
        decide(
            "[redhat-3.17] PROJQUAY-6: fix: correct manifest digest lookup",
            ["data/model/manifest.py"],
            base_ref="redhat-3.17",
        )
        is False
    )


def test_unparseable_title_is_noop():
    assert decide("bump lxml to 6.1.3", ["data/model/manifest.py"]) is False


def test_mixed_notable_and_non_notable_paths_nudges():
    assert (
        decide(
            "PROJQUAY-7: fix: correct manifest digest lookup",
            ["docs/README.md", "data/model/manifest.py", ".github/workflows/ci.yaml"],
        )
        is True
    )


def test_has_marker_comment_finds_existing_marker():
    comments = ["thanks for the PR!", f"{MARKER}\n**Backport triage**\n\n..."]
    assert has_marker_comment(comments) is True


def test_has_marker_comment_skips_when_absent():
    comments = ["thanks for the PR!", "lgtm"]
    assert has_marker_comment(comments) is False


def test_has_marker_comment_handles_empty_list():
    assert has_marker_comment([]) is False


def test_non_master_base_ref_is_noop():
    assert (
        decide(
            "PROJQUAY-8: fix: correct manifest digest lookup",
            ["data/model/manifest.py"],
            base_ref="redhat-3.18",
        )
        is False
    )


def test_closed_pr_is_noop():
    assert (
        decide(
            "PROJQUAY-9: fix: correct manifest digest lookup",
            ["data/model/manifest.py"],
            state="closed",
        )
        is False
    )


def test_comment_action_skips_when_marker_present():
    comments = ["thanks for the PR!", f"{MARKER}\n**Backport triage**\n\n..."]
    assert comment_action(comments) == "skip"


def test_comment_action_posts_when_marker_absent():
    comments = ["thanks for the PR!", "lgtm"]
    assert comment_action(comments) == "post"


def test_main_writes_nudge_true_to_github_output(monkeypatch, tmp_path):
    output_file = tmp_path / "github_output"
    monkeypatch.setenv("PR_TITLE", "PROJQUAY-10: fix: correct manifest digest lookup")
    monkeypatch.setenv("CHANGED_FILES", "data/model/manifest.py")
    monkeypatch.setenv("PR_BASE_REF", "master")
    monkeypatch.setenv("PR_STATE", "open")
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    backport_nudge.main()
    assert output_file.read_text() == "nudge=true\n"


def test_main_writes_nudge_false_to_github_output(monkeypatch, tmp_path):
    output_file = tmp_path / "github_output"
    monkeypatch.setenv("PR_TITLE", "NO-ISSUE: feat(ui): add a widget")
    monkeypatch.setenv("CHANGED_FILES", "web/src/widget.tsx")
    monkeypatch.delenv("PR_BASE_REF", raising=False)
    monkeypatch.delenv("PR_STATE", raising=False)
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    backport_nudge.main()
    assert output_file.read_text() == "nudge=false\n"
