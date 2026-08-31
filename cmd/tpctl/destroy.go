package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/taonic/temporal-platform-workshop/internal/platform"
)

// destroyCmd tears down everything a spec asked for.
//
// The reconciler has always handled a destroy signal; until this command there was
// nothing that sent one. That gap had a nasty shape: deleting specs/<name>.yaml
// looked like a removal and was not. `sync` iterates over the files it FINDS, so a
// file that is gone is simply never mentioned -- while the reconciler for it keeps
// running on its last known desired state, and its drift timer keeps the
// namespaces alive. Delete one in the Cloud UI and the loop puts it back.
//
// So removal has to be said out loud, and this is where it is said.
func destroyCmd() *cobra.Command {
	var (
		yes      bool
		keepSpec bool
		dir      string
		waitFor  time.Duration
	)

	c := &cobra.Command{
		Use:   "destroy <name>",
		Short: "Tear down every namespace a spec asked for, and stop its reconciler",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			id := platform.NamespaceWorkflowID(name)

			cl, err := dial()
			if err != nil {
				return err
			}
			defer cl.Close()

			ctx, cancel := withTimeout(30 * time.Second)
			defer cancel()

			// Show what is about to go before asking. A confirmation prompt that
			// does not say what it is confirming is a prompt people learn to
			// answer without reading.
			resp, err := cl.QueryWorkflow(ctx, id, "", platform.QueryStatus)
			if err != nil {
				return fmt.Errorf("querying %s: %w\n\n"+
					"Nothing to destroy: no reconciler is running for %q.\n"+
					"If its namespaces still exist, they were made by something else --\n"+
					"`tpctl apply` on its own does not leave a reconciler behind.",
					id, err, name)
			}
			var st platform.Status
			if err := resp.Get(&st); err != nil {
				return err
			}

			specPath := filepath.Join(dir, name+".yaml")
			fmt.Printf("Destroying %s, owned by %s.\n\n", st.Spec.Name, st.Spec.Owner)
			for _, e := range st.Environments {
				fmt.Printf("  namespace   %s\n", dash(e.NamespaceID))
			}
			fmt.Printf("  reconciler  %s (stops when this finishes)\n", id)
			if !keepSpec {
				if _, statErr := os.Stat(specPath); statErr == nil {
					fmt.Printf("  spec file   %s\n", specPath)
				}
			}
			fmt.Println()
			fmt.Println("Namespaces are deleted in Temporal Cloud. Their workflow histories go with them.")
			fmt.Println()

			if !yes {
				if !confirm(fmt.Sprintf("Type %q to confirm: ", name), name) {
					fmt.Println("Nothing was destroyed.")
					return nil
				}
			}

			if err := cl.SignalWorkflow(ctx, id, "", platform.SignalDestroy, nil); err != nil {
				return fmt.Errorf("signalling %s: %w", id, err)
			}
			fmt.Printf("\ndestroy signalled to %s\n", id)

			// The spec file is the request. Leaving it while destroying what it
			// asked for would be incoherent -- and worse, the next `tpctl sync`
			// would read it and build the whole thing again.
			if !keepSpec {
				if err := os.Remove(specPath); err == nil {
					fmt.Printf("removed %s\n", specPath)
				} else if !os.IsNotExist(err) {
					fmt.Fprintf(os.Stderr, "warning: could not remove %s: %v\n"+
						"  Remove it by hand, or the next `tpctl sync` will provision it again.\n",
						specPath, err)
				}
			} else {
				fmt.Printf("\nkept %s. The next `tpctl sync` will provision it again.\n", specPath)
			}

			// Waiting, because "signalled" is not "gone" and a terraform destroy
			// takes minutes. A student who walks away at "signalled" has no idea
			// whether it worked.
			fmt.Printf("\nwaiting for the reconciler to finish (up to %s)...\n", waitFor)
			wctx, wcancel := withTimeout(waitFor)
			defer wcancel()
			if err := cl.GetWorkflow(wctx, id, "").Get(wctx, nil); err != nil {
				return fmt.Errorf("the destroy was signalled, but waiting for it failed: %w\n\n"+
					"It may still be running. Check with:\n"+
					"  tpctl status %s", err, name)
			}
			fmt.Println("done. The reconciler has stopped.")
			return nil
		},
	}

	c.Flags().BoolVar(&yes, "yes", false, "skip the confirmation prompt")
	c.Flags().BoolVar(&keepSpec, "keep-spec", false, "leave specs/<name>.yaml in place")
	c.Flags().StringVar(&dir, "dir", defaultSpecDir, "directory holding the spec")
	c.Flags().DurationVar(&waitFor, "wait", 10*time.Minute, "how long to wait for the teardown")
	addIdentityFlags(c)
	return c
}

// confirm asks for the resource's own name rather than y/n.
//
// Typing the thing you are deleting is the difference between agreeing and
// noticing. With no terminal there is nothing to ask, so --yes is required.
func confirm(prompt, want string) bool {
	if !isTerminal() {
		fmt.Fprintln(os.Stderr, "not a terminal, and --yes was not passed. Refusing to destroy.")
		return false
	}
	fmt.Print(prompt)
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		return false
	}
	return strings.TrimSpace(line) == want
}

func isTerminal() bool {
	fi, err := os.Stdin.Stat()
	return err == nil && (fi.Mode()&os.ModeCharDevice) != 0
}
