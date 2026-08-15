// Read a live DOM table into the same structure the string parser produces, so the grid,
// inference and emitters cannot tell where a table came from.

'use strict';

const { collapse, textFromHtml } = require('./parse');

function attrsOf(element) {
  const attrs = {};
  const list = element.attributes || [];
  for (let i = 0; i < list.length; i += 1) attrs[list[i].name.toLowerCase()] = list[i].value;
  return attrs;
}

function spanOf(element, name) {
  const raw = element.getAttribute(name);
  if (raw === null || raw === undefined) return 1;
  const digits = String(raw).match(/\d+/);
  if (!digits) return 1;
  const value = parseInt(digits[0], 10);
  if (!Number.isFinite(value) || value < 0) return 1;
  return Math.min(value, 1000);
}

function sectionOf(row) {
  let node = row.parentNode;
  while (node && node.nodeType === 1) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') return tag;
    if (tag === 'table') break;
    node = node.parentNode;
  }
  return 'tbody';
}

function nearestTable(node) {
  let current = node.parentNode;
  while (current && current.nodeType === 1) {
    if (current.tagName.toLowerCase() === 'table') return current;
    current = current.parentNode;
  }
  return null;
}

// A nested table's cells belong to the nested table, so they are removed before the text is
// read. The rest goes through the same flattener the string parser uses, rather than through
// textContent, so that an inline tag and a block tag are treated the same way in both.
function cellText(cell) {
  const clone = cell.cloneNode(true);
  const drop = clone.querySelectorAll ? clone.querySelectorAll('script,style,table') : [];
  for (let i = 0; i < drop.length; i += 1) {
    if (drop[i].parentNode) drop[i].parentNode.removeChild(drop[i]);
  }
  if (typeof clone.innerHTML === 'string') return textFromHtml(clone.innerHTML);
  return collapse(clone.textContent || '');
}

// Only the cells that belong to this table, so a nested table's cells stay with the nested one.
function fromDom(table) {
  const rows = [];
  let thCount = 0;
  let tdCount = 0;
  let hasNestedTable = !!(table.querySelector && table.querySelector('table'));
  let hasExplicitHead = !!(table.querySelector && table.querySelector('thead'));

  const allRows = table.querySelectorAll('tr');
  for (let i = 0; i < allRows.length; i += 1) {
    const row = allRows[i];
    if (nearestTable(row) !== table) continue;
    const record = { cells: [], section: sectionOf(row) };
    for (let j = 0; j < row.children.length; j += 1) {
      const cell = row.children[j];
      const tag = cell.tagName ? cell.tagName.toLowerCase() : '';
      if (tag !== 'th' && tag !== 'td') continue;
      if (tag === 'th') thCount += 1;
      else tdCount += 1;
      record.cells.push({
        tag,
        header: tag === 'th',
        colspan: Math.max(1, spanOf(cell, 'colspan')),
        rowspan: spanOf(cell, 'rowspan'),
        attrs: attrsOf(cell),
        text: cellText(cell),
        hasNestedTable: !!(cell.querySelector && cell.querySelector('table')),
      });
    }
    rows.push(record);
  }

  const caption = table.querySelector('caption');
  return {
    attrs: attrsOf(table),
    depth: 0,
    caption: caption && nearestTable(caption) === table ? collapse(caption.textContent || '') : '',
    rows,
    hasNestedTable,
    thCount,
    tdCount,
    hasExplicitHead,
  };
}

module.exports = { fromDom, cellText };
