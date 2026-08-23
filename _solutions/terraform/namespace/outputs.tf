output "namespace_id" {
  description = "Fully qualified namespace id, e.g. ws-7-staging.acct1."
  value       = temporalcloud_namespace.ns.id
}

output "service_account_id" {
  description = "Owner id for the API key the reconciler mints outside Terraform."
  value       = temporalcloud_service_account.worker.id
}
