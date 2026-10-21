/* Focused conversational surface for the inventory agent.
 *
 * The browser only transports the message, the previous turns and an explicitly
 * selected permanent asset id. Missing data, approvals, parsing and
 * authorization stay on the server; no business operation is inferred here and
 * nothing is rendered as raw HTML.
 */
(function () {
  'use strict';

  // Backend bound for `conversation`; the extra message cap is a UI guard so an
  // accidental paste never becomes a multi-megabyte request.
  const MAX_TURNS = 20;
  const MAX_MESSAGE = 2000;
  const UNAVAILABLE = 'El agente no está disponible: el servidor no tiene un modelo configurado.';
  const EXPIRED = 'La sesión no está disponible. Inicia sesión de nuevo.';
  const MAX_MESSAGE_ERROR = 'El mensaje supera los ' + MAX_MESSAGE + ' caracteres.';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const ACTION_LABELS = {
    completed: 'Completada',
    failed: 'Fallida',
    denied: 'Denegada'
  };

  const ACTION_TONES = {
    completed: 'ok',
    failed: 'down',
    denied: 'warn'
  };

  const STATUS_LABELS = {
    in_use: 'Asignado',
    in_storage: 'En resguardo',
    maintenance: 'Mantenimiento',
    retired: 'Dado de baja'
  };

  function isPermanentId(value) {
    return typeof value === 'string' && UUID_RE.test(value);
  }

  window.AssetConversation = {
    name: 'AssetConversation',
    props: {
      app: { type: Object, required: true }
    },
    data() {
      return {
        messages: [],
        draft: '',
        busy: false,
        error: '',
        actions: [],
        results: [],
        selectedAssetId: '',
        requestId: 0,
        request: null,
        disposed: false
      };
    },
    computed: {
      authenticated() {
        return !!this.app.authenticated;
      },
      maxMessageLength() {
        return MAX_MESSAGE;
      },
      canSend() {
        return !this.busy && this.draft.trim().length > 0;
      },
      hasMessages() {
        return this.messages.length > 0;
      },
      routeAssetId() {
        const route = this.app.route;
        return route && route.name === 'conversation' && isPermanentId(route.assetId) ? route.assetId : '';
      },
      /* Only assets the server already returned in this session can be attached;
       * typed or demo ids are never accepted as context. */
      assetContextOptions() {
        const items = (this.app.inventory && Array.isArray(this.app.inventory.items)) ? this.app.inventory.items : [];
        const detail = this.app.inventoryDetail && this.app.inventoryDetail.asset;
        const seen = {};
        const options = [];
        items.concat(detail ? [detail] : []).forEach((asset) => {
          if (!asset || asset.serverAsset !== true || !isPermanentId(asset.id) || seen[asset.id]) return;
          seen[asset.id] = true;
          options.push({ id: asset.id, name: asset.name || asset.quickCode || asset.id, quickCode: asset.quickCode || '' });
        });
        return options;
      }
    },
    watch: {
      authenticated(value) {
        if (!value) this.resetSurface();
      },
      routeAssetId(value) {
        if (value) this.selectedAssetId = value;
      }
    },
    created() {
      if (this.routeAssetId) this.selectedAssetId = this.routeAssetId;
    },
    beforeUnmount() {
      this.disposed = true;
      this.cancelRequest();
    },
    methods: {
      history() {
        return this.messages
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .slice(-MAX_TURNS)
          .map((message) => ({ role: message.role, content: message.content }));
      },
      cancelRequest() {
        this.requestId += 1;
        if (this.request) {
          this.request.abort();
          this.request = null;
        }
        this.busy = false;
      },
      resetSurface() {
        this.cancelRequest();
        this.messages = [];
        this.draft = '';
        this.error = '';
        this.actions = [];
        this.results = [];
        this.selectedAssetId = '';
      },
      contextAssetId() {
        const id = this.selectedAssetId;
        if (!isPermanentId(id)) return '';
        const known = this.routeAssetId === id || this.assetContextOptions.some((asset) => asset.id === id);
        return known ? id : '';
      },
      async send() {
        const message = this.draft.trim();
        if (!message || this.busy || this.disposed) return false;
        if (!this.app.authenticated) {
          this.error = EXPIRED;
          return false;
        }
        if (message.length > MAX_MESSAGE) {
          this.error = MAX_MESSAGE_ERROR;
          return false;
        }
        const conversation = this.history();
        const assetId = this.contextAssetId();
        const body = { message, conversation };
        if (assetId) body.assetId = assetId;
        this.messages.push({ role: 'user', content: message });
        this.draft = '';
        this.busy = true;
        this.error = '';
        this.actions = [];
        this.results = [];
        const requestId = this.requestId + 1;
        this.requestId = requestId;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        this.request = controller;
        try {
          const payload = await window.AssetAccess.request(this.app, '/agent/chat', {
            method: 'POST',
            body,
            signal: controller ? controller.signal : undefined
          });
          if (requestId !== this.requestId || this.disposed) return false;
          const reply = payload && typeof payload.message === 'string' ? payload.message.trim() : '';
          if (reply) this.messages.push({ role: 'assistant', content: reply });
          this.actions = (Array.isArray(payload && payload.actions) ? payload.actions : [])
            .filter((action) => action && typeof action === 'object')
            .map((action) => ({
              tool: typeof action.tool === 'string' ? action.tool : '',
              status: typeof action.status === 'string' ? action.status : '',
              assetIds: Array.isArray(action.assetIds) ? action.assetIds : [],
              tone: ACTION_TONES[action.status] || 'hold'
            }));
          this.results = (Array.isArray(payload && payload.results) ? payload.results : [])
            .filter((asset) => asset && typeof asset.id === 'string' && asset.id);
          return true;
        } catch (error) {
          if (requestId !== this.requestId || this.disposed) return false;
          if (error && error.status === 503) this.error = UNAVAILABLE;
          else if (error && error.status === 401) this.error = EXPIRED;
          else this.error = (error && error.message) || 'No se pudo enviar el mensaje al agente.';
          return false;
        } finally {
          if (requestId === this.requestId) {
            this.busy = false;
            this.request = null;
          }
        }
      },
      actionStatusLabel(status) {
        return ACTION_LABELS[status] || 'Registrada';
      },
      assetHref(id) {
        return '#/activo/' + encodeURIComponent(id);
      },
      resultName(result) {
        return result.name || result.quickCode || result.id;
      },
      resultMeta(result) {
        const parts = [];
        if (result.quickCode) parts.push(result.quickCode);
        if (result.category) parts.push(result.category);
        if (result.site) parts.push(result.site);
        return parts.join(' · ');
      },
      resultStatus(result) {
        return STATUS_LABELS[result.status] || 'Sin estado';
      }
    },
    template: [
      '<section class="conversation" aria-labelledby="conversation-title">',
      '  <header class="page-head conversation__head">',
      '    <div>',
      '      <p class="eyebrow">Asistente de inventario</p>',
      '      <h1 id="conversation-title">Conversación</h1>',
      '      <p class="page-sub">Consulta o cambia activos del inventario. El servidor decide qué operaciones ejecutar y pide los datos que falten.</p>',
      '    </div>',
      '  </header>',
      '  <div class="conversation__log" role="log" aria-live="polite" aria-relevant="additions text">',
      '    <p v-if="!hasMessages && !busy" class="conversation__empty">Todavía no hay mensajes. Escribe una consulta para empezar.</p>',
      '    <article v-for="(message, index) in messages" :key="index" class="conversation__turn" :class="\'conversation__turn--\' + message.role">',
      '      <p class="conversation__role">{{ message.role === \'user\' ? \'Tú\' : \'Agente\' }}</p>',
      '      <p class="conversation__text">{{ message.content }}</p>',
      '    </article>',
      '    <p v-if="busy" class="conversation__pending" role="status">Esperando la respuesta del agente…</p>',
      '  </div>',
      '  <p v-if="error" class="conversation__error" role="alert">{{ error }}</p>',
      '  <section v-if="actions.length" class="conversation__section" aria-labelledby="conversation-actions">',
      '    <h2 id="conversation-actions" class="conversation__heading">Acciones ejecutadas</h2>',
      '    <ul class="conversation__actions">',
      '      <li v-for="(action, index) in actions" :key="index" class="conversation__action">',
      '        <span class="conversation__action-tool">{{ action.tool }}</span>',
      '        <span class="status-pill" :class="\'status--\' + action.tone">{{ actionStatusLabel(action.status) }}</span>',
      '      </li>',
      '    </ul>',
      '  </section>',
      '  <section v-if="results.length" class="conversation__section" aria-labelledby="conversation-results">',
      '    <h2 id="conversation-results" class="conversation__heading">Activos mencionados</h2>',
      '    <ul class="conversation__results">',
      '      <li v-for="result in results" :key="result.id" class="conversation__result">',
      '        <a class="conversation__result-link" :href="assetHref(result.id)">{{ resultName(result) }}</a>',
      '        <span class="conversation__meta">{{ resultMeta(result) }}</span>',
      '        <span class="conversation__meta">{{ resultStatus(result) }}</span>',
      '      </li>',
      '    </ul>',
      '  </section>',
      '  <div v-if="assetContextOptions.length" class="conversation__context">',
      '    <label class="conversation__label" for="conversation-asset">Activo en contexto (opcional)</label>',
      '    <select id="conversation-asset" v-model="selectedAssetId" :disabled="busy" class="conversation__select">',
      '      <option value="">Sin activo seleccionado</option>',
      '      <option v-for="asset in assetContextOptions" :key="asset.id" :value="asset.id">{{ asset.name }}<template v-if="asset.quickCode"> · {{ asset.quickCode }}</template></option>',
      '    </select>',
      '    <p class="conversation__help">Se envía solo el identificador permanente del activo que elijas de la lista.</p>',
      '  </div>',
      '  <form class="conversation__form" @submit.prevent="send">',
      '    <label class="conversation__label" for="conversation-input">Mensaje</label>',
      '    <textarea id="conversation-input" v-model="draft" rows="2" :maxlength="maxMessageLength" :disabled="busy" aria-describedby="conversation-help" placeholder="Ej.: Muéstrame los servidores de Matriz"></textarea>',
      '    <p id="conversation-help" class="conversation__help">El agente pide los datos que falten antes de cambiar un activo.</p>',
      '    <button type="submit" class="btn btn--primary" :disabled="!canSend">{{ busy ? \'Enviando…\' : \'Enviar\' }}</button>',
      '  </form>',
      '</section>'
    ].join('\n')
  };
})();
