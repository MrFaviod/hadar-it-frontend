'use strict';
// S3/S4/S10: every visible label in the asset schema seeds comes from the
// catalog: Spanish stays byte-for-byte, English is natural, and the stable ids
// and stored values never change with the locale.
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./universal-harness.cjs');

async function switchTo(s, tag) {
  await s.c.ItsmI18n.loadBundle(tag);
  s.c.ItsmI18n.setLocale(tag);
  await s.tick();
  await s.settle();
}

function labels(s) {
  const schema = s.c.AssetSchema;
  return {
    types: Array.from(schema.FIELD_TYPES, (entry) => entry.label),
    firstField: schema.COMMON_FIELDS.find((field) => field.key === 'name').label,
    group: schema.COMMON_FIELDS.find((field) => field.key === 'ip').group,
    statuses: Array.from(schema.STATUS_SEED, (status) => status.label),
    tones: [schema.TONE_LABELS.ok, schema.TONE_LABELS.warn, schema.TONE_LABELS.hold, schema.TONE_LABELS.down],
    libraryCpu: schema.FIELD_LIBRARY.find((field) => field.key === 'cpu'),
    presetType: schema.FORM_PRESETS.computadoras.type
  };
}

test('schema seed labels render the Spanish source first', async () => {
  const s = harness.setup();
  const seeded = labels(s);
  assert.deepEqual(seeded.types, ['Texto', 'Número', 'Selección', 'Sí / No', 'Fecha', 'URL', 'Texto largo']);
  assert.equal(seeded.firstField, 'Nombre');
  assert.equal(seeded.group, 'Red');
  assert.deepEqual(seeded.statuses, ['Asignado', 'En resguardo', 'Mantenimiento', 'Dado de baja']);
  assert.deepEqual(seeded.tones, ['Operativo', 'Atención', 'Sin asignar', 'Baja']);
  assert.equal(seeded.libraryCpu.label, 'Procesador');
  assert.equal(seeded.libraryCpu.hint, 'Modelo y núcleos.');
  assert.equal(seeded.presetType, 'Computadora');
  assert.equal(s.c.AssetSchema.FIELD_TYPES[0].value, 'text', 'the stable field type is untouched');
});

test('schema defaults, gaps and history fallbacks follow the locale', async () => {
  const s = harness.setup();
  const schema = s.c.AssetSchema;
  const admin = schema.defaultAdmin();
  assert.deepEqual(Array.from(schema.gaps({ category: 'computadoras', brand: '', model: 'm', serial: 's', site: 'x', locationId: 'l', assigneeId: 'p', cost: 0, ip: 'i' }, admin)), ['Marca', 'Coste']);

  await switchTo(s, 'en');
  const seeded = labels(s);
  assert.deepEqual(seeded.types, ['Text', 'Number', 'Select', 'Yes / No', 'Date', 'URL', 'Long text']);
  assert.equal(seeded.firstField, 'Name');
  assert.equal(seeded.group, 'Network');
  assert.deepEqual(seeded.statuses, ['Assigned', 'In storage', 'Maintenance', 'Retired']);
  assert.deepEqual(seeded.tones, ['Operational', 'Attention', 'Unassigned', 'Retired']);
  assert.equal(seeded.libraryCpu.label, 'Processor');
  assert.equal(seeded.libraryCpu.hint, 'Model and core count.');
  assert.equal(seeded.presetType, 'Computer');
  assert.deepEqual(Array.from(schema.gaps({ category: 'computadoras', brand: '', model: 'm', serial: 's', site: 'x', locationId: 'l', assigneeId: 'p', cost: 0, ip: 'i' }, admin)), ['Brand', 'Cost']);
  assert.equal(schema.STATUS_SEED[0].id, 'asignado', 'the stable status id is untouched');
  assert.equal(schema.FIELD_TYPES[0].value, 'text', 'the stable field type is untouched');

  await switchTo(s, 'es');
  assert.equal(labels(s).firstField, 'Nombre', 'the Spanish label returns after the switch');
});
