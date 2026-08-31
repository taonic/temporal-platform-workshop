package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/taonic/temporal-platform-workshop/internal/spec"
)

// newCmd is the wizard from the talk: name, owner, tier, retention, enter.
//
// Interactive by default because that is what makes a platform feel like a
// product rather than a YAML schema with a README. But every prompt also has a
// flag, and --non-interactive turns the whole thing into something a checkpoint
// script or a CI job can drive. Every real platform CLI has both halves; a
// wizard-only tool cannot be graded and cannot be automated.
func newCmd() *cobra.Command {
	var (
		name, owner, tier, region, backend string
		retention                          int
		envs                               []string
		nonInteractive                     bool
		dir                                string
	)

	c := &cobra.Command{
		Use:   "new",
		Short: "Ask a few questions and write a namespace spec",
		RunE: func(cmd *cobra.Command, _ []string) error {
			s := spec.Spec{
				Name:          name,
				Owner:         owner,
				Tier:          tier,
				RetentionDays: retention,
				Region:        region,
				Environments:  envs,
				StateBackend:  backend,
			}

			if !nonInteractive {
				if err := runWizard(cmd, &s); err != nil {
					return err
				}
			}

			path, err := s.Save(dir)
			if err != nil {
				return err
			}

			// Best effort: the spec is written and valid either way. Without a
			// username we simply cannot show the physical names yet.
			username, _, idErr := identity(cmd)

			fmt.Printf("\nWrote %s\n\n", path)
			if idErr == nil {
				fmt.Printf("  %-14s %s\n", "namespaces", strings.Join(physicalNames(&s, username), ", "))
			}
			fmt.Printf("  %-14s %s\n", "fingerprint", s.Fingerprint())
			fmt.Println()
			fmt.Println("Next:")
			fmt.Printf("  tpctl apply -f %s      # provision it now\n", path)
			fmt.Println("  git add specs && git commit    # or let the reconciler do it")
			return nil
		},
	}

	c.Flags().StringVar(&name, "name", "", "logical namespace name, 2-12 chars")
	c.Flags().StringVar(&owner, "owner", "", "team or person who gets paged")
	c.Flags().StringVar(&tier, "tier", spec.TierStandard, "standard or critical")
	c.Flags().IntVar(&retention, "retention", 7, "workflow history retention in days")
	// Defaulting to the region the student's own control plane runs in, which
	// `workshop init` wrote as TF_VAR_region.
	//
	// It used to be a hardcoded aws-us-east-1, and the mismatch was expensive: a
	// namespace in one region is only reachable on THAT region's endpoint, and
	// dialling the wrong one answers "Request unauthorized" -- which reads as a
	// credential problem and sends you to audit keys and service accounts that are
	// all correct. One region per student, chosen once, is the fix.
	c.Flags().StringVar(&region, "region", envOr("TF_VAR_region", "aws-us-east-1"), "single region")
	// One environment by default. A namespace is a finite account resource, not a
	// free abstraction -- the workshop account has a quota with a handful spare,
	// and the reconciler refuses an apply that would exceed it. A team that asks
	// for what it actually needs today gets it; a default that hands out two of
	// everything is how an account fills up with staging namespaces nobody uses.
	//
	// Asking for both is one flag, and challenge 2 does exactly that on purpose.
	c.Flags().StringSliceVar(&envs, "environments", []string{spec.EnvStaging}, "staging, prod, or both")
	c.Flags().StringVar(&backend, "state-backend", spec.BackendLocal, "local or s3")
	c.Flags().BoolVar(&nonInteractive, "non-interactive", false, "take every value from flags, ask nothing")
	c.Flags().StringVar(&dir, "dir", defaultSpecDir, "directory to write the spec into")
	addIdentityFlags(c)

	return c
}

