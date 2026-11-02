'use strict';
// Counts human-visible hard-coded copy so the i18n sweep can only reduce it.
// A text node, placeholder, title, aria-label or alt counted here is copy that a
// translator cannot reach through a catalog key.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const VISIBLE_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt'];
const LETTER = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;

function stripNonContent(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
}

// Vue expressions and template-literal interpolations are code, not copy. They
// can embed `<`, `>` or braces that would otherwise split a text node or survive
// as if it were visible text, so they are removed before a literal is read.
function stripDelimited(source, opening) {
  let output = '';
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf(opening, index);
    if (start < 0) { output += source.slice(index); break; }
    let depth = 0;
    let quote = '';
    let cursor = start;
    let closed = false;
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (quote) { if (character === quote) quote = ''; continue; }
      if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
      if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth <= 0) { closed = true; cursor += 1; break; }
      }
    }
    if (!closed) { output += source.slice(start); break; }
    output += source.slice(index, start) + ' ';
    index = cursor;
  }
  return output;
}

function stripExpressions(markup) {
  return stripDelimited(stripDelimited(markup, '{{'), '${');
}

function literalTextNodes(markup) {
  const found = [];
  const pattern = />([^<>]+)</g;
  let match;
  while ((match = pattern.exec(stripExpressions(markup)))) {
    const value = match[1].replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').trim();
    if (value && LETTER.test(value)) found.push(value);
  }
  return found;
}

function literalAttributes(markup) {
  const found = [];
  markup = stripExpressions(markup);
  for (const attribute of VISIBLE_ATTRIBUTES) {
    // Bound values (`:title`, `v-bind:title`) are dynamic and never counted.
    const pattern = new RegExp('(?<![:\\w-])' + attribute + '\\s*=\\s*"([^"]*)"', 'g');
    let match;
    while ((match = pattern.exec(markup))) {
      const value = match[1].replace(/\{\{[\s\S]*?\}\}/g, ' ').trim();
      if (value && LETTER.test(value)) found.push(attribute + '=' + value);
    }
  }
  return found;
}

// Reads every `template: '<markup>'` literal in a module, including escaped
// quotes, so component copy is measured the same way as the HTML shell.
function templateLiterals(source) {
  const literals = [];
  const pattern = /template\s*:\s*/g;
  let match;
  while ((match = pattern.exec(source))) {
    const start = pattern.lastIndex;
    const quote = source[start];
    if (quote !== "'" && quote !== '"' && quote !== '`') continue;
    let index = start + 1;
    let value = '';
    while (index < source.length) {
      const character = source[index];
      if (character === '\\') { value += source[index + 1] || ''; index += 2; continue; }
      if (character === quote) break;
      value += character;
      index += 1;
    }
    literals.push(value);
    pattern.lastIndex = index + 1;
  }
  return literals;
}

// A literal is markup when it starts with a tag and closes one, which is how the
// views in this repository build a template that is not written inline. Starting
// at the tag keeps an inline script body, whose own kit templates contain tags,
// out of the count.
function looksLikeMarkup(value) {
  return /^\s*<\/?[a-zA-Z]/.test(value) && /<\/[a-zA-Z]/.test(value);
}

// A template literal may nest another template inside `${…}`, which is how the
// extension frame ships its inline kit. The reader therefore has to walk the
// interpolation instead of stopping at the first backtick it meets.
function skipInterpolation(source, start) {
  let depth = 0;
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') { index += 2; continue; }
    if (character === "'" || character === '"' || character === '`') {
      const nested = readLiteral(source, index);
      index = nested.end;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth <= 0) return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function readLiteral(source, start) {
  const quote = source[start];
  let index = start + 1;
  let value = '';
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') { value += source[index + 1] || ''; index += 2; continue; }
    if (character === quote) return { value, end: index + 1 };
    if (quote === '`' && character === '$' && source[index + 1] === '{') {
      const end = skipInterpolation(source, index + 1);
      value += source.slice(index, end);
      index = end;
      continue;
    }
    value += character;
    index += 1;
  }
  return { value, end: source.length };
}

function canStartRegex(source, index) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(source[cursor])) cursor -= 1;
  if (cursor < 0) return true;
  if (/[(,=:[!&|?{};+\-*%~^<>]/.test(source[cursor])) return true;
  const word = /([A-Za-z_$]+)\s*$/.exec(source.slice(Math.max(0, cursor - 12), cursor + 1));
  return !!word && ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof'].includes(word[1]);
}

function readRegex(source, start) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') { index += 2; continue; }
    if (character === '[') inClass = true;
    else if (character === ']') inClass = false;
    else if (character === '/' && !inClass) return index + 1;
    else if (character === '\n') return index;
    index += 1;
  }
  return source.length;
}

// Every string literal in the module, read with escapes so a concatenation such
// as `'<b>' + value + '</b>'` yields its real fragments instead of one runaway
// match. Comments and regular expressions are skipped first, so a quote inside
// `/["&<>]/g` never starts a literal.
function stringLiterals(source) {
  const spans = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '/' && source[index + 1] === '/') {
      const newline = source.indexOf('\n', index);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      index = close < 0 ? source.length : close + 2;
      continue;
    }
    if (character === '/' && canStartRegex(source, index)) {
      index = readRegex(source, index);
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      const literal = readLiteral(source, index);
      spans.push({ start: index, end: literal.end, value: literal.value, closed: source[literal.end - 1] === character });
      index = Math.max(literal.end, index + 1);
      continue;
    }
    index += 1;
  }
  return spans;
}

