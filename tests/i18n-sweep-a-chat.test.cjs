'use strict';
// T3a sweep A continuation: the conversation surface, configuration methods,
// shell data, people methods and the workspace adapter must render their copy
// from the `ui.*` catalog. Each case switches the shipped runtime to `en` and
// back to `es`, so a hard-coded literal in either language fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

function text(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text || '';
  return (node.text || '') + (node.children || []).map(text).join(' ');
}

// Attribute copy is not part of the text dump, so collect the strings Vue
// bound to the visible attributes instead of serialising the vnode tree.
function attrs(node) {
  if (!node) return [];
  const own = ['placeholder', 'title', 'aria-label', 'alt']
    .map(name => [node.props, node.attrs]
      .map(bag => (bag && typeof bag[name] === 'string' ? bag[name] : ''))
      .find(Boolean) || '')
    .filter(Boolean);
  return own.concat((node.children || []).flatMap(attrs));
}

async function inLocale(s, locale, run) {
  // The runtime only switches once the target bundle is loaded.
  await s.c.ItsmI18n.loadBundle(locale);
  s.c.ItsmI18n.setLocale(locale);
  await s.tick();
  await s.settle();
  return run();
}

async function bothLocales(s, pair) {
  await inLocale(s, 'es', () => pair.es(text(s.root)));
  await inLocale(s, 'en', () => pair.en(text(s.root)));
  s.c.ItsmI18n.setLocale('es');
  await s.tick();
}

test('T3a chat surface renders from the catalog and switches language in place', async () => {
  const s = setup();
  s.app.route = { name: 'conversation' };
  const canonical = s.c.fetch;
  s.c.fetch = async (url, init) => {
    if (String(url).replace(/^\/api\/v1/, '') === '/agent/engines') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          instances: [{ id: 'pydantic-built-in', name: 'Pydantic AI', engine: 'pydantic', enabled: true, attachmentsSupported: true, models: [{ id: 'model-a' }], capabilities: { tools: true } }],
          preference: { instanceId: 'pydantic-built-in', model: 'model-a' }
        })
      };
    }
    return canonical(url, init);
  };
  const ui = s.mount('AssetConversation', { app: s.app });
  s.root = ui.root;
  await s.settle();
  await bothLocales(s, {
    es: (copy) => {
      // The header now names the conversation instead of repeating the route
      // label: an empty transcript starts as "Nueva conversación".
      assert.match(copy, /Nueva conversación/, 'the empty conversation is named in Spanish');
      assert.match(copy, /Proveedor/, 'the provider selector label is translated');
      assert.match(copy, /Modelo/, 'the model selector label is translated');
      assert.match(copy, /Configuración/, 'the single configuration action is translated');
      assert.match(copy, /Adjuntos/, 'the attachment action is translated');
      assert.doesNotMatch(copy, /Todavía no hay mensajes|Choose Files|No file chosen/,
        'no instruction or browser file chrome is rendered');
      const input = attrs(s.root).join(' | ');
      assert.match(input, /Ej\.: Muéstrame los servidores de Matriz/, 'Spanish placeholder is unchanged');
    },
    en: (copy) => {
      assert.match(copy, /New conversation/, 'the empty conversation is named in English');
      assert.match(copy, /Provider/, 'the English provider label is shown');
      assert.match(copy, /Model/, 'the English model label is shown');
      assert.match(copy, /Settings/, 'the English configuration action is shown');
      assert.match(copy, /Attachments/, 'the English attachment action is shown');
      assert.doesNotMatch(copy, /Conversación|Proveedor|Modelo|Configuración|Todavía no hay mensajes|Adjuntos/,
        'no Spanish copy leaks into English');
      assert.doesNotMatch(attrs(s.root).join(' | '), /Muéstrame los servidores/, 'the placeholder is translated');
    }
  });
  ui.unmount();
});

test('T3a switching the chat language keeps the conversation state', async () => {
  const s = setup();
  s.app.route = { name: 'conversation' };
  const ui = s.mount('AssetConversation', { app: s.app });
  s.root = ui.root;
  await s.settle();
  const vm = ui.instance;
  vm.messages = [
    { role: 'user', content: 'Texto libre del usuario' },
    { role: 'assistant', content: 'Server reply text' }
  ];
  vm.draft = 'borrador en curso';
  await s.tick();
  await inLocale(s, 'en', () => {
    const copy = text(s.root);
    assert.match(copy, /Server reply text/, 'server and user text is never translated');
    assert.match(copy, /You\b|User\b/, 'the role label follows the active locale');
  });
  assert.equal(vm.messages.length, 2, 'the transcript survives the hot switch');
  assert.equal(vm.messages[0].content, 'Texto libre del usuario', 'user free text is untouched');
  assert.equal(vm.draft, 'borrador en curso', 'the draft survives the hot switch');
  s.c.ItsmI18n.setLocale('es');
  ui.unmount();
});

