---
slug: workshop
id: qzzm0tgqgxps
type: challenge
title: Your workshop sandbox
teaser: Everything the prerequisites ask you to install is already here. Your instructions
  live in the workshop portal.
notes:
- type: text
  contents: |-
    ## This sandbox replaces your laptop, not your browser

    Every tool the workshop needs is already installed, at the right version, and
    warmed up: the Temporal CLI with `temporal cloud`, Terraform, Go, Python with
    `uv`, Docker, the Vault CLI, and a k3s cluster that is already running.

    **Your instructions are not here.** They live in the workshop portal, in a tab
    of your own browser, because the portal knows who you are — it fills your
    username, cohort and region into every command and grades your work against
    the real Temporal Cloud account as you go. The terminal printed your join link
    when this sandbox came up: open it, pick a username, and keep the portal and
    this window side by side all day.

    **Click the Editor tab once before you need it.** `code <file>` hands the file
    to an editor window that has to already be open. `nano` and `vim` work too.

    Lost? `./scripts/workshop`, run on its own from the repo root, lists every
    verb in the workshop.
tabs:
- id: h8nnzkc9mmpl
  title: Terminal
  type: terminal
  hostname: platform-workshop
- id: ftbq2snqmqpz
  title: Editor
  type: service
  hostname: platform-workshop
  port: 8443
difficulty: intermediate
timelimit: 28800
lab_config:
  custom_layout: '{"root":{"children":[{"leaf":{"tabs":["h8nnzkc9mmpl","ftbq2snqmqpz"],"activeTabId":"h8nnzkc9mmpl","size":100}}],"orientation":"Horizontal"}}'
enhanced_loading: null
---
