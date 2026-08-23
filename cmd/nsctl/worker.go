package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/spf13/cobra"

	"github.com/taonic/temporal-platform-workshop/internal/workerconfig"
)

// workerCmd is the paved road's front end.
func workerCmd() *cobra.Command {
	c := &cobra.Command{Use: "worker", Short: "Generate worker config and deployment manifests"}
	c.AddCommand(genConfigCmd(), manifestCmd())
	return c
}

// genConfigCmd is a facade. It shells out to Python.
//
// It has to. The decorators live in Python, so only Python can introspect what the
// workflows declared -- and reimplementing that in Go would create a second source
// of truth that silently disagrees with the first. The CLI stays the one command a
// student has to remember; the logic stays where the information is.
//
// This is a real platform lesson dressed up as an implementation detail: a
// platform CLI is a user interface, and it delegates to the ecosystem's native
// tooling rather than rebuilding it.
func genConfigCmd() *cobra.Command {
	var (
		dir string
		out string
	)

	c := &cobra.Command{
		Use:   "gen-config",
		Short: "Generate worker config from the decorated workflows (delegates to Python)",
		RunE: func(cmd *cobra.Command, args []string) error {
			py := exec.Command("uv", "run", "python", "-m", "platform_sdk.genconfig")
			py.Dir = dir
			py.Stderr = os.Stderr
			py.Stdout = os.Stdout

			if out != "" {
				// Resolved before handing it to a subprocess with a different
				// working directory. Otherwise `--out generated/x.json` from the
				// repo root quietly writes into worker/generated/.
				abs, err := filepath.Abs(out)
				if err != nil {
					return err
				}
				py.Args = append(py.Args, "--out", abs)
			}

			if err := py.Run(); err != nil {
				return fmt.Errorf("generating worker config in %s: %w\n\nIs `uv sync` done in that directory?", dir, err)
			}
			return nil
		},
	}

	c.Flags().StringVar(&dir, "dir", "worker", "directory containing the Python worker")
	c.Flags().StringVar(&out, "out", "", "write the config here instead of stdout")
	return c
}

// manifestCmd templates the Kubernetes deployment from a generated worker config.
//
// The manifest is generated, never hand-written, for the same reason the config is:
// so that "which queue does this worker poll" has exactly one answer, traceable
// back to the workflow that declared it.
func manifestCmd() *cobra.Command {
	var (
		configPath string
		image      string
		vaultAddr  string
		out        string
	)

	c := &cobra.Command{
		Use:   "manifest",
		Short: "Template the Kubernetes deployment for a worker config",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := workerconfig.Load(configPath)
			if err != nil {
				return err
			}
			participant, slot, err := identity(cmd)
			if err != nil {
				return err
			}
			if image != "" {
				cfg.Image = image
			}
			if cfg.Image == "" {
				return fmt.Errorf("no image: pass --image or set it in %s", configPath)
			}

			data := manifestData{
				Config:       cfg,
				PhysicalName: fmt.Sprintf("ws-%d-%s-%s", slot, cfg.Namespace, cfg.Environment),
				TaskQueues:   strings.Join(cfg.TaskQueues, ","),
				VaultAddr:    vaultAddr,
				VaultRole:    "worker-" + cfg.Namespace,
				Participant:  participant,
			}
			if data.Config.VaultPath == "" {
				data.Config.VaultPath = fmt.Sprintf("namespaces/%s/%s/%s",
					participant, cfg.Namespace, cfg.Environment)
			}

			rendered := new(strings.Builder)
			if err := manifestTmpl.Execute(rendered, data); err != nil {
				return err
			}

			cfgJSON, err := json.MarshalIndent(cfg, "    ", "  ")
			if err != nil {
				return err
			}
			body := strings.ReplaceAll(rendered.String(), "__WORKER_CONFIG__", string(cfgJSON))

			if out == "" {
				fmt.Print(body)
				return nil
			}
			if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(out, []byte(body), 0o644); err != nil {
				return err
			}
			fmt.Printf("wrote %s\n\n  kubectl apply -f %s\n", out, out)
			return nil
		},
	}

	c.Flags().StringVarP(&configPath, "config", "c", "generated/worker-config.json", "generated worker config")
	c.Flags().StringVar(&image, "image", "", "container image, overrides the config")
	c.Flags().StringVar(&vaultAddr, "vault-addr", envOr("VAULT_ADDR", "http://vault.default.svc:8200"), "Vault address reachable from inside the cluster")
	c.Flags().StringVarP(&out, "out", "o", "", "write here instead of stdout")
	addIdentityFlags(c)
	return c
}

type manifestData struct {
	Config       *workerconfig.Config
	PhysicalName string
	TaskQueues   string
	VaultAddr    string
	VaultRole    string
	Participant  string
}

// The ConfigMap is not decoration. OpenAI's operator reads generated configs
// deployed as ConfigMaps; mounting it here keeps that shape, and it means the
// worker's declared queues are inspectable with kubectl rather than baked opaquely
// into an image.
var manifestTmpl = template.Must(template.New("manifest").Parse(`# Generated by nsctl. Do not edit -- regenerate with:
#   nsctl worker gen-config --out generated/worker-config.json
#   nsctl worker manifest -o deploy/{{ .Config.Service }}.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ .Config.Service }}
  labels:
    app: {{ .Config.Service }}
    owner: {{ .Config.Owner }}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Config.Service }}-config
data:
  worker-config.json: |
    __WORKER_CONFIG__
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Config.Service }}
  labels:
    app: {{ .Config.Service }}
    owner: {{ .Config.Owner }}
    environment: {{ .Config.Environment }}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: {{ .Config.Service }}
  template:
    metadata:
      labels:
        app: {{ .Config.Service }}
    spec:
      serviceAccountName: {{ .Config.Service }}
      containers:
        - name: worker
          image: {{ .Config.Image }}
          imagePullPolicy: IfNotPresent
          args: ["--config", "/etc/worker/worker-config.json"]
          env:
            - name: TEMPORAL_NAMESPACE
              value: "{{ .PhysicalName }}"
            - name: TEMPORAL_TASK_QUEUES
              value: "{{ .TaskQueues }}"
            # No credential here, and none in the image. The worker reads its API
            # key from Vault, authenticating as this pod's ServiceAccount. The root
            # token that worked from a shell does not exist in here -- that is the
            # whole point of the switch.
            - name: VAULT_ADDR
              value: "{{ .VaultAddr }}"
            - name: VAULT_K8S_ROLE
              value: "{{ .VaultRole }}"
            - name: VAULT_SECRET_PATH
              value: "{{ .Config.VaultPath }}"
          volumeMounts:
            - name: config
              mountPath: /etc/worker
              readOnly: true
          resources:
            requests: { cpu: 100m, memory: 192Mi }
            limits: { cpu: "1", memory: 512Mi }
      volumes:
        - name: config
          configMap:
            name: {{ .Config.Service }}-config
`))
