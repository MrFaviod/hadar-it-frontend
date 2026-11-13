import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  SECTION_IDS,
  setupClient,
  type AiDiagnosticCode,
  type AiReceipt,
  type Checklist,
  type ChecklistItem,
  type ClaimResult,
  type ConfigurationDiagnosticCode,
  type OwnerFailureCode,
  type SectionApplyReceipt,
  type SectionId,
  type SectionPreview,
  type SectionView,
  type SetupClient,
  type SetupSession,
  type StorageDiagnosticCode,
  type StorageProbe,
  type StorageSummary,
} from './client';
import {
  clearOwnerSecrets,
  emptyOwnerForm,
  ownerInput,
  validateOwnerForm,
  type OwnerFormCode,
  type OwnerFormState,
} from './owner-form';
import { ConfigurationPanel, VerifyPanel } from './sections';
import { verifyOutcome } from './section-status';
import { loadTranslator, type Translator } from './strings';

// The first-start wizard. It is a sibling of the legacy host, never a Vue view:
// Vue would start AssetAccess against an installation with no database and
// clear identity on the failing /auth/me. Every state shown here is either the
// server's own answer or an explicit pending marker; the claimed step never
// simulates progress it cannot observe.

const STEPS = [
  { key: 'claim', label: 'ui.setup.steps.claim' },
  { key: 'ai', label: 'ui.setup.steps.ai' },
  { key: 'storage', label: 'ui.setup.steps.storage' },
  { key: 'owner', label: 'ui.setup.steps.owner' },
  { key: 'configuration', label: 'ui.setup.steps.configuration' },
  { key: 'verify', label: 'ui.setup.steps.verify' },
] as const;

type StepKey = typeof STEPS[number]['key'];
type StepStatus = 'done' | 'active' | 'pending';
type Step = 'claim' | 'claimed';
type Panel = 'ai' | 'storage' | 'owner' | 'configure' | 'verify';
type FormCode = AiDiagnosticCode | 'form-incomplete';
type FocusTarget = 'receipt' | 'pending' | 'error' | 'assistant' | 'panel' | 'storage-error' | 'owner-error';

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

function storageMessage(code: StorageDiagnosticCode, t: Translator): string {
  switch (code) {
    case 'unsupported_engine': return t('ui.setup.storage.error.unsupported_engine');
    case 'database_not_adoptable': return t('ui.setup.storage.error.database_not_adoptable');
    case 'invalid_request': return t('ui.setup.storage.error.invalid_request');
    case 'state_refused': return t('ui.setup.storage.error.state_refused');
    case 'session_expired': return t('ui.setup.storage.error.session_expired');
    case 'network': return t('ui.setup.storage.error.network');
    case 'timeout': return t('ui.setup.storage.error.timeout');
    case 'invalid-response': return t('ui.setup.storage.error.invalid_response');
    default: return t('ui.setup.storage.error.unavailable');
  }
}

function ownerMessage(code: OwnerFormCode | OwnerFailureCode, t: Translator): string {
  switch (code) {
    case 'required': return t('ui.setup.owner.required');
    case 'too_short': return t('ui.setup.owner.too_short');
    case 'too_long': return t('ui.setup.owner.too_long');
    case 'mismatch': return t('ui.setup.owner.mismatch');
    case 'owner_exists': return t('ui.setup.owner.error.owner_exists');
    case 'invalid_request': return t('ui.setup.owner.error.invalid_request');
    case 'state_refused': return t('ui.setup.owner.error.state_refused');
    case 'session_expired': return t('ui.setup.owner.error.session_expired');
    case 'network': return t('ui.setup.owner.error.network');
    case 'timeout': return t('ui.setup.owner.error.timeout');
    case 'invalid-response': return t('ui.setup.owner.error.invalid_response');
    default: return t('ui.setup.owner.error.unavailable');
  }
}

/** The server state is the only source of truth for where the wizard resumes. */
function panelForState(state: string): Panel {
  switch (state) {
    case 'ai_configured': return 'ai';
    case 'ai_deferred':
    case 'storage_ready': return state === 'storage_ready' ? 'owner' : 'storage';
    case 'owner_ready':
    case 'configuring': return 'configure';
    case 'verifying':
    case 'complete': return 'verify';
    default: return 'ai';
  }
}

/**
 * Honest progress: a deferred AI step stays pending, a postponed section is
 * never a pass, and verification only fills once the run itself has observed
 * the checklist.
 */
function stepStatuses(state: string, panel: Panel, aiDeferred: boolean): Record<StepKey, StepStatus> {
  const rank: Record<string, number> = {
    claimed: 0,
    ai_configured: 1,
    ai_deferred: 1,
    storage_ready: 2,
    owner_ready: 3,
    configuring: 4,
    verifying: 5,
    complete: 5,
  };
  const current = rank[state] ?? 0;
  const ai: StepStatus = aiDeferred || current < 1
    ? (panel === 'ai' ? 'active' : 'pending')
    : 'done';
  const storage: StepStatus = current >= 2
    ? 'done'
    : current === 1 ? (panel === 'storage' ? 'active' : 'pending') : 'pending';
  const owner: StepStatus = current >= 3
    ? 'done'
    : current === 2 ? (panel === 'owner' ? 'active' : 'pending') : 'pending';
  const configuration: StepStatus = current >= 5
    ? 'done'
    : current === 4 ? (panel === 'configure' ? 'active' : 'pending') : 'pending';
  const verify: StepStatus = state === 'complete'
    ? 'done'
    : current >= 4 ? (panel === 'verify' ? 'active' : 'pending') : 'pending';
  return {
    claim: 'done',
    ai,
    storage,
    owner,
    configuration,
    verify,
  };
}

