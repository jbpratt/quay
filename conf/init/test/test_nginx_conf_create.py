import os
import shutil

from .. import nginx_conf_create


def render_hosted_http_base_conf(tmp_path, monkeypatch, config):
    os.mkdir(tmp_path / "nginx")
    shutil.copy(
        os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "../../nginx/hosted-http-base.conf.jnj",
        ),
        tmp_path / "nginx",
    )
    monkeypatch.setattr(nginx_conf_create, "QUAYCONF_DIR", str(tmp_path))
    nginx_conf_create.generate_hosted_http_base_config(config)
    return (tmp_path / "nginx/hosted-http-base.conf").read_text()


def _listen_lines(rendered):
    return [line.strip() for line in rendered.splitlines() if line.strip().startswith("listen")]


class TestHostedHttpBaseListen:
    def test_ipv4_by_default(self, tmp_path, monkeypatch):
        rendered = render_hosted_http_base_conf(tmp_path, monkeypatch, None)
        assert _listen_lines(rendered) == ["listen 8080 default_server;"]

    def test_ipv6(self, tmp_path, monkeypatch):
        rendered = render_hosted_http_base_conf(
            tmp_path, monkeypatch, {"FEATURE_LISTEN_IP_VERSION": "IPv6"}
        )
        assert _listen_lines(rendered) == ["listen [::]:8080 default_server;"]

    def test_dual_stack(self, tmp_path, monkeypatch):
        rendered = render_hosted_http_base_conf(
            tmp_path, monkeypatch, {"FEATURE_LISTEN_IP_VERSION": "dual-stack"}
        )
        assert _listen_lines(rendered) == [
            "listen 8080 default_server;",
            "listen [::]:8080 default_server;",
        ]

    def test_dual_stack_with_proxy_protocol(self, tmp_path, monkeypatch):
        rendered = render_hosted_http_base_conf(
            tmp_path,
            monkeypatch,
            {"FEATURE_LISTEN_IP_VERSION": "dual-stack", "FEATURE_PROXY_PROTOCOL": True},
        )
        assert _listen_lines(rendered) == [
            "listen 8080 default_server proxy_protocol;",
            "listen [::]:8080 default_server proxy_protocol;",
        ]
