"""
OpenShift OAuth service for Quay.

Implements OpenShift OAuth 2.0 integration, which differs from standard OIDC:
- Uses RFC 8414 OAuth 2.0 Authorization Server Metadata discovery
- No standard /userinfo endpoint - uses OpenShift User API instead
- Groups are fetched from OpenShift API, not token claims
"""

import json
import logging
import os
from posixpath import join
from typing import Optional

from oauth.base import OAuthGetUserInfoException
from oauth.login import OAuthLoginException
from oauth.login_utils import (
    get_sub_username_email_from_token,
    get_username_from_userinfo,
)
from oauth.oidc import DiscoveryFailureException, OIDCLoginService

logger = logging.getLogger(__name__)

# OpenShift uses RFC 8414 OAuth 2.0 Authorization Server Metadata
OAUTH_AUTHORIZATION_SERVER_WELLKNOWN = ".well-known/oauth-authorization-server"

# Default path for in-cluster service account token
DEFAULT_SA_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"


class OpenShiftOAuthService(OIDCLoginService):
    """
    OpenShift OAuth service with non-standard userinfo handling.

    OpenShift OAuth is OAuth 2.0 compliant but not full OIDC:
    - Discovery uses /.well-known/oauth-authorization-server (RFC 8414)
    - No /userinfo endpoint - must use /apis/user.openshift.io/v1/users/~
    - Groups come from OpenShift User API response
    """

    def __init__(self, config, key_name, client=None):
        super().__init__(config, key_name, client)
        self._openshift_api_url = self._get_openshift_api_url()

    def _get_openshift_api_url(self):
        """
        Get the OpenShift API URL from config or auto-detect from environment.
        """
        # Check explicit config first
        api_url = self.config.get("OPENSHIFT_API_URL")
        if api_url:
            return api_url.rstrip("/")

        # Auto-detect from in-cluster environment
        k8s_host = os.environ.get("KUBERNETES_SERVICE_HOST")
        k8s_port = os.environ.get("KUBERNETES_SERVICE_PORT", "443")
        if k8s_host:
            return f"https://{k8s_host}:{k8s_port}"

        # Fallback: derive from OIDC_SERVER
        # OpenShift OAuth URL is typically oauth-openshift.apps.cluster.example.com
        # API URL is typically api.cluster.example.com:6443
        oidc_server = self.config.get("OIDC_SERVER", "")
        if "oauth-openshift" in oidc_server:
            # Extract cluster domain and construct API URL
            # oauth-openshift.apps.cluster.example.com -> api.cluster.example.com:6443
            try:
                from urllib.parse import urlparse

                parsed = urlparse(oidc_server)
                hostname = parsed.netloc
                # Remove oauth-openshift.apps. prefix
                if hostname.startswith("oauth-openshift.apps."):
                    cluster_domain = hostname[len("oauth-openshift.apps.") :]
                    return f"https://api.{cluster_domain}:6443"
            except Exception:
                pass

        logger.warning(
            "Could not determine OpenShift API URL. "
            "Set OPENSHIFT_API_URL in config or run in-cluster."
        )
        return None

    def service_name(self):
        return self.config.get("SERVICE_NAME", "OpenShift")

    def get_icon(self):
        return self.config.get("SERVICE_ICON", "fa-openshift")

    def get_login_scopes(self):
        """
        Return OAuth scopes for OpenShift.

        OpenShift uses different scopes than standard OIDC:
        - user:info - Basic user information
        - user:check-access - Check access to resources
        - user:full - Full user access (includes above)
        """
        default_scopes = ["user:info"]
        return self.config.get("LOGIN_SCOPES", default_scopes)

    def _load_oidc_config_via_discovery(self, is_debugging):
        """
        Override to use RFC 8414 OAuth 2.0 Authorization Server Metadata.

        OpenShift exposes /.well-known/oauth-authorization-server instead of
        the standard OIDC /.well-known/openid-configuration endpoint.
        """
        oidc_server = self.config["OIDC_SERVER"]
        if not oidc_server.startswith("https://") and not is_debugging:
            raise DiscoveryFailureException("OAuth server must be accessed over SSL")

        # Try RFC 8414 discovery first
        discovery_url = join(oidc_server, OAUTH_AUTHORIZATION_SERVER_WELLKNOWN)
        discovery = self._http_client.get(discovery_url, timeout=5, verify=is_debugging is False)

        if discovery.status_code // 100 != 2:
            # Fallback to standard OIDC discovery (in case OpenShift is behind RHSSO/Keycloak)
            logger.debug(
                "RFC 8414 discovery failed (%s), trying standard OIDC discovery",
                discovery.status_code,
            )
            return super()._load_oidc_config_via_discovery(is_debugging)

        try:
            config = json.loads(discovery.text)

            # OpenShift's RFC 8414 response may not include jwks_uri directly
            # We need to construct it from the issuer
            if "jwks_uri" not in config and "issuer" in config:
                # OpenShift JWKS is at /oauth/token/keys or derivable from issuer
                issuer = config["issuer"].rstrip("/")
                # Try common OpenShift JWKS locations
                for jwks_path in ["/oauth/token/keys", "/.well-known/jwks.json"]:
                    jwks_url = f"{issuer}{jwks_path}"
                    try:
                        jwks_check = self._http_client.get(
                            jwks_url, timeout=5, verify=is_debugging is False
                        )
                        if jwks_check.status_code == 200:
                            config["jwks_uri"] = jwks_url
                            break
                    except Exception:
                        continue

            return config
        except ValueError:
            logger.exception("Could not parse OAuth authorization server metadata")
            raise DiscoveryFailureException("Could not parse OAuth authorization server metadata")

    def user_endpoint(self):
        """
        OpenShift doesn't have a standard /userinfo endpoint.
        Return None to force using id_token or API calls.
        """
        return None

    def get_user_info_from_openshift_api(self, http_client, access_token):
        """
        Get user info from OpenShift User API.

        OpenShift doesn't have a standard OIDC /userinfo endpoint.
        Instead, we call /apis/user.openshift.io/v1/users/~ which returns
        the current user's information including groups.

        Returns:
            dict: User info with sub, preferred_username, and groups
        """
        if not self._openshift_api_url:
            raise OAuthGetUserInfoException("OpenShift API URL not configured")

        api_url = f"{self._openshift_api_url}/apis/user.openshift.io/v1/users/~"
        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            response = http_client.get(api_url, headers=headers, timeout=10, verify=True)
        except Exception as e:
            logger.exception("Failed to call OpenShift User API: %s", e)
            raise OAuthGetUserInfoException(f"Failed to call OpenShift API: {e}")

        if response.status_code != 200:
            logger.error(
                "OpenShift User API returned %s: %s",
                response.status_code,
                response.text,
            )
            raise OAuthGetUserInfoException(f"OpenShift User API returned {response.status_code}")

        try:
            user_data = response.json()
        except ValueError:
            raise OAuthGetUserInfoException("Invalid JSON response from OpenShift API")

        # Extract user info from OpenShift User resource
        metadata = user_data.get("metadata", {})
        return {
            "sub": metadata.get("uid", metadata.get("name")),
            "preferred_username": metadata.get("name"),
            "email": None,  # OpenShift doesn't provide email by default
            "groups": user_data.get("groups", []),
        }

    def exchange_code_for_login(
        self,
        app_config,
        http_client,
        code,
        redirect_suffix,
        code_verifier: Optional[str] = None,
    ):
        """
        Exchange OAuth code for user login information.

        For OpenShift, we:
        1. Exchange the code for tokens (standard OAuth flow)
        2. Try to decode id_token for user info
        3. Always fetch groups from OpenShift API
        """
        # Exchange code for tokens
        id_token, access_token = self.exchange_code_for_tokens(
            app_config, http_client, code, redirect_suffix, code_verifier=code_verifier
        )

        # Try to decode id_token for user info
        decoded_id_token = None
        user_info = None

        try:
            decoded_id_token = self.decode_user_jwt(id_token)
            user_info = decoded_id_token.copy()
        except Exception as e:
            logger.debug("Could not decode OpenShift id_token, falling back to API: %s", e)

        # Always try to get user info from OpenShift API for groups
        try:
            os_user_info = self.get_user_info_from_openshift_api(http_client, access_token)

            if user_info is None:
                # Use API response as primary user info
                user_info = os_user_info
                decoded_id_token = os_user_info
            else:
                # Merge groups from API into existing user info
                user_info["groups"] = os_user_info.get("groups", [])

                # Use OpenShift username if not in token
                if "preferred_username" not in user_info:
                    user_info["preferred_username"] = os_user_info.get("preferred_username")

        except OAuthGetUserInfoException as e:
            logger.warning("Could not fetch OpenShift user info: %s", e)
            if user_info is None:
                raise OAuthLoginException("Could not get user info from OpenShift")

        if decoded_id_token is None:
            raise OAuthLoginException("Could not decode OpenShift token or fetch user info")

        # Ensure sub is set
        if "sub" not in decoded_id_token or not decoded_id_token["sub"]:
            if "preferred_username" in user_info:
                decoded_id_token["sub"] = user_info["preferred_username"]
            else:
                raise OAuthLoginException("Could not determine user identity")

        return get_sub_username_email_from_token(
            decoded_id_token, user_info, self, self._mailing, fetch_groups=True
        )

    def get_user_id(self, decoded_id_token: dict) -> str:
        """
        Extract user ID from decoded token.

        OpenShift may use different sub formats:
        - UUID from metadata.uid
        - Username from metadata.name

        Returns the most stable identifier available.
        """
        sub = decoded_id_token.get("sub")
        if not sub:
            # Fallback to preferred_username
            sub = decoded_id_token.get("preferred_username")

        if not sub:
            raise OAuthLoginException("Token missing 'sub' and 'preferred_username' fields")

        return sub

    def validate_opaque_token(self, http_client, token):
        """
        Validate an opaque (non-JWT) OpenShift access token.

        OpenShift can issue opaque access tokens that aren't JWTs.
        We validate these by calling the User API - if it succeeds,
        the token is valid.

        Returns:
            dict: User info including sub, preferred_username, and groups
        """
        return self.get_user_info_from_openshift_api(http_client, token)

    def get_service_account_token(self):
        """
        Get the in-cluster service account token for background operations.

        This is used for background team sync operations that need to
        query OpenShift groups without a user's token.
        """
        token_path = self.config.get("SERVICE_ACCOUNT_TOKEN_PATH", DEFAULT_SA_TOKEN_PATH)
        try:
            with open(token_path, "r") as f:
                return f.read().strip()
        except FileNotFoundError:
            logger.warning("Service account token not found at %s", token_path)
            return None
        except Exception as e:
            logger.error("Failed to read service account token: %s", e)
            return None

    def get_group_members(self, http_client, group_name):
        """
        Get members of an OpenShift group.

        Used for background team sync operations.

        Args:
            http_client: HTTP client for API calls
            group_name: Name of the OpenShift group

        Returns:
            list: List of usernames in the group
        """
        if not self._openshift_api_url:
            raise OAuthGetUserInfoException("OpenShift API URL not configured")

        # Use service account token for background operations
        sa_token = self.get_service_account_token()
        if not sa_token:
            raise OAuthGetUserInfoException("Service account token not available")

        api_url = f"{self._openshift_api_url}/apis/user.openshift.io/v1/groups/{group_name}"
        headers = {"Authorization": f"Bearer {sa_token}"}

        try:
            response = http_client.get(api_url, headers=headers, timeout=10, verify=True)
        except Exception as e:
            logger.exception("Failed to fetch OpenShift group: %s", e)
            raise OAuthGetUserInfoException(f"Failed to fetch group: {e}")

        if response.status_code == 404:
            return []

        if response.status_code != 200:
            raise OAuthGetUserInfoException(f"OpenShift Group API returned {response.status_code}")

        try:
            group_data = response.json()
            return group_data.get("users", [])
        except ValueError:
            raise OAuthGetUserInfoException("Invalid JSON response from OpenShift Group API")
