import { defineConfig, devices } from '@playwright/test'

const DEV_URL = 'http://localhost:5173'
const PREVIEW_URL = 'http://localhost:4173'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: DEV_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: DEV_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Build produksi + preview: service worker & manifest hanya ada di build
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      url: PREVIEW_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
