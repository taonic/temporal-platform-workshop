---
slug: be-the-developer
id: 05
type: challenge
title: Be the developer
teaser: Empty directory. Stopwatch. Go.
notes:
  - type: text
    contents: |-
      OpenAI's platform team measured one number: **time to first workflow**. It
      was one to two weeks. After the paved road, it was a day.

      You have spent four challenges building a platform. You have not once used
      it as a customer. Take the platform hat off.
tabs:
  - id: terminal
    title: Terminal
    type: terminal
    hostname: platform-workshop
    workdir: /workspace/newteam
  - id: editor
    title: Editor
    type: code
    hostname: platform-workshop
    path: /workspace/platform
  # No local dev server on this branch: the control plane runs on a Temporal
  # Cloud namespace, so the UI is the real one.
  - id: temporal
    title: Temporal UI
    type: external
    url: https://cloud.temporal.io
difficulty: advanced
timelimit: 2700
---

You are a developer on a different team. You have heard there is a platform. You
have an empty directory and no Temporal Cloud login.

**Get a workflow to complete.** Time yourself.

You may use only what the platform gives you: `nsctl`, the decorators, and the
generated config. You may not open the Cloud UI, write Terraform, or touch a
credential.

<details>
<summary>If you get stuck, the shape of it</summary>

```bash
nsctl new --non-interactive --name payments --owner risk-team --retention 7 \
  --environments staging
nsctl apply -f specs/payments.yaml
# write a decorated workflow
nsctl worker gen-config --out generated/payments.json
# run the worker, start the workflow
```
</details>

### Then: the argument you now get to have

At 14:28 in the Replay talk, OpenAI says: *"all of this could actually be done in
terraform, but at our scale terraform was making us slow"* — and replaced it with a
Kubernetes operator.

You just built the same control loop as a Temporal entity workflow. Sit with the
comparison for ten minutes:

| | k8s operator | entity workflow |
|---|---|---|
| Durability | requeue on restart, state in etcd | durable by construction |
| Retry | exponential backoff, opaque | per-activity policy, visible |
| Audit | controller logs | event history, for the retention period |
| Concurrency | leader election | workflow id uniqueness |
| Human in the loop | a new CRD and a webhook | a signal |

The last two rows are the interesting ones. **You never wrote a lock**, because the
workflow id was the resource identity. And if tomorrow you need retention changes
above 30 days to require approval, that is a signal and a `workflow.Await` — not a
new controller.

That is the argument. It is worth being able to make it out loud.
