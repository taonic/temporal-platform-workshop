// GENERATED from the reference solution. Do not hand-edit the code below --
// `pnpm snippets:emit` writes it back to terraform/namespace/main.tf and `./scripts/workshop verify` compiles it
// there, so a drifted copy fails CI rather than a student's paste.
export const NAMESPACE_MAIN_TF = `# One physical namespace, and the identity its workers run as.
#
# Note what is NOT here: the API key. temporalcloud_apikey exposes .token as a
# readable attribute, so minting a key in Terraform would write a live credential
# in plaintext into remote state. The reconciler mints keys through the Cloud Ops
# API in a separate activity and writes them straight to Vault. See DESIGN.md
# rule 2.

resource "temporalcloud_namespace" "ns" {
  name           = var.namespace_name
  regions        = [var.region]
  retention_days = var.retention_days

  # Every worker in this workshop authenticates with an API key. A namespace
  # created without this cannot be switched over afterwards.
  api_key_auth = true
}

# Namespace-scoped, write permission. A worker's job is entirely on the data
# plane: it polls a task queue and completes tasks. It never calls the Ops API,
# so it gets no account-level access at all.
resource "temporalcloud_service_account" "worker" {
  name        = "\${var.namespace_name}-worker"
  description = "Data-plane identity for workers on \${var.namespace_name}. Managed by the platform reconciler."

  namespace_scoped_access = {
    namespace_id = temporalcloud_namespace.ns.id
    permission   = "write"
  }
}
`;
