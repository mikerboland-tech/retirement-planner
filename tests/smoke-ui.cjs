// Browser smoke test — the app, as a reader meets it, in headless Chromium.
//
//   node tests/smoke-ui.cjs            (or: npm run smoke)
//   node tests/smoke-ui.cjs --strict   fail, rather than skip, without Playwright
//
// run-tests.cjs proves the engine and reads the source; it never renders a
// page. This loads the BUILT pages (run tools/build.cjs first), clears the
// browser's storage so the app starts on its own built-in sample plan — never
// a real one — and walks it: every tab under every withdrawal strategy, across
// the looks, plus the handful of interactions that have broken before (a hidden
// panel coming back, the timeline playing, Sensitivity's figures, the strategy
// screens). Any page error or console error fails the run.
//
// Playwright is not a dependency of this repo. The script uses one already on
// the machine (`npm i -g playwright` and `npx playwright install chromium`),
// or skips with a message. PLAYWRIGHT_CHROMIUM points it at a Chromium binary.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.log('SKIPPED — Playwright is not installed. `npm i -g playwright && npx playwright install chromium`, then run again.');
  process.exit(STRICT ? 1 : 0);
}

// ── A static server for the repo, on a free port, local only ────────────────
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const serve = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    // Only what the pages load: no exported plans, nothing outside the repo.
    if (!file.startsWith(ROOT + path.sep) || /retirement-plan-.*\.json$|-data\.json$/.test(file)
        || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const launch = async () => {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM;
  if (explicit) return chromium.launch({ executablePath: explicit });
  try {
    return await chromium.launch();
  } catch (e) {
    // Cloud sessions ship a Chromium that a newer Playwright may not name.
    const fallback = '/opt/pw-browsers/chromium';
    if (fs.existsSync(fallback)) return chromium.launch({ executablePath: fallback });
    throw e;
  }
};

// ── Results ─────────────────────────────────────────────────────────────────
let pass = 0;
const failures = [];
const ok = (cond, label, detail) => {
  if (cond) { pass++; return; }
  failures.push(detail ? `${label} — ${detail}` : label);
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
};
const section = (name) => console.log(`\n${name}`);

const APP_VERSION = (/window\.APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')) || [])[1];

// A fresh visit: empty storage, the sample plan, the full planner showing.
const visit = async (browser, base, { look = 'dark', strategy = null, page: pageName = 'index.html', viewport } = {}) => {
  const context = await browser.newContext({ viewport: viewport || { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().split('\n')[0]); });
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(`${base}/${pageName}`);
  await page.evaluate((l) => {
    localStorage.clear();
    localStorage.setItem('retirement_planner_tour_seen', '1');
    localStorage.setItem('retirement_planner_theme', l);
  }, look);
  await page.reload();
  if (pageName === 'index.html') {
    await page.waitForSelector('main');
    const explore = await page.$('text=Explore with sample data');
    if (explore) await explore.click();
    await page.click('text=No thanks', { timeout: 1500 }).catch(() => {});
    await page.click('aside >> text=Show everything', { timeout: 1500 }).catch(() => {});
    if (strategy) {
      await page.click('aside >> text=Personal Info');
      await page.selectOption('select[aria-label="Withdrawal strategy"]', strategy);
      await page.waitForTimeout(300);
    }
  }
  return { page, errors, requests, close: () => context.close() };
};
const mainText = (page) => page.evaluate(() => (document.querySelector('main') || document.body).innerText || '');
// The sidebar's tabs carry data-tab; the buttons below them (Guided Setup,
// the tour, Reports…) open dialogs and are not tabs. A tab reads
// "<icon>\n<label>", so it is matched on the label alone.
const tabList = (page) => page.$$eval('aside nav [data-tab]', (bs) =>
  bs.map((b) => ({ id: b.dataset.tab, label: b.innerText.trim().split('\n').pop().trim() })));
const tab = async (page, label) => {
  const t = (await tabList(page)).find((x) => x.label === label || x.id === label);
  if (!t) throw new Error(`no "${label}" tab`);
  await page.click(`aside nav [data-tab="${t.id}"]`);
  await page.waitForTimeout(600);
  return t.id;
};

// One visit per check. A failed assertion or a thrown error is recorded, the
// page is closed and the run moves on, so one broken screen cannot hide the
// rest — and every check ends by asking whether the page logged an error.
const check = async (browser, base, name, opts, fn) => {
  let v;
  try {
    v = await visit(browser, base, opts);
    await fn(v);
    ok(v.errors.length === 0, `${name}: no page or console errors`, v.errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok(false, `${name}: ran to the end`, String((e && e.message) || e).split('\n')[0]);
  } finally {
    if (v) await v.close().catch(() => {});
  }
};

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  const t0 = Date.now();
  try {
    // ── 1. Every tab, under every strategy, across the looks ─────────────────
    section('Every tab renders, under every withdrawal strategy');
    const combos = [['target', 'dark'], ['guardrails', 'light'], ['constant', 'observatory'], ['percent', 'neon'],
      ['rmd', 'aurora'], ['vanguard', 'ember'], ['vpw', 'prism']];
    for (const [strategy, look] of combos) {
      await check(browser, base, `${strategy}/${look}`, { look, strategy }, async (v) => {
        const lookAttr = await v.page.evaluate(() => document.documentElement.getAttribute('data-look'));
        if (look !== 'dark' && look !== 'light') ok(lookAttr === look, `${look}: the look is applied`, `data-look=${lookAttr}`);
        const tabs = await tabList(v.page);
        ok(tabs.length >= 11, `${strategy}/${look}: the full planner lists its eleven tabs`, `${tabs.length} tabs`);
        for (const t of tabs) {
          await tab(v.page, t.id);
          const current = await v.page.evaluate(() => (document.querySelector('aside nav [data-tab][aria-current="page"]') || {}).dataset?.tab);
          const len = (await mainText(v.page)).length;
          ok(current === t.id && len > 50, `${strategy}/${look}: "${t.label}" opens and renders`, `current=${current}, ${len} characters`);
          // A tab that crashed takes the sidebar with it; stop here rather
          // than report every later tab as missing.
          if (current !== t.id) break;
        }
      });
    }

    // ── 2. The Dashboard's own interactions ──────────────────────────────────
    section('Dashboard: the version, the timeline, a hidden panel');
    await check(browser, base, 'Dashboard', {}, async (v) => {
      const side = await v.page.evaluate(() => document.querySelector('aside').innerText);
      ok(APP_VERSION && side.includes(`v${APP_VERSION}`), 'the sidebar shows the built version', APP_VERSION);
      await tab(v.page, 'Dashboard');
      const slider = v.page.locator('[role="slider"][aria-label="Year of the plan"]');
      ok(await slider.count() === 1, 'the year-by-year timeline is on the Dashboard');
      if (await slider.count() === 1) {
        const before = Number(await slider.getAttribute('aria-valuenow'));
        await v.page.click('[aria-label="Play the plan year by year"]');
        await v.page.waitForTimeout(1200);
        await v.page.click('[aria-label="Pause"]').catch(() => {});
        const after = Number(await slider.getAttribute('aria-valuenow'));
        ok(after > before, 'play steps through the years', `${before} → ${after}`);
      }
      const hides = v.page.locator('main button:text-is("Hide")');
      const panelsBefore = await hides.count();
      ok(panelsBefore > 0, 'Dashboard panels can be hidden');
      if (panelsBefore > 0) {
        await hides.first().click();
        await v.page.waitForTimeout(300);
        const again = v.page.locator('button:text-is("Show it again")');
        ok(await again.count() === 1, 'a hidden panel leaves a way back');
        if (await again.count() === 1) {
          await again.click();
          await v.page.waitForTimeout(300);
          ok(await hides.count() === panelsBefore, 'and "Show it again" brings it back', `${await hides.count()} of ${panelsBefore}`);
        }
      }
    });

    // ── 2b. The what-if card scrolls away; a slim strip stands in for it ────
    section('Dashboard: the what-if strip');
    await check(browser, base, 'What-if strip', {}, async (v) => {
      await tab(v.page, 'Dashboard');
      const card = '[data-tour="whatif-levers"]';
      await v.page.click(`${card} button[aria-expanded]`);   // open the card
      await v.page.waitForTimeout(300);
      ok(await v.page.locator('[data-whatif-strip]').count() === 0, 'while the card is on screen there is no strip');
      // Move a slider, so the page shows a what-if.
      const slider = v.page.locator(`${card} input[type="range"]`).first();
      await slider.focus();
      await v.page.keyboard.press('ArrowLeft');
      await v.page.waitForTimeout(400);
      // Scroll well past the card.
      await v.page.evaluate(() => {
        const m = document.querySelector('main');
        const el = (m && m.scrollHeight > m.clientHeight) ? m : document.scrollingElement;
        el.scrollTop = 2000;
      });
      await v.page.waitForTimeout(500);
      const cardTop = await v.page.$eval(card, (el) => el.getBoundingClientRect().bottom);
      ok(cardTop < 0, 'the card scrolls away with the page', `bottom at ${Math.round(cardTop)}px`);
      const strip = v.page.locator('[data-whatif-strip]');
      ok(await strip.count() === 1, 'and a strip takes its place');
      if (await strip.count() === 1) {
        const box = await strip.boundingBox();
        ok(box.height < 70 && box.y >= 0 && box.y < 40, 'pinned at the top, one line high', `${Math.round(box.height)}px at y=${Math.round(box.y)}`);
        ok(/retire at|I retire at/.test(await strip.innerText()), 'naming what has changed');
        await strip.locator('button:has-text("Sliders")').click();
        await v.page.waitForTimeout(250);
        ok(await strip.locator('input[type="range"]').count() >= 4, 'the sliders come down on demand');
        await strip.locator('button:has-text("Back to my plan")').click();
        await v.page.waitForTimeout(400);
        ok(/following your plan/.test(await strip.innerText()), 'and Back to my plan undoes the what-if', await strip.innerText());
      }
    });

    // ── 2c. Planning for the Social Security shortfall ─────────────────────
    section('About you: the Social Security shortfall');
    await check(browser, base, 'SS shortfall', {}, async (v) => {
      await tab(v.page, 'personal');
      ok(/Chance at least one of you is alive at \d+: \d+%/.test(await v.page.$eval('[data-longevity-odds]', (el) => el.innerText)),
        'the planning age shows the odds of reaching it');
      await v.page.selectOption('select[aria-label="Social Security shortfall"]', 'oasi');
      await v.page.waitForTimeout(400);
      ok(/Every Social Security payment in the plan/.test(await v.page.$eval('[data-ss-shortfall]', (el) => el.innerText)),
        'choosing the Trustees’ cut says what it does');
    });

    // ── 3. The look picker ───────────────────────────────────────────────────
    section('The look picker');
    await check(browser, base, 'Looks', {}, async (v) => {
      await v.page.click('aside >> text=Classic dark');
      await v.page.click('[role="radiogroup"][aria-label="Look"] >> role=radio[name=/Abyss/]');
      await v.page.waitForTimeout(300);
      ok(await v.page.evaluate(() => document.documentElement.getAttribute('data-look')) === 'abyss', 'choosing a look applies it');
      ok(await v.page.evaluate(() => localStorage.getItem('retirement_planner_theme')) === 'abyss', 'and remembers it in this browser');
    });

    // ── 4. Sensitivity, under a target and under a strategy ─────────────────
    section('Will it last? → What matters most');
    for (const strategy of ['target', 'percent']) {
      await check(browser, base, `Sensitivity (${strategy})`, { strategy }, async (v) => {
        await tab(v.page, 'Will it last?');
        await v.page.click('text=What matters most');
        await v.page.click('text=Run Sensitivity Analysis');
        await v.page.waitForSelector('text=Impact Ranking', { timeout: 60000 });
        await v.page.waitForTimeout(500);
        const text = await mainText(v.page);
        const ranges = [...text.matchAll(/Range: \$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
        // The sample couple's life expectancies end the plan before its legacy
        // age; reading a row at the legacy age put $0 in every range.
        ok(ranges.length > 3 && ranges.some((r) => r > 0), `${strategy}: the ranges are real figures`, ranges.slice(0, 4).join(', '));
        if (strategy === 'percent') {
          ok(text.includes('Withdrawal Rate') && !text.includes('Annual Spending Goal'),
            'percent: the spending lever is the withdrawal rate');
        } else {
          ok(text.includes('Annual Spending Goal'), 'target: the spending lever is the spending goal');
        }
      });
    }

    // ── 5. Every strategy, compared on the same markets ─────────────────────
    section('Will it last? → compare all seven strategies');
    await check(browser, base, 'Strategy comparison', {}, async (v) => {
      await tab(v.page, 'Will it last?');
      await v.page.click('text=Compare all seven');
      await v.page.waitForSelector('th:text-is("Money lasts")', { timeout: 120000 });
      const rows = await v.page.$$eval('table', (ts) => {
        const t = ts.find((x) => x.innerText.includes('Money lasts'));
        return t ? t.querySelectorAll('tbody tr').length : 0;
      });
      ok(rows === 7, 'one row per strategy', `${rows} rows`);
    });

    // ── 6. Reports ───────────────────────────────────────────────────────────
    section('Reports');
    for (const strategy of ['target', 'percent']) {
      await check(browser, base, `Reports (${strategy})`, { strategy }, async (v) => {
        for (const [button, title] of [['Plan Summary Report', 'Retirement Plan Summary'], ['What Breaks First', 'What Breaks First']]) {
          await v.page.click('aside >> text=Reports');
          await v.page.click(`button:has-text("${button}")`);
          await v.page.waitForSelector('#report-print', { timeout: 30000 });
          const text = await v.page.evaluate(() => document.getElementById('report-print').innerText);
          ok(text.includes(title), `${strategy}: ${button} opens`);
          if (button === 'What Breaks First') {
            ok(strategy === 'percent' ? text.includes('Spending has no row') : /\nSpending\t/.test(text),
              `${strategy}: the spending edge is ${strategy === 'percent' ? 'left out, with the reason' : 'measured'}`);
          } else if (strategy === 'percent') {
            ok(/Withdrawal Strategy/i.test(text) && text.includes('Fixed percentage'), 'percent: the summary names the strategy');
          }
          await v.page.click('#report-print >> button:text-is("Close")');
          await v.page.waitForTimeout(200);
        }
      });
    }

    // ── 7. The AI assistant sends nothing until it has a key ────────────────
    section('AI Assistant');
    await check(browser, base, 'AI Assistant', {}, async (v) => {
      await tab(v.page, 'AI Assistant');
      ok((await mainText(v.page)).includes('AI Assistant'), 'the tab renders its key setup');
      ok(!v.requests.some((u) => u.includes('anthropic.com')), 'and makes no request without a key');
    });

    // ── 8. The phone page ────────────────────────────────────────────────────
    section('mobile.html');
    await check(browser, base, 'mobile.html', { page: 'mobile.html', viewport: { width: 390, height: 844 } }, async (v) => {
      await v.page.waitForTimeout(1500);
      const len = (await v.page.evaluate(() => document.body.innerText)).length;
      ok(len > 200, 'the phone page renders', `${len} characters`);
      const wide = await v.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(wide <= 1, 'with no sideways scroll at phone width', `${wide}px over`);
      // Every strategy runs on the phone; the five that set spending say so.
      const ids = await v.page.$$eval('select[aria-label="Withdrawal strategy"] option', (os) => os.map((o) => o.value));
      ok(ids.join(',') === 'target,guardrails,constant,percent,rmd,vanguard,vpw', 'the phone offers all seven strategies', ids.join(','));
      for (const id of ids) {
        await v.page.selectOption('select[aria-label="Withdrawal strategy"]', id);
        await v.page.waitForTimeout(250);
        const text = await v.page.evaluate(() => document.body.innerText);
        const leads = ['constant', 'percent', 'rmd', 'vanguard', 'vpw'].includes(id);
        ok(leads ? /First-year spending/i.test(text) && /Not used while/.test(text) : /Sustainable spending/i.test(text),
          `phone, ${id}: the spending card ${leads ? 'shows the strategy’s first year' : 'is the 4% capacity'}`);
      }
      // Every input re-runs the plan. Switching to % of salary and moving its
      // slider once left the results on the old projection.
      const atRetirement = () => v.page.evaluate(() => {
        const card = [...document.querySelectorAll('section div')].find((d) => /^Portfolio at retirement/i.test(d.innerText.trim()));
        return card ? card.innerText : '';
      });
      const fixed = await atRetirement();
      await v.page.click('button:text-is("% of salary")');
      await v.page.waitForTimeout(250);
      const percent = await atRetirement();
      ok(percent !== fixed && percent !== '', 'phone: switching to % of salary re-runs the plan', `${fixed.split('\n')[1]} → ${percent.split('\n')[1]}`);
      await v.page.locator('input[type="range"]').nth(3).fill('20');
      await v.page.waitForTimeout(250);
      const raised = await atRetirement();
      ok(raised !== percent, 'phone: so does moving the contribution percent', `${percent.split('\n')[1]} → ${raised.split('\n')[1]}`);
      // A reload keeps the choice: it is saved with the other inputs.
      await v.page.selectOption('select[aria-label="Withdrawal strategy"]', 'vpw');
      await v.page.waitForTimeout(1200);
      await v.page.reload();
      await v.page.waitForTimeout(1200);
      ok(await v.page.$eval('select[aria-label="Withdrawal strategy"]', (el) => el.value) === 'vpw', 'phone: the strategy is remembered');
    });
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${'─'.repeat(60)}`);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (failures.length === 0) {
    console.log(`✓ ALL ${pass} BROWSER CHECKS PASSED (${secs}s)`);
    process.exit(0);
  }
  console.log(`✗ ${failures.length} FAILED, ${pass} passed (${secs}s)\n\nFailures:`);
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
