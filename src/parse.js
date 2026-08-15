// A tolerant HTML table reader.
//
// The browser has a parser already, so this exists for node: the CLI, the tests and the
// fixtures all need the same cell structure the DOM adapter produces. It reads tags with a
// scanner rather than building a full document tree, because the only structure that matters
// here is table / caption / section / row / cell.
//
// Implicit closes are the whole difficulty. Real pages, and Wikipedia in particular, write
// `<tr><td>a<td>b` with no closing tags at all, so a cell ends when the next cell, row,
// section or table starts.

'use strict';

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

// Only these separate words. An inline tag does not: a browser renders `Rail<sup>[1]</sup>` as
// "Rail[1]" with no space, and the two readers here have to agree with the browser and with
// each other, because the same fixtures are checked through both.
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption',
  'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav',
  'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul',
]);

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '–',
  mdash: '—', hellip: '…', pound: '£', euro: '€', yen: '¥',
  cent: '¢', deg: '°', times: '×', minus: '−', laquo: '«',
  raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  bull: '•', dagger: '†', copy: '©', reg: '®', trade: '™',
  frac12: '½', frac14: '¼', sup2: '²', sup3: '³',
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch (err) {
        return whole;
      }
    }
    const key = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : whole;
  });
}

// Collapse the way a browser lays text out: runs of whitespace become one space, and a
// non-breaking space becomes an ordinary one so that "1 234" written with &nbsp; is still
// readable as a number later.
function collapse(text) {
  return decodeEntities(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAttributes(source) {
  const attrs = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    let value = match[2] === undefined ? '' : match[2];
    if (value.length > 1 && (value[0] === '"' || value[0] === "'")) value = value.slice(1, -1);
    attrs[match[1].toLowerCase()] = decodeEntities(value);
  }
  return attrs;
}

function spanOf(attrs, name) {
  const raw = attrs[name];
  if (raw === undefined) return 1;
  const digits = String(raw).match(/\d+/);
  if (!digits) return 1;
  const value = parseInt(digits[0], 10);
  // rowspan=0 means "to the end of this section" and is handled by the grid builder.
  // colspan=0 was dropped from HTML and is treated as 1.
  if (!Number.isFinite(value) || value < 0) return 1;
  if (value > 1000) return 1000;
  return value;
}

function newTable(attrs, depth) {
  return {
    attrs,
    depth,
    caption: '',
    rows: [],
    hasNestedTable: false,
    thCount: 0,
    tdCount: 0,
    hasExplicitHead: false,
  };
}

// Returns every table in the document, outermost first, each with its own cells only.
// A cell that itself contains a table keeps its text but the inner table is a separate entry.
function parseTables(html) {
  const source = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const tables = [];
  const stack = [];
  let skipTag = null;
  let captionOpen = false;
  let pending = 0;

  const top = () => (stack.length ? stack[stack.length - 1] : null);

  function closeCell() {
    const table = top();
    if (!table || !table.openCell) return;
    table.openCell.text = collapse(table.openCell.raw);
    delete table.openCell.raw;
    table.openCell = null;
  }

  function closeRow() {
    const table = top();
    if (!table) return;
    closeCell();
    table.openRow = null;
  }

  function addText(text) {
    if (skipTag || !text) return;
    const table = top();
    if (!table) return;
    if (captionOpen) {
      table.caption += text;
      return;
    }
    if (table.openCell) table.openCell.raw += text;
  }

  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
  let match;
  while ((match = tagPattern.exec(source)) !== null) {
    addText(source.slice(pending, match.index));
    pending = tagPattern.lastIndex;

    const closing = match[1] === '/';
    const name = match[2].toLowerCase();
    const rest = match[3] || '';

    if (skipTag) {
      if (closing && name === skipTag) skipTag = null;
      continue;
    }
    if (!closing && (name === 'script' || name === 'style')) {
      if (!/\/\s*$/.test(rest)) skipTag = name;
      continue;
    }

    if (name === 'table') {
      if (!closing) {
        const parent = top();
        if (parent) {
          parent.hasNestedTable = true;
          if (parent.openCell) parent.openCell.hasNestedTable = true;
        }
        const table = newTable(parseAttributes(rest), stack.length);
        table.openRow = null;
        table.openCell = null;
        table.section = null;
        tables.push(table);
        stack.push(table);
      } else if (stack.length) {
        closeRow();
        captionOpen = false;
        stack.pop();
      }
      continue;
    }

    const table = top();
    if (!table) continue;

    if (name === 'caption') {
      if (closing) captionOpen = false;
      else {
        closeCell();
        captionOpen = true;
      }
      continue;
    }
    if (name === 'thead' || name === 'tbody' || name === 'tfoot') {
      closeRow();
      table.section = closing ? null : name;
      if (!closing && name === 'thead') table.hasExplicitHead = true;
      continue;
    }
    if (name === 'tr') {
      closeRow();
      if (!closing) {
        table.openRow = { cells: [], section: table.section || 'tbody' };
        table.rows.push(table.openRow);
      }
      continue;
    }
    if (name === 'th' || name === 'td') {
      closeCell();
      if (closing) continue;
      if (!table.openRow) {
        table.openRow = { cells: [], section: table.section || 'tbody' };
        table.rows.push(table.openRow);
      }
      const attrs = parseAttributes(rest);
      const cell = {
        tag: name,
        header: name === 'th',
        colspan: Math.max(1, spanOf(attrs, 'colspan')),
        rowspan: spanOf(attrs, 'rowspan'),
        attrs,
        raw: '',
        text: '',
        hasNestedTable: false,
      };
      if (name === 'th') table.thCount += 1;
      else table.tdCount += 1;
      table.openRow.cells.push(cell);
      table.openCell = cell;
      continue;
    }
    if (VOID_TAGS.has(name)) {
      // An image or an input inside a cell carries no text. Its alt text is worth keeping.
      if (name === 'img' && !closing) {
        const attrs = parseAttributes(rest);
        if (attrs.alt) addText(' ' + attrs.alt + ' ');
        continue;
      }
      // br and hr are void and still break the line.
      if (BLOCK_TAGS.has(name)) addText(' ');
      continue;
    }
    // Any other tag. A block level one separates words, an inline one such as <a> or <sup>
    // does not, which is what the browser does when it lays the cell out.
    if (BLOCK_TAGS.has(name)) addText(' ');
  }
  addText(source.slice(pending));

  for (const table of tables) {
    if (table.openCell) {
      table.openCell.text = collapse(table.openCell.raw);
      delete table.openCell.raw;
    }
    delete table.openCell;
    delete table.openRow;
    delete table.section;
    table.caption = collapse(table.caption);
    for (const row of table.rows) {
      for (const cell of row.cells) {
        if (cell.raw !== undefined) {
          cell.text = collapse(cell.raw);
          delete cell.raw;
        }
      }
    }
  }
  return tables;
}

// The text of one cell, given its inner HTML. The DOM adapter hands its cells through here so
// that a cell reads the same whether it arrived as a string or as an element.
function textFromHtml(html) {
  const stripped = String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const flattened = stripped.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g,
    (whole, closing, name, rest) => {
      const tag = name.toLowerCase();
      if (tag === 'img' && !closing) {
        const alt = parseAttributes(rest).alt;
        return alt ? ` ${alt} ` : '';
      }
      return BLOCK_TAGS.has(tag) ? ' ' : '';
    });
  return collapse(flattened);
}

module.exports = { parseTables, collapse, decodeEntities, parseAttributes, textFromHtml, BLOCK_TAGS };
