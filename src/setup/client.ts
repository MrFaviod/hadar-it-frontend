// Setup probe and claim transport for the first-start wizard.
//
// It deliberately does not use AssetAccess: that client assumes an installed
// API, a session and a CSRF handshake, while this one must answer before any
// database or backend exists. The rule that matters here is the classification:
// only an explicit "setup is enabled and this install is unclaimed" may show
// the claim form. A 5xx, a timeout or a malformed body is unavailability, never
// a first install, so an edge blip cannot open a claim on a live instance.

export const SETUP_BASE = '/api/setup/v1';

export interface SetupStatus {
  state: string;
  mode: string | null;
  release_mode: string | null;
  setup_enabled: boolean;
  claim_available: boolean;
  backend: string | null;
  version: string | null;
  instance_id: string | null;
  checks?: Record<string, unknown>;
}

export interface SetupSession {
  state: string;
  mode: string | null;
  release_mode: string | null;
  checks: Record<string, unknown>;
}

export type StatusResult =
  | { kind: 'setup-available'; status: SetupStatus }
  | { kind: 'existing-instance'; reason: 'disabled' | 'state' | 'absent'; status: SetupStatus | null }
  | { kind: 'unavailable'; reason: 'network' | 'timeout' | 'server' | 'invalid' | 'aborted'; httpStatus: number | null };

export type ClaimFailureCode =
  | 'invalid'
  | 'locked'
  | 'unavailable'
  | 'network'
  | 'timeout'
  | 'invalid-response';

export type ClaimResult =
  | { ok: true; csrfToken: string; state: string | null }
  | { ok: false; code: ClaimFailureCode; attemptsRemaining: number | null; detail: string | null };

export type SessionResult =
  | { ok: true; session: SetupSession }
  | { ok: false; reason: 'denied' | 'unavailable' | 'network' | 'timeout' };

/** Closed classification of a candidate database; never the service's prose. */
export type StorageClassification = 'empty' | 'ours' | 'foreign';

export interface StorageProbe {
  reachable: boolean;
  engine: string | null;
  version: string | null;
  classification: StorageClassification | 'unreachable';
  identity: string | null;
  adoptable: boolean;
}

/** What apply_storage actually did; no database URL and no credential. */
export interface StorageSummary {
  engine: string;
  version: string | null;
  classification: 'empty' | 'ours';
  identity: string | null;
  configSource: 'installation' | 'external';
  migrated: boolean;
}

/** Closed diagnostics the storage and owner steps know how to explain. */
export type StorageDiagnosticCode =
  | 'unsupported_engine'
  | 'database_not_adoptable'
  | 'invalid_request'
  | 'state_refused'
  | 'session_expired'
  | 'unavailable'
  | 'network'
  | 'timeout'
  | 'invalid-response';

export type StorageCheckResult =
  | { ok: true; probe: StorageProbe }
  | { ok: false; code: StorageDiagnosticCode };

export type StorageApplyResult =
  | { ok: true; state: string; storage: StorageSummary }
  | { ok: false; code: StorageDiagnosticCode };

export interface OwnerInput {
  username: string;
  displayName: string;
  email?: string;
  password: string;
}

export interface OwnerReceipt {
  username: string;
  displayName: string;
}

export type OwnerFailureCode = StorageDiagnosticCode | 'owner_exists';

export type OwnerResult =
  | { ok: true; state: string; owner: OwnerReceipt; ai: 'transferred' | 'pending' }
  | { ok: false; code: OwnerFailureCode };

/** Closed diagnostics the AI step knows how to explain; never server text. */
export type AiDiagnosticCode =
  | 'provider_unreachable'
  | 'model_without_tools'
  | 'endpoint_forbidden'
  | 'credential_missing'
  | 'credential_key_missing'
  | 'auth_failed'
  | 'tool_not_called'
  | 'session_expired'
  | 'state_refused'
  | 'ai_not_configured'
  | 'unavailable'
  | 'network'
  | 'timeout'
  | 'invalid-response';

/** The sanitized receipt: an allowlist, so an echoing server adds nothing. */
export interface AiReceipt {
  status: 'configured' | 'pending';
  provider: string | null;
  model: string | null;
  tool: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  pending: boolean;
  reason: string | null;
  checkedAt: string | null;
  deferredAt: string | null;
}

