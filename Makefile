.PHONY: build test tf-validate py-test lint clean dev worker-image sync-schema

BIN := bin

build: $(BIN)/nsctl $(BIN)/platform-worker $(BIN)/tfstate

$(BIN)/nsctl:           ; go build -o $@ ./cmd/nsctl
$(BIN)/platform-worker: ; go build -o $@ ./cmd/platform-worker
$(BIN)/tfstate:         ; go build -o $@ ./services/state

# The platform control plane. Needs TEMPORAL_CLOUD_API_KEY (or Vault) in the env.
dev: build
	./$(BIN)/platform-worker

test:
	go test ./...

py-test:
	cd worker && uv run pytest -q

tf-validate:
	cd terraform/namespace && terraform init -backend=false -input=false >/dev/null && terraform validate

lint:
	go vet ./...
	gofmt -l cmd internal services

# go:embed cannot reach outside its package directory, so the schema is copied in
# two places. Two tests fail if the copies drift; this fixes them.
sync-schema:
	cp schema/workerconfig.schema.json internal/workerconfig/schema/workerconfig.schema.json
	cp schema/workerconfig.schema.json worker/schema/workerconfig.schema.json

worker-image:
	docker build -t platform-worker:dev ./worker

clean:
	rm -rf $(BIN) generated
