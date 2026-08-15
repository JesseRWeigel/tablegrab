// The four output formats. All of them read the typed analysis, so a number is a number in
// every one of them and the thousands separator is gone exactly once.

'use strict';

const SQL_TYPES = { date: 'DATE', string: 'TEXT' };

function cellText(cell) {
  if (!cell || cell.type === 'empty') return '';
  if (cell.type === 'number') return String(cell.value);
  if (cell.type === 'date') return cell.value;
  return cell.raw;
}

function csvField(text, delimiter) {
  const needsQuote = text.includes(delimiter) || text.includes('"') || /[\r\n]/.test(text)
    || text !== text.trim();
  return needsQuote ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCSV(analysis, options) {
  const opts = options || {};
  const delimiter = opts.delimiter || ',';
  const newline = opts.newline || '\n';
  const lines = [analysis.columns.map((column) => csvField(column.label, delimiter)).join(delimiter)];
  for (const row of analysis.rows) {
    lines.push(row.map((cell) => csvField(cellText(cell), delimiter)).join(delimiter));
  }
  return lines.join(newline) + newline;
}

function toJSON(analysis, options) {
  const opts = options || {};
  const records = analysis.rows.map((row) => {
    const record = {};
    row.forEach((cell, index) => {
      const column = analysis.columns[index];
      if (!cell || cell.type === 'empty') record[column.label] = null;
      else if (cell.type === 'number') record[column.label] = cell.value;
      else if (cell.type === 'date') record[column.label] = cell.value;
      else record[column.label] = cell.raw;
    });
    return record;
  });
  return JSON.stringify(records, null, opts.indent === undefined ? 2 : opts.indent) + '\n';
}

function mdCell(text) {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function toMarkdown(analysis) {
  const head = `| ${analysis.columns.map((column) => mdCell(column.label)).join(' | ')} |`;
  const rule = `| ${analysis.columns.map((column) => (column.type === 'number' ? '---:' : '---')).join(' | ')} |`;
  const body = analysis.rows.map(
    (row) => `| ${row.map((cell) => mdCell(cellText(cell))).join(' | ')} |`);
  return [head, rule, ...body].join('\n') + '\n';
}

function identifier(name, index) {
  let out = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!out) out = `column_${index + 1}`;
  if (/^\d/.test(out)) out = `c_${out}`;
  return out.slice(0, 63);
}

function uniqueIdentifiers(names) {
  const seen = new Map();
  return names.map((name, index) => {
    const base = identifier(name, index);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function sqlLiteral(cell) {
  if (!cell || cell.type === 'empty') return 'NULL';
  if (cell.type === 'number') return String(cell.value);
  const text = cell.type === 'date' ? cell.value : cell.raw;
  return `'${text.replace(/'/g, "''")}'`;
}

function sqlType(column) {
  if (column.type === 'number') return column.integer ? 'INTEGER' : 'REAL';
  return SQL_TYPES[column.type] || 'TEXT';
}

function toSQL(analysis, options) {
  const opts = options || {};
  const table = identifier(opts.table || analysis.caption || 'grabbed_table', 0);
  const names = uniqueIdentifiers(analysis.columns.map((column) => column.name));
  const widest = names.reduce((best, name) => Math.max(best, name.length), 0);
  const definitions = names.map(
    (name, index) => `  "${name}"${' '.repeat(widest - name.length)} ${sqlType(analysis.columns[index])}`);
  const create = `CREATE TABLE "${table}" (\n${definitions.join(',\n')}\n);`;
  if (!analysis.rows.length) return create + '\n';
  const tuples = analysis.rows.map(
    (row) => `  (${row.map((cell) => sqlLiteral(cell)).join(', ')})`);
  const insert = `INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(', ')}) VALUES\n`
    + `${tuples.join(',\n')};`;
  return `${create}\n${insert}\n`;
}

const FORMATS = { csv: toCSV, json: toJSON, md: toMarkdown, markdown: toMarkdown, sql: toSQL };

function emit(analysis, format, options) {
  const fn = FORMATS[String(format).toLowerCase()];
  if (!fn) throw new Error(`unknown format: ${format}`);
  return fn(analysis, options);
}

module.exports = { toCSV, toJSON, toMarkdown, toSQL, emit, identifier, uniqueIdentifiers, cellText };
