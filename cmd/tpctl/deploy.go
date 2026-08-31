package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/taonic/temporal-platform-workshop/internal/spec"
	"github.com/taonic/temporal-platform-workshop/internal/workerconfig"
)

// deployCmd is the paved road with the seams closed.
//
// Everything it does was already possible: gen-config, manifest, docker build, an
// image import, kubectl apply. Five commands, in an order you had to know, with
// three paths to keep consistent between them. A developer using the platform
// should not have to know that order -- knowing it is the platform team's job, and
// putting it in one command is what "paved" means.
//
// It is deliberately NOT a new mechanism. Each step below is the same thing the
// separate commands do, so a student who wants to see the parts can still run them
// one at a time, and challenge 4 does exactly that before arriving here.
func deployCmd() *cobra.Command {
	var (
		configPath  string
		specPath    string
		image       string
		vaultAddr   string
		skipBuild   bool
		accountFlag string
	)

	c := &cobra.Command{
		Use:   "deploy",
		Short: "Build the worker image and deploy it, from a worker config and its spec",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := workerconfig.Load(configPath)
			if err != nil {
				return fmt.Errorf("%s: %w\n\nGenerate it: tpctl worker gen-config", configPath, err)
			}
			username, _, err := identity(cmd)
			if err != nil {
				return err
			}

			// The spec is not decoration here. A worker config is generated from
			// the code, and the code does not know whether the namespace it names
			// is still one the team asked for -- so a config left over from a spec
			// that has since changed will happily deploy a worker that polls a
			// namespace nobody provisioned. Checking costs one file read.
			s, err := spec.Load(specPath)
			if err != nil {
				return err
			}
			if cfg.Namespace != s.Name {
				return fmt.Errorf(
					"%s was generated for namespace %q, but %s is %q.\n\n"+
						"Regenerate it: tpctl worker gen-config --spec %s",
					configPath, cfg.Namespace, specPath, s.Name, specPath)
			}
			if !contains(s.Environments, cfg.Environment) {
				return fmt.Errorf(
					"%s targets the %q environment, which %s does not ask for (%s).\n\n"+
						"Add it to the spec, or regenerate the config for an environment that exists.",
					configPath, cfg.Environment, specPath, strings.Join(s.Environments, ", "))
			}

			if image != "" {
				cfg.Image = image
			}
			if cfg.Image == "" {
				cfg.Image = defaultWorkerImage
			}

			root, err := repoRoot()
			if err != nil {
				return err
			}
			workerDir := filepath.Dir(mustAbs(configPath))

			// Resolved up front rather than at manifest time: it is the one input
			// that can fail for a reason unrelated to Kubernetes, and finding that
			// out after a docker build is a waste of two minutes.
			acct, err := accountID(accountFlag)
			if err != nil {
				return err
			}
			physical := fmt.Sprintf("ws-%s-%s-%s.%s", username, cfg.Namespace, cfg.Environment, acct)

			fmt.Printf("deploying %s for %s\n", cfg.Service, s.Owner)
			fmt.Printf("  temporal    %s\n", physical)
			fmt.Printf("  kubernetes  namespace/%s\n", cfg.Namespace)
			fmt.Printf("  queues      %s\n", strings.Join(cfg.TaskQueues, ", "))
			fmt.Printf("  image       %s\n", cfg.Image)
			fmt.Printf("  address     %s\n\n", spec.NamespaceEndpoint(physical))

			if !skipBuild {
				fmt.Println("==> build")
				if err := run(workerDir, "docker", "build", "-t", cfg.Image, "-f",
					filepath.Join(workerDir, "Dockerfile"), workerDir); err != nil {
					return err
				}

				// The same import logic bring-up uses, rather than a second copy
				// of the k3d/k3s/Docker Desktop branch. up.sh takes the image name
				// from $IMAGE precisely so it can be reused here.
				fmt.Println("\n==> load into the cluster")
				imp := exec.Command(filepath.Join(root, "deploy", "platform", "up.sh"), "import")
				imp.Env = append(os.Environ(), "IMAGE="+cfg.Image)
				imp.Dir, imp.Stdout, imp.Stderr = root, os.Stdout, os.Stderr
				if err := imp.Run(); err != nil {
					return fmt.Errorf("loading %s into the cluster: %w", cfg.Image, err)
				}
			}

			fmt.Println("\n==> vault access")
			if err := grantVaultAccess(cfg, username); err != nil {
				return err
			}

			fmt.Println("\n==> manifest")
			body, err := renderManifest(cfg, username, vaultAddr, acct)
			if err != nil {
				return err
			}

			fmt.Println("==> apply")
			apply := exec.Command("kubectl", "apply", "-f", "-")
			apply.Stdin = strings.NewReader(body)
			apply.Stdout, apply.Stderr = os.Stdout, os.Stderr
			if err := apply.Run(); err != nil {
				return fmt.Errorf("applying the manifest: %w", err)
			}

			fmt.Println("\n==> rollout")
			// -n, because the manifest puts the worker in its own namespace rather
			// than in whatever kubectl happens to be pointed at.
			if err := run("", "kubectl", "rollout", "status", "-n", cfg.Namespace,
				"deploy/"+cfg.Service, "--timeout=180s"); err != nil {
				return fmt.Errorf("%w\n\nThe manifest applied. Look at why the pod is unhappy:\n"+
					"  kubectl -n %s logs deploy/%s", err, cfg.Namespace, cfg.Service)
			}

			fmt.Printf("\n%s is polling %s on ws-%s-%s-%s.\n",
				cfg.Service, strings.Join(cfg.TaskQueues, ", "), username, cfg.Namespace, cfg.Environment)
			fmt.Printf("  kubectl -n %s logs -f deploy/%s\n", cfg.Namespace, cfg.Service)
			return nil
		},
	}

	c.Flags().StringVarP(&configPath, "config", "c", "worker-config.json", "generated worker config")
	c.Flags().StringVar(&specPath, "spec", "", "the namespace spec this worker belongs to")
	c.Flags().StringVar(&image, "image", "", "container image, overrides the config")
	c.Flags().StringVar(&vaultAddr, "vault-addr", inClusterVaultAddr, "Vault address reachable from inside the cluster")
	c.Flags().BoolVar(&skipBuild, "skip-build", false, "deploy the image that is already there")
	c.Flags().StringVar(&accountFlag, "account-id", "", "Cloud account id; derived from your environment when unset")
	_ = c.MarkFlagRequired("spec")
	addIdentityFlags(c)
	return c
}

