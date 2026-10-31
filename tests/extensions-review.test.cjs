'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSandbox, evaluate, deferred, digest, mountThroughShell } = require('./extensions-support.cjs');
const { setup } = require('./universal-harness.cjs');

function candidateDetail(overrides) {
  const base = {
    id: 'cand-1',
    extensionId: 'demo',
    version: '1.2.0',
    digest: digest('c'),
    state: 'pending',
    revision: 11,
    submittedBy: 'user-1',
    submittedAt: '2026-10-20T10:00:00Z',
    approvedBy: null,
    approvedAt: null,
    supersededAt: null,
    manifest: {
      id: 'demo',
      name: 'Demo nativa',
      version: '1.2.0',
      sdkVersion: 2,
      schemaVersion: 2,
      permissions: [{ code: 'ext_demo.page', label: 'Ver página', description: 'Abre la página.' }],
      operations: [{ name: 'inspect', description: 'Consulta los registros', permission: 'ext_demo.page', mutation: false }],
      collections: [{ name: 'records', description: 'Registros' }],
      frontend: { pages: [{ id: 'panel', label: 'Panel demo', component: 'DemoPanel', permission: 'ext_demo.page' }], assetPanels: [] },
      schedules: [{ name: 'periodic', permission: 'ext_demo.page', intervalSeconds: 86400 }],
      skills: [{ name: 'registry', description: 'Gestiona el registro', path: 'skills/registry/SKILL.md' }]
    },
    validation: {
      status: 'passed',
      digest: digest('c'),
      sdkVersion: 2,
      checks: [{ name: 'digest', status: 'passed', detail: 'Coincide' }],
      errors: [],
      container: { image: 'itsm-extension-validator:1', engine: 'docker', source: { content: 'not review copy' } },
      completedAt: '2026-10-20T10:01:00Z'
    },
    permissionDelta: {
      added: [{ code: 'ext_demo.page', label: 'Ver página', description: 'Abre la página.' }],
      removed: [],
      grantedTo: 'superadmin',
      core: ['assets.view'],
      note: 'Los permisos nuevos se conceden solo al Superadmin.'
    },
    migrationPlan: {
      from: 1,
      to: 2,
      steps: [{ from: 1, to: 2, handler: 'm2' }],
      compatible: true,
      required: true
    },
    trust: {
      model: 'trusted-native',
      sandboxed: false,
      statement: 'Código aprobado dentro del host; no es un sandbox.'
    },
    currentVersion: '1.1.0',
    currentRevision: 7,
    rollbackCompatible: true,
    history: [
      {
        id: 'h1',
        action: 'extension.installed',
        actorId: 'user-1',
        createdAt: '2026-10-01T10:00:00Z',
        detail: { version: '1.1.0', digest: digest('d'), revision: 6, enabled: true }
      },
      {
        id: 'h2',
        action: 'extension.submitted',
        actorId: 'user-2',
        createdAt: '2026-10-02T10:00:00Z',
        detail: { candidateId: 'cand-0', version: '1.2.0', digest: digest('e') }
      }
    ]
  };
  return Object.assign(base, overrides || {});
}

function installedItem(overrides) {
  const base = {
    id: 'demo',
    manifest: { id: 'demo', name: 'Demo nativa', version: '1.2.0', sdkVersion: 2, schemaVersion: 2, permissions: [], operations: [] },
    digest: digest('a'),
    enabled: true,
    version: '1.2.0',
    revision: 5,
    schemaVersion: 2,
    frontendUrl: '/api/v1/extensions/demo/frontend.js?digest=' + digest('a'),
    operations: []
  };
  return Object.assign(base, overrides || {});
}

