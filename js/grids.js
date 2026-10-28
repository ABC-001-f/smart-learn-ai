// AG Grid (Community) helpers: one dark theme matching LearnBond, plus shared formatters.
// If the AG Grid CDN can't load (e.g. offline), pages fall back to plain HTML tables.
LB.grids = (() => {
  'use strict';
  const available = () => typeof window.agGrid?.createGrid === 'function';

  let theme;
  function getTheme() {
    theme ??= agGrid.themeQuartz.withPart(agGrid.colorSchemeDarkBlue).withParams({
      accentColor: '#8b5cf6',
      backgroundColor: '#0b1022',
      foregroundColor: '#eef1ff',
      headerBackgroundColor: '#0f1530',
      borderColor: 'rgba(255, 255, 255, 0.08)',
      fontFamily: 'Inter, system-ui, sans-serif',
      headerFontFamily: '"Space Grotesk", Inter, sans-serif',
      fontSize: 13,
      wrapperBorderRadius: 14,
    });
    return theme;
  }

  function create(el, options) {
    if (!available()) return null;
    return agGrid.createGrid(el, {
      theme: getTheme(),
      animateRows: true,
      defaultColDef: { sortable: true, resizable: true, filter: true, ...options.defaultColDef },
      ...options,
    });
  }

  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const moneyFmt = (p) => (p.value == null || p.value === '' ? '' : usd.format(p.value));
  const timeFmt = (p) => (p.value ? new Date(p.value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

  // Wires a search box and a CSV button to a grid.
  function toolbar(api, { search, exportBtn, fileName }) {
    search?.addEventListener('input', () => api.setGridOption('quickFilterText', search.value));
    exportBtn?.addEventListener('click', () => api.exportDataAsCsv({ fileName }));
  }

  return { available, create, moneyFmt, timeFmt, toolbar };
})();
