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
				if err := runWizard(&s); err != nil {
					return err
				}
			}

			path, err := s.Save(dir)
			if err != nil {
				return err
			}

			fmt.Printf("\nWrote %s\n\n", path)
			fmt.Printf("  %-14s %s\n", "namespaces", strings.Join(physicalNames(&s), ", "))
			fmt.Printf("  %-14s %s\n", "fingerprint", s.Fingerprint())
			fmt.Println()
			fmt.Println("Next:")
			fmt.Printf("  nsctl apply -f %s      # provision it now\n", path)
			fmt.Println("  git add specs && git commit    # or let the reconciler do it")
			return nil
		},
	}

	c.Flags().StringVar(&name, "name", "", "logical namespace name, 2-12 chars")
	c.Flags().StringVar(&owner, "owner", "", "team or person who gets paged")
	c.Flags().StringVar(&tier, "tier", spec.TierStandard, "standard or critical")
	c.Flags().IntVar(&retention, "retention", 7, "workflow history retention in days")
	c.Flags().StringVar(&region, "region", "aws-us-east-1", "single region")
	c.Flags().StringSliceVar(&envs, "environments", []string{spec.EnvStaging, spec.EnvProd}, "staging, prod")
	c.Flags().StringVar(&backend, "state-backend", spec.BackendHTTP, "http, local or s3")
	c.Flags().BoolVar(&nonInteractive, "non-interactive", false, "take every value from flags, ask nothing")
	c.Flags().StringVar(&dir, "dir", defaultSpecDir, "directory to write the spec into")

	return c
}

func runWizard(s *spec.Spec) error {
	in := bufio.NewReader(os.Stdin)

	fmt.Println()
	fmt.Println("  A namespace, provisioned properly.")
	fmt.Println("  Four questions. Press enter to accept the value in brackets.")
	fmt.Println()

	var err error
	if s.Name, err = ask(in, "Name", s.Name, "short, lower-case, e.g. orders"); err != nil {
		return err
	}
	if s.Owner, err = ask(in, "Owner", s.Owner, "team that gets paged, e.g. payments-team"); err != nil {
		return err
	}
	if s.Tier, err = ask(in, "Tier", orDefault(s.Tier, spec.TierStandard), "standard or critical"); err != nil {
		return err
	}
	retention, err := ask(in, "Retention days", strconv.Itoa(orZero(s.RetentionDays, 7)), "1 to 90")
	if err != nil {
		return err
	}
	if s.RetentionDays, err = strconv.Atoi(retention); err != nil {
		return fmt.Errorf("retention days: %q is not a number", retention)
	}

	// Not asked: region, environments and state backend are platform decisions
	// with sensible defaults. A wizard that asks eight questions is a form.
	if s.Region == "" {
		s.Region = "aws-us-east-1"
	}
	if len(s.Environments) == 0 {
		s.Environments = []string{spec.EnvStaging, spec.EnvProd}
	}
	if s.StateBackend == "" {
		s.StateBackend = spec.BackendHTTP
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

func physicalNames(s *spec.Spec) []string {
	out := make([]string, 0, len(s.Environments))
	for _, e := range s.Environments {
		out = append(out, s.PhysicalName(1, e)+" (slot 1)")
	}
	return out
}
