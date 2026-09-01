#!/usr/bin/env bash
# Bring the control plane up on k3s, against Temporal Cloud.
#
# Two phases, and the boundary between them is exactly one secret.
#
#   base      Vault, Kubernetes auth, AND seeding the platform's own Cloud API
#             key. Provisioning does this, and the seeding step is the only place
#             in the workshop that ever holds the key in an environment variable.
#   platform  the control plane itself. A student does this, after their own
#             Terraform has made the namespace it will run in.
#
# The split is what lets the sandbox seed Vault and then unset the key, so a
# student running `history` cannot find it -- the same property the systemd
# version had, kept.
#
# But only the SEEDING has to be separate. The namespace, Vault and the auth
# config hold nothing sensitive, so ensure_base_infra() is shared: platform runs
# it too, and a rebuilt cluster heals itself instead of stopping to say "run
# base-up first". What platform will still never do is ask for the key -- if
# Vault is empty it points at `workshop init --api-key` and stops.
set -euo pipefail

PHASE="${1:-all}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
k() { kubectl "$@"; }

VAULT_NODEPORT="${VAULT_NODEPORT:-30820}"
# Script-level, not `local` in ensure_base_infra. bring_up_base prints it in its
# closing summary, and a `local` is not in scope there -- under `set -u` that is
# not an empty string, it is "vault_root: unbound variable" thrown AFTER the key
# was already seeded, so the work succeeded and the command still failed.
VAULT_ROOT_TOKEN="${VAULT_DEV_ROOT_TOKEN_ID:-dev}"
IMAGE="${IMAGE:-platform-worker:dev}"

# Colour, when a terminal is there to render it. NO_COLOR is honoured because it
# is the convention, and because the sandbox captures this output into a log where
# escape codes are noise rather than emphasis.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_STEP=$'\033[1;36m'         # cyan: what is about to happen
  # Grey 250, not the dim attribute. \033[2m is rendered by most terminals as
  # roughly half brightness against the background, which on a dark theme puts the
  # explanation somewhere between hard to read and invisible -- and an explanation
  # nobody reads is the whole rule 10 failure, just spelled differently. A fixed
  # light grey stays clearly subordinate to the cyan heading without disappearing.
  C_BODY=$'\033[38;5;250m'     # light grey: why it happens
  C_ASK=$'\033[1;33m'          # yellow: the one line asking something of you
  C_OFF=$'\033[0m'
else
  C_STEP='' C_BODY='' C_ASK='' C_OFF=''
fi

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
# The cluster_id of the Vault answering on the host port, and of the Vault running
# in this cluster. They must be the same Vault.
vault_id_via_port() {
  VAULT_ADDR="http://127.0.0.1:$VAULT_NODEPORT" vault status -format=json 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("cluster_id",""))' 2>/dev/null
}

vault_id_in_cluster() {
  k -n platform exec deploy/vault -- sh -c 'VAULT_ADDR=http://127.0.0.1:8200 vault status -format=json' 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("cluster_id",""))' 2>/dev/null
}

# Reachability is not identity, and conflating the two costs an afternoon.
#
# A `kubectl port-forward` left over from another cluster binds 127.0.0.1:30820
# every bit as convincingly as a real NodePort. When that happens every `vault`
# command on the host configures the WRONG Vault, while the worker -- which talks
# to vault.platform.svc inside the cluster -- talks to the right one. The symptom
# is a worker failing kubernetes login with "permission denied" against a role you
# can read on your own screen, because the role is in the other Vault.
#
# Nothing about that is guessable from the error, so check the cluster_id rather
# than trusting a TCP connect.
vault_is_this_cluster() {
  local outside inside
  outside="$(vault_id_via_port)"
  inside="$(vault_id_in_cluster)"
  [ -n "$outside" ] && [ -n "$inside" ] && [ "$outside" = "$inside" ]
}

