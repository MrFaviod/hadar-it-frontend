(function () {
  'use strict';

  // FR-02: operational view bundles are ordered classic scripts, exactly like
  // the rest of the legacy runtime. Within a group the scripts are inserted one
  // at a time: a failed prerequisite stops the insertion of every dependent
  // script, so a later consumer never executes against a missing global.
  // Caches live per URL and per group: a shared in-flight load is reused, a
  // successful script is never executed twice, and only a failed request is
  // cleared for retry. Cross-group prerequisites are declared explicitly
  // instead of relying on the incidental render order of the login shell.
  function scanGroups() {
    const found = {};
    if (!document.querySelectorAll) return found;
    document.querySelectorAll('script[src][data-domain]').forEach((tag) => {
      const name = tag.getAttribute('data-domain');
      const src = tag.getAttribute('src');
      if (!name || !src) return;
      (found[name] || (found[name] = [])).push(src);
    });
    return found;
  }

  const groups = window.AssetLoaderGroups || scanGroups();
  // map/graph read the monitoring mixin while they evaluate; dashboard reads
  // Views.MonChart. The transfer data helpers stay in the eager login layer
  // because the dashboard exports CSV without opening the transfer UI.
  const dependencies = {
    map: ['monitor'],
    graph: ['monitor'],
    dashboard: ['monitor']
  };
  const scriptPromises = Object.create(null);
  const groupPromises = Object.create(null);
  const groupFailures = Object.create(null);
  const loaded = Object.create(null);

  function absolute(url) {
    try { return new URL(url, document.baseURI || window.location.href).href; }
    catch (_) { return url; }
  }

  function loadScript(url) {
    const target = absolute(url);
    if (scriptPromises[target]) return scriptPromises[target];
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.async = false;
      script.src = target;
      let evaluationError = null;
      const onError = (event) => {
        if (!event || !event.filename) return;
        if (absolute(event.filename) !== target) return;
        evaluationError = event.error || new Error('Script evaluation failed: ' + target);
      };
      const listen = typeof window.addEventListener === 'function';
      if (listen) window.addEventListener('error', onError, true);
      const cleanup = () => { if (listen && typeof window.removeEventListener === 'function') window.removeEventListener('error', onError, true); };
      script.onload = () => {
        cleanup();
        if (evaluationError) {
          delete scriptPromises[target];
          const failure = new Error('Script evaluation failed: ' + target);
          // A classic script cannot be un-evaluated: earlier statements may
          // already have registered globals or listeners, so retrying it in
          // place would repeat side effects. The group is unrecoverable and
          // the error card offers an explicit page reload instead.
          failure.unrecoverable = true;
          failure.cause = evaluationError;
          reject(failure);
          return;
        }
        loaded[target] = true;
        resolve(target);
      };
      script.onerror = () => {
        cleanup();
        delete scriptPromises[target];
        reject(new Error('Could not load ' + target));
      };
      (document.head || document.body).append(script);
    });
    scriptPromises[target] = promise;
    return promise;
  }

  function loadGroup(name) {
    if (groupPromises[name]) return groupPromises[name];
    if (groupFailures[name]) return Promise.reject(groupFailures[name]);
    const list = groups[name];
    if (!list || !list.length) return Promise.reject(new Error('Unknown view group: ' + name));
    const prerequisites = dependencies[name] || [];
    const promise = Promise.all(prerequisites.map(loadGroup)).then(async () => {
      for (const url of list) await loadScript(url);
      if (window.AssetWorkspaceRuntime && typeof window.AssetWorkspaceRuntime.wirePendingViews === 'function') {
        window.AssetWorkspaceRuntime.wirePendingViews();
      }
      return true;
    }).catch((error) => {
      if (error && error.unrecoverable) groupFailures[name] = error;
      if (groupPromises[name] === promise) delete groupPromises[name];
      throw error;
    });
    groupPromises[name] = promise;
    return promise;
  }

  function resolve(path) {
    return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), window);
  }

  const loadingView = {
    name: 'AssetDomainLoading',
    template: '<div data-domain-loading role="status" aria-live="polite" style="display:flex;align-items:center;gap:.5rem;padding:1rem;color:inherit;font-size:.9rem;opacity:.8">'
      + '<span aria-hidden="true" style="inline-size:.8rem;block-size:.8rem;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:asset-domain-spin .8s linear infinite"></span>'
      + '<span>{{ $t(\'ui.common.loading\') }}</span></div>'
  };

  const errorView = {
    name: 'AssetDomainError',
    props: { error: { type: Object, default: null } },
    emits: ['retry', 'reload'],
    computed: {
      unrecoverable() { return !!(this.error && this.error.unrecoverable); }
    },
    template: '<div data-domain-error role="alert" style="display:flex;flex-direction:column;gap:.5rem;padding:1rem;border:1px solid var(--color-border, #d5dbe1);border-radius:.5rem;background:var(--color-surface, transparent)">'
      + '<strong>{{ unrecoverable ? $t(\'ui.shell.domain_load_unrecoverable\') : $t(\'ui.shell.domain_load_failed\') }}</strong>'
      + '<code style="font-size:.8rem;overflow-wrap:anywhere">{{ error && error.message }}</code>'
      + '<button v-if="unrecoverable" type="button" class="text-button" @click="$emit(\'reload\')">{{ $t(\'ui.shell.domain_reload\') }}</button>'
      + '<button v-else type="button" class="text-button" @click="$emit(\'retry\')">{{ $t(\'ui.common.retry\') }}</button></div>'
  };

  // A missing view must never be dereferenced at registration time: the
  // resolver stays a function accessor until Vue renders the component. The
  // wrapper owns the async load itself (instead of defineAsyncComponent) so it
  // can expose the resolved child through one explicit public contract:
  // `$refs.workspaceView.realView` is the actual view instance, while `realView`
  // below unwraps the wrapper for every consumer of the ref.
  function component(group, path) {
    const existing = resolve(path);
    if (existing) return existing;
    if (!window.Vue || typeof window.Vue.h !== 'function') return null;
    return {
      name: 'AssetDeferredView',
      inheritAttrs: false,
      data() {
        return { resolved: null, loadError: null, loading: true, inner: null, attempt: 0, isAssetDeferredView: true };
      },
      computed: {
        realView() { return this.inner; }
      },
      created() { this.loadView(); },
      methods: {
        loadView() {
          const attempt = this.attempt;
          this.loading = true;
          this.loadError = null;
          return loadGroup(group).then(() => {
            if (attempt !== this.attempt) return;
            const view = resolve(path);
            if (!view) throw new Error('View ' + path + ' did not register after loading ' + group);
            this.resolved = window.Vue.markRaw ? window.Vue.markRaw(view) : view;
            this.loading = false;
          }).catch((error) => {
            if (attempt !== this.attempt) return;
            this.resolved = null;
            this.loadError = error;
            this.loading = false;
          });
        },
        retry() {
          this.attempt += 1;
          this.inner = null;
          return this.loadView();
        },
        reload() { if (window.location && typeof window.location.reload === 'function') window.location.reload(); },
        captureInner(view) { this.inner = view || null; }
      },
      render() {
        if (this.resolved) {
          return window.Vue.h(this.resolved, { ...this.$attrs, key: this.attempt, ref: this.captureInner }, this.$slots);
        }
        if (this.loadError) {
          return window.Vue.h(errorView, {
            error: this.loadError,
            onRetry: () => this.retry(),
            onReload: () => this.reload()
          });
        }
        return window.Vue.h(loadingView);
      }
    };
  }

  // Single public unwrap protocol for every `workspaceView`/`maintenanceCenter`
  // consumer: the deferred wrapper returns its mounted child, a static view is
  // returned unchanged and a missing ref stays null.
  function realView(ref) {
    if (!ref) return null;
    if (ref.isAssetDeferredView) return ref.realView || null;
    return ref;
  }

  window.AssetLoader = {
    groups,
    dependencies,
    loadGroup,
    component,
    realView,
    resolve,
    loaded
  };
})();
