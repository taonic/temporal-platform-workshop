// GENERATED from the reference solution. Do not hand-edit the code below --
// `pnpm snippets:emit` writes it back to terraform/namespace/outputs.tf and `make verify` compiles it
// there, so a drifted copy fails CI rather than a student's paste.
export const NAMESPACE_OUTPUTS_TF = `output "namespace_id" {
  description = "Fully qualified namespace id, e.g. ws-7-staging.acct1."
  value       = temporalcloud_namespace.ns.id
}

output "service_account_id" {
  description = "Owner id for the API key the reconciler mints outside Terraform."
  value       = temporalcloud_service_account.worker.id
}
`;