ensure_vault_reachable() {
  local i
  for i in $(seq 1 15); do
    if vault_reachable; then
      vault_is_this_cluster && return 0
      echo "==> port $VAULT_NODEPORT is answering, but from a DIFFERENT Vault than this cluster's." >&2
      echo "    Almost always a kubectl port-forward left running against another cluster." >&2
      echo "    Replacing it." >&2
      break
    fi
    sleep 2
  done

  echo "==> NodePort $VAULT_NODEPORT is not routed to this cluster's Vault; port-forwarding instead"
  pkill -f "port-forward.*svc/vault.*$VAULT_NODEPORT:8200" 2>/dev/null || true
  sleep 1
  nohup kubectl -n platform port-forward svc/vault "$VAULT_NODEPORT:8200" \
    >/tmp/vault-port-forward.log 2>&1 &
  disown 2>/dev/null || true

  for i in $(seq 1 30); do
    if vault_reachable && vault_is_this_cluster; then return 0; fi
    sleep 1
  done

  echo "ERROR: Vault is not reachable at http://127.0.0.1:$VAULT_NODEPORT" >&2
  echo "  kubectl -n platform get pods" >&2
  echo "  tail /tmp/vault-port-forward.log" >&2
  exit 1
}

# Can the cluster kubectl currently points at see an image built by `docker build`?
#
# The discriminator that matters is Docker Desktop's, because the context is named
# docker-desktop either way: node "docker-desktop" is kubeadm-provisioned and
# shares the daemon, node "desktop-control-plane" is kind-provisioned with its own
# containerd and shares nothing -- and its node lives inside the Docker Desktop VM,
# so there is no `docker exec ... ctr images import` route and no `kind load` route
# either. Keep this in step with scripts/workshop-check, which reports the same
# distinction.
cluster_can_take_images() {
  local ctx node
  ctx="$(kubectl config current-context 2>/dev/null)"
  node="$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"
  [ "$ctx" = "docker-desktop" ] && [ "$node" != "docker-desktop" ] && return 1
  return 0
}

# Is kubectl pointing at a cluster this workshop is allowed to build in?
#
# kubectl's current context is global state that anything on the machine can
# change -- another project, another terminal, an `aws eks update-kubeconfig` an
# hour ago. The failure that guards against is not a broken workshop: it is a
# control plane, a Vault with a live Cloud credential in it, and a PersistentVolume
# deployed into somebody's real cluster, by a script that was only ever asked to
# set up a laptop.
#
# So recognise the local ones by name and refuse everything else out loud. This is
# the one place the workshop is allowed to be paranoid, because it is the only
# action here that cannot be undone by deleting a namespace.
cluster_is_local() {
  local ctx; ctx="$(kubectl config current-context 2>/dev/null)"
  case "$ctx" in
    k3d-*|kind-*|docker-desktop|minikube|colima|default|rancher-desktop) return 0 ;;
    *) return 1 ;;
  esac
}

k3d_cluster_exists() {
  command -v k3d >/dev/null 2>&1 && k3d cluster list 2>/dev/null | grep -q '^platform '
}

# Build the k3d cluster the workshop is designed around.
#
# The port mapping is not optional: Vault runs in the cluster and its CLI runs on
# your machine -- every challenge reads a secret by hand -- so the NodePort has to
# be published to the host. See rule 8 in DESIGN.md.
create_k3d_cluster() {
  command -v k3d >/dev/null 2>&1 || {
    echo "ERROR: k3d is not installed, and it is what this workshop runs on." >&2
    echo >&2
    echo "    brew install k3d      # macOS" >&2
    echo >&2
    echo "  Then re-run this command; it will create the cluster for you." >&2
    exit 1
  }

  step "Create the k3d cluster this workshop runs on" \
    "k3d runs a small Kubernetes inside Docker. The -p mapping publishes Vault's" \
    "NodePort $VAULT_NODEPORT to your machine, because Vault runs in the cluster while the" \
    "vault CLI you type by hand runs outside it." \
    "" \
    "This creates containers and switches your kubectl context to k3d-platform." \
    "Nothing outside this workshop is touched. To remove it later:" \
    "  k3d cluster delete platform      ('workshop down' only clears the namespace)"

  k3d cluster create platform -p "$VAULT_NODEPORT:$VAULT_NODEPORT@server:0"
}

