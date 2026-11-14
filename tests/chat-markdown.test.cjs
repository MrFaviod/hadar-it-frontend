'use strict';
// Safe chat markdown: every case runs the shipped browser file inside a bare
// vm context (no DOM, like the other engine tests). The XSS block is the point
// of the module, so it is asserted on the produced string, not on a DOM parse.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'chat-markdown.js'), 'utf8');

function load(extra) {
  const context = Object.assign({}, extra || {});
  context.window = context;
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'chat-markdown.js' });
  return context;
}

const browser = load();
const render = (text) => browser.ChatMarkdown.render(text);

test('the renderer loads as window.ChatMarkdown and is pure', () => {
  assert.ok(browser.ChatMarkdown, 'window.ChatMarkdown exists');
  assert.equal(typeof browser.ChatMarkdown.render, 'function');
  assert.equal(typeof browser.document, 'undefined', 'no DOM is needed');
  assert.equal(render('hola'), '<p>hola</p>');
});

test('the whole message is HTML-escaped before anything else runs', () => {
  assert.equal(
    render('a & b < c > d "e" \'f\''),
    '<p>a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;</p>'
  );
  assert.equal(render('&lt;script&gt;'), '<p>&amp;lt;script&amp;gt;</p>');
  assert.equal(render('**<b>hi</b>**'), '<p><strong>&lt;b&gt;hi&lt;/b&gt;</strong></p>');
});