function createReview(options) {
  const env = createSandbox();
  const requests = [];
  let handler = () => Promise.resolve({});
  env.window.AssetAccess = {
    request(_vm, requestPath, requestOptions) {
      requests.push({ path: requestPath, options: requestOptions });
      return handler(requestPath, requestOptions);
    },
    setExtensionPermissions() {}
  };
  evaluate(env, 'assets/js/extensions.js');
  const Review = env.window.AssetExtensions.components.ExtensionReview;
  const instance = Review.data();
  Object.assign(instance, Review.methods);
  Object.keys(Review.computed).forEach((name) => {
    Object.defineProperty(instance, name, {
      configurable: true,
      get: Review.computed[name].bind(instance)
    });
  });
  const app = {
    authenticated: true,
    activeUserId: 'user-1',
    serverPermissions: ['system.modules'],
    route: { name: 'config', section: 'extensiones', candidateId: 'cand-1' },
    setHash(hash) { this.hash = hash; },
    can(permission) { return this.permissions ? this.permissions.includes(permission) : true; },
    permissions: ['system.modules'],
    extensionsLoad() { this.reloads = (this.reloads || 0) + 1; return Promise.resolve(true); },
    extensions: { items: [installedItem()] },
    showToast() {}
  };
  instance.app = app;
  return {
    env,
    window: env.window,
    Review,
    instance,
    app,
    requests,
    setHandler(fn) { handler = fn; }
  };
}

test('review loads the candidate inbox and the deep-linked candidate detail', async () => {
  const review = createReview();
  review.setHandler((requestPath) => {
    if (requestPath === '/extensions/candidates') {
      return Promise.resolve({
        items: [{
          id: 'cand-1', extensionId: 'demo', version: '1.2.0', digest: digest('c'), state: 'pending',
          revision: 11, submittedAt: '2026-10-20T10:00:00Z', validationStatus: 'passed',
          currentVersion: '1.1.0', currentRevision: 7
        }]
      });
    }
    if (requestPath === '/extensions/candidates/cand-1') return Promise.resolve(candidateDetail());
    throw new Error('unexpected ' + requestPath);
  });

  await review.instance.reviewLoad();
  assert.equal(review.instance.review.loading, false);
  assert.equal(review.instance.review.candidates.length, 1);
  assert.equal(review.instance.review.detail.id, 'cand-1');
  assert.equal(review.instance.review.selectedId, 'cand-1');
  assert.match(review.instance.review.candidates[0].currentVersion, /1\.1\.0/);
});

test('approve confirmation sends the digest and locked integer currentRevision, never candidate revision', async () => {
  const review = createReview();
  let approvedBody = null;
  review.setHandler((requestPath, requestOptions) => {
    if (requestPath === '/extensions/candidates') return Promise.resolve({ items: [] });
    if (requestPath === '/extensions/candidates/cand-1') return Promise.resolve(candidateDetail());
    if (requestPath === '/extensions/candidates/cand-1/approve') {
      approvedBody = requestOptions.body;
      return Promise.resolve({ ok: true });
    }
    throw new Error('unexpected ' + requestPath);
  });

  await review.instance.reviewLoad();
  review.instance.askApprove();
  assert.equal(review.instance.confirm.open, true);
  assert.equal(review.instance.confirm.payload.digest, digest('c'));
  assert.equal(review.instance.confirm.payload.expectedVersion, 7);
  assert.equal(approvedBody, null, 'confirmation alone performs no request');

  await review.instance.confirmRun();
  assert.equal(approvedBody.digest, digest('c'));
  assert.equal(approvedBody.expectedVersion, 7);
  assert.equal(review.instance.action.error, '');
  assert.equal(review.instance.app.reloads, 1);
});

test('a candidate without currentRevision never emits an undefined expectedVersion', async () => {
  const review = createReview();
  review.setHandler((requestPath) => {
    if (requestPath === '/extensions/candidates') return Promise.resolve({ items: [] });
    if (requestPath === '/extensions/candidates/cand-1') {
      return Promise.resolve(candidateDetail({ currentRevision: undefined }));
    }
    throw new Error('unexpected ' + requestPath);
  });
  await review.instance.reviewLoad();
  review.instance.askApprove();
  assert.equal(review.instance.confirm.open, false);
  assert.match(review.instance.action.error, /revisión/i);
  assert.equal(review.requests.filter((entry) => entry.path.endsWith('/approve')).length, 0);
});

