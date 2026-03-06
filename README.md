# Retirement Planner

A comprehensive, client-side retirement planning tool built with React. All calculations run in your browser — no data is sent to any server.

## Features

### Core Planning
- **Multi-account support** — 401(k), Traditional IRA, Roth IRA, Roth 401(k), 403(b), 457(b), HSA, Brokerage
- **Tax-aware withdrawal solver** — Iterative solver determines gross withdrawals needed for your net spending target
- **RMD calculations** — SECURE 2.0 compliant Required Minimum Distributions
- **Social Security optimization** — Claiming analysis across all ages 62-70 with breakeven, survivor benefits, and portfolio impact
- **Roth conversion modeling** — Fill-to-bracket or fixed-amount conversions with tax impact analysis
- **Survivor modeling** — Models financial impact when a spouse passes (SS survivor benefits, filing status change)
- **Scenario comparison** — Save and compare multiple planning scenarios side by side

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
- **Monte Carlo simulation** — 1,000+ scenario stochastic modeling with tax-aware withdrawals
- **Tax Year Snapshot** — Bracket walk-through for any projected year
- **Tax Planning** — Marginal rate analysis and Roth conversion simulator
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
2. Open `index.html` in any modern browser
3. That's it — no build step, no npm, no server needed

The app loads React, Tailwind, and Recharts from CDN, then Babel transforms the JSX in-browser.

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
- **Tailwind CSS** — Styling
- **Babel** — In-browser JSX transformation
- No build tools, no bundler, no server

## License

MIT — Free to use, modify, and share.

## Disclaimer

This tool is for educational and informational purposes only. It is not financial, tax, or legal advice. Consult a qualified professional before making financial decisions.
