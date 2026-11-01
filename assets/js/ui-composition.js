(function () {
  'use strict';

  // Validation copy is returned to the caller, which may render it outside the
  // mounted app: resolve it through the runtime, never through `this`.
  function tr(key, params) {
    return window.ItsmI18n ? window.ItsmI18n.t(key, params) : '';
  }

  // Runtime projection for SDK v2 `frontend.contributions`. The backend schema
  // is authoritative; this module only accepts the exact catalogue it ships and
  // renders declarative views. It never executes module code and it is never an
  // authorization source: `can` only hides affordances.

  const SDK_VERSION = 2;
  const ORDER_MIN = -10000;
  const ORDER_MAX = 10000;
  const MAX_CONTRIBUTIONS = 50;
  const ID_RE = /^[a-z][a-z0-9-]{1,47}$/;
  const PERMISSION_RE = /^ext_[a-z0-9_]+\.[a-z][a-z0-9_]{1,63}$/;

  const GROUPS = {
    nav: ['panel', 'inventory', 'conversation', 'maintenance', 'monitoring', 'infrastructure', 'datos', 'reports', 'warranties', 'labels', 'people', 'help', 'extensions'],
    page: ['panel', 'inventory', 'conversation', 'maintenance', 'monitoring', 'map', 'graph', 'datos', 'reports', 'warranties', 'labels', 'people', 'person', 'detail', 'incident', 'reportAsset', 'monitorDevice', 'monitorAlert', 'notifications', 'help'],
    widget: ['availability', 'alerts', 'distribution', 'infrastructure', 'activity', 'maintenance', 'warranties', 'inventory', 'latency', 'incidents'],
    'asset.panel': ['warranty', 'attachments', 'qr', 'relations', 'maintenance', 'monitoring', 'history'],
    'asset.action': ['edit', 'assign', 'return', 'transfer', 'ask', 'duplicate', 'change-status', 'restore', 'archive', 'retire', 'purge', 'delete'],
    config: ['apariencia', 'general', 'categorias', 'activos', 'sedes', 'personas', 'integraciones', 'relaciones', 'mantenimiento', 'supervision', 'alertas', 'notificaciones', 'mapas', 'datos', 'reportes', 'garantias', 'qr', 'etiquetas']
  };

  const CATALOGUE = Object.freeze(Object.keys(GROUPS).reduce(
    (all, prefix) => all.concat(GROUPS[prefix].map((name) => prefix + '.' + name)),
    []
  ));
  const KNOWN = new Set(CATALOGUE);
  // These surfaces stay core-owned. They are absent from the catalogue and can
  // never be named by a contribution, so administration stays reachable.
  const PROTECTED = Object.freeze([
    'nav.login', 'page.login', 'nav.users', 'nav.user', 'page.users', 'page.user',
    'nav.security', 'page.security', 'config.seguridad',
    'nav.extensions-review', 'nav.extensions-recovery', 'page.extensions',
    'config.extensiones', 'page.extensionsReview', 'page.extensionsRecovery',
    'nav.system', 'page.system', 'config.sistema', 'nav.config', '*'
  ]);

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function isKnownTarget(target) {
    return typeof target === 'string' && KNOWN.has(target);
  }

  function isProtectedTarget(target) {
    return typeof target === 'string' && (PROTECTED.indexOf(target) !== -1 || /^nav\.(?:login|users|user|security|system|config)$/.test(target) || /^config\.(?:seguridad|extensiones|sistema)$/.test(target) || /^page\.(?:login|users|user|security|extensions|system)$/.test(target));
  }

  function groupOf(target) {
    if (typeof target !== 'string') return '';
    return target.split('.')[0];
  }

  function declaredPermissions(item) {
    const codes = new Set();
    const manifest = (item && item.manifest) || {};
    (Array.isArray(item && item.permissions) ? item.permissions : []).forEach((permission) => {
      if (permission && typeof permission.code === 'string') codes.add(permission.code);
    });
    (Array.isArray(manifest.permissions) ? manifest.permissions : []).forEach((permission) => {
      if (permission && typeof permission.code === 'string') codes.add(permission.code);
    });
    (Array.isArray(item && item.operations) ? item.operations : []).forEach((operation) => {
      if (operation && typeof operation.permission === 'string') codes.add(operation.permission);
    });
    (Array.isArray(manifest.operations) ? manifest.operations : []).forEach((operation) => {
      if (operation && typeof operation.permission === 'string') codes.add(operation.permission);
    });
    return codes;
  }

  function normalize(raw, item, seen) {
    const fail = (error) => ({ ok: false, error });
    if (!isPlainObject(raw)) return fail('La contribución no es un objeto válido.');
    const id = text(raw.id);
    if (!ID_RE.test(id)) return fail('La contribución tiene un id no válido.');
    if (seen && seen.has(id)) return fail('La contribución repite el id "' + id + '".');
    const label = text(raw.label);
    if (!label || label.length > 120) return fail('La contribución "' + id + '" necesita una etiqueta breve.');
    const target = text(raw.target);
    if (isProtectedTarget(target)) return fail('El destino "' + target + '" pertenece al núcleo y no se puede componer.');
    if (!isKnownTarget(target)) return fail('El destino "' + target + '" no existe en el catálogo consumido.');
    const mode = text(raw.mode);
    if (mode !== 'add' && mode !== 'hide') return fail('La contribución "' + id + '" usa un modo no válido.');
    const permission = text(raw.permission);
    if (!PERMISSION_RE.test(permission)) return fail('La contribución "' + id + '" necesita un permiso de extensión válido.');
    if (!declaredPermissions(item).has(permission)) {
      return fail('El permiso "' + permission + '" no está declarado por la extensión.');
    }
    const order = raw.order === undefined || raw.order === null ? 0 : raw.order;
    if (!Number.isInteger(order) || order < ORDER_MIN || order > ORDER_MAX) {
      return fail('La contribución "' + id + '" usa un orden fuera de rango.');
    }
    let view = null;
    if (mode === 'hide') {
      if (raw.view !== undefined || raw.component !== undefined) {
        return fail('La contribución "' + id + '" oculta un destino y no puede declarar contenido.');
      }
      if (groupOf(target) === 'nav' && target === 'nav.extensions') {
        return fail('El acceso a extensiones no se puede ocultar.');
      }
    } else {
      if (groupOf(target) === 'nav') {
        return fail(tr('ui.shell.composition_nav_error'));
      }
      if (raw.component !== undefined) {
        return fail('El módulo no puede registrar componentes privados: declara una vista.');
      }
      const checked = window.ExtensionViews && typeof window.ExtensionViews.normalizeView === 'function'
        ? window.ExtensionViews.normalizeView(raw.view, (item && item.operations) || [])
        : { ok: false, error: 'El host no admite vistas declarativas.' };
      if (!checked.ok) return fail('La contribución "' + id + '" no declara una vista válida. ' + checked.error);
      view = checked.value;
    }
    if (target === 'nav.extensions' && mode !== 'add') {
      return fail('El grupo de extensiones solo admite contribuciones añadidas.');
    }
    return {
      ok: true,
      value: {
        id,
        label,
        target,
        mode,
        permission,
        order,
        view,
        extensionId: text(item && item.id),
        key: text(item && item.id) + ':' + id
      }
    };
  }

  function contributionList(item) {
    if (Array.isArray(item.contributions)) return item.contributions;
    return [];
  }

  function project(items, can) {
    const projection = { additions: {}, hidden: {}, replacement: {}, ignored: [], candidates: [] };
    const members = Array.isArray(items) ? items : [];
    const seen = new Set();
    members.forEach((item) => {
      if (!item || !item.enabled || item.invalid || item.requiresUpgrade) return;
      contributionList(item).slice(0, MAX_CONTRIBUTIONS).forEach((contribution) => {
        if (!contribution || seen.has(contribution.key)) return;
        seen.add(contribution.key);
        projection.candidates.push(contribution);
        if (typeof can === 'function' && !can(contribution.permission)) {
          projection.ignored.push({ key: contribution.key, reason: 'permission' });
          return;
        }
        const target = contribution.target;
        if (contribution.mode === 'hide') {
          if (!projection.hidden[target]) {
            projection.hidden[target] = { extensionId: contribution.extensionId, contributionId: contribution.id };
          }
          return;
        }
        if (!projection.additions[target]) projection.additions[target] = [];
        projection.additions[target].push({
          key: contribution.key,
          extensionId: contribution.extensionId,
          contributionId: contribution.id,
          label: contribution.label,
          order: contribution.order,
          item,
          view: contribution.view
        });
      });
    });
    Object.keys(projection.additions).forEach((target) => {
      projection.additions[target].sort((left, right) =>
        left.order - right.order ||
        (left.extensionId < right.extensionId ? -1 : left.extensionId > right.extensionId ? 1 : 0) ||
        (left.contributionId < right.contributionId ? -1 : left.contributionId > right.contributionId ? 1 : 0)
      );
    });
    return projection;
  }

  function coverage() {
    return { targets: CATALOGUE.length, catalogue: CATALOGUE.length, total: CATALOGUE.length, entries: CATALOGUE.slice() };
  }

  function projectionFor(app) {
    const projection = app && app.extensionComposition;
    if (projection && projection.additions) return projection;
    return project(app && app.extensions ? app.extensions.items : [], app && typeof app.can === 'function' ? app.can.bind(app) : null);
  }

  function entriesFor(app, target) {
    return projectionFor(app).additions[target] || [];
  }

  function replacementsFor() {
    return [];
  }

  function isHidden(app, target) {
    const projection = projectionFor(app);
    return !!projection.hidden[target];
  }

  const UICompositionBoundary = {
    name: 'UICompositionBoundary',
    components: window.ExtensionViews ? { ExtensionView: window.ExtensionViews.components.ExtensionView } : {},
    props: {
      app: { type: Object, required: true },
      target: { type: String, required: true }
    },
    computed: {
      hidden() { return isHidden(this.app, this.target); },
      additions() { return entriesFor(this.app, this.target); }
    },
    template: `
      <div class="ui-composition-boundary">
        <template v-if="hidden"><p class="ui-composition-fallback" role="status">{{ $t('ui.shell.composition_hidden') }}</p></template>
        <slot v-else></slot>
        <div v-if="additions.length" class="ui-composition-additions">
          <extension-view v-for="entry in additions" :key="entry.key" :app="app" :item="entry.item" :view="entry.view"></extension-view>
        </div>
      </div>
    `
  };

  const UICompositionSlot = {
    name: 'UICompositionSlot',
    components: window.ExtensionViews ? { ExtensionView: window.ExtensionViews.components.ExtensionView } : {},
    props: {
      app: { type: Object, required: true },
      target: { type: String, required: true },
      asset: { type: Object, default: null }
    },
    computed: {
      hidden() { return isHidden(this.app, this.target); },
      additions() { return entriesFor(this.app, this.target); }
    },
    template: `
      <div class="ui-composition-slot">
        <template v-if="hidden"></template>
        <slot v-else></slot>
        <extension-view v-for="entry in additions" :key="entry.key" :app="app" :item="entry.item" :view="entry.view" :asset="asset"></extension-view>
      </div>
    `
  };

  const UICompositionNavItem = {
    name: 'UICompositionNavItem',
    props: {
      app: { type: Object, required: true },
      target: { type: String, required: true }
    },
    computed: {
      hidden() { return isHidden(this.app, this.target); }
    },
    render() {
      if (this.hidden) return null;
      const slot = this.$slots && typeof this.$slots.default === 'function' ? this.$slots.default() : null;
      return slot && slot.length ? slot : null;
    }
  };

  const UICompositionNavAdditions = {
    name: 'UICompositionNavAdditions',
    props: {
      app: { type: Object, required: true },
      target: { type: String, default: 'nav.extensions' }
    },
    computed: {
      additions() { return entriesFor(this.app, this.target); }
    },
    template: `
      <div v-if="additions.length" class="ui-composition-nav-additions">
        <p v-for="entry in additions" :key="entry.key" class="cell-note">{{ $t('ui.shell.composition_no_links', { label: entry.label }) }}</p>
      </div>
    `
  };

  const UICompositionWidgetEntry = {
    name: 'UICompositionWidgetEntry',
    components: window.ExtensionViews ? { ExtensionView: window.ExtensionViews.components.ExtensionView } : {},
    props: {
      app: { type: Object, required: true },
      entry: { type: Object, required: true }
    },
    template: `
      <section class="noc-widget ui-composition-entry" :aria-label="entry.label">
        <header class="panel-head">
          <div><p class="eyebrow">{{ $t('ui.page.extension') }}</p><h2>{{ entry.label }}</h2></div>
          <span class="chip chip--muted">{{ entry.extensionId }}</span>
        </header>
        <extension-view :app="app" :item="entry.item" :view="entry.view"></extension-view>
      </section>
    `
  };

  const UICompositionWidgets = {
    name: 'UICompositionWidgets',
    components: { UiCompositionWidgetEntry: UICompositionWidgetEntry },
    props: {
      app: { type: Object, required: true }
    },
    computed: {
      entries() { return entriesFor(this.app, 'widget.alerts').concat(entriesFor(this.app, 'widget.availability'), entriesFor(this.app, 'widget.activity')); }
    },
    template: `
      <div v-if="entries.length" class="ui-composition-widgets">
        <ui-composition-widget-entry v-for="entry in entries" :key="entry.key" :app="app" :entry="entry"></ui-composition-widget-entry>
      </div>
    `
  };

  const mixin = {
    computed: {
      uiProjection() {
        return projectionFor(this);
      },
      uiNavHidden() {
        const projection = this.uiProjection;
        return (id) => !!(projection && projection.hidden && projection.hidden['nav.' + id]);
      }
    },
    methods: {
      uiTargetsFor(target) {
        return entriesFor(this, target);
      }
    }
  };

  window.UIComposition = {
    sdkVersion: SDK_VERSION,
    GROUPS: Object.freeze(GROUPS),
    CATALOGUE,
    coverage,
    normalize,
    project,
    projectionFor,
    entriesFor,
    replacementsFor,
    isKnownTarget,
    isProtectedTarget,
    mixin,
    components: {
      UICompositionBoundary,
      UICompositionSlot,
      UICompositionNavItem,
      UICompositionNavAdditions,
      UICompositionWidgets,
      UICompositionWidgetEntry,
      CompositionBoundary: UICompositionBoundary,
      CompositionSlot: UICompositionSlot,
      CompositionNavItem: UICompositionNavItem,
      CompositionNavAdditions: UICompositionNavAdditions,
      UiCompositionWidgets: UICompositionWidgets,
      UiCompositionWidgetEntry: UICompositionWidgetEntry,
      CompositionWidgets: UICompositionWidgets,
      CompositionWidgetEntry: UICompositionWidgetEntry
    }
  };
})();
