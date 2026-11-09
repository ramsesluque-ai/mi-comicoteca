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
  report.url = page.url();
  report.httpStatus = response.status();
  report.pageErrors = errors;
  await page.screenshot({ path: 'artifacts/bi-browser.png', fullPage: true });
  fs.writeFileSync('artifacts/bi-browser-report.json', JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (report.httpStatus !== 200 || !report.dashboardButton || !report.biModule || !report.biNodes || !report.dashboardVisible || !report.biCssApplied || !report.logoCount || !report.logoLoaded || !report.logoVisible || errors.length) process.exitCode = 1;
})().catch(err => { console.error(err); process.exitCode = 1; });
