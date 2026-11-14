'use strict';
// What the declaration and origin/session forms refuse before they offer a
// preview, and how a receipt's provenance is turned into rows. Pure rules, so
// the wizard's honesty is testable without a DOM: ``declared`` is counted
// apart from a pass, the environment wins and is named, and a value that would
// be refused by the service never reaches it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FORMS = require.resolve(path.join(__dirname, '..', 'src', 'setup', 'gap-forms.ts'));
const STATUS = require.resolve(path.join(__dirname, '..', 'src', 'setup', 'section-status.ts'));

function load(file) {
  delete require.cache[file];
  return require(file);
}

const DECLARATION = {
  target: 's3://hadar-backups/prod',
  locationKind: 'object_storage',
  schedule: 'daily 02:00 UTC',
  retention: '30 days',
  responsible: 'platform team',
};

test('a declaration needs every field, a bounded target and a numeric retention', () => {
  const { validateBackupDeclaration, emptyBackupDeclaration } = load(FORMS);

  assert.equal(validateBackupDeclaration(emptyBackupDeclaration()), 'target');
  assert.equal(validateBackupDeclaration({ ...DECLARATION, target: '   ' }), 'target');
  assert.equal(validateBackupDeclaration({ ...DECLARATION, target: 's3://' + 'a'.repeat(200) }), 'target');
  assert.equal(validateBackupDeclaration({ ...DECLARATION, locationKind: '' }), 'location_kind');
  assert.equal(validateBackupDeclaration({ ...DECLARATION, schedule: '' }), 'schedule');
  assert.equal(validateBackupDeclaration({ ...DECLARATION, retention: 'forever' }), 'retention');
  assert.equal(validateBackupDeclaration({ ...DECLARATION, retention: '30 days' }), null);
  assert.equal(validateBackupDeclaration({ ...DECLARATION, responsible: 'platform\u0000team' }), 'responsible');
  assert.equal(validateBackupDeclaration({ ...DECLARATION, schedule: 'x'.repeat(121) }), 'schedule');
});

test('a declaration sends the item, the closed location and the trimmed values', () => {
  const { backupDeclarationValues, emptyBackupDeclaration } = load(FORMS);
  assert.deepEqual(backupDeclarationValues(DECLARATION), {
    item: 'backup_policy_declared',
    target: 's3://hadar-backups/prod',
    location_kind: 'object_storage',
    schedule: 'daily 02:00 UTC',
    retention: '30 days',
    responsible: 'platform team',
  });
  assert.deepEqual(backupDeclarationValues({ ...emptyBackupDeclaration(), target: '  nfs:/backups  ', locationKind: 'local', schedule: 'nightly', retention: '7 days', responsible: 'ops' }), {
    item: 'backup_policy_declared',
    target: 'nfs:/backups',
    location_kind: 'local',
    schedule: 'nightly',
    retention: '7 days',
    responsible: 'ops',
  });
});

test('origin settings accept a bare http(s) origin and a sane session length', () => {
  const { validateOriginSettings, emptyOriginSettings } = load(FORMS);

  assert.equal(validateOriginSettings(emptyOriginSettings()), null);
  assert.equal(validateOriginSettings({ origin: 'https://assets.example.com', cookieSecure: 'true', cookieName: 'itsm_session', sessionMinutes: '60' }), null);
  assert.equal(validateOriginSettings({ origin: 'https://assets.example.com/app', cookieSecure: 'true', cookieName: '', sessionMinutes: '' }), 'auth_origin');
  assert.equal(validateOriginSettings({ origin: 'assets.example.com', cookieSecure: 'true', cookieName: '', sessionMinutes: '' }), 'auth_origin');
  assert.equal(validateOriginSettings({ origin: 'ftp://assets.example.com', cookieSecure: 'true', cookieName: '', sessionMinutes: '' }), 'auth_origin');
  assert.equal(validateOriginSettings({ origin: 'https://a.example.com?x=1', cookieSecure: 'true', cookieName: '', sessionMinutes: '' }), 'auth_origin');
  assert.equal(validateOriginSettings({ origin: '', cookieSecure: 'true', cookieName: 'bad name', sessionMinutes: '' }), 'auth_cookie_name');
  assert.equal(validateOriginSettings({ origin: '', cookieSecure: 'true', cookieName: '', sessionMinutes: '0' }), 'auth_session_minutes_default');
  assert.equal(validateOriginSettings({ origin: '', cookieSecure: 'true', cookieName: '', sessionMinutes: 'soon' }), 'auth_session_minutes_default');
});

