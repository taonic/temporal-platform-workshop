"""The platform SDK: the thin layer a product team writes against.

Named platform_sdk rather than platform because `platform` is a Python standard
library module, and shadowing it breaks things a long way from here.

A product team's whole interaction with the platform is the two decorators in
this package. Everything else -- namespaces, identities, credentials, container
images, Kubernetes -- is the platform's problem, which is the boundary the
workshop exists to draw.
"""

from platform_sdk.decorators import managed_activity, managed_workflow
from platform_sdk.registry import registry

__all__ = ["managed_workflow", "managed_activity", "registry"]
