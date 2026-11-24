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
const leaveButton = document.querySelector('#leave-object');
const guestButton = document.querySelector('#open-draft');
const exampleButton = document.querySelector('#load-example');
const exportButton = document.querySelector('#export-objects');
const importButton = document.querySelector('#import-objects');
const importInput = document.querySelector('#objects-file');
const objectList = document.querySelector('#object-list');
const objectTemplate = document.querySelector('#object-template');
const emptyObjects = document.querySelector('#empty-objects');
const libraryStatus = document.querySelector('#library-status');
const compareButton = document.querySelector('#compare-objects');
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
  saveButton.textContent = activeObject ? 'Сохранить изменения' : 'Сохранить объект';
  leaveButton.hidden = activeObject === null;
  exampleButton.hidden = activeObject !== null;
  updateObjectUnloadGuard();
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
  let guest = guestInMemory?.draft ?? null;
  const pending = guestInMemory !== null && !sameDraftValues(guestInMemory.draft, guestInMemory.baseline);
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
  if (activeObject !== null) restoreGuestEditor();
  showView('calculator');
}

async function changeLibrary(action, onError) {
  if (libraryBusy) return;
  libraryBusy = true;
  saveButton.disabled = true;
  try {
    const locks = window.navigator?.locks;
    if (locks) await locks.request(OBJECTS_KEY, action);
    else await action();
  } catch (error) {
    onError(error);
  } finally {
    libraryBusy = false;
    saveButton.disabled = false;
  }
}

function saveEditorObject() {
  return changeLibrary(() => {
    const storage = window.localStorage;
    const snapshot = currentDraft();
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
    if (!objectsView.hidden) (objectList.querySelector('[data-object-open]') ?? guestButton).focus();
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
  const base = calculateStoredBase(record.draft);

  item.querySelector('[data-object-name]').textContent = name;
  const locationLabel = item.querySelector('[data-object-location]');
  locationLabel.textContent = location ?? '';
  locationLabel.hidden = !location;
  item.querySelector('[data-object-preliminary]').hidden = base.uncountedCosts.length === 0;
  item.querySelector('[data-object-profit]').textContent = base.profit === null ? '—' : formatMoney(base.profit);

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
  compareButton.textContent = count === 0 ? 'Сравнить' : `Сравнить (${count})`;
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
    showLibraryStatus('Не удалось открыть сохранённые объекты.', true);
    return;
  }
  selectedRecords(objects);
  objects.sort((left, right) => right.updatedAt - left.updatedAt);
  objectList.replaceChildren(...objects.map(objectCard));
  emptyObjects.hidden = objects.length !== 0;
  exportButton.disabled = objects.length === 0;
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

saveButton.addEventListener('click', saveEditorObject);
leaveButton.addEventListener('click', openGuestEditor);
guestButton.addEventListener('click', openGuestEditor);
calculatorTab.addEventListener('click', () => showView('calculator'));
objectsTab.addEventListener('click', openObjectList);
exportButton.addEventListener('click', downloadObjects);
importButton.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', importSelectedFile);
window.addEventListener('storage', ({ key }) => {
  if (!objectsView.hidden && (key === OBJECTS_KEY || key === null)) refreshLibrary();
});
