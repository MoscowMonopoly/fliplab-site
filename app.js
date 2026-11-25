'use strict';

const form = document.querySelector('#deal-form');
const baseFields = [...form.querySelectorAll('[name]')];
const fields = [...form.querySelectorAll('[data-amount]')];
const scenarioForm = document.querySelector('#scenario-form');
const scenarioFields = [...scenarioForm.querySelectorAll('input')];
const baseMode = document.querySelector('#base-mode');
const scenarioMode = document.querySelector('#scenario-mode');
const draftStatus = document.querySelector('#draft-status');
const resultSaveStatus = document.querySelector('#result-save-status');
const results = document.querySelector('#results');
const resultsTitle = document.querySelector('#results-title');
const resultsJump = document.querySelector('#results-jump');
const resultState = document.querySelector('#result-state');
const resultError = document.querySelector('#result-error');
const fixCalculation = document.querySelector('#fix-calculation');
const firstStepHint = document.querySelector('#first-step-hint');
const resultValues = [...document.querySelectorAll('[data-result]')];
const costValues = [...document.querySelectorAll('[data-cost]')];
const repairOutput = document.querySelector('#repair-cost');
const baseRepairRow = document.querySelector('#base-repair-row');
const profitCard = document.querySelector('.profit');
const baseProfitRow = document.querySelector('#base-profit-row');
const baseProfitStatus = document.querySelector('#base-profit-status');
const baseProfitValue = document.querySelector('#base-profit');
const profitDifferenceRow = document.querySelector('#profit-difference-row');
const profitDifferenceStatus = document.querySelector('#profit-difference-status');
const profitDifferenceValue = document.querySelector('#profit-difference');
const preliminary = document.querySelector('#preliminary');
const uncountedMessage = document.querySelector('#uncounted-costs');
const workList = document.querySelector('#work-list');
const workTemplate = document.querySelector('#work-template');
const addWorkButton = document.querySelector('#add-work');
const workBreakdownRow = document.querySelector('#work-breakdown-row');
const workBreakdown = workBreakdownRow.querySelector('[data-work-breakdown]');
const moneyDisplay = new WeakMap();
const resultNotes = new Map();
let lastWorkId = 0;
let previousDraft;
let editingSavedObject = false;

const currencyOptions = {
  style: 'currency', currency: 'RUB', maximumFractionDigits: 0,
};
const currency = new Intl.NumberFormat('ru-RU', currencyOptions);
const signedCurrency = new Intl.NumberFormat('ru-RU', {
  ...currencyOptions, signDisplay: 'exceptZero',
});
const percent = new Intl.NumberFormat('ru-RU', {
  style: 'percent', maximumFractionDigits: 2,
});
const amount = new Intl.NumberFormat('ru-RU', {
  maximumSignificantDigits: 12,
});
const costList = new Intl.ListFormat('ru-RU');

const formatMoney = (value) => currency.format(value);
const formatPercent = (value) => percent.format(value);
const formatters = {
  totalCost: formatMoney,
  profit: formatMoney,
  breakEvenPrice: formatMoney,
  returnOnCost: formatPercent,
  annualReturn: formatPercent,
  months: (value) => `${amount.format(value)}\u00a0мес.`,
};
const costNames = {
  extraWorks: 'дополнительные работы',
  purchaseExpenses: 'расходы на приобретение',
  saleExpenses: 'прочие расходы на продажу',
  commissionCost: 'комиссия',
  holdingCost: 'содержание',
  loanInterest: 'проценты по кредиту',
  tax: 'налог',
  otherExpenses: 'прочие расходы',
};

function validateField(input) {
  const { value, invalid } = validatedAmount(input.name, input.value);
  input.setAttribute('aria-invalid', String(invalid));
  document.getElementById(input.getAttribute('aria-errormessage')).hidden = !invalid;
  return { value, invalid };
}

