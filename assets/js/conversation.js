/* Focused conversational surface for the inventory agent.
 *
 * The browser only transports the message, the previous turns (bounded), the
 * chosen engine/model and an explicitly selected permanent asset id. Provider
 * URLs and credentials stay on the server; streaming frames are parsed but no
 * business operation is inferred here.
 *
 * Agent copy is the one exception to plain-text rendering: it goes through
 * window.ChatMarkdown, an escape-first renderer owned by chat-markdown.js, and
 * only its output binds to v-html. User messages stay plain text, and when the
 * renderer is absent every message falls back to escaped text with no markup.
 */
(function () {
  'use strict';

  // Backend bound for `conversation`; the extra message cap is a UI guard so an
  // accidental paste never becomes a multi-megabyte request.
  const MAX_TURNS = 20;
  const MAX_MESSAGE = 2000;
  // Server bounds for chat attachments: the browser mirrors them as an early
  // guard, while the API keeps the final word on size, type and count.
  const MAX_ATTACHMENTS = 4;
  const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
  const MAX_SESSION_ATTACHMENTS = 20;
  // Canvas routes own their own floating controls; the chat button never
  // paints over them.
  const CANVAS_ROUTES = ['graph', 'map'];
  const IMAGE_NAME_RE = /\.(png|jpe?g|webp|gif)$/i;
  const PDF_NAME_RE = /\.pdf$/i;
  const TEXT_NAME_RE = /\.(txt|csv)$/i;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Visible copy resolves through the shipped runtime so a language switch
  // re-renders the surface without losing the conversation state. The module
  // stays loadable without it (isolated tests), where a key renders empty.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  // Pipe-form plurals: vue-i18n picks the form from the numeric choice.
  function trPlural(key, count) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, { count: count }, { plural: count }) : '';
  }

  // Escape-first fallback for agent copy: used only when the markdown renderer
  // is not on the page, so no message text can ever become markup on its own.
  const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeMarkup(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/[&<>"']/g, character => HTML_ENTITIES[character]);
  }

  // Stable status ids map to literal catalog keys; a key is never built from
  // data at runtime.
  const ATTACHMENT_KIND_KEYS = {
    image: 'ui.chat.kind_image',
    file: 'ui.chat.kind_file',
    text: 'ui.chat.kind_text'
  };

  const ACTION_STATUS_KEYS = {
    completed: 'ui.chat.status_completed',
    failed: 'ui.chat.status_failed',
    denied: 'ui.chat.status_denied'
  };

  const TOOL_STATUS_KEYS = {
    running: 'ui.chat.status_running',
    pending: 'ui.chat.status_running',
    completed: 'ui.chat.status_completed',
    failed: 'ui.chat.status_failed',
    denied: 'ui.chat.status_denied'
  };

  const ASSET_STATUS_KEYS = {
    in_use: 'ui.chat.status_in_use',
    in_storage: 'ui.chat.status_in_storage',
    maintenance: 'ui.chat.status_maintenance',
    retired: 'ui.chat.status_retired'
  };

  const ACTION_TONES = {
    completed: 'ok',
    failed: 'down',
    denied: 'warn'
  };

  const TOOL_TONES = {
    running: 'hold',
    pending: 'hold',
    completed: 'ok',
    failed: 'down',
    denied: 'warn'
  };

  function isPermanentId(value) {
    return typeof value === 'string' && UUID_RE.test(value);
  }

  // The server owns the real file name; the browser only displays its base
  // name so a stored path or control character never reaches the transcript.
  function safeFilename(value) {
    const raw = typeof value === 'string' ? value : '';
    const base = raw.split(/[\\/]/).pop() || '';
    return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
  }

  function attachmentKindFor(filename) {
    const name = typeof filename === 'string' ? filename : '';
    if (IMAGE_NAME_RE.test(name)) return 'image';
    if (PDF_NAME_RE.test(name)) return 'file';
    if (TEXT_NAME_RE.test(name)) return 'text';
    return '';
  }

  function attachmentBytes(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function bytesText(size) {
    if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MiB';
    if (size >= 1024) return Math.ceil(size / 1024) + ' KiB';
    return size + ' B';
  }

  function numericOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function toolTone(status) {
    return TOOL_TONES[status] || 'hold';
  }

  const HISTORY_KEY = 'asset-manager.chat-history';
  const HISTORY_NARROW_PX = 900;
  const DAY_MS = 86400000;

  function historyStamp(session) {
    return Date.parse((session && (session.updatedAt || session.createdAt)) || '');
  }

  // Calendar buckets in local time. Same-day and future stamps count as today;
  // an unreadable stamp lands in the oldest bucket instead of disappearing.
  function historyBucket(value, now) {
    const stamp = typeof value === 'number' ? value : Date.parse(value || '');
    if (!Number.isFinite(stamp)) return 'older';
    const reference = new Date(now === undefined ? Date.now() : now);
    const startToday = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();
    const day = new Date(stamp);
    const startDay = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const days = Math.round((startToday - startDay) / DAY_MS);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days <= 7) return 'week';
    return 'older';
  }

  function groupHistory(sessions, now) {
    const order = ['today', 'yesterday', 'week', 'older'];
    const buckets = { today: [], yesterday: [], week: [], older: [] };
    (Array.isArray(sessions) ? sessions : []).forEach(function (session) {
      if (session && typeof session.id === 'string') buckets[historyBucket(historyStamp(session), now)].push(session);
    });
    order.forEach(function (key) {
      buckets[key].sort(function (a, b) { return (historyStamp(b) || 0) - (historyStamp(a) || 0); });
    });
    return order.filter(function (key) { return buckets[key].length > 0; })
      .map(function (key) { return { key: key, sessions: buckets[key] }; });
  }

  function readHistoryCollapsed() {
    try { return window.localStorage.getItem(HISTORY_KEY) === 'collapsed'; } catch (error) { return false; }
  }

  function writeHistoryCollapsed(collapsed) {
    try { window.localStorage.setItem(HISTORY_KEY, collapsed ? 'collapsed' : 'expanded'); } catch (error) { /* Preference stays in memory. */ }
  }

  window.AssetConversationHistory = { bucket: historyBucket, group: groupHistory };

  window.AssetConversation = {
    name: 'AssetConversation',
    components: { AppIcon: window.AppIcon },
    mixins: [].concat(window.AssetAgentEngineMixin ? [window.AssetAgentEngineMixin] : []),
    props: {
      app: { type: Object, required: true }
    },
    data() {
      return {
        messages: [],
        draft: '',
        copiedIndex: -1,
        busy: false,
        error: '',
        actions: [],
        results: [],
        extensionReviews: [],
        selectedAssetId: '',
        requestId: 0,
        request: null,
        disposed: false,
        epoch: 0,
        legacyFallback: false,
        sessionId: '',
        sessionInstanceId: '',
        sessionModel: '',
        sessionProviderId: '',
        managedProviderId: '',
        chatProviders: [],
        streaming: false,
        streamingIndex: -1,
        tools: [],
        usage: null,
        approvalPending: false,
        streamStatus: '',
        retryable: false,
        cancelPending: false,
        cancelReason: '',
        cancelRequested: false,
        reconnecting: false,
        panelOpen: false,
        opener: null,
        panelAnchor: '',
        lastModuleRoute: { name: 'panel' },
        savedSessions: [],
        sessionsLoading: false,
        sessionsError: '',
        historyCollapsed: readHistoryCollapsed(),
        historyOverlayOpen: false,
        historyNarrow: false,
        deleteCandidate: '',
        deletingSessionId: '',
        resuming: false,
        selecting: false,
        sessionRunning: false,
        retainedAsset: null,
        attachments: [],
        attachmentBusy: false,
        attachmentError: '',
        sessionAttachmentCount: 0,
        assetAttachments: [],
        assetAttachmentsLoading: false,
        assetAttachmentsLoaded: false,
        assetAttachmentsError: '',
        assetAttachmentsTotal: 0,
        assetAttachmentsHasMore: false,
        selectedAssetAttachmentIds: []
      };
    },
    computed: {
      authenticated() {
        return !!this.app.authenticated;
      },
      maxMessageLength() {
        return MAX_MESSAGE;
      },
      maxSessionAttachments() {
        return MAX_SESSION_ATTACHMENTS;
      },
      useAgentSessions() {
        return !this.legacyFallback && this.agentEnginesAvailable;
      },
      // Managed engines spend through the ITSM gateway, so the person may pick
      // one of their own enabled providers per conversation; an empty value
      // keeps the instance's organization provider and its daily budget.
      agentManagedActive() {
        const instance = this.agentActiveInstance;
        return !!(instance && instance.quota && instance.quota.mode === 'managed');
      },
      agentProviderOptions() {
        if (!this.agentManagedActive) return [];
        return [{ value: '', label: tr('ui.chat.provider_organization'), models: [], capabilities: {} }].concat(
          this.chatProviders.map(provider => ({
            value: provider.id,
            label: tr('ui.chat.provider_personal_label', { name: provider.name }),
            models: provider.models,
            capabilities: provider.capabilities || {}
          }))
        );
      },
      // One provider control replaces the engine, profile and provider
      // selectors. An engine choice keeps the existing instance authority; a
      // managed engine exposes its organization and personal providers here.
      chatProviderChoices() {
        const choices = [];
        const dedupe = (label) => {
          const index = label.indexOf(' · ');
          if (index < 0) return label;
          const head = label.slice(0, index);
          const tail = label.slice(index + 3);
          return tail.startsWith(head) ? tail : label;
        };
        const instances = this.agentInstanceList.filter(instance =>
          instance && typeof instance.id === 'string' && instance.id && instance.enabled !== false);
        const activeInstanceId = this.agentPreference && this.agentPreference.instanceId;
        const offered = instances
          .filter(instance => !(this.agentManagedActive && instance.id === activeInstanceId))
          .map(instance => ({
            instance,
            label: dedupe(this.agentInstanceLabel(instance))
          }));
        const labelCounts = new Map();
        for (const item of offered) labelCounts.set(item.label, (labelCounts.get(item.label) || 0) + 1);
        for (const item of offered) {
          // Only a duplicated label needs the authorized profile appended; an
          // instance whose own name already distinguishes it stays short.
          let label = item.label;
          const profile = this.agentProfileLabel(item.instance);
          if ((labelCounts.get(label) || 0) > 1 && profile && !label.includes(profile)) {
            label += ' · ' + profile;
          }
          choices.push({
            value: 'engine:' + item.instance.id,
            kind: 'engine',
            instanceId: item.instance.id,
            label
          });
        }
        for (const option of this.agentProviderOptions) {
          choices.push({
            value: 'provider:' + option.value,
            kind: 'provider',
            providerValue: option.value,
            label: option.label
          });
        }
        return choices;
      },
      chatProviderValue() {
        if (this.agentManagedActive) return 'provider:' + (this.managedProviderId || '');
        const instance = this.agentActiveInstance;
        return instance && instance.id ? 'engine:' + instance.id : '';
      },
      chatProviderDisabled() {
        return this.busy || this.selecting || this.resuming || this.sessionRunning ||
          this.hasPendingAttachments || !this.chatProviderChoices.length;
      },
      // The configuration action stays honest: the IA section is the existing
      // route that owns provider installation, not a new chat setting surface.
      canConfigureChat() {
        if (!this.authenticated) return false;
        if (this.app && typeof this.app.canConfig === 'function') return this.app.canConfig('ia');
        return false;
      },
      agentSelectedProvider() {
        if (!this.agentManagedActive || !this.managedProviderId) return null;
        return this.agentProviderOptions.find(option => option.value === this.managedProviderId) || null;
      },
      agentModels() {
        const provider = this.agentSelectedProvider;
        if (provider) {
          return provider.models.map(id => ({
            id,
            name: id,
            provider: provider.label,
            free: null,
            inputs: (provider.capabilities && provider.capabilities[id]) || { image: false, file: false }
          }));
        }
        const instance = this.agentActiveInstance;
        return instance && Array.isArray(instance.models) ? instance.models.filter(model => model && typeof model.id === 'string') : [];
      },
      /* What the selected engine and model may receive. Support is only the
       * explicit server flag: no engine name or version is guessed here, and a
       * missing flag fails closed. UTF-8 text needs the flag alone; images and
       * PDFs also need the model's own image/file mark. */
      chatAttachmentSupport() {
        const instance = this.agentActiveInstance;
        if (!this.useAgentSessions || !instance || instance.attachmentsSupported !== true) {
          return { supported: false, image: false, file: false, text: false };
        }
        const inputs = this.agentModelInputs;
        return { supported: true, image: inputs.image === true, file: inputs.file === true, text: true };
      },
      agentModelInputs() {
        const model = typeof this.agentPreference.model === 'string' ? this.agentPreference.model : '';
        if (!model) return { image: false, file: false };
        const provider = this.agentSelectedProvider;
        if (provider) {
          const mark = provider.capabilities && provider.capabilities[model];
          return { image: !!(mark && mark.image === true), file: !!(mark && mark.file === true) };
        }
        const instance = this.agentActiveInstance;
        const entry = instance && Array.isArray(instance.models)
          ? instance.models.find(candidate => candidate && candidate.id === model)
          : null;
        const inputs = entry && entry.inputs && typeof entry.inputs === 'object' ? entry.inputs : null;
        return { image: !!(inputs && inputs.image === true), file: !!(inputs && inputs.file === true) };
      },
      canAttachFiles() {
        return this.chatAttachmentSupport.supported;
      },
      attachmentAccept() {
        const support = this.chatAttachmentSupport;
        if (!support.supported) return '';
        const parts = [];
        if (support.image) parts.push('.png', '.jpg', '.jpeg', '.webp', '.gif', 'image/png', 'image/jpeg', 'image/webp', 'image/gif');
        if (support.file) parts.push('.pdf', 'application/pdf');
        parts.push('.txt', '.csv', 'text/plain', 'text/csv');
        return parts.join(',');
      },
      attachmentHelp() {
        const support = this.chatAttachmentSupport;
        if (!support.supported) return '';
        const formats = [];
        if (support.image) formats.push(tr('ui.chat.formats_images'));
        if (support.file) formats.push(tr('ui.chat.formats_pdf'));
        formats.push(tr('ui.chat.formats_text'));
        return tr('ui.chat.attachment_help', { max: MAX_ATTACHMENTS, formats: formats.join(', ') });
      },
      hasPendingAttachments() {
        return this.attachments.length > 0 || this.selectedAssetAttachmentIds.length > 0;
      },
      attachmentsFull() {
        return this.combinedAttachmentCount >= MAX_ATTACHMENTS;
      },
      combinedAttachmentCount() {
        return this.attachments.length + this.selectedAssetAttachmentIds.length;
      },
      engineReady() {
        if (this.legacyFallback) return true;
        if (!this.agentEnginesLoaded) return false;
        return !!(this.agentActiveInstance && this.agentPreference.model);
      },
      canSend() {
        const hasText = this.draft.trim().length > 0;
        const hasFiles = this.useAgentSessions && (this.attachments.length > 0 || this.selectedAssetAttachmentIds.length > 0);
        return !this.busy && !this.resuming && !this.selecting && !this.sessionRunning &&
          !this.attachmentBusy && (hasText || hasFiles) && this.engineReady;
      },
      canCancel() {
        return !!this.busy || this.sessionRunning;
      },
      canReconnect() {
        return !this.busy && !!this.sessionId && (!!this.error || this.sessionRunning);
      },
      hasMessages() {
        return this.messages.length > 0;
      },
      /* The empty conversation names the model that will answer, but only when
       * one is really selected: the generic role label is not a model name. */
      welcomeModelName() {
        const model = this.sessionModel || (this.agentPreference && this.agentPreference.model) || '';
        if (typeof model !== 'string' || !model) return '';
        const entry = this.agentModels.find((candidate) => candidate.id === model);
        return entry ? this.agentModelLabel(entry) : model;
      },
      /* Starter questions are pull, not instruction: each one fills the
       * composer and sends it through the same path a typed turn takes. */
      suggestionPrompts() {
        return [
          { id: 'servers', label: tr('ui.chat.suggestion_servers'), text: tr('ui.chat.suggestion_servers') },
          { id: 'warranties', label: tr('ui.chat.suggestion_warranties'), text: tr('ui.chat.suggestion_warranties') },
          { id: 'inventory', label: tr('ui.chat.suggestion_inventory'), text: tr('ui.chat.suggestion_inventory') }
        ];
      },
      /* Only a loaded catalog that produced no usable engine is a setup
       * problem; a failed discovery already reports itself above the log. */
      setupNoticeVisible() {
        if (this.legacyFallback || this.engineReady) return false;
        return this.agentEnginesLoaded && !this.agentEnginesError;
      },
      /* A disabled send button says why in its own description instead of
       * leaving the reason to a colour or a tooltip nobody can focus. */
      sendBlockedReason() {
        if (this.canSend) return '';
        const hasContent = this.draft.trim().length > 0 ||
          (this.useAgentSessions && (this.attachments.length > 0 || this.selectedAssetAttachmentIds.length > 0));
        if (!hasContent) return '';
        if (this.busy || this.resuming || this.selecting || this.sessionRunning || this.attachmentBusy) {
          return tr('ui.chat.reason_wait');
        }
        if (!this.engineReady) {
          return this.agentActiveInstance ? tr('ui.chat.reason_model') : tr('ui.chat.reason_engine');
        }
        return '';
      },
      /* El primer turno del usuario nombra la conversación; el listado del
       * servidor no envía títulos, así que aquí no se inventa otro dato. */
      conversationTitle() {
        const first = this.messages.find(message => message.role === 'user' &&
          typeof message.content === 'string' && message.content.trim());
        if (!first) return tr('ui.chat.session_new');
        const text = first.content.trim().replace(/\s+/g, ' ');
        return text.length > 48 ? text.slice(0, 47).trimEnd() + '…' : text;
      },
      isConversationRoute() {
        return !!(this.app.route && this.app.route.name === 'conversation');
      },
      // The full route docks the list beside the log; the compact panel and
      // narrow screens show it as an overlay that the user opens and closes.
      historyOverlay() {
        return !this.isConversationRoute || this.historyNarrow;
      },
      historyVisible() {
        return this.historyOverlay ? this.historyOverlayOpen : !this.historyCollapsed;
      },
      historyDocked() {
        return !this.legacyFallback && !this.historyOverlay && this.historyVisible;
      },
      historyBusy() {
        return this.busy || this.resuming || this.selecting || this.sessionRunning;
      },
      historyGroups() {
        return window.AssetConversationHistory.group(this.savedSessions, Date.now());
      },
      /* El mapa y el grafo son lienzos: el botón flotante se retira para no
       * tapar sus controles. La entrada de la barra sigue disponible. */
      canvasRoute() {
        return !!(this.app.route && CANVAS_ROUTES.includes(this.app.route.name));
      },
      fabVisible() {
        return this.canUseConversation && !this.isConversationRoute && !this.canvasRoute;
      },
      surfaceVisible() {
        return this.authenticated && (this.isConversationRoute || this.panelOpen);
      },
      canUseConversation() {
        return this.authenticated && !!(this.app.can && this.app.can('assets.view'));
      },
      currentContextAsset() {
        const route = this.app.route || {};
        const asset = this.app.inventoryDetail && this.app.inventoryDetail.asset;
        return route.name === 'detail' && asset && asset.serverAsset === true &&
          isPermanentId(asset.id) && asset.id === route.assetId ? asset : null;
      },
      demoAlertContext() {
        return !!(this.app.route && this.app.route.name === 'monitorAlert');
      },
      routeAssetId() {
        const route = this.app.route;
        return route && route.name === 'conversation' && isPermanentId(route.assetId) ? route.assetId : '';
      },
      /* The chip above the composer names the asset that travels with the turn;
       * it only ever resolves an id the server already returned. */
      selectedContextAsset() {
        if (!this.selectedAssetId) return null;
        return this.assetContextOptions.find((asset) => asset.id === this.selectedAssetId) || null;
      },
      /* Only assets the server already returned in this session can be attached;
       * typed or demo ids are never accepted as context. */
      assetContextOptions() {
        const items = (this.app.inventory && Array.isArray(this.app.inventory.items)) ? this.app.inventory.items : [];
        const detail = this.app.inventoryDetail && this.app.inventoryDetail.asset;
        const seen = {};
        const options = [];
        items.concat(detail ? [detail] : [], this.retainedAsset ? [this.retainedAsset] : []).forEach((asset) => {
          if (!asset || asset.serverAsset !== true || !isPermanentId(asset.id) || seen[asset.id]) return;
          seen[asset.id] = true;
          options.push({ id: asset.id, name: asset.name || asset.quickCode || asset.id, quickCode: asset.quickCode || '' });
        });
        return options;
      }
    },
    watch: {
      authenticated: {
        flush: 'sync',
        handler(value) {
          if (!value) this.resetSurface();
          else if (this.isConversationRoute) void this.loadEnginesForChat();
        }
      },
      'app.activeUserId': {
        flush: 'sync',
        handler() {
          this.resetSurface();
          if (this.authenticated && this.isConversationRoute) void this.loadEnginesForChat();
        }
      },
      canUseConversation(value) {
        if (!value) this.resetSurface();
      },
      'app.route'(route) {
        if (route && !['conversation', 'login', 'denied'].includes(route.name)) this.lastModuleRoute = Object.assign({}, route);
      },
      isConversationRoute(value) {
        if (value && this.authenticated && !this.busy) void this.loadEnginesForChat();
      },
      routeAssetId(value) {
        if (value) {
          this.selectedAssetId = value;
          void this.loadRouteAsset();
        }
      },
      selectedAssetId() {
        // Asset attachments belong to one asset; changing the selection never
        // carries the previous asset's list or checked ids into the new one.
        this.clearAssetAttachments();
      },
      draft() {
        // Any writer (typing, a retry refill, a reset) leaves the field sized to
        // its content instead of to the previous draft.
        if (this.$nextTick) this.$nextTick(this.autosizeComposer);
      }
    },
    created() {
      if (this.app.route && !this.isConversationRoute) this.lastModuleRoute = Object.assign({}, this.app.route);
      if (this.routeAssetId) {
        this.selectedAssetId = this.routeAssetId;
        void this.loadRouteAsset();
      }
      if (this.isConversationRoute) void this.loadEnginesForChat();
      if (document.addEventListener) document.addEventListener('keydown', this.handleChatKeydown);
    },
    mounted() {
      this.localizeRenderedCopy();
      this.autosizeComposer();
      this.syncHistoryViewport();
      if (window.addEventListener) window.addEventListener('resize', this.syncHistoryViewport);
    },
    updated() {
      // v-html replaces the code-block DOM on every stream tick, so the copy
      // label is re-applied after each render instead of once on mount.
      this.localizeRenderedCopy();
    },
    beforeUnmount() {
      this.disposed = true;
      this.resetSurface();
      if (document.removeEventListener) document.removeEventListener('keydown', this.handleChatKeydown);
      if (window.removeEventListener) window.removeEventListener('resize', this.syncHistoryViewport);
    },
    methods: {
      applyAgentEngines(payload) {
        // A resumed conversation owns its current selection. The independent
        // saved preference still supplies the default for a new conversation.
        const active = this.sessionId ? { instanceId: this.sessionInstanceId, model: this.sessionModel } : null;
        window.AssetAgentEngineMixin.methods.applyAgentEngines.call(this, payload, { preserveSelection: active });
      },
      agentMessageName() {
        const model = this.sessionModel || this.agentPreference.model;
        return model ? this.agentModelLabel(model) : tr('ui.chat.role_agent');
      },
      messageHtml(message) {
        const text = message && typeof message.content === 'string' ? message.content : '';
        const renderer = typeof window !== 'undefined' ? window.ChatMarkdown : null;
        if (renderer && typeof renderer.render === 'function') {
          try {
            return renderer.render(text);
          } catch (error) {
            // A renderer bug must degrade to text, never to an empty turn.
          }
        }
        return '<p class="conversation__plain">' + escapeMarkup(text) + '</p>';
      },
      copyText(text) {
        const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null;
        if (!clipboard || typeof clipboard.writeText !== 'function') return Promise.resolve(false);
        return clipboard.writeText(String(text === null || text === undefined ? '' : text))
          .then(() => true, () => false);
      },
      copyMessage(index, event) {
        const message = this.messages[index];
        if (!message) return;
        const button = event && event.currentTarget ? event.currentTarget : null;
        const result = this.copyText(message.content);
        void result.then(ok => {
          if (!ok) return;
          this.copiedIndex = index;
          if (button) button.classList.add('is-copied');
        });
      },
      retryLastMessage() {
        if (this.busy || this.resuming || this.sessionRunning) return;
        const lastUser = this.messages.slice().reverse().find(message => message.role === 'user');
        if (!lastUser || typeof lastUser.content !== 'string' || !lastUser.content.trim()) return;
        this.draft = lastUser.content;
        this.error = '';
        this.streamStatus = '';
        this.retryable = false;
        void this.send();
      },
      handleLogClick(event) {
        const target = event && event.target;
        if (!target || typeof target.closest !== 'function') return;
        const button = target.closest('[data-md-copy]');
        if (!button) return;
        event.preventDefault();
        const block = typeof button.closest === 'function' ? button.closest('pre') : null;
        const code = block && typeof block.querySelector === 'function' ? block.querySelector('code') : null;
        const text = code ? code.textContent : (block ? block.textContent : '');
        const original = button.textContent;
        const result = this.copyText(text);
        void result.then(ok => {
          if (!ok) return;
          button.textContent = tr('ui.chat.copied');
          if (typeof window !== 'undefined' && window.setTimeout) {
            window.setTimeout(() => { button.textContent = original; }, 1200);
          }
        });
      },
      localizeRenderedCopy() {
        const root = this.$refs.log;
        if (!root || typeof root.querySelectorAll !== 'function') return;
        const label = tr('ui.chat.copy_code');
        Array.prototype.forEach.call(root.querySelectorAll('[data-md-copy]'), button => {
          if (button.textContent !== label) button.textContent = label;
          if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
        });
      },
      async openPanel(event) {
        if (!this.canUseConversation) return false;
        const trigger = (event && event.currentTarget) || null;
        const isFab = !!(trigger && trigger.id === 'conversation-fab');
        this.opener = trigger || this.$refs.opener || null;
        this.panelAnchor = isFab ? 'fab' : '';
        this.panelOpen = true;
        if (!this.busy) void this.loadEnginesForChat();
        await this.$nextTick();
        if (this.surfaceVisible && this.$refs.input) this.$refs.input.focus();
        return true;
      },
      closePanel() {
        this.panelOpen = false;
        this.panelAnchor = '';
        this.historyOverlayOpen = false;
        this.deleteCandidate = '';
        const opener = this.opener || this.$refs.opener;
        void this.$nextTick(() => {
          if (this.authenticated && opener && typeof opener.focus === 'function') opener.focus();
        });
      },
      handleChatKeydown(event) {
        if (event.key !== 'Escape') return;
        if (this.historyOverlay && this.historyOverlayOpen) {
          event.preventDefault();
          this.closeHistory();
          return;
        }
        if (!this.panelOpen || this.isConversationRoute) return;
        event.preventDefault();
        this.closePanel();
      },
      expandConversation() {
        this.panelOpen = true;
        this.app.setHash('#/conversacion');
      },
      collapseConversation() {
        this.panelOpen = true;
        this.app.setHash(this.app.hashFor(this.lastModuleRoute));
      },
      useCurrentAsset() {
        if (!this.currentContextAsset || this.busy) return false;
        this.retainedAsset = Object.assign({}, this.currentContextAsset);
        this.selectedAssetId = this.currentContextAsset.id;
        return true;
      },
      async loadRouteAsset() {
        const id = this.routeAssetId;
        if (!id || this.assetContextOptions.some(asset => asset.id === id) || typeof this.app.loadInventoryDetail !== 'function') return;
        const epoch = this.epoch;
        const loaded = await this.app.loadInventoryDetail(id);
        if (!this.isCurrent(epoch)) return;
        const asset = this.app.inventoryDetail && this.app.inventoryDetail.asset;
        if (loaded && asset && asset.serverAsset === true && asset.id === id) this.retainedAsset = Object.assign({}, asset);
        else this.error = (this.app.inventoryDetail && this.app.inventoryDetail.error) || tr('ui.chat.asset_unavailable');
      },
      async loadSavedSessions() {
        const epoch = this.epoch;
        this.sessionsLoading = true;
        this.sessionsError = '';
        try {
          const payload = await window.AssetAgentApi.listSessions(this.app);
          if (!this.isCurrent(epoch)) return false;
          this.savedSessions = payload && Array.isArray(payload.sessions) ? payload.sessions.filter(session => session && typeof session.id === 'string') : [];
          return true;
        } catch (error) {
          if (this.isCurrent(epoch)) this.sessionsError = error.serverMessage || error.message || tr('ui.chat.sessions_error');
          return false;
        } finally {
          if (this.isCurrent(epoch)) this.sessionsLoading = false;
        }
      },
      async resumeSession(id) {
        if (this.busy || this.selecting || this.resuming) return false;
        if (!id) {
          this.epoch += 1;
          this.startNewSession();
          this.applyAgentEngines({ instances: this.agentEngines, budget: this.agentBudget, preference: this.agentPreferenceSaved });
          this.messages = [];
          this.draft = '';
          this.error = '';
          this.streamStatus = '';
          this.selectedAssetId = '';
          return true;
        }
        if (!this.savedSessions.some(session => session.id === id)) return false;
        const epoch = ++this.epoch;
        const controller = new AbortController();
        this.request = controller;
        this.resuming = true;
        this.sessionsError = '';
        try {
          const session = await window.AssetAgentApi.getSession(this.app, id, { signal: controller.signal });
          if (!this.isCurrent(epoch)) return false;
          if (!session || session.id !== id) throw new Error(tr('ui.chat.resume_wrong_session'));
          this.startNewSession();
          this.sessionId = id;
          this.applySessionSnapshot(session);
          this.agentPreference = { instanceId: this.sessionInstanceId, model: this.sessionModel };
          this.selectedAssetId = isPermanentId(session.assetId) ? session.assetId : '';
          this.draft = '';
          this.error = '';
          return true;
        } catch (error) {
          if (this.isCurrent(epoch) && error.name !== 'AbortError') this.sessionsError = error.serverMessage || error.message || tr('ui.chat.resume_failed');
          return false;
        } finally {
          if (this.isCurrent(epoch)) { this.resuming = false; this.request = null; }
        }
      },
      syncHistoryViewport() {
        this.historyNarrow = typeof window.innerWidth === 'number' && window.innerWidth <= HISTORY_NARROW_PX;
      },
      historyGroupLabel(key) {
        var labels = {
          today: tr('ui.chat.history_today'),
          yesterday: tr('ui.chat.history_yesterday'),
          week: tr('ui.chat.history_week'),
          older: tr('ui.chat.history_older')
        };
        return labels[key] || '';
      },
      historyName(session) {
        return session.model || session.engine || tr('ui.chat.title');
      },
      historyCountText(session) {
        const count = Number(session.messageCount) || 0;
        return trPlural('ui.chat.history_messages', count);
      },
      historyDateText(session) {
        const stamp = historyStamp(session);
        if (!Number.isFinite(stamp)) return '';
        const date = new Date(stamp);
        return window.ItsmI18n && window.ItsmI18n.formatDate
          ? window.ItsmI18n.formatDate(date, { day: 'numeric', month: 'short' })
          : new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(date);
      },
      toggleHistory() {
        if (this.historyOverlay) {
          this.historyOverlayOpen = !this.historyOverlayOpen;
          if (this.historyOverlayOpen) void this.$nextTick(() => { if (this.$refs.historyNew && this.$refs.historyNew.focus) this.$refs.historyNew.focus(); });
          else this.deleteCandidate = '';
          return this.historyOverlayOpen;
        }
        this.historyCollapsed = !this.historyCollapsed;
        writeHistoryCollapsed(this.historyCollapsed);
        return !this.historyCollapsed;
      },
      closeHistory() {
        if (!this.historyOverlayOpen) return false;
        this.historyOverlayOpen = false;
        this.deleteCandidate = '';
        void this.$nextTick(() => { if (this.$refs.historyToggle && this.$refs.historyToggle.focus) this.$refs.historyToggle.focus(); });
        return true;
      },
      async openSavedSession(id) {
        const opened = await this.resumeSession(id);
        if (opened) this.closeHistory();
        return opened;
      },
      async newConversationFromHistory() {
        const started = await this.resumeSession('');
        if (started) this.closeHistory();
        return started;
      },
      focusHistoryControl(selector) {
        void this.$nextTick(() => {
          const root = this.$el;
          const target = root && typeof root.querySelector === 'function' ? root.querySelector(selector) : null;
          if (target && typeof target.focus === 'function') target.focus();
        });
      },
      requestDeleteSession(id) {
        if (this.historyBusy || this.deletingSessionId) return false;
        this.deleteCandidate = id;
        this.focusHistoryControl('#conversation-history-confirm-' + id);
        return true;
      },
      cancelDeleteSession() {
        const id = this.deleteCandidate;
        this.deleteCandidate = '';
        if (id) this.focusHistoryControl('#conversation-history-delete-' + id);
      },
      async confirmDeleteSession(id) {
        if (this.deletingSessionId || this.historyBusy || this.deleteCandidate !== id) return false;
        const epoch = this.epoch;
        const removed = this.savedSessions.find(session => session.id === id);
        const wasActive = this.sessionId === id;
        this.deletingSessionId = id;
        let deleted = false;
        try {
          await window.AssetAgentApi.deleteSession(this.app, id);
          deleted = true;
        } catch (error) {
          if (this.isCurrent(epoch)) this.sessionsError = error.serverMessage || error.message || tr('ui.chat.session_delete_failed');
        } finally {
          this.deletingSessionId = '';
          this.deleteCandidate = '';
        }
        if (!deleted || !this.isCurrent(epoch)) return false;
        this.savedSessions = this.savedSessions.filter(session => session.id !== id);
        // The transcript belongs to the deleted session, so it is cleared too.
        if (wasActive) await this.resumeSession('');
        await this.loadSavedSessions();
        if (removed && this.savedSessions.some(session => session.id === id)) this.sessionsError = tr('ui.chat.session_delete_failed');
        return true;
      },
      savedSessionLabel(session) {
        return session.title || session.preview || tr('ui.chat.session_fallback_title', { date: session.updatedAt || session.createdAt || session.id });
      },
      isCurrent(epoch) {
        return epoch === this.epoch && this.disposed !== true && this.app.authenticated !== false;
      },
      history() {
        return this.messages
          .filter((message) => (message.role === 'user' || message.role === 'assistant') &&
            typeof message.content === 'string' && message.content.trim().length > 0)
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
        this.streaming = false;
      },
      resetSurface() {
        this.epoch += 1;
        this.agentEpoch += 1;
        this.agentPreferenceEpoch += 1;
        this.panelOpen = false;
        this.opener = null;
        this.panelAnchor = '';
        this.lastModuleRoute = { name: 'panel' };
        this.savedSessions = [];
        this.sessionsLoading = false;
        this.sessionsError = '';
        this.historyOverlayOpen = false;
        this.deleteCandidate = '';
        this.deletingSessionId = '';
        this.resuming = false;
        this.selecting = false;
        this.sessionRunning = false;
        this.retainedAsset = null;
        this.clearAttachments();
        this.clearAssetAttachments();
        this.attachmentBusy = false;
        this.attachmentError = '';
        this.sessionAttachmentCount = 0;
        this.cancelRequest();
        this.messages = [];
        this.draft = '';
        this.error = '';
        this.actions = [];
        this.results = [];
        this.extensionReviews = [];
        this.selectedAssetId = '';
        this.sessionId = '';
        this.sessionInstanceId = '';
        this.sessionModel = '';
        this.streamingIndex = -1;
        this.tools = [];
        this.usage = null;
        this.approvalPending = false;
        this.streamStatus = '';
        this.retryable = false;
        this.cancelPending = false;
        this.cancelReason = '';
        this.cancelRequested = false;
        this.reconnecting = false;
        this.legacyFallback = false;
        this.agentEngines = [];
        this.agentEnginesLoaded = false;
        this.agentEnginesAvailable = false;
        this.agentEnginesLoading = false;
        this.agentEnginesError = '';
        this.agentPreference = { instanceId: '', model: '' };
        this.agentPreferenceSaved = { instanceId: '', model: '' };
        this.agentBudget = null;
        this.agentSelectionNotice = '';
      },
      async loadEnginesForChat() {
        if (!this.app.authenticated || (!this.isConversationRoute && !this.panelOpen)) return false;
        const epoch = this.epoch;
        const discovery = this.loadAgentEngines();
        const loaded = await discovery;
        if (!this.isCurrent(epoch)) return false;
        if (!loaded) {
          this.legacyFallback = !this.agentEnginesAvailable;
          return false;
        }
        this.legacyFallback = false;
        if (!this.sessionsLoading) void this.loadSavedSessions();
        if (this.agentInstanceList.some(instance => instance && instance.quota && instance.quota.mode === 'managed')) void this.loadChatProviders(epoch);
        return true;
      },
      // Only the caller's own enabled personal providers are offered; the
      // server lists them owner-filtered and never returns key material.
      async loadChatProviders(epoch) {
        try {
          const payload = await window.AssetAgentApi.providers(this.app);
          if (!this.isCurrent(epoch)) return;
          const items = payload && Array.isArray(payload.items) ? payload.items : [];
          this.chatProviders = items
            .filter(item => item && item.scope === 'personal' && item.enabled !== false && typeof item.id === 'string' && Array.isArray(item.models) && item.models.length)
            .map(item => ({
              id: item.id,
              name: String(item.name || item.id),
              models: item.models.filter(model => typeof model === 'string' && model),
              // Owner/provider modality marks travel with the offered models so
              // the chat never guesses what the selected model accepts.
              capabilities: this.normalizeModelCapabilities(item.modelCapabilities)
            }));
        } catch (_) {
          if (this.isCurrent(epoch)) this.chatProviders = [];
        }
      },
      contextAssetId() {
        const id = this.selectedAssetId;
        if (!isPermanentId(id)) return '';
        const known = this.assetContextOptions.some((asset) => asset.id === id);
        return known ? id : '';
      },
      normalizeModelCapabilities(raw) {
        const result = {};
        if (!raw || typeof raw !== 'object') return result;
        Object.keys(raw).forEach(id => {
          const entry = raw[id] && typeof raw[id] === 'object' ? raw[id] : {};
          // Only an explicit true admits the modality; null stays unknown.
          result[id] = { image: entry.image === true, file: entry.file === true };
        });
        return result;
      },
      pendingAttachmentIds() {
        return this.attachments.map(item => item.id);
      },
      attachmentKindLabel(kind) {
        return tr(ATTACHMENT_KIND_KEYS[kind] || 'ui.chat.kind_other');
      },
      attachmentSizeText(item) {
        if (!item || item.sizeKnown === false) return tr('ui.chat.size_unknown');
        return bytesText(attachmentBytes(item.size));
      },
      selectedAssetAttachmentBytes() {
        const rows = this.assetAttachments.filter(item => this.selectedAssetAttachmentIds.includes(item.id));
        let bytes = 0;
        for (const row of rows) {
          if (row.sizeKnown === false) return null;
          bytes += attachmentBytes(row.size);
        }
        return bytes;
      },
      mapAttachments(list) {
        return (Array.isArray(list) ? list : [])
          .filter(item => item && typeof item.id === 'string' && item.id)
          .map(item => {
            const rawSize = Number(item.size);
            const sizeKnown = item.size !== null && item.size !== '' && Number.isFinite(rawSize) && rawSize >= 0;
            return {
              id: item.id,
              filename: safeFilename(item.filename),
              mediaType: typeof item.mediaType === 'string' ? item.mediaType : '',
              kind: ['image', 'file', 'text'].includes(item.kind) ? item.kind : 'file',
              // A size the server did not report is unknown, never zero: the
              // shared message budget cannot be verified without it.
              size: sizeKnown ? rawSize : 0,
              sizeKnown
            };
          });
      },
      mapMessageAttachments(list) {
        return this.mapAttachments(list);
      },
      attachmentErrorMessage(error) {
        const code = error && (error.code || '');
        if (code === 'model_modality_unsupported') return tr('ui.chat.error_modality');
        if (code === 'engine_attachments_unsupported') return tr('ui.chat.error_engine_attachments');
        if (error && error.status === 401) return tr('ui.chat.session_expired');
        return (error && (error.serverMessage || error.message)) || tr('ui.chat.error_attach');
      },
      clearAttachments() {
        this.attachments = [];
      },
      /* Enter sends, Shift+Enter keeps the newline, and an IME composition
       * never submits half a character. */
      handleComposerKeydown(event) {
        if (!event || event.key !== 'Enter' || event.shiftKey) return;
        if (event.isComposing || event.keyCode === 229) return;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        void this.send();
      },
      /* The composer grows with its content up to the CSS max-height and then
       * scrolls, so a long draft never pushes the transcript off screen. */
      autosizeComposer() {
        const el = this.$refs.input;
        if (!el || !el.style) return;
        const min = 24;
        const max = 200;
        const next = typeof el.scrollHeight === 'number' ? Math.max(el.scrollHeight, min) : 0;
        el.style.height = 'auto';
        if (next) el.style.height = Math.min(next, max) + 'px';
        el.style.overflowY = next > max ? 'auto' : 'hidden';
      },
      /* One tap on a starter question: it becomes the draft and the normal send
       * path runs, so validation, bounds and cancellation stay in one place. */
      applySuggestion(text) {
        const value = typeof text === 'string' ? text.trim() : '';
        if (!value || !this.engineReady || this.busy || this.resuming || this.sessionRunning) return false;
        this.draft = value;
        return this.send();
      },
      clearContextAsset() {
        this.selectedAssetId = '';
      },
      clearAssetAttachments() {
        this.assetAttachments = [];
        this.assetAttachmentsLoading = false;
        this.assetAttachmentsLoaded = false;
        this.assetAttachmentsError = '';
        this.assetAttachmentsTotal = 0;
        this.assetAttachmentsHasMore = false;
        this.selectedAssetAttachmentIds = [];
      },
      // Validates the whole selection before any byte leaves the browser, so a
      // rejected batch never leaves a half-populated message.
      attachmentBatchError(files) {
        const selectedBytes = this.selectedAssetAttachmentBytes();
        if (selectedBytes === null) {
          return tr('ui.chat.error_asset_size_unknown');
        }
        if (this.combinedAttachmentCount + files.length > MAX_ATTACHMENTS) {
          return tr('ui.chat.error_too_many_attachments', { max: MAX_ATTACHMENTS });
        }
        if (this.sessionAttachmentCount + files.length > MAX_SESSION_ATTACHMENTS) {
          return tr('ui.chat.error_session_attachment_limit', { max: MAX_SESSION_ATTACHMENTS });
        }
        const support = this.chatAttachmentSupport;
        let total = this.attachments.reduce((sum, item) => sum + attachmentBytes(item.size), 0) + selectedBytes;
        for (const file of files) {
          const size = attachmentBytes(file && file.size);
          if (size > MAX_ATTACHMENT_BYTES) return tr('ui.chat.error_file_size');
          total += size;
          const kind = attachmentKindFor(file && file.name);
          if (kind === 'image' && !support.image) return tr('ui.chat.error_no_images');
          if (kind === 'file' && !support.file) return tr('ui.chat.error_no_documents');
        }
        if (total > MAX_ATTACHMENT_BYTES) return tr('ui.chat.error_total_size');
        return '';
      },
      openAttachmentPicker() {
        const input = this.$refs && this.$refs.attachmentInput;
        if (input && typeof input.click === 'function') input.click();
      },
      async attachFiles(event) {
        if (!this.chatAttachmentSupport.supported) return false;
        const input = event && event.target ? event.target : null;
        const files = input && input.files ? Array.prototype.slice.call(input.files) : [];
        if (input) {
          // Clearing the native value lets the same file be chosen again after
          // an error; the pending list, not the control, is the authority.
          try { input.value = ''; } catch (_) { /* read-only fixture control */ }
        }
        if (!files.length) return false;
        if (this.busy || this.attachmentBusy || this.resuming || this.selecting || this.sessionRunning) return false;
        if (!this.engineReady) {
          this.attachmentError = tr('ui.chat.no_model');
          return false;
        }
        const batchError = this.attachmentBatchError(files);
        if (batchError) {
          this.attachmentError = batchError;
          return false;
        }
        this.attachmentError = '';
        let stored = 0;
        for (const file of files) {
          if (await this.storeAttachment(file)) stored += 1;
          if (this.attachmentError) break;
        }
        return stored > 0;
      },
      async storeAttachment(file) {
        const filename = safeFilename(file && file.name);
        if (!filename) {
          this.attachmentError = tr('ui.chat.error_filename');
          return false;
        }
        const epoch = this.epoch;
        this.attachmentBusy = true;
        try {
          const bytes = await file.arrayBuffer();
          if (!this.isCurrent(epoch)) return false;
          if (!(await this.ensureAttachmentSession(epoch))) return false;
          if (!this.isCurrent(epoch)) return false;
          const payload = await window.AssetAgentApi.uploadSessionAttachment(this.app, this.sessionId, filename, bytes);
          if (!this.isCurrent(epoch)) return false;
          const item = this.mapAttachments([payload])[0];
          if (!item) throw new Error(tr('ui.chat.error_upload_response'));
          this.attachments = this.attachments.concat([item]);
          this.sessionAttachmentCount += 1;
          return true;
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          if (error && error.name === 'AbortError') return false;
          this.attachmentError = this.attachmentErrorMessage(error);
          return false;
        } finally {
          if (this.isCurrent(epoch)) this.attachmentBusy = false;
        }
      },
      // Attachments are session scoped, so an upload first obtains the same
      // server session the message would use. A created session is reused by
      // the later send instead of creating a second one.
      async ensureAttachmentSession(epoch) {
        if (this.sessionId) return true;
        const instance = this.agentActiveInstance;
        const model = this.agentPreference.model;
        if (!instance || instance.enabled === false) {
          this.attachmentError = tr('ui.chat.no_engine');
          return false;
        }
        if (!model) {
          this.attachmentError = tr('ui.chat.no_model');
          return false;
        }
        try {
          await this.ensureSession(instance, model, this.history(), this.contextAssetId(), epoch);
          return !!this.sessionId && this.isCurrent(epoch);
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          this.attachmentError = this.attachmentErrorMessage(error);
          return false;
        }
      },
      async removeAttachment(id) {
        const target = this.attachments.find(item => item.id === id);
        if (!target || !this.sessionId || this.busy || this.attachmentBusy) return false;
        const epoch = this.epoch;
        try {
          await window.AssetAgentApi.deleteSessionAttachment(this.app, this.sessionId, id);
          if (!this.isCurrent(epoch)) return false;
          this.attachments = this.attachments.filter(item => item.id !== id);
          this.sessionAttachmentCount = Math.max(0, this.sessionAttachmentCount - 1);
          if (!this.attachments.length) this.attachmentError = '';
          return true;
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          this.attachmentError = this.attachmentErrorMessage(error);
          return false;
        }
      },
      // Existing asset attachments are only listed after the explicit load the
      // person asks for, and only ids the server returned can be referenced.
      async loadAssetAttachments() {
        const assetId = this.contextAssetId();
        if (!assetId || this.assetAttachmentsLoading) return false;
        const epoch = this.epoch;
        this.assetAttachmentsLoading = true;
        this.assetAttachmentsError = '';
        try {
          const payload = await window.AssetAgentApi.assetAttachments(this.app, assetId);
          if (!this.isCurrent(epoch) || assetId !== this.contextAssetId()) return false;
          this.assetAttachments = this.mapAttachments(payload && payload.items);
          const total = Number(payload && payload.total);
          this.assetAttachmentsTotal = Number.isFinite(total) && total >= 0 ? total : this.assetAttachments.length;
          this.assetAttachmentsHasMore = payload && payload.hasMore === true;
          this.assetAttachmentsLoaded = true;
          this.selectedAssetAttachmentIds = this.selectedAssetAttachmentIds.filter(id =>
            this.assetAttachments.some(item => item.id === id));
          return true;
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          if (error && error.name === 'AbortError') return false;
          this.assetAttachmentsError = error && error.status === 401
            ? tr('ui.chat.session_expired')
            : ((error && (error.serverMessage || error.message)) || tr('ui.chat.error_asset_attachments'));
          return false;
        } finally {
          if (this.isCurrent(epoch)) this.assetAttachmentsLoading = false;
        }
      },
      toggleAssetAttachment(id, event) {
        const value = typeof id === 'string' ? id : '';
        const row = this.assetAttachments.find(item => item.id === value);
        if (!row) return false;
        const target = event && event.target ? event.target : null;
        const checked = target && typeof target.checked === 'boolean'
          ? target.checked
          : !this.selectedAssetAttachmentIds.includes(value);
        if (!checked) {
          this.selectedAssetAttachmentIds = this.selectedAssetAttachmentIds.filter(item => item !== value);
          this.attachmentError = '';
          return true;
        }
        if (this.selectedAssetAttachmentIds.includes(value)) return true;
        if (row.sizeKnown === false) {
          this.attachmentError = tr('ui.chat.error_asset_attachment_size');
          return false;
        }
        if (this.combinedAttachmentCount + 1 > MAX_ATTACHMENTS) {
          this.attachmentError = tr('ui.chat.error_too_many_attachments', { max: MAX_ATTACHMENTS });
          return false;
        }
        const selectedBytes = this.selectedAssetAttachmentBytes() || 0;
        const total = this.attachments.reduce((sum, item) => sum + attachmentBytes(item.size), 0) +
          selectedBytes + attachmentBytes(row.size);
        if (total > MAX_ATTACHMENT_BYTES) {
          this.attachmentError = tr('ui.chat.error_total_size');
          return false;
        }
        this.selectedAssetAttachmentIds = this.selectedAssetAttachmentIds.concat([value]);
        this.attachmentError = '';
        return true;
      },
      mapActions(list) {
        return (Array.isArray(list) ? list : [])
          .filter((action) => action && typeof action === 'object')
          .map((action) => ({
            tool: typeof action.tool === 'string' ? action.tool : '',
            status: typeof action.status === 'string' ? action.status : '',
            assetIds: Array.isArray(action.assetIds) ? action.assetIds : [],
            tone: ACTION_TONES[action.status] || 'hold'
          }));
      },
      mapResults(list) {
        const rows = Array.isArray(list) ? list : [];
        this.extensionReviews = rows.filter((item) => item && item.type === 'extension_review' &&
          typeof item.candidateId === 'string' && UUID_RE.test(item.candidateId) &&
          typeof item.digest === 'string' && /^[0-9a-f]{64}$/.test(item.digest) &&
          typeof item.extensionId === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(item.extensionId) &&
          typeof item.version === 'string' && /^\d+\.\d+\.\d+$/.test(item.version)).map((item) => ({
          candidateId: item.candidateId, extensionId: item.extensionId,
          version: item.version, digest: item.digest,
          href: '#/configuracion/extensiones?candidato=' + encodeURIComponent(item.candidateId)
        }));
        return rows.filter((asset) => asset && asset.type !== 'extension_review' && typeof asset.id === 'string' && UUID_RE.test(asset.id));
      },
      async send() {
        const message = this.draft.trim();
        const attachmentIds = this.useAgentSessions ? this.pendingAttachmentIds() : [];
        const assetAttachmentIds = this.useAgentSessions ? this.selectedAssetAttachmentIds : [];
        const hasContent = !!message || attachmentIds.length > 0 || assetAttachmentIds.length > 0;
        if (!hasContent || this.busy || this.resuming || this.selecting || this.sessionRunning || this.disposed) return false;
        if (!this.app.authenticated) {
          this.error = tr('ui.chat.session_expired');
          return false;
        }
        if (this.attachmentBusy) return false;
        if (message.length > MAX_MESSAGE) {
          this.error = tr('ui.chat.message_too_long', { max: MAX_MESSAGE });
          return false;
        }
        if (this.useAgentSessions) return this.sendSession(message);
        return this.sendLegacy(message);
      },
      async sendLegacy(message) {
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
          this.actions = this.mapActions(payload && payload.actions);
          this.results = this.mapResults(payload && payload.results);
          if (payload && typeof payload.approvalPending === 'boolean') this.approvalPending = payload.approvalPending;
          return true;
        } catch (error) {
          if (requestId !== this.requestId || this.disposed) return false;
          if (error && error.status === 503) this.error = error.serverMessage || tr('ui.chat.agent_unavailable');
          else if (error && error.status === 401) this.error = tr('ui.chat.session_expired');
          else this.error = (error && (error.serverMessage || error.message)) || tr('ui.chat.error_send_agent');
          return false;
        } finally {
          if (requestId === this.requestId) {
            this.busy = false;
            this.request = null;
          }
        }
      },
      async sendSession(message) {
        const instance = this.agentActiveInstance;
        if (!instance || instance.enabled === false) {
          this.error = tr('ui.chat.no_engine');
          return false;
        }
        const model = this.agentPreference.model;
        if (!model) {
          this.error = tr('ui.chat.no_model');
          return false;
        }
        const assetId = this.contextAssetId();
        const attachmentIds = this.pendingAttachmentIds();
        const assetAttachmentIds = this.selectedAssetAttachmentIds.slice();
        const sentAttachments = this.attachments.slice();
        this.error = '';
        this.retryable = false;
        this.streamStatus = '';
        this.cancelPending = false;
        this.cancelReason = '';
        this.cancelRequested = false;
        this.actions = [];
        this.results = [];
        this.tools = [];
        this.usage = null;
        this.approvalPending = false;
        this.busy = true;
        this.streaming = false;
        this.streamingIndex = -1;
        this.epoch += 1;
        const epoch = this.epoch;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        this.request = controller;
        let done = false;
        let received = false;
        let userIndex = -1;
        try {
          await this.ensureSession(instance, model, this.history(), assetId, epoch, controller ? controller.signal : undefined);
          if (!this.isCurrent(epoch)) return false;
          if (this.cancelRequested) {
            this.streamStatus = tr('ui.chat.cancelled');
            return false;
          }
          this.messages.push({ role: 'user', content: message, attachments: sentAttachments });
          userIndex = this.messages.length - 1;
          this.draft = '';
          this.attachments = [];
          this.attachmentError = '';
          this.selectedAssetAttachmentIds = [];
          this.streaming = true;
          const body = { message };
          if (attachmentIds.length) body.attachmentIds = attachmentIds;
          if (assetAttachmentIds.length) body.assetAttachmentIds = assetAttachmentIds;
          if (assetId) body.assetId = assetId;
          const frames = window.AssetAgentApi.streamMessage(this.app, this.sessionId, body, {
            signal: controller ? controller.signal : undefined
          });
          for await (const event of frames) {
            received = true;
            if (!this.isCurrent(epoch)) return false;
            if (this.applyAgentEvent(event)) {
              done = true;
              break;
            }
          }
          if (!this.isCurrent(epoch)) return false;
          if (!done && !this.error) this.streamStatus = tr('ui.chat.stream_incomplete');
          this.finishStreamingMessage();
          return true;
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          if (error && error.name === 'AbortError') return false;
          // A rejection before the run started leaves nothing sent: restore the
          // exact draft and pending attachment rows so a retry is explicit and
          // never replayed automatically.
          if (!received) {
            if (this.messages[userIndex] && this.messages[userIndex].role === 'user') this.messages.splice(userIndex, 1);
            if (!this.draft) this.draft = message;
            this.attachments = sentAttachments;
            this.selectedAssetAttachmentIds = assetAttachmentIds;
          }
          if (error && error.status === 401) this.error = tr('ui.chat.session_expired');
          else if (error && (error.status === 503 || error.status === 429)) this.error = error.serverMessage || error.message;
          else if (error && error.status === 409) this.error = (error.serverMessage || error.message) + tr('ui.chat.busy_409');
          else this.error = (error && (error.serverMessage || error.message)) || tr('ui.chat.error_send_engine');
          this.retryable = !!(error && (error.status === 503 || error.status === 429 || error.status === 0 || !error.status));
          this.finishStreamingMessage();
          return false;
        } finally {
          if (this.isCurrent(epoch)) {
            this.busy = false;
            this.streaming = false;
            this.request = null;
            void this.loadSavedSessions();
          }
        }
      },
      async ensureSession(instance, model, context, assetId, epoch, signal) {
        if (this.sessionId) {
          if (this.sessionInstanceId === instance.id && this.sessionModel === model) return;
          const body = this.sessionInstanceId === instance.id ? { model } : { instanceId: instance.id, model };
          const patched = await window.AssetAgentApi.patchSession(this.app, this.sessionId, body, { signal });
          if (!this.isCurrent(epoch)) return;
          this.sessionInstanceId = instance.id;
          this.sessionModel = (patched && patched.model) || model;
          return;
        }
        const providerId = this.agentManagedActive ? this.managedProviderId : '';
        if (!providerId) await this.persistAgentPreference(instance.id, model);
        if (!this.isCurrent(epoch)) return;
        if (signal && signal.aborted) {
          // Internal signal, never rendered: callers return early on AbortError.
          const aborted = new Error('Aborted');
          aborted.name = 'AbortError';
          throw aborted;
        }
        const body = { instanceId: instance.id, model };
        if (providerId) body.providerId = providerId;
        if (context.length) body.context = context;
        if (assetId) body.assetId = assetId;
        const session = await window.AssetAgentApi.createSession(this.app, body, { signal });
        if (!this.isCurrent(epoch)) return;
        if (!session || !session.id) throw new Error(tr('ui.chat.error_session_created'));
        this.sessionId = session.id;
        this.sessionInstanceId = session.instanceId || instance.id;
        this.sessionModel = session.model || model;
        this.sessionProviderId = session.providerId || providerId;
      },
      startNewSession() {
        this.sessionId = '';
        this.sessionInstanceId = '';
        this.sessionModel = '';
        this.sessionProviderId = '';
        this.tools = [];
        this.usage = null;
        this.actions = [];
        this.results = [];
        this.approvalPending = false;
        this.sessionRunning = false;
        // Uploads belong to the server session that is being left behind.
        this.clearAttachments();
        this.clearAssetAttachments();
        this.attachmentError = '';
        this.sessionAttachmentCount = 0;
      },
      async changeEngine(instanceId) {
        const instance = this.agentInstanceList.find(item => item.id === instanceId && item.enabled !== false);
        if (!instance) return false;
        return this.changeSelection(instance, this.agentDefaultModel(instance));
      },
      async changeModel(model) {
        const instance = this.agentActiveInstance;
        if (!instance || !this.agentModels.some(item => item.id === model)) return false;
        return this.changeSelection(instance, model);
      },
      // The rendered engine value groups external profiles; an authorized
      // instance id is still accepted so the older control contract keeps
      // working without inventing a new selection authority.
      async changeEngineChoice(event) {
        const value = typeof event === 'string' ? event : (event && event.target ? event.target.value : '');
        const choice = this.agentEngineChoices.find(item => item.value === value);
        let applied;
        if (choice) {
          const instance = choice.instanceId
            ? this.agentInstanceList.find(item => item.id === choice.instanceId)
            : this.agentEngineInstanceFor(choice.engine);
          applied = instance && instance.enabled !== false ? await this.changeEngine(instance.id) : false;
        } else {
          applied = await this.changeEngine(value);
        }
        if (!applied) this.agentResetSelection(event, this.agentEngineValue);
        return applied;
      },
      // A profile switch is the existing target-instance PATCH: the ITSM
      // session keeps its id, transcript and actions, while only the engine's
      // native binding is reset by the server.
      async changeProfile(event) {
        const value = typeof event === 'string' ? event : (event && event.target ? event.target.value : '');
        const instance = this.agentProfileInstance(value);
        const applied = instance && instance.enabled !== false
          ? await this.changeSelection(instance, this.agentDefaultModel(instance))
          : false;
        if (!applied) this.agentResetSelection(event, this.agentPreference.instanceId);
        return applied;
      },
      async changeProvider(event) {
        const value = typeof event === 'string' ? event : (event && event.target ? event.target.value : '');
        const instance = this.agentActiveInstance;
        const option = this.agentProviderOptions.find(item => item.value === value);
        if (!instance || !option || this.busy || this.resuming || this.selecting || this.sessionRunning) {
          this.agentResetSelection(event, this.managedProviderId);
          return false;
        }
        if (this.hasPendingAttachments) {
          // A provider may change the model and its modality marks; the person
          // decides first whether the pending files still belong to this turn.
          this.agentResetSelection(event, this.managedProviderId);
          return false;
        }
        const model = option.value ? (option.models[0] || '') : this.agentDefaultModel(instance);
        const epoch = this.epoch;
        const controller = new AbortController();
        this.request = controller;
        this.selecting = true;
        this.agentSelectionNotice = '';
        this.error = '';
        try {
          let applied = model;
          if (this.sessionId) {
            const patched = await window.AssetAgentApi.patchSession(this.app, this.sessionId, { providerId: option.value || null }, { signal: controller.signal });
            if (!this.isCurrent(epoch)) return false;
            applied = (patched && patched.model) || model;
            this.sessionModel = applied;
            this.sessionProviderId = option.value;
          }
          this.managedProviderId = option.value;
          this.agentPreference = { instanceId: instance.id, model: applied };
          if (!option.value) await this.persistAgentPreference(instance.id, applied);
          return true;
        } catch (error) {
          if (this.isCurrent(epoch) && error.name !== 'AbortError') this.error = error.status === 401 ? tr('ui.chat.session_expired') : (error.serverMessage || error.message || tr('ui.chat.error_change_provider'));
          this.agentResetSelection(event, this.managedProviderId);
          return false;
        } finally {
          if (this.isCurrent(epoch)) { this.selecting = false; this.request = null; }
        }
      },
      // The single provider control maps its option back to the existing
      // authority: an engine choice changes the authorized instance/profile,
      // and a provider choice changes only the managed provider of that
      // instance. A rejected change restores the value the server reports.
      async changeChatProvider(event) {
        const value = typeof event === 'string' ? event : (event && event.target ? event.target.value : '');
        const choice = this.chatProviderChoices.find(item => item.value === value);
        if (!choice) {
          this.agentResetSelection(event, this.chatProviderValue);
          return false;
        }
        let applied;
        if (choice.kind === 'provider') {
          applied = await this.changeProvider(choice.providerValue);
        } else if (choice.instanceId) {
          applied = await this.changeEngineChoice(choice.instanceId);
        } else {
          applied = false;
        }
        if (!applied) this.agentResetSelection(event, this.chatProviderValue);
        return applied;
      },
      openChatConfig() {
        if (!this.canConfigureChat) return false;
        if (!this.isConversationRoute) this.closePanel();
        this.app.setHash('#/configuracion/ia');
        return true;
      },
      async changeSelection(instance, model) {
        if (this.busy || this.resuming || this.selecting || this.sessionRunning) return false;
        // Pending attachments keep the conversation on the engine, model and
        // session that accepted them until the person sends or removes them.
        if (this.hasPendingAttachments) return false;
        if (this.sessionId && !model) {
          this.agentSelectionNotice = tr('ui.chat.notice_models_none');
          return false;
        }
        const epoch = this.epoch;
        const controller = new AbortController();
        this.request = controller;
        this.selecting = true;
        this.agentSelectionNotice = '';
        this.error = '';
        try {
          if (this.sessionId) {
            const body = this.sessionInstanceId === instance.id ? { model } : { instanceId: instance.id, model };
            const patched = await window.AssetAgentApi.patchSession(this.app, this.sessionId, body, { signal: controller.signal });
            if (!this.isCurrent(epoch)) return false;
            this.sessionInstanceId = instance.id;
            this.sessionModel = (patched && patched.model) || model;
            if (patched && 'providerId' in patched) this.sessionProviderId = patched.providerId || '';
          }
          // Another instance starts again on its organization provider, as the
          // server does when a PATCH moves the session without a providerId.
          if (instance.id !== this.agentPreference.instanceId) this.managedProviderId = '';
          this.agentPreference = { instanceId: instance.id, model };
          if (!this.managedProviderId) await this.persistAgentPreference(instance.id, model);
          if (!this.isCurrent(epoch)) return false;
          if (!model) this.agentSelectionNotice = tr('ui.chat.notice_models_none_review');
          return true;
        } catch (error) {
          if (this.isCurrent(epoch) && error.name !== 'AbortError') this.error = error.status === 401 ? tr('ui.chat.session_expired') : (error.serverMessage || error.message || tr('ui.chat.error_change_engine'));
          return false;
        } finally {
          if (this.isCurrent(epoch)) { this.selecting = false; this.request = null; }
        }
      },
      async cancelRun() {
        if (!this.canCancel) return false;
        if (!this.useAgentSessions || !this.sessionId) {
          this.cancelRequested = true;
          this.cancelRequest();
          this.streamStatus = tr('ui.chat.cancelled');
          return true;
        }
        if (this.cancelPending) return false;
        const epoch = this.epoch;
        this.cancelPending = true;
        this.cancelReason = '';
        try {
          const result = await window.AssetAgentApi.cancelSession(this.app, this.sessionId);
          if (!this.isCurrent(epoch)) return false;
          if (!result || result.cancelled !== true) {
            this.cancelPending = false;
            this.cancelReason = (result && typeof result.reason === 'string' && result.reason.trim())
              ? result.reason.trim()
              : tr('ui.chat.cancel_not_supported');
            this.streamStatus = this.cancelReason;
            return false;
          }
          return true;
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          this.cancelPending = false;
          this.error = (error && error.message) || tr('ui.chat.error_cancel');
          return false;
        }
      },
      async reconnectSession() {
        if (!this.sessionId || this.busy || this.reconnecting) return false;
        const epoch = this.epoch;
        this.reconnecting = true;
        try {
          const session = await window.AssetAgentApi.getSession(this.app, this.sessionId);
          if (!this.isCurrent(epoch)) return false;
          this.applySessionSnapshot(session);
          this.error = '';
          this.retryable = false;
          if (!this.sessionRunning) this.streamStatus = '';
          return true;
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          this.error = (error && error.message) || tr('ui.chat.error_session_status');
          return false;
        } finally {
          if (this.isCurrent(epoch)) this.reconnecting = false;
        }
      },
      applySessionSnapshot(session) {
        const payload = session && typeof session === 'object' ? session : {};
        if (Array.isArray(payload.messages)) {
          this.messages = payload.messages
            .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
            .map((message) => ({
              role: message.role,
              content: message.content,
              // Only the server's metadata is kept for display; bytes and URLs
              // never travel through the transcript or the history sent back.
              attachments: this.mapMessageAttachments(message.attachments)
            }));
        }
        if (Array.isArray(payload.actions)) this.actions = this.mapActions(payload.actions);
        if (Array.isArray(payload.results)) this.results = this.mapResults(payload.results);
        if (typeof payload.approvalPending === 'boolean') this.approvalPending = payload.approvalPending;
        if (typeof payload.model === 'string') this.sessionModel = payload.model;
        if (typeof payload.instanceId === 'string') this.sessionInstanceId = payload.instanceId;
        if (typeof payload.providerId === 'string' || payload.providerId === null) {
          this.sessionProviderId = payload.providerId || '';
          this.managedProviderId = this.sessionProviderId;
        }
        if (payload.status === 'running') this.streamStatus = tr('ui.chat.status_running_server');
        this.sessionRunning = payload.status === 'running';
      },
      applyAgentEvent(event) {
        if (!event || typeof event !== 'object') return false;
        if (event.type === 'session' && typeof event.sessionId === 'string' && event.sessionId) {
          this.sessionId = event.sessionId;
        } else if (event.type === 'delta') {
          const chunk = typeof event.text === 'string' ? event.text : '';
          if (chunk) {
            this.ensureStreamingMessage();
            const message = this.messages[this.streamingIndex];
            // Neutral contract: every delta.text is a new fragment. The server
            // diffs cumulative provider snapshots before emitting.
            message.content = String(message.content || '') + chunk;
          }
        } else if (event.type === 'tool') {
          this.applyToolEvent(event);
        } else if (event.type === 'usage') {
          this.applyUsage(event);
        } else if (event.type === 'error') {
          this.error = typeof event.message === 'string' && event.message.trim()
            ? event.message.trim()
            : tr('ui.chat.error_engine_stream');
          this.retryable = event.retryable === true;
        } else if (event.type === 'done') {
          this.applyDone(event);
          this.finishStreamingMessage();
          return true;
        }
        return false;
      },
      ensureStreamingMessage() {
        if (this.streamingIndex >= 0 && this.messages[this.streamingIndex]) return;
        this.messages.push({ role: 'assistant', content: '', streaming: true });
        this.streamingIndex = this.messages.length - 1;
      },
      finishStreamingMessage() {
        if (this.streamingIndex < 0) return;
        const message = this.messages[this.streamingIndex];
        if (message && !String(message.content || '').trim()) this.messages.splice(this.streamingIndex, 1);
        else if (message) message.streaming = false;
        this.streamingIndex = -1;
      },
      applyDone(event) {
        if (Array.isArray(event.actions)) this.actions = this.mapActions(event.actions);
        if (Array.isArray(event.results)) this.results = this.mapResults(event.results);
        if (typeof event.approvalPending === 'boolean') this.approvalPending = event.approvalPending;
        this.sessionRunning = false;
        const wasPending = this.cancelPending;
        this.cancelPending = false;
        if (event.cancelled === true) this.streamStatus = tr('ui.chat.status_cancelled');
        else if (wasPending && this.cancelReason) this.streamStatus = this.cancelReason;
        else if (this.error) this.streamStatus = tr('ui.chat.status_failed_stream');
      },
      applyToolEvent(event) {
        const tool = typeof event.tool === 'string' && event.tool.trim() ? event.tool.trim() : tr('ui.chat.tool_fallback');
        const status = this.normalizeToolStatus(event.status);
        let index = -1;
        for (let cursor = this.tools.length - 1; cursor >= 0; cursor -= 1) {
          const item = this.tools[cursor];
          if (item.tool === tool && (item.status === 'running' || item.status === 'pending')) {
            index = cursor;
            break;
          }
        }
        const row = index >= 0 ? this.tools[index] : { tool, status, input: '', output: '' };
        row.status = status;
        if (event.input !== undefined && event.input !== null) row.input = this.serializeToolValue(event.input);
        if (event.output !== undefined && event.output !== null) row.output = this.serializeToolValue(event.output);
        if (index < 0) this.tools.push(row);
      },
      serializeToolValue(value) {
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch (_) { return ''; }
      },
      normalizeToolStatus(status) {
        if (status === 'started' || status === 'in_progress' || status === 'pending') return 'running';
        if (status === 'succeeded' || status === 'success') return 'completed';
        if (status === 'error') return 'failed';
        return typeof status === 'string' && status ? status : 'running';
      },
      applyUsage(event) {
        const precision = ['measured', 'estimated', 'unavailable'].includes(event.precision) ? event.precision : 'unavailable';
        const source = ['provider', 'engine', 'estimate', 'none'].includes(event.source) ? event.source : 'none';
        this.usage = {
          inputTokens: numericOrNull(event.inputTokens),
          outputTokens: numericOrNull(event.outputTokens),
          cacheReadTokens: numericOrNull(event.cacheReadTokens),
          cacheWriteTokens: numericOrNull(event.cacheWriteTokens),
          reasoningTokens: numericOrNull(event.reasoningTokens),
          totalTokens: numericOrNull(event.totalTokens),
          precision,
          source,
          estimationMethod: typeof event.estimationMethod === 'string' && event.estimationMethod.trim() ? event.estimationMethod.trim() : null,
          inputIncludesCache: typeof event.inputIncludesCache === 'boolean' ? event.inputIncludesCache : null,
          outputIncludesReasoning: typeof event.outputIncludesReasoning === 'boolean' ? event.outputIncludesReasoning : null,
          totalSource: event.totalSource === 'provider' || event.totalSource === 'derived' ? event.totalSource : null,
          cost: event.cost === undefined || event.cost === null ? '' : String(event.cost)
        };
      },
      toolStatusLabel(status) {
        return tr(TOOL_STATUS_KEYS[status] || 'ui.chat.status_recorded');
      },
      toolTone(status) {
        return toolTone(status);
      },
      actionStatusLabel(status) {
        return tr(ACTION_STATUS_KEYS[status] || 'ui.chat.status_recorded');
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
        return tr(ASSET_STATUS_KEYS[result.status] || 'ui.chat.status_none');
      },
      assetAttachmentsCountText() {
        let text = tr('ui.chat.asset_attachments_examined', {
          examined: this.assetAttachments.length,
          total: this.assetAttachmentsTotal
        });
        if (this.assetAttachmentsHasMore) text += tr('ui.chat.asset_attachments_more');
        return text + '.';
      }
    },
    template: [
'<div class="conversation-host" :class="{ \'conversation-host--full\': isConversationRoute, \'conversation-host--open\': panelOpen }">',
'  <button v-if="canUseConversation && !isConversationRoute" id="conversation-opener" ref="opener" type="button" class="btn btn--secondary conversation-opener" :aria-label="panelOpen ? $t(\'ui.chat.close_panel\') : $t(\'ui.chat.open_panel\')" aria-controls="conversation-surface" :aria-expanded="panelOpen" :title="$t(\'ui.chat.title\')" @click="panelOpen ? closePanel() : openPanel($event)"><app-icon name="chat"></app-icon><span id="conversation-opener-label" class="conversation-opener__label">{{ $t(\'ui.chat.title\') }}</span><span v-if="busy" class="sr-only">{{ $t(\'ui.chat.response_in_progress\') }}</span></button>',
'  <button v-if="fabVisible" id="conversation-fab" :hidden="panelOpen" type="button" class="conversation-fab" :class="{ \'conversation-fab--busy\': busy }" :aria-label="$t(\'ui.chat.open_panel\')" aria-controls="conversation-surface" :aria-expanded="panelOpen" :title="$t(\'ui.chat.title\')" @click="openPanel($event)"><app-icon name="chat"></app-icon><span v-if="busy" class="conversation-fab__dot" aria-hidden="true"></span><span v-if="busy" class="sr-only">{{ $t(\'ui.chat.response_in_progress\') }}</span></button>',
'<section id="conversation-surface" class="conversation" :class="{ \'conversation--compact\': !isConversationRoute, \'conversation--from-fab\': !isConversationRoute && panelAnchor === \'fab\' }" :hidden="!surfaceVisible" aria-labelledby="conversation-title">',
'  <header class="conversation__head">',
'    <button ref="historyToggle" id="conversation-history-toggle" type="button" class="icon-button conversation__history-toggle" :aria-expanded="historyVisible ? \'true\' : \'false\'" aria-controls="conversation-history" :aria-label="historyVisible ? $t(\'ui.chat.history_hide\') : $t(\'ui.chat.history_show\')" :title="historyVisible ? $t(\'ui.chat.history_hide\') : $t(\'ui.chat.history_show\')" @click="toggleHistory"><app-icon name="history"></app-icon></button>',
'    <div class="conversation__title-block">',
'      <h1 v-if="isConversationRoute" id="conversation-title" class="conversation__title">{{ conversationTitle }}</h1>',
'      <h2 v-else id="conversation-title" class="conversation__title">{{ conversationTitle }}</h2>',
'    </div>',
'    <div v-if="!legacyFallback" class="conversation__model-picker" role="group" :aria-label="$t(\'ui.chat.engine_title\')">',
'      <label class="conversation__picker"><span class="sr-only">{{ $t(\'ui.chat.provider_label\') }}</span>',
'        <select id="conversation-provider" class="conversation__select" :value="chatProviderValue" :disabled="chatProviderDisabled" @change="changeChatProvider($event)">',
'          <option v-if="!chatProviderChoices.length" value="">{{ $t(\'ui.system.executor.unconfigured_state\') }}</option>',
'          <option v-for="choice in chatProviderChoices" :key="choice.value" :value="choice.value" :disabled="choice.disabled">{{ choice.label }}{{ choice.disabled ? $t(\'ui.chat.disabled_suffix\') : "" }}</option>',
'        </select>',
'      </label>',
'      <label class="conversation__picker"><span class="sr-only">{{ $t(\'ui.chat.model_label\') }}</span>',
'        <select id="conversation-model" class="conversation__select" :value="agentPreference.model" :disabled="busy || selecting || resuming || sessionRunning || !agentModels.length || hasPendingAttachments" @change="changeModel($event.target.value)">',
'          <option v-if="!agentModels.length" value="">{{ $t(\'ui.chat.models_none\') }}</option>',
'          <option v-for="model in agentModels" :key="model.id" :value="model.id">{{ agentModelLabel(model) }}</option>',
'        </select>',
'      </label>',
'    </div>',
'    <a v-if="canConfigureChat" id="conversation-config" class="conversation__config icon-button" href="#/configuracion/ia" :aria-label="$t(\'ui.page.settings\')" :title="$t(\'ui.page.settings\')" @click.prevent="openChatConfig"><app-icon name="sliders"></app-icon><span class="conversation__config-label sr-only">{{ $t(\'ui.page.settings\') }}</span></a>',
'    <div class="conversation__window-actions">',
'      <button v-if="!isConversationRoute" id="conversation-expand" type="button" class="icon-button conversation__expand" :aria-label="$t(\'ui.chat.expand\')" :title="$t(\'ui.chat.expand\')" @click="expandConversation"><app-icon name="arrow-up-right"></app-icon><span class="sr-only">{{ $t(\'ui.chat.expand\') }}</span></button>',
'      <button v-else id="conversation-collapse" type="button" class="icon-button conversation__collapse" :aria-label="$t(\'ui.chat.collapse\')" :title="$t(\'ui.chat.collapse\')" @click="collapseConversation"><app-icon name="chevron-down"></app-icon><span class="sr-only">{{ $t(\'ui.chat.collapse\') }}</span></button>',
'      <button v-if="!isConversationRoute" type="button" class="icon-button" :aria-label="$t(\'ui.chat.close_panel\')" :title="$t(\'ui.chat.close_panel\')" @click="closePanel"><app-icon name="close"></app-icon></button>',
'    </div>',
'  </header>',
'  <div class="conversation__frame">',
'  <aside id="conversation-history" class="conversation__history" :class="{ \'conversation__history--docked\': historyDocked, \'conversation__history--overlay\': historyOverlay, \'conversation__history--open\': historyVisible }" :hidden="!historyVisible" :aria-label="$t(\'ui.chat.history_title\')">',
'    <div class="conversation__history-head">',
'      <button ref="historyNew" id="conversation-history-new" type="button" class="btn btn--secondary conversation__history-new" :disabled="historyBusy" @click="newConversationFromHistory"><app-icon name="plus"></app-icon><span>{{ $t(\'ui.chat.session_new\') }}</span></button>',
'      <button v-if="historyOverlay" id="conversation-history-close" type="button" class="icon-button" :aria-label="$t(\'ui.chat.history_hide\')" @click="closeHistory"><app-icon name="close"></app-icon></button>',
'    </div>',
'    <p v-if="savedSessions.length === 0 && sessionsLoading" class="conversation__meta conversation__history-status" role="status">{{ $t(\'ui.chat.sessions_loading\') }}</p>',
'    <div v-if="sessionsError" class="conversation__history-status">',
'      <p class="conversation__error" role="alert">{{ sessionsError }}</p>',
'      <button id="conversation-history-retry" type="button" class="btn btn--ghost btn--small" :disabled="sessionsLoading" @click="loadSavedSessions">{{ $t(\'ui.chat.sessions_retry\') }}</button>',
'    </div>',
'    <p v-else-if="!sessionsLoading && savedSessions.length === 0" class="conversation__meta conversation__history-status">{{ $t(\'ui.chat.history_empty\') }}</p>',
'    <nav v-if="savedSessions.length" class="conversation__history-list" :aria-label="$t(\'ui.chat.history_title\')">',
'      <section v-for="group in historyGroups" :key="group.key" class="conversation__history-group" :aria-labelledby="\'conversation-history-group-\' + group.key">',
'        <h2 :id="\'conversation-history-group-\' + group.key" class="conversation__history-heading">{{ historyGroupLabel(group.key) }}</h2>',
'        <ul class="conversation__history-items">',
'          <li v-for="session in group.sessions" :key="session.id" class="conversation__history-item" :class="{ \'conversation__history-item--active\': session.id === sessionId }">',
'            <template v-if="deleteCandidate !== session.id">',
'              <button :id="\'conversation-history-open-\' + session.id" type="button" class="conversation__history-open" :aria-current="session.id === sessionId ? \'true\' : null" :disabled="historyBusy || deletingSessionId === session.id" @click="openSavedSession(session.id)">',
'                <span class="conversation__history-name">{{ historyName(session) }}</span>',
'                <span class="conversation__meta">{{ historyCountText(session) }} · {{ historyDateText(session) }}</span>',
'              </button>',
'              <button :id="\'conversation-history-delete-\' + session.id" type="button" class="icon-button conversation__history-delete" :disabled="historyBusy || !!deletingSessionId" :aria-label="$t(\'ui.chat.history_delete\', { name: historyName(session) })" :title="$t(\'ui.chat.history_delete\', { name: historyName(session) })" @click="requestDeleteSession(session.id)"><app-icon name="trash"></app-icon></button>',
'            </template>',
'            <div v-else class="conversation__history-confirm" role="group" :aria-label="$t(\'ui.chat.history_confirm_question\', { name: historyName(session) })">',
'              <p class="conversation__history-confirm-text">{{ $t(\'ui.chat.history_confirm_question\') }}</p>',
'              <div class="conversation__history-confirm-actions">',
'                <button :id="\'conversation-history-confirm-\' + session.id" type="button" class="btn btn--danger btn--small" :disabled="deletingSessionId === session.id" @click="confirmDeleteSession(session.id)">{{ deletingSessionId === session.id ? $t(\'ui.chat.history_deleting\') : $t(\'ui.chat.history_delete_confirm\') }}</button>',
'                <button type="button" class="btn btn--ghost btn--small" :disabled="deletingSessionId === session.id" @click="cancelDeleteSession">{{ $t(\'ui.chat.history_delete_cancel\') }}</button>',
'              </div>',
'            </div>',
'          </li>',
'        </ul>',
'      </section>',
'    </nav>',
'  </aside>',
'  <button v-if="historyOverlay && historyVisible" id="conversation-history-backdrop" type="button" class="conversation__history-backdrop" :aria-label="$t(\'ui.chat.history_hide\')" tabindex="-1" @click="closeHistory"></button>',
'  <div class="conversation__main">',
'  <div class="conversation__body">',
      '  <p v-if="agentEnginesLoading" class="conversation__meta" role="status">{{ $t(\'ui.chat.engines_loading\') }}</p>',
      '  <p v-if="agentEnginesError" class="conversation__error" role="alert">{{ agentEnginesError }}</p>',
      '  <p v-if="hasPendingAttachments" id="conversation-attachment-lock" class="conversation__help" role="status">{{ $t(\'ui.chat.attachment_lock\') }}</p>',
      '  <ul v-if="agentDiscoveryErrors.length" class="conversation__errors" role="alert" :aria-label="$t(\'ui.chat.discovery_errors_aria\')">',
      '    <li v-for="failure in agentDiscoveryErrors" :key="failure.id" class="conversation__error">{{ failure.label }}: {{ failure.error }}</li>',
      '  </ul>',
      '  <p v-if="agentSelectionNotice" class="conversation__help" role="status">{{ agentSelectionNotice }}</p>',
'  <div class="conversation__log" ref="log" role="log" aria-live="polite" aria-relevant="additions text" @click="handleLogClick">',
'    <div v-if="!hasMessages && !busy && !streaming" class="conversation__welcome">',
'      <p class="conversation__welcome-title">{{ $t(\'ui.chat.welcome_greeting\') }}</p>',
'      <p v-if="welcomeModelName" class="conversation__welcome-model"><span class="sr-only">{{ $t(\'ui.chat.welcome_model_label\') }}: </span>{{ welcomeModelName }}</p>',
'      <div v-if="setupNoticeVisible" class="conversation__setup" role="status">',
'        <p class="conversation__setup-text">{{ $t(\'ui.chat.setup_notice\') }}</p>',
'        <button v-if="canConfigureChat" type="button" class="btn btn--secondary btn--small" :disabled="busy" @click="openChatConfig">{{ $t(\'ui.chat.setup_action\') }}</button>',
'      </div>',
'      <ul class="conversation__suggestions" :aria-label="$t(\'ui.chat.suggestions_aria\')">',
'        <li v-for="suggestion in suggestionPrompts" :key="suggestion.id">',
'          <button type="button" class="conversation__suggestion" :disabled="!engineReady || busy || resuming || sessionRunning" @click="applySuggestion(suggestion.text)">{{ suggestion.label }}</button>',
'        </li>',
'      </ul>',
'    </div>',
'    <template v-for="(message, index) in messages" :key="index">',
'      <article v-if="message.role === &quot;user&quot;" class="conversation__turn conversation__turn--user">',
'        <p class="sr-only conversation__role">{{ $t(\'ui.chat.role_user\') }}</p>',
'        <div class="conversation__bubble">',
'          <p class="conversation__text">{{ message.content }}</p>',
'        <ul v-if="message.attachments && message.attachments.length" class="conversation__attachment-list" :aria-label="$t(\'ui.chat.message_attachments_aria\')">',
'          <li v-for="attachment in message.attachments" :key="attachment.id" class="conversation__attachment">',
'            <span class="conversation__attachment-name">{{ attachment.filename }}</span>',
'            <span class="conversation__meta">{{ attachmentKindLabel(attachment.kind) }} · {{ attachmentSizeText(attachment) }}</span>',
'          </li>',
'        </ul>',
'        </div>',
'      </article>',
'      <article v-else class="conversation__turn conversation__turn--assistant">',
'        <span class="conversation__avatar" aria-hidden="true"><app-icon name="activity"></app-icon></span>',
'        <div class="conversation__agent">',
'          <p class="conversation__agent-name">{{ agentMessageName() }}<span class="sr-only conversation__role"> · {{ $t(\'ui.chat.role_agent\') }}</span></p>',
'          <p v-if="message.streaming && !message.content" class="conversation__typing" role="status" :aria-label="$t(\'ui.chat.receiving\')"><span class="conversation__dot"></span><span class="conversation__dot"></span><span class="conversation__dot"></span></p>',
'          <div v-else class="conversation__markdown" v-html="messageHtml(message)"></div>',
  '        <ul v-if="message.attachments && message.attachments.length" class="conversation__attachment-list" :aria-label="$t(\'ui.chat.message_attachments_aria\')">',
  '          <li v-for="attachment in message.attachments" :key="attachment.id" class="conversation__attachment">',
  '            <span class="conversation__attachment-name">{{ attachment.filename }}</span>',
  '            <span class="conversation__meta">{{ attachmentKindLabel(attachment.kind) }} · {{ attachmentSizeText(attachment) }}</span>',
  '          </li>',
  '        </ul>',
'          <div class="conversation__message-actions">',
'            <button type="button" class="conversation__action-btn" :aria-label="$t(\'ui.chat.copy_message\')" :title="$t(\'ui.chat.copy_message\')" @click="copyMessage(index, $event)"><app-icon name="copy"></app-icon></button>',
'            <button v-if="retryable && !busy && index === messages.length - 1" type="button" class="conversation__action-btn" :aria-label="$t(\'ui.chat.retry_message\')" :title="$t(\'ui.chat.retry_message\')" @click="retryLastMessage"><app-icon name="refresh"></app-icon></button>',
'          </div>',
'        </div>',
'      </article>',
'    </template>',
'    <div v-if="tools.length || actions.length || results.length || extensionReviews.length" class="conversation__activity">',
'      <span class="conversation__avatar conversation__avatar--spacer" aria-hidden="true"></span>',
'      <details class="conversation__details">',
'      <summary class="conversation__details-summary">{{ $t(\'ui.chat.tools_used\', { count: tools.length + actions.length }) }}</summary>',
      '  <section v-if="extensionReviews.length" id="conversation-extension-reviews" class="conversation__section" aria-labelledby="conversation-extension-reviews-title">',
      '    <h2 id="conversation-extension-reviews-title" class="conversation__heading">{{ $t(\'ui.chat.reviews_title\') }}</h2>',
      '    <ul class="conversation__actions">',
      '      <li v-for="review in extensionReviews" :key="review.candidateId" class="conversation__action">',
      '        <a :id="\'conversation-extension-review-\' + review.candidateId" class="conversation__result-link" :href="review.href">{{ $t(\'ui.chat.review_link\', { extension: review.extensionId, version: review.version }) }}</a>',
      '        <span class="conversation__meta">SHA-256: {{ review.digest }}</span>',
      '      </li>',
      '    </ul>',
      '  </section>',
      '  <section v-if="tools.length" class="conversation__section" aria-labelledby="conversation-tools">',
      '    <h2 id="conversation-tools" class="conversation__heading">{{ $t(\'ui.chat.tools_title\') }}</h2>',
      '    <ul class="conversation__actions">',
      '      <li v-for="(tool, index) in tools" :key="index" class="conversation__action">',
      '        <span class="conversation__action-tool">{{ tool.tool }}</span>',
      '        <span class="status-pill" :class="\'status--\' + toolTone(tool.status)">{{ toolStatusLabel(tool.status) }}</span>',
      '        <p v-if="tool.output" class="conversation__meta">{{ tool.output }}</p>',
      '      </li>',
      '    </ul>',
      '  </section>',
      '  <section v-if="actions.length" class="conversation__section" aria-labelledby="conversation-actions">',
      '    <h2 id="conversation-actions" class="conversation__heading">{{ $t(\'ui.chat.actions_title\') }}</h2>',
      '    <ul class="conversation__actions">',
      '      <li v-for="(action, index) in actions" :key="index" class="conversation__action">',
      '        <span class="conversation__action-tool">{{ action.tool }}</span>',
      '        <span class="status-pill" :class="\'status--\' + action.tone">{{ actionStatusLabel(action.status) }}</span>',
      '      </li>',
      '    </ul>',
      '  </section>',
      '  <section v-if="results.length" class="conversation__section" aria-labelledby="conversation-results">',
      '    <h2 id="conversation-results" class="conversation__heading">{{ $t(\'ui.chat.results_title\') }}</h2>',
      '    <ul class="conversation__results">',
      '      <li v-for="result in results" :key="result.id" class="conversation__result">',
      '        <a class="conversation__result-link" :href="assetHref(result.id)">{{ resultName(result) }}</a>',
      '        <span class="conversation__meta">{{ resultMeta(result) }}</span>',
      '        <span class="conversation__meta">· {{ resultStatus(result) }}</span>',
      '      </li>',
      '    </ul>',
      '  </section>',
'      </details>',
'    </div>',
'    <p v-if="busy && !streaming" class="conversation__pending" role="status">{{ $t(\'ui.chat.preparing\') }}</p>',
'    <p v-if="streaming" class="conversation__pending" role="status">{{ $t(\'ui.chat.receiving\') }}</p>',
'  </div>',
      '  <div v-if="error" id="conversation-error" class="conversation__error-box">',
      '    <p class="conversation__error" role="alert">{{ error }}</p>',
      '    <p v-if="retryable && !busy" class="conversation__help">{{ $t(\'ui.chat.retry_help\') }}</p>',
      '    <button v-if="canReconnect" type="button" class="btn btn--secondary btn--small" :disabled="reconnecting" @click="reconnectSession">{{ reconnecting ? $t(\'ui.chat.consulting\') : $t(\'ui.chat.reconnect\') }}</button>',
      '  </div>',
      '  <p v-if="streamStatus" class="conversation__help" role="status">{{ streamStatus }}</p>',
      '  <p v-if="approvalPending" class="conversation__approval" role="status">{{ $t(\'ui.chat.approval_pending\') }}</p>',
      '  <button v-if="currentContextAsset" id="conversation-use-asset" type="button" class="btn btn--secondary btn--small" :disabled="busy" @click="useCurrentAsset">{{ $t(\'ui.chat.use_asset\', { name: currentContextAsset.name || currentContextAsset.id }) }}</button>',
      '  <p v-if="demoAlertContext" class="conversation__help">{{ $t(\'ui.chat.demo_alert\') }}</p>',
      '  <div v-if="canAttachFiles && contextAssetId()" class="conversation__context conversation__asset-attachments">',
      '    <span class="conversation__label">{{ $t(\'ui.chat.asset_attachments_label\') }}</span>',
      '    <button id="conversation-load-asset-attachments" type="button" class="btn btn--secondary btn--small" :disabled="assetAttachmentsLoading || busy" @click="loadAssetAttachments">{{ assetAttachmentsLoading ? $t(\'ui.chat.consulting\') : $t(\'ui.chat.asset_attachments_load\') }}</button>',
      '    <p v-if="assetAttachmentsError" class="conversation__error" role="alert">{{ assetAttachmentsError }}</p>',
      '    <p v-if="assetAttachmentsLoaded && assetAttachmentsTotal > 0" class="conversation__meta">{{ assetAttachmentsCountText() }}</p>',
      '    <p v-if="assetAttachmentsLoaded && assetAttachmentsTotal === 0" class="conversation__help" role="status">{{ $t(\'ui.chat.asset_attachments_empty\') }}</p>',
      '    <ul v-if="assetAttachments.length" class="conversation__attachment-list" :aria-label="$t(\'ui.chat.asset_attachments_aria\')">',
      '      <li v-for="item in assetAttachments" :key="item.id" class="conversation__attachment">',
      '        <input :id="\'conversation-asset-attachment-\' + item.id" type="checkbox" :checked="selectedAssetAttachmentIds.includes(item.id)" :disabled="busy" @change="toggleAssetAttachment(item.id, $event)">',
      '        <label :for="\'conversation-asset-attachment-\' + item.id" class="conversation__attachment-name">{{ item.filename }}</label>',
      '        <span class="conversation__meta">{{ attachmentKindLabel(item.kind) }} · {{ attachmentSizeText(item) }}</span>',
      '      </li>',
      '    </ul>',
      '  </div>',
      '  </div>',
      '  <form id="conversation-form" class="conversation__form" @submit.prevent="send">',
      '    <label class="sr-only" for="conversation-input">{{ $t(\'ui.chat.message_label\') }}</label>',
      '    <p v-if="attachmentBusy" class="conversation__meta" role="status">{{ $t(\'ui.chat.attaching\') }}</p>',
      '    <p v-if="attachmentError" class="conversation__error" role="alert">{{ attachmentError }}</p>',
      '    <ul v-if="attachments.length || selectedContextAsset" class="conversation__attachment-list conversation__chips" :aria-label="$t(\'ui.chat.pending_attachments_aria\')">',
      '      <li v-if="selectedContextAsset" class="conversation__attachment conversation__chip">',
      '        <app-icon name="pin"></app-icon>',
      '        <span class="conversation__attachment-name conversation__chip-name">{{ selectedContextAsset.name }}</span>',
      '        <span v-if="selectedContextAsset.quickCode" class="conversation__meta">{{ selectedContextAsset.quickCode }}</span>',
      '        <button id="conversation-context-remove" type="button" class="conversation__chip-remove" :disabled="busy" :aria-label="$t(\'ui.chat.remove_context\')" @click="clearContextAsset"><app-icon name="close"></app-icon></button>',
      '      </li>',
      '      <li v-for="item in attachments" :key="item.id" class="conversation__attachment conversation__chip">',
      '        <span class="conversation__attachment-name conversation__chip-name">{{ item.filename }}</span>',
      '        <span class="conversation__meta">{{ attachmentKindLabel(item.kind) }} · {{ attachmentSizeText(item) }}</span>',
      '        <button :id="\'conversation-attachment-remove-\' + item.id" type="button" class="conversation__chip-remove" :disabled="attachmentBusy || busy" :aria-label="$t(\'ui.chat.remove_attachment\', { filename: item.filename })" @click="removeAttachment(item.id)"><app-icon name="close"></app-icon></button>',
      '      </li>',
      '    </ul>',
      '    <div class="conversation__field">',
      '      <textarea id="conversation-input" ref="input" v-model="draft" rows="1" :maxlength="maxMessageLength" :disabled="busy || resuming" :placeholder="$t(\'ui.chat.message_placeholder\')" @keydown="handleComposerKeydown"></textarea>',
      '      <div class="conversation__form-actions">',
      '        <span v-if="canAttachFiles" class="conversation__composer-tools">',
      '          <button id="conversation-attach" type="button" class="conversation__tool-btn" :disabled="busy || attachmentBusy || attachmentsFull" aria-describedby="conversation-attachment-help" :title="attachmentHelp" @click="openAttachmentPicker"><app-icon name="plus"></app-icon><span class="sr-only">{{ $t(\'ui.chat.attachments_label\') }}</span></button>',
      '          <input id="conversation-attachment" ref="attachmentInput" class="sr-only" type="file" :multiple="true" :accept="attachmentAccept" :disabled="busy || attachmentBusy || attachmentsFull" tabindex="-1" aria-hidden="true" @change="attachFiles($event)">',
      '          <span id="conversation-attachment-help" class="sr-only">{{ attachmentHelp }}</span>',
      '        </span>',
      '        <span v-if="assetContextOptions.length" class="conversation__context conversation__context--composer">',
      '          <label class="sr-only" for="conversation-asset">{{ $t(\'ui.chat.context_label\') }}</label>',
      '          <select id="conversation-asset" v-model="selectedAssetId" :disabled="busy" class="conversation__select conversation__select--composer">',
      '            <option value="">{{ $t(\'ui.chat.context_none\') }}</option>',
      '            <option v-for="asset in assetContextOptions" :key="asset.id" :value="asset.id">{{ asset.name }}<template v-if="asset.quickCode"> · {{ asset.quickCode }}</template></option>',
      '          </select>',
      '        </span>',
      '        <span class="conversation__form-buttons">',
      '          <button v-if="canCancel" id="conversation-cancel" type="button" class="conversation__round-btn conversation__round-btn--stop" :disabled="cancelPending" :aria-label="cancelPending ? $t(\'ui.chat.cancelling\') : $t(\'ui.chat.cancel\')" @click="cancelRun"><app-icon name="stop"></app-icon><span class="sr-only">{{ cancelPending ? $t(\'ui.chat.cancelling\') : $t(\'ui.chat.cancel\') }}</span></button>',
      '          <button v-else id="conversation-send" type="submit" class="conversation__round-btn conversation__round-btn--send" :disabled="!canSend" :title="sendBlockedReason || null" :aria-describedby="sendBlockedReason ? \'conversation-send-reason\' : null" :aria-label="busy ? $t(\'ui.chat.sending\') : $t(\'ui.chat.send\')"><app-icon name="send"></app-icon><span class="sr-only">{{ busy ? $t(\'ui.chat.sending\') : $t(\'ui.chat.send\') }}</span></button>',
'          <span v-if="sendBlockedReason" id="conversation-send-reason" class="sr-only">{{ sendBlockedReason }}</span>',
      '        </span>',
      '      </div>',
      '    </div>',
      '    <p v-if="sessionAttachmentCount" class="conversation__meta conversation__composer-note">{{ $t(\'ui.chat.session_attachments\', { count: sessionAttachmentCount, max: maxSessionAttachments }) }}</p>',
      '  </form>',
'  </div>',
'  </div>',
'  </div>',
      '</section>',
      '</div>'
    ].join('\n')
  };
})();
