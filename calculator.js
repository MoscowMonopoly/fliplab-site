'use strict';

const amountConstraints = {
  area: (value) => value > 0,
  bedrooms: Number.isInteger,
  commissionRate: (value) => value < 100,
};
const sharedAmounts = [
  'purchasePrice', 'salePrice', 'months', 'purchaseExpenses', 'saleExpenses',
  'commissionRate', 'monthlyHolding', 'loanInterest', 'tax', 'otherExpenses',
];
const baseAmounts = [...sharedAmounts, 'area', 'repairRate', 'preparationMonths', 'renovationMonths', 'saleMonths'];
const scenarioAmounts = [...sharedAmounts, 'repairBudget'];
const amountGroupSeparator = /[ \u00a0\u202f]/g;
const expenseInputs = {
  purchaseExpenses: 'purchaseExpenses', saleExpenses: 'saleExpenses',
  loanInterest: 'loanInterest', tax: 'tax', otherExpenses: 'otherExpenses',
};

function hasDraftValues(draft) {
  return Boolean(draft && [
    ...Object.values(draft.base), ...Object.values(draft.scenario),
    ...draft.works.flatMap((row) => [row?.name, row?.amount]),
  ].some((value) => typeof value === 'string' && value.trim()));
}

function parseAmount(raw) {
  const value = raw.trim();
  if (value === '') return null;

  const numberFormat = /^(?:(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d*)?|[.,]\d+)$/;
  if (!numberFormat.test(value)) return NaN;

  const amount = Number(value.replace(amountGroupSeparator, '').replace(',', '.'));
  return Number.isFinite(amount) ? amount : NaN;
}

