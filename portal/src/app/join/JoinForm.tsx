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
export function JoinForm({
  code,
  domain,
  loginUrl,
  cohort,
  region,
}: {
  code: string;
  domain: string;
  loginUrl: string;
  cohort: string;
  region: string;
}) {
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
    // Every value filled in, so this is a copy-paste and not a form. `init`
    // prompts for anything missing, and a prompt is where a cohort id gets typed
    // wrong -- which then tags every namespace the student creates.
    const cmd =
      `./scripts/workshop init --username ${result.username} ` +
      `--cohort ${cohort} --region ${region}`;
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
          <pre className="code">{`username  ${result.email}\npassword  ${result.password}`}</pre>
          <p className="expect">
            Save the password now. It is shown once — though if you lose it, come back here and type{' '}
            <code>{result.username}</code> again: that resets it rather than locking you out.
          </p>
          {/* Two identifiers, one person. The sign-in box wants the address; every
              other thing in the workshop is named after the handle. Saying which is
              which here is what stops "who am I?" becoming a question later on. */}
          <p className="expect">
            Sign in with the whole address, not just <code>{result.username}</code>. It is what the
            login hands to Temporal Cloud, and a bare name arrives there as somebody the account has
            never heard of. Everything else is named after the handle — your namespaces, your Vault
            paths, the tag the grader reads.
          </p>
          {/* Above the button, not below it: a warning about what happens after you
              click is only a warning if it is read first. */}
          <p className="notice">
            {/* Decorative: the sentence after it already says this is a warning, and
                the panel is styled as one. */}
            <span aria-hidden>⚠️ </span>
            <strong>Skip the namespace step during the Temporal Cloud onboarding.</strong> It offers
            to create a <code>quickstart-…</code> namespace for you. Decline it. Namespaces are what
            you provision from Terraform in challenge 1, and one made by hand carries none of the
            tags the grader reads — so it counts for nothing and takes a slot from the account
            quota.
          </p>
          <p className="row">
            <a
              className="btn btn-cta"
              href={loginUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Sign in to Temporal Cloud →
            </a>
            <span className="expect">Opens in a new tab, so this password stays on screen.</span>
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
    <form className="card stack" onSubmit={submit} aria-busy={busy}>
      <h2>Pick a username</h2>
      <p className="expect">
        It becomes part of every namespace your platform creates, so: 2–14 characters, lower-case
        letters, digits and dashes, starting with a letter. If you have been here before, type the
        same one — that gets your account back rather than refusing it.
      </p>
      {/* Field and domain as one control, on one line. The address is not two
          things to fill in -- only the left half is editable -- and watching it
          complete itself as they type is how "the name you pick is the identity"
          stops being an assertion and becomes something they can see. */}
      <div className="input-suffix">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="tao"
          autoFocus
          pattern="[a-z][a-z0-9-]{1,13}"
          required
          disabled={busy}
          aria-label="Username"
          aria-describedby="domain-suffix"
        />
        <span className="suffix" id="domain-suffix">
          @{domain}
        </span>
      </div>
      <p className="expect">
        That whole address is what you sign in with. <code>{domain}</code> is the
        workshop&rsquo;s own identifier domain — it has no mailbox and never resolves, so nothing
        is ever sent there.
      </p>
      {result?.error && <p className="notice">{result.error}</p>}
      <div className="row">
        <button className="btn" type="submit" disabled={busy || !username}>
          {busy && <span className="spinner" aria-hidden />}
          {busy ? 'Joining…' : 'Join the workshop'}
        </button>
        {/* Joining is three sequential API calls -- create the user, set a password,
            create the Cloud user -- and takes a couple of seconds against a cold Fly
            machine. Say what is happening, or the pause reads as a click that did not
            land. Mounted always, empty when idle, so the live region is already there
            to announce into rather than appearing at the same moment as its text. */}
        <span className="expect" role="status" aria-live="polite">
          {busy ? 'Creating your Authentik account and your Temporal Cloud user…' : ''}
        </span>
      </div>
    </form>
  );
}
