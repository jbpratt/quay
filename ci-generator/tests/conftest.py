"""Shared Cell builders for periodic and master-presubmit test cells."""

from typing import Any

from model import Cell


def phase0_cell(**kwargs: Any) -> Cell:
    values: dict[str, Any] = {
        "org": "quay",
        "repo": "quay",
        "branch": "redhat-3.18",
        "quay_version": "3.18",
        "ocp_version": "4.22",
        "cloud": "aws",
        "test": "e2e-install",
        "tier": "daily",
        "source": "nightly",
    }
    values.update(kwargs)
    return Cell(**values)


def master_presubmit_cell(**kwargs: Any) -> Cell:
    return phase0_cell(
        branch="master",
        quay_version=None,
        kind="presubmit",
        tier=None,
        source=None,
        always_run=False,
        optional=True,
        **kwargs,
    )
