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

	"github.com/taonic/temporal-platform-workshop/internal/cloudops"
	"github.com/taonic/temporal-platform-workshop/internal/spec"
	"github.com/taonic/temporal-platform-workshop/internal/workerconfig"
)

// defaultWorkerImage is what `deploy` builds and what `manifest` templates when
// the config does not name one.
//
// One constant because the two used to disagree: `deploy` defaulted, `manifest`
// refused, so the command the lab tells you to read the manifest with failed while
// the command that applies it worked. `gen-config` only records an image when
// asked with --image, so "not set" is the normal case rather than an error.
const defaultWorkerImage = "managed-worker:dev"

// inClusterVaultAddr is where Vault is, as seen from a pod.
//
// Deliberately NOT defaulted from $VAULT_ADDR. That variable holds the address
// Vault has from YOUR MACHINE -- http://127.0.0.1:30820, a NodePort published to
// the host -- and baking it into a Deployment produces a worker that starts, finds
// its config, and then fails with "connection refused" against localhost inside
// its own container. The flag exists for a genuinely different cluster; the host's
// address is never the right answer for a pod.
//
// And it is vault.platform.svc, not vault.default.svc: Vault is deployed into the
// platform namespace by deploy/platform/vault.yaml. The two commands here used to
// disagree about that, which meant `worker manifest` and `deploy` produced
// different Deployments from the same config.
const inClusterVaultAddr = "http://vault.platform.svc:8200"

// accountID answers "what goes after the dot in a namespace id".
//
// Three sources, cheapest first. TEMPORAL_NAMESPACE is written by
// `workshop init` and already carries it -- ws-<you>-control.<acct> -- so on a
// configured machine this costs nothing. Falling back to the API key means it
// still works in a shell that has sourced nothing, and the flag is there for the
// case neither is true.
func accountID(flag string) (string, error) {
	if flag != "" {
		return flag, nil
	}
	if ns := os.Getenv("TEMPORAL_NAMESPACE"); strings.Contains(ns, ".") {
		return ns[strings.LastIndex(ns, ".")+1:], nil
	}
	key, err := cloudKeyFromVault()
	if err != nil {
		return "", fmt.Errorf(
			"cannot work out your Cloud account id, and a namespace is only addressable "+
				"as <name>.<account-id>.\n\nEither source the env file, or pass --account-id:\n"+
				"  source \"$(./scripts/workshop env-file)\"\n\n%w", err)
	}
	return cloudops.AccountIDFromKey(key)
}

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
		configPath  string
		image       string
		vaultAddr   string
		out         string
		accountFlag string
	)

	c := &cobra.Command{
		Use:   "manifest",
		Short: "Template the Kubernetes deployment for a worker config",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := workerconfig.Load(configPath)
			if err != nil {
				return err
			}
			username, _, err := identity(cmd)
			if err != nil {
				return err
			}
			if image != "" {
				cfg.Image = image
			}
			if cfg.Image == "" {
				cfg.Image = defaultWorkerImage
			}

			acct, err := accountID(accountFlag)
			if err != nil {
				return err
			}
			body, err := renderManifest(cfg, username, vaultAddr, acct)
			if err != nil {
				return err
			}

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

	c.Flags().StringVarP(&configPath, "config", "c", "worker-config.json", "generated worker config")
	c.Flags().StringVar(&image, "image", "", "container image, overrides the config")
	c.Flags().StringVar(&vaultAddr, "vault-addr", inClusterVaultAddr, "Vault address reachable from inside the cluster")
	c.Flags().StringVarP(&out, "out", "o", "", "write here instead of stdout")
	c.Flags().StringVar(&accountFlag, "account-id", "", "Cloud account id; derived from your environment when unset")
	addIdentityFlags(c)
	return c
}

