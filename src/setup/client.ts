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

/** The five configuration sections the wizard can show. */
export type SectionId = 'agent' | 'appearance' | 'notifications' | 'monitoring' | 'operational';

export const SECTION_IDS: readonly SectionId[] = [
  'agent',
  'appearance',
  'notifications',
  'monitoring',
  'operational',
];

/**
 * A stored section decision. The service's green word is ``passed``: it is the
 * only status that counts as a pass, and a postponement or an accepted risk is
 * never painted as one.
 */
export type SectionStatus = 'pending' | 'passed' | 'postponed' | 'risk';

/** What the service is willing to record for a section. */
export type SectionAction = 'apply' | 'postpone';

/** Values are data: one scalar per field, or a closed list of ids. */
export type SectionData = Record<string, string | number | boolean | null | string[]>;

/** What a section proposal sends as ``values``. */
export type SectionInput = Record<string, string | number | boolean | null>;

/** A section as ``GET /configuration`` lists it. */
export interface SectionSummary {
  section: SectionId;
  required: boolean;
  postponable: boolean;
  status: SectionStatus;
  actions: SectionAction[];
}

/** A section read on its own: its decision plus, when readable, its live value. */
export interface SectionDetail extends SectionSummary {
  /** The effective value the owning service answered, as data. */
  current: SectionData | null;
  proposed: SectionData | null;
  /** The sanitized read-back recorded when the section was decided. */
  receipt: SectionData | null;
  /** The live value could not be read; the stored decision still stands. */
  currentUnavailable: boolean;
}

export interface SectionField {
  field: string;
  value: string;
}

export interface SectionChange {
  field: string;
  from: string | null;
  to: string | null;
}

/** ``POST /configuration/{section}``: a diff only, never a write. */
export interface SectionPreview {
  section: SectionId;
  status: 'preview';
  required: boolean;
  postponable: boolean;
  current: SectionData | null;
  proposed: SectionData | null;
  changes: SectionChange[];
  previewOnly: boolean;
}

/** ``POST /configuration/{section}/apply``: the decision the service recorded. */
export interface SectionDecision {
  section: SectionId;
  required: boolean;
  postponable: boolean;
  status: SectionStatus;
  receipt: SectionData | null;
}

/** ``GET /configuration``: every section plus the checklist built from receipts. */
export interface ConfigurationOverview {
  state: string;
  mode: string;
  sections: SectionSummary[];
  checklist: Checklist;
  blocking: string[];
  acceptedRisk: string[];
}

export type ConfigurationDiagnosticCode =
  | 'confirm_required'
  | 'state_refused'
  | 'invalid_request'
  | 'permission_denied'
  | 'verification_blocked'
  | 'session_expired'
  | 'unavailable'
  | 'network'
  | 'timeout'
  | 'invalid-response';

export type ConfigurationResult =
  | { ok: true; state: string; mode: string }
  | { ok: false; code: ConfigurationDiagnosticCode };

export type OverviewResult =
  | { ok: true; overview: ConfigurationOverview }
  | { ok: false; code: ConfigurationDiagnosticCode };

export type SectionResult =
  | { ok: true; section: SectionDetail }
  | { ok: false; code: ConfigurationDiagnosticCode };

export type PreviewResult =
  | { ok: true; preview: SectionPreview }
  | { ok: false; code: ConfigurationDiagnosticCode };

export type ApplyResult =
  | { ok: true; receipt: SectionDecision }
  | { ok: false; code: ConfigurationDiagnosticCode };

export type PostponeResult =
  | { ok: true; receipt: SectionDecision }
  | { ok: false; code: ConfigurationDiagnosticCode };

export type RiskResult =
  | { ok: true; receipt: SectionDecision }
  | { ok: false; code: ConfigurationDiagnosticCode };

/** Closed checklist states; ``risk`` and ``unavailable`` are never a pass. */
export type ChecklistStatus =
  | 'passed'
  | 'failed'
  | 'pending'
  | 'postponed'
  | 'risk'
  | 'unavailable'
  | 'not_required';