// Every literal that holds markup, however the module assigns it: the value of
// `template:`, a markup constant interpolated into a template, or a fragment
// joined with `+`. Reading the literal spans first keeps a `template:` written
// inside another string (the extension frame ships inline kit code) from being
// counted as the module's own markup. Translation-helper arguments are catalog
// keys, not copy.
function markupLiterals(source) {
  const literals = [];
  for (const span of stringLiterals(source)) {
    if (!span.closed) continue;
    // The extension frame ships a whole sandboxed document; its copy comes from
    // `frameMessages()`/`t()` at run time, so the document is not counted as
    // this app's markup and its inline script cannot leak code into the count.
    if (/<script/i.test(span.value)) continue;
    const previous = source.slice(Math.max(0, span.start - 60), span.start);
    if (/\b(?:\$t|ItsmI18n\.t|ItsmI18n\.te|tr|T|t|translate|label)\(\s*$/.test(previous)) continue;
    // A `template:` value is markup by contract; any other assigned literal
    // (an inline script body, a JSON payload) counts only when it really holds
    // markup, which is what keeps the frame kit out of the count.
    const isTemplate = /template\s*:\s*$/.test(previous);
    if (!isTemplate && !looksLikeMarkup(span.value)) continue;
    literals.push(span.value);
  }
  return literals;
}

// Strings passed to a translation helper are catalog keys, and a bare identifier,
// CSS token or quick-code prefix is not copy a translator can act on.
const NOT_COPY = [
  /^[a-z][a-z0-9_.:@?=&#/()]*$/, // slugs, routes, CSS classes, attribute names
  /^[a-z][A-Za-z0-9]*$/, // camelCase identifiers such as `logoDark`
  /^[-#./]/, // CSS variables, selectors and hash routes
  /^\d+[A-Za-z]+$/, // duration tokens such as `24h`
  /^url\(/, // SVG paint references such as `url(#garrow-)`
  /^[A-Z]{2,}-\d+$/ // quick-code prefixes such as `AM-0000`
];

function isCopyLiteral(value) {
  const trimmed = value.trim();
  if (trimmed.length < 3) return false;
  if (!LETTER.test(trimmed)) return false;
  if (NOT_COPY.some((pattern) => pattern.test(trimmed))) return false;
  // A class list such as `status status--` is styling, not copy.
  const tokens = trimmed.split(/\s+/);
  if (tokens.every((token) => /^[a-z][a-z0-9_-]*$/.test(token))) return false;
  return true;
}

// `{{ … }}`, a bound directive value and a `${…}` interpolation are code, so a
// quoted literal inside them is copy only when it reads as a human sentence.
function interpolationExpressions(markup) {
  const found = [];
  let index = 0;
  while (index < markup.length) {
    const start = markup.indexOf('${', index);
    if (start < 0) break;
    let depth = 0;
    let quote = '';
    let cursor = start + 1;
    let closed = -1;
    for (; cursor < markup.length; cursor += 1) {
      const character = markup[cursor];
      if (quote) { if (character === quote) quote = ''; continue; }
      if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
      if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth <= 0) { closed = cursor; break; }
      }
    }
    if (closed < 0) break;
    found.push(markup.slice(start + 2, closed));
    index = closed + 1;
  }
  return found;
}

function expressionLiterals(markup) {
  const expressions = [];
  for (const match of markup.matchAll(/\{\{([\s\S]*?)\}\}/g)) expressions.push(match[1]);
  for (const match of markup.matchAll(/(?:^|[\s"/])(?:[:@#]|v-)[\w:.\-[\]]*\s*=\s*"([^"]*)"/g)) expressions.push(match[1]);
  for (const expression of interpolationExpressions(markup)) expressions.push(expression);
  const found = [];
  for (const expression of expressions) {
    const code = expression
      .replace(/\$t\(\s*(['"])[^'"]*\1/g, ' ')
      .replace(/\b(?:ItsmI18n\.t|ItsmI18n\.te|tr|T|t|translate|label)\(\s*(['"])[^'"]*\1/g, ' ');
    for (const match of code.matchAll(/(['"])((?:[^\\]|\\.)*?)\1/g)) {
      const value = match[2].replace(/\\n/g, ' ').trim();
      if (isCopyLiteral(value)) found.push(value);
    }
  }
  return found;
}

function countMarkup(markup) {
  return literalTextNodes(stripNonContent(markup)).length
    + literalAttributes(stripNonContent(markup)).length
    + expressionLiterals(stripNonContent(markup)).length;
}

function scanHtml(source) {
  const start = source.indexOf('<div id="app"');
  const end = source.indexOf('<script src="assets/vendor/', start);
  const shell = start >= 0 ? source.slice(start, end > start ? end : source.length) : source;
  return countMarkup(shell);
}

function scanModule(source) {
  return markupLiterals(source).reduce((total, markup) => total + countMarkup(markup), 0);
}

function scanRepository() {
  const report = {};
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  report['index.html'] = scanHtml(html);
  const directory = path.join(ROOT, 'assets/js');
  for (const entry of fs.readdirSync(directory).sort()) {
    if (!entry.endsWith('.js')) continue;
    const source = fs.readFileSync(path.join(directory, entry), 'utf8');
    const count = scanModule(source);
    if (count > 0) report['assets/js/' + entry] = count;
  }
  const files = {};
  for (const key of Object.keys(report).sort()) files[key] = report[key];
  const total = Object.keys(files).reduce((sum, key) => sum + files[key], 0);
  return { files, total };
}

module.exports = {
  scanRepository, scanHtml, scanModule, templateLiterals, markupLiterals, stringLiterals, expressionLiterals,
  isCopyLiteral, literalTextNodes, literalAttributes, countMarkup, ROOT
};
