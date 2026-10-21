'use strict';
// Thin helpers over the shared VM harness for the phase-4 inventory contract.
// The shared harness boots the real index.html script order with the real Vue
// runtime, so these tests exercise the adapter the browser actually runs.
const { setup } = require('./universal-harness.cjs');

const ASSET_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ID = '99999999-8888-7777-6666-555555555555';

function json(payload, status) {
  const code = status || 200;
  return { ok: code < 400, status: code, json: async () => payload };
}

function stubFetch(c, handler) {
  const calls = [];
  c.fetch = async (url, init) => {
    const call = { url, init: init || {}, rawBody: init ? init.body : undefined };
    try {
      call.body = call.rawBody ? JSON.parse(call.rawBody) : undefined;
    } catch (_) {
      call.body = undefined;
    }
    calls.push(call);
    return handler(call, calls.length);
  };
  return calls;
}

function dto(overrides) {
  return Object.assign(
    {
      id: ASSET_ID,
      quickCode: 'NB-CEN-001',
      name: 'Notebook de dirección',
      category: 'Notebooks',
      type: 'Notebook',
      brand: 'Lenovo',
      model: 'T14',
      serial: 'SN-1',
      ip: '10.0.0.15',
      site: 'Sede Central',
      location: 'Piso 4',
      responsible: 'Ana Benítez',
      status: 'in_use',
      description: '',
      cost: null,
      technical: null,
      archived: false,
      archivedAt: null,
      archivedBy: null,
      images: {},
      createdAt: '2026-01-05T10:00:00Z',
      updatedAt: '2026-01-06T11:30:00Z'
    },
    overrides
  );
}

function catalog(overrides) {
  const base = {
    commonFields: [
      'name', 'category', 'type', 'brand', 'model', 'serial', 'ip', 'site',
      'locationId', 'assigneeId', 'cost', 'statusId', 'image', 'description'
    ],
    fields: [
      { key: 'cpu', label: 'Procesador', type: 'text', active: true, required: false, options: [], unit: '', hint: '', maxLength: 500 },
      { key: 'ram', label: 'Memoria RAM', type: 'number', active: true, required: false, options: [], unit: 'GB', hint: '', maxLength: 500, minimum: 0, maximum: 4096 },
      { key: 'poe', label: 'Alimentación PoE', type: 'boolean', active: true, required: false, options: [], unit: '', hint: '', maxLength: 500 },
      { key: 'os', label: 'Sistema operativo', type: 'select', active: true, required: false, options: ['Linux', 'Windows'], unit: '', hint: '', maxLength: 500 },
      { key: 'installedAt', label: 'Fecha de alta física', type: 'date', active: true, required: false, options: [], unit: '', hint: '', maxLength: 500 },
      { key: 'retiredField', label: 'Campo retirado', type: 'text', active: false, required: false, options: [], unit: '', hint: '', maxLength: 500 }
    ],
    categories: [
      {
        id: 'notebooks', label: 'Notebooks', prefix: 'NB', type: 'Notebook', icon: 'laptop',
        active: true, fov: false,
        quick: ['name', 'type', 'brand', 'model', 'site', 'locationId', 'assigneeId', 'ip'],
        advanced: ['serial', 'cost', 'statusId', 'description'],
        tech: ['cpu', 'ram', 'poe', 'os', 'installedAt', 'retiredField'],
        transitions: null
      },
      {
        id: 'camaras', label: 'Cámaras', prefix: 'CAM', type: 'Cámara IP', icon: 'camera',
        active: true, fov: true,
        quick: ['name', 'type', 'brand', 'model', 'site', 'locationId', 'ip'],
        advanced: ['serial', 'cost', 'statusId', 'description'],
        tech: ['cpu'],
        transitions: { in_use: ['maintenance'] }
      },
      {
        id: 'ups', label: 'UPS', prefix: 'UPS', type: 'UPS', icon: 'battery',
        active: false, fov: false, quick: ['name'], advanced: [], tech: [], transitions: null
      }
    ],
    statuses: [
      { id: 'in_use', label: 'Asignado', tone: 'ok', final: false, active: true },
      { id: 'maintenance', label: 'Mantenimiento', tone: 'warn', final: false, active: true },
      { id: 'storage', label: 'En resguardo', tone: 'hold', final: false, active: true },
      { id: 'retired', label: 'Dado de baja', tone: 'down', final: true, active: true },
      { id: 'obsolete', label: 'Obsoleto', tone: 'hold', final: false, active: false }
    ],
    rules: {
      identification: { id: 'identification', separator: '-', quickPad: 3, siteCodeLength: 3, includeSite: true, order: 'site-type', siteCodes: { Central: 'CEN' } },
      transitions: { id: 'transitions', transitions: { in_use: ['maintenance', 'storage'], maintenance: ['in_use'] } }
    },
    operations: {
      environment: 'production',
      purge: {
        confirmationRequired: true,
        humanOnly: true,
        permission: 'assets.purge',
        archivedRequired: true,
        typedIdRequired: true,
        reasonRequired: true
      }
    }
  };
  return Object.assign(base, overrides);
}

module.exports = { setup, json, stubFetch, dto, catalog, ASSET_ID, OTHER_ID };
