/* Translator tools (S9/T7): locale coverage, missing keys with context,
 * export, validate/import and the custom translation layer.
 *
 * The server owns the registry, the precedence order and every write. The
 * browser registers the shipped `ui` source catalog (idempotent by content),
 * reads coverage, and reports the server's own validation problems. A custom
 * translation is stored in the custom layer, which a core update never
 * overwrites; after a write the shipped runtime reloads the affected bundle so
 * the change shows without a page reload.
 */
(function () {
  'use strict';

  const AppIcon = window.AppIcon;

  const PAGE_SIZE = 25;

  // Explicit map: keys are never built at runtime.
  const PROVIDER_KEYS = {
    core: 'ui.translations.provider.core',
    'ui-source': 'ui.translations.provider.ui_source',
    extension: 'ui.translations.provider.extension',
    'language-pack': 'ui.translations.provider.language_pack',
    custom: 'ui.translations.provider.custom'
  };

  // Registration is idempotent server-side and keyed by the catalog content, so
  // an unchanged shipped catalog is never re-sent within one page session. The
  // cache is scoped to the runtime instance, never to the module.
  const registrations = new WeakMap();

  function T(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : '';
  }

  function runtime() {
    return window.ItsmI18n || null;
  }

  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : (fallback || '');
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function integer(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  }

  function number(value, options) {
    const api = runtime();
    return api ? api.number(value, options) : String(value);
  }

  function knowsKey(key) {
    const api = runtime();
    return !!(api && key && api.te(key));
  }

  function providerLabel(kind) {
    const key = PROVIDER_KEYS[kind];
    return key ? T(key) : text(kind);
  }

  // The server localizes the problem message; `reasonKey` and the raw reason are
  // the documented fallbacks when it does not.
  function problemLabel(problem) {
    const item = object(problem);
    if (text(item.message)) return item.message;
    if (knowsKey(item.reasonKey)) return T(item.reasonKey);
    return text(item.reason);
  }

  function percentageLabel(value) {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? parsed : 0;
    return T('ui.translations.percent', { value: number(safe, { maximumFractionDigits: 2 }) });
  }

  function registrationCache(api) {
    let cache = registrations.get(api);
    if (!cache) {
      cache = new Map();
      registrations.set(api, cache);
    }
    return cache;
  }

  function catalogSignature(catalogs, context) {
    const json = JSON.stringify(catalogs) + JSON.stringify(context);
    let hash = 0x811c9dc5;
    for (let index = 0; index < json.length; index += 1) {
      hash ^= json.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16) + ':' + json.length;
  }

  function shippedCatalogs() {
    const api = runtime();
    if (!api) return null;
    const catalogs = object(api.catalogs);
    const es = object(catalogs.es);
    if (!Object.keys(es).length) return null;
    return { es: es, en: object(catalogs.en) };
  }

  // The runtime holds the translator context only when the host preloaded it, so
  // the shipped context file is read when it is missing.
  async function shippedContext() {
    const api = runtime();
    const local = api ? object(api.context) : {};
    if (Object.keys(local).length) return local;
    if (typeof window.fetch !== 'function') return {};
    try {
      const response = await window.fetch('assets/i18n/context.json', { cache: 'no-store' });
      if (!response || !response.ok) return {};
      return object(await response.json());
    } catch (error) {
      return {};
    }
  }

  const TranslationSettings = {
    name: 'TranslationSettings',
    components: { AppIcon, ModalShell: window.ModalShell },
    props: { app: { type: Object, required: true } },
    data() {
      return {
        disposed: false,
        epoch: 0,
        requestIdentity: '',
        lifecycle: null,
        loading: true,
        coverageError: '',
        coverage: null,
        namespaceChoices: [],
        namespace: '',
        missingLocale: '',
        missing: { loading: false, error: '', total: 0, limit: PAGE_SIZE, offset: 0, items: [] },
        // A semantic flag plus a message id keep the notice translatable: a
        // resolved string would freeze the language it failed in.
        sourceFailed: false,
        sourceNotice: '',
        sourceNoticeParams: { keys: 0, revision: 0 },
        exportForm: { locale: '', format: 'json', namespace: '' },
        exportBusy: false,
        exportError: '',
        importForm: { locale: '', format: 'json', content: '' },
        importBusy: false,
        importError: '',
        report: null,
        confirm: { open: false, kind: '', locale: '', key: '', title: '', message: '', busy: false, error: '' },
        // The live region keeps either a resolved sentence or a message id with
        // its parameters; only the id survives a locale switch.
        result: { text: '', notice: '', params: {} }
      };
    },
    computed: {
      sessionIdentity() {
        return String((this.app && this.app.activeUserId) || '') + '|' + String((this.app && this.app.csrfToken) || '');
      },
      canView() { return this.allows('system.view'); },
      canConfigure() { return this.allows('system.configure'); },
      revision() { return integer(object(this.coverage).revision); },
      sourceSummary() {
        return T('ui.translations.coverage.source_summary', { count: integer(object(object(this.coverage).source).total) });
      },
      // Reading the runtime version keeps the signature reactive: the shipped
      // catalogs arrive asynchronously and a changed catalog must re-register.
      uiSourceSignature() {
        const api = runtime();
        if (!api) return '';
        const version = api.version && typeof api.version === 'object' ? api.version.value : 0;
        const catalogs = shippedCatalogs();
        if (!catalogs) return '';
        return version >= 0 ? catalogSignature(catalogs, object(api.context)) : '';
      },
      rows() {
        return list(object(this.coverage).locales).map((row) => this.rowView(row));
      },
      namespaceOptions() {
        return [{ value: '', label: T('ui.translations.filters.all_namespaces') }].concat(
          this.namespaceChoices.map((value) => ({ value: value, label: value }))
        );
      },
      localeOptions() {
        return this.rows.map((row) => ({ value: row.tag, label: row.displayTag + ' · ' + row.nativeName }));
      },
      customRows() {
        return this.rows.filter((row) => row.entries > 0 || row.orphaned.length > 0);
      },
      importFormat() {
        return this.importForm.format === 'po' ? 'po' : 'json';
      },
      missingRangeLabel() {
        const offset = integer(this.missing.offset);
        const count = list(this.missing.items).length;
        return T('ui.translations.missing.page', { from: count ? offset + 1 : 0, to: offset + count, total: integer(this.missing.total) });
      },
      missingEnd() {
        return integer(this.missing.offset) + list(this.missing.items).length >= integer(this.missing.total);
      },
      problems() {
        return list(object(this.report).problems);
      },
      reportValid() {
        return object(this.report).valid === true;
      },
      reportCount() {
        return integer(object(this.report).entries);
      },
      problemsCount() {
        return this.problems.length;
      }
    },
    watch: {
      'app.authenticated'(value) {
        if (!value) this.dispose();
      },
      sessionIdentity() {
        if (this.app.authenticated && !this.disposed) this.reset();
      },
      uiSourceSignature(value) {
        if (value && this.canConfigure) void this.registerSource();
      }
    },
    created() {
      this.lifecycle = typeof AbortController === 'function' ? new AbortController() : null;
      void this.load();
    },
    beforeUnmount() {
      this.dispose();
    },
    methods: {
      allows(permission) {
        return !!(this.app && typeof this.app.can === 'function' && this.app.can(permission));
      },
      requestOptions() {
        return this.lifecycle ? { signal: this.lifecycle.signal } : {};
      },
      isCurrent(epoch) {
        return !this.disposed && epoch === this.epoch && this.requestIdentity === this.sessionIdentity;
      },
      errorText(error, fallback) {
        if (!error) return fallback;
        if (error.name === 'AbortError' || error.message === 'Solicitud cancelada.') return '';
        if (error.status === 403) return T('ui.translations.permission_denied');
        return text(error.message, fallback);
      },
      rowView(row) {
        const value = object(row);
        const tag = text(value.tag);
        const custom = object(value.custom);
        const providers = list(value.providers).filter((item) => item && text(item.kind));
        return {
          tag: tag,
          displayTag: text(value.displayTag, tag),
          name: text(value.name, tag),
          nativeName: text(value.nativeName, tag),
          source: value.source === true,
          total: integer(value.total),
          translated: integer(value.translated),
          percentage: percentageLabel(value.percentage),
          providersLabel: providers.map((item) => providerLabel(text(item.kind))).join(' · ') || T('ui.translations.providers.none'),
          entries: integer(custom.entries),
          orphaned: list(custom.orphaned)
            .filter((item) => item && text(item.key))
            .map((item) => ({ key: item.key, label: problemLabel(item) }))
        };
      },
      problemLabel(problem) {
        return problemLabel(problem);
      },
      clearView() {
        this.coverage = null;
        this.namespaceChoices = [];
        this.namespace = '';
        this.missingLocale = '';
        this.missing = { loading: false, error: '', total: 0, limit: PAGE_SIZE, offset: 0, items: [] };
        this.report = null;
        this.coverageError = '';
        this.importError = '';
        this.exportError = '';
        this.sourceFailed = false;
        this.sourceNotice = '';
        this.sourceNoticeParams = { keys: 0, revision: 0 };
        this.result = { text: '', notice: '', params: {} };
        this.confirm = { open: false, kind: '', locale: '', key: '', title: '', message: '', busy: false, error: '' };
      },
      // Announce an already resolved sentence; it replaces any semantic notice
      // so the live region always describes the latest outcome.
      announce(value) {
        this.result.notice = '';
        this.result.params = {};
        this.result.text = text(value);
      },
      reset() {
        if (this.lifecycle) this.lifecycle.abort();
        this.lifecycle = typeof AbortController === 'function' ? new AbortController() : null;
        this.epoch += 1;
        this.clearView();
        void this.load();
      },
      dispose() {
        this.disposed = true;
        this.epoch += 1;
        if (this.lifecycle) this.lifecycle.abort();
        this.clearView();
      },
      async load() {
        if (this.disposed) return;
        if (!this.canView) {
          this.loading = false;
          return;
        }
        const epoch = ++this.epoch;
        this.requestIdentity = this.sessionIdentity;
        this.loading = true;
        this.coverageError = '';
        await this.registerSource();
        if (!this.isCurrent(epoch)) return;
        await this.loadCoverage(epoch);
        if (this.isCurrent(epoch)) this.loading = false;
      },
      async reload() {
        if (this.disposed || !this.canView) return;
        const epoch = ++this.epoch;
        this.requestIdentity = this.sessionIdentity;
        this.loading = true;
        this.coverageError = '';
        await this.loadCoverage(epoch);
        if (this.isCurrent(epoch)) this.loading = false;
      },
      // Only an account that may configure the installation registers the
      // shipped catalog; the write is idempotent and audited server-side.
      async registerSource() {
        if (this.disposed || !this.canConfigure) return null;
        const api = runtime();
        const catalogs = shippedCatalogs();
        if (!api || !catalogs) return null;
        const context = await shippedContext();
        if (this.disposed) return null;
        const signature = catalogSignature(catalogs, context);
        const cache = registrationCache(api);
        const pending = cache.get(signature);
        if (pending) return pending;
        const request = window.AssetAccess.request(this.app, '/i18n/sources/ui', Object.assign({
          method: 'PUT',
          body: { catalogs: catalogs, context: context }
        }, this.requestOptions()));
        const promise = request.then((payload) => {
          const value = object(payload);
          cache.set(signature, Promise.resolve(value));
          if (!this.disposed) {
            this.sourceFailed = false;
            this.sourceNotice = value.changed === false
              ? 'ui.translations.source.unchanged'
              : 'ui.translations.source.registered';
            this.sourceNoticeParams = { keys: number(integer(value.keys)), revision: integer(value.revision) };
            // The live region keeps the message id too, so the announcement
            // follows the active locale instead of the one it happened in.
            this.result.notice = this.sourceNotice;
            this.result.params = this.sourceNoticeParams;
            this.result.text = '';
          }
          return value;
        }).catch(() => {
          cache.delete(signature);
          if (!this.disposed) {
            this.sourceNotice = '';
            this.sourceFailed = true;
          }
          return null;
        });
        cache.set(signature, promise);
        return promise;
      },
      async loadCoverage(epoch) {
        const query = new URLSearchParams();
        if (this.namespace) query.set('namespace', this.namespace);
        query.set('limit', '1');
        let payload = null;
        try {
          payload = await window.AssetAccess.request(this.app, '/i18n/coverage?' + query.toString(), this.requestOptions());
        } catch (error) {
          if (!this.isCurrent(epoch)) return;
          this.coverage = null;
          this.coverageError = this.errorText(error, T('ui.translations.coverage.failed'));
          return;
        }
        if (!this.isCurrent(epoch)) return;
        const value = object(payload);
        this.coverage = value;
        this.coverageError = '';
        if (!this.namespace) {
          this.namespaceChoices = Object.keys(object(object(value.source).namespaces)).sort();
        }
        this.syncSelection();
        await this.loadMissing(epoch);
      },
      syncSelection() {
        const rows = this.rows;
        const tags = rows.map((row) => row.tag);
        if (!tags.length) {
          this.missingLocale = '';
          this.missing = { loading: false, error: '', total: 0, limit: PAGE_SIZE, offset: 0, items: [] };
          return;
        }
        if (tags.indexOf(this.missingLocale) < 0) {
          const preferred = rows.find((row) => !row.source) || rows[0];
          this.missingLocale = preferred.tag;
          this.missing.offset = 0;
        }
        if (tags.indexOf(text(this.exportForm.locale)) < 0) this.exportForm.locale = this.missingLocale;
        if (tags.indexOf(text(this.importForm.locale)) < 0) this.importForm.locale = this.missingLocale;
      },
      async loadMissing(epoch) {
        if (!this.missingLocale) return;
        const query = new URLSearchParams();
        query.set('locale', this.missingLocale);
        query.set('limit', String(this.missing.limit));
        query.set('offset', String(this.missing.offset));
        if (this.namespace) query.set('namespace', this.namespace);
        this.missing.loading = true;
        this.missing.error = '';
        let payload = null;
        try {
          payload = await window.AssetAccess.request(this.app, '/i18n/coverage?' + query.toString(), this.requestOptions());
        } catch (error) {
          if (!this.isCurrent(epoch)) return;
          this.missing.loading = false;
          this.missing.error = this.errorText(error, T('ui.translations.missing.failed'));
          return;
        }
        if (!this.isCurrent(epoch)) return;
        const page = object(object(list(object(payload).locales)[0]).missing);
        this.missing = {
          loading: false,
          error: '',
          total: integer(page.total),
          limit: integer(page.limit) || this.missing.limit,
          offset: integer(page.offset),
          items: list(page.items).filter((item) => item && text(item.key)).map((item) => ({ key: item.key, context: text(item.context) }))
        };
      },
      changeNamespace(value) {
        this.namespace = text(value);
        this.missing.offset = 0;
        void this.reload();
      },
      changeMissingLocale(value) {
        this.missingLocale = text(value);
        this.missing.offset = 0;
        void this.loadMissing(this.epoch);
      },
      missingPrev() {
        this.missing.offset = Math.max(0, integer(this.missing.offset) - integer(this.missing.limit));
        void this.loadMissing(this.epoch);
      },
      missingNext() {
        if (this.missingEnd) return;
        this.missing.offset = integer(this.missing.offset) + integer(this.missing.limit);
        void this.loadMissing(this.epoch);
      },
      setExportLocale(value) { this.exportForm.locale = text(value); },
      setExportFormat(value) { this.exportForm.format = value === 'po' ? 'po' : 'json'; },
      setExportNamespace(value) { this.exportForm.namespace = text(value); },
      setImportLocale(value) { this.importForm.locale = text(value); },
      setImportFormat(value) { this.importForm.format = value === 'po' ? 'po' : 'json'; },
      setImportContent(value) { this.importForm.content = String(value == null ? '' : value); },
      async runExport() {
        if (!this.canView || this.exportBusy) return;
        const locale = text(this.exportForm.locale, this.missingLocale);
        if (!locale) return;
        const format = this.exportForm.format === 'po' ? 'po' : 'json';
        const namespace = text(this.exportForm.namespace);
        const query = new URLSearchParams();
        query.set('locale', locale);
        query.set('format', format);
        if (namespace) query.set('namespace', namespace);
        this.exportBusy = true;
        this.exportError = '';
        try {
          const blob = await window.AssetAccess.request(this.app, '/i18n/export?' + query.toString(), Object.assign({ responseType: 'blob' }, this.requestOptions()));
          if (this.disposed) return;
          const file = (namespace ? locale + '.' + namespace : locale) + '.' + format;
          this.saveBlob(blob, file);
        } catch (error) {
          if (this.disposed) return;
          this.exportError = this.errorText(error, T('ui.translations.export.failed'));
        } finally {
          if (!this.disposed) this.exportBusy = false;
        }
      },
      saveBlob(blob, file) {
        const canDownload = typeof URL !== 'undefined' &&
          typeof URL.createObjectURL === 'function' &&
          typeof document !== 'undefined' &&
          typeof document.createElement === 'function';
        if (!blob || !canDownload) {
          this.exportError = T('ui.translations.export.blocked');
          return false;
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file;
        if (typeof anchor.click === 'function') anchor.click();
        setTimeout(() => {
          try { URL.revokeObjectURL(url); } catch (error) { /* the download already owns the bytes */ }
        }, 0);
        this.announce(T('ui.translations.export.ready', { file: file }));
        return true;
      },
      readImportFile(event) {
        const input = event && event.target ? event.target : null;
        const file = input && input.files && input.files[0];
        if (!file) return;
        this.importError = '';
        if (typeof file.text !== 'function') {
          this.importError = T('ui.translations.import.file_failed');
          return;
        }
        file.text().then((content) => {
          if (!this.disposed) this.importForm.content = String(content || '');
        }).catch(() => {
          if (!this.disposed) this.importError = T('ui.translations.import.file_failed');
        });
      },
      applyReport(report, mode) {
        const value = object(report);
        this.report = value;
        const locale = text(value.locale, this.importForm.locale);
        if (mode === 'import') {
          this.announce(integer(value.applied)
            ? T('ui.translations.import.done', { locale: locale })
            : T('ui.translations.import.applied_none'));
          return;
        }
        this.announce(value.valid === true
          ? T('ui.translations.import.result_valid', { count: integer(value.entries) })
          : T('ui.translations.import.result_invalid', { count: list(value.problems).length }));
      },
      importBody() {
        return { locale: text(this.importForm.locale), format: this.importFormat, content: String(this.importForm.content || '') };
      },
      async validateImport() {
        if (!this.canView || this.importBusy) return;
        const body = this.importBody();
        if (!body.locale || !body.content.trim()) {
          this.importError = T('ui.translations.import.required');
          return;
        }
        this.importBusy = true;
        this.importError = '';
        try {
          const report = await window.AssetAccess.request(this.app, '/i18n/validate', Object.assign({ method: 'POST', body: body }, this.requestOptions()));
          if (this.disposed) return;
          this.applyReport(report, 'validate');
        } catch (error) {
          if (this.disposed) return;
          this.report = null;
          this.importError = this.errorText(error, T('ui.translations.import.validate_failed'));
        } finally {
          if (!this.disposed) this.importBusy = false;
        }
      },
      async importCatalog() {
        if (!this.canConfigure || this.importBusy) return;
        const body = this.importBody();
        if (!body.locale || !body.content.trim()) {
          this.importError = T('ui.translations.import.required');
          return;
        }
        this.importBusy = true;
        this.importError = '';
        try {
          const report = await window.AssetAccess.request(this.app, '/i18n/import', Object.assign({ method: 'POST', body: body }, this.requestOptions()));
          if (this.disposed) return;
          this.applyReport(report, 'import');
          await this.reloadBundle(text(object(report).locale, body.locale));
          if (this.disposed) return;
          await this.reload();
        } catch (error) {
          if (this.disposed) return;
          // D11: a rejected import returns the full report beside the error
          // envelope, so every problem is listed exactly as the validate path
          // does instead of only the summary message. Nothing is applied and no
          // bundle is reloaded.
          this.report = error && error.report && typeof error.report === 'object' ? error.report : null;
          this.importError = this.errorText(error, T('ui.translations.import.failed'));
        } finally {
          if (!this.disposed) this.importBusy = false;
        }
      },
      // A write bumps the registry revision, so the affected bundle is fetched
      // again and the active locale is re-applied without a page reload.
      async reloadBundle(locale) {
        const api = runtime();
        const tag = text(locale);
        if (!api || !tag) return null;
        const messages = await api.loadBundle(tag);
        if (api.activeLocale === tag) api.setLocale(tag);
        return messages;
      },
      askDelete(row, item) {
        if (!this.canConfigure) return;
        this.confirm = {
          open: true,
          kind: 'delete',
          locale: row.tag,
          key: item.key,
          busy: false,
          error: '',
          title: T('ui.translations.custom.delete_title', { key: item.key }),
          message: T('ui.translations.custom.delete_body', { locale: row.displayTag })
        };
      },
      askReset(row) {
        if (!this.canConfigure) return;
        this.confirm = {
          open: true,
          kind: 'reset',
          locale: row.tag,
          key: '',
          busy: false,
          error: '',
          title: T('ui.translations.custom.reset_title', { locale: row.displayTag }),
          message: T('ui.translations.custom.reset_body', { locale: row.displayTag })
        };
      },
      closeConfirm() {
        this.confirm.open = false;
      },
      async confirmRun() {
        if (!this.confirm.open || this.confirm.busy || !this.canConfigure) return;
        const kind = this.confirm.kind;
        const locale = this.confirm.locale;
        const key = this.confirm.key;
        const path = kind === 'delete'
          ? '/i18n/custom/' + encodeURIComponent(locale) + '/' + encodeURIComponent(key)
          : '/i18n/custom/' + encodeURIComponent(locale);
        this.confirm.busy = true;
        this.confirm.error = '';
        try {
          const payload = await window.AssetAccess.request(this.app, path, Object.assign({ method: 'DELETE' }, this.requestOptions()));
          if (this.disposed) return;
          const value = object(payload);
          this.confirm.open = false;
          this.announce(kind === 'delete'
            ? T('ui.translations.custom.deleted', { key: key })
            : T('ui.translations.custom.reset_done', { count: integer(value.deleted), locale: locale }));
          await this.reloadBundle(locale);
          if (this.disposed) return;
          await this.reload();
        } catch (error) {
          if (this.disposed) return;
          this.confirm.error = this.errorText(
            error,
            kind === 'delete' ? T('ui.translations.custom.delete_failed') : T('ui.translations.custom.reset_failed')
          );
        } finally {
          if (!this.disposed) this.confirm.busy = false;
        }
      }
    },
    template: `
      <section class="config-section translation-settings" aria-labelledby="translations-title">
        <header class="config-section__head">
          <div>
            <p class="eyebrow">{{ $t('ui.translations.eyebrow') }}</p>
            <h2 id="translations-title">{{ $t('ui.translations.title') }}</h2>
            <p>{{ $t('ui.translations.lead') }}</p>
          </div>
          <span class="config-badge"><app-icon name="layers"></app-icon> {{ $t('ui.translations.badge') }}</span>
        </header>

        <p v-if="!canView" class="agent-note agent-note--error" role="alert">{{ $t('ui.translations.no_view') }}</p>

        <template v-else>
          <p v-if="!canConfigure" class="agent-note">{{ $t('ui.translations.read_only') }}</p>
          <p class="agent-note translation-result" role="status" aria-live="polite">{{ result.notice ? $t(result.notice, result.params) : result.text }}</p>

          <section class="agent-panel" aria-labelledby="translations-coverage-title">
            <div class="agent-panel__head">
              <div>
                <h3 id="translations-coverage-title" class="agent-panel__title">{{ $t('ui.translations.coverage.title') }}</h3>
                <p class="agent-panel__sub">{{ $t('ui.translations.coverage.lead') }}</p>
              </div>
              <div class="agent-panel__actions">
                <button type="button" class="btn btn--secondary btn--small" @click="load">
                  <app-icon name="refresh"></app-icon>{{ $t('ui.translations.coverage.refresh') }}
                </button>
              </div>
            </div>

            <div class="field-grid">
              <div class="field">
                <label for="translations-namespace">{{ $t('ui.translations.filters.namespace') }}</label>
                <div class="input-shell">
                  <select id="translations-namespace" :value="namespace" @change="changeNamespace($event.target.value)">
                    <option v-for="option in namespaceOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </div>
              </div>
            </div>

            <dl class="access-facts">
              <div><dt>{{ $t('ui.translations.coverage.revision') }}</dt><dd class="mono">{{ revision }}</dd></div>
              <div><dt>{{ $t('ui.translations.coverage.source') }}</dt><dd>{{ sourceSummary }}</dd></div>
            </dl>

            <p v-if="sourceFailed" class="agent-note agent-note--error" role="alert">{{ $t('ui.translations.source.failed') }}</p>
            <p v-else-if="sourceNotice" class="agent-note">{{ $t(sourceNotice, sourceNoticeParams) }}</p>
            <p v-if="loading" class="agent-note" role="status">{{ $t('ui.translations.coverage.loading') }}</p>
            <p v-else-if="coverageError" class="agent-note agent-note--error" role="alert">{{ coverageError }}</p>
            <p v-else-if="!rows.length" class="agent-note">{{ $t('ui.translations.coverage.empty') }}</p>
            <div v-else class="translation-table-wrap">
              <table class="asset-table translation-table">
                <caption class="sr-only">{{ $t('ui.translations.coverage.caption') }}</caption>
                <thead>
                  <tr>
                    <th scope="col">{{ $t('ui.translations.column.locale') }}</th>
                    <th scope="col">{{ $t('ui.translations.column.native') }}</th>
                    <th scope="col">{{ $t('ui.translations.column.providers') }}</th>
                    <th scope="col">{{ $t('ui.translations.column.translated') }}</th>
                    <th scope="col">{{ $t('ui.translations.column.total') }}</th>
                    <th scope="col">{{ $t('ui.translations.column.percentage') }}</th>
                    <th scope="col">{{ $t('ui.translations.column.orphaned') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in rows" :key="row.tag">
                    <th scope="row" class="mono">
                      {{ row.displayTag }}
                      <span v-if="row.source" class="translation-tag">{{ $t('ui.translations.locale.source_tag') }}</span>
                    </th>
                    <td>{{ row.nativeName }}</td>
                    <td>{{ row.providersLabel }}</td>
                    <td class="mono">{{ row.translated }}</td>
                    <td class="mono">{{ row.total }}</td>
                    <td class="mono">{{ row.percentage }}</td>
                    <td class="mono">{{ row.orphaned.length }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="agent-panel" aria-labelledby="translations-missing-title">
            <div class="agent-panel__head">
              <div>
                <h3 id="translations-missing-title" class="agent-panel__title">{{ $t('ui.translations.missing.title') }}</h3>
                <p class="agent-panel__sub">{{ $t('ui.translations.missing.lead') }}</p>
              </div>
            </div>

            <div class="field-grid">
              <div class="field">
                <label for="translations-missing-locale">{{ $t('ui.translations.missing.locale') }}</label>
                <div class="input-shell">
                  <select id="translations-missing-locale" :value="missingLocale" @change="changeMissingLocale($event.target.value)">
                    <option v-for="option in localeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </div>
              </div>
            </div>

            <p v-if="missing.error" class="agent-note agent-note--error" role="alert">{{ missing.error }}</p>
            <p v-else-if="!missingLocale" class="agent-note">{{ $t('ui.translations.missing.choose_locale') }}</p>
            <p v-else-if="missing.loading" class="agent-note" role="status">{{ $t('ui.translations.missing.loading') }}</p>
            <template v-else>
              <p class="agent-note">{{ missingRangeLabel }}</p>
              <div v-if="missing.items.length" class="translation-table-wrap">
                <table class="asset-table translation-table">
                  <caption class="sr-only">{{ $t('ui.translations.missing.caption') }}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{{ $t('ui.translations.missing.key') }}</th>
                      <th scope="col">{{ $t('ui.translations.missing.context') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in missing.items" :key="item.key">
                      <th scope="row" class="mono">{{ item.key }}</th>
                      <td>{{ item.context || $t('ui.translations.missing.no_context') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="agent-note">{{ $t('ui.translations.missing.empty') }}</p>
              <div class="agent-panel__actions">
                <button type="button" class="btn btn--secondary btn--small" :disabled="missing.offset === 0" @click="missingPrev">
                  <app-icon name="arrow-left"></app-icon>{{ $t('ui.translations.missing.prev') }}
                </button>
                <button type="button" class="btn btn--secondary btn--small" :disabled="missingEnd" @click="missingNext">
                  {{ $t('ui.translations.missing.next') }}<app-icon name="arrow-right"></app-icon>
                </button>
              </div>
            </template>
          </section>

          <section class="agent-panel" aria-labelledby="translations-export-title">
            <div class="agent-panel__head">
              <div>
                <h3 id="translations-export-title" class="agent-panel__title">{{ $t('ui.translations.export.title') }}</h3>
                <p class="agent-panel__sub">{{ $t('ui.translations.export.lead') }}</p>
              </div>
            </div>

            <div class="field-grid">
              <div class="field">
                <label for="translations-export-locale">{{ $t('ui.translations.export.locale') }}</label>
                <div class="input-shell">
                  <select id="translations-export-locale" :value="exportForm.locale" @change="setExportLocale($event.target.value)">
                    <option v-for="option in localeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label for="translations-export-format">{{ $t('ui.translations.export.format') }}</label>
                <div class="input-shell">
                  <select id="translations-export-format" :value="exportForm.format" @change="setExportFormat($event.target.value)">
                    <option value="json">{{ $t('ui.translations.format.json') }}</option>
                    <option value="po">{{ $t('ui.translations.format.po') }}</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label for="translations-export-namespace">{{ $t('ui.translations.export.namespace') }}</label>
                <div class="input-shell">
                  <select id="translations-export-namespace" :value="exportForm.namespace" @change="setExportNamespace($event.target.value)">
                    <option v-for="option in namespaceOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </div>
                <p class="field__hint">{{ $t('ui.translations.export.namespace_hint') }}</p>
              </div>
            </div>

            <p class="agent-note">{{ $t('ui.translations.export.scope') }}</p>
            <p v-if="exportError" class="agent-note agent-note--error" role="alert">{{ exportError }}</p>
            <div class="agent-panel__actions">
              <button type="button" class="btn btn--primary btn--small" :disabled="exportBusy" @click="runExport">
                <app-icon name="download"></app-icon>{{ exportBusy ? $t('ui.translations.export.busy') : $t('ui.translations.export.submit') }}
              </button>
            </div>
          </section>

          <section class="agent-panel" aria-labelledby="translations-import-title">
            <div class="agent-panel__head">
              <div>
                <h3 id="translations-import-title" class="agent-panel__title">{{ $t('ui.translations.import.title') }}</h3>
                <p class="agent-panel__sub">{{ $t('ui.translations.import.lead') }}</p>
              </div>
            </div>

            <div class="field-grid">
              <div class="field">
                <label for="translations-import-locale">{{ $t('ui.translations.import.locale') }}</label>
                <div class="input-shell">
                  <select id="translations-import-locale" :value="importForm.locale" @change="setImportLocale($event.target.value)">
                    <option v-for="option in localeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label for="translations-import-format">{{ $t('ui.translations.import.format') }}</label>
                <div class="input-shell">
                  <select id="translations-import-format" :value="importForm.format" @change="setImportFormat($event.target.value)">
                    <option value="json">{{ $t('ui.translations.format.json') }}</option>
                    <option value="po">{{ $t('ui.translations.format.po') }}</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label for="translations-import-file">{{ $t('ui.translations.import.file') }}</label>
                <div class="input-shell input-shell--plain">
                  <input id="translations-import-file" type="file" accept=".json,.po,application/json,text/plain" @change="readImportFile">
                </div>
                <p class="field__hint">{{ $t('ui.translations.import.file_hint') }}</p>
              </div>
            </div>

            <div class="field">
              <label for="translations-import-content">{{ $t('ui.translations.import.content') }}</label>
              <textarea id="translations-import-content" class="translation-content" rows="8" spellcheck="false"
                        :value="importForm.content" :placeholder="$t('ui.translations.import.content_placeholder')"
                        @input="setImportContent($event.target.value)"></textarea>
            </div>

            <p v-if="importError" class="agent-note agent-note--error" role="alert">{{ importError }}</p>
            <div class="agent-panel__actions">
              <button type="button" class="btn btn--secondary btn--small" :disabled="importBusy" @click="validateImport">
                <app-icon name="check"></app-icon>{{ importBusy ? $t('ui.translations.import.validating') : $t('ui.translations.import.validate') }}
              </button>
              <button v-if="canConfigure" type="button" class="btn btn--primary btn--small" :disabled="importBusy" @click="importCatalog">
                <app-icon name="upload"></app-icon>{{ importBusy ? $t('ui.translations.import.importing') : $t('ui.translations.import.submit') }}
              </button>
            </div>

            <div v-if="report" class="translation-report">
              <p class="agent-note" :class="{ 'agent-note--error': !reportValid }">
                {{ reportValid ? $t('ui.translations.import.result_valid', { count: reportCount }) : $t('ui.translations.import.result_invalid', { count: problemsCount }) }}
              </p>
              <div v-if="problems.length" class="translation-table-wrap">
                <table class="asset-table translation-table">
                  <caption class="sr-only">{{ $t('ui.translations.problem.list_title') }}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{{ $t('ui.translations.problem.key') }}</th>
                      <th scope="col">{{ $t('ui.translations.problem.message') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="problem in problems" :key="problem.key + '|' + problem.reason">
                      <th scope="row" class="mono">{{ problem.key }}</th>
                      <td>{{ problemLabel(problem) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section class="agent-panel" aria-labelledby="translations-custom-title">
            <div class="agent-panel__head">
              <div>
                <h3 id="translations-custom-title" class="agent-panel__title">{{ $t('ui.translations.custom.title') }}</h3>
                <p class="agent-panel__sub">{{ $t('ui.translations.custom.lead') }}</p>
              </div>
            </div>

            <p v-if="!customRows.length" class="agent-note">{{ $t('ui.translations.custom.none') }}</p>
            <div v-for="row in customRows" :key="row.tag" class="translation-custom">
              <div class="translation-custom__head">
                <strong class="mono">{{ row.displayTag }}</strong>
                <span class="agent-note">{{ $t('ui.translations.custom.entries', { count: row.entries }) }}</span>
                <button v-if="canConfigure" :id="'translations-reset-' + row.tag" type="button" class="btn btn--ghost btn--small" @click="askReset(row)">
                  <app-icon name="restore"></app-icon>{{ $t('ui.translations.custom.reset') }}
                </button>
              </div>
              <p v-if="!row.orphaned.length" class="agent-note">{{ $t('ui.translations.custom.empty') }}</p>
              <template v-else>
                <p class="agent-note">{{ $t('ui.translations.custom.orphaned_lead') }}</p>
                <ul class="translation-custom__list">
                  <li v-for="item in row.orphaned" :key="item.key">
                    <span class="mono">{{ item.key }}</span>
                    <span class="translation-custom__reason">{{ item.label }}</span>
                    <button v-if="canConfigure" :id="'translations-delete-' + item.key" type="button" class="btn btn--ghost btn--small" @click="askDelete(row, item)">
                      <app-icon name="trash"></app-icon>{{ $t('ui.translations.custom.delete') }}
                    </button>
                  </li>
                </ul>
              </template>
            </div>
          </section>
        </template>

        <modal-shell :open="confirm.open" :title="confirm.title" :eyebrow="$t('ui.translations.confirm.eyebrow')" size="small" @close="closeConfirm">
          <div class="translation-confirm">
            <span class="translation-confirm__icon"><app-icon name="alert"></app-icon></span>
            <div>
              <p>{{ confirm.message }}</p>
              <p v-if="confirm.key" class="translation-confirm__key mono">{{ confirm.key }}</p>
            </div>
          </div>
          <p v-if="confirm.error" class="form-alert" role="alert"><app-icon name="alert"></app-icon> {{ confirm.error }}</p>
          <template #footer>
            <button type="button" class="btn btn--ghost" :disabled="confirm.busy" @click="closeConfirm">{{ $t('ui.common.cancel') }}</button>
            <button type="button" class="btn btn--danger" :disabled="confirm.busy" @click="confirmRun">
              {{ confirm.kind === 'delete' ? $t('ui.translations.custom.delete_confirm') : $t('ui.translations.custom.reset_confirm') }}
            </button>
          </template>
        </modal-shell>
      </section>
    `
  };

  window.AssetTranslationViews = { TranslationSettings };
})();
