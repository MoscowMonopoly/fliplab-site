'use strict';

const comparisonTable = document.querySelector('#comparison-table');
const comparisonCaption = comparisonTable.querySelector('caption');
const comparisonScroll = document.querySelector('#comparison-scroll');
const comparisonScrollHint = document.querySelector('#comparison-scroll-hint');
const comparisonStatus = document.querySelector('#comparison-status');
const comparisonCount = document.querySelector('#comparison-count');
const backToObjects = document.querySelector('#back-to-objects');
const shareComparisonButton = document.querySelector('#share-comparison');
const signedDuration = new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 12, signDisplay: 'exceptZero' });
let displayedComparisonRecords = [];

function comparisonText(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function displayComparisonValue(value, formatter) {
  return value === null ? '—' : formatter(value);
}

function compareMetricEntry(label, result, key, format) {
  const entry = document.createElement('div');
  entry.append(
    comparisonText('small', label),
    comparisonText('strong', result === null ? 'Не задано' : displayComparisonValue(result[key], format)),
  );
  const note = result && metricNote(result, key);
  if (note) entry.append(comparisonText('small', note, result.errors[key] ? 'comparison-error' : 'comparison-preliminary'));
  return entry;
}

function compareMetric({ base, scenario }, key, format) {
  const group = document.createElement('div');
  group.className = 'comparison-metrics';
  group.append(compareMetricEntry('База', base, key, format));
  if (scenario || key === 'profit') group.append(compareMetricEntry('Что если?', scenario, key, format));
  return group;
}

function compareChange(result, key, formatValue, formatDelta) {
  if (result.scenario === null) return '—';
  const group = document.createElement('div');
  group.append(comparisonText('strong', displayComparisonValue(result.differences[key], formatDelta)));
  const newValue = result.scenario[key];
  if (newValue !== null) group.append(comparisonText('small', `В сценарии ${formatValue(newValue)}`));
  return group;
}

function compareUncounted({ base, scenario }) {
  const groups = document.createElement('div');
  groups.className = 'comparison-missing';
  const baseCosts = base.state === 'empty' ? [] : base.missingCosts;
  const scenarioCosts = scenario?.missingCosts ?? [];
  if (!baseCosts.length && !scenarioCosts.length) return '—';

  const sameCosts = baseCosts.length === scenarioCosts.length && baseCosts.every((key) => scenarioCosts.includes(key));
  const entries = sameCosts ? [['База и сценарий', baseCosts]] : [['База', baseCosts], ['Что если?', scenarioCosts]];
  for (const [label, costs] of entries) {
    if (costs.length === 0) continue;
    const group = document.createElement('div');
    group.append(comparisonText('small', label), comparisonText('p', costList.format(costs.map((key) => costNames[key]))));
    groups.append(group);
  }
  return groups;
}

const compareRows = [
  ['Прибыль', (result) => compareMetric(result, 'profit', formatMoney)],
  ['Цена покупки · база', ({ base }) => displayComparisonValue(base.costs.purchasePrice, formatMoney)],
  ['Себестоимость', (result) => compareMetric(result, 'totalCost', formatMoney)],
  ['Цена сделки · база', ({ base }) => displayComparisonValue(base.salePrice, formatMoney)],
  ['Рентабельность', (result) => compareMetric(result, 'returnOnCost', formatPercent)],
  ['Общий срок', (result) => compareMetric(result, 'months', formatters.months)],
  ['Изменение цены сделки', (result) => compareChange(result, 'salePrice', formatMoney, (value) => signedCurrency.format(value))],
  ['Изменение ремонта', (result) => compareChange(result, 'repairCost', formatMoney, (value) => signedCurrency.format(value))],
  ['Изменение срока', (result) => compareChange(result, 'months', formatters.months, (value) => `${signedDuration.format(value)}\u00a0мес.`)],
  ['Не учтено', compareUncounted],
];

function showComparisonStatus(message, error = false) {
  comparisonStatus.textContent = message;
  comparisonStatus.setAttribute('data-error', String(error));
}

function comparisonHeader(records) {
  const head = document.createElement('thead');
  const row = document.createElement('tr');
  const label = comparisonText('th', 'Показатель');
  label.setAttribute('scope', 'col');
  row.append(label);
  for (const record of records) {
    const header = document.createElement('th');
    header.setAttribute('scope', 'col');
    const name = objectName(record);
    const open = comparisonText('button', name, 'comparison-open');
    open.type = 'button';
    open.title = name;
    open.setAttribute('data-compare-object', record.id);
    open.setAttribute('aria-label', `Открыть «${name}»`);
    open.addEventListener('click', () => openSavedObject(record.id, showComparisonStatus));
    header.append(open);
    row.append(header);
  }
  head.append(row);
  return head;
}

function renderComparison(records) {
  const results = records.map(({ draft }) => calculateDraftComparison(draft));
  const body = document.createElement('tbody');
  for (const [label, content] of compareRows) {
    const row = document.createElement('tr');
    const name = comparisonText('th', label);
    name.setAttribute('scope', 'row');
    row.append(name);
    for (const result of results) {
      const cell = document.createElement('td');
      cell.append(content(result));
      row.append(cell);
    }
    body.append(row);
  }
  comparisonTable.style.setProperty('--comparison-count', records.length);
  comparisonTable.dataset.many = String(records.length > 2);
  comparisonTable.replaceChildren(comparisonCaption, comparisonHeader(records), body);
  comparisonScroll.hidden = false;
  displayedComparisonRecords = records;
  shareComparisonButton.hidden = false;
  comparisonCount.textContent = `Выбрано: ${records.length}`;
  comparisonCount.hidden = false;
  updateComparisonOverflow();
}

function updateComparisonOverflow() {
  comparisonScrollHint.hidden = comparisonScroll.hidden || comparisonView.hidden
    || comparisonScroll.scrollWidth <= comparisonScroll.clientWidth + 1;
}

function refreshComparison() {
  const focusedId = document.activeElement?.getAttribute('data-compare-object');
  let records;
  comparisonScrollHint.hidden = true;
  comparisonCount.hidden = true;
  displayedComparisonRecords = [];
  shareComparisonButton.hidden = true;
  try {
    records = selectedRecords(readObjects(window.localStorage));
  } catch {
    comparisonScroll.hidden = true;
    showComparisonStatus('Не удалось открыть объекты для сравнения.', true);
    if (focusedId) backToObjects.focus();
    return;
  }
  if (records.length < 2) {
    comparisonScroll.hidden = true;
    showComparisonStatus('Выберите минимум два объекта в списке.');
    if (focusedId) backToObjects.focus();
    return;
  }
  showComparisonStatus('');
  renderComparison(records);
  if (focusedId) {
    const buttons = [...comparisonTable.querySelectorAll('[data-compare-object]')];
    const nextFocus = buttons.find((button) => button.getAttribute('data-compare-object') === focusedId);
    (nextFocus ?? backToObjects).focus({ preventScroll: Boolean(nextFocus) });
  }
}

compareButton.addEventListener('click', () => {
  refreshComparison();
  showView('comparison');
  comparisonScroll.scrollLeft = 0;
  updateComparisonOverflow();
});
const observeComparisonSize = new ResizeObserver(updateComparisonOverflow);
observeComparisonSize.observe(comparisonScroll);
observeComparisonSize.observe(comparisonTable);
backToObjects.addEventListener('click', openObjectList);
window.addEventListener('storage', ({ key }) => {
  if (!comparisonView.hidden && (key === OBJECTS_KEY || key === null)) refreshComparison();
});
