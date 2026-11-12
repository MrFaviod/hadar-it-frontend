'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./universal-harness.cjs');

test('CSV text neutralizes formula, whitespace and control prefixes without changing typed numbers', () => {
  const { c } = setup();
  const text = ['=1+1', '+SUM(1)', '-12', '@x', '  =1', '\ttext', '\rtext', '\ntext', '\u0001=1', '\u007f=1'];
  for (const value of text) {
    const actual = c.AssetTransferData.toCsv([], [[value]], ';');
    const escaped = "'" + value;
    const expected = /["\r\n;]/.test(escaped) ? '"' + escaped.replace(/"/g, '""') + '"' : escaped;
    assert.equal(actual, expected, JSON.stringify(value));
  }
  assert.equal(c.AssetTransferData.toCsv(['Label'], [[-12.5, 0, 12.5, 'safe', 'a;b', 'quote"', 'tail\r']], ';'),
    'Label\r\n-12.5;0;12.5;safe;"a;b";"quote""";"tail\r"');
});

test('dashboard download uses the transfer writer and retains numeric values and BOM', async () => {
  const { c } = setup();
  let blob, rows;
  c.URL.createObjectURL = value => { blob = value; return 'blob:test'; };
  c.URL.revokeObjectURL = () => {};
  c.document.createElement = () => ({ click() {} });
  c.setTimeout = () => 0;
  const original = c.AssetTransferData.toCsv;
  c.AssetTransferData.toCsv = (header, values, sep) => { rows = values; return original(header, values, sep); };
  c.AssetPanel.PanelOverview.methods.downloadReport.call({
    model: { rows: [{ asset: { name: '=1', code: '  +1' }, statusMeta: { label: 'OK' }, uptimePct: -2.5, latencyMs: 0, lastCheckAt: 'now' }] },
    app: { showToast() {} }
  });
  assert.ok(rows, 'panel must use the shared writer');
  assert.equal(rows[1][3], -2.5);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191]);
  assert.match(bytes.toString(), /'=1;'  \+1;OK;-2.5;0;now$/);
});

test('local export keeps cost typed so signed numeric values remain importable', () => {
  const { c, app } = setup();
  const result = c.AssetTransferEngine.buildExport(app, { assets: [{ name: 'A;B', cost: -12.5 }], fields: ['name', 'cost'], includeEmpty: true, separator: ';' });
  assert.equal(result.rows[0][1], -12.5);
  assert.match(result.csv, /"A;B";-12.5$/);
});


test('CSV exhaustively neutralizes C0, DEL and C1 plus Unicode whitespace in header and text only', () => {
  const { c } = setup();
  const codes = [...Array.from({length:32}, (_, i) => i), ...Array.from({length:33}, (_, i) => 127+i)];
  const whitespace = [0x20, 0xa0, 0x1680, ...Array.from({length:11}, (_,i)=>0x2000+i), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];
  const quote = value => /["\r\n;]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
  for (const code of [...codes, ...whitespace]) {
    const value = String.fromCodePoint(code) + 'text', original = { value };
    assert.equal(c.AssetTransferData.toCsv([value], [[value, -12.5, '-12.5', 0]], ';'),
      quote("'"+value) + '\r\n' + quote("'"+value) + ";-12.5;'-12.5;0", 'U+'+code.toString(16));
    assert.equal(original.value, value, 'export must not mutate source payload');
  }
  assert.equal(c.AssetTransferData.toCsv([], [['safe\u0085inside', 'quote";tail\r']], ';'), 'safe\u0085inside;"quote"";tail\r"');
});
