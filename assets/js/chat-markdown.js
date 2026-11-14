/* Safe markdown for chat messages.
 *
 * The model may print anything, so the whole message is HTML-escaped before
 * any transform runs and every tag below is a literal in this file: no user,
 * model or provider string can ever become markup. Because escaping happens
 * first, a leading `>` arrives here as `&gt;` and that is what blockquotes
 * match. The renderer is pure (no DOM), so the Node tests can execute it.
 */
(function () {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const FENCE_RE = /^ {0,3}```[ \t]*([^`\s]*)[^`]*$/;
  const HEADING_RE = /^ {0,3}(#{1,3})[ \t]+(.*)$/;
  const RULE_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
  const QUOTE_RE = /^ {0,3}&gt;[ \t]?(.*)$/;
  const ITEM_RE = /^([ \t]*)([-*]|\d{1,9}[.)])[ \t]+(.*)$/;
  const TABLE_SEP_RE = /^\s*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?\s*$/;
  const PLACEHOLDER_RE = /\u0000(\d+)\u0000/g;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return ESCAPES[character];
    });
  }

  const NAMED = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    colon: ':', sol: '/', commat: '@', period: '.', tab: '\t', newline: '\n'
  };

  // One entity pass. Unknown names stay exactly as written.
  function decodeEntities(value) {
    return String(value).replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, function (match, body) {
      if (body.charAt(0) === '#') {
        const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
        const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }
      const named = NAMED[body.toLowerCase()];
      return named === undefined ? match : named;
    });
  }

  // Repeated decoding, so an entity that the escaping pass nested cannot hide
  // a scheme. Bounded: the only failure mode is refusing the link.
  function decodeDeep(value) {
    let text = String(value || '');
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeEntities(text);
      if (next === text) break;
      text = next;
    }
    return text;
  }

  // Only http(s) and mailto targets, plus in-app `#/` routes, may become links.
  // Anything else (javascript:, data:, vbscript:, ...) stays literal text.
  function safeHref(raw) {
    const text = decodeDeep(raw).trim();
    if (!text) return '';
    if (/[\s"'<>`\\]/.test(text)) return '';
    if (/^https?:\/\/[^\s]+$/i.test(text)) return text;
    if (/^mailto:[^\s]+$/i.test(text)) return text;
    if (text.charAt(0) === '#' && text.charAt(1) === '/') return text;
    return '';
  }

  // Inline pass. Code and links are claimed first and replaced by placeholders,
  // so emphasis can never rewrite their contents or a URL attribute.
  function renderInline(source) {
    const held = [];
    const hold = function (html) {
      held.push(html);
      return '\u0000' + (held.length - 1) + '\u0000';
    };
    let text = source;

    text = text.replace(/`([^`\n]+)`/g, function (match, code) {
      return hold('<code class="md-inline">' + code + '</code>');
    });

    text = text.replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, function (match, label, url) {
      const href = safeHref(url);
      // A refused target stays exactly as written and is held, so the bare-URL
      // pass cannot adopt the address inside it.
      if (!href) return hold(match);
      return hold('<a href="' + escapeHtml(href) + '" rel="noopener noreferrer" target="_blank">' + label + '</a>');
    });

    text = text.replace(/https?:\/\/[^\s\u0000<>"`]+/gi, function (match) {
      let url = match.replace(/[.,;:!?]+$/, '');
      if (/&quot;$/.test(url)) url = url.slice(0, -6);
      if (/&#39;$/.test(url)) url = url.slice(0, -5);
      const href = safeHref(url);
      if (!href) return match;
      return hold('<a href="' + escapeHtml(href) + '" rel="noopener noreferrer" target="_blank">' + escapeHtml(href) + '</a>') +
        match.slice(url.length);
    });

    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    text = text.replace(/(^|[^\w])_([^_\n]+)_(?![\w])/g, '$1<em>$2</em>');

    // Held HTML may itself contain placeholders (a code span inside link text).
    let restored = text;
    for (let pass = 0; pass < 3 && restored.indexOf('\u0000') !== -1; pass += 1) {
      const previous = restored;
      restored = restored.replace(PLACEHOLDER_RE, function (match, index) {
        return held[Number(index)];
      });
      if (restored === previous) break;
    }
    return restored;
  }

  function codeBlock(language, code) {
    return '<pre class="md-code"><div class="md-code__bar">' +
      '<span class="md-code__lang">' + language + '</span>' +
      '<button type="button" class="md-code__copy" data-md-copy>Copy</button>' +
      '</div><code>' + code + '</code></pre>';
  }

  function splitRow(line) {
    let text = line.trim();
    if (text.charAt(0) === '|') text = text.slice(1);
    if (text.charAt(text.length - 1) === '|') text = text.slice(0, -1);
    return text.split('|').map(function (cell) { return cell.trim(); });
  }

  function table(head, rows) {
    const cell = function (tag, value) {
      return '<' + tag + '>' + renderInline(value) + '</' + tag + '>';
    };
    let html = '<div class="md-table"><table><thead><tr>' +
      head.map(function (value) { return cell('th', value); }).join('') +
      '</tr></thead><tbody>';
    rows.forEach(function (row) {
      html += '<tr>' + head.map(function (unused, index) {
        return cell('td', row[index] === undefined ? '' : row[index]);
      }).join('') + '</tr>';
    });
    return html + '</tbody></table></div>';
  }

  // One nesting level: an indented run is rendered inside the preceding item.
  function nestedList(entries) {
    const runs = [];
    entries.forEach(function (entry) {
      const tag = entry.ordered ? 'ol' : 'ul';
      const last = runs[runs.length - 1];
      if (last && last.tag === tag) last.items.push(entry.text);
      else runs.push({ tag: tag, items: [entry.text] });
    });
    return runs.map(function (run) {
      return '<' + run.tag + '>' + run.items.map(function (item) {
        return '<li>' + renderInline(item) + '</li>';
      }).join('') + '</' + run.tag + '>';
    }).join('');
  }

  function collectList(lines, start) {
    const ordered = /^\d/.test(ITEM_RE.exec(lines[start])[2]);
    const items = [];
    let index = start;
    while (index < lines.length) {
      const match = ITEM_RE.exec(lines[index]);
      if (!match) break;
      const indent = match[1].replace(/\t/g, '  ').length;
      const isOrdered = /^\d/.test(match[2]);
      if (indent >= 2 && items.length) {
        const owner = items[items.length - 1];
        if (!owner.subs) owner.subs = [];
        owner.subs.push({ ordered: isOrdered, text: match[3] });
        index += 1;
        continue;
      }
      if (isOrdered !== ordered) break;
      items.push({ text: match[3], subs: null });
      index += 1;
    }
    const tag = ordered ? 'ol' : 'ul';
    const html = items.map(function (item) {
      const subs = item.subs && item.subs.length ? nestedList(item.subs) : '';
      return '<li>' + renderInline(item.text) + subs + '</li>';
    }).join('');
    return { html: '<' + tag + '>' + html + '</' + tag + '>', next: index };
  }

  function render(text) {
    // Escape first: every later pass only ever sees inert text.
    const source = escapeHtml(text).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
    const lines = source.split('\n');
    const out = [];
    let paragraph = [];

    const flush = function () {
      if (!paragraph.length) return;
      out.push('<p>' + paragraph.map(renderInline).join('<br>') + '</p>');
      paragraph = [];
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];

      if (FENCE_RE.test(line)) {
        flush();
        const language = FENCE_RE.exec(line)[1] || '';
        const body = [];
        index += 1;
        while (index < lines.length && !/^ {0,3}```[ \t]*$/.test(lines[index])) {
          body.push(lines[index]);
          index += 1;
        }
        out.push(codeBlock(language, body.join('\n')));
        continue;
      }

      if (!line.trim()) {
        flush();
        continue;
      }

      const heading = HEADING_RE.exec(line);
      if (heading) {
        flush();
        const level = heading[1].length + 2; // # -> h3, ## -> h4, ### -> h5
        out.push('<h' + level + '>' + renderInline(heading[2].trim()) + '</h' + level + '>');
        continue;
      }

      if (RULE_RE.test(line)) {
        flush();
        out.push('<hr>');
        continue;
      }

      const quote = QUOTE_RE.exec(line);
      if (quote) {
        flush();
        const body = [quote[1]];
        while (index + 1 < lines.length && QUOTE_RE.test(lines[index + 1])) {
          body.push(QUOTE_RE.exec(lines[index + 1])[1]);
          index += 1;
        }
        out.push('<blockquote>' + body.map(renderInline).join('<br>') + '</blockquote>');
        continue;
      }

      if (line.indexOf('|') !== -1 && index + 1 < lines.length && TABLE_SEP_RE.test(lines[index + 1])) {
        const head = splitRow(line);
        const separator = splitRow(lines[index + 1]);
        if (head.length > 1 && head.length === separator.length) {
          flush();
          index += 1;
          const rows = [];
          while (index + 1 < lines.length) {
            const candidate = lines[index + 1];
            if (!candidate.trim() || candidate.indexOf('|') === -1) break;
            if (FENCE_RE.test(candidate) || RULE_RE.test(candidate)) break;
            rows.push(splitRow(candidate));
            index += 1;
          }
          out.push(table(head, rows));
          continue;
        }
      }

      if (ITEM_RE.test(line)) {
        flush();
        const list = collectList(lines, index);
        out.push(list.html);
        index = list.next - 1;
        continue;
      }

      paragraph.push(line);
    }

    flush();
    return out.join('\n');
  }

  const ChatMarkdown = { render: render, escapeHtml: escapeHtml, safeHref: safeHref };

  if (typeof window !== 'undefined') window.ChatMarkdown = ChatMarkdown;
  if (typeof module !== 'undefined' && module.exports) module.exports = ChatMarkdown;
})();
