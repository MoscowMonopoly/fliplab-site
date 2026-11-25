'use strict';

const calculatorView = document.querySelector('#calculator-view');
const objectsView = document.querySelector('#objects-view');
const comparisonView = document.querySelector('#comparison-view');
const calculatorTab = document.querySelector('#calculator-tab');
const objectsTab = document.querySelector('#objects-tab');
const calculatorTitle = document.querySelector('#calculator-title');
const objectsTitle = document.querySelector('#objects-title');
const comparisonTitle = document.querySelector('#comparison-title');
const saveButton = document.querySelector('#save-object');
const saveButtons = [saveButton, document.querySelector('#save-result')];
const clearFieldsButton = document.querySelector('#clear-fields');
const leaveButton = document.querySelector('#leave-object');
const guestButton = document.querySelector('#open-draft');
const newFromLibrary = document.querySelector('#new-from-library');
const newAfterSave = document.querySelector('#new-after-save');
const exampleButton = document.querySelector('#load-example');
const exportButton = document.querySelector('#export-objects');
const importButton = document.querySelector('#import-objects');
const importInput = document.querySelector('#objects-file');
const objectList = document.querySelector('#object-list');
const objectTemplate = document.querySelector('#object-template');
const emptyObjects = document.querySelector('#empty-objects');
const libraryStatus = document.querySelector('#library-status');
const compareButton = document.querySelector('#compare-objects');
const compareActions = document.querySelector('#compare-actions');
const selectionStatus = document.querySelector('#selection-status');
const selectedObjectIds = new Set();

let activeObject = null;
let editorBaseline = null;
let guestInMemory = null;
let libraryBusy = false;

function objectName(record) {
  return record.draft.base.objectName?.trim() || 'Без названия';
}

function showLibraryStatus(message, error = false) {
  libraryStatus.textContent = message;
  libraryStatus.setAttribute('data-error', String(error));
}

function showView(view) {
  const calculator = view === 'calculator';
  calculatorView.hidden = !calculator;
  objectsView.hidden = view !== 'objects';
  comparisonView.hidden = view !== 'comparison';
  const currentTab = calculator ? calculatorTab : objectsTab;
  const otherTab = calculator ? objectsTab : calculatorTab;
  otherTab.removeAttribute('aria-current');
  currentTab.setAttribute('aria-current', 'page');
  const headings = { calculator: calculatorTitle, objects: objectsTitle, comparison: comparisonTitle };
  headings[view].focus();
}

function updateEditorActions() {
  calculatorTitle.textContent = activeObject ? objectName(activeObject) : 'Калькулятор флип-сделки';
  for (const button of saveButtons) button.textContent = activeObject ? 'Сохранить изменения' : 'Сохранить объект';
  newAfterSave.hidden = activeObject === null;
  exampleButton.hidden = activeObject !== null;
  refreshDraftActions();
  updateObjectUnloadGuard();
}

function hasPendingGuestEdits() {
  return guestInMemory !== null && !sameDraftValues(guestInMemory.draft, guestInMemory.baseline);
}

function refreshDraftActions() {
  const draft = currentDraft();
  const hasValues = hasDraftValues(draft);
  for (const button of saveButtons) button.disabled = libraryBusy || !hasValues;
  clearFieldsButton.disabled = libraryBusy || !hasValues;
  let guest = activeObject === null ? draft : guestInMemory?.draft;
  const pendingInEditor = activeObject === null && !sameDraftValues(draft, previousDraft);
  const readStored = activeObject === null ? !pendingInEditor && !hasValues : !hasPendingGuestEdits();
  if (readStored) {
    try {
      guest = loadDraft(window.localStorage);
    } catch {
      // A guest snapshot can still be available in this tab.
    }
  }
  guestButton.hidden = !hasDraftValues(guest);
  leaveButton.hidden = activeObject === null || guestButton.hidden;
}

function editorHasChanges() {
  return activeObject !== null && !sameDraftValues(currentDraft(), editorBaseline);
}