export interface ChecklistItem {
  id: string;
  /** The section that decides this item; empty for contract-wide items. */
  section: SectionId | null;
  status: ChecklistStatus;
  required: boolean;
  postponable: boolean;
  /** The observation that decided the status, in one operator line. */
  evidence: string;
  /** The service's own verdict: a required item that is not satisfied yet. */
  blocking: boolean;
  acceptedRisk: boolean;
}

export interface Checklist {
  mode: string | null;
  items: ChecklistItem[];
  blocking: string[];
  acceptedRisk: string[];
}

export type VerifyResult =
  | { ok: true; state: string; checklist: Checklist }
  | { ok: false; code: ConfigurationDiagnosticCode; checklist?: Checklist };

/**
 * The finish step's sanitized preview. Every field is allowlisted here and
 * parsed one by one: a service that echoes a credential or a connection string
 * adds nothing to this object, and the page can only render what it carries.
 */
export interface SetupReport {
  contract: string | null;
  setupContractVersion: string | null;
  mode: string | null;
  releaseMode: string | null;
  state: string | null;
  instanceId: string | null;
  owner: { username: string | null };
  ai: { status: string | null; provider: string | null; model: string | null; pending: boolean | null };
  storage: Record<string, string | boolean | null>;
  checklist: ChecklistItem[];
  blocking: string[];
  acceptedRisk: string[];
  verifiedAt: string | null;
  completedAt: string | null;
  completedBy: string | null;
  reportDigest: string | null;
}

/** Completion knows the setup refusals plus the two the finish step adds. */
export type CompletionCode = ConfigurationDiagnosticCode | 'setup_complete' | 'completion_blocked';

export type ReportResult =
  | { ok: true; report: SetupReport }
  | { ok: false; code: CompletionCode };

export type CompleteResult =
  | {
    ok: true;
    state: 'complete';
    completedAt: string | null;
    instanceId: string | null;
    reportDigest: string | null;
  }
  | { ok: false; code: CompletionCode };

/** The normal API's authoritative installation marker, as a closed answer. */
export type InstallationProbe = 'complete' | 'incomplete' | 'unknown';


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
  /** owner_ready -> configuring. Idempotent; the answer names the state and mode. */
  startConfiguration(options?: RequestOptions): Promise<ConfigurationResult>;
  /** Every section plus the checklist built from stored receipts. */
  getOverview(options?: RequestOptions): Promise<OverviewResult>;
  /** One section: its decision and, when readable, the live value it holds. */
  getSection(section: SectionId, options?: RequestOptions): Promise<SectionResult>;
  /** Writes nothing: the service answers the diff the operator would apply. */
  previewSection(section: SectionId, values: SectionInput, options?: RequestOptions): Promise<PreviewResult>;
  /** Refused before any request unless ``confirm`` is exactly true. */
  applySection(
    section: SectionId,
    values: SectionInput,
    confirm: boolean,
    options?: RequestOptions,
  ): Promise<ApplyResult>;
  /** Only for a section the service marked postponable. */
  postponeSection(section: SectionId, confirm: boolean, options?: RequestOptions): Promise<PostponeResult>;
  /** The production backup only: an explicit, recorded risk acceptance. */
  acceptRisk(
    section: SectionId,
    item: string,
    reason: string,
    confirm: boolean,
    options?: RequestOptions,
  ): Promise<RiskResult>;
  /** Runs the checklist; a refusal carries the observed blocking items. */
  verify(options?: RequestOptions): Promise<VerifyResult>;
  /** The sanitized report preview; GET only, and never after completion. */
  getReport(options?: RequestOptions): Promise<ReportResult>;
  /** The explicit last step; the service re-verifies and closes the surface. */
  complete(options?: RequestOptions): Promise<CompleteResult>;
  /** Asks the normal API whether this installation is already complete. */
  getInstallation(options?: RequestOptions): Promise<InstallationProbe>;
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
  if (status.kind === 'setup-available') {
    // Defensive: a gate that still says "claimable" while its own state is
    // complete must not reopen a wizard on a finished installation.
    if (status.status.state === 'complete') return { view: 'legacy', reason: 'installed' };
    return { view: 'wizard', status: status.status, session: null };
  }
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

