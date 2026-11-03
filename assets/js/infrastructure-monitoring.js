/*
 * T7 infrastructure availability join.
 *
 * The map and the graph work from a bounded canonical asset canvas; the
 * monitoring adapter already answers what the server measured. This module is
 * the single seam between both: it reads one bounded monitoring page plus the
 * selected device detail, joins them by canonical asset id and exposes an
 * honest per-asset view for the canvas, the marker and the inspector.
 *
 * Boundaries kept on purpose:
 * - It never reads beyond `assets.view`; the guard lives in `can()`.
 * - It never claims coverage of the whole canvas: the server total is
 *   disclosed and an id that is not in the loaded page stays unknown, which is
 *   not the same as `unmonitored` or `up`.
 * - It never presents a poll as live streaming; every surface shows the last
 *   check time and the read time.
 * - The automatic refresh runs at one minute or slower, pauses while the tab
 *   is hidden, never overlaps, aborts on dispose, identity change or unmount,
 *   and ignores any answer from an older epoch.
 */
(function () {
  'use strict';

  const CONSTANTS = {
    REFRESH_MS: 60000,
    LIMIT: 200,
    PERIOD: '24h',
    ALERTS: 3
  };
  const MEASURED = { up: true, degraded: true, down: true };
  // The reading keeps its neutral status/reason code; only the label is
  // translated, so a language change never needs another transport read.
  // Full keys, not prefixes: the catalog check reads literal keys only.
  const STATUS_KEYS = {
    up: 'ui.monitoring.status.up',
    degraded: 'ui.monitoring.status.degraded',
    down: 'ui.monitoring.status.down',
    unmonitored: 'ui.monitoring.status.unmonitored',
    no_data: 'ui.monitoring.status.no_data',
    unavailable: 'ui.monitoring.status.unavailable'
  };
  const REASON_KEYS = {
    target_missing: 'ui.monitoring.reason.target_missing',
    prometheus_unavailable: 'ui.monitoring.reason.prometheus_unavailable'
  };

  function runtime() {
    return typeof window !== 'undefined' ? window.ItsmI18n : null;
  }

  function tr(key, params) {
    const api = runtime();
    return api && typeof api.t === 'function' ? api.t(key, params) : '';
  }

  function statusText(status, fallback) {
    const key = STATUS_KEYS[text(status)];
    return key ? tr(key) : text(fallback);
  }

  function reasonText(reason, fallback) {
    const key = REASON_KEYS[text(reason)];
    return key ? tr(key) : text(fallback);
  }

  function mapping() {
    return typeof window !== 'undefined' ? window.AssetMonitoringApiMapping : null;
  }

  function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function uniqueIds(values) {
    const seen = {};
    const out = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const id = text(value);
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  function stamp(value) {
    if (!value) return '';
    const api = runtime();
    if (api && typeof api.time === 'function') return api.time(value);
    return String(value);
  }

  function percentText(value) {
    const parsed = num(value);
    if (parsed === null) return '';
    const api = runtime();
    if (api && typeof api.number === 'function') {
      return api.number(parsed, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
    }
    return parsed + ' %';
  }

  function aborted(error) {
    if (!error) return false;
    if (error.name === 'AbortError') return true;
    if (error.code === 20) return true;
    return /abort|cancel/i.test(String(error.message || ''));
  }

  function listState() {
    return {
      loaded: false,
      loading: false,
      error: '',
      examined: 0,
      total: 0,
      checkedAt: '',
      rows: {},
      epoch: 0,
      controller: null
    };
  }

  function detailState() {
    return {
      assetId: '',
      loaded: false,
      loading: false,
      error: '',
      missing: false,
      checkedAt: '',
      record: null,
      // One counter per asset read: A -> B -> A must not let the first A answer
      // repaint the third read, which is what the asset id alone cannot tell.
      request: 0,
      epoch: 0,
      controller: null
    };
  }

  // The epoch is a generation counter that only moves forward, including
  // across dispose: a discarded generation hands the next one a higher number,
  // so an answer still on the wire can never match a restarted read.
  function freshState(epoch, identity) {
    return {
      identity: text(identity),
      epoch: Number(epoch) > 0 ? Number(epoch) : 0,
      timer: 0,
      scope: [],
      selectedId: '',
      retrySelect: '',
      pending: false,
      list: listState(),
      detail: detailState()
    };
  }

  function listPath() {
    return '/monitoring/devices?limit=' + CONSTANTS.LIMIT + '&offset=0&period=' + CONSTANTS.PERIOD;
  }

  function devicePath(assetId) {
    return '/monitoring/devices/' + encodeURIComponent(assetId) + '?period=' + CONSTANTS.PERIOD;
  }

  const InfraMonitoring = {
    data() {
      return {
        infraMonitorConstants: CONSTANTS,
        infraMonitoring: freshState(0, '')
      };
    },

    computed: {
      // The selected asset this surface actually shows. Both canvases keep it
      // in `selectedId`; a click, a deep link and a restored route all land
      // there, so one field decides the reading everywhere.
      infraMonitorSelection() {
        return typeof this.selectedId === 'string' ? this.selectedId : '';
      },
      infraMonitorPane() {
        // Only the registered selection: falling back to the raw component
        // field would paint a page row for an asset whose detail was never
        // requested, which is exactly the divergence this join must not have.
        const id = text(this.infraMonitoring && this.infraMonitoring.selectedId);
        return this.infraMonitorPanel(id);
      }
    },

    watch: {
      // A session restored after this view mounted is a real case: a deep link
      // renders before the identity envelope resolves, so the first read has to
      // start from the transition, not only from `mounted`.
      'app.authenticated'(value) {
        if (!value) {
          this.infraMonitorDispose();
          return;
        }
        this.infraMonitorBoot();
      },
      // Replacing the signed-in person is not a logout: no observation may be
      // carried across the replacement, and the new session reads its own.
      // A click, a deep link or a restored route all end in `selectedId`; the
      // handler writes only monitoring state, so the watcher cannot re-enter.
      infraMonitorSelection(value) {
        this.infraMonitorSelect(value);
      },
      'app.activeUserId'() {
        this.infraMonitorIdentity();
      }
    },

    mounted() {
      this.infraMonitorBoot();
    },

    beforeUnmount() {
      this.infraMonitorDispose();
      this.infraMonitorUnbind();
    },

    methods: {
      infraMonitorAvailable() {
        const app = this.app;
        if (!app || !app.authenticated || !text(app.activeUserId)) return false;
        if (typeof app.can === 'function' && !app.can('assets.view')) return false;
        return !!mapping();
      },

      infraMonitorIdentityKey() {
        const app = this.app;
        return app && app.authenticated ? text(app.activeUserId) : '';
      },

      infraMonitorCurrent(epoch) {
        const state = this.infraMonitoring;
        if (!state || state.epoch !== epoch) return false;
        const identity = this.infraMonitorIdentityKey();
        if (!identity || state.identity !== identity) return false;
        return this.infraMonitorAvailable();
      },

      infraMonitorIdentity() {
        const state = this.infraMonitoring;
        if (!state) return false;
        const identity = this.infraMonitorIdentityKey();
        if (!identity) {
          this.infraMonitorDispose();
          return false;
        }
        if (state.identity === identity) return false;
        this.infraMonitorDispose();
        this.infraMonitoring.identity = identity;
        if (!this.infraMonitorAvailable()) return false;
        this.infraMonitorSync();
        this.infraMonitorRetrySelect();
        this.infraMonitorSchedule();
        return true;
      },

      infraMonitorScope(assetIds) {
        const source = Array.isArray(assetIds) ? assetIds : (this.source && this.source.assets);
        return uniqueIds((Array.isArray(source) ? source : []).map((asset) => (asset && asset.id) || asset));
      },

      infraMonitorRow(assetId) {
        const id = text(assetId);
        const state = this.infraMonitoring;
        if (!id || !state || !state.list.loaded) return null;
        return state.list.rows[id] || null;
      },

      // A marker only exists for an actionable measured state. Missing rows,
      // unmonitored devices and healthy devices stay unmarked.
      infraMonitorStatus(assetId) {
        const row = this.infraMonitorRow(assetId);
        if (!row) return null;
        const alerts = num(row.activeAlerts) || 0;
        const down = row.status === 'down';
        const degraded = row.status === 'degraded';
        if (!down && !degraded && !alerts) return null;
        return {
          assetId: row.assetId,
          status: row.status,
          tone: down ? 'down' : 'warn',
          alerts,
          label: statusText(row.status, row.statusLabel),
          reason: reasonText(row.reason, row.reasonLabel)
        };
      },

      infraMonitorPanel(assetId) {
        const id = text(assetId);
        const state = this.infraMonitoring;
        const available = this.infraMonitorAvailable();
        const row = this.infraMonitorRow(id);
        const detail = state ? state.detail : null;
        const detailLoaded = !!(detail && detail.loaded && detail.assetId === id && detail.record);
        const record = detailLoaded ? detail.record : null;
        const known = !!(record || row);
        const status = record ? record.status : (row ? row.status : '');
        const statusLabel = record
          ? statusText(record.status, record.statusLabel)
          : statusText(row && row.status, row && row.statusLabel);
        const tone = record ? record.statusTone : (row ? row.statusTone : 'neutral');
        const reasonLabel = record
          ? reasonText(record.reason, record.reasonLabel)
          : reasonText(row && row.reason, row && row.reasonLabel);
        const measured = !!MEASURED[status];
        const uptimePct = record ? num(record.uptime && record.uptime.percent) : num(row && row.uptimePct);
        const alerts = record
          ? (num(record.alerts && record.alerts.active) || 0)
          : (row ? (num(row.activeAlerts) || 0) : 0);
        const latencyMs = record ? num(record.latency && record.latency.currentMs) : num(row && row.latencyMs);
        const detailCheck = record && record.checks && record.checks.length ? record.checks[0] : null;
        const lastCheckAt = (detailCheck && detailCheck.lastCheckAt) || (row && row.lastCheckAt) || '';
        const values = [];
        if (known && measured && uptimePct !== null) {
          values.push({ key: 'uptime', label: tr('ui.infra.monitor.uptime'), value: percentText(uptimePct) });
        }
        if (known && lastCheckAt) {
          values.push({ key: 'lastCheck', label: tr('ui.dashboard.last_check'), value: stamp(lastCheckAt) });
        }
        if (known && alerts) {
          values.push({ key: 'alerts', label: tr('ui.monitoring.center.active_alerts'), value: String(alerts) });
        }
        if (known && measured && latencyMs !== null) {
          values.push({ key: 'latency', label: tr('ui.infra.monitor.latency'), value: latencyMs + ' ms' });
        }
        const examined = state ? state.list.examined : 0;
        const total = state ? state.list.total : 0;
        const checkedAt = state && state.list.checkedAt ? state.list.checkedAt : '';
        const coverage = examined && total
          ? tr('ui.infra.monitor.coverage', { examined: String(examined), total: String(total) })
          : '';
        let note = coverage;
        if (known) {
          const updated = checkedAt ? tr('ui.infra.monitor.updated', { time: stamp(checkedAt) }) : '';
          note = [coverage, updated].filter(Boolean).join(' · ');
        } else if (id) {
          note = [tr('ui.infra.monitor.not_loaded'), coverage].filter(Boolean).join(' · ');
        }
        const recent = record && record.alerts && Array.isArray(record.alerts.recent)
          ? record.alerts.recent.slice(0, CONSTANTS.ALERTS).map((alert) => ({
            id: text(alert.id) || text(alert.alertName),
            label: text(alert.alertName) || text(alert.name),
            tone: alert.severity === 'critical' ? 'down' : 'warn'
          }))
          : [];
        return {
          assetId: id,
          available,
          known,
          detailLoaded,
          status,
          statusLabel,
          tone,
          reasonLabel,
          uptime: uptimePct,
          alerts,
          values,
          recent,
          note,
          loading: !!(state && (state.list.loading || state.detail.loading)),
          // A device read can fail while the last good reading is still shown:
          // the reading stays and the failure is reported next to it.
          error: state ? (state.list.error || (id ? state.detail.error : '')) : ''
        };
      },

      infraMonitorSelect(assetId) {
        const id = text(assetId);
        const state = this.infraMonitoring;
        if (!state) return false;
        const changed = state.selectedId !== id;
        state.selectedId = id;
        if (!id) {
          state.retrySelect = '';
          return false;
        }
        const detail = state.detail;
        if (!changed && (!detail.loaded || detail.assetId === id)) return false;
        if (!this.infraMonitorAvailable()) {
          // The selection can resolve before the session does (a deep link
          // restores in front of the identity envelope). Remember it so the read
          // happens once the session is ready instead of being lost.
          state.retrySelect = id;
          return false;
        }
        state.retrySelect = '';
        return this.infraMonitorReadDetail(id, state.epoch);
      },

      infraMonitorRetrySelect() {
        const state = this.infraMonitoring;
        if (!state) return false;
        const id = text(state.retrySelect);
        if (!id || !this.infraMonitorAvailable()) return false;
        state.retrySelect = '';
        // The selection is already registered; the dedupe guard of a second
        // `infraMonitorSelect` would refuse the read the early return skipped.
        if (id === state.selectedId) return this.infraMonitorReadDetail(id, state.epoch);
        return this.infraMonitorSelect(id);
      },

      async infraMonitorRefresh(options) {
        const opts = options || {};
        const state = this.infraMonitoring;
        if (!state) return false;
        if (Array.isArray(opts.assetIds)) state.scope = uniqueIds(opts.assetIds);
        if (opts.selectedId !== undefined) state.selectedId = text(opts.selectedId);
        if (!this.infraMonitorAvailable()) return false;
        if (state.list.loading || state.detail.loading) {
          // A read is already on the wire. A selection or an identity change can
          // arrive in that window, so the request is queued instead of dropped;
          // the follow-up runs when the current read settles.
          state.pending = true;
          return false;
        }
        state.pending = false;
        state.identity = this.infraMonitorIdentityKey();

        state.epoch += 1;
        const epoch = state.epoch;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        state.list.loading = true;
        state.list.error = '';
        state.list.controller = controller;

        const requested = text(state.selectedId);
        if (requested) {
          const detail = state.detail;
          detail.assetId = requested;
          detail.loading = true;
          detail.error = '';
        }

        let applied = false;
        try {
          const payload = await this.infraMonitorSend(listPath(), controller);
          if (!this.infraMonitorCurrent(epoch)) return false;
          const items = payload && Array.isArray(payload.items) ? payload.items : [];
          const map = mapping();
          const rows = {};
          items.forEach((item) => {
            const row = map && map.mapDeviceRow ? map.mapDeviceRow(item) : null;
            if (row && row.assetId) rows[row.assetId] = row;
          });
          state.list.rows = rows;
          state.list.examined = items.length;
          state.list.total = num(payload && payload.total) === null ? items.length : num(payload.total);
          state.list.checkedAt = new Date().toISOString();
          state.list.loaded = true;
          applied = true;
        } catch (error) {
          if (!this.infraMonitorCurrent(epoch)) return false;
          if (!aborted(error)) state.list.error = text(error && error.message) || tr('ui.infra.monitor.error');
        } finally {
          if (this.infraMonitorCurrent(epoch)) {
            state.list.loading = false;
            // The selected device was queued for a read that this failed page
            // never started: leaving the flag set would keep the refresh button
            // disabled and the no-overlap guard would refuse every retry.
            if (!applied) state.detail.loading = false;
          }
          // A later generation owns the field now; the discarded read must not
          // clear the controller it no longer owns.
          if (state.list.controller === controller) state.list.controller = null;
        }
        if (applied && this.infraMonitorCurrent(epoch)) {
          const selected = text(state.selectedId);
          if (selected && selected !== requested) {
            // The selection moved while this page was on the wire; the new one
            // owns the detail read now.
            await this.infraMonitorReadDetail(selected, epoch);
          } else if (requested) {
            await this.infraMonitorReadDetail(requested, epoch);
          }
        }
        if (state.pending && this.infraMonitorCurrent(epoch)) {
          state.pending = false;
          await this.infraMonitorRefresh({ assetIds: state.scope });
        }
        return applied;
      },

      async infraMonitorReadDetail(assetId, epoch) {
        const state = this.infraMonitoring;
        const detail = state.detail;
        if (detail.controller) detail.controller.abort();
        if (detail.assetId !== assetId) {
          detail.loaded = false;
          detail.record = null;
          detail.checkedAt = '';
        }
        detail.request += 1;
        const request = detail.request;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        detail.assetId = assetId;
        detail.loading = true;
        detail.error = '';
        detail.missing = false;
        detail.controller = controller;
        try {
          const payload = await this.infraMonitorSend(devicePath(assetId), controller);
          if (!this.infraMonitorCurrent(epoch) || detail.request !== request || detail.assetId !== assetId) return false;
          const map = mapping();
          const record = map && map.mapDeviceDetail ? map.mapDeviceDetail(payload, CONSTANTS.PERIOD) : null;
          if (!record) return false;
          detail.record = Object.assign({}, record, { assetId: text(record.assetId) || assetId });
          detail.loaded = true;
          detail.checkedAt = new Date().toISOString();
          return true;
        } catch (error) {
          if (!this.infraMonitorCurrent(epoch) || detail.request !== request || detail.assetId !== assetId) return false;
          if (!aborted(error)) {
            detail.missing = !!(error && error.status === 404);
            detail.error = detail.missing ? '' : (text(error && error.message) || tr('ui.infra.monitor.error'));
            if (detail.missing) {
              // The device answered before and is gone now: the cached reading
              // is no longer evidence, so the panel falls back to the page row.
              detail.loaded = false;
              detail.record = null;
              detail.checkedAt = '';
            }
          }
          return false;
        } finally {
          if (detail.request === request) {
            detail.loading = false;
            detail.controller = null;
            // A refresh asked for while this read was open was queued, not
            // dropped: the queue drains here, once, and only for a live epoch.
            if (state.pending && this.infraMonitorCurrent(epoch)) {
              state.pending = false;
              this.infraMonitorRefresh({ assetIds: state.scope });
            }
          }
        }
      },

      async infraMonitorSend(path, controller) {
        const access = window.AssetAccess;
        const app = this.app;
        if (!access || typeof access.request !== 'function' || !app) {
          throw new Error(tr('ui.infra.monitor.error'));
        }
        const options = controller ? { signal: controller.signal } : {};
        return access.request(app, path, options);
      },

      infraMonitorSync() {
        const state = this.infraMonitoring;
        if (!state) return false;
        const scope = this.infraMonitorScope();
        state.scope = scope;
        // A deep link initialises the view selection before any click exists,
        // so the first read has to carry it: otherwise the block would paint
        // the page row and the device detail would never be read.
        return this.infraMonitorRefresh({ assetIds: scope, selectedId: this.infraMonitorSelection });
      },


      infraMonitorBoot() {
        if (typeof window === 'undefined') return;
        this.infraMonitorBind();
        if (!this.infraMonitorAvailable()) return;
        this.infraMonitorSync();
        this.infraMonitorRetrySelect();
        this.infraMonitorSchedule();
      },

      infraMonitorBind() {
        if (typeof document === 'undefined' || !document.addEventListener) return;
        if (this.__infraMonitorVisibility) return;
        this.__infraMonitorVisibility = () => this.infraMonitorVisibility();
        document.addEventListener('visibilitychange', this.__infraMonitorVisibility);
      },

      infraMonitorUnbind() {
        if (typeof document === 'undefined' || !document.removeEventListener) return;
        if (!this.__infraMonitorVisibility) return;
        document.removeEventListener('visibilitychange', this.__infraMonitorVisibility);
        this.__infraMonitorVisibility = null;
      },

      // Hiding the tab is a pause, not a pause of the timer alone: reads on the
      // wire are cancelled, the generation moves forward so a late answer is
      // discarded, and the last observation stays visible until the tab returns.
      infraMonitorPause() {
        const state = this.infraMonitoring;
        if (!state) return false;
        if (state.timer) clearTimeout(state.timer);
        state.timer = 0;
        if (state.list.controller) state.list.controller.abort();
        if (state.detail.controller) state.detail.controller.abort();
        state.list.controller = null;
        state.detail.controller = null;
        state.epoch += 1;
        state.list.loading = false;
        state.detail.loading = false;
        return true;
      },

      infraMonitorVisibility() {
        const state = this.infraMonitoring;
        if (!state) return;
        if (typeof document !== 'undefined' && document.hidden) {
          this.infraMonitorPause();
          return;
        }
        this.infraMonitorSync();
        this.infraMonitorSchedule();
      },

      infraMonitorSchedule() {
        const state = this.infraMonitoring;
        if (!state || state.timer || !this.infraMonitorAvailable()) return;
        const handle = setTimeout(() => {
          state.timer = 0;
          this.infraMonitorSync();
          this.infraMonitorSchedule();
        }, CONSTANTS.REFRESH_MS);
        if (handle && typeof handle.unref === 'function') handle.unref();
        state.timer = handle;
      },

      infraMonitorDispose() {
        const state = this.infraMonitoring;
        if (!state) return;
        if (state.timer) clearTimeout(state.timer);
        if (state.list.controller) state.list.controller.abort();
        if (state.detail.controller) state.detail.controller.abort();
        this.infraMonitoring = freshState(state.epoch + 1, '');
      },

      refreshSelectedMonitoring() {
        const selected = text(this.infraMonitoring.selectedId) || text(this.selectedId);
        return this.infraMonitorRefresh({ assetIds: this.infraMonitorScope(), selectedId: selected });
      }
    }
  };

  window.AssetInfrastructureMonitoring = InfraMonitoring;
  window.AssetInfrastructureMonitoringConstants = CONSTANTS;
})();
