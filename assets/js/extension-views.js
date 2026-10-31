/* Declarative extension views (SDK v2).
   Extensions describe their pages, asset panels, widgets and actions with data;
   the host renders them with its own components. No module code runs here. */
(function () {
  'use strict';

  const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
  const OPERATION_RE = /^[a-z][a-z0-9_]{0,63}$/;
  const COMPONENT_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
  const INPUTS = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'];
  const FORMATS = ['text', 'date', 'date-time', 'number', 'boolean'];
  // Declarative operation kinds whose arguments the server validates itself.
  const DECLARATIVE_KINDS = ['list', 'get', 'put', 'delete'];
  const MAX_COLUMNS = 12;
  const MAX_FIELDS = 30;
  const MAX_OPTIONS = 50;
  const PAGE_SIZE = 10;
  const EMPTY = {
    ok: false,
    error: 'La extensión no declara una vista válida.'
  };

  // Tables of one extension reload together after any of its forms saves, even
  // when the form lives in a different panel of the same page.
  const savedListeners = new Map();
  function onExtensionSaved(extensionId, listener) {
    if (!savedListeners.has(extensionId)) savedListeners.set(extensionId, new Set());
    savedListeners.get(extensionId).add(listener);
    return () => {
      const listeners = savedListeners.get(extensionId);
      if (!listeners) return;
      listeners.delete(listener);
      if (!listeners.size) savedListeners.delete(extensionId);
    };
  }
  function notifyExtensionSaved(extensionId) {
    Array.from(savedListeners.get(extensionId) || []).forEach((listener) => listener());
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value) {
    return typeof value === 'string' ? value : '';
  }

  function labelOf(value, fallback) {
    const label = text(value).trim();
    return label && label.length <= 80 ? label : fallback;
  }

  function operationIndex(operations) {
    if (!Array.isArray(operations)) return null;
    const index = new Map();
    operations.forEach((entry) => {
      if (typeof entry === 'string') {
        index.set(entry, 'handler');
        return;
      }
      if (!entry || typeof entry.name !== 'string') return;
      index.set(entry.name, typeof entry.kind === 'string' && entry.kind ? entry.kind : 'handler');
    });
    return index;
  }

  function operationKindOf(index, name) {
    const kind = index ? index.get(name) : 'handler';
    return DECLARATIVE_KINDS.indexOf(kind) === -1 ? 'handler' : kind;
  }

  function operationName(value, declared, kind) {
    if (typeof value !== 'string' || !OPERATION_RE.test(value)) {
      return { ok: false, error: 'La vista de ' + kind + ' necesita una operación con nombre válido.' };
    }
    if (declared && !declared.has(value)) {
      return { ok: false, error: 'La operación ' + value + ' no está declarada por la extensión.' };
    }
    return { ok: true, value };
  }

  function normalizeColumns(raw) {
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_COLUMNS) {
      return { ok: false, error: 'La tabla necesita entre 1 y ' + MAX_COLUMNS + ' columnas.' };
    }
    const columns = [];
    const seen = new Set();
    for (const column of raw) {
      if (!isPlainObject(column) || typeof column.field !== 'string' || !FIELD_RE.test(column.field)) {
        return { ok: false, error: 'Cada columna necesita un campo válido.' };
      }
      if (seen.has(column.field)) return { ok: false, error: 'La tabla repite la columna ' + column.field + '.' };
      seen.add(column.field);
      const format = column.format === undefined ? 'text' : column.format;
      if (FORMATS.indexOf(format) === -1) {
        return { ok: false, error: 'El formato de la columna ' + column.field + ' no está permitido.' };
      }
      columns.push({ field: column.field, label: labelOf(column.label, column.field), format });
    }
    return { ok: true, value: columns };
  }

  function normalizeOptions(raw, field) {
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_OPTIONS) {
      return { ok: false, error: 'El campo ' + field + ' necesita entre 1 y ' + MAX_OPTIONS + ' opciones.' };
    }
    const options = [];
    for (const option of raw) {
      if (typeof option === 'string' && option.length <= 80) {
        options.push({ value: option, label: option });
      } else if (isPlainObject(option) && typeof option.value === 'string' && option.value.length <= 80) {
        options.push({ value: option.value, label: labelOf(option.label, option.value) });
      } else {
        return { ok: false, error: 'Las opciones del campo ' + field + ' no son válidas.' };
      }
    }
    return { ok: true, value: options };
  }

  function normalizeFields(raw) {
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_FIELDS) {
      return { ok: false, error: 'El formulario necesita entre 1 y ' + MAX_FIELDS + ' campos.' };
    }
    const fields = [];
    const seen = new Set();
    for (const field of raw) {
      if (!isPlainObject(field) || typeof field.field !== 'string' || !FIELD_RE.test(field.field)) {
        return { ok: false, error: 'Cada campo del formulario necesita un nombre válido.' };
      }
      if (seen.has(field.field)) return { ok: false, error: 'El formulario repite el campo ' + field.field + '.' };
      seen.add(field.field);
      const input = field.input === undefined ? 'text' : field.input;
      if (INPUTS.indexOf(input) === -1) {
        return { ok: false, error: 'El tipo del campo ' + field.field + ' no está permitido.' };
      }
      const normalized = {
        field: field.field,
        label: labelOf(field.label, field.field),
        input,
        required: field.required === true
      };
      if (input === 'select') {
        const options = normalizeOptions(field.options, field.field);
        if (!options.ok) return options;
        normalized.options = options.value;
      }
      fields.push(normalized);
    }
    return { ok: true, value: fields };
  }

  function normalizeForm(raw, declared) {
    if (!isPlainObject(raw)) return { ok: false, error: 'El formulario declarado no es un objeto.' };
    const operation = operationName(raw.operation, declared, 'formulario');
    if (!operation.ok) return operation;
    const operationKind = operationKindOf(declared, operation.value);
    const fields = normalizeFields(raw.fields);
    if (!fields.ok) return fields;
    let assetField = '';
    if (raw.assetField !== undefined) {
      if (typeof raw.assetField !== 'string' || !FIELD_RE.test(raw.assetField)) {
        return { ok: false, error: 'El campo de activo del formulario no es válido.' };
      }
      assetField = raw.assetField;
    }
    return {
      ok: true,
      value: { kind: 'form', operation: operation.value, operationKind, fields: fields.value, assetField }
    };
  }

  function normalizeTable(raw, declared) {
    if (!isPlainObject(raw)) return { ok: false, error: 'La tabla declarada no es un objeto.' };
    const operation = operationName(raw.operation, declared, 'tabla');
    if (!operation.ok) return operation;
    const operationKind = operationKindOf(declared, operation.value);
    const columns = normalizeColumns(raw.columns);
    if (!columns.ok) return columns;
    let filterAsset = '';
    if (raw.filterAsset !== undefined) {
      if (typeof raw.filterAsset !== 'string' || !FIELD_RE.test(raw.filterAsset)) {
        return { ok: false, error: 'El filtro de activo de la tabla no es válido.' };
      }
      filterAsset = raw.filterAsset;
    }
    let form = null;
    if (raw.form !== undefined) {
      const normalized = normalizeForm(raw.form, declared);
      if (!normalized.ok) return normalized;
      form = normalized.value;
    }
    return {
      ok: true,
      value: { kind: 'table', operation: operation.value, operationKind, columns: columns.value, filterAsset, form }
    };
  }

  function normalizeIsolated(raw) {
    if (!isPlainObject(raw)) return { ok: false, error: 'La vista aislada declarada no es un objeto.' };
    if (typeof raw.component !== 'string' || !COMPONENT_RE.test(raw.component)) {
      return { ok: false, error: 'La vista aislada necesita un componente con nombre válido.' };
    }
    let height = 360;
    if (raw.height !== undefined) {
      if (!Number.isInteger(raw.height) || raw.height < 160 || raw.height > 2400) {
        return { ok: false, error: 'La altura de la vista aislada debe estar entre 160 y 2400 píxeles.' };
      }
      height = raw.height;
    }
    return { ok: true, value: { kind: 'isolated', component: raw.component, height } };
  }

  // `operations` is the list declared by the manifest. When it is omitted the
  // names are still validated, but membership is enforced later by the server.
  function normalizeView(raw, operations) {
    if (!isPlainObject(raw)) return EMPTY;
    const declared = operationIndex(operations);
    const kinds = ['table', 'form', 'isolated'].filter((kind) => raw[kind] !== undefined);
    if (kinds.length !== 1) {
      return { ok: false, error: 'La vista debe declarar exactamente un tipo: tabla, formulario o aislada.' };
    }
    if (kinds[0] === 'table') return normalizeTable(raw.table, declared);
    if (kinds[0] === 'form') return normalizeForm(raw.form, declared);
    return normalizeIsolated(raw.isolated);
  }

  function describeView(view) {
    if (!view || typeof view !== 'object') return 'Sin vista declarada.';
    if (view.kind === 'table') return 'Tabla declarativa sobre ' + view.operation + '.';
    if (view.kind === 'form') return 'Formulario declarativo sobre ' + view.operation + '.';
    if (view.kind === 'isolated') return 'Código aislado en un marco sin sesión (' + view.component + ').';
    return 'Sin vista declarada.';
  }

  function formatDate(value, options) {
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return new Intl.DateTimeFormat('es-ES', options).format(date);
    } catch (_) {
      return String(value);
    }
  }

  function formatNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
    try {
      return new Intl.NumberFormat('es-ES').format(value);
    } catch (_) {
      return String(value);
    }
  }

  function formatValue(value, format) {
    if (value === null || value === undefined || value === '') return '—';
    if (format === 'boolean') return value ? 'Sí' : 'No';
    if (format === 'date') return formatDate(value, { dateStyle: 'medium' });
    if (format === 'date-time') return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' });
    if (format === 'number') return formatNumber(value);
    if (Array.isArray(value)) return value.map((entry) => formatValue(entry, 'text')).join(', ');
    if (typeof value === 'object') return '—';
    return String(value);
  }

  function errorMessage(error) {
    if (error && typeof error.serverMessage === 'string' && error.serverMessage.trim()) {
      return error.serverMessage.trim().slice(0, 300);
    }
    const message = error && typeof error.message === 'string' && error.message
      ? error.message
      : 'La operación de la extensión falló.';
    return message.replace(/\s+/g, ' ').slice(0, 300);
  }

  const ExtensionTable = {
    name: 'ExtensionTable',
    components: { ItsmTable: window.ItsmTable, ItsmError: window.ItsmError },
    props: {
      app: { type: Object, required: true },
      item: { type: Object, required: true },
      view: { type: Object, required: true },
      asset: { type: Object, default: null }
    },
    data() {
      return { loading: false, loaded: false, error: '', rows: [], total: 0, limit: PAGE_SIZE, offset: 0, epoch: 0 };
    },
    computed: {
      sdk() {
        return window.AssetExtensions && typeof window.AssetExtensions.sdkFor === 'function'
          ? window.AssetExtensions.sdkFor(this.app, this.item)
          : null;
      },
      columns() {
        return (this.view.columns || []).map((column) => ({
          field: column.field,
          label: column.label || column.field,
          formatter: (value) => formatValue(value, column.format)
        }));
      },
      caption() {
        const name = this.item && this.item.manifest && this.item.manifest.name
          ? this.item.manifest.name
          : this.item && this.item.id ? this.item.id : 'Extensión';
        return 'Registros de ' + name;
      },
      filterValue() {
        const field = this.view.filterAsset;
        return field && this.asset && this.asset.id ? String(this.asset.id) : '';
      },
      canPrev() {
        return this.offset > 0 && !this.loading;
      },
      canNext() {
        return this.total > 0 && this.offset + this.limit < this.total && !this.loading;
      },
      rangeLabel() {
        if (this.loading && !this.loaded) return 'Cargando registros…';
        if (!this.rows.length) return 'Sin registros para mostrar.';
        const first = this.offset + 1;
        const last = Math.min(this.offset + this.limit, this.total || this.rows.length);
        return 'Mostrando ' + first + '–' + last + ' de ' + (this.total || this.rows.length);
      },
      emptyLabel() {
        return this.loaded ? 'La extensión no devolvió registros.' : 'Sin datos.';
      }
    },
    watch: {
      filterValue() {
        this.reload();
      }
    },
    mounted() {
      this.load();
      this.stopSaved = onExtensionSaved(this.item && this.item.id, () => this.reload());
    },
    beforeUnmount() {
      this.epoch += 1;
      if (this.stopSaved) this.stopSaved();
    },
    methods: {
      args() {
        const args = { limit: this.limit, offset: this.offset };
        if (!this.view.filterAsset || !this.filterValue) return args;
        // A declarative list validates filters on the server; a handler receives
        // its declared parameter as a top-level argument.
        if (this.view.operationKind === 'list') {
          args.filters = { [this.view.filterAsset]: this.filterValue };
        } else {
          args[this.view.filterAsset] = this.filterValue;
        }
        return args;
      },
      asRows(result) {
        let rows = [];
        if (Array.isArray(result)) rows = result;
        else if (result && typeof result === 'object') {
          if (Array.isArray(result.items)) rows = result.items;
          else if (Array.isArray(result.records)) rows = result.records;
        }
        // Module store records arrive as {id, version, data}; columns name data fields.
        return rows.map((row) => (isPlainObject(row) && isPlainObject(row.data) && typeof row.id === 'string'
          ? Object.assign({}, row.data, { id: row.id, version: row.version })
          : row));
      },
      async load() {
        if (!this.sdk) {
          this.error = 'La extensión ya no está activa.';
          return;
        }
        const epoch = ++this.epoch;
        this.loading = true;
        this.error = '';
        try {
          const result = await this.sdk.request(this.view.operation, this.args());
          if (epoch !== this.epoch) return;
          this.rows = this.asRows(result);
          const total = result && Number.isInteger(result.total) ? result.total : this.rows.length;
          this.total = Math.max(total, this.rows.length);
          this.loading = false;
          this.loaded = true;
        } catch (error) {
          if (epoch !== this.epoch) return;
          this.loading = false;
          this.loaded = true;
          this.rows = [];
          this.total = 0;
          this.error = errorMessage(error);
        }
      },
      reload() {
        this.offset = 0;
        return this.load();
      },
      next() {
        if (!this.canNext) return;
        this.offset += this.limit;
        return this.load();
      },
      prev() {
        if (!this.canPrev) return;
        this.offset = Math.max(0, this.offset - this.limit);
        return this.load();
      }
    },
    template: `
      <div class="extension-view extension-table-view">
        <itsm-error v-if="error" :error="error" :retry="true" retry-label="Reintentar" @retry="load">
        </itsm-error>
        <template v-else>
          <itsm-table :caption="caption" :columns="columns" :rows="rows" :loading="loading" :empty="emptyLabel"></itsm-table>
          <div class="extension-pager" role="group" :aria-label="'Paginación de ' + caption">
            <button type="button" class="btn btn--secondary btn--small" :disabled="!canPrev" aria-label="Página anterior" @click="prev">Anterior</button>
            <p class="extension-pager__status" role="status">{{ rangeLabel }}</p>
            <button type="button" class="btn btn--secondary btn--small" :disabled="!canNext" aria-label="Página siguiente" @click="next">Siguiente</button>
          </div>
        </template>
      </div>
    `
  };

  const ExtensionForm = {
    name: 'ExtensionForm',
    components: { ItsmField: window.ItsmField },
    props: {
      app: { type: Object, required: true },
      item: { type: Object, required: true },
      view: { type: Object, required: true },
      asset: { type: Object, default: null }
    },
    emits: ['saved'],
    data() {
      return { values: {}, errors: {}, busy: false, message: '', error: '', epoch: 0, sequence: 0 };
    },
    computed: {
      sdk() {
        return window.AssetExtensions && typeof window.AssetExtensions.sdkFor === 'function'
          ? window.AssetExtensions.sdkFor(this.app, this.item)
          : null;
      },
      fields() {
        return Array.isArray(this.view.fields) ? this.view.fields : [];
      },
      assetId() {
        return this.asset && this.asset.id ? String(this.asset.id) : '';
      },
      submitLabel() {
        return this.busy ? 'Guardando…' : 'Guardar';
      }
    },
    created() {
      const values = {};
      this.fields.forEach((field) => {
        values[field.field] = field.input === 'checkbox' ? false : '';
      });
      if (this.view.assetField && this.assetId) values[this.view.assetField] = this.assetId;
      this.values = values;
    },
    beforeUnmount() {
      this.epoch += 1;
    },
    methods: {
      controlId(field) {
        return 'extension-field-' + (this.item && this.item.id ? this.item.id : 'x') + '-' + field.field;
      },
      inputType(field) {
        if (field.input === 'number') return 'number';
        if (field.input === 'date') return 'date';
        return 'text';
      },
      optionList(field) {
        return Array.isArray(field.options) ? field.options.map((option) => (
          typeof option === 'string' ? { value: option, label: option } : option
        )) : [];
      },
      setValue(field, value) {
        this.values[field.field] = value;
        if (this.errors[field.field]) delete this.errors[field.field];
      },
      onSelect(field, event) {
        this.setValue(field, event.target.value);
      },
      onCheck(field, event) {
        this.setValue(field, event.target.checked);
      },
      validate() {
        const errors = {};
        this.fields.forEach((field) => {
          const value = this.values[field.field];
          if (field.required) {
            const empty = field.input === 'checkbox' ? value !== true : !String(value === null || value === undefined ? '' : value).trim();
            if (empty) errors[field.field] = 'Este campo es obligatorio.';
          }
          if (field.input === 'number' && String(value === undefined || value === null ? '' : value).trim() !== '' && Number.isNaN(Number(value))) {
            errors[field.field] = 'Introduce un número válido.';
          }
        });
        this.errors = errors;
        return Object.keys(errors).length === 0;
      },
      payload() {
        const values = {};
        this.fields.forEach((field) => {
          const value = this.values[field.field];
          if (field.input === 'checkbox') {
            values[field.field] = value === true;
            return;
          }
          if (String(value === null || value === undefined ? '' : value).trim() === '') return;
          values[field.field] = field.input === 'number' ? Number(value) : value;
        });
        if (this.view.assetField && this.assetId) values[this.view.assetField] = this.assetId;
        // A declarative put validates the record itself, so the declared fields
        // and the asset reference travel together inside `data`.
        if (this.view.operationKind === 'put') return { data: values };
        return values;
      },
      async submit() {
        if (this.busy) return false;
        this.message = '';
        this.error = '';
        if (!this.validate()) return false;
        if (!this.sdk) {
          this.error = 'La extensión ya no está activa.';
          return false;
        }
        const epoch = ++this.epoch;
        this.busy = true;
        try {
          const result = await this.sdk.request(this.view.operation, this.payload());
          if (epoch !== this.epoch) return false;
          this.busy = false;
          this.message = 'El servidor guardó el registro.';
          this.$emit('saved', result);
          notifyExtensionSaved(this.item && this.item.id);
          return true;
        } catch (error) {
          if (epoch !== this.epoch) return false;
          this.busy = false;
          this.error = errorMessage(error);
          return false;
        }
      }
    },
    template: `
      <form class="extension-form" novalidate @submit.prevent="submit">
        <template v-for="field in fields" :key="field.field">
          <itsm-field
            v-if="field.input !== 'select' && field.input !== 'checkbox'"
            :id="controlId(field)"
            :label="field.label"
            :model-value="values[field.field]"
            :type="inputType(field)"
            :multiline="field.input === 'textarea'"
            :required="field.required"
            :error="errors[field.field] || ''"
            @update:model-value="setValue(field, $event)"
          ></itsm-field>
        </template>
        <div v-if="fields.some((field) => field.input === 'select')" class="extension-form__selects">
          <template v-for="field in fields" :key="field.field">
            <div v-if="field.input === 'select'" class="field" :class="{ 'field--invalid': !!errors[field.field] }">
              <label :for="controlId(field)">{{ field.label }}<span v-if="field.required" class="itsm-field__required" aria-hidden="true"> *</span></label>
              <div class="input-shell">
                <select
                  :id="controlId(field)"
                  :value="values[field.field]"
                  :required="field.required"
                  :aria-invalid="errors[field.field] ? 'true' : null"
                  :aria-describedby="errors[field.field] ? controlId(field) + '-error' : null"
                  @change="onSelect(field, $event)"
                >
                  <option value=""></option>
                  <option v-for="option in optionList(field)" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </div>
              <p v-if="errors[field.field]" :id="controlId(field) + '-error'" class="field__error" role="alert">{{ errors[field.field] }}</p>
            </div>
          </template>
        </div>
        <div v-if="fields.some((field) => field.input === 'checkbox')" class="extension-form__checks">
          <template v-for="field in fields" :key="field.field">
            <div v-if="field.input === 'checkbox'" class="field extension-check" :class="{ 'field--invalid': !!errors[field.field] }">
              <label :for="controlId(field)" class="extension-check__label">
                <input
                  :id="controlId(field)"
                  type="checkbox"
                  :checked="values[field.field] === true"
                  :required="field.required"
                  :aria-invalid="errors[field.field] ? 'true' : null"
                  :aria-describedby="errors[field.field] ? controlId(field) + '-error' : null"
                  @change="onCheck(field, $event)"
                >
                <span>{{ field.label }}</span>
              </label>
              <p v-if="errors[field.field]" :id="controlId(field) + '-error'" class="field__error" role="alert">{{ errors[field.field] }}</p>
            </div>
          </template>
        </div>
        <p v-if="error" class="form-alert" role="alert">{{ error }}</p>
        <p v-if="message" class="config-note" role="status">{{ message }}</p>
        <div class="extension-form__actions">
          <button type="submit" class="btn btn--primary" :disabled="busy" :aria-busy="busy ? 'true' : 'false'">{{ submitLabel }}</button>
        </div>
      </form>
    `
  };

  const ExtensionIsolatedView = {
    name: 'ExtensionIsolatedView',
    components: { ItsmError: window.ItsmError },
    props: {
      app: { type: Object, required: true },
      item: { type: Object, required: true },
      view: { type: Object, required: true },
      asset: { type: Object, default: null }
    },
    data() {
      return {
        srcdoc: '',
        sandbox: window.ExtensionFrame ? window.ExtensionFrame.SANDBOX : 'allow-scripts',
        status: 'loading',
        error: '',
        height: this.view && this.view.height ? this.view.height : 360
      };
    },
    computed: {
      sdk() {
        return window.AssetExtensions && typeof window.AssetExtensions.sdkFor === 'function'
          ? window.AssetExtensions.sdkFor(this.app, this.item)
          : null;
      },
      title() {
        const name = this.item && this.item.manifest && this.item.manifest.name
          ? this.item.manifest.name
          : this.item && this.item.id ? this.item.id : 'Extensión';
        return 'Vista aislada de ' + name;
      }
    },
    mounted() {
      this.start();
      window.addEventListener('message', this.onMessage);
    },
    beforeUnmount() {
      window.removeEventListener('message', this.onMessage);
      if (this._bridge) {
        this._bridge.dispose();
        this._bridge = null;
      }
    },
    watch: {
      'app.themeResolved'() {
        if (this._bridge) this._bridge.sendTheme();
      }
    },
    methods: {
      onHeight(height) {
        this.height = height;
      },
      onMessage(event) {
        if (this._bridge) this._bridge.handleMessage(event);
      },
      async start() {
        if (!window.ExtensionFrame) {
          this.status = 'error';
          this.error = 'El host no tiene el aislamiento de extensiones disponible.';
          return;
        }
        try {
          const sources = await window.ExtensionFrame.loadSources({ frontendUrl: this.item.frontendUrl });
          this.srcdoc = window.ExtensionFrame.buildDocument({
            extensionId: this.item.id,
            component: this.view.component,
            title: this.title,
            vueSource: sources.vueSource,
            moduleSource: sources.moduleSource,
            theme: window.ExtensionFrame.themeTokens(window),
            origin: window.location.origin
          });
          this.$nextTick(() => this.connect());
          this.status = 'ready';
        } catch (error) {
          this.status = 'error';
          this.error = errorMessage(error);
        }
      },
      connect() {
        if (!this.$refs.frame || !window.ExtensionFrame) return;
        const permissions = [];
        (this.item.permissions || []).forEach((permission) => {
          const code = typeof permission === 'string' ? permission : permission && permission.code;
          if (!code) return;
          let granted = true;
          try {
            granted = !this.sdk || this.sdk.can(code);
          } catch (_) {
            granted = false;
          }
          if (granted) permissions.push(code);
        });
        this._bridge = window.ExtensionFrame.bridge({
          frame: this.$refs.frame,
          item: this.item,
          component: this.view.component,
          asset: this.asset,
          permissions,
          sdk: this.sdk,
          getTheme: () => window.ExtensionFrame.themeTokens(window),
          onHeight: this.onHeight,
          navigate: (page) => {
            if (window.AssetExtensions && typeof window.AssetExtensions.frameNavigate === 'function') {
              window.AssetExtensions.frameNavigate(this.app, this.item, page);
            }
          }
        });
      }
    },
    template: `
      <div class="extension-isolated">
        <itsm-error v-if="error" :error="error" :title="'No se pudo cargar la vista aislada'"></itsm-error>
        <p v-else-if="status === 'loading'" class="config-note" role="status">Cargando la vista aislada de la extensión…</p>
        <iframe
          ref="frame"
          class="extension-frame"
          :title="title"
          :sandbox="sandbox"
          :srcdoc="srcdoc"
          referrerpolicy="no-referrer"
          :style="{ height: height + 'px' }"
        ></iframe>
      </div>
    `
  };

  const ExtensionView = {
    name: 'ExtensionView',
    components: {
      ExtensionTable,
      ExtensionForm,
      ExtensionIsolatedView
    },
    props: {
      app: { type: Object, required: true },
      item: { type: Object, required: true },
      view: { type: Object, default: null },
      asset: { type: Object, default: null }
    },
    template: `
      <div class="extension-view">
        <template v-if="view && view.kind === 'table'">
          <extension-table
            ref="table"
            :app="app"
            :item="item"
            :view="view"
            :asset="asset"
          ></extension-table>
          <extension-form
            v-if="view.form"
            ref="form"
            :app="app"
            :item="item"
            :view="view.form"
            :asset="asset"
          ></extension-form>
        </template>
        <extension-form
          v-else-if="view && view.kind === 'form'"
          ref="form"
          :app="app"
          :item="item"
          :view="view"
          :asset="asset"
        ></extension-form>
        <extension-isolated-view
          v-else-if="view && view.kind === 'isolated'"
          :app="app"
          :item="item"
          :view="view"
          :asset="asset"
        ></extension-isolated-view>
        <p v-else class="config-note">La extensión no declara una vista válida.</p>
      </div>
    `
  };

  const ExtensionWidgets = {
    name: 'ExtensionWidgets',
    components: { ExtensionView },
    components: { ExtensionView },
    props: {
      app: { type: Object, required: true }
    },
    computed: {
      widgets() {
        return window.AssetExtensions && typeof window.AssetExtensions.widgetsFor === 'function'
          ? window.AssetExtensions.widgetsFor(this.app)
          : [];
      }
    },
    template: `
      <div v-if="widgets.length" class="extension-widgets">
        <section v-for="entry in widgets" :key="entry.key" class="noc-widget extension-widget" :aria-label="entry.widget.label">
          <header class="noc-widget-head">
            <div>
              <h2>{{ entry.widget.label }}</h2>
              <p class="noc-widget-sub">Extensión {{ entry.extensionName }} · solo lectura declarativa</p>
            </div>
          </header>
          <extension-view :app="app" :item="entry.item" :view="entry.widget.view"></extension-view>
        </section>
      </div>
    `
  };

  const ExtensionAssetActions = {
    name: 'ExtensionAssetActions',
    components: { ModalShell: window.ModalShell, AppIcon: window.AppIcon },
    props: {
      app: { type: Object, required: true },
      asset: { type: Object, default: null }
    },
    data() {
      return {
        busy: '',
        message: '',
        error: '',
        dialog: { open: false, action: null, busy: false, error: '' }
      };
    },
    computed: {
      actions() {
        return window.AssetExtensions && typeof window.AssetExtensions.actionsFor === 'function'
          ? window.AssetExtensions.actionsFor(this.app, this.asset)
          : [];
      },
      dialogTitle() {
        return this.dialog.action ? this.dialog.action.action.label : 'Confirmar acción';
      },
      dialogMessage() {
        if (!this.dialog.action) return '';
        const message = this.dialog.action.action.confirm;
        return typeof message === 'string' && message
          ? message
          : 'La extensión ejecutará la acción sobre el activo abierto.';
      }
    },
    methods: {
      sdkFor(action) {
        return window.AssetExtensions && typeof window.AssetExtensions.sdkFor === 'function'
          ? window.AssetExtensions.sdkFor(this.app, action.item)
          : null;
      },
      run(action) {
        this.message = '';
        this.error = '';
        if (!this.asset || !this.asset.id) {
          this.error = 'Abre un activo del servidor para usar esta acción.';
          return;
        }
        if (action.action.confirm) {
          this.dialog = { open: true, action, busy: false, error: '' };
          return;
        }
        return this.execute(action);
      },
      closeDialog() {
        if (this.dialog.busy) return;
        this.dialog = { open: false, action: null, busy: false, error: '' };
      },
      confirm() {
        return this.execute(this.dialog.action, true);
      },
      async execute(action, fromDialog) {
        if (!action || !this.asset || !this.asset.id) return false;
        const sdk = this.sdkFor(action);
        if (!sdk) {
          const message = 'La extensión ya no está activa.';
          if (fromDialog) this.dialog = Object.assign({}, this.dialog, { error: message });
          else this.error = message;
          return false;
        }
        if (fromDialog) this.dialog = Object.assign({}, this.dialog, { busy: true, error: '' });
        this.busy = action.key;
        try {
          const result = await sdk.request(action.action.operation, { assetId: String(this.asset.id) });
          this.busy = '';
          this.message = 'El servidor completó la acción.';
          this.dialog = { open: false, action: null, busy: false, error: '' };
          this.$emit('completed', { action: action.action.id, result });
          return true;
        } catch (error) {
          this.busy = '';
          if (fromDialog) this.dialog = Object.assign({}, this.dialog, { busy: false, error: errorMessage(error) });
          else this.error = errorMessage(error);
          return false;
        }
      }
    },
    template: `
      <div v-if="actions.length" class="extension-actions">
        <button
          v-for="action in actions"
          :key="action.key"
          type="button"
          class="btn btn--secondary"
          :disabled="busy === action.key"
          :aria-busy="busy === action.key ? 'true' : 'false'"
          @click="run(action)"
        >
          <app-icon :name="action.action.icon || 'bolt'"></app-icon>
          <span>{{ action.action.label }}</span>
        </button>
        <p v-if="message" class="extension-actions__status" role="status">{{ message }}</p>
        <p v-if="error" class="form-alert" role="alert">{{ error }}</p>
        <modal-shell :open="dialog.open" :title="dialogTitle" eyebrow="Extensión" size="small" @close="closeDialog">
          <p>{{ dialogMessage }}</p>
          <p v-if="dialog.error" class="form-alert" role="alert">{{ dialog.error }}</p>
          <template #footer>
            <button type="button" class="btn btn--secondary" :disabled="dialog.busy" @click="closeDialog">Cancelar</button>
            <button type="button" class="btn btn--primary" :disabled="dialog.busy" :aria-busy="dialog.busy ? 'true' : 'false'" @click="confirm">Confirmar acción</button>
          </template>
        </modal-shell>
      </div>
    `
  };

  ExtensionTable.components = {
    ItsmTable: window.ItsmTable,
    ItsmError: window.ItsmError,
    ExtensionForm
  };

  window.ExtensionViews = {
    sdkVersion: 2,
    normalizeView,
    describeView,
    formatValue,
    normalizeTable,
    normalizeForm,
    normalizeIsolated,
    components: {
      ExtensionView,
      ExtensionTable,
      ExtensionForm,
      ExtensionIsolatedView,
      ExtensionWidgets,
      ExtensionAssetActions
    }
  };
})();
