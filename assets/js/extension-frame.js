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

  function kitSource(origin) {
    const hostOrigin = JSON.stringify(text(origin) || 'null');
    return `(function () {
  'use strict';
  var HOST_ORIGIN = ${hostOrigin};
  var definition = null;
  var booted = false;
  var sequence = 0;
  var fieldSequence = 0;
  var pending = {};
  function post(message) {
    try { window.parent.postMessage(message, HOST_ORIGIN); } catch (_) { /* the frame is detached */ }
  }
  function request(operation, args) {
    if (typeof operation !== 'string' || !operation) return Promise.reject(new Error('La operación no es válida.'));
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
      empty: { type: String, default: 'Sin datos.' },
      loading: { type: Boolean, default: false }
    },
    methods: {
      cell: function (row, column) {
        var value = row ? row[column.field] : '';
        if (value === null || value === undefined || value === '') return '—';
        if (typeof value === 'boolean') return value ? 'Sí' : 'No';
        if (typeof value === 'object') return '—';
        return String(value);
      }
    },
    template: '<div class="kit-table-wrap"><table class="kit-table"><caption class="kit-sr">{{ caption || "Datos de la extensión" }}</caption><thead><tr><th v-for="column in columns" :key="column.field" scope="col">{{ column.label || column.field }}</th></tr></thead><tbody><tr v-if="loading"><td :colspan="columns.length || 1" class="kit-empty" role="status">Cargando datos…</td></tr><tr v-else-if="!rows.length"><td :colspan="columns.length || 1" class="kit-empty">{{ empty }}</td></tr><tr v-for="(row, index) in rows" :key="row.id || index"><td v-for="column in columns" :key="column.field">{{ cell(row, column) }}</td></tr></tbody></table></div>'
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
    template: '<div class="kit-field"><label :for="controlId">{{ label }}<span v-if="required" aria-hidden="true"> *</span></label><textarea v-if="multiline" :id="controlId" :value="modelValue" :required="required" :aria-invalid="invalid" :aria-describedby="describedBy" @input="onInput"></textarea><input v-else :id="controlId" :type="type" :value="modelValue" :required="required" :aria-invalid="invalid" :aria-describedby="describedBy" @input="onInput"><p v-if="error" :id="errorId" class="kit-field__error" role="alert">{{ error }}</p><p v-else-if="hint" :id="hintId" class="kit-field__hint">{{ hint }}</p></div>'
  };
  var KitStatus = {
    name: 'ItsmStatus',
    props: { label: { type: String, default: '—' }, tone: { type: String, default: 'hold' } },
    template: '<span class="kit-status" :class="&quot;kit-status--&quot; + tone">{{ label }}</span>'
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
    template: '<button :type="type" :class="classes" :disabled="disabled" @click="$emit(\\'click\\')"><slot>{{ label }}</slot></button>'
  };
  function boot(init) {
    if (booted) return;
    booted = true;
    applyTheme(init.theme);
    var components = (definition && definition.components) || {};
    var component = components[init.component];
    var root = document.getElementById('root');
    if (!component) {
      root.innerHTML = '<div class="kit-error" role="alert"><strong>El módulo no registró el componente solicitado.</strong><p>Falta ' + String(init.component).replace(/[<>&"]/g, '') + '.</p></div>';
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
        throw new Error('El módulo debe registrar componentes con window.ITSMExtension.register({components}).');
      }
      definition = registered;
    }
  };
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || event.origin !== HOST_ORIGIN) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
    if (data.type === 'itsm:init') { boot(data); return; }
    if (data.type === 'itsm:theme') { applyTheme(data.theme); return; }
    if (data.type === 'itsm:response') {
      var entry = pending[data.id];
      if (!entry) return;
      delete pending[data.id];
      if (data.ok === true) entry.resolve(data.data);
      else entry.reject(new Error(typeof data.error === 'string' && data.error ? data.error : 'La operación falló en el servidor.'));
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
      '<html lang="es">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="referrer" content="no-referrer">',
      '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">',
      '<!-- sandbox-document -->',
      '<title>' + escapeHtml(text(source.title) || 'Extensión aislada') + '</title>',
      '<style>:root{' + themeCss(theme) + '}' + KIT_STYLE + '</style>',
      '</head>',
      '<body><div id="root" class="kit-frame"></div>',
      '<script>' + inlineScript(source.vueSource) + '</script>',
      '<script>' + inlineScript(kitSource(source.origin || (typeof window !== 'undefined' ? window.location.origin : ''))) + '</script>',
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
    if (typeof raw !== 'string' || !raw) throw new Error('La extensión no publica un módulo de frontend válido.');
    const binding = isPlainObject(expected) ? expected : {};
    const expectedId = text(binding.id);
    const expectedDigest = text(binding.digest);
    if (!expectedId || !DIGEST_RE.test(expectedDigest)) throw new Error('La ruta del módulo de frontend no está ligada a una extensión aprobada.');
    let parsed;
    try {
      parsed = new URL(raw, window.location.origin);
    } catch (_) {
      throw new Error('La ruta del módulo de frontend no es válida.');
    }
    if (parsed.origin !== window.location.origin) throw new Error('El módulo de frontend debe servirse desde la misma origen del host.');
    const pathMatch = FRONTEND_PATH_RE.exec(parsed.pathname);
    if (!pathMatch) throw new Error('La ruta del módulo de frontend no es la declarada por el host.');
    if (pathMatch[1] !== expectedId) throw new Error('La ruta del módulo de frontend no corresponde a esta extensión.');
    const digest = parsed.searchParams.get('digest') || '';
    if (!DIGEST_RE.test(digest)) throw new Error('La firma digest del módulo de frontend no es válida.');
    if (digest !== expectedDigest) throw new Error('La firma digest del módulo de frontend no corresponde a esta extensión.');
    return parsed.href;
  }

  async function fetchTextDefault(url, limit) {
    const response = await window.fetch(url, { credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    if (!response || !response.ok) throw new Error('El host no pudo cargar el recurso de la extensión.');
    const body = await response.text();
    if (typeof body !== 'string' || body.length > limit) throw new Error('El recurso de la extensión supera el tamaño permitido.');
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
    if (typeof vueSource !== 'string' || !vueSource) throw new Error('El host no pudo cargar el motor de vistas aislado.');
    if (typeof moduleSource !== 'string' || !moduleSource) throw new Error('El módulo de frontend de la extensión está vacío.');
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
      : 'La operación de la extensión falló.';
    return message.replace(/\s+/g, ' ').slice(0, 300);
  }

  function bridge(options) {
    const config = options || {};
    const frame = config.frame;
    if (!frame) throw new Error('El host necesita el marco aislado para conectar la extensión.');
    const item = config.item || {};
    const operations = new Set((item.operations || []).map((operation) => operation && operation.name).filter(Boolean));
    const pages = new Set((item.pages || []).map((page) => page && page.id).filter(Boolean));
    // Only the asset identifier travels to the frame. The record itself is
    // fetched by the module through its own declared, permission-checked
    // operations, so a document that replaces this one learns nothing.
    const assetId = text(config.assetId) || text(config.asset && config.asset.id);
    const state = { ready: false, disposed: false, pending: new Map(), guest: null, loads: 0 };

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
        post({ type: 'itsm:response', id, ok: false, error: 'Hay demasiadas solicitudes en curso.' });
        return false;
      }
      if (!config.sdk || typeof config.sdk.request !== 'function') {
        post({ type: 'itsm:response', id, ok: false, error: 'La extensión ya no está activa.' });
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
      if (pages.has(data.page) || /^#\/[A-Za-z0-9/_?=-]*$/.test(data.page)) {
        try {
          if (typeof config.navigate === 'function') config.navigate(data.page);
          return true;
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
        return true;
      }
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
    bridge
  };
})();
