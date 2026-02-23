#!/usr/bin/env node
import { chromium } from 'playwright';

async function main() {
  const url = process.argv[2] || 'http://localhost:5173';
  const selectors = process.argv.slice(3);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    console.log(`Navigating to ${url}`);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(`HTTP ${resp ? resp.status() : 'no response'}`);

    await page.waitForTimeout(500); // give hydrated apps a moment

    if (selectors.length === 0) {
      const body = await page.locator('body').innerHTML();
      console.log('--- BODY HTML START ---');
      console.log(body);
      console.log('--- BODY HTML END ---');
    } else {
      for (const sel of selectors) {
        const count = await page.locator(sel).count();
        console.log(`Selector "${sel}" matched ${count} node(s).`);
        for (let i = 0; i < Math.min(count, 5); i++) {
          const outer = await page.locator(sel).nth(i).evaluate((el) => el.outerHTML);
          console.log(`--- ${sel} [${i}] START ---`);
          console.log(outer);
          console.log(`--- ${sel} [${i}] END ---`);
        }
      }
    }
  } catch (err) {
    console.error('Error during DOM check:', err);
    process.exitCode = 2;
  } finally {
    await browser.close();
  }
}

main();

