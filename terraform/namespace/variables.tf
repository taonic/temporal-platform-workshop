variable "namespace_name" {
  description = "Physical namespace name, e.g. ws-7-staging. Leased from the slot pool, never derived from a participant id, because Temporal Cloud reserves names after deletion."
  type        = string
}

variable "region" {
  description = "Single region. The workshop fans out across environments, not regions."
  type        = string
}

variable "retention_days" {
  description = "Workflow history retention."
  type        = number
}

# No "tags" variable. There used to be one, feeding a temporalcloud_namespace_tags
# resource, and both are gone: UpdateNamespaceTags is granted to Account Owner and
# Global Admin only, and the reconciler runs as a Developer service account on
# purpose. See DESIGN.md rule 3.
#
# It outlived the resource it fed, which is worse than useless -- a required
# variable with no default and no consumer fails every apply with
# "No value for required variable", pointing at a line that explains nothing.
