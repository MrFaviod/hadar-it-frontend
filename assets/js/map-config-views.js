(function () {
  'use strict';

  const Engine = window.AssetMapEngine;
  const Data = window.AssetMapData;

  // Human-visible copy comes from the shared catalog. The runtime is resolved at
  // call time so the component still loads in a harness without i18n.
  function tr(key, params) {
    const runtime = typeof window !== 'undefined' ? window.ItsmI18n : null;
    return runtime ? runtime.t(key, params) : '';
  }

  const MapSettings = {
    name: 'MapSettings',
    props: {
      app: { type: Object, required: true }
    },
    data() {
      return {
        geoDraft: {},
        geoErrors: {},
        geoSaved: {},
        planDialog: { open: false, name: '', floor: '', kind: 'custom', src: '', error: '', busy: false },
        confirmPlanId: '',
        confirmPositions: false,
        notice: ''
      };
    },
    computed: {
      maps() {
        return Engine.mapsOf(this.app);
      },
      prefs() {
        return this.maps.prefs;
      },
      sites() {
        return this.app.sites || [];
      },
      floors() {
        return this.maps.floors || [];
      },
      buildings() {
        return this.maps.buildings || [];
      },
      plans() {
        return this.maps.plans || [];
      },
      assets() {
        return this.app.assets || [];
      },
      positionedCount() {
        return Object.keys(this.maps.positions || {}).length;
      },
      planPresets() {
        const seen = [];
        (Data.plans || []).forEach((plan) => {
          if (seen.indexOf(plan.src) === -1) seen.push(plan.src);
        });
        this.plans.forEach((plan) => {
          if (seen.indexOf(plan.src) === -1) seen.push(plan.src);
        });
        return seen;
      },
      stats() {
        return Engine.counts(this.app, {});
      }
    },
    watch: {
      'app.maps.geo': {
        deep: true,
        handler() {
          this.hydrateGeo();
        }
      }
    },
    created() {
      this.hydrateGeo();
    },
    methods: {
      hydrateGeo() {
        const draft = {};
        this.sites.forEach((site) => {
          const geo = Engine.siteGeo(this.app, site.id) || { lat: 0, lng: 0, address: '' };
          draft[site.id] = {
            lat: String(geo.lat),
            lng: String(geo.lng),
            address: geo.address || ''
          };
        });
        this.geoDraft = draft;
      },
      saveSite(siteId) {
        const draft = this.geoDraft[siteId] || {};
        const lat = Number(draft.lat);
        const lng = Number(draft.lng);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
          this.geoErrors = Object.assign({}, this.geoErrors, { [siteId]: tr('ui.map.error.latitude_range') });
          return;
        }
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
          this.geoErrors = Object.assign({}, this.geoErrors, { [siteId]: tr('ui.map.error.longitude_range') });
          return;
        }
        this.geoErrors = Object.assign({}, this.geoErrors, { [siteId]: '' });
        Engine.setGeo(this.app, siteId, { lat: lat, lng: lng, address: draft.address });
        this.geoSaved = Object.assign({}, this.geoSaved, { [siteId]: true });
        this.notice = tr('ui.map.toast.coords_saved', { site: this.siteLabel(siteId) });
        this.app.showToast(tr('ui.map.toast.site_updated', { site: this.siteLabel(siteId) }), 'success');
        window.setTimeout(() => {
          this.geoSaved = Object.assign({}, this.geoSaved, { [siteId]: false });
        }, 2600);
      },
      resetSite(siteId) {
        const base = Data.sites[siteId];
        if (!base) return;
        Engine.setGeo(this.app, siteId, { lat: base.lat, lng: base.lng, address: base.address });
        this.hydrateGeo();
        this.notice = tr('ui.map.notice.coords_reset', { site: this.siteLabel(siteId) });
      },
      siteLabel(siteId) {
        const site = this.sites.find((item) => item.id === siteId);
        return site ? site.label : siteId;
      },
      floorLabel(floorId) {
        const floor = this.floors.find((item) => item.id === floorId);
        if (!floor) return floorId;
        const building = this.buildings.find((item) => item.id === floor.building);
        const site = this.sites.find((item) => item.id === floor.site);
        return (site ? site.label : '') + ' · ' + (building ? building.name : '') + ' · ' + floor.name;
      },
      togglePlan(plan) {
        Engine.setPlan(this.app, plan.id, { visible: !plan.visible });
      },
      setPlanOpacity(plan, value) {
        Engine.setPlan(this.app, plan.id, { opacity: Math.max(0.2, Math.min(1, Number(value))) });
      },
      setPref(key, value) {
        Engine.setPrefs(this.app, { [key]: value });
      },
      openPlanDialog() {
        this.planDialog = {
          open: true,
          name: '',
          floor: this.floors.length ? this.floors[0].id : '',
          kind: 'custom',
          src: '',
          error: '',
          busy: false
        };
      },
      closePlanDialog() {
        this.planDialog.open = false;
      },
      pickPlanFile(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          this.planDialog.src = String(reader.result || '');
          if (!this.planDialog.name) this.planDialog.name = file.name.replace(/\.[^.]+$/, '');
        };
        reader.readAsDataURL(file);
      },
      createPlan() {
        const dialog = this.planDialog;
        if (!dialog.name.trim()) {
          dialog.error = tr('ui.map.error.plan_name');
          return;
        }
        if (!dialog.floor) {
          dialog.error = tr('ui.map.error.plan_floor');
          return;
        }
        if (!dialog.src) {
          dialog.error = tr('ui.map.error.plan_file');
          return;
        }
        const plan = Engine.addPlan(this.app, {
          name: dialog.name.trim(),
          floor: dialog.floor,
          kind: dialog.kind,
          src: dialog.src
        });
        if (!plan) {
          dialog.error = tr('ui.map.error.plan_add');
          return;
        }
        dialog.open = false;
        this.notice = tr('ui.map.notice.plan_added', { name: plan.name, floor: this.floorLabel(plan.floor) });
        this.app.showToast(tr('ui.map.toast.plan_added'), 'success');
      },
      askRemovePlan(planId) {
        this.confirmPlanId = planId;
      },
      removePlan(planId) {
        if (Engine.removePlan(this.app, planId)) {
          this.notice = tr('ui.map.notice.plan_removed');
          this.app.showToast(tr('ui.map.toast.plan_removed'), 'success');
        }
        this.confirmPlanId = '';
      },
      clearPositions() {
        if (!this.confirmPositions) {
          this.confirmPositions = true;
          return;
        }
        Object.keys(this.maps.positions).forEach((assetId) => Engine.removePosition(this.app, assetId));
        this.confirmPositions = false;
        this.notice = tr('ui.map.notice.positions_cleared');
        this.app.showToast(tr('ui.map.toast.positions_cleared'), 'success');
      },
      openExplorer() {
        this.app.setHash('#/infra/mapa');
      }
    },
    template: `
      <div class="map-config" data-od-id="map-settings">
        <header class="map-config__head">
          <div>
            <p class="eyebrow">{{ $t('ui.map.settings.eyebrow') }}</p>
            <h1>{{ $t('ui.map.settings.title') }}</h1>
            <p class="map-config__lead">
              {{ $t('ui.map.settings.lead') }}
            </p>
          </div>
          <button type="button" class="btn btn--secondary btn--small" data-od-id="map-settings-open" @click="openExplorer">
            <app-icon name="map-pin"></app-icon> {{ $t('ui.map.settings.open_explorer') }}
          </button>
        </header>

        <p v-if="notice" class="map-config__notice" role="status">{{ notice }}</p>

        <section class="map-config__card" data-od-id="map-settings-sites">
          <header class="map-config__card-head">
            <h2>{{ $t('ui.map.settings.sites_title') }}</h2>
            <p>{{ $t('ui.map.settings.sites_lead', { sites: stats.sites, buildings: stats.buildings }) }}</p>
          </header>
          <div class="map-config__sites">
            <form v-for="site in sites" :key="site.id" class="map-site-form" @submit.prevent="saveSite(site.id)">
              <h3>{{ site.label }}</h3>
              <p class="map-site-form__hint mono">{{ site.geo ? site.geo.city + ' · ' + site.geo.region : '' }}</p>
              <label class="map-field">
                <span>{{ $t('ui.map.field.latitude') }}</span>
                <input v-model="geoDraft[site.id].lat" type="text" inputmode="decimal" autocomplete="off">
              </label>
              <label class="map-field">
                <span>{{ $t('ui.map.field.longitude') }}</span>
                <input v-model="geoDraft[site.id].lng" type="text" inputmode="decimal" autocomplete="off">
              </label>
              <label class="map-field map-field--wide">
                <span>{{ $t('ui.map.field.address') }}</span>
                <input v-model="geoDraft[site.id].address" type="text" autocomplete="off">
              </label>
              <p v-if="geoErrors[site.id]" class="map-config__error" role="alert">{{ geoErrors[site.id] }}</p>
              <div class="map-site-form__actions">
                <button type="submit" class="btn btn--primary btn--small">{{ $t('ui.map.action.save') }}</button>
                <button type="button" class="btn btn--ghost btn--small" @click="resetSite(site.id)">{{ $t('ui.map.action.reset') }}</button>
                <span v-if="geoSaved[site.id]" class="map-config__saved mono">{{ $t('ui.map.state.saved') }}</span>
              </div>
            </form>
          </div>
        </section>

        <section class="map-config__card" data-od-id="map-settings-plans">
          <header class="map-config__card-head map-config__card-head--row">
            <div>
              <h2>{{ $t('ui.map.settings.plans_title') }}</h2>
              <p>{{ $t('ui.map.settings.plans_lead') }}</p>
            </div>
            <button type="button" class="btn btn--primary btn--small" data-od-id="map-settings-add-plan" @click="openPlanDialog">
              <app-icon name="plus"></app-icon> {{ $t('ui.map.action.add_plan') }}
            </button>
          </header>
          <div class="map-plan-table-wrap">
            <table class="map-plan-table">
              <thead>
                <tr>
                  <th scope="col">{{ $t('ui.map.col.plan') }}</th>
                  <th scope="col">{{ $t('ui.map.col.floor') }}</th>
                  <th scope="col">{{ $t('ui.map.col.visibility') }}</th>
                  <th scope="col">{{ $t('ui.map.col.opacity') }}</th>
                  <th scope="col"><span class="sr-only">{{ $t('ui.map.col.actions') }}</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="plan in plans" :key="plan.id">
                  <td>
                    <span class="map-plan-table__name">{{ plan.name }}</span>
                    <span class="map-plan-table__kind mono">{{ plan.format }}</span>
                  </td>
                  <td>{{ floorLabel(plan.floor) }}</td>
                  <td>
                    <label class="map-check map-check--inline">
                      <input type="checkbox" :checked="plan.visible" @change="togglePlan(plan)"
                             :aria-label="$t('ui.map.plan.show_aria', { name: plan.name })">
                      <span>{{ plan.visible ? $t('ui.map.plan.visible') : $t('ui.map.plan.hidden') }}</span>
                    </label>
                  </td>
                  <td>
                    <input type="range" min="0.2" max="1" step="0.05" :value="plan.opacity"
                           class="map-plan-table__range" :aria-label="$t('ui.map.plan.opacity_aria', { name: plan.name })"
                           @input="setPlanOpacity(plan, $event.target.value)">
                  </td>
                  <td class="map-plan-table__actions">
                    <template v-if="confirmPlanId === plan.id">
                      <button type="button" class="text-button text-button--danger" @click="removePlan(plan.id)">{{ $t('ui.map.action.confirm') }}</button>
                      <button type="button" class="text-button" @click="confirmPlanId = ''">{{ $t('ui.common.cancel') }}</button>
                    </template>
                    <button v-else type="button" class="icon-button icon-button--small"
                            :aria-label="$t('ui.map.plan.remove_aria', { name: plan.name })" @click="askRemovePlan(plan.id)">
                      <app-icon name="trash"></app-icon>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="map-config__hint">
            <app-icon name="info"></app-icon>
            {{ $t('ui.map.settings.plans_note') }}
          </p>
        </section>

        <section class="map-config__card" data-od-id="map-settings-prefs">
          <header class="map-config__card-head">
            <h2>{{ $t('ui.map.settings.prefs_title') }}</h2>
            <p>{{ $t('ui.map.settings.prefs_lead') }}</p>
          </header>
          <div class="map-config__prefs">
            <fieldset class="map-layers__group">
              <legend>{{ $t('ui.map.pref.base') }}</legend>
              <label class="map-radio">
                <input type="radio" name="settings-base" value="esquema" :checked="prefs.base === 'esquema'"
                       @change="setPref('base', 'esquema')">
                <span>{{ $t('ui.map.pref.base_schema') }}</span>
              </label>
              <label class="map-radio">
                <input type="radio" name="settings-base" value="detalle" :checked="prefs.base === 'detalle'"
                       @change="setPref('base', 'detalle')">
                <span>{{ $t('ui.map.pref.base_detail') }}</span>
              </label>
            </fieldset>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.labels !== false" @change="setPref('labels', $event.target.checked)">
              <span>{{ $t('ui.map.pref.labels') }}</span>
            </label>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.clusters !== false" @change="setPref('clusters', $event.target.checked)">
              <span>{{ $t('ui.map.pref.clusters') }}</span>
            </label>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.showPlans !== false" @change="setPref('showPlans', $event.target.checked)">
              <span>{{ $t('ui.map.pref.show_plans') }}</span>
            </label>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.animations !== false" @change="setPref('animations', $event.target.checked)">
              <span>{{ $t('ui.map.pref.animations') }}</span>
            </label>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.showRetired" @change="setPref('showRetired', $event.target.checked)">
              <span>{{ $t('ui.map.pref.show_retired') }}</span>
            </label>
          </div>
          <p class="map-config__hint">
            <app-icon name="eye"></app-icon>
            {{ $t('ui.map.pref.reduced_note') }}
          </p>
        </section>

        <section class="map-config__card" data-od-id="map-settings-positions">
          <header class="map-config__card-head">
            <h2>{{ $t('ui.map.settings.positions_title') }}</h2>
            <p>
              {{ $t('ui.map.settings.positions_lead', { placed: positionedCount, total: assets.length }) }}
            </p>
          </header>
          <div class="map-config__actions">
            <button type="button" class="btn btn--ghost btn--small" @click="clearPositions">
              <app-icon name="restore"></app-icon>
              {{ confirmPositions ? $t('ui.map.settings.clear_positions_confirm') : $t('ui.map.settings.clear_positions') }}
            </button>
            <button v-if="confirmPositions" type="button" class="text-button" @click="confirmPositions = false">{{ $t('ui.common.cancel') }}</button>
            <span class="map-config__hint-inline">{{ $t('ui.map.settings.positions_hint') }}</span>
          </div>
        </section>

        <div v-if="planDialog.open" class="map-dialog" role="dialog" aria-modal="true" aria-labelledby="map-plan-dialog-title">
          <form class="map-dialog__panel" @submit.prevent="createPlan">
            <header class="map-dialog__head">
              <h2 id="map-plan-dialog-title">{{ $t('ui.map.action.add_plan') }}</h2>
              <button type="button" class="icon-button" :aria-label="$t('ui.map.action.close')" @click="closePlanDialog">
                <app-icon name="close"></app-icon>
              </button>
            </header>
            <label class="map-field">
              <span>{{ $t('ui.map.dialog.name') }}</span>
              <input v-model="planDialog.name" type="text" :placeholder="$t('ui.map.dialog.name_placeholder')" autocomplete="off">
            </label>
            <label class="map-field">
              <span>{{ $t('ui.map.dialog.floor') }}</span>
              <select v-model="planDialog.floor">
                <option v-for="floor in floors" :key="floor.id" :value="floor.id">{{ floorLabel(floor.id) }}</option>
              </select>
            </label>
            <label class="map-field">
              <span>{{ $t('ui.map.dialog.kind') }}</span>
              <select v-model="planDialog.kind">
                <option value="custom">{{ $t('ui.map.kind.custom') }}</option>
                <option value="office">{{ $t('ui.map.kind.office') }}</option>
                <option value="technical">{{ $t('ui.map.kind.technical') }}</option>
                <option value="industrial">{{ $t('ui.map.kind.industrial') }}</option>
              </select>
            </label>
            <label class="map-field">
              <span>{{ $t('ui.map.dialog.file') }}</span>
              <input type="file" accept=".svg,image/*" @change="pickPlanFile">
            </label>
            <label class="map-field">
              <span>{{ $t('ui.map.dialog.preset') }}</span>
              <select v-model="planDialog.src">
                <option value="">{{ $t('ui.map.dialog.no_file') }}</option>
                <option v-for="preset in planPresets" :key="preset" :value="preset">{{ preset }}</option>
              </select>
            </label>
            <p v-if="planDialog.error" class="map-config__error" role="alert">{{ planDialog.error }}</p>
            <footer class="map-dialog__foot">
              <button type="button" class="btn btn--ghost btn--small" @click="closePlanDialog">{{ $t('ui.common.cancel') }}</button>
              <button type="submit" class="btn btn--primary btn--small">{{ $t('ui.map.action.add_plan') }}</button>
            </footer>
          </form>
        </div>
      </div>
    `
  };

  window.AssetMapViews = window.AssetMapViews || {};
  window.AssetMapViews.MapSettings = MapSettings;
})();