test('a script tag stays text', () => {
  const html = render('<script>alert(1)</script>');
  assert.equal(html, '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.doesNotMatch(html, /<script/i);
});

test('an image with an inline handler stays text', () => {
  const html = render('<img src=x onerror=alert(1)>');
  assert.equal(html, '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.doesNotMatch(html, /<img|<[^>]*onerror/i);
});

test('a fenced block renders the bar, the language and the copy button', () => {
  const source = ['```js', 'const a = 1;', '```'].join('\n');
  assert.equal(
    render(source),
    '<pre class="md-code"><div class="md-code__bar">' +
      '<span class="md-code__lang">js</span>' +
      '<button type="button" class="md-code__copy" data-md-copy>Copy</button>' +
      '</div><code>const a = 1;</code></pre>'
  );
});

test('a fence without a language keeps an empty label', () => {
  const html = render(['```', 'plain', '```'].join('\n'));
  assert.match(html, /<span class="md-code__lang"><\/span>/);
  assert.match(html, /<code>plain<\/code>/);
});

test('a code block escapes HTML and never receives another transform', () => {
  const source = ['```html', '<script>alert(1)</script>', '**not bold** # not a heading', '- not a list', '```'].join('\n');
  const html = render(source);
  assert.match(html, /<code>&lt;script&gt;alert\(1\)&lt;\/script&gt;\n\*\*not bold\*\* # not a heading\n- not a list<\/code>/);
  assert.doesNotMatch(html, /<strong>|<em>|<h[1-6]|<li>/);
});

test('inline code is escaped, classed and never transformed inside', () => {
  const html = render('usa `[x](javascript:1) **no**` ahora');
  assert.equal(html, '<p>usa <code class="md-inline">[x](javascript:1) **no**</code> ahora</p>');
  const script = render('`<script>alert(1)</script>`');
  assert.equal(script, '<p><code class="md-inline">&lt;script&gt;alert(1)&lt;/script&gt;</code></p>');
});

test('bold and both italic markers render', () => {
  assert.equal(render('**fuerte**'), '<p><strong>fuerte</strong></p>');
  assert.equal(render('*suave*'), '<p><em>suave</em></p>');
  assert.equal(render('_suave_'), '<p><em>suave</em></p>');
  assert.equal(render('**a** y *b* y _c_'), '<p><strong>a</strong> y <em>b</em> y <em>c</em></p>');
});

test('headings map to h3, h4 and h5 and never to h1 or h2', () => {
  assert.equal(render('# uno'), '<h3>uno</h3>');
  assert.equal(render('## dos'), '<h4>dos</h4>');
  assert.equal(render('### tres'), '<h5>tres</h5>');
  const html = render(['# uno', '## dos', '### tres'].join('\n'));
  assert.doesNotMatch(html, /<h[12][ >]/);
});

test('unordered lists render with either marker', () => {
  assert.equal(render('- uno\n- dos'), '<ul><li>uno</li><li>dos</li></ul>');
  assert.equal(render('* uno\n* dos'), '<ul><li>uno</li><li>dos</li></ul>');
});

test('a list supports one nesting level', () => {
  assert.equal(
    render('- uno\n- dos\n  - dos a\n  - dos b\n- tres'),
    '<ul><li>uno</li><li>dos<ul><li>dos a</li><li>dos b</li></ul></li><li>tres</li></ul>'
  );
});

test('ordered lists render as ol', () => {
  assert.equal(render('1. uno\n2. dos'), '<ol><li>uno</li><li>dos</li></ol>');
});

test('a blockquote groups its consecutive lines', () => {
  assert.equal(render('> cita\n> mas'), '<blockquote>cita<br>mas</blockquote>');
});

test('a horizontal rule renders as hr', () => {
  assert.equal(render('---'), '<hr>');
});

test('a GFM pipe table renders inside the scroll wrapper', () => {
  const source = ['nombre | estado', '--- | ---', 'srv-1 | activo', 'srv-2 | **baja**'].join('\n');
  assert.equal(
    render(source),
    '<div class="md-table"><table><thead><tr><th>nombre</th><th>estado</th></tr></thead><tbody>' +
      '<tr><td>srv-1</td><td>activo</td></tr>' +
      '<tr><td>srv-2</td><td><strong>baja</strong></td></tr>' +
      '</tbody></table></div>'
  );
});

test('an https link opens in a new tab with noopener', () => {
  assert.equal(
    render('[sitio](https://example.com/x)'),
    '<p><a href="https://example.com/x" rel="noopener noreferrer" target="_blank">sitio</a></p>'
  );
});

test('mailto and in-app #/ routes are accepted targets', () => {
  assert.match(render('[mail](mailto:it@example.com)'), /<a href="mailto:it@example\.com" rel="noopener noreferrer" target="_blank">/);
  assert.match(render('[activo](#/activo/1)'), /<a href="#\/activo\/1" rel="noopener noreferrer" target="_blank">/);
});

test('a bare url becomes a link and trailing punctuation stays text', () => {
  assert.equal(
    render('ver https://example.com/a?b=1. fin'),
    '<p>ver <a href="https://example.com/a?b=1" rel="noopener noreferrer" target="_blank">https://example.com/a?b=1</a>. fin</p>'
  );
});

test('javascript: targets render as plain text', () => {
  assert.equal(render('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.doesNotMatch(render('[x](javascript:alert(1))'), /<a[\s>]/);
});

test('a mixed-case javascript: scheme is refused', () => {
  assert.equal(render('[x](JaVaScRiPt:alert(1))'), '<p>[x](JaVaScRiPt:alert(1))</p>');
});

test('an entity-encoded scheme is decoded before the scheme check', () => {
  assert.equal(render('[x](&#106;avascript:alert(1))'), '<p>[x](&amp;#106;avascript:alert(1))</p>');
});

test('data: and vbscript: targets render as plain text', () => {
  assert.doesNotMatch(render('[x](data:text/html,<b>x</b>)'), /<a[\s>]/);
  assert.match(render('[x](data:text/html,<b>x</b>)'), /\[x\]\(data:text\/html,&lt;b&gt;x&lt;\/b&gt;\)/);
  assert.doesNotMatch(render('[x](vbscript:msgbox(1))'), /<a[\s>]/);
});

test('a quote in the url cannot break out of the href attribute', () => {
  const html = render('[x](https://a.com" onmouseover="x)');
  assert.doesNotMatch(html, /<a[\s>]/);
  assert.doesNotMatch(html, /<[^>]*onmouseover/i);
  assert.match(html, /\[x\]\(https:\/\/a\.com&quot; onmouseover=&quot;x\)/);
});

test('blank lines separate paragraphs and single newlines break the line', () => {
  assert.equal(render('uno\ndos'), '<p>uno<br>dos</p>');
  assert.equal(render('uno\n\ndos'), '<p>uno</p>\n<p>dos</p>');
});

test('an empty message renders nothing', () => {
  assert.equal(render(''), '');
  assert.equal(render('   '), '');
});

test('the renderer also exports itself when a module object exists', () => {
  const context = load({ module: { exports: {} } });
  assert.equal(context.module.exports, context.ChatMarkdown);
  assert.equal(context.module.exports.render('# ok'), '<h3>ok</h3>');
});
