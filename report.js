'use strict';

const reportDetailLabels = {
  location: 'Адрес или район',
  listingUrl: 'Ссылка на объявление',
  layoutNote: 'Заметки',
};

const reportFonts = {
  NotoSans: {
    normal: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf',
    italics: 'NotoSans-Regular.ttf', bolditalics: 'NotoSans-Bold.ttf',
  },
};

const reportMetrics = [
  ['Цена покупки', 'money', (result) => result.costs.purchasePrice],
  ['Цена сделки', 'money', (result) => result.salePrice],
  ['Бюджет ремонта', 'money', (result) => result.repairCost],
  ['Себестоимость', 'money', (result) => result.totalCost],
  ['Рентабельность', 'percent', (result) => result.returnOnCost],
  ['Годовая доходность', 'percent', (result) => result.annualReturn],
  ['Цена безубыточности', 'money', (result) => result.breakEvenPrice],
  ['Срок', 'months', (result) => result.months],
];

function reportNumber(value, format) {
  return value == null ? '—' : format(value);
}

function reportMetricsRows(results, format) {
  return reportMetrics.map(([label, kind, value]) => [
    label, ...results.map((result) => reportNumber(result && value(result), format[kind])),
  ]);
}

function reportWarnings(result, format) {
  if (!result || result.state === 'empty') return '';
  const costs = result.missingCosts;
  return [
    result.state === 'invalid' ? 'Ошибка в исходных данных'
      : result.state === 'preliminary' ? 'Предварительный расчёт' : '',
    costs.length ? `Не учтено: ${format.costs(costs)}` : '',
  ].filter(Boolean).join('. ');
}

function reportTable(columns, rows) {
  return {
    layout: 'lightHorizontalLines',
    table: {
      headerRows: 1,
      widths: [166, ...columns.map(() => '*')],
      body: [
        ['Показатель', ...columns].map((text) => ({ text, style: 'tableHeader' })),
        ...rows,
      ],
    },
  };
}

function reportDetails(records, details, comparison) {
  return records.flatMap(({ draft, name }) => {
    const fields = Object.entries(reportDetailLabels).flatMap(([key, label]) => {
      const value = draft.base[key]?.trim();
      if (!details[key] || !value) return [];
      return [{ text: label, style: 'detailLabel' }, { text: value, wordBreak: key === 'listingUrl' ? 'break-all' : 'normal' }];
    });
    if (!fields.length) return [];
    return [...(comparison ? [{ text: name, style: 'detailHeading' }] : []), ...fields];
  });
}

function reportProfit(result, format) {
  return result ? reportNumber(result.profit, format.money) : 'Не задано';
}

function reportDeal(record, format) {
  const { base, scenario } = record.result;
  const columns = scenario ? ['База', 'Что если?'] : ['База'];
  const results = scenario ? [base, scenario] : [base];
  const rows = [
    ['Прибыль', ...results.map((result) => ({ text: reportProfit(result, format), style: 'profit' }))],
    ...reportMetricsRows(results, format),
  ];
  const warnings = results.map((result, index) => {
    const costs = reportWarnings(result, format);
    return costs && `${columns[index]} — ${costs}`;
  }).filter(Boolean);
  return [
    { text: record.name, style: 'subtitle' },
    reportTable(columns, rows),
    ...(warnings.length ? [{ text: warnings.join('\n'), style: 'warning' }] : []),
  ];
}

function reportComparison(records, format) {
  const results = records.map(({ result }) => result);
  const rows = [
    ['Прибыль · база', ...results.map(({ base }) => ({ text: reportProfit(base, format), style: 'profit' }))],
    ['Прибыль · «Что если?»', ...results.map(({ scenario }) => ({ text: reportProfit(scenario, format), style: 'profit' }))],
    ...reportMetricsRows(results.map(({ base }) => base), format),
  ];

  if (results.some(({ scenario }) => scenario)) {
    for (const [label, key, kind] of [
      ['Изменение цены сделки', 'salePrice', 'money'],
      ['Изменение ремонта', 'repairCost', 'money'],
      ['Изменение срока', 'months', 'months'],
    ]) {
      rows.push([label, ...results.map(({ differences }) => reportNumber(differences?.[key], (value) => (
        `${value > 0 ? '+' : ''}${format[kind](value)}`
      )))]);
    }
  }

  const warnings = results.map(({ base, scenario }) => {
    const baseCosts = reportWarnings(base, format);
    const scenarioCosts = reportWarnings(scenario, format);
    if (!baseCosts && !scenarioCosts) return '—';
    return { stack: [
      ...(baseCosts ? [{ text: `База — ${baseCosts}` }] : []),
      ...(scenarioCosts ? [{ text: `Что если? — ${scenarioCosts}` }] : []),
    ] };
  });
  if (warnings.some((value) => value !== '—')) rows.push(['Статус расчёта', ...warnings]);
  return reportTable(records.map(({ name }) => name), rows);
}

function createReportDocument(drafts, { comparison = false, details = {} }, format) {
  const title = comparison ? 'Сравнение объектов' : 'Расчёт объекта';
  const records = drafts.map((draft) => ({
    draft,
    name: draft.base.objectName?.trim() || 'Без названия',
    result: format.calculate(draft),
  }));
  const content = [];
  const groupSize = comparison ? 2 : 1;
  for (let index = 0; index < records.length; index += groupSize) {
    const group = records.slice(index, index + groupSize);
    const header = { text: 'FlipLab', style: 'brand' };
    if (index) header.pageBreak = 'before';
    content.push(header, { text: title, style: 'title' });
    if (comparison) content.push(reportComparison(group, format));
    else content.push(...reportDeal(group[0], format));
    content.push(...reportDetails(group, details, comparison));
  }

  return {
    info: { title, creator: 'FlipLab' },
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 42],
    content,
    defaultStyle: { font: 'NotoSans', fontSize: 10.5, color: '#202923', lineHeight: 1.14 },
    styles: {
      brand: { fontSize: 11, bold: true, color: '#367750', margin: [0, 0, 0, 8] },
      title: { fontSize: 24, bold: true, color: '#1b3b30', margin: [0, 0, 0, 16] },
      subtitle: { fontSize: 15, bold: true, margin: [0, 0, 0, 12] },
      tableHeader: { bold: true, fillColor: '#eaf0e7', color: '#1b3b30' },
      profit: { bold: true, color: '#1b3b30' },
      warning: { bold: true, color: '#963b2d', margin: [0, 13, 0, 4] },
      detailHeading: { bold: true, fontSize: 13, margin: [0, 16, 0, 0] },
      detailLabel: { bold: true, margin: [0, 9, 0, 3] },
    },
    footer: (page, total) => ({
      text: `${page} / ${total}`, alignment: 'right', fontSize: 9, color: '#59645b', margin: [40, 10, 40, 0],
    }),
  };
}

if (typeof module === 'object' && module.exports) {
  module.exports = { createReportDocument, reportFonts };
}
