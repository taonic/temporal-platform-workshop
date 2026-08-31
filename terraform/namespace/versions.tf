# Pinned deliberately: namespace_scoped_access postdates the 0.9 line and the
# reconciler depends on it. (temporalcloud_namespace_tags did too, and used to be
# named here -- the module no longer manages tags at all; see variables.tf.)
terraform {
  required_version = ">= 1.5"

  required_providers {
    temporalcloud = {
      source  = "temporalio/temporalcloud"
      version = "~> 1.6"
    }
  }
}

# No provider block with arguments on purpose. The provider reads
# TEMPORAL_CLOUD_API_KEY from the environment, and the reconciler puts it there
# from Vault for the lifetime of one activity attempt. Nothing is written to disk
# and no variable carries a credential.
