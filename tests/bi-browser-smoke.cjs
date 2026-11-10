'use strict';
const fs = require('node:fs');
const { chromium } = require('playwright');
(async () => {
  fs.mkdirSync('artifacts', { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const baseUrl = process.env.COMICTECA_BASE_URL || 'http://127.0.0.1:8765/';
  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4500);
  await page.locator('[data-v="dashboard"]').click();
  await page.waitForTimeout(500);
  const report = await page.evaluate(() => ({
    title: document.title,
    dashboardButton: !!document.querySelector('[data-v="dashboard"]'),
    biModule: !!window.PbiDashboard,
    biNodes: document.querySelectorAll('[class*="pbi-"]').length,
    viewText: (document.querySelector('#view')?.innerText || '').slice(0, 500),
    logoCount: document.querySelectorAll('img[src*="comicteca-logo"]').length,
    logoLoaded: [...document.querySelectorAll('img[src*="comicteca-logo"]')].every(img => img.complete && img.naturalWidth > 0),
    dashboardVisible: [...document.querySelectorAll('#view [class*="pbi-"]')].some(el => el.getClientRects().length > 0),
    biCssApplied: [...document.querySelectorAll('#view .pbi-shell')].some(el => getComputedStyle(el).display === 'grid'),
    logoVisible: [...document.querySelectorAll('img[src*="comicteca-logo"]')].some(img => img.getClientRects().length > 0 && img.naturalWidth > 0)
  }));
  // Exercise the interactive BI drill-down even with an empty collection.
  // This checks actual navigation and rendering, not merely the presence of JS/CSS.
  await page.evaluate(() => window.PbiDashboard.filter('publisher', encodeURIComponent('Editorial de prueba')));
  await page.locator('#view .pbi-drill').waitFor({ state: 'visible', timeout: 10000 });
  report.drilldown = await page.evaluate(() => ({
    visible: !!document.querySelector('#view .pbi-drill'),
    heading: document.querySelector('#view .pbi-drill h2')?.textContent?.trim(),
    dashboardStillActive: !!document.querySelector('#view .pbi-shell'),
    closeButton: !!document.querySelector('#view .pbi-drill button[onclick*="clearDrill"]')
  }));
  await page.screenshot({ path: 'artifacts/bi-drilldown.png', fullPage: true });
  await page.locator('#view .pbi-drill button[onclick*="clearDrill"]').click();
  await page.locator('#view .pbi-drill').waitFor({ state: 'detached', timeout: 10000 });
  report.drilldown.closed = !await page.locator('#view .pbi-drill').count();
  // Validate every BI category opens a rendered drilldown and returns to the dashboard.
  report.drilldown.categories = {};
  for (const kind of ['character', 'universe', 'author', 'decade']) {
    const label = kind === 'decade' ? '1990–1999' : 'Filtro de prueba ' + kind;
    await page.evaluate(({ kind, label }) => window.PbiDashboard.filter(kind, encodeURIComponent(label)), { kind, label });
    await page.locator('#view .pbi-drill h2').waitFor({ state: 'visible', timeout: 10000 });
    const heading = await page.locator('#view .pbi-drill h2').innerText();
    await page.locator('#view .pbi-drill button[onclick*="clearDrill"]').click();
    await page.locator('#view .pbi-drill').waitFor({ state: 'detached', timeout: 10000 });
    report.drilldown.categories[kind] = heading.trim() === label && await page.locator('#view .pbi-shell').isVisible();
  }
  // Validate the actual published asset responses, not just DOM references.
  // A GitHub Pages HTML fallback may return 200 for a missing JS/CSS file.
  report.assets = {};
  for (const asset of ['dashboard-pbi.js', 'dashboard-pbi.css', 'mi-comicteca-logo.svg']) {
    const assetUrl = new URL(asset, baseUrl).href;
    const assetResponse = await page.request.get(assetUrl, { failOnStatusCode: false });
    const contentType = (assetResponse.headers()['content-type'] || '').toLowerCase();
    const expected = asset.endsWith('.js') ? ['javascript', 'ecmascript'] : asset.endsWith('.css') ? ['text/css'] : ['image/svg+xml'];
    report.assets[asset] = { status: assetResponse.status(), contentType, valid: assetResponse.ok() && expected.some(type => contentType.includes(type)) };
  }
  report.manifest = { valid: false };
  const manifestResponse = await page.request.get(new URL('manifest.webmanifest', baseUrl).href, { failOnStatusCode: false });
  if (manifestResponse.ok()) {
    try {
      const manifest = await manifestResponse.json();
      report.manifest = { valid: manifest.name === 'COMICTECA' && manifest.short_name === 'COMICTECA', name: manifest.name, shortName: manifest.short_name };
    } catch (error) {
      report.manifest = { valid: false, error: String(error) };
    }
  }
  report.url = page.url();
  report.httpStatus = response.status();
  report.pageErrors = errors;
  await page.screenshot({ path: 'artifacts/bi-browser.png', fullPage: true });
  fs.writeFileSync('artifacts/bi-browser-report.json', JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (report.httpStatus !== 200 || !report.dashboardButton || !report.biModule || !report.biNodes || !report.dashboardVisible || !report.biCssApplied || !report.logoCount || !report.logoLoaded || !report.logoVisible || !report.drilldown.visible || report.drilldown.heading !== 'Editorial de prueba' || !report.drilldown.dashboardStillActive || !report.drilldown.closeButton || !report.drilldown.closed || Object.values(report.drilldown.categories).some(ok => !ok) || !Object.values(report.assets).every(asset => asset.valid) || !report.manifest.valid || errors.length) process.exitCode = 1;
})().catch(err => { console.error(err); process.exitCode = 1; });