function renderWorkBreakdown(works) {
  const rows = works.map(({ name, amount, invalid }, index) => {
    const row = document.createElement('div');
    row.className = 'cost-row';
    const label = document.createElement('dt');
    label.textContent = name || `Работа ${index + 1}`;
    const value = document.createElement('dd');
    value.textContent = invalid ? 'Ошибка ввода' : amount === null ? 'Не учтено' : formatMoney(amount);
    row.append(label, value);
    return row;
  });
  workBreakdown.replaceChildren(...rows);
  workBreakdownRow.hidden = rows.length === 0;
}

function renderCosts(result, works) {
  const costs = { ...result.costs, repairCost: result.repairCost };
  const uncounted = result.missingCosts;

  for (const element of costValues) {
    const key = element.dataset.cost;
    const amount = costs[key];
    element.textContent = result.errors[key] ? 'Ошибка ввода'
      : result.state !== 'empty' && uncounted.includes(key) ? 'Не учтено'
        : amount === null ? '—' : formatMoney(amount);
  }
  renderWorkBreakdown(works);
  preliminary.hidden = result.state === 'empty' || uncounted.length === 0;
  uncountedMessage.textContent = uncounted.length === 0
    ? ''
    : `В себестоимости пока не учтены ${costList.format(uncounted.map((key) => costNames[key]))}.`;
}

const scenarioControls = scenarioFields.map((input) => {
  const reference = document.getElementById(`${input.id}-base`);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'text-button scenario-reset';
  reset.textContent = 'К базе';
  reset.setAttribute('aria-label', `Сбросить к базе: ${input.labels[0].textContent}`);
  reset.hidden = true;
  reset.addEventListener('click', () => {
    setEditorValue(input, '');
    input.focus();
    editorChanged();
  });
  reference.after(reset);
  return { input, reference, reset };
});

function renderScenarioFields(draft, base) {
  for (const { input, reference, reset } of scenarioControls) {
    const { name } = input;
    const raw = validatedAmount(name, draft.base[name] ?? '');
    const value = name === 'repairBudget' ? base.repairCost : name === 'months' ? base.months : raw.value;
    const invalid = raw.invalid || (name === 'repairBudget' && base.errors.repairCost) || (name === 'months' && base.errors.months);
    const pretty = !(value === null || invalid)
      ? input.matches('[data-money]') ? formatMoney(value)
        : name === 'commissionRate' ? formatPercent(value / 100) : formatters.months(value)
      : null;
    reference.textContent = `В базе: ${invalid ? 'ошибка ввода' : pretty ?? 'не задано'}`;
    reset.hidden = !input.value.trim();
    validateField(input);
  }
}

function renderProfitComparison(isScenario, base, result) {
  baseProfitRow.hidden = !isScenario || base.profit === null;
  baseProfitStatus.textContent = metricNote(base, 'profit');
  baseProfitStatus.hidden = !baseProfitStatus.textContent;
  baseProfitValue.textContent = base.profit === null ? '—' : formatMoney(base.profit);

  const difference = base.profit === null || result.profit === null
    ? null
    : finiteOrNull(result.profit - base.profit);
  profitDifferenceRow.hidden = !isScenario || difference === null;
  profitDifferenceStatus.hidden = !metricNote(base, 'profit') && !metricNote(result, 'profit');
  profitDifferenceValue.textContent = difference === null ? '—' : signedCurrency.format(difference);
}

function workFields() {
  return [...workList.children].map((row) => ({
    nameInput: row.querySelector('[data-work-name]'),
    amountInput: row.querySelector('[data-work-amount]'),
  }));
}