# Make sure there is a cluster, and that it is one we can actually deploy to.
#
# "Reachable" is not the same as "usable": a kind-provisioned Docker Desktop
# answers kubectl perfectly and then cannot see a single image you build. Finding
# that out at ImagePullBackOff, forty seconds after a confident "nothing to
# import", is the failure this function exists to prevent.
require_cluster() {
  # The sandbox runs k3s as a systemd unit; a laptop runs k3d, colima or Docker
  # Desktop, where there is no unit to start. Detect rather than assume.
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files k3s.service >/dev/null 2>&1; then
    sudo systemctl is-active --quiet k3s || sudo systemctl start k3s
  fi

  # A k3d cluster that exists but is stopped is one command from working, and
  # recreating it would throw away Vault and the key inside it.
  if ! k get nodes >/dev/null 2>&1 && k3d_cluster_exists; then
    step "Start the existing k3d cluster" \
      "The cluster 'platform' already exists but is not running. Starting it keeps" \
      "whatever is already in it -- Vault, and the Cloud API key you seeded."
    k3d cluster start platform >/dev/null
  fi

  if ! k get nodes >/dev/null 2>&1; then
    create_k3d_cluster
  elif ! cluster_is_local; then
    echo "ERROR: refusing to deploy into an unrecognised cluster." >&2
    echo >&2
    echo "  kubectl context: $(kubectl config current-context 2>/dev/null)" >&2
    echo >&2
    echo "  This does not look like a local workshop cluster, and platform-up would" >&2
    echo "  create a namespace, a Vault holding a live Temporal Cloud credential, and" >&2
    echo "  a PersistentVolume in it." >&2
    echo >&2
    echo "  Switch to your workshop cluster, or let this create one:" >&2
    echo "    kubectl config use-context k3d-platform" >&2
    echo >&2
    echo "  If you really do mean this cluster: WORKSHOP_ALLOW_CLUSTER=1 ..." >&2
    [ "${WORKSHOP_ALLOW_CLUSTER:-}" = "1" ] || exit 1
    echo "  WORKSHOP_ALLOW_CLUSTER=1 is set; continuing." >&2
  elif ! cluster_can_take_images; then
    local node; node="$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"
    echo >&2
    echo "The cluster kubectl points at cannot see locally built images." >&2
    echo "  context: $(kubectl config current-context 2>/dev/null)" >&2
    echo "  node:    $node  (kind-provisioned, its own containerd)" >&2
    echo >&2
    echo "Deploying to it would end in ImagePullBackOff. The fix is a k3d cluster." >&2
    if k3d_cluster_exists; then
      step "Switch to the k3d cluster" \
        "A k3d cluster called 'platform' already exists. Pointing kubectl at it."
      k3d kubeconfig merge platform --kubeconfig-merge-default --kubeconfig-switch-context >/dev/null
    else
      create_k3d_cluster
    fi
  fi

  for _ in $(seq 1 60); do k get nodes >/dev/null 2>&1 && break; sleep 2; done
  k get nodes >/dev/null || {
    echo "no reachable cluster." >&2
    echo "  Linux:  sudo systemctl start k3s" >&2
    echo "  macOS:  k3d cluster create platform -p \"$VAULT_NODEPORT:$VAULT_NODEPORT@server:0\"" >&2
    exit 1
  }
}

