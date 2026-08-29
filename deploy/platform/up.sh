#!/usr/bin/env bash
# Bring the control plane up on k3s, against Temporal Cloud.
#
# Two phases, because they have different owners.
#
#   base      k3s, Vault, Kubernetes auth, and the platform's own Cloud API key.
#             Provisioning does this, and it is the only step that ever holds the
#             key in an environment variable.
#   platform  the control plane itself. A student does this, after their own
#             Terraform has made the namespace it will run in.
#
# Splitting them is what lets the sandbox seed Vault and then unset the key, so a
# student running `history` cannot find it -- the same property the systemd
# version had, kept.
set -euo pipefail

PHASE="${1:-all}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
k() { kubectl "$@"; }

VAULT_NODEPORT="${VAULT_NODEPORT:-30820}"

vault_reachable() {
  curl -fsS -m 2 -o /dev/null \
    "http://127.0.0.1:$VAULT_NODEPORT/v1/sys/health?standbyok=true" 2>/dev/null
}

# One address for Vault in every environment -- rule 8 -- which takes some work,
# because NodePort routing is not universal:
#
#   k3s        the host IS the node, so the NodePort is simply open.
#   k3d        needs -p "30820:30820@server:0" at cluster creation.
#   Docker Desktop (kind-based, node "desktop-control-plane")
#              does NOT publish NodePorts to the host at all.
#
# So: try the NodePort, and fall back to a port-forward on the SAME port. The lab
# text, the env file and every `vault kv get` see one address regardless.
ensure_vault_reachable() {
  local i
  for i in $(seq 1 15); do vault_reachable && return 0; sleep 2; done

  echo "==> NodePort $VAULT_NODEPORT is not routed to the host; port-forwarding instead"
  pkill -f "port-forward.*svc/vault.*$VAULT_NODEPORT:8200" 2>/dev/null || true
  nohup kubectl -n platform port-forward svc/vault "$VAULT_NODEPORT:8200" \
    >/tmp/vault-port-forward.log 2>&1 &
  disown 2>/dev/null || true

  for i in $(seq 1 30); do vault_reachable && return 0; sleep 1; done

  echo "ERROR: Vault is not reachable at http://127.0.0.1:$VAULT_NODEPORT" >&2
  echo "  kubectl -n platform get pods" >&2
  echo "  tail /tmp/vault-port-forward.log" >&2
  exit 1
}

require_cluster() {
  # The sandbox runs k3s as a systemd unit; a laptop runs k3d, colima or Docker
  # Desktop, where there is no unit to start. Detect rather than assume.
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files k3s.service >/dev/null 2>&1; then
    sudo systemctl is-active --quiet k3s || sudo systemctl start k3s
  fi
  for _ in $(seq 1 60); do k get nodes >/dev/null 2>&1 && break; sleep 2; done
  k get nodes >/dev/null || {
    echo "no reachable cluster." >&2
    echo "  Linux:  sudo systemctl start k3s" >&2
    echo "  macOS:  k3d cluster create platform -p "30820:30820@server:0"" >&2
    echo "          (or enable Kubernetes in Docker Desktop)" >&2
    exit 1
  }
}

bring_up_base() {
  : "${TEMPORAL_CLOUD_API_KEY:?set it to a Cloud API key with the Developer role}"
  local vault_root="${VAULT_DEV_ROOT_TOKEN_ID:-dev}"

  echo "==> cluster"
  require_cluster

  echo "==> namespace and secrets"
  k create namespace platform --dry-run=client -o yaml | k apply -f -
  k -n platform create secret generic platform-bootstrap \
    --from-literal=vault-root-token="$vault_root" \
    --from-literal=state-token="${STATE_TOKEN:-local}" \
    --dry-run=client -o yaml | k apply -f -

  echo "==> vault"
  k apply -f "$HERE/vault.yaml"
  k -n platform rollout status deploy/vault --timeout=120s

  export VAULT_ADDR="http://127.0.0.1:$VAULT_NODEPORT" VAULT_TOKEN="$vault_root"
  ensure_vault_reachable

  echo "==> seed the platform's own credential"
  # It lands here and nowhere else. Whoever runs this phase should unset the
  # variable afterwards; the sandbox provisioner does.
  vault kv put secret/platform/cloud-api-key api_key="$TEMPORAL_CLOUD_API_KEY" >/dev/null

  echo "==> kubernetes auth, so the pod needs no token in its manifest"
  # Enabling the auth method, and creating only the platform's own role. The
  # policy and role for the MANAGED worker stay unwritten -- that is challenge
  # 4's graded step, and pre-creating it would give the answer away.
  vault auth enable kubernetes 2>/dev/null || true
  vault write auth/kubernetes/config kubernetes_host="https://kubernetes.default.svc" >/dev/null
  vault policy write platform-worker - <<'POLICY' >/dev/null
path "secret/data/platform/*"       { capabilities = ["read"] }
path "secret/data/namespaces/*"     { capabilities = ["create", "update", "read"] }
path "secret/metadata/namespaces/*" { capabilities = ["list", "read"] }
POLICY
  vault write auth/kubernetes/role/platform-worker \
    bound_service_account_names=platform-worker \
    bound_service_account_namespaces=platform \
    policies=platform-worker ttl=24h >/dev/null

  cat <<EOF

Base is up.

  vault   http://127.0.0.1:30820  (root token: $vault_root)

The platform's Cloud API key is in Vault at secret/platform/cloud-api-key and
nowhere else. Unset TEMPORAL_CLOUD_API_KEY now.

Next, from the repo root:

  ./scripts/workshop-creds init
  source "\$(./scripts/workshop-creds env-file)"
EOF
}