function renderDeal() {
  fields.forEach(validateField);
  const works = workFields().map(({ nameInput, amountInput }) => ({ name: nameInput.value.trim(), ...validateField(amountInput) }));
  const draft = currentDraft();
  const { base, scenario } = calculateDraftComparison(draft);
  const isScenario = !scenarioForm.hidden;
  const result = isScenario && scenario ? scenario : base;
  const overridesRepair = isScenario && Boolean(draft.scenario.repairBudget.trim());
  renderScenarioFields(draft, base);

  const baseRepair = base.costs.baseRepairCost;
  repairOutput.value = base.errors.baseRepairCost ? 'Ошибка ввода' : baseRepair === null ? '—' : formatMoney(baseRepair);
  for (const element of resultValues) {
    const key = element.dataset.result;
    element.textContent = result[key] === null ? '—' : formatters[key](result[key]);
    const note = resultNotes.get(key);
    note.textContent = metricNote(result, key);
    note.hidden = !note.textContent;
    note.dataset.error = String(Boolean(result.errors[key]));
  }
  renderResultState(result, draft);
  profitCard.classList.toggle('loss', result.profit < 0);
  baseRepairRow.hidden = overridesRepair;
  renderCosts(result, overridesRepair ? [] : works);
  renderProfitComparison(isScenario, base, result);
  const started = hasDraftValues(draft);
  form.dataset.started = String(started);
  firstStepHint.hidden = started;
  document.dispatchEvent(new Event('fliplab:editor-rendered'));
}

const resultStateLabels = {
  empty: 'Введите исходные данные, чтобы увидеть расчёт.',
  invalid: 'Ошибка в исходных данных',
  preliminary: 'Предварительный расчёт',
  complete: 'Расчёт готов',
};

function renderResultState(result, draft) {
  results.dataset.state = result.state;
  const state = resultStateLabels[result.state];
  if (resultState.textContent !== state) resultState.textContent = state;
  const field = result.errors.salePrice || result.errors.profit || Object.values(result.errors).find(Boolean);
  const control = field === 'extraWorks' ? workList.querySelector('[data-work-amount][aria-invalid="true"]')
    : document.getElementById(`${draft.mode === 'scenario' && draft.scenario[field]?.trim() ? 'scenario-' : ''}${field}`);
  resultError.hidden = !control;
  if (control) {
    fixCalculation.textContent = `Проверьте поле «${control.labels[0].textContent}»`;
    fixCalculation.dataset.input = control.id;
  }
}

function showDraftStatus(message, error = false) {
  if (draftStatus.textContent !== message) draftStatus.textContent = message;
  draftStatus.setAttribute('data-error', String(error));
}

function showResultSaveStatus(message, error = false) {
  resultSaveStatus.textContent = message;
  resultSaveStatus.dataset.error = String(error);
}

function editorValue(input) {
  const display = moneyDisplay.get(input);
  return display?.text === input.value ? display.raw : input.value;
}

function setMoneyDisplay(input, raw, text) {
  // Keep display-only changes out of saved snapshots and unsaved-change checks.
  moneyDisplay.set(input, { raw, text });
  if (input.value !== text) input.value = text;
}

function setEditorValue(input, value) {
  if (input.matches('[data-money]')) setMoneyDisplay(input, value, formatMoneyInput(value));
  else input.value = value;
}

function editMoneyInput({ target: input }) {
  if (!input.matches('[data-money]') || !Number.isFinite(parseAmount(input.value))) return;
  const text = input.value;
  const ungrouped = text.replace(amountGroupSeparator, '');
  if (text === ungrouped) return;

  const start = text.slice(0, input.selectionStart).replace(amountGroupSeparator, '').length;
  const end = text.slice(0, input.selectionEnd).replace(amountGroupSeparator, '').length;
  const direction = input.selectionDirection;
  setMoneyDisplay(input, editorValue(input), ungrouped);
  input.setSelectionRange(start, end, direction);
}

function formatMoneyField({ target: input }) {
  if (input.matches('[data-money]')) setEditorValue(input, editorValue(input));
}

function fieldValues(inputs) {
  return Object.fromEntries(inputs.map((input) => [input.name, editorValue(input)]));
}

function workValues() {
  return workFields().map(({ nameInput, amountInput }) => ({ name: nameInput.value, amount: editorValue(amountInput) }));
}