function warnBeforeClosingObject(event) {
  event.preventDefault();
  event.returnValue = true;
}

function updateObjectUnloadGuard() {
  if (editorHasChanges()) window.addEventListener('beforeunload', warnBeforeClosingObject);
  else window.removeEventListener('beforeunload', warnBeforeClosingObject);
}

function confirmLeavingEditor() {
  return !editorHasChanges() || window.confirm('В открытом объекте есть несохранённые изменения. Закрыть его?');
}

function openSavedObject(id, showError = showLibraryStatus) {
  if (libraryBusy) return;
  let record;
  try {
    record = readObjects(window.localStorage).find((item) => item.id === id);
  } catch {
    showError('Не удалось открыть сохранённые объекты.', true);
    return;
  }
  if (!record) {
    refreshLibrary();
    showError('Этот объект уже удалён.', true);
    return;
  }
  if (record.id === activeObject?.id && record.revision === activeObject.revision) {
    showView('calculator');
    return;
  }
  if (!confirmLeavingEditor()) return;

  if (activeObject === null) guestInMemory = { draft: currentDraft(), baseline: previousDraft };
  activeObject = record;
  openEditor(record.draft, true);
  editorBaseline = currentDraft();
  updateEditorActions();
  showDraftStatus('');
  showView('calculator');
}

function restoreGuestEditor() {
  let guest = activeObject === null ? currentDraft() : guestInMemory?.draft ?? null;
  const pending = hasPendingGuestEdits();
  let storageError = false;
  try {
    if (!pending) guest = loadDraft(window.localStorage);
  } catch {
    storageError = true;
  }
  activeObject = null;
  editorBaseline = null;
  openEditor(guest);
  if (pending) previousDraft = guestInMemory.baseline;
  guestInMemory = null;
  updateEditorActions();
  const storageUnavailable = storageError || pending;
  showDraftStatus(storageUnavailable ? 'Черновик открыт. Последние правки могут быть только в этой вкладке.' : '', storageUnavailable);
}

function openGuestEditor() {
  if (libraryBusy || !confirmLeavingEditor()) return;
  const draft = currentDraft();
  if (activeObject !== null || (!hasDraftValues(draft) && sameDraftValues(draft, previousDraft))) restoreGuestEditor();
  showView('calculator');
}

function clearEditorFields() {
  if (libraryBusy || !hasDraftValues(currentDraft())) return;
  if (!window.confirm('Очистить поля текущего расчёта и его сценария?')) return;

  const editingObject = activeObject !== null;
  if (!editingObject) {
    try {
      if (!clearSavedDraft(window.localStorage, previousDraft)) {
        showDraftStatus('Черновик изменён в другой вкладке. Откройте актуальную версию.', true);
        return;
      }
    } catch {
      showDraftStatus('Не удалось очистить черновик в браузере.', true);
      return;
    }
  }

  openEditor(null, editingObject);
  updateObjectUnloadGuard();
  showDraftStatus('Поля очищены.');
  focusEditorControl(document.querySelector('#form-title'));
}

function newCalculation() {
  if (libraryBusy || !confirmLeavingEditor()) return;
  try {
    const storage = window.localStorage;
    const stored = loadDraft(storage);
    const guest = activeObject === null ? currentDraft() : hasPendingGuestEdits() ? guestInMemory.draft : stored;
    if ((hasDraftValues(guest) || hasDraftValues(stored))
      && !window.confirm('Начать новый расчёт и очистить текущий черновик?')) return;
    if (stored && !clearSavedDraft(storage, stored)) {
      throw new Error('The draft changed in another tab');
    }
  } catch {
    const message = 'Не удалось очистить черновик. Откройте его и проверьте данные.';
    if (!objectsView.hidden) showLibraryStatus(message, true);
    else showResultSaveStatus(message, true);
    return;
  }
  activeObject = null;
  editorBaseline = null;
  guestInMemory = null;
  openEditor(null);
  showDraftStatus('');
  updateEditorActions();
  showView('calculator');
  focusEditorControl(document.querySelector('#form-title'));
}

