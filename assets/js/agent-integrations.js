/* Engine selection, shared model catalog and integration administration.
 *
 * Provider URLs, credentials and installation authority stay on the server.
 * The browser selects an offered instance/model, streams a session and renders
 * the installer receipt exactly as reported; a verified flag is never inferred.
 */
(function () {
  'use strict';

  const ENGINE_LABELS = {
    pydantic: 'Pydantic AI',
    opencode: 'OpenCode',
    hermes: 'Hermes'
  };

  const CAPABILITY_LABELS = {
    streaming: 'Respuesta progresiva',
    cancel: 'Interrupción',
    tools: 'Herramientas',
    usage: 'Consumo de tokens',
    sessions: 'Sesiones',
    models: 'Modelos dinámicos'
  };

  const OPERATIONS = [
    { id: 'install', label: 'Instalar' },
    { id: 'verify', label: 'Verificar' },
    { id: 'update', label: 'Actualizar' },
    { id: 'repair', label: 'Reparar' },
    { id: 'disable', label: 'Deshabilitar' },
    { id: 'uninstall', label: 'Desinstalar' }
  ];

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
    return number(value).toLocaleString('es-ES');
  }

  // Daily AI quota contract: /api/v1/agent/usage. A missing field is
  // unavailable, never zero; an explicit null limit is unlimited and zero
  // denies new admissions. The browser renders those distinctions and never
  // recomputes totals the server already produced.
  const QUOTA_BASE = '/agent/usage';
  const QUOTA_FUNDING_LABELS = { company: 'Empresa', personal: 'Personal' };
  const QUOTA_LIMIT_SOURCE_LABELS = { override: 'Excepción del usuario', policy: 'Política del servidor', default: 'Valor predeterminado', legacy_config: 'Configuración heredada', record_only: 'Solo registro', not_applicable: 'No aplica' };
  const PROVIDER_CREDENTIAL_LABELS = {
    missing: 'Sin credencial configurada',
    primary: 'Credencial configurada',
    older: 'Credencial guardada con una clave de cifrado anterior; se volverá a cifrar al rotar',
    unreadable: 'Credencial ilegible con las claves de cifrado actuales; vuelve a introducirla',
    unavailable: 'Credencial guardada, pero el servidor no tiene claves de cifrado configuradas'
  };
  const PROVIDER_CHECK_LABELS = {
    unauthorized: 'El proveedor rechazó la credencial.',
    unreachable: 'No se pudo conectar con el endpoint.',
    blocked_address: 'El endpoint apunta a una dirección que este despliegue no autoriza.',
    redirect: 'El endpoint respondió con una redirección; no se siguen redirecciones.',
    invalid_response: 'El endpoint no respondió como un servicio compatible con OpenAI.',
    credential_unavailable: 'No se pudo leer la credencial guardada.',
    timeout: 'El endpoint no respondió a tiempo.',
    request_failed: 'No se pudo solicitar la comprobación.'
  };
  const QUOTA_PRECISION_LABELS = { measured: 'Medido', estimated: 'Estimado', unavailable: 'No disponible' };
  const QUOTA_SOURCE_LABELS = { provider: 'Proveedor', engine: 'Motor', estimate: 'Estimación', none: 'Sin fuente', legacy: 'Legado' };
  const QUOTA_STATE_LABELS = { settled: 'Liquidado', unresolved: 'Sin resolver', pending: 'Pendiente', released: 'Liberado', legacy: 'Legado sin atribuir' };
  const QUOTA_ENGINE_MODES = { managed: 'Gestionado por el gateway', direct: 'Directo', builtin: 'Integrado' };
  const QUOTA_ENGINE_ENFORCEMENTS = { strict: 'Estricta antes de enviar', admission_only: 'Solo admisión', observed: 'Solo observada', unavailable: 'No disponible' };
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
    return ENGINE_LABELS[value] || text(value, 'Motor');
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
    return model && model.free === true ? name + ' · Gratis' : name;
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
      return 'Selecciona un proveedor global habilitado para el modo gestionado.';
    }
    if (!text(draft.defaultModel)) {
      return 'Indica el modelo predeterminado del proveedor gestionado.';
    }
    if (quotaPositiveInteger(draft.managedContextTokens) === null) {
      return 'El contexto gestionado debe ser un entero positivo de tokens.';
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
    if (!record) return 'Sin datos';
    if (record.verified === true) return 'Verificado';
    const status = text(record.status);
    if (status === 'configured') return 'Configurado, sin verificación';
    if (status === 'exported') return 'Solicitud exportada, sin instalar';
    if (status === 'conflict') return 'Conflicto';
    if (status === 'failed') return 'Fallido';
    return status ? 'Estado: ' + status : 'Sin verificación del servidor';
  }

  function checkText(check) {
    if (typeof check === 'string') return check;
    if (check && typeof check === 'object') {
      const label = text(check.label, text(check.name, text(check.check, 'Comprobación')));
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
          return 'La instancia seleccionada usa tu propia clave: el consumo se registra, pero no se descuenta ni se limita con el presupuesto de la empresa.';
        }
        if (this.quotaSelectedFunding === 'company') {
          return 'La instancia seleccionada usa financiación de la empresa.';
        }
        return 'El servidor no informó la financiación de esta instancia; el saldo no se atribuye ni a la empresa ni a la cuenta personal.';
      },
      quotaAccounts() {
        return [
          { scope: 'company', label: QUOTA_FUNDING_LABELS.company, balance: this.quotaCompany, selected: this.quotaSelectedFunding === 'company' },
          { scope: 'personal', label: QUOTA_FUNDING_LABELS.personal, balance: this.quotaPersonal, selected: this.quotaSelectedFunding === 'personal' }
        ];
      }
    },
    methods: {
      quotaTokenText(value) {
        const parsed = quotaToken(value);
        return parsed === null ? 'No disponible' : formatTokens(parsed);
      },
      quotaAmountText(value) {
        const parsed = quotaToken(value);
        return parsed === null ? 'No disponible' : formatTokens(parsed) + ' tokens';
      },
      quotaFundingLabel(scope) { return QUOTA_FUNDING_LABELS[scope] || 'Sin atribuir'; },
      quotaLimitSourceLabel(source) { return QUOTA_LIMIT_SOURCE_LABELS[source] || 'Origen no informado'; },
      quotaLimitText(balance) {
        if (!balance) return 'No disponible';
        if (balance.recordOnly) return 'Sin límite diario';
        if (balance.unlimited) return 'Ilimitado';
        return formatTokens(balance.limit) + ' tokens' + (balance.limit === 0 ? ' · sin admisión' : '');
      },
      quotaAvailableText(balance) {
        if (!balance) return 'No disponible';
        if (balance.recordOnly) return 'No aplica: se usa tu propia clave';
        if (balance.unlimited) return 'Ilimitado';
        if (!balance.availableKnown || balance.available === null) return 'No disponible';
        return formatTokens(balance.available) + ' tokens';
      },
      quotaPrecisionText(balance) {
        if (!balance) return 'No disponible';
        const precision = balance.precision || {};
        return 'medido ' + this.quotaTokenText(precision.measured) +
          ' · estimado ' + this.quotaTokenText(precision.estimated) +
          ' · no disponible ' + this.quotaTokenText(precision.unavailable);
      },
      quotaEngineStatus(instance) {
        const quota = instance && instance.quota && typeof instance.quota === 'object' && !Array.isArray(instance.quota) ? instance.quota : null;
        if (!quota) {
          return {
            known: false,
            mode: '',
            modeLabel: 'No informado',
            enforcement: 'unavailable',
            enforcementLabel: QUOTA_ENGINE_ENFORCEMENTS.unavailable,
            reason: 'El servidor no informó el estado de cuota de este motor; se trata como no estricta.',
            directException: false,
            strict: false
          };
        }
        const mode = QUOTA_ENGINE_MODES[quota.mode] ? quota.mode : '';
        const enforcement = QUOTA_ENGINE_ENFORCEMENTS[quota.enforcement] ? quota.enforcement : 'unavailable';
        return {
          known: true,
          mode,
          modeLabel: mode ? QUOTA_ENGINE_MODES[mode] : 'No informado',
          enforcement,
          enforcementLabel: QUOTA_ENGINE_ENFORCEMENTS[enforcement],
          reason: text(quota.reason),
          directException: quota.directException === true,
          strict: mode === 'managed' && enforcement === 'strict'
        };
      },
      quotaPrecisionLabel(value) { return QUOTA_PRECISION_LABELS[value] || 'No disponible'; },
      quotaSourceLabel(value) { return QUOTA_SOURCE_LABELS[value] || 'Sin fuente'; },
      quotaStateLabel(value) { return QUOTA_STATE_LABELS[value] || 'Sin clasificar'; },
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
            this.quotaError = 'La sesión expiró; vuelve a iniciar sesión para ver tu cuota.';
          } else {
            this.quotaError = (error && (error.serverMessage || error.message)) || 'No se pudo consultar tu consumo de IA.';
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
          .map(key => ({ key, label: CAPABILITY_LABELS[key] || key }));
      },
      agentBudgetSummary() {
        if (!this.agentBudget) return '';
        const parts = [];
        if (this.agentBudget.dailyLimit !== null && this.agentBudget.dailyLimit !== undefined) {
          parts.push('Límite diario: ' + formatTokens(this.agentBudget.dailyLimit) + ' tokens');
        }
        parts.push('Consumo medido: ' + formatTokens(this.agentBudget.usedMeasured) + ' tokens');
        parts.push('Consumo informado por motores externos: ' + formatTokens(this.agentBudget.usedReported) + ' tokens');
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
          this.agentSelectionNotice = available ? '' : 'El motor o el modelo de esta conversación ya no está disponible. Elige otro motor o modelo para continuar.';
          return;
        }

        const selectable = instances.filter(instance => instance.enabled !== false);
        let instance = selectable.find(item => item.id === saved.instanceId) || null;
        let notice = '';
        if (!instance && selectable.length) {
          instance = selectable[0];
          if (saved.instanceId) notice = 'La instancia guardada ya no está disponible. Se seleccionó ' + text(instance.name, instance.id) + '.';
        }
        let model = saved.model;
        if (instance) {
          const models = Array.isArray(instance.models) ? instance.models.filter(item => item && typeof item.id === 'string') : [];
          if (!models.some(item => item.id === model)) {
            const fallback = defaultModelFor(instance);
            if (saved.model) {
              const fallbackLabel = models.find(item => item.id === fallback);
              notice = 'El modelo guardado ya no está disponible en ' + text(instance.name, instance.id) + '.' +
                (fallback ? ' Se seleccionó ' + modelLabel(fallbackLabel || { id: fallback }) + '.' : '');
            }
            model = fallback;
          }
        } else {
          model = '';
        }
        this.agentPreference = { instanceId: instance ? instance.id : '', model };
        this.agentPreferenceSaved = saved;
        this.agentSelectionNotice = notice ? notice + ' La preferencia se actualizará en el servidor.' : '';
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
            : (error && (error.serverMessage || error.message)) || 'No se pudieron consultar los motores del servidor.';
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
          this.agentSelectionNotice = (error && (error.serverMessage || error.message)) || 'No se pudo guardar la preferencia en el servidor.';
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
      heading: { type: String, default: 'Motor y modelo' },
      showBudget: { type: Boolean, default: true }
    },
    data() {
      return { disposed: false };
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
          <h2 :id="'agent-engine-title'" class="agent-engine__title">{{ heading }}</h2>
          <span v-if="agentEnginesLoading" class="agent-engine__meta" role="status">Consultando motores…</span>
        </header>
        <p v-if="agentEnginesError" class="agent-note agent-note--error" role="alert">{{ agentEnginesError }}</p>
        <div v-if="agentEnginesLoaded && agentInstanceList.length" class="agent-engine__grid">
          <div class="field">
            <label class="field__label" for="agent-engine-instance">Motor</label>
            <select id="agent-engine-instance" class="input-shell" :value="agentEngineValue" @change="onEngine">
              <option v-for="choice in agentEngineChoices" :key="choice.value" :value="choice.value" :disabled="choice.disabled">
                {{ choice.label }}{{ choice.disabled ? ' · Deshabilitada' : '' }}
              </option>
            </select>
          </div>
          <div v-if="agentProfileSelectorVisible" class="field">
            <label class="field__label" for="agent-engine-profile">Perfil</label>
            <select id="agent-engine-profile" class="input-shell" :value="agentPreference.instanceId" @change="onProfile">
              <option v-for="instance in agentProfileOptions" :key="instance.id" :value="instance.id" :disabled="instance.enabled === false">
                {{ agentProfileLabel(instance) }}{{ instance.enabled === false ? ' · Deshabilitada' : '' }}
              </option>
            </select>
            <p class="field__hint">El perfil elegido se usará en las conversaciones nuevas; una conversación guardada conserva su motor y modelo.</p>
          </div>
          <div class="field">
            <label class="field__label" for="agent-engine-model">Modelo</label>
            <select id="agent-engine-model" class="input-shell" :value="agentPreference.model" @change="onModel" :disabled="!agentModels.length">
              <option v-if="!agentModels.length" value="">Sin modelos anunciados</option>
              <option v-for="model in agentModels" :key="model.id" :value="model.id">{{ agentModelLabel(model) }}</option>
            </select>
            <p v-if="agentActiveInstance && !agentModels.length" class="field__hint">Los modelos disponibles los anuncia este motor; si no responde, elige otra instancia.</p>
          </div>
        </div>
        <ul v-if="agentDiscoveryErrors.length" class="agent-engine__errors" role="alert" aria-label="Errores de descubrimiento de motores">
          <li v-for="failure in agentDiscoveryErrors" :key="failure.id" class="agent-note agent-note--error">
            {{ failure.label }}: {{ failure.error }}
          </li>
        </ul>
        <p v-if="agentEnginesLoaded && !agentInstanceList.length" class="agent-note" role="status">El servidor no anunció motores configurables.</p>
        <p v-if="agentSelectionNotice" class="agent-note" role="status">{{ agentSelectionNotice }}</p>
        <div v-if="agentActiveInstance && agentCapabilityList.length" class="agent-engine__capabilities">
          <span class="agent-tag" v-for="capability in agentCapabilityList" :key="capability.key">{{ capability.label }}</span>
        </div>
        <template v-if="showBudget">
          <p v-if="agentBudgetSummary" class="agent-budget">{{ agentBudgetSummary }}</p>
          <section class="agent-quota" aria-labelledby="agent-quota-title">
            <div class="agent-quota__head">
              <h3 id="agent-quota-title" class="agent-quota__title">Tu cuota diaria de IA</h3>
              <button type="button" class="btn btn--ghost btn--small" :disabled="quotaLoading" @click="loadQuota">{{ quotaLoading ? 'Actualizando…' : 'Actualizar cuota' }}</button>
            </div>
            <p v-if="quotaLoading && !quotaLoaded" class="agent-quota__meta" role="status">Consultando tu cuota…</p>
            <p v-if="quotaError" class="agent-note agent-note--error" role="alert">{{ quotaError }}</p>
            <p v-if="quotaUnavailable" class="agent-budget agent-budget--note">El servidor no devolvió un saldo de cuota; se muestra como no disponible, no como cero.</p>
            <template v-if="quotaHasData">
              <p class="agent-quota__meta">Día {{ quotaPeriodDay || 'no informado' }} · Zona {{ quotaTimezone || 'no informada' }}<template v-if="quotaPendingTimezone"> · Cambio pendiente a {{ quotaPendingTimezone }}; se aplicará el {{ quotaPendingEffectiveDay || 'próximo día seguro' }}.</template></p>
              <dl class="agent-quota__accounts">
                <div v-for="account in quotaAccounts" :key="account.scope" class="agent-quota__account" :class="{ 'is-selected': account.selected }">
                  <dt>{{ account.label }}<span v-if="account.selected" class="agent-tag">Contexto actual</span></dt>
                  <dd v-if="account.balance">
                    <span>Límite: {{ quotaLimitText(account.balance) }} · {{ quotaLimitSourceLabel(account.balance.limitSource) }}</span>
                    <span>Consumido: {{ quotaAmountText(account.balance.consumed) }} · Retenido: {{ quotaAmountText(account.balance.reserved) }}</span>
                    <span>Disponible: {{ quotaAvailableText(account.balance) }}</span>
                    <span>Esperas pendientes: {{ quotaTokenText(account.balance.pendingCount) }} · Precisión: {{ quotaPrecisionText(account.balance) }}</span>
                    <span>Histórico sin atribuir: {{ quotaAmountText(account.balance.legacy) }}</span>
                  </dd>
                  <dd v-else>No disponible</dd>
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
          if (!payload || !Array.isArray(payload.items)) throw new Error('El servidor no devolvió la configuración de proveedores.');
          this.quotaProviders = payload.items.map(item => this.normalizeQuotaProvider(item));
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaProvider(epoch) || (error && error.name === 'AbortError')) return false;
          if (error && error.status === 401) {
            this.resetQuotaProviders();
            return false;
          }
          this.quotaProviders = [];
          this.quotaProvidersError = (error && (error.serverMessage || error.message)) || 'No se pudieron consultar los proveedores globales.';
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
            <label class="field__label" for="agent-instance-name">Nombre</label>
            <input id="agent-instance-name" class="input-shell" v-model.trim="draft.name" maxlength="80" required>
          </div>
          <div class="field">
            <label class="field__label" for="agent-instance-engine">Motor</label>
            <select id="agent-instance-engine" class="input-shell" v-model="draft.engine" :disabled="!!draft.id">
              <option value="opencode">OpenCode</option>
              <option value="hermes">Hermes</option>
              <option value="pydantic">Pydantic AI</option>
            </select>
          </div>
          <div v-if="external" class="field">
            <label class="field__label" for="agent-instance-url">URL base</label>
            <input id="agent-instance-url" class="input-shell" v-model.trim="draft.baseUrl" inputmode="url" placeholder="http://127.0.0.1:4096">
            <p class="field__hint">El servidor del ITSM es el único que usa esta dirección; el navegador no contacta al motor.</p>
          </div>
          <div v-if="external" class="field">
            <label class="field__label" for="agent-instance-secret">Nombre del secreto</label>
            <input id="agent-instance-secret" class="input-shell" v-model.trim="draft.secretRef" maxlength="120" placeholder="OPENCODE_SERVER_PASSWORD">
            <p class="field__hint">Solo se guarda la referencia a la variable de entorno. El valor nunca se envía al navegador.</p>
          </div>
          <div v-if="external" class="field">
            <label class="field__label" for="agent-instance-user">Usuario del servidor</label>
            <input id="agent-instance-user" class="input-shell" v-model.trim="draft.username" maxlength="120" autocomplete="off">
          </div>
          <div class="field">
            <label class="field__label" for="agent-instance-profile">Perfil o espacio de trabajo</label>
            <input id="agent-instance-profile" class="input-shell" v-model.trim="draft.profile" maxlength="200">
          </div>
          <div class="field">
            <label class="field__label" for="agent-instance-directory">Directorio</label>
            <input id="agent-instance-directory" class="input-shell" v-model.trim="draft.directory" maxlength="400">
          </div>
          <div class="field">
            <label class="field__label" for="agent-instance-default">Modelo predeterminado</label>
            <input id="agent-instance-default" class="input-shell" v-model.trim="draft.defaultModel" maxlength="200" :aria-describedby="canManageQuota && draft.quotaMode === 'managed' ? 'agent-instance-default-help' : null">
            <p v-if="canManageQuota && draft.quotaMode === 'managed'" id="agent-instance-default-help" class="field__hint">El modelo debe pertenecer al proveedor global seleccionado; el servidor lo valida.</p>
          </div>
          <div class="field">
            <label class="field__label" for="agent-instance-identity">Identidad de integración</label>
            <select id="agent-instance-identity" class="input-shell" v-model="draft.integrationIdentityId">
              <option value="">Sin identidad de integración</option>
              <option v-for="identity in identities" :key="identity.id" :value="identity.id">{{ identity.name || identity.username || identity.id }} · {{ identity.actorKind }}</option>
            </select>
          </div>
        </div>
        <fieldset v-if="canManageQuota" class="agent-quota-fieldset agent-instance-quota">
          <legend>Cuota y enrutamiento</legend>
          <div class="field">
            <label class="field__label" for="agent-instance-quota-mode">Modo de cuota</label>
            <select id="agent-instance-quota-mode" class="input-shell" v-model="draft.quotaMode" :disabled="busy" aria-describedby="agent-instance-quota-mode-help">
              <option value="direct">Directo observado</option>
              <option value="managed">Gestionado por el gateway de ITSM</option>
            </select>
            <p id="agent-instance-quota-mode-help" class="field__hint">Gestionado enruta por el gateway de ITSM; no demuestra por sí solo aislamiento de red ni convierte la cuota en estricta. Directo se observa y no se presenta como estricto.</p>
          </div>
          <template v-if="draft.quotaMode === 'managed'">
            <div class="field">
              <label class="field__label" for="agent-instance-quota-provider">Proveedor global</label>
              <select id="agent-instance-quota-provider" class="input-shell" v-model="draft.managedProviderId" :disabled="busy || quotaProvidersLoading" required aria-describedby="agent-instance-quota-provider-help">
                <option value="">{{ quotaProvidersLoading ? 'Consultando proveedores…' : 'Selecciona un proveedor global' }}</option>
                <option v-for="provider in quotaGlobalProviders" :key="provider.id" :value="provider.id">{{ quotaProviderOptions(provider) }}</option>
              </select>
              <p id="agent-instance-quota-provider-help" class="field__hint">Solo se ofrecen proveedores globales habilitados y permitidos por el servidor. El identificador personal no se acepta aquí.</p>
              <p v-if="quotaProvidersError" class="agent-note agent-note--error" role="alert">{{ quotaProvidersError }}</p>
              <p v-else-if="!quotaProvidersLoading && !quotaGlobalProviders.length" class="agent-note">No hay proveedores globales habilitados. El modo gestionado no se puede guardar hasta que exista uno.</p>
              <p v-else-if="!quotaProvidersLoading && !quotaSelectedProviderAvailable" class="agent-note agent-note--error" role="alert">El proveedor guardado ya no está disponible como global habilitado; selecciona otro o cambia a modo directo.</p>
            </div>
            <div class="field">
              <label class="field__label" for="agent-instance-quota-context">Límite de contexto de entrada</label>
              <input id="agent-instance-quota-context" class="input-shell" v-model.trim="draft.managedContextTokens" type="number" min="1" step="1" inputmode="numeric" :disabled="busy" required aria-describedby="agent-instance-quota-context-help">
              <p id="agent-instance-quota-context-help" class="field__hint">Entero positivo declarado por el operador dentro del contexto de entrada admitido por este modelo y proveedor. El límite de salida lo configura la instalación en el servidor. Este valor no demuestra aislamiento de red ni garantiza una cuota estricta del motor.</p>
            </div>
          </template>
          <template v-else>
            <label class="agent-check"><input id="agent-instance-quota-exception" type="checkbox" v-model="draft.directCompanyException" :disabled="busy"> Excepción explícita para ejecución directa de empresa</label>
            <p class="field__hint">Sin esta excepción, el servidor no admite trabajos de empresa por ejecución directa. La cuota directa se observa, no se aplica como límite estricto antes de enviar. El servidor decide y audita la excepción.</p>
          </template>
        </fieldset>
        <label class="agent-check"><input type="checkbox" v-model="draft.enabled"> Instancia habilitada</label>
        <p v-if="error" class="agent-note agent-note--error" role="alert">{{ error }}</p>
        <div class="agent-editor__actions">
          <button type="submit" class="btn btn--primary btn--small" :disabled="busy">{{ busy ? 'Guardando…' : 'Guardar instancia' }}</button>
          <button type="button" class="btn btn--secondary btn--small" :disabled="busy" @click="$emit('cancel')">Cancelar</button>
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
        return module.enabled === false ? 'Deshabilitado' : 'Habilitado';
      },
      toggle(module) {
        if (!module || module.official === true) return;
        this.$emit('toggle-module', module);
      },
      skillMeta(skill) {
        const parts = [];
        if (text(skill.version)) parts.push('v' + text(skill.version));
        if (text(skill.module)) parts.push(this.skillIsOfficial(skill) ? 'Oficial' : 'Módulo ' + text(skill.module));
        if (Array.isArray(skill.capabilities) && skill.capabilities.length) parts.push(skill.capabilities.join(', '));
        return parts.join(' · ');
      },
      permissionText(skill) {
        return Array.isArray(skill.permissions) && skill.permissions.length ? skill.permissions.join(', ') : 'Sin permisos declarados';
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
            <h3 id="agent-catalog-title" class="agent-panel__title">Catálogo compartido</h3>
            <p class="agent-panel__sub">Paquete oficial y módulos registrados. Deshabilitar un módulo retira sus herramientas y skills.</p>
          </div>
        </header>
        <p v-if="error" class="agent-note agent-note--error" role="alert">{{ error }}</p>
        <h4 class="agent-panel__subtitle">Paquete oficial</h4>
        <p v-if="!officialSkills.length" class="agent-note">El servidor no anunció skills oficiales.</p>
        <ul v-else class="agent-skill-list">
          <li v-for="skill in officialSkills" :key="skill.name" class="agent-skill">
            <div><strong>{{ skill.name }}</strong><span class="agent-tag">Oficial</span></div>
            <p v-if="skill.description">{{ skill.description }}</p>
            <p class="agent-skill__meta">{{ skillMeta(skill) }}</p>
            <p class="agent-skill__meta">Permisos: {{ permissionText(skill) }}</p>
            <p v-if="digestText(skill)" class="agent-skill__meta mono">SHA-256 {{ digestText(skill) }}</p>
          </li>
        </ul>
        <h4 class="agent-panel__subtitle">Módulos</h4>
        <p v-if="!externalModules.length" class="agent-note">El servidor no anunció módulos externos.</p>
        <ul v-else class="agent-module-list">
          <li v-for="module in externalModules" :key="module.id" class="agent-module" :class="{ 'is-disabled': module.enabled === false }">
            <div class="agent-module__head">
              <div>
                <strong>{{ module.name || module.id }}</strong>
                <span class="agent-tag" v-if="module.official">Oficial</span>
                <span class="agent-tag">{{ moduleStateLabel(module) }}</span>
              </div>
              <button v-if="!module.official && canManage" type="button" class="btn btn--secondary btn--small" :disabled="busyId === module.id" @click="toggle(module)">
                {{ busyId === module.id ? 'Aplicando…' : (module.enabled === false ? 'Habilitar módulo' : 'Deshabilitar módulo') }}
              </button>
              <p v-else-if="!module.official" class="field__hint">Cambiar módulos requiere el permiso de módulos del sistema.</p>
            </div>
            <p v-if="module.description">{{ module.description }}</p>
            <p class="agent-skill__meta" v-if="Array.isArray(module.permissions) && module.permissions.length">Permisos: {{ module.permissions.join(', ') }}</p>
            <p class="agent-skill__meta" v-if="Array.isArray(module.capabilities) && module.capabilities.length">Capacidades: {{ module.capabilities.join(', ') }}</p>
            <p v-if="module.official" class="field__hint">Un módulo oficial no se puede deshabilitar desde la aplicación.</p>
            <ul class="agent-skill-list" v-if="moduleSkills(module).length">
              <li v-for="skill in moduleSkills(module)" :key="skill.name" class="agent-skill">
                <strong>{{ skill.name }}</strong>
                <p v-if="skill.description">{{ skill.description }}</p>
                <p class="agent-skill__meta">{{ skillMeta(skill) }} · {{ permissionText(skill) }}</p>
              </li>
            </ul>
            <p v-else-if="module.enabled === false" class="field__hint">Sus skills y herramientas están retiradas.</p>
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
          this.receiptError = 'El recibo no es JSON válido.';
          return false;
        }
        if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
          this.receiptError = 'El recibo debe ser un objeto JSON.';
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
            this.requestError = 'El navegador no permite descargar el archivo de solicitud.';
            return false;
          }
          this.$emit('applied', payload);
          return true;
        } catch (error) {
          this.requestError = (error && error.message) || 'No se pudo recuperar la solicitud remota.';
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
            <h3 id="agent-installations-title" class="agent-panel__title">Instalaciones</h3>
            <p class="agent-panel__sub">Resultado real del instalador. Una configuración escrita no equivale a una conexión MCP verificada.</p>
          </div>
        </header>
        <p v-if="error" class="agent-note agent-note--error" role="alert">{{ error }}</p>
        <p v-if="!installations.length" class="agent-note">Todavía no hay instalaciones registradas.</p>
        <ul v-else class="agent-installation-list">
          <li v-for="record in installations" :key="record.id" class="agent-installation">
            <div class="agent-installation__head">
              <div>
                <strong>{{ pathLabel(record) }}</strong>
                <span class="status-pill" :class="'status--' + tone(record)">{{ statusLabel(record) }}</span>
                <span v-if="record.target && record.target.version" class="agent-tag">v{{ record.target.version }}</span>
              </div>
              <span class="agent-skill__meta">Operación: {{ record.operation || 'install' }}</span>
            </div>
            <p v-if="record.binding && record.binding.configFile" class="agent-skill__meta mono">{{ record.binding.configFile }}</p>
            <p v-if="Array.isArray(record.managedFiles) && record.managedFiles.length" class="agent-skill__meta">{{ record.managedFiles.length }} archivo(s) administrado(s)</p>
            <div v-if="Array.isArray(record.conflicts) && record.conflicts.length" class="agent-note agent-note--warn" role="status">
              <p>Conflictos conservados sin sobrescribir:</p>
              <ul><li v-for="(conflict, index) in record.conflicts" :key="index">{{ checkText(conflict) || conflict }}</li></ul>
            </div>
            <p v-if="record.status === 'configured' && record.verified !== true" class="field__hint">Archivos escritos; el servidor no confirmó una conexión MCP real.</p>
            <p v-if="record.status === 'exported' && record.verified !== true" class="field__hint">Solicitud exportada; el destino remoto todavía no está instalado ni verificado.</p>
            <p v-if="isRemote(record)" class="field__hint">Solicitud remota ligada a esta instalación. El ITSM no escribió en el host remoto.</p>
            <p v-if="requestError" class="agent-note agent-note--error" role="alert">{{ requestError }}</p>
            <div v-if="isRemote(record)" class="agent-installation__actions">
              <button type="button" class="btn btn--ghost btn--small" :disabled="requestBusy === record.id" @click="downloadRequest(record)">{{ requestBusy === record.id ? 'Descargando…' : 'Descargar solicitud' }}</button>
              <button v-if="canImportReceipt(record)" type="button" class="btn btn--ghost btn--small" @click="toggleReceipt(record)">{{ receiptFor === record.id ? 'Ocultar recibo' : 'Importar recibo' }}</button>
            </div>
            <div v-if="receiptFor === record.id" class="agent-remote">
              <div class="field">
                <label class="field__label" :for="'agent-receipt-' + record.id">Recibo del host remoto</label>
                <textarea :id="'agent-receipt-' + record.id" class="conversation__select" rows="3" v-model="receiptText" placeholder="JSON del instalador auxiliar"></textarea>
              </div>
              <p v-if="receiptError" class="agent-note agent-note--error" role="alert">{{ receiptError }}</p>
              <div class="agent-installation__actions">
                <button type="button" class="btn btn--primary btn--small" @click="submitReceipt(record)">Importar recibo y verificar</button>
              </div>
            </div>
            <div class="agent-installation__actions">
              <button v-for="operation in operations" :key="operation.id" type="button" class="btn btn--ghost btn--small" :disabled="busy === record.id + ':' + operation.id" @click="operate(operation.id, record)">
                {{ busy === record.id + ':' + operation.id ? 'Ejecutando…' : operation.label }}
              </button>
            </div>
          </li>
        </ul>
        <div v-if="result" class="agent-result" role="status">
          <div class="agent-result__head">
            <strong>Resultado del instalador</strong>
            <span class="status-pill" :class="'status--' + tone(result)">{{ statusLabel(result) }}</span>
          </div>
          <p v-if="resultError(result)" class="agent-note agent-note--error" role="alert">{{ resultError(result) }}</p>
          <p v-else-if="result.verified === true">El servidor verificó la conexión MCP con este destino.</p>
          <p v-else>El servidor no confirmó una conexión MCP real.</p>
          <p v-if="result.target && result.target.version" class="agent-skill__meta">Versión: {{ result.target.version }}</p>
          <div v-if="Array.isArray(result.checks) && result.checks.length">
            <p class="agent-skill__meta">Comprobaciones informadas:</p>
            <ul><li v-for="(check, index) in result.checks" :key="index">{{ checkText(check) || check }}</li></ul>
          </div>
          <div v-if="resultLimitations(result).length">
            <p class="agent-skill__meta">Limitaciones informadas por el servidor:</p>
            <ul><li v-for="(item, index) in resultLimitations(result)" :key="index">{{ limitationText(item) }}</li></ul>
          </div>
          <div v-if="Array.isArray(result.conflicts) && result.conflicts.length">
            <p class="agent-skill__meta">Conflictos conservados:</p>
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
        return ['Instancia', 'Destino', 'Servidor MCP', 'Skills', 'Revisión'][this.step - 1] || 'Instalación';
      },
      canNext() {
        if (this.step === 1) {
          if (this.mode === 'new') return !!text(this.instanceDraft.name) && (this.instanceDraft.engine === 'hermes' || isHttpUrl(this.instanceDraft.baseUrl));
          return !!this.instanceId;
        }
        if (this.step === 2) return isAbsolutePath(this.target.path) && (this.target.remote === true || !!(this.detection && this.detection.detected === true));
        if (this.step === 3) return isHttpUrl(this.mcp.url) && !!text(this.mcp.secretRef) && !!text(this.mcp.identityId);
        if (this.step === 4) return this.selectedSkills.length > 0;
        return !this.busy;
      },
      reviewTarget() {
        return [this.targetEngineLabel, text(this.target.path), this.target.profile ? 'perfil ' + this.target.profile : '', this.target.remote ? 'destino remoto' : ''].filter(Boolean).join(' · ');
      },
      verified() {
        return !!(this.result && this.result.verified === true);
      }
    },
    watch: {
      'target.path'() {
        this.detection = null;
      }
    },
    methods: {
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
        if (text(skill.module)) parts.push(this.skillIsOfficial(skill) ? 'Oficial' : 'Módulo ' + text(skill.module));
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
            this.instanceError = 'Selecciona una instancia OpenCode o Hermes registrada.';
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
        if (!body.name) { this.instanceError = 'Escribe un nombre para la instancia.'; return false; }
        if (body.engine === 'opencode' && !isHttpUrl(body.baseUrl)) { this.instanceError = 'La URL base de OpenCode debe ser http o https.'; return false; }
        if (this.canManageQuota) {
          const quotaError = quotaInstanceError(this.instanceDraft);
          if (quotaError) { this.instanceError = quotaError; return false; }
          Object.assign(body, quotaInstanceBody(this.instanceDraft, true));
        }
        this.instanceBusy = true;
        try {
          const payload = await window.AssetAgentApi.saveInstance(this.app, '', body);
          const instance = payload && payload.instance ? payload.instance : payload;
          if (!instance || !text(instance.id)) throw new Error('El servidor no devolvió la instancia creada.');
          this.instanceId = instance.id;
          this.mode = 'existing';
          this.preparedInstanceId = instance.id;
          this.target.profile = this.registeredProfile({ engine: body.engine, profile: body.profile });
          if (!this.target.path) this.target.path = text(body.directory);
          this.$emit('applied', instance);
          return true;
        } catch (error) {
          this.instanceError = (error && error.message) || 'No se pudo registrar la instancia.';
          return false;
        } finally {
          this.instanceBusy = false;
        }
      },
      async detect() {
        this.detectError = '';
        this.detection = null;
        if (this.target.remote === true) {
          this.detectError = 'La inspección local no aplica a un destino remoto. Se generará una solicitud para ejecutar allí.';
          return false;
        }
        if (!this.engine) { this.detectError = 'Selecciona primero una instancia.'; return false; }
        if (!isAbsolutePath(this.target.path)) { this.detectError = 'Escribe una ruta absoluta al perfil o espacio de trabajo.'; return false; }
        this.detecting = true;
        try {
          const payload = await window.AssetAgentApi.detectTarget(this.app, {
            engine: this.engine,
            path: text(this.target.path),
            profile: this.targetProfilePayload(),
            version: text(this.target.version)
          });
          const detection = normalizeTargetDetection(payload, this.engine);
          if (!detection) {
            this.detectError = 'El servidor no devolvió una inspección de destino válida.';
            return false;
          }
          this.detection = detection;
          if (detection.version) this.target.version = detection.version;
          return true;
        } catch (error) {
          this.detectError = (error && error.message) || 'No se pudo inspeccionar el destino.';
          return false;
        } finally {
          this.detecting = false;
        }
      },
      async install() {
        if (this.busy) return false;
        this.error = '';
        if (!this.instanceId || !this.selectedInstance) { this.error = 'Falta la instancia seleccionada.'; return false; }
        if (!this.detection || this.detection.detected !== true) {
          if (this.target.remote !== true) { this.error = 'Inspecciona y confirma el destino antes de instalar.'; return false; }
        }
        if (!isHttpUrl(this.mcp.url) || !text(this.mcp.secretRef) || !text(this.mcp.identityId)) { this.error = 'Completa el servidor MCP y la identidad de integración.'; return false; }
        if (!this.selectedSkills.length) { this.error = 'Selecciona al menos una skill.'; return false; }
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
          this.error = (error && error.message) || 'La instalación no se pudo completar.';
          return false;
        } finally {
          this.busy = false;
        }
      },
      async downloadRequest() {
        if (!this.result) return false;
        const request = this.result.request || (this.result.binding && this.result.binding.request);
        if (!request) { this.requestError = 'El servidor no devolvió una solicitud remota para descargar.'; return false; }
        if (!saveJsonFile(request, this.result.id)) {
          this.requestError = 'El navegador no permite descargar el archivo de solicitud.';
          return false;
        }
        this.requestError = '';
        return true;
      },
      async reDownloadRequest() {
        if (!this.result || !this.result.id) { this.requestError = 'La instalación aún no tiene identificador.'; return false; }
        this.requestError = '';
        try {
          const payload = await window.AssetAgentApi.installationRequest(this.app, this.result.id);
          if (!saveJsonFile(payload && payload.request, this.result.id)) {
            this.requestError = 'El navegador no permite descargar el archivo de solicitud.';
            return false;
          }
          return true;
        } catch (error) {
          this.requestError = (error && error.message) || 'No se pudo recuperar la solicitud remota.';
          return false;
        }
      },
      async importWizardReceipt() {
        if (this.receiptBusy || !this.result || !this.result.id) return false;
        let receipt;
        try {
          receipt = JSON.parse(this.receiptText);
        } catch (_) {
          this.receiptError = 'El recibo no es JSON válido.';
          return false;
        }
        if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
          this.receiptError = 'El recibo debe ser un objeto JSON.';
          return false;
        }
        const requestDigest = text(this.result.requestDigest);
        if (!requestDigest) {
          this.receiptError = 'La solicitud remota no tiene un resumen SHA-256 con el que vincular el recibo.';
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
          this.receiptError = (error && error.message) || 'El servidor no aceptó el recibo.';
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
            <p class="eyebrow">Integración guiada</p>
            <h3 id="agent-wizard-title" class="agent-wizard__title">Asistente de integración</h3>
            <p class="agent-panel__sub">Paso {{ step }} de 5 · {{ stepTitle }}</p>
          </div>
          <button type="button" class="config-icon-action" aria-label="Cerrar el asistente" @click="cancel"><app-icon name="close"></app-icon></button>
        </header>
        <ol class="agent-wizard__steps">
          <li v-for="index in 5" :key="index" :class="{ 'is-active': step === index, 'is-done': step > index }">{{ index }}</li>
        </ol>
        <p v-if="error" class="agent-note agent-note--error" role="alert">{{ error }}</p>

        <section v-if="step === 1" class="agent-wizard__body" aria-labelledby="agent-wizard-instance">
          <h4 id="agent-wizard-instance">Instancia del motor</h4>
          <div class="agent-wizard__modes">
            <label class="agent-check"><input type="radio" value="existing" v-model="mode"> Instancia registrada</label>
            <label class="agent-check"><input type="radio" value="new" v-model="mode"> Registrar una instancia</label>
          </div>
          <div v-if="mode === 'existing'" class="field">
            <label class="field__label" for="agent-wizard-instance-select">Instancia</label>
            <select id="agent-wizard-instance-select" class="input-shell" v-model="instanceId">
              <option value="">Selecciona OpenCode o Hermes</option>
              <option v-for="instance in engineInstances" :key="instance.id" :value="instance.id">{{ instance.name }} · {{ engineLabel(instance.engine) }}</option>
            </select>
            <p v-if="!engineInstances.length" class="agent-note">No hay instancias OpenCode o Hermes registradas. Registra una para continuar.</p>
          </div>
          <agent-instance-editor v-else :app="app" :draft="instanceDraft" :identities="identities" :busy="instanceBusy" :error="instanceError" :can-manage-quota="canManageQuota" @save="prepareInstance" @cancel="mode = 'existing'"></agent-instance-editor>
          <p v-if="mode === 'existing' && instanceError" class="agent-note agent-note--error" role="alert">{{ instanceError }}</p>
        </section>

        <section v-else-if="step === 2" class="agent-wizard__body" aria-labelledby="agent-wizard-target">
          <h4 id="agent-wizard-target">Destino real</h4>
          <p>{{ targetEngineLabel }} · la ruta se inspecciona en el servidor, no se escanea el sistema.</p>
          <div class="field">
            <label class="field__label" for="agent-wizard-path">Ruta del perfil o espacio de trabajo</label>
            <input id="agent-wizard-path" class="input-shell" v-model.trim="target.path" placeholder="/ruta/al/perfil" autocomplete="off">
          </div>
          <div class="agent-wizard__grid">
            <div class="field">
              <label class="field__label" for="agent-wizard-profile">Perfil</label>
              <input id="agent-wizard-profile" class="input-shell" v-model.trim="target.profile" maxlength="200" :disabled="engine === 'opencode'" :placeholder="engine === 'opencode' ? 'Usa el espacio de trabajo seleccionado' : 'Nombre del perfil'">
            </div>
            <div class="field">
              <label class="field__label" for="agent-wizard-version">Versión esperada</label>
              <input id="agent-wizard-version" class="input-shell" v-model.trim="target.version" maxlength="80" placeholder="Opcional">
            </div>
          </div>
          <label class="agent-check"><input type="checkbox" v-model="target.remote"> El destino no es accesible desde el host del ITSM</label>
          <p v-if="target.remote" class="agent-note" role="status">Se generará una solicitud JSON para ejecutar el instalador auxiliar en el host remoto. El ITSM no escribirá archivos en ese host.</p>
          <div v-if="!target.remote" class="agent-wizard__actions">
            <button type="button" class="btn btn--secondary btn--small" :disabled="detecting" @click="detect">{{ detecting ? 'Inspeccionando…' : 'Inspeccionar destino' }}</button>
          </div>
          <div v-if="detection && !target.remote" class="agent-note" role="status">
            <p v-if="detection.detected === true">Destino detectado: {{ detection.targetPath || target.path }}<template v-if="detection.version"> · versión {{ detection.version }}</template><template v-if="detection.profile"> · perfil {{ detection.profile }}</template><template v-if="detection.configExists === false"> · configuración nueva</template></p>
            <p v-if="detection.detected === true" class="agent-skill__meta">Configuración: {{ detection.configFile }} · Skills: {{ detection.skillsDirectory }}</p>
            <p v-else>El servidor no detectó un destino instalable.</p>
            <ul v-if="Array.isArray(detection.limitations) && detection.limitations.length"><li v-for="(item, index) in detection.limitations" :key="index">{{ item }}</li></ul>
          </div>
          <p v-if="detectError" class="agent-note agent-note--error" role="alert">{{ detectError }}</p>
          <p class="field__hint">El instalador solo puede modificar rutas accesibles desde el host del ITSM. Para un host remoto sin acceso a archivos, ejecuta el instalador auxiliar en ese host y vuelve a esta pantalla para verificar con una operación real.</p>
        </section>

        <section v-else-if="step === 3" class="agent-wizard__body" aria-labelledby="agent-wizard-mcp">
          <h4 id="agent-wizard-mcp">Servidor MCP del ITSM</h4>
          <div class="field">
            <label class="field__label" for="agent-wizard-mcp-url">URL del servidor MCP</label>
            <input id="agent-wizard-mcp-url" class="input-shell" v-model.trim="mcp.url" inputmode="url" placeholder="http://127.0.0.1:8000/mcp">
          </div>
          <div class="field">
            <label class="field__label" for="agent-wizard-mcp-secret">Nombre del secreto</label>
            <input id="agent-wizard-mcp-secret" class="input-shell" v-model.trim="mcp.secretRef" maxlength="120" placeholder="ITSM_MCP_TOKEN">
            <p class="field__hint">Solo se envía el nombre de la variable de entorno. El token lo resuelve el servidor y nunca llega al navegador.</p>
          </div>
          <div class="field">
            <label class="field__label" for="agent-wizard-identity">Identidad de integración</label>
            <select id="agent-wizard-identity" class="input-shell" v-model="mcp.identityId">
              <option value="">Selecciona una identidad de máquina</option>
              <option v-for="identity in identities" :key="identity.id" :value="identity.id">{{ machineIdentityLabel(identity) }}</option>
            </select>
            <p v-if="!identities.length" class="agent-note">El servidor no devolvió identidades de integración. Crea una identidad de máquina antes de instalar.</p>
            <p v-else-if="selectedIdentity" class="field__hint">Permisos de la identidad: {{ identityPermissions.length ? identityPermissions.join(', ') : 'ninguno declarado' }}.</p>
          </div>
        </section>

        <section v-else-if="step === 4" class="agent-wizard__body" aria-labelledby="agent-wizard-skills">
          <h4 id="agent-wizard-skills">Skills del catálogo</h4>
          <p class="agent-panel__sub">Solo se instalan las skills seleccionadas. Los permisos efectivos siguen siendo los de la identidad de integración.</p>
          <div class="agent-wizard__actions">
            <button type="button" class="btn btn--ghost btn--small" @click="selectAllSkills">Seleccionar todas</button>
            <button type="button" class="btn btn--ghost btn--small" @click="clearSkills">Quitar selección</button>
          </div>
          <p v-if="!skills.length" class="agent-note">El servidor no anunció skills.</p>
          <ul v-else class="agent-skill-list">
            <li v-for="skill in skills" :key="skill.name" class="agent-skill">
              <label class="agent-check">
                <input type="checkbox" :checked="selectedSkills.indexOf(skill.name) !== -1" :disabled="!skillEnabled(skill)" @change="toggleSkill(skill)">
                <span><strong>{{ skill.name }}</strong> <span class="agent-tag">{{ skillIsOfficial(skill) ? 'Oficial' : 'Módulo' }}</span></span>
              </label>
              <p v-if="skill.description">{{ skill.description }}</p>
              <p class="agent-skill__meta">{{ skillMeta(skill) }}</p>
              <p v-if="!skillEnabled(skill)" class="field__hint">El módulo está deshabilitado.</p>
            </li>
          </ul>
        </section>

        <section v-else class="agent-wizard__body" aria-labelledby="agent-wizard-review">
          <h4 id="agent-wizard-review">Revisión</h4>
          <dl class="agent-review">
            <dt>Instancia</dt><dd>{{ selectedInstance ? selectedInstance.name : 'Nueva instancia' }}</dd>
            <dt>Destino</dt><dd>{{ reviewTarget }}</dd>
            <dt>Servidor MCP</dt><dd class="mono">{{ mcp.url }}</dd>
            <dt>Secreto</dt><dd class="mono">{{ mcp.secretRef }}</dd>
            <dt>Identidad</dt><dd>{{ selectedIdentity ? machineIdentityLabel(selectedIdentity) : 'Sin identidad' }}</dd>
            <dt>Skills</dt><dd>{{ selectedSkills.length }} seleccionadas</dd>
          </dl>
          <p class="field__hint">El servidor ejecuta el instalador y devuelve el recibo. No se muestra «instalado» hasta que el recibo confirme la verificación.</p>
          <div class="agent-wizard__actions">
            <button type="button" class="btn btn--primary btn--small" :disabled="busy" @click="install">{{ busy ? 'Procesando…' : (target.remote ? 'Generar solicitud remota' : 'Instalar y verificar') }}</button>
          </div>
          <div v-if="result" class="agent-result" :class="{ 'agent-result--ok': verified }" role="status">
            <div class="agent-result__head">
              <strong>Resultado del instalador</strong>
              <span class="status-pill" :class="'status--' + tone(result)">{{ statusLabel(result) }}</span>
            </div>
            <p v-if="resultError(result)" class="agent-note agent-note--error" role="alert">{{ resultError(result) }}</p>
            <p v-else-if="verified">El servidor verificó la conexión MCP con este destino.</p>
            <p v-else>El servidor no confirmó una conexión MCP real. La configuración puede haberse escrito, pero no está verificada.</p>
            <p v-if="result.mcpVerified === true || result.profileSafetyVerified === true" class="agent-skill__meta">
              MCP: {{ result.mcpVerified === true ? 'verificado' : 'sin verificar' }} · Perfil: {{ result.profileSafetyVerified === true ? 'verificado' : 'sin verificar' }}
            </p>
            <p v-if="result.target && result.target.version" class="agent-skill__meta">Versión: {{ result.target.version }}</p>
            <p v-if="Array.isArray(result.managedFiles) && result.managedFiles.length" class="agent-skill__meta">{{ result.managedFiles.length }} archivo(s) administrado(s).</p>
            <div v-if="Array.isArray(result.conflicts) && result.conflicts.length" class="agent-note agent-note--warn">
              <p>Conflictos conservados sin sobrescribir:</p>
              <ul><li v-for="(conflict, index) in result.conflicts" :key="index">{{ checkText(conflict) || conflict }}</li></ul>
            </div>
            <div v-if="Array.isArray(result.checks) && result.checks.length">
              <p class="agent-skill__meta">Comprobaciones informadas:</p>
              <ul><li v-for="(check, index) in result.checks" :key="index">{{ checkText(check) || check }}</li></ul>
            </div>
            <div v-if="resultLimitations(result).length">
              <p class="agent-skill__meta">Limitaciones informadas por el servidor:</p>
              <ul><li v-for="(item, index) in resultLimitations(result)" :key="index">{{ limitationText(item) }}</li></ul>
            </div>
            <div v-if="result.request || (result.binding && result.binding.requestDigest)" class="agent-remote">
              <p><strong>Solicitud remota generada.</strong> El destino todavía no está instalado ni verificado.</p>
              <p v-if="result.requestDigest" class="agent-skill__meta mono">SHA-256 {{ result.requestDigest }}</p>
              <p class="field__hint">Descarga la solicitud y ejecútala en el host remoto con el instalador auxiliar:</p>
              <p class="mono">python -m itsm.agent_integrations --request &lt;ruta del archivo&gt;</p>
              <div class="agent-wizard__actions">
                <button type="button" class="btn btn--secondary btn--small" @click="downloadRequest">Descargar solicitud</button>
                <button v-if="result.id" type="button" class="btn btn--ghost btn--small" @click="reDownloadRequest">Volver a descargar</button>
              </div>
              <p v-if="requestError" class="agent-note agent-note--error" role="alert">{{ requestError }}</p>
              <div class="field">
                <label class="field__label" for="agent-wizard-receipt">Recibo del host remoto</label>
                <textarea id="agent-wizard-receipt" class="conversation__select" rows="4" v-model="receiptText" placeholder="Pega aquí el JSON que imprimió el instalador auxiliar"></textarea>
              </div>
              <p v-if="receiptError" class="agent-note agent-note--error" role="alert">{{ receiptError }}</p>
              <div class="agent-wizard__actions">
                <button type="button" class="btn btn--primary btn--small" :disabled="receiptBusy" @click="importWizardReceipt">{{ receiptBusy ? 'Validando…' : 'Importar recibo y verificar' }}</button>
              </div>
              <p v-if="receiptResult" class="agent-note" role="status">
                Recibo importado. Estado: {{ statusLabel(receiptResult) }}.
                <template v-if="receiptResult.verified === true">El servidor validó el recibo y alcanzó el servidor MCP.</template>
                <template v-else>El servidor no confirmó una conexión MCP real.</template>
              </p>
            </div>
            <div class="agent-wizard__actions">
              <button type="button" class="btn btn--secondary btn--small" @click="cancel">Cerrar</button>
            </div>
          </div>
        </section>

        <footer v-if="step < 5" class="agent-wizard__footer">
          <button type="button" class="btn btn--secondary btn--small" :disabled="step === 1 || busy" @click="back">Atrás</button>
          <button type="button" class="btn btn--primary btn--small" :disabled="!canNext || instanceBusy" @click="next">{{ instanceBusy ? 'Guardando…' : 'Continuar' }}</button>
        </footer>
        <footer v-else-if="!result" class="agent-wizard__footer">
          <button type="button" class="btn btn--secondary btn--small" :disabled="busy" @click="back">Atrás</button>
          <span class="agent-panel__sub">La instalación se ejecuta en el servidor; un destino remoto solo genera una solicitud.</span>
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
        return PROVIDER_CREDENTIAL_LABELS[provider.credentialStatus] ||
          (provider.credentialConfigured ? 'Credencial configurada' : 'Sin credencial configurada');
      },
      checkResultText(provider) {
        const result = this.checks[provider.id];
        if (!result) return '';
        if (result.pending) return 'Comprobando conexión…';
        if (result.ok) {
          return typeof result.modelCount === 'number'
            ? 'Conexión correcta: el proveedor ofrece ' + result.modelCount + ' modelos.'
            : 'Conexión correcta.';
        }
        return PROVIDER_CHECK_LABELS[result.code] || 'No se pudo comprobar el proveedor.';
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
          if (!payload || !Array.isArray(payload.items)) throw new Error('El servidor no devolvió la configuración de proveedores.');
          this.items = payload.items.map(item => ({
            id: text(item.id), name: text(item.name), scope: item.scope, baseUrl: text(item.baseUrl),
            models: Array.isArray(item.models) ? item.models.map(model => text(model)) : [],
            credentialConfigured: item.credentialConfigured === true, credentialStatus: text(item.credentialStatus),
            enabled: item.enabled !== false
          }));
          this.canManageGlobal = payload.canManageGlobal === true;
          this.canManagePersonal = payload.canManagePersonal === true;
          this.credentialStorageAvailable = payload.credentialStorageAvailable === true;
          return true;
        } catch (error) {
          if (this.current(epoch) && error.name !== 'AbortError') this.error = error.serverMessage || error.message || 'No se pudieron consultar los proveedores.';
          return false;
        } finally {
          if (this.current(epoch)) { this.loading = false; this.controller = null; }
        }
      },
      newProvider(scope) {
        if (this.busy || (scope === 'global' ? !this.globalAllowed : scope !== 'personal' || !this.personalAllowed)) return false;
        this.draft = { id: '', name: '', scope, baseUrl: '', modelsText: '', apiKey: '', enabled: true };
        this.error = '';
        this.notice = '';
        return true;
      },
      editProvider(provider) {
        if (this.busy || !this.canEditProvider(provider)) return false;
        this.draft = { id: provider.id, name: provider.name, scope: provider.scope, baseUrl: provider.baseUrl, modelsText: provider.models.join('\n'), apiKey: '', enabled: provider.enabled };
        this.error = '';
        this.notice = '';
        return true;
      },
      cancelProviderEdit() { this.draft = null; this.error = ''; },
      async saveProvider() {
        const draft = this.draft;
        if (!draft || this.busy || !this.canEditProvider(draft)) return false;
        const models = draft.modelsText.split(/\r?\n/).map(model => model.trim()).filter(Boolean);
        if (!draft.name.trim() || !draft.baseUrl.trim() || !models.length) {
          this.error = 'Indica el nombre, el endpoint y al menos un modelo explícito.';
          return false;
        }
        if (draft.apiKey && !this.credentialStorageAvailable) {
          this.error = 'No se puede guardar la credencial: faltan ITSM_AI_CREDENTIAL_KEYS en el servidor.';
          draft.apiKey = '';
          return false;
        }
        const body = { name: draft.name.trim(), scope: draft.scope, baseUrl: draft.baseUrl.trim(), models, enabled: draft.enabled };
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
          this.notice = 'Proveedor guardado. Sus modelos se ofrecen a través de Pydantic AI.';
          await this.loadProviders();
          this.$emit('changed');
          return true;
        } catch (error) {
          if (this.current(epoch) && error.name !== 'AbortError') {
            this.error = error.serverMessage || error.message || 'No se pudo guardar el proveedor.';
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
          this.notice = 'Proveedor eliminado.';
          await this.loadProviders();
          this.$emit('changed');
          return true;
        } catch (error) {
          if (this.current(epoch) && error.name !== 'AbortError') this.error = error.serverMessage || error.message || 'No se pudo eliminar el proveedor.';
          return false;
        } finally {
          if (this.current(epoch)) { this.busy = false; this.controller = null; }
        }
      }
    },
    template: `
      <section class="agent-panel agent-providers" aria-labelledby="agent-providers-title" :aria-busy="loading || busy">
        <header class="agent-panel__head">
          <div><h3 id="agent-providers-title" class="agent-panel__title">Proveedores compatibles con OpenAI</h3><p class="agent-panel__sub">Los globales los administra el Superadmin. Los personales solo están disponibles para su propietario autorizado. Las herramientas conservan tus permisos.</p></div>
          <div class="agent-provider-actions">
            <button v-if="globalAllowed" id="provider-new-global" type="button" class="btn btn--secondary btn--small" :disabled="busy" @click="newProvider('global')">Añadir proveedor global</button>
            <button v-if="personalAllowed" id="provider-new-personal" type="button" class="btn btn--secondary btn--small" :disabled="busy" @click="newProvider('personal')">Añadir proveedor personal</button>
          </div>
        </header>
        <p v-if="loading" class="agent-note" role="status">Consultando proveedores…</p>
        <p v-if="error" id="provider-error" class="agent-note agent-note--error" role="alert">{{ error }}</p>
        <button v-if="error && !draft" type="button" class="btn btn--ghost btn--small" @click="loadProviders">Volver a consultar proveedores</button>
        <p v-if="notice" class="agent-note" role="status">{{ notice }}</p>
        <p v-if="!loading && !error && !items.length" class="agent-note">No hay proveedores adicionales disponibles. El proveedor predeterminado del servidor no se modifica aquí.</p>
        <p v-if="!loading && (globalAllowed || personalAllowed) && !credentialStorageAvailable" id="provider-storage-help" class="agent-note">No está disponible la escritura de credenciales: el servidor necesita ITSM_AI_CREDENTIAL_KEYS. No se genera ni se guarda esa clave desde esta pantalla.</p>
        <ul v-if="items.length" class="agent-instance-list">
          <li v-for="provider in items" :key="provider.id" class="agent-instance">
            <div><strong>{{ provider.name }}</strong> <span class="agent-tag">{{ provider.scope === 'global' ? 'Global' : 'Personal' }}</span> <span class="status-pill" :class="provider.enabled ? 'status--ok' : 'status--hold'">{{ provider.enabled ? 'Habilitado' : 'Deshabilitado' }}</span></div>
            <p class="agent-skill__meta">{{ provider.baseUrl }}</p>
            <p class="agent-skill__meta">Modelos: {{ provider.models.join(', ') || 'Sin modelos configurados' }}</p>
            <p class="agent-skill__meta">{{ credentialText(provider) }} · Pydantic AI</p>
            <p v-if="checks[provider.id]" class="agent-skill__meta" role="status">{{ checkResultText(provider) }}</p>
            <div v-if="canEditProvider(provider)" class="agent-provider-actions">
              <button :id="'provider-edit-' + provider.id" type="button" class="btn btn--ghost btn--small" :disabled="busy" :aria-label="'Editar proveedor ' + provider.name" @click="editProvider(provider)">Editar</button>
              <button :id="'provider-check-' + provider.id" type="button" class="btn btn--ghost btn--small" :disabled="busy || (checks[provider.id] && checks[provider.id].pending)" :aria-label="'Comprobar proveedor ' + provider.name" @click="checkProvider(provider)">Comprobar</button>
              <button :id="'provider-delete-' + provider.id" type="button" class="btn btn--ghost btn--small" :disabled="busy" :aria-label="'Eliminar proveedor ' + provider.name" @click="pendingDeleteId = provider.id">Eliminar</button>
              <template v-if="pendingDeleteId === provider.id"><span>¿Eliminar {{ provider.name }}?</span><button type="button" class="btn btn--secondary btn--small" :disabled="busy" @click="removeProvider(provider)">Confirmar eliminación</button><button type="button" class="btn btn--ghost btn--small" @click="pendingDeleteId = ''">Conservar proveedor</button></template>
            </div>
          </li>
        </ul>
        <form v-if="draft" id="provider-form" class="agent-editor agent-provider-form" :aria-describedby="error ? 'provider-error' : undefined" @submit.prevent="saveProvider">
          <h4 class="agent-panel__title">{{ draft.id ? 'Editar proveedor' : 'Nuevo proveedor' }} {{ draft.scope === 'global' ? 'global' : 'personal' }}</h4>
          <div class="field"><label class="field__label" for="provider-name">Nombre del proveedor</label><input id="provider-name" v-model="draft.name" class="input-shell" required :disabled="busy" maxlength="160"></div>
          <div class="field"><label class="field__label" for="provider-url">Endpoint compatible con OpenAI</label><input id="provider-url" v-model="draft.baseUrl" type="url" class="input-shell" required :disabled="busy" aria-describedby="provider-url-help"><p id="provider-url-help" class="field__hint">{{ draft.scope === 'personal' ? 'HTTPS público, sin credenciales en la URL ni redirecciones. Solo se aceptan destinos privados que el despliegue haya autorizado. El servidor valida el destino.' : 'URL administrada por el propietario de la instalación. Puede ser un endpoint de la red local.' }}</p></div>
          <div class="field"><label class="field__label" for="provider-models">Modelos disponibles (uno por línea)</label><textarea id="provider-models" v-model="draft.modelsText" class="input-shell" rows="3" required :disabled="busy" aria-describedby="provider-models-help"></textarea><p id="provider-models-help" class="field__hint">Identificadores exactos del proveedor. No se descubren ni se inventan modelos automáticamente.</p></div>
          <div class="field"><label class="field__label" for="provider-key">{{ draft.id ? 'Sustituir credencial (opcional)' : 'Credencial (opcional)' }}</label><input id="provider-key" v-model="draft.apiKey" type="password" class="input-shell" autocomplete="new-password" :disabled="busy || !credentialStorageAvailable" :aria-describedby="!credentialStorageAvailable ? 'provider-storage-help provider-key-help' : 'provider-key-help'"><p id="provider-key-help" class="field__hint">Solo escritura. No se muestra la credencial guardada. Déjalo vacío para conservarla al editar.</p></div>
          <label class="agent-checkbox"><input v-model="draft.enabled" type="checkbox" :disabled="busy"> Habilitado</label>
          <div class="agent-provider-actions"><button type="submit" class="btn btn--primary" :disabled="busy">{{ busy ? 'Guardando…' : 'Guardar proveedor' }}</button><button type="button" class="btn btn--secondary" :disabled="busy" @click="cancelProviderEdit">Cancelar</button></div>
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
        if (!defaults.instanceId) return 'Sin preferencia predeterminada';
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
        if (known === false) return 'No disponible';
        if (limit === null || limit === undefined) return 'Ilimitado';
        return formatTokens(limit) + ' tokens' + (limit === 0 ? ' · sin admisión' : '');
      },
      quotaOverrideLimitText(record) {
        if (!record) return 'Hereda del valor predeterminado';
        return this.quotaLimitText(record.dailyLimit, true);
      },
      quotaDimensionLabel(key) {
        return {
          user: 'Usuario',
          provider: 'Proveedor',
          model: 'Modelo',
          engine: 'Motor',
          funding: 'Financiación',
          day: 'Día'
        }[key] || text(key);
      },
      quotaUserName(userId) {
        const id = text(userId);
        if (!id) return 'Sin usuario';
        const match = this.quotaUserOptions.find(item => item.id === id);
        return match ? match.label : id;
      },
      quotaRowProvider(row) {
        if (row.legacy === true) return 'Sin atribuir (legado)';
        const name = text(row.providerName) || text(row.providerId);
        if (!name) return 'No informado';
        const scope = text(row.providerScope);
        const scopeLabel = scope === 'global' ? 'Global' : scope === 'personal' ? 'Personal' : 'Ámbito no informado';
        return name + (scope ? ' · ' + scopeLabel : '');
      },
      quotaRowModel(row) {
        if (row.legacy === true) return 'Sin atribuir (legado)';
        return text(row.model) || 'No informado';
      },
      quotaRowEngine(row) {
        if (row.legacy === true) return 'Sin atribuir (legado)';
        return text(row.engine) || 'No informado';
      },
      quotaRowPrecision(row) {
        return this.quotaPrecisionLabel(row.precision) + ' · ' + this.quotaSourceLabel(row.source);
      },
      quotaRowState(row) {
        return this.quotaStateLabel(row.state) + (row.legacy === true ? ' · legado' : '');
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
            this.quotaPolicyError = 'El servidor no devolvió la política diaria de cuota.';
            return false;
          }
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaAdmin(epoch)) return false;
          this.quotaPolicy = null;
          this.quotaPolicyError = error && error.status === 403
            ? 'La política de cuota requiere el permiso system.providers de una cuenta humana.'
            : ((error && (error.serverMessage || error.message)) || 'No se pudo consultar la política de cuota.');
          return false;
        } finally {
          if (this.isCurrentQuotaAdmin(epoch)) this.quotaPolicyLoading = false;
        }
      },
      async saveQuotaPolicy() {
        if (!this.canManageQuota || !this.quotaPolicy || !this.quotaPolicy.available || this.quotaAdminMutationBusy) {
          if (this.quotaPolicy && !this.quotaPolicy.available) {
            this.quotaPolicyError = 'La política no está disponible; no se puede guardar una cuota que el servidor no informó.';
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
                this.quotaPolicyError = 'El límite diario de la empresa debe ser un entero mayor o igual que cero.';
                return false;
              }
              if (parsed !== this.quotaPolicy[bodyKey]) body[bodyKey] = parsed;
            } else {
              this.quotaPolicyError = 'Indica si el límite diario de la empresa es ilimitado o tiene un valor.';
              return false;
            }
          }
          const timezone = text(this.quotaDraft.timezone);
          if (timezone && timezone !== this.quotaPolicy.timezone) body.timezone = timezone;
          if (!Object.keys(body).length) {
            this.quotaPolicyNotice = 'No hay cambios que guardar.';
            return true;
          }
          this.quotaPolicyBusy = true;
          epoch = this.quotaMutationEpoch + 1;
          this.quotaMutationEpoch = epoch;
          this.quotaAdminOwner = String(this.app.activeUserId || '');
          const payload = await api.saveQuotaPolicy(this.app, body);
          if (!this.isCurrentQuotaMutation(epoch)) return false;
          if (!this.applyQuotaPolicy(payload)) {
            this.quotaPolicyError = 'El servidor no confirmó la política de cuota.';
            return false;
          }
          this.quotaAdminEpoch += 1;
          this.quotaPolicyLoading = false;
          this.quotaPolicyNotice = 'Cuota guardada. Un cambio de zona horaria queda pendiente hasta el siguiente límite diario seguro; el día no se reinicia en el navegador.';
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaMutation(epoch)) return false;
          this.quotaPolicyError = (error && (error.serverMessage || error.message)) || 'No se pudo guardar la política de cuota.';
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
            this.quotaPolicyError = 'El servidor no confirmó la cancelación del cambio de zona.';
            return false;
          }
          this.quotaAdminEpoch += 1;
          this.quotaPolicyLoading = false;
          this.quotaPolicyNotice = 'Cambio de zona cancelado. Se mantiene la zona actual.';
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaMutation(epoch)) return false;
          this.quotaPolicyError = (error && (error.serverMessage || error.message)) || 'No se pudo cancelar el cambio de zona horaria.';
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
            ? 'Selecciona un usuario válido de la lista.'
            : 'Escribe un UUID de usuario válido; el nombre de usuario no es un identificador.';
          return false;
        }
        const scope = 'company';
        if (this.quotaOverrideMode === 'inherit') {
          if (!this.quotaOverrideRecord) {
            this.quotaOverrideError = 'El usuario ya hereda el valor predeterminado; no hay excepción que eliminar.';
            return false;
          }
          return this.removeQuotaOverride(userId, scope);
        }
        let dailyLimit;
        if (this.quotaOverrideMode === 'unlimited') dailyLimit = null;
        else if (this.quotaOverrideMode === 'limited') {
          dailyLimit = this.parseQuotaLimit(this.quotaOverrideLimit);
          if (dailyLimit === undefined) {
            this.quotaOverrideError = 'La excepción diaria debe ser un entero mayor o igual que cero.';
            return false;
          }
        } else {
          this.quotaOverrideError = 'Elige heredar, ilimitado o un límite diario explícito.';
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
            this.quotaOverrideError = 'El servidor no confirmó las excepciones de cuota.';
            return false;
          }
          this.quotaOverrides = overrides;
          if (this.quotaPolicy) this.quotaPolicy.overrides = overrides.slice();
          this.quotaAdminEpoch += 1;
          this.quotaPolicyLoading = false;
          this.syncQuotaOverrideDraft();
          this.quotaOverrideNotice = dailyLimit === null
            ? 'Excepción guardada: uso ilimitado explícito. Es distinto de heredar el valor predeterminado.'
            : (dailyLimit === 0
              ? 'Excepción guardada: cero tokens, sin admisión de ejecuciones.'
              : 'Excepción guardada: límite diario de ' + formatTokens(dailyLimit) + ' tokens.');
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaMutation(epoch)) return false;
          this.quotaOverrideError = (error && (error.serverMessage || error.message)) || 'No se pudo guardar la excepción de cuota.';
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
            this.quotaOverrideError = 'El servidor no confirmó las excepciones de cuota.';
            return false;
          }
          this.quotaOverrides = overrides;
          if (this.quotaPolicy) this.quotaPolicy.overrides = overrides.slice();
          this.quotaAdminEpoch += 1;
          this.quotaPolicyLoading = false;
          this.syncQuotaOverrideDraft();
          this.quotaOverrideNotice = 'Excepción eliminada: el usuario vuelve a heredar el valor predeterminado de su financiación.';
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaMutation(epoch)) return false;
          this.quotaOverrideError = (error && (error.serverMessage || error.message)) || 'No se pudo eliminar la excepción de cuota.';
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
          this.quotaReportError = 'El filtro de usuario debe ser el UUID de la cuenta, no su nombre.';
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
            this.quotaReportError = 'El servidor no devolvió un informe de consumo utilizable.';
            return false;
          }
          this.quotaReport = report;
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaAdmin(epoch, 'report')) return false;
          this.quotaReport = null;
          this.quotaReportError = (error && (error.serverMessage || error.message)) || 'No se pudo consultar el informe de consumo.';
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
            this.quotaPendingError = 'El servidor no devolvió las retenciones pendientes.';
            return false;
          }
          this.quotaPending = items;
          return true;
        } catch (error) {
          if (!this.isCurrentQuotaAdmin(epoch, 'pending')) return false;
          this.quotaPending = null;
          this.quotaPendingError = (error && (error.serverMessage || error.message)) || 'No se pudieron consultar las retenciones pendientes.';
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
              ? 'La administración de integraciones requiere el permiso de proveedores de IA del sistema.'
              : ((error && error.message) || 'No se pudieron consultar las integraciones.');
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
            ? 'La administración de integraciones requiere el permiso de proveedores de IA del sistema.'
            : ((error && error.message) || 'No se pudieron consultar las integraciones.');
        }
      },
      async refreshCatalog() {
        try {
          this.catalog = this.normalizeCatalog(await window.AssetAgentApi.catalog(this.app));
          this.catalogError = '';
        } catch (error) {
          this.catalogError = (error && error.message) || 'No se pudo consultar el catálogo.';
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
        if (!text(draft.name)) { this.instanceError = 'Escribe un nombre para la instancia.'; return false; }
        if (draft.engine === 'opencode' && !isHttpUrl(draft.baseUrl)) { this.instanceError = 'La URL base de OpenCode debe ser http o https.'; return false; }
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
          this.instanceError = (error && error.message) || 'No se pudo guardar la instancia.';
          return false;
        } finally {
          this.instanceBusy = false;
        }
      },
      async toggleModule(module) {
        if (!this.canManageModules) {
          this.moduleError = 'Cambiar módulos requiere el permiso de módulos del sistema.';
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
          this.moduleError = (error && error.message) || 'No se pudo cambiar el estado del módulo.';
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
          this.operationError = (error && error.message) || 'No se pudo completar la operación del instalador.';
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
          this.operationError = 'La instalación no tiene un resumen SHA-256 con el que vincular el recibo.';
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
          this.operationError = (error && error.message) || 'El servidor no aceptó el recibo remoto.';
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
            <p class="eyebrow">Inteligencia artificial</p>
            <h2 id="agent-ia-title">Motores y modelos</h2>
            <p>El chat usa el motor y el modelo que elijas. La preferencia se guarda en el servidor; el navegador nunca recibe credenciales del motor.</p>
          </div>
          <span class="config-badge"><app-icon name="layers"></app-icon> IA</span>
        </header>
        <p v-if="loading" class="agent-note" role="status">Consultando motores e integraciones…</p>
        <p v-if="loadError" class="agent-note agent-note--error" role="alert">{{ loadError }}</p>
        <agent-engine-picker :key="enginePickerKey" :app="app" heading="Preferencia del chat"></agent-engine-picker>
        <agent-providers-panel :app="app" @changed="onProvidersChanged"></agent-providers-panel>

        <template v-if="canManageQuota">
          <section class="agent-panel agent-quota-admin" aria-labelledby="quota-policy-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="quota-policy-title" class="agent-panel__title">Cuota diaria de IA</h3>
                <p class="agent-panel__sub">El límite diario solo controla los proveedores globales de la organización. El consumo con proveedores personales se registra, pero no tiene límite diario: lo paga cada persona con su propia clave. El navegador no reinicia el día ni convierte un límite nulo en cero; el servidor aplica la zona horaria y conserva las retenciones hasta reconciliarlas.</p>
              </div>
              <button type="button" class="btn btn--ghost btn--small" :disabled="quotaPolicyLoading || quotaPolicyBusy" @click="loadQuotaPolicy">{{ quotaPolicyLoading ? 'Consultando…' : 'Actualizar política' }}</button>
            </header>
            <p v-if="quotaPolicyLoading" class="agent-note" role="status">Consultando la política de cuota…</p>
            <p v-if="quotaPolicyError" class="agent-note agent-note--error" role="alert">{{ quotaPolicyError }}</p>
            <p v-if="quotaPolicyNotice" class="agent-note" role="status">{{ quotaPolicyNotice }}</p>
            <p v-if="quotaPolicy && !quotaPolicy.available" class="agent-note agent-note--warn">El servidor no devolvió el límite de la empresa. La política se muestra como no disponible y no se puede guardar.</p>
            <form v-if="quotaPolicy && quotaPolicy.available" class="agent-quota-form" @submit.prevent="saveQuotaPolicy">
              <fieldset class="agent-quota-fieldset">
                <legend>Límite diario de la empresa</legend>
                <label class="agent-check"><input v-model="quotaDraft.companyMode" type="radio" value="limited" :disabled="quotaPolicyBusy"> Límite diario</label>
                <label class="agent-check"><input v-model="quotaDraft.companyMode" type="radio" value="unlimited" :disabled="quotaPolicyBusy"> Ilimitado (sin límite)</label>
                <div class="field">
                  <label class="field__label" for="quota-company-limit">Tokens por día</label>
                  <input id="quota-company-limit" v-model="quotaDraft.companyLimit" type="number" min="0" step="1" inputmode="numeric" class="input-shell" :disabled="quotaPolicyBusy || quotaDraft.companyMode !== 'limited'" aria-describedby="quota-company-help">
                  <p id="quota-company-help" class="field__hint">0 bloquea nuevas ejecuciones; no es lo mismo que ilimitado. Valor actual: {{ quotaLimitText(quotaPolicy.companyDailyLimit, quotaPolicy.companyKnown) }} ({{ quotaLimitSourceLabel(quotaPolicy.companyLimitSource) }}).</p>
                </div>
              </fieldset>
              <div class="field">
                <label class="field__label" for="quota-timezone">Zona horaria del día</label>
                <input id="quota-timezone" v-model="quotaDraft.timezone" type="text" class="input-shell" :disabled="quotaPolicyBusy" aria-describedby="quota-timezone-help" placeholder="America/Mexico_City" autocomplete="off" spellcheck="false">
                <p id="quota-timezone-help" class="field__hint">Nombre IANA. Zona actual: {{ quotaPolicy.timezone || 'no informada' }}. <template v-if="quotaPolicy.pendingTimezone">Cambio pendiente a {{ quotaPolicy.pendingTimezone }} para el día {{ quotaPolicy.pendingEffectiveDay || 'siguiente seguro' }}; no se aplica de inmediato.</template><template v-else>El cambio se aplica en el siguiente límite diario seguro, no en el navegador.</template></p>
              </div>
              <div class="agent-provider-actions">
                <button type="submit" class="btn btn--primary" :disabled="quotaAdminMutationBusy">{{ quotaPolicyBusy ? 'Guardando…' : 'Guardar política' }}</button>
                <button v-if="quotaPolicy.pendingTimezone" type="button" class="btn btn--secondary" :disabled="quotaAdminMutationBusy" @click="cancelQuotaTimezoneChange">Cancelar cambio de zona</button>
              </div>
            </form>

            <section class="agent-quota-block" aria-labelledby="quota-overrides-title">
              <h4 id="quota-overrides-title">Excepciones por usuario</h4>
              <p class="agent-panel__sub">Una excepción reemplaza el límite diario de la empresa para una persona; no afecta su consumo con claves propias. Quitarla devuelve la cuenta al valor heredado; ilimitado explícito es una excepción distinta.</p>
              <div class="agent-quota-form">
                <div class="field">
                  <label class="field__label" for="quota-override-user">Usuario real</label>
                  <select v-if="canBrowseQuotaUsers && quotaUserOptions.length" id="quota-override-user" v-model="quotaOverrideUser" class="input-shell" :disabled="quotaOverrideBusy" @change="onQuotaOverrideTargetChanged">
                    <option v-for="user in quotaUserOptions" :key="user.id" :value="user.id">{{ user.label }}</option>
                  </select>
                  <template v-else>
                    <input id="quota-override-user" v-model="quotaOverrideUser" type="text" class="input-shell" :disabled="quotaOverrideBusy" aria-describedby="quota-override-user-help" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off" spellcheck="false">
                    <p id="quota-override-user-help" class="field__hint">UUID de la cuenta. El nombre de usuario no identifica una cuenta. La lista de cuentas requiere el permiso users.view.</p>
                  </template>
                </div>
                <fieldset class="agent-quota-fieldset">
                  <legend>Valor de la excepción</legend>
                  <label class="agent-check"><input v-model="quotaOverrideMode" type="radio" value="inherit" :disabled="quotaOverrideBusy"> Heredar el valor predeterminado</label>
                  <label class="agent-check"><input v-model="quotaOverrideMode" type="radio" value="unlimited" :disabled="quotaOverrideBusy"> Ilimitado explícito</label>
                  <label class="agent-check"><input v-model="quotaOverrideMode" type="radio" value="limited" :disabled="quotaOverrideBusy"> Límite diario</label>
                  <div class="field">
                    <label class="field__label" for="quota-override-limit">Tokens por día</label>
                    <input id="quota-override-limit" v-model="quotaOverrideLimit" type="number" min="0" step="1" inputmode="numeric" class="input-shell" :disabled="quotaOverrideBusy || quotaOverrideMode !== 'limited'" aria-describedby="quota-override-limit-help">
                    <p id="quota-override-limit-help" class="field__hint">0 bloquea nuevas ejecuciones; ilimitado se elige arriba, no con 0.</p>
                  </div>
                </fieldset>
                <p class="agent-skill__meta">Excepción actual: {{ quotaOverrideLimitText(quotaOverrideRecord) }}.</p>
                <p v-if="quotaOverrideError" class="agent-note agent-note--error" role="alert">{{ quotaOverrideError }}</p>
                <p v-if="quotaOverrideNotice" class="agent-note" role="status">{{ quotaOverrideNotice }}</p>
                <div class="agent-provider-actions">
                  <button type="button" class="btn btn--primary" :disabled="quotaAdminMutationBusy" @click="saveQuotaOverride">{{ quotaOverrideMode === 'inherit' ? 'Quitar excepción y heredar' : 'Guardar excepción' }}</button>
                </div>
              </div>
              <ul v-if="quotaOverrides.length" class="agent-quota-overrides">
                <li v-for="record in quotaOverrides" :key="record.userId + '|' + record.scope" class="agent-quota-override">
                  <div>
                    <strong>{{ quotaUserName(record.userId) }}</strong>
                    <span class="agent-tag">{{ quotaFundingLabel(record.scope) }}</span>
                    <p class="agent-skill__meta">Valor: {{ quotaOverrideLimitText(record) }}<template v-if="record.updatedAt"> · Actualizado: {{ record.updatedAt }}</template></p>
                  </div>
                  <div class="agent-installation__actions">
                    <template v-if="quotaPendingRemove === record.userId + '|' + record.scope">
                      <button type="button" class="btn btn--danger btn--small" :disabled="quotaAdminMutationBusy" @click="confirmRemoveQuotaOverride(record)">Confirmar herencia</button>
                      <button type="button" class="btn btn--ghost btn--small" :disabled="quotaAdminMutationBusy" @click="cancelRemoveQuotaOverride">Cancelar</button>
                    </template>
                    <button v-else type="button" class="btn btn--ghost btn--small" :disabled="quotaAdminMutationBusy" @click="requestRemoveQuotaOverride(record)">Quitar excepción</button>
                  </div>
                </li>
              </ul>
              <p v-else class="agent-note">No hay excepciones; todas las cuentas heredan sus valores predeterminados.</p>
            </section>

            <section class="agent-quota-block" aria-labelledby="quota-report-title">
              <h4 id="quota-report-title">Consumo medido y estimado</h4>
              <p class="agent-panel__sub">Solo el servidor agrupa y totaliza. Las columnas de caché son descriptivas y no se suman al total. Un campo nulo se muestra como no disponible, nunca como cero.</p>
              <form class="agent-quota-filters" @submit.prevent="loadQuotaReport">
                <div class="field">
                  <label class="field__label" for="quota-report-user">Usuario</label>
                  <select v-if="canBrowseQuotaUsers && quotaUserOptions.length" id="quota-report-user" v-model="quotaReportFilters.userId" class="input-shell">
                    <option value="">Todos</option>
                    <option v-for="user in quotaUserOptions" :key="user.id" :value="user.id">{{ user.label }}</option>
                  </select>
                  <input v-else id="quota-report-user" v-model="quotaReportFilters.userId" type="text" class="input-shell" placeholder="UUID de usuario" autocomplete="off" spellcheck="false">
                </div>
                <div class="field">
                  <label class="field__label" for="quota-report-provider">Proveedor</label>
                  <input id="quota-report-provider" v-model="quotaReportFilters.providerId" type="text" class="input-shell" autocomplete="off">
                </div>
                <div class="field">
                  <label class="field__label" for="quota-report-model">Modelo</label>
                  <input id="quota-report-model" v-model="quotaReportFilters.model" type="text" class="input-shell" autocomplete="off">
                </div>
                <div class="field">
                  <label class="field__label" for="quota-report-engine">Motor</label>
                  <input id="quota-report-engine" v-model="quotaReportFilters.engine" type="text" class="input-shell" autocomplete="off">
                </div>
                <div class="field">
                  <label class="field__label" for="quota-report-funding">Financiación</label>
                  <select id="quota-report-funding" v-model="quotaReportFilters.funding" class="input-shell">
                    <option value="">Todas</option>
                    <option value="company">Empresa</option>
                    <option value="personal">Personal</option>
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="quota-report-from">Desde</label>
                  <input id="quota-report-from" v-model="quotaReportFilters.dayFrom" type="date" class="input-shell">
                </div>
                <div class="field">
                  <label class="field__label" for="quota-report-to">Hasta</label>
                  <input id="quota-report-to" v-model="quotaReportFilters.dayTo" type="date" class="input-shell">
                </div>
                <label class="agent-check"><input v-model="quotaReportIncludeLegacy" type="checkbox"> Incluir filas de legado sin atribuir</label>
                <div class="agent-provider-actions">
                  <button type="submit" class="btn btn--primary" :disabled="quotaReportLoading">{{ quotaReportLoading ? 'Consultando…' : 'Consultar consumo' }}</button>
                </div>
              </form>
              <p v-if="quotaReportError" class="agent-note agent-note--error" role="alert">{{ quotaReportError }}</p>
              <template v-if="quotaReport">
                <p class="agent-skill__meta">Zona: {{ quotaReport.timezone || 'no informada' }} · Generado: {{ quotaReport.generatedAt || 'no informado' }} · Agrupación confirmada: {{ quotaReportGroupByLabel || 'no informada' }}</p>
                <dl class="agent-quota-totals">
                  <div><dt>Liquidado</dt><dd>{{ quotaTokenText(quotaReport.totals.settledTokens) }}</dd></div>
                  <div><dt>Reservado</dt><dd>{{ quotaTokenText(quotaReport.totals.reservedTokens) }}</dd></div>
                  <div><dt>Retenciones pendientes</dt><dd>{{ quotaTokenText(quotaReport.totals.pendingCount) }} · sin resolver {{ quotaTokenText(quotaReport.totals.unresolvedCount) }}</dd></div>
                  <div><dt>Liberado</dt><dd>{{ quotaTokenText(quotaReport.totals.releasedCount) }} · recibos {{ quotaTokenText(quotaReport.totals.receiptCount) }}</dd></div>
                  <div><dt>Legado sin atribuir</dt><dd>{{ quotaTokenText(quotaReport.totals.legacyTokens) }}</dd></div>
                  <div><dt>Precisión</dt><dd>medido {{ quotaTokenText(quotaReport.precision.measured) }} · estimado {{ quotaTokenText(quotaReport.precision.estimated) }} · no disponible {{ quotaTokenText(quotaReport.precision.unavailable) }}</dd></div>
                </dl>
                <p class="agent-skill__meta">Reservado y pendiente no son consumo liquidado. El navegador no recalcula totales, no reparte el legado y no pagina filas que el servidor no paginó.</p>
                <div v-if="quotaReport.items.length" class="agent-quota-table-wrap">
                  <table class="agent-quota-table">
                    <caption class="agent-skill__meta">Consumo de IA con la agrupación confirmada por el servidor</caption>
                    <thead>
                      <tr>
                        <th scope="col">Día</th><th scope="col">Usuario</th><th scope="col">Proveedor</th><th scope="col">Modelo</th><th scope="col">Motor</th><th scope="col">Financiación</th><th scope="col">Precisión y fuente</th><th scope="col">Estado</th><th scope="col">Liquidado</th><th scope="col">Reservado</th><th scope="col">Pendientes</th><th scope="col">Entrada</th><th scope="col">Salida</th><th scope="col">Caché lectura</th><th scope="col">Caché escritura</th><th scope="col">Razonamiento</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, index) in quotaReport.items" :key="index">
                        <td>{{ row.day || 'No disponible' }}</td>
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
                <p v-else class="agent-note">El servidor no devolvió filas para estos filtros.</p>
              </template>
            </section>

            <section class="agent-quota-block" aria-labelledby="quota-pending-title">
              <h4 id="quota-pending-title">Retenciones pendientes</h4>
              <p class="agent-panel__sub">Una retención reserva cuota antes de la ejecución. No es consumo liquidado y esta vista no libera ni reembolsa nada; la reconciliación pertenece al servidor.</p>
              <div class="agent-provider-actions">
                <button type="button" class="btn btn--secondary btn--small" :disabled="quotaPendingLoading" @click="loadQuotaPending">{{ quotaPendingLoading ? 'Consultando…' : 'Consultar retenciones' }}</button>
              </div>
              <p v-if="quotaPendingError" class="agent-note agent-note--error" role="alert">{{ quotaPendingError }}</p>
              <ul v-if="quotaPending && quotaPending.length" class="agent-quota-overrides">
                <li v-for="hold in quotaPending" :key="hold.reservationId" class="agent-quota-override">
                  <div>
                    <strong class="mono">{{ hold.reservationId }}</strong>
                    <span class="agent-tag">{{ quotaStateLabel(hold.state) }}</span>
                    <p class="agent-skill__meta">Ejecución: {{ hold.runId || 'no informada' }} · Usuario: {{ quotaUserName(hold.userId) }} · {{ quotaFundingLabel(hold.funding) }} · {{ quotaRowProvider(hold) }}</p>
                    <p class="agent-skill__meta">Reservado: {{ quotaTokenText(hold.reservedTokens) }} · Día {{ hold.periodDay || 'no informado' }} · Zona {{ hold.timezone || 'no informada' }} · Creado {{ hold.createdAt || 'sin fecha' }}</p>
                  </div>
                </li>
              </ul>
              <p v-else-if="quotaPending" class="agent-note">El servidor no devolvió retenciones.</p>
            </section>
          </section>
        </template>

        <p v-if="!isAdmin" class="agent-note">La administración de instancias, instalaciones y catálogo requiere el permiso de proveedores de IA del sistema.</p>
        <p v-else-if="adminError" class="agent-note agent-note--error" role="alert">{{ adminError }}</p>

        <template v-if="isAdmin && adminAvailable">
          <section class="agent-panel" aria-labelledby="agent-instances-title">
            <header class="agent-panel__head">
              <div>
                <h3 id="agent-instances-title" class="agent-panel__title">Instancias</h3>
                <p class="agent-panel__sub">Cada instancia declara su motor, su URL y la referencia al secreto. La integración interna de Pydantic AI no se edita aquí.</p>
                <p class="agent-skill__meta">Valor predeterminado del servidor: {{ defaultLabel }}</p>
              </div>
              <button type="button" class="btn btn--primary btn--small" @click="newInstance"><app-icon name="plus"></app-icon> Nueva instancia</button>
            </header>
            <p v-if="!adminInstances.length" class="agent-note">El servidor no devolvió instancias.</p>
            <ul v-else class="agent-instance-list">
              <li v-for="instance in adminInstances" :key="instance.id" class="agent-instance">
                <div>
                  <strong>{{ instance.name }}</strong>
                  <span class="agent-tag">{{ engineLabel(instance.engine) }}</span>
                  <span class="status-pill" :class="instance.enabled === false ? 'status--hold' : 'status--ok'">{{ instance.enabled === false ? 'Deshabilitada' : 'Habilitada' }}</span>
                </div>
                <p class="agent-skill__meta">{{ instance.baseUrl || 'Integración interna del servidor' }}</p>
                <p class="agent-skill__meta">Perfil: {{ instance.profile || 'Sin perfil' }} · Secreto: {{ instance.secretConfigured ? 'configurado' : (instance.secretRef || 'sin referencia') }}</p>
                <p v-if="instance.integrationIdentityId" class="agent-skill__meta mono">Identidad: {{ instance.integrationIdentityId }}</p>
                <p class="agent-skill__meta">Cuota del motor: {{ quotaEngineStatus(instance).modeLabel }} · {{ quotaEngineStatus(instance).enforcementLabel }}<template v-if="quotaEngineStatus(instance).directException"> · excepción directa de empresa</template></p>
                <p class="agent-skill__meta">Motivo: {{ quotaEngineStatus(instance).reason || 'sin motivo informado' }}</p>
                <p v-if="quotaEngineStatus(instance).strict" class="agent-skill__meta">El servidor declara cuota estricta. Gestionado describe el enrutamiento por el gateway de ITSM, no demuestra por sí solo aislamiento de red.</p>
                <p v-if="quotaEngineStatus(instance).mode === 'direct'" class="agent-skill__meta">Ejecución directa: {{ quotaEngineStatus(instance).directException ? 'excepción de empresa declarada por el servidor' : 'sin excepción de empresa declarada' }}; no se presenta como cuota estricta.</p>
                <div v-if="instance.engine !== 'pydantic'" class="agent-installation__actions">
                  <button type="button" class="btn btn--ghost btn--small" @click="editInstance(instance)">Editar</button>
                </div>
              </li>
            </ul>
            <agent-instance-editor v-if="instanceEditing" :app="app" :draft="instanceDraft" :identities="identities" :busy="instanceBusy" :error="instanceError" :can-manage-quota="canManageQuota" @save="saveInstance" @cancel="cancelInstanceEdit"></agent-instance-editor>
          </section>

          <div class="agent-panel__actions">
            <button type="button" class="btn btn--secondary btn--small" @click="openWizard"><app-icon name="layers"></app-icon> Abrir asistente de integración</button>
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
