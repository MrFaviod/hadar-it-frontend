(function () {
  'use strict';

  // Runtime projection for SDK v1 `frontend.contributions`. The backend schema
  // is authoritative; this module only accepts the exact catalogue it ships,
  // filters it at runtime and renders trusted Vue components through the host
  // registry. It is never an authorization source: `can` only hides affordances.

  const SDK_VERSION = 1;
  const ORDER_MIN = -10000;
  const ORDER_MAX = 10000;
  const MAX_CONTRIBUTIONS = 50;
  const ID_RE = /^[a-z][a-z0-9-]{1,47}$/;
  const COMPONENT_RE = /^[A-Z][A-Za-z0-9]{1,63}$/;
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

  // Normalized runtime items carry `contributions`. A manifest-only item is
  // accepted too so a host can project the same contract before its module
  // finishes loading; unregistered components are still ignored above.
  function contributionList(item) {
    if (Array.isArray(item.contributions)) return item.contributions;
    const frontend = item.manifest && item.manifest.frontend;
    const raw = frontend && Array.isArray(frontend.contributions) ? frontend.contributions : [];
    const seen = new Set();
    const valid = [];
    raw.slice(0, MAX_CONTRIBUTIONS).forEach((entry) => {
      const checked = normalize(entry, item, seen);
      if (checked.ok) {
        seen.add(checked.value.id);
        valid.push(checked.value);
      }
    });
    return valid;
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
    if (['add', 'hide', 'replace'].indexOf(mode) === -1) return fail('La contribución "' + id + '" usa un modo no válido.');
    const permission = text(raw.permission);
    if (!PERMISSION_RE.test(permission)) return fail('La contribución "' + id + '" necesita un permiso de extensión válido.');
    if (!declaredPermissions(item).has(permission)) {
      return fail('El permiso "' + permission + '" no está declarado por la extensión.');
    }
    const component = text(raw.component);
    if (mode === 'hide') {
      if (component) return fail('La contribución "' + id + '" oculta un destino y no puede declarar componente.');
    } else if (!COMPONENT_RE.test(component)) {
      return fail('La contribución "' + id + '" necesita un componente registrado válido.');
    }
    const order = raw.order === undefined || raw.order === null ? 0 : raw.order;
    if (!Number.isInteger(order) || order < ORDER_MIN || order > ORDER_MAX) {
      return fail('La contribución "' + id + '" usa un orden fuera de rango.');
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
        component: mode === 'hide' ? '' : component,
        icon: text(raw.icon) || 'package',
        order
      }
    };
  }

  function compare(left, right) {
    if (left.order !== right.order) return left.order - right.order;
    if (left.extensionId !== right.extensionId) return left.extensionId < right.extensionId ? -1 : 1;
    if (left.contributionId !== right.contributionId) return left.contributionId < right.contributionId ? -1 : 1;
    return 0;
  }

  // A failed render is recorded per declaration, never per target, so the
  // projection keeps the core surface until a working module registers again.
  function entryKey(entry) {
    return entry.extensionId + ':' + entry.contributionId;
  }

  // Pure projection: no component is registered and nothing is mutated here.
  // `resolveComponent` is the host registry; a declaration whose component is
  // not registered yet is ignored so the core surface keeps working.
  // `failed` is the host's per-declaration render-failure map: a replacement
  // that could not render stops suppressing the core surface.
  function project(items, can, resolveComponent, failed) {
    const additions = Object.create(null);
    const hidden = Object.create(null);
    const replacement = Object.create(null);
    const ignored = [];
    const candidates = [];
    const authorize = typeof can === 'function' ? can : function () { return false; };
    const resolve = typeof resolveComponent === 'function' ? resolveComponent : null;

    (Array.isArray(items) ? items : []).forEach((item) => {
      if (!item || !item.enabled || item.invalid) return;
      // A hide-only module declares no component, so the host never fetches or
      // executes its script. Non-hide declarations still need a registered
      // component below.
      const needsScript = Array.isArray(item.declaredComponents) ? item.declaredComponents.length > 0 : true;
      if (!item.loaded && needsScript) return;
      const extensionId = text(item.id) || text(item.manifest && item.manifest.id);
      if (!extensionId) return;
      const extensionName = text(item.manifest && item.manifest.name) || extensionId;
      contributionList(item).slice(0, MAX_CONTRIBUTIONS).forEach((entry) => {
        if (!entry || !isKnownTarget(entry.target)) return;
        const record = {
          extensionId,
          extensionName,
          contributionId: entry.id,
          label: entry.label,
          target: entry.target,
          mode: entry.mode,
          component: entry.component || '',
          permission: entry.permission,
          icon: entry.icon || 'package',
          order: entry.order === undefined ? 0 : entry.order
        };
        if (!PERMISSION_RE.test(record.permission) || !declaredPermissions(item).has(record.permission)) {
          ignored.push({ ...record, reason: 'permission-not-declared' });
          return;
        }
        if (!authorize(record.permission)) {
          ignored.push({ ...record, reason: 'unauthorized' });
          return;
        }
        if (record.mode !== 'hide' && (!resolve || !resolve(record.component))) {
          ignored.push({ ...record, reason: 'component-unavailable' });
          return;
        }
        if (record.mode !== 'hide' && failed && failed[entryKey(record)]) {
          ignored.push({ ...record, reason: 'component-failed' });
          return;
        }
        candidates.push(record);
      });
    });

    candidates.sort(compare);
    candidates.forEach((entry) => {
      if (entry.mode === 'add') {
        (additions[entry.target] || (additions[entry.target] = [])).push(entry);
        return;
      }
      if (hidden[entry.target] || replacement[entry.target]) return;
      if (entry.mode === 'hide') hidden[entry.target] = entry;
      else replacement[entry.target] = entry;
    });

    return { additions, hidden, replacement, ignored, candidates };
  }

  function coverage() {
    return Object.freeze({ declared: CATALOGUE.length, wired: CATALOGUE.length, missing: [] });
  }

  function entriesFor(projection, group) {
    const prefix = group ? group + '.' : '';
    return (projection ? projection.candidates : []).filter((entry) =>
      entry.mode === 'add' && (!prefix || entry.target.indexOf(prefix) === 0)
    );
  }

  // Winning replacements for one group, in the same deterministic order as the
  // additions so a host list can render both without extra sorting.
  function replacementsFor(projection, group) {
    const prefix = group ? group + '.' : '';
    const winners = (projection && projection.replacement) || {};
    return Object.keys(winners)
      .filter((target) => !prefix || target.indexOf(prefix) === 0)
      .map((target) => winners[target])
      .sort(compare);
  }

  function reportFailure(app, entry) {
    if (!entry || !window.AssetExtensions || typeof window.AssetExtensions.compositionFailure !== 'function') return false;
    return window.AssetExtensions.compositionFailure(app, entry) === true;
  }

  function componentFor(name) {
    if (window.AssetExtensions && typeof window.AssetExtensions.componentFor === 'function') {
      return window.AssetExtensions.componentFor(name);
    }
    return null;
  }

  function sdkFor(app, entry) {
    if (!app || !entry || !window.AssetExtensions) return null;
    const state = app.extensions || {};
    const item = (state.items || []).find((candidate) => candidate.id === entry.extensionId);
    if (!item || typeof window.AssetExtensions.sdkFor !== 'function') return null;
    return window.AssetExtensions.sdkFor(app, item);
  }

  // The context asset is a live host object. Extensions receive the deep-frozen
  // copy the host already produces for asset panels through `readonlyAsset`,
  // so a slot or boundary can never mutate inventory state. Until the host
  // helper is available no asset is projected, matching `sdkFor`.
  function readonlyContextAsset(context) {
    const asset = context && context.asset;
    if (!asset || typeof asset !== 'object') return null;
    const host = window.AssetExtensions;
    if (!host || typeof host.readonlyAsset !== 'function') return null;
    return host.readonlyAsset(asset);
  }

  function projectionFor(app) {
    const state = (app && app.extensions) || {};
    const can = app && typeof app.can === 'function' ? app.can.bind(app) : null;
    const failed = state.compositionFailures;
    return project(state.items || [], can, componentFor, failed && typeof failed === 'object' ? failed : null);
  }

  const mixin = {
    computed: {
      uiProjection() {
        return projectionFor(this);
      }
    },
    methods: {
      uiTargetsFor(target) {
        const projection = this.uiProjection;
        return {
          hidden: !!projection.hidden[target],
          replacement: projection.replacement[target] || null,
          additions: projection.additions[target] || []
        };
      },
      uiNavHidden(target) {
        return !!this.uiProjection.hidden[target];
      }
    }
  };

  function entryProps(entry) {
    return {
      key: entry.extensionId + ':' + entry.contributionId,
      'aria-label': entry.label,
      'data-extension-id': entry.extensionId,
      'data-target': entry.target
    };
  }

  const UICompositionBoundary = {
    name: 'UICompositionBoundary',
    props: {
      app: { type: Object, required: true },
      target: { type: String, default: '' },
      context: { type: Object, default: () => ({}) }
    },
    data() {
      return { failed: false };
    },
    computed: {
      projection() { return projectionFor(this.app); },
      hidden() { return this.target ? this.projection.hidden[this.target] || null : null; },
      replacement() { return this.target ? this.projection.replacement[this.target] || null : null; },
      additions() { return (this.target && this.projection.additions[this.target]) || []; },
      replacementComponent() { return this.replacement ? componentFor(this.replacement.component) : null; },
      asset() { return readonlyContextAsset(this.context); }
    },
    methods: {
      entryProps,
      componentFor,
      sdkFor(entry) { return sdkFor(this.app, entry); }
    },
    errorCaptured() {
      this.failed = true;
      return false;
    },
    template: `
      <div class="ui-composition-boundary" :data-target="target || null">
        <template v-if="!failed && replacement && replacementComponent">
          <component :is="replacementComponent" :sdk="sdkFor(replacement)" :asset="asset"></component>
        </template>
        <div v-else-if="!failed && hidden" class="ui-composition-fallback" role="status">
          <app-icon name="info"></app-icon>
          <p>Esta sección está ocultada por la extensión <strong>{{ hidden.extensionName }}</strong>. Los permisos y las operaciones del servidor no cambian.</p>
        </div>
        <template v-else><slot></slot></template>
        <div v-if="additions.length" class="ui-composition-additions">
          <section v-for="entry in additions" :key="entryProps(entry).key" class="ui-composition-entry"
                   :aria-label="entry.label" :data-extension-id="entry.extensionId" :data-target="entry.target">
            <component v-if="componentFor(entry.component)" :is="componentFor(entry.component)"
                       :sdk="sdkFor(entry)" :asset="asset"></component>
          </section>
        </div>
      </div>
    `
  };

  // `permitted` carries the core permission and asset-state condition the shipped
  // template already applies to this surface. The default slot keeps rendering
  // its own core content (and its own `v-if`), so a denied permission, an
  // archived/retired asset or the other asset mode never becomes visible through
  // a replacement, a hide or an addition. Duplicated declarations of one target
  // pass mutually exclusive conditions and render at most one replacement.
  const UICompositionSlot = {
    name: 'UICompositionSlot',
    props: {
      app: { type: Object, required: true },
      target: { type: String, required: true },
      context: { type: Object, default: () => ({}) },
      permitted: { type: Boolean, default: true },
      substitute: { type: Boolean, default: true }
    },
    data() {
      return { failed: false };
    },
    computed: {
      projection() { return projectionFor(this.app); },
      hidden() { return this.projection.hidden[this.target] || null; },
      replacement() { return this.projection.replacement[this.target] || null; },
      additions() { return this.projection.additions[this.target] || []; },
      replacementComponent() { return this.replacement ? componentFor(this.replacement.component) : null; },
      asset() { return readonlyContextAsset(this.context); }
    },
    methods: {
      entryProps,
      componentFor,
      sdkFor(entry) { return sdkFor(this.app, entry); }
    },
    errorCaptured() {
      this.failed = true;
      return false;
    },
    template: `
      <div class="ui-composition-slot" :data-target="target">
        <template v-if="!failed && permitted && substitute && replacement && replacementComponent">
          <component :is="replacementComponent" :sdk="sdkFor(replacement)" :asset="asset"></component>
        </template>
        <template v-else-if="!failed && permitted && hidden"></template>
        <template v-else><slot></slot></template>
        <div v-if="permitted && substitute && additions.length" class="ui-composition-slot__additions">
          <template v-for="entry in additions" :key="entryProps(entry).key">
            <component v-if="componentFor(entry.component)" :is="componentFor(entry.component)"
                       :sdk="sdkFor(entry)" :asset="asset"></component>
          </template>
        </div>
      </div>
    `
  };

  // Core navigation stays in the page template; this wrapper only swaps a single
  // named target. `permitted` carries the core permission affordance, so an
  // extension permission never widens a link the person cannot already open.
  // A replacement that throws restores the core link through the host failure
  // registry, exactly like a disabled or unavailable module.
  const UICompositionNavItem = {
    name: 'UICompositionNavItem',
    props: {
      app: { type: Object, required: true },
      target: { type: String, required: true },
      permitted: { type: Boolean, default: true }
    },
    data() {
      return { failed: false };
    },
    computed: {
      projection() { return projectionFor(this.app); },
      hidden() { return !!(this.target && this.projection.hidden[this.target]); },
      replacement() { return this.target ? this.projection.replacement[this.target] || null : null; },
      replacementComponent() { return this.replacement ? componentFor(this.replacement.component) : null; }
    },
    methods: {
      componentFor,
      sdkFor(entry) { return sdkFor(this.app, entry); }
    },
    errorCaptured() {
      // A recorded failure drops the replacement from the projection, so the
      // next render already falls back to the core slot.
      this.failed = !reportFailure(this.app, this.replacement);
      return false;
    },
    template: `
      <template v-if="!permitted"></template>
      <template v-else-if="!failed && replacement && replacementComponent">
        <component :is="replacementComponent" :sdk="sdkFor(replacement)"></component>
      </template>
      <template v-else-if="!failed && permitted && hidden"></template>
      <template v-else><slot></slot></template>
    `
  };

  const UICompositionNavAdditions = {
    name: 'UICompositionNavAdditions',
    props: { app: { type: Object, required: true } },
    computed: {
      projection() { return projectionFor(this.app); },
      additions() { return entriesFor(this.projection, 'nav'); }
    },
    methods: { entryProps, componentFor, sdkFor(entry) { return sdkFor(this.app, entry); } },
    template: `
      <div v-if="additions.length" class="ui-composition-nav-additions">
        <div v-for="entry in additions" :key="entryProps(entry).key" class="nav-link ui-composition-nav-entry"
             :data-extension-id="entry.extensionId" :data-target="entry.target">
          <component v-if="componentFor(entry.component)" :is="componentFor(entry.component)" :sdk="sdkFor(entry)"></component>
          <span v-else>{{ entry.label }}</span>
        </div>
      </div>
    `
  };

  // One rendered widget declaration. A failing component reports itself above
  // and disappears, which also restores the core widget the overlay suppressed.
  const UICompositionWidgetEntry = {
    name: 'UICompositionWidgetEntry',
    props: {
      app: { type: Object, required: true },
      entry: { type: Object, required: true }
    },
    data() {
      return { failed: false };
    },
    computed: {
      component() { return componentFor(this.entry.component); }
    },
    methods: {
      sdkFor(entry) { return sdkFor(this.app, entry); }
    },
    errorCaptured() {
      this.failed = !reportFailure(this.app, this.entry);
      return false;
    },
    template: `
      <template v-if="!failed && component">
        <component :is="component" :sdk="sdkFor(entry)"></component>
      </template>
    `
  };

  const UICompositionWidgets = {
    name: 'UICompositionWidgets',
    props: { app: { type: Object, required: true } },
    components: { CompositionWidgetEntry: UICompositionWidgetEntry },
    computed: {
      projection() { return projectionFor(this.app); },
      entries() {
        return replacementsFor(this.projection, 'widget').concat(entriesFor(this.projection, 'widget'));
      }
    },
    methods: { entryProps, componentFor, sdkFor(entry) { return sdkFor(this.app, entry); } },
    template: `
      <div v-if="entries.length" class="ui-composition-widgets noc-grid">
        <section v-for="entry in entries" :key="entryProps(entry).key" class="noc-widget"
                 :aria-label="entry.label" :data-extension-id="entry.extensionId" :data-target="entry.target" :data-mode="entry.mode">
          <header class="noc-widget-head"><div><h2>{{ entry.label }}</h2><p>Extensión {{ entry.extensionName }}</p></div></header>
          <composition-widget-entry :app="app" :entry="entry"></composition-widget-entry>
        </section>
      </div>
    `
  };

  window.UIComposition = {
    sdkVersion: SDK_VERSION,
    CATALOGUE,
    PROTECTED,
    GROUPS: Object.freeze(GROUPS),
    isKnownTarget,
    isProtectedTarget,
    groupOf,
    normalize,
    project,
    coverage,
    entriesFor,
    replacementsFor,
    entryKey,
    mixin,
    // Kebab tags camelize to `CompositionBoundary` (not `UICompositionBoundary`),
    // so both the resolvable keys and the descriptive aliases are exported.
    components: {
      CompositionBoundary: UICompositionBoundary,
      CompositionSlot: UICompositionSlot,
      CompositionNavItem: UICompositionNavItem,
      CompositionNavAdditions: UICompositionNavAdditions,
      CompositionWidgets: UICompositionWidgets,
      CompositionWidgetEntry: UICompositionWidgetEntry,
      UICompositionBoundary,
      UICompositionSlot,
      UICompositionNavItem,
      UICompositionNavAdditions,
      UICompositionWidgets,
      UICompositionWidgetEntry
    }
  };
})();
