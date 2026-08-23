package tfexec

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// run executes terraform and streams every output line to onOutput.
//
// Cancellation matters more here than anywhere else in the platform. If the
// activity is cancelled and the terraform process keeps running, it holds a state
// write nobody is waiting for -- and since the platform deliberately has no state
// locking, an orphan writer is the one failure the design cannot shrug off. So the
// process gets SIGINT (terraform's graceful stop), then a hard kill after a grace
// period.
func (t *Terraform) run(ctx context.Context, env map[string]string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, t.bin, args...)
	cmd.Dir = t.workDir

	cmd.Env = append(os.Environ(),
		"TF_IN_AUTOMATION=1",
		"TF_INPUT=0",
		"CHECKPOINT_DISABLE=1",
	)
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}

	// SIGINT first: terraform traps it and unwinds cleanly.
	cmd.Cancel = func() error { return cmd.Process.Signal(os.Interrupt) }
	cmd.WaitDelay = 20 * time.Second

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("starting terraform %s: %w", args[0], err)
	}

	var (
		mu   sync.Mutex
		sb   strings.Builder
		wg   sync.WaitGroup
		emit = func(line string) {
			mu.Lock()
			sb.WriteString(line)
			sb.WriteByte('\n')
			mu.Unlock()
			if t.onOutput != nil {
				t.onOutput(line)
			}
		}
	)

	scan := func(r io.Reader) {
		defer wg.Done()
		s := bufio.NewScanner(r)
		s.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for s.Scan() {
			emit(s.Text())
		}
	}
	wg.Add(2)
	go scan(stdout)
	go scan(stderr)
	wg.Wait()

	if err := cmd.Wait(); err != nil {
		return sb.String(), fmt.Errorf("terraform %s: %w\n%s", args[0], err, tail(sb.String(), 40))
	}
	return sb.String(), nil
}

// tail keeps the last n lines. Terraform failures are verbose and the useful part
// is at the bottom; a workflow error message that includes the whole log is a
// workflow error message nobody reads.
func tail(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) <= n {
		return s
	}
	return "...\n" + strings.Join(lines[len(lines)-n:], "\n")
}