test('origin settings send only what was typed and always carry the secure flag', () => {
  const { originSettingsValues } = load(FORMS);
  assert.deepEqual(originSettingsValues({ origin: ' https://assets.example.com ', cookieSecure: 'false', cookieName: '', sessionMinutes: '' }), {
    auth_origin: 'https://assets.example.com',
    auth_cookie_secure: false,
  });
  assert.deepEqual(originSettingsValues({ origin: '', cookieSecure: 'true', cookieName: 'itsm_session', sessionMinutes: '30' }), {
    auth_cookie_secure: true,
    auth_cookie_name: 'itsm_session',
    auth_session_minutes_default: 30,
  });
});

test('the organization name is bounded and keeps only the allowed characters', () => {
  const { organizationNameError, normalizeOrganizationName } = load(FORMS);

  assert.equal(organizationNameError(''), null);
  assert.equal(organizationNameError('Hadar IT'), null);
  assert.equal(organizationNameError("O'Neil & Co., S.A. (IT)"), null);
  assert.equal(organizationNameError('x'.repeat(121)), 'too_long');
  assert.equal(organizationNameError('Hadar\u0000IT'), 'control');
  assert.equal(organizationNameError('Hadar <IT>'), 'charset');
  assert.equal(normalizeOrganizationName('  Hadar   IT '), 'Hadar IT');
});

test('the receipt provenance becomes rows, env first and named', () => {
  const { effectiveRows } = load(FORMS);
  const rows = effectiveRows({
    effective: [
      { key: 'auth_origin', value: 'https://env.example.com', source: 'env', overriddenBy: 'ITSM_AUTH_ORIGIN' },
      { key: 'auth_cookie_secure', value: 'true', source: 'installation', overriddenBy: null },
    ],
    overriddenBy: ['ITSM_AUTH_ORIGIN'],
    restartRequired: true,
    restartScope: ['backend', 'worker'],
    note: null,
    backupPolicy: null,
  });
  assert.deepEqual(rows, [
    { key: 'auth_origin', value: 'https://env.example.com', source: 'env', overriddenBy: 'ITSM_AUTH_ORIGIN' },
    { key: 'auth_cookie_secure', value: 'true', source: 'installation', overriddenBy: null },
  ]);
  assert.deepEqual(effectiveRows(null), []);
});

test('a required restart names the backend and the worker even when the scope is unset', () => {
  const { restartScopeKeys } = load(FORMS);
  assert.deepEqual(restartScopeKeys({ restartRequired: true, restartScope: ['backend', 'worker'] }), ['backend', 'worker']);
  assert.deepEqual(restartScopeKeys({ restartRequired: true, restartScope: [] }), ['backend', 'worker']);
  assert.deepEqual(restartScopeKeys({ restartRequired: false, restartScope: ['backend'] }), []);
  assert.deepEqual(restartScopeKeys(null), []);
});

test('a declared section is its own chip, never a pass', () => {
  const { chipFor, verifyOutcome } = load(STATUS);
  const card = { section: 'operational', status: 'declared', required: true, postponable: false, actions: ['apply'], current: null };
  assert.equal(chipFor(card, { aiDeferred: false }), 'declared');

  const item = (id, overrides = {}) => ({
    id,
    section: 'operational',
    required: true,
    postponable: false,
    status: 'declared',
    evidence: 'declared: s3://hadar-backups/prod',
    blocking: false,
    acceptedRisk: false,
    ...overrides,
  });
  const outcome = verifyOutcome({ mode: 'prod', items: [item('backup_policy_declared')], blocking: [], acceptedRisk: [] });
  assert.equal(outcome.passed, 0);
  assert.deepEqual(outcome.declared.map((entry) => entry.id), ['backup_policy_declared']);
  assert.deepEqual(outcome.missing, []);
  assert.deepEqual(outcome.blocked, []);
});

// The operational preview the service really answers for a declaration:
// ``proposed`` is the normalized policy and carries no ``item``
// (itsm/setup/configuration.py:1045-1053, itsm/setup/backup_policy.py:94-102).
const DECLARATION_PREVIEW = {
  section: 'operational',
  status: 'preview',
  required: true,
  postponable: false,
  current: {
    target: 's3://hadar-backups/old',
    location_kind: 'local',
    schedule: 'weekly 01:00 UTC',
    retention: '7 days',
    responsible: 'ops',
    declared_by: 'owner',
    declared_at: '2026-11-13T22:10:00+00:00',
    source: 'declaration',
  },
  proposed: {
    target: 's3://hadar-backups/prod',
    location_kind: 'object_storage',
    schedule: 'daily 02:00 UTC',
    retention: '30 days',
    responsible: 'platform team',
  },
  changes: [
    { field: 'target', from: 's3://hadar-backups/old', to: 's3://hadar-backups/prod' },
  ],
  preview_only: true,
};