// runWizard asks for what it has not already been told.
//
// A flag the caller actually passed is an answer, so asking for it again is
// friction dressed up as an interface -- `tpctl new --name orders` should not
// then ask what to call it. Cobra's Changed() is what makes that precise: `tier`
// and `retention` carry non-empty flag DEFAULTS, so testing the value would skip
// those questions forever, while testing Changed() only skips what a human typed.
//
// Supplied values are printed rather than silently swallowed. A wizard that
// quietly drops a question leaves you wondering whether the flag was read at all.
func runWizard(cmd *cobra.Command, s *spec.Spec) error {
	in := bufio.NewReader(os.Stdin)

	given := func(flag string) bool { return cmd.Flags().Changed(flag) }
	// The flag name is passed in rather than derived from the label: "Retention
	// days" lowercases to "retention days", which is not a flag anyone can type.
	shown := func(label, flag, value string) {
		fmt.Printf("  %-16s%s  %s\n", label, value, dim("(from --"+flag+")"))
	}

	asked := 0
	for _, f := range []string{"name", "owner", "tier", "retention"} {
		if !given(f) {
			asked++
		}
	}

	fmt.Println()
	fmt.Println("  A namespace, provisioned properly.")
	if asked > 0 {
		fmt.Printf("  %d question(s). Press enter to accept the value in brackets.\n", asked)
	}
	fmt.Println()

	var err error
	if given("name") {
		shown("Name", "name", s.Name)
	} else if s.Name, err = ask(in, "Name", s.Name, "short, lower-case, e.g. orders"); err != nil {
		return err
	}
	if given("owner") {
		shown("Owner", "owner", s.Owner)
	} else if s.Owner, err = ask(in, "Owner", s.Owner, "team that gets paged, e.g. payments-team"); err != nil {
		return err
	}
	if given("tier") {
		shown("Tier", "tier", s.Tier)
	} else if s.Tier, err = ask(in, "Tier", orDefault(s.Tier, spec.TierStandard), "standard or critical"); err != nil {
		return err
	}
	if given("retention") {
		shown("Retention days", "retention", strconv.Itoa(s.RetentionDays))
	} else {
		retention, rerr := ask(in, "Retention days", strconv.Itoa(orZero(s.RetentionDays, 7)), "1 to 90")
		if rerr != nil {
			return rerr
		}
		if s.RetentionDays, err = strconv.Atoi(retention); err != nil {
			return fmt.Errorf("retention days: %q is not a number", retention)
		}
	}

	// Not asked: region, environments and state backend are platform decisions
	// with sensible defaults. A wizard that asks eight questions is a form.
	if s.Region == "" {
		s.Region = envOr("TF_VAR_region", "aws-us-east-1")
	}
	if len(s.Environments) == 0 {
		s.Environments = []string{spec.EnvStaging}
	}
	if s.StateBackend == "" {
		s.StateBackend = spec.BackendLocal
	}

	if err := s.Validate(); err != nil {
		return err
	}
	return nil
}

func ask(in *bufio.Reader, label, def, hint string) (string, error) {
	prompt := fmt.Sprintf("  %-16s", label)
	if def != "" {
		prompt += fmt.Sprintf("[%s] ", def)
	}
	if hint != "" {
		prompt = fmt.Sprintf("  %s\n%s", dim(hint), prompt)
	}
	fmt.Print(prompt)

	line, err := in.ReadString('\n')
	if err != nil && line == "" {
		return "", fmt.Errorf("reading %s: %w", label, err)
	}
	line = strings.TrimSpace(line)
	if line == "" {
		if def == "" {
			return "", fmt.Errorf("%s is required", label)
		}
		return def, nil
	}
	return line, nil
}

func dim(s string) string { return "\x1b[2m" + s + "\x1b[0m" }

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func orZero(v, def int) int {
	if v == 0 {
		return def
	}
	return v
}

func physicalNames(s *spec.Spec, username string) []string {
	out := make([]string, 0, len(s.Environments))
	for _, e := range s.Environments {
		out = append(out, s.PhysicalName(username, e))
	}
	return out
}