function currentDraft() {
  return {
    base: fieldValues(baseFields),
    scenario: fieldValues(scenarioFields),
    works: workValues(),
    mode: scenarioForm.hidden ? 'base' : 'scenario',
  };
}

function persistDraft(replaceBase = false) {
  let draft;
  try {
    const storage = window.localStorage;
    draft = mergeDraftEdits(previousDraft, currentDraft(), loadDraft(storage), replaceBase);
    saveDraft(storage, draft);
  } catch {
    showDraftStatus('Браузер не сохранил изменения черновика.', true);
    renderDeal();
    return;
  }
  applyDraftValues(draft);
  previousDraft = currentDraft();
  renderDeal();
  showDraftStatus('Черновик сохранён в этом браузере.');
}

function restoreFieldValues(inputs, values) {
  for (const input of inputs) {
    const value = Object.hasOwn(values, input.name) && typeof values[input.name] === 'string' ? values[input.name] : '';
    if (editorValue(input) !== value) setEditorValue(input, value);
  }
}

function applyDraftValues(draft) {
  restoreFieldValues(baseFields, draft.base);
  restoreFieldValues(scenarioFields, draft.scenario);
  const works = draft.works.filter((work) => typeof work?.name === 'string' && typeof work.amount === 'string');
  if (!sameWorkRows(workValues(), works)) {
    workList.replaceChildren();
    for (const work of works) addWorkRow(work.name, work.amount);
  }
}

function openEditor(snapshot, savedObject = false) {
  editingSavedObject = savedObject;
  applyDraftValues(snapshot ?? emptyDraft);
  showScenario(snapshot?.mode === 'scenario');
  if (!savedObject) previousDraft = currentDraft();
  showResultSaveStatus('');
  renderDeal();
}

function editorChanged(replaceBase = false) {
  showResultSaveStatus('');
  if (editingSavedObject) {
    renderDeal();
    showDraftStatus('Сохраните изменения объекта.');
    updateObjectUnloadGuard();
    return;
  }
  persistDraft(replaceBase);
}

function restoreDraft() {
  let draft;
  try {
    draft = loadDraft(window.localStorage);
  } catch {
    showDraftStatus('Хранилище черновика недоступно в этом браузере.', true);
    return null;
  }
  if (draft === null) return null;

  applyDraftValues(draft);
  showDraftStatus('Черновик восстановлен.');
  return draft;
}

function showScenario(active) {
  form.hidden = active;
  scenarioForm.hidden = !active;
  baseMode.setAttribute('aria-pressed', String(!active));
  scenarioMode.setAttribute('aria-pressed', String(active));
  resultsTitle.textContent = active ? 'Результаты сценария' : 'Результаты';
}

function changeMode(active) {
  showScenario(active);
  renderDeal();
  if (editingSavedObject) return;

  try {
    const storage = window.localStorage;
    const saved = loadDraft(storage);
    const mode = active ? 'scenario' : 'base';
    // A view change should neither create a draft nor replace edits from another tab.
    if (saved !== null && saved.mode !== mode) saveDraft(storage, { ...saved, mode });
  } catch {
    // A storage error should not prevent switching views.
  }
}

function addWorkRow(name = '', amount = '') {
  const row = workTemplate.content.firstElementChild.cloneNode(true);
  const nameInput = row.querySelector('[data-work-name]');
  const amountInput = row.querySelector('[data-work-amount]');
  const amountUnit = row.querySelector('[data-work-unit]');
  const amountError = row.querySelector('[data-work-error]');
  const remove = row.querySelector('[data-remove-work]');
  const id = ++lastWorkId;

  nameInput.id = `work-name-${id}`;
  nameInput.value = name;
  row.querySelector('[data-work-name-label]').htmlFor = nameInput.id;
  amountInput.id = `work-amount-${id}`;
  setEditorValue(amountInput, amount);
  amountUnit.id = `${amountInput.id}-unit`;
  amountError.id = `${amountInput.id}-error`;
  amountInput.setAttribute('aria-describedby', amountUnit.id);
  amountInput.setAttribute('aria-errormessage', amountError.id);
  row.querySelector('[data-work-amount-label]').htmlFor = amountInput.id;

  remove.addEventListener('click', () => {
    const nextRow = row.nextElementSibling ?? row.previousElementSibling;
    row.remove();
    const nextControl = nextRow?.querySelector('[data-work-name]') ?? addWorkButton;
    nextControl.focus();
    editorChanged();
  });
  workList.append(row);
  return nameInput;
}

