/* Focused conversational surface for the inventory agent.
 *
 * The browser only transports the message, the previous turns (bounded), the
 * chosen engine/model and an explicitly selected permanent asset id. Provider
 * URLs and credentials stay on the server; streaming frames are parsed but no
 * business operation is inferred here and nothing is rendered as raw HTML.
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
  const NO_ENGINE = 'No hay un motor habilitado. Elige una instancia en Configuración → IA.';
  const NO_MODEL = 'La instancia seleccionada no ofrece modelos disponibles. Elige otro motor.';
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

  const TOOL_LABELS = {
    running: 'En curso',
    pending: 'En curso',
    completed: 'Completada',
    failed: 'Fallida',
    denied: 'Denegada'
  };

  const TOOL_TONES = {
    running: 'hold',
    pending: 'hold',
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

  function numericOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function toolTone(status) {
    return TOOL_TONES[status] || 'hold';
  }

  window.AssetConversation = {
    name: 'AssetConversation',
    components: { AppIcon: window.AppIcon },
    mixins: []
      .concat(window.AssetAgentEngineMixin ? [window.AssetAgentEngineMixin] : [])
      .concat(window.AssetAgentQuotaMixin ? [window.AssetAgentQuotaMixin] : []),
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
        disposed: false,
        epoch: 0,
        legacyFallback: false,
        sessionId: '',
        sessionInstanceId: '',
        sessionModel: '',
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
        lastModuleRoute: { name: 'panel' },
        savedSessions: [],
        sessionsLoading: false,
        sessionsError: '',
        resuming: false,
        selecting: false,
        sessionRunning: false,
        retainedAsset: null,
      };
    },
    computed: {
      authenticated() {
        return !!this.app.authenticated;
      },
      maxMessageLength() {
        return MAX_MESSAGE;
      },
      useAgentSessions() {
        return !this.legacyFallback && this.agentEnginesAvailable;
      },
      engineReady() {
        if (this.legacyFallback) return true;
        if (!this.agentEnginesLoaded) return false;
        return !!(this.agentActiveInstance && this.agentPreference.model);
      },
      canSend() {
        return !this.busy && !this.resuming && !this.selecting && !this.sessionRunning && this.draft.trim().length > 0 && this.engineReady;
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
      isConversationRoute() {
        return !!(this.app.route && this.app.route.name === 'conversation');
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
    beforeUnmount() {
      this.disposed = true;
      this.resetSurface();
      if (document.removeEventListener) document.removeEventListener('keydown', this.handleChatKeydown);
    },
    methods: {
      applyAgentEngines(payload) {
        // A resumed conversation owns its current selection. The independent
        // saved preference still supplies the default for a new conversation.
        const active = this.sessionId ? { instanceId: this.sessionInstanceId, model: this.sessionModel } : null;
        window.AssetAgentEngineMixin.methods.applyAgentEngines.call(this, payload, { preserveSelection: active });
      },
      async openPanel(event) {
        if (!this.canUseConversation) return false;
        this.opener = (event && event.currentTarget) || this.$refs.opener || null;
        this.panelOpen = true;
        if (!this.busy) void this.loadEnginesForChat();
        await this.$nextTick();
        if (this.surfaceVisible && this.$refs.input) this.$refs.input.focus();
        return true;
      },
      closePanel() {
        this.panelOpen = false;
        const opener = this.opener || this.$refs.opener;
        void this.$nextTick(() => {
          if (this.authenticated && opener && typeof opener.focus === 'function') opener.focus();
        });
      },
      handleChatKeydown(event) {
        if (event.key !== 'Escape' || !this.panelOpen || this.isConversationRoute) return;
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
        else this.error = (this.app.inventoryDetail && this.app.inventoryDetail.error) || 'El activo en contexto no está disponible en el servidor.';
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
          if (this.isCurrent(epoch)) this.sessionsError = error.serverMessage || error.message || 'No se pudieron consultar tus conversaciones.';
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
          if (!session || session.id !== id) throw new Error('El servidor no devolvió la conversación seleccionada.');
          this.startNewSession();
          this.sessionId = id;
          this.applySessionSnapshot(session);
          this.agentPreference = { instanceId: this.sessionInstanceId, model: this.sessionModel };
          this.selectedAssetId = isPermanentId(session.assetId) ? session.assetId : '';
          this.draft = '';
          this.error = '';
          return true;
        } catch (error) {
          if (this.isCurrent(epoch) && error.name !== 'AbortError') this.sessionsError = error.serverMessage || error.message || 'No se pudo abrir la conversación.';
          return false;
        } finally {
          if (this.isCurrent(epoch)) { this.resuming = false; this.request = null; }
        }
      },
      savedSessionLabel(session) {
        return session.title || session.preview || ('Conversación · ' + (session.updatedAt || session.createdAt || session.id));
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
        this.resetQuota();
        this.agentEpoch += 1;
        this.agentPreferenceEpoch += 1;
        this.panelOpen = false;
        this.opener = null;
        this.lastModuleRoute = { name: 'panel' };
        this.savedSessions = [];
        this.sessionsLoading = false;
        this.sessionsError = '';
        this.resuming = false;
        this.selecting = false;
        this.sessionRunning = false;
        this.retainedAsset = null;
        this.cancelRequest();
        this.messages = [];
        this.draft = '';
        this.error = '';
        this.actions = [];
        this.results = [];
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
        void this.loadQuota();
        const loaded = await discovery;
        if (!this.isCurrent(epoch)) return false;
        if (!loaded) {
          this.legacyFallback = !this.agentEnginesAvailable;
          return false;
        }
        this.legacyFallback = false;
        if (!this.sessionsLoading) void this.loadSavedSessions();
        return true;
      },
      contextAssetId() {
        const id = this.selectedAssetId;
        if (!isPermanentId(id)) return '';
        const known = this.assetContextOptions.some((asset) => asset.id === id);
        return known ? id : '';
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
        return (Array.isArray(list) ? list : []).filter((asset) => asset && typeof asset.id === 'string' && asset.id);
      },
      async send() {
        const message = this.draft.trim();
        if (!message || this.busy || this.resuming || this.selecting || this.sessionRunning || this.disposed) return false;
        if (!this.app.authenticated) {
          this.error = EXPIRED;
          return false;
        }
        if (message.length > MAX_MESSAGE) {
          this.error = MAX_MESSAGE_ERROR;
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
          if (error && error.status === 503) this.error = error.serverMessage || UNAVAILABLE;
          else if (error && error.status === 401) this.error = EXPIRED;
          else this.error = (error && (error.serverMessage || error.message)) || 'No se pudo enviar el mensaje al agente.';
          return false;
        } finally {
          if (requestId === this.requestId) {
            this.busy = false;
            this.request = null;
            if (!this.disposed) void this.loadQuota();
          }
        }
      },
      async sendSession(message) {
        const instance = this.agentActiveInstance;
        if (!instance || instance.enabled === false) {
          this.error = NO_ENGINE;
          return false;
        }
        const model = this.agentPreference.model;
        if (!model) {
          this.error = NO_MODEL;
          return false;
        }
        const assetId = this.contextAssetId();
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
        try {
          await this.ensureSession(instance, model, this.history(), assetId, epoch, controller ? controller.signal : undefined);
          if (!this.isCurrent(epoch)) return false;
          if (this.cancelRequested) {
            this.streamStatus = 'Solicitud cancelada.';
            return false;
          }
          this.messages.push({ role: 'user', content: message });
          this.draft = '';
          this.streaming = true;
          const body = { message };
          if (assetId) body.assetId = assetId;
          const frames = window.AssetAgentApi.streamMessage(this.app, this.sessionId, body, {
            signal: controller ? controller.signal : undefined
          });
          for await (const event of frames) {
            if (!this.isCurrent(epoch)) return false;
            if (this.applyAgentEvent(event)) {
              done = true;
              break;
            }
          }
          if (!this.isCurrent(epoch)) return false;
          if (!done && !this.error) this.streamStatus = 'La conexión terminó sin un evento de cierre.';
          this.finishStreamingMessage();
          return true;
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          if (error && error.name === 'AbortError') return false;
          if (error && error.status === 401) this.error = EXPIRED;
          else if (error && (error.status === 503 || error.status === 429)) this.error = error.serverMessage || error.message;
          else if (error && error.status === 409) this.error = (error.serverMessage || error.message) + ' La ejecución anterior sigue activa; puedes cancelarla o reconectar sin reenviar el mensaje.';
          else this.error = (error && (error.serverMessage || error.message)) || 'No se pudo enviar el mensaje al motor.';
          this.retryable = !!(error && (error.status === 503 || error.status === 429 || error.status === 0 || !error.status));
          this.finishStreamingMessage();
          return false;
        } finally {
          if (this.isCurrent(epoch)) {
            this.busy = false;
            this.streaming = false;
            this.request = null;
            void this.loadQuota();
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
        await this.persistAgentPreference(instance.id, model);
        if (!this.isCurrent(epoch)) return;
        if (signal && signal.aborted) {
          const aborted = new Error('Cancelada');
          aborted.name = 'AbortError';
          throw aborted;
        }
        const body = { instanceId: instance.id, model };
        if (context.length) body.context = context;
        if (assetId) body.assetId = assetId;
        const session = await window.AssetAgentApi.createSession(this.app, body, { signal });
        if (!this.isCurrent(epoch)) return;
        if (!session || !session.id) throw new Error('El servidor no devolvió la sesión creada.');
        this.sessionId = session.id;
        this.sessionInstanceId = session.instanceId || instance.id;
        this.sessionModel = session.model || model;
      },
      startNewSession() {
        this.sessionId = '';
        this.sessionInstanceId = '';
        this.sessionModel = '';
        this.tools = [];
        this.usage = null;
        this.actions = [];
        this.results = [];
        this.approvalPending = false;
        this.sessionRunning = false;
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
      async changeSelection(instance, model) {
        if (this.busy || this.resuming || this.selecting || this.sessionRunning) return false;
        if (this.sessionId && !model) {
          this.agentSelectionNotice = 'La instancia seleccionada no anunció modelos. La conversación actual no ha cambiado.';
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
          }
          this.agentPreference = { instanceId: instance.id, model };
          await this.persistAgentPreference(instance.id, model);
          if (!this.isCurrent(epoch)) return false;
          if (!model) this.agentSelectionNotice = 'La instancia seleccionada no anunció modelos. Revisa su conexión o elige otro motor antes de conversar.';
          return true;
        } catch (error) {
          if (this.isCurrent(epoch) && error.name !== 'AbortError') this.error = error.status === 401 ? EXPIRED : (error.serverMessage || error.message || 'No se pudo cambiar el motor o modelo.');
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
          this.streamStatus = 'Solicitud cancelada.';
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
              : 'El motor no permite interrumpir la ejecución.';
            this.streamStatus = this.cancelReason;
            return false;
          }
          return true;
        } catch (error) {
          if (!this.isCurrent(epoch)) return false;
          this.cancelPending = false;
          this.error = (error && error.message) || 'No se pudo cancelar la ejecución.';
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
          this.error = (error && error.message) || 'No se pudo consultar el estado de la sesión.';
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
            .map((message) => ({ role: message.role, content: message.content }));
        }
        if (Array.isArray(payload.actions)) this.actions = this.mapActions(payload.actions);
        if (Array.isArray(payload.results)) this.results = this.mapResults(payload.results);
        if (typeof payload.approvalPending === 'boolean') this.approvalPending = payload.approvalPending;
        if (typeof payload.model === 'string') this.sessionModel = payload.model;
        if (typeof payload.instanceId === 'string') this.sessionInstanceId = payload.instanceId;
        if (payload.status === 'running') this.streamStatus = 'El servidor indica una ejecución en curso.';
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
            : 'El motor informó un error durante la ejecución.';
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
        if (event.cancelled === true) this.streamStatus = 'Ejecución cancelada.';
        else if (wasPending && this.cancelReason) this.streamStatus = this.cancelReason;
        else if (this.error) this.streamStatus = 'La ejecución terminó con un error informado por el motor.';
      },
      applyToolEvent(event) {
        const tool = typeof event.tool === 'string' && event.tool.trim() ? event.tool.trim() : 'herramienta';
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
        return TOOL_LABELS[status] || 'Registrada';
      },
      toolTone(status) {
        return toolTone(status);
      },
      tokenCount(value) {
        return value === null || value === undefined ? 'no disponible' : Number(value).toLocaleString('es-ES');
      },
      usagePrecisionLabel() {
        if (!this.usage) return '';
        if (this.usage.precision === 'measured') return 'medido';
        if (this.usage.precision === 'estimated') return 'estimado';
        return 'no disponible';
      },
      usageSourceLabel() {
        if (!this.usage) return '';
        if (this.usage.source === 'provider') return 'proveedor';
        if (this.usage.source === 'engine') return 'motor';
        if (this.usage.source === 'estimate') return 'estimación';
        return 'no disponible';
      },
      usageInclusionLabel(value) {
        return value === true ? 'sí' : (value === false ? 'no' : 'no disponible');
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
      '<div class="conversation-host" :class="{ \'conversation-host--full\': isConversationRoute }">',
      '  <button v-if="canUseConversation && !isConversationRoute" id="conversation-opener" ref="opener" type="button" class="btn btn--secondary conversation-opener" :aria-label="panelOpen ? \'Cerrar conversación\' : \'Abrir conversación\'" aria-controls="conversation-surface" :aria-expanded="panelOpen" @click="panelOpen ? closePanel() : openPanel($event)"><app-icon name="send"></app-icon> Conversación<span v-if="busy" class="sr-only"> · Respuesta en curso</span></button>',
      '<section id="conversation-surface" class="conversation" :class="{ \'conversation--compact\': !isConversationRoute }" :hidden="!surfaceVisible" aria-labelledby="conversation-title">',
      '  <header class="page-head conversation__head">',
      '    <div>',
      '      <p class="eyebrow">Asistente de inventario</p>',
      '      <h1 v-if="isConversationRoute" id="conversation-title">Conversación</h1>',
      '      <h2 v-else id="conversation-title">Conversación</h2>',
      '      <p v-if="isConversationRoute" class="page-sub">Consulta o cambia activos del inventario. El servidor decide qué operaciones ejecutar y pide los datos que falten.</p>',
      '    </div>',
      '    <div class="conversation__window-actions">',
      '      <button v-if="!isConversationRoute" id="conversation-expand" type="button" class="btn btn--ghost btn--small" @click="expandConversation">Ampliar conversación</button>',
      '      <button v-else id="conversation-collapse" type="button" class="btn btn--ghost btn--small" @click="collapseConversation">Volver al chat compacto</button>',
      '      <button v-if="!isConversationRoute" type="button" class="icon-button" aria-label="Cerrar conversación" @click="closePanel"><app-icon name="close"></app-icon></button>',
      '    </div>',
      '  </header>',
      '  <div class="conversation__body">',
      '  <div v-if="useAgentSessions" class="conversation__field">',
      '    <label class="conversation__label" for="conversation-session">Tus conversaciones</label>',
      '    <select id="conversation-session" class="conversation__select" :value="sessionId" :disabled="busy || selecting || resuming || sessionsLoading" @change="resumeSession($event.target.value)">',
      '      <option value="">Nueva conversación</option>',
      '      <option v-if="sessionId && !savedSessions.some(item => item.id === sessionId)" :value="sessionId">Conversación actual</option>',
      '      <option v-for="session in savedSessions" :key="session.id" :value="session.id">{{ savedSessionLabel(session) }}</option>',
      '    </select>',
      '    <p v-if="sessionsLoading || resuming" class="conversation__help" role="status">Consultando conversaciones…</p>',
      '    <p v-if="sessionsError" class="conversation__error" role="alert">{{ sessionsError }}</p>',
      '    <button v-if="sessionsError" type="button" class="btn btn--ghost btn--small" @click="loadSavedSessions">Volver a consultar conversaciones</button>',
      '  </div>',
      '  <section v-if="!legacyFallback" class="conversation__engine" aria-labelledby="conversation-engine-title">',
      '    <div class="conversation__engine-head">',
      '      <h2 id="conversation-engine-title" class="conversation__heading">Motor y modelo</h2>',
      '      <span v-if="agentEnginesLoading" class="conversation__meta" role="status">Consultando motores…</span>',
      '    </div>',
      '    <p v-if="agentEnginesError" class="conversation__error" role="alert">{{ agentEnginesError }}</p>',
      '    <div v-if="agentInstanceList.length" class="conversation__engine-grid">',
      '      <div class="conversation__field">',
      '        <label class="conversation__label" for="conversation-engine">Motor</label>',
      '        <select id="conversation-engine" class="conversation__select" :value="agentEngineValue" :disabled="busy || selecting || resuming || sessionRunning" @change="changeEngineChoice($event)">',
      '          <option v-for="choice in agentEngineChoices" :key="choice.value" :value="choice.value" :disabled="choice.disabled">{{ choice.label }}{{ choice.disabled ? \' · Deshabilitada\' : \'\' }}</option>',
      '        </select>',
      '      </div>',
      '      <div v-if="agentProfileSelectorVisible" class="conversation__field">',
      '        <label class="conversation__label" for="conversation-profile">Perfil</label>',
      '        <select id="conversation-profile" class="conversation__select" aria-describedby="conversation-profile-help" :value="agentPreference.instanceId" :disabled="busy || selecting || resuming || sessionRunning" @change="changeProfile($event)">',
      '          <option v-for="instance in agentProfileOptions" :key="instance.id" :value="instance.id" :disabled="instance.enabled === false">{{ agentProfileLabel(instance) }}{{ instance.enabled === false ? \' · Deshabilitada\' : \'\' }}</option>',
      '        </select>',
      '      </div>',
      '      <div class="conversation__field">',
      '        <label class="conversation__label" for="conversation-model">Modelo</label>',
      '        <select id="conversation-model" class="conversation__select" :value="agentPreference.model" :disabled="busy || selecting || resuming || sessionRunning || !agentModels.length" @change="changeModel($event.target.value)">',
      '          <option v-if="!agentModels.length" value="">Sin modelos anunciados</option>',
      '          <option v-for="model in agentModels" :key="model.id" :value="model.id">{{ agentModelLabel(model) }}</option>',
      '        </select>',
      '      </div>',
      '    </div>',
      '    <p v-if="agentProfileSelectorVisible" id="conversation-profile-help" class="conversation__help">Cambiar de perfil conserva los mensajes ITSM de esta conversación y reinicia solo la sesión nativa del motor. No cambia el perfil global de Hermes.</p>',
      '    <ul v-if="agentDiscoveryErrors.length" class="conversation__errors" role="alert" aria-label="Errores de descubrimiento de motores">',
      '      <li v-for="failure in agentDiscoveryErrors" :key="failure.id" class="conversation__error">{{ failure.label }}: {{ failure.error }}</li>',
      '    </ul>',
      '    <p v-if="agentSelectionNotice" class="conversation__help" role="status">{{ agentSelectionNotice }}</p>',
      '    <p v-if="agentEnginesLoaded && !agentInstanceList.length" class="conversation__help" role="status">El servidor no anunció motores de sesión. Crea una instancia en Configuración → IA para conversar.</p>',
      '    <p v-else-if="agentEnginesLoaded && !agentActiveInstance" class="conversation__help" role="status">No hay un motor habilitado. Habilita una instancia en Configuración → IA.</p>',
      '    <div v-if="agentCapabilityList.length" class="conversation__tags">',
      '      <span v-for="capability in agentCapabilityList" :key="capability.key" class="chip chip--muted">{{ capability.label }}</span>',
      '    </div>',
      '    <p v-if="agentBudgetSummary" class="conversation__usage">{{ agentBudgetSummary }}</p>',
      '  </section>',
      '  <p v-else-if="agentEnginesLoaded" class="conversation__help">El servidor no anunció motores de sesión; se usa el chat compatible del servidor.</p>',
      '  <section v-if="app.authenticated" id="conversation-quota" class="conversation__quota" aria-labelledby="conversation-quota-title">',
      '    <div class="conversation__engine-head">',
      '      <h2 id="conversation-quota-title" class="conversation__heading">Tu cuota diaria de IA</h2>',
      '      <button id="conversation-quota-refresh" type="button" class="btn btn--ghost btn--small" :disabled="quotaLoading" @click="loadQuota">{{ quotaLoading ? \'Actualizando…\' : \'Actualizar cuota\' }}</button>',
      '    </div>',
      '    <p v-if="quotaLoading && !quotaHasData" class="conversation__help" role="status">Consultando tu cuota…</p>',
      '    <p v-if="quotaError" class="conversation__error" role="alert">{{ quotaError }}</p>',
      '    <p v-if="quotaUnavailable" class="conversation__help" role="status">La cuota no está disponible en este momento; no se muestra como cero.</p>',
      '    <template v-if="quotaHasData">',
      '      <p class="conversation__meta">Día {{ quotaPeriodDay || \'no informado\' }} · Zona {{ quotaTimezone || \'no informada\' }}<template v-if="quotaPendingTimezone"> · cambio pendiente a {{ quotaPendingTimezone }} para {{ quotaPendingEffectiveDay || \'el siguiente límite seguro\' }}</template></p>',
      '      <ul class="conversation__quota-list">',
      '        <li v-for="account in quotaAccounts" :key="account.scope" class="conversation__quota-account">',
      '          <p><strong>{{ account.label }}</strong><span v-if="account.selected" class="chip chip--muted">Contexto actual</span></p>',
      '          <p class="conversation__meta">Límite: {{ quotaLimitText(account.balance) }} · {{ quotaLimitSourceLabel(account.balance && account.balance.limitSource) }}</p>',
      '          <p class="conversation__meta">Consumido: {{ quotaAmountText(account.balance && account.balance.consumed) }} · Reservado: {{ quotaAmountText(account.balance && account.balance.reserved) }} · Disponible: {{ quotaAvailableText(account.balance) }}</p>',
      '          <p class="conversation__meta">Retenciones pendientes: {{ quotaTokenText(account.balance && account.balance.pendingCount) }} · Precisión: {{ quotaPrecisionText(account.balance) }}</p>',
      '          <p class="conversation__meta">Legado sin atribuir: {{ quotaAmountText(account.balance && account.balance.legacy) }}</p>',
      '        </li>',
      '      </ul>',
      '      <p v-if="quotaSelectedNotice" class="conversation__help" role="status">{{ quotaSelectedNotice }}</p>',
      '    </template>',
      '  </section>',
      '  <div class="conversation__log" role="log" aria-live="polite" aria-relevant="additions text">',
      '    <p v-if="!hasMessages && !busy" class="conversation__empty">Todavía no hay mensajes. Escribe una consulta para empezar.</p>',
      '    <article v-for="(message, index) in messages" :key="index" class="conversation__turn" :class="\'conversation__turn--\' + message.role">',
      '      <p class="conversation__role">{{ message.role === \'user\' ? \'Tú\' : \'Agente\' }}</p>',
      '      <p class="conversation__text">{{ message.content }}<span v-if="message.streaming" class="conversation__streaming" aria-hidden="true">…</span></p>',
      '    </article>',
      '    <p v-if="busy && !streaming" class="conversation__pending" role="status">Preparando la sesión del motor…</p>',
      '    <p v-if="streaming" class="conversation__pending" role="status">Recibiendo la respuesta del agente…</p>',
      '  </div>',
      '  <div v-if="error" class="conversation__error-box">',
      '    <p class="conversation__error" role="alert">{{ error }}</p>',
      '    <p v-if="retryable && !busy" class="conversation__help">La ejecución se interrumpió; el mensaje no se reenvió automáticamente.</p>',
      '    <button v-if="canReconnect" type="button" class="btn btn--secondary btn--small" :disabled="reconnecting" @click="reconnectSession">{{ reconnecting ? \'Consultando…\' : \'Reconectar y consultar el estado\' }}</button>',
      '  </div>',
      '  <p v-if="streamStatus" class="conversation__help" role="status">{{ streamStatus }}</p>',
      '  <p v-if="approvalPending" class="conversation__approval" role="status">La última operación queda pendiente de aprobación en el servidor.</p>',
      '  <section v-if="tools.length" class="conversation__section" aria-labelledby="conversation-tools">',
      '    <h2 id="conversation-tools" class="conversation__heading">Herramientas</h2>',
      '    <ul class="conversation__actions">',
      '      <li v-for="(tool, index) in tools" :key="index" class="conversation__action">',
      '        <span class="conversation__action-tool">{{ tool.tool }}</span>',
      '        <span class="status-pill" :class="\'status--\' + toolTone(tool.status)">{{ toolStatusLabel(tool.status) }}</span>',
      '        <p v-if="tool.output" class="conversation__meta">{{ tool.output }}</p>',
      '      </li>',
      '    </ul>',
      '  </section>',
      '  <p v-if="usage" id="conversation-usage" class="conversation__usage" role="status">Última llamada · Consumo {{ usagePrecisionLabel() }} · origen: {{ usageSourceLabel() }}. Entrada: {{ tokenCount(usage.inputTokens) }} · salida: {{ tokenCount(usage.outputTokens) }} · caché leída: {{ tokenCount(usage.cacheReadTokens) }} · caché escrita: {{ tokenCount(usage.cacheWriteTokens) }} · razonamiento: {{ tokenCount(usage.reasoningTokens) }} · total: {{ tokenCount(usage.totalTokens) }}<template v-if="usage.totalSource"> ({{ usage.totalSource === \'provider\' ? \'del proveedor\' : \'derivado por el servidor\' }})</template>. Caché incluida en entrada: {{ usageInclusionLabel(usage.inputIncludesCache) }} · razonamiento incluido en salida: {{ usageInclusionLabel(usage.outputIncludesReasoning) }}.<template v-if="usage.estimationMethod"> Método de estimación: {{ usage.estimationMethod }}.</template><template v-if="usage.cost"> Coste: {{ usage.cost }}.</template> No es el total de la ejecución.</p>',
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
      '  <button v-if="currentContextAsset" id="conversation-use-asset" type="button" class="btn btn--secondary btn--small" :disabled="busy" @click="useCurrentAsset">Usar activo: {{ currentContextAsset.name || currentContextAsset.id }}</button>',
      '  <p v-if="demoAlertContext" class="conversation__help">Las alertas de demostración no se adjuntan al chat como una integración del servidor.</p>',
      '  <div v-if="assetContextOptions.length" class="conversation__context">',
      '    <label class="conversation__label" for="conversation-asset">Activo en contexto (opcional)</label>',
      '    <select id="conversation-asset" v-model="selectedAssetId" :disabled="busy" class="conversation__select">',
      '      <option value="">Sin activo seleccionado</option>',
      '      <option v-for="asset in assetContextOptions" :key="asset.id" :value="asset.id">{{ asset.name }}<template v-if="asset.quickCode"> · {{ asset.quickCode }}</template></option>',
      '    </select>',
      '    <p class="conversation__help">Se envía solo el identificador permanente del activo que elijas de la lista.</p>',
      '  </div>',
      '  </div>',
      '  <form class="conversation__form" @submit.prevent="send">',
      '    <label class="conversation__label" for="conversation-input">Mensaje</label>',
      '    <textarea id="conversation-input" ref="input" v-model="draft" rows="2" :maxlength="maxMessageLength" :disabled="busy || resuming" aria-describedby="conversation-help" placeholder="Ej.: Muéstrame los servidores de Matriz"></textarea>',
      '    <p id="conversation-help" class="conversation__help">El agente pide los datos que falten antes de cambiar un activo.</p>',
      '    <div class="conversation__form-actions">',
      '      <button type="submit" class="btn btn--primary" :disabled="!canSend">{{ busy ? \'Enviando…\' : \'Enviar\' }}</button>',
      '      <button v-if="canCancel" type="button" class="btn btn--secondary" :disabled="cancelPending" @click="cancelRun">{{ cancelPending ? \'Cancelando…\' : \'Cancelar\' }}</button>',
      '    </div>',
      '  </form>',
      '</section>',
      '</div>'
    ].join('\n')
  };
})();
