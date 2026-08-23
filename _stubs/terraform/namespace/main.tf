# ============================================================================
# Lab 1 — Spec to workflow
#
# Goal: the reconciler already knows how to run Terraform. It has nothing to run.
#       Write the module it applies.
#
# Write below:
#   · one temporalcloud_namespace, named var.namespace_name. The reconciler
#     derives that name from your leased slot, so do not hard-code anything —
#     Temporal Cloud reserves a namespace name after deletion, and the slot is
#     what makes names recyclable.
#   · api_key_auth = true. Every worker in this workshop authenticates with an
#     API key, and a namespace created without this cannot be switched over
#     afterwards.
#   · regions = [var.region] and retention_days = var.retention_days.
#   · one temporalcloud_service_account for the worker, named
#     "${var.namespace_name}-worker", and NAMESPACE-SCOPED:
#
#         namespace_scoped_access = {
#           namespace_id = <the namespace above>
#           permission   = "write"
#         }
#
#     Not account_access. A worker's job is entirely on the data plane — it polls
#     a task queue and completes tasks — so it needs no account-level access at
#     all. namespace_scoped_access and account_access are mutually exclusive, and
#     the namespace assignment is immutable after creation: scope it to the wrong
#     namespace and you destroy and recreate, key included.
#   · one temporalcloud_namespace_tags with tags = var.tags. That resource
#     manages the COMPLETE tag set, so a second one anywhere would wipe the
#     first. The reconciler always sends every tag it wants.
#
# And in outputs.tf, which you also write:
#   · output "namespace_id"       — the namespace's id
#   · output "service_account_id" — the worker identity's id
#
#     The reconciler reads both by name. Get them wrong and the apply succeeds
#     while the workflow fails on a missing output, which is a genuinely
#     confusing failure — so this is worth reading twice.
#
# What you must NOT write here: temporalcloud_apikey.
#
#   That resource exposes .token as a readable attribute, and `sensitive = true`
#   masks CLI output without encrypting anything. Minting a key here would write
#   a live credential in plaintext into remote state — which in this workshop is
#   a volume on a single Fly machine. The platform mints keys through the Cloud
#   Ops API in a separate activity that writes straight to Vault and returns a
#   path. It also means `terraform destroy` cannot revoke every worker's auth,
#   and rotation is not state surgery.
#
#   The grader checks that no credential appears in the workflow's event history.
#
# The variables are declared for you in variables.tf, and the provider is pinned
# in versions.tf. The provider reads TEMPORAL_CLOUD_API_KEY from the environment,
# which the reconciler sets from Vault for the lifetime of one activity attempt —
# so there is no variable to thread through and no tfvars file to forget to
# gitignore.
#
# Check your work without touching the Cloud:  terraform validate
# ============================================================================