export type AiResult =
  | { ok: true; state: string; receipt: AiReceipt }
  | { ok: false; code: AiDiagnosticCode };

export type AssistantResult =
  | { ok: true; answer: string; tools: string[]; latencyMs: number }
  | { ok: false; code: AiDiagnosticCode };

export type LogoutResult = { ok: true } | { ok: false; code: AiDiagnosticCode };

export interface AiProviderInput {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SetupClient {
  getStatus(options?: RequestOptions): Promise<StatusResult>;
  claim(credential: string, options?: RequestOptions): Promise<ClaimResult>;
  getSession(options?: RequestOptions): Promise<SessionResult>;
  /** Probes a candidate database; drives no transition and keeps no URL. */
  checkStorage(databaseUrl: string, options?: RequestOptions): Promise<StorageCheckResult>;
  /** Migrates and claims the candidate database for this release mode. */
  applyStorage(databaseUrl: string, options?: RequestOptions): Promise<StorageApplyResult>;
  /** Creates the first owner. The password is an argument of this call only. */
  createOwner(input: OwnerInput, options?: RequestOptions): Promise<OwnerResult>;
  /** One verification turn. The key lives in this call, never in the client. */
  configureAi(input: AiProviderInput, options?: RequestOptions): Promise<AiResult>;
  deferAi(options?: RequestOptions): Promise<AiResult>;
  askAssistant(question: string, options?: RequestOptions): Promise<AssistantResult>;
  /** Ends this browser's setup session; the token is dropped with it. */
  logout(options?: RequestOptions): Promise<LogoutResult>;
  /** In memory only: the setup session token never reaches any storage. */
  csrfToken(): string | null;
}

export type EntryDecision =
  | { view: 'wizard'; status: SetupStatus; session: SetupSession | null }
  | { view: 'legacy'; reason: 'installed' | 'unavailable' };

const SESSION_PROBE_TIMEOUT_MS = 1000;

// Boot decision, kept out of the component so it can be exercised without a
// DOM. A claimed installation still has a setup session in this browser: that
// is the only case where a second request is worth its latency. Everything
// else falls back to today's shell, and unavailability never shows a claim.
export async function resolveEntry(
  client: SetupClient,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<EntryDecision> {
  const status = await client.getStatus(options);
  if (status.kind === 'setup-available') return { view: 'wizard', status: status.status, session: null };
  if (status.kind === 'unavailable') return { view: 'legacy', reason: 'unavailable' };
  // A 404 means no setup service at all: there is no session to ask about.
  // Any other existing-instance answer may still carry a live setup session in
  // this browser (a reload after the claim), and that is the wizard's step.
  if (status.reason !== 'absent' && status.status) {
    const session = await client.getSession({
      signal: options.signal,
      timeoutMs: Math.min(SESSION_PROBE_TIMEOUT_MS, options.timeoutMs ?? SESSION_PROBE_TIMEOUT_MS),
    });
    if (session.ok) return { view: 'wizard', status: status.status, session: session.session };
  }
  return { view: 'legacy', reason: 'installed' };
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

type Transport =
  | { ok: true; response: Response }
  | { ok: false; reason: 'network' | 'timeout' | 'aborted' };

const DEFAULT_STATUS_TIMEOUT_MS = 1500;
const DEFAULT_WRITE_TIMEOUT_MS = 20000;
// Provider verification does a discovery round trip and one tool call.
const DEFAULT_AI_TIMEOUT_MS = 30000;
// A database probe or migration may wait on a remote engine.
const DEFAULT_STORAGE_TIMEOUT_MS = 30000;
// The assistant is bounded server-side at 30s; the client waits it out.
const DEFAULT_ASK_TIMEOUT_MS = 45000;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseStatus(value: unknown): SetupStatus | null {
  const raw = object(value);
  if (!raw) return null;
  if (typeof raw.setup_enabled !== 'boolean') return null;
  const state = text(raw.state);
  if (!state) return null;
  const status: SetupStatus = {
    state,
    mode: text(raw.mode),
    release_mode: text(raw.release_mode),
    setup_enabled: raw.setup_enabled,
    claim_available: raw.claim_available === true,
    backend: text(raw.backend),
    version: text(raw.version),
    instance_id: text(raw.instance_id),
  };
  if (raw.checks !== undefined) status.checks = object(raw.checks) ?? {};
  return status;
}

function parseSession(value: unknown): SetupSession | null {
  const raw = object(value);
  if (!raw) return null;
  const state = text(raw.state);
  if (!state) return null;
  return {
    state,
    mode: text(raw.mode),
    release_mode: text(raw.release_mode),
    checks: object(raw.checks) ?? {},
  };
}

function probeClass(value: unknown): StorageProbe['classification'] | null {
  return value === 'empty' || value === 'ours' || value === 'foreign' || value === 'unreachable'
    ? value
    : null;
}

// The service answers with a closed status (the contract calls it
// ``classification``); both spellings are accepted, anything else is a broken
// response rather than prose the wizard would render.
function parseStorageProbe(value: unknown): StorageProbe | null {
  const raw = object(value);
  if (!raw || typeof raw.reachable !== 'boolean') return null;
  const classification = probeClass(raw.classification ?? raw.status);
  if (!classification) return null;
  return {
    reachable: raw.reachable,
    engine: text(raw.engine),
    version: text(raw.version),
    classification,
    identity: text(raw.identity),
    adoptable: raw.adoptable === true,
  };
}

function parseStorageSummary(value: unknown): StorageSummary | null {
  const raw = object(value);
  if (!raw) return null;
  const engine = text(raw.engine);
  const classification = raw.status === 'empty' || raw.status === 'ours' ? raw.status : null;
  const configSource = raw.config_source === 'external'
    ? 'external'
    : raw.config_source === 'installation' ? 'installation' : null;
  if (!engine || !classification || !configSource) return null;
  return {
    engine,
    version: text(raw.version),
    classification,
    identity: text(raw.identity),
    configSource,
    migrated: raw.migrated === true,
  };
}

function parseOwnerResult(value: unknown): { owner: OwnerReceipt; ai: 'transferred' | 'pending' } | null {
  const raw = object(value);
  const owner = object(raw?.owner);
  const username = text(owner?.username);
  const displayName = text(owner?.display_name);
  const ai = raw?.ai === 'transferred' ? 'transferred' : raw?.ai === 'pending' ? 'pending' : null;
  if (!username || !displayName || !ai) return null;
  return { owner: { username, displayName }, ai };
}

// The agent API answers with one closed code in ``error`` (its routes never
// echo upstream text). Anything outside these sets is availability, not a
// diagnosis: unknown strings are dropped so nothing server-authored is ever
// rendered.
const AI_DIAGNOSTICS: readonly AiDiagnosticCode[] = [
  'provider_unreachable',
  'model_without_tools',
  'endpoint_forbidden',
  'credential_missing',
  'credential_key_missing',
  'auth_failed',
  'tool_not_called',
  'state_refused',
  'ai_not_configured',
];

const SESSION_ERROR_CODES = new Set([
  'authentication_required',
  'csrf_invalid',
  'origin_not_allowed',
  'setup_session_expired',
]);

function diagnosticOf(body: unknown, httpStatus: number): AiDiagnosticCode {
  const raw = object(body);
  const code = text(raw?.error) ?? text(raw?.detail);
  if (code && (AI_DIAGNOSTICS as readonly string[]).includes(code)) return code as AiDiagnosticCode;
  if (code && SESSION_ERROR_CODES.has(code)) return 'session_expired';
  if (httpStatus === 401 || httpStatus === 403) return 'session_expired';
  return 'unavailable';
}

const STORAGE_DIAGNOSTICS: readonly StorageDiagnosticCode[] = [
  'unsupported_engine',
  'database_not_adoptable',
  'invalid_request',
  'state_refused',
];

// Same rule as the AI step: the service's closed code is the only thing kept.
// Its ``guidance`` string is operator text and never reaches the page.
function diagnosticOfStorage(body: unknown, httpStatus: number): StorageDiagnosticCode {
  const raw = object(body);
  const code = text(raw?.error) ?? text(raw?.detail);
  if (code && (STORAGE_DIAGNOSTICS as readonly string[]).includes(code)) {
    return code as StorageDiagnosticCode;
  }
  if (code && SESSION_ERROR_CODES.has(code)) return 'session_expired';
  if (httpStatus === 401 || httpStatus === 403) return 'session_expired';
  return 'unavailable';
}

function diagnosticOfOwner(body: unknown, httpStatus: number): OwnerFailureCode {
  const code = text(object(body)?.error) ?? text(object(body)?.detail);
  if (code === 'owner_exists') return 'owner_exists';
  return diagnosticOfStorage(body, httpStatus);
}

function parseReceipt(value: unknown): AiReceipt | null {
  const raw = object(value);
  if (!raw) return null;
  const status = raw.status === 'configured' || raw.status === 'pending' ? raw.status : null;
  if (!status) return null;
  // A configured receipt without the host and model it claims proves nothing:
  // the wizard would render an empty success. Treat it as a broken response.
  if (status === 'configured' && (!text(raw.provider) || !text(raw.model))) return null;
  return {
    status,
    provider: text(raw.provider),
    model: text(raw.model),
    tool: text(raw.tool),
    latencyMs: integer(raw.latency_ms),
    inputTokens: integer(raw.input_tokens),
    outputTokens: integer(raw.output_tokens),
    pending: raw.pending === true || status === 'pending',
    reason: text(raw.reason),
    checkedAt: text(raw.checked_at),
    deferredAt: text(raw.deferred_at),
  };
}

function parseAiResult(body: unknown): AiResult | null {
  const raw = object(body);
  if (!raw) return null;
  const state = text(raw.state);
  const receipt = parseReceipt(raw.ai);
  if (!state || !receipt) return null;
  return { ok: true, state, receipt };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function parseAnswer(body: unknown): AssistantResult | null {
  const raw = object(body);
  if (!raw) return null;
  const answer = text(raw.answer);
  if (!answer) return null;
  return {
    ok: true,
    answer,
    tools: strings(raw.tools),
    latencyMs: integer(raw.latency_ms) ?? 0,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function detailOf(value: unknown): string | null {
  const raw = object(value);
  if (!raw) return null;
  const direct = text(raw.detail) ?? text(raw.message);
  if (direct) return direct;
  const nested = object(raw.detail);
  return nested ? text(nested.message) : null;
}

function tokenOf(value: unknown): string | null {
  const raw = object(value);
  if (!raw) return null;
  return text(raw.csrf_token) ?? text(raw.csrfToken) ?? text(raw.csrf);
}

export function createSetupClient(defaults: { fetch?: FetchLike; timeoutMs?: number } = {}): SetupClient {
  let csrfToken: string | null = null;

  async function transport(path: string, init: RequestInit, timeoutMs: number): Promise<Transport> {
    const fetchImpl = defaults.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (typeof fetchImpl !== 'function') return { ok: false, reason: 'network' };
    const controller = new AbortController();
    let timedOut = false;
    let externallyAborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const forward = () => {
      externallyAborted = true;
      controller.abort();
    };
    const external = init.signal;
    if (external) {
      if (external.aborted) forward();
      else external.addEventListener('abort', forward, { once: true });
    }
    try {
      const response = await fetchImpl(SETUP_BASE + path, { ...init, signal: controller.signal });
      return { ok: true, response };
    } catch {
      return { ok: false, reason: timedOut ? 'timeout' : externallyAborted ? 'aborted' : 'network' };
    } finally {
      clearTimeout(timer);
      if (external) external.removeEventListener('abort', forward);
    }
  }

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    const base: Record<string, string> = { Accept: 'application/json', ...extra };
    if (csrfToken) base['X-CSRF-Token'] = csrfToken;
    return base;
  }

  async function getStatus(options: RequestOptions = {}): Promise<StatusResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS;
    const result = await transport('/status', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: headers(),
      signal: options.signal,
    }, timeoutMs);
    if (!result.ok) return { kind: 'unavailable', reason: result.reason, httpStatus: null };
    const response = result.response;
    // A stack without the setup service answers 404 from the edge fallback or
    // from the API itself: that installation already exists, it is not fresh.
    if (response.status === 404) return { kind: 'existing-instance', reason: 'absent', status: null };
    if (!response.ok) return { kind: 'unavailable', reason: 'server', httpStatus: response.status };
    const status = parseStatus(await readJson(response));
    if (!status) return { kind: 'unavailable', reason: 'invalid', httpStatus: response.status };
    if (!status.setup_enabled) return { kind: 'existing-instance', reason: 'disabled', status };
    if (status.state !== 'unclaimed' || !status.claim_available) {
      return { kind: 'existing-instance', reason: 'state', status };
    }
    return { kind: 'setup-available', status };
  }

  async function claim(credential: string, options: RequestOptions = {}): Promise<ClaimResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
    const result = await transport('/claim', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ credential }),
      signal: options.signal,
    }, timeoutMs);
    if (!result.ok) {
      const code = result.reason === 'network' ? 'network' : result.reason === 'aborted' ? 'network' : 'timeout';
      return { ok: false, code, attemptsRemaining: null, detail: null };
    }
    const response = result.response;
    const body = await readJson(response);
    if (response.ok) {
      const token = tokenOf(body);
      const state = text(object(body)?.state);
      // No token means the handshake did not happen: reporting success would
      // leave the wizard unable to perform a single authenticated call.
      if (!token) return { ok: false, code: 'invalid-response', attemptsRemaining: null, detail: detailOf(body) };
      csrfToken = token;
      return { ok: true, csrfToken: token, state };
    }
    const raw = object(body) ?? {};
    const attempts = integer(raw.attempts_remaining) ?? integer(raw.attemptsRemaining);
    const detail = detailOf(body);
    const status = response.status;
    if (status === 423 || status === 429) return { ok: false, code: 'locked', attemptsRemaining: attempts, detail };
    if (status === 400 || status === 401 || status === 403 || status === 409 || status === 422) {
      return { ok: false, code: 'invalid', attemptsRemaining: attempts, detail };
    }
    return { ok: false, code: 'unavailable', attemptsRemaining: attempts, detail };
  }

  async function getSession(options: RequestOptions = {}): Promise<SessionResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS;
    const result = await transport('/session', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: headers(),
      signal: options.signal,
    }, timeoutMs);
    if (!result.ok) return { ok: false, reason: result.reason === 'aborted' ? 'network' : result.reason };
    const response = result.response;
    // 404 keeps the reload path on the claim step instead of a dead end.
    if (response.status === 401 || response.status === 403 || response.status === 404) return { ok: false, reason: 'denied' };
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    const body = await readJson(response);
    const session = parseSession(body);
    if (!session) return { ok: false, reason: 'unavailable' };
    // A reloaded wizard has no claim response left. GET /session returns the
    // session's CSRF value, and adopting it here is what keeps the storage and
    // owner mutations working after a reload.
    const refreshed = tokenOf(body);
    if (refreshed) csrfToken = refreshed;
    return { ok: true, session };
  }

  // Storage writes mirror the AI rule: the URL is an argument of one call and
  // never a field of the client, so it cannot be replayed by a re-render.
  async function storageWrite(
    path: string,
    databaseUrl: string,
    timeoutMs: number,
    options: RequestOptions,
  ): Promise<{ ok: true; body: unknown } | { ok: false; code: StorageDiagnosticCode }> {
    const result = await transport(path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ database_url: databaseUrl }),
      signal: options.signal,
    }, timeoutMs);
    if (!result.ok) return { ok: false, code: result.reason === 'timeout' ? 'timeout' : 'network' };
    const response = result.response;
    const body = await readJson(response);
    if (!response.ok) return { ok: false, code: diagnosticOfStorage(body, response.status) };
    return { ok: true, body };
  }

  async function checkStorage(databaseUrl: string, options: RequestOptions = {}): Promise<StorageCheckResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_STORAGE_TIMEOUT_MS;
    const outcome = await storageWrite('/storage/check', databaseUrl, timeoutMs, options);
    if (!outcome.ok) return outcome;
    const probe = parseStorageProbe(outcome.body);
    if (!probe) return { ok: false, code: 'invalid-response' };
    return { ok: true, probe };
  }

  async function applyStorage(databaseUrl: string, options: RequestOptions = {}): Promise<StorageApplyResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_STORAGE_TIMEOUT_MS;
    const outcome = await storageWrite('/storage', databaseUrl, timeoutMs, options);
    if (!outcome.ok) return outcome;
    const raw = object(outcome.body);
    const state = text(raw?.state);
    const storage = parseStorageSummary(raw?.storage);
    if (!state || !storage) return { ok: false, code: 'invalid-response' };
    return { ok: true, state, storage };
  }

  async function createOwner(input: OwnerInput, options: RequestOptions = {}): Promise<OwnerResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_STORAGE_TIMEOUT_MS;
    const payload: Record<string, string> = {
      username: input.username.trim(),
      display_name: input.displayName.trim(),
      password: input.password,
    };
    const email = input.email?.trim();
    if (email) payload.email = email;
    const result = await transport('/owner', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: options.signal,
    }, timeoutMs);
    if (!result.ok) return { ok: false, code: result.reason === 'timeout' ? 'timeout' : 'network' };
    const response = result.response;
    const body = await readJson(response);
    if (!response.ok) return { ok: false, code: diagnosticOfOwner(body, response.status) };
    const parsed = parseOwnerResult(body);
    const state = text(object(body)?.state);
    if (!parsed || !state) return { ok: false, code: 'invalid-response' };
    return { ok: true, state, owner: parsed.owner, ai: parsed.ai };
  }

  // Session writes for the AI step. The provider key is a parameter of this
  // call and never a field of the client: it cannot be read back, replayed by
  // a later request, or picked up by a component re-render.
  async function aiWrite(path: string, payload: unknown, timeoutMs: number, options: RequestOptions): Promise<AiResult> {
    const hasBody = payload !== undefined;
    const result = await transport(path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: headers(hasBody ? { 'Content-Type': 'application/json' } : {}),
      body: hasBody ? JSON.stringify(payload) : undefined,
      signal: options.signal,
    }, timeoutMs);
    if (!result.ok) return { ok: false, code: result.reason === 'timeout' ? 'timeout' : 'network' };
    const response = result.response;
    const body = await readJson(response);
    if (!response.ok) return { ok: false, code: diagnosticOf(body, response.status) };
    const parsed = parseAiResult(body);
    if (!parsed) return { ok: false, code: 'invalid-response' };
    return parsed;
  }

  async function configureAi(input: AiProviderInput, options: RequestOptions = {}): Promise<AiResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
    return aiWrite('/ai', {
      base_url: input.baseUrl.trim(),
      model: input.model.trim(),
      api_key: input.apiKey,
    }, timeoutMs, options);
  }

  async function deferAi(options: RequestOptions = {}): Promise<AiResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
    return aiWrite('/ai/defer', undefined, timeoutMs, options);
  }

  async function askAssistant(question: string, options: RequestOptions = {}): Promise<AssistantResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
    const result = await transport('/assistant/ask', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ question }),
      signal: options.signal,
    }, timeoutMs);
    if (!result.ok) return { ok: false, code: result.reason === 'timeout' ? 'timeout' : 'network' };
    const response = result.response;
    const body = await readJson(response);
    if (!response.ok) return { ok: false, code: diagnosticOf(body, response.status) };
    const answer = parseAnswer(body);
    if (!answer) return { ok: false, code: 'invalid-response' };
    return answer;
  }

  async function logout(options: RequestOptions = {}): Promise<LogoutResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
    const result = await transport('/session/logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: headers(),
      signal: options.signal,
    }, timeoutMs);
    if (!result.ok) return { ok: false, code: result.reason === 'timeout' ? 'timeout' : 'network' };
    const response = result.response;
    if (!response.ok) return { ok: false, code: diagnosticOf(await readJson(response), response.status) };
    csrfToken = null;
    return { ok: true };
  }

  return {
    getStatus,
    claim,
    getSession,
    checkStorage,
    applyStorage,
    createOwner,
    configureAi,
    deferAi,
    askAssistant,
    logout,
    csrfToken: () => csrfToken,
  };
}

export const setupClient = createSetupClient();
