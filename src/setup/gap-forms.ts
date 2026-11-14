// Rules for the three forms the wizard gained last: the production backup
// declaration, the origin/session settings and the installation organization
// name.
//
// The service stays authoritative; these only stop the page from offering a
// value the service has already said it refuses, and flatten an apply receipt
// into rows a person can read. Nothing here writes.

import type { EffectiveSetting, OperationalState, SectionInput, SectionPreview } from './client';

/** The closed location kinds the declaration accepts. */
export const BACKUP_LOCATION_KINDS = [
  'local',
  'remote',
  'object_storage',
  'managed_service',
  'other',
] as const;

export type BackupLocationKind = typeof BACKUP_LOCATION_KINDS[number];

export interface BackupDeclarationState {
  target: string;
  locationKind: BackupLocationKind | '';
  schedule: string;
  retention: string;
  responsible: string;
}

export type BackupField = 'target' | 'location_kind' | 'schedule' | 'retention' | 'responsible';

export const BACKUP_ITEM = 'backup_policy_declared';

export function emptyBackupDeclaration(): BackupDeclarationState {
  return { target: '', locationKind: '', schedule: '', retention: '', responsible: '' };
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function bounded(value: string, limit: number): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= limit && !CONTROL.test(trimmed);
}

/**
 * The first field the service would refuse, in the order the form shows them:
 * every field non-empty and trimmed, target at most 200 characters and the
 * rest at most 120, no control characters, and a retention that names a number
 * (``forever`` and ``unlimited`` are not a retention).
 */
export function validateBackupDeclaration(state: BackupDeclarationState): BackupField | null {
  if (!bounded(state.target, 200)) return 'target';
  if (!BACKUP_LOCATION_KINDS.includes(state.locationKind as BackupLocationKind)) return 'location_kind';
  if (!bounded(state.schedule, 120)) return 'schedule';
  if (!bounded(state.retention, 120) || !/[0-9]/.test(state.retention)) return 'retention';
  if (!bounded(state.responsible, 120)) return 'responsible';
  return null;
}

/** The ``values`` a declaration sends; ``item`` is what makes it one. */
export function backupDeclarationValues(state: BackupDeclarationState): SectionInput {
  return {
    item: BACKUP_ITEM,
    target: state.target.trim(),
    location_kind: state.locationKind,
    schedule: state.schedule.trim(),
    retention: state.retention.trim(),
    responsible: state.responsible.trim(),
  };
}

/**
 * The policy fields the service's declaration preview answers with
 * (itsm/setup/backup_policy.py:31 ``FIELDS`` and :94-102 ``normalize``): the
 * preview body is the normalized policy and carries no ``item``, so the page
 * tells the two operational previews apart by the keys they name, never by the
 * request it sent (itsm/setup/configuration.py:1045-1053).
 */
export const BACKUP_POLICY_FIELDS = ['target', 'location_kind', 'schedule', 'retention', 'responsible'] as const;

/** The settings keys an origin/session preview answers with (configuration.py:1068-1078). */
export const ORIGIN_SETTING_KEYS = [
  'auth_origin',
  'auth_cookie_secure',
  'auth_cookie_name',
  'auth_session_minutes_default',
] as const;

function proposedKeys(preview: Pick<SectionPreview, 'proposed'> | null): string[] {
  return preview?.proposed ? Object.keys(preview.proposed) : [];
}

/** True only when every proposed key is a policy field and there is one. */
export function isBackupDeclarationPreview(preview: Pick<SectionPreview, 'proposed'> | null): boolean {
  const keys = proposedKeys(preview);
  return keys.length > 0 && keys.every((key) => (BACKUP_POLICY_FIELDS as readonly string[]).includes(key));
}

/** True only when the proposed keys include an origin/session setting. */
export function isOriginSettingsPreview(preview: Pick<SectionPreview, 'proposed'> | null): boolean {
  return proposedKeys(preview).some((key) => (ORIGIN_SETTING_KEYS as readonly string[]).includes(key));
}

export interface OriginSettingsState {
  origin: string;
  cookieSecure: string;
  cookieName: string;
  sessionMinutes: string;
}

export type OriginField = 'auth_origin' | 'auth_cookie_name' | 'auth_session_minutes_default';

export function emptyOriginSettings(): OriginSettingsState {
  return { origin: '', cookieSecure: 'true', cookieName: '', sessionMinutes: '' };
}

/** A bare http(s) origin: scheme, host[:port], nothing after it. */
const ORIGIN = /^https?:\/\/[^\s/?#]+$/;
const COOKIE_NAME = /^[A-Za-z0-9_-]+$/;

/** Every field is optional: an empty one is simply not part of the change. */
export function validateOriginSettings(state: OriginSettingsState): OriginField | null {
  const origin = state.origin.trim();
  if (origin && !ORIGIN.test(origin)) return 'auth_origin';
  const cookieName = state.cookieName.trim();
  if (cookieName && !COOKIE_NAME.test(cookieName)) return 'auth_cookie_name';
  const minutes = state.sessionMinutes.trim();
  if (minutes) {
    const value = Number(minutes);
    if (!Number.isInteger(value) || value < 1 || value > 100000) return 'auth_session_minutes_default';
  }
  return null;
}

/** The ``values`` an origin/session apply sends: only what was typed. */
export function originSettingsValues(state: OriginSettingsState): SectionInput {
  const values: SectionInput = { auth_cookie_secure: state.cookieSecure !== 'false' };
  const origin = state.origin.trim();
  if (origin) values.auth_origin = origin;
  const cookieName = state.cookieName.trim();
  if (cookieName) values.auth_cookie_name = cookieName;
  const minutes = Number(state.sessionMinutes.trim());
  if (state.sessionMinutes.trim() && Number.isInteger(minutes)) values.auth_session_minutes_default = minutes;
  return values;
}

/** Letters and digits plus the punctuation the service keeps, nothing else. */
const ORGANIZATION = /^[\p{L}\p{N} &.,'"()+\-_/:@#%]*$/u;

export type OrganizationNameProblem = 'control' | 'too_long' | 'charset';

/** Optional: an empty value means "leave the stored name alone". */
export function organizationNameError(value: string): OrganizationNameProblem | null {
  if (CONTROL.test(value)) return 'control';
  if (value.trim().length > 120) return 'too_long';
  if (!ORGANIZATION.test(value.trim())) return 'charset';
  return null;
}

/** What the service will store: trimmed, inner runs of whitespace collapsed. */
export function normalizeOrganizationName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** The receipt provenance as rows, in the order the service listed them. */
export function effectiveRows(state: OperationalState | null): Array<EffectiveSetting & { value: string }> {
  if (!state) return [];
  return state.effective.map((setting) => ({ ...setting, value: setting.value ?? '' }));
}

/** What a restart would pick up. A required restart always names both units. */
export function restartScopeKeys(
  state: Pick<OperationalState, 'restartRequired' | 'restartScope'> | null,
): string[] {
  if (!state?.restartRequired) return [];
  return state.restartScope.length > 0 ? state.restartScope : ['backend', 'worker'];
}
