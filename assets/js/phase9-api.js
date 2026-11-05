(function () {
  'use strict';
  // Adapter copy is shown outside a mounted template: resolve it at call time.
  function tr(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : '';
  }

  /* Phase 9 reports adapter.
   *
   * Every document, template, job, QR, share and settings value is read from
   * the canonical reports API. The browser keeps no document history and no
   * label/report authority in storage. Public report reads are the only calls
   * that may run without a session, and they require the exact share token.
   *
   * Two counters isolate stale work:
   * - responseEpoch guards each resource against superseded reads;
   * - sessionEpoch rotates when the adapter is cleared (logout/user change)
   *   so a late write never publishes state or a toast. */

  const BASE = '/reports';
  const POLL_INTERVAL = 2500;
  const JOB_LIMIT = 25;
  const SELECTION_LIMIT = 25;
  const PUBLIC_FIELDS = ['id', 'quickCode', 'name', 'category', 'site', 'location', 'status'];
  const JOB_STATES = ['queued', 'running', 'completed', 'failed'];

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

  function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function makeController() {
    return typeof AbortController === 'function' ? new AbortController() : null;
  }

  function blankResource(limit) {
    return {
      items: [],
      loaded: false,
      loading: false,
      error: '',
      epoch: 0,
      controller: null,
      total: 0,
      limit: limit || 0,
      offset: 0
    };
  }

  function normalizeBranding(source) {
    const raw = source && typeof source === 'object' ? source : {};
    return {
      name: text(raw.name),
      primary: text(raw.primary),
      accent: text(raw.accent),
      header: text(raw.header),
      footer: text(raw.footer),
      logoAttachmentId: text(raw.logoAttachmentId)
    };
  }

  function normalizeSettings(source) {
    const raw = source && typeof source === 'object' ? source : {};
    const label = window.AssetLabelEngine;
    return {
      baseUrl: text(raw.baseUrl),
      branding: normalizeBranding(raw.branding),
      labelDefaults: label && label.defaultLabelOptions ? label.defaultLabelOptions(raw.labelDefaults) : (raw.labelDefaults || {})
    };
  }

  function normalizeFilters(source) {
    const raw = source && typeof source === 'object' ? source : {};
    return {
      search: text(raw.search),
      category: text(raw.category),
      siteId: text(raw.siteId),
      locationId: text(raw.locationId),
      responsiblePersonId: text(raw.responsiblePersonId),
      status: text(raw.status),
      archived: raw.archived === 'archived' || raw.archived === true ? 'archived' : (raw.archived === 'all' || raw.archived === '' ? 'all' : 'active'),
      from: text(raw.from),
      to: text(raw.to),
      actor: text(raw.actor),
      event: text(raw.event),
      warrantyFilter: text(raw.warrantyFilter)
    };
  }

  function normalizeDocument(source) {
    const raw = source && typeof source === 'object' ? source : {};
    return {
      id: text(raw.id),
      name: text(raw.name) || 'Documento',
      mime: text(raw.mime) || 'application/octet-stream',
      size: number(raw.size, 0),
      downloadUrl: text(raw.downloadUrl),
      assetId: text(raw.assetId) || null,
      jobId: text(raw.jobId)
    };
  }

  function normalizeShare(source) {
    if (!source || typeof source !== 'object') return null;
    return {
      id: text(source.id),
      url: text(source.url),
      fields: Array.isArray(source.fields) ? source.fields.map(text).filter(function (field) { return PUBLIC_FIELDS.indexOf(field) !== -1; }) : [],
      expiresAt: text(source.expiresAt)
    };
  }

  function normalizeQr(source) {
    const raw = source && typeof source === 'object' ? source : {};
    return {
      assetId: text(raw.assetId),
      url: text(raw.url),
      svg: text(raw.svg),
      share: normalizeShare(raw.share)
    };
  }

  function normalizeJob(source) {
    const raw = source && typeof source === 'object' ? source : {};
    const status = JOB_STATES.indexOf(text(raw.status)) !== -1 ? text(raw.status) : 'queued';
    return {
      id: text(raw.id),
      status: status,
      total: number(raw.total, 0),
      processed: number(raw.processed, 0),
      errors: (Array.isArray(raw.errors) ? raw.errors : []).map(function (item) {
        if (typeof item === 'string') return item;
        return text(item && item.message) || text(item && item.error) || tr('ui.reports.error.job_error');
      }),
      documents: (Array.isArray(raw.documents) ? raw.documents : []).map(normalizeDocument),
      createdAt: text(raw.createdAt)
    };
  }

  function queryString(pairs) {
    return pairs
      .filter(function (pair) { return pair[1] !== '' && pair[1] !== null && pair[1] !== undefined; })
      .map(function (pair) { return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(String(pair[1])); })
      .join('&');
  }

  function wirePath(url, fallback) {
    const value = text(url);
    if (!value) return fallback;
    if (value.indexOf('/api/v1/') === 0) return value.slice('/api/v1'.length);
    if (value.charAt(0) === '/') return value;
    return fallback;
  }

  function saveBlob(blob, filename) {
    if (typeof URL === 'undefined' || !URL.createObjectURL || typeof document === 'undefined') return false;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'reporte.pdf';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
    return true;
  }

  function createState() {
    return {
      sessionEpoch: nextSessionEpoch(),
      identity: '',
      templates: blankResource(),
      settings: {
        baseUrl: '',
        branding: normalizeBranding({}),
        labelDefaults: window.AssetLabelEngine && window.AssetLabelEngine.defaultLabelOptions
          ? window.AssetLabelEngine.defaultLabelOptions({})
          : {},
        loaded: false,
        loading: false,
        saving: false,
        error: '',
        epoch: 0,
        controller: null
      },
      selection: Object.assign(blankResource(SELECTION_LIMIT), { filters: normalizeFilters({}) }),
      preview: {
        html: '',
        template: null,
        branding: null,
        assets: 0,
        rows: 0,
        columns: [],
        summary: null,
        matched: 0,
        truncated: false,
        loading: false,
        error: '',
        epoch: 0,
        controller: null
      },
      jobs: Object.assign(blankResource(JOB_LIMIT), { }),
      activeJob: {
        id: '',
        job: null,
        loading: false,
        error: '',
        epoch: 0,
        controller: null,
        pollTimer: null
      },
      documents: blankResource(),
      qr: {
        assetId: '',
        url: '',
        svg: '',
        share: null,
        loading: false,
        error: '',
        epoch: 0,
        controller: null
      },
      share: { creating: false, revoking: false, error: '', created: null, epoch: 0 },
      privateReport: {
        assetId: '',
        asset: null,
        fields: [],
        loading: false,
        error: '',
        epoch: 0,
        controller: null
      },
      publicReport: {
        token: '',
        loading: false,
        error: '',
        asset: null,
        fields: [],
        expiresAt: '',
        loaded: false,
        epoch: 0,
        controller: null
      },
      download: { id: '', loading: false, error: '' }
    };
  }

  function applyDocumentList(state, jobs) {
    const documents = [];
    (jobs || []).forEach(function (job) {
      (job.documents || []).forEach(function (document) {
        documents.push(Object.assign({}, document, { jobId: job.id, jobStatus: job.status, jobCreatedAt: job.createdAt }));
      });
    });
    state.documents.items = documents;
    state.documents.total = documents.length;
    state.documents.loaded = true;
  }

  window.AssetPhase9 = {
    BASE: BASE,
    PUBLIC_FIELDS: PUBLIC_FIELDS,
    JOB_STATES: JOB_STATES,
    POLL_INTERVAL: POLL_INTERVAL,
    createState: createState,
    normalizeSettings: normalizeSettings,
    normalizeBranding: normalizeBranding,
    normalizeFilters: normalizeFilters,
    normalizeDocument: normalizeDocument,
    normalizeJob: normalizeJob,
    normalizeShare: normalizeShare,
    normalizeQr: normalizeQr,
    queryString: queryString,

    data() {
      return {
        phase9: createState(),
        phase9SelectionTimer: null
      };
    },

    computed: {
      phase9Templates() {
        return this.phase9 ? this.phase9.templates.items : [];
      },
      phase9Selection() {
        return this.phase9 ? this.phase9.selection : blankResource(SELECTION_LIMIT);
      },
      phase9Preview() {
        return this.phase9 ? this.phase9.preview : null;
      },
      phase9Jobs() {
        return this.phase9 ? this.phase9.jobs.items : [];
      },
      phase9Documents() {
        return this.phase9 ? this.phase9.documents.items : [];
      },
      phase9Settings() {
        return this.phase9 ? this.phase9.settings : normalizeSettings({});
      },
      phase9Qr() {
        return this.phase9 ? this.phase9.qr : normalizeQr({});
      },
      phase9Share() {
        return this.phase9 ? this.phase9.share : { creating: false, revoking: false, error: '', created: null };
      },
      phase9PublicReport() {
        return this.phase9 ? this.phase9.publicReport : null;
      },
      phase9PrivateReport() {
        return this.phase9 ? this.phase9.privateReport : null;
      }
    },

    methods: {
      /* ------------------------------------------------------ state guards */
      phase9Token() {
        const state = this.phase9;
        const identity = text(this.activeUserId);
        if (state) state.identity = identity;
        return {
          session: state ? state.sessionEpoch : 0,
          identity: identity
        };
      },
      phase9TokenOpen(token) {
        return !!this.phase9 &&
          this.phase9.sessionEpoch === token.session &&
          this.authenticated === true &&
          text(this.activeUserId) === token.identity;
      },
      phase9ResourceOwned(resource) {
        return !!this.phase9 && resource && [
          this.phase9.templates,
          this.phase9.settings,
          this.phase9.selection,
          this.phase9.preview,
          this.phase9.jobs,
          this.phase9.activeJob,
          this.phase9.documents,
          this.phase9.qr,
          this.phase9.privateReport,
          this.phase9.publicReport
        ].indexOf(resource) !== -1;
      },
      identityChangedPhase9() {
        if (!this.phase9) return false;
        if (this.phase9.identity === text(this.activeUserId)) return false;
        this.clearPhase9State();
        return true;
      },
      stopPhase9Polling() {
        if (this.phase9 && this.phase9.activeJob && this.phase9.activeJob.pollTimer) {
          window.clearTimeout(this.phase9.activeJob.pollTimer);
          this.phase9.activeJob.pollTimer = null;
        }
      },
      clearPhase9State() {
        if (!this.phase9) return false;
        this.stopPhase9Polling();
        if (this.phase9SelectionTimer) {
          window.clearTimeout(this.phase9SelectionTimer);
          this.phase9SelectionTimer = null;
        }
        const state = this.phase9;
        [
          state.templates,
          state.settings,
          state.selection,
          state.preview,
          state.jobs,
          state.activeJob,
          state.documents,
          state.qr,
          state.privateReport,
          state.publicReport
        ].forEach(function (resource) {
          if (resource && resource.controller) resource.controller.abort();
        });
        const publicReport = state.publicReport;
        this.phase9 = createState();
        this.phase9.identity = text(this.activeUserId);
        // A public share token is not private state: keep the exact tokenized
        // report visible while the surrounding session is cleared.
        this.phase9.publicReport = publicReport;
        return true;
      },
      phase9Result(error) {
        return {
          ok: false,
          cancelled: !!(error && (error.name === 'AbortError' || error.status === 401)),
          error: text(error && error.message) || tr('ui.errors.request_failed'),
          fieldErrors: (error && error.fieldErrors) || {}
        };
      },
      phase9CanWrite() {
        return this.authenticated === true && this.can && this.can('assets.view');
      },
      phase9Read(resource, path, apply, options) {
        const state = this.phase9;
        if (!state || !resource) return Promise.resolve(false);
        const token = this.phase9Token();
        if (resource.controller) resource.controller.abort();
        const controller = makeController();
        const epoch = nextEpoch();
        resource.epoch = epoch;
        resource.controller = controller;
        resource.loading = true;
        resource.error = '';
        return window.AssetAccess.request(
          this,
          path,
          Object.assign({}, options || {}, { signal: controller ? controller.signal : undefined })
        ).then((payload) => {
          if (epoch !== resource.epoch || !this.phase9 || this.phase9 !== state || !this.phase9TokenOpen(token)) return false;
          apply(payload);
          resource.loaded = true;
          return true;
        }).catch((error) => {
          if (epoch !== resource.epoch || !this.phase9 || this.phase9 !== state) return false;
          if (error && error.name === 'AbortError') return false;
          resource.error = text(error && error.message) || tr('ui.errors.request_failed');
          return false;
        }).finally(() => {
          if (epoch === resource.epoch && this.phase9 === state) {
            resource.loading = false;
            resource.controller = null;
          }
        });
      },

      /* --------------------------------------------------------- templates */
      phase9LoadTemplates() {
        const state = this.phase9;
        if (!state || !this.phase9CanWrite()) return Promise.resolve(false);
        return this.phase9Read(state.templates, BASE + '/templates', (payload) => {
          const items = Array.isArray(payload && payload.items) ? payload.items : (Array.isArray(payload) ? payload : []);
          state.templates.items = items
            .filter(function (item) { return item && (item.id || item.name); })
            .map(window.AssetReportEngine.normalizeTemplate);
          state.templates.total = state.templates.items.length;
        });
      },

      phase9SaveTemplate(template) {
        if (!this.requirePermission('assets.edit')) return Promise.resolve({ ok: false, error: tr('ui.reports.error.template_edit_permission') });
        const normalized = window.AssetReportEngine.normalizeTemplate(template);
        if (!normalized.name || !normalized.name.trim()) return Promise.resolve({ ok: false, error: tr('ui.reports.error.template_name_required') });
        if (!normalized.id || normalized.builtin) normalized.id = 'custom-' + Date.now().toString(36) + '-' + nextEpoch();
        const body = {
          id: normalized.id,
          name: normalized.name,
          description: normalized.description,
          family: normalized.family,
          mode: normalized.mode,
          format: normalized.format,
          fields: normalized.fields,
          logo: normalized.logo,
          images: normalized.images,
          version: 1,
          blocks: normalized.blocks.map(function (item) {
            return { id: item.id, type: item.type, label: item.label, text: item.text, enabled: item.enabled };
          })
        };
        const token = this.phase9Token();
        return window.AssetAccess.request(this, BASE + '/templates/' + encodeURIComponent(normalized.id), {
          method: 'PUT',
          body: body
        }).then((payload) => {
          if (!this.phase9TokenOpen(token)) return { ok: false, cancelled: true };
          const saved = window.AssetReportEngine.normalizeTemplate(payload && payload.id ? payload : body);
          const items = this.phase9.templates.items.filter(function (item) { return item.id !== saved.id; });
          items.push(saved);
          this.phase9.templates.items = items;
          this.phase9.templates.loaded = true;
          return { ok: true, template: saved };
        }).catch((error) => this.phase9Result(error));
      },

      phase9DeleteTemplate(id) {
        if (!this.requirePermission('assets.edit')) return Promise.resolve({ ok: false, error: tr('ui.reports.error.template_edit_permission') });
        const token = this.phase9Token();
        return window.AssetAccess.request(this, BASE + '/templates/' + encodeURIComponent(id), { method: 'DELETE' })
          .then(() => {
            if (!this.phase9TokenOpen(token)) return { ok: false, cancelled: true };
            this.phase9.templates.items = this.phase9.templates.items.filter(function (item) { return item.id !== id; });
            return { ok: true };
          }).catch((error) => this.phase9Result(error));
      },

      /* ---------------------------------------------------------- settings */
      phase9LoadSettings() {
        const state = this.phase9;
        if (!state || !this.phase9CanWrite()) return Promise.resolve(false);
        return this.phase9Read(state.settings, BASE + '/settings', (payload) => {
          const settings = normalizeSettings(payload && payload.settings ? payload.settings : payload);
          state.settings.baseUrl = settings.baseUrl;
          state.settings.branding = settings.branding;
          state.settings.labelDefaults = settings.labelDefaults;
        });
      },

      phase9SaveSettings(patch) {
        if (!this.requirePermission('config.general')) {
          return Promise.resolve({ ok: false, error: tr('ui.reports.error_config_permission') });
        }
        const state = this.phase9;
        const current = state.settings;
        const source = patch && typeof patch === 'object' ? patch : {};
        const payload = {
          baseUrl: source.baseUrl !== undefined ? text(source.baseUrl) : current.baseUrl,
          branding: normalizeBranding(source.branding !== undefined ? source.branding : current.branding),
          labelDefaults: window.AssetLabelEngine.wireLabelOptions(
            source.labelDefaults !== undefined ? source.labelDefaults : current.labelDefaults
          )
        };
        const token = this.phase9Token();
        current.saving = true;
        current.error = '';
        return window.AssetAccess.request(this, BASE + '/settings', { method: 'PUT', body: payload })
          .then((response) => {
            if (!this.phase9TokenOpen(token)) return { ok: false, cancelled: true };
            const saved = normalizeSettings(response && response.settings ? response.settings : response);
            current.baseUrl = saved.baseUrl;
            current.branding = saved.branding;
            current.labelDefaults = saved.labelDefaults;
            current.loaded = true;
            return { ok: true, settings: saved };
          }).catch((error) => {
            if (!this.phase9TokenOpen(token)) return { ok: false, cancelled: true };
            const result = this.phase9Result(error);
            current.error = result.error;
            return result;
          }).finally(() => {
            if (this.phase9 && this.phase9TokenOpen(token)) current.saving = false;
          });
      },

      /* -------------------------------------------------- inventory select */
      phase9SelectionQuery(filters, limit, offset) {
        const normalized = normalizeFilters(filters);
        const category = typeof this.inventoryCategoryText === 'function'
          ? text(this.inventoryCategoryText(normalized.category))
          : normalized.category;
        const pairs = [
          ['query', normalized.search],
          ['category', category],
          ['siteId', normalized.siteId],
          ['locationId', normalized.locationId],
          ['responsiblePersonId', normalized.responsiblePersonId],
          ['status', normalized.status]
        ];
        if (normalized.archived === 'archived') pairs.push(['archived', 'true']);
        if (normalized.archived === 'active') pairs.push(['archived', 'false']);
        pairs.push(['limit', limit], ['offset', offset]);
        const query = queryString(pairs);
        return query ? '?' + query : '';
      },

      phase9LoadSelection(options) {
        const state = this.phase9;
        if (!state || !this.phase9CanWrite()) return Promise.resolve(false);
        const selection = state.selection;
        const source = options && typeof options === 'object' ? options : {};
        if (source.filters) selection.filters = normalizeFilters(source.filters);
        if (source.resetOffset) selection.offset = 0;
        const path = '/assets/search' + this.phase9SelectionQuery(selection.filters, selection.limit, selection.offset);
        return this.phase9Read(selection, path, (payload) => {
          const items = Array.isArray(payload && payload.items) ? payload.items : [];
          selection.items = items.map((item) => (typeof this.inventoryMapAsset === 'function' ? this.inventoryMapAsset(item) : item));
          selection.total = number(payload && payload.total, selection.items.length);
          selection.limit = number(payload && payload.limit, selection.limit);
          selection.offset = number(payload && payload.offset, selection.offset);
        });
      },

      phase9ScheduleSelectionSearch(filters) {
        if (this.phase9SelectionTimer) window.clearTimeout(this.phase9SelectionTimer);
        this.phase9SelectionTimer = window.setTimeout(() => {
          this.phase9SelectionTimer = null;
          this.phase9LoadSelection({ filters: filters, resetOffset: true });
        }, 250);
      },

      phase9SelectionPage(direction) {
        const selection = this.phase9 && this.phase9.selection;
        if (!selection) return Promise.resolve(false);
        const offset = direction === 'next'
          ? selection.offset + selection.limit
          : Math.max(0, selection.offset - selection.limit);
        if (offset === selection.offset) return Promise.resolve(false);
        if (offset >= selection.total && direction === 'next') return Promise.resolve(false);
        selection.offset = offset;
        return this.phase9LoadSelection();
      },

      /* ---------------------------------------------------------- preview */
      phase9PreviewReport(request) {
        const state = this.phase9;
        if (!state || !this.phase9CanWrite()) return Promise.resolve({ ok: false, error: tr('ui.reports.error.preview_permission') });
        const preview = state.preview;
        const token = this.phase9Token();
        if (preview.controller) preview.controller.abort();
        const controller = makeController();
        const epoch = nextEpoch();
        preview.epoch = epoch;
        preview.controller = controller;
        preview.loading = true;
        preview.error = '';
        return window.AssetAccess.request(this, BASE + '/preview', {
          method: 'POST',
          body: request,
          signal: controller ? controller.signal : undefined
        }).then((payload) => {
          if (epoch !== preview.epoch || !this.phase9TokenOpen(token)) return { ok: false, cancelled: true };
          preview.html = text(payload && payload.html);
          preview.template = payload && payload.template ? window.AssetReportEngine.normalizeTemplate(payload.template) : null;
          preview.branding = payload && payload.branding ? normalizeBranding(payload.branding) : null;
          preview.assets = Array.isArray(payload && payload.assets)
            ? payload.assets.length
            : number(payload && payload.assets, 0);
          preview.rows = number(payload && payload.rows, 0);
          preview.columns = Array.isArray(payload && payload.columns) ? payload.columns.slice() : [];
          preview.summary = payload && payload.summary && typeof payload.summary === 'object' ? payload.summary : null;
          preview.matched = number(payload && payload.matched, 0);
          preview.truncated = !!(payload && payload.truncated);
          return { ok: true, preview: preview };
        }).catch((error) => {
          if (epoch !== preview.epoch || !this.phase9TokenOpen(token)) return { ok: false, cancelled: true };
          const result = this.phase9Result(error);
          preview.error = result.error;
          return result;
        }).finally(() => {
          if (epoch === preview.epoch && this.phase9) {
            preview.loading = false;
            preview.controller = null;
          }
        });
      },

      /* ------------------------------------------------------------- jobs */
      phase9JobItems() {
        return this.phase9 ? this.phase9.jobs.items : [];
      },

      phase9ApplyJob(job) {
        if (!this.phase9 || !job || !job.id) return false;
        const items = this.phase9.jobs.items.slice();
        const index = items.findIndex(function (item) { return item.id === job.id; });
        if (index >= 0) items[index] = job; else items.unshift(job);
        this.phase9.jobs.items = items;
        this.phase9.jobs.loaded = true;
        this.phase9.jobs.total = items.length;
        this.phase9.activeJob.id = job.id;
        this.phase9.activeJob.job = job;
        applyDocumentList(this.phase9, items);
        return true;
      },

      phase9LoadJobs() {
        const state = this.phase9;
        if (!state || !this.phase9CanWrite()) return Promise.resolve(false);
        return this.phase9Read(state.jobs, BASE + '/jobs?limit=' + JOB_LIMIT, (payload) => {
          const items = Array.isArray(payload && payload.items) ? payload.items : (Array.isArray(payload) ? payload : []);
          state.jobs.items = items.map(normalizeJob);
          state.jobs.total = state.jobs.items.length;
          applyDocumentList(state, state.jobs.items);
        });
      },

      phase9LoadJob(id) {
        const state = this.phase9;
        if (!state || !this.phase9CanWrite() || !text(id)) return Promise.resolve(false);
        const active = state.activeJob;
        const token = this.phase9Token();
        if (active.controller) active.controller.abort();
        const controller = makeController();
        const epoch = nextEpoch();
        active.epoch = epoch;
        active.controller = controller;
        active.loading = true;
        active.error = '';
        return window.AssetAccess.request(this, BASE + '/jobs/' + encodeURIComponent(id), {
          signal: controller ? controller.signal : undefined
        }).then((payload) => {
          if (epoch !== active.epoch || !this.phase9TokenOpen(token)) return false;
          const job = normalizeJob(payload && payload.job ? payload.job : payload);
          this.phase9ApplyJob(job);
          if (job.status === 'queued' || job.status === 'running') this.phase9ScheduleJobPoll(job.id);
          return true;
        }).catch((error) => {
          if (epoch !== active.epoch || !this.phase9TokenOpen(token)) return false;
          if (error && error.name !== 'AbortError') active.error = text(error.message) || tr('ui.errors.request_failed');
          return false;
        }).finally(() => {
          if (epoch === active.epoch && this.phase9) {
            active.loading = false;
            active.controller = null;
          }
        });
      },

      phase9ScheduleJobPoll(id) {
        const state = this.phase9;
        if (!state) return false;
        this.stopPhase9Polling();
        const token = this.phase9Token();
        state.activeJob.pollTimer = window.setTimeout(() => {
          if (!this.phase9 || !this.phase9TokenOpen(token)) return;
          this.phase9LoadJob(id);
        }, POLL_INTERVAL);
        return true;
      },

      phase9CreateJob(request) {
        if (!this.phase9CanWrite()) return Promise.resolve({ ok: false, error: tr('ui.reports.error.generate_permission') });
        const token = this.phase9Token();
        return window.AssetAccess.request(this, BASE + '/jobs', { method: 'POST', body: request })
          .then((payload) => {
            if (!this.phase9TokenOpen(token)) return { ok: false, cancelled: true };
            const job = normalizeJob(payload && payload.job ? payload.job : payload);
            this.phase9ApplyJob(job);
            if (job.status === 'queued' || job.status === 'running') this.phase9ScheduleJobPoll(job.id);
            return { ok: true, job: job };
          }).catch((error) => this.phase9Result(error));
      },

      phase9DownloadDocument(documentRef) {
        if (!this.authenticated || !this.can || !this.can('assets.view')) {
          return Promise.resolve({ ok: false, error: tr('ui.reports.error.download_permission') });
        }
        const reference = documentRef && typeof documentRef === 'object' ? documentRef : {};
        const id = text(reference.id);
        if (!id) return Promise.resolve({ ok: false, error: tr('ui.reports.error_document_unavailable') });
        const path = wirePath(reference.downloadUrl, BASE + '/documents/' + encodeURIComponent(id) + '/download');
        const token = this.phase9Token();
        this.phase9.download.id = id;
        this.phase9.download.loading = true;
        this.phase9.download.error = '';
        return window.AssetAccess.request(this, path, { responseType: 'blob' })
          .then((blob) => {
            if (!this.phase9TokenOpen(token)) return { ok: false, cancelled: true };
            const saved = saveBlob(blob, reference.name || 'reporte.pdf');
            return { ok: true, saved: saved, blob: blob };
          }).catch((error) => {
            if (!this.phase9TokenOpen(token)) return { ok: false, cancelled: true };
            const result = this.phase9Result(error);
            this.phase9.download.error = result.error;
            return result;
          }).finally(() => {
            if (this.phase9) this.phase9.download.loading = false;
          });
      },

      /* --------------------------------------------------------- QR/share */
      phase9LoadQr(assetId) {
        const state = this.phase9;
        if (!state || !this.phase9CanWrite() || !text(assetId)) return Promise.resolve(false);
        const qr = state.qr;
        if (text(qr.assetId) !== text(assetId)) {
          qr.assetId = text(assetId);
          qr.url = '';
          qr.svg = '';
          qr.share = null;
        }
        qr.assetId = text(assetId);
        return this.phase9Read(qr, BASE + '/assets/' + encodeURIComponent(assetId) + '/qr', (payload) => {
          const normalized = normalizeQr(payload);
          qr.assetId = normalized.assetId || text(assetId);
          qr.url = normalized.url;
          qr.svg = normalized.svg;
          qr.share = normalized.share;
          qr.error = '';
        });
      },

      phase9CreateShare(assetId, fields, expiresInDays) {
        if (!this.requirePermission('reports.share')) {
          return Promise.resolve({ ok: false, error: tr('ui.reports.error_share_permission') });
        }
        const selected = (Array.isArray(fields) ? fields : [])
          .map(text)
          .filter(function (key) { return PUBLIC_FIELDS.indexOf(key) !== -1; });
        if (!selected.length) return Promise.resolve({ ok: false, error: tr('ui.reports.error_public_field') });
        const state = this.phase9;
        const share = state.share;
        const token = this.phase9Token();
        share.creating = true;
        share.error = '';
        return window.AssetAccess.request(this, BASE + '/assets/' + encodeURIComponent(assetId) + '/shares', {
          method: 'POST',
          body: { fields: selected, expiresInDays: Math.max(1, Math.trunc(number(expiresInDays, 7))) }
        }).then((payload) => {
          if (!this.phase9TokenOpen(token)) return { ok: false, cancelled: true };
          const created = normalizeShare(payload && payload.share ? payload.share : payload);
          share.created = created;
          if (created && state.qr.assetId === text(assetId)) {
            state.qr.share = created;
            if (created.url && !state.qr.url) state.qr.url = created.url.split('/#/')[0] || '';
          }
          return { ok: true, share: created };
        }).catch((error) => {
          if (!this.phase9TokenOpen(token)) return { ok: false, cancelled: true };
          const result = this.phase9Result(error);
          share.error = result.error;
          return result;
        }).finally(() => {
          if (this.phase9TokenOpen(token)) share.creating = false;
        });
      },

      phase9RevokeShare(shareId) {
        if (!this.requirePermission('reports.share')) {
          return Promise.resolve({ ok: false, error: tr('ui.reports.error_revoke_permission') });
        }
        const state = this.phase9;
        const token = this.phase9Token();
        state.share.revoking = true;
        state.share.error = '';
        return window.AssetAccess.request(this, BASE + '/shares/' + encodeURIComponent(shareId), { method: 'DELETE' })
          .then(() => {
            if (!this.phase9TokenOpen(token)) return { ok: false, cancelled: true };
            if (state.qr.share && state.qr.share.id === shareId) state.qr.share = null;
            if (state.share.created && state.share.created.id === shareId) state.share.created = null;
            return { ok: true };
          }).catch((error) => {
            if (!this.phase9TokenOpen(token)) return { ok: false, cancelled: true };
            const result = this.phase9Result(error);
            state.share.error = result.error;
            return result;
          }).finally(() => {
            if (this.phase9TokenOpen(token)) state.share.revoking = false;
          });
      },

      /* ------------------------------------------------- public/private page */
      phase9LoadPublicReport(token) {
        const state = this.phase9;
        if (!state) return Promise.resolve(false);
        const value = text(token);
        const report = state.publicReport;
        if (report.controller) report.controller.abort();
        const controller = makeController();
        const epoch = nextEpoch();
        report.epoch = epoch;
        report.controller = controller;
        report.token = value;
        report.loading = true;
        report.error = '';
        // This projection belongs to exactly one capability. Clearing it before
        // the read (and on every failure) is what keeps a revoked, missing or
        // failed capability from painting the previous record on screen.
        report.asset = null;
        report.fields = [];
        report.expiresAt = '';
        report.loaded = false;
        if (!value) {
          report.loading = false;
          report.error = tr('ui.reports.public_link_invalid');
          return Promise.resolve(false);
        }
        return window.AssetAccess.request(this, BASE + '/public/' + encodeURIComponent(value), {
          signal: controller ? controller.signal : undefined
        }).then((payload) => {
          if (epoch !== report.epoch || !this.phase9 || this.phase9.publicReport !== report || report.token !== value) return false;
          const asset = payload && payload.asset && typeof payload.asset === 'object' ? payload.asset : null;
          report.asset = asset;
          report.fields = Array.isArray(payload && payload.fields)
            ? payload.fields.map(text).filter(function (field) { return PUBLIC_FIELDS.indexOf(field) !== -1; })
            : [];
          report.expiresAt = text(payload && payload.expiresAt);
          report.loaded = true;
          return true;
        }).catch((error) => {
          if (epoch !== report.epoch || !this.phase9 || this.phase9.publicReport !== report) return false;
          if (error && error.name === 'AbortError') return false;
          // A failed read leaves nothing readable behind: the page shows the
          // unavailable state instead of a record the capability no longer covers.
          report.asset = null;
          report.fields = [];
          report.expiresAt = '';
          report.loaded = false;
          report.error = text(error && error.message) || tr('ui.reports.public_link_unavailable');
          return false;
        }).finally(() => {
          if (epoch === report.epoch && this.phase9 && this.phase9.publicReport === report) {
            report.loading = false;
            report.controller = null;
          }
        });
      },

      phase9LoadPrivateReport(assetId) {
        const state = this.phase9;
        if (!state || !this.phase9CanWrite() || !text(assetId)) return Promise.resolve(false);
        const report = state.privateReport;
        report.assetId = text(assetId);
        return this.phase9Read(report, BASE + '/assets/' + encodeURIComponent(assetId), (payload) => {
          const asset = payload && typeof payload === 'object' && payload.asset && typeof payload.asset === 'object'
            ? payload.asset
            : payload;
          report.asset = typeof this.inventoryMapAsset === 'function' ? this.inventoryMapAsset(asset) : asset;
          const allowed = window.AssetReportEngine && window.AssetReportEngine.fieldKeys
            ? window.AssetReportEngine.fieldKeys('inventory')
            : PUBLIC_FIELDS.concat(['responsible', 'serial', 'brand', 'model', 'ip', 'purchaseCost', 'technical']);
          report.fields = Array.isArray(payload && payload.fields)
            ? payload.fields.map(text).filter(function (field) { return allowed.indexOf(field) !== -1; })
            : allowed;
        });
      }
    }
  };
})();
