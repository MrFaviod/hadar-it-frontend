'use strict';
// The owner form keeps one identity draft and two secrets. The secrets must be
// clearable without touching the draft, and the validation must refuse a form
// the server would reject anyway (its default minimum is 12 characters), so the
// first-owner step fails in the field instead of after a round trip.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SOURCE = require.resolve(path.join(__dirname, '..', 'src', 'setup', 'owner-form.ts'));
const form = require(SOURCE);

const FILLED = {
  username: 'ada',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'correct-horse-1',
  confirm: 'correct-horse-1',
};

test('an empty or partial owner form is incomplete', () => {
  assert.equal(form.validateOwnerForm(form.emptyOwnerForm()), 'required');
  assert.equal(form.validateOwnerForm({ ...FILLED, username: '  ' }), 'required');
  assert.equal(form.validateOwnerForm({ ...FILLED, displayName: '' }), 'required');
  assert.equal(form.validateOwnerForm({ ...FILLED, password: '' }), 'required');
});

test('the password must reach the identity minimum and match its confirmation', () => {
  assert.equal(form.validateOwnerForm({ ...FILLED, password: 'short', confirm: 'short' }), 'too_short');
  assert.equal(form.validateOwnerForm({ ...FILLED, confirm: 'correct-horse-2' }), 'mismatch');
  assert.equal(form.validateOwnerForm({ ...FILLED, password: 'x'.repeat(129), confirm: 'x'.repeat(129) }), 'too_long');
  assert.equal(form.validateOwnerForm(FILLED), null);
});

test('the email is optional and is not invented when the field is blank', () => {
  assert.equal(form.validateOwnerForm({ ...FILLED, email: '' }), null);
  assert.equal(form.validateOwnerForm({ ...FILLED, email: '  ' }), null);
});

test('clearing the owner secrets keeps the draft and drops both passwords', () => {
  const cleared = form.clearOwnerSecrets(FILLED);
  assert.deepEqual(cleared, {
    username: 'ada',
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
    password: '',
    confirm: '',
  });
  assert.equal(FILLED.password, 'correct-horse-1', 'the caller draft is not mutated in place');
  assert.equal(cleared.password, '');
  assert.equal(cleared.confirm, '');
});
