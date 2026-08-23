"""Reading the worker's own credential from Vault.

The worker never holds a credential it was given. It holds a *path*, and fetches
the secret at startup as itself.

Early in the workshop that means a root token from the environment. Once the
worker is a pod, the token that worked from a shell simply does not exist -- so it
authenticates as its Kubernetes ServiceAccount instead. That switch is the one
moment where "the worker moved into the cluster" has a consequence somebody has to
handle rather than watch.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

KUBERNETES_JWT = Path("/var/run/secrets/kubernetes.io/serviceaccount/token")


class VaultError(Exception):
    pass


class Vault:
    def __init__(self, addr: str, token: str, mount: str = "secret") -> None:
        self.addr = addr.rstrip("/")
        self.token = token
        self.mount = mount

    @classmethod
    def from_env(cls) -> "Vault":
        addr = os.environ.get("VAULT_ADDR")
        if not addr:
            raise VaultError("VAULT_ADDR is not set")
        mount = os.environ.get("VAULT_KV_MOUNT", "secret")

        token = os.environ.get("VAULT_TOKEN")
        if token:
            return cls(addr, token, mount)

        role = os.environ.get("VAULT_K8S_ROLE")
        if not role:
            raise VaultError(
                "no VAULT_TOKEN and no VAULT_K8S_ROLE.\n"
                "Outside Kubernetes, export VAULT_TOKEN. Inside it, set VAULT_K8S_ROLE "
                "and give the pod a ServiceAccount bound to that Vault role."
            )
        if not KUBERNETES_JWT.is_file():
            raise VaultError(
                f"VAULT_K8S_ROLE is set but there is no projected service account token at "
                f"{KUBERNETES_JWT}. Is this actually running in a pod?"
            )
        client = cls(addr, "", mount)
        client.token = client._login_kubernetes(role, KUBERNETES_JWT.read_text().strip())
        return client

    def read(self, path: str) -> dict:
        body = self._request("GET", f"{self.addr}/v1/{self.mount}/data/{path.lstrip('/')}")
        return body.get("data", {}).get("data", {})

    def read_field(self, path: str, field: str) -> str:
        data = self.read(path)
        if field not in data:
            raise VaultError(f"vault path {path} has no field {field!r}. Present: {sorted(data)}")
        return str(data[field])

    def _login_kubernetes(self, role: str, jwt: str) -> str:
        body = self._request(
            "POST",
            f"{self.addr}/v1/auth/kubernetes/login",
            json.dumps({"role": role, "jwt": jwt}).encode(),
        )
        token = body.get("auth", {}).get("client_token")
        if not token:
            raise VaultError(f"vault kubernetes login as {role!r} returned no client token")
        return token

    def _request(self, method: str, url: str, data: bytes | None = None) -> dict:
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("X-Vault-Token", self.token)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read() or b"{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            raise VaultError(f"vault {method} {url}: {e.code} {e.reason}: {detail}") from e
        except urllib.error.URLError as e:
            raise VaultError(f"vault {method} {url}: {e.reason}") from e
