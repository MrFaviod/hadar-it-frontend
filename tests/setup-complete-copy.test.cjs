'use strict';
// The finish step and the completed hand-over. The wizard is the last screen a
// person sees before the app, so the pins are: the report preview is read
// before confirming, the confirmation is a separate explicit control, the
// completed copy links to the app, focus lands on the new heading, and the
// dialog is announced. The catalog owns every sentence, including the ones a
// completed install shows after its setup session is gone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'src', 'setup', 'SetupApp.tsx'), 'utf8');
const sections = fs.readFileSync(path.join(ROOT, 'src', 'setup', 'sections.tsx'), 'utf8');
const ui = app + '\n' + sections;
const main = fs.readFileSync(path.join(ROOT, 'src', 'main.tsx'), 'utf8');
const catalog = (locale) => JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'i18n', `${locale}.json`), 'utf8'));

const FINISH_KEYS = [
  'ui.setup.steps.finish',
  'ui.setup.finish.title',
  'ui.setup.finish.lead',
  'ui.setup.finish.report_title',
  'ui.setup.finish.report_loading',
  'ui.setup.finish.report_error',
  'ui.setup.finish.report_retry',
  'ui.setup.finish.mode',
  'ui.setup.finish.owner',
  'ui.setup.finish.ai_status',
  'ui.setup.finish.ai_provider',
  'ui.setup.finish.ai_model',
  'ui.setup.finish.storage_engine',
  'ui.setup.finish.storage_status',
  'ui.setup.finish.checks',
  'ui.setup.finish.checks_value',
  'ui.setup.finish.verified_at',
  'ui.setup.finish.instance',
  'ui.setup.finish.digest',
  'ui.setup.finish.download',
  'ui.setup.finish.confirm',
  'ui.setup.finish.confirming',
  'ui.setup.finish.confirm_hint',
  'ui.setup.finish.error.completion_blocked',
  'ui.setup.finish.error.session_expired',
  'ui.setup.finish.error.state_refused',
  'ui.setup.finish.error.unavailable',
  'ui.setup.finish.error.network',
  'ui.setup.finish.error.timeout',
  'ui.setup.finish.error.invalid_response',
  'ui.setup.complete.title',
  'ui.setup.complete.lead',
  'ui.setup.complete.report',
  'ui.setup.complete.link',
  'ui.setup.complete.digest',
];

test('both catalogs carry the finish and completed copy', () => {
  for (const locale of ['es', 'en']) {
    const copy = catalog(locale);
    for (const key of FINISH_KEYS) {
      assert.equal(typeof copy[key], 'string', `${locale} is missing ${key}`);
      assert.ok(copy[key].trim().length > 0, `${locale} has an empty ${key}`);
    }
  }
});

test('the finish step is announced, focused and separate from the confirmation', () => {
  assert.match(ui, /data-setup-finish/);
  assert.match(ui, /data-setup-finish-status/);
  assert.match(ui, /id="setup-finish-title"/);
  assert.match(ui, /headingRef=\{panelHeading\}/);
  assert.match(ui, /ref=\{props\.headingRef\}/);
  assert.match(ui, /id="setup-finish-confirm"/);
  assert.match(app, /onConfirm=\{\(\) => \{ void completeInstallation\(\); \}\}/);
  // The report is read before the confirmation is offered.
  assert.match(app, /void loadReport\(\)/);
  assert.match(ui, /disabled=\{props\.completing \|\| report === null\}/);
});

test('the report downloads as a JSON blob built from the sanitized object', () => {
  assert.match(app, /new Blob\(\[JSON\.stringify\(report, null, 2\)\], \{ type: 'application\/json' \}\)/);
  assert.match(app, /URL\.createObjectURL/);
  assert.match(app, /URL\.revokeObjectURL/);
  assert.match(app, /link\.download = /);
});

test('the completed screen links to the app and is announced', () => {
  assert.match(app, /data-setup-complete/);
  assert.match(app, /data-setup-complete-heading/);
  assert.match(app, /aria-live="polite"/);
  assert.match(app, /href="\/"/);
  assert.match(app, /ui\.setup\.complete\.link/);
});

test('the finish and completed screens never read a credential field', () => {
  for (const forbidden of ['password', 'secret', 'api_key', 'apiKey', 'token', 'database_url']) {
    const pattern = new RegExp(`report\\.[A-Za-z0-9_.]*${forbidden}`, 'i');
    assert.ok(!pattern.test(app), `the finish screen reads report.${forbidden}`);
  }
  assert.ok(!/dangerouslySetInnerHTML/.test(app), 'the report is injected as HTML');
});

test('main.tsx routes a complete installation to the app, never to setup', () => {
  assert.match(main, /resolveBoot/);
  assert.ok(!/resolveEntry/.test(main), 'main still decides with the setup probe alone');
  assert.match(main, /if \(view\.kind === 'setup'\) return <SetupApp initialSession=\{view\.decision\.session\} \/>;/);
});