async function changeLibrary(action, onError) {
  if (libraryBusy) return;
  libraryBusy = true;
  refreshDraftActions();
  try {
    const locks = window.navigator?.locks;
    if (locks) await locks.request(OBJECTS_KEY, action);
    else await action();
  } catch (error) {
    onError(error);
  } finally {
    libraryBusy = false;
    refreshDraftActions();
  }
}

function saveEditorObject() {
  return changeLibrary(() => {
    const storage = window.localStorage;
    const snapshot = currentDraft();
    if (!hasDraftValues(snapshot)) return;
    const creating = activeObject === null;
    activeObject = saveObject(storage, snapshot, activeObject);
    editorBaseline = snapshot;
    editingSavedObject = true;
    updateEditorActions();

    let draftCleared = true;
    if (creating) {
      guestInMemory = null;
      try {
        draftCleared = clearSavedDraft(storage, snapshot);
      } catch {
        draftCleared = false;
      }
    }
    const message = draftCleared ? 'Объект сохранён в этом браузере.' : 'Объект сохранён. Гостевой черновик остался в браузере.';
    showDraftStatus(message);
    showResultSaveStatus(message);
    if (!objectsView.hidden) {
      refreshLibrary();
      showLibraryStatus(message);
    }
    if (!comparisonView.hidden) refreshComparison();
  }, (error) => {
    const message = error instanceof ObjectConflict
      ? 'Объект изменён или удалён в другой вкладке. Откройте актуальную карточку из списка.'
      : 'Не удалось сохранить объект. Введённые данные остались в форме.';
    showDraftStatus(message, true);
    showResultSaveStatus(message, true);
    if (!objectsView.hidden) showLibraryStatus(message, true);
    if (!comparisonView.hidden) showComparisonStatus(message, true);
  });
}

function removeSavedObject(record) {
  const pending = activeObject?.id === record.id && editorHasChanges();
  const suffix = pending ? ' вместе с несохранёнными изменениями?' : ' из этого браузера?';
  if (libraryBusy || !window.confirm(`Удалить объект «${objectName(record)}»${suffix}`)) return;
  return changeLibrary(() => {
    deleteObject(window.localStorage, record);
    if (activeObject?.id === record.id) restoreGuestEditor();
    refreshLibrary();
    showLibraryStatus('Объект удалён.');
    if (!comparisonView.hidden) refreshComparison();
    if (!objectsView.hidden) (objectList.querySelector('[data-object-open]') ?? newFromLibrary).focus();
  }, (error) => {
    refreshLibrary();
    showLibraryStatus(error instanceof ObjectConflict
      ? 'Объект изменён в другой вкладке. Проверьте актуальный список.'
      : 'Не удалось удалить объект.', true);
  });
}

function objectCard(record) {
  const item = objectTemplate.content.firstElementChild.cloneNode(true);
  const name = objectName(record);
  const location = record.draft.base.location?.trim();
  const { base } = calculateDraftComparison(record.draft);

  item.querySelector('[data-object-name]').textContent = name;
  const locationLabel = item.querySelector('[data-object-location]');
  locationLabel.textContent = location ?? '';
  locationLabel.hidden = !location;
  const preliminary = item.querySelector('[data-object-preliminary]');
  preliminary.hidden = !['invalid', 'preliminary'].includes(base.state);
  if (base.state === 'invalid') preliminary.textContent = 'Ошибка в исходных данных';
  item.querySelector('[data-object-dirty]').hidden = activeObject?.id !== record.id || !editorHasChanges();
  item.querySelector('[data-object-profit]').textContent = base.profit === null ? '—' : formatMoney(base.profit);
  const profitNote = item.querySelector('[data-object-profit-note]');
  profitNote.textContent = metricNote(base, 'profit');
  profitNote.hidden = !profitNote.textContent;

  const select = item.querySelector('[data-object-select]');
  select.checked = selectedObjectIds.has(record.id);
  select.setAttribute('aria-label', `Выбрать «${name}» для сравнения`);
  select.addEventListener('change', () => {
    if (select.checked) selectedObjectIds.add(record.id);
    else selectedObjectIds.delete(record.id);
    updateCompareButton();
  });

  const open = item.querySelector('[data-object-open]');
  open.setAttribute('aria-label', `Открыть «${name}»`);
  open.addEventListener('click', () => openSavedObject(record.id));
  const remove = item.querySelector('[data-object-delete]');
  remove.setAttribute('aria-label', `Удалить «${name}»`);
  remove.addEventListener('click', () => removeSavedObject(record));
  return item;
}

