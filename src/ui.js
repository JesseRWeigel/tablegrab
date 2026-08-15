// The bookmarklet's on-page half: hover to highlight a table, click to export it.
//
// Everything is inline styled and scoped to one container, because this runs on somebody
// else's page and has no business touching their stylesheet.

'use strict';

const { fromDom } = require('./dom');
const { buildGrid } = require('./grid');
const { analyse } = require('./infer');
const { classify } = require('./detect');
const { emit } = require('./emit');

const PANEL_ID = 'tablegrab-panel';
const HIGHLIGHT = '2px solid #d6482f';
const FORMATS = [['csv', 'CSV'], ['json', 'JSON'], ['md', 'Markdown'], ['sql', 'SQL']];

function style(element, rules) {
  for (const key of Object.keys(rules)) element.style[key] = rules[key];
  return element;
}

function make(tag, rules, text) {
  const element = document.createElement(tag);
  if (rules) style(element, rules);
  if (text !== undefined) element.textContent = text;
  return element;
}

function activate(options) {
  const opts = options || {};
  const root = opts.root || document;
  if (document.getElementById(PANEL_ID)) return null;

  const state = { hovered: null, table: null, format: 'csv', force: false, saved: '' };

  const panel = make('div', {
    position: 'fixed', right: '12px', bottom: '12px', width: 'min(560px, calc(100vw - 24px))',
    maxHeight: '70vh', zIndex: '2147483647', background: '#fff', color: '#191a1c',
    border: '1px solid #c9c9c9', borderRadius: '8px', boxShadow: '0 8px 30px rgba(0,0,0,.25)',
    font: '13px/1.45 ui-sans-serif, system-ui, sans-serif', display: 'flex',
    flexDirection: 'column', overflow: 'hidden',
  });
  panel.id = PANEL_ID;

  const head = style(make('div'), {
    display: 'flex', gap: '6px', alignItems: 'center', padding: '8px 10px',
    borderBottom: '1px solid #e4e4e4', flexWrap: 'wrap',
  });
  const title = make('strong', { marginRight: 'auto' }, 'tablegrab');
  head.appendChild(title);

  const buttons = {};
  for (const [key, label] of FORMATS) {
    const button = make('button', {
      font: 'inherit', padding: '3px 9px', borderRadius: '5px', cursor: 'pointer',
      border: '1px solid #c9c9c9', background: '#f4f4f4',
    }, label);
    button.addEventListener('click', () => {
      state.format = key;
      render();
    });
    buttons[key] = button;
    head.appendChild(button);
  }
  const close = make('button', {
    font: 'inherit', padding: '3px 9px', borderRadius: '5px', cursor: 'pointer',
    border: '1px solid #c9c9c9', background: '#f4f4f4',
  }, 'Close');
  close.addEventListener('click', () => deactivate());
  head.appendChild(close);

  const status = style(make('div'), {
    padding: '6px 10px', color: '#5d626a', borderBottom: '1px solid #e4e4e4',
  });
  status.textContent = 'Hover a table, then click it.';

  const output = make('textarea');
  style(output, {
    flex: '1', minHeight: '160px', margin: '0', padding: '10px', border: '0',
    resize: 'vertical', font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
    outline: 'none', background: '#fbfaf8', color: '#191a1c', whiteSpace: 'pre',
  });
  output.setAttribute('readonly', 'readonly');
  output.id = 'tablegrab-output';

  const foot = style(make('div'), {
    display: 'flex', gap: '6px', padding: '8px 10px', borderTop: '1px solid #e4e4e4',
  });
  const copy = make('button', {
    font: 'inherit', padding: '3px 9px', borderRadius: '5px', cursor: 'pointer',
    border: '1px solid #c9c9c9', background: '#f4f4f4',
  }, 'Copy');
  copy.addEventListener('click', () => {
    output.removeAttribute('readonly');
    output.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    output.setAttribute('readonly', 'readonly');
    copy.textContent = ok ? 'Copied' : 'Select and copy';
  });
  const download = make('button', {
    font: 'inherit', padding: '3px 9px', borderRadius: '5px', cursor: 'pointer',
    border: '1px solid #c9c9c9', background: '#f4f4f4',
  }, 'Download');
  download.addEventListener('click', () => {
    const extension = state.format === 'md' ? 'md' : state.format;
    const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' });
    const link = make('a');
    link.href = URL.createObjectURL(blob);
    link.download = `table.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  });
  const forceLabel = style(make('label'), { marginLeft: 'auto', color: '#5d626a' });
  const forceBox = make('input');
  forceBox.type = 'checkbox';
  forceBox.addEventListener('change', () => {
    state.force = forceBox.checked;
    render();
  });
  forceLabel.appendChild(forceBox);
  forceLabel.appendChild(document.createTextNode(' export anyway'));

  foot.appendChild(copy);
  foot.appendChild(download);
  foot.appendChild(forceLabel);

  panel.appendChild(head);
  panel.appendChild(status);
  panel.appendChild(output);
  panel.appendChild(foot);
  document.body.appendChild(panel);

  function highlight(table) {
    if (state.hovered === table) return;
    if (state.hovered && state.hovered !== state.table) {
      state.hovered.style.outline = state.hovered.getAttribute('data-tablegrab-outline') || '';
    }
    state.hovered = table;
    if (table && table !== state.table) {
      table.setAttribute('data-tablegrab-outline', table.style.outline || '');
      table.style.outline = '2px dashed #d6482f';
    }
  }

  function nearestTable(node) {
    let current = node;
    while (current && current !== document.body) {
      if (current.tagName && current.tagName.toLowerCase() === 'table') return current;
      current = current.parentNode;
    }
    return null;
  }

  function onOver(event) {
    if (panel.contains(event.target)) return;
    highlight(nearestTable(event.target));
  }

  function onClick(event) {
    if (panel.contains(event.target)) return;
    const table = nearestTable(event.target);
    if (!table) return;
    event.preventDefault();
    event.stopPropagation();
    select(table);
  }

  function onKey(event) {
    if (event.key === 'Escape') deactivate();
  }

  function select(table) {
    if (state.table && state.table !== table) state.table.style.outline = '';
    state.table = table;
    table.style.outline = HIGHLIGHT;
    render();
  }

  function render() {
    for (const [key] of FORMATS) {
      buttons[key].style.background = key === state.format ? '#191a1c' : '#f4f4f4';
      buttons[key].style.color = key === state.format ? '#fff' : '#191a1c';
    }
    copy.textContent = 'Copy';
    if (!state.table) {
      output.value = '';
      status.textContent = 'Hover a table, then click it.';
      return;
    }
    const grid = buildGrid(fromDom(state.table), opts);
    const verdict = classify(grid);
    if (!verdict.isData && !state.force) {
      output.value = '';
      status.textContent = `Refused: this looks like a layout table (score ${verdict.score}). `
        + `${verdict.reasons.join('; ')}.`;
      return;
    }
    const analysis = analyse(grid, opts);
    output.value = emit(analysis, state.format, opts);
    const warnings = analysis.columns
      .filter((column) => column.warnings.length)
      .map((column) => `${column.name}: ${column.warnings.join('; ')}`)
      .concat(grid.notes)
      .concat(grid.ragged.length ? [`${grid.ragged.length} short row(s) padded`] : []);
    status.textContent = `${grid.height} x ${grid.width}, ${grid.headerRows} header row(s), `
      + `${analysis.rows.length} data rows. ${warnings.join(' | ') || 'No warnings.'}`;
  }

  function deactivate() {
    root.removeEventListener('mouseover', onOver, true);
    root.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    if (state.hovered) state.hovered.style.outline = '';
    if (state.table) state.table.style.outline = '';
    if (panel.parentNode) panel.parentNode.removeChild(panel);
  }

  root.addEventListener('mouseover', onOver, true);
  root.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);

  return { select, render, deactivate, state, panel };
}

module.exports = { activate, PANEL_ID };
