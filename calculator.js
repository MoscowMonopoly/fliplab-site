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

function storedBaseAmounts(draft) {
  const values = Object.fromEntries(baseAmounts.map((name) => [name, validatedAmount(name, draft.base[name] ?? '').value]));
  values.extraWorks = draft.works.map(({ amount }) => validatedAmount('', amount).value);
  return values;
}

function calculateStoredBase(draft) {
  return calculateDeal(storedBaseAmounts(draft));
}

function changeFromBase(base, scenario) {
  return base === null || scenario === null ? null : finiteOrNull(scenario - base);
}

function calculateDraftComparison(draft) {
  const values = storedBaseAmounts(draft);
  const base = { ...calculateDeal(values), salePrice: values.salePrice };
  const overrides = {};
  for (const name of scenarioAmounts) {
    const raw = draft.scenario[name];
    if (raw?.trim()) overrides[name] = validatedAmount(name, raw).value;
  }
  if (Object.keys(overrides).length === 0) return { base, scenario: null, differences: null };

  const next = { ...values, ...overrides };
  const scenario = { ...calculateDeal(next), salePrice: next.salePrice };
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
  module.exports = { calculateDeal, calculateDraftComparison, formatMoneyInput, parseAmount };
}