// Boot decision with the app's own marker first. After completion the setup
// service may already refuse every call or be switched off entirely, so the
// normal API is asked before any setup probe: a completed installation always
// reaches the app login, never a claim form. An unreachable app status is not
// an answer, and the setup probe decides from there.
export async function resolveBoot(
  client: SetupClient,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<EntryDecision> {
  const installation = await client.getInstallation(options);
  if (installation === 'complete') return { view: 'legacy', reason: 'installed' };
  return resolveEntry(client, options);
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
// A section read or write is one settings row change; no external round trip.
const DEFAULT_CONFIGURATION_TIMEOUT_MS = 20000;
// Verify probes the queue, the database and a temp file, so it gets the
// storage budget rather than the short status one.
const DEFAULT_VERIFY_TIMEOUT_MS = 30000;
// The normal API's readiness payload carries the authoritative marker
// (itsm/main.py): a completed installation never offers setup again, even if
// the setup service is unreachable or still answers from a stale gate.
const APP_STATUS_PATH = '/api/v1/health/ready';
// Completion re-verifies the whole checklist server-side before writing.
const DEFAULT_COMPLETION_TIMEOUT_MS = 30000;
// One assistant answer can wait on a provider round trip.
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

function sectionIdOf(value: unknown): SectionId | null {
  return typeof value === 'string' && (SECTION_IDS as readonly string[]).includes(value)
    ? value as SectionId
    : null;
}

const SECTION_STATUSES: readonly SectionStatus[] = ['pending', 'passed', 'postponed', 'risk'];

function sectionStatusOf(value: unknown): SectionStatus | null {
  return typeof value === 'string' && (SECTION_STATUSES as readonly string[]).includes(value)
    ? value as SectionStatus
    : null;
}

const SECTION_ACTIONS: readonly SectionAction[] = ['apply', 'postpone'];

function sectionActionOf(value: unknown): SectionAction | null {
  return typeof value === 'string' && (SECTION_ACTIONS as readonly string[]).includes(value)
    ? value as SectionAction
    : null;
}

function parseActions(value: unknown): SectionAction[] | null {
  if (!Array.isArray(value)) return null;
  const actions = value.map(sectionActionOf);
  return actions.every((entry): entry is SectionAction => entry !== null) ? actions : null;
}

// Section values arrive as data. A scalar or a list of ids is kept; a nested
// object is dropped rather than rendered, because the wizard has no field for
// it and the service's own keys are not prose it may print.
function parseData(value: unknown): SectionData | null {
  const raw = object(value);
  if (!raw) return null;
  const data: SectionData = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean' || entry === null) {
      data[key] = entry;
    } else if (Array.isArray(entry) && entry.every((item) => typeof item === 'string')) {
      data[key] = entry as string[];
    }
  }
  return data;
}

function dataText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.join(', ');
  return null;
}

function parseSectionSummary(value: unknown): SectionSummary | null {
  const raw = object(value);
  if (!raw) return null;
  const section = sectionIdOf(raw.section);
  const status = sectionStatusOf(raw.status);
  const actions = parseActions(raw.actions);
  if (!section || !status || actions === null) return null;
  return {
    section,
    required: raw.required === true,
    postponable: raw.postponable === true,
    status,
    actions,
  };
}

function parseSectionList(value: unknown): SectionSummary[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parseSectionSummary);
  return parsed.every((entry): entry is SectionSummary => entry !== null) ? parsed : null;
}

// ``GET /configuration/{section}`` answers with the section id as a string,
// its decision and, when the owning service could be read, its live value.
function parseSectionDetail(body: unknown): SectionDetail | null {
  const summary = parseSectionSummary(body);
  const raw = object(body);
  if (!summary || !raw) return null;
  return {
    ...summary,
    current: raw.current === null || raw.current === undefined ? null : parseData(raw.current),
    proposed: raw.proposed === null || raw.proposed === undefined ? null : parseData(raw.proposed),
    receipt: raw.receipt === null || raw.receipt === undefined ? null : parseData(raw.receipt),
    currentUnavailable: raw.currentUnavailable === true,
  };
}

