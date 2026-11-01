(function () {
  'use strict';

  // Thin glue over the vendored vue-i18n global build (D1). Everything that
  // decides *which* message or format is used lives here: locale resolution,
  // the D11 bundle overlay, CLDR plurals and installation formats. There is no
  // second translation engine.
  const SOURCE_LOCALE = 'es';
  const BUILTIN_LOCALES = ['es', 'en'];
  const STORAGE_KEY = 'itsm.locale';
  const PLACEHOLDER_KEY = 'ui.i18n.text_unavailable';
  const NEUTRAL_PLACEHOLDER = { es: 'Texto no disponible', en: 'Text unavailable' };
  const DEFAULT_TIMEZONE = 'America/Asuncion';
  const DEFAULT_CURRENCY = 'PYG';

  const state = {
    catalogs: {},
    context: {},
    locales: [],
    localeSource: 'builtin',
    defaultLocale: SOURCE_LOCALE,
    timezone: DEFAULT_TIMEZONE,
    currency: DEFAULT_CURRENCY,
    userLocale: null,
    anonymous: null,
    bundles: {},
    misses: [],
    listeners: [],
    revision: 0,
    booted: false
  };

  let i18n = null;
  const inflight = new Map();
  // A tracked counter: catalog, locale-list and bundle changes bump it so a
  // component computed that reads it recomputes without a reload.
  const version = typeof window.Vue !== 'undefined' && window.Vue.ref ? window.Vue.ref(0) : { value: 0 };

  function bump() {
    version.value += 1;
  }

  function clone(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
  }

  function normalize(tag) {
    return typeof tag === 'string' ? tag.trim() : '';
  }

  function parentOf(tag) {
    const index = tag.indexOf('-');
    return index > 0 ? tag.slice(0, index) : '';
  }

  function hasCatalog(tag) {
    return Object.prototype.hasOwnProperty.call(state.catalogs, tag);
  }

  function engineLocales() {
    if (!i18n) return [];
    const value = i18n.global.availableLocales;
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.value)) return value.value;
    return [];
  }

  function installedLocales() {
    const tags = Object.keys(state.catalogs);
    state.locales.forEach(function (locale) { if (tags.indexOf(locale.tag) === -1) tags.push(locale.tag); });
    Object.keys(state.bundles).forEach(function (tag) { if (tags.indexOf(tag) === -1) tags.push(tag); });
    engineLocales().forEach(function (tag) { if (tags.indexOf(tag) === -1) tags.push(tag); });
    return tags;
  }

  // A regional variant is usable when its parent language is installed; the
  // vue-i18n fallback chain then resolves the parent catalog (D5).
  function isLocaleKnown(tag) {
    if (!tag) return false;
    if (hasCatalog(tag)) return true;
    const parent = parentOf(tag);
    if (parent && (hasCatalog(parent) || installedLocales().indexOf(parent) !== -1)) return true;
    return installedLocales().indexOf(tag) !== -1;
  }

  function activeLocale() {
    return i18n ? i18n.global.locale.value : SOURCE_LOCALE;
  }

  function pickLocale() {
    for (let index = 0; index < arguments.length; index += 1) {
      const candidate = normalize(arguments[index]);
      if (candidate && isLocaleKnown(candidate)) return candidate;
    }
    return SOURCE_LOCALE;
  }

  function fallbackChain(tag) {
    const chain = [];
    // The source locale is the last resort: it never falls back to another
    // language, so a Spanish miss shows the localized placeholder instead.
    if (tag === SOURCE_LOCALE) return chain;
    [parentOf(tag), state.defaultLocale, SOURCE_LOCALE].forEach(function (candidate) {
      if (candidate && candidate !== tag && chain.indexOf(candidate) === -1) chain.push(candidate);
    });
    return chain;
  }

  function pluralRuleFor(tag) {
    let rules = null;
    try { rules = new Intl.PluralRules(tag); } catch (_) { return null; }
    // CLDR order and the locale's own categories decide the form index, so a
    // message declaring `one | many | other` selects `many` for 1000000.
    const categories = rules.resolvedOptions().pluralCategories;
    return function pluralRule(choice, choicesLength) {
      const category = rules.select(Math.abs(Number(choice)) || 0);
      const index = categories.indexOf(category);
      if (choicesLength === categories.length) return index < 0 ? choicesLength - 1 : index;
      if (choicesLength <= 2) return category === 'one' ? 0 : 1;
      return index < 0 ? choicesLength - 1 : Math.min(index, choicesLength - 1);
    };
  }

  // vue-i18n reads `pluralRules[tag]`; the proxy generates the CLDR rule for any
  // installed tag without pre-registering a fixed list.
  const pluralRules = new Proxy({}, {
    get(target, property) {
      if (typeof property !== 'string') return undefined;
      if (!(property in target)) {
        const rule = pluralRuleFor(property);
        if (!rule) return undefined;
        target[property] = rule;
      }
      return target[property];
    }
  });

  function placeholderFor(tag) {
    const catalog = state.catalogs[tag] || state.catalogs[SOURCE_LOCALE] || {};
    return catalog[PLACEHOLDER_KEY] || NEUTRAL_PLACEHOLDER[tag] || NEUTRAL_PLACEHOLDER[SOURCE_LOCALE];
  }

  // D5: a missing key never renders the key. The neutral placeholder is read
  // from the catalog directly so the handler cannot recurse.
  function onMissing(locale, key) {
    state.misses.push({ locale: normalize(locale), key: normalize(key) });
    return placeholderFor(hasCatalog(activeLocale()) ? activeLocale() : SOURCE_LOCALE);
  }

  function unavailable() {
    return placeholderFor(hasCatalog(activeLocale()) ? activeLocale() : SOURCE_LOCALE);
  }

  function notify(tag) {
    state.listeners.slice().forEach(function (listener) {
      try { listener(tag); } catch (_) { /* a listener must not break the switch */ }
    });
  }

  function syncDocumentLang(tag) {
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (!root) return;
    if (typeof root.setAttribute === 'function') root.setAttribute('lang', tag);
    else root.lang = tag;
  }

  function assignRef(reference, value) {
    if (reference && typeof reference === 'object' && 'value' in reference) reference.value = value;
    return value;
  }

  function applyLocale(tag) {
    const target = isLocaleKnown(normalize(tag))
      ? normalize(tag)
      : (isLocaleKnown(state.defaultLocale) ? state.defaultLocale : SOURCE_LOCALE);
    if (!i18n) return target;
    if (i18n.global.locale.value !== target) i18n.global.locale.value = target;
    assignRef(i18n.global.fallbackLocale, fallbackChain(target));
    syncDocumentLang(target);
    bump();
    notify(target);
    if (!state.bundles[target]) loadBundle(target);
    return target;
  }

  function applyEffective() {
    return applyLocale(pickLocale(state.userLocale, state.anonymous, state.defaultLocale));
  }

  function installCatalogs(catalogs) {
    Object.keys(catalogs || {}).forEach(function (tag) {
      const messages = catalogs[tag];
      if (!messages || typeof messages !== 'object') return;
      state.catalogs[tag] = messages;
      if (i18n) i18n.global.setLocaleMessage(tag, clone(messages));
    });
    bump();
    if (!state.locales.length) {
      state.locales = Object.keys(state.catalogs).map(function (tag) {
        return { tag: tag, name: tag, nativeName: tag, provider: 'builtin' };
      });
    }
  }

  function mergeBundle(tag, payload) {
    const builtin = hasCatalog(tag) ? clone(state.catalogs[tag]) : {};
    const messages = payload && payload.messages && typeof payload.messages === 'object' ? payload.messages : {};
    const overrides = payload && payload.overrides && typeof payload.overrides === 'object' ? payload.overrides : {};
    // D11: fill-only pack entries lose against the built-in ui catalog and only
    // explicit overrides win over it.
    return Object.assign({}, clone(messages), builtin, clone(overrides));
  }

  function loadBundle(tag) {
    const target = normalize(tag) || activeLocale();
    if (inflight.has(target)) return inflight.get(target);
    const cached = state.bundles[target];
    const headers = { Accept: 'application/json' };
    if (cached && cached.etag) headers['If-None-Match'] = cached.etag;
    const promise = (async function () {
      if (typeof window.fetch !== 'function') return null;
      try {
        const response = await window.fetch('/api/v1/i18n/bundle?locale=' + encodeURIComponent(target), {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: headers
        });
        if (response.status === 304 && cached) return cached.messages;
        if (!response.ok) return null;
        const payload = await response.json();
        const merged = mergeBundle(target, payload);
        const etag = response.headers && typeof response.headers.get === 'function' ? response.headers.get('ETag') || '' : '';
        state.bundles[target] = { etag: etag, messages: merged, revision: payload && payload.revision ? payload.revision : 0 };
        if (i18n) i18n.global.setLocaleMessage(target, clone(merged));
        bump();
        notify(target);
        return merged;
      } catch (_) {
        return null;
      }
    })();
    const tracked = promise.then(function (value) {
      inflight.delete(target);
      return value;
    }, function () {
      inflight.delete(target);
      return null;
    });
    inflight.set(target, tracked);
    return tracked;
  }

  // Marks a locale as already resolved against the server (used by suites and by
  // a host that resolved the bundle elsewhere). Never used to invent overrides.
  function primeBundle(tag, messages) {
    const target = normalize(tag) || activeLocale();
    const merged = messages ? mergeBundle(target, { messages: messages }) : mergeBundle(target, null);
    state.bundles[target] = { etag: '', messages: merged, revision: state.revision };
    if (i18n) i18n.global.setLocaleMessage(target, clone(merged));
    bump();
    notify(target);
    return merged;
  }

  function applyLocales(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (typeof payload.defaultLocale === 'string' && payload.defaultLocale.trim()) state.defaultLocale = payload.defaultLocale.trim();
    const formats = payload.formats && typeof payload.formats === 'object' ? payload.formats : {};
    if (typeof formats.timezone === 'string' && formats.timezone.trim()) state.timezone = formats.timezone.trim();
    if (typeof formats.currency === 'string' && formats.currency.trim()) state.currency = formats.currency.trim().toUpperCase();
    if (Array.isArray(payload.locales) && payload.locales.length) {
      state.locales = payload.locales.filter(function (locale) {
        return locale && typeof locale.tag === 'string' && locale.tag.trim();
      }).map(function (locale) {
        const tag = locale.tag.trim();
        return {
          tag: tag,
          name: typeof locale.name === 'string' && locale.name.trim() ? locale.name.trim() : tag,
          nativeName: typeof locale.nativeName === 'string' && locale.nativeName.trim() ? locale.nativeName.trim() : tag,
          provider: typeof locale.provider === 'string' && locale.provider.trim() ? locale.provider.trim() : 'builtin'
        };
      });
      state.localeSource = 'server';
    }
    state.revision = Number(payload.revision) || 0;
    bump();
    return true;
  }

  async function loadLocales() {
    if (typeof window.fetch !== 'function') return null;
    try {
      const response = await window.fetch('/api/v1/i18n/locales', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return null;
      const payload = await response.json();
      applyLocales(payload);
      return payload;
    } catch (_) {
      return null;
    }
  }

  async function fetchBuiltinCatalogs() {
    if (typeof window.fetch !== 'function') return false;
    try {
      const responses = await Promise.all(BUILTIN_LOCALES.map(function (tag) {
        return window.fetch('assets/i18n/' + tag + '.json', { cache: 'no-store', headers: { Accept: 'application/json' } });
      }));
      const loaded = {};
      for (let index = 0; index < responses.length; index += 1) {
        if (!responses[index].ok) continue;
        loaded[BUILTIN_LOCALES[index]] = await responses[index].json();
      }
      if (!Object.keys(loaded).length) return false;
      installCatalogs(loaded);
      return true;
    } catch (_) {
      return false;
    }
  }

  function readPreference() {
    try {
      const value = normalize(window.localStorage.getItem(STORAGE_KEY));
      return value || null;
    } catch (_) {
      return null;
    }
  }

  function writePreference(tag) {
    try {
      window.localStorage.setItem(STORAGE_KEY, tag);
    } catch (_) { /* the preference lives in memory for this session */ }
  }

  function createInstance(locale) {
    const engine = window.VueI18n;
    if (!engine || typeof engine.createI18n !== 'function') return null;
    return engine.createI18n({
      legacy: false,
      globalInjection: true,
      flatJson: true,
      locale: locale,
      fallbackLocale: fallbackChain(locale),
      messages: {},
      missing: onMissing,
      missingWarn: false,
      fallbackWarn: false,
      pluralRules: pluralRules
    });
  }

  function translate(key, params, options) {
    if (!i18n || typeof key !== 'string' || !key) return unavailable();
    if (params === undefined || params === null) return i18n.global.t(key, {}, options);
    return i18n.global.t(key, params, options);
  }

  function has(key) {
    return Boolean(i18n) && typeof key === 'string' && Boolean(i18n.global.te(key));
  }

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function toDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function withTimeZone(options) {
    return Object.assign({ timeZone: state.timezone }, options || {});
  }

  // Exact options, installation timezone applied. Used where a caller needs a
  // style bundle (dateStyle/timeStyle) that cannot be merged with day/month/year.
  function stamp(value, options) {
    const parsed = toDate(value);
    if (!parsed) return '';
    return new Intl.DateTimeFormat(activeLocale(), withTimeZone(options || {})).format(parsed);
  }

  function number(value, options) {
    return new Intl.NumberFormat(activeLocale(), options || {}).format(toNumber(value));
  }

  function amount(value, options) {
    if (value === null || value === undefined || value === '') return '—';
    const settings = Object.assign({ style: 'currency', currency: state.currency, maximumFractionDigits: 0 }, options || {});
    return new Intl.NumberFormat(activeLocale(), settings).format(toNumber(value));
  }

  function date(value, options) {
    return stamp(value, Object.assign({ day: '2-digit', month: '2-digit', year: 'numeric' }, options || {}));
  }

  function datetime(value, options) {
    return stamp(value, Object.assign({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }, options || {}));
  }

  function time(value, options) {
    return stamp(value, Object.assign({ hour: '2-digit', minute: '2-digit' }, options || {}));
  }

  function collator(options) {
    return new Intl.Collator(activeLocale(), options || { sensitivity: 'base' });
  }

  function compare(left, right, options) {
    return collator(options).compare(String(left === null || left === undefined ? '' : left), String(right === null || right === undefined ? '' : right));
  }

  function setLocale(tag, options) {
    const target = normalize(tag);
    if (!target || !isLocaleKnown(target)) return activeLocale();
    if (options && options.persist) {
      state.anonymous = target;
      writePreference(target);
    }
    return applyLocale(target);
  }

  // D11 session envelope: locale, preferences.locale and installation formats
  // are additive; a missing envelope keeps the current effective locale.
  function applySession(envelope) {
    if (!envelope || typeof envelope !== 'object') return activeLocale();
    const installation = envelope.installation && typeof envelope.installation === 'object' ? envelope.installation : null;
    if (installation) {
      if (typeof installation.defaultLocale === 'string' && installation.defaultLocale.trim()) state.defaultLocale = installation.defaultLocale.trim();
      if (typeof installation.timezone === 'string' && installation.timezone.trim()) state.timezone = installation.timezone.trim();
      if (typeof installation.currency === 'string' && installation.currency.trim()) state.currency = installation.currency.trim().toUpperCase();
    }
    if (envelope.preferences && typeof envelope.preferences === 'object') {
      state.userLocale = normalize(envelope.preferences.locale) || null;
    } else {
      // The envelope may omit `preferences`; its `locale` is the locale the
      // server resolved, not a preference, so the anonymous choice survives.
      state.userLocale = null;
    }
    return applyEffective();
  }

  function clearSession() {
    state.userLocale = null;
    return applyEffective();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {};
    state.listeners.push(listener);
    return function () {
      const index = state.listeners.indexOf(listener);
      if (index >= 0) state.listeners.splice(index, 1);
    };
  }

  function localeName(tag) {
    const entry = (state.locales || []).find((item) => item && item.tag === tag);
    if (entry) return entry.nativeName || entry.name || entry.tag;
    const builtin = { es: 'Español', en: 'English' };
    return builtin[tag] || tag;
  }

  // One accessible language control for every shell surface: a native select
  // inside its own label, so keyboard, focus and the accessible name are the
  // platform's. It only asks the root to change the language; the root owns the
  // save scope (anonymous preference or the caller's profile).
  const LocaleSelect = {
    name: 'LocaleSelect',
    computed: {
      label() {
        version.value;
        return translate('ui.i18n.language');
      },
      active() {
        version.value;
        return activeLocale();
      },
      options() {
        version.value;
        return installedLocales().map((tag) => ({ tag: tag, name: localeName(tag) }));
      }
    },
    methods: {
      change(event) {
        const tag = (event && event.target && event.target.value) || '';
        const root = this.$root;
        if (root && typeof root.changeLocale === 'function') {
          root.changeLocale(tag);
          return;
        }
        setLocale(tag, { persist: true });
      }
    },
    template: '<label class="locale-select">'
      + '<span class="locale-select__label">{{ label }}</span>'
      + '<select class="locale-select__control" :value="active" @change="change">'
      + '<option v-for="option in options" :key="option.tag" :value="option.tag">{{ option.name }}</option>'
      + '</select>'
      + '</label>'
  };

  const api = {
    engine: null,
    ready: null,
    version: version,
    get i18n() { return i18n; },
    get catalogs() { return state.catalogs; },
    get context() { return state.context; },
    get locales() { return state.locales; },
    get localeSource() { return state.localeSource; },
    get activeLocale() { return activeLocale(); },
    get defaultLocale() { return state.defaultLocale; },
    get timezone() { return state.timezone; },
    get currency() { return state.currency; },
    get misses() { return state.misses; },
    get revision() { return state.revision; },
    installedLocales: installedLocales,
    isLocaleKnown: isLocaleKnown,
    install: function install(app) {
      if (app && typeof app.use === 'function' && i18n) app.use(i18n);
      return app;
    },
    t: translate,
    te: has,
    number: number,
    amount: amount,
    date: date,
    formatDate: stamp,
    datetime: datetime,
    time: time,
    collator: collator,
    compare: compare,
    setLocale: setLocale,
    loadBundle: loadBundle,
    primeBundle: primeBundle,
    localeName: localeName,
    LocaleSelect: LocaleSelect,
    loadLocales: loadLocales,
    applySession: applySession,
    clearSession: clearSession,
    subscribe: subscribe
  };

  function boot() {
    if (state.booted) return;
    state.booted = true;
    state.anonymous = readPreference();
    const initial = pickLocale(state.anonymous, SOURCE_LOCALE);
    i18n = createInstance(initial);
    api.engine = i18n;
    const preloaded = window.__ITSM_I18N_CATALOGS__;
    if (preloaded && preloaded.catalogs) {
      if (preloaded.context && typeof preloaded.context === 'object') state.context = preloaded.context;
      installCatalogs(preloaded.catalogs);
    }
    applyLocale(initial);
    api.ready = (async function () {
      if (!preloaded || !preloaded.catalogs) await fetchBuiltinCatalogs();
      await loadLocales();
      // Activation itself requests the overlay; a repeated boot must not add a
      // second bundle request for the same locale.
      applyEffective();
      return api;
    })();
  }

  window.ItsmI18n = api;
  boot();
})();
