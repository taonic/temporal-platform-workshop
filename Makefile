.PHONY: build test lab-test py-test tf-validate lint clean dev worker-image sync-schema solve unsolve verify

BIN := bin

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

build: $(BIN)/nsctl $(BIN)/platform-worker $(BIN)/tfstate

$(BIN)/nsctl:           ; go build -o $@ ./cmd/nsctl
$(BIN)/platform-worker: ; go build -o $@ ./cmd/platform-worker
$(BIN)/tfstate:         ; go build -o $@ ./services/state

# The platform control plane. Needs Vault reachable with the Cloud API key in it.
dev: build
	./$(BIN)/platform-worker

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
