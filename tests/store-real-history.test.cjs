'use strict';
// Real (non-demo) local assets must not gain invented history entries.
// The store is loaded in a vm with stubbed collaborators so the test exercises
// the actual merge path in assets/js/store.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const JS = path.join(__dirname, '..', 'assets', 'js');
const STORE = path.join(JS, 'store.js');

function passThrough(overrides) {
  return new Proxy(overrides, {
    get(target, key) {
      if (key in target) return target[key];
      return (value) => value;
    }
  });
}

function loadStore(storedAssets) {
  const storage = new Map();
  storage.set('asset-manager.assets', JSON.stringify(storedAssets));
  const localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  const enrichCalls = [];
  const win = {
    localStorage,
    AssetSchema: passThrough({
      normalizeAssets: (assets) => assets,
      normalizeAdmin: (admin) => admin || {},
      ensureForms: (admin) => admin
    }),
    AssetOpsData: passThrough({
      enrich: (assets) => { enrichCalls.push(assets); return assets; }
    }),
    AssetMapData: passThrough({ normalizeMaps: () => ({}) }),
    AssetMonitorEngine: passThrough({ normalize: () => ({}) }),
    AssetRelationsData: passThrough({})
  };
  const context = vm.createContext({ window: win, console });
  for (const file of [path.join(JS, 'data.js'), STORE]) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  return { win, enrichCalls, storage };
}

test('stored real assets are not enriched with demo history', () => {
  const asset = {
    id: 'real-1',
    name: 'Equipo real',
    createdAt: '2026-01-01T00:00:00.000Z',
    history: [],
    assigneeId: 'p1',
    assignee: 'Ana',
    statusId: 'mantenimiento'
  };
  const { win, enrichCalls } = loadStore([asset]);
  assert.equal(enrichCalls.length, 0, 'store must not call AssetOpsData.enrich on user data');
  const stored = win.AssetStore.assets || [];
  assert.equal(stored.some((item) => item.id === 'real-1' && item.history.length > 0), false);
});
