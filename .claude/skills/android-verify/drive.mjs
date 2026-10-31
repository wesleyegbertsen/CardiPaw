// Usage: node drive.mjs <step.mjs>
// Copy this file next to a scratch install of playwright-core (not into the repo).
// Needs: adb forward tcp:9222 localabstract:webview_devtools_remote_<app pid>
// Runs the step's default export, async (page) => result, and prints the result as JSON.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const stepFile = process.argv[2];
if (!stepFile) throw new Error('Usage: node drive.mjs <step.mjs>');

const browser = await chromium.connectOverCDP('http://localhost:9222');
try {
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page = pages.find((p) => /^https?:\/\/localhost/.test(p.url()));
  if (!page)
    throw new Error(
      `No CardiPaw page found. Pages: ${pages.map((p) => p.url()).join(', ') || '(none)'}`,
    );
  const step = await import(pathToFileURL(path.resolve(stepFile)).href);
  console.log(JSON.stringify(await step.default(page), null, 2));
} finally {
  // Disconnects only; the app's page stays open.
  await browser.close();
}
