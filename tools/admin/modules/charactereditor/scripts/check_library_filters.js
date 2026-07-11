#!/usr/bin/env node
/**
 * Static guard: library search/filter must stay wired in ui-packages.js.
 * Run from module root: node scripts/check_library_filters.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const uiPackages = path.join(root, 'spmk_app/static/ui-packages.js');
const uiPolish = path.join(root, 'spmk_app/static/ui-polish.css');

const requiredSymbols = [
  'PKG_LIB_FILTERS_KEY',
  'PKG_LIB_SHEET_FILTERS',
  'renderPkgLibSearchBar',
  'openPkgLibFilterModal',
  'matchesPkgLibFilters',
  'applyPkgLibFilters',
  'pkgLibPokemonFlatMode',
  'libraryCellSizeTag',
  'bindPkgLibSearchBar',
];

const requiredDom = [
  'pkg-lib-searchbar',
  'pkgLibSearch',
  'pkgLibOpenFilters',
  'pkg-lib-pokemon-flat',
];

const requiredCss = [
  '.pkg-lib-searchbar',
  '.pkg-lib-filter-modal',
  '.pkg-lib-filter-chip',
];

let failed = false;

function fail(msg) {
  console.error(`check_library_filters: ${msg}`);
  failed = true;
}

const js = fs.readFileSync(uiPackages, 'utf8');
for (const sym of requiredSymbols) {
  if (!js.includes(sym)) fail(`missing symbol "${sym}" in ui-packages.js`);
}
for (const dom of requiredDom) {
  if (!js.includes(dom)) fail(`missing DOM id/class "${dom}" in ui-packages.js`);
}
if (!js.includes('applyPkgLibFilters(fullList)')) {
  fail('renderCharList must call applyPkgLibFilters(fullList)');
}
if (!js.includes('renderPkgLibSearchBar(fullList, list)')) {
  fail('renderCharList must render the search bar');
}

const css = fs.readFileSync(uiPolish, 'utf8');
for (const rule of requiredCss) {
  if (!css.includes(rule)) fail(`missing CSS rule "${rule}" in ui-polish.css`);
}

if (failed) process.exit(1);
console.log('check_library_filters: ok');