function parsePreview(body: unknown): SectionPreview | null {
  const raw = object(body);
  if (!raw || raw.status !== 'preview' || raw.preview_only !== true) return null;
  const section = sectionIdOf(raw.section);
  if (!section || !Array.isArray(raw.changes)) return null;
  const proposed = parseData(raw.proposed);
  if (proposed === null) return null;
  const changes: SectionChange[] = [];
  for (const entry of raw.changes) {
    const change = object(entry);
    const field = text(change?.field);
    if (!field) return null;
    changes.push({ field, from: dataText(change?.from), to: dataText(change?.to) });
  }
  return {
    section,
    status: 'preview',
    required: raw.required === true,
    postponable: raw.postponable === true,
    current: raw.current === null || raw.current === undefined ? null : parseData(raw.current),
    proposed,
    changes,
    previewOnly: true,
  };
}

// Apply, postpone and accept_risk all answer with the same decision envelope:
// the section, its shape and the status the service actually recorded. The
// decision carries no ``actions`` list; only a read does.
function parseDecision(body: unknown): SectionDecision | null {
  const raw = object(body);
  if (!raw) return null;
  const section = sectionIdOf(raw.section);
  const status = sectionStatusOf(raw.status);
  if (!section || !status) return null;
  return {
    section,
    required: raw.required === true,
    postponable: raw.postponable === true,
    status,
    receipt: raw.receipt === null || raw.receipt === undefined ? null : parseData(raw.receipt),
  };
}

const CHECKLIST_STATUSES: readonly ChecklistStatus[] = [
  'passed',
  'failed',
  'pending',
  'postponed',
  'risk',
  'unavailable',
  'not_required',
];

function checklistStatusOf(value: unknown): ChecklistStatus | null {
  return typeof value === 'string' && (CHECKLIST_STATUSES as readonly string[]).includes(value)
    ? value as ChecklistStatus
    : null;
}

function parseChecklistItem(value: unknown): ChecklistItem | null {
  const raw = object(value);
  if (!raw) return null;
  const id = text(raw.id);
  const status = checklistStatusOf(raw.status);
  const evidence = typeof raw.evidence === 'string' ? raw.evidence : null;
  if (!id || !status || evidence === null) return null;
  return {
    id,
    section: sectionIdOf(raw.section),
    status,
    required: raw.required === true,
    postponable: raw.postponable === true,
    evidence,
    blocking: raw.blocking === true,
    acceptedRisk: raw.acceptedRisk === true,
  };
}

function parseIdList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

// The checklist is the service's own array of items (not an object holding an
// ``items`` key); ``mode``, ``blocking`` and ``acceptedRisk`` sit beside it.
function parseChecklist(body: unknown): Checklist | null {
  const raw = object(body);
  if (!raw || !Array.isArray(raw.checklist) || raw.checklist.length === 0) return null;
  const items = raw.checklist.map(parseChecklistItem);
  if (!items.every((entry): entry is ChecklistItem => entry !== null)) return null;
  return {
    mode: text(raw.mode),
    items,
    blocking: parseIdList(raw.blocking),
    acceptedRisk: parseIdList(raw.acceptedRisk),
  };
}

// The report is an allowlist, both in shape and in the storage row. A field
// the service invents is dropped here, not hidden later in the page.
const REPORT_STORAGE_FIELDS: readonly (readonly [string, string])[] = [
  ['version', 'version'],
  ['engine', 'engine'],
  ['status', 'status'],
  ['identity', 'identity'],
  ['config_source', 'configSource'],
  ['migrated', 'migrated'],
  ['identity_claimed', 'identityClaimed'],
];

