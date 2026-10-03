import { defineConfig } from '@playwright/test';

const PORT = 4173;

// OnePlus 13R: 1264x2780 panel. Chrome reports a ~412px-wide CSS viewport; the
// height below is the visible area with Chrome's address bar and Android's nav bar.
const onePlus13R = {
  userAgent:
    'Mozilla/5.0 (Linux; Android 15; CPH2645) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  viewport: { width: 412, height: 820 },
  screen: { width: 412, height: 906 },
  deviceScaleFactor: 1264 / 412,
  isMobile: true,
  hasTouch: true,
  defaultBrowserType: 'chromium',
};

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/artifacts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'oneplus-13r', use: onePlus13R }],
  webServer: {
    command: `node tests/serve.js`,
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
  },
});
