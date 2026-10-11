// The window and the mini player as they look, in each interface style
// (Rumoria, Windows, Mac) and each of the mini player's shapes (normal,
// tarjeta, compacta), compared with the screenshots saved before. Rumoria
// runs from a fresh data folder, with nothing going to the network by itself
// (RUMORIA_E2E): no updates, nothing read in the background.
import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SONG = {
  title: 'Una canción con un título bastante largo para ver cómo se desliza', artist: 'Artista de prueba', cover: null,
  playing: false, loading: false, time: 63, duration: 214, liked: true, canLike: true, volume: 0.7, muted: false,
  shuffle: true, repeat: 'all', hasNext: true, yt: null, line: 'Esta es la línea que suena ahora', nextLine: 'Y esta, la siguiente',
  upNext: 'La siguiente · Otro artista', queue: [{ i: 1, title: 'La siguiente', artist: 'Otro artista' }, { i: 2, title: 'Y otra', artist: 'Alguien' }],
};

// Screenshots made and compared on Windows (fonts and scaling); a Mac has its own spec (mac.spec.mjs).
test.skip(process.platform !== 'win32', 'screenshots are made on Windows');

let app;
let page;
let dataDir;

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rumoria-e2e-'));
  // The same window size and mini player spot every time.
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ bounds: { x: 40, y: 40, width: 1280, height: 820 }, miniPos: { x: 60, y: 60 } }));
  // Launched from inside another Electron app (an editor), this may be set: Electron would start as plain Node.
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
  app = await electron.launch({ args: [ROOT], cwd: ROOT, env: { ...env, RUMORIA_USER_DATA: dataDir, RUMORIA_E2E: '1' } });
  page = await app.firstWindow();
  await page.waitForSelector('.sidebar');
  // No welcome guide, dark theme.
  await page.evaluate(() => { localStorage.setItem('rumoria_guide', JSON.stringify({ show: false })); localStorage.setItem('rumoria_theme', 'dark'); });
});

test.afterAll(async () => {
  if (app) await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Rumoria with this look (kept in the page's storage, as Personalizar does), opened again. */
async function withLook(look) {
  await page.evaluate((l) => localStorage.setItem('rumoria_look', JSON.stringify(l)), look);
  await page.reload();
  await page.waitForSelector('.sidebar');
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.waitForTimeout(300);
}

for (const ui of ['rumoria', 'windows', 'mac']) {
  test(`the window in the ${ui} style`, async () => {
    await withLook({ ui });
    expect(await page.evaluate(() => document.documentElement.dataset.ui)).toBe(ui);
    // What the style changes: the title bar, the library, the player, corners and colours. Inicio's
    // contents rotate and change with the hour, so they're left out (Ajustes, below, covers a page).
    await expect(page).toHaveScreenshot(`window-${ui}.png`, { mask: [page.locator('.page')] });
  });
}

test('Ajustes in the Mac style, light theme', async () => {
  await page.evaluate(() => localStorage.setItem('rumoria_theme', 'light'));
  await withLook({ ui: 'mac' });
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await page.waitForSelector('.settings');
  await expect(page).toHaveScreenshot('settings-mac-light.png');
  await page.getByRole('button', { name: 'Inicio' }).click();
  await page.evaluate(() => localStorage.setItem('rumoria_theme', 'dark'));
});

test.describe('the mini player', () => {
  let mini;
  test.beforeAll(async () => {
    await withLook({ ui: 'rumoria' });
    const opened = app.waitForEvent('window', (w) => w.url().includes('mini.html'));
    await page.evaluate(() => window.rumoria.mini.open());
    mini = await opened;
    await mini.waitForLoadState('domcontentloaded');
  });

  for (const [shape, prefs] of [['normal', { compact: false, card: false, video: false }], ['card', { compact: false, card: true }], ['compact', { compact: true, card: false }]]) {
    test(`shape: ${shape}`, async () => {
      await page.evaluate((p) => window.rumoria.mini.setPrefs({ showCover: true, lyrics: true, opacity: 1, ...p }), prefs);
      await page.evaluate((s) => window.rumoria.mini.state(s), SONG);
      await mini.waitForTimeout(600);
      await expect(mini).toHaveScreenshot(`mini-${shape}.png`);
    });
  }
});
