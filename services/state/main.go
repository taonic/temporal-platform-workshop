// Command tfstate is the workshop's Terraform HTTP state backend.
//
// Three verbs, one volume, and -- deliberately -- no locking.
//
// Terraform's http backend treats lock_address as optional, and the platform does
// not want it: the reconciler's child workflow id is the resource identity, so
// Temporal's workflow-id uniqueness constraint already guarantees a single writer
// per state file. A second concurrent writer cannot come into existence, so there
// is nothing for a lock to protect against.
//
// The LOCK and UNLOCK handlers below therefore refuse, and explain why. A student
// who trips over that message has arrived at the best insight in the workshop from
// the other direction.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const maxStateBytes = 32 << 20 // 32 MiB; a namespace module's state is a few KiB

type server struct {
	dir    string
	secret string
	static map[string]string
}

func main() {
	srv := &server{
		dir:    envOr("STATE_DIR", "/data"),
		secret: os.Getenv("STATE_SHARED_SECRET"),
		static: parseTokens(os.Getenv("STATE_TOKENS")),
	}
	if srv.secret == "" && len(srv.static) == 0 {
		log.Fatal("set STATE_SHARED_SECRET (tokens are derived per participant) or STATE_TOKENS")
	}
	if err := os.MkdirAll(srv.dir, 0o700); err != nil {
		log.Fatalf("state directory %s: %v", srv.dir, err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok\n")
	})
	mux.HandleFunc("/state/", srv.handleState)
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "state paths look like /state/<participant>/<spec>/<environment>", http.StatusNotFound)
	})

	addr := ":" + envOr("PORT", "8080")
	log.Printf("terraform state service on %s, data in %s, locking disabled by design", addr, srv.dir)

	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute,
		WriteTimeout:      2 * time.Minute,
	}
	log.Fatal(httpSrv.ListenAndServe())
}

func (s *server) handleState(w http.ResponseWriter, r *http.Request) {
	// LOCK and UNLOCK are terraform's own verbs. Answering them honestly is more
	// useful than answering them at all.
	if r.Method == "LOCK" || r.Method == "UNLOCK" {
		w.Header().Set("Allow", "GET, POST, DELETE")
		http.Error(w,
			"This backend implements no locking, on purpose.\n\n"+
				"The reconciler runs one child workflow per resource, and the workflow id IS\n"+
				"the resource identity. Temporal's workflow-id uniqueness constraint already\n"+
				"guarantees a single writer, so a lock would protect against a situation that\n"+
				"cannot arise. Leave lock_address unset in the backend config.\n",
			http.StatusMethodNotAllowed)
		return
	}

	participant, rel, err := splitPath(r.URL.Path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if !s.authorised(r, participant) {
		w.Header().Set("WWW-Authenticate", `Basic realm="terraform state"`)
		http.Error(w, "unauthorised: the basic-auth user must be the participant in the path", http.StatusUnauthorized)
		return
	}

	path := filepath.Join(s.dir, participant, rel+".tfstate")

	switch r.Method {
	case http.MethodGet:
		data, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			// Terraform reads 404 as "no state yet", which is the correct answer
			// for a namespace nobody has applied.
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "reading state", http.StatusInternalServerError)
			log.Printf("read %s: %v", path, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(data)

	case http.MethodPost:
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxStateBytes))
		if err != nil {
			http.Error(w, "reading request body", http.StatusBadRequest)
			return
		}
		if err := writeAtomic(path, body); err != nil {
			http.Error(w, "writing state", http.StatusInternalServerError)
			log.Printf("write %s: %v", path, err)
			return
		}
		log.Printf("wrote %s (%d bytes)", strings.TrimPrefix(path, s.dir), len(body))
		w.WriteHeader(http.StatusOK)

	case http.MethodDelete:
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			http.Error(w, "deleting state", http.StatusInternalServerError)
			log.Printf("delete %s: %v", path, err)
			return
		}
		w.WriteHeader(http.StatusOK)

	default:
		w.Header().Set("Allow", "GET, POST, DELETE")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// splitPath turns /state/<participant>/<spec>/<env> into its parts, refusing
// anything that could escape the participant's own directory.
func splitPath(urlPath string) (participant, rel string, err error) {
	trimmed := strings.TrimPrefix(urlPath, "/state/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("path must be /state/<participant>/<spec>/<environment>")
	}
	for _, p := range parts {
		if p == "" || p == "." || p == ".." || strings.ContainsAny(p, `\:`) {
			return "", "", fmt.Errorf("path segment %q is not allowed", p)
		}
	}
	return parts[0], filepath.Join(parts[1:]...), nil
}

// authorised checks basic auth and, critically, that the caller is the participant
// whose state they are addressing. Without that second check a valid token would
// read every student's state -- which, because terraform state contains resource
// ids and metadata, is a cross-student information leak in a shared cohort.
func (s *server) authorised(r *http.Request, participant string) bool {
	user, pass, ok := r.BasicAuth()
	if !ok || user != participant {
		return false
	}
	if want, found := s.static[participant]; found {
		return subtle.ConstantTimeCompare([]byte(pass), []byte(want)) == 1
	}
	if s.secret == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(pass), []byte(DeriveToken(s.secret, participant))) == 1
}

// DeriveToken is how the sandbox gets a per-participant token without a database:
// the same secret and the same participant id always produce the same token.
func DeriveToken(secret, participant string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(participant))
	return hex.EncodeToString(mac.Sum(nil))[:40]
}

func writeAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tfstate-")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	// fsync before rename: a Fly machine restarting mid-write is exactly the
	// failure AttemptImport exists to repair, and there is no reason to make it
	// more likely than it has to be.
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func parseTokens(raw string) map[string]string {
	out := map[string]string{}
	for _, pair := range strings.Split(raw, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		k, v, ok := strings.Cut(pair, ":")
		if ok {
			out[k] = v
		}
	}
	return out
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
