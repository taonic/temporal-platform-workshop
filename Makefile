BIN := bin

# `make` on its own lists the verbs. This is the interface: everything a student
# types is `make <verb>`, with one exception -- ./scripts/workshop-creds, which
# wraps arbitrary commands and prompts, neither of which Make can express.
.DEFAULT_GOAL := help

help:
	@echo "Environment"
	@echo "  check          probe tools, cluster, vault, egress, control plane"
	@echo "  base-up        k3s, vault, kubernetes auth, seed the cloud key"
	@echo "  platform-up    build the worker image and deploy the control plane"
	@echo "  up             both of the above"
	@echo "  reload         rebuild + redeploy after editing anything compiled in"
	@echo "  logs           follow the control plane"
	@echo "  vault-forward  restart the vault port-forward if it died"
	@echo "  down           delete the platform namespace"
	@echo
	@echo "Build and test"
	@echo "  build          nsctl, platform-worker, tfstate"
	@echo "  test lab-test  your feedback loop; FAILS until you have done the labs"
	@echo "  verify         apply the answers, run everything, restore the stubs"
	@echo
	@echo "Credentials and variables: ./scripts/workshop-creds {init|exec|control|show|env-file}"

# BIN is defined first on purpose: .PHONY expands its prerequisites when the line
# is read, so declaring it above the assignment would silently make the binary
# targets non-phony again.
.PHONY: build test lab-test py-test tf-validate lint clean dev worker-image sync-schema solve unsolve verify \
        $(BIN)/nsctl $(BIN)/platform-worker $(BIN)/tfstate \
        platform-image k3s-import up base-up platform-up cluster-check reload logs vault-forward down check help

# The five files a student writes. Prose stubs live in _stubs/; the ANSWERS live in
# the portal, as the snippets students read -- there is no solutions directory, so
# there is only ever one copy of an answer.
#
# `make solve` emits the portal's snippets into the tree, which is how the answer
# key gets compiled and tested. A snippet that stops working therefore fails CI
# rather than a student's paste.
#
# _stubs/ starts with an underscore so the go tool ignores it -- otherwise it would
# try to compile two copies of package platform.
LAB_GO   := internal/platform/environment.go internal/platform/wait.go
LAB_TF   := terraform/namespace/main.tf terraform/namespace/outputs.tf
LAB_PY   := worker/workflows/greeting.py

# Phony, all three. These were file targets with no prerequisites, which meant
# make considered them up to date the moment the binary existed and silently
# skipped the rebuild after a source edit -- the worst possible failure for the
# labs, where the whole point is that your edit changes what the platform does.
build: $(BIN)/nsctl $(BIN)/platform-worker $(BIN)/tfstate

$(BIN)/nsctl:           ; go build -o $@ ./cmd/nsctl
$(BIN)/platform-worker: ; go build -o $@ ./cmd/platform-worker
$(BIN)/tfstate:         ; go build -o $@ ./services/state

# The platform control plane. Needs Vault reachable with the Cloud API key in it.
dev: build
	./$(BIN)/platform-worker

# ---------------------------------------------------------------------------
# k3s + Temporal Cloud. No local dev server, no host processes but k3s.
#
# The inner loop for challenges 1 to 3. Every one of them edits something that is
# compiled into the worker -- the Terraform module included, because
# terraform/embed.go embeds it -- so an edit is not live until the image is
# rebuilt and the Deployment restarted.
# ---------------------------------------------------------------------------
platform-image:
	docker build -t platform-worker:dev -f cmd/platform-worker/Dockerfile .

# Every recipe below is one or two lines on purpose. Anything with branching,
# detection or a multi-line message lives in deploy/platform/up.sh instead --
# Make runs each recipe line in its own shell, and backslash-continued
# conditionals here have already produced two silent bugs.
k3s-import: platform-image
	@./deploy/platform/up.sh import

# base-up is provisioning's job and holds the Cloud key for exactly as long as it
# takes to write it to Vault. platform-up is the student's, and needs no
# credential at all -- the pod authenticates to Vault as its ServiceAccount.
base-up:
	@./deploy/platform/up.sh base

platform-up: platform-image k3s-import
	@./deploy/platform/up.sh platform

up: base-up platform-up

cluster-check:
	@./deploy/platform/up.sh preflight

reload: cluster-check k3s-import
	kubectl -n platform rollout restart deploy/platform-worker
	kubectl -n platform rollout status  deploy/platform-worker --timeout=180s

logs:
	kubectl -n platform logs -f deploy/platform-worker

# Every probe, run every time -- a diagnostic, not a gate. Exits non-zero only if
# something is genuinely broken; "not built yet" is a warning.
check:
	@./scripts/workshop-check

# Recovery. A port-forward is a process, and processes die -- if `vault kv get`
# starts refusing connections mid-workshop, this is the fix. A no-op on k3s,
# where the NodePort is genuinely open.
vault-forward:
	@./deploy/platform/up.sh forward

down:
	kubectl delete namespace platform --ignore-not-found

# ---------------------------------------------------------------------------
# Two different questions, two different targets.
#
#   make test / lab-test   your feedback loop. FAILS until you have done the labs.
#   make verify            repo health: applies the solutions, runs everything,
#                          puts the stubs back. This is what CI runs.
# ---------------------------------------------------------------------------

# Labs 2 and 3. Fails on a fresh clone, on purpose.
test:
	go test ./...

# Lab 4. Fails on a fresh clone, on purpose.
lab-test:
	cd worker && uv run pytest -q -m lab

# Contract tests only: the schema and the golden fixture. Always green.
py-test:
	cd worker && uv run pytest -q -m "not lab"

tf-validate:
	cd terraform/namespace && terraform init -backend=false -input=false >/dev/null && terraform validate

lint:
	go vet ./...
	gofmt -l cmd internal services

worker-image:
	docker build -t platform-worker:dev ./worker

# ---------------------------------------------------------------------------
# Instructor tooling. `solve` is also the honest way to see how a lab ends up.
# ---------------------------------------------------------------------------

# Sourced from the portal's snippets: one copy of every answer, and it is the copy
# students actually read. Needs `pnpm install` in portal/.
solve:
	cd portal && pnpm snippets:emit --out ..

unsolve:
	@rm -f terraform/namespace/outputs.tf
	@for f in $(LAB_GO) $(LAB_PY) terraform/namespace/main.tf; do cp _stubs/$$f $$f; echo "  stubbed $$f"; done

# Prove the answers students are shown actually work, then leave the repo as a
# student finds it. This is the snippet-compile check: without it, deleting the
# solutions directory would have been a straight downgrade, because nothing else
# ever compiles a TypeScript string literal.
verify:
	cd portal && pnpm snippets:check
	@$(MAKE) --no-print-directory solve
	go build ./...
	go vet ./...
	go test ./...
	cd worker && uv run pytest -q
	cd terraform/namespace && terraform init -backend=false -input=false >/dev/null && terraform validate
	@$(MAKE) --no-print-directory unsolve
	@echo
	@echo "verified: the portal's snippets build, pass and validate. Stubs restored."

# go:embed cannot reach outside its package directory, so the schema is copied in
# two places. Two tests fail if the copies drift; this fixes them.
sync-schema:
	cp schema/workerconfig.schema.json internal/workerconfig/schema/workerconfig.schema.json
	cp schema/workerconfig.schema.json worker/schema/workerconfig.schema.json

clean:
	rm -rf $(BIN) generated