addWorkButton.addEventListener('click', () => {
  addWorkRow().focus();
  editorChanged();
});
form.addEventListener('input', () => editorChanged());
form.addEventListener('submit', (event) => event.preventDefault());
scenarioForm.addEventListener('input', () => editorChanged());
scenarioForm.addEventListener('submit', (event) => event.preventDefault());
for (const editorForm of [form, scenarioForm]) {
  editorForm.addEventListener('focusin', editMoneyInput);
  editorForm.addEventListener('focusout', formatMoneyField);
}
baseMode.addEventListener('click', () => changeMode(false));
scenarioMode.addEventListener('click', () => changeMode(true));
window.addEventListener('pageshow', renderDeal);

for (const value of resultValues) {
  const key = value.dataset.result;
  const note = document.createElement('small');
  note.id = `result-note-${key}`;
  note.className = 'metric-note';
  value.parentElement.querySelector('dt').append(note);
  value.setAttribute('aria-describedby', note.id);
  resultNotes.set(key, note);
}

function focusEditorControl(control) {
  control.focus({ preventScroll: true });
  control.scrollIntoView({ block: 'start' });
}

fixCalculation.addEventListener('click', () => {
  const input = document.getElementById(fixCalculation.dataset.input);
  const targetScenario = scenarioForm.contains(input);
  if (targetScenario !== form.hidden) changeMode(targetScenario);
  const disclosure = input.closest('details');
  if (disclosure) disclosure.open = true;
  focusEditorControl(input);
});

for (const link of document.querySelectorAll('[data-edit-inputs]')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    if (document.querySelector('#calculator-view').hidden) document.querySelector('#calculator-tab').click();
    focusEditorControl(document.querySelector(form.hidden ? '#scenario-title' : '#form-title'));
  });
}

resultsJump.addEventListener('click', (event) => {
  event.preventDefault();
  focusEditorControl(results);
});

new IntersectionObserver(([entry]) => {
  resultsJump.hidden = entry.isIntersecting;
}).observe(results);

function hasBaseValues(draft) {
  return draft !== null && hasDraftValues({ ...draft, scenario: {} });
}

document.querySelector('#load-example').addEventListener('click', () => {
  let saved = null;
  try {
    saved = loadDraft(window.localStorage);
  } catch {
    // The example is available even when storage is blocked.
  }
  if ((hasBaseValues(currentDraft()) || hasBaseValues(saved))
    && !window.confirm('Заменить данные базового расчёта примером?')) return;

  const example = {
    objectName: 'Квартира для примера',
    purchasePrice: '10 000 000',
    purchaseExpenses: '100 000',
    area: '100',
    repairRate: '20 000',
    salePrice: '15 000 000',
    commissionRate: '2',
    saleExpenses: '70 000',
    preparationMonths: '1',
    renovationMonths: '3',
    saleMonths: '2',
    monthlyHolding: '30 000',
    loanInterest: '150 000',
    tax: '200 000',
    otherExpenses: '0',
  };
  form.reset();
  for (const [name, value] of Object.entries(example)) setEditorValue(form.elements.namedItem(name), value);
  workList.replaceChildren();
  addWorkRow('Дополнительные работы по смете', '200 000');
  editorChanged(true);
});

const emptyDraft = currentDraft();
showScenario(restoreDraft()?.mode === 'scenario');
previousDraft = currentDraft();
renderDeal();
