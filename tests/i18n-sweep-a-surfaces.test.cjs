'use strict';
// T3a sweep A continuation: the shell data arrays, the people directory
// methods, the workspace adapter messages and the configuration dialogs must
// read their copy from the `ui.*` catalog. Each case switches the shipped
// runtime to `en` and back to `es`, so a literal in either language fails here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

async function inLocale(s, locale, run) {
  // The runtime only switches once the target bundle is loaded.
  await s.c.ItsmI18n.loadBundle(locale);
  s.c.ItsmI18n.setLocale(locale);
  await s.tick();
  await s.settle();
  return run();
}

test('T3a shell data arrays render from the catalog', async () => {
  const s = setup();
  await inLocale(s, 'es', () => {
    assert.equal(s.app.configSections.find((item) => item.id === 'mapas').label, 'Mapas y planos');
    assert.equal(s.app.configSections.find((item) => item.id === 'mapas').hint, 'Sedes, planos y capas');
    assert.equal(s.app.sortOptions[0].label, 'Código');
    assert.equal(s.app.statusTones[2].label, 'Sin asignar');
    assert.equal(s.app.assetConfigTabs[3].label, 'Identificación');
    assert.equal(s.app.deviceImagePresets[7].label, 'UPS');
    assert.equal(s.app.integrationDefinitions[0].description, 'Acceso remoto puntual para soporte y asistencia.');
    s.app.route.section = 'no-such-section';
    assert.equal(s.app.configSectionLabel, 'Configuración');
  });
  await inLocale(s, 'en', () => {
    assert.equal(s.app.configSections.find((item) => item.id === 'mapas').label, 'Maps and floor plans');
    assert.equal(s.app.configSections.find((item) => item.id === 'mapas').hint, 'Sites, floor plans and layers');
    assert.equal(s.app.sortOptions[0].label, 'Code');
    assert.equal(s.app.statusTones[2].label, 'Unassigned');
    assert.equal(s.app.assetConfigTabs[3].label, 'Identification');
    assert.equal(s.app.deviceImagePresets[7].label, 'UPS');
    assert.equal(s.app.integrationDefinitions[0].description, 'One-off remote access for support and assistance.');
    assert.equal(s.app.configSectionLabel, 'Settings');
    // Ids, tones, icons and URLs stay stable so stored state and routes survive.
    assert.equal(s.app.configSections.find((item) => item.id === 'mapas').icon, 'map-pin');
    assert.equal(s.app.statusTones[2].value, 'hold');
    assert.equal(s.app.sortOptions.map((item) => item.value).join(','),
      'id-asc,name-asc,name-desc,site-asc,assignee-asc,type-asc');
    assert.equal(s.app.deviceImagePresets[7].src, 'assets/svg/devices/ups.svg');
  });
  s.c.ItsmI18n.setLocale('es');
});

