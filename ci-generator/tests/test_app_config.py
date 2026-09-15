"""Branch-owned application config baseline."""

from typing import Any

import yaml
from conftest import master_presubmit_cell as _master_presubmit_cell
from conftest import phase0_cell as _phase0_cell
from generate import GENERATOR_DIR, build_config, load_yaml

CONFIG_PATH = GENERATOR_DIR / "config" / "config.yaml"

INFRASTRUCTURE_OR_SECRET_PREFIXES = (
    "DISTRIBUTED_STORAGE_",
    "USERFILES_",
    "PULL_METRICS_REDIS",
    "BUILDLOGS_REDIS",
    "USER_EVENTS_REDIS",
    "DB_URI",
    "DB_CONNECTION_ARGS",
    "SERVER_HOSTNAME",
    "PREFERRED_URL_SCHEME",
    "EXTERNAL_TLS_TERMINATION",
    "SECURITY_SCANNER",
    "FEATURE_SECURITY_",
    "REPO_MIRROR_INTERVAL",
    "REPO_MIRROR_SERVER_HOSTNAME",
    "REPO_MIRROR_TLS_VERIFY",
    "FEATURE_REPO_MIRROR",
    "MAIL_",
    "FEATURE_MAILING",
    "OTEL_CONFIG",
    "FEATURE_OTEL_TRACING",
    "LOG_ARCHIVE_LOCATION",
    "ACTION_LOG_ARCHIVE_LOCATION",
    "FEATURE_BUILD_SUPPORT",
    "BUILDMAN",
    "SECRET_KEY",
    "DATABASE_SECRET_KEY",
)
SECRET_SUBSTRINGS = ("SECRET", "PASSWORD", "TOKEN")


def _app_config() -> dict[str, Any]:
    return load_yaml(CONFIG_PATH)


def test_app_config_parses_to_mapping() -> None:
    config = _app_config()
    assert isinstance(config, dict)
    assert config


def test_app_config_has_no_infrastructure_or_secret_keys() -> None:
    for key in _app_config():
        assert not key.startswith(INFRASTRUCTURE_OR_SECRET_PREFIXES), key
        assert not any(substring in key for substring in SECRET_SUBSTRINGS), key


def test_presubmit_extra_config_is_disjoint_from_app_config() -> None:
    config = build_config(_master_presubmit_cell(), GENERATOR_DIR / "templates")
    extra_config = yaml.safe_load(config["tests"][0]["steps"]["env"]["QUAY_EXTRA_CONFIG"])
    assert set(extra_config) & set(_app_config()) == set()


def test_presubmit_chain_copies_app_config_before_deploy() -> None:
    presubmit_config = build_config(_master_presubmit_cell(), GENERATOR_DIR / "templates")
    presubmit_refs = [step["ref"] for step in presubmit_config["tests"][0]["steps"]["test"]]
    deploy_index = presubmit_refs.index("quay-deploy-aws-s3")
    assert presubmit_refs[deploy_index - 1] == "quay-copy-app-config"

    periodic_config = build_config(_phase0_cell(), GENERATOR_DIR / "templates")
    periodic_refs = [step["ref"] for step in periodic_config["tests"][0]["steps"]["test"]]
    assert "quay-copy-app-config" not in periodic_refs
