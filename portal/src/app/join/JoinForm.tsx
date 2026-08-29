'use client';

import { useState } from 'react';
import { join, type JoinResult } from './actions';

/**
 * The join screen.
 *
 * One field. The username the student types names everything downstream — their
 * namespaces, their Vault paths, their tfstate paths and the tag the grader reads
 * — so it is validated here as well as on the server, because the same rejection
 * arriving from a Terraform activity two challenges later reads as a broken
 * module rather than as a name they should have typed differently.
 */
export function JoinForm({ code }: { code: string }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JoinResult | undefined>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setResult(await join(code, username));
    } finally {
      setBusy(false);
    }
  }

  if (result?.username && result.password) {
    const cmd =
      `./scripts/workshop-creds init --username ${result.username} ` +
      `--state-token ${result.stateToken}`;
    return (
      <section className="card stack">
        <h2>{result.returning ? `Welcome back, ${result.username}` : `You are ${result.username}`}</h2>
        {result.returning && (
          <p className="expect">
            You already had an account, so this is the same one — with a new password, because the
            old one was only ever shown once.
          </p>
        )}
        <div className="stack">
          <p className="eyebrow">Sign in to Temporal Cloud with</p>
          <pre className="code">{`username  ${result.username}\npassword  ${result.password}`}</pre>
          <p className="expect">
            Save the password now. It is shown once — though if you lose it, come back here and type
            the same username: that resets it rather than locking you out.
          </p>
        </div>
        <div className="stack">
          <p className="eyebrow">Then, in your terminal</p>
          <pre className="code">{cmd}</pre>
        </div>
        <p>
          <a href={result.labUrl}>Start challenge 1 →</a>
          <br />
          <span className="expect">
            Bookmark that link. It is personalised, and it is how you get back in.
          </span>
        </p>
      </section>
    );
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Pick a username</h2>
      <p className="expect">
        It becomes part of every namespace your platform creates, so: 2–14 characters, lower-case
        letters, digits and dashes, starting with a letter. If you have been here before, type the
        same one — that gets your account back rather than refusing it.
      </p>
      <input
        className="code"
        style={{ width: '100%' }}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="tao"
        autoFocus
        pattern="[a-z][a-z0-9-]{1,13}"
        required
      />
      {result?.error && <p className="notice">{result.error}</p>}
      <div className="row">
        <button className="btn" type="submit" disabled={busy || !username}>
          {busy ? 'Joining…' : 'Join the workshop'}
        </button>
      </div>
    </form>
  );
}