test('T3a people directory methods render from the catalog', async () => {
  const s = setup();
  const people = s.c.AssetPeopleMethods;
  const personStatusLabel = (app, person) => people.personStatusLabel.call(app, person);
  await inLocale(s, 'en', () => {
    assert.equal(people.departmentLabel.call(s.app, 'missing'), 'No department');
    assert.equal(personStatusLabel(s.app, { active: true }), 'Active');
    assert.equal(personStatusLabel(s.app, { active: false }), 'Inactive');
  });
  await inLocale(s, 'es', () => {
    assert.equal(people.departmentLabel.call(s.app, 'missing'), 'Sin departamento');
    assert.equal(personStatusLabel(s.app, { active: true }), 'Activa');
    assert.equal(personStatusLabel(s.app, { active: false }), 'Inactiva');
  });
  // The canonical directory delegates to the server; the local dialog copy is
  // what the prototype branch renders, so the module methods are calleddirectly.
  s.app.personDialog = { mode: 'create', id: '', name: '', role: '', email: '', phone: '', departmentId: '', siteId: '' };
  await inLocale(s, 'en', () => {
    people.savePerson.call(s.app);
    assert.equal(s.app.personErrors.name, 'Enter the person name.');
  });
  await inLocale(s, 'es', () => {
    people.savePerson.call(s.app);
    assert.equal(s.app.personErrors.name, 'Introduce el nombre de la persona.');
  });
  // The directory and its department counts come from the server in canonical
  // mode, so the prototype branch is driven with an explicit receiver.
  const prototype = {
    serverOrganizationMode: false,
    departmentPeopleCount: () => 1,
    people: [],
    confirmDialog: null,
    showToast: () => {}
  };
  await inLocale(s, 'en', () => {
    people.requestDeleteDepartment.call(prototype, { id: 'd1', label: 'Operaciones' });
    assert.equal(prototype.confirmDialog.title, 'Department in use');
    assert.equal(prototype.confirmDialog.message, '“Operaciones” has 1 associated person.');
    assert.equal(prototype.confirmDialog.detail, 'Reassign those people to another department before deleting it.');
  });
  await inLocale(s, 'es', () => {
    people.requestDeleteDepartment.call(prototype, { id: 'd1', label: 'Operaciones' });
    assert.equal(prototype.confirmDialog.title, 'Departamento en uso');
    assert.equal(prototype.confirmDialog.message, '“Operaciones” tiene 1 persona asociada.');
  });
  s.c.ItsmI18n.setLocale('es');
});

test('T3a workspace adapter errors render from the catalog', async () => {
  const s = setup();
  const api = s.c.AssetPhase10Api;
  await inLocale(s, 'en', async () => {
    await assert.rejects(api.patchState(s.app, { themeMode: 'nope' }), /Invalid theme\./);
    await assert.rejects(api.patchState(s.app, { unknownField: 1 }), /Invalid workspace field: unknownField/);
    await assert.rejects(api.patchState(s.app, { widgets: 'nope' }), /Invalid widget layout\./);
  });
  await inLocale(s, 'es', async () => {
    await assert.rejects(api.patchState(s.app, { themeMode: 'nope' }), /Tema no válido\./);
    await assert.rejects(api.patchState(s.app, { unknownField: 1 }), /Campo de espacio de trabajo no válido: unknownField/);
    await assert.rejects(api.patchState(s.app, { widgets: 'nope' }), /Distribución de widgets no válida\./);
  });
  s.c.ItsmI18n.setLocale('es');
});

test('T3a configuration dialogs render from the catalog', async () => {
  const s = setup();
  // Same reason as the directory: the server wrapper owns the canonical write,
  // while these dialogs render the prototype branch.
  const config = s.c.AssetConfigMethods;
  s.app.config = { categories: [], sites: [], departments: [], integrations: {} };
  s.app.categoryDialog = { open: true, mode: 'create', id: '', label: '', description: '', image: '', icon: '' };
  await inLocale(s, 'en', () => {
    config.saveCategory.call(s.app);
    assert.equal(s.app.categoryErrors.label, 'Enter a category name.');
  });
  await inLocale(s, 'es', () => {
    config.saveCategory.call(s.app);
    assert.equal(s.app.categoryErrors.label, 'Introduce un nombre para la categoría.');
  });
  s.app.categoryDialog.label = 'Servidores';
  s.app.config.categories = [{ id: 'servidores', label: 'Servidores' }];
  s.app.assets = [{ id: 'a1', category: 'servidores' }];
  await inLocale(s, 'en', () => {
    config.requestDeleteCategory.call(s.app, { id: 'servidores', label: 'Servidores' });
    assert.equal(s.app.confirmDialog.title, 'Category in use');
    assert.equal(s.app.confirmDialog.message, '“Servidores” is assigned to 1 asset.');
    assert.equal(s.app.confirmDialog.detail, 'Reassign those assets to another category before deleting it.');
  });
  await inLocale(s, 'es', () => {
    config.requestDeleteCategory.call(s.app, { id: 'servidores', label: 'Servidores' });
    assert.equal(s.app.confirmDialog.title, 'Categoría en uso');
    assert.equal(s.app.confirmDialog.message, '“Servidores” está asignada a 1 activo.');
  });
  s.c.ItsmI18n.setLocale('es');
});
