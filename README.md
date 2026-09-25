# Retirement Planner

A comprehensive, client-side retirement planning tool built with React. All calculations run in your browser — no data is sent to any server.

## Features

### Core Planning
- **Multi-account support** — 401(k), Traditional IRA, Roth IRA, Roth 401(k), 403(b), 457(b), HSA, Brokerage
- **Tax-aware withdrawal solver** — Iterative solver determines gross withdrawals needed for your net spending target
- **RMD calculations** — SECURE 2.0 compliant Required Minimum Distributions
- **Social Security optimization** — Claiming analysis across all ages 62-70 with breakeven, survivor benefits, and portfolio impact
- **Roth conversion modeling** — Fixed amount, fill-to-bracket, stay-under-an-IRMAA-tier or a staged schedule, set in one place (Taxes & Roth) beside what the strategy saves against converting nothing
- **Survivor modeling** — Models financial impact when a spouse passes (SS survivor benefits, filing status change)
- **What-if and scenarios** — The Dashboard's "What if…" card re-runs the whole plan as you move retirement age, spending, claiming, strategy or income streams; save any what-if as a scenario and compare them side by side

### Tax Engine
- Federal income tax (2026 brackets, inflation-adjusted)
- State income tax (50 states)
- FICA (Social Security + Medicare)
- Capital gains tax (long-term rates)
- Net Investment Income Tax (NIIT 3.8%)
- IRMAA Medicare surcharges
- Social Security earnings test
- Pre-tax contribution deductions (above-the-line)
- MAGI calculation with proper add-backs

### Analysis Tools
- **Will it last?** — Monte Carlo (1,000+ markets, sampled or replayed from history), a stress test of specific crashes at retirement, and a sensitivity ranking of which assumption matters most — all through the full engine
- **Tax Year Snapshot** — Bracket walk-through for any projected year
- **Taxes & Roth** — Your conversion strategy, the optimizer, marginal rates, IRMAA and the years with bracket room
- **Lifestyle vs Legacy** — Spending tradeoff analysis across 8 spending levels
- **Coast FIRE** — Portfolio sufficiency analysis
- **Cash Flow Sankey** — Visual money flow diagram

### Healthcare & Expenses (v20)
- **Healthcare expense modeling** — Pre-65, Medicare, Medigap, out-of-pocket, long-term care
- **Medical inflation** — Separate healthcare inflation rate (typically 5-7%)
- **Recurring expense categories** — Housing, transportation, travel, education, insurance, caregiving, debt payments
- **Per-item inflation rates** — Each expense gets its own inflation rate and active date range

### Data Management
- Auto-save to browser localStorage
- Import/Export as JSON
- No server, no accounts — 100% client-side

## How to Use

### Option 1: GitHub Pages (recommended)
Visit the live site: `https://YOUR-USERNAME.github.io/retirement-planner/`

### Option 2: Run Locally
1. Clone this repository
2. Serve the folder with any static file server — e.g. `python -m http.server 8000` or the VS Code "Live Server" extension
3. Open `http://localhost:8000`

Note: double-clicking `index.html` does **not** work — the app fetches its JSX and spawns a Web Worker, both of which browsers block on `file://` URLs.

All libraries (React, Recharts) are vendored in `vendor/` and load locally — no CDN dependency, works offline. The pages load the prebuilt app and stylesheet; Babel and Tailwind's in-browser compiler are vendored too, but only load when the source has been edited without rebuilding.

### Running the tests
```
node tests/run-tests.cjs
```
The suite exercises the shared calc engine (`engine.js`) — federal/state tax brackets, RMD, Social Security taxation, IRMAA, the early-withdrawal penalty, the age-65 deductions, Roth bracket-fill, and full projection integration tests.

### Building (after any change to the source)
```
npm install          # once — installs Tailwind 3.4.17, used only by the build
node tools/build.cjs
```
There is still no bundler. The build precompiles `retirement-planner.jsx` and
`retirement-planner-mobile.jsx` to `.compiled.js` files, builds `app.css` from the
classes they use, and stamps each page with the hash of the source it was built
from. On the live site the pages trust that stamp and load only the compiled app
and the stylesheet — about 2.6 MB for the desktop and 1 MB for the phone, where
it was about 7.7 MB and 4.4 MB when both compiled in the browser.

A stale build cannot reach the live site: the test suite fails if any stamp,
compiled file or `app.css` does not match its source. Served from `localhost`,
the pages also check the source itself, so an edit you have not rebuilt yet is
compiled in the browser rather than ignored — slower, never wrong. Commit the
`.compiled.js` files and `app.css` alongside the source.

## Architecture

**Unified calculation model:** All inputs feed into a single `computeProjections()` engine. All display components read from the engine's output. When you add a feature, it goes into the engine once and every view — dashboard, detailed table, Monte Carlo, scenarios, SS analysis — picks it up automatically.

```
Inputs (Personal Info, Accounts, Income, Assets, Expenses)
    ↓
computeProjections() — Single projection engine
    ↓
Year data array (income, taxes, balances, healthcare, expenses per year)
    ↓
Display components read from year data
```

## Tech Stack

- **React 18** — UI framework
- **Recharts** — Charts and visualizations
- **Tailwind CSS** — Styling, prebuilt to `app.css`
- **Babel** — JSX precompiled by `tools/build.cjs` (in-browser only as a fallback)
- No bundler, no server

## License

Source-available — all rights reserved. You're welcome to use the hosted app and run a local copy for personal, non-commercial planning, and the source is published so you can verify that everything runs locally in your browser with no data sent anywhere. Copying, redistributing, or reusing the code in other projects requires written permission. See [LICENSE](LICENSE) for full terms.

## Disclaimer

This tool is for educational and informational purposes only. It is not financial, tax, or legal advice. Consult a qualified professional before making financial decisions.
