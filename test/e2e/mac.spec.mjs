// On a Mac (GitHub's, in the release workflow): the packaged Rumoria.app
// (RUMORIA_MAC_APP, its executable) or, without it, the app from the
// sources. It must open with the Mac's own window buttons, its server and
// yt-dlp must work, and screenshots of the window are saved to look at
// (test-results/mac/), not compared: there is no Mac here to make them.
import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'test-results', 'mac');

test.skip(process.platform !== 'darwin', 'only on a Mac');

let app;
let page;
let dataDir;
const report = {};

test.beforeAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rumoria-mac-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ bounds: { x: 40, y: 40, width: 1280, height: 820 } }));
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
  const packaged = process.env.RUMORIA_MAC_APP;
  report.packaged = Boolean(packaged);
  app = await electron.launch({
    ...(packaged ? { executablePath: packaged, args: [] } : { args: [ROOT], cwd: ROOT }),
    env: { ...env, RUMORIA_USER_DATA: dataDir, RUMORIA_E2E: '1' },
  });
  page = await app.firstWindow();
  await page.waitForSelector('.sidebar', { timeout: 60_000 });
  await page.evaluate(() => { localStorage.setItem('rumoria_guide', JSON.stringify({ show: false })); localStorage.setItem('rumoria_theme', 'dark'); });
  await page.reload();
  await page.waitForSelector('.sidebar');
});

test.afterAll(async () => {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  if (app) await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('opens with the Mac window buttons and room for them', async () => {
  expect(await page.evaluate(() => window.rumoria.platform)).toBe('darwin');
  await expect(page.locator('.titlebar-native')).toBeVisible();
  await expect(page.locator('.titlebar .traffic, .titlebar .caption')).toHaveCount(0);
  report.version = await app.evaluate(({ app: a }) => a.getVersion());
  report.arch = await app.evaluate(() => process.arch);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'window-dark.png') });
});

test('every style and theme, and Ajustes', async () => {
  for (const [ui, theme] of [['mac', 'light'], ['mac', 'dark'], ['rumoria', 'light']]) {
    await page.evaluate(([u, t]) => { localStorage.setItem('rumoria_look', JSON.stringify({ ui: u })); localStorage.setItem('rumoria_theme', t); }, [ui, theme]);
    await page.reload();
    await page.waitForSelector('.sidebar');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `window-${ui}-${theme}.png`) });
  }
  await page.locator('.topbar button[aria-label="Ajustes"]').click();
  await page.waitForSelector('.settings');
  await page.screenshot({ path: path.join(OUT, 'settings.png') });
});

test('its server answers, and yt-dlp for the Mac runs', async () => {
  const lists = await page.evaluate(async () => (await fetch('/api/lists')).status);
  expect(lists).toBe(200);
  // YouTube may not answer GitHub's machines: the result is written down, and only a crash fails.
  const search = await page.evaluate(async () => {
    const t0 = Date.now();
    const r = await fetch('/api/search?q=never%20gonna%20give%20you%20up');
    const body = await r.json().catch(() => null);
    return { status: r.status, ms: Date.now() - t0, results: body && body.results ? body.results.length : 0, error: body && body.error };
  });
  report.search = search;
  expect([200, 502]).toContain(search.status);
  if (search.status === 200) {
    report.audio = await page.evaluate(async () => {
      const t0 = Date.now();
      const r = await fetch('/api/stream/audio?id=dQw4w9WgXcQ', { headers: { Range: 'bytes=0-99999' } });
      const bytes = (await r.arrayBuffer()).byteLength;
      return { status: r.status, type: r.headers.get('content-type'), bytes, ms: Date.now() - t0 };
    });
  }
});
