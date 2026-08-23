// Package workerconfig is the Go half of the one contract that crosses the
// language seam.
//
// The namespace spec never leaves Go, so it needs no schema file. This does: the
// Python side emits it from the decorated workflows, the Python worker validates
// it on boot, and this package reads it when the CLI templates a Kubernetes
// manifest. Two languages, one JSON Schema, one golden fixture they must both
// round-trip. See DESIGN.md rule 7.
package workerconfig

import (
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

//go:embed all:schema
var schemaFS embed.FS

const schemaPath = "schema/workerconfig.schema.json"

type Entry struct {
	Name      string `json:"name"`
	TaskQueue string `json:"taskQueue"`
}

type Config struct {
	Version     int      `json:"version"`
	Service     string   `json:"service"`
	Owner       string   `json:"owner"`
	Namespace   string   `json:"namespace"`
	Environment string   `json:"environment"`
	Image       string   `json:"image,omitempty"`
	TaskQueues  []string `json:"taskQueues"`
	Workflows   []Entry  `json:"workflows"`
	Activities  []Entry  `json:"activities,omitempty"`
	VaultPath   string   `json:"vaultPath,omitempty"`
}

// Load reads a worker config and validates it against the shared schema.
//
// Validating here as well as in Python is not belt-and-braces for its own sake: a
// config that reaches the manifest templater malformed produces a Deployment that
// fails in Kubernetes, where the error message is about a container rather than
// about a config.
func Load(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if err := Validate(raw); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	var c Config
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return &c, nil
}

// Validate checks a raw JSON document against the schema.
func Validate(raw []byte) error {
	schema, err := compiled()
	if err != nil {
		return err
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return fmt.Errorf("not valid JSON: %w", err)
	}
	if err := schema.Validate(doc); err != nil {
		return fmt.Errorf("worker config does not match %s:\n%v", schemaPath, err)
	}
	return nil
}

func compiled() (*jsonschema.Schema, error) {
	data, err := schemaFS.ReadFile(schemaPath)
	if err != nil {
		return nil, fmt.Errorf("reading embedded schema: %w", err)
	}
	doc, err := jsonschema.UnmarshalJSON(strings.NewReader(string(data)))
	if err != nil {
		return nil, err
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource(schemaPath, doc); err != nil {
		return nil, err
	}
	return c.Compile(schemaPath)
}