function formatMoneyInput(raw) {
  if (!Number.isFinite(parseAmount(raw))) return raw;
  return raw.trim().replace(amountGroupSeparator, '').replace(/^\d+/, (digits) => (
    digits.replace(/\B(?=(?:\d{3})+$)/g, '\u202f')
  ));
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function validatedAmount(name, raw) {
  const value = parseAmount(raw.replace(/[\r\n]/g, ''));
  const accepts = amountConstraints[name];
  const invalid = Number.isNaN(value) || (value !== null && accepts !== undefined && !accepts(value));
  // Only a blank duration override falls back to the sum of the stages.
  return { value: invalid ? (name === 'months' ? NaN : null) : value, invalid };
}

function sumKnown(amounts) {
  return finiteOrNull(amounts.reduce((sum, amount) => sum + (amount ?? 0), 0));
}

function calculateDeal({
  purchasePrice = null, area = null, repairRate = null, salePrice = null, months = null,
  preparationMonths = null, renovationMonths = null, saleMonths = null,
  purchaseExpenses = null, extraWorks = [], repairBudget, saleExpenses = null, commissionRate = null,
  monthlyHolding = null, loanInterest = null, tax = null, otherExpenses = null,
}) {
  const stages = [preparationMonths, renovationMonths, saleMonths];
  const stageMonths = stages.includes(null) ? null : sumKnown(stages);
  const selectedMonths = months ?? stageMonths;
  const totalMonths = Number.isFinite(selectedMonths) && selectedMonths >= 0 ? selectedMonths : null;
  const usesRepairEstimate = repairBudget === undefined;
  const baseRepairCost = usesRepairEstimate ? multiplyKnown(area, repairRate) : null;
  const repairCost = usesRepairEstimate
    ? (baseRepairCost === null ? null : sumKnown([baseRepairCost, ...extraWorks]))
    : (repairBudget >= 0 ? finiteOrNull(repairBudget) : null);
  const commission = commissionRate !== null && commissionRate >= 0 && commissionRate < 100
    ? commissionRate / 100
    : null;
  const commissionCost = commission === 0 ? 0 : multiplyKnown(salePrice, commission);
  const holdingCost = monthlyHolding === 0 ? 0 : multiplyKnown(monthlyHolding, totalMonths);

  const costsWithoutCommission = purchasePrice !== null && repairCost !== null
    ? sumKnown([purchasePrice, purchaseExpenses, repairCost, saleExpenses, holdingCost, loanInterest, tax, otherExpenses])
    : null;
  const totalCost = costsWithoutCommission === null ? null : sumKnown([costsWithoutCommission, commissionCost]);
  const breakEvenPrice = costsWithoutCommission === null
    ? null
    : finiteOrNull(costsWithoutCommission / (1 - (commission ?? 0)));
  const profit = totalCost !== null && salePrice !== null ? salePrice - totalCost : null;
  const returnOnCost = profit !== null && totalCost > 0 ? finiteOrNull(profit / totalCost) : null;
  const annualReturn = returnOnCost !== null && totalMonths > 0
    ? finiteOrNull((returnOnCost * 12) / totalMonths)
    : null;

  const optionalCosts = { purchaseExpenses, saleExpenses, commissionCost, holdingCost, loanInterest, tax, otherExpenses };
  const uncountedCosts = Object.keys(optionalCosts).filter((key) => optionalCosts[key] === null);
  if (usesRepairEstimate && extraWorks.includes(null)) uncountedCosts.unshift('extraWorks');

  return {
    repairCost, totalCost, profit, returnOnCost, breakEvenPrice, months: totalMonths, annualReturn,
    costs: { purchasePrice, baseRepairCost, ...optionalCosts }, uncountedCosts,
  };
}

function multiplyKnown(left, right) {
  return left !== null && right !== null ? finiteOrNull(left * right) : null;
}

function readAmounts(fields, names) {
  return Object.fromEntries(names.map((name) => [name, validatedAmount(name, fields[name] ?? '')]));
}

function evaluateDraftAmounts(inputs, workInputs, hasValues) {
  const values = Object.fromEntries(Object.entries(inputs).map(([key, { value }]) => [key, value]));
  values.extraWorks = workInputs.map(({ value }) => value);
  const result = calculateDeal(values);
  const invalid = (name) => inputs[name]?.invalid ? name : undefined;
  const stages = ['preparationMonths', 'renovationMonths', 'saleMonths'];
  const months = values.months === null ? stages.find(invalid) : invalid('months');
  const baseRepairCost = values.repairBudget === undefined ? ['area', 'repairRate'].find(invalid) : undefined;
  const extraWorks = values.repairBudget === undefined && workInputs.some(({ invalid }) => invalid) ? 'extraWorks' : undefined;
  const repairCost = invalid('repairBudget') || baseRepairCost || extraWorks;
  const commissionCost = (values.commissionRate > 0 && invalid('salePrice')) || invalid('commissionRate');
  const holdingCost = invalid('monthlyHolding') || (values.monthlyHolding > 0 ? months : undefined);
  const purchasePrice = invalid('purchasePrice');
  const salePrice = invalid('salePrice');
  const expenses = Object.fromEntries(Object.entries(expenseInputs).map(([key, name]) => [key, invalid(name)]));
  const otherCosts = [purchasePrice, repairCost, holdingCost, ...Object.values(expenses)].find(Boolean);
  const totalCost = commissionCost || otherCosts;
  const profit = salePrice || totalCost;
  const errors = {
    ...expenses, purchasePrice, salePrice, baseRepairCost, extraWorks, repairCost, commissionCost, holdingCost,
    totalCost, profit, returnOnCost: profit, annualReturn: profit || months, months,
    breakEvenPrice: invalid('commissionRate') || otherCosts,
  };
  const missingCosts = result.uncountedCosts.filter((key) => !errors[key]);
  const commissionMissing = values.commissionRate === null && !invalid('commissionRate');
  for (const [key, error] of Object.entries(errors)) {
    if (!error) continue;
    if (Object.hasOwn(result, key)) result[key] = null;
    if (Object.hasOwn(result.costs, key)) result.costs[key] = null;
  }
  const state = Object.values(errors).some(Boolean) ? 'invalid'
    : !hasValues ? 'empty'
      : result.profit === null || result.months === null || missingCosts.length ? 'preliminary' : 'complete';
  return { ...result, salePrice: values.salePrice, errors, missingCosts, commissionMissing, state };
}

function metricNote(result, key) {
  if (result.errors[key]) return 'Ошибка ввода';
  if (key === 'months' || result[key] === null) return '';
  if (result.commissionMissing) return 'Без учёта комиссии';
  const missing = key === 'breakEvenPrice'
    ? result.missingCosts.some((cost) => cost !== 'commissionCost')
    : result.missingCosts.length > 0;
  return missing ? 'Предварительно' : '';
}

function changeFromBase(base, scenario) {
  return base === null || scenario === null ? null : finiteOrNull(scenario - base);
}

function calculateDraftComparison(draft) {
  const inputs = readAmounts(draft.base, baseAmounts);
  const workInputs = draft.works.map(({ amount }) => validatedAmount('', amount));
  const base = evaluateDraftAmounts(inputs, workInputs, hasDraftValues({ ...draft, scenario: {} }));
  const overrideNames = scenarioAmounts.filter((name) => draft.scenario[name]?.trim());
  if (overrideNames.length === 0) return { base, scenario: null, differences: null };

  const overrides = readAmounts(draft.scenario, overrideNames);
  const scenario = evaluateDraftAmounts({ ...inputs, ...overrides }, workInputs, true);
  return {
    base,
    scenario,
    differences: {
      salePrice: changeFromBase(base.salePrice, scenario.salePrice),
      repairCost: changeFromBase(base.repairCost, scenario.repairCost),
      months: changeFromBase(base.months, scenario.months),
    },
  };
}

if (typeof module === 'object' && module.exports) {
  module.exports = { calculateDeal, calculateDraftComparison, formatMoneyInput, hasDraftValues, metricNote, parseAmount };
}
