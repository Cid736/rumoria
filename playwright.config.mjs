// End-to-end tests: the real desktop app (Electron) driven by Playwright, with
// screenshots compared against the ones saved in test/e2e/__screenshots__ —
// so a change that breaks the window's look (the Windows or Mac style, the
// mini player's shapes) shows up before it ships. `npm run test:e2e` builds
// the page first; `npm run test:e2e:update` saves new screenshots after a
// change that's meant to look different. Screenshots depend on the system's
// fonts and scaling: they're made and checked on Windows at 100 %.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.mjs',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' } },
});
