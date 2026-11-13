'use strict';
// Where a configured section stands, and whether verification may move on.
// The wizard must never paint a postponed item green, and a deferred AI step
// keeps its section pending even if a later read-back claims otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SOURCE = require.resolve(path.join(__dirname, '..', 'src', 'setup', 'section-status.ts'));

function load() {
  delete require.cache[SOURCE];
  return require(SOURCE);
}

function section(overrides = {}) {
  return {
    id: 'appearance',
    status: 'pending',
    source: 'default',
    required: true,
    postponable: false,
    locked: false,
    value: 'claro',
    options: ['claro', 'nocturno'],
    updatedAt: null,
    ...overrides,
  };
}

test('postponed is never shown as applied or verified', () => {
  const { chipFor } = load();
  assert.equal(chipFor(section({ status: 'postponed', postponable: true }), { aiDeferred: false }), 'postponed');
  assert.equal(chipFor(section({ id: 'notifications', status: 'postponed', postponable: true }), { aiDeferred: false }), 'postponed');
});

test('a deferred AI step keeps the agent section pending', () => {
  const { chipFor } = load();
  const agent = section({ id: 'agent', status: 'applied', source: 'installation' });
  assert.equal(chipFor(agent, { aiDeferred: true }), 'pending');
  assert.equal(chipFor(agent, { aiDeferred: false }), 'applied');
});

test('verified, applied, risk and pending keep their own words', () => {
  const { chipFor } = load();
  const options = { aiDeferred: false };
  assert.equal(chipFor(section({ status: 'verified' }), options), 'verified');
  assert.equal(chipFor(section({ status: 'applied' }), options), 'applied');
  assert.equal(chipFor(section({ status: 'risk' }), options), 'risk');
  assert.equal(chipFor(section({ status: 'pending' }), options), 'pending');
});

test('an environment or domain value is locked for the wizard', () => {
  const { isLocked } = load();
  assert.equal(isLocked(section({ source: 'environment' })), true);
  assert.equal(isLocked(section({ source: 'domain_service' })), true);
  assert.equal(isLocked(section({ locked: true })), true);
  assert.equal(isLocked(section({ source: 'installation' })), false);
});

test('every section links to the settings route that owns it', () => {
  const { SECTION_ROUTES } = load();
  assert.deepEqual(SECTION_ROUTES, {
    agent: '#/configuracion/ia',
    appearance: '#/configuracion/apariencia',
    notifications: '#/configuracion/notificaciones',
    monitoring: '#/configuracion/supervision',
    operational: '#/configuracion/sistema',
  });
});

test('verification blocks on required failures and keeps postponements out of it', () => {
  const { verifyOutcome } = load();
  const outcome = verifyOutcome({
    mode: 'dev',
    items: [
      { id: 'database_ready', status: 'passed', required: true, postponable: false, evidence: [], observedAt: null },
      { id: 'worker_ready', status: 'failed', required: true, postponable: false, evidence: [], observedAt: null },
      { id: 'appearance_decided', status: 'pending', required: true, postponable: false, evidence: [], observedAt: null },
      { id: 'smtp', status: 'postponed', required: false, postponable: true, evidence: [], observedAt: null },
      { id: 'monitoring', status: 'postponed', required: false, postponable: true, evidence: [], observedAt: null },
    ],
  });
  assert.equal(outcome.passed, 1);
  assert.deepEqual(outcome.blocked.map((item) => item.id), ['worker_ready', 'appearance_decided']);
  assert.deepEqual(outcome.postponed.map((item) => item.id), ['smtp', 'monitoring']);
});

test('a required risk is reported as not verified', () => {
  const { verifyOutcome } = load();
  const outcome = verifyOutcome({
    mode: 'prod',
    items: [
      { id: 'backup_policy_declared', status: 'risk', required: true, postponable: false, evidence: [], observedAt: null },
    ],
  });
  assert.deepEqual(outcome.blocked.map((item) => item.id), ['backup_policy_declared']);
  assert.deepEqual(outcome.risk.map((item) => item.id), ['backup_policy_declared']);
});

test('only options of an unlocked section become assistant suggestions', () => {
  const { suggestionsFor } = load();
  const sections = [
    section({ id: 'appearance', options: ['claro', 'nocturno'] }),
    section({ id: 'operational', source: 'environment', value: 'dev', options: ['dev', 'prod'] }),
    section({ id: 'monitoring', status: 'pending', postponable: true, value: null, options: ['basico', 'completo'] }),
  ];
  const suggestions = suggestionsFor('Para una sala oscura conviene nocturno; no uses prod.', sections);
  assert.deepEqual(suggestions, [{ section: 'appearance', value: 'nocturno' }]);

  assert.deepEqual(suggestionsFor(null, sections), []);
  assert.deepEqual(suggestionsFor('habla de otra cosa', sections), []);
});

test('a suggestion never repeats the current value or the same section', () => {
  const { suggestionsFor } = load();
  const sections = [
    section({ id: 'appearance', value: 'claro', options: ['claro', 'nocturno', 'alto-contraste'] }),
  ];
  const suggestions = suggestionsFor('claro frente a nocturno y alto-contraste', sections);
  assert.deepEqual(suggestions, [{ section: 'appearance', value: 'nocturno' }]);
});
