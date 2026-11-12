/* Isolated extension frames (SDK v2).
   A sandboxed extension never receives a host script element: the host fetches
   its digest-bound module, inlines it into an `allow-scripts` iframe with a
   strict CSP and speaks to it through a closed postMessage bridge. */
(function () {
  'use strict';

  const SANDBOX = 'allow-scripts';
  const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'";
  const VUE_PATH = '/assets/vendor/vue.global.prod.js';
  const VUE_LIMIT = 4 * 1024 * 1024;
  const MODULE_LIMIT = 1024 * 1024;
  const MAX_IN_FLIGHT = 20;
  const MIN_HEIGHT = 160;
  const MAX_HEIGHT = 2400;
  const DIGEST_RE = /^[a-f0-9]{64}$/;
  const FRONTEND_PATH_RE = /^\/api\/v1\/extensions\/([a-z0-9][a-z0-9-]{0,63})\/frontend\.js$/;
  const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const THEME_KEYS = [
    '--bg', '--paper', '--text', '--muted', '--border', '--surface-muted',
    '--teal-600', '--teal-700', '--amber-800', '--danger-700', '--accent',
    '--radius-sm', '--radius-md', '--radius-pill', '--font-body', '--font-mono'
  ];
  const DEFAULT_THEME = {
    '--bg': '#f2f7f5',
    '--paper': '#ffffff',
    '--text': '#152b34',
    '--muted': '#58717a',
    '--border': '#d7e2e1',
    '--surface-muted': '#f2f7f5',
    '--teal-600': '#0f8b81',
    '--teal-700': '#0d766e',
    '--amber-800': '#8a4b0f',
    '--danger-700': '#a92f24',
    '--radius-sm': '8px',
    '--radius-md': '12px',
    '--radius-pill': '999px',
    '--font-body': '"IBM Plex Sans", system-ui, sans-serif',
    '--font-mono': '"IBM Plex Mono", ui-monospace, monospace'
  };
  const KIT_STYLE = [
    '*{box-sizing:border-box}',
    'html,body{margin:0;background:var(--paper,#ffffff);color:var(--text,#152b34);font-family:var(--font-body,system-ui,sans-serif);font-size:14px;line-height:1.45}',
    '.kit-frame{padding:16px;display:grid;gap:14px}',
    '.kit-table-wrap{overflow:auto;border:1px solid var(--border,#d7e2e1);border-radius:var(--radius-md,12px)}',
    '.kit-table{width:100%;border-collapse:collapse}',
    '.kit-table th,.kit-table td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border,#d7e2e1);vertical-align:top}',
    '.kit-table th{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#58717a);background:var(--surface-muted,#f2f7f5)}',
    '.kit-btn{min-height:38px;padding:0 16px;border-radius:var(--radius-pill,999px);border:1px solid transparent;background:var(--teal-700,#0d766e);color:#ffffff;font:inherit;font-size:13px;font-weight:600;cursor:pointer}',
    '.kit-btn--secondary{background:transparent;border-color:var(--border,#d7e2e1);color:var(--text,#152b34)}',
    '.kit-btn:disabled{opacity:.6;cursor:not-allowed}',
    '.kit-field{display:grid;gap:6px;margin-bottom:14px}',
    '.kit-field label{font-size:12px;font-weight:600;color:var(--muted,#58717a)}',
    '.kit-field input,.kit-field textarea{min-height:40px;padding:8px 10px;border:1px solid var(--border,#d7e2e1);border-radius:var(--radius-sm,8px);background:var(--paper,#ffffff);color:inherit;font:inherit}',
    '.kit-field__error{margin:0;color:var(--danger-700,#a92f24);font-size:12px}',
    '.kit-field__hint{margin:0;color:var(--muted,#58717a);font-size:12px}',
    '.kit-status{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;background:var(--surface-muted,#f2f7f5);color:var(--muted,#58717a)}',
    '.kit-status--ok{color:var(--teal-700,#0d766e)}',
    '.kit-status--warn{color:var(--amber-800,#8a4b0f)}',
    '.kit-status--down{color:var(--danger-700,#a92f24)}',
    '.kit-empty{padding:18px;text-align:center;color:var(--muted,#58717a)}',
    '.kit-error{display:grid;gap:6px;padding:12px 14px;border:1px solid var(--danger-700,#a92f24);border-radius:var(--radius-sm,8px);color:var(--danger-700,#a92f24);background:var(--paper,#ffffff)}',
    '.kit-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
  ].join('\n');

  const FRAME_STRING_KEYS = {
    captionFallback: 'ui.extensions.frame.caption_fallback',
    loadingData: 'ui.shell.loading_data',
    emptyTable: 'ui.extensions.frame.empty_table',
    booleanTrue: 'ui.extensions.frame.boolean_true',
    booleanFalse: 'ui.extensions.frame.boolean_false',
    invalidOperation: 'ui.extensions.frame.invalid_operation',
    requestFailed: 'ui.extensions.frame.request_failed',
    missingComponent: 'ui.extensions.frame.missing_component',
    missingComponentName: 'ui.extensions.frame.missing_component_name',
    registerRequired: 'ui.extensions.frame.register_required',
    renderRequired: 'ui.extensions.frame.render_required',
    documentTitle: 'ui.extensions.frame.document_title'
  };

  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime && typeof runtime.t === 'function' ? runtime.t(key, params) : '';
  }

  // A sandboxed frame has no host i18n instance, so the host resolves the kit
  // copy in the active locale and ships it in the init payload. One catalog stays
  // the only source of truth and a hot switch can refresh an already open frame.
  function frameMessages() {
    const messages = {};
    Object.keys(FRAME_STRING_KEYS).forEach((name) => {
      messages[name] = tr(FRAME_STRING_KEYS[name]);
    });
    return messages;
  }

  function activeLocale() {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    const tag = runtime && typeof runtime.activeLocale === 'string' ? runtime.activeLocale : '';
    return tag || 'es';
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value) {
    return typeof value === 'string' ? value : '';
  }

  function sanitizeThemeValue(value) {
    const raw = String(value === null || value === undefined ? '' : value).slice(0, 120);
    return /^[A-Za-z0-9#%.,()\- "'\/]+$/.test(raw) ? raw : '';
  }

  function themeCss(theme) {
    const source = isPlainObject(theme) ? theme : {};
    return Object.keys(source)
      .filter((key) => /^--[a-z0-9-]{1,48}$/i.test(key))
      .map((key) => ({ key, value: sanitizeThemeValue(source[key]) }))
      .filter((entry) => entry.value)
      .map((entry) => entry.key + ': ' + entry.value)
      .join('; ');
  }

  function themeTokens(win) {
    const scope = win || window;
    const tokens = Object.assign({}, DEFAULT_THEME);
    try {
      const computed = scope.getComputedStyle && scope.document && scope.document.documentElement
        ? scope.getComputedStyle(scope.document.documentElement)
        : null;
      if (computed && typeof computed.getPropertyValue === 'function') {
        THEME_KEYS.forEach((key) => {
          const value = text(computed.getPropertyValue(key)).trim();
          if (value) tokens[key] = value;
        });
      }
    } catch (_) {
      /* The brand defaults keep the frame legible without computed styles. */
    }
    return tokens;
  }

  // An inline script may not contain a literal closing tag: a module could
  // otherwise break out of the srcdoc document it was inlined into.
  function inlineScript(source) {
    return String(source === null || source === undefined ? '' : source)
      .replace(/<\/script/gi, '<\\/script')
      .replace(/<!--/g, '<\\!--');
  }

  function kitSource(origin, initial) {
    const hostOrigin = JSON.stringify(text(origin) || 'null');
    const initialCopy = JSON.stringify({
      locale: text(initial && initial.locale) || 'es',
      messages: isPlainObject(initial && initial.messages) ? initial.messages : {}
    });
    return `(function () {
  'use strict';
  var HOST_ORIGIN = ${hostOrigin};
  var definition = null;
  var booted = false;
  var sequence = 0;
  var fieldSequence = 0;
  var pending = {};
  var LOCALE = 'es';
  var MESSAGES = window.Vue && typeof window.Vue.reactive === 'function' ? window.Vue.reactive({}) : {};
  function t(name, params) {
    var message = MESSAGES[name];
    if (typeof message !== 'string' || !message) return '';
    return message.replace(/\\{(\\w+)\\}/g, function (match, key) {
      return params && params[key] !== undefined && params[key] !== null ? String(params[key]) : match;
    });
  }
  function escapeText(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[<>&"]/g, function (character) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[character];
    });
  }
  function applyLocale(data) {
    if (!data || typeof data !== 'object') return;
    if (typeof data.locale === 'string' && data.locale) LOCALE = data.locale;
    var incoming = data.messages && typeof data.messages === 'object' ? data.messages : null;
    if (incoming) {
      Object.keys(MESSAGES).forEach(function (key) { delete MESSAGES[key]; });
      Object.keys(incoming).forEach(function (key) {
        if (typeof incoming[key] === 'string') MESSAGES[key] = incoming[key];
      });
    }
    document.documentElement.lang = LOCALE;
  }
  applyLocale(${initialCopy});
  function post(message) {
    try { window.parent.postMessage(message, HOST_ORIGIN); } catch (_) { /* the frame is detached */ }
  }
  function request(operation, args) {
    if (typeof operation !== 'string' || !operation) return Promise.reject(new Error(t('invalidOperation')));
    var id = 'r' + (++sequence);
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      post({ type: 'itsm:request', id: id, operation: operation, args: args && typeof args === 'object' ? args : {} });
    });
  }
  function navigate(page) {
    post({ type: 'itsm:navigate', page: typeof page === 'string' ? page : (page && page.page) || '' });
  }
  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    Object.keys(theme).forEach(function (key) {
      if (key.indexOf('--') !== 0) return;
      document.documentElement.style.setProperty(key, String(theme[key]));
    });
  }
  var KitTable = {
    name: 'ItsmTable',
    props: {
      columns: { type: Array, default: function () { return []; } },
      rows: { type: Array, default: function () { return []; } },
      caption: { type: String, default: '' },
      empty: { type: String, default: '' },
      loading: { type: Boolean, default: false }
    },
    methods: {
      copy: function (name) { return t(name); },
      cell: function (row, column) {
        var value = row ? row[column.field] : '';
        if (value === null || value === undefined || value === '') return '—';
        if (typeof value === 'boolean') return value ? t('booleanTrue') : t('booleanFalse');
        if (typeof value === 'object') return '—';
        return String(value);
      }
    },
    render: function () {
      var self = this;
      var h = Vue.h;
      var body = [];
      if (this.loading || !this.rows.length) {
        body.push(h('tr', [h('td', { colspan: this.columns.length || 1, class: 'kit-empty', role: this.loading ? 'status' : null },
          this.loading ? this.copy('loadingData') : (this.empty || this.copy('emptyTable')))]));
      }
      this.rows.forEach(function (row, index) {
        body.push(h('tr', { key: row.id || index }, self.columns.map(function (column) {
          return h('td', { key: column.field }, self.cell(row, column));
        })));
      });
      return h('div', { class: 'kit-table-wrap' }, [h('table', { class: 'kit-table' }, [
        h('caption', { class: 'kit-sr' }, this.caption || this.copy('captionFallback')),
        h('thead', [h('tr', this.columns.map(function (column) {
          return h('th', { key: column.field, scope: 'col' }, column.label || column.field);
        }))]), h('tbody', body)
      ])]);
    }
  };
  var KitField = {
    name: 'ItsmField',
    props: {
      label: { type: String, required: true },
      modelValue: { type: [String, Number], default: '' },
      type: { type: String, default: 'text' },
      multiline: { type: Boolean, default: false },
      required: { type: Boolean, default: false },
      hint: { type: String, default: '' },
      error: { type: String, default: '' }
    },
    emits: ['update:modelValue'],
    data: function () { fieldSequence += 1; return { controlId: 'kit-field-' + fieldSequence }; },
    computed: {
      invalid: function () { return this.error ? 'true' : null; },
      errorId: function () { return this.controlId + '-error'; },
      hintId: function () { return this.controlId + '-hint'; },
      describedBy: function () { return this.error ? this.errorId : (this.hint ? this.hintId : null); }
    },
    methods: {
      onInput: function (event) { this.$emit('update:modelValue', event.target.value); }
    },
    render: function () {
      var h = Vue.h;
      var control = { id: this.controlId, value: this.modelValue, required: this.required,
        'aria-invalid': this.invalid, 'aria-describedby': this.describedBy, onInput: this.onInput };
      if (!this.multiline) control.type = this.type;
      return h('div', { class: 'kit-field' }, [
        h('label', { for: this.controlId }, [this.label, this.required ? h('span', { 'aria-hidden': 'true' }, ' *') : null]),
        h(this.multiline ? 'textarea' : 'input', control),
        this.error ? h('p', { id: this.errorId, class: 'kit-field__error', role: 'alert' }, this.error)
          : (this.hint ? h('p', { id: this.hintId, class: 'kit-field__hint' }, this.hint) : null)
      ]);
    }
  };
  var KitStatus = {
    name: 'ItsmStatus',
    props: { label: { type: String, default: '—' }, tone: { type: String, default: 'hold' } },
    render: function () { return Vue.h('span', { class: 'kit-status kit-status--' + this.tone }, this.label); }
  };
  var KitButton = {
    name: 'ItsmButton',
    props: {
      label: { type: String, default: '' },
      variant: { type: String, default: 'primary' },
      type: { type: String, default: 'button' },
      disabled: { type: Boolean, default: false }
    },
    emits: ['click'],
    computed: {
      classes: function () { return this.variant === 'secondary' ? 'kit-btn kit-btn--secondary' : 'kit-btn'; }
    },
    render: function () {
      var self = this;
      return Vue.h('button', { type: this.type, class: this.classes, disabled: this.disabled,
        onClick: function () { self.$emit('click'); } }, this.$slots.default ? this.$slots.default() : this.label);
    }
  };
  // Inspect only Vue component option edges inside the sandbox, never module code in the host.
  function unsupportedComponent(components) {
    var seen = new Set();
    function inspect(component, name, requireRender) {
      if (!component || (typeof component !== 'object' && typeof component !== 'function')) return name;
      if (component.template !== undefined || (requireRender && typeof component !== 'function' && typeof component.render !== 'function')) return name;
      if (seen.has(component)) return '';
      seen.add(component);
      var local = component.components || {};
      var names = Object.keys(local);
      for (var i = 0; i < names.length; i += 1) {
        var invalid = inspect(local[names[i]], name + '.' + names[i], true);
        if (invalid) return invalid;
      }
      if (component.extends) {
        var inherited = inspect(component.extends, name + '.extends', false);
        if (inherited) return inherited;
      }
      var mixins = component.mixins || [];
      for (var j = 0; j < mixins.length; j += 1) {
        var mixed = inspect(mixins[j], name + '.mixins[' + j + ']', false);
        if (mixed) return mixed;
      }
      return '';
    }
    var names = Object.keys(components);
    for (var i = 0; i < names.length; i += 1) {
      var invalid = inspect(components[names[i]], names[i], true);
      if (invalid) return invalid;
    }
    return '';
  }
  function boot(init) {
    if (booted) return;
    booted = true;
    applyLocale(init);
    applyTheme(init.theme);
    var components = (definition && definition.components) || {};
    var component = components[init.component];
    var root = document.getElementById('root');
    if (!component) {
      root.innerHTML = '<div class="kit-error" role="alert"><strong>' + escapeText(t('missingComponent')) + '</strong><p>' + escapeText(t('missingComponentName', { component: String(init.component || '') })) + '</p></div>';
      return;
    }
    var unsupported = unsupportedComponent(components);
    if (unsupported) {
      root.innerHTML = '<div class="kit-error" role="alert">' + escapeText(t('renderRequired', { component: unsupported })) + '</div>';
      reportHeight();
      return;
    }
    var sdk = {
      id: init.extensionId,
      assetId: init.assetId || null,
      request: request,
      navigate: navigate,
      can: function (permission) {
        return Array.isArray(init.permissions) && init.permissions.indexOf(permission) !== -1;
      }
    };
    var app = Vue.createApp({
      render: function () {
        return Vue.h(component, { sdk: sdk, assetId: init.assetId || null, permissions: init.permissions });
      }
    });
    app.component('ItsmTable', KitTable);
    app.component('ItsmField', KitField);
    app.component('ItsmStatus', KitStatus);
    app.component('ItsmButton', KitButton);
    app.mount(root);
    reportHeight();
    if (window.ResizeObserver) {
      new window.ResizeObserver(function () { reportHeight(); }).observe(document.documentElement);
    }
  }
  function reportHeight() {
    var height = Math.ceil(document.documentElement.getBoundingClientRect().height + 2);
    if (height > 0) post({ type: 'itsm:resize', height: height });
  }
  window.ITSMExtension = {
    register: function (registered) {
      if (!registered || typeof registered !== 'object' || !registered.components || typeof registered.components !== 'object') {
        throw new Error(t('registerRequired'));
      }
      definition = registered;
    }
  };
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || event.origin !== HOST_ORIGIN) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
    if (data.type === 'itsm:init') {
      if (booted) applyLocale(data);
      else boot(data);
      return;
    }
    if (data.type === 'itsm:theme') { applyTheme(data.theme); return; }
    if (data.type === 'itsm:response') {
      var entry = pending[data.id];
      if (!entry) return;
      delete pending[data.id];
      if (data.ok === true) entry.resolve(data.data);
      else entry.reject(new Error(typeof data.error === 'string' && data.error ? data.error : t('requestFailed')));
    }
  });
  post({ type: 'itsm:ready' });
})();`;
  }

  function buildDocument(options) {
    const source = options || {};
    const theme = isPlainObject(source.theme) ? source.theme : DEFAULT_THEME;
    return [
      '<!DOCTYPE html>',
      '<html lang="' + escapeHtml(activeLocale()) + '">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="referrer" content="no-referrer">',
      '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">',
      '<!-- sandbox-document -->',
      '<title>' + escapeHtml(text(source.title) || tr('ui.extensions.frame.document_title')) + '</title>',
      '<style>:root{' + themeCss(theme) + '}' + KIT_STYLE + '</style>',
      '</head>',
      '<body><div id="root" class="kit-frame"></div>',
      '<script>' + inlineScript(source.vueSource) + '</script>',
      '<script>' + inlineScript(kitSource(
        source.origin || (typeof window !== 'undefined' ? window.location.origin : ''),
        { locale: activeLocale(), messages: isPlainObject(source.messages) ? source.messages : frameMessages() }
      )) + '</script>',
      '<script>' + inlineScript(source.moduleSource) + '</script>',
      '</body>',
      '</html>'
    ].join('\n');
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function validatedFrontendUrl(raw, expected) {
    if (typeof raw !== 'string' || !raw) throw new Error(tr('ui.extensions.frame.error_module_invalid'));
    const binding = isPlainObject(expected) ? expected : {};
    const expectedId = text(binding.id);
    const expectedDigest = text(binding.digest);
    if (!expectedId || !DIGEST_RE.test(expectedDigest)) throw new Error(tr('ui.extensions.frame.error_binding_unapproved'));
    let parsed;
    try {
      parsed = new URL(raw, window.location.origin);
    } catch (_) {
      throw new Error(tr('ui.extensions.frame.error_path_invalid'));
    }
    if (parsed.origin !== window.location.origin) throw new Error(tr('ui.extensions.frame.error_origin_mismatch'));
    const pathMatch = FRONTEND_PATH_RE.exec(parsed.pathname);
    if (!pathMatch) throw new Error(tr('ui.extensions.frame.error_path_not_declared'));
    if (pathMatch[1] !== expectedId) throw new Error(tr('ui.extensions.frame.error_path_extension_mismatch'));
    const digest = parsed.searchParams.get('digest') || '';
    if (!DIGEST_RE.test(digest)) throw new Error(tr('ui.extensions.frame.error_digest_invalid'));
    if (digest !== expectedDigest) throw new Error(tr('ui.extensions.frame.error_digest_mismatch'));
    return parsed.href;
  }

  async function fetchTextDefault(url, limit) {
    const response = await window.fetch(url, { credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    if (!response || !response.ok) throw new Error(tr('ui.extensions.frame.error_resource_unavailable'));
    const body = await response.text();
    if (typeof body !== 'string' || body.length > limit) throw new Error(tr('ui.extensions.frame.error_resource_too_large'));
    return body;
  }

  async function loadSources(options) {
    const source = options || {};
    const moduleUrl = validatedFrontendUrl(source.frontendUrl, { id: source.extensionId, digest: source.digest });
    const fetchText = typeof source.fetchText === 'function'
      ? source.fetchText
      : (url, limit) => fetchTextDefault(url, limit);
    const vueSource = await fetchText(VUE_PATH, VUE_LIMIT);
    const moduleSource = await fetchText(moduleUrl, MODULE_LIMIT);
    if (typeof vueSource !== 'string' || !vueSource) throw new Error(tr('ui.extensions.frame.error_engine_unavailable'));
    if (typeof moduleSource !== 'string' || !moduleSource) throw new Error(tr('ui.extensions.frame.error_module_empty'));
    return { vueSource, moduleSource, frontendUrl: moduleUrl };
  }

  function clampHeight(value) {
    const height = Math.round(Number(value));
    if (!Number.isFinite(height)) return null;
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height));
  }

  function messageError(error) {
    const message = error && typeof error.message === 'string' && error.message
      ? error.message
      : tr('ui.extensions.frame.error_operation_failed');
    return message.replace(/\s+/g, ' ').slice(0, 300);
  }

  function bridge(options) {
    const config = options || {};
    const frame = config.frame;
    if (!frame) throw new Error(tr('ui.extensions.frame.error_frame_required'));
    const item = config.item || {};
    const operations = new Set((item.operations || []).map((operation) => operation && operation.name).filter(Boolean));
    const pages = new Set((item.pages || []).map((page) => page && page.id).filter(Boolean));
    // Only the asset identifier travels to the frame. The record itself is
    // fetched by the module through its own declared, permission-checked
    // operations, so a document that replaces this one learns nothing.
    const assetId = text(config.assetId) || text(config.asset && config.asset.id);
    const state = { ready: false, disposed: false, pending: new Map(), guest: null, loads: 0 };
    let unsubscribe = null;

    function contentWindow() {
      try {
        return frame.contentWindow || null;
      } catch (_) {
        return null;
      }
    }

    function post(payload) {
      if (state.disposed) return false;
      const target = contentWindow();
      if (!target || typeof target.postMessage !== 'function') return false;
      // Payloads are addressed to the guest window accepted at readiness. A
      // replaced window is a navigated frame: stop instead of posting to it.
      if (state.guest !== null && target !== state.guest) return terminate();
      try {
        target.postMessage(payload, '*');
        return true;
      } catch (_) {
        return false;
      }
    }

    // A frame that navigates away is terminal: the host stops answering so a
    // foreign document never receives another payload or operation result.
    function terminate() {
      if (state.disposed) return false;
      state.disposed = true;
      state.pending.clear();
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (typeof config.onTerminated === 'function') {
        try {
          config.onTerminated();
        } catch (_) {
          /* the host can still dispose the frame */
        }
      }
      return false;
    }

    function initPayload() {
      return {
        type: 'itsm:init',
        extensionId: text(item.id),
        component: text(config.component),
        assetId,
        permissions: Array.isArray(config.permissions) ? config.permissions.slice(0, 60) : [],
        locale: activeLocale(),
        messages: frameMessages(),
        theme: typeof config.getTheme === 'function' ? config.getTheme() : {}
      };
    }

    function themePayload() {
      return { type: 'itsm:theme', theme: typeof config.getTheme === 'function' ? config.getTheme() : {} };
    }

    function onRequest(data) {
      const id = data.id;
      const validId = (typeof id === 'string' && REQUEST_ID_RE.test(id)) || (Number.isInteger(id) && id >= 0);
      if (!validId) return false;
      if (typeof data.operation !== 'string' || !operations.has(data.operation)) return false;
      if (data.args !== undefined && data.args !== null && !isPlainObject(data.args)) return false;
      if (state.pending.size >= MAX_IN_FLIGHT) {
        post({ type: 'itsm:response', id, ok: false, error: tr('ui.extensions.frame.error_too_many_requests') });
        return false;
      }
      if (!config.sdk || typeof config.sdk.request !== 'function') {
        post({ type: 'itsm:response', id, ok: false, error: tr('ui.extensions.frame.error_extension_inactive') });
        return false;
      }
      const args = data.args === undefined || data.args === null ? {} : data.args;
      state.pending.set(id, true);
      let pendingRequest;
      try {
        pendingRequest = Promise.resolve(config.sdk.request(data.operation, args));
      } catch (error) {
        pendingRequest = Promise.reject(error);
      }
      pendingRequest
        .then((result) => ({ ok: true, data: result === undefined ? null : result }))
        .catch((error) => ({ ok: false, error: messageError(error) }))
        .then((outcome) => {
          state.pending.delete(id);
          if (state.disposed) return;
          post(Object.assign({ type: 'itsm:response', id }, outcome));
        });
      return true;
    }

    function onNavigate(data) {
      if (typeof data.page !== 'string' || !data.page || data.page.length > 200) return false;
      if (pages.has(data.page) || data.page.startsWith('#/')) {
        try {
          return typeof config.navigate === 'function' && config.navigate(data.page) !== false;
        } catch (_) {
          return false;
        }
      }
      return false;
    }

    function onResize(data) {
      const height = clampHeight(data.height);
      if (height === null) return false;
      if (typeof config.onHeight === 'function') config.onHeight(height);
      return true;
    }

    function handleMessage(event) {
      if (state.disposed || !event) return false;
      const source = contentWindow();
      if (!source || event.source !== source) return false;
      if (state.guest !== null && (event.source !== state.guest || source !== state.guest)) return terminate();
      const data = event.data;
      if (!isPlainObject(data) || typeof data.type !== 'string') return false;
      if (data.type === 'itsm:ready') {
        if (state.ready) return false;
        state.ready = true;
        state.guest = source;
        post(initPayload());
        post(themePayload());
        // The frame has no i18n instance of its own: refresh its copy whenever
        // the host switches language, not only when the frame is first opened.
        const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
        if (!unsubscribe && runtime && typeof runtime.subscribe === 'function') {
          unsubscribe = runtime.subscribe(() => {
            if (state.disposed || !state.ready) return;
            post(initPayload());
          });
        }
        return true;
      }
      if (!state.ready) return false;
      if (data.type === 'itsm:request') return onRequest(data);
      if (data.type === 'itsm:navigate') return onNavigate(data);
      if (data.type === 'itsm:resize') return onResize(data);
      return false;
    }

    // The host calls this on every iframe `load` event. The first load raised
    // after readiness is the srcdoc document the host itself created; any later
    // load means the module moved the frame to another document.
    function frameLoaded() {
      if (state.disposed) return false;
      state.loads += 1;
      if (state.loads === 1) return true;
      return terminate();
    }

    return {
      frame,
      item,
      state,
      get sdk() { return config.sdk; },
      set sdk(value) { config.sdk = value; },
      handleMessage,
      frameLoaded,
      sendTheme() {
        if (state.disposed) return false;
        return post(themePayload());
      },
      sendInit() {
        if (state.disposed) return false;
        return post(initPayload());
      },
      dispose() {
        state.disposed = true;
        state.pending.clear();
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      }
    };
  }

  window.ExtensionFrame = {
    SANDBOX,
    CSP,
    VUE_PATH,
    MAX_IN_FLIGHT,
    MIN_HEIGHT,
    MAX_HEIGHT,
    DEFAULT_THEME,
    themeTokens,
    themeCss,
    inlineScript,
    buildDocument,
    validatedFrontendUrl,
    loadSources,
    frameMessages,
    bridge
  };
})();