func run(dir, name string, args ...string) error {
	c := exec.Command(name, args...)
	c.Dir, c.Stdout, c.Stderr = dir, os.Stdout, os.Stderr
	if err := c.Run(); err != nil {
		return fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}
	return nil
}

func contains(hay []string, needle string) bool {
	for _, h := range hay {
		if h == needle {
			return true
		}
	}
	return false
}

func mustAbs(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		return p
	}
	return abs
}

// repoRoot walks up for go.mod, so `tpctl deploy` works from worker/ -- which is
// where a developer running it actually stands.
func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("cannot find the repo root (no go.mod above %s)", dir)
		}
		dir = parent
	}
}

// grantVaultAccess lets this worker's pods authenticate to Vault as themselves.
//
// A policy naming exactly the secrets this team's namespaces hold, and a
// Kubernetes auth role bound to exactly this ServiceAccount in exactly this
// Kubernetes namespace. Nothing else can assume it: not another team's worker,
// not something a student deploys by hand into "default".
//
// It belongs here, in deploy, because granting a workload its identity IS part of
// deploying it. Doing it by hand afterwards leaves a window where the Deployment
// exists and crash-loops, and leaves the grant to a step somebody forgets -- which
// is how a platform ends up with one team's role bound to bound_service_account_
// namespaces=default because that was what made the error go away.
//
// The platform's own role is written by `workshop base-up`; this is the same two
// commands for the workload side, run at the moment the workload appears.
func grantVaultAccess(cfg *workerconfig.Config, username string) error {
	role := "worker-" + cfg.Namespace
	policy := fmt.Sprintf(`path "secret/data/namespaces/%s/%s/*"     { capabilities = ["read"] }
path "secret/metadata/namespaces/%s/%s/*" { capabilities = ["list", "read"] }
`, username, cfg.Namespace, username, cfg.Namespace)

	fmt.Printf("    policy %s -> secret/namespaces/%s/%s/*  (read only)\n", role, username, cfg.Namespace)
	w := exec.Command("vault", "policy", "write", role, "-")
	w.Stdin = strings.NewReader(policy)
	w.Stderr = os.Stderr
	if err := w.Run(); err != nil {
		return fmt.Errorf("writing the %s Vault policy: %w\n\n"+
			"Is Vault reachable? `source \"$(./scripts/workshop env-file)\"`", role, err)
	}

	fmt.Printf("    role   %s -> serviceaccount %s in namespace %s\n", role, cfg.Service, cfg.Namespace)
	if err := run("", "vault", "write", "auth/kubernetes/role/"+role,
		"bound_service_account_names="+cfg.Service,
		"bound_service_account_namespaces="+cfg.Namespace,
		"policies="+role, "ttl=24h"); err != nil {
		return fmt.Errorf("creating the %s Vault role: %w", role, err)
	}
	return nil
}
