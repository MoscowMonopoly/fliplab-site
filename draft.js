'use strict';

const DRAFT_KEY = 'fliplab:draft';
const DRAFT_VERSION = 1;

function isFieldMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function loadDraft(storage) {
  const serialized = storage.getItem(DRAFT_KEY);
  if (serialized === null) return null;

  let record;
  try {
    record = JSON.parse(serialized);
  } catch {
    return null;
  }

  const draft = record?.draft;
  if (record?.version !== DRAFT_VERSION || !isFieldMap(draft?.base) || !isFieldMap(draft?.scenario)
    || !Array.isArray(draft.works) || !['base', 'scenario'].includes(draft.mode)) return null;

  return draft;
}

function saveDraft(storage, draft) {
  storage.setItem(DRAFT_KEY, JSON.stringify({ version: DRAFT_VERSION, draft }));
}

function sameWorkRows(first, second) {
  return first.length === second.length && first.every((work, index) => (
    work.name === second[index].name && work.amount === second[index].amount
  ));
}

function sameDraftFields(first, second) {
  const names = Object.keys(first);
  return names.length === Object.keys(second).length && names.every((name) => first[name] === second[name]);
}

function sameDraftValues(first, second) {
  return sameDraftFields(first.base, second.base) && sameDraftFields(first.scenario, second.scenario)
    && sameWorkRows(first.works, second.works);
}

function clearSavedDraft(storage, snapshot) {
  const stored = loadDraft(storage);
  if (stored === null) return true;
  if (!sameDraftValues(stored, snapshot)) return false;
  storage.removeItem(DRAFT_KEY);
  return true;
}

function mergeDraftFields(previous, current, saved) {
  return Object.fromEntries(Object.entries(current).map(([key, value]) => {
    const inherit = value === previous[key] && Object.hasOwn(saved, key) && typeof saved[key] === 'string';
    return [key, inherit ? saved[key] : value];
  }));
}

function mergeDraftEdits(previous, current, saved, replaceBase = false) {
  if (saved === null) return current;
  return {
    base: replaceBase ? current.base : mergeDraftFields(previous.base, current.base, saved.base),
    scenario: mergeDraftFields(previous.scenario, current.scenario, saved.scenario),
    works: replaceBase || !sameWorkRows(previous.works, current.works) ? current.works : saved.works,
    mode: current.mode,
  };
}

if (typeof module === 'object' && module.exports) {
  module.exports = { clearSavedDraft, loadDraft, mergeDraftEdits, saveDraft };
}
