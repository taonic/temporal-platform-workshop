"""Every workflow module has to be imported here.

That is a real sharp edge and it is left visible on purpose. A decorator only runs
when its module is imported, so a workflow in a module nobody imports is invisible
to the registry -- and a worker that does not know about a workflow will happily
start, poll, and never pick up a single task.

This is the failure platform teams call out by name: always register the workflow
at bootstrap, because it is the step people miss. The platform cannot stop you
forgetting an import, but it can refuse to start when the config and the code
disagree -- see platform_sdk/validate.py. Try deleting a line here and running the
worker.
"""

from workflows import greeting  # noqa: F401

__all__ = ["greeting"]
