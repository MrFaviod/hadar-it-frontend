(function () {
  'use strict';

  const Engine = window.AssetMapEngine;
  const Data = window.AssetMapData;

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
        planDialog: { open: false, name: '', floor: '', kind: 'Plano personalizado', src: '', error: '', busy: false },
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
          this.geoErrors = Object.assign({}, this.geoErrors, { [siteId]: 'La latitud debe estar entre -90 y 90.' });
          return;
        }
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
          this.geoErrors = Object.assign({}, this.geoErrors, { [siteId]: 'La longitud debe estar entre -180 y 180.' });
          return;
        }
        this.geoErrors = Object.assign({}, this.geoErrors, { [siteId]: '' });
        Engine.setGeo(this.app, siteId, { lat: lat, lng: lng, address: draft.address });
        this.geoSaved = Object.assign({}, this.geoSaved, { [siteId]: true });
        this.notice = 'Coordenadas de ' + this.siteLabel(siteId) + ' guardadas.';
        this.app.showToast('Sede ' + this.siteLabel(siteId) + ' actualizada.', 'success');
        window.setTimeout(() => {
          this.geoSaved = Object.assign({}, this.geoSaved, { [siteId]: false });
        }, 2600);
      },
      resetSite(siteId) {
        const base = Data.sites[siteId];
        if (!base) return;
        Engine.setGeo(this.app, siteId, { lat: base.lat, lng: base.lng, address: base.address });
        this.hydrateGeo();
        this.notice = 'Coordenadas de demostración restauradas para ' + this.siteLabel(siteId) + '.';
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
          kind: 'Plano personalizado',
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
          dialog.error = 'Ponle un nombre al plano.';
          return;
        }
        if (!dialog.floor) {
          dialog.error = 'Selecciona la planta del plano.';
          return;
        }
        if (!dialog.src) {
          dialog.error = 'Carga un archivo SVG o elige un plano de ejemplo.';
          return;
        }
        const plan = Engine.addPlan(this.app, {
          name: dialog.name.trim(),
          floor: dialog.floor,
          kind: dialog.kind,
          src: dialog.src
        });
        if (!plan) {
          dialog.error = 'No se pudo agregar el plano.';
          return;
        }
        dialog.open = false;
        this.notice = 'Plano «' + plan.name + '» agregado a ' + this.floorLabel(plan.floor) + '.';
        this.app.showToast('Plano agregado a la planta.', 'success');
      },
      askRemovePlan(planId) {
        this.confirmPlanId = planId;
      },
      removePlan(planId) {
        if (Engine.removePlan(this.app, planId)) {
          this.notice = 'Plano eliminado del catálogo.';
          this.app.showToast('Plano eliminado.', 'success');
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
        this.notice = 'Todas las posiciones individuales se quitaron. Los activos siguen agrupados por sala.';
        this.app.showToast('Posiciones individuales eliminadas.', 'success');
      },
      openExplorer() {
        this.app.setHash('#/infra/mapa');
      }
    },
    template: `
      <div class="map-config" data-od-id="map-settings">
        <header class="map-config__head">
          <div>
            <p class="eyebrow">Configuración</p>
            <h1>Mapas y planos</h1>
            <p class="map-config__lead">
              Sedes geográficas, planos por edificio o piso, capas disponibles y preferencias del explorador.
              Los activos no necesitan posicionamiento manual para aparecer en la estructura de ubicaciones.
            </p>
          </div>
          <button type="button" class="btn btn--secondary btn--small" data-od-id="map-settings-open" @click="openExplorer">
            <app-icon name="map-pin"></app-icon> Abrir explorador
          </button>
        </header>

        <p v-if="notice" class="map-config__notice" role="status">{{ notice }}</p>

        <section class="map-config__card" data-od-id="map-settings-sites">
          <header class="map-config__card-head">
            <h2>Sedes geográficas</h2>
            <p>Las coordenadas ubican cada sede en el mapa. {{ stats.sites }} sedes y {{ stats.buildings }} edificios registrados.</p>
          </header>
          <div class="map-config__sites">
            <form v-for="site in sites" :key="site.id" class="map-site-form" @submit.prevent="saveSite(site.id)">
              <h3>{{ site.label }}</h3>
              <p class="map-site-form__hint mono">{{ site.geo ? site.geo.city + ' · ' + site.geo.region : '' }}</p>
              <label class="map-field">
                <span>Latitud</span>
                <input v-model="geoDraft[site.id].lat" type="text" inputmode="decimal" autocomplete="off">
              </label>
              <label class="map-field">
                <span>Longitud</span>
                <input v-model="geoDraft[site.id].lng" type="text" inputmode="decimal" autocomplete="off">
              </label>
              <label class="map-field map-field--wide">
                <span>Dirección</span>
                <input v-model="geoDraft[site.id].address" type="text" autocomplete="off">
              </label>
              <p v-if="geoErrors[site.id]" class="map-config__error" role="alert">{{ geoErrors[site.id] }}</p>
              <div class="map-site-form__actions">
                <button type="submit" class="btn btn--primary btn--small">Guardar</button>
                <button type="button" class="btn btn--ghost btn--small" @click="resetSite(site.id)">Restablecer</button>
                <span v-if="geoSaved[site.id]" class="map-config__saved mono">Guardado</span>
              </div>
            </form>
          </div>
        </section>

        <section class="map-config__card" data-od-id="map-settings-plans">
          <header class="map-config__card-head map-config__card-head--row">
            <div>
              <h2>Planos y capas</h2>
              <p>Los planos se asocian a una planta y se muestran como capa del interior. Formatos admitidos: SVG o imagen.</p>
            </div>
            <button type="button" class="btn btn--primary btn--small" data-od-id="map-settings-add-plan" @click="openPlanDialog">
              <app-icon name="plus"></app-icon> Agregar plano
            </button>
          </header>
          <div class="map-plan-table-wrap">
            <table class="map-plan-table">
              <thead>
                <tr>
                  <th scope="col">Plano</th>
                  <th scope="col">Planta</th>
                  <th scope="col">Visibilidad</th>
                  <th scope="col">Opacidad</th>
                  <th scope="col"><span class="sr-only">Acciones</span></th>
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
                             :aria-label="'Mostrar el plano ' + plan.name">
                      <span>{{ plan.visible ? 'Visible' : 'Oculto' }}</span>
                    </label>
                  </td>
                  <td>
                    <input type="range" min="0.2" max="1" step="0.05" :value="plan.opacity"
                           class="map-plan-table__range" :aria-label="'Opacidad de ' + plan.name"
                           @input="setPlanOpacity(plan, $event.target.value)">
                  </td>
                  <td class="map-plan-table__actions">
                    <template v-if="confirmPlanId === plan.id">
                      <button type="button" class="text-button text-button--danger" @click="removePlan(plan.id)">Confirmar</button>
                      <button type="button" class="text-button" @click="confirmPlanId = ''">Cancelar</button>
                    </template>
                    <button v-else type="button" class="icon-button icon-button--small"
                            :aria-label="'Eliminar el plano ' + plan.name" @click="askRemovePlan(plan.id)">
                      <app-icon name="trash"></app-icon>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="map-config__hint">
            <app-icon name="info"></app-icon>
            Ocultar un plano no elimina su archivo ni el posicionamiento de los activos.
          </p>
        </section>

        <section class="map-config__card" data-od-id="map-settings-prefs">
          <header class="map-config__card-head">
            <h2>Preferencias de visualización</h2>
            <p>Se aplican al abrir el explorador y se guardan en este navegador.</p>
          </header>
          <div class="map-config__prefs">
            <fieldset class="map-layers__group">
              <legend>Base cartográfica</legend>
              <label class="map-radio">
                <input type="radio" name="settings-base" value="esquema" :checked="prefs.base === 'esquema'"
                       @change="setPref('base', 'esquema')">
                <span>Esquema general</span>
              </label>
              <label class="map-radio">
                <input type="radio" name="settings-base" value="detalle" :checked="prefs.base === 'detalle'"
                       @change="setPref('base', 'detalle')">
                <span>Detalle departamental</span>
              </label>
            </fieldset>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.labels !== false" @change="setPref('labels', $event.target.checked)">
              <span>Etiquetas de ciudades y departamentos</span>
            </label>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.clusters !== false" @change="setPref('clusters', $event.target.checked)">
              <span>Agrupar marcadores próximos</span>
            </label>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.showPlans !== false" @change="setPref('showPlans', $event.target.checked)">
              <span>Mostrar planos al abrir una planta</span>
            </label>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.animations !== false" @change="setPref('animations', $event.target.checked)">
              <span>Transiciones animadas del mapa</span>
            </label>
            <label class="map-check">
              <input type="checkbox" :checked="prefs.showRetired" @change="setPref('showRetired', $event.target.checked)">
              <span>Incluir activos dados de baja en el explorador</span>
            </label>
          </div>
          <p class="map-config__hint">
            <app-icon name="eye"></app-icon>
            El explorador respeta la preferencia de movimiento reducido del sistema operativo.
          </p>
        </section>

        <section class="map-config__card" data-od-id="map-settings-positions">
          <header class="map-config__card-head">
            <h2>Posicionamiento de activos</h2>
            <p>
              {{ positionedCount }} de {{ assets.length }} activos tienen una posición individual sobre un plano.
              El resto se agrupa por sala o zona y sigue visible en la estructura.
            </p>
          </header>
          <div class="map-config__actions">
            <button type="button" class="btn btn--ghost btn--small" @click="clearPositions">
              <app-icon name="restore"></app-icon>
              {{ confirmPositions ? 'Confirmar: quitar todas las posiciones' : 'Quitar todas las posiciones' }}
            </button>
            <button v-if="confirmPositions" type="button" class="text-button" @click="confirmPositions = false">Cancelar</button>
            <span class="map-config__hint-inline">Las posiciones se editan arrastrando los marcadores en el plano.</span>
          </div>
        </section>

        <div v-if="planDialog.open" class="map-dialog" role="dialog" aria-modal="true" aria-labelledby="map-plan-dialog-title">
          <form class="map-dialog__panel" @submit.prevent="createPlan">
            <header class="map-dialog__head">
              <h2 id="map-plan-dialog-title">Agregar plano</h2>
              <button type="button" class="icon-button" aria-label="Cerrar" @click="closePlanDialog">
                <app-icon name="close"></app-icon>
              </button>
            </header>
            <label class="map-field">
              <span>Nombre del plano</span>
              <input v-model="planDialog.name" type="text" placeholder="Planta de oficinas" autocomplete="off">
            </label>
            <label class="map-field">
              <span>Planta</span>
              <select v-model="planDialog.floor">
                <option v-for="floor in floors" :key="floor.id" :value="floor.id">{{ floorLabel(floor.id) }}</option>
              </select>
            </label>
            <label class="map-field">
              <span>Tipo de plano</span>
              <select v-model="planDialog.kind">
                <option value="Plano personalizado">Plano personalizado</option>
                <option value="Planta de oficinas">Planta de oficinas</option>
                <option value="Planta técnica">Planta técnica</option>
                <option value="Planta industrial">Planta industrial</option>
              </select>
            </label>
            <label class="map-field">
              <span>Archivo SVG o imagen</span>
              <input type="file" accept=".svg,image/*" @change="pickPlanFile">
            </label>
            <label class="map-field">
              <span>O elige un plano de ejemplo</span>
              <select v-model="planDialog.src">
                <option value="">Sin archivo seleccionado</option>
                <option v-for="preset in planPresets" :key="preset" :value="preset">{{ preset }}</option>
              </select>
            </label>
            <p v-if="planDialog.error" class="map-config__error" role="alert">{{ planDialog.error }}</p>
            <footer class="map-dialog__foot">
              <button type="button" class="btn btn--ghost btn--small" @click="closePlanDialog">Cancelar</button>
              <button type="submit" class="btn btn--primary btn--small">Agregar plano</button>
            </footer>
          </form>
        </div>
      </div>
    `
  };

  window.AssetMapViews = window.AssetMapViews || {};
  window.AssetMapViews.MapSettings = MapSettings;
})();
