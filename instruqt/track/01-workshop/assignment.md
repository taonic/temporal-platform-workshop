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

    Every tool the workshop needs — the Temporal CLI including `temporal cloud`,
    Terraform, Go, Python with `uv`, Docker, the Vault CLI, k3s — is already
    installed here, at the right version, with the provider cache warmed, k3s
    running and both container images already in its image store. A cold
    `terraform init` against `temporalio/temporalcloud` is a silent two-minute
    stall, and it has already happened.

    **Your instructions are not in this panel.** They live in the workshop portal,
    in a separate tab of your own browser, because the portal knows who you are:
    it names your namespaces, fills your username, cohort and region into every
    command, and grades your work against the real Temporal Cloud account while
    you go.

    The terminal printed your join link when this sandbox came up. Open it, pick a
    username, and keep the portal and this window side by side all day.

    ### Two tabs, and one of them needs a click

    **Terminal** opens in `/workspace/platform`, the repo every lab command is
    written to run from. **Editor** is VS Code on the same directory — click it
    once now, before the first lab step that says `code <file>`, because `code`
    hands the file to an editor window that has to already be open. `nano` and
    `vim` are there if you would rather not leave the terminal.

    ### The one command to know

    `./scripts/workshop` from the repo root, run on its own, lists every verb.
    That is the whole interface — the Make targets are reachable through it too,
    so you never have to work out which half of the workshop is Make.

    Nothing is running against Temporal yet, on purpose. There is no local dev
    server and no control plane: the first thing you build is the namespace your
    control plane will run on, and the first command of challenge 1 is what brings
    Vault up to hold your Cloud API key.
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