test('disable and enable send the installed integer revision and refresh from the server', async () => {
  const review = createReview();
  const bodies = [];
  review.setHandler((requestPath, requestOptions) => {
    if (requestPath === '/extensions/candidates') return Promise.resolve({ items: [] });
    if (requestPath === '/extensions/candidates/cand-1') return Promise.resolve(candidateDetail());
    if (requestPath === '/extensions/demo/enabled') {
      bodies.push(requestOptions.body);
      return Promise.resolve({ ok: true });
    }
    throw new Error('unexpected ' + requestPath);
  });

  await review.instance.reviewLoad();
  const installed = installedItem();
  review.instance.askToggle(installed, false);
  assert.equal(review.instance.confirm.payload.enabled, false);
  assert.equal(review.instance.confirm.payload.expectedVersion, 5);
  await review.instance.confirmRun();
  review.instance.askToggle(installedItem({ enabled: false, revision: 6 }), true);
  await review.instance.confirmRun();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].enabled, false);
  assert.equal(bodies[0].expectedVersion, 5);
  assert.equal(bodies[1].enabled, true);
  assert.equal(bodies[1].expectedVersion, 6);
});

test('stale lifecycle responses surface the conflict and never claim a local result', async () => {
  const review = createReview();
  review.setHandler((requestPath) => {
    if (requestPath === '/extensions/candidates') return Promise.resolve({ items: [] });
    if (requestPath === '/extensions/candidates/cand-1') return Promise.resolve(candidateDetail());
    if (requestPath === '/extensions/demo/enabled') {
      const error = new Error('El módulo cambió.');
      error.code = 'stale';
      error.status = 409;
      return Promise.reject(error);
    }
    throw new Error('unexpected ' + requestPath);
  });

  await review.instance.reviewLoad();
  review.instance.askToggle(installedItem(), false);
  await review.instance.confirmRun();
  assert.equal(review.instance.review.stale, true);
  assert.match(review.instance.action.error, /cambió/i);
  assert.equal(review.instance.action.message, '');
  assert.equal(review.instance.confirm.open, false);
  assert.ok(review.instance.app.reloads >= 1);
});

test('rollback is offered only for a previous installed version with digest and compatibility', async () => {
  const review = createReview();
  review.setHandler((requestPath) => {
    if (requestPath === '/extensions/candidates') return Promise.resolve({ items: [] });
    if (requestPath === '/extensions/candidates/cand-1') return Promise.resolve(candidateDetail());
    throw new Error('unexpected ' + requestPath);
  });
  await review.instance.reviewLoad();
  const detail = review.instance.review.detail;
  const active = installedItem();
  const installedEntry = detail.history[0];
  const submittedEntry = detail.history[1];

  assert.equal(review.instance.canRollback(installedEntry, active), true);
  assert.equal(review.instance.canRollback(submittedEntry, active), false);
  assert.equal(review.instance.canRollback({
    action: 'extension.installed',
    detail: { version: '1.2.0', digest: digest('f') }
  }, active), false, 'same version is not a rollback target');

  review.instance.askRollback(installedEntry, active);
  assert.equal(review.instance.confirm.payload.version, '1.1.0');
  assert.equal(review.instance.confirm.payload.digest, digest('d'));
  assert.equal(review.instance.confirm.payload.expectedVersion, 5);
});

test('review refuses approval without validation and explains the server trust notice', async () => {
  const review = createReview();
  review.setHandler((requestPath) => {
    if (requestPath === '/extensions/candidates') return Promise.resolve({ items: [] });
    if (requestPath === '/extensions/candidates/cand-1') {
      return Promise.resolve(candidateDetail({
        validation: { status: 'failed', digest: digest('c'), sdkVersion: 2, checks: [], errors: ['Fallo'], container: 'x', completedAt: '2026-10-20T10:01:00Z' }
      }));
    }
    throw new Error('unexpected ' + requestPath);
  });
  await review.instance.reviewLoad();
  assert.match(review.instance.detailTrustNotice(), /no es un sandbox/i);
  review.instance.askApprove();
  assert.equal(review.instance.confirm.open, false);
  assert.match(review.instance.action.error, /validación/i);
  assert.equal(review.requests.filter((entry) => entry.path.endsWith('/approve')).length, 0);
});