bring_up_platform() {
  : "${CONTROL_NAMESPACE:?the namespace the control plane runs in, e.g. ws-7-control.a1b2c3}"
  local address="${TEMPORAL_ADDRESS:-us-west-2.aws.api.temporal.io:7233}"

  require_cluster
  k -n platform get deploy vault >/dev/null 2>&1 || {
    echo "Vault is not deployed. Run 'make base-up' first." >&2
    exit 1
  }

  ensure_vault_reachable

  echo "==> control plane config"
  k -n platform create configmap platform-env \
    --from-literal=temporal-address="$address" \
    --from-literal=control-namespace="$CONTROL_NAMESPACE" \
    --from-literal=state-service-url="${STATE_SERVICE_URL:-}" \
    --from-literal=username="${WORKSHOP_USERNAME:-local}" \
    --from-literal=cohort="${WORKSHOP_COHORT:-local}" \
    --from-literal=namespace-quota="${PLATFORM_NAMESPACE_QUOTA:-50}" \
    --dry-run=client -o yaml | k apply -f -

  echo "==> control plane"
  k apply -f "$HERE/platform-worker.yaml"
  k -n platform rollout restart deploy/platform-worker
  k -n platform rollout status  deploy/platform-worker --timeout=180s

  cat <<EOF

Control plane is up.

  namespace   $CONTROL_NAMESPACE
  address     $address
  logs        make logs
  reload      make reload   (after editing anything compiled into the worker)

The UI is https://cloud.temporal.io -- there is no local one any more.
EOF
}

# Checked before the image build, not after. Without this the first symptom of a
# stopped cluster is an import error arriving forty seconds late, which reads as a
# broken build rather than as a cluster that is not running.
preflight() {
  if ! kubectl get nodes >/dev/null 2>&1; then
    cat >&2 <<EOF
No reachable cluster -- k3s is where the control plane runs.

  sandbox / Linux:  sudo systemctl start k3s
  macOS:            k3d cluster create platform -p "30820:30820@server:0"
                    (or enable Kubernetes in Docker Desktop)
EOF
    exit 1
  fi
  if ! kubectl -n platform get deploy platform-worker >/dev/null 2>&1; then
    cat >&2 <<EOF
Cluster is up, but the control plane is not deployed yet.

  make base-up      # k3s, vault, kubernetes auth, seed the key
                    needs TEMPORAL_CLOUD_API_KEY
  make platform-up  # the control plane itself
                    needs CONTROL_NAMESPACE (./scripts/workshop-creds control)
EOF
    exit 1
  fi
}

# Getting a locally built image in front of a kubelet, which is the step people
# lose an afternoon to. Nothing pushes to a registry: the sandbox has no
# credentials for one, and `imagePullPolicy: IfNotPresent` is what makes that
# safe -- the kubelet uses what it has and never reaches out.
#
# Three runtimes, three answers:
#   k3s            its own containerd, invisible to the Docker daemon. Import.
#   k3d            same, but wrapped -- it ships a command for it.
#   docker-desktop shares the Docker daemon, so the image is already there.
import_image() {
  local ctx; ctx="$(kubectl config current-context 2>/dev/null)"
  if command -v k3d >/dev/null 2>&1 && k3d cluster list 2>/dev/null | grep -q platform; then
    echo "==> k3d image import"
    k3d image import platform-worker:dev -c platform
  elif [ "$ctx" = "docker-desktop" ]; then
    echo "==> docker-desktop shares the Docker daemon; nothing to import"
  else
    echo "==> k3s ctr images import"
    docker save platform-worker:dev | sudo k3s ctr images import -
  fi
}

case "$PHASE" in
  base)     bring_up_base ;;
  platform) bring_up_platform ;;
  all)      bring_up_base; bring_up_platform ;;
  forward)   require_cluster; ensure_vault_reachable; echo "vault reachable at http://127.0.0.1:$VAULT_NODEPORT" ;;
  preflight) preflight ;;
  import)    import_image ;;
  *)         echo "usage: up.sh [base|platform|forward|preflight|import|all]" >&2; exit 2 ;;
esac