function parseReport(value: unknown): SetupReport | null {
  const raw = object(value);
  if (!raw) return null;
  const state = text(raw.state);
  if (!state) return null;
  const owner = object(raw.owner);
  const ai = object(raw.ai);
  const storage = object(raw.storage);
  const fields: Record<string, string | boolean | null> = {};
  if (storage) {
    for (const [source, target] of REPORT_STORAGE_FIELDS) {
      const entry = storage[source];
      if (typeof entry === 'string' || typeof entry === 'boolean' || entry === null) fields[target] = entry;
    }
  }
  const checklist = Array.isArray(raw.checklist)
    ? raw.checklist.map(parseChecklistItem).filter((item): item is ChecklistItem => item !== null)
    : [];
  return {
    contract: text(raw.contract),
    setupContractVersion: text(raw.setup_contract_version),
    mode: text(raw.mode),
    releaseMode: text(raw.release_mode),
    state,
    instanceId: text(raw.instance_id),
    owner: { username: text(owner?.username) },
    ai: {
      status: text(ai?.status),
      provider: text(ai?.provider),
      model: text(ai?.model),
      pending: typeof ai?.pending === 'boolean' ? ai.pending : null,
    },
    storage: fields,
    checklist,
    blocking: parseIdList(raw.blocking),
    acceptedRisk: parseIdList(raw.acceptedRisk),
    verifiedAt: text(raw.verified_at),
    completedAt: text(raw.completed_at),
    completedBy: text(raw.completed_by),
    reportDigest: text(raw.report_digest),
  };
}

function isSetupComplete(body: unknown): boolean {
  return text(object(body)?.error) === 'setup_complete';
}

function parseOverview(body: unknown): ConfigurationOverview | null {
  const raw = object(body);
  if (!raw) return null;
  const state = text(raw.state);
  const mode = text(raw.mode);
  const sections = parseSectionList(raw.sections);
  const checklist = parseChecklist(raw);
  if (!state || !mode || sections === null || checklist === null) return null;
  return {
    state,
    mode,
    sections,
    checklist,
    blocking: parseIdList(raw.blocking),
    acceptedRisk: parseIdList(raw.acceptedRisk),
  };
}

// The service answers with one closed code in ``error`` and never echoes
// upstream prose. ``configuration_invalid`` is one refusal to the operator
// (the values were rejected); ``configuration_unavailable`` is availability.
const CONFIGURATION_DIAGNOSTICS: Record<string, ConfigurationDiagnosticCode> = {
  state_refused: 'state_refused',
  permission_denied: 'permission_denied',
  confirmation_required: 'confirm_required',
  configuration_invalid: 'invalid_request',
  configuration_unavailable: 'unavailable',
  verification_blocked: 'verification_blocked',
};

