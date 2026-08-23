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

variable "tags" {
  description = "Complete tag set for the namespace. This resource manages the whole set, so the reconciler always sends every tag it wants."
  type        = map(string)
}