# Everything the control plane needs that is NOT a secret: the namespace, Vault
# itself, and the Kubernetes auth that lets the pod log in as its ServiceAccount.
#
# Split out of bring_up_base so that platform-up can call it too. It is safe to
# run anywhere, as often as you like -- every step is idempotent and none of it
# touches the Cloud API key. That key is the ONLY reason the two phases were ever
# separate: see the note at the top of this file, and seed_cloud_key below.
ensure_base_infra() {

  step "Create the platform namespace and its bootstrap secret" \
    "A Kubernetes namespace called \"platform\" to keep the control plane's own" \
    "resources together, and one secret holding Vault's dev root token. That token" \
    "is not your Cloud key -- it is how this script talks to Vault to configure it."
  k create namespace platform --dry-run=client -o yaml | k apply -f -
  k -n platform create secret generic platform-bootstrap \
    --from-literal=vault-root-token="$VAULT_ROOT_TOKEN" \
    --dry-run=client -o yaml | k apply -f -

  step "Deploy Vault, and wait for it" \
    "Vault is where the platform's Cloud API key lives, and where every namespace" \
    "credential the reconciler mints will be written. It runs in the cluster; the" \
    "vault CLI you use by hand runs on your machine and reaches it on a NodePort."
  k apply -f "$HERE/vault.yaml"
  k -n platform rollout status deploy/vault --timeout=120s

  export VAULT_ADDR="http://127.0.0.1:$VAULT_NODEPORT" VAULT_TOKEN="$VAULT_ROOT_TOKEN"
  ensure_vault_reachable

  step "Configure Kubernetes auth in Vault" \
    "This is what lets the worker pod log in to Vault as its ServiceAccount, so no" \
    "token appears in the Deployment manifest. It writes the platform's own policy" \
    "and role -- and deliberately NOT the managed worker's, which is challenge 4."
  # Enabling the auth method, and creating only the platform's own role. The
  # managed worker's policy and role are written by `tpctl deploy`, at the moment
  # that worker appears -- they name a spec and a Kubernetes namespace that do not
  # exist yet here, and granting a workload its identity belongs with deploying
  # the workload rather than with bringing up the cluster.
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
}

# The one step that holds the Cloud key, and the whole reason `base` exists as a
# separate phase. It lands in Vault and nowhere else; whoever runs this should
# unset the variable afterwards, as the sandbox provisioner does.
seed_cloud_key() {
  : "${TEMPORAL_CLOUD_API_KEY:?set it to a Cloud API key with the Developer role}"
  step "Seed the platform's Cloud API key into Vault" \
    "The one step in this workshop that holds the key in an environment variable." \
    "It lands in Vault at secret/platform/cloud-api-key and nowhere else; unset the" \
    "variable afterwards."
  vault kv put secret/platform/cloud-api-key api_key="$TEMPORAL_CLOUD_API_KEY" >/dev/null
}

# Refuse to deploy a control plane that has no credential to work with. This is
# NOT a request for the key -- platform-up never takes one. It is a check that
# somebody has already seeded it, and a pointer to the one command that does.
require_cloud_key() {
  vault kv get -field=api_key secret/platform/cloud-api-key >/dev/null 2>&1 && return 0
  echo "ERROR: Vault is up, but the platform's Cloud API key is not in it." >&2
  echo >&2
  echo "  A fresh cluster means a fresh Vault, so the key has to be seeded once" >&2
  echo "  more. It is the only thing here a human has to supply:" >&2
  echo >&2
  echo "    ./scripts/workshop init --api-key" >&2
  echo >&2
  echo "  platform-up deliberately does not ask for it. The key is pasted once," >&2
  echo "  into Vault, and every later command reads it from there." >&2
  exit 1
}

bring_up_base() {
  : "${TEMPORAL_CLOUD_API_KEY:?set it to a Cloud API key with the Developer role}"

  step "Check the cluster is reachable" \
    "Everything below lands in Kubernetes, so nothing can start without one."
  require_cluster
  ensure_base_infra
  seed_cloud_key

  cat <<EOF

Base is up.

  vault   http://127.0.0.1:$VAULT_NODEPORT  (root token: $VAULT_ROOT_TOKEN)

The platform's Cloud API key is in Vault at secret/platform/cloud-api-key and
nowhere else. Unset TEMPORAL_CLOUD_API_KEY now.

Next, from the repo root:

  ./scripts/workshop init
  source "\$(./scripts/workshop env-file)"
EOF
}

