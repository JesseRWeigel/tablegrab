#!/usr/bin/env node
// The command line form of the bookmarklet, which is what the tests and the fingerprint drive.

'use strict';

const fs = require('fs');
const path = require('path');
const { parseTables, grabTable, rectangle } = require('../src/index');

const USAGE = `usage: tablegrab <file.html> [options]

  --index N        which table, in source order (default 0)
  --format F       csv, json, md, sql, grid (default csv)
  --table NAME     table name for the SQL output
  --day-first      read an ambiguous numeric date as day/month
  --force          export even if it looks like a layout table
  --list           list every table in the document and exit
`;

function parseArgs(argv) {
  const opts = { index: 0, format: 'csv' };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--index') opts.index = parseInt(argv[++i], 10);
    else if (arg === '--format') opts.format = argv[++i];
    else if (arg === '--table') opts.table = argv[++i];
    else if (arg === '--day-first') opts.dayFirst = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--list') opts.list = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else rest.push(arg);
  }
  opts.file = rest[0];
  return opts;
}

function summarise(result) {
  const { grid, analysis, verdict } = result;
  return {
    caption: grid.caption,
    width: grid.width,
    height: grid.height,
    headerRows: grid.headerRows,
    columns: analysis.columns.map((column) => ({
      name: column.name,
      label: column.label,
      type: column.type,
      integer: column.integer,
      currency: column.currency,
      percent: column.percent,
      warnings: column.warnings,
    })),
    rectangle: rectangle(grid),
    values: analysis.rows.map((row) => row.map((cell) => (cell.type === 'empty' ? null : cell.value))),
    footRows: grid.footRows,
    ragged: grid.ragged,
    notes: grid.notes,
    verdict,
  };
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help || !opts.file) {
    process.stdout.write(USAGE);
    return opts.help ? 0 : 2;
  }
  const html = fs.readFileSync(opts.file, 'utf8');

  if (opts.list) {
    const tables = parseTables(html);
    tables.forEach((table, index) => {
      let line;
      try {
        const result = grabTable(table, { force: true });
        line = `${index}: ${result.grid.height}x${result.grid.width} `
          + `header=${result.grid.headerRows} data=${result.verdict.isData} `
          + `score=${result.verdict.score} ${result.grid.caption || '(no caption)'}`;
      } catch (err) {
        line = `${index}: unreadable: ${err.message}`;
      }
      process.stdout.write(line + '\n');
    });
    return 0;
  }

  const tables = parseTables(html);
  const table = tables[opts.index];
  if (!table) {
    process.stderr.write(`no table at index ${opts.index}, ${tables.length} found in `
      + `${path.basename(opts.file)}\n`);
    return 1;
  }

  let result;
  try {
    // "grid" is a way of looking at the analysis rather than an output format.
    result = grabTable(table, { ...opts, format: opts.format === 'grid' ? null : opts.format });
  } catch (err) {
    process.stderr.write(err.message + '\n');
    return 3;
  }

  if (opts.format === 'grid') {
    process.stdout.write(JSON.stringify(summarise(result), null, 2) + '\n');
    return 0;
  }
  process.stdout.write(result.output);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main, parseArgs, summarise };
