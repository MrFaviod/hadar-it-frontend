'use strict';

// Publish-readiness privacy guard (T4). The published repository carries only
// neutral examples: reserved example domains, RFC 1918 ranges and generic
// paths. Records that must stay private (AGENTS.md, odd/, docs/reviews/) are
// ignored rather than shipped, and published docs do not point at them. The
// OpenDesign manifest keeps its import-time hashes as history and records a
// sanitization-time snapshot separately, so the original provenance is never
// silently rewritten. The content scan, not a hash, is the privacy guard.
//
// The forbidden identifiers below are assembled from fragments on purpose:
// this file is itself part of the scanned product surface.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', '.verification', '.atl', '.codegraph',
  '__pycache__', '.venv', 'odd', '.worktrees', '.publish'
]);
const SKIP_FILES = new Set(['AGENTS.md']);
const SKIP_PATHS = ['docs/reviews/'];
const TEXT_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.json', '.css', '.html', '.md', '.ts', '.tsx',
  '.py', '.yml', '.yaml', '.conf', '.txt'
]);
const TEXT_FILENAMES = new Set(['Dockerfile', '.gitignore', '.dockerignore']);

const FORBIDDEN = [
  { label: 'private home directory', pattern: new RegExp('/home/' + 'informatica(?![A-Za-z0-9._-])') },
  { label: 'OpenDesign project identifier', pattern: new RegExp('78077567' + '-3e32-4db7-92e0-6ca8cf4d351b') },
  { label: 'organization name', pattern: new RegExp('produc' + 'ar', 'i') },
  { label: 'organization email domain', pattern: new RegExp('empresa' + '\\.local', 'i') },
  { label: 'site name', pattern: new RegExp('bella' + '\\s+vista', 'i') },
  { label: 'city name', pattern: new RegExp('san' + '\\s+lorenzo', 'i') },
  { label: 'derived site code', pattern: new RegExp('\\b[A-Za-z]{2,5}-' + 'BV\\b') },
  { label: 'device network ' + '192.168.' + '120.0/24', pattern: new RegExp('192\\.168\\.' + '120\\.') },
  { label: 'device network ' + '192.168.' + '10.0/24', pattern: new RegExp('192\\.168\\.' + '10\\.') },
  { label: 'demo network ' + '10.' + '30.0.0/16', pattern: new RegExp('(?:^|[^0-9.])10\\.' + '30\\.\\d{1,3}\\.\\d{1,3}(?![0-9])') }
];

// Published docs must not link or point at records that are never published.
const LOCAL_RECORD_REFERENCE = new RegExp(
  '(?<![A-Za-z0-9_.-])(?:odd/|AGENTS' + '\\.md\\b|docs/' + 'reviews)'
);

function isText(entry) {
  return TEXT_FILENAMES.has(entry) || TEXT_EXTENSIONS.has(path.extname(entry));
}

function collect(dir, relBase, out) {
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase ? relBase + '/' + dirent.name : dirent.name;
    if (dirent.isDirectory()) {
      if (SKIP_DIRS.has(dirent.name)) continue;
      if (SKIP_PATHS.some((prefix) => (rel + '/').startsWith(prefix))) continue;
      collect(path.join(dir, dirent.name), rel, out);
      continue;
    }
    if (!dirent.isFile()) continue;
    if (SKIP_FILES.has(rel)) continue;
    if (SKIP_PATHS.some((prefix) => rel.startsWith(prefix))) continue;
    if (!isText(dirent.name)) continue;
    out.push(rel);
  }
  return out;
}

function productFiles() {
  return collect(root, '', []).sort();
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function sha256(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
}

test('product files carry no private organization, host, project or network identifiers', () => {
  const findings = [];
  for (const rel of productFiles()) {
    const lines = read(rel).split('\n');
    lines.forEach((line, index) => {
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(line)) findings.push(rule.label + ' at ' + rel + ':' + (index + 1));
      }
    });
  }
  assert.deepEqual(findings, [], 'sensitive identifiers found: ' + findings.length);
});

test('the denylist recognizes every private identifier class', () => {
  const samples = [
    'San' + ' Lorenzo', 'san' + '  lorenzo', 'SL-' + 'BV', 'Bella' + ' Vista',
    'Produc' + 'ar', 'ana@empresa' + '.local', '192.168.' + '120.80', '10.' + '30.1.2'
  ];
  for (const sample of samples) {
    assert.ok(FORBIDDEN.some((rule) => rule.pattern.test(sample)), 'recognized: ' + sample.length + ' chars');
  }
  for (const neutral of ['Sede Norte', 'Sede Sur', 'example.invalid', '192.168.' + '50.10']) {
    assert.ok(!FORBIDDEN.some((rule) => rule.pattern.test(neutral)), 'accepted: ' + neutral);
  }
});