export function SetupApp({ initialSession = null, client = setupClient }: SetupAppProps) {
  const [t, setT] = useState<Translator | null>(null);
  const [step, setStep] = useState<Step>(initialSession ? 'claimed' : 'claim');
  const [state, setState] = useState<string>(initialSession?.state ?? '');
  const [panel, setPanel] = useState<Panel>(initialSession ? panelForState(initialSession.state) : 'ai');
  const [credential, setCredential] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [resumeFailed, setResumeFailed] = useState(false);
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

  const [engine, setEngine] = useState<'postgresql' | 'sqlite'>('postgresql');
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [checkedUrl, setCheckedUrl] = useState<string | null>(null);
  const [probe, setProbe] = useState<StorageProbe | null>(null);
  const [storageError, setStorageError] = useState<StorageDiagnosticCode | null>(null);
  const [storageRequired, setStorageRequired] = useState(false);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [storageSummary, setStorageSummary] = useState<StorageSummary | null>(null);

  const [ownerForm, setOwnerForm] = useState<OwnerFormState>(emptyOwnerForm);
  const [ownerError, setOwnerError] = useState<OwnerFormCode | OwnerFailureCode | null>(null);
  const [creatingOwner, setCreatingOwner] = useState(false);
  const [ownerReceipt, setOwnerReceipt] = useState<{ username: string; displayName: string } | null>(null);
  const [ownerAi, setOwnerAi] = useState<'transferred' | 'pending' | null>(null);

  const [aiDeferred, setAiDeferred] = useState(initialSession?.state === 'ai_deferred');
  const [sections, setSections] = useState<SectionView[]>([]);
  const [configurationLoading, setConfigurationLoading] = useState(false);
  const [configurationError, setConfigurationError] = useState<ConfigurationDiagnosticCode | null>(null);
  const [configBusy, setConfigBusy] = useState<SectionId | null>(null);
  const [previews, setPreviews] = useState<Partial<Record<SectionId, SectionPreview>>>({});
  const [receipts, setReceipts] = useState<Partial<Record<SectionId, SectionApplyReceipt>>>({});
  const [verifyingInstallation, setVerifyingInstallation] = useState(false);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [verifyBlocked, setVerifyBlocked] = useState<ChecklistItem[] | null>(null);
  const [verifyError, setVerifyError] = useState<ConfigurationDiagnosticCode | null>(null);

  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const aiErrorRef = useRef<HTMLDivElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const pendingNotice = useRef<HTMLElement>(null);
  const assistantErrorRef = useRef<HTMLParagraphElement>(null);
  const storageErrorRef = useRef<HTMLDivElement>(null);
  const ownerErrorRef = useRef<HTMLDivElement>(null);
  const ownerReceiptRef = useRef<HTMLHeadingElement>(null);
  const claimMessageRef = useRef<HTMLDivElement>(null);
  const configurationLoaded = useRef(false);

  useEffect(() => {
    let active = true;
    void loadTranslator().then((loaded) => { if (active) setT(() => loaded); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    // A claimed installation reloads with only its cookie. getSession() returns
    // the session CSRF token, so refreshing here is what lets a resumed wizard
    // mutate; a denied session sends the operator back to the claim form.
    if (!initialSession) return;
    let active = true;
    void client.getSession().then((result) => {
      if (!active) return;
      if (result.ok) {
        setState(result.session.state);
        setPanel(panelForState(result.session.state));
      } else if (result.reason === 'denied') {
        setResumeFailed(true);
        setStep('claim');
      }
    });
    return () => { active = false; };
    // The session is read once per mount; a reload mounts a new wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === 'claimed') heading.current?.focus();
  }, [step]);

  useEffect(() => {
    // A rejected credential is announced where the operator is: the summary is
    // the alert, and it takes focus so a keyboard user hears the reason before
    // returning to the field, which is still the next control in tab order.
    if (step !== 'claim' || (!message && !resumeFailed)) return;
    claimMessageRef.current?.focus();
  }, [message, step, resumeFailed]);

  useEffect(() => {
    if (step !== 'claimed' || panel !== 'configure' || configurationLoaded.current) return;
    configurationLoaded.current = true;
    void loadConfiguration();
    // One automatic attempt per mount; the panel's reload button drives every
    // later attempt explicitly, so a failing service cannot loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, step]);

  useEffect(() => {
    // A panel change is the wizard moving forward; announce it by moving the
    // caret to the new heading instead of leaving it on a vanished button.
    if (step === 'claimed') panelHeading.current?.focus();
  }, [panel, step]);

  useEffect(() => {
    // A state change and its focus target are committed together, so the
    // refs below exist by the time this runs. Clearing the request keeps the
    // user's own focus afterwards.
    if (!focusRequest) return;
    if (focusRequest.target === 'receipt') receiptHeading.current?.focus();
    if (focusRequest.target === 'pending') pendingNotice.current?.focus();
    if (focusRequest.target === 'error') aiErrorRef.current?.focus();
    if (focusRequest.target === 'assistant') assistantErrorRef.current?.focus();
    if (focusRequest.target === 'panel') panelHeading.current?.focus();
    if (focusRequest.target === 'storage-error') storageErrorRef.current?.focus();
    if (focusRequest.target === 'owner-error') ownerErrorRef.current?.focus();
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
      // The summary announces itself; the effect above moves focus to it.
      setMessage(t!('ui.setup.claim.required'));
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
      setResumeFailed(false);
      setState(result.state ?? 'claimed');
      setStep('claimed');
      return;
    }
    setMessage(claimMessage(result, t!));
    setAttempts(result.attemptsRemaining);
    if (result.code === 'locked') {
      setLocked(true);
    }
    // The alert is the next thing to read; the effect focuses it once rendered.
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
      setAiDeferred(false);
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
      // A deferred provider is not this wizard's work: the database step is
      // next, and the progress list and the agent section keep AI as pending.
      setAiDeferred(true);
      setPanel('storage');
      return;
    }
    setAiError(result.code);
    setFocusRequest({ target: 'error' });
  }

  async function checkDatabase() {
    if (checking || applying) return;
    const url = databaseUrl.trim();
    if (!url) {
      setStorageRequired(true);
      setStorageError(null);
      return;
    }
    setChecking(true);
    setStorageRequired(false);
    setStorageError(null);
    setProbe(null);
    setCheckedUrl(url);
    const result = await client.checkStorage(url);
    setChecking(false);
    if (!result.ok) {
      setStorageError(result.code);
      setFocusRequest({ target: 'storage-error' });
      return;
    }
    setProbe(result.probe);
  }

  async function applyDatabase() {
    if (checking || applying) return;
    const url = checkedUrl;
    if (!probe || !url || !canApply) return;
    setApplying(true);
    setStorageError(null);
    const result = await client.applyStorage(url);
    setApplying(false);
    // The URL is not a field of the wizard after the request: external
    // databases stay as a read-only summary, and the field disappears either
    // way so a later reload cannot resubmit it.
    setDatabaseUrl('');
    setProbe(null);
    setCheckedUrl(null);
    if (!result.ok) {
      setStorageError(result.code);
      setFocusRequest({ target: 'storage-error' });
      return;
    }
    setState(result.state);
    setStorageSummary(result.storage);
    if (result.storage.configSource === 'external') {
      // The environment pinned this database; the wizard can only show it.
      return;
    }
    setPanel('owner');
  }

  async function createOwnerAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingOwner) return;
    const invalid = validateOwnerForm(ownerForm);
    if (invalid) {
      setOwnerError(invalid);
      setFocusRequest({ target: 'owner-error' });
      return;
    }
    setCreatingOwner(true);
    setOwnerError(null);
    const result = await client.createOwner(ownerInput(ownerForm));
    setCreatingOwner(false);
    // Both secrets leave React state on every outcome, and the form drops them
    // from the DOM: only the identity draft survives a rejection.
    setOwnerForm((current) => clearOwnerSecrets(current));
    if (!result.ok) {
      setOwnerError(result.code);
      setFocusRequest({ target: 'owner-error' });
      return;
    }
    setState(result.state);
    setOwnerReceipt(result.owner);
    setOwnerAi(result.ai);
    // The installation has an owner; the wizard now configures it and verifies
    // the result, so this is not a terminal "done" panel.
    setPanel('configure');
  }

  /**
   * Enter configuration once per panel visit: the service moves an owner-ready
   * installation to ``configuring``, then each section is read for its
   * effective value and source. A failed read is reported as a code; no
   * section keeps a stale value it could not confirm.
   */
  async function loadConfiguration() {
    setConfigurationLoading(true);
    setConfigurationError(null);
    if (state === 'owner_ready') {
      const started = await client.startConfiguration();
      if (!started.ok) {
        setConfigurationLoading(false);
        setConfigurationError(started.code);
        return;
      }
      setState(started.state);
    }
    const results = await Promise.all(SECTION_IDS.map((id) => client.getSection(id)));
    setConfigurationLoading(false);
    const failure = results.find((result) => !result.ok);
    if (failure && !failure.ok) {
      setConfigurationError(failure.code);
      return;
    }
    setSections(results.flatMap((result) => (result.ok ? [result.section] : [])));
  }

  async function previewConfiguration(section: SectionId, value: string) {
    if (configBusy) return;
    setConfigBusy(section);
    setConfigurationError(null);
    const result = await client.previewSection(section, value);
    setConfigBusy(null);
    if (!result.ok) {
      setConfigurationError(result.code);
      return;
    }
    setPreviews((current) => ({ ...current, [section]: result.preview }));
  }

  async function applyConfiguration(section: SectionId, value: string) {
    if (configBusy) return;
    setConfigBusy(section);
    setConfigurationError(null);
    const result = await client.applySection(section, value, true);
    setConfigBusy(null);
    if (!result.ok) {
      setConfigurationError(result.code);
      return;
    }
    // The receipt is the service's read-back: the section takes its status
    // and the applied value from it, never from the request that was sent.
    setSections((current) => current.map((entry) => (entry.id === section
      ? { ...entry, status: result.receipt.status, source: 'installation', value }
      : entry)));
    setPreviews((current) => {
      const next = { ...current };
      delete next[section];
      return next;
    });
    setReceipts((current) => ({ ...current, [section]: result.receipt }));
    const refreshed = await client.getSection(section);
    if (refreshed.ok) {
      setSections((current) => current.map((entry) => (entry.id === section ? refreshed.section : entry)));
    }
  }

  async function postponeConfiguration(section: SectionId) {
    if (configBusy) return;
    setConfigBusy(section);
    setConfigurationError(null);
    const result = await client.postponeSection(section);
    setConfigBusy(null);
    if (!result.ok) {
      setConfigurationError(result.code);
      return;
    }
    // A postponement is recorded as itself: the chip says so and verification
    // reports it apart from the passes.
    setSections((current) => current.map((entry) => (entry.id === section
      ? { ...entry, status: 'postponed' }
      : entry)));
    setPreviews((current) => {
      const next = { ...current };
      delete next[section];
      return next;
    });
    setReceipts((current) => {
      const next = { ...current };
      delete next[section];
      return next;
    });
  }

  async function verifyInstallation() {
    if (verifyingInstallation) return;
    setVerifyingInstallation(true);
    setConfigurationError(null);
    setVerifyError(null);
    setVerifyBlocked(null);
    const result = await client.verify();
    setVerifyingInstallation(false);
    if (!result.ok) {
      setVerifyError(result.code);
      return;
    }
    setState(result.state);
    setChecklist(result.checklist);
    const outcome = verifyOutcome(result.checklist);
    if (result.state === 'verifying' || result.state === 'complete') {
      setPanel('verify');
      return;
    }
    // Verification did not pass: the operator stays where the fix is, with the
    // blocking items named and their observed status shown.
    setVerifyBlocked(outcome.blocked);
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (asking) return;
    await askQuestion(question.trim());
  }

  /** One assistant call shared by the AI step and the configuration panel. */
  async function askQuestion(value: string) {
    if (asking) return;
    if (!value) {
      setAssistantError('form-incomplete');
      if (panel === 'ai') {
        setFocusRequest({ target: 'assistant' });
        // The alert mounts in this commit; the frame callback finds it even
        // when the effect ran before the portal's ref was attached.
        requestAnimationFrame(() => assistantErrorRef.current?.focus());
      }
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
    if (panel === 'ai') setFocusRequest({ target: 'assistant' });
  }

  const claimAlert = message ?? (resumeFailed ? t('ui.setup.resume.failed') : null);
  const describedBy = claimAlert ? 'setup-credential-hint setup-message' : 'setup-credential-hint';
  const statuses = stepStatuses(state, panel, aiDeferred);
  const canApply = probe !== null
    && probe.reachable
    && probe.adoptable
    && (probe.classification === 'empty' || probe.classification === 'ours')
    && checkedUrl !== null
    && checkedUrl === databaseUrl.trim()
    && !checking
    && !applying;
  const badge = (status: StepStatus) => t!(
    status === 'done' ? 'ui.setup.steps.done'
      : status === 'active' ? 'ui.setup.steps.active'
        : 'ui.setup.steps.pending',
  );

  if (step === 'claimed') {
    const configured = state === 'ai_configured';
    const deferred = state === 'ai_deferred';
    const aiBusy = verifying || deferring;
    const incomplete = aiError === 'form-incomplete';
    // One empty field must not mark the other two invalid.
    const baseInvalid = incomplete && !baseUrl.trim();
    const modelInvalid = incomplete && !model.trim();
    const keyInvalid = incomplete && !apiKey;
    const fieldInvalid = baseInvalid;
    const fieldDescribedBy = baseInvalid ? 'setup-ai-base-hint setup-ai-error' : 'setup-ai-base-hint';
    const keyDescribedBy = keyInvalid ? 'setup-ai-key-hint setup-ai-error' : 'setup-ai-key-hint';
    const external = storageSummary?.configSource === 'external' ? storageSummary : null;
    const classificationText = probe === null ? '' : t(
      probe.classification === 'empty' ? 'ui.setup.storage.class_empty'
        : probe.classification === 'ours' ? 'ui.setup.storage.class_ours'
          : probe.classification === 'foreign' ? 'ui.setup.storage.class_foreign'
            : 'ui.setup.storage.class_unreachable',
    );

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
                {STEPS.map((entry) => {
                  const status = statuses[entry.key];
                  return (
                    <li
                      className={`setup-step setup-step--${status}`}
                      key={entry.key}
                      data-setup-progress={entry.key}
                      data-setup-step={status}
                    >
                      <span>{t(entry.label)}</span>
                      <span className="setup-step__badge" role="status">{badge(status)}</span>
                    </li>
                  );
                })}
              </ol>
            </section>
            <div className="setup__messages" aria-live="polite" aria-atomic="true">
              {claimAlert ? (
                <div className="form-alert" id="setup-message" role="alert" tabIndex={-1} ref={claimMessageRef}>{claimAlert}</div>
              ) : null}
            </div>

            {panel === 'ai' ? (
              <section className="setup__ai" aria-labelledby="setup-ai-title" data-setup-panel="ai">
                <h2 id="setup-ai-title" tabIndex={-1} ref={panelHeading}>{t('ui.setup.ai.title')}</h2>
                <p className="setup__lead">{t('ui.setup.ai.lead')}</p>

                {deferred ? (
                  <section
                    className="form-note setup__pending"
                    aria-labelledby="setup-ai-pending-title"
                    tabIndex={-1}
                    ref={pendingNotice}
                    data-setup-ai="deferred"
                  >
                    <div>
                      <h3 id="setup-ai-pending-title">{t('ui.setup.ai.pending_title')}</h3>
                      <p>{t('ui.setup.ai.pending_body')}</p>
                    </div>
                    <span className="setup-step__badge">{t('ui.setup.steps.pending')}</span>
                  </section>
                ) : null}

                {configured ? (
                  <section aria-labelledby="setup-ai-receipt-title" data-setup-ai="configured">
                    <h3 id="setup-ai-receipt-title" tabIndex={-1} ref={receiptHeading}>{t('ui.setup.ai.receipt_title')}</h3>
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
                    <div className="setup__ai-actions">
                      <button
                        className="btn btn--primary"
                        type="button"
                        id="setup-ai-continue"
                        onClick={() => setPanel('storage')}
                      >
                        {t('ui.setup.ai.continue_label')}
                      </button>
                    </div>
                    <form className="login-form" noValidate onSubmit={ask} aria-busy={asking}>
                      <h4>{t('ui.setup.ai.assistant_title')}</h4>
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
                            aria-describedby={assistantError ? 'setup-assistant-hint setup-assistant-error' : 'setup-assistant-hint'}
                            onChange={(event) => setQuestion(event.target.value)}
                          />
                        </div>
                        <p className="field__hint" id="setup-assistant-hint">{t('ui.setup.ai.assistant_hint')}</p>
                      </div>
                      <div className="setup__messages" aria-live="polite" aria-atomic="true">
                        {asking ? <p className="form-note" role="status">{t('ui.setup.ai.assistant_progress')}</p> : null}
                        {assistantError ? (
                          <p className="form-alert" id="setup-assistant-error" role="alert" tabIndex={-1} ref={assistantErrorRef}>
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
                  <div
                    className="setup__ai-form"
                    data-setup-ai={keyMissing ? 'blocked' : 'form'}
                  >
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
                      <div className={`field${modelInvalid ? ' field--invalid' : ''}`}>
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
                            aria-invalid={modelInvalid ? true : undefined}
                            aria-describedby={modelInvalid ? 'setup-ai-model-hint setup-ai-error' : 'setup-ai-model-hint'}
                            onChange={(event) => setModel(event.target.value)}
                          />
                        </div>
                        <p className="field__hint" id="setup-ai-model-hint">{t('ui.setup.ai.model_hint')}</p>
                      </div>
                      <div className={`field${keyInvalid ? ' field--invalid' : ''}`}>
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
                            aria-invalid={keyInvalid ? true : undefined}
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
                        <button
                          className="btn btn--secondary"
                          type="button"
                          id="setup-ai-defer"
                          disabled={aiBusy}
                          onClick={() => { void continueWithoutAi(); }}
                        >
                          {deferring ? t('ui.setup.ai.deferring') : t('ui.setup.ai.defer')}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </section>
            ) : null}

            {panel === 'storage' ? (
              <section className="setup__ai" aria-labelledby="setup-storage-title" data-setup-panel="storage">
                <h2 id="setup-storage-title" tabIndex={-1} ref={panelHeading}>{t('ui.setup.storage.title')}</h2>
                <p className="setup__lead">{t('ui.setup.storage.lead')}</p>

                {deferred ? (
                  <div className="form-note setup__pending" data-setup-ai="deferred">
                    <div>
                      <h3>{t('ui.setup.ai.pending_title')}</h3>
                      <p>{t('ui.setup.ai.pending_body')}</p>
                    </div>
                    <span className="setup-step__badge">{t('ui.setup.steps.pending')}</span>
                  </div>
                ) : null}

                {external ? (
                  <div className="setup__operator" data-setup-storage="external">
                    <h3>{t('ui.setup.storage.external_title')}</h3>
                    <p>{t('ui.setup.storage.external_body')}</p>
                    <dl className="setup__receipt">
                      <div>
                        <dt>{t('ui.setup.storage.probe_engine')}</dt>
                        <dd data-setup-storage="engine">{external.engine}</dd>
                      </div>
                      <div>
                        <dt>{t('ui.setup.storage.probe_version')}</dt>
                        <dd data-setup-storage="version">{external.version ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>{t('ui.setup.storage.probe_identity')}</dt>
                        <dd data-setup-storage="identity">{external.identity ?? '—'}</dd>
                      </div>
                    </dl>
                    <div className="setup__ai-actions">
                      <button
                        className="btn btn--primary"
                        type="button"
                        id="setup-storage-continue"
                        onClick={() => setPanel('owner')}
                      >
                        {t('ui.setup.storage.continue')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <form className="login-form" noValidate onSubmit={(event) => { event.preventDefault(); void checkDatabase(); }} aria-busy={checking || applying}>
                    <fieldset className="setup__engine" data-setup-engine-options>
                      <legend>{t('ui.setup.storage.engine_label')}</legend>
                      <label className="setup__engine-option" htmlFor="setup-storage-engine-postgres">
                        <input
                          id="setup-storage-engine-postgres"
                          type="radio"
                          name="storage-engine"
                          value="postgresql"
                          checked={engine === 'postgresql'}
                          disabled={checking || applying}
                          onChange={() => { setEngine('postgresql'); setProbe(null); setCheckedUrl(null); }}
                        />
                        <span>{t('ui.setup.storage.engine_postgres')}</span>
                        <span className="setup-step__badge">{t('ui.setup.storage.recommended')}</span>
                      </label>
                      <p className="field__hint">{t('ui.setup.storage.engine_postgres_hint')}</p>
                      <label className="setup__engine-option" htmlFor="setup-storage-engine-sqlite">
                        <input
                          id="setup-storage-engine-sqlite"
                          type="radio"
                          name="storage-engine"
                          value="sqlite"
                          checked={engine === 'sqlite'}
                          disabled={checking || applying}
                          onChange={() => { setEngine('sqlite'); setProbe(null); setCheckedUrl(null); }}
                        />
                        <span>{t('ui.setup.storage.engine_sqlite')}</span>
                      </label>
                      <p className="field__hint">{t('ui.setup.storage.engine_sqlite_hint')}</p>
                    </fieldset>

                    <div className={`field${storageError === 'invalid_request' || storageRequired ? ' field--invalid' : ''}`}>
                      <label htmlFor="setup-storage-url">{t('ui.setup.storage.url')}</label>
                      <div className="input-shell">
                        <input
                          id="setup-storage-url"
                          type="password"
                          name="database_url"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={engine === 'sqlite'
                            ? 'sqlite:////var/lib/itsm/itsm.db'
                            : 'postgresql+psycopg://user:password@host:5432/itsm'}
                          value={databaseUrl}
                          disabled={checking || applying}
                          aria-invalid={storageError === 'invalid_request' || storageRequired ? true : undefined}
                          aria-describedby={storageError ? 'setup-storage-url-hint setup-storage-error' : 'setup-storage-url-hint'}
                          onChange={(event) => {
                            setDatabaseUrl(event.target.value);
                            setProbe(null);
                            setCheckedUrl(null);
                            setStorageError(null);
                            setStorageRequired(false);
                          }}
                        />
                      </div>
                      <p className="field__hint" id="setup-storage-url-hint">
                        {engine === 'sqlite' ? t('ui.setup.storage.url_hint_sqlite') : t('ui.setup.storage.url_hint')}
                      </p>
                    </div>

                    <div className="setup__messages" aria-live="assertive" aria-atomic="true">
                      {storageRequired ? (
                        <p className="form-alert" role="alert">{t('ui.setup.storage.required')}</p>
                      ) : null}
                      {storageError ? (
                        <div className="form-alert" id="setup-storage-error" role="alert" tabIndex={-1} ref={storageErrorRef}>
                          <div>
                            <p><strong>{t('ui.setup.storage.error_title')}</strong></p>
                            <p>{storageMessage(storageError, t)}</p>
                          </div>
                        </div>
                      ) : null}
                      {checking ? <p className="form-note" role="status">{t('ui.setup.storage.checking')}</p> : null}
                      {applying ? <p className="form-note" role="status">{t('ui.setup.storage.applying')}</p> : null}
                    </div>

                    <div className="setup__ai-actions">
                      <button
                        className="btn btn--secondary"
                        type="submit"
                        id="setup-storage-check"
                        disabled={checking || applying || !databaseUrl.trim()}
                      >
                        {checking ? t('ui.setup.storage.checking') : t('ui.setup.storage.check')}
                      </button>
                      <button
                        className="btn btn--primary"
                        type="button"
                        id="setup-storage-apply"
                        disabled={!canApply}
                        onClick={() => { void applyDatabase(); }}
                      >
                        {applying ? t('ui.setup.storage.applying') : t('ui.setup.storage.apply')}
                      </button>
                    </div>

                    {probe ? (
                      <section
                        aria-labelledby="setup-storage-probe-title"
                        data-setup-storage-probe
                        data-setup-probe-class={probe.classification}
                      >
                        <h3 id="setup-storage-probe-title">{t('ui.setup.storage.probe_title')}</h3>
                        <dl className="setup__receipt">
                          <div>
                            <dt>{t('ui.setup.storage.probe_classification')}</dt>
                            <dd data-setup-probe="classification">{classificationText}</dd>
                          </div>
                          <div>
                            <dt>{t('ui.setup.storage.probe_engine')}</dt>
                            <dd data-setup-probe="engine">{probe.engine ?? '—'}</dd>
                          </div>
                          <div>
                            <dt>{t('ui.setup.storage.probe_version')}</dt>
                            <dd data-setup-probe="version">{probe.version ?? '—'}</dd>
                          </div>
                          <div>
                            <dt>{t('ui.setup.storage.probe_identity')}</dt>
                            <dd data-setup-probe="identity">{probe.identity ?? '—'}</dd>
                          </div>
                        </dl>
                        {probe.classification === 'foreign' || !probe.adoptable ? (
                          <div className="form-note setup__operator" data-setup-probe="blocked">
                            <div>
                              <h3>{t('ui.setup.storage.foreign_title')}</h3>
                              <p>{t('ui.setup.storage.foreign_body')}</p>
                            </div>
                          </div>
                        ) : null}
                        {probe.classification === 'unreachable' ? (
                          <div className="form-note setup__operator" data-setup-probe="unreachable">
                            <div>
                              <h3>{t('ui.setup.storage.unreachable_title')}</h3>
                              <p>{t('ui.setup.storage.unreachable_body')}</p>
                            </div>
                          </div>
                        ) : null}
                      </section>
                    ) : null}

                    {storageSummary && !external ? (
                      <div className="form-note" data-setup-storage="ready">
                        <div>
                          <h3>{t('ui.setup.storage.ready_title')}</h3>
                          <p>{t('ui.setup.storage.ready_body')}</p>
                        </div>
                      </div>
                    ) : null}
                  </form>
                )}
              </section>
            ) : null}

            {panel === 'owner' ? (
              <section className="setup__ai" aria-labelledby="setup-owner-title" data-setup-panel="owner">
                <h2 id="setup-owner-title" tabIndex={-1} ref={panelHeading}>{t('ui.setup.owner.title')}</h2>
                <p className="setup__lead">{t('ui.setup.owner.lead')}</p>
                <form className="login-form" noValidate onSubmit={createOwnerAccount} aria-busy={creatingOwner}>
                  <div className="setup__messages" aria-live="assertive" aria-atomic="true">
                    {ownerError ? (
                      <div className="form-alert" id="setup-owner-error" role="alert" tabIndex={-1} ref={ownerErrorRef}>
                        <div>
                          <p><strong>{t('ui.setup.owner.error_title')}</strong></p>
                          <p>{ownerMessage(ownerError, t)}</p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className={`field${ownerError === 'required' ? ' field--invalid' : ''}`}>
                    <label htmlFor="setup-owner-username">{t('ui.setup.owner.username')}</label>
                    <div className="input-shell">
                      <input
                        id="setup-owner-username"
                        type="text"
                        name="username"
                        autoComplete="username"
                        spellCheck={false}
                        maxLength={64}
                        value={ownerForm.username}
                        disabled={creatingOwner}
                        aria-invalid={ownerError === 'required' ? true : undefined}
                        aria-describedby="setup-owner-username-hint"
                        onChange={(event) => setOwnerForm({ ...ownerForm, username: event.target.value })}
                      />
                    </div>
                    <p className="field__hint" id="setup-owner-username-hint">{t('ui.setup.owner.username_hint')}</p>
                  </div>
                  <div className={`field${ownerError === 'required' ? ' field--invalid' : ''}`}>
                    <label htmlFor="setup-owner-display-name">{t('ui.setup.owner.display_name')}</label>
                    <div className="input-shell">
                      <input
                        id="setup-owner-display-name"
                        type="text"
                        name="display_name"
                        autoComplete="name"
                        maxLength={120}
                        value={ownerForm.displayName}
                        disabled={creatingOwner}
                        aria-invalid={ownerError === 'required' ? true : undefined}
                        aria-describedby="setup-owner-display-hint"
                        onChange={(event) => setOwnerForm({ ...ownerForm, displayName: event.target.value })}
                      />
                    </div>
                    <p className="field__hint" id="setup-owner-display-hint">{t('ui.setup.owner.display_name_hint')}</p>
                  </div>
                  <div className={`field${ownerError === 'invalid_request' ? ' field--invalid' : ''}`}>
                    <label htmlFor="setup-owner-email">{t('ui.setup.owner.email')}</label>
                    <div className="input-shell">
                      <input
                        id="setup-owner-email"
                        type="email"
                        name="email"
                        autoComplete="email"
                        inputMode="email"
                        spellCheck={false}
                        maxLength={254}
                        value={ownerForm.email}
                        disabled={creatingOwner}
                        aria-invalid={ownerError === 'invalid_request' ? true : undefined}
                        aria-describedby="setup-owner-email-hint"
                        onChange={(event) => setOwnerForm({ ...ownerForm, email: event.target.value })}
                      />
                    </div>
                    <p className="field__hint" id="setup-owner-email-hint">{t('ui.setup.owner.email_hint')}</p>
                  </div>
                  <div className={`field${ownerError === 'too_short' || ownerError === 'too_long' ? ' field--invalid' : ''}`}>
                    <label htmlFor="setup-owner-password">{t('ui.setup.owner.password')}</label>
                    <div className="input-shell">
                      <input
                        id="setup-owner-password"
                        type="password"
                        name="new-password"
                        autoComplete="new-password"
                        value={ownerForm.password}
                        disabled={creatingOwner}
                        aria-invalid={ownerError === 'too_short' || ownerError === 'too_long' ? true : undefined}
                        aria-describedby="setup-owner-password-hint"
                        onChange={(event) => setOwnerForm({ ...ownerForm, password: event.target.value })}
                      />
                    </div>
                    <p className="field__hint" id="setup-owner-password-hint">{t('ui.setup.owner.password_hint')}</p>
                  </div>
                  <div className={`field${ownerError === 'mismatch' ? ' field--invalid' : ''}`}>
                    <label htmlFor="setup-owner-confirm">{t('ui.setup.owner.confirm')}</label>
                    <div className="input-shell">
                      <input
                        id="setup-owner-confirm"
                        type="password"
                        name="confirm"
                        autoComplete="new-password"
                        value={ownerForm.confirm}
                        disabled={creatingOwner}
                        aria-invalid={ownerError === 'mismatch' ? true : undefined}
                        aria-describedby="setup-owner-confirm-hint"
                        onChange={(event) => setOwnerForm({ ...ownerForm, confirm: event.target.value })}
                      />
                    </div>
                    <p className="field__hint" id="setup-owner-confirm-hint">{t('ui.setup.owner.password_hint')}</p>
                  </div>
                  <div className="setup__messages" aria-live="polite" aria-atomic="true">
                    {creatingOwner ? <p className="form-note" role="status">{t('ui.setup.owner.progress')}</p> : null}
                  </div>
                  <button
                    className="btn btn--primary login-submit"
                    type="submit"
                    id="setup-owner-submit"
                    disabled={creatingOwner}
                  >
                    {creatingOwner ? t('ui.setup.owner.submitting') : t('ui.setup.owner.submit')}
                  </button>
                </form>
              </section>
            ) : null}

            {panel === 'configure' ? (
              <>
                {ownerReceipt ? (
                  <section className="form-note" aria-labelledby="setup-owner-created" data-setup-owner="created">
                    <div>
                      <h3 id="setup-owner-created" tabIndex={-1} ref={ownerReceiptRef}>{t('ui.setup.owner.receipt_title')}</h3>
                      <dl className="setup__receipt">
                        <div>
                          <dt>{t('ui.setup.owner.receipt_username')}</dt>
                          <dd data-setup-owner-field="username">{ownerReceipt.username}</dd>
                        </div>
                        <div>
                          <dt>{t('ui.setup.owner.receipt_name')}</dt>
                          <dd data-setup-owner-field="display-name">{ownerReceipt.displayName}</dd>
                        </div>
                      </dl>
                      {ownerAi ? (
                        <p className="field__hint">
                          {ownerAi === 'transferred' ? t('ui.setup.owner.ai_transferred') : t('ui.setup.owner.ai_pending')}
                        </p>
                      ) : null}
                    </div>
                  </section>
                ) : null}
                <ConfigurationPanel
                  t={t}
                  headingRef={panelHeading}
                  sections={sections}
                  loading={configurationLoading}
                  error={configurationError}
                  busy={configBusy}
                  previews={previews}
                  receipts={receipts}
                  blocked={verifyBlocked}
                  aiDeferred={aiDeferred}
                  appUsable={state === 'complete'}
                  verifying={verifyingInstallation}
                  verifyError={verifyError}
                  assistant={{ answer, tools: answerTools, latency: answerLatency, asking, error: assistantError }}
                  onPreview={(section, value) => { void previewConfiguration(section, value); }}
                  onApply={(section, value) => { void applyConfiguration(section, value); }}
                  onDiscard={(section) => {
                    setPreviews((current) => {
                      const next = { ...current };
                      delete next[section];
                      return next;
                    });
                  }}
                  onPostpone={(section) => { void postponeConfiguration(section); }}
                  onVerify={() => { void verifyInstallation(); }}
                  onReload={() => { void loadConfiguration(); }}
                  onAsk={(value) => { void askQuestion(value); }}
                />
              </>
            ) : null}

            {panel === 'verify' ? (
              <VerifyPanel
                t={t}
                headingRef={panelHeading}
                checklist={checklist}
                state={state}
                verifying={verifyingInstallation}
                appUsable={state === 'complete'}
                onVerify={() => { void verifyInstallation(); }}
                onBack={() => setPanel('configure')}
              />
            ) : null}
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
            <div className="setup__messages" aria-live="polite" aria-atomic="true">
              {claimAlert ? (
                <div className="form-alert" id="setup-message" role="alert" tabIndex={-1} ref={claimMessageRef}>{claimAlert}</div>
              ) : null}
            </div>
            <div className={`field${message || resumeFailed ? ' field--invalid' : ''}`}>
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
                  aria-invalid={message || resumeFailed ? true : undefined}
                  aria-describedby={describedBy}
                  onChange={(event) => setCredential(event.target.value)}
                />
              </div>
              <p className="field__hint" id="setup-credential-hint">{t('ui.setup.claim.hint')}</p>
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