# The control plane's namespace, read from the Terraform that made it.
#
# Terraform is the source because it answers the right question. The account id
# can also be decoded from the API key in Vault, but that answers "who am I
# authenticating as", not "what namespace exists" -- and a stale key makes the
# first answer confidently wrong. The state file cannot be wrong about what it
# created.
#
# This lives here rather than in scripts/workshop so that every entry path gets
# it: `workshop platform-up`, `make platform-up`, `make up`, and this script run
# directly all resolve the same way.
control_namespace_from_tf() {
  local dir="$REPO/terraform/namespace"
  [ -f "$dir/terraform.tfstate" ] || return 0

  # `terraform output` is the interface, so try it first. It needs `terraform
  # init` to have been run in that directory, which a fresh sandbox may not have
  # done -- so fall back to reading the state, rather than failing over a
  # dependency the answer does not actually need.
  if command -v terraform >/dev/null 2>&1; then
    local out
    out=$(cd "$dir" && terraform output -raw namespace_id 2>/dev/null) || out=""
    case "$out" in ""|*[!a-zA-Z0-9.-]*) ;; *) printf '%s' "$out"; return 0 ;; esac
  fi

  python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(0)
v = d.get("outputs", {}).get("namespace_id", {}).get("value")
if isinstance(v, str) and v:
    print(v)
' "$dir/terraform.tfstate" 2>/dev/null
}

# An exported CONTROL_NAMESPACE still wins -- `workshop platform-up
# --control-namespace` sets it, and a sandbox may too. But when it disagrees with
# Terraform, say so rather than silently choosing: a leftover export from another
# account is the one failure here that is otherwise invisible, because everything
# comes up healthy and points at the wrong namespace.
resolve_control_namespace() {
  local tf; tf="$(control_namespace_from_tf)"

  if [ -n "${CONTROL_NAMESPACE:-}" ]; then
    if [ -n "$tf" ] && [ "$tf" != "$CONTROL_NAMESPACE" ]; then
      echo "note: using CONTROL_NAMESPACE from the environment, not Terraform." >&2
      echo "      environment: $CONTROL_NAMESPACE" >&2
      echo "      terraform:   $tf" >&2
    fi
    return 0
  fi

  CONTROL_NAMESPACE="$tf"
  if [ -z "$CONTROL_NAMESPACE" ]; then
    echo "ERROR: cannot tell which namespace the control plane should run on." >&2
    echo >&2
    echo "  Challenge 1's apply creates it and writes namespace_id to Terraform's" >&2
    echo "  outputs. If that apply has run, check terraform/namespace/outputs.tf" >&2
    echo "  exists and declares namespace_id -- without it the namespace is created" >&2
    echo "  but nothing can name it." >&2
    echo >&2
    echo "  To bypass: ./scripts/workshop platform-up --control-namespace <ns>.<acct>" >&2
    exit 1
  fi
}

