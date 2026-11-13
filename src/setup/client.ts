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

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SetupClient {
  getStatus(options?: RequestOptions): Promise<StatusResult>;
  claim(credential: string, options?: RequestOptions): Promise<ClaimResult>;
  getSession(options?: RequestOptions): Promise<SessionResult>;
  /** In memory only: the setup session token never reaches any storage. */
  csrfToken(): string | null;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

type Transport =
  | { ok: true; response: Response }
  | { ok: false; reason: 'network' | 'timeout' | 'aborted' };

const DEFAULT_STATUS_TIMEOUT_MS = 1500;
const DEFAULT_WRITE_TIMEOUT_MS = 20000;

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
    const session = parseSession(await readJson(response));
    if (!session) return { ok: false, reason: 'unavailable' };
    return { ok: true, session };
  }

  return { getStatus, claim, getSession, csrfToken: () => csrfToken };
}

export const setupClient = createSetupClient();
