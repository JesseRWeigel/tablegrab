// Type inference, and the refusals that matter more than the inferences.
//
// The classic failure of a tool like this is eating a leading zero: a zip code column arrives
// as 7030, 2139, 10001 and nobody notices until a mailing goes out. So the guards come first
// and they are absolute. A version string, a phone number, a part code and anything with a
// leading zero stay text no matter how numeric they look.
//
// Everything else is decided per column rather than per cell, because one "n/a" in a column of
// integers should not turn the whole column into text, and one unambiguous date is enough to
// settle whether the ambiguous ones in the same column are day-first or month-first.

'use strict';

const NULLISH = new Set(['-', '–', '—', '?', 'n/a', 'na', 'n.a.', 'null', 'none', 'nil', '.']);

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const CURRENCY = {
  $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR',
  'us$': 'USD', 'a$': 'AUD', 'ca$': 'CAD', 'r$': 'BRL',
  usd: 'USD', eur: 'EUR', gbp: 'GBP', jpy: 'JPY', inr: 'INR', chf: 'CHF',
  cad: 'CAD', aud: 'AUD', brl: 'BRL',
};

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isRealDate(y, m, d) {
  if (!(y >= 1 && y <= 9999) || !(m >= 1 && m <= 12) || d < 1) return false;
  let limit = DAYS_IN_MONTH[m - 1];
  if (m === 2 && (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) limit = 29;
  return d <= limit;
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;

// A number written with separators. Every accepted shape is listed, and anything not listed is
// text. Being permissive here is how "1.2.3" becomes 1.23.
function parseDigits(body) {
  const shapes = [
    [/^(\d+)$/, (m) => Number(m[1])],
    // 1,234,567 and 1,234,567.89 -- comma groups, dot decimal
    [/^(\d{1,3}(?:,\d{3})+)$/, (m) => Number(m[1].replace(/,/g, ''))],
    [/^(\d{1,3}(?:,\d{3})+)\.(\d+)$/, (m) => Number(`${m[1].replace(/,/g, '')}.${m[2]}`)],
    // 1.234.567 and 1.234.567,89 -- the European convention, only when there are two or more
    // groups. A single "1.234" is read as a decimal, which is the English reading.
    [/^(\d{1,3}(?:\.\d{3}){2,})$/, (m) => Number(m[1].replace(/\./g, ''))],
    [/^(\d{1,3}(?:\.\d{3})+),(\d+)$/, (m) => Number(`${m[1].replace(/\./g, '')}.${m[2]}`)],
    // 1 234 567, the separator Wikipedia and most of Europe use
    [/^(\d{1,3}(?: \d{3})+)$/, (m) => Number(m[1].replace(/ /g, ''))],
    [/^(\d{1,3}(?: \d{3})+)[.,](\d+)$/, (m) => Number(`${m[1].replace(/ /g, '')}.${m[2]}`)],
    // plain decimals, either separator
    [/^(\d+)\.(\d+)$/, (m) => Number(`${m[1]}.${m[2]}`)],
    // 1,5 is a decimal comma; 1,234 is a thousands group. Three digits after the comma is the
    // grouping reading, which is the common case in English documents.
    [/^(\d+),(\d{3})$/, (m) => Number(m[1] + m[2])],
    [/^(\d+),(\d{1,2}|\d{4,})$/, (m) => Number(`${m[1]}.${m[2]}`)],
  ];
  for (const [pattern, build] of shapes) {
    const match = body.match(pattern);
    if (match) {
      const value = build(match);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function parseNumber(text) {
  let s = text;
  let negative = false;
  let currency = null;
  let percent = false;

  const bracketed = s.match(/^\((.*)\)$/);
  if (bracketed) {
    negative = true;
    s = bracketed[1].trim();
  }
  const lead = s.match(/^(US\$|A\$|CA\$|R\$|[$€£¥₹]|USD|EUR|GBP|JPY|INR|CHF|CAD|AUD|BRL)\s*/i);
  if (lead) {
    currency = CURRENCY[lead[1].toLowerCase()] || null;
    s = s.slice(lead[0].length);
  }
  const trail = s.match(/\s*(USD|EUR|GBP|JPY|INR|CHF|CAD|AUD|BRL|[$€£¥₹])$/i);
  if (trail) {
    if (!currency) currency = CURRENCY[trail[1].toLowerCase()] || null;
    s = s.slice(0, s.length - trail[0].length);
  }
  s = s.trim();
  if (s.endsWith('%')) {
    percent = true;
    s = s.slice(0, -1).trim();
  }
  const sign = s.match(/^([+\-−])\s*/);
  if (sign) {
    if (sign[1] !== '+') negative = !negative;
    s = s.slice(sign[0].length).trim();
  }
  if (s === '') return null;
  // Anything outside digits and the three separators is text. This is the line that keeps
  // "555-0134", "1,234-5,678" and "12 items" out.
  if (!/^\d[\d., ]*$/.test(s)) return null;
  // The leading zero guard. "0" and "0.5" are numbers, "007" and "07030" are identifiers.
  if (/^0\d/.test(s)) return null;

  const value = parseDigits(s);
  if (value === null) return null;
  return {
    type: 'number',
    value: negative ? -value : value,
    integer: Number.isInteger(negative ? -value : value),
    currency,
    percent,
    raw: text,
  };
}

function monthNumber(word) {
  const key = word.toLowerCase().replace(/\.$/, '');
  return Object.prototype.hasOwnProperty.call(MONTHS, key) ? MONTHS[key] : null;
}

function parseDate(text, options) {
  const opts = options || {};
  const dayFirstDefault = !!opts.dayFirst;
  const s = text.trim();
  let m;

  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (!isRealDate(y, mo, d)) return null;
    return { type: 'date', value: iso(y, mo, d), format: 'iso', ambiguous: false, alt: null, raw: text };
  }
  if ((m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (!isRealDate(y, mo, d)) return null;
    return { type: 'date', value: iso(y, mo, d), format: 'ymd', ambiguous: false, alt: null, raw: text };
  }
  // Numeric day and month with a four digit year. This is the ambiguous family.
  if ((m = s.match(/^(\d{1,2})([/.\-])(\d{1,2})\2(\d{4})$/))) {
    const a = +m[1];
    const b = +m[3];
    const y = +m[4];
    const dmy = isRealDate(y, b, a);
    const mdy = isRealDate(y, a, b);
    if (dmy && mdy) {
      const first = dayFirstDefault ? iso(y, b, a) : iso(y, a, b);
      const second = dayFirstDefault ? iso(y, a, b) : iso(y, b, a);
      return {
        type: 'date',
        value: first,
        format: dayFirstDefault ? 'dmy' : 'mdy',
        ambiguous: true,
        alt: second,
        raw: text,
      };
    }
    if (dmy) return { type: 'date', value: iso(y, b, a), format: 'dmy', ambiguous: false, alt: null, raw: text };
    if (mdy) return { type: 'date', value: iso(y, a, b), format: 'mdy', ambiguous: false, alt: null, raw: text };
    return null;
  }
  // 3 March 2026, 3rd March 2026, 3 Mar. 2026
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9}\.?),?\s+(\d{4})$/))) {
    const mo = monthNumber(m[2]);
    if (mo === null || !isRealDate(+m[3], mo, +m[1])) return null;
    return { type: 'date', value: iso(+m[3], mo, +m[1]), format: 'month-name', ambiguous: false, alt: null, raw: text };
  }
  // March 3, 2026 and Mar 3 2026
  if ((m = s.match(/^([A-Za-z]{3,9}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/))) {
    const mo = monthNumber(m[1]);
    if (mo === null || !isRealDate(+m[3], mo, +m[2])) return null;
    return { type: 'date', value: iso(+m[3], mo, +m[2]), format: 'month-name', ambiguous: false, alt: null, raw: text };
  }
  return null;
}

function inferValue(raw, options) {
  const text = String(raw === null || raw === undefined ? '' : raw).trim();
  if (text === '' || NULLISH.has(text.toLowerCase())) {
    return { type: 'empty', value: null, raw: text };
  }
  const date = parseDate(text, options);
  if (date) return date;
  const number = parseNumber(text);
  if (number) return number;
  return { type: 'string', value: text, raw: text };
}

// One column at a time. A mixed column is text, because half-typed data is worse than none.
function inferColumn(values, options) {
  const cells = values.map((value) => inferValue(value, options));
  const present = cells.filter((cell) => cell.type !== 'empty');
  const warnings = [];

  if (present.length === 0) {
    return { type: 'string', cells, warnings, integer: false, currency: null, percent: false };
  }
  if (present.every((cell) => cell.type === 'number')) {
    const currencies = new Set(present.map((cell) => cell.currency).filter(Boolean));
    if (currencies.size > 1) warnings.push(`mixed currencies: ${[...currencies].sort().join(', ')}`);
    return {
      type: 'number',
      cells,
      warnings,
      integer: present.every((cell) => cell.integer),
      currency: currencies.size === 1 ? [...currencies][0] : null,
      percent: present.every((cell) => cell.percent),
    };
  }
  if (present.every((cell) => cell.type === 'date')) {
    const evidence = new Set(present.filter((cell) => !cell.ambiguous).map((cell) => cell.format));
    const ambiguous = present.filter((cell) => cell.ambiguous);
    if (ambiguous.length) {
      let dayFirst = null;
      if (evidence.has('dmy') && !evidence.has('mdy')) dayFirst = true;
      else if (evidence.has('mdy') && !evidence.has('dmy')) dayFirst = false;
      if (dayFirst === null) {
        warnings.push(
          `${ambiguous.length} ambiguous date(s) such as ${ambiguous[0].raw} and nothing in the `
          + `column settles day-first or month-first; read as ${ambiguous[0].format}`);
      } else {
        for (const cell of cells) {
          if (cell.type === 'date' && cell.ambiguous) {
            const wanted = dayFirst ? 'dmy' : 'mdy';
            if (cell.format !== wanted) {
              const swapped = cell.alt;
              cell.alt = cell.value;
              cell.value = swapped;
              cell.format = wanted;
            }
            cell.resolvedBy = 'column';
          }
        }
        warnings.push(`${ambiguous.length} ambiguous date(s) read as `
          + `${dayFirst ? 'day-first' : 'month-first'} from the rest of the column`);
      }
    }
    return { type: 'date', cells, warnings, integer: false, currency: null, percent: false };
  }
  // A mixed column is a text column, and that has to reach the individual cells. A ZIP column
  // holding 07030, 02139 and 10001 is the case: the first two are text by the leading zero
  // guard, and leaving the third as the number 10001 puts two types in one JSON field.
  const mixed = new Set(present.map((cell) => cell.type));
  for (const cell of cells) {
    if (cell.type !== 'empty' && cell.type !== 'string') {
      cell.coercedFrom = cell.type;
      cell.type = 'string';
      cell.value = cell.raw;
    }
  }
  if (mixed.size > 1) warnings.push(`mixed cell types (${[...mixed].sort().join(', ')}), kept as text`);
  return { type: 'string', cells, warnings, integer: false, currency: null, percent: false };
}

// The typed view of a grid: one entry per column, and the rows re-emitted as typed values.
function analyse(grid, options) {
  const columns = [];
  for (let c = 0; c < grid.width; c += 1) {
    const raw = grid.rows.map((row) => row[c]);
    const inferred = inferColumn(raw, options);
    let label = grid.columns[c];
    if (inferred.type === 'number' && inferred.currency) label += ` (${inferred.currency})`;
    else if (inferred.type === 'number' && inferred.percent) label += ' (%)';
    columns.push({
      name: grid.columns[c],
      label,
      type: inferred.type,
      integer: inferred.integer,
      currency: inferred.currency,
      percent: inferred.percent,
      warnings: inferred.warnings,
      cells: inferred.cells,
    });
  }
  const rows = grid.rows.map((_, r) => columns.map((column) => column.cells[r]));
  return { columns, rows, caption: grid.caption || '' };
}

module.exports = { inferValue, inferColumn, analyse, parseNumber, parseDate, NULLISH };
