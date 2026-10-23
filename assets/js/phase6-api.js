(function () {
  'use strict';

  /* Phase 6 workflows adapter.
   *
   * One state object owns every server read and write for imports, bulk
   * operations, exports, warranties and attachments. The server is the only
   * authority: files are uploaded as bytes and parsed there, approvals are
   * human requests, and nothing is written to browser storage or resolved
   * from prototype/demo collections.
   *
   * Two monotonic counters guard client state:
   * - responseEpoch increments for every read so a superseded response can
   *   never overwrite a newer one (identity rotation, filters, pagination).
   * - sessionEpoch increments only when the adapter state is cleared, so a
   *   write that resolves after logout/user change reports cancellation and
   *   touches neither state nor toasts.
   */
  const POLL_INTERVAL = 2500;
  const DEFAULT_LIMIT = 50;
  const MAX_LIMIT = 100;
  const EXPORT_FIELDS = [
    'id',
    'quick_code',
    'name',
    'category',
    'status',
    'serial',
    'site',
    'location',
    'responsible'
  ];
  const WARRANTY_FIELDS = [
    'supplier',
    'purchaseDate',
    'durationMonths',
    'expiresOn',
    'status',
    'receiptId',
    'notes'
  ];
  const FINAL_STATES = ['complete', 'error', 'queue_error'];
  const COVERAGES = ['', 'current', 'expiring', 'expired', 'unknown'];
  const ATTACHMENT_CATEGORIES = ['photo', 'receipt', 'manual', 'document'];
  const FALLBACK_ERROR = 'No se pudo completar la solicitud.';

  let responseEpoch = 0;
  let sessionEpoch = 0;

  function nextEpoch() {
    responseEpoch += 1;
    return responseEpoch;
  }

  function nextSessionEpoch() {
    sessionEpoch += 1;
    return sessionEpoch;
  }

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function count(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, count(value, minimum)));
  }

  function makeController() {
    return typeof AbortController === 'function' ? new AbortController() : null;
  }

  function summaryOf(source) {
    const summary = source && typeof source === 'object' ? source : {};
    return {
      created: count(summary.created, 0),
      modified: count(summary.modified, 0),
      omitted: count(summary.omitted, 0),
      failed: count(summary.failed, 0)
    };
  }

  function rowOf(row) {
    const source = row && typeof row === 'object' ? row : {};
    return {
      index: count(source.index, 0),
      sheet: text(source.sheet),
      line: count(source.line, 0),
      values: source.values && typeof source.values === 'object' ? source.values : {},
      errors: Array.isArray(source.errors) ? source.errors.map(String) : [],
      assetId: text(source.assetId),
      version: text(source.version),
      classification: text(source.classification),
      candidates: Array.isArray(source.candidates) ? source.candidates.slice() : [],
      action: text(source.action),
      reason: text(source.reason),
      result: text(source.result),
      createdAssetId: text(source.createdAssetId),
      error: text(source.error)
    };
  }

  function createPage(limit) {
    return {
      items: [],
      loaded: false,
      loading: false,
      error: '',
      epoch: nextEpoch(),
      controller: null,
      hasMore: false,
      total: 0,
      offset: 0,
      limit: limit || DEFAULT_LIMIT
    };
  }

  function createResource() {
    return { loaded: false, loading: false, error: '', epoch: nextEpoch(), controller: null };
  }

  function createState() {
    return {
      identity: '',
      sessionEpoch: nextSessionEpoch(),
      profiles: Object.assign(createPage(MAX_LIMIT), { items: [] }),
      importRun: Object.assign(createResource(), { filename: '', options: {}, busy: false }),
      operation: Object.assign(createResource(), {
        id: '',
        kind: '',
        state: '',
        jobId: '',
        approved: false,
        total: 0,
        processed: 0,
        summary: summaryOf(null),
        rows: [],
        offset: 0,
        limit: 100,
        hasMore: false
      }),
      bulkRun: Object.assign(createResource(), { busy: false }),
      exportRun: Object.assign(createResource(), {
        busy: false,
        filename: 'assets.csv',
        fields: EXPORT_FIELDS.slice()
      }),
      warranties: createPage(DEFAULT_LIMIT),
      warranty: Object.assign(createResource(), { assetId: '', item: null }),
      warrantyPrefs: Object.assign(createResource(), { expiringDays: 30 }),
      attachments: Object.assign(createPage(DEFAULT_LIMIT), { assetId: '', busy: false })
    };
  }

  function isFinal(state) {
    return FINAL_STATES.indexOf(text(state)) !== -1;
  }

  // Encoding stays explicit so the same adapter runs in the browser and in the
  // Node harness, which has no URLSearchParams global.
  function query(params) {
    const parts = [];
    Object.keys(params).forEach((key) => {
      const value = params[key];
      if (value === undefined || value === null) return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function bodyWithoutEmpty(source, keys) {
    const body = {};
    keys.forEach((key) => {
      if (source[key] === undefined) return;
      const value = source[key];
      body[key] = value === '' ? null : value;
    });
    return body;
  }

  window.AssetPhase6 = {
    data() {
      return { phase6: createState(), phase6OperationPolling: false };
    },

    computed: {
      phase6Available() {
        return this.authenticated === true;
      },
      phase6CanView() {
        return this.phase6Available && !!(this.can && this.can('assets.view'));
      },
      phase6CanEdit() {
        return this.phase6Available && !!(this.can && this.can('assets.edit'));
      },
      phase6ImportProfiles() {
        return this.phase6 ? this.phase6.profiles.items : [];
      },
      phase6OperationRows() {
        return this.phase6 ? this.phase6.operation.rows : [];
      },
      phase6OperationSummary() {
        return this.phase6 ? this.phase6.operation.summary : summaryOf(null);
      },
      phase6OperationFinal() {
        return this.phase6 ? isFinal(this.phase6.operation.state) : false;
      },
      phase6ConflictRows() {
        if (!this.phase6) return [];
        return this.phase6.operation.rows.filter((row) => ['possible_duplicate', 'error'].indexOf(row.classification) !== -1);
      },
      phase6ClassificationCounts() {
        const totals = { new: 0, safe: 0, possible_duplicate: 0, error: 0, omitted: 0 };
        if (!this.phase6) return totals;
        this.phase6.operation.rows.forEach((row) => {
          if (totals[row.classification] === undefined) return;
          totals[row.classification] += 1;
        });
        return totals;
      },
      phase6WarrantyItems() {
        return this.phase6 ? this.phase6.warranties.items : [];
      },
      phase6AttachmentItems() {
        return this.phase6 ? this.phase6.attachments.items : [];
      },
      phase6ExportFields() {
        return EXPORT_FIELDS.slice();
      },
      phase6AttachmentCategories() {
        return ATTACHMENT_CATEGORIES.slice();
      },
      phase6WarrantyCoverages() {
        return COVERAGES.slice();
      }
    },

    methods: {
      /* ------------------------------------------------------ guard helpers */
      phase6Token() {
        const state = this.phase6;
        const identity = text(this.activeUserId);
        if (state) state.identity = identity;
        return {
          session: state ? state.sessionEpoch : 0,
          identity,
          authenticated: this.authenticated === true
        };
      },
      phase6TokenOpen(token) {
        return (
          !!this.phase6 &&
          this.authenticated === true &&
          token.authenticated === true &&
          this.phase6.sessionEpoch === token.session &&
          text(this.activeUserId) === token.identity
        );
      },
      /* A resource is current only while the same adapter state still owns it:
       * clearPhase6State() replaces every resource, so a late response from the
       * previous state can neither publish rows nor reset a newer flag. */
      phase6Owns(key, resource) {
        return !!this.phase6 && !!resource && this.phase6[key] === resource;
      },
      identityChangedPhase6() {
        if (!this.phase6) return false;
        if (this.phase6.identity === text(this.activeUserId)) return false;
        this.clearPhase6State();
        return true;
      },
      phase6Result(error) {
        return {
          ok: false,
          error: text(error && error.message) || FALLBACK_ERROR,
          fieldErrors: (error && error.fieldErrors) || {}
        };
      },
      phase6Announce(error) {
        if (this.showToast) this.showToast(text(error && error.message) || FALLBACK_ERROR, 'error');
      },

      /* A write reports success only while the session that started it is
       * still the open one. A request that would start after the session ended
       * is never sent, and a late response never mutates state or toasts. */
      async phase6Write(token, request, current) {
        const active = () => this.phase6TokenOpen(token) && (!current || current());
        if (!active()) return { ok: false, cancelled: true };
        try {
          const payload = await request();
          if (!active()) return { ok: false, cancelled: true };
          return { ok: true, payload };
        } catch (error) {
          if (!active()) return { ok: false, cancelled: true };
          if (error && error.name === 'AbortError') return { ok: false, cancelled: true };
          if (error && error.status === 401) {
            this.clearPhase6State();
            return { ok: false, cancelled: true };
          }
          this.phase6Announce(error);
          return this.phase6Result(error);
        }
      },

      /* Every read owns its resource epoch and controller. A superseded or
       * cancelled response is ignored without clearing the visible rows. */
      async phase6Read(key, path, options, apply) {
        const resource = this.phase6 && this.phase6[key];
        if (!resource) return false;
        const token = this.phase6Token();
        if (resource.controller) resource.controller.abort();
        const controller = makeController();
        const epoch = nextEpoch();
        resource.epoch = epoch;
        resource.controller = controller;
        resource.loading = true;
        resource.error = '';
        try {
          const payload = await window.AssetAccess.request(
            this,
            path,
            Object.assign({}, options || {}, { signal: controller ? controller.signal : undefined })
          );
          if (epoch !== resource.epoch || !this.phase6Owns(key, resource) || !this.phase6TokenOpen(token)) return false;
          apply(payload);
          resource.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== resource.epoch || !this.phase6Owns(key, resource) || !this.phase6TokenOpen(token)) return false;
          if (error && error.name === 'AbortError') return false;
          if (error && error.status === 401) {
            this.clearPhase6State();
            return false;
          }
          resource.error = text(error && error.message) || FALLBACK_ERROR;
          return false;
        } finally {
          if (epoch === resource.epoch && this.phase6Owns(key, resource)) {
            resource.loading = false;
            resource.controller = null;
          }
        }
      },

      applyPhase6Operation(payload) {
        const operation = this.phase6 && this.phase6.operation;
        if (!operation || !payload || typeof payload !== 'object') return false;
        operation.id = text(payload.id);
        operation.kind = text(payload.kind);
        operation.state = text(payload.state);
        operation.jobId = text(payload.jobId);
        operation.approved = payload.approved === true;
        operation.total = count(payload.total, 0);
        operation.processed = count(payload.processed, 0);
        operation.summary = summaryOf(payload.summary);
        operation.hasMore = payload.hasMore === true;
        if (Array.isArray(payload.rows)) operation.rows = payload.rows.map(rowOf);
        operation.loaded = true;
        operation.error = '';
        if (isFinal(operation.state)) this.stopPhase6Polling();
        return true;
      },

      stopPhase6Polling() {
        this.phase6OperationPolling = false;
        if (this.phase6PollTimer) {
          if (typeof window.clearTimeout === 'function') window.clearTimeout(this.phase6PollTimer);
          this.phase6PollTimer = null;
        }
      },

      clearPhase6State() {
        if (!this.phase6) return false;
        this.stopPhase6Polling();
        const state = this.phase6;
        [
          state.profiles,
          state.importRun,
          state.operation,
          state.bulkRun,
          state.exportRun,
          state.warranties,
          state.warranty,
          state.warrantyPrefs,
          state.attachments
        ].forEach((resource) => {
          if (resource && resource.controller) resource.controller.abort();
        });
        this.phase6 = createState();
        this.phase6.identity = text(this.activeUserId);
        return true;
      },

      /* ------------------------------------------------------------ imports */
      async loadImportProfiles() {
        if (!this.phase6CanView) return false;
        return this.phase6Read('profiles', '/import-profiles', {}, (payload) => {
          const page = this.phase6.profiles;
          page.items = (Array.isArray(payload && payload.items) ? payload.items : [])
            .filter((item) => item && item.id)
            .map((item) => ({
              id: text(item.id),
              name: text(item.name) || text(item.id),
              options: item.options && typeof item.options === 'object' ? item.options : {}
            }));
          page.total = page.items.length;
        });
      },

      async saveImportProfile(name, options, profileId) {
        if (!this.phase6CanEdit) return false;
        const label = text(name);
        if (!label) return { ok: false, error: 'Escribe un nombre para el perfil.' };
        const token = this.phase6Token();
        const body = { name: label, options: options && typeof options === 'object' ? options : {} };
        const id = text(profileId);
        const result = await this.phase6Write(token, () =>
          window.AssetAccess.request(this, '/import-profiles' + (id ? '/' + encodeURIComponent(id) : ''), {
            method: id ? 'PUT' : 'POST',
            body
          })
        );
        if (!result.ok || !result.payload) return result;
        const saved = {
          id: text(result.payload.id),
          name: text(result.payload.name) || label,
          options: result.payload.options && typeof result.payload.options === 'object' ? result.payload.options : body.options
        };
        const items = this.phase6.profiles.items.filter((item) => item.id !== saved.id);
        items.push(saved);
        items.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
        this.phase6.profiles.items = items;
        this.phase6.profiles.loaded = true;
        return { ok: true };
      },

      async deleteImportProfile(profileId) {
        if (!this.phase6CanEdit) return false;
        const id = text(profileId);
        if (!id) return { ok: false, error: 'El perfil no está disponible.' };
        const token = this.phase6Token();
        const result = await this.phase6Write(token, () =>
          window.AssetAccess.request(this, '/import-profiles/' + encodeURIComponent(id), { method: 'DELETE' })
        );
        if (!result.ok) return result;
        this.phase6.profiles.items = this.phase6.profiles.items.filter((item) => item.id !== id);
        return { ok: true };
      },

      async inspectImportFile(file, options) {
        if (!this.phase6CanEdit) return { ok: false };
        const token = this.phase6Token();
        const settings = Object.assign({}, options || {}, { inspectOnly: true });
        try {
          const bytes = await file.arrayBuffer();
          const result = await this.phase6Write(token, () => window.AssetAccess.request(this,
            '/imports/analyze' + query({ filename: file.name, options: JSON.stringify(settings) }),
            { method: 'POST', body: bytes }));
          if (!result.ok) return result;
          return { ok: true, sheets: result.payload.sheets || [] };
        } catch (error) {
          if (!this.phase6TokenOpen(token)) return { ok: false, cancelled: true };
          this.phase6Announce(error);
          return { ok: false };
        }
      },

      async analyzeImport(file, options) {
        if (!this.phase6CanEdit) return false;
        const run = this.phase6.importRun;
        const token = this.phase6Token();
        const filename = text(file && file.name) || 'import.csv';
        const settings = Object.assign({}, options || {});
        let encoded = '{}';
        try {
          encoded = JSON.stringify(settings);
        } catch (_) {
          return { ok: false, error: 'Las opciones de importación no se pueden enviar.' };
        }
        if (encoded.length > 20000) return { ok: false, error: 'Las opciones de importación son demasiado extensas.' };
        if (run.controller) run.controller.abort();
        const controller = makeController();
        const epoch = nextEpoch();
        run.epoch = epoch;
        const current = () => this.phase6Owns('importRun', run) && run.epoch === epoch;
        run.controller = controller;
        run.busy = true;
        run.error = '';
        run.filename = filename;
        run.options = settings;
        this.stopPhase6Polling();
        this.phase6.operation = Object.assign(createResource(), {
          id: '',
          kind: 'import',
          state: '',
          jobId: '',
          approved: false,
          total: 0,
          processed: 0,
          summary: summaryOf(null),
          rows: [],
          offset: 0,
          limit: 100,
          hasMore: false
        });
        try {
          const bytes = await file.arrayBuffer();
          const result = await this.phase6Write(token, () =>
            window.AssetAccess.request(
              this,
              '/imports/analyze' + query({ filename, options: encoded }),
              { method: 'POST', body: bytes, signal: controller ? controller.signal : undefined }
            ), current
          );
          if (!result.ok || !result.payload) return result.ok ? { ok: false, error: FALLBACK_ERROR } : result;
          this.applyPhase6Operation(result.payload);
          return { ok: true };
        } catch (error) {
          if (!current() || !this.phase6TokenOpen(token) || (error && error.name === 'AbortError')) return { ok: false, cancelled: true };
          this.phase6Announce(error);
          return { ok: false, error: text(error && error.message) || 'No se pudo leer el archivo seleccionado.' };
        } finally {
          if (current()) {
            run.busy = false;
            run.controller = null;
          }
        }
      },

      async loadImportOperation(operationId, options) {
        if (!this.phase6CanView) return false;
        const id = text(operationId) || text(this.phase6.operation.id);
        if (!id) return false;
        const opts = options || {};
        const offset = Math.max(0, count(opts.offset, this.phase6.operation.offset));
        const limit = clamp(count(opts.limit, this.phase6.operation.limit || 100), 1, 5000);
        this.phase6.operation.offset = offset;
        this.phase6.operation.limit = limit;
        return this.phase6Read(
          'operation',
          '/operations/' + encodeURIComponent(id) + query({ offset, limit }),
          {},
          (payload) => this.applyPhase6Operation(payload)
        );
      },

      async refreshPhase6Operation() {
        return this.phase6.operation.id ? this.loadImportOperation(this.phase6.operation.id, {}) : false;
      },

      async pollPhase6Operation() {
        const operation = this.phase6 && this.phase6.operation;
        const id = operation ? text(operation.id) : '';
        if (!id || this.authenticated !== true) {
          this.stopPhase6Polling();
          return false;
        }
        const token = this.phase6Token();
        try {
          const payload = await window.AssetAccess.request(this, '/operations/' + encodeURIComponent(id), {});
          if (!this.phase6TokenOpen(token)) return false;
          if (text(this.phase6.operation.id) !== id) return false;
          this.applyPhase6Operation(payload);
          return true;
        } catch (error) {
          if (!this.phase6TokenOpen(token)) return false;
          if (error && error.status === 401) {
            this.clearPhase6State();
            return false;
          }
          if (error && error.name === 'AbortError') return false;
          this.phase6.operation.error = text(error && error.message) || FALLBACK_ERROR;
          this.stopPhase6Polling();
          return false;
        }
      },

      startPhase6Polling() {
        const operation = this.phase6 && this.phase6.operation;
        if (!operation || !operation.id || isFinal(operation.state)) {
          this.stopPhase6Polling();
          return false;
        }
        this.stopPhase6Polling();
        this.phase6OperationPolling = true;
        const token = this.phase6Token();
        const tick = async () => {
          this.phase6PollTimer = null;
          if (!this.phase6OperationPolling) return;
          const accepted = await this.pollPhase6Operation();
          if (!accepted || !this.phase6OperationPolling) return;
          if (!this.phase6TokenOpen(token) || isFinal(this.phase6.operation.state)) {
            this.stopPhase6Polling();
            return;
          }
          if (typeof window.setTimeout === 'function') {
            this.phase6PollTimer = window.setTimeout(tick, POLL_INTERVAL);
          }
        };
        if (typeof window.setTimeout !== 'function') return false;
        this.phase6PollTimer = window.setTimeout(tick, POLL_INTERVAL);
        return true;
      },

      async resolvePhase6Row(index, action, extra) {
        if (!this.phase6CanEdit) return false;
        const operation = this.phase6.operation;
        if (!operation.id) return { ok: false, error: 'La previsualización no está disponible.' };
        const body = { row: count(index, 0), action: text(action) };
        if (extra && extra.assetId) body.assetId = text(extra.assetId);
        if (extra && extra.values && typeof extra.values === 'object') body.values = extra.values;
        const token = this.phase6Token();
        const result = await this.phase6Write(token, () =>
          window.AssetAccess.request(this, '/operations/' + encodeURIComponent(operation.id) + '/resolve', {
            method: 'POST',
            body
          })
        );
        if (!result.ok || !result.payload) return result.ok ? { ok: false, error: FALLBACK_ERROR } : result;
        this.applyPhase6Operation(result.payload);
        return { ok: true };
      },

      phase6OperationAction(suffix) {
        const operation = this.phase6.operation;
        if (!operation.id) return Promise.resolve({ ok: false, error: 'La previsualización no está disponible.' });
        const token = this.phase6Token();
        return this.phase6Write(token, () =>
          window.AssetAccess.request(this, '/operations/' + encodeURIComponent(operation.id) + '/' + suffix, {
            method: 'POST'
          })
        ).then((result) => {
          if (!result.ok || !result.payload) return result.ok ? { ok: false, error: FALLBACK_ERROR } : result;
          this.applyPhase6Operation(result.payload);
          return { ok: true, payload: result.payload };
        });
      },

      async approvePhase6Operation() {
        if (!this.phase6CanEdit) return false;
        const operation = this.phase6.operation;
        if (!operation.id) return { ok: false, error: 'La previsualización no está disponible.' };
        const token = this.phase6Token();
        const result = await this.phase6Write(token, () =>
          window.AssetAccess.request(this, '/operations/' + encodeURIComponent(operation.id) + '/approve', {
            method: 'POST'
          })
        );
        if (!result.ok || !result.payload) return result.ok ? { ok: false, error: FALLBACK_ERROR } : result;
        this.applyPhase6Operation(result.payload);
        return { ok: true };
      },

      async enqueuePhase6Operation() {
        if (!this.phase6CanEdit) return false;
        const operation = this.phase6.operation;
        if (!operation.id) return { ok: false, error: 'La previsualización no está disponible.' };
        const token = this.phase6Token();
        const result = await this.phase6Write(token, () =>
          window.AssetAccess.request(this, '/operations/' + encodeURIComponent(operation.id) + '/enqueue', {
            method: 'POST'
          })
        );
        if (!result.ok || !result.payload) return result.ok ? { ok: false, error: FALLBACK_ERROR } : result;
        this.applyPhase6Operation(result.payload);
        return { ok: true, jobId: this.phase6.operation.jobId };
      },

      async executePhase6Operation() {
        if (!this.phase6CanEdit) return false;
        const operation = this.phase6.operation;
        if (!operation.id) return { ok: false, error: 'La previsualización no está disponible.' };
        const token = this.phase6Token();
        const result = await this.phase6Write(token, () =>
          window.AssetAccess.request(this, '/operations/' + encodeURIComponent(operation.id) + '/execute', {
            method: 'POST'
          })
        );
        if (!result.ok || !result.payload) return result.ok ? { ok: false, error: FALLBACK_ERROR } : result;
        this.applyPhase6Operation(result.payload);
        return { ok: true, jobId: this.phase6.operation.jobId };
      },

      async bulkPreviewPhase6(input) {
        if (!this.phase6CanEdit) return false;
        const source = input || {};
        const body = {};
        if (Array.isArray(source.assetIds) && source.assetIds.length) body.assetIds = source.assetIds.slice();
        if (source.filters && typeof source.filters === 'object') body.filters = source.filters;
        body.changes = source.changes && typeof source.changes === 'object' ? source.changes : {};
        body.action = text(source.action) || 'update';
        if (source.reason) body.reason = text(source.reason);
        const run = this.phase6.bulkRun;
        if (run.controller) run.controller.abort();
        const controller = makeController();
        const epoch = nextEpoch();
        run.epoch = epoch;
        const current = () => this.phase6Owns('bulkRun', run) && run.epoch === epoch;
        run.controller = controller;
        run.busy = true;
        run.error = '';
        this.stopPhase6Polling();
        const token = this.phase6Token();
        try {
          const result = await this.phase6Write(token, () =>
            window.AssetAccess.request(this, '/bulk/preview', {
              method: 'POST',
              body,
              signal: controller ? controller.signal : undefined
            }), current
          );
          if (!result.ok || !result.payload) return result.ok ? { ok: false, error: FALLBACK_ERROR } : result;
          this.applyPhase6Operation(result.payload);
          return { ok: true };
        } finally {
          if (current()) {
            run.busy = false;
            run.controller = null;
          }
        }
      },

      /* ------------------------------------------------------------ export */
      async exportPhase6Assets(input) {
        if (!this.phase6CanView) return false;
        const source = input || {};
        const run = this.phase6.exportRun;
        const body = {};
        if (Array.isArray(source.assetIds) && source.assetIds.length) body.assetIds = source.assetIds.slice();
        if (source.filters && typeof source.filters === 'object') body.filters = source.filters;
        if (Array.isArray(source.fields) && source.fields.length) body.fields = source.fields.slice();
        if (run.controller) run.controller.abort();
        const controller = makeController();
        const epoch = nextEpoch();
        run.epoch = epoch;
        run.controller = controller;
        run.busy = true;
        run.error = '';
        const token = this.phase6Token();
        try {
          const blob = await window.AssetAccess.request(this, '/assets/export', {
            method: 'POST',
            body,
            responseType: 'blob',
            signal: controller ? controller.signal : undefined
          });
          if (epoch !== run.epoch || this.phase6.exportRun !== run || !this.phase6TokenOpen(token)) return { ok: false, cancelled: true };
          return { ok: true, blob, filename: text(run.filename) || 'assets.csv' };
        } catch (error) {
          if (epoch !== run.epoch || this.phase6.exportRun !== run || !this.phase6TokenOpen(token)) return { ok: false, cancelled: true };
          if (error && error.status === 401) {
            this.clearPhase6State();
            return { ok: false, cancelled: true };
          }
          if (error && error.name === 'AbortError') return { ok: false, cancelled: true };
          this.phase6Announce(error);
          run.error = text(error && error.message) || FALLBACK_ERROR;
          return this.phase6Result(error);
        } finally {
          if (this.phase6 && this.phase6.exportRun === run && epoch === run.epoch) {
            run.busy = false;
            run.controller = null;
          }
        }
      },

      /* --------------------------------------------------------- warranties */
      async loadWarranties(input) {
        if (!this.phase6CanView) return false;
        const source = input || {};
        const coverage = COVERAGES.indexOf(text(source.coverage)) === -1 ? '' : text(source.coverage);
        const offset = Math.max(0, count(source.offset, 0));
        const limit = clamp(count(source.limit, DEFAULT_LIMIT), 1, MAX_LIMIT);
        const page = this.phase6.warranties;
        return this.phase6Read(
          'warranties',
          '/warranties' + query({ coverage, offset, limit }),
          {},
          (payload) => {
            const items = (Array.isArray(payload && payload.items) ? payload.items : [])
              .filter((item) => item && item.assetId)
              .map((item) => ({
                assetId: text(item.assetId),
                supplier: text(item.supplier),
                purchaseDate: text(item.purchaseDate),
                durationMonths: item.durationMonths === null || item.durationMonths === undefined ? null : count(item.durationMonths, 0),
                expiresOn: text(item.expiresOn),
                status: text(item.status) || 'unknown',
                receiptId: text(item.receiptId),
                notes: text(item.notes),
                coverage: text(item.coverage) || 'unknown'
              }));
            page.items = offset === 0 ? items : page.items.concat(items);
            page.total = page.items.length;
            page.offset = offset;
            page.limit = limit;
            page.hasMore = !!(payload && payload.hasMore);
          }
        );
      },

      async loadAssetWarranty(assetId) {
        if (!this.phase6CanView) return false;
        const id = text(assetId);
        if (!id) return false;
        const detail = this.phase6.warranty;
        if (!this.phase6Owns('warranty', detail)) return false;
        const token = this.phase6Token();
        if (detail.controller) detail.controller.abort();
        const controller = makeController();
        const epoch = nextEpoch();
        detail.epoch = epoch;
        detail.controller = controller;
        detail.assetId = id;
        detail.loading = true;
        detail.error = '';
        try {
          const payload = await window.AssetAccess.request(this, '/assets/' + encodeURIComponent(id) + '/warranty', {
            signal: controller ? controller.signal : undefined
          });
          if (epoch !== detail.epoch || !this.phase6Owns('warranty', detail) || !this.phase6TokenOpen(token)) return false;
          detail.item = Object.assign({ assetId: id }, payload || {});
          detail.loaded = true;
          return true;
        } catch (error) {
          if (epoch !== detail.epoch || !this.phase6Owns('warranty', detail) || !this.phase6TokenOpen(token)) return false;
          if (error && error.name === 'AbortError') return false;
          if (error && error.status === 401) {
            this.clearPhase6State();
            return false;
          }
          if (error && error.status === 404) {
            detail.item = null;
            detail.loaded = true;
            detail.error = '';
            return true;
          }
          detail.error = text(error && error.message) || FALLBACK_ERROR;
          return false;
        } finally {
          if (epoch === detail.epoch && this.phase6Owns('warranty', detail)) {
            detail.loading = false;
            detail.controller = null;
          }
        }
      },

      async saveAssetWarranty(assetId, values) {
        if (!this.phase6CanEdit) return false;
        const id = text(assetId);
        if (!id) return { ok: false, error: 'El activo no está disponible.' };
        const token = this.phase6Token();
        const body = bodyWithoutEmpty(values || {}, WARRANTY_FIELDS);
        const result = await this.phase6Write(token, () =>
          window.AssetAccess.request(this, '/assets/' + encodeURIComponent(id) + '/warranty', {
            method: 'PUT',
            body
          })
        );
        if (!result.ok || !result.payload) return result.ok ? { ok: false, error: FALLBACK_ERROR } : result;
        const item = Object.assign({ assetId: id }, result.payload);
        if (this.phase6.warranty.assetId === id) {
          this.phase6.warranty.item = item;
          this.phase6.warranty.loaded = true;
          this.phase6.warranty.error = '';
        }
        return { ok: true, payload: item };
      },

      async deleteAssetWarranty(assetId) {
        if (!this.phase6CanEdit) return false;
        const id = text(assetId);
        if (!id) return { ok: false, error: 'El activo no está disponible.' };
        const token = this.phase6Token();
        const result = await this.phase6Write(token, () =>
          window.AssetAccess.request(this, '/assets/' + encodeURIComponent(id) + '/warranty', { method: 'DELETE' })
        );
        if (!result.ok) return result;
        if (this.phase6.warranty.assetId === id) {
          this.phase6.warranty.item = null;
          this.phase6.warranty.loaded = true;
        }
        this.phase6.warranties.items = this.phase6.warranties.items.filter((item) => item.assetId !== id);
        return { ok: true };
      },

      async loadWarrantyPreferences() {
        if (!this.phase6CanView) return false;
        return this.phase6Read('warrantyPrefs', '/warranty-preferences', {}, (payload) => {
          this.phase6.warrantyPrefs.expiringDays = clamp(count(payload && payload.expiringDays, 30), 1, 365);
        });
      },

      async saveWarrantyPreferences(days) {
        if (!this.phase6CanEdit) return false;
        const value = count(days, 0);
        const token = this.phase6Token();
        const result = await this.phase6Write(token, () =>
          window.AssetAccess.request(this, '/warranty-preferences', {
            method: 'PUT',
            body: { expiringDays: value }
          })
        );
        if (!result.ok || !result.payload) return result.ok ? { ok: false, error: FALLBACK_ERROR } : result;
        this.phase6.warrantyPrefs.expiringDays = clamp(count(result.payload.expiringDays, value), 1, 365);
        this.phase6.warrantyPrefs.loaded = true;
        return { ok: true };
      },

      /* -------------------------------------------------------- attachments */
      async loadAssetAttachments(assetId, options) {
        if (!this.phase6CanView) return false;
        const id = text(assetId) || this.phase6.attachments.assetId;
        if (!id) return false;
        const opts = options || {};
        const offset = Math.max(0, count(opts.offset, 0));
        const limit = clamp(count(opts.limit, DEFAULT_LIMIT), 1, MAX_LIMIT);
        const page = this.phase6.attachments;
        return this.phase6Read(
          'attachments',
          '/assets/' + encodeURIComponent(id) + '/attachments' + query({ limit, offset }),
          {},
          (payload) => {
            const items = (Array.isArray(payload && payload.items) ? payload.items : [])
              .filter((item) => item && item.id)
              .map((item) => ({
                id: text(item.id),
                assetId: text(item.assetId) || id,
                filename: text(item.filename),
                category: text(item.category) || 'document',
                contentType: text(item.contentType),
                size: count(item.size, 0),
                sha256: text(item.sha256),
                createdBy: text(item.createdBy),
                createdAt: text(item.createdAt)
              }));
            page.assetId = id;
            page.items = offset === 0 ? items : page.items.concat(items);
            page.offset = offset;
            page.limit = limit;
            page.hasMore = !!(payload && payload.hasMore);
            page.total = page.items.length;
          }
        );
      },

      async uploadAssetAttachment(assetId, file, category) {
        if (!this.phase6CanEdit) return false;
        const id = text(assetId);
        const filename = text(file && file.name);
        if (!id || !filename) return { ok: false, error: 'Selecciona un archivo con nombre.' };
        const kind = ATTACHMENT_CATEGORIES.indexOf(text(category)) === -1 ? 'document' : text(category);
        const page = this.phase6.attachments;
        if (!this.phase6Owns('attachments', page)) return { ok: false, cancelled: true };
        const token = this.phase6Token();
        page.busy = true;
        try {
          const bytes = await file.arrayBuffer();
          if (!this.phase6Owns('attachments', page) || !this.phase6TokenOpen(token)) {
            return { ok: false, cancelled: true };
          }
          const result = await this.phase6Write(token, () =>
            window.AssetAccess.request(
              this,
              '/assets/' + encodeURIComponent(id) + '/attachments' + query({ filename, category: kind }),
              { method: 'POST', body: bytes }
            )
          );
          if (!result.ok || !result.payload) {
            return result.ok ? { ok: false, error: FALLBACK_ERROR } : result;
          }
          const item = result.payload;
          if (this.phase6.attachments.assetId === id) {
            const others = this.phase6.attachments.items.filter((entry) => entry.id !== text(item.id));
            page.items = [
              {
                id: text(item.id),
                assetId: text(item.assetId) || id,
                filename: text(item.filename) || filename,
                category: text(item.category) || kind,
                contentType: text(item.contentType),
                size: count(item.size, 0),
                sha256: text(item.sha256),
                createdBy: text(item.createdBy),
                createdAt: text(item.createdAt)
              }
            ].concat(others);
            page.total = page.items.length;
            page.loaded = true;
          }
          return { ok: true, payload: item };
        } catch (error) {
          if (!this.phase6TokenOpen(token)) return { ok: false, cancelled: true };
          this.phase6Announce(error);
          return this.phase6Result(error);
        } finally {
          if (this.phase6Owns('attachments', page)) page.busy = false;
        }
      },

      async downloadAssetAttachment(attachment) {
        if (!this.phase6CanView) return false;
        const source = attachment || {};
        const id = text(source.id);
        const assetId = text(source.assetId) || this.phase6.attachments.assetId;
        if (!id || !assetId) return { ok: false, error: 'El archivo no está disponible.' };
        const token = this.phase6Token();
        try {
          const blob = await window.AssetAccess.request(
            this,
            '/assets/' + encodeURIComponent(assetId) + '/attachments/' + encodeURIComponent(id) + '/download',
            { responseType: 'blob' }
          );
          if (!this.phase6TokenOpen(token)) return { ok: false, cancelled: true };
          if (!blob || typeof blob !== 'object') return { ok: false, error: 'El servidor no devolvió el archivo.' };
          return { ok: true, blob, filename: text(source.filename) || 'documento' };
        } catch (error) {
          if (!this.phase6TokenOpen(token)) return { ok: false, cancelled: true };
          if (error && error.status === 401) {
            this.clearPhase6State();
            return { ok: false, cancelled: true };
          }
          this.phase6Announce(error);
          return this.phase6Result(error);
        }
      },

      async deleteAssetAttachment(attachmentId) {
        if (!this.phase6CanEdit) return false;
        const id = text(attachmentId);
        const assetId = this.phase6.attachments.assetId;
        if (!id || !assetId) return { ok: false, error: 'El archivo no está disponible.' };
        const token = this.phase6Token();
        const result = await this.phase6Write(token, () =>
          window.AssetAccess.request(
            this,
            '/assets/' + encodeURIComponent(assetId) + '/attachments/' + encodeURIComponent(id),
            { method: 'DELETE' }
          )
        );
        if (!result.ok) return result;
        const page = this.phase6.attachments;
        page.items = page.items.filter((item) => item.id !== id);
        page.total = page.items.length;
        return { ok: true };
      }
    }
  };
})();