test('history summaries expose the installed version and revision without inventing data', async () => {
  const review = createReview();
  review.setHandler((requestPath) => {
    if (requestPath === '/extensions/candidates') return Promise.resolve({ items: [] });
    if (requestPath === '/extensions/candidates/cand-1') return Promise.resolve(candidateDetail());
    throw new Error('unexpected ' + requestPath);
  });
  await review.instance.reviewLoad();
  assert.equal(review.instance.historySummary(review.instance.history[0]), 'versión 1.1.0 · activa · revisión 6');
  assert.equal(review.instance.historySummary({ detail: null }), '');
});

test('review displays canonical host permission, migration and trust metadata', async () => {
  const review = createReview();
  review.setHandler((path) => Promise.resolve(path.endsWith('/candidates') ? { items: [] } : candidateDetail()));
  await review.instance.reviewLoad();
  assert.equal(review.instance.permissionLabel('ext_demo.page'), 'Ver página');
  assert.equal(review.instance.detailTrustNotice(), review.instance.detail.trust.statement);
  assert.deepEqual(review.instance.detail.permissionDelta.core, ['assets.view']);
  assert.equal(review.instance.detail.migrationPlan.steps[0].handler, 'm2');
});

test('passing validation must bind the exact candidate digest and SDK', async () => {
  const review = createReview();
  review.setHandler((path) => Promise.resolve(path.endsWith('/candidates') ? { items: [] } : candidateDetail({
    validation: { status: 'passed', digest: digest('f'), sdkVersion: 2, checks: [], errors: [], container: 'fixed-validator', completedAt: '2026-10-20T10:01:00Z' }
  })));
  await review.instance.reviewLoad();
  review.instance.askApprove();
  assert.equal(review.instance.confirm.open, false);
  assert.match(review.instance.action.error, /validación/i);
  assert.equal(review.requests.filter((request) => request.path.endsWith('/approve')).length, 0);
});

test('rendered human review shows exact digest, permission additions, migrations and contributions', async () => {
  const { c, app, tick } = setup();
  app.route = { name: 'config', section: 'extensiones', candidateId: 'cand-1' };
  app.extensions.loaded = true;
  c.AssetAccess.request = async (_app, path) => path.endsWith('/candidates')
    ? { items: [{ id: 'cand-1', extensionId: 'demo', version: '1.2.0', state: 'pending', validationStatus: 'passed' }] }
    : candidateDetail();
  c.document.addEventListener = () => {};
  c.document.removeEventListener = () => {};
  const mounted = mountThroughShell(c, c.AssetExtensions.components.ExtensionReview, { app });
  await mounted.instance.reviewLoad();
  await tick();
  const textOf = (node) => [node.text || '', ...(node.children || []).map(textOf)].join(' ');
  const text = textOf(mounted.root);
  for (const expected of [digest('c'), 'ext_demo.page', 'Ver página', 'Abre la página.', 'assets.view', 'm2',
    'Código aprobado dentro del host; no es un sandbox.', 'Panel demo', 'inspect', 'records', 'periodic', 'registry', 'itsm-extension-validator:1', 'docker']) {
    assert.ok(text.includes(expected), 'review renders ' + expected);
  }
  assert.ok(!text.includes('not review copy'));
  assert.deepEqual(mounted.errors.map((error) => error.message), []);
  mounted.unmount();
});

test('candidate detail and approval responses cannot repopulate a logged-out review', async () => {
  const review = createReview();
  const detail = deferred();
  review.app.authenticated = true;
  review.app.activeUserId = 'user-1';
  review.setHandler(() => detail.promise);
  const request = review.instance.reviewDetail('cand-1');
  review.app.authenticated = false;
  detail.resolve(candidateDetail());
  assert.equal(await request, false);
  assert.equal(review.instance.review.detail, null);
});