test('T3a chat status labels and attachment copy follow the active locale', async () => {
  const s = setup();
  s.app.route = { name: 'conversation' };
  const ui = s.mount('AssetConversation', { app: s.app });
  s.root = ui.root;
  await s.settle();
  const vm = ui.instance;
  // The attachment help only exists when an engine that accepts attachments is
  // active, so the fixture selects one before switching locale.
  vm.legacyFallback = false;
  vm.agentEnginesAvailable = true;
  vm.agentEngines = [{
    id: 'engine-1',
    engine: 'hermes',
    enabled: true,
    attachmentsSupported: true,
    models: [{ id: 'model-1' }],
    capabilities: { 'model-1': { image: true, file: true } }
  }];
  vm.agentPreference = { instanceId: 'engine-1', model: 'model-1' };
  await s.tick();
  await s.settle();
  await inLocale(s, 'en', () => {
    assert.equal(vm.attachmentKindLabel('image'), 'Image');
    assert.equal(vm.attachmentKindLabel('file'), 'PDF or document');
    assert.equal(vm.attachmentKindLabel('text'), 'Text');
    assert.equal(vm.attachmentKindLabel('other'), 'File');
    assert.equal(vm.toolStatusLabel('completed'), 'Completed');
    assert.equal(vm.toolStatusLabel('failed'), 'Failed');
    assert.equal(vm.toolStatusLabel('denied'), 'Denied');
    assert.equal(vm.toolStatusLabel('running'), 'Running');
    assert.equal(vm.toolStatusLabel('unknown'), 'Recorded');
    assert.equal(vm.actionStatusLabel('completed'), 'Completed');
    assert.equal(vm.resultStatus({ status: 'in_storage' }), 'In storage');
    assert.equal(vm.resultStatus({}), 'No status');
    assert.equal(vm.attachmentSizeText({ sizeKnown: false }), 'Size not reported');
    assert.match(vm.attachmentHelp, /text or CSV/);
  });
  await inLocale(s, 'es', () => {
    assert.equal(vm.attachmentKindLabel('image'), 'Imagen');
    assert.equal(vm.attachmentKindLabel('file'), 'PDF o documento');
    assert.equal(vm.attachmentKindLabel('text'), 'Texto');
    assert.equal(vm.attachmentKindLabel('other'), 'Archivo');
    assert.equal(vm.toolStatusLabel('completed'), 'Completada');
    assert.equal(vm.toolStatusLabel('unknown'), 'Registrada');
    assert.equal(vm.resultStatus({ status: 'in_storage' }), 'En resguardo');
    assert.equal(vm.resultStatus({}), 'Sin estado');
    assert.equal(vm.attachmentSizeText({ sizeKnown: false }), 'Tamaño no informado');
    assert.match(vm.attachmentHelp, /texto o CSV/);
  });
  ui.unmount();
});

test('T3a chat errors are localized without translating free text', async () => {
  const s = setup();
  s.app.route = { name: 'conversation' };
  const ui = s.mount('AssetConversation', { app: s.app });
  s.root = ui.root;
  await s.settle();
  const vm = ui.instance;
  await inLocale(s, 'en', () => {
    assert.equal(vm.attachmentErrorMessage({ code: 'model_modality_unsupported' }),
      'The selected model does not accept that attachment type.');
    assert.equal(vm.attachmentErrorMessage({ status: 401 }), 'This session is not available. Sign in again.');
    assert.equal(vm.attachmentErrorMessage({ serverMessage: 'Server said no' }), 'Server said no',
      'server text is shown as-is');
    assert.equal(vm.attachmentErrorMessage({}), 'Unable to attach the file.');
    assert.equal(vm.attachmentBatchError([{ name: 'a.png', size: 5 * 1024 * 1024 }]),
      'Each file must be 4 MiB or smaller.');
    assert.equal(vm.attachmentBatchError([{ name: 'a.pdf', size: 10 }]),
      'The selected model does not accept PDF or documents.');
  });
  await inLocale(s, 'es', () => {
    assert.equal(vm.attachmentErrorMessage({ code: 'engine_attachments_unsupported' }),
      'El motor seleccionado no admite adjuntos en el chat.');
    assert.equal(vm.attachmentBatchError([{ name: 'a.png', size: 5 * 1024 * 1024 }]),
      'Cada archivo debe pesar 4 MiB o menos.');
  });
  ui.unmount();
});
