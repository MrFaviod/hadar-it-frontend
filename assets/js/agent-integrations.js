/* Engine selection, shared model catalog and integration administration.
 *
 * Provider URLs, credentials and installation authority stay on the server.
 * The browser selects an offered instance/model, streams a session and renders
 * the installer receipt exactly as reported; a verified flag is never inferred.
 */
(function () {
  'use strict';

  // Copy resolved outside a mounted template goes through the same runtime, so
  // toasts, notices and computed labels follow the active locale. Reading the
  // active locale keeps a computed that resolves copy reactive on a hot switch.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    if (!runtime) return '';
    if (runtime.i18n) runtime.i18n.global.locale.value;
    return runtime.t(key, params);
  }

  // Product and engine names are stable identifiers, not copy: they read the
  // same in every language.
  const ENGINE_LABELS = {
    pydantic: 'Pydantic AI',
    opencode: 'OpenCode',
    hermes: 'Hermes'
  };

  // Label maps hold catalog keys and resolve at render time, so a language
  // switch never keeps copy captured while the module was loading.
  const CAPABILITY_LABELS = {
    streaming: 'ui.agents.capability_streaming',
    cancel: 'ui.agents.capability_cancel',
    tools: 'ui.agents.capability_tools',
    usage: 'ui.agents.capability_usage',
    sessions: 'ui.agents.capability_sessions',
    models: 'ui.agents.capability_models'
  };

  const OPERATIONS = [
    { id: 'install', label: 'ui.agents.operation_install' },
    { id: 'verify', label: 'ui.agents.operation_verify' },
    { id: 'update', label: 'ui.agents.operation_update' },
    { id: 'repair', label: 'ui.agents.operation_repair' },
    { id: 'disable', label: 'ui.agents.operation_disable' },
    { id: 'uninstall', label: 'ui.agents.operation_uninstall' }
  ];

  function capabilityLabel(id) {
    const key = CAPABILITY_LABELS[id];
    return key ? tr(key) : text(id);
  }

  function operationLabel(operation) {
    return operation ? tr(operation.label) : '';
  }

  // Global IA administration is an installation-owned capability: the server
  // rejects it without system.providers, so the browser gate mirrors that.
  const ADMIN_PERMISSION = 'system.providers';

  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : (fallback || '');
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function formatTokens(value) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.number(number(value)) : String(number(value));
  }

  // Daily AI quota contract: /api/v1/agent/usage. A missing field is
  // unavailable, never zero; an explicit null limit is unlimited and zero
  // denies new admissions. The browser renders those distinctions and never
  // recomputes totals the server already produced.
  const QUOTA_BASE = '/agent/usage';
  const QUOTA_FUNDING_LABELS = { company: 'ui.agents.funding_company', personal: 'ui.agents.funding_personal' };
  const QUOTA_LIMIT_SOURCE_LABELS = { override: 'ui.agents.limit_source_override', policy: 'ui.agents.limit_source_policy', default: 'ui.agents.limit_source_default', legacy_config: 'ui.agents.limit_source_legacy', record_only: 'ui.agents.limit_source_record_only', not_applicable: 'ui.agents.limit_source_not_applicable' };
  const PROVIDER_CREDENTIAL_LABELS = {
    missing: 'ui.agents.credential_missing',
    primary: 'ui.agents.credential_primary',
    older: 'ui.agents.credential_older',
    unreadable: 'ui.agents.credential_unreadable',
    unavailable: 'ui.agents.credential_unavailable'
  };
  const PROVIDER_CHECK_LABELS = {
    unauthorized: 'ui.agents.check_unauthorized',
    unreachable: 'ui.agents.check_unreachable',
    blocked_address: 'ui.agents.check_blocked_address',
    redirect: 'ui.agents.check_redirect',
    invalid_response: 'ui.agents.check_invalid_response',
    credential_unavailable: 'ui.agents.check_credential_unavailable',
    timeout: 'ui.agents.check_timeout',
    request_failed: 'ui.agents.check_request_failed'
  };
  const PROVIDER_CAPABILITY_FIELDS = ['image', 'file'];
  function normalizeCapabilities(raw) {
    const result = {};
    if (!raw || typeof raw !== 'object') return result;
    Object.keys(raw).forEach(id => {
      const entry = raw[id] && typeof raw[id] === 'object' ? raw[id] : {};
      result[id] = {
        image: typeof entry.image === 'boolean' ? entry.image : null,
        file: typeof entry.file === 'boolean' ? entry.file : null,
        source: text(entry.source, 'unknown')
      };
    });
    return result;
  }
  const QUOTA_PRECISION_LABELS = { measured: 'ui.agents.precision_measured', estimated: 'ui.agents.precision_estimated', unavailable: 'ui.agents.not_available' };
  const QUOTA_SOURCE_LABELS = { provider: 'ui.agents.source_provider', engine: 'ui.agents.engine', estimate: 'ui.agents.source_estimate', none: 'ui.agents.source_none', legacy: 'ui.agents.source_legacy' };
  const QUOTA_STATE_LABELS = { settled: 'ui.agents.state_settled', unresolved: 'ui.agents.state_unresolved', pending: 'ui.agents.state_pending', released: 'ui.agents.state_released', legacy: 'ui.agents.state_legacy' };
  const QUOTA_ENGINE_MODES = { managed: 'ui.agents.mode_managed', direct: 'ui.agents.mode_direct', builtin: 'ui.agents.mode_builtin' };
  const QUOTA_ENGINE_ENFORCEMENTS = { strict: 'ui.agents.enforcement_strict', admission_only: 'ui.agents.enforcement_admission_only', observed: 'ui.agents.enforcement_observed', unavailable: 'ui.agents.not_available' };
  const QUOTA_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function quotaHas(object, key) {
    return !!object && Object.prototype.hasOwnProperty.call(object, key);
  }

  function quotaToken(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
  }

  function normalizeQuotaBalance(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!quotaHas(raw, 'limitTokens') || !quotaHas(raw, 'consumedTokens')) return null;
    const limit = raw.limitTokens === null ? null : quotaToken(raw.limitTokens);
    const consumed = quotaToken(raw.consumedTokens);
    if ((raw.limitTokens !== null && limit === null) || consumed === null) return null;
    const optional = key => quotaHas(raw, key) ? quotaToken(raw[key]) : null;
    const precision = raw.precision && typeof raw.precision === 'object' ? raw.precision : {};
    return {
      limit,
      unlimited: limit === null,
      recordOnly: raw.limitSource === 'record_only',
      limitSource: text(raw.limitSource),
      consumed,
      reserved: optional('reservedTokens'),
      legacy: optional('legacyTokens'),
      availableKnown: quotaHas(raw, 'availableTokens'),
      available: optional('availableTokens'),
      pendingCount: optional('pendingCount'),
      precision: {
        measured: quotaToken(precision.measured),
        estimated: quotaToken(precision.estimated),
        unavailable: quotaToken(precision.unavailable)
      }
    };
  }

  function normalizeQuotaUsage(payload) {
    const raw = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    const funding = raw && raw.funding && typeof raw.funding === 'object' ? raw.funding : null;
    const company = normalizeQuotaBalance(funding && funding.company);
    const personal = normalizeQuotaBalance(funding && funding.personal);
    return {
      periodDay: text(raw && raw.periodDay),
      timezone: text(raw && raw.timezone),
      pendingTimezone: text(raw && raw.pendingTimezone),
      pendingEffectiveDay: text(raw && raw.pendingEffectiveDay),
      company,
      personal,
      hasData: !!(company || personal)
    };
  }

  function normalizeQuotaPolicy(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const limit = value => value === null ? null : quotaToken(value);
    const companyKnown = quotaHas(payload, 'companyDailyLimit');
    const companyDailyLimit = companyKnown ? limit(payload.companyDailyLimit) : null;
    if (companyKnown && payload.companyDailyLimit !== null && companyDailyLimit === null) return null;
    return {
      companyKnown,
      available: companyKnown,
      companyDailyLimit,
      companyLimitSource: text(payload.companyLimitSource),
      timezone: text(payload.timezone),
      pendingTimezone: text(payload.pendingTimezone),
      pendingEffectiveDay: text(payload.pendingEffectiveDay),
      overrides: Array.isArray(payload.overrides) ? payload.overrides.filter(item => item && typeof item === 'object' && text(item.userId)).map(item => ({
        userId: text(item.userId),
        scope: 'company',
        dailyLimit: item.dailyLimit === null ? null : quotaToken(item.dailyLimit),
        updatedAt: text(item.updatedAt)
      })) : [],
      serverTime: text(payload.serverTime)
    };
  }

  function normalizeQuotaOverrides(payload) {
    if (!payload || !Array.isArray(payload.overrides)) return null;
    return normalizeQuotaPolicy({ companyDailyLimit: null, overrides: payload.overrides.filter(item => item && item.scope !== 'personal') }).overrides;
  }

  function normalizeQuotaReport(payload) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) return null;
    if (!payload.totals || typeof payload.totals !== 'object') return null;
    return {
      timezone: text(payload.timezone),
      generatedAt: text(payload.generatedAt),
      filters: payload.filters && typeof payload.filters === 'object' ? payload.filters : {},
      groupBy: Array.isArray(payload.groupBy) ? payload.groupBy.map(item => text(item)).filter(Boolean) : [],
      items: payload.items.filter(item => item && typeof item === 'object' && !Array.isArray(item)),
      totals: payload.totals,
      precision: payload.precision && typeof payload.precision === 'object' ? payload.precision : {}
    };
  }

  function normalizeQuotaPending(payload) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) return null;
    return payload.items.filter(item => item && typeof item === 'object' && !Array.isArray(item));
  }

  function engineLabel(value) {
    return ENGINE_LABELS[value] || text(value) || tr('ui.agents.engine');
  }

  function isAbsolutePath(value) {
    return typeof value === 'string' && (value.charAt(0) === '/' || /^[A-Za-z]:[\\/]/.test(value));
  }

  // POST /agent/integrations/targets returns the canonical installer envelope
  // `{target, detection}`. Both members are required: an arbitrary 200 must not
  // become an installable target by inventing a flat `detected` flag.
  function normalizeTargetDetection(payload, expectedEngine) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const target = payload.target;
    const detection = payload.detection;
    if (!target || typeof target !== 'object' || Array.isArray(target) ||
        !detection || typeof detection !== 'object' || Array.isArray(detection)) return null;
    if (target.remote !== false) return null;
    if (target.profile !== null && typeof target.profile !== 'string') return null;
    if (target.version !== null && typeof target.version !== 'string') return null;
    if (detection.profile !== null && typeof detection.profile !== 'string') return null;
    const engine = text(target.engine);
    const detectionEngine = text(detection.engine);
    const targetPath = text(detection.targetPath);
    const format = text(detection.format);
    const version = text(detection.version);
    const configFile = text(detection.configFile);
    const skillsDirectory = text(detection.skillsDirectory);
    if (!engine || detectionEngine !== engine || (expectedEngine && engine !== expectedEngine)) return null;
    if (!isAbsolutePath(text(target.path)) || !isAbsolutePath(targetPath)) return null;
    if (!format || !version || !configFile || !skillsDirectory) return null;
    if (typeof detection.configExists !== 'boolean') return null;
    if (!Array.isArray(detection.limitations) ||
        detection.limitations.some(item => typeof item !== 'string')) return null;
    return {
      detected: true,
      engine,
      format,
      version,
      profile: text(detection.profile) || text(target.profile),
      targetPath,
      configFile,
      configExists: detection.configExists,
      skillsDirectory,
      limitations: detection.limitations.map(item => item.trim()).filter(Boolean)
    };
  }

  function isHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function samePreference(a, b) {
    return !!a && !!b && text(a.instanceId) === text(b.instanceId) && text(a.model) === text(b.model);
  }

  function defaultModelFor(instance) {
    if (!instance) return '';
    const models = Array.isArray(instance.models) ? instance.models.filter(model => model && typeof model.id === 'string') : [];
    const preferred = text(instance.defaultModel);
    if (preferred && models.some(model => model.id === preferred)) return preferred;
    return models.length ? models[0].id : preferred;
  }

  function modelLabel(model) {
    const name = text(model && model.name, text(model && model.id));
    return model && model.free === true ? name + ' · ' + tr('ui.agents.model_free') : name;
  }

  // Exact instance-administration seam: quota routing is an explicit operator
  // decision. Absent authorization the fields are omitted so the server keeps
  // its own default; no browser-side strictness is inferred from the mode.
  function quotaPositiveInteger(value) {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    }
    const raw = text(value);
    if (!/^\d+$/.test(raw)) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function quotaInstanceDraft(instance) {
    const managed = !!instance && instance.quotaMode === 'managed';
    const context = managed && instance.managedContextTokens !== null && instance.managedContextTokens !== undefined
      ? String(instance.managedContextTokens)
      : '';
    return {
      quotaMode: managed ? 'managed' : 'direct',
      directCompanyException: !managed && !!instance && instance.directCompanyException === true,
      managedProviderId: managed && instance ? text(instance.managedProviderId) : '',
      managedContextTokens: context
    };
  }

  function quotaInstanceBody(draft, authorized) {
    if (!authorized) return {};
    const managed = !!draft && draft.quotaMode === 'managed';
    return {
      quotaMode: managed ? 'managed' : 'direct',
      directCompanyException: !managed && !!draft && draft.directCompanyException === true,
      managedProviderId: managed ? text(draft.managedProviderId) : null,
      managedContextTokens: managed ? quotaPositiveInteger(draft.managedContextTokens) : null
    };
  }

  function quotaInstanceError(draft) {
    if (!draft || draft.quotaMode !== 'managed') return '';
    if (!QUOTA_UUID_RE.test(text(draft.managedProviderId))) {
      return tr('ui.agents.error_managed_provider');
    }
    if (!text(draft.defaultModel)) {
      return tr('ui.agents.error_managed_model');
    }
    if (quotaPositiveInteger(draft.managedContextTokens) === null) {
      return tr('ui.agents.error_managed_context');
    }
    return '';
  }

  function statusTone(status, verified) {
    if (verified === true) return 'ok';
    if (status === 'conflict') return 'warn';
    if (status === 'failed') return 'down';
    return 'hold';
  }

  function installationStatusLabel(record) {
    if (!record) return tr('ui.agents.status_no_data');
    if (record.verified === true) return tr('ui.agents.status_verified');
    const status = text(record.status);
    if (status === 'configured') return tr('ui.agents.status_configured');
    if (status === 'exported') return tr('ui.agents.status_exported');
    if (status === 'conflict') return tr('ui.agents.status_conflict');
    if (status === 'failed') return tr('ui.agents.status_failed');
    return status ? tr('ui.agents.status_with_value', { status: status }) : tr('ui.agents.status_no_server_verification');
  }

  function checkText(check) {
    if (typeof check === 'string') return check;
    if (check && typeof check === 'object') {
      const label = text(check.label, text(check.name, text(check.check, tr('ui.agents.check_fallback'))));
      const detail = text(check.detail, text(check.message, text(check.evidence, '')));
      return detail ? label + ': ' + detail : label;
    }
    return '';
  }

  // The receipt may hide an invalid configuration behind a failed status with
  // no checks; surface the sanitized server message instead of a generic line.
  function resultErrorText(result) {
    const error = result && result.error;
    if (!error) return '';
    if (typeof error === 'string') return text(error);
    return text(error.message) || text(error.code);
  }

  function resultLimitations(result) {
    return Array.isArray(result && result.limitations) ? result.limitations : [];
  }

  function limitationText(item) {
    if (typeof item === 'string') return text(item);
    if (item && typeof item === 'object') return text(item.message) || text(item.detail) || text(item.code);
    return text(item);
  }

  // Client-side Blob download for a server-built request. The request is the
  // only artifact the remote helper consumes; PI/credentials stay out of it.
  function saveJsonFile(value, installationId) {
    if (value === undefined || value === null) return false;
    if (typeof document === 'undefined' || !document.body || typeof Blob === 'undefined' ||
        typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
    try {
      const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      const blob = new Blob([body], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'itsm-install-' + String(installationId || 'remoto').replace(/[^A-Za-z0-9._-]/g, '_') + '.json';
      document.body.appendChild(link);
      if (typeof link.click === 'function') link.click();
      if (typeof link.remove === 'function') link.remove();
      setTimeout(() => { URL.revokeObjectURL(url); }, 0);
      return true;
    } catch (_) {
      return false;
    }
  }

  // The hash parser and hash writer are shared assets outside this feature's
  // edit surface. This narrow seam keeps `#/configuracion/ia` addressable
  // without forking the whole route table.
  function routeOverride(route, hash) {
    if (!route || route.name !== 'config') return null;
    const clean = String(hash || '').replace(/^#/, '').replace(/\/+$/, '');
    if (clean === '/configuracion/ia') return Object.assign({}, route, { section: 'ia' });
    return null;
  }

  const api = {
    engines(vm, options) {
      return window.AssetAccess.request(vm, '/agent/engines', options || {});
    },
    savePreference(vm, body, options) {
      return window.AssetAccess.request(vm, '/agent/preferences', Object.assign({ method: 'PUT', body }, options || {}));
    },
    usageMe(vm, options) {
      return window.AssetAccess.request(vm, QUOTA_BASE + '/me', options || {});
    },
    quotaPolicy(vm, options) {
      return window.AssetAccess.request(vm, QUOTA_BASE + '/policy', options || {});
    },
    saveQuotaPolicy(vm, body, options) {
      return window.AssetAccess.request(vm, QUOTA_BASE + '/policy', Object.assign({ method: 'PUT', body }, options || {}));
    },
    quotaOverrides(vm, options) {
      return window.AssetAccess.request(vm, QUOTA_BASE + '/overrides', options || {});
    },
    saveQuotaOverride(vm, userId, body, options) {
      return window.AssetAccess.request(vm, QUOTA_BASE + '/overrides/' + encodeURIComponent(userId), Object.assign({ method: 'PUT', body }, options || {}));
    },
    deleteQuotaOverride(vm, userId, scope, options) {
      return window.AssetAccess.request(vm, QUOTA_BASE + '/overrides/' + encodeURIComponent(userId) + '?scope=' + encodeURIComponent(scope), Object.assign({ method: 'DELETE' }, options || {}));
    },
    quotaReport(vm, query, options) {
      return window.AssetAccess.request(vm, QUOTA_BASE + '/report' + (query ? '?' + query : ''), options || {});
    },
    quotaPending(vm, options) {
      return window.AssetAccess.request(vm, QUOTA_BASE + '/pending?limit=100', options || {});
    },
    listSessions(vm, options) {
      return window.AssetAccess.request(vm, '/agent/sessions', options || {});
    },
    providers(vm, options) {
      return window.AssetAccess.request(vm, '/agent/providers', options || {});
    },
    saveProvider(vm, id, body, options) {
      return window.AssetAccess.request(vm, '/agent/providers' + (id ? '/' + encodeURIComponent(id) : ''), Object.assign({ method: id ? 'PATCH' : 'POST', body }, options || {}));
    },
    checkProvider(vm, id, options) {
      return window.AssetAccess.request(vm, '/agent/providers/' + encodeURIComponent(id) + '/check', Object.assign({ method: 'POST' }, options || {}));
    },
    deleteProvider(vm, id, options) {
      return window.AssetAccess.request(vm, '/agent/providers/' + encodeURIComponent(id), Object.assign({ method: 'DELETE' }, options || {}));
    },
    createSession(vm, body, options) {
      return window.AssetAccess.request(vm, '/agent/sessions', Object.assign({ method: 'POST', body }, options || {}));
    },
    getSession(vm, id, options) {
      return window.AssetAccess.request(vm, '/agent/sessions/' + encodeURIComponent(id), options || {});
    },
    patchSession(vm, id, body, options) {
      return window.AssetAccess.request(vm, '/agent/sessions/' + encodeURIComponent(id), Object.assign({ method: 'PATCH', body }, options || {}));
    },
    cancelSession(vm, id, options) {
      return window.AssetAccess.request(vm, '/agent/sessions/' + encodeURIComponent(id) + '/cancel', Object.assign({ method: 'POST' }, options || {}));
    },
    streamMessage(vm, id, body, options) {
      return window.AssetAccess.stream(vm, '/agent/sessions/' + encodeURIComponent(id) + '/messages', Object.assign({ method: 'POST', body }, options || {}));
    },
    // Chat attachment bytes travel as the raw request body with the shared
    // cookie/CSRF transport; the server sniffs the real type and owns the id.
    uploadSessionAttachment(vm, id, filename, bytes, options) {
      const query = '?filename=' + encodeURIComponent(String(filename || ''));
      return window.AssetAccess.request(vm, '/agent/sessions/' + encodeURIComponent(id) + '/attachments' + query, Object.assign({ method: 'POST', body: bytes }, options || {}));
    },
    deleteSessionAttachment(vm, id, attachmentId, options) {
      return window.AssetAccess.request(
        vm,
        '/agent/sessions/' + encodeURIComponent(id) + '/attachments/' + encodeURIComponent(attachmentId),
        Object.assign({ method: 'DELETE' }, options || {})
      );
    },
    assetAttachments(vm, assetId, options) {
      return window.AssetAccess.request(
        vm,
        '/assets/' + encodeURIComponent(assetId) + '/attachments?limit=50&offset=0',
        options || {}
      );
    },
    integrations(vm, options) {
      return window.AssetAccess.request(vm, '/agent/integrations', options || {});
    },
    catalog(vm, options) {
      return window.AssetAccess.request(vm, '/agent/integrations/catalog', options || {});
    },
    saveInstance(vm, id, body, options) {
      const path = '/agent/integrations/instances' + (id ? '/' + encodeURIComponent(id) : '');
      return window.AssetAccess.request(vm, path, Object.assign({ method: id ? 'PUT' : 'POST', body }, options || {}));
    },
    setModuleEnabled(vm, id, enabled, options) {
      return window.AssetAccess.request(vm, '/agent/integrations/modules/' + encodeURIComponent(id), Object.assign({ method: 'PUT', body: { enabled: !!enabled } }, options || {}));
    },
    detectTarget(vm, body, options) {
      return window.AssetAccess.request(vm, '/agent/integrations/targets', Object.assign({ method: 'POST', body }, options || {}));
    },
    apply(vm, body, options) {
      return window.AssetAccess.request(vm, '/agent/integrations/install', Object.assign({ method: 'POST', body }, options || {}));
    },
    importReceipt(vm, body, options) {
      return window.AssetAccess.request(vm, '/agent/integrations/receipts', Object.assign({ method: 'POST', body }, options || {}));
    },
    installationRequest(vm, id, options) {
      return window.AssetAccess.request(vm, '/agent/integrations/installations/' + encodeURIComponent(id) + '/request', options || {});
    }
  };

  window.AssetAgentApi = api;

  // Own balance for the signed-in account. This state is private: every
  // request records the active identity, a newer request supersedes it, and a
  // late response from a replaced account is discarded. No interval or local
  // storage is used; refreshing is explicit, on focus/visibility, after a run,
  // and on the next server read of the day.
  window.AssetAgentQuotaMixin = {
    data() {
      return {
        quotaSnapshot: null,
        quotaLoaded: false,
        quotaLoading: false,
        quotaError: '',
        quotaEpoch: 0,
        quotaOwner: '',
        quotaController: null
      };
    },
    computed: {
      quotaCompany() { return this.quotaSnapshot ? this.quotaSnapshot.company : null; },
      quotaPersonal() { return this.quotaSnapshot ? this.quotaSnapshot.personal : null; },
      quotaPeriodDay() { return this.quotaSnapshot ? this.quotaSnapshot.periodDay : ''; },
      quotaTimezone() { return this.quotaSnapshot ? this.quotaSnapshot.timezone : ''; },
      quotaPendingTimezone() { return this.quotaSnapshot ? this.quotaSnapshot.pendingTimezone : ''; },
      quotaPendingEffectiveDay() { return this.quotaSnapshot ? this.quotaSnapshot.pendingEffectiveDay : ''; },
      quotaHasData() { return !!(this.quotaSnapshot && this.quotaSnapshot.hasData); },
      quotaUnavailable() { return this.quotaLoaded && !this.quotaHasData; },
      quotaSelectedFunding() {
        const instance = this.agentActiveInstance;
        if (!instance) return '';
        if (instance.quota && instance.quota.mode === 'managed' && typeof this.managedProviderId === 'string') {
          return this.managedProviderId ? 'personal' : 'company';
        }
        const scope = text(instance.providerScope) || text(instance.funding);
        if (scope === 'personal') return 'personal';
        if (scope === 'company' || scope === 'global') return 'company';
        return '';
      },
      quotaSelectedBalance() {
        if (this.quotaSelectedFunding === 'personal') return this.quotaPersonal;
        if (this.quotaSelectedFunding === 'company') return this.quotaCompany;
        return null;
      },
      quotaSelectedNotice() {
        if (!this.agentActiveInstance) return '';
        if (this.quotaSelectedFunding === 'personal') {
          return tr('ui.agents.quota_notice_personal');
        }
        if (this.quotaSelectedFunding === 'company') {
          return tr('ui.agents.quota_notice_company');
        }
        return tr('ui.agents.quota_notice_unknown');
      },
      quotaAccounts() {
        return [
          { scope: 'company', label: tr(QUOTA_FUNDING_LABELS.company), balance: this.quotaCompany, selected: this.quotaSelectedFunding === 'company' },
          { scope: 'personal', label: tr(QUOTA_FUNDING_LABELS.personal), balance: this.quotaPersonal, selected: this.quotaSelectedFunding === 'personal' }
        ];
      }
    },
    methods: {
      quotaTokenText(value) {
        const parsed = quotaToken(value);
        return parsed === null ? tr('ui.agents.not_available') : formatTokens(parsed);
      },
      quotaAmountText(value) {
        const parsed = quotaToken(value);
        return parsed === null ? tr('ui.agents.not_available') : tr('ui.agents.tokens_value', { value: formatTokens(parsed) });
      },
      quotaFundingLabel(scope) { return tr(QUOTA_FUNDING_LABELS[scope] || 'ui.agents.funding_unattributed'); },
      quotaLimitSourceLabel(source) { return tr(QUOTA_LIMIT_SOURCE_LABELS[source] || 'ui.agents.limit_source_unreported'); },
      quotaLimitText(balance) {
        if (!balance) return tr('ui.agents.not_available');
        if (balance.recordOnly) return tr('ui.agents.no_daily_limit');
        if (balance.unlimited) return tr('ui.agents.unlimited');
        return tr('ui.agents.tokens_value', { value: formatTokens(balance.limit) }) +
          (balance.limit === 0 ? ' · ' + tr('ui.agents.limit_zero_admission') : '');
      },
      quotaAvailableText(balance) {
        if (!balance) return tr('ui.agents.not_available');
        if (balance.recordOnly) return tr('ui.agents.not_applicable_own_key');
        if (balance.unlimited) return tr('ui.agents.unlimited');
        if (!balance.availableKnown || balance.available === null) return tr('ui.agents.not_available');
        return tr('ui.agents.tokens_value', { value: formatTokens(balance.available) });
      },
      quotaPrecisionText(balance) {
        if (!balance) return tr('ui.agents.not_available');
        const precision = balance.precision || {};
        return tr('ui.agents.precision_summary', {
          measured: this.quotaTokenText(precision.measured),
          estimated: this.quotaTokenText(precision.estimated),
          unavailable: this.quotaTokenText(precision.unavailable)
        });
      },
      quotaEngineStatus(instance) {
        const quota = instance && instance.quota && typeof instance.quota === 'object' && !Array.isArray(instance.quota) ? instance.quota : null;
        if (!quota) {
          return {
            known: false,
            mode: '',
            modeLabel: tr('ui.agents.not_reported'),
            enforcement: 'unavailable',
            enforcementLabel: tr(QUOTA_ENGINE_ENFORCEMENTS.unavailable),
            reason: tr('ui.agents.engine_quota_unknown'),
            directException: false,
            strict: false
          };
        }
        const mode = QUOTA_ENGINE_MODES[quota.mode] ? quota.mode : '';
        const enforcement = QUOTA_ENGINE_ENFORCEMENTS[quota.enforcement] ? quota.enforcement : 'unavailable';
        return {
          known: true,
          mode,
          modeLabel: mode ? tr(QUOTA_ENGINE_MODES[mode]) : tr('ui.agents.not_reported'),
          enforcement,
          enforcementLabel: tr(QUOTA_ENGINE_ENFORCEMENTS[enforcement]),
          reason: text(quota.reason),
          directException: quota.directException === true,
          strict: mode === 'managed' && enforcement === 'strict'
        };
      },
      quotaPrecisionLabel(value) { return tr(QUOTA_PRECISION_LABELS[value] || 'ui.agents.not_available'); },
      quotaSourceLabel(value) { return tr(QUOTA_SOURCE_LABELS[value] || 'ui.agents.source_none'); },
      quotaStateLabel(value) { return tr(QUOTA_STATE_LABELS[value] || 'ui.agents.state_unclassified'); },
      isCurrentQuotaEpoch(epoch) {
        return epoch === this.quotaEpoch && this.disposed !== true && this.app.authenticated !== false &&
          this.quotaOwner === String(this.app.activeUserId || '');
      },
      resetQuota() {
        this.quotaEpoch += 1;
        if (this.quotaController && typeof this.quotaController.abort === 'function') this.quotaController.abort();
        this.quotaController = null;
        this.quotaSnapshot = null;
        this.quotaLoaded = false;
        this.quotaLoading = false;
        this.quotaError = '';
        this.quotaOwner = '';
      },
      applyQuota(payload) {
        const usage = normalizeQuotaUsage(payload);
        this.quotaSnapshot = Object.assign({ owner: String(this.app.activeUserId || '') }, usage);
        this.quotaLoaded = true;
        this.quotaError = '';
      },
      async loadQuota() {
        if (!this.app.authenticated || !window.AssetAccess || typeof window.AssetAccess.request !== 'function') {
          this.resetQuota();
          return false;
        }
        const epoch = this.quotaEpoch + 1;
        this.quotaEpoch = epoch;
        if (this.quotaController && typeof this.quotaController.abort === 'function') this.quotaController.abort();
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        this.quotaController = controller;
        this.quotaOwner = String(this.app.activeUserId || '');
        this.quotaLoading = true;
        this.quotaError = '';
        try {
          const payload = await api.usageMe(this.app, controller ? { signal: controller.signal } : {});
          if (!this.isCurrentQuotaEpoch(epoch)) return false;
          this.applyQuota(payload);
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaEpoch(epoch)) return false;
          this.quotaLoaded = false;
          this.quotaSnapshot = null;
          if (error && error.status === 401) {
            this.quotaOwner = '';
            this.quotaLoading = false;
            this.quotaError = tr('ui.agents.error_quota_session');
          } else {
            this.quotaError = (error && (error.serverMessage || error.message)) || tr('ui.agents.error_quota_load');
          }
          return false;
        } finally {
          if (this.isCurrentQuotaEpoch(epoch)) this.quotaLoading = false;
        }
      },
      onQuotaFocus() {
        if (this.surfaceVisible === false) return;
        if (this.app.authenticated) void this.loadQuota();
      },
      onQuotaVisibility() {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') this.onQuotaFocus();
      }
    },
    mounted() {
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('focus', this.onQuotaFocus);
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', this.onQuotaVisibility);
    },
    beforeUnmount() {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('focus', this.onQuotaFocus);
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', this.onQuotaVisibility);
      this.resetQuota();
    }
  };

  // Formatting and server-DTO helpers are stateless. Settings uses only this
  // surface so it never owns or refreshes the caller's balance.
  const quotaFormatMethods = window.AssetAgentQuotaMixin.methods;
  window.AssetAgentQuotaFormatMixin = {
    methods: {
      quotaTokenText: quotaFormatMethods.quotaTokenText,
      quotaAmountText: quotaFormatMethods.quotaAmountText,
      quotaFundingLabel: quotaFormatMethods.quotaFundingLabel,
      quotaLimitSourceLabel: quotaFormatMethods.quotaLimitSourceLabel,
      quotaLimitText: quotaFormatMethods.quotaLimitText,
      quotaAvailableText: quotaFormatMethods.quotaAvailableText,
      quotaPrecisionText: quotaFormatMethods.quotaPrecisionText,
      quotaEngineStatus: quotaFormatMethods.quotaEngineStatus,
      quotaPrecisionLabel: quotaFormatMethods.quotaPrecisionLabel,
      quotaSourceLabel: quotaFormatMethods.quotaSourceLabel,
      quotaStateLabel: quotaFormatMethods.quotaStateLabel
    }
  };

  window.AssetAgentEngineMixin = {
    data() {
      return {
        agentEngines: [],
        agentPreference: { instanceId: '', model: '' },
        agentPreferenceSaved: { instanceId: '', model: '' },
        agentBudget: null,
        agentEnginesLoaded: false,
        agentEnginesLoading: false,
        agentEnginesAvailable: false,
        agentEnginesError: '',
        agentSelectionNotice: '',
        agentEpoch: 0,
        agentPreferenceEpoch: 0
      };
    },
    computed: {
      agentInstanceList() {
        return Array.isArray(this.agentEngines) ? this.agentEngines : [];
      },
      // The engine selector offers one choice per external engine: its named
      // profiles are selected separately. Pydantic instances are distinct
      // provider configurations (global or personal), so each one stays its own
      // choice instead of collapsing into an anonymous "Pydantic AI" option.
      agentEngineChoices() {
        const choices = [];
        const grouped = new Map();
        for (const instance of this.agentInstanceList) {
          if (!instance || typeof instance.id !== 'string' || !instance.id) continue;
          const engine = text(instance.engine);
          if (!engine) continue;
          if (engine === 'pydantic') {
            choices.push({
              value: instance.id,
              engine,
              instanceId: instance.id,
              label: this.agentInstanceLabel(instance),
              disabled: instance.enabled === false
            });
            continue;
          }
          const choice = grouped.get(engine);
          if (choice) {
            if (instance.enabled !== false) {
              if (choice.disabled) {
                const version = text(instance.version);
                choice.label = engineLabel(engine) + (version ? ' ' + version : '');
              }
              choice.disabled = false;
            }
            continue;
          }
          const version = text(instance.version);
          const created = {
            value: engine,
            engine,
            instanceId: '',
            label: engineLabel(engine) + (version ? ' ' + version : ''),
            disabled: instance.enabled === false
          };
          grouped.set(engine, created);
          choices.push(created);
        }
        return choices;
      },
      agentEngineValue() {
        const instance = this.agentActiveInstance;
        if (!instance) return '';
        const engine = text(instance.engine);
        return !engine || engine === 'pydantic' ? instance.id : engine;
      },
      agentProfileOptions() {
        const engine = this.agentActiveEngine;
        if (!engine || engine === 'pydantic') return [];
        return this.agentInstanceList.filter(instance =>
          instance && typeof instance.id === 'string' && instance.id && text(instance.engine) === engine);
      },
      // A profile is only a choice when the authorized discovery returned more
      // than one for the selected external engine. Single-profile engines show
      // no dead control, and Pydantic providers had their own engine choice.
      agentProfileSelectorVisible() {
        return this.agentProfileOptions.length > 1;
      },
      agentActiveInstance() {
        const id = this.agentPreference && this.agentPreference.instanceId;
        return this.agentInstanceList.find(instance => instance && instance.id === id) || null;
      },
      agentActiveEngine() {
        return this.agentActiveInstance ? text(this.agentActiveInstance.engine) : '';
      },
      agentModels() {
        const instance = this.agentActiveInstance;
        return instance && Array.isArray(instance.models) ? instance.models.filter(model => model && typeof model.id === 'string') : [];
      },
      agentDiscoveryErrors() {
        return this.agentInstanceList
          .filter(instance => instance && text(instance.error))
          .map(instance => ({
            id: instance.id,
            label: this.agentInstanceLabel(instance),
            error: text(instance.error)
          }));
      },
      agentActiveModel() {
        const id = this.agentPreference && this.agentPreference.model;
        return this.agentModels.find(model => model.id === id) || null;
      },
      agentCapabilityList() {
        const instance = this.agentActiveInstance;
        const capabilities = instance && instance.capabilities && typeof instance.capabilities === 'object' ? instance.capabilities : {};
        return Object.keys(capabilities)
          .filter(key => capabilities[key] === true)
          .map(key => ({ key, label: capabilityLabel(key) }));
      },
      agentBudgetSummary() {
        if (!this.agentBudget) return '';
        const parts = [];
        if (this.agentBudget.dailyLimit !== null && this.agentBudget.dailyLimit !== undefined) {
          parts.push(tr('ui.agents.budget_limit', { value: formatTokens(this.agentBudget.dailyLimit) }));
        }
        parts.push(tr('ui.agents.budget_used_measured', { value: formatTokens(this.agentBudget.usedMeasured) }));
        parts.push(tr('ui.agents.budget_used_reported', { value: formatTokens(this.agentBudget.usedReported) }));
        return parts.join(' · ');
      },
      agentCanSelect() {
        return !this.agentEnginesLoading && this.agentInstanceList.length > 0;
      }
    },
    methods: {
      agentDefaultModel(instance) { return defaultModelFor(instance); },
      agentModelLabel(model) {
        return modelLabel(model);
      },
      agentInstanceLabel(instance) {
        if (!instance) return '';
        const engine = engineLabel(instance.engine);
        const version = text(instance.version);
        return (text(instance.name, engine) + ' · ' + engine) + (version ? ' ' + version : '');
      },
      // Only the profile or instance name already authorized by discovery is
      // shown; endpoints, directories and credentials never reach this label.
      agentProfileLabel(instance) {
        if (!instance) return '';
        return text(instance.profile) || text(instance.name, engineLabel(instance.engine));
      },
      // Picking an engine keeps the current or saved profile of that engine
      // when it is still authorized and enabled.
      agentEngineInstanceFor(engine) {
        const name = text(engine);
        if (!name) return null;
        const candidates = this.agentInstanceList.filter(instance =>
          instance && instance.enabled !== false && text(instance.engine) === name);
        if (!candidates.length) return null;
        const current = this.agentPreference && this.agentPreference.instanceId;
        const saved = this.agentPreferenceSaved && this.agentPreferenceSaved.instanceId;
        return candidates.find(instance => instance.id === current) ||
          candidates.find(instance => instance.id === saved) ||
          candidates[0];
      },
      agentProfileInstance(instanceId) {
        const engine = this.agentActiveEngine;
        if (!engine || engine === 'pydantic') return null;
        return this.agentInstanceList.find(instance =>
          instance && instance.id === instanceId && text(instance.engine) === engine) || null;
      },
      // A rejected same-session switch leaves the reactive preference intact,
      // so the native control is restored to the value that authority reports.
      agentResetSelection(event, value) {
        const target = event && typeof event === 'object' ? event.target : null;
        if (target && typeof value === 'string' && 'value' in target) target.value = value;
      },
      agentIdentityLabel(identity) {
        if (!identity) return '';
        return text(identity.name, text(identity.username, identity.id));
      },
      isCurrentAgentEpoch(epoch) {
        return epoch === this.agentEpoch && this.disposed !== true && this.app.authenticated !== false;
      },
      applyAgentEngines(payload, options) {
        const instances = payload && Array.isArray(payload.instances)
          ? payload.instances.filter(instance => instance && typeof instance.id === 'string' && instance.id)
          : [];
        const preference = payload && payload.preference && typeof payload.preference === 'object' ? payload.preference : {};
        const saved = { instanceId: text(preference.instanceId), model: text(preference.model) };
        this.agentEngines = instances;
        this.agentBudget = payload && payload.budget ? payload.budget : null;
        this.agentEnginesLoaded = true;
        this.agentEnginesAvailable = true;
        this.agentEnginesError = '';
        if (options && options.preserveSelection) {
          const selection = options.preserveSelection;
          this.agentPreference = { instanceId: text(selection.instanceId), model: text(selection.model) };
          this.agentPreferenceSaved = saved;
          const instance = instances.find(item => item.id === selection.instanceId && item.enabled !== false);
          const available = instance && Array.isArray(instance.models) && instance.models.some(item => item.id === selection.model);
          this.agentSelectionNotice = available ? '' : tr('ui.agents.notice_selection_unavailable');
          return;
        }

        const selectable = instances.filter(instance => instance.enabled !== false);
        let instance = selectable.find(item => item.id === saved.instanceId) || null;
        let notice = '';
        if (!instance && selectable.length) {
          instance = selectable[0];
          if (saved.instanceId) notice = tr('ui.agents.notice_instance_fallback', { name: text(instance.name, instance.id) });
        }
        let model = saved.model;
        if (instance) {
          const models = Array.isArray(instance.models) ? instance.models.filter(item => item && typeof item.id === 'string') : [];
          if (!models.some(item => item.id === model)) {
            const fallback = defaultModelFor(instance);
            if (saved.model) {
              const fallbackLabel = models.find(item => item.id === fallback);
              notice = tr('ui.agents.notice_model_fallback', { name: text(instance.name, instance.id) }) +
                (fallback ? ' ' + tr('ui.agents.notice_model_selected', { model: modelLabel(fallbackLabel || { id: fallback }) }) : '');
            }
            model = fallback;
          }
        } else {
          model = '';
        }
        this.agentPreference = { instanceId: instance ? instance.id : '', model };
        this.agentPreferenceSaved = saved;
        this.agentSelectionNotice = notice ? notice + ' ' + tr('ui.agents.notice_preference_saved') : '';
        if (notice && instance && model) {
          void this.persistAgentPreference(instance.id, model);
        }
      },
      async loadAgentEngines(options) {
        if (!window.AssetAccess || typeof window.AssetAccess.request !== 'function') return false;
        const epoch = this.agentEpoch + 1;
        this.agentEpoch = epoch;
        this.agentEnginesLoading = true;
        this.agentEnginesError = '';
        try {
          const payload = await api.engines(this.app, options);
          if (!this.isCurrentAgentEpoch(epoch)) return false;
          this.applyAgentEngines(payload);
          return true;
        } catch (error) {
          if (!this.isCurrentAgentEpoch(epoch)) return false;
          this.agentEnginesLoaded = false;
          this.agentEnginesAvailable = !(error && error.status === 404);
          this.agentEnginesError = error && error.status === 404
            ? ''
            : (error && (error.serverMessage || error.message)) || tr('ui.agents.error_engines_load');
          return false;
        } finally {
          if (this.isCurrentAgentEpoch(epoch)) this.agentEnginesLoading = false;
        }
      },
      async persistAgentPreference(instanceId, model) {
        const target = { instanceId: text(instanceId), model: text(model) || null };
        if (!target.instanceId) return false;
        if (samePreference(this.agentPreferenceSaved, target)) return true;
        const token = this.agentPreferenceEpoch + 1;
        this.agentPreferenceEpoch = token;
        const userId = this.app.activeUserId;
        const epoch = this.agentEpoch;
        try {
          await api.savePreference(this.app, target);
          if (token !== this.agentPreferenceEpoch || userId !== this.app.activeUserId || !this.isCurrentAgentEpoch(epoch)) return false;
          this.agentPreferenceSaved = Object.assign({}, target);
          return true;
        } catch (error) {
          if (token !== this.agentPreferenceEpoch || userId !== this.app.activeUserId || !this.isCurrentAgentEpoch(epoch)) return false;
          if (error && error.name === 'AbortError') return false;
          this.agentSelectionNotice = (error && (error.serverMessage || error.message)) || tr('ui.agents.error_preference_save');
          return false;
        }
      },
      async setAgentInstance(instanceId) {
        const instance = this.agentInstanceList.find(item => item.id === instanceId && item.enabled !== false);
        if (!instance) return false;
        const previous = Object.assign({}, this.agentPreference);
        const model = defaultModelFor(instance);
        this.agentPreference = { instanceId: instance.id, model };
        this.agentSelectionNotice = '';
        const saved = await this.persistAgentPreference(instance.id, model);
        if (!saved) {
          this.agentPreference = previous;
          return false;
        }
        return model;
      },
      async setAgentModel(model) {
        const instance = this.agentActiveInstance;
        const offered = this.agentModels.some(item => item.id === model);
        if (!instance || !offered) return false;
        const previous = this.agentPreference.model;
        this.agentPreference = { instanceId: instance.id, model };
        this.agentSelectionNotice = '';
        const saved = await this.persistAgentPreference(instance.id, model);
        if (!saved) {
          this.agentPreference = { instanceId: instance.id, model: previous };
          return false;
        }
        return true;
      }
    }
  };

  const enginePicker = {
    name: 'AgentEnginePicker',
    mixins: [window.AssetAgentEngineMixin, window.AssetAgentQuotaMixin],
    props: {
      app: { type: Object, required: true },
      heading: { type: String, default: '' },
      showBudget: { type: Boolean, default: true }
    },
    data() {
      return { disposed: false };
    },
    computed: {
      // An empty heading prop falls back to localized copy, so the default
      // never freezes one language at mount time.
      headingText() {
        return this.heading || tr('ui.agents.engine_model');
      }
    },
    watch: {
      'app.activeUserId': {
        flush: 'sync',
        handler() {
          this.agentEpoch += 1;
          this.agentPreferenceEpoch += 1;
          this.agentEngines = [];
          this.agentPreference = { instanceId: '', model: '' };
          this.agentPreferenceSaved = { instanceId: '', model: '' };
          this.agentBudget = null;
          this.agentEnginesError = '';
          this.agentSelectionNotice = '';
          this.resetQuota();
          if (this.app.authenticated) {
            void this.loadAgentEngines();
            void this.loadQuota();
          }
        }
      },
      'app.authenticated'(value) {
        if (!value) this.resetQuota();
        else void this.loadQuota();
      }
    },
    created() {
      void this.loadAgentEngines();
      if (this.app.authenticated) void this.loadQuota();
    },
    beforeUnmount() {
      this.disposed = true;
      this.agentEpoch += 1;
    },
    methods: {
      async onEngine(event) {
        const value = event && event.target ? event.target.value : '';
        const choice = this.agentEngineChoices.find(item => item.value === value);
        const instance = choice
          ? (choice.instanceId
            ? this.agentInstanceList.find(item => item.id === choice.instanceId)
            : this.agentEngineInstanceFor(choice.engine))
          : this.agentInstanceList.find(item => item.id === value);
        const saved = instance && instance.enabled !== false ? await this.setAgentInstance(instance.id) : false;
        if (saved === false) this.agentResetSelection(event, this.agentEngineValue);
        return saved !== false;
      },
      async onProfile(event) {
        const value = event && event.target ? event.target.value : '';
        const instance = this.agentProfileInstance(value);
        const previous = this.agentPreference.instanceId;
        const saved = instance && instance.enabled !== false ? await this.setAgentInstance(instance.id) : false;
        if (saved === false) this.agentResetSelection(event, previous || this.agentPreference.instanceId);
        return saved !== false;
      },
      onModel(event) {
        return this.setAgentModel(event.target.value);
      }
    },
    template: `
      <section class="agent-engine" aria-labelledby="agent-engine-title">
        <header class="agent-engine__head">
          <h2 :id="'agent-engine-title'" class="agent-engine__title">{{ headingText }}</h2>
          <span v-if="agentEnginesLoading" class="agent-engine__meta" role="status">{{ $t('ui.agents.loading_engines') }}</span>
        </header>
        <p v-if="agentEnginesError" class="agent-note agent-note--error" role="alert">{{ agentEnginesError }}</p>
        <div v-if="agentEnginesLoaded && agentInstanceList.length" class="agent-engine__grid">
          <div class="field">
            <label class="field__label" for="agent-engine-instance">{{ $t('ui.agents.engine') }}</label>
            <select id="agent-engine-instance" class="input-shell" :value="agentEngineValue" @change="onEngine">
              <option v-for="choice in agentEngineChoices" :key="choice.value" :value="choice.value" :disabled="choice.disabled">
                {{ choice.label }}{{ choice.disabled ? ' · ' + $t('ui.agents.disabled') : '' }}
              </option>
            </select>
          </div>
          <div v-if="agentProfileSelectorVisible" class="field">
            <label class="field__label" for="agent-engine-profile">{{ $t('ui.agents.profile') }}</label>
            <select id="agent-engine-profile" class="input-shell" :value="agentPreference.instanceId" @change="onProfile">
              <option v-for="instance in agentProfileOptions" :key="instance.id" :value="instance.id" :disabled="instance.enabled === false">
                {{ agentProfileLabel(instance) }}{{ instance.enabled === false ? ' · ' + $t('ui.agents.disabled') : '' }}
              </option>
            </select>
            <p class="field__hint">{{ $t('ui.agents.profile_hint') }}</p>
          </div>
          <div class="field">
            <label class="field__label" for="agent-engine-model">{{ $t('ui.agents.model') }}</label>
            <select id="agent-engine-model" class="input-shell" :value="agentPreference.model" @change="onModel" :disabled="!agentModels.length">
              <option v-if="!agentModels.length" value="">{{ $t('ui.agents.no_models_announced') }}</option>
              <option v-for="model in agentModels" :key="model.id" :value="model.id">{{ agentModelLabel(model) }}</option>
            </select>
            <p v-if="agentActiveInstance && !agentModels.length" class="field__hint">{{ $t('ui.agents.models_hint') }}</p>
          </div>
        </div>
        <ul v-if="agentDiscoveryErrors.length" class="agent-engine__errors" role="alert" :aria-label="$t('ui.agents.discovery_errors_label')">
          <li v-for="failure in agentDiscoveryErrors" :key="failure.id" class="agent-note agent-note--error">
            {{ failure.label }}: {{ failure.error }}
          </li>
        </ul>
        <p v-if="agentEnginesLoaded && !agentInstanceList.length" class="agent-note" role="status">{{ $t('ui.agents.no_engines') }}</p>
        <p v-if="agentSelectionNotice" class="agent-note" role="status">{{ agentSelectionNotice }}</p>
        <div v-if="agentActiveInstance && agentCapabilityList.length" class="agent-engine__capabilities">
          <span class="agent-tag" v-for="capability in agentCapabilityList" :key="capability.key">{{ capability.label }}</span>
        </div>
        <template v-if="showBudget">
          <p v-if="agentBudgetSummary" class="agent-budget">{{ agentBudgetSummary }}</p>
          <section class="agent-quota" aria-labelledby="agent-quota-title">
            <div class="agent-quota__head">
              <h3 id="agent-quota-title" class="agent-quota__title">{{ $t('ui.agents.daily_quota_title') }}</h3>
              <button type="button" class="btn btn--ghost btn--small" :disabled="quotaLoading" @click="loadQuota">{{ quotaLoading ? $t('ui.agents.refreshing') : $t('ui.agents.refresh_quota') }}</button>
            </div>
            <p v-if="quotaLoading && !quotaLoaded" class="agent-quota__meta" role="status">{{ $t('ui.agents.loading_quota') }}</p>
            <p v-if="quotaError" class="agent-note agent-note--error" role="alert">{{ quotaError }}</p>
            <p v-if="quotaUnavailable" class="agent-budget agent-budget--note">{{ $t('ui.agents.quota_unavailable_note') }}</p>
            <template v-if="quotaHasData">
              <p class="agent-quota__meta">{{ $t('ui.agents.quota_day', { day: quotaPeriodDay || $t('ui.agents.quota_day_unreported'), timezone: quotaTimezone || $t('ui.agents.quota_timezone_unreported') }) }}<template v-if="quotaPendingTimezone"> · {{ $t('ui.agents.quota_pending_change', { timezone: quotaPendingTimezone, day: quotaPendingEffectiveDay || $t('ui.agents.quota_next_safe_day') }) }}</template></p>
              <dl class="agent-quota__accounts">
                <div v-for="account in quotaAccounts" :key="account.scope" class="agent-quota__account" :class="{ 'is-selected': account.selected }">
                  <dt>{{ account.label }}<span v-if="account.selected" class="agent-tag">{{ $t('ui.agents.current_context') }}</span></dt>
                  <dd v-if="account.balance">
                    <span>{{ $t('ui.agents.limit', { value: quotaLimitText(account.balance), source: quotaLimitSourceLabel(account.balance.limitSource) }) }}</span>
                    <span>{{ $t('ui.agents.consumed_reserved', { consumed: quotaAmountText(account.balance.consumed), reserved: quotaAmountText(account.balance.reserved) }) }}</span>
                    <span>{{ $t('ui.agents.available', { value: quotaAvailableText(account.balance) }) }}</span>
                    <span>{{ $t('ui.agents.pending_precision', { pending: quotaTokenText(account.balance.pendingCount), precision: quotaPrecisionText(account.balance) }) }}</span>
                    <span>{{ $t('ui.agents.legacy_unattributed', { value: quotaAmountText(account.balance.legacy) }) }}</span>
                  </dd>
                  <dd v-else>{{ $t('ui.agents.not_available') }}</dd>
                </div>
              </dl>
              <p v-if="quotaSelectedNotice" class="agent-quota__meta">{{ quotaSelectedNotice }}</p>
            </template>
          </section>
        </template>
      </section>
    `
  };

  const instanceEditor = {
    name: 'AgentInstanceEditor',
    props: {
      app: { type: Object, required: true },
      draft: { type: Object, required: true },
      identities: { type: Array, default: () => [] },
      busy: { type: Boolean, default: false },
      error: { type: String, default: '' },
      canManageQuota: { type: Boolean, default: false }
    },
    emits: ['save', 'cancel'],
    data() {
      return {
        quotaProviders: [],
        quotaProvidersLoading: false,
        quotaProvidersError: '',
        quotaProviderEpoch: 0,
        quotaProviderController: null,
        quotaProviderOwner: '',
        quotaProviderDisposed: false
      };
    },
    computed: {
      external() {
        return this.draft.engine !== 'pydantic';
      },
      quotaGlobalProviders() {
        return this.quotaProviders
          .filter(provider => provider.scope === 'global' && provider.enabled)
          .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
      },
      quotaSelectedProviderAvailable() {
        if (!this.draft.managedProviderId) return true;
        return this.quotaGlobalProviders.some(provider => provider.id === this.draft.managedProviderId);
      }
    },
    created() {
      if (this.canManageQuota) void this.loadQuotaProviders();
    },
    watch: {
      'app.activeUserId': {
        flush: 'sync',
        handler() {
          this.resetQuotaProviders();
          if (this.canManageQuota && this.app.authenticated) void this.loadQuotaProviders();
        }
      },
      'app.authenticated': {
        flush: 'sync',
        handler(value) {
          this.resetQuotaProviders();
          if (value && this.canManageQuota) void this.loadQuotaProviders();
        }
      },
      canManageQuota(value) {
        this.resetQuotaProviders();
        if (value && this.app.authenticated) void this.loadQuotaProviders();
      }
    },
    beforeUnmount() {
      this.quotaProviderDisposed = true;
      this.resetQuotaProviders();
    },
    methods: {
      resetQuotaProviders() {
        this.quotaProviderEpoch += 1;
        if (this.quotaProviderController) this.quotaProviderController.abort();
        this.quotaProviderController = null;
        this.quotaProviderOwner = '';
        this.quotaProviders = [];
        this.quotaProvidersLoading = false;
        this.quotaProvidersError = '';
      },
      isCurrentQuotaProvider(epoch) {
        return epoch === this.quotaProviderEpoch && !this.quotaProviderDisposed &&
          this.canManageQuota && this.app.authenticated !== false &&
          this.quotaProviderOwner === String(this.app.activeUserId || '');
      },
      quotaProviderOptions(provider) {
        const models = Array.isArray(provider.models) && provider.models.length
          ? ' · ' + provider.models.slice(0, 4).join(', ')
          : '';
        return (provider.name || provider.id) + models;
      },
      normalizeQuotaProvider(item) {
        return {
          id: text(item.id),
          name: text(item.name),
          scope: text(item.scope),
          enabled: item.enabled !== false,
          models: Array.isArray(item.models) ? item.models.map(model => text(model)).filter(Boolean) : []
        };
      },
      async loadQuotaProviders() {
        if (!this.canManageQuota || !this.app.authenticated || this.quotaProviderDisposed) {
          this.resetQuotaProviders();
          return false;
        }
        const epoch = ++this.quotaProviderEpoch;
        if (this.quotaProviderController) this.quotaProviderController.abort();
        const controller = new AbortController();
        this.quotaProviderController = controller;
        this.quotaProviderOwner = String(this.app.activeUserId || '');
        this.quotaProvidersLoading = true;
        this.quotaProvidersError = '';
        try {
          const payload = await window.AssetAgentApi.providers(this.app, { signal: controller.signal });
          if (!this.isCurrentQuotaProvider(epoch)) return false;
          if (!payload || !Array.isArray(payload.items)) throw new Error(tr('ui.agents.error_providers_payload'));
          this.quotaProviders = payload.items.map(item => this.normalizeQuotaProvider(item));
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaProvider(epoch) || (error && error.name === 'AbortError')) return false;
          if (error && error.status === 401) {
            this.resetQuotaProviders();
            return false;
          }
          this.quotaProviders = [];
          this.quotaProvidersError = (error && (error.serverMessage || error.message)) || tr('ui.agents.error_providers_load');
          return false;
        } finally {
          if (this.isCurrentQuotaProvider(epoch)) {
            this.quotaProvidersLoading = false;
            this.quotaProviderController = null;
          }
        }
      }
    },
    template: `
      <form class="agent-editor" @submit.prevent="$emit('save')">
        <div class="agent-editor__grid">
          <div class="field">
            <label class="field__label" for="agent-instance-name">{{ $t('ui.agents.name') }}</label>
            <input id="agent-instance-name" class="input-shell" v-model.trim="draft.name" maxlength="80" required>
          </div>
          <div class="field">
            <label class="field__label" for="agent-instance-engine">{{ $t('ui.agents.engine') }}</label>
            <select id="agent-instance-engine" class="input-shell" v-model="draft.engine" :disabled="!!draft.id">
              <option value="opencode">OpenCode</option>
              <option value="hermes">Hermes</option>
              <option value="pydantic">Pydantic AI</option>
            </select>
          </div>
          <div v-if="external" class="field">
            <label class="field__label" for="agent-instance-url">{{ $t('ui.agents.base_url') }}</label>
            <input id="agent-instance-url" class="input-shell" v-model.trim="draft.baseUrl" inputmode="url" placeholder="http://127.0.0.1:4096">
            <p class="field__hint">{{ $t('ui.agents.base_url_hint') }}</p>
          </div>
          <div v-if="external" class="field">
            <label class="field__label" for="agent-instance-secret">{{ $t('ui.agents.secret_name') }}</label>
            <input id="agent-instance-secret" class="input-shell" v-model.trim="draft.secretRef" maxlength="120" placeholder="OPENCODE_SERVER_PASSWORD">
            <p class="field__hint">{{ $t('ui.agents.secret_hint') }}</p>
          </div>
          <div v-if="external" class="field">
            <label class="field__label" for="agent-instance-user">{{ $t('ui.agents.server_user') }}</label>
            <input id="agent-instance-user" class="input-shell" v-model.trim="draft.username" maxlength="120" autocomplete="off">
          </div>
          <div class="field">
            <label class="field__label" for="agent-instance-profile">{{ $t('ui.agents.profile_or_workspace') }}</label>
            <input id="agent-instance-profile" class="input-shell" v-model.trim="draft.profile" maxlength="200">
          </div>
          <div class="field">
            <label class="field__label" for="agent-instance-directory">{{ $t('ui.agents.directory') }}</label>
            <input id="agent-instance-directory" class="input-shell" v-model.trim="draft.directory" maxlength="400">
          </div>
          <div class="field">
            <label class="field__label" for="agent-instance-default">{{ $t('ui.agents.default_model') }}</label>
            <input id="agent-instance-default" class="input-shell" v-model.trim="draft.defaultModel" maxlength="200" :aria-describedby="canManageQuota && draft.quotaMode === 'managed' ? 'agent-instance-default-help' : null">
            <p v-if="canManageQuota && draft.quotaMode === 'managed'" id="agent-instance-default-help" class="field__hint">{{ $t('ui.agents.default_model_hint') }}</p>
          </div>
          <div class="field">
            <label class="field__label" for="agent-instance-identity">{{ $t('ui.agents.integration_identity') }}</label>
            <select id="agent-instance-identity" class="input-shell" v-model="draft.integrationIdentityId">
              <option value="">{{ $t('ui.agents.no_integration_identity') }}</option>
              <option v-for="identity in identities" :key="identity.id" :value="identity.id">{{ identity.name || identity.username || identity.id }} · {{ identity.actorKind }}</option>
            </select>
          </div>
        </div>
        <fieldset v-if="canManageQuota" class="agent-quota-fieldset agent-instance-quota">
          <legend>{{ $t('ui.agents.quota_routing_legend') }}</legend>
          <div class="field">
            <label class="field__label" for="agent-instance-quota-mode">{{ $t('ui.agents.quota_mode') }}</label>
            <select id="agent-instance-quota-mode" class="input-shell" v-model="draft.quotaMode" :disabled="busy" aria-describedby="agent-instance-quota-mode-help">
              <option value="direct">{{ $t('ui.agents.quota_mode_direct') }}</option>
              <option value="managed">{{ $t('ui.agents.quota_mode_managed') }}</option>
            </select>
            <p id="agent-instance-quota-mode-help" class="field__hint">{{ $t('ui.agents.quota_mode_hint') }}</p>
          </div>
          <template v-if="draft.quotaMode === 'managed'">
            <div class="field">
              <label class="field__label" for="agent-instance-quota-provider">{{ $t('ui.agents.global_provider') }}</label>
              <select id="agent-instance-quota-provider" class="input-shell" v-model="draft.managedProviderId" :disabled="busy || quotaProvidersLoading" required aria-describedby="agent-instance-quota-provider-help">
                <option value="">{{ quotaProvidersLoading ? $t('ui.agents.loading_providers') : $t('ui.agents.select_global_provider') }}</option>
                <option v-for="provider in quotaGlobalProviders" :key="provider.id" :value="provider.id">{{ quotaProviderOptions(provider) }}</option>
              </select>
              <p id="agent-instance-quota-provider-help" class="field__hint">{{ $t('ui.agents.global_provider_hint') }}</p>
              <p v-if="quotaProvidersError" class="agent-note agent-note--error" role="alert">{{ quotaProvidersError }}</p>
              <p v-else-if="!quotaProvidersLoading && !quotaGlobalProviders.length" class="agent-note">{{ $t('ui.agents.no_global_providers') }}</p>
              <p v-else-if="!quotaProvidersLoading && !quotaSelectedProviderAvailable" class="agent-note agent-note--error" role="alert">{{ $t('ui.agents.global_provider_gone') }}</p>
            </div>
            <div class="field">
              <label class="field__label" for="agent-instance-quota-context">{{ $t('ui.agents.input_context_limit') }}</label>
              <input id="agent-instance-quota-context" class="input-shell" v-model.trim="draft.managedContextTokens" type="number" min="1" step="1" inputmode="numeric" :disabled="busy" required aria-describedby="agent-instance-quota-context-help">
              <p id="agent-instance-quota-context-help" class="field__hint">{{ $t('ui.agents.input_context_hint') }}</p>
            </div>
          </template>
          <template v-else>
            <label class="agent-check"><input id="agent-instance-quota-exception" type="checkbox" v-model="draft.directCompanyException" :disabled="busy"> {{ $t('ui.agents.direct_exception') }}</label>
            <p class="field__hint">{{ $t('ui.agents.direct_exception_hint') }}</p>
          </template>
        </fieldset>
        <label class="agent-check"><input type="checkbox" v-model="draft.enabled"> {{ $t('ui.agents.instance_enabled') }}</label>
        <p v-if="error" class="agent-note agent-note--error" role="alert">{{ error }}</p>
        <div class="agent-editor__actions">
          <button type="submit" class="btn btn--primary btn--small" :disabled="busy">{{ busy ? $t('ui.agents.saving') : $t('ui.agents.save_instance') }}</button>
          <button type="button" class="btn btn--secondary btn--small" :disabled="busy" @click="$emit('cancel')">{{ $t('ui.common.cancel') }}</button>
        </div>
      </form>
    `
  };

  const catalogPanel = {
    name: 'AgentCatalogPanel',
    props: {
      catalog: { type: Object, default: () => ({ skills: [], modules: [] }) },
      busyId: { type: String, default: '' },
      error: { type: String, default: '' },
      canManage: { type: Boolean, default: true }
    },
    emits: ['toggle-module'],
    computed: {
      skills() {
        return Array.isArray(this.catalog.skills) ? this.catalog.skills : [];
      },
      modules() {
        return Array.isArray(this.catalog.modules) ? this.catalog.modules : [];
      },
      officialModules() {
        return this.modules.filter(module => module && module.official === true);
      },
      officialSkills() {
        const officialIds = new Set(this.officialModules.map(module => text(module.id)));
        return this.skills.filter(skill => officialIds.has(text(skill.module)));
      },
      externalModules() {
        return this.modules.filter(module => !module || module.official !== true);
      }
    },
    methods: {
      moduleFor(skill) {
        const id = text(skill.module);
        return id ? this.modules.find(module => module.id === id) || null : null;
      },
      skillIsOfficial(skill) {
        const module = this.moduleFor(skill);
        return !!(module && module.official === true);
      },
      moduleEnabled(module) {
        return !module || module.enabled !== false;
      },
      moduleSkills(module) {
        return this.skills.filter(skill => text(skill.module) === text(module.id));
      },
      moduleStateLabel(module) {
        return module.enabled === false ? tr('ui.agents.module_disabled') : tr('ui.agents.module_enabled');
      },
      toggle(module) {
        if (!module || module.official === true) return;
        this.$emit('toggle-module', module);
      },
      skillMeta(skill) {
        const parts = [];
        if (text(skill.version)) parts.push('v' + text(skill.version));
        if (text(skill.module)) parts.push(this.skillIsOfficial(skill) ? tr('ui.agents.official') : tr('ui.agents.module_named', { id: text(skill.module) }));
        if (Array.isArray(skill.capabilities) && skill.capabilities.length) parts.push(skill.capabilities.join(', '));
        return parts.join(' · ');
      },
      permissionText(skill) {
        return Array.isArray(skill.permissions) && skill.permissions.length ? skill.permissions.join(', ') : tr('ui.agents.no_declared_permissions');
      },
      digestText(skill) {
        const digest = text(skill.digest);
        return digest ? digest.slice(0, 16) + '…' : '';
      }
    },
    template: `
      <section class="agent-panel" aria-labelledby="agent-catalog-title">
        <header class="agent-panel__head">
          <div>
            <h3 id="agent-catalog-title" class="agent-panel__title">{{ $t('ui.agents.catalog_title') }}</h3>
            <p class="agent-panel__sub">{{ $t('ui.agents.catalog_sub') }}</p>
          </div>
        </header>
        <p v-if="error" class="agent-note agent-note--error" role="alert">{{ error }}</p>
        <h4 class="agent-panel__subtitle">{{ $t('ui.agents.official_package') }}</h4>
        <p v-if="!officialSkills.length" class="agent-note">{{ $t('ui.agents.no_official_skills') }}</p>
        <ul v-else class="agent-skill-list">
          <li v-for="skill in officialSkills" :key="skill.name" class="agent-skill">
            <div><strong>{{ skill.name }}</strong><span class="agent-tag">{{ $t('ui.agents.official') }}</span></div>
            <p v-if="skill.description">{{ skill.description }}</p>
            <p class="agent-skill__meta">{{ skillMeta(skill) }}</p>
            <p class="agent-skill__meta">{{ $t('ui.agents.permissions', { list: permissionText(skill) }) }}</p>
            <p v-if="digestText(skill)" class="agent-skill__meta mono">SHA-256 {{ digestText(skill) }}</p>
          </li>
        </ul>
        <h4 class="agent-panel__subtitle">{{ $t('ui.agents.modules') }}</h4>
        <p v-if="!externalModules.length" class="agent-note">{{ $t('ui.agents.no_external_modules') }}</p>
        <ul v-else class="agent-module-list">
          <li v-for="module in externalModules" :key="module.id" class="agent-module" :class="{ 'is-disabled': module.enabled === false }">
            <div class="agent-module__head">
              <div>
                <strong>{{ module.name || module.id }}</strong>
                <span class="agent-tag" v-if="module.official">{{ $t('ui.agents.official') }}</span>
                <span class="agent-tag">{{ moduleStateLabel(module) }}</span>
              </div>
              <button v-if="!module.official && canManage" type="button" class="btn btn--secondary btn--small" :disabled="busyId === module.id" @click="toggle(module)">
                {{ busyId === module.id ? $t('ui.agents.module_applying') : (module.enabled === false ? $t('ui.agents.enable_module') : $t('ui.agents.disable_module')) }}
              </button>
              <p v-else-if="!module.official" class="field__hint">{{ $t('ui.agents.module_permission_required') }}</p>
            </div>
            <p v-if="module.description">{{ module.description }}</p>
            <p class="agent-skill__meta" v-if="Array.isArray(module.permissions) && module.permissions.length">{{ $t('ui.agents.permissions', { list: module.permissions.join(', ') }) }}</p>
            <p class="agent-skill__meta" v-if="Array.isArray(module.capabilities) && module.capabilities.length">{{ $t('ui.agents.module_capabilities', { list: module.capabilities.join(', ') }) }}</p>
            <p v-if="module.official" class="field__hint">{{ $t('ui.agents.official_module_locked') }}</p>
            <ul class="agent-skill-list" v-if="moduleSkills(module).length">
              <li v-for="skill in moduleSkills(module)" :key="skill.name" class="agent-skill">
                <strong>{{ skill.name }}</strong>
                <p v-if="skill.description">{{ skill.description }}</p>
                <p class="agent-skill__meta">{{ skillMeta(skill) }} · {{ permissionText(skill) }}</p>
              </li>
            </ul>
            <p v-else-if="module.enabled === false" class="field__hint">{{ $t('ui.agents.module_skills_removed') }}</p>
          </li>
        </ul>
      </section>
    `
  };

  const installationsPanel = {
    name: 'AgentInstallationsPanel',
    props: {
      app: { type: Object, required: true },
      installations: { type: Array, default: () => [] },
      busy: { type: String, default: '' },
      error: { type: String, default: '' },
      result: { type: Object, default: null }
    },
    emits: ['operation', 'receipt', 'applied'],
    data() {
      return {
        receiptFor: '',
        receiptText: '',
        receiptError: '',
        requestBusy: '',
        requestError: ''
      };
    },
    computed: {
      operations() {
        return OPERATIONS.filter(operation => operation.id !== 'install');
      }
    },
    methods: {
      statusLabel: installationStatusLabel,
      tone(record) {
        return statusTone(text(record.status), record.verified);
      },
      checkText,
      resultError: resultErrorText,
      resultLimitations,
      limitationText,
      operationLabel,
      pathLabel(record) {
        const target = record && record.target ? record.target : {};
        return [text(target.engine) ? engineLabel(target.engine) : '', text(target.path), text(target.profile)].filter(Boolean).join(' · ');
      },
      operate(operation, record) {
        this.$emit('operation', { operation, record });
      },
      isRemote(record) {
        return !!(record && record.binding && record.binding.requestDigest);
      },
      canImportReceipt(record) {
        return this.isRemote(record) && record.verified !== true && ['configured', 'exported', 'failed'].includes(text(record.status));
      },
      toggleReceipt(record) {
        this.receiptFor = this.receiptFor === record.id ? '' : record.id;
        this.receiptText = '';
        this.receiptError = '';
      },
      submitReceipt(record) {
        let receipt;
        try {
          receipt = JSON.parse(this.receiptText);
        } catch (_) {
          this.receiptError = tr('ui.agents.error_receipt_invalid_json');
          return false;
        }
        if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
          this.receiptError = tr('ui.agents.error_receipt_object');
          return false;
        }
        this.receiptError = '';
        this.$emit('receipt', { record, receipt });
        return true;
      },
      async downloadRequest(record) {
        if (!record || !record.id || this.requestBusy) return false;
        this.requestBusy = record.id;
        this.requestError = '';
        try {
          const payload = await window.AssetAgentApi.installationRequest(this.app, record.id);
          const request = payload && payload.request;
          if (!saveJsonFile(request, record.id)) {
            this.requestError = tr('ui.agents.error_download_blocked');
            return false;
          }
          this.$emit('applied', payload);
          return true;
        } catch (error) {
          this.requestError = (error && error.message) || tr('ui.agents.error_request_fetch');
          return false;
        } finally {
          this.requestBusy = '';
        }
      }
    },
    template: `
      <section class="agent-panel" aria-labelledby="agent-installations-title">
        <header class="agent-panel__head">
          <div>
            <h3 id="agent-installations-title" class="agent-panel__title">{{ $t('ui.agents.installations_title') }}</h3>
            <p class="agent-panel__sub">{{ $t('ui.agents.installations_sub') }}</p>
          </div>
        </header>
        <p v-if="error" class="agent-note agent-note--error" role="alert">{{ error }}</p>
        <p v-if="!installations.length" class="agent-note">{{ $t('ui.agents.no_installations') }}</p>
        <ul v-else class="agent-installation-list">
          <li v-for="record in installations" :key="record.id" class="agent-installation">
            <div class="agent-installation__head">
              <div>
                <strong>{{ pathLabel(record) }}</strong>
                <span class="status-pill" :class="'status--' + tone(record)">{{ statusLabel(record) }}</span>
                <span v-if="record.target && record.target.version" class="agent-tag">v{{ record.target.version }}</span>
              </div>
              <span class="agent-skill__meta">{{ $t('ui.agents.operation_line', { operation: record.operation || 'install' }) }}</span>
            </div>
            <p v-if="record.binding && record.binding.configFile" class="agent-skill__meta mono">{{ record.binding.configFile }}</p>
            <p v-if="Array.isArray(record.managedFiles) && record.managedFiles.length" class="agent-skill__meta">{{ $t('ui.agents.managed_files', { count: record.managedFiles.length }, record.managedFiles.length) }}</p>
            <div v-if="Array.isArray(record.conflicts) && record.conflicts.length" class="agent-note agent-note--warn" role="status">
              <p>{{ $t('ui.agents.conflicts_kept') }}</p>
              <ul><li v-for="(conflict, index) in record.conflicts" :key="index">{{ checkText(conflict) || conflict }}</li></ul>
            </div>
            <p v-if="record.status === 'configured' && record.verified !== true" class="field__hint">{{ $t('ui.agents.files_written_unverified') }}</p>
            <p v-if="record.status === 'exported' && record.verified !== true" class="field__hint">{{ $t('ui.agents.request_exported_unverified') }}</p>
            <p v-if="isRemote(record)" class="field__hint">{{ $t('ui.agents.remote_request_bound') }}</p>
            <p v-if="requestError" class="agent-note agent-note--error" role="alert">{{ requestError }}</p>
            <div v-if="isRemote(record)" class="agent-installation__actions">
              <button type="button" class="btn btn--ghost btn--small" :disabled="requestBusy === record.id" @click="downloadRequest(record)">{{ requestBusy === record.id ? $t('ui.agents.downloading') : $t('ui.agents.download_request') }}</button>
              <button v-if="canImportReceipt(record)" type="button" class="btn btn--ghost btn--small" @click="toggleReceipt(record)">{{ receiptFor === record.id ? $t('ui.agents.hide_receipt') : $t('ui.agents.import_receipt') }}</button>
            </div>
            <div v-if="receiptFor === record.id" class="agent-remote">
              <div class="field">
                <label class="field__label" :for="'agent-receipt-' + record.id">{{ $t('ui.agents.remote_receipt') }}</label>
                <textarea :id="'agent-receipt-' + record.id" class="conversation__select" rows="3" v-model="receiptText" :placeholder="$t('ui.agents.receipt_placeholder')"></textarea>
              </div>
              <p v-if="receiptError" class="agent-note agent-note--error" role="alert">{{ receiptError }}</p>
              <div class="agent-installation__actions">
                <button type="button" class="btn btn--primary btn--small" @click="submitReceipt(record)">{{ $t('ui.agents.import_receipt_verify') }}</button>
              </div>
            </div>
            <div class="agent-installation__actions">
              <button v-for="operation in operations" :key="operation.id" type="button" class="btn btn--ghost btn--small" :disabled="busy === record.id + ':' + operation.id" @click="operate(operation.id, record)">
                {{ busy === record.id + ':' + operation.id ? $t('ui.agents.running') : operationLabel(operation) }}
              </button>
            </div>
          </li>
        </ul>
        <div v-if="result" class="agent-result" role="status">
          <div class="agent-result__head">
            <strong>{{ $t('ui.agents.installer_result') }}</strong>
            <span class="status-pill" :class="'status--' + tone(result)">{{ statusLabel(result) }}</span>
          </div>
          <p v-if="resultError(result)" class="agent-note agent-note--error" role="alert">{{ resultError(result) }}</p>
          <p v-else-if="result.verified === true">{{ $t('ui.agents.server_verified_mcp') }}</p>
          <p v-else>{{ $t('ui.agents.server_unverified_mcp') }}</p>
          <p v-if="result.target && result.target.version" class="agent-skill__meta">{{ $t('ui.agents.version', { version: result.target.version }) }}</p>
          <div v-if="Array.isArray(result.checks) && result.checks.length">
            <p class="agent-skill__meta">{{ $t('ui.agents.reported_checks') }}</p>
            <ul><li v-for="(check, index) in result.checks" :key="index">{{ checkText(check) || check }}</li></ul>
          </div>
          <div v-if="resultLimitations(result).length">
            <p class="agent-skill__meta">{{ $t('ui.agents.reported_limitations') }}</p>
            <ul><li v-for="(item, index) in resultLimitations(result)" :key="index">{{ limitationText(item) }}</li></ul>
          </div>
          <div v-if="Array.isArray(result.conflicts) && result.conflicts.length">
            <p class="agent-skill__meta">{{ $t('ui.agents.conflicts_kept_short') }}</p>
            <ul><li v-for="(conflict, index) in result.conflicts" :key="index">{{ checkText(conflict) || conflict }}</li></ul>
          </div>
        </div>
      </section>
    `
  };

  const wizard = {
    name: 'AgentIntegrationWizard',
    components: {
      AgentInstanceEditor: instanceEditor,
      AppIcon: window.AppIcon
    },
    props: {
      app: { type: Object, required: true },
      instances: { type: Array, default: () => [] },
      catalog: { type: Object, default: () => ({ skills: [], modules: [] }) },
      identities: { type: Array, default: () => [] },
      canManageQuota: { type: Boolean, default: false }
    },
    emits: ['close', 'applied'],
    data() {
      return {
        step: 1,
        mode: 'existing',
        instanceId: '',
        instanceDraft: Object.assign({
          name: '', engine: 'opencode', baseUrl: 'http://127.0.0.1:4096', secretRef: '', username: '', profile: '', directory: '', defaultModel: '', integrationIdentityId: '', enabled: true
        }, quotaInstanceDraft()),
        instanceBusy: false,
        instanceError: '',
        target: { path: '', profile: '', version: '', remote: false },
        preparedInstanceId: '',
        detecting: false,
        detection: null,
        detectionTarget: null,
        pendingTarget: null,
        detectGeneration: 0,
        detectError: '',
        mcp: { url: '', secretRef: '', identityId: '' },
        selectedSkills: [],
        error: '',
        busy: false,
        result: null,
        requestError: '',
        receiptText: '',
        receiptBusy: false,
        receiptError: '',
        receiptResult: null,
        operation: 'install'
      };
    },
    computed: {
      engineInstances() {
        return (Array.isArray(this.instances) ? this.instances : []).filter(instance => instance && instance.engine !== 'pydantic');
      },
      selectedInstance() {
        return this.engineInstances.find(instance => instance.id === this.instanceId) || null;
      },
      engine() {
        return this.mode === 'new' ? this.instanceDraft.engine : (this.selectedInstance ? this.selectedInstance.engine : '');
      },
      targetEngineLabel() {
        return engineLabel(this.engine);
      },
      skills() {
        return Array.isArray(this.catalog.skills) ? this.catalog.skills : [];
      },
      modules() {
        return Array.isArray(this.catalog.modules) ? this.catalog.modules : [];
      },
      enabledSkills() {
        return this.skills.filter(skill => {
          const moduleId = text(skill.module);
          if (!moduleId) return true;
          const module = this.modules.find(item => item.id === moduleId);
          return !module || module.enabled !== false;
        });
      },
      selectedIdentity() {
        return this.identities.find(identity => identity.id === this.mcp.identityId) || null;
      },
      identityPermissions() {
        const identity = this.selectedIdentity;
        if (!identity || !this.app.userPermissions) return [];
        return this.app.userPermissions(identity);
      },
      stepTitle() {
        return [
        tr('ui.agents.wizard_instance'),
        tr('ui.agents.wizard_destination'),
        tr('ui.agents.wizard_mcp'),
        tr('ui.agents.wizard_skills'),
        tr('ui.agents.wizard_review')
      ][this.step - 1] || tr('ui.agents.wizard_step_fallback');
      },
      canNext() {
        if (this.step === 1) {
          if (this.mode === 'new') return !!text(this.instanceDraft.name) && (this.instanceDraft.engine === 'hermes' || isHttpUrl(this.instanceDraft.baseUrl));
          return !!this.instanceId;
        }
        if (this.step === 2) return isAbsolutePath(this.target.path) && (this.target.remote === true || this.detectionIsCurrent());
        if (this.step === 3) return isHttpUrl(this.mcp.url) && !!text(this.mcp.secretRef) && !!text(this.mcp.identityId);
        if (this.step === 4) return this.selectedSkills.length > 0;
        return !this.busy;
      },
      reviewTarget() {
        return [
          this.targetEngineLabel,
          text(this.target.path),
          this.target.profile ? tr('ui.agents.wizard_review_profile', { profile: this.target.profile }) : '',
          this.target.remote ? tr('ui.agents.wizard_review_remote') : ''
        ].filter(Boolean).join(' · ');
      },
      verified() {
        return !!(this.result && this.result.verified === true);
      }
    },
    watch: {
      'target.path'() {
        this.targetChanged();
      },
      'target.profile'() {
        this.targetChanged();
      },
      'target.version'() {
        this.targetChanged();
      },
      'target.remote'() {
        this.targetChanged();
      },
      engine() {
        this.targetChanged();
      }
    },
    methods: {
      targetSnapshot() {
        return {
          engine: text(this.engine),
          path: text(this.target.path),
          profile: text(this.targetProfilePayload()),
          version: text(this.target.version),
          remote: this.target.remote === true
        };
      },
      sameTarget(left, right) {
        return !!left && !!right
          && left.engine === right.engine
          && left.path === right.path
          && left.profile === right.profile
          && left.version === right.version
          && left.remote === right.remote;
      },
      invalidateDetection() {
        this.detectGeneration += 1;
        this.detection = null;
        this.detectionTarget = null;
        this.pendingTarget = null;
        this.detecting = false;
        this.detectError = '';
      },
      detectionIsCurrent() {
        if (!this.detection || this.detection.detected !== true || !this.detectionTarget) return false;
        return this.sameTarget(this.detectionTarget, this.targetSnapshot());
      },
      targetChanged() {
        // A detection describes exactly one local target. Keep it only while
        // the snapshot that produced it still matches; the version echoed by
        // the server is applied before the snapshot is taken, so its own
        // watcher does not discard a fresh inspection. A watcher queued by an
        // earlier edit must not cancel an inspection of the current target.
        if (this.detectionIsCurrent()) return;
        if (this.detecting && this.pendingTarget && this.sameTarget(this.pendingTarget, this.targetSnapshot())) return;
        if (!this.detection && !this.detectionTarget && !this.detecting) {
          this.detectError = '';
          return;
        }
        this.invalidateDetection();
      },
      engineLabel,
      statusLabel: installationStatusLabel,
      tone(record) {
        return statusTone(text(record && record.status), record && record.verified);
      },
      checkText,
      resultError: resultErrorText,
      resultLimitations,
      limitationText,
      machineIdentityLabel(identity) {
        return (text(identity.name, text(identity.username, identity.id))) + ' · ' + text(identity.actorKind);
      },
      registeredProfile(instance) {
        if (!instance) return '';
        const profile = text(instance.profile);
        if (text(instance.engine) === 'opencode') return profile;
        return profile || 'default';
      },
      targetProfilePayload() {
        const profile = text(this.target.profile);
        if (profile) return profile;
        return this.engine === 'opencode' ? null : profile;
      },
      skillIsOfficial(skill) {
        const moduleId = text(skill.module);
        return this.modules.some(module => module && module.id === moduleId && module.official === true);
      },
      skillMeta(skill) {
        const parts = [];
        if (text(skill.version)) parts.push('v' + text(skill.version));
        if (text(skill.module)) parts.push(this.skillIsOfficial(skill) ? tr('ui.agents.official') : tr('ui.agents.module_named', { id: text(skill.module) }));
        return parts.join(' · ');
      },
      skillEnabled(skill) {
        return this.enabledSkills.some(item => item.name === skill.name);
      },
      toggleSkill(skill) {
        if (!this.skillEnabled(skill)) return;
        const index = this.selectedSkills.indexOf(skill.name);
        if (index === -1) this.selectedSkills.push(skill.name);
        else this.selectedSkills.splice(index, 1);
      },
      selectAllSkills() {
        this.selectedSkills = this.enabledSkills.map(skill => skill.name);
      },
      clearSkills() {
        this.selectedSkills = [];
      },
      async next() {
        this.error = '';
        if (this.step === 1) {
          const ready = await this.prepareInstance();
          if (!ready) return;
        }
        if (this.step < 5) this.step += 1;
      },
      back() {
        this.error = '';
        if (this.step > 1) this.step -= 1;
      },
      async prepareInstance() {
        this.instanceError = '';
        if (this.mode === 'existing') {
          if (!this.selectedInstance) {
            this.instanceError = tr('ui.agents.error_instance_selection');
            return false;
          }
          if (this.preparedInstanceId !== this.selectedInstance.id) {
            this.target.profile = this.registeredProfile(this.selectedInstance);
            this.preparedInstanceId = this.selectedInstance.id;
            this.detection = null;
          }
          if (!this.target.path) this.target.path = text(this.selectedInstance.directory);
          if (!this.mcp.identityId) this.mcp.identityId = text(this.selectedInstance.integrationIdentityId);
          return true;
        }
        const body = {
          name: text(this.instanceDraft.name),
          engine: this.instanceDraft.engine,
          baseUrl: text(this.instanceDraft.baseUrl),
          secretRef: text(this.instanceDraft.secretRef),
          username: text(this.instanceDraft.username),
          profile: text(this.instanceDraft.profile),
          directory: text(this.instanceDraft.directory),
          defaultModel: text(this.instanceDraft.defaultModel),
          integrationIdentityId: text(this.instanceDraft.integrationIdentityId),
          enabled: this.instanceDraft.enabled !== false
        };
        if (!body.name) { this.instanceError = tr('ui.agents.error_instance_name'); return false; }
        if (body.engine === 'opencode' && !isHttpUrl(body.baseUrl)) { this.instanceError = tr('ui.agents.error_opencode_url'); return false; }
        if (this.canManageQuota) {
          const quotaError = quotaInstanceError(this.instanceDraft);
          if (quotaError) { this.instanceError = quotaError; return false; }
          Object.assign(body, quotaInstanceBody(this.instanceDraft, true));
        }
        this.instanceBusy = true;
        try {
          const payload = await window.AssetAgentApi.saveInstance(this.app, '', body);
          const instance = payload && payload.instance ? payload.instance : payload;
          if (!instance || !text(instance.id)) throw new Error(tr('ui.agents.error_instance_created'));
          this.instanceId = instance.id;
          this.mode = 'existing';
          this.preparedInstanceId = instance.id;
          this.target.profile = this.registeredProfile({ engine: body.engine, profile: body.profile });
          if (!this.target.path) this.target.path = text(body.directory);
          this.$emit('applied', instance);
          return true;
        } catch (error) {
          this.instanceError = (error && error.message) || tr('ui.agents.error_instance_register');
          return false;
        } finally {
          this.instanceBusy = false;
        }
      },
      async detect() {
        this.invalidateDetection();
        if (this.target.remote === true) {
          this.detectError = tr('ui.agents.error_inspect_remote');
          return false;
        }
        if (!this.engine) { this.detectError = tr('ui.agents.error_instance_first'); return false; }
        if (!isAbsolutePath(this.target.path)) { this.detectError = tr('ui.agents.error_absolute_path'); return false; }
        const requested = this.targetSnapshot();
        const generation = this.detectGeneration;
        this.pendingTarget = requested;
        this.detecting = true;
        try {
          const payload = await window.AssetAgentApi.detectTarget(this.app, {
            engine: requested.engine,
            path: requested.path,
            profile: this.targetProfilePayload(),
            version: requested.version
          });
          if (generation !== this.detectGeneration) return false;
          if (!this.sameTarget(requested, this.targetSnapshot())) {
            this.invalidateDetection();
            return false;
          }
          const detection = normalizeTargetDetection(payload, requested.engine);
          if (!detection) {
            this.detectError = tr('ui.agents.error_detection_payload');
            return false;
          }
          this.detection = detection;
          if (detection.version) this.target.version = detection.version;
          this.detectionTarget = this.targetSnapshot();
          return true;
        } catch (error) {
          if (generation !== this.detectGeneration) return false;
          this.detectError = (error && error.message) || tr('ui.agents.error_detection');
          return false;
        } finally {
          if (generation === this.detectGeneration) {
            this.detecting = false;
            this.pendingTarget = null;
          }
        }
      },
      async install() {
        if (this.busy) return false;
        this.error = '';
        if (!this.instanceId || !this.selectedInstance) { this.error = tr('ui.agents.error_missing_instance'); return false; }
        if (this.target.remote !== true && !this.detectionIsCurrent()) {
          this.error = tr('ui.agents.error_confirm_target');
          return false;
        }
        if (!isHttpUrl(this.mcp.url) || !text(this.mcp.secretRef) || !text(this.mcp.identityId)) { this.error = tr('ui.agents.error_mcp_identity'); return false; }
        if (!this.selectedSkills.length) { this.error = tr('ui.agents.error_skills_required'); return false; }
        this.busy = true;
        try {
          const body = {
            instanceId: this.instanceId,
            target: {
              engine: this.engine,
              path: text(this.target.path),
              profile: this.targetProfilePayload(),
              version: text(this.target.version),
              remote: this.target.remote === true
            },
            mcp: {
              url: text(this.mcp.url),
              secretRef: text(this.mcp.secretRef),
              identityId: text(this.mcp.identityId)
            },
            skills: this.selectedSkills.slice(),
            operation: 'install'
          };
          if (this.target.remote === true) body.mode = 'remote';
          const payload = await window.AssetAgentApi.apply(this.app, body);
          this.result = payload || {};
          this.receiptText = '';
          this.receiptError = '';
          this.receiptResult = null;
          this.requestError = '';
          this.$emit('applied', this.result);
          return true;
        } catch (error) {
          this.error = (error && error.message) || tr('ui.agents.error_install_failed');
          return false;
        } finally {
          this.busy = false;
        }
      },
      async downloadRequest() {
        if (!this.result) return false;
        const request = this.result.request || (this.result.binding && this.result.binding.request);
        if (!request) { this.requestError = tr('ui.agents.error_no_request'); return false; }
        if (!saveJsonFile(request, this.result.id)) {
          this.requestError = tr('ui.agents.error_download_blocked');
          return false;
        }
        this.requestError = '';
        return true;
      },
      async reDownloadRequest() {
        if (!this.result || !this.result.id) { this.requestError = tr('ui.agents.error_installation_id'); return false; }
        this.requestError = '';
        try {
          const payload = await window.AssetAgentApi.installationRequest(this.app, this.result.id);
          if (!saveJsonFile(payload && payload.request, this.result.id)) {
            this.requestError = tr('ui.agents.error_download_blocked');
            return false;
          }
          return true;
        } catch (error) {
          this.requestError = (error && error.message) || tr('ui.agents.error_request_fetch');
          return false;
        }
      },
      async importWizardReceipt() {
        if (this.receiptBusy || !this.result || !this.result.id) return false;
        let receipt;
        try {
          receipt = JSON.parse(this.receiptText);
        } catch (_) {
          this.receiptError = tr('ui.agents.error_receipt_invalid_json');
          return false;
        }
        if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
          this.receiptError = tr('ui.agents.error_receipt_object');
          return false;
        }
        const requestDigest = text(this.result.requestDigest);
        if (!requestDigest) {
          this.receiptError = tr('ui.agents.error_request_digest');
          return false;
        }
        this.receiptBusy = true;
        this.receiptError = '';
        try {
          const updated = await window.AssetAgentApi.importReceipt(this.app, {
            instanceId: this.instanceId,
            requestDigest,
            receipt
          });
          const previous = this.result;
          this.result = Object.assign({}, previous, updated, {
            request: previous.request,
            requestDigest: updated.requestDigest || previous.requestDigest
          });
          this.receiptResult = updated || {};
          this.$emit('applied', updated);
          return true;
        } catch (error) {
          this.receiptError = (error && error.message) || tr('ui.agents.error_receipt_rejected');
          return false;
        } finally {
          this.receiptBusy = false;
        }
      },
      cancel() {
        this.$emit('close');
      }
    },
    template: `
      <section class="agent-wizard" aria-labelledby="agent-wizard-title">
        <header class="agent-wizard__head">
          <div>
            <p class="eyebrow">{{ $t('ui.agents.wizard_eyebrow') }}</p>
            <h3 id="agent-wizard-title" class="agent-wizard__title">{{ $t('ui.agents.wizard_title') }}</h3>
            <p class="agent-panel__sub">{{ $t('ui.agents.wizard_step', { step: step, title: stepTitle }) }}</p>
          </div>
          <button type="button" class="config-icon-action" :aria-label="$t('ui.agents.wizard_close')" @click="cancel"><app-icon name="close"></app-icon></button>
        </header>
        <ol class="agent-wizard__steps">
          <li v-for="index in 5" :key="index" :class="{ 'is-active': step === index, 'is-done': step > index }">{{ index }}</li>
        </ol>
        <p v-if="error" class="agent-note agent-note--error" role="alert">{{ error }}</p>

        <section v-if="step === 1" class="agent-wizard__body" aria-labelledby="agent-wizard-instance">
          <h4 id="agent-wizard-instance">{{ $t('ui.agents.wizard_instance_section') }}</h4>
          <div class="agent-wizard__modes">
            <label class="agent-check"><input type="radio" value="existing" v-model="mode"> {{ $t('ui.agents.wizard_mode_existing') }}</label>
            <label class="agent-check"><input type="radio" value="new" v-model="mode"> {{ $t('ui.agents.wizard_mode_new') }}</label>
          </div>
          <div v-if="mode === 'existing'" class="field">
            <label class="field__label" for="agent-wizard-instance-select">{{ $t('ui.agents.wizard_instance') }}</label>
            <select id="agent-wizard-instance-select" class="input-shell" v-model="instanceId">
              <option value="">{{ $t('ui.agents.wizard_instance_placeholder') }}</option>
              <option v-for="instance in engineInstances" :key="instance.id" :value="instance.id">{{ instance.name }} · {{ engineLabel(instance.engine) }}</option>
            </select>
            <p v-if="!engineInstances.length" class="agent-note">{{ $t('ui.agents.wizard_no_instances') }}</p>
          </div>
          <agent-instance-editor v-else :app="app" :draft="instanceDraft" :identities="identities" :busy="instanceBusy" :error="instanceError" :can-manage-quota="canManageQuota" @save="prepareInstance" @cancel="mode = 'existing'"></agent-instance-editor>
          <p v-if="mode === 'existing' && instanceError" class="agent-note agent-note--error" role="alert">{{ instanceError }}</p>
        </section>

        <section v-else-if="step === 2" class="agent-wizard__body" aria-labelledby="agent-wizard-target">
          <h4 id="agent-wizard-target">{{ $t('ui.agents.wizard_target_section') }}</h4>
          <div class="field">
            <label class="field__label" for="agent-wizard-path">{{ $t('ui.agents.wizard_target_path') }}</label>
            <input id="agent-wizard-path" class="input-shell" v-model.trim="target.path" :placeholder="$t('ui.agents.wizard_target_path_placeholder')" autocomplete="off">
          </div>
          <div class="agent-wizard__grid">
            <div class="field">
              <label class="field__label" for="agent-wizard-profile">{{ $t('ui.agents.wizard_profile') }}</label>
              <input id="agent-wizard-profile" class="input-shell" v-model.trim="target.profile" maxlength="200" :disabled="engine === 'opencode'" :placeholder="engine === 'opencode' ? $t('ui.agents.wizard_profile_workspace_placeholder') : $t('ui.agents.wizard_profile_name_placeholder')">
            </div>
            <div class="field">
              <label class="field__label" for="agent-wizard-version">{{ $t('ui.agents.wizard_version_expected') }}</label>
              <input id="agent-wizard-version" class="input-shell" v-model.trim="target.version" maxlength="80" :placeholder="$t('ui.agents.wizard_optional')">
            </div>
          </div>
          <label class="agent-check"><input type="checkbox" v-model="target.remote"> {{ $t('ui.agents.wizard_remote') }}</label>
          <p v-if="target.remote" class="agent-note" role="status">{{ $t('ui.agents.wizard_remote_request') }}</p>
          <div v-if="!target.remote" class="agent-wizard__actions">
            <button type="button" class="btn btn--secondary btn--small" :disabled="detecting" @click="detect">{{ detecting ? $t('ui.agents.wizard_inspecting') : $t('ui.agents.wizard_inspect_target') }}</button>
          </div>
          <div v-if="detection && !target.remote" class="agent-note" role="status">
            <p v-if="detection.detected === true">{{ $t('ui.agents.wizard_detected', { path: detection.targetPath || target.path }) }}<template v-if="detection.version">{{ $t('ui.agents.wizard_detected_version', { version: detection.version }) }}</template><template v-if="detection.profile">{{ $t('ui.agents.wizard_detected_profile', { profile: detection.profile }) }}</template><template v-if="detection.configExists === false">{{ $t('ui.agents.wizard_new_config') }}</template></p>
            <p v-if="detection.detected === true" class="agent-skill__meta">{{ $t('ui.agents.wizard_detected_paths', { config: detection.configFile, skills: detection.skillsDirectory }) }}</p>
            <p v-else>{{ $t('ui.agents.wizard_not_detected') }}</p>
            <ul v-if="Array.isArray(detection.limitations) && detection.limitations.length"><li v-for="(item, index) in detection.limitations" :key="index">{{ item }}</li></ul>
          </div>
          <p v-if="detectError" class="agent-note agent-note--error" role="alert">{{ detectError }}</p>
          <p class="field__hint">{{ $t('ui.agents.wizard_local_hint') }}</p>
        </section>

        <section v-else-if="step === 3" class="agent-wizard__body" aria-labelledby="agent-wizard-mcp">
          <h4 id="agent-wizard-mcp">{{ $t('ui.agents.wizard_mcp_section') }}</h4>
          <div class="field">
            <label class="field__label" for="agent-wizard-mcp-url">{{ $t('ui.agents.wizard_mcp_url') }}</label>
            <input id="agent-wizard-mcp-url" class="input-shell" v-model.trim="mcp.url" inputmode="url" placeholder="http://127.0.0.1:8000/mcp">
          </div>
          <div class="field">
            <label class="field__label" for="agent-wizard-mcp-secret">{{ $t('ui.agents.wizard_secret_name') }}</label>
            <input id="agent-wizard-mcp-secret" class="input-shell" v-model.trim="mcp.secretRef" maxlength="120" placeholder="ITSM_MCP_TOKEN">
            <p class="field__hint">{{ $t('ui.agents.wizard_secret_hint') }}</p>
          </div>
          <div class="field">
            <label class="field__label" for="agent-wizard-identity">{{ $t('ui.agents.wizard_identity') }}</label>
            <select id="agent-wizard-identity" class="input-shell" v-model="mcp.identityId">
              <option value="">{{ $t('ui.agents.wizard_identity_placeholder') }}</option>
              <option v-for="identity in identities" :key="identity.id" :value="identity.id">{{ machineIdentityLabel(identity) }}</option>
            </select>
            <p v-if="!identities.length" class="agent-note">{{ $t('ui.agents.wizard_no_identities') }}</p>
            <p v-else-if="selectedIdentity" class="field__hint">{{ $t('ui.agents.wizard_identity_permissions', { list: identityPermissions.length ? identityPermissions.join(', ') : $t('ui.agents.wizard_none_declared') }) }}</p>
          </div>
        </section>

        <section v-else-if="step === 4" class="agent-wizard__body" aria-labelledby="agent-wizard-skills">
          <h4 id="agent-wizard-skills">{{ $t('ui.agents.wizard_skills_section') }}</h4>
          <p class="agent-panel__sub">{{ $t('ui.agents.wizard_skills_lead') }}</p>
          <div class="agent-wizard__actions">
            <button type="button" class="btn btn--ghost btn--small" @click="selectAllSkills">{{ $t('ui.agents.wizard_select_all') }}</button>
            <button type="button" class="btn btn--ghost btn--small" @click="clearSkills">{{ $t('ui.agents.wizard_clear_selection') }}</button>
          </div>
          <p v-if="!skills.length" class="agent-note">{{ $t('ui.agents.wizard_no_skills') }}</p>
          <ul v-else class="agent-skill-list">
            <li v-for="skill in skills" :key="skill.name" class="agent-skill">
              <label class="agent-check">
                <input type="checkbox" :checked="selectedSkills.indexOf(skill.name) !== -1" :disabled="!skillEnabled(skill)" @change="toggleSkill(skill)">
                <span><strong>{{ skill.name }}</strong> <span class="agent-tag">{{ skillIsOfficial(skill) ? $t('ui.agents.official') : $t('ui.agents.wizard_module_tag') }}</span></span>
              </label>
              <p v-if="skill.description">{{ skill.description }}</p>
              <p class="agent-skill__meta">{{ skillMeta(skill) }}</p>
              <p v-if="!skillEnabled(skill)" class="field__hint">{{ $t('ui.agents.wizard_module_disabled') }}</p>
            </li>
          </ul>
        </section>

        <section v-else class="agent-wizard__body" aria-labelledby="agent-wizard-review">
          <h4 id="agent-wizard-review">{{ $t('ui.agents.wizard_review') }}</h4>
          <dl class="agent-review">
            <dt>{{ $t('ui.agents.wizard_instance') }}</dt><dd>{{ selectedInstance ? selectedInstance.name : $t('ui.agents.wizard_new_instance') }}</dd>
            <dt>{{ $t('ui.agents.wizard_destination') }}</dt><dd>{{ reviewTarget }}</dd>
            <dt>{{ $t('ui.agents.wizard_mcp') }}</dt><dd class="mono">{{ mcp.url }}</dd>
            <dt>{{ $t('ui.agents.wizard_secret') }}</dt><dd class="mono">{{ mcp.secretRef }}</dd>
            <dt>{{ $t('ui.agents.wizard_identity_label') }}</dt><dd>{{ selectedIdentity ? machineIdentityLabel(selectedIdentity) : $t('ui.agents.wizard_no_identity') }}</dd>
            <dt>{{ $t('ui.agents.wizard_skills') }}</dt><dd>{{ $t('ui.agents.wizard_selected_count', { count: selectedSkills.length }, selectedSkills.length) }}</dd>
          </dl>

          <div class="agent-wizard__actions">
            <button type="button" class="btn btn--primary btn--small" :disabled="busy" @click="install">{{ busy ? $t('ui.agents.wizard_processing') : (target.remote ? $t('ui.agents.wizard_generate_request') : $t('ui.agents.wizard_install_verify')) }}</button>
          </div>
          <div v-if="result" class="agent-result" :class="{ 'agent-result--ok': verified }" role="status">
            <div class="agent-result__head">
              <strong>{{ $t('ui.agents.installer_result') }}</strong>
              <span class="status-pill" :class="'status--' + tone(result)">{{ statusLabel(result) }}</span>
            </div>
            <p v-if="resultError(result)" class="agent-note agent-note--error" role="alert">{{ resultError(result) }}</p>
            <p v-else-if="verified">{{ $t('ui.agents.server_verified_mcp') }}</p>
            <p v-else>{{ $t('ui.agents.wizard_unverified_detail') }}</p>
            <p v-if="result.mcpVerified === true || result.profileSafetyVerified === true" class="agent-skill__meta">
              {{ $t('ui.agents.wizard_mcp_profile_state', { mcp: result.mcpVerified === true ? $t('ui.agents.wizard_verified') : $t('ui.agents.wizard_unverified'), profile: result.profileSafetyVerified === true ? $t('ui.agents.wizard_verified') : $t('ui.agents.wizard_unverified') }) }}
            </p>
            <p v-if="result.target && result.target.version" class="agent-skill__meta">{{ $t('ui.agents.version', { version: result.target.version }) }}</p>
            <p v-if="Array.isArray(result.managedFiles) && result.managedFiles.length" class="agent-skill__meta">{{ $t('ui.agents.managed_files', { count: result.managedFiles.length }, result.managedFiles.length) }}.</p>
            <div v-if="Array.isArray(result.conflicts) && result.conflicts.length" class="agent-note agent-note--warn">
              <p>{{ $t('ui.agents.conflicts_kept') }}</p>
              <ul><li v-for="(conflict, index) in result.conflicts" :key="index">{{ checkText(conflict) || conflict }}</li></ul>
            </div>
            <div v-if="Array.isArray(result.checks) && result.checks.length">
              <p class="agent-skill__meta">{{ $t('ui.agents.reported_checks') }}</p>
              <ul><li v-for="(check, index) in result.checks" :key="index">{{ checkText(check) || check }}</li></ul>
            </div>
            <div v-if="resultLimitations(result).length">
              <p class="agent-skill__meta">{{ $t('ui.agents.reported_limitations') }}</p>
              <ul><li v-for="(item, index) in resultLimitations(result)" :key="index">{{ limitationText(item) }}</li></ul>
            </div>
            <div v-if="result.request || (result.binding && result.binding.requestDigest)" class="agent-remote">
              <p><strong>{{ $t('ui.agents.wizard_request_generated') }}</strong> {{ $t('ui.agents.wizard_request_pending_install') }}</p>
              <p v-if="result.requestDigest" class="agent-skill__meta mono">SHA-256 {{ result.requestDigest }}</p>
              <p class="field__hint">{{ $t('ui.agents.wizard_run_hint') }}</p>
              <p class="mono">{{ $t('ui.agents.integration_request_example') }}</p>
              <div class="agent-wizard__actions">
                <button type="button" class="btn btn--secondary btn--small" @click="downloadRequest">{{ $t('ui.agents.download_request') }}</button>
                <button v-if="result.id" type="button" class="btn btn--ghost btn--small" @click="reDownloadRequest">{{ $t('ui.agents.wizard_redownload') }}</button>
              </div>
              <p v-if="requestError" class="agent-note agent-note--error" role="alert">{{ requestError }}</p>
              <div class="field">
                <label class="field__label" for="agent-wizard-receipt">{{ $t('ui.agents.remote_receipt') }}</label>
                <textarea id="agent-wizard-receipt" class="conversation__select" rows="4" v-model="receiptText" :placeholder="$t('ui.agents.wizard_receipt_placeholder')"></textarea>
              </div>
              <p v-if="receiptError" class="agent-note agent-note--error" role="alert">{{ receiptError }}</p>
              <div class="agent-wizard__actions">
                <button type="button" class="btn btn--primary btn--small" :disabled="receiptBusy" @click="importWizardReceipt">{{ receiptBusy ? $t('ui.agents.wizard_validating') : $t('ui.agents.import_receipt_verify') }}</button>
              </div>
              <p v-if="receiptResult" class="agent-note" role="status">
                {{ $t('ui.agents.wizard_receipt_imported', { status: statusLabel(receiptResult) }) }}
                <template v-if="receiptResult.verified === true">{{ $t('ui.agents.wizard_receipt_verified') }}</template>
                <template v-else>{{ $t('ui.agents.server_unverified_mcp') }}</template>
              </p>
            </div>
            <div class="agent-wizard__actions">
              <button type="button" class="btn btn--secondary btn--small" @click="cancel">{{ $t('ui.common.close') }}</button>
            </div>
          </div>
        </section>

        <footer v-if="step < 5" class="agent-wizard__footer">
          <button type="button" class="btn btn--secondary btn--small" :disabled="step === 1 || busy" @click="back">{{ $t('ui.agents.wizard_back') }}</button>
          <button type="button" class="btn btn--primary btn--small" :disabled="!canNext || instanceBusy" @click="next">{{ instanceBusy ? $t('ui.common.saving') : $t('ui.agents.wizard_continue') }}</button>
        </footer>
        <footer v-else-if="!result" class="agent-wizard__footer">
          <button type="button" class="btn btn--secondary btn--small" :disabled="busy" @click="back">{{ $t('ui.agents.wizard_back') }}</button>
          <span class="agent-panel__sub">{{ $t('ui.agents.wizard_footer_hint') }}</span>
        </footer>
      </section>
    `
  };

  const providersPanel = {
    name: 'AgentProvidersPanel',
    props: { app: { type: Object, required: true } },
    emits: ['changed'],
    data() {
      return {
        items: [], canManageGlobal: false, canManagePersonal: false,
        credentialStorageAvailable: false, loading: false, busy: false,
        error: '', notice: '', draft: null, pendingDeleteId: '', checks: {},
        epoch: 0, disposed: false, controller: null
      };
    },
    computed: {
      globalAllowed() { return this.canManageGlobal && !!(this.app.can && this.app.can(ADMIN_PERMISSION)); },
      personalAllowed() { return this.canManagePersonal && !!(this.app.can && this.app.can('agents.providers.personal')); }
    },
    watch: {
      'app.activeUserId': { flush: 'sync', handler() { this.resetProviders(); if (this.app.authenticated) void this.loadProviders(); } },
      'app.authenticated': { flush: 'sync', handler(value) { this.resetProviders(); if (value) void this.loadProviders(); } }
    },
    created() { if (this.app.authenticated) void this.loadProviders(); },
    beforeUnmount() { this.disposed = true; this.resetProviders(); },
    methods: {
      current(epoch) { return epoch === this.epoch && !this.disposed && !!this.app.authenticated; },
      resetProviders() {
        this.epoch += 1;
        if (this.controller) this.controller.abort();
        this.controller = null;
        this.items = [];
        this.canManageGlobal = false;
        this.canManagePersonal = false;
        this.credentialStorageAvailable = false;
        this.loading = false;
        this.busy = false;
        this.error = '';
        this.notice = '';
        this.draft = null;
        this.pendingDeleteId = '';
        this.checks = {};
      },
      credentialText(provider) {
        // A missing catalog key must not shadow the configured/unconfigured
        // fallback, so the mapped key is checked before translating.
        const key = PROVIDER_CREDENTIAL_LABELS[provider.credentialStatus];
        if (key) return tr(key);
        return provider.credentialConfigured ? tr('ui.agents.credential_primary') : tr('ui.agents.credential_missing');
      },
      checkResultText(provider) {
        const result = this.checks[provider.id];
        if (!result) return '';
        if (result.pending) return tr('ui.agents.provider_checking');
        if (result.ok) {
          return typeof result.modelCount === 'number'
            ? tr('ui.agents.provider_check_ok_models', { count: result.modelCount })
            : tr('ui.agents.provider_check_ok');
        }
        return PROVIDER_CHECK_LABELS[result.code]
          ? tr(PROVIDER_CHECK_LABELS[result.code])
          : tr('ui.agents.provider_check_failed');
      },
      async checkProvider(provider) {
        if (this.busy || !this.canEditProvider(provider)) return false;
        const epoch = this.epoch;
        this.checks = Object.assign({}, this.checks, { [provider.id]: { pending: true } });
        try {
          const result = await api.checkProvider(this.app, provider.id);
          if (!this.current(epoch)) return false;
          const outcome = result && typeof result === 'object' ? result : {};
          this.checks = Object.assign({}, this.checks, {
            [provider.id]: { ok: outcome.ok === true, code: text(outcome.code), modelCount: outcome.modelCount }
          });
          // Discovery is refreshed server-side by the check. Reload even on
          // failure so the list reflects its current closed status and models.
          await this.loadProviders();
          return outcome.ok === true;
        } catch (error) {
          if (!this.current(epoch)) return false;
          this.checks = Object.assign({}, this.checks, { [provider.id]: { ok: false, code: 'request_failed' } });
          return false;
        }
      },
      canEditProvider(provider) {
        return !!provider && (provider.scope === 'global' ? this.globalAllowed : provider.scope === 'personal' && this.personalAllowed);
      },
      async loadProviders() {
        const epoch = ++this.epoch;
        if (this.controller) this.controller.abort();
        const controller = new AbortController();
        this.controller = controller;
        this.loading = true;
        this.error = '';
        try {
          const payload = await api.providers(this.app, { signal: controller.signal });
          if (!this.current(epoch)) return false;
          if (!payload || !Array.isArray(payload.items)) throw new Error(tr('ui.agents.error_providers_payload'));
          this.items = payload.items.map(item => ({
            id: text(item.id), name: text(item.name), scope: item.scope, baseUrl: text(item.baseUrl),
            models: Array.isArray(item.models) ? item.models.map(model => text(model)) : [],
            modelSelection: item.modelSelection === 'manual' ? 'manual' : 'auto',
            discoveredCount: Array.isArray(item.discoveredModels) ? item.discoveredModels.length : 0,
            capabilities: normalizeCapabilities(item.modelCapabilities),
            discovery: item.discovery && typeof item.discovery === 'object' ? { code: text(item.discovery.code), count: Number(item.discovery.count) || 0 } : { code: '', count: 0 },
            credentialConfigured: item.credentialConfigured === true, credentialStatus: text(item.credentialStatus),
            enabled: item.enabled !== false
          }));
          this.canManageGlobal = payload.canManageGlobal === true;
          this.canManagePersonal = payload.canManagePersonal === true;
          this.credentialStorageAvailable = payload.credentialStorageAvailable === true;
          return true;
        } catch (error) {
          if (this.current(epoch) && error.name !== 'AbortError') this.error = error.serverMessage || error.message || tr('ui.agents.provider_load_failed');
          return false;
        } finally {
          if (this.current(epoch)) { this.loading = false; this.controller = null; }
        }
      },
      newProvider(scope) {
        if (this.busy || (scope === 'global' ? !this.globalAllowed : scope !== 'personal' || !this.personalAllowed)) return false;
        this.draft = { id: '', name: '', scope, baseUrl: '', modelSelection: 'auto', modelsText: '', marks: {}, apiKey: '', enabled: true };
        this.error = '';
        this.notice = '';
        return true;
      },
      editProvider(provider) {
        if (this.busy || !this.canEditProvider(provider)) return false;
        const marks = {};
        Object.keys(provider.capabilities).forEach(model => {
          const capability = provider.capabilities[model];
          if (capability.source === 'owner') marks[model] = { image: capability.image, file: capability.file };
        });
        this.draft = { id: provider.id, name: provider.name, scope: provider.scope, baseUrl: provider.baseUrl, modelSelection: provider.modelSelection, modelsText: provider.models.join('\n'), models: provider.models.slice(), marks, capabilities: provider.capabilities, apiKey: '', enabled: provider.enabled };
        this.error = '';
        this.notice = '';
        return true;
      },
      cancelProviderEdit() { this.draft = null; this.error = ''; },
      discoveryText(provider) {
        if (!provider.discovery.code) return provider.modelSelection === 'manual' ? tr('ui.agents.provider_manual_models') : tr('ui.agents.provider_discovery_pending');
        if (provider.discovery.code !== 'ok') return tr('ui.agents.provider_discovery_failed', { reason: PROVIDER_CHECK_LABELS[provider.discovery.code]
            ? tr(PROVIDER_CHECK_LABELS[provider.discovery.code])
            : tr('ui.agents.provider_discovery_invalid') });
        return provider.modelSelection === 'manual'
          ? tr('ui.agents.provider_discovery_manual_count', { count: provider.discovery.count })
          : tr('ui.agents.provider_discovery_auto_count', { count: provider.discovery.count });
      },
      capabilityModels(provider, field, value) {
        return provider.models.filter(id => provider.capabilities[id] && provider.capabilities[id][field] === value);
      },
      unknownCapabilityModels(provider) {
        return provider.models.filter(id => !provider.capabilities[id] || (provider.capabilities[id].image === null && provider.capabilities[id].file === null));
      },
      capabilityValue(model, field) {
        const draft = this.draft;
        if (!draft) return '';
        const mark = draft.marks[model];
        if (mark && field in mark) return mark[field] === null ? '' : String(mark[field]);
        const known = draft.capabilities && draft.capabilities[model];
        return known && known.source === 'owner' && typeof known[field] === 'boolean' ? String(known[field]) : '';
      },
      setCapability(model, field, value) {
        const draft = this.draft;
        if (!draft || !PROVIDER_CAPABILITY_FIELDS.includes(field)) return;
        const flag = value === 'true' ? true : (value === 'false' ? false : null);
        const current = Object.assign({}, draft.marks[model] || {});
        current[field] = flag;
        draft.marks = Object.assign({}, draft.marks, { [model]: current });
      },
      async saveProvider() {
        const draft = this.draft;
        if (!draft || this.busy || !this.canEditProvider(draft)) return false;
        const manual = draft.modelSelection === 'manual';
        const models = draft.modelsText.split(/\r?\n/).map(model => model.trim()).filter(Boolean);
        if (!draft.name.trim() || !draft.baseUrl.trim() || (manual && !models.length)) {
          this.error = manual ? tr('ui.agents.provider_save_missing_all') : tr('ui.agents.provider_save_missing');
          return false;
        }
        if (draft.apiKey && !this.credentialStorageAvailable) {
          this.error = tr('ui.agents.provider_no_storage');
          draft.apiKey = '';
          return false;
        }
        const body = { name: draft.name.trim(), scope: draft.scope, baseUrl: draft.baseUrl.trim(), modelSelection: manual ? 'manual' : 'auto' };
        if (manual) body.models = models;
        body.enabled = draft.enabled;
        // Only owner marks that were changed in this form are sent; provider
        // reported capabilities stay authoritative until the owner overrides.
        const marks = {};
        Object.keys(draft.marks).forEach(model => {
          const mark = draft.marks[model];
          marks[model] = { image: 'image' in mark ? mark.image : null, file: 'file' in mark ? mark.file : null };
        });
        if (Object.keys(marks).length) body.modelCapabilities = marks;
        if (draft.apiKey) body.apiKey = draft.apiKey;
        const epoch = this.epoch;
        const controller = new AbortController();
        this.controller = controller;
        this.busy = true;
        this.error = '';
        try {
          await api.saveProvider(this.app, draft.id, body, { signal: controller.signal });
          if (!this.current(epoch)) return false;
          this.draft = null;
          this.busy = false;
          this.notice = manual ? tr('ui.agents.provider_saved_models') : tr('ui.agents.provider_saved_discovery');
          await this.loadProviders();
          this.$emit('changed');
          return true;
        } catch (error) {
          if (this.current(epoch) && error.name !== 'AbortError') {
            this.error = error.serverMessage || error.message || tr('ui.agents.provider_save_failed');
            if (this.draft) this.draft.apiKey = '';
          }
          return false;
        } finally {
          if (this.current(epoch)) { this.busy = false; this.controller = null; }
        }
      },
      async removeProvider(provider) {
        if (this.busy || !this.canEditProvider(provider) || this.pendingDeleteId !== provider.id) return false;
        const epoch = this.epoch;
        const controller = new AbortController();
        this.controller = controller;
        this.busy = true;
        this.error = '';
        try {
          await api.deleteProvider(this.app, provider.id, { signal: controller.signal });
          if (!this.current(epoch)) return false;
          this.pendingDeleteId = '';
          this.draft = null;
          this.busy = false;
          this.notice = tr('ui.agents.provider_deleted');
          await this.loadProviders();
          this.$emit('changed');
          return true;
        } catch (error) {
          if (this.current(epoch) && error.name !== 'AbortError') this.error = error.serverMessage || error.message || tr('ui.agents.provider_delete_failed');
          return false;
        } finally {
          if (this.current(epoch)) { this.busy = false; this.controller = null; }
        }
      }
    },
    template: `
      <section class="agent-panel agent-providers" aria-labelledby="agent-providers-title" :aria-busy="loading || busy">
        <header class="agent-panel__head">
          <div><h3 id="agent-providers-title" class="agent-panel__title">{{ $t('ui.agents.providers_title') }}</h3><p class="agent-panel__sub">{{ $t('ui.agents.providers_sub') }}</p></div>
          <div class="agent-provider-actions">
            <button v-if="globalAllowed" id="provider-new-global" type="button" class="btn btn--secondary btn--small" :disabled="busy" @click="newProvider('global')">{{ $t('ui.agents.provider_add_global') }}</button>
            <button v-if="personalAllowed" id="provider-new-personal" type="button" class="btn btn--secondary btn--small" :disabled="busy" @click="newProvider('personal')">{{ $t('ui.agents.provider_add_personal') }}</button>
          </div>
        </header>
        <p v-if="loading" class="agent-note" role="status">{{ $t('ui.agents.providers_loading') }}</p>
        <p v-if="error" id="provider-error" class="agent-note agent-note--error" role="alert">{{ error }}</p>
        <button v-if="error && !draft" type="button" class="btn btn--ghost btn--small" @click="loadProviders">{{ $t('ui.agents.providers_reload') }}</button>
        <p v-if="notice" class="agent-note" role="status">{{ notice }}</p>
        <p v-if="!loading && !error && !items.length" class="agent-note">{{ $t('ui.agents.providers_empty') }}</p>
        <p v-if="!loading && (globalAllowed || personalAllowed) && !credentialStorageAvailable" id="provider-storage-help" class="agent-note">{{ $t('ui.agents.provider_storage_help') }}</p>
        <ul v-if="items.length" class="agent-instance-list">
          <li v-for="provider in items" :key="provider.id" class="agent-instance">
            <div><strong>{{ provider.name }}</strong> <span class="agent-tag">{{ provider.scope === 'global' ? $t('ui.agents.provider_scope_global') : $t('ui.agents.provider_scope_personal') }}</span> <span class="status-pill" :class="provider.enabled ? 'status--ok' : 'status--hold'">{{ provider.enabled ? $t('ui.agents.module_enabled') : $t('ui.agents.module_disabled') }}</span></div>
            <p class="agent-skill__meta">{{ provider.baseUrl }}</p>
            <p class="agent-skill__meta">{{ $t('ui.agents.provider_models', { list: provider.models.join(', ') || $t('ui.agents.provider_no_models') }) }}</p>
            <p class="agent-skill__meta">{{ discoveryText(provider) }}</p>
            <p v-if="capabilityModels(provider, 'image', true).length" class="agent-skill__meta">{{ $t('ui.agents.provider_accepts_images', { list: capabilityModels(provider, 'image', true).join(', ') }) }}</p>
            <p v-if="capabilityModels(provider, 'file', true).length" class="agent-skill__meta">{{ $t('ui.agents.provider_accepts_pdf', { list: capabilityModels(provider, 'file', true).join(', ') }) }}</p>
            <p v-if="unknownCapabilityModels(provider).length" class="agent-skill__meta">{{ $t('ui.agents.provider_capability_unknown', { list: unknownCapabilityModels(provider).join(', ') }) }}</p>
            <p class="agent-skill__meta">{{ credentialText(provider) }} · Pydantic AI</p>
            <p v-if="checks[provider.id]" class="agent-skill__meta" role="status">{{ checkResultText(provider) }}</p>
            <div v-if="canEditProvider(provider)" class="agent-provider-actions">
              <button :id="'provider-edit-' + provider.id" type="button" class="btn btn--ghost btn--small" :disabled="busy" :aria-label="$t('ui.agents.provider_edit_label', { name: provider.name })" @click="editProvider(provider)">{{ $t('ui.agents.provider_edit') }}</button>
              <button :id="'provider-check-' + provider.id" type="button" class="btn btn--ghost btn--small" :disabled="busy || (checks[provider.id] && checks[provider.id].pending)" :aria-label="$t('ui.agents.provider_check_label', { name: provider.name })" @click="checkProvider(provider)">{{ $t('ui.agents.provider_check') }}</button>
              <button :id="'provider-delete-' + provider.id" type="button" class="btn btn--ghost btn--small" :disabled="busy" :aria-label="$t('ui.agents.provider_delete_label', { name: provider.name })" @click="pendingDeleteId = provider.id">{{ $t('ui.agents.provider_delete') }}</button>
              <template v-if="pendingDeleteId === provider.id"><span>{{ $t('ui.agents.provider_delete_question', { name: provider.name }) }}</span><button type="button" class="btn btn--secondary btn--small" :disabled="busy" @click="removeProvider(provider)">{{ $t('ui.agents.provider_delete_confirm') }}</button><button type="button" class="btn btn--ghost btn--small" @click="pendingDeleteId = ''">{{ $t('ui.agents.provider_delete_keep') }}</button></template>
            </div>
          </li>
        </ul>
        <form v-if="draft" id="provider-form" class="agent-editor agent-provider-form" :aria-describedby="error ? 'provider-error' : undefined" @submit.prevent="saveProvider">
          <h4 class="agent-panel__title">{{ draft.id ? $t('ui.agents.provider_edit_title') : $t('ui.agents.provider_new_title') }} {{ draft.scope === 'global' ? $t('ui.agents.provider_scope_global') : $t('ui.agents.provider_scope_personal') }}</h4>
          <div class="field"><label class="field__label" for="provider-name">{{ $t('ui.agents.provider_name') }}</label><input id="provider-name" v-model="draft.name" class="input-shell" required :disabled="busy" maxlength="160"></div>
          <div class="field"><label class="field__label" for="provider-url">{{ $t('ui.agents.provider_endpoint') }}</label><input id="provider-url" v-model="draft.baseUrl" type="url" class="input-shell" required :disabled="busy" aria-describedby="provider-url-help"><p id="provider-url-help" class="field__hint">{{ draft.scope === 'personal' ? $t('ui.agents.provider_url_help_personal') : $t('ui.agents.provider_url_help_global') }}</p></div>
          <div class="field"><label class="field__label" for="provider-model-selection">{{ $t('ui.agents.provider_models_label') }}</label><select id="provider-model-selection" class="input-shell" :value="draft.modelSelection" :disabled="busy" aria-describedby="provider-model-selection-help" @change="draft.modelSelection = $event.target.value"><option value="auto">{{ $t('ui.agents.provider_discovery_auto') }}</option><option value="manual">{{ $t('ui.agents.provider_discovery_manual') }}</option></select><p id="provider-model-selection-help" class="field__hint">{{ draft.modelSelection === 'auto' ? $t('ui.agents.provider_discovery_auto_help') : $t('ui.agents.provider_discovery_manual_help') }}</p></div>
          <div v-if="draft.modelSelection === 'manual'" class="field"><label class="field__label" for="provider-models">{{ $t('ui.agents.provider_models_offered') }}</label><textarea id="provider-models" v-model="draft.modelsText" class="input-shell" rows="3" required :disabled="busy" aria-describedby="provider-models-help"></textarea><p id="provider-models-help" class="field__hint">{{ $t('ui.agents.provider_models_help') }}</p></div>
          <fieldset v-if="draft.id && draft.models && draft.models.length" class="field"><legend class="field__label">{{ $t('ui.agents.provider_inputs_legend') }}</legend><p class="field__hint">{{ $t('ui.agents.provider_inputs_hint') }}</p>
            <div v-for="(model, index) in draft.models" :key="model" class="agent-provider-actions"><span>{{ model }}</span>
              <label :for="'provider-capability-image-' + index">{{ $t('ui.agents.provider_images') }}</label><select :id="'provider-capability-image-' + index" class="input-shell" :value="capabilityValue(model, 'image')" :disabled="busy" @change="setCapability(model, 'image', $event.target.value)"><option value="">{{ draft.capabilities[model] && draft.capabilities[model].image !== null && draft.capabilities[model].source === 'provider' ? (draft.capabilities[model].image ? $t('ui.agents.provider_yes_provider') : $t('ui.agents.provider_no_provider')) : $t('ui.agents.provider_unknown_option') }}</option><option value="true">{{ $t('ui.agents.provider_yes') }}</option><option value="false">{{ $t('ui.agents.provider_no') }}</option></select>
              <label :for="'provider-capability-file-' + index">{{ $t('ui.agents.provider_pdf') }}</label><select :id="'provider-capability-file-' + index" class="input-shell" :value="capabilityValue(model, 'file')" :disabled="busy" @change="setCapability(model, 'file', $event.target.value)"><option value="">{{ draft.capabilities[model] && draft.capabilities[model].file !== null && draft.capabilities[model].source === 'provider' ? (draft.capabilities[model].file ? $t('ui.agents.provider_yes_provider') : $t('ui.agents.provider_no_provider')) : $t('ui.agents.provider_unknown_option') }}</option><option value="true">{{ $t('ui.agents.provider_yes') }}</option><option value="false">{{ $t('ui.agents.provider_no') }}</option></select>
            </div>
          </fieldset>
          <div class="field"><label class="field__label" for="provider-key">{{ draft.id ? $t('ui.agents.provider_key_replace') : $t('ui.agents.provider_key_new') }}</label><input id="provider-key" v-model="draft.apiKey" type="password" class="input-shell" autocomplete="new-password" :disabled="busy || !credentialStorageAvailable" :aria-describedby="!credentialStorageAvailable ? 'provider-storage-help provider-key-help' : 'provider-key-help'"><p id="provider-key-help" class="field__hint">{{ $t('ui.agents.provider_key_help') }}</p></div>
          <label class="agent-checkbox"><input v-model="draft.enabled" type="checkbox" :disabled="busy"> {{ $t('ui.agents.module_enabled') }}</label>
          <div class="agent-provider-actions"><button type="submit" class="btn btn--primary" :disabled="busy">{{ busy ? $t('ui.common.saving') : $t('ui.agents.provider_save') }}</button><button type="button" class="btn btn--secondary" :disabled="busy" @click="cancelProviderEdit">{{ $t('ui.common.cancel') }}</button></div>
        </form>
      </section>
    `
  };

  const settings = {
    name: 'AgentIntegrationsSettings',
    components: {
      AppIcon: window.AppIcon,
      AgentEnginePicker: enginePicker,
      AgentInstanceEditor: instanceEditor,
      AgentCatalogPanel: catalogPanel,
      AgentInstallationsPanel: installationsPanel,
      AgentIntegrationWizard: wizard,
      AgentProvidersPanel: providersPanel
    },
    mixins: [window.AssetAgentEngineMixin, window.AssetAgentQuotaFormatMixin],
    props: {
      app: { type: Object, required: true }
    },
    data() {
      return {
        disposed: false,
        loading: true,
        loadError: '',
        adminError: '',
        enginePickerKey: 0,
        adminAvailable: false,
        integrations: { instances: [], installations: [], defaults: { instanceId: null, model: null } },
        catalog: { skills: [], modules: [] },
        catalogError: '',
        wizardOpen: false,
        wizardAutoOpened: false,
        instanceEditing: false,
        instanceBusy: false,
        instanceError: '',
        instanceDraft: Object.assign({
          id: '', name: '', engine: 'opencode', baseUrl: 'http://127.0.0.1:4096', secretRef: '', username: '', profile: '', directory: '', defaultModel: '', integrationIdentityId: '', enabled: true
        }, quotaInstanceDraft()),
        moduleBusyId: '',
        moduleError: '',
        operationBusy: '',
        operationError: '',
        operationResult: null,
        quotaAdminEpoch: 0,
        quotaMutationEpoch: 0,
        quotaReportEpoch: 0,
        quotaPendingEpoch: 0,
        quotaAdminOwner: '',
        quotaPolicyController: null,
        quotaReportController: null,
        quotaPendingController: null,
        quotaPolicy: null,
        quotaPolicyLoading: false,
        quotaPolicyError: '',
        quotaPolicyBusy: false,
        quotaPolicyNotice: '',
        quotaDraft: { companyMode: 'limited', companyLimit: '', personalMode: 'limited', personalLimit: '', timezone: '' },
        quotaOverrides: [],
        quotaOverrideUser: '',
        quotaOverrideScope: 'company',
        quotaOverrideMode: 'inherit',
        quotaOverrideLimit: '',
        quotaOverrideBusy: false,
        quotaOverrideError: '',
        quotaOverrideNotice: '',
        quotaPendingRemove: '',
        quotaReport: null,
        quotaReportLoading: false,
        quotaReportError: '',
        quotaReportFilters: { userId: '', providerId: '', model: '', engine: '', funding: '', dayFrom: '', dayTo: '' },
        quotaReportIncludeLegacy: true,
        quotaPending: null,
        quotaPendingLoading: false,
        quotaPendingError: ''
      };
    },
    computed: {
      isAdmin() {
        return !!(this.app.can && this.app.can(ADMIN_PERMISSION));
      },
      canManageModules() {
        return !!(this.app.can && this.app.can('system.modules'));
      },
      adminInstances() {
        return Array.isArray(this.integrations.instances) ? this.integrations.instances : [];
      },
      installations() {
        return Array.isArray(this.integrations.installations) ? this.integrations.installations : [];
      },
      externalInstances() {
        return this.adminInstances.filter(instance => instance && instance.engine !== 'pydantic');
      },
      identities() {
        const users = this.app.security && Array.isArray(this.app.security.users) ? this.app.security.users : [];
        return users.filter(user => user && user.id && text(user.actorKind) && user.actorKind !== 'human');
      },
      firstRegistration() {
        return this.isAdmin && this.adminAvailable && this.installations.length === 0 && this.externalInstances.length === 0;
      },
      defaultLabel() {
        const defaults = this.integrations.defaults || {};
        if (!defaults.instanceId) return tr('ui.agents.default_preference');
        const instance = this.adminInstances.find(item => item.id === defaults.instanceId);
        return (instance ? instance.name : defaults.instanceId) + (defaults.model ? ' · ' + defaults.model : '');
      },
      canManageQuota() {
        if (!(this.app.can && this.app.can(ADMIN_PERMISSION))) return false;
        const user = this.app.currentUser;
        return !user || !text(user.actorKind) || user.actorKind === 'human';
      },
      canBrowseQuotaUsers() {
        return !!(this.app.can && this.app.can('users.view'));
      },
      quotaUserOptions() {
        if (!this.canBrowseQuotaUsers) return [];
        const users = this.app.security && Array.isArray(this.app.security.users) ? this.app.security.users : [];
        return users.filter(user => user && text(user.id) && (!text(user.actorKind) || user.actorKind === 'human')).map(user => {
          const name = text(user.name) || text(user.username) || text(user.id);
          const username = text(user.username);
          return { id: text(user.id), label: username && username !== name ? name + ' · ' + username : name };
        });
      },
      quotaOverrideRecord() {
        const userId = text(this.quotaOverrideUser);
        return this.quotaOverrides.find(item => item.userId === userId && item.scope === this.quotaOverrideScope) || null;
      },
      quotaOverrideInputValid() {
        const userId = text(this.quotaOverrideUser);
        if (!userId || userId.length > 64) return false;
        if (this.canBrowseQuotaUsers && this.quotaUserOptions.length) return this.quotaUserOptions.some(item => item.id === userId);
        return QUOTA_UUID_RE.test(userId);
      },
      quotaAdminMutationBusy() {
        return this.quotaPolicyBusy || this.quotaOverrideBusy;
      },
      quotaReportGroupByLabel() {
        if (!this.quotaReport) return '';
        return this.quotaReport.groupBy.map(key => this.quotaDimensionLabel(key)).join(', ');
      }
    },
    watch: {
      'app.activeUserId': {
        flush: 'sync',
        handler() {
          this.resetQuotaAdmin();
          if (this.app.authenticated && this.canManageQuota) {
            void this.loadQuotaPolicy();
            void this.loadQuotaReport();
          }
        }
      },
      'app.authenticated'(value) {
        this.resetQuotaAdmin();
        if (value && this.canManageQuota) {
          void this.loadQuotaPolicy();
          void this.loadQuotaReport();
        }
      }
    },
    created() {
      void this.load();
    },
    beforeUnmount() {
      this.disposed = true;
      this.agentEpoch += 1;
      this.resetQuotaAdmin();
    },
    methods: {
      engineLabel,
      resetQuotaAdmin() {
        this.quotaAdminEpoch += 1;
        this.quotaMutationEpoch += 1;
        this.quotaReportEpoch += 1;
        this.quotaPendingEpoch += 1;
        [this.quotaPolicyController, this.quotaReportController, this.quotaPendingController].forEach(controller => {
          if (controller && typeof controller.abort === 'function') controller.abort();
        });
        this.quotaPolicyController = null;
        this.quotaReportController = null;
        this.quotaPendingController = null;
        this.quotaAdminOwner = '';
        this.quotaPolicy = null;
        this.quotaPolicyLoading = false;
        this.quotaPolicyBusy = false;
        this.quotaPolicyError = '';
        this.quotaPolicyNotice = '';
        this.quotaDraft = { companyMode: 'limited', companyLimit: '', personalMode: 'limited', personalLimit: '', timezone: '' };
        this.quotaOverrides = [];
        this.quotaOverrideUser = '';
        this.quotaOverrideScope = 'company';
        this.quotaOverrideMode = 'inherit';
        this.quotaOverrideLimit = '';
        this.quotaOverrideBusy = false;
        this.quotaOverrideError = '';
        this.quotaOverrideNotice = '';
        this.quotaPendingRemove = '';
        this.quotaReport = null;
        this.quotaReportLoading = false;
        this.quotaReportError = '';
        this.quotaReportFilters = { userId: '', providerId: '', model: '', engine: '', funding: '', dayFrom: '', dayTo: '' };
        this.quotaReportIncludeLegacy = true;
        this.quotaPending = null;
        this.quotaPendingLoading = false;
        this.quotaPendingError = '';
      },
      isCurrentQuotaAdmin(epoch, kind) {
        const current = kind === 'report'
          ? this.quotaReportEpoch
          : (kind === 'pending' ? this.quotaPendingEpoch : this.quotaAdminEpoch);
        return epoch === current && this.disposed !== true && this.app.authenticated !== false &&
          this.quotaAdminOwner === String(this.app.activeUserId || '');
      },
      isCurrentQuotaMutation(epoch) {
        return epoch === this.quotaMutationEpoch && this.disposed !== true && this.app.authenticated !== false &&
          this.quotaAdminOwner === String(this.app.activeUserId || '');
      },
      parseQuotaLimit(value) {
        if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
        const raw = text(value);
        if (!raw || !/^\d+$/.test(raw)) return undefined;
        const parsed = Number(raw);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
      },
      quotaLimitText(limit, known) {
        if (known === false) return tr('ui.agents.not_available');
        if (limit === null || limit === undefined) return tr('ui.agents.unlimited');
        return tr('ui.agents.tokens_value', { value: formatTokens(limit) }) +
          (limit === 0 ? ' · ' + tr('ui.agents.limit_zero_admission') : '');
      },
      quotaOverrideLimitText(record) {
        if (!record) return tr('ui.agents.quota_override_inherit');
        return this.quotaLimitText(record.dailyLimit, true);
      },
      quotaDimensionLabel(key) {
        return {
          user: tr('ui.agents.quota_dim_user'),
          provider: tr('ui.agents.source_provider'),
          model: tr('ui.agents.quota_dim_model'),
          engine: tr('ui.agents.engine'),
          funding: tr('ui.agents.quota_dim_funding'),
          day: tr('ui.agents.quota_dim_day')
        }[key] || text(key);
      },
      quotaUserName(userId) {
        const id = text(userId);
        if (!id) return tr('ui.agents.quota_no_user');
        const match = this.quotaUserOptions.find(item => item.id === id);
        return match ? match.label : id;
      },
      quotaRowProvider(row) {
        if (row.legacy === true) return tr('ui.agents.quota_legacy_unattributed');
        const name = text(row.providerName) || text(row.providerId);
        if (!name) return tr('ui.agents.not_reported');
        const scope = text(row.providerScope);
        const scopeLabel = scope === 'global' ? tr('ui.agents.provider_scope_global') : scope === 'personal' ? tr('ui.agents.provider_scope_personal') : tr('ui.agents.quota_scope_unknown');
        return name + (scope ? ' · ' + scopeLabel : '');
      },
      quotaRowModel(row) {
        if (row.legacy === true) return tr('ui.agents.quota_legacy_unattributed');
        return text(row.model) || tr('ui.agents.not_reported');
      },
      quotaRowEngine(row) {
        if (row.legacy === true) return tr('ui.agents.quota_legacy_unattributed');
        return text(row.engine) || tr('ui.agents.not_reported');
      },
      quotaRowPrecision(row) {
        return this.quotaPrecisionLabel(row.precision) + ' · ' + this.quotaSourceLabel(row.source);
      },
      quotaRowState(row) {
        return this.quotaStateLabel(row.state) + (row.legacy === true ? tr('ui.agents.quota_legacy_suffix') : '');
      },
      applyQuotaPolicy(value) {
        const policy = normalizeQuotaPolicy(value);
        if (!policy) {
          this.quotaPolicy = null;
          this.quotaOverrides = [];
          return false;
        }
        this.quotaPolicy = policy;
        this.quotaOverrides = policy.overrides.slice();
        this.quotaDraft = {
          companyMode: policy.companyKnown ? (policy.companyDailyLimit === null ? 'unlimited' : 'limited') : 'unknown',
          companyLimit: policy.companyKnown && policy.companyDailyLimit !== null ? String(policy.companyDailyLimit) : '',
          timezone: policy.timezone
        };
        if (!this.quotaOverrideUser || (this.canBrowseQuotaUsers && this.quotaUserOptions.length &&
          !this.quotaUserOptions.some(item => item.id === this.quotaOverrideUser))) {
          this.quotaOverrideUser = this.quotaUserOptions.length ? this.quotaUserOptions[0].id : '';
        }
        this.syncQuotaOverrideDraft();
        return true;
      },
      syncQuotaOverrideDraft() {
        const record = this.quotaOverrideRecord;
        if (!record) {
          this.quotaOverrideMode = 'inherit';
          this.quotaOverrideLimit = '';
          return;
        }
        if (record.dailyLimit === null) {
          this.quotaOverrideMode = 'unlimited';
          this.quotaOverrideLimit = '';
          return;
        }
        this.quotaOverrideMode = 'limited';
        this.quotaOverrideLimit = String(record.dailyLimit);
      },
      onQuotaOverrideTargetChanged() {
        this.quotaOverrideError = '';
        this.quotaOverrideNotice = '';
        this.quotaPendingRemove = '';
        this.syncQuotaOverrideDraft();
      },
      async loadQuotaPolicy() {
        if (!this.canManageQuota) return false;
        const epoch = this.quotaAdminEpoch + 1;
        this.quotaAdminEpoch = epoch;
        if (this.quotaPolicyController && typeof this.quotaPolicyController.abort === 'function') this.quotaPolicyController.abort();
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        this.quotaPolicyController = controller;
        this.quotaAdminOwner = String(this.app.activeUserId || '');
        this.quotaPolicyLoading = true;
        this.quotaPolicyError = '';
        try {
          const payload = await api.quotaPolicy(this.app, controller ? { signal: controller.signal } : {});
          if (!this.isCurrentQuotaAdmin(epoch)) return false;
          if (!this.applyQuotaPolicy(payload)) {
            this.quotaPolicyError = tr('ui.agents.error_quota_policy_payload');
            return false;
          }
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaAdmin(epoch)) return false;
          this.quotaPolicy = null;
          this.quotaPolicyError = error && error.status === 403
            ? tr('ui.agents.error_quota_policy_forbidden')
            : ((error && (error.serverMessage || error.message)) || tr('ui.agents.error_quota_policy_load'));
          return false;
        } finally {
          if (this.isCurrentQuotaAdmin(epoch)) this.quotaPolicyLoading = false;
        }
      },
      async saveQuotaPolicy() {
        if (!this.canManageQuota || !this.quotaPolicy || !this.quotaPolicy.available || this.quotaAdminMutationBusy) {
          if (this.quotaPolicy && !this.quotaPolicy.available) {
            this.quotaPolicyError = tr('ui.agents.error_quota_policy_unavailable');
          }
          return false;
        }
        this.quotaPolicyError = '';
        this.quotaPolicyNotice = '';
        let epoch = 0;
        try {
          const body = {};
          const limits = [
            ['company', 'companyMode', 'companyLimit', 'companyDailyLimit']
          ];
          for (const [, modeKey, limitKey, bodyKey] of limits) {
            if (this.quotaDraft[modeKey] === 'unlimited') {
              if (this.quotaPolicy[bodyKey] !== null) body[bodyKey] = null;
            } else if (this.quotaDraft[modeKey] === 'limited') {
              const parsed = this.parseQuotaLimit(this.quotaDraft[limitKey]);
              if (parsed === undefined) {
                this.quotaPolicyError = tr('ui.agents.error_quota_company_limit');
                return false;
              }
              if (parsed !== this.quotaPolicy[bodyKey]) body[bodyKey] = parsed;
            } else {
              this.quotaPolicyError = tr('ui.agents.error_quota_company_mode');
              return false;
            }
          }
          const timezone = text(this.quotaDraft.timezone);
          if (timezone && timezone !== this.quotaPolicy.timezone) body.timezone = timezone;
          if (!Object.keys(body).length) {
            this.quotaPolicyNotice = tr('ui.agents.quota_no_changes');
            return true;
          }
          this.quotaPolicyBusy = true;
          epoch = this.quotaMutationEpoch + 1;
          this.quotaMutationEpoch = epoch;
          this.quotaAdminOwner = String(this.app.activeUserId || '');
          const payload = await api.saveQuotaPolicy(this.app, body);
          if (!this.isCurrentQuotaMutation(epoch)) return false;
          if (!this.applyQuotaPolicy(payload)) {
            this.quotaPolicyError = tr('ui.agents.error_quota_policy_confirm');
            return false;
          }
          this.quotaAdminEpoch += 1;
          this.quotaPolicyLoading = false;
          this.quotaPolicyNotice = tr('ui.agents.quota_policy_saved');
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaMutation(epoch)) return false;
          this.quotaPolicyError = (error && (error.serverMessage || error.message)) || tr('ui.agents.error_quota_policy_save');
          return false;
        } finally {
          if (epoch === this.quotaMutationEpoch) this.quotaPolicyBusy = false;
        }
      },
      async cancelQuotaTimezoneChange() {
        if (!this.canManageQuota || !this.quotaPolicy || !this.quotaPolicy.pendingTimezone || this.quotaAdminMutationBusy) return false;
        this.quotaPolicyBusy = true;
        this.quotaPolicyError = '';
        this.quotaPolicyNotice = '';
        const epoch = this.quotaMutationEpoch + 1;
        this.quotaMutationEpoch = epoch;
        this.quotaAdminOwner = String(this.app.activeUserId || '');
        try {
          const payload = await api.saveQuotaPolicy(this.app, { cancelTimezoneChange: true });
          if (!this.isCurrentQuotaMutation(epoch)) return false;
          if (!this.applyQuotaPolicy(payload)) {
            this.quotaPolicyError = tr('ui.agents.error_quota_timezone_confirm');
            return false;
          }
          this.quotaAdminEpoch += 1;
          this.quotaPolicyLoading = false;
          this.quotaPolicyNotice = tr('ui.agents.quota_timezone_cancelled');
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaMutation(epoch)) return false;
          this.quotaPolicyError = (error && (error.serverMessage || error.message)) || tr('ui.agents.error_quota_timezone_cancel');
          return false;
        } finally {
          if (epoch === this.quotaMutationEpoch) this.quotaPolicyBusy = false;
        }
      },
      async saveQuotaOverride() {
        if (!this.canManageQuota || this.quotaAdminMutationBusy) return false;
        this.quotaOverrideError = '';
        this.quotaOverrideNotice = '';
        const userId = text(this.quotaOverrideUser);
        if (!this.quotaOverrideInputValid) {
          this.quotaOverrideError = this.canBrowseQuotaUsers && this.quotaUserOptions.length
            ? tr('ui.agents.error_quota_user_selection')
            : tr('ui.agents.error_quota_user_uuid');
          return false;
        }
        const scope = 'company';
        if (this.quotaOverrideMode === 'inherit') {
          if (!this.quotaOverrideRecord) {
            this.quotaOverrideError = tr('ui.agents.error_quota_override_inherited');
            return false;
          }
          return this.removeQuotaOverride(userId, scope);
        }
        let dailyLimit;
        if (this.quotaOverrideMode === 'unlimited') dailyLimit = null;
        else if (this.quotaOverrideMode === 'limited') {
          dailyLimit = this.parseQuotaLimit(this.quotaOverrideLimit);
          if (dailyLimit === undefined) {
            this.quotaOverrideError = tr('ui.agents.error_quota_override_limit');
            return false;
          }
        } else {
          this.quotaOverrideError = tr('ui.agents.error_quota_override_mode');
          return false;
        }
        this.quotaOverrideBusy = true;
        const epoch = this.quotaMutationEpoch + 1;
        this.quotaMutationEpoch = epoch;
        this.quotaAdminOwner = String(this.app.activeUserId || '');
        try {
          const payload = await api.saveQuotaOverride(this.app, userId, { dailyLimit, scope });
          if (!this.isCurrentQuotaMutation(epoch)) return false;
          const overrides = normalizeQuotaOverrides(payload);
          if (!overrides) {
            this.quotaOverrideError = tr('ui.agents.error_quota_overrides_confirm');
            return false;
          }
          this.quotaOverrides = overrides;
          if (this.quotaPolicy) this.quotaPolicy.overrides = overrides.slice();
          this.quotaAdminEpoch += 1;
          this.quotaPolicyLoading = false;
          this.syncQuotaOverrideDraft();
          this.quotaOverrideNotice = dailyLimit === null
            ? tr('ui.agents.quota_override_saved_unlimited')
            : (dailyLimit === 0
              ? tr('ui.agents.quota_override_saved_zero')
              : tr('ui.agents.quota_override_saved_limit', { value: formatTokens(dailyLimit) }));
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaMutation(epoch)) return false;
          this.quotaOverrideError = (error && (error.serverMessage || error.message)) || tr('ui.agents.error_quota_override_save');
          return false;
        } finally {
          if (epoch === this.quotaMutationEpoch) this.quotaOverrideBusy = false;
        }
      },
      requestRemoveQuotaOverride(record) {
        if (!record) return false;
        this.quotaPendingRemove = text(record.userId) + '|' + text(record.scope);
        this.quotaOverrideError = '';
        this.quotaOverrideNotice = '';
        return true;
      },
      cancelRemoveQuotaOverride() {
        this.quotaPendingRemove = '';
      },
      async confirmRemoveQuotaOverride(record) {
        if (!record) return false;
        const key = text(record.userId) + '|' + text(record.scope);
        if (this.quotaPendingRemove !== key) return false;
        this.quotaPendingRemove = '';
        return this.removeQuotaOverride(record.userId, record.scope);
      },
      async removeQuotaOverride(userId, scope) {
        if (!this.canManageQuota || this.quotaAdminMutationBusy) return false;
        this.quotaOverrideError = '';
        this.quotaOverrideNotice = '';
        this.quotaOverrideBusy = true;
        const epoch = this.quotaMutationEpoch + 1;
        this.quotaMutationEpoch = epoch;
        this.quotaAdminOwner = String(this.app.activeUserId || '');
        try {
          const payload = await api.deleteQuotaOverride(this.app, userId, scope);
          if (!this.isCurrentQuotaMutation(epoch)) return false;
          const overrides = normalizeQuotaOverrides(payload);
          if (!overrides) {
            this.quotaOverrideError = tr('ui.agents.error_quota_overrides_confirm');
            return false;
          }
          this.quotaOverrides = overrides;
          if (this.quotaPolicy) this.quotaPolicy.overrides = overrides.slice();
          this.quotaAdminEpoch += 1;
          this.quotaPolicyLoading = false;
          this.syncQuotaOverrideDraft();
          this.quotaOverrideNotice = tr('ui.agents.quota_override_removed');
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaMutation(epoch)) return false;
          this.quotaOverrideError = (error && (error.serverMessage || error.message)) || tr('ui.agents.error_quota_override_remove');
          return false;
        } finally {
          if (epoch === this.quotaMutationEpoch) this.quotaOverrideBusy = false;
        }
      },
      async loadQuotaReport() {
        if (!this.canManageQuota) return false;
        const filters = this.quotaReportFilters;
        const userId = text(filters.userId);
        if (userId && !QUOTA_UUID_RE.test(userId)) {
          this.quotaReportError = tr('ui.agents.error_quota_report_user');
          return false;
        }
        const parts = [];
        ['userId', 'providerId', 'model', 'engine', 'funding', 'dayFrom', 'dayTo'].forEach(key => {
          const value = text(filters[key]);
          if (value) parts.push(key + '=' + encodeURIComponent(value));
        });
        parts.push('includeLegacy=' + (this.quotaReportIncludeLegacy ? 'true' : 'false'));
        const epoch = this.quotaReportEpoch + 1;
        this.quotaReportEpoch = epoch;
        if (this.quotaReportController && typeof this.quotaReportController.abort === 'function') this.quotaReportController.abort();
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        this.quotaReportController = controller;
        this.quotaAdminOwner = String(this.app.activeUserId || '');
        this.quotaReportLoading = true;
        this.quotaReportError = '';
        try {
          const payload = await api.quotaReport(this.app, parts.join('&'), controller ? { signal: controller.signal } : {});
          if (!this.isCurrentQuotaAdmin(epoch, 'report')) return false;
          const report = normalizeQuotaReport(payload);
          if (!report) {
            this.quotaReport = null;
            this.quotaReportError = tr('ui.agents.error_quota_report_payload');
            return false;
          }
          this.quotaReport = report;
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaAdmin(epoch, 'report')) return false;
          this.quotaReport = null;
          this.quotaReportError = (error && (error.serverMessage || error.message)) || tr('ui.agents.error_quota_report_load');
          return false;
        } finally {
          if (this.isCurrentQuotaAdmin(epoch, 'report')) this.quotaReportLoading = false;
        }
      },
      async loadQuotaPending() {
        if (!this.canManageQuota) return false;
        const epoch = this.quotaPendingEpoch + 1;
        this.quotaPendingEpoch = epoch;
        if (this.quotaPendingController && typeof this.quotaPendingController.abort === 'function') this.quotaPendingController.abort();
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        this.quotaPendingController = controller;
        this.quotaAdminOwner = String(this.app.activeUserId || '');
        this.quotaPendingLoading = true;
        this.quotaPendingError = '';
        try {
          const payload = await api.quotaPending(this.app, controller ? { signal: controller.signal } : {});
          if (!this.isCurrentQuotaAdmin(epoch, 'pending')) return false;
          const items = normalizeQuotaPending(payload);
          if (!items) {
            this.quotaPending = null;
            this.quotaPendingError = tr('ui.agents.error_quota_pending_payload');
            return false;
          }
          this.quotaPending = items;
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaAdmin(epoch, 'pending')) return false;
          this.quotaPending = null;
          this.quotaPendingError = (error && (error.serverMessage || error.message)) || tr('ui.agents.error_quota_pending_load');
          return false;
        } finally {
          if (this.isCurrentQuotaAdmin(epoch, 'pending')) this.quotaPendingLoading = false;
        }
      },
      async onProvidersChanged() {
        await this.loadAgentEngines();
        if (!this.disposed) this.enginePickerKey += 1;
      },
      installationStatusLabel,
      async load() {
        this.loading = true;
        this.loadError = '';
        this.adminError = '';
        await this.loadAgentEngines();
        if (!this.agentEnginesAvailable && this.agentEnginesError) this.loadError = this.agentEnginesError;
        if (this.isAdmin) {
          try {
            const [integrations, catalog] = await Promise.all([
              window.AssetAgentApi.integrations(this.app),
              window.AssetAgentApi.catalog(this.app)
            ]);
            if (this.disposed) return;
            this.integrations = this.normalizeIntegrations(integrations);
            this.catalog = this.normalizeCatalog(catalog);
            this.adminAvailable = true;
            this.catalogError = '';
          } catch (error) {
            if (this.disposed) return;
            this.adminAvailable = false;
            this.adminError = (error && error.status === 403)
              ? tr('ui.agents.error_integrations_permission')
              : ((error && error.message) || tr('ui.agents.error_integrations_load'));
            this.adminError && (this.loadError = this.loadError || this.adminError);
          }
        }
        if (this.canManageQuota) {
          await Promise.all([this.loadQuotaPolicy(), this.loadQuotaReport()]);
        }
        this.loading = false;
        if (!this.wizardAutoOpened && this.isAdmin && this.adminAvailable && this.installations.length === 0 && this.externalInstances.length === 0) {
          this.wizardAutoOpened = true;
          this.wizardOpen = true;
        }
      },
      normalizeIntegrations(payload) {
        const value = payload || {};
        return {
          instances: Array.isArray(value.instances) ? value.instances : [],
          installations: Array.isArray(value.installations) ? value.installations : [],
          defaults: value.defaults && typeof value.defaults === 'object' ? value.defaults : { instanceId: null, model: null }
        };
      },
      normalizeCatalog(payload) {
        const value = payload || {};
        return {
          skills: Array.isArray(value.skills) ? value.skills : [],
          modules: Array.isArray(value.modules) ? value.modules : []
        };
      },
      async refreshIntegrations() {
        if (!this.isAdmin) return;
        try {
          this.integrations = this.normalizeIntegrations(await window.AssetAgentApi.integrations(this.app));
          this.adminAvailable = true;
          this.adminError = '';
        } catch (error) {
          this.adminError = (error && error.status === 403)
            ? tr('ui.agents.error_integrations_permission')
            : ((error && error.message) || tr('ui.agents.error_integrations_load'));
        }
      },
      async refreshCatalog() {
        try {
          this.catalog = this.normalizeCatalog(await window.AssetAgentApi.catalog(this.app));
          this.catalogError = '';
        } catch (error) {
          this.catalogError = (error && error.message) || tr('ui.agents.error_catalog_load');
        }
      },
      openWizard() {
        this.wizardOpen = true;
        this.wizardAutoOpened = true;
      },
      closeWizard() {
        this.wizardOpen = false;
      },
      async onWizardApplied() {
        await this.refreshIntegrations();
        await this.loadAgentEngines();
        this.enginePickerKey += 1;
      },
      blankInstance() {
        return Object.assign({
          id: '', name: '', engine: 'opencode', baseUrl: 'http://127.0.0.1:4096', secretRef: '', username: '', profile: '', directory: '', defaultModel: '', integrationIdentityId: '', enabled: true
        }, quotaInstanceDraft());
      },
      newInstance() {
        this.instanceEditing = true;
        this.instanceError = '';
        this.instanceDraft = this.blankInstance();
      },
      editInstance(instance) {
        if (!instance || instance.engine === 'pydantic') return;
        this.instanceEditing = true;
        this.instanceError = '';
        this.instanceDraft = Object.assign({
          id: instance.id,
          name: text(instance.name),
          engine: text(instance.engine, 'opencode'),
          baseUrl: text(instance.baseUrl),
          secretRef: text(instance.secretRef),
          username: text(instance.username),
          profile: text(instance.profile),
          directory: text(instance.directory),
          defaultModel: text(instance.defaultModel),
          integrationIdentityId: text(instance.integrationIdentityId),
          enabled: instance.enabled !== false
        }, quotaInstanceDraft(instance));
      },
      cancelInstanceEdit() {
        this.instanceEditing = false;
        this.instanceError = '';
      },
      async saveInstance() {
        if (this.instanceBusy) return false;
        this.instanceError = '';
        const draft = this.instanceDraft;
        if (!text(draft.name)) { this.instanceError = tr('ui.agents.error_instance_name'); return false; }
        if (draft.engine === 'opencode' && !isHttpUrl(draft.baseUrl)) { this.instanceError = tr('ui.agents.error_opencode_url'); return false; }
        if (this.canManageQuota) {
          const quotaError = quotaInstanceError(draft);
          if (quotaError) { this.instanceError = quotaError; return false; }
        }
        const body = {
          name: text(draft.name),
          engine: draft.engine,
          baseUrl: text(draft.baseUrl),
          secretRef: text(draft.secretRef),
          username: text(draft.username),
          profile: text(draft.profile),
          directory: text(draft.directory),
          defaultModel: text(draft.defaultModel),
          integrationIdentityId: text(draft.integrationIdentityId),
          enabled: draft.enabled !== false
        };
        Object.assign(body, quotaInstanceBody(draft, this.canManageQuota));
        this.instanceBusy = true;
        try {
          await window.AssetAgentApi.saveInstance(this.app, text(draft.id), body);
          this.instanceEditing = false;
          await this.refreshIntegrations();
          await this.loadAgentEngines();
          this.enginePickerKey += 1;
          return true;
        } catch (error) {
          this.instanceError = (error && error.message) || tr('ui.agents.error_instance_save');
          return false;
        } finally {
          this.instanceBusy = false;
        }
      },
      async toggleModule(module) {
        if (!this.canManageModules) {
          this.moduleError = tr('ui.agents.module_permission_required');
          return false;
        }
        if (!module || module.official === true || this.moduleBusyId) return false;
        this.moduleError = '';
        this.moduleBusyId = module.id;
        try {
          await window.AssetAgentApi.setModuleEnabled(this.app, module.id, module.enabled === false);
          await this.refreshCatalog();
          await this.refreshIntegrations();
          return true;
        } catch (error) {
          this.moduleError = (error && error.message) || tr('ui.agents.error_module_state');
          return false;
        } finally {
          this.moduleBusyId = '';
        }
      },
      lifecycleBody(operation, record) {
        // The control service resolves the persisted MCP binding and env
        // reference for lifecycle operations; do not resend secrets or skills.
        const target = record.target || {};
        return {
          instanceId: record.instanceId,
          target: {
            engine: target.engine,
            path: target.path,
            profile: target.profile,
            version: target.version
          },
          operation
        };
      },
      async applyOperation(payload) {
        if (!payload || !payload.record || this.operationBusy) return false;
        const record = payload.record;
        const operation = payload.operation;
        this.operationError = '';
        this.operationResult = null;
        this.operationBusy = record.id + ':' + operation;
        try {
          this.operationResult = await window.AssetAgentApi.apply(this.app, this.lifecycleBody(operation, record));
          await this.refreshIntegrations();
          return true;
        } catch (error) {
          this.operationError = (error && error.message) || tr('ui.agents.error_operation');
          return false;
        } finally {
          this.operationBusy = '';
        }
      },
      async importReceipt(payload) {
        if (!payload || !payload.record || this.operationBusy) return false;
        const record = payload.record;
        const requestDigest = text(record.requestDigest);
        if (!requestDigest) {
          this.operationError = tr('ui.agents.error_receipt_digest');
          return false;
        }
        this.operationError = '';
        this.operationResult = null;
        this.operationBusy = record.id + ':receipt';
        try {
          const updated = await window.AssetAgentApi.importReceipt(this.app, {
            instanceId: record.instanceId,
            requestDigest,
            receipt: payload.receipt
          });
          this.operationResult = updated || null;
          await this.refreshIntegrations();
          return true;
        } catch (error) {
          this.operationError = (error && error.message) || tr('ui.agents.error_receipt_rejected');
          return false;
        } finally {
          this.operationBusy = '';
        }
      }
    },
    template: `
      <section class="config-section agent-ia" aria-labelledby="agent-ia-title">
        <header class="config-section__head">
          <div>
            <p class="eyebrow">{{ $t('ui.agents.settings_eyebrow') }}</p>
            <h2 id="agent-ia-title">{{ $t('ui.agents.settings_title') }}</h2>

          </div>
          <span class="config-badge"><app-icon name="layers"></app-icon> {{ $t('ui.agents.settings_badge') }}</span>
        </header>
        <p v-if="loading" class="agent-note" role="status">{{ $t('ui.agents.settings_loading') }}</p>
        <p v-if="loadError" class="agent-note agent-note--error" role="alert">{{ loadError }}</p>
        <agent-engine-picker :key="enginePickerKey" :app="app" :heading="$t('ui.agents.engine_picker_heading')"></agent-engine-picker>
        <agent-providers-panel :app="app" @changed="onProvidersChanged"></agent-providers-panel>

        <template v-if="canManageQuota">
          <section class="agent-panel agent-quota-admin" aria-labelledby="quota-policy-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="quota-policy-title" class="agent-panel__title">{{ $t('ui.agents.quota_admin_title') }}</h3>
                <p class="agent-panel__sub">{{ $t('ui.agents.quota_admin_lead') }}</p>
              </div>
              <button type="button" class="btn btn--ghost btn--small" :disabled="quotaPolicyLoading || quotaPolicyBusy" @click="loadQuotaPolicy">{{ quotaPolicyLoading ? $t('ui.agents.quota_refreshing') : $t('ui.agents.quota_refresh') }}</button>
            </header>
            <p v-if="quotaPolicyLoading" class="agent-note" role="status">{{ $t('ui.agents.quota_policy_loading') }}</p>
            <p v-if="quotaPolicyError" class="agent-note agent-note--error" role="alert">{{ quotaPolicyError }}</p>
            <p v-if="quotaPolicyNotice" class="agent-note" role="status">{{ quotaPolicyNotice }}</p>
            <p v-if="quotaPolicy && !quotaPolicy.available" class="agent-note agent-note--warn">{{ $t('ui.agents.quota_policy_unavailable') }}</p>
            <form v-if="quotaPolicy && quotaPolicy.available" class="agent-quota-form" @submit.prevent="saveQuotaPolicy">
              <fieldset class="agent-quota-fieldset">
                <legend>{{ $t('ui.agents.quota_company_legend') }}</legend>
                <label class="agent-check"><input v-model="quotaDraft.companyMode" type="radio" value="limited" :disabled="quotaPolicyBusy"> {{ $t('ui.agents.quota_mode_limited') }}</label>
                <label class="agent-check"><input v-model="quotaDraft.companyMode" type="radio" value="unlimited" :disabled="quotaPolicyBusy"> {{ $t('ui.agents.quota_mode_unlimited') }}</label>
                <div class="field">
                  <label class="field__label" for="quota-company-limit">{{ $t('ui.agents.quota_tokens_per_day') }}</label>
                  <input id="quota-company-limit" v-model="quotaDraft.companyLimit" type="number" min="0" step="1" inputmode="numeric" class="input-shell" :disabled="quotaPolicyBusy || quotaDraft.companyMode !== 'limited'" aria-describedby="quota-company-help">
                  <p id="quota-company-help" class="field__hint">{{ $t('ui.agents.quota_company_help', { value: quotaLimitText(quotaPolicy.companyDailyLimit, quotaPolicy.companyKnown), source: quotaLimitSourceLabel(quotaPolicy.companyLimitSource) }) }}</p>
                </div>
              </fieldset>
              <div class="field">
                <label class="field__label" for="quota-timezone">{{ $t('ui.agents.quota_timezone') }}</label>
                <input id="quota-timezone" v-model="quotaDraft.timezone" type="text" class="input-shell" :disabled="quotaPolicyBusy" aria-describedby="quota-timezone-help" placeholder="America/Mexico_City" autocomplete="off" spellcheck="false">
                <p id="quota-timezone-help" class="field__hint">{{ $t('ui.agents.quota_timezone_help', { timezone: quotaPolicy.timezone || $t('ui.agents.quota_unreported_f') }) }}<template v-if="quotaPolicy.pendingTimezone">{{ $t('ui.agents.quota_timezone_pending', { timezone: quotaPolicy.pendingTimezone, day: quotaPolicy.pendingEffectiveDay || $t('ui.agents.quota_next_safe_day') }) }}</template><template v-else>{{ $t('ui.agents.quota_timezone_applies') }}</template></p>
              </div>
              <div class="agent-provider-actions">
                <button type="submit" class="btn btn--primary" :disabled="quotaAdminMutationBusy">{{ quotaPolicyBusy ? $t('ui.common.saving') : $t('ui.agents.quota_save_policy') }}</button>
                <button v-if="quotaPolicy.pendingTimezone" type="button" class="btn btn--secondary" :disabled="quotaAdminMutationBusy" @click="cancelQuotaTimezoneChange">{{ $t('ui.agents.quota_cancel_timezone') }}</button>
              </div>
            </form>

            <section class="agent-quota-block" aria-labelledby="quota-overrides-title">
              <h4 id="quota-overrides-title">{{ $t('ui.agents.quota_overrides_title') }}</h4>
              <p class="agent-panel__sub">{{ $t('ui.agents.quota_overrides_lead') }}</p>
              <div class="agent-quota-form">
                <div class="field">
                  <label class="field__label" for="quota-override-user">{{ $t('ui.agents.quota_user_real') }}</label>
                  <select v-if="canBrowseQuotaUsers && quotaUserOptions.length" id="quota-override-user" v-model="quotaOverrideUser" class="input-shell" :disabled="quotaOverrideBusy" @change="onQuotaOverrideTargetChanged">
                    <option v-for="user in quotaUserOptions" :key="user.id" :value="user.id">{{ user.label }}</option>
                  </select>
                  <template v-else>
                    <input id="quota-override-user" v-model="quotaOverrideUser" type="text" class="input-shell" :disabled="quotaOverrideBusy" aria-describedby="quota-override-user-help" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off" spellcheck="false">
                    <p id="quota-override-user-help" class="field__hint">{{ $t('ui.agents.quota_user_uuid_hint') }}</p>
                  </template>
                </div>
                <fieldset class="agent-quota-fieldset">
                  <legend>{{ $t('ui.agents.quota_override_legend') }}</legend>
                  <label class="agent-check"><input v-model="quotaOverrideMode" type="radio" value="inherit" :disabled="quotaOverrideBusy"> {{ $t('ui.agents.quota_override_inherit_option') }}</label>
                  <label class="agent-check"><input v-model="quotaOverrideMode" type="radio" value="unlimited" :disabled="quotaOverrideBusy"> {{ $t('ui.agents.quota_override_unlimited_option') }}</label>
                  <label class="agent-check"><input v-model="quotaOverrideMode" type="radio" value="limited" :disabled="quotaOverrideBusy"> {{ $t('ui.agents.quota_mode_limited') }}</label>
                  <div class="field">
                    <label class="field__label" for="quota-override-limit">{{ $t('ui.agents.quota_tokens_per_day') }}</label>
                    <input id="quota-override-limit" v-model="quotaOverrideLimit" type="number" min="0" step="1" inputmode="numeric" class="input-shell" :disabled="quotaOverrideBusy || quotaOverrideMode !== 'limited'" aria-describedby="quota-override-limit-help">
                    <p id="quota-override-limit-help" class="field__hint">{{ $t('ui.agents.quota_override_limit_help') }}</p>
                  </div>
                </fieldset>
                <p class="agent-skill__meta">{{ $t('ui.agents.quota_override_current', { value: quotaOverrideLimitText(quotaOverrideRecord) }) }}</p>
                <p v-if="quotaOverrideError" class="agent-note agent-note--error" role="alert">{{ quotaOverrideError }}</p>
                <p v-if="quotaOverrideNotice" class="agent-note" role="status">{{ quotaOverrideNotice }}</p>
                <div class="agent-provider-actions">
                  <button type="button" class="btn btn--primary" :disabled="quotaAdminMutationBusy" @click="saveQuotaOverride">{{ quotaOverrideMode === 'inherit' ? $t('ui.agents.quota_remove_and_inherit') : $t('ui.agents.quota_save_override') }}</button>
                </div>
              </div>
              <ul v-if="quotaOverrides.length" class="agent-quota-overrides">
                <li v-for="record in quotaOverrides" :key="record.userId + '|' + record.scope" class="agent-quota-override">
                  <div>
                    <strong>{{ quotaUserName(record.userId) }}</strong>
                    <span class="agent-tag">{{ quotaFundingLabel(record.scope) }}</span>
                    <p class="agent-skill__meta">{{ $t('ui.agents.quota_value', { value: quotaOverrideLimitText(record) }) }}<template v-if="record.updatedAt">{{ $t('ui.agents.quota_updated', { date: record.updatedAt }) }}</template></p>
                  </div>
                  <div class="agent-installation__actions">
                    <template v-if="quotaPendingRemove === record.userId + '|' + record.scope">
                      <button type="button" class="btn btn--danger btn--small" :disabled="quotaAdminMutationBusy" @click="confirmRemoveQuotaOverride(record)">{{ $t('ui.agents.quota_confirm_inherit') }}</button>
                      <button type="button" class="btn btn--ghost btn--small" :disabled="quotaAdminMutationBusy" @click="cancelRemoveQuotaOverride">{{ $t('ui.common.cancel') }}</button>
                    </template>
                    <button v-else type="button" class="btn btn--ghost btn--small" :disabled="quotaAdminMutationBusy" @click="requestRemoveQuotaOverride(record)">{{ $t('ui.agents.quota_remove_override') }}</button>
                  </div>
                </li>
              </ul>
              <p v-else class="agent-note">{{ $t('ui.agents.quota_no_overrides') }}</p>
            </section>

            <section class="agent-quota-block" aria-labelledby="quota-report-title">
              <h4 id="quota-report-title">{{ $t('ui.agents.report_title') }}</h4>
              <p class="agent-panel__sub">{{ $t('ui.agents.report_lead') }}</p>
              <form class="agent-quota-filters" @submit.prevent="loadQuotaReport">
                <div class="field">
                  <label class="field__label" for="quota-report-user">{{ $t('ui.agents.quota_dim_user') }}</label>
                  <select v-if="canBrowseQuotaUsers && quotaUserOptions.length" id="quota-report-user" v-model="quotaReportFilters.userId" class="input-shell">
                    <option value="">{{ $t('ui.agents.report_all') }}</option>
                    <option v-for="user in quotaUserOptions" :key="user.id" :value="user.id">{{ user.label }}</option>
                  </select>
                  <input v-else id="quota-report-user" v-model="quotaReportFilters.userId" type="text" class="input-shell" :placeholder="$t('ui.agents.report_user_placeholder')" autocomplete="off" spellcheck="false">
                </div>
                <div class="field">
                  <label class="field__label" for="quota-report-provider">{{ $t('ui.agents.source_provider') }}</label>
                  <input id="quota-report-provider" v-model="quotaReportFilters.providerId" type="text" class="input-shell" autocomplete="off">
                </div>
                <div class="field">
                  <label class="field__label" for="quota-report-model">{{ $t('ui.agents.quota_dim_model') }}</label>
                  <input id="quota-report-model" v-model="quotaReportFilters.model" type="text" class="input-shell" autocomplete="off">
                </div>
                <div class="field">
                  <label class="field__label" for="quota-report-engine">{{ $t('ui.agents.engine') }}</label>
                  <input id="quota-report-engine" v-model="quotaReportFilters.engine" type="text" class="input-shell" autocomplete="off">
                </div>
                <div class="field">
                  <label class="field__label" for="quota-report-funding">{{ $t('ui.agents.quota_dim_funding') }}</label>
                  <select id="quota-report-funding" v-model="quotaReportFilters.funding" class="input-shell">
                    <option value="">{{ $t('ui.agents.report_all') }}</option>
                    <option value="company">{{ $t('ui.agents.funding_company') }}</option>
                    <option value="personal">{{ $t('ui.agents.funding_personal') }}</option>
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="quota-report-from">{{ $t('ui.agents.report_from') }}</label>
                  <input id="quota-report-from" v-model="quotaReportFilters.dayFrom" type="date" class="input-shell">
                </div>
                <div class="field">
                  <label class="field__label" for="quota-report-to">{{ $t('ui.agents.report_to') }}</label>
                  <input id="quota-report-to" v-model="quotaReportFilters.dayTo" type="date" class="input-shell">
                </div>
                <label class="agent-check"><input v-model="quotaReportIncludeLegacy" type="checkbox"> {{ $t('ui.agents.report_include_legacy') }}</label>
                <div class="agent-provider-actions">
                  <button type="submit" class="btn btn--primary" :disabled="quotaReportLoading">{{ quotaReportLoading ? $t('ui.agents.quota_refreshing') : $t('ui.agents.report_consult') }}</button>
                </div>
              </form>
              <p v-if="quotaReportError" class="agent-note agent-note--error" role="alert">{{ quotaReportError }}</p>
              <template v-if="quotaReport">
                <p class="agent-skill__meta">{{ $t('ui.agents.report_meta', { timezone: quotaReport.timezone || $t('ui.agents.quota_unreported_f'), generated: quotaReport.generatedAt || $t('ui.agents.not_reported'), grouping: quotaReportGroupByLabel || $t('ui.agents.quota_unreported_f') }) }}</p>
                <dl class="agent-quota-totals">
                  <div><dt>{{ $t('ui.agents.state_settled') }}</dt><dd>{{ quotaTokenText(quotaReport.totals.settledTokens) }}</dd></div>
                  <div><dt>{{ $t('ui.agents.report_totals_reserved') }}</dt><dd>{{ quotaTokenText(quotaReport.totals.reservedTokens) }}</dd></div>
                  <div><dt>{{ $t('ui.agents.quota_pending_title') }}</dt><dd>{{ $t('ui.agents.report_pending_detail', { pending: quotaTokenText(quotaReport.totals.pendingCount), unresolved: quotaTokenText(quotaReport.totals.unresolvedCount) }) }}</dd></div>
                  <div><dt>{{ $t('ui.agents.state_released') }}</dt><dd>{{ $t('ui.agents.report_released_detail', { released: quotaTokenText(quotaReport.totals.releasedCount), receipts: quotaTokenText(quotaReport.totals.receiptCount) }) }}</dd></div>
                  <div><dt>{{ $t('ui.agents.state_legacy') }}</dt><dd>{{ quotaTokenText(quotaReport.totals.legacyTokens) }}</dd></div>
                  <div><dt>{{ $t('ui.agents.report_totals_precision') }}</dt><dd>{{ $t('ui.agents.precision_summary', { measured: quotaTokenText(quotaReport.precision.measured), estimated: quotaTokenText(quotaReport.precision.estimated), unavailable: quotaTokenText(quotaReport.precision.unavailable) }) }}</dd></div>
                </dl>
                <p class="agent-skill__meta">{{ $t('ui.agents.report_reserved_note') }}</p>
                <div v-if="quotaReport.items.length" class="agent-quota-table-wrap">
                  <table class="agent-quota-table">
                    <caption class="agent-skill__meta">{{ $t('ui.agents.report_caption') }}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{{ $t('ui.agents.quota_dim_day') }}</th><th scope="col">{{ $t('ui.agents.quota_dim_user') }}</th><th scope="col">{{ $t('ui.agents.source_provider') }}</th><th scope="col">{{ $t('ui.agents.quota_dim_model') }}</th><th scope="col">{{ $t('ui.agents.engine') }}</th><th scope="col">{{ $t('ui.agents.quota_dim_funding') }}</th><th scope="col">{{ $t('ui.agents.report_col_precision_source') }}</th><th scope="col">{{ $t('ui.agents.report_col_state') }}</th><th scope="col">{{ $t('ui.agents.state_settled') }}</th><th scope="col">{{ $t('ui.agents.report_totals_reserved') }}</th><th scope="col">{{ $t('ui.agents.report_col_pending') }}</th><th scope="col">{{ $t('ui.agents.report_col_input') }}</th><th scope="col">{{ $t('ui.agents.report_col_output') }}</th><th scope="col">{{ $t('ui.agents.report_col_cache_read') }}</th><th scope="col">{{ $t('ui.agents.report_col_cache_write') }}</th><th scope="col">{{ $t('ui.agents.report_col_reasoning') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, index) in quotaReport.items" :key="index">
                        <td>{{ row.day || $t('ui.agents.not_available') }}</td>
                        <td>{{ quotaUserName(row.userId) }}</td>
                        <td>{{ quotaRowProvider(row) }}</td>
                        <td>{{ quotaRowModel(row) }}</td>
                        <td>{{ quotaRowEngine(row) }}</td>
                        <td>{{ quotaFundingLabel(row.funding) }}</td>
                        <td>{{ quotaRowPrecision(row) }}</td>
                        <td>{{ quotaRowState(row) }}</td>
                        <td>{{ quotaTokenText(row.settledTokens) }}</td>
                        <td>{{ quotaTokenText(row.reservedTokens) }}</td>
                        <td>{{ quotaTokenText(row.pendingCount) }} / {{ quotaTokenText(row.unresolvedCount) }}</td>
                        <td>{{ quotaTokenText(row.inputTokens) }}</td>
                        <td>{{ quotaTokenText(row.outputTokens) }}</td>
                        <td>{{ quotaTokenText(row.cacheReadTokens) }}</td>
                        <td>{{ quotaTokenText(row.cacheWriteTokens) }}</td>
                        <td>{{ quotaTokenText(row.reasoningTokens) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p v-else class="agent-note">{{ $t('ui.agents.report_no_rows') }}</p>
              </template>
            </section>

            <section class="agent-quota-block" aria-labelledby="quota-pending-title">
              <h4 id="quota-pending-title">{{ $t('ui.agents.quota_pending_title') }}</h4>
              <p class="agent-panel__sub">{{ $t('ui.agents.quota_pending_lead') }}</p>
              <div class="agent-provider-actions">
                <button type="button" class="btn btn--secondary btn--small" :disabled="quotaPendingLoading" @click="loadQuotaPending">{{ quotaPendingLoading ? $t('ui.agents.quota_refreshing') : $t('ui.agents.quota_pending_consult') }}</button>
              </div>
              <p v-if="quotaPendingError" class="agent-note agent-note--error" role="alert">{{ quotaPendingError }}</p>
              <ul v-if="quotaPending && quotaPending.length" class="agent-quota-overrides">
                <li v-for="hold in quotaPending" :key="hold.reservationId" class="agent-quota-override">
                  <div>
                    <strong class="mono">{{ hold.reservationId }}</strong>
                    <span class="agent-tag">{{ quotaStateLabel(hold.state) }}</span>
                    <p class="agent-skill__meta">{{ $t('ui.agents.quota_pending_run', { run: hold.runId || $t('ui.agents.quota_unreported_f'), user: quotaUserName(hold.userId), funding: quotaFundingLabel(hold.funding), provider: quotaRowProvider(hold) }) }}</p>
                    <p class="agent-skill__meta">{{ $t('ui.agents.quota_pending_reserved', { value: quotaTokenText(hold.reservedTokens), day: hold.periodDay || $t('ui.agents.not_reported'), timezone: hold.timezone || $t('ui.agents.quota_unreported_f'), created: hold.createdAt || $t('ui.agents.quota_pending_created_unknown') }) }}</p>
                  </div>
                </li>
              </ul>
              <p v-else-if="quotaPending" class="agent-note">{{ $t('ui.agents.quota_pending_none') }}</p>
            </section>
          </section>
        </template>

        <p v-if="!isAdmin" class="agent-note">{{ $t('ui.agents.admin_permission_note') }}</p>
        <p v-else-if="adminError" class="agent-note agent-note--error" role="alert">{{ adminError }}</p>

        <template v-if="isAdmin && adminAvailable">
          <section class="agent-panel" aria-labelledby="agent-instances-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="agent-instances-title" class="agent-panel__title">{{ $t('ui.agents.instances_title') }}</h3>
                <p class="agent-panel__sub">{{ $t('ui.agents.instances_lead') }}</p>
                <p class="agent-skill__meta">{{ $t('ui.agents.instances_default', { value: defaultLabel }) }}</p>
              </div>
              <button type="button" class="btn btn--primary btn--small" @click="newInstance"><app-icon name="plus"></app-icon> {{ $t('ui.agents.wizard_new_instance') }}</button>
            </header>
            <p v-if="!adminInstances.length" class="agent-note">{{ $t('ui.agents.no_instances') }}</p>
            <ul v-else class="agent-instance-list">
              <li v-for="instance in adminInstances" :key="instance.id" class="agent-instance">
                <div>
                  <strong>{{ instance.name }}</strong>
                  <span class="agent-tag">{{ engineLabel(instance.engine) }}</span>
                  <span class="status-pill" :class="instance.enabled === false ? 'status--hold' : 'status--ok'">{{ instance.enabled === false ? $t('ui.agents.instance_disabled_state') : $t('ui.agents.instance_enabled_state') }}</span>
                </div>
                <p class="agent-skill__meta">{{ instance.baseUrl || $t('ui.agents.instance_internal') }}</p>
                <p class="agent-skill__meta">{{ $t('ui.agents.instance_profile_secret', { profile: instance.profile || $t('ui.agents.instance_no_profile'), secret: instance.secretConfigured ? $t('ui.agents.instance_secret_configured') : (instance.secretRef || $t('ui.agents.instance_secret_no_reference')) }) }}</p>
                <p v-if="instance.integrationIdentityId" class="agent-skill__meta mono">{{ $t('ui.agents.instance_identity', { id: instance.integrationIdentityId }) }}</p>
                <p class="agent-skill__meta">{{ $t('ui.agents.instance_engine_quota', { mode: quotaEngineStatus(instance).modeLabel, enforcement: quotaEngineStatus(instance).enforcementLabel }) }}<template v-if="quotaEngineStatus(instance).directException">{{ $t('ui.agents.instance_direct_exception') }}</template></p>
                <p class="agent-skill__meta">{{ $t('ui.agents.instance_reason', { reason: quotaEngineStatus(instance).reason || $t('ui.agents.instance_reason_unknown') }) }}</p>
                <p v-if="quotaEngineStatus(instance).strict" class="agent-skill__meta">{{ $t('ui.agents.instance_strict_note') }}</p>
                <p v-if="quotaEngineStatus(instance).mode === 'direct'" class="agent-skill__meta">{{ $t('ui.agents.instance_direct_note', { exception: quotaEngineStatus(instance).directException ? $t('ui.agents.instance_direct_exception_declared') : $t('ui.agents.instance_direct_exception_none') }) }}</p>
                <div v-if="instance.engine !== 'pydantic'" class="agent-installation__actions">
                  <button type="button" class="btn btn--ghost btn--small" @click="editInstance(instance)">{{ $t('ui.agents.provider_edit') }}</button>
                </div>
              </li>
            </ul>
            <agent-instance-editor v-if="instanceEditing" :app="app" :draft="instanceDraft" :identities="identities" :busy="instanceBusy" :error="instanceError" :can-manage-quota="canManageQuota" @save="saveInstance" @cancel="cancelInstanceEdit"></agent-instance-editor>
          </section>

          <div class="agent-panel__actions">
            <button type="button" class="btn btn--secondary btn--small" @click="openWizard"><app-icon name="layers"></app-icon> {{ $t('ui.agents.open_wizard') }}</button>
          </div>
          <agent-integration-wizard v-if="wizardOpen" :app="app" :instances="adminInstances" :catalog="catalog" :identities="identities" :can-manage-quota="canManageQuota" @close="closeWizard" @applied="onWizardApplied"></agent-integration-wizard>

          <agent-catalog-panel :catalog="catalog" :busy-id="moduleBusyId" :error="moduleError" :can-manage="canManageModules" @toggle-module="toggleModule"></agent-catalog-panel>

          <agent-installations-panel :app="app" :installations="installations" :busy="operationBusy" :error="operationError" :result="operationResult" @operation="applyOperation" @receipt="importReceipt" @applied="onWizardApplied"></agent-installations-panel>
        </template>
      </section>
    `
  };

  window.AssetAgentViews = {
    routeOverride,
    AgentEnginePicker: enginePicker,
    AgentInstanceEditor: instanceEditor,
    AgentCatalogPanel: catalogPanel,
    AgentInstallationsPanel: installationsPanel,
    AgentIntegrationWizard: wizard,
    AgentProvidersPanel: providersPanel,
    AgentIntegrationsSettings: settings,
    engineLabel,
    installationStatusLabel
  };
})();
