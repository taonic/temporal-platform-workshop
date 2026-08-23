// Package tfactivity is the Temporal-aware skin over a terraform workspace.
//
// It exists so that the workflow code never sees a subprocess and the terraform
// code never sees an activity. Ported from temporal-terraform-demo.
package tfactivity

import (
	"context"
	"time"

	"go.temporal.io/sdk/activity"

	"github.com/taonic/temporal-platform-workshop/internal/heartbeat"
	"github.com/taonic/temporal-platform-workshop/internal/tfworkspace"
)

const heartbeatInterval = 10 * time.Second

type Activity struct {
	cfg tfworkspace.Config
}

func New(cfg tfworkspace.Config) *Activity { return &Activity{cfg: cfg} }

func (a *Activity) Apply(ctx context.Context, in tfworkspace.ApplyInput) (tfworkspace.ApplyOutput, error) {
	log := activity.GetLogger(ctx)
	ctx, cancel := heartbeat.Begin(ctx, heartbeatInterval)
	defer cancel()

	log.Info("terraform apply",
		"module", a.cfg.ModulePath,
		"backend", a.cfg.Backend.BlockName())

	// Every terraform line becomes a heartbeat detail, so the Temporal UI shows
	// what an apply is doing while it does it. Cheap, and the difference between
	// "it is working" and "I hope it is working".
	cfg := a.cfg
	cfg.OnOutput = func(line string) {
		heartbeat.Detailed(ctx, line)
		log.Debug("terraform", "line", line)
	}

	return tfworkspace.New(cfg).Apply(ctx, in)
}

func (a *Activity) Destroy(ctx context.Context, in tfworkspace.DestroyInput) error {
	log := activity.GetLogger(ctx)
	ctx, cancel := heartbeat.Begin(ctx, heartbeatInterval)
	defer cancel()

	log.Info("terraform destroy",
		"module", a.cfg.ModulePath,
		"backend", a.cfg.Backend.BlockName())

	cfg := a.cfg
	cfg.OnOutput = func(line string) { heartbeat.Detailed(ctx, line) }

	return tfworkspace.New(cfg).Destroy(ctx, in)
}