test('published documents do not reference unpublished local records', () => {
  const findings = [];
  for (const rel of productFiles().filter((file) => file.endsWith('.md'))) {
    read(rel).split('\n').forEach((line, index) => {
      if (LOCAL_RECORD_REFERENCE.test(line)) findings.push(rel + ':' + (index + 1));
    });
  }
  assert.deepEqual(findings, [], 'references to unpublished records: ' + findings.join(', '));
});

test('every absolute home path in product files points at the neutral home directory', () => {
  const findings = [];
  for (const rel of productFiles()) {
    const lines = read(rel).split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/\/home\/[A-Za-z0-9._-]+/g)) {
        if (match[0] !== '/home/user') findings.push(rel + ':' + (index + 1));
      }
    });
  }
  assert.deepEqual(findings, [], 'non-neutral home paths found: ' + findings.length);
});

test('demo monitoring channels use reserved example domains instead of a real organization domain', () => {
  const source = read('assets/js/monitoring-data.js');
  const addresses = source.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) || [];
  assert.ok(addresses.length > 0, 'the demo channel still has addresses');
  for (const address of addresses) {
    assert.match(address, /\.invalid$/, 'demo address must use a reserved domain: ' + address.split('@')[1]);
  }
  assert.match(source, /host:\s*'[^']*\.invalid'/, 'the SMTP host uses a reserved domain');
});

test('private records stay ignored while the existing ignore rules survive', () => {
  const gitignore = read('.gitignore').split('\n').map((line) => line.trim()).filter(Boolean);
  for (const entry of ['AGENTS.md', 'odd/', 'docs/reviews/', '.worktrees/', '.publish/', '.env', '.env.*']) {
    assert.ok(gitignore.includes(entry), '.gitignore ignores ' + entry);
  }
  for (const entry of ['node_modules', 'dist/', '.verification/', '.atl/', '.codegraph/', '__pycache__/', '*.local']) {
    assert.ok(gitignore.includes(entry), '.gitignore keeps ' + entry);
  }

  const dockerignore = read('.dockerignore').split('\n').map((line) => line.trim()).filter(Boolean);
  for (const entry of ['AGENTS.md', 'odd', 'docs/reviews', '.worktrees', '.publish', '.env', '.env.*']) {
    assert.ok(dockerignore.includes(entry), '.dockerignore excludes ' + entry);
  }
  for (const entry of ['.git', 'node_modules', 'dist', '.verification', '.venv', '.atl', '.codegraph', '__pycache__', '*.local']) {
    assert.ok(dockerignore.includes(entry), '.dockerignore keeps ' + entry);
  }
});

test('import manifest keeps original provenance and records sanitized hashes separately', () => {
  const manifest = JSON.parse(read('docs/opendesign/source-manifest.json'));

  assert.equal(manifest.projectId, '00000000-0000-4000-8000-000000000000');
  assert.match(manifest.source, /^\/home\/user\//);

  assert.equal(typeof manifest.sha256Note, 'string');
  assert.match(manifest.sha256Note, /import/i);
  assert.equal(typeof manifest.sanitized, 'object');
  assert.equal(typeof manifest.sanitized.note, 'string');
  assert.match(manifest.sanitized.note, /sanitiz/i);

  const sanitized = manifest.sanitized.sha256;
  assert.ok(sanitized && Object.keys(sanitized).length > 0, 'sanitization snapshot hashes are recorded');

  // The snapshot is history, not a pin: later legitimate edits to the demo
  // data must not fail this privacy guard.
  for (const [rel, snapshot] of Object.entries(sanitized)) {
    assert.ok(rel in manifest.sha256, 'sanitized file belongs to the imported manifest: ' + rel);
    assert.match(snapshot, /^[0-9a-f]{64}$/, 'snapshot is a SHA-256 digest: ' + rel);
    assert.notEqual(manifest.sha256[rel], snapshot, 'the import hash stays separate from the snapshot: ' + rel);
    assert.notEqual(
      manifest.sha256[rel], sha256(rel),
      'the imported original hash was not regenerated from the sanitized file: ' + rel
    );
  }
});
