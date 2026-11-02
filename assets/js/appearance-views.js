(function () {
  'use strict';
  const E = window.AssetAppearanceEngine;
  // Non-template copy (notices, thrown errors) resolves through the runtime so a
  // locale change reaches strings that a template never holds.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime && typeof runtime.t === 'function' ? runtime.t(key, params) : '';
  }
  const AppearancePreview = {
    props: ['preset', 'mode'],
    data: () => ({ tab: 'panel', query: '', selected: false }),
    computed: {
      palette() { try { return E.tokens(this.preset, this.mode); } catch (_) { return {}; } },
      logo() { return E.safeResource((this.mode === 'dark' && this.preset.branding.logoDark) || this.preset.branding.logo); },
      rows() { return [{ name: tr('ui.appearance.preview.specimen_laptop'), code: 'EQ-001', status: tr('ui.appearance.preview.specimen_status_assigned') }, { name: tr('ui.appearance.preview.specimen_monitor'), code: 'EQ-002', status: tr('ui.appearance.preview.specimen_status_available') }].filter(x => x.name.toLowerCase().includes(this.query.toLowerCase())); }
    },
    template: `<div class="appearance-specimen" :class="{'is-dark':mode==='dark'}" :style="palette" :data-theme="mode" data-od-id="appearance-preview">
      <div class="appearance-specimen__nav"><div class="appearance-specimen__brand"><img v-if="logo" :src="logo" width="30" height="30" :alt="$t('ui.appearance.preview.alt_logo')"><strong>{{ preset.branding.appName }}</strong></div><span>{{ preset.branding.organizationName }}</span></div>
      <div class="appearance-specimen__tabs" role="tablist" :aria-label="$t('ui.appearance.preview.aria')"><button v-for="item in [{id:'panel',label:'Dashboard'},{id:'inventory',label:'Inventario'}]" :key="item.id" role="tab" :aria-selected="tab===item.id" :class="{'is-active':tab===item.id}" @click="tab=item.id">{{item.label}}</button><small>{{ $t('ui.appearance.preview.eyebrow') }}</small></div>
      <div class="appearance-specimen__body">
        <div class="appearance-specimen__heading"><div><span class="appearance-kicker">{{tab==='panel'?'Resumen operativo':'Activos de ejemplo'}}</span><h3>{{tab==='panel'?'Todo, en su sitio':'Inventario de equipos'}}</h3></div><span class="appearance-status">{{ $t('ui.appearance.preview.os') }}</span></div>
        <template v-if="tab==='panel'"><div class="appearance-specimen__stats"><div><small>{{ $t('ui.appearance.preview.sample_assets') }}</small><strong>02</strong><span>{{ $t('ui.appearance.preview.demo_inventory') }}</span></div><div><small>{{ $t('ui.appearance.preview.availability') }}</small><strong>01 <em>/ 02</em></strong><span>{{ $t('ui.appearance.preview.one_available') }}</span></div></div><div class="appearance-specimen__chart"><div><strong>{{ $t('ui.appearance.preview.distribution') }}</strong><span>{{ $t('ui.appearance.preview.assigned_available') }}</span></div><div class="appearance-specimen__bar"><span></span></div><small>{{ $t('ui.appearance.preview.one_assigned') }} <span>{{ $t('ui.appearance.preview.one_free') }}</span></small></div></template>
        <label class="appearance-specimen__search"><span>{{ $t('ui.appearance.preview.search_placeholder') }}</span><input v-model="query" :placeholder="$t('ui.appearance.preview.placeholder_name')" data-od-id="preview-search"></label>
        <div class="appearance-specimen__table"><table><thead><tr><th>{{ $t('ui.appearance.preview.col_asset') }}</th><th>{{ $t('ui.appearance.preview.col_code') }}</th><th>{{ $t('ui.appearance.preview.col_status') }}</th></tr></thead><tbody><tr v-for="row in rows" :key="row.code"><td>{{row.name}}</td><td>{{row.code}}</td><td><span class="appearance-status">{{row.status}}</span></td></tr><tr v-if="!rows.length"><td colspan="3">{{ $t('ui.appearance.preview.no_results') }}</td></tr></tbody></table></div>
        <div class="appearance-specimen__footer"><label><input type="checkbox" v-model="selected"> {{ $t('ui.appearance.preview.include_technical') }}</label><button @click="selected=!selected" data-od-id="preview-action">{{selected?'Selección preparada':'Preparar selección'}}</button></div>
      </div>
    </div>`
  };
  const AppearancePackageDialog = {
    components: { ModalShell: window.ModalShell, AppearancePreview },
    props: ['open', 'kind', 'presets', 'active', 'current', 'app'], emits: ['close', 'imported'],
    data() { return { presetId: this.active.id, filename: 'apariencia-asset-manager.zip', detected: null, error: '', busy: false, policy: 'both', dragging: false, prepared: false }; },
    computed: {
      selected() { return this.presetId === this.active.id ? this.active : (this.presets.find(p => p.id === this.presetId) || this.active); },
      collision() { return this.detected && this.presets.find(p => p.name === this.detected.preset.name); },
      builtinIds() { return (this.app && this.app.appearance.builtinIds) || ['generic']; },
      canReplace() { return this.collision && !this.builtinIds.includes(this.collision.id); },
      server() { return !!(this.app && this.app.authenticated && window.AssetAppearanceApi); }
    },
    methods: {
      async read(file) {
        this.error = ''; this.detected = null; this.busy = true;
        try {
          if (!file || !/\.zip$/i.test(file.name)) throw new Error(tr('ui.appearance.package.file_not_zip'));
          if (file.size > 24 * 1024 * 1024) throw new Error(tr('ui.appearance.package.size_exceeded'));
          if (this.server) {
            this.detected = await window.AssetAppearanceApi.previewImport(this.app, await file.arrayBuffer());
          } else {
            this.detected = await window.AssetAppearancePackage.decode(await file.arrayBuffer());
            E.validate(this.detected.preset);
          }
          if (!this.detected) throw new Error(tr('ui.appearance.package.preview_failed'));
          this.policy = 'both';
        } catch (error) { this.detected = null; this.error = error.message; }
        finally { this.busy = false; }
      },
      drop(event) { this.dragging = false; this.read(event.dataTransfer.files[0]); },
      confirm() { if (this.detected) this.$emit('imported', { preset: this.detected.preset, policy: this.policy }); },
      async download() {
        this.busy = true; this.error = ''; this.prepared = false;
        try {
          if (this.server) {
            const blob = await window.AssetAppearanceApi.downloadPreset(this.app, this.selected, this.filename.trim() || 'apariencia');
            if (blob) this.prepared = true;
          } else {
            const bytes = await window.AssetAppearancePackage.encode(this.selected);
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
            const link = document.createElement('a'); link.href = url; link.download = (this.filename.trim() || 'apariencia.zip').replace(/\.zip$/i, '') + '.zip'; link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000); this.prepared = true;
          }
        } catch (error) { this.error = error.message; }
        finally { this.busy = false; }
      }
    },
    template: `<modal-shell :open="open" :title="kind==='import'?'Importar apariencia':'Exportar apariencia'" eyebrow="Paquete ZIP portable" size="lg" @close="$emit('close')">
      <div class="appearance-package" data-od-id="appearance-package">
        <template v-if="kind==='import'">
          <p>{{ $t('ui.appearance.package.lead') }}</p>
          <label class="appearance-drop" :class="{'is-dragging':dragging}" @dragover.prevent="dragging=true" @dragleave.prevent="dragging=false" @drop.prevent="drop" data-od-id="appearance-zip-drop"><strong>{{busy?'Leyendo el paquete…':'Arrastra aquí un archivo ZIP'}}</strong><span>{{ $t('ui.appearance.package.drop_hint') }}</span><input type="file" accept=".zip,application/zip" :disabled="busy" @change="read($event.target.files[0])"></label>
          <template v-if="detected"><div class="appearance-package__detected"><strong>{{detected.preset.name}}</strong><span>{{ $t('ui.appearance.package.version', { version: detected.preset.version, resources: detected.resources.length }) }}</span><ul><li v-for="r in detected.resources" :key="r.name">{{r.name}} <small>{{ $t('ui.appearance.package.kb', { size: Math.ceil(r.size/1024) }) }}</small></li></ul><p v-for="warning in (detected.warnings||[])" :key="warning" class="appearance-hint">{{warning}}</p></div>
          <div class="appearance-compare"><div><h3>{{ $t('ui.appearance.package.current') }}</h3><appearance-preview :preset="current" mode="light"></appearance-preview></div><div><h3>{{ $t('ui.appearance.package.imported') }}</h3><appearance-preview :preset="detected.preset" mode="light"></appearance-preview></div></div>
          <fieldset v-if="collision" class="appearance-conflict"><legend>{{ $t('ui.appearance.package.conflict_exists') }}</legend><label><input type="radio" v-model="policy" value="both"> {{ $t('ui.appearance.package.keep_both') }}</label><label v-if="canReplace"><input type="radio" v-model="policy" value="replace"> {{ $t('ui.appearance.package.replace') }}</label><p v-else>{{ $t('ui.appearance.package.generic_note') }}</p></fieldset></template>
        </template>
        <template v-else><p>{{ $t('ui.appearance.package.export_note') }}</p><div class="field"><label for="appearance-export-preset">{{ $t('ui.appearance.package.export_preset') }}</label><select id="appearance-export-preset" v-model="presetId"><option v-for="p in presets" :value="p.id" :key="p.id">{{p.name}}{{p.id===active.id?' · Activo':''}}</option></select></div><div class="field"><label for="appearance-export-name">{{ $t('ui.appearance.package.filename') }}</label><input id="appearance-export-name" v-model="filename" maxlength="120"></div><appearance-preview :preset="selected" mode="light"></appearance-preview><p v-if="prepared" class="appearance-feedback" role="status">{{ $t('ui.appearance.package.ready') }}</p></template>
        <p v-if="error" class="appearance-error" role="alert">{{error}}</p>
      </div>
      <template #footer><button class="btn btn--secondary" @click="$emit('close')">{{ $t('ui.common.close') }}</button><button v-if="kind==='import'" class="btn btn--primary" :disabled="!detected||busy" @click="confirm" data-od-id="appearance-confirm-import">{{ $t('ui.appearance.package.import_review') }}</button><button v-else class="btn btn--primary" :disabled="busy" @click="download" data-od-id="appearance-download">{{busy?'Preparando…':'Descargar ZIP'}}</button></template>
    </modal-shell>`
  };
  const AppearanceSettings = {
    components: { AppearancePreview, AppearancePackageDialog }, props: ['app'],
    data() { return { draft: E.clone(this.app.appearance.active), previewMode: 'light', editMode: 'light', packageKind: '', error: '', notice: '', restorePrompt: false }; },
    computed: {
      // Resolved at render, never at module load: a locale change must reach these labels.
      resourceKeys() {
        if (window.ItsmI18n && window.ItsmI18n.version) window.ItsmI18n.version.value;
        return [
          { id: 'logo', label: tr('ui.appearance.settings.resource_logo') },
          { id: 'logoDark', label: tr('ui.appearance.settings.resource_logo_dark') },
          { id: 'logoCompact', label: tr('ui.appearance.settings.resource_logo_compact') },
          { id: 'favicon', label: tr('ui.appearance.settings.resource_favicon') }
        ];
      },
      dirty() { return JSON.stringify(this.draft) !== JSON.stringify(this.app.appearance.active); },
      valid() { try { E.validate(this.draft); return true; } catch (_) { return false; } },
      currentMode() { return this.app.themeMode; },
      colors() { return this.draft.colors[this.editMode]; },
      server() { return !!(this.app.authenticated && window.AssetAppearanceApi); },
      appearanceError() { return this.server ? window.AssetAppearanceApi.lastError(this.app) : ''; },
      appearanceLoading() { return this.server && window.AssetAppearanceApi.isLoading(this.app); },
      builtinIds() { return this.app.appearance.builtinIds || ['generic']; }
    },
    methods: {
      select(preset) { this.draft = E.clone(preset); this.error = ''; this.notice = tr('ui.appearance.notice.selected'); },
      discard() { this.draft = E.clone(this.app.appearance.active); this.error = ''; this.notice = tr('ui.appearance.notice.discarded'); },
      async apply() {
        try {
          E.validate(this.draft);
          if (this.server) {
            const stored = this.app.appearance.presets.find(p => p.id === this.draft.id);
            let target = stored && JSON.stringify(stored) === JSON.stringify(this.draft) ? stored : null;
            if (!target) {
              const candidate = E.clone(this.draft);
              if (candidate.id === 'generic' || this.builtinIds.includes(candidate.id)) {
                delete candidate.id;
                if (candidate.name === 'Asset Manager') candidate.name = tr('ui.appearance.settings.my_organization');
              }
              target = await window.AssetAppearanceApi.savePreset(this.app, candidate);
              if (!target) return;
            }
            const active = await window.AssetAppearanceApi.applyPreset(this.app, target);
            if (!active) return;
            this.draft = E.clone(active);
            this.app.applyAppearanceState(active);
            this.notice = tr('ui.appearance.notice.applied'); this.error = '';
            return;
          }
          const generic = this.app.appearance.presets[0];
          if (this.draft.id === 'generic' && JSON.stringify(this.draft) !== JSON.stringify(generic)) {
            const p = E.clone(this.draft); p.name = p.name === generic.name ? tr('ui.appearance.settings.my_organization') : p.name; this.draft = E.savePreset(this.app.appearance, p, 'both');
          } else {
            const index = this.app.appearance.presets.findIndex(p => p.id === this.draft.id);
            if (index >= 0 && this.draft.id !== 'generic') this.app.appearance.presets.splice(index, 1, E.clone(this.draft));
          }
          this.app.applyAppearance(this.draft); this.notice = tr('ui.appearance.notice.applied'); this.error = '';
        } catch (error) { this.error = error.message; }
      },
      async duplicate() {
        if (this.server) {
          try {
            const copy = E.clone(this.draft);
            copy.name = tr('ui.appearance.settings.copy_name', { name: copy.name || tr('ui.appearance.settings.preset_default') });
            delete copy.id;
            const saved = await window.AssetAppearanceApi.savePreset(this.app, copy);
            if (!saved) return;
            this.draft = E.clone(saved);
            this.notice = tr('ui.appearance.notice.duplicate_gallery');
            this.error = '';
          } catch (error) { this.error = error.message; }
          return;
        }
        this.draft = E.duplicate(this.app.appearance, this.draft); this.notice = tr('ui.appearance.notice.duplicate_session');
      },
      async save() {
        try {
          E.validate(this.draft);
          if (this.server) {
            const candidate = E.clone(this.draft);
            if (candidate.id === 'generic' || this.builtinIds.includes(candidate.id)) {
              delete candidate.id;
              if (candidate.name === 'Asset Manager') candidate.name = tr('ui.appearance.settings.my_organization');
            }
            const saved = await window.AssetAppearanceApi.savePreset(this.app, candidate);
            if (!saved) return;
            this.draft = E.clone(saved);
            this.notice = tr('ui.appearance.notice.saved_gallery');
            this.error = '';
            return;
          }
          const p = E.clone(this.draft); if (p.id === 'generic') p.name = tr('ui.appearance.settings.my_organization'); this.draft = E.savePreset(this.app.appearance, p, 'replace'); this.notice = tr('ui.appearance.notice.saved_session');
        } catch (error) { this.error = error.message; }
      },
      async restore() {
        this.restorePrompt = false;
        if (this.server) {
          try {
            const active = await window.AssetAppearanceApi.restore(this.app);
            if (!active) return;
            this.draft = E.clone(active);
            this.app.applyAppearanceState(active);
            this.notice = tr('ui.appearance.notice.restored'); this.error = '';
          } catch (error) { this.error = error.message; }
          return;
        }
        const generic = this.app.appearance.presets[0]; this.draft = E.clone(generic); this.app.applyAppearance(generic); this.notice = tr('ui.appearance.notice.restored');
      },
      async previous() {
        if (this.server) {
          try {
            const active = await window.AssetAppearanceApi.revert(this.app);
            if (!active) return;
            this.draft = E.clone(active);
            this.app.applyAppearanceState(active);
            this.notice = tr('ui.appearance.notice.previous'); this.error = '';
          } catch (error) { this.error = error.message; }
          return;
        }
        if (!this.app.appearance.previous) return;
        const p = E.clone(this.app.appearance.previous); this.draft = p; this.app.applyAppearance(p); this.notice = tr('ui.appearance.notice.previous');
      },
      setMode(mode) { return this.app.setAppearanceMode(mode); },
      async imported(result) {
        if (this.server) {
          try {
            const staged = await window.AssetAppearanceApi.stageImport(this.app, result.preset, result.policy);
            if (!staged) return;
            this.draft = E.clone(staged);
            this.packageKind = '';
            this.notice = tr('ui.appearance.notice.imported_gallery'); this.error = '';
          } catch (error) { this.error = error.message; }
          return;
        }
        try { this.draft = E.savePreset(this.app.appearance, result.preset, result.policy); this.packageKind = ''; this.notice = tr('ui.appearance.notice.imported_session'); } catch (error) { this.error = error.message; }
      },
      async resource(event, key) {
        const file = event.target.files[0]; if (!file) return;
        if (!['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(file.type)) { this.error = tr('ui.appearance.settings.image_format'); return; }
        if (file.size > 2 * 1024 * 1024) { this.error = tr('ui.appearance.settings.image_too_large'); return; }
        try { const reader = new FileReader(); this.draft.branding[key] = await new Promise((resolve, reject) => { reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error(tr('ui.appearance.settings.image_read_failed'))); reader.readAsDataURL(file); }); this.error = ''; }
        catch (error) { this.error = error.message; }
      }
    },
    template: `<section class="config-section appearance" data-od-id="appearance-settings">
      <header class="config-section__head"><div><span class="eyebrow">{{ $t('ui.appearance.settings.eyebrow') }}</span><h2 data-od-id="appearance-heading">{{ $t('ui.appearance.settings.title') }}</h2><p>{{ $t('ui.appearance.settings.lead') }}</p></div><div class="appearance-tools"><button class="btn btn--secondary" @click="packageKind='import'" data-od-id="appearance-import">{{ $t('ui.appearance.settings.import') }}</button><button class="btn btn--secondary" @click="packageKind='export'" data-od-id="appearance-export">{{ $t('ui.appearance.settings.export') }}</button></div></header>
      <div class="appearance-mode" data-od-id="appearance-user-mode"><div><h3>{{ $t('ui.appearance.settings.mode_title') }}</h3><p>{{ $t('ui.appearance.settings.mode_lead') }}</p></div><div class="appearance-segments" :aria-label="$t('ui.appearance.settings.mode_aria')"><button v-for="m in [{id:'light',label:'Claro'},{id:'dark',label:'Oscuro'},{id:'system',label:'Automático'}]" :key="m.id" :aria-pressed="currentMode===m.id" :class="{'is-active':currentMode===m.id}" @click="setMode(m.id)">{{m.label}}</button></div></div>
      <div class="appearance-section-title"><div><h3>{{ $t('ui.appearance.settings.presets_title') }}</h3><p>{{ $t('ui.appearance.settings.presets_lead') }}</p></div><span class="appearance-session">{{appearanceLoading?'Sincronizando galería…':'Galería de la instalación'}}</span></div>
      <p v-if="appearanceError" class="appearance-error" role="alert">{{appearanceError}}</p>
      <div class="appearance-gallery" data-od-id="appearance-gallery"><button v-for="p in app.appearance.presets" :key="p.id" class="appearance-preset" :class="{'is-selected':draft.id===p.id}" :aria-pressed="draft.id===p.id" :data-od-id="'appearance-preset-'+p.id" @click="select(p)"><div class="appearance-preset__sample" :style="{'--sample-primary':p.colors.light.primary,'--sample-secondary':p.colors.light.secondary}"><span class="appearance-preset__rail"></span><div><i></i><div><b></b><b></b><b></b></div><em></em></div></div><div class="appearance-preset__label"><strong>{{p.name}}</strong><span v-if="app.appearance.active.id===p.id" class="appearance-active">{{ $t('ui.appearance.settings.active') }}</span></div><small>{{p.description||'Identidad personalizada'}}</small></button></div>
      <div class="appearance-workspace">
        <div class="appearance-editor" data-od-id="appearance-identity-editor"><div class="appearance-section-title"><h3>{{ $t('ui.appearance.settings.identity_title') }}</h3><button class="btn btn--ghost" @click="duplicate" data-od-id="appearance-duplicate">{{ $t('ui.appearance.settings.duplicate') }}</button></div>
          <div class="field"><label for="appearance-preset-name">{{ $t('ui.appearance.settings.preset_name') }}</label><input id="appearance-preset-name" v-model="draft.name" maxlength="64"></div>
          <div class="field"><label for="appearance-app-name">{{ $t('ui.appearance.settings.app_name') }}</label><input id="appearance-app-name" v-model="draft.branding.appName" maxlength="64"></div>
          <div class="field"><label for="appearance-org-name">{{ $t('ui.appearance.settings.organization') }}</label><input id="appearance-org-name" v-model="draft.branding.organizationName" maxlength="80"></div>
          <div class="appearance-resource-grid"><div v-for="r in resourceKeys" :key="r.id" class="appearance-resource" :data-od-id="'appearance-resource-'+r.id"><div class="appearance-resource__preview" :class="{'is-dark':r.id==='logoDark'}"><img v-if="draft.branding[r.id]" :src="draft.branding[r.id]" width="44" height="44" :alt="r.label"><span v-else>{{ $t('ui.appearance.settings.no_variant') }}</span></div><label>{{r.label}}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon" @change="resource($event,r.id)"><span>{{ $t('ui.appearance.settings.load_image') }}</span></label><button v-if="draft.branding[r.id]" class="appearance-text-button" @click="draft.branding[r.id]=''" :aria-label="'Quitar '+r.label">{{ $t('ui.appearance.settings.remove') }}</button></div></div>
          <p class="appearance-hint">{{ $t('ui.appearance.settings.assets_hint') }}</p>
          <div class="appearance-section-title"><h3>{{ $t('ui.appearance.settings.colors_title') }}</h3><div class="appearance-segments appearance-segments--small"><button :class="{'is-active':editMode==='light'}" :aria-pressed="editMode==='light'" @click="editMode='light'">{{ $t('ui.appearance.settings.theme_light') }}</button><button :class="{'is-active':editMode==='dark'}" :aria-pressed="editMode==='dark'" @click="editMode='dark'">{{ $t('ui.appearance.settings.theme_dark') }}</button></div></div>
          <div class="appearance-colors"><label v-for="c in [{id:'primary',label:'Principal'},{id:'secondary',label:'Secundario'},{id:'accent',label:'Acento'}]" :key="c.id">{{c.label}}<div><input type="color" v-model="colors[c.id]" :aria-label="c.label+' '+editMode"><input type="text" v-model="colors[c.id]" maxlength="7" :aria-label="'Valor hexadecimal '+c.label"></div></label></div>
          <p class="appearance-hint">{{ $t('ui.appearance.settings.colors_note') }}</p>
          <label class="appearance-check"><input type="checkbox" v-model="draft.preferences.compact"> {{ $t('ui.appearance.settings.compact') }}</label>
          <div class="field"><label for="appearance-default-mode">{{ $t('ui.appearance.settings.default_mode') }}</label><select id="appearance-default-mode" v-model="draft.preferences.defaultMode"><option value="system">{{ $t('ui.appearance.settings.mode_auto') }}</option><option value="light">{{ $t('ui.appearance.settings.theme_light') }}</option><option value="dark">{{ $t('ui.appearance.settings.theme_dark') }}</option></select></div>
          <button class="btn btn--secondary" :disabled="!valid" @click="save" data-od-id="appearance-save">{{ $t('ui.appearance.settings.save_preset') }}</button>
        </div>
        <aside class="appearance-preview-panel" data-od-id="appearance-live-preview"><div class="appearance-section-title"><div><h3>{{ $t('ui.appearance.settings.preview_title') }}</h3><p>{{ $t('ui.appearance.settings.preview_lead') }}</p></div></div><div class="appearance-preview-toolbar"><span>{{previewMode==='light'?'Tema claro':'Tema oscuro'}}</span><div class="appearance-segments"><button :class="{'is-active':previewMode==='light'}" :aria-pressed="previewMode==='light'" @click="previewMode='light'">{{ $t('ui.appearance.settings.theme_light') }}</button><button :class="{'is-active':previewMode==='dark'}" :aria-pressed="previewMode==='dark'" @click="previewMode='dark'">{{ $t('ui.appearance.settings.theme_dark') }}</button></div></div><appearance-preview :preset="draft" :mode="previewMode"></appearance-preview><div class="appearance-preview-note"><strong>{{ $t('ui.appearance.settings.shared_title') }}</strong><p>{{ $t('ui.appearance.settings.shared_lead') }}</p></div></aside>
      </div>
      <p v-if="error" class="appearance-error" role="alert">{{error}}</p><p v-if="notice" class="appearance-feedback" role="status">{{notice}}</p>
      <footer class="appearance-apply" data-od-id="appearance-apply-bar"><div><strong>{{dirty?'Hay cambios sin aplicar':'Apariencia actualizada'}}</strong><span>{{dirty?'Solo los ves en esta vista previa.':'La identidad genérica siempre estará disponible.'}}</span></div><div><button class="btn btn--ghost" :disabled="!dirty" @click="discard" data-od-id="appearance-discard">{{ $t('ui.appearance.settings.discard') }}</button><button class="btn btn--primary" :disabled="!dirty||!valid" @click="apply" data-od-id="appearance-apply">{{ $t('ui.appearance.settings.apply') }}</button></div></footer>
      <div class="appearance-restore"><div><h3>{{ $t('ui.appearance.restore.title') }}</h3><p>{{ $t('ui.appearance.restore.lead') }}</p></div><button class="btn btn--secondary" @click="restorePrompt=true" data-od-id="appearance-restore">{{ $t('ui.appearance.restore.action') }}</button><button v-if="app.appearance.previous" class="appearance-text-button" @click="previous">{{ $t('ui.appearance.restore.previous') }}</button></div>
      <div v-if="restorePrompt" class="appearance-confirm" role="group" :aria-label="$t('ui.appearance.restore.confirm_aria')"><p>{{ $t('ui.appearance.restore.confirm') }}</p><button class="btn btn--secondary" @click="restorePrompt=false">{{ $t('ui.common.cancel') }}</button><button class="btn btn--secondary" @click="restore">{{ $t('ui.appearance.restore.confirm_action') }}</button></div>
      <appearance-package-dialog v-if="packageKind" :open="true" :kind="packageKind" :presets="app.appearance.presets" :active="app.appearance.active" :current="app.appearance.active" :app="app" @close="packageKind=''" @imported="imported"></appearance-package-dialog>
    </section>`
  };
  window.AssetAppearanceViews = { AppearanceSettings, AppearancePreview, AppearancePackageDialog };
})();
