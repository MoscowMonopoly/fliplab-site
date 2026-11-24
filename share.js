'use strict';

const shareDealButton = document.querySelector('#share-deal');
const shareDialog = document.querySelector('#share-dialog');
const shareTitle = document.querySelector('#share-title');
const shareOptions = document.querySelector('#share-options');
const shareFields = [...shareOptions.querySelectorAll('input')];
const shareStatus = document.querySelector('#share-status');
const shareConfirm = document.querySelector('#share-confirm');
const shareClose = document.querySelector('#share-close');

const shareFormat = {
  calculate: calculateDraftComparison,
  money: formatMoney,
  percent: formatPercent,
  months: formatters.months,
  costs: (keys) => costList.format(keys.map((key) => costNames[key])),
};

let pdfLibrary;
let shareSelection;
let preparedReport;
let reportVersion = 0;

function loadReportScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => {
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    }, { once: true });
    document.head.append(script);
  });
}

function loadPdfLibrary() {
  if (!pdfLibrary) {
    pdfLibrary = loadReportScript('vendor/pdfmake-0.3.15.min.js')
      .then(() => loadReportScript('vendor/noto-sans-2.015-vfs.js'))
      .then(() => {
        const { pdfMake } = window;
        pdfMake.addFonts(reportFonts);
        return pdfMake;
      })
      .catch((error) => {
        pdfLibrary = undefined;
        throw error;
      });
  }
  return pdfLibrary;
}

function showShareStatus(text, error = false) {
  shareStatus.textContent = text;
  shareStatus.dataset.error = String(error);
}

async function prepareReport() {
  const version = ++reportVersion;
  const { drafts, comparison } = shareSelection;
  const details = Object.fromEntries(shareFields.map(({ name, checked }) => [name, checked]));
  preparedReport = undefined;
  shareConfirm.disabled = true;
  shareConfirm.textContent = 'Подготовить PDF';
  showShareStatus('Готовим PDF…');

  try {
    const pdfMake = await loadPdfLibrary();
    const definition = createReportDocument(drafts, { comparison, details }, shareFormat);
    const blob = await pdfMake.createPdf(definition).getBlob();
    if (version !== reportVersion || !shareDialog.open) return;

    const name = comparison ? 'fliplab-sravnenie.pdf' : 'fliplab-raschet.pdf';
    const file = new File([blob], name, { type: 'application/pdf' });
    const shareData = { files: [file] };
    const native = typeof navigator.share === 'function' && navigator.canShare?.(shareData);
    preparedReport = { file, native };
    shareConfirm.textContent = native ? 'Отправить PDF' : 'Скачать PDF';
    showShareStatus('');
  } catch {
    if (version !== reportVersion || !shareDialog.open) return;
    shareConfirm.textContent = 'Повторить';
    showShareStatus('Не удалось подготовить PDF.', true);
  }

  shareConfirm.disabled = false;
}

function openShareDialog(drafts, comparison = false) {
  shareSelection = { drafts, comparison };
  shareTitle.textContent = comparison ? 'Поделиться сравнением' : 'Поделиться расчётом';
  for (const field of shareFields) {
    field.checked = false;
    field.parentElement.hidden = !drafts.some(({ base }) => base[field.name]?.trim());
  }
  shareOptions.hidden = shareFields.every((field) => field.parentElement.hidden);
  shareDialog.showModal();
  prepareReport();
}

async function confirmShare() {
  const report = preparedReport;
  if (!report) {
    await prepareReport();
    return;
  }

  if (!report.native) {
    try {
      downloadFile(report.file, report.file.name);
      shareDialog.close();
    } catch {
      showShareStatus('Не удалось скачать PDF.', true);
    }
    return;
  }

  shareConfirm.disabled = true;
  try {
    await navigator.share({ files: [report.file] });
    if (preparedReport === report && shareDialog.open) shareDialog.close();
  } catch (error) {
    if (preparedReport !== report || !shareDialog.open) return;
    if (error.name !== 'AbortError') {
      report.native = false;
      shareConfirm.textContent = 'Скачать PDF';
      showShareStatus('Можно скачать PDF и отправить его из файлов.', true);
    }
    shareConfirm.disabled = false;
  }
}

shareDealButton.addEventListener('click', () => openShareDialog([currentDraft()]));
shareComparisonButton.addEventListener('click', () => {
  if (displayedComparisonRecords.length >= 2) {
    openShareDialog(displayedComparisonRecords.map(({ draft }) => draft), true);
  }
});
shareOptions.addEventListener('change', prepareReport);
shareConfirm.addEventListener('click', confirmShare);
shareClose.addEventListener('click', () => shareDialog.close());
shareDialog.addEventListener('close', () => {
  if (shareDialog.open) return;
  reportVersion++;
  shareSelection = undefined;
  preparedReport = undefined;
});