// The origin/session preview the same route answers for an apply
// (itsm/setup/configuration.py:1068-1078): ``proposed`` names settings keys.
const ORIGIN_PREVIEW = {
  section: 'operational',
  status: 'preview',
  required: true,
  postponable: false,
  current: { auth_origin: '', auth_cookie_secure: true, auth_cookie_name: 'itms_session', auth_session_minutes_default: 480 },
  proposed: { auth_origin: 'https://itsm.example.test', auth_cookie_secure: true },
  changes: [{ field: 'auth_origin', from: '', to: 'https://itsm.example.test' }],
  env_override: [],
  preview_only: true,
};

test('a declaration preview is told apart from an origin preview by its fields', () => {
  const { isBackupDeclarationPreview, isOriginSettingsPreview } = load(FORMS);
  assert.equal(isBackupDeclarationPreview(DECLARATION_PREVIEW), true);
  assert.equal(isOriginSettingsPreview(DECLARATION_PREVIEW), false);
  assert.equal(isOriginSettingsPreview(ORIGIN_PREVIEW), true);
  assert.equal(isBackupDeclarationPreview(ORIGIN_PREVIEW), false);
  assert.equal(isBackupDeclarationPreview(null), false);
  assert.equal(isOriginSettingsPreview(null), false);
  // A body that names neither is neither: the page shows no diff rather than
  // guessing which of the two editors the operator asked about.
  assert.equal(isBackupDeclarationPreview({ proposed: { something_else: 'x' } }), false);
  assert.equal(isOriginSettingsPreview({ proposed: { something_else: 'x' } }), false);

  // The panel must ask these predicates, never a ``proposed.item`` the
  // operational preview body does not carry (itsm/setup/configuration.py:1045-1053).
  const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'setup', 'gap-panels.tsx'), 'utf8');
  assert.match(panel, /const declaring = isBackupDeclarationPreview\(preview\);/);
  assert.match(panel, /const applying = isOriginSettingsPreview\(preview\);/);
  assert.equal(panel.includes('proposed?.item'), false);
});

test('the provider record is read from the receipt, then live, and never invented', () => {
  const { providerRecord } = load(STATUS);
  const live = { current: { provider: 'openai', provider_record: true } };
  const recorded = { current: null };

  assert.equal(providerRecord(live, null), true);
  assert.equal(providerRecord({ current: { provider_record: false } }, null), false);
  assert.equal(providerRecord(recorded, { receipt: { provider_record: false } }), false);
  assert.equal(providerRecord(recorded, { receipt: { provider_record: true } }), true);
  assert.equal(providerRecord(recorded, null), null);
  assert.equal(providerRecord({ current: { provider: 'openai' } }, null), null);
  // The receipt is the write the page just made; a live value read before it
  // (the section as loaded when the panel opened) must not win
  // (itsm/setup/configuration.py:345-356 records provider_record on the receipt).
  assert.equal(
    providerRecord({ current: { provider: 'openai', provider_record: false } }, { receipt: { provider_record: true } }),
    true,
  );
});

test('an apply takes the read-back as current and never keeps a pre-apply value', () => {
  const { appliedSection } = load(STATUS);
  const before = {
    section: 'appearance',
    status: 'pending',
    required: true,
    postponable: false,
    actions: ['apply'],
    current: { preset: 'default' },
    proposed: null,
    receipt: null,
    currentUnavailable: false,
  };
  const decision = {
    section: 'appearance',
    required: true,
    postponable: false,
    status: 'passed',
    receipt: { organizationName: 'Hadar IT' },
  };
  const refreshed = { ...before, status: 'passed', current: { preset: 'blue', organizationName: 'Hadar IT' } };

  const merged = appliedSection(before, decision, refreshed);
  assert.deepEqual(merged.current, { preset: 'blue', organizationName: 'Hadar IT' });
  assert.equal(merged.status, 'passed');

  // A read-back that failed after the apply clears the live value: a value
  // read before the write is never shown as the current one.
  const failed = appliedSection(before, decision, null);
  assert.equal(failed.current, null);
  assert.equal(failed.currentUnavailable, true);
  assert.equal(failed.status, 'passed');

  // ``applied`` is the call's own word, never a stored status: the section
  // keeps the status of the read-back.
  const origin = appliedSection(
    { ...before, section: 'operational' },
    { section: 'operational', required: true, postponable: false, status: 'applied', receipt: null },
    { ...before, section: 'operational', status: 'pending' },
  );
  assert.equal(origin.status, 'pending');
});