// renderManifest turns a worker config into the Deployment that runs it.
//
// Shared by `worker manifest`, which prints it, and `deploy`, which applies it.
// One renderer on purpose: two would be two answers to "which queue does this
// worker poll", and the whole point of generating the manifest is that there is
// exactly one.
func renderManifest(cfg *workerconfig.Config, username, vaultAddr, acct string) (string, error) {
	physical := fmt.Sprintf("ws-%s-%s-%s.%s", username, cfg.Namespace, cfg.Environment, acct)
	data := manifestData{
		Config:       cfg,
		K8sNamespace: cfg.Namespace,
		CloudAddress: spec.NamespaceEndpoint(physical),

		PhysicalName: physical,
		TaskQueues:   strings.Join(cfg.TaskQueues, ","),
		VaultAddr:    vaultAddr,
		VaultRole:    "worker-" + cfg.Namespace,
		Username:     username,
	}
	if data.Config.VaultPath == "" {
		data.Config.VaultPath = fmt.Sprintf("namespaces/%s/%s/%s",
			username, cfg.Namespace, cfg.Environment)
	}

	rendered := new(strings.Builder)
	if err := manifestTmpl.Execute(rendered, data); err != nil {
		return "", err
	}
	cfgJSON, err := json.MarshalIndent(cfg, "    ", "  ")
	if err != nil {
		return "", err
	}
	return strings.ReplaceAll(rendered.String(), "__WORKER_CONFIG__", string(cfgJSON)), nil
}

type manifestData struct {
	Config       *workerconfig.Config
	K8sNamespace string
	CloudAddress string
	PhysicalName string
	TaskQueues   string
	VaultAddr    string
	VaultRole    string
	Username     string
}

// The ConfigMap is not decoration. OpenAI's operator reads generated configs
// deployed as ConfigMaps; mounting it here keeps that shape, and it means the
// worker's declared queues are inspectable with kubectl rather than baked opaquely
// into an image.
var manifestTmpl = template.Must(template.New("manifest").Parse(`# Generated by tpctl. Do not edit -- regenerate with:
#   tpctl worker gen-config --out worker-config.json
#   tpctl worker manifest -o deploy/{{ .Config.Service }}.yaml
#
# Everything lands in its own Kubernetes namespace, named after the spec. The
# control plane lives in "platform" and this is somebody else's workload, so
# sharing a namespace with it -- or landing in "default", which is what happens
# when a manifest says nothing -- would be an accident rather than a decision.
#
# It also makes the Vault binding mean something: a role bound to
# bound_service_account_namespaces={{ .K8sNamespace }} grants this team's workers and
# nobody else's. Bound to "default" it would grant anything anyone deployed.
apiVersion: v1
kind: Namespace
metadata:
  name: {{ .K8sNamespace }}
  labels:
    owner: {{ .Config.Owner }}
    managed-by: tpctl
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ .Config.Service }}
  namespace: {{ .K8sNamespace }}
  labels:
    app: {{ .Config.Service }}
    owner: {{ .Config.Owner }}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Config.Service }}-config
  namespace: {{ .K8sNamespace }}
data:
  worker-config.json: |
    __WORKER_CONFIG__
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Config.Service }}
  namespace: {{ .K8sNamespace }}
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
            # Set explicitly. Without it the worker falls back to us-west-2, and a
            # namespace in any other region answers "Request unauthorized" -- which
            # reads as a credential problem and is a routing one.
            - name: TEMPORAL_ADDRESS
              value: "{{ .CloudAddress }}"
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
          ports:
            - name: health
              containerPort: 8080
          # Readiness, not liveness, and the difference is the point.
          #
          # /healthz is served only after the client has connected and the workers
          # are polling -- so "not ready" means exactly "not polling". Everything
          # that goes wrong here goes wrong before that: no credential in Vault,
          # a namespace that does not exist, Cloud unreachable.
          #
          # No livenessProbe on purpose. A worker that has lost its connection
          # retries with backoff, and killing it mid-retry replaces a recovering
          # worker with a cold start. Restarting a process is not a fix for a
          # network that is down, and a liveness probe here would turn a blip into
          # a crash loop.
          readinessProbe:
            httpGet: { path: /healthz, port: health }
            periodSeconds: 10
            failureThreshold: 3
          startupProbe:
            httpGet: { path: /healthz, port: health }
            periodSeconds: 5
            # Generous: the first start fetches a credential from Vault and dials
            # Cloud, and neither is instant on a laptop.
            failureThreshold: 24
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
