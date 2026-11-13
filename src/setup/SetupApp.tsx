import { useEffect, useRef, useState, type FormEvent } from 'react';
import { setupClient, type ClaimResult, type SetupClient, type SetupSession } from './client';
import { loadTranslator, type Translator } from './strings';

// The first-start wizard. It is a sibling of the legacy host, never a Vue view:
// Vue would start AssetAccess against an installation with no database and
// clear identity on the failing /auth/me. Every state shown here is either the
// server's own answer or an explicit pending marker; the claimed step never
// simulates progress it cannot observe.

const PENDING_STEPS = ['ui.setup.steps.ai', 'ui.setup.steps.storage', 'ui.setup.steps.owner', 'ui.setup.steps.verify'] as const;

type Step = 'claim' | 'claimed';

interface SetupAppProps {
  initialSession?: SetupSession | null;
  client?: SetupClient;
}

function claimMessage(result: Extract<ClaimResult, { ok: false }>, t: Translator): string {
  switch (result.code) {
    case 'invalid': return t('ui.setup.claim.invalid');
    case 'locked': return t('ui.setup.claim.locked');
    case 'unavailable':
    case 'network':
    case 'timeout': return t('ui.setup.claim.unavailable');
    default: return t('ui.setup.claim.invalid_response');
  }
}

export function SetupApp({ initialSession = null, client = setupClient }: SetupAppProps) {
  const [t, setT] = useState<Translator | null>(null);
  const [step, setStep] = useState<Step>(initialSession ? 'claimed' : 'claim');
  const [state, setState] = useState<string>(initialSession?.state ?? '');
  const [credential, setCredential] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    void loadTranslator().then((loaded) => { if (active) setT(() => loaded); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (step === 'claimed') heading.current?.focus();
  }, [step]);

  if (!t) {
    return <main className="login setup" aria-busy="true" data-setup-wizard="loading" />;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || locked) return;
    const value = credential.trim();
    if (!value) {
      setMessage(t!('ui.setup.claim.required'));
      input.current?.focus();
      return;
    }
    setSubmitting(true);
    setMessage(null);
    setAttempts(null);
    const result = await client.claim(value);
    setSubmitting(false);
    // A rejected credential is not kept in the DOM; the operator retypes it.
    setCredential('');
    if (result.ok) {
      setState(result.state ?? 'claimed');
      setStep('claimed');
      return;
    }
    setMessage(claimMessage(result, t!));
    setAttempts(result.attemptsRemaining);
    if (result.code === 'locked') {
      setLocked(true);
      return;
    }
    if (result.code === 'invalid') input.current?.focus();
  }

  const describedBy = message ? 'setup-credential-hint setup-message' : 'setup-credential-hint';

  if (step === 'claimed') {
    return (
      <main className="login setup" aria-labelledby="setup-title" data-setup-wizard="claimed">
        <div className="login__panel">
          <div className="login__form-wrap">
            <h1 id="setup-title" tabIndex={-1} ref={heading}>{t('ui.setup.claimed.title')}</h1>
            <p className="setup__lead">{t('ui.setup.claimed.lead')}</p>
            <p className="setup__state">
              <span>{t('ui.setup.state.label')}</span>
              <span className="setup__state-value" data-setup-state>{state || 'claimed'}</span>
            </p>
            <section aria-labelledby="setup-steps-title">
              <h2 id="setup-steps-title">{t('ui.setup.steps.title')}</h2>
              <ol className="setup-steps">
                {PENDING_STEPS.map((key) => (
                  <li className="setup-step" key={key} data-setup-step="pending">
                    <span>{t(key)}</span>
                    <span className="setup-step__badge">{t('ui.setup.steps.pending')}</span>
                  </li>
                ))}
              </ol>
            </section>
            <div className="setup__messages" aria-live="polite" aria-atomic="true">
              {message ? <p className="form-alert" id="setup-message">{message}</p> : null}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="login setup" aria-labelledby="setup-title" data-setup-wizard="claim">
      <div className="login__panel">
        <div className="login__form-wrap">
          <h1 id="setup-title">{t('ui.setup.title')}</h1>
          <p className="setup__lead">{t('ui.setup.lead')}</p>
          <form className="login-form" noValidate onSubmit={submit} aria-busy={submitting}>
            <div className={`field${message ? ' field--invalid' : ''}`}>
              <label htmlFor="setup-credential">{t('ui.setup.claim.label')}</label>
              <div className="input-shell">
                <input
                  id="setup-credential"
                  ref={input}
                  type="password"
                  name="credential"
                  autoComplete="one-time-code"
                  autoFocus
                  value={credential}
                  disabled={submitting || locked}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={describedBy}
                  onChange={(event) => setCredential(event.target.value)}
                />
              </div>
              <p className="field__hint" id="setup-credential-hint">{t('ui.setup.claim.hint')}</p>
            </div>
            <div className="setup__messages" aria-live="polite" aria-atomic="true">
              {message ? <p className="form-alert" id="setup-message">{message}</p> : null}
              {attempts !== null && attempts > 0
                ? <p className="field__hint">{t('ui.setup.claim.attempts', { count: attempts })}</p>
                : null}
            </div>
            <button className="btn btn--primary login-submit" type="submit" id="setup-claim-submit" disabled={submitting || locked}>
              {submitting ? t('ui.setup.claim.submitting') : t('ui.setup.claim.submit')}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