function updateCompareButton() {
  const count = selectedObjectIds.size;
  compareButton.disabled = count < 2;
  compareButton.textContent = `Сравнить (${count})`;
  selectionStatus.textContent = count < 2 ? `Выбрано: ${count}. Выберите минимум два объекта для сравнения.` : `Выбрано: ${count}.`;
}

function selectedRecords(objects) {
  const byId = new Map(objects.map((record) => [record.id, record]));
  for (const id of selectedObjectIds) {
    if (!byId.has(id)) selectedObjectIds.delete(id);
  }
  updateCompareButton();
  return [...selectedObjectIds].map((id) => byId.get(id));
}

function refreshLibrary() {
  let objects;
  try {
    objects = readObjects(window.localStorage);
  } catch {
    objectList.replaceChildren();
    emptyObjects.hidden = true;
    exportButton.disabled = true;
    compareButton.disabled = true;
    compareActions.hidden = true;
    showLibraryStatus('Не удалось открыть сохранённые объекты.', true);
    return;
  }
  selectedRecords(objects);
  objects.sort((left, right) => right.updatedAt - left.updatedAt);
  objectList.replaceChildren(...objects.map(objectCard));
  emptyObjects.hidden = objects.length !== 0;
  exportButton.disabled = objects.length === 0;
  compareActions.hidden = objects.length === 0;
  refreshDraftActions();
}

function openObjectList() {
  showLibraryStatus('');
  refreshLibrary();
  showView('objects');
}

function downloadFile(file, name) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function downloadObjects() {
  try {
    const file = new Blob([exportObjects(readObjects(window.localStorage))], { type: 'application/json' });
    downloadFile(file, 'fliplab-objects.json');
  } catch {
    showLibraryStatus('Не удалось скачать копию объектов.', true);
  }
}

function importSelectedFile() {
  const file = importInput.files[0];
  importInput.value = '';
  if (!file || libraryBusy) return;
  return changeLibrary(async () => {
    let contents;
    try {
      contents = await file.text();
    } catch {
      showLibraryStatus('Не удалось прочитать выбранный файл.', true);
      return;
    }
    const { added, skipped } = importObjects(window.localStorage, contents);
    refreshLibrary();
    showLibraryStatus(`Добавлено объектов — ${added}. Уже были в списке — ${skipped}.`);
  }, (error) => {
    showLibraryStatus(error instanceof ObjectFileError
      ? 'Выберите файл, экспортированный из FlipLab.'
      : 'Не удалось импортировать объекты. Список сохранён без изменений.', true);
  });
}

for (const button of saveButtons) button.addEventListener('click', saveEditorObject);
clearFieldsButton.addEventListener('click', clearEditorFields);
leaveButton.addEventListener('click', openGuestEditor);
guestButton.addEventListener('click', openGuestEditor);
newFromLibrary.addEventListener('click', newCalculation);
newAfterSave.addEventListener('click', newCalculation);
calculatorTab.addEventListener('click', () => showView('calculator'));
objectsTab.addEventListener('click', openObjectList);
exportButton.addEventListener('click', downloadObjects);
importButton.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', importSelectedFile);
window.addEventListener('storage', ({ key }) => {
  if (!objectsView.hidden && (key === OBJECTS_KEY || key === null)) refreshLibrary();
  if (key === DRAFT_KEY || key === null) refreshDraftActions();
});
document.addEventListener('fliplab:editor-rendered', refreshDraftActions);
updateEditorActions();