bring_up_platform() {
  resolve_control_namespace
  local address="${TEMPORAL_ADDRESS:-us-west-2.aws.api.temporal.io:7233}"

  require_cluster
  # Bring the non-secret half of `base` up if it is not there. A rebuilt cluster
  # is the common case -- k3d create, and everything in the old one is gone -- and
  # "Vault is not deployed, run base-up first" was a step the script could simply
  # have taken itself. What it still will not do is seed the key.
  ensure_base_infra
  require_cloud_key

  # One list, and the keys are the environment variable names the worker reads.
  # The Deployment consumes the whole map with envFrom and never names a key, so
  # a new setting is a line here and nothing there.
  #
  # Empty is not a value: env(), envInt() and envDuration() in
  # internal/platform/activity/config.go all treat an empty string as unset, so
  # leaving one blank defers to the Go default rather than overriding it with
  # something this script guessed.
  step "Write the platform-env ConfigMap" \
    "The namespace to run on, the Cloud address, your username and cohort. Its keys" \
    "are the environment variable names the worker reads, so there is no" \
    "translation table between this and the Deployment."
  k -n platform create configmap platform-env \
    --from-literal=TEMPORAL_ADDRESS="$address" \
    --from-literal=TEMPORAL_NAMESPACE="$CONTROL_NAMESPACE" \
    --from-literal=WORKSHOP_USERNAME="${WORKSHOP_USERNAME:-local}" \
    --from-literal=WORKSHOP_COHORT="${WORKSHOP_COHORT:-local}" \
    --from-literal=PLATFORM_NAMESPACE_QUOTA="${PLATFORM_NAMESPACE_QUOTA:-}" \
    --dry-run=client -o yaml | k apply -f -

  step "Deploy the control plane and wait for the rollout" \
    "A ServiceAccount, a volume for Terraform state, and the worker itself. When" \
    "this returns, the worker is polling the platform task queue -- registered for" \
    "whatever you have uncommented in internal/platform/register.go, and no more."
  k apply -f "$HERE/platform-worker.yaml"
  k -n platform rollout restart deploy/platform-worker
  k -n platform rollout status  deploy/platform-worker --timeout=180s

  cat <<EOF

Control plane is up.

  namespace   $CONTROL_NAMESPACE
  address     $address
  logs        workshop logs
  reload      workshop reload   (after editing anything compiled into the worker)

Go and look at what you just built:

  k9s -n platform

  :pods           the worker, and Vault beside it
  l               logs for whatever is selected -- the same thing workshop logs shows
  d               describe it: image, env, mounts, and the ServiceAccount it holds
  :configmaps     platform-env, the config this script just wrote
  ?               help, and :q quits

Worth two minutes now, because everything after this is something you did to a
cluster you have seen. If k9s is not installed: brew install k9s.

The Temporal UI is https://cloud.temporal.io -- there is no local one any more.
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

  workshop base-up      # k3s, vault, kubernetes auth, seed the key
                    needs TEMPORAL_CLOUD_API_KEY
  workshop platform-up  # the control plane itself
                    needs CONTROL_NAMESPACE (./scripts/workshop init ...)
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
# Get the freshly built image to wherever the kubelet will look for it.
#
# The context name is NOT enough to decide, which is the trap this function used
# to fall into. Docker Desktop reports the context "docker-desktop" whether it is
# kubeadm-provisioned (one node, named docker-desktop, sharing the Docker daemon)
# or kind-provisioned (node desktop-control-plane, its own containerd, sharing
# nothing). Assuming the first when it is the second produces a confident
# "nothing to import" followed forty seconds later by ImagePullBackOff, reported
# as "pull access denied" -- an authorization error for a registry that was never
# involved.
#
# So branch on the node, not the context. Keep this in step with the image
# delivery probe in scripts/workshop-check, which makes the same distinction in
# order to catch it before anything is built.
# Say what is about to happen, and why, before doing it.
#
# A student watching `platform-up` scroll past learns nothing about their own
# platform. The point of this workshop is that the control plane is not magic, so
# the script that builds it must not behave like magic either -- see rule 10 in
# DESIGN.md. Every step announces itself, in the vocabulary the labs use, and
# waits.
#
# It waits ONLY when a human is there to read it. No TTY means the sandbox
# provisioner, CI, or `make up` in a script, and blocking those on a keypress
# would turn a teaching device into a hang. WORKSHOP_YES=1 opts out explicitly,
# which is what you want on the fifth run of the morning.
step() {
  local title="$1"; shift
  printf '\n%s==> %s%s\n' "$C_STEP" "$title" "$C_OFF"
  local line
  for line in "$@"; do printf '%s    %s%s\n' "$C_BODY" "$line" "$C_OFF"; done
  [ "${WORKSHOP_YES:-}" = "1" ] && return 0
  [ -t 0 ] || return 0
  printf '\n%s    press any key to continue, ctrl-c to stop %s' "$C_ASK" "$C_OFF"
  read -r -n 1 -s _ || true
  printf '\r\033[K'
}

# Compile the control plane into an image.
#
# In up.sh rather than in the Makefile so that it announces itself like every
# other step -- see rule 10 in DESIGN.md. A recipe line that scrolls past is
# exactly the kind of thing this workshop is not supposed to do to a student.
build_image() {
  step "Build the control plane image" \
    "Compiles internal/platform and cmd/platform-worker into $IMAGE." \
    "" \
    "Two things worth knowing about what goes in it. Your Terraform module is" \
    "EMBEDDED in the binary by terraform/embed.go, so what you wrote in challenge 1" \
    "travels inside the image -- there is no directory mounted into the pod and" \
    "nothing to keep in sync. And terraform itself ships in the image, because the" \
    "apply runs as a subprocess of an activity." \
    "" \
    "That is also why editing Go or HCL later needs 'workshop reload' rather than a" \
    "restart: the pod never reads your files, only the copy inside this binary."
  docker build -t "$IMAGE" -f "$REPO/cmd/platform-worker/Dockerfile" "$REPO"
}

import_image() {
  local ctx node
  ctx="$(kubectl config current-context 2>/dev/null)"
  node="$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"

  if command -v k3d >/dev/null 2>&1 && k3d cluster list 2>/dev/null | grep -q platform; then
    step "Load the worker image into k3d" \
      "k3d runs its own containerd, so an image built by docker build is invisible" \
      "to the kubelet until it is imported."
    k3d image import "$IMAGE" -c platform
  elif [ "$ctx" = "docker-desktop" ] && [ "$node" = "docker-desktop" ]; then
    echo "==> docker-desktop shares the Docker daemon; nothing to import"
  elif [ "$ctx" = "docker-desktop" ]; then
    echo "ERROR: this Docker Desktop cluster cannot see locally built images." >&2
    echo >&2
    echo "  Node \"$node\" is kind-provisioned: it runs its own containerd, so the" >&2
    echo "  image you just built is invisible to the kubelet, and its node lives" >&2
    echo "  inside the Docker Desktop VM, so there is nothing to import into." >&2
    echo >&2
    echo "  Either use k3d, which is what this repo is built around:" >&2
    echo "    brew install k3d" >&2
    echo "    k3d cluster create platform -p \"30820:30820@server:0\"" >&2
    echo >&2
    echo "  or switch Docker Desktop -> Settings -> Kubernetes back to kubeadm" >&2
    echo "  provisioning, which does share the daemon." >&2
    exit 1
  else
    step "Load the worker image into k3s" \
      "k3s runs its own containerd, so the image has to be handed to it directly."
    docker save "$IMAGE" | sudo k3s ctr images import -
  fi
}

# The inverse of the platform phase, and nothing more.
#
# No announcements and no pauses: rule 10 exists so a student understands what is
# being BUILT, and narrating a teardown they already asked for is just friction in
# front of the thing they want.
#
# It stops at the control plane. Vault stays, because the Cloud API key is in it
# and re-seeding means finding the key again. The PersistentVolumeClaim stays too,
# and that one is not politeness: it holds the Terraform state for every namespace
# the platform has made, and deleting it would orphan real Cloud namespaces that
# nothing could then find or destroy. `workshop down` is the bigger hammer, and
# `workshop-teardown` is the one that cleans up the Cloud side properly.
bring_down_platform() {
  # Deliberately not require_cluster: creating a cluster in order to tear
  # something down would be absurd.
  k get nodes >/dev/null 2>&1 || { echo "no reachable cluster; nothing to do." >&2; return 0; }

  k -n platform delete deployment platform-worker --ignore-not-found
  k -n platform delete configmap platform-env --ignore-not-found
  k -n platform delete serviceaccount platform-worker --ignore-not-found

  cat <<EOF

Control plane is down.

  kept  vault, and the Cloud API key in it
  kept  pvc/platform-state -- the Terraform state for every namespace you made

Bring it back with 'workshop platform-up'. To remove Vault and the state as well,
'workshop down' deletes the whole namespace.
EOF
}

case "$PHASE" in
  base)     bring_up_base ;;
  platform) bring_up_platform ;;
  platform-down) bring_down_platform ;;
  all)      bring_up_base; bring_up_platform ;;
  forward)   require_cluster; ensure_vault_reachable; echo "vault reachable at http://127.0.0.1:$VAULT_NODEPORT" ;;
  preflight) preflight ;;
  # require_cluster first: `make platform-up` runs this phase before the platform
  # phase, so without it a missing cluster fails here -- before the code that
  # would have created one ever runs.
  build)     build_image ;;
  import)    require_cluster; import_image ;;
  *)         echo "usage: up.sh [base|platform|platform-down|build|forward|preflight|import|all]" >&2; exit 2 ;;
esac
