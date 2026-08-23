package workerconfig

import (
	"os"
	"path/filepath"
	"testing"
)

// goldenFixture is the same file worker/tests/test_config.py reads. Two languages,
// one document. If either side stops agreeing with it, a test fails here or there
// before anything reaches a cluster.
const goldenFixture = "../../worker/tests/fixtures/worker-config.json"

func TestLoadGoldenFixture(t *testing.T) {
	cfg, err := Load(goldenFixture)
	if err != nil {
		t.Fatalf("loading the golden fixture: %v", err)
	}

	if cfg.Version != 1 {
		t.Errorf("version = %d, want 1", cfg.Version)
	}
	if cfg.Service != "orders-staging-worker" {
		t.Errorf("service = %q", cfg.Service)
	}
	if cfg.Namespace != "orders" || cfg.Environment != "staging" {
		t.Errorf("namespace/environment = %q/%q", cfg.Namespace, cfg.Environment)
	}
	if len(cfg.TaskQueues) != 1 || cfg.TaskQueues[0] != "orders-main" {
		t.Errorf("taskQueues = %v", cfg.TaskQueues)
	}
	if len(cfg.Workflows) != 1 || cfg.Workflows[0].Name != "GreetingWorkflow" {
		t.Errorf("workflows = %+v", cfg.Workflows)
	}
}

func TestRejectsUnknownEnvironment(t *testing.T) {
	raw := []byte(`{
	  "version": 1, "service": "a-staging-worker", "owner": "t", "namespace": "a",
	  "environment": "production",
	  "taskQueues": ["q"], "workflows": [{"name": "W", "taskQueue": "q"}]
	}`)
	if err := Validate(raw); err == nil {
		t.Fatal("expected 'production' to be rejected; the enum is staging|prod")
	}
}

func TestRejectsMissingWorkflows(t *testing.T) {
	raw := []byte(`{
	  "version": 1, "service": "a-staging-worker", "owner": "t", "namespace": "a",
	  "environment": "staging", "taskQueues": ["q"], "workflows": []
	}`)
	if err := Validate(raw); err == nil {
		t.Fatal("expected an empty workflow list to be rejected")
	}
}

// TestEmbeddedSchemaMatchesSource guards the copy go:embed forces us to keep.
func TestEmbeddedSchemaMatchesSource(t *testing.T) {
	embedded, err := schemaFS.ReadFile(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(filepath.Join("..", "..", "schema", "workerconfig.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(embedded) != string(source) {
		t.Error("the embedded schema has drifted from schema/workerconfig.schema.json; run `make sync-schema`")
	}
}
