#!/usr/bin/env node
// Infer one value at a time, with no column around it. The fingerprint uses this to watch the
// type rules directly rather than only through a table.

'use strict';

const { inferValue } = require('../src/infer');

const values = JSON.parse(process.argv[2] || '[]');
const out = values.map((raw) => {
  const cell = inferValue(raw);
  return {
    raw,
    type: cell.type,
    value: cell.value === undefined ? null : cell.value,
    ambiguous: !!cell.ambiguous,
    currency: cell.currency || null,
    percent: !!cell.percent,
  };
});
process.stdout.write(JSON.stringify(out) + '\n');
