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

function countMarkup(markup) {
  return literalTextNodes(stripNonContent(markup)).length + literalAttributes(stripNonContent(markup)).length;
}

function scanHtml(source) {
  const start = source.indexOf('<div id="app"');
  const end = source.indexOf('<script src="assets/vendor/', start);
  const shell = start >= 0 ? source.slice(start, end > start ? end : source.length) : source;
  return countMarkup(shell);
}

function scanModule(source) {
  return templateLiterals(source).reduce((total, markup) => total + countMarkup(markup), 0);
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

module.exports = { scanRepository, scanHtml, scanModule, templateLiterals, literalTextNodes, literalAttributes, countMarkup, ROOT };
