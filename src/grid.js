// Turn a parsed table into a rectangle.
//
// This is the part that is actually hard. A table with colspan and rowspan is a sparse
// description of a grid, and every consumer downstream wants the dense one. The rules here
// follow how a browser lays a table out:
//
//   * cells are placed left to right into the first free slot on their row,
//   * a cell with rowspan occupies the slot in later rows too, so the row below starts
//     further right than its own cell count suggests,
//   * rowspan="0" runs to the end of its section,
//   * sections render thead, then tbody, then tfoot, whatever order they were written in,
//   * a row with too few cells leaves the tail of the rectangle empty rather than shifting.
//
// A merged cell's text is repeated into every slot it covers. That is the useful answer for
// CSV and SQL, and the slot records whether it was the anchor so nothing has to guess later.

'use strict';

const SECTION_ORDER = { thead: 0, tbody: 1, tfoot: 2 };

function orderRows(table) {
  const numbered = table.rows.map((row, index) => ({ row, index }));
  numbered.sort((a, b) => {
    const left = SECTION_ORDER[a.row.section] === undefined ? 1 : SECTION_ORDER[a.row.section];
    const right = SECTION_ORDER[b.row.section] === undefined ? 1 : SECTION_ORDER[b.row.section];
    if (left !== right) return left - right;
    return a.index - b.index;
  });
  return numbered.map((entry) => entry.row);
}

function sectionEnd(rows, start) {
  const section = rows[start].section;
  let end = start;
  while (end + 1 < rows.length && rows[end + 1].section === section) end += 1;
  return end;
}

function buildSlots(rows) {
  const slots = [];
  const notes = [];
  const ensure = (r) => {
    while (slots.length <= r) slots.push([]);
    return slots[r];
  };

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    ensure(r);
    let c = 0;
    for (const cell of row.cells) {
      while (slots[r][c] !== undefined) c += 1;
      let rowspan = cell.rowspan;
      if (rowspan === 0) {
        rowspan = sectionEnd(rows, r) - r + 1;
        notes.push(`row ${r} col ${c}: rowspan="0" expanded to ${rowspan} rows`);
      }
      rowspan = Math.max(1, Math.min(rowspan, rows.length - r));
      const colspan = Math.max(1, cell.colspan);
      for (let dr = 0; dr < rowspan; dr += 1) {
        const target = ensure(r + dr);
        for (let dc = 0; dc < colspan; dc += 1) {
          if (target[c + dc] !== undefined) {
            notes.push(`row ${r + dr} col ${c + dc}: overlapping spans, later cell dropped`);
            continue;
          }
          target[c + dc] = {
            text: cell.text,
            header: cell.header,
            anchor: dr === 0 && dc === 0,
            anchorRow: r,
            anchorCol: c,
            rowspan,
            colspan,
            merged: rowspan > 1 || colspan > 1,
            hasNestedTable: !!cell.hasNestedTable,
          };
        }
      }
      c += colspan;
    }
  }

  let width = 0;
  for (const row of slots) width = Math.max(width, row.length);
  const ragged = [];
  for (let r = 0; r < slots.length; r += 1) {
    let filled = 0;
    for (let c = 0; c < width; c += 1) {
      if (slots[r][c] === undefined) {
        slots[r][c] = {
          text: '', header: false, anchor: true, anchorRow: r, anchorCol: c,
          rowspan: 1, colspan: 1, merged: false, filler: true, hasNestedTable: false,
        };
      } else {
        filled += 1;
      }
    }
    if (filled < width) ragged.push({ row: r, filled, width });
  }
  return { slots, width, ragged, notes };
}

// How many rows at the top are header rows. An explicit thead wins. Without one, a leading run
// of rows whose anchor cells are all th counts, which is what a hand-written table does.
function headerRowCount(rows, slots) {
  let explicit = 0;
  while (explicit < rows.length && rows[explicit].section === 'thead') explicit += 1;
  if (explicit > 0) return explicit;
  let count = 0;
  for (let r = 0; r < slots.length; r += 1) {
    const anchors = slots[r].filter((slot) => slot.anchor && !slot.filler);
    if (anchors.length === 0) break;
    if (!anchors.every((slot) => slot.header)) break;
    count += 1;
  }
  // Every row being a header means the table is a list of labels, not a header block.
  if (count === slots.length) return slots.length > 1 ? 1 : 0;
  return count;
}

function uniquify(names) {
  const seen = new Map();
  return names.map((name) => {
    const count = seen.get(name) || 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });
}

// Collapse a stack of header rows into one name per column. A header spanning two columns
// repeats into both, so "Sales" over "2023" and "2024" becomes "Sales / 2023" and
// "Sales / 2024". A header spanning two rows repeats downward, and repeating a name into
// itself is noise, so consecutive duplicates collapse.
function columnNames(slots, headerRows, width, separator) {
  const names = [];
  for (let c = 0; c < width; c += 1) {
    const parts = [];
    for (let r = 0; r < headerRows; r += 1) {
      const slot = slots[r] && slots[r][c];
      const text = slot && slot.text ? slot.text.trim() : '';
      if (!text) continue;
      if (parts.length && parts[parts.length - 1] === text) continue;
      parts.push(text);
    }
    names.push(parts.length ? parts.join(separator) : `column_${c + 1}`);
  }
  return uniquify(names);
}

function buildGrid(table, options) {
  const opts = options || {};
  const separator = opts.separator === undefined ? ' / ' : opts.separator;
  const rows = orderRows(table);
  const { slots, width, ragged, notes } = buildSlots(rows);
  const headerRows = opts.headerRows === undefined ? headerRowCount(rows, slots) : opts.headerRows;
  const columns = columnNames(slots, headerRows, width, separator);

  const bodyRows = [];
  const footRows = [];
  for (let r = headerRows; r < slots.length; r += 1) {
    const values = [];
    for (let c = 0; c < width; c += 1) values.push(slots[r][c].text);
    if (rows[r] && rows[r].section === 'tfoot') footRows.push(bodyRows.length);
    bodyRows.push(values);
  }

  return {
    caption: table.caption || '',
    width,
    height: slots.length,
    headerRows,
    columns,
    slots,
    rows: bodyRows,
    footRows,
    ragged,
    notes,
    thCount: table.thCount,
    tdCount: table.tdCount,
    hasNestedTable: !!table.hasNestedTable,
    attrs: table.attrs || {},
    sections: rows.map((row) => row.section),
  };
}

// The flat rectangle, header row included. Useful for tests and for eyeballing a fixture.
function rectangle(grid) {
  const out = [];
  for (let r = 0; r < grid.height; r += 1) {
    const line = [];
    for (let c = 0; c < grid.width; c += 1) line.push(grid.slots[r][c].text);
    out.push(line);
  }
  return out;
}

module.exports = { buildGrid, rectangle, orderRows, columnNames, headerRowCount };
