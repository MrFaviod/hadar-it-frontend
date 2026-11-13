import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  setupClient,
  type AiDiagnosticCode,
  type AiReceipt,
  type ClaimResult,
  type SetupClient,
  type SetupSession,
} from './client';
import { loadTranslator, type Translator } from './strings';

// The first-start wizard. It is a sibling of the legacy host, never a Vue view:
// Vue would start AssetAccess against an installation with no database and
// clear identity on the failing /auth/me. Every state shown here is either the
// server's own answer or an explicit pending marker; the claimed step never
// simulates progress it cannot observe.

const PENDING_STEPS = ['ui.setup.steps.ai', 'ui.setup.steps.storage', 'ui.setup.steps.owner', 'ui.setup.steps.verify'] as const;

type Step = 'claim' | 'claimed';
type FormCode = AiDiagnosticCode | 'form-incomplete';
type FocusTarget = 'receipt' | 'pending' | 'error' | 'assistant';

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

/**
 * One closed sentence per diagnostic. The server sends a code, never prose the
 * wizard would print, so an unknown code degrades to the same availability
 * message instead of leaking an upstream error string into the page.
 */
function aiMessage(code: FormCode, t: Translator): string {
  switch (code) {
    case 'form-incomplete': return t('ui.setup.ai.form_incomplete');
    case 'provider_unreachable': return t('ui.setup.ai.error.provider_unreachable');
    case 'model_without_tools': return t('ui.setup.ai.error.model_without_tools');
    case 'endpoint_forbidden': return t('ui.setup.ai.error.endpoint_forbidden');
    case 'credential_missing': return t('ui.setup.ai.error.credential_missing');
    case 'credential_key_missing': return t('ui.setup.ai.error.credential_key_missing');
    case 'auth_failed': return t('ui.setup.ai.error.auth_failed');
    case 'tool_not_called': return t('ui.setup.ai.error.tool_not_called');
    case 'session_expired': return t('ui.setup.ai.error.session_expired');
    case 'state_refused': return t('ui.setup.ai.error.state_refused');
    case 'ai_not_configured': return t('ui.setup.ai.error.ai_not_configured');
    case 'network': return t('ui.setup.ai.error.network');
    case 'timeout': return t('ui.setup.ai.error.timeout');
    case 'invalid-response': return t('ui.setup.ai.error.invalid_response');
    default: return t('ui.setup.ai.error.unavailable');
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
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [deferring, setDeferring] = useState(false);
  const [aiError, setAiError] = useState<FormCode | null>(null);
  const [keyMissing, setKeyMissing] = useState(false);
  const [receipt, setReceipt] = useState<AiReceipt | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerTools, setAnswerTools] = useState<string[]>([]);
  const [answerLatency, setAnswerLatency] = useState<number | null>(null);
  const [assistantError, setAssistantError] = useState<FormCode | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const aiErrorRef = useRef<HTMLDivElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const pendingNotice = useRef<HTMLElement>(null);
  const assistantErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let active = true;
    void loadTranslator().then((loaded) => { if (active) setT(() => loaded); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (step === 'claimed') heading.current?.focus();
  }, [step]);

  useEffect(() => {
    // The submit disables the field while the claim is in flight, and a
    // disabled input drops focus to the body. Return the caret to the field
    // once the attempt settles, so retrying a rejected credential stays a
    // keyboard-only action instead of a Tab hunt.
    if (step !== 'claim' || locked || !message) return;
    input.current?.focus();
  }, [message, locked, step]);

  useEffect(() => {
    // A state change and its focus target are committed together, so the
    // refs below exist by the time this runs. Clearing the request keeps the
    // user's own focus afterwards.
    if (!focusRequest) return;
    if (focusRequest.target === 'receipt') receiptHeading.current?.focus();
    if (focusRequest.target === 'pending') pendingNotice.current?.focus();
    if (focusRequest.target === 'error') aiErrorRef.current?.focus();
    if (focusRequest.target === 'assistant') assistantErrorRef.current?.focus();
    setFocusRequest(null);
  }, [focusRequest]);

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

  async function verifyProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verifying || deferring || keyMissing) return;
    const base = baseUrl.trim();
    const name = model.trim();
    if (!base || !name || !apiKey) {
      setAiError('form-incomplete');
      setFocusRequest({ target: 'error' });
      return;
    }
    setVerifying(true);
    setAiError(null);
    const result = await client.configureAi({ baseUrl: base, model: name, apiKey });
    setVerifying(false);
    // The key is not state the wizard keeps: clear it whether verification
    // passed, failed, or the request never reached the service.
    setApiKey('');
    if (result.ok) {
      setState(result.state);
      setReceipt(result.receipt);
      setKeyMissing(false);
      setFocusRequest({ target: 'receipt' });
      return;
    }
    if (result.code === 'credential_key_missing') setKeyMissing(true);
    setAiError(result.code);
    setFocusRequest({ target: 'error' });
  }

  async function continueWithoutAi() {
    if (verifying || deferring) return;
    setDeferring(true);
    setAiError(null);
    const result = await client.deferAi();
    setDeferring(false);
    if (result.ok) {
      setState(result.state);
      setReceipt(result.receipt);
      setFocusRequest({ target: 'pending' });
      return;
    }
    setAiError(result.code);
    setFocusRequest({ target: 'error' });
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (asking) return;
    const value = question.trim();
    if (!value) {
      setAssistantError('form-incomplete');
      setFocusRequest({ target: 'assistant' });
      return;
    }
    setAsking(true);
    setAssistantError(null);
    const result = await client.askAssistant(value);
    setAsking(false);
    if (result.ok) {
      setAnswer(result.answer);
      setAnswerTools(result.tools);
      setAnswerLatency(result.latencyMs);
      setQuestion('');
      return;
    }
    setAssistantError(result.code);
    setFocusRequest({ target: 'assistant' });
  }

  const describedBy = message ? 'setup-credential-hint setup-message' : 'setup-credential-hint';

  if (step === 'claimed') {
    const configured = state === 'ai_configured';
    const deferred = state === 'ai_deferred';
    const aiBusy = verifying || deferring;
    const fieldInvalid = aiError === 'form-incomplete';
    const fieldDescribedBy = aiError ? 'setup-ai-base-hint setup-ai-error' : 'setup-ai-base-hint';
    const keyDescribedBy = aiError ? 'setup-ai-key-hint setup-ai-error' : 'setup-ai-key-hint';

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

            {deferred ? (
              <section
                className="form-note setup__pending"
                aria-labelledby="setup-ai-pending-title"
                tabIndex={-1}
                ref={pendingNotice}
                data-setup-ai="deferred"
              >
                <div>
                  <h2 id="setup-ai-pending-title">{t('ui.setup.ai.pending_title')}</h2>
                  <p>{t('ui.setup.ai.pending_body')}</p>
                </div>
                <span className="setup-step__badge">{t('ui.setup.steps.pending')}</span>
              </section>
            ) : null}

            {configured ? (
              <section className="setup__ai" aria-labelledby="setup-ai-receipt-title" data-setup-ai="configured">
                <h2 id="setup-ai-receipt-title" tabIndex={-1} ref={receiptHeading}>{t('ui.setup.ai.receipt_title')}</h2>
                {receipt ? (
                  <dl className="setup__receipt">
                    <div>
                      <dt>{t('ui.setup.ai.receipt_provider')}</dt>
                      <dd data-setup-receipt="provider">{receipt.provider}</dd>
                    </div>
                    <div>
                      <dt>{t('ui.setup.ai.receipt_model')}</dt>
                      <dd data-setup-receipt="model">{receipt.model}</dd>
                    </div>
                    <div>
                      <dt>{t('ui.setup.ai.receipt_tool')}</dt>
                      <dd data-setup-receipt="tool">{receipt.tool ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>{t('ui.setup.ai.receipt_latency')}</dt>
                      <dd data-setup-receipt="latency">
                        {receipt.latencyMs === null ? '—' : t('ui.setup.ai.receipt_latency_value', { ms: receipt.latencyMs })}
                      </dd>
                    </div>
                  </dl>
                ) : null}
                <p className="form-note">{t('ui.setup.ai.receipt_note')}</p>
                <form className="login-form" noValidate onSubmit={ask} aria-busy={asking}>
                  <h3>{t('ui.setup.ai.assistant_title')}</h3>
                  <p className="setup__lead">{t('ui.setup.ai.assistant_lead')}</p>
                  <div className={`field${assistantError === 'form-incomplete' ? ' field--invalid' : ''}`}>
                    <label htmlFor="setup-assistant-question">{t('ui.setup.ai.assistant_label')}</label>
                    <div className="input-shell">
                      <input
                        id="setup-assistant-question"
                        type="text"
                        name="question"
                        autoComplete="off"
                        maxLength={500}
                        value={question}
                        disabled={asking}
                        aria-invalid={assistantError === 'form-incomplete' ? true : undefined}
                        aria-describedby="setup-assistant-hint"
                        onChange={(event) => setQuestion(event.target.value)}
                      />
                    </div>
                    <p className="field__hint" id="setup-assistant-hint">{t('ui.setup.ai.assistant_hint')}</p>
                  </div>
                  <div className="setup__messages" aria-live="polite" aria-atomic="true">
                    {asking ? <p className="form-note" role="status">{t('ui.setup.ai.assistant_progress')}</p> : null}
                    {assistantError ? (
                      <p className="form-alert" role="alert" tabIndex={-1} ref={assistantErrorRef}>
                        {aiMessage(assistantError, t)}
                      </p>
                    ) : null}
                  </div>
                  <button className="btn btn--primary" type="submit" id="setup-assistant-submit" disabled={asking}>
                    {asking ? t('ui.setup.ai.assistant_asking') : t('ui.setup.ai.assistant_ask')}
                  </button>
                  <div className="setup__assistant-answer" aria-live="polite" aria-atomic="true" data-setup-assistant="answer">
                    <h4>{t('ui.setup.ai.assistant_answer_label')}</h4>
                    {answer
                      ? <p className="setup__assistant-text" data-setup-assistant="text">{answer}</p>
                      : <p className="setup__lead">{t('ui.setup.ai.assistant_empty')}</p>}
                    {answer
                      ? <p className="field__hint">
                          {answerTools.length
                            ? t('ui.setup.ai.assistant_tools', { tools: answerTools.join(', ') })
                            : t('ui.setup.ai.assistant_tools_none')}
                        </p>
                      : null}
                    {answerLatency !== null
                      ? <p className="field__hint">{t('ui.setup.ai.receipt_latency_value', { ms: answerLatency })}</p>
                      : null}
                  </div>
                </form>
              </section>
            ) : (
              <section
                className="setup__ai"
                aria-labelledby="setup-ai-title"
                data-setup-ai={keyMissing ? 'blocked' : 'form'}
              >
                <h2 id="setup-ai-title">{t('ui.setup.ai.title')}</h2>
                <p className="setup__lead">{t('ui.setup.ai.lead')}</p>
                {keyMissing ? (
                  <div className="form-note setup__operator" data-setup-ai-key="missing">
                    <div>
                      <h3>{t('ui.setup.ai.key_missing_title')}</h3>
                      <p>{t('ui.setup.ai.key_missing_body')}</p>
                    </div>
                  </div>
                ) : null}
                <form className="login-form" noValidate onSubmit={verifyProvider} aria-busy={verifying}>
                  <div className="setup__messages" aria-live="assertive" aria-atomic="true">
                    {aiError ? (
                      <div className="form-alert" id="setup-ai-error" role="alert" tabIndex={-1} ref={aiErrorRef}>
                        <div>
                          <p><strong>{t('ui.setup.ai.error_title')}</strong></p>
                          <p>{aiMessage(aiError, t)}</p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className={`field${fieldInvalid ? ' field--invalid' : ''}`}>
                    <label htmlFor="setup-ai-base-url">{t('ui.setup.ai.base_url')}</label>
                    <div className="input-shell">
                      <input
                        id="setup-ai-base-url"
                        type="url"
                        name="base_url"
                        inputMode="url"
                        autoComplete="url"
                        spellCheck={false}
                        placeholder="https://api.example.com/v1"
                        value={baseUrl}
                        disabled={keyMissing || aiBusy}
                        aria-invalid={fieldInvalid ? true : undefined}
                        aria-describedby={fieldDescribedBy}
                        onChange={(event) => setBaseUrl(event.target.value)}
                      />
                    </div>
                    <p className="field__hint" id="setup-ai-base-hint">{t('ui.setup.ai.base_url_hint')}</p>
                  </div>
                  <div className={`field${fieldInvalid ? ' field--invalid' : ''}`}>
                    <label htmlFor="setup-ai-model">{t('ui.setup.ai.model')}</label>
                    <div className="input-shell">
                      <input
                        id="setup-ai-model"
                        type="text"
                        name="model"
                        autoComplete="off"
                        spellCheck={false}
                        value={model}
                        disabled={keyMissing || aiBusy}
                        aria-invalid={fieldInvalid ? true : undefined}
                        aria-describedby={aiError ? 'setup-ai-model-hint setup-ai-error' : 'setup-ai-model-hint'}
                        onChange={(event) => setModel(event.target.value)}
                      />
                    </div>
                    <p className="field__hint" id="setup-ai-model-hint">{t('ui.setup.ai.model_hint')}</p>
                  </div>
                  <div className={`field${fieldInvalid ? ' field--invalid' : ''}`}>
                    <label htmlFor="setup-ai-api-key">{t('ui.setup.ai.api_key')}</label>
                    <div className="input-shell">
                      <input
                        id="setup-ai-api-key"
                        type="password"
                        name="api_key"
                        autoComplete="new-password"
                        spellCheck={false}
                        value={apiKey}
                        disabled={keyMissing || aiBusy}
                        aria-invalid={fieldInvalid ? true : undefined}
                        aria-describedby={keyDescribedBy}
                        onChange={(event) => setApiKey(event.target.value)}
                      />
                    </div>
                    <p className="field__hint" id="setup-ai-key-hint">{t('ui.setup.ai.api_key_hint')}</p>
                  </div>
                  <div className="setup__messages" aria-live="polite" aria-atomic="true">
                    {verifying ? <p className="form-note" role="status">{t('ui.setup.ai.progress')}</p> : null}
                    {deferring ? <p className="form-note" role="status">{t('ui.setup.ai.deferring')}</p> : null}
                  </div>
                  <div className="setup__ai-actions">
                    <button
                      className="btn btn--primary"
                      type="submit"
                      id="setup-ai-verify"
                      disabled={keyMissing || aiBusy}
                    >
                      {verifying ? t('ui.setup.ai.verifying') : t('ui.setup.ai.verify')}
                    </button>
                    {deferred ? null : (
                      <button
                        className="btn btn--secondary"
                        type="button"
                        id="setup-ai-defer"
                        disabled={aiBusy}
                        onClick={() => { void continueWithoutAi(); }}
                      >
                        {deferring ? t('ui.setup.ai.deferring') : t('ui.setup.ai.defer')}
                      </button>
                    )}
                  </div>
                </form>
              </section>
            )}
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