function diagnosticOfConfiguration(body: unknown, httpStatus: number): ConfigurationDiagnosticCode {
  const raw = object(body);
  const code = text(raw?.error) ?? text(raw?.detail);
  if (code && code in CONFIGURATION_DIAGNOSTICS) return CONFIGURATION_DIAGNOSTICS[code];
  if (code && SESSION_ERROR_CODES.has(code)) return 'session_expired';
  if (httpStatus === 401) return 'session_expired';
  return 'unavailable';
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

  async function transport(path: string, init: RequestInit, timeoutMs: number, absolute = false): Promise<Transport> {
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
      const response = await fetchImpl(absolute ? path : SETUP_BASE + path, { ...init, signal: controller.signal });
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

  // Configuration writes. The same closed-code rule as storage and AI: a
  // service answer outside the documented codes is availability, not prose the
  // wizard would print.
  async function configWrite(
    path: string,
    payload: unknown,
    timeoutMs: number,
    options: RequestOptions,
  ): Promise<{ ok: true; body: unknown } | { ok: false; code: ConfigurationDiagnosticCode; body: unknown }> {
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
    if (!result.ok) return { ok: false, code: result.reason === 'timeout' ? 'timeout' : 'network', body: null };
    const response = result.response;
    const body = await readJson(response);
    if (!response.ok) return { ok: false, code: diagnosticOfConfiguration(body, response.status), body };
    return { ok: true, body };
  }

  async function startConfiguration(options: RequestOptions = {}): Promise<ConfigurationResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_CONFIGURATION_TIMEOUT_MS;
    const outcome = await configWrite('/configuration', undefined, timeoutMs, options);
    if (!outcome.ok) return { ok: false, code: outcome.code };
    const raw = object(outcome.body);
    const state = text(raw?.state);
    const mode = text(raw?.mode);
    if (!state || !mode) return { ok: false, code: 'invalid-response' };
    return { ok: true, state, mode };
  }

  async function getOverview(options: RequestOptions = {}): Promise<OverviewResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_CONFIGURATION_TIMEOUT_MS;
    const result = await transport('/configuration', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: headers(),
      signal: options.signal,
    }, timeoutMs);
    if (!result.ok) return { ok: false, code: result.reason === 'timeout' ? 'timeout' : 'network' };
    const response = result.response;
    const body = await readJson(response);
    if (!response.ok) return { ok: false, code: diagnosticOfConfiguration(body, response.status) };
    const overview = parseOverview(body);
    if (!overview) return { ok: false, code: 'invalid-response' };
    return { ok: true, overview };
  }

  async function getSection(section: SectionId, options: RequestOptions = {}): Promise<SectionResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_CONFIGURATION_TIMEOUT_MS;
    const result = await transport(`/configuration/${section}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: headers(),
      signal: options.signal,
    }, timeoutMs);
    if (!result.ok) return { ok: false, code: result.reason === 'timeout' ? 'timeout' : 'network' };
    const response = result.response;
    const body = await readJson(response);
    if (!response.ok) return { ok: false, code: diagnosticOfConfiguration(body, response.status) };
    const parsed = parseSectionDetail(body);
    if (!parsed || parsed.section !== section) return { ok: false, code: 'invalid-response' };
    return { ok: true, section: parsed };
  }

  async function previewSection(
    section: SectionId,
    values: SectionInput,
    options: RequestOptions = {},
  ): Promise<PreviewResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_CONFIGURATION_TIMEOUT_MS;
    const outcome = await configWrite(`/configuration/${section}`, { values }, timeoutMs, options);
    if (!outcome.ok) return { ok: false, code: outcome.code };
    const preview = parsePreview(outcome.body);
    if (!preview || preview.section !== section) return { ok: false, code: 'invalid-response' };
    return { ok: true, preview };
  }

  async function applySection(
    section: SectionId,
    values: SectionInput,
    confirm: boolean,
    options: RequestOptions = {},
  ): Promise<ApplyResult> {
    // The confirm gate is client-side on purpose: a bare click on the section
    // control cannot become a write, and a retried render cannot replay one.
    if (confirm !== true) return { ok: false, code: 'confirm_required' };
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_CONFIGURATION_TIMEOUT_MS;
    const outcome = await configWrite(
      `/configuration/${section}/apply`,
      { values, action: 'apply', confirm: true },
      timeoutMs,
      options,
    );
    if (!outcome.ok) return { ok: false, code: outcome.code };
    const receipt = parseDecision(outcome.body);
    if (!receipt || receipt.section !== section) return { ok: false, code: 'invalid-response' };
    return { ok: true, receipt };
  }

  async function postponeSection(
    section: SectionId,
    confirm: boolean,
    options: RequestOptions = {},
  ): Promise<PostponeResult> {
    if (confirm !== true) return { ok: false, code: 'confirm_required' };
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_CONFIGURATION_TIMEOUT_MS;
    const outcome = await configWrite(
      `/configuration/${section}/apply`,
      { values: {}, action: 'postpone', confirm: true },
      timeoutMs,
      options,
    );
    if (!outcome.ok) return { ok: false, code: outcome.code };
    const receipt = parseDecision(outcome.body);
    // Anything other than an explicit postponement is not one: a service
    // answer that says ``passed`` did not postpone and the UI must not paint
    // it so.
    if (!receipt || receipt.section !== section || receipt.status !== 'postponed') {
      return { ok: false, code: 'invalid-response' };
    }
    return { ok: true, receipt };
  }

  // The production backup is the one requirement a person may accept as a
  // risk. It is still an explicit decision: the caller passes confirm true only
  // after the operator checked it, and the recorded status is ``risk``.
  async function acceptRisk(
    section: SectionId,
    item: string,
    reason: string,
    confirm: boolean,
    options: RequestOptions = {},
  ): Promise<RiskResult> {
    if (confirm !== true) return { ok: false, code: 'confirm_required' };
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_CONFIGURATION_TIMEOUT_MS;
    const values: SectionInput = { item };
    const cleaned = reason.trim();
    if (cleaned) values.reason = cleaned;
    const outcome = await configWrite(
      `/configuration/${section}/apply`,
      { values, action: 'accept_risk', confirm: true },
      timeoutMs,
      options,
    );
    if (!outcome.ok) return { ok: false, code: outcome.code };
    const receipt = parseDecision(outcome.body);
    if (!receipt || receipt.section !== section || receipt.status !== 'risk') {
      return { ok: false, code: 'invalid-response' };
    }
    return { ok: true, receipt };
  }

  async function verify(options: RequestOptions = {}): Promise<VerifyResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
    const outcome = await configWrite('/verify', undefined, timeoutMs, options);
    if (!outcome.ok) {
      // A refused verification answers 409 with the observed checklist: the
      // operator stays in configuration and can see which requirements block.
      if (outcome.code === 'verification_blocked') {
        const checklist = parseChecklist(outcome.body);
        if (checklist) return { ok: false, code: outcome.code, checklist };
      }
      return { ok: false, code: outcome.code };
    }
    const raw = object(outcome.body);
    const state = text(raw?.state);
    const checklist = parseChecklist(outcome.body);
    if (!state || !checklist) return { ok: false, code: 'invalid-response' };
    return { ok: true, state, checklist };
  }

  // The preview is a GET: it reads the same report the operator will export and
  // changes nothing. After completion the service refuses it with 409, which is
  // the finished installation rather than an error to retry.
  async function getReport(options: RequestOptions = {}): Promise<ReportResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_CONFIGURATION_TIMEOUT_MS;
    const result = await transport('/report', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: headers(),
      signal: options.signal,
    }, timeoutMs);
    if (!result.ok) return { ok: false, code: result.reason === 'timeout' ? 'timeout' : 'network' };
    const response = result.response;
    const body = await readJson(response);
    if (!response.ok) {
      if (isSetupComplete(body)) return { ok: false, code: 'setup_complete' };
      return { ok: false, code: diagnosticOfConfiguration(body, response.status) };
    }
    const report = parseReport(body);
    if (!report) return { ok: false, code: 'invalid-response' };
    return { ok: true, report };
  }

  // The one explicit confirmation. The server re-runs the checklist; a refusal
  // keeps its own code so the page can send the operator back to verification
  // instead of claiming a completion it never observed.
  async function complete(options: RequestOptions = {}): Promise<CompleteResult> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS;
    const outcome = await configWrite('/complete', undefined, timeoutMs, options);
    if (!outcome.ok) {
      if (isSetupComplete(outcome.body)) return { ok: false, code: 'setup_complete' };
      if (text(object(outcome.body)?.error) === 'completion_blocked') {
        return { ok: false, code: 'completion_blocked' };
      }
      return { ok: false, code: outcome.code };
    }
    const raw = object(outcome.body);
    const state = text(raw?.state);
    if (state !== 'complete') return { ok: false, code: 'invalid-response' };
    // The service invalidates the setup session with this answer; holding the
    // token would offer a mutation the server is guaranteed to refuse.
    csrfToken = null;
    return {
      ok: true,
      state: 'complete',
      completedAt: text(raw?.completed_at),
      instanceId: text(raw?.instance_id),
      reportDigest: text(raw?.report_digest),
    };
  }

  // Boot only: a boolean marker, never a payload the page would render. A
  // 404, an HTML fallback or a timeout is ``unknown`` so the setup probe still
  // decides; ``complete`` is final.
  async function getInstallation(options: RequestOptions = {}): Promise<InstallationProbe> {
    const timeoutMs = options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS;
    const result = await transport(APP_STATUS_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    }, timeoutMs, true);
    if (!result.ok) return 'unknown';
    const response = result.response;
    const raw = object(await readJson(response));
    const flag = raw?.installation_complete;
    if (typeof flag === 'boolean') return flag ? 'complete' : 'incomplete';
    return 'unknown';
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
    startConfiguration,
    getOverview,
    getSection,
    previewSection,
    applySection,
    postponeSection,
    acceptRisk,
    verify,
    getReport,
    complete,
    getInstallation,
    configureAi,
    deferAi,
    askAssistant,
    logout,
    csrfToken: () => csrfToken,
  };
}

export const setupClient = createSetupClient();
