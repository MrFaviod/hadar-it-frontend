'use strict';
// Where a configured section stands, and whether verification may move on.
// The wizard must never paint a postponement or an accepted risk green, and a
// deferred AI step keeps its section pending even if a later read-back claims
// otherwise. The evidence is the service's own checklist: blocking is read
// from the item, never re-derived from a status this file invented.
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
    section: 'appearance',
    status: 'pending',
    required: true,
    postponable: false,
    actions: ['apply'],
    current: null,
    ...overrides,
  };
}

function item(id, overrides = {}) {
  return {
    id,
    section: 'appearance',
    required: true,
    postponable: false,
    status: 'pending',
    evidence: 'observed',
    blocking: false,
    acceptedRisk: false,
    ...overrides,
  };
}

test('postponed and risk are never shown as a pass', () => {
  const { chipFor } = load();
  const options = { aiDeferred: false };
  assert.equal(chipFor(section({ status: 'postponed', postponable: true }), options), 'postponed');
  assert.equal(chipFor(section({ section: 'notifications', status: 'postponed', postponable: true }), options), 'postponed');
  assert.equal(chipFor(section({ section: 'operational', status: 'risk' }), options), 'risk');
  assert.notEqual(chipFor(section({ section: 'operational', status: 'risk' }), options), 'passed');
});

test('a deferred AI step keeps the agent section pending', () => {
  const { chipFor } = load();
  const agent = section({ section: 'agent', status: 'passed' });
  assert.equal(chipFor(agent, { aiDeferred: true }), 'pending');
  assert.equal(chipFor(agent, { aiDeferred: false }), 'passed');
});

test('passed and pending keep the service words', () => {
  const { chipFor } = load();
  const options = { aiDeferred: false };
  assert.equal(chipFor(section({ status: 'passed' }), options), 'passed');
  assert.equal(chipFor(section({ status: 'pending' }), options), 'pending');
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

test('the live value is flattened for display and arrays print their ids', () => {
  const { currentRows } = load();
  assert.deepEqual(
    currentRows(section({
      section: 'appearance',
      current: { preset: 'blue', previous: null, builtinIds: ['generic', 'forest'] },
    })),
    [
      { field: 'preset', value: 'blue' },
      { field: 'builtinIds', value: 'generic, forest' },
    ],
  );
  assert.deepEqual(currentRows(section({ current: null })), []);
});

test('only the appearance section publishes closed choices', () => {
  const { choicesFor } = load();
  assert.deepEqual(
    choicesFor(section({ section: 'appearance', current: { preset: 'blue', builtinIds: ['generic', 'forest'] } })),
    ['generic', 'forest'],
  );
  assert.deepEqual(choicesFor(section({ section: 'notifications', current: { kind: 'smtp' } })), []);
  assert.deepEqual(choicesFor(section({ section: 'appearance', current: null })), []);
});

test('verification blocks on the service verdict and keeps postponements out of it', () => {
  const { verifyOutcome } = load();
  const outcome = verifyOutcome({
    mode: 'dev',
    items: [
      item('database_ready', { status: 'passed' }),
      item('worker_ready', { status: 'failed', blocking: true }),
      item('appearance_decided', { status: 'pending', blocking: true }),
      item('smtp', { section: 'notifications', required: false, postponable: true, status: 'postponed' }),
      item('monitoring', { section: 'monitoring', required: false, postponable: true, status: 'postponed' }),
      item('external_search', { section: 'operational', required: false, status: 'unavailable' }),
    ],
    blocking: ['worker_ready', 'appearance_decided'],
    acceptedRisk: [],
  });
  assert.equal(outcome.passed, 1);
  assert.deepEqual(outcome.blocked.map((entry) => entry.id), ['worker_ready', 'appearance_decided']);
  assert.deepEqual(outcome.postponed.map((entry) => entry.id), ['smtp', 'monitoring']);
  assert.deepEqual(outcome.failed.map((entry) => entry.id), ['worker_ready']);
});

test('an accepted risk is recorded, reported as a risk and does not block', () => {
  const { verifyOutcome } = load();
  const outcome = verifyOutcome({
    mode: 'prod',
    items: [
      item('backup_policy_declared', {
        section: 'operational',
        required: true,
        status: 'risk',
        evidence: 'accepted risk: single host demo',
        blocking: false,
        acceptedRisk: true,
      }),
    ],
    blocking: [],
    acceptedRisk: ['backup_policy_declared'],
  });
  assert.deepEqual(outcome.risk.map((entry) => entry.id), ['backup_policy_declared']);
  assert.deepEqual(outcome.blocked, []);
  assert.deepEqual(outcome.missing, []);
});

test('only appearance presets become assistant suggestions, never the current one', () => {
  const { suggestionsFor } = load();
  const sections = [
    section({ section: 'appearance', current: { preset: 'generic', builtinIds: ['generic', 'forest', 'blue'] } }),
    section({ section: 'notifications', current: { kind: 'smtp' } }),
    section({ section: 'operational', current: { origin: 'https://itsm.example' } }),
  ];
  const suggestions = suggestionsFor('Para una sala oscura conviene forest; no uses prod.', sections);
  assert.deepEqual(suggestions, [{ section: 'appearance', value: 'forest' }]);

  assert.deepEqual(suggestionsFor(null, sections), []);
  assert.deepEqual(suggestionsFor('habla de otra cosa', sections), []);
});

test('a suggestion never repeats the current preset', () => {
  const { suggestionsFor } = load();
  const sections = [
    section({ section: 'appearance', current: { preset: 'generic', builtinIds: ['generic', 'forest', 'blue'] } }),
  ];
  assert.deepEqual(suggestionsFor('generic frente a forest', sections), [{ section: 'appearance', value: 'forest' }]);
  assert.deepEqual(suggestionsFor('sólo generic', sections), []);
});
