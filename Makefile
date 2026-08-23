.PHONY: build test lab-test py-test tf-validate lint clean dev worker-image sync-schema solve unsolve verify

BIN := bin

# The five files a student writes. Complete versions live in _solutions/, prose
# stubs in _stubs/. Both directories start with an underscore so the go tool
# ignores them entirely -- otherwise it would try to compile two copies of the
# same package.
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

solve:
	@for f in $(LAB_GO) $(LAB_TF) $(LAB_PY); do cp _solutions/$$f $$f; echo "  solved $$f"; done

unsolve:
	@rm -f terraform/namespace/outputs.tf
	@for f in $(LAB_GO) $(LAB_PY) terraform/namespace/main.tf; do cp _stubs/$$f $$f; echo "  stubbed $$f"; done

# Prove the solutions actually work, then leave the repo as a student finds it.
# Without this, solutions rot silently the first time an interface changes.
verify:
	@$(MAKE) --no-print-directory solve
	go build ./...
	go vet ./...
	go test ./...
	cd worker && uv run pytest -q
	cd terraform/namespace && terraform init -backend=false -input=false >/dev/null && terraform validate
	@$(MAKE) --no-print-directory unsolve
	@echo
	@echo "verified: the solutions build, pass and validate. Stubs restored."

# go:embed cannot reach outside its package directory, so the schema is copied in
# two places. Two tests fail if the copies drift; this fixes them.
sync-schema:
	cp schema/workerconfig.schema.json internal/workerconfig/schema/workerconfig.schema.json
	cp schema/workerconfig.schema.json worker/schema/workerconfig.schema.json

clean:
	rm -rf $(BIN) generated
