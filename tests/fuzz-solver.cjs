// Solver fuzz — thousands of random (synthetic) plans through the engine.
//
//   node tests/fuzz-solver.cjs          (or: npm run fuzz)
//   node tests/fuzz-solver.cjs 600      more plans (default 220 × 7 strategies)
//
// run-tests.cjs checks named cases. This throws a seeded spread of plans at
// computeProjections — single and married, ages 40–70, five states, with and
// without survivor modelling, a spouse still working past the other's
// retirement, mid-year retirements, Roth conversions, bracket-fill, charitable
// QCDs, care costs, the Social Security shortfall, and market shocks — under
// every withdrawal strategy, and flags any year that:
//   - throws, or produces a non-finite figure;
//   - leaves a balance below zero;
//   - misses its own spending by more than $25 (the solver's residual);
//   - draws less than a withdrawal-led strategy's rule with no salary to cover it.
// The same seed gives the same plans, so a failure reproduces.
'use strict';

const E = require('../engine.js');

const PLANS = Number(process.argv[2]) || 220;
let seed = 12345;
const r = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(r() * a.length)];

const issues = {};
const note = (k, ex) => { issues[k] = issues[k] || { n: 0, ex }; issues[k].n++; };
let runs = 0, rows = 0;

for (let t = 0; t < PLANS; t++) {
  const married = r() < 0.6;
  const myAge = 40 + Math.floor(r() * 30);
  const ret = Math.max(myAge, 50 + Math.floor(r() * 20));
  const pi = {
    ...E.DEFAULT_PLAN_INFO, myAge, spouseAge: myAge - Math.floor(r() * 8), myRetirementAge: ret, spouseRetirementAge: ret,
    myRetirementMonth: pick([1, 1, 4, 7, 10]),
    filingStatus: married ? 'married_joint' : 'single', state: pick(['Texas', 'California', 'New York', 'Colorado', 'Illinois']),
    desiredRetirementIncome: 30000 + Math.floor(r() * 150000), legacyAge: 88 + Math.floor(r() * 10), inflationRate: 0.02 + r() * 0.02,
    survivorModelEnabled: married && r() < 0.8, healthcareModel: pick(['none', 'default']), ltcModel: pick(['none', 'default', 'stress']),
    charitableGivingPercent: r() < 0.2 ? 5 : 0, rothConversionBracket: r() < 0.3 ? '22%' : '',
    withdrawalBracketFill: r() < 0.2 ? '12%' : '',
    ssShortfall: pick(['', '', '', 'oasi', 'combined']),
    strategyRatePct: pick([0.03, 0.04, 0.05]), guardrailFloorPct: r() < 0.3 ? 0.8 : 0,
  };
  const accts = [
    { id: 1, name: '401k', type: '401k', owner: 'me', balance: Math.floor(r() * 2e6), contribution: 20000, cagr: 0.04 + r() * 0.04, startAge: myAge, stopAge: ret, contributor: 'me' },
    { id: 2, name: 'Roth', type: 'roth_ira', owner: married && r() < 0.5 ? 'spouse' : 'me', balance: Math.floor(r() * 5e5), contribution: 6000, cagr: 0.06, startAge: myAge, stopAge: ret, contributor: 'me' },
    { id: 3, name: 'Brok', type: 'brokerage', owner: 'joint', balance: Math.floor(r() * 1e6), contribution: 0, cagr: 0.05, startAge: myAge, stopAge: myAge, contributor: 'me', costBasisPercent: 0.6 }];
  const streams = [
    { id: 1, type: 'earned_income', owner: 'me', name: 'Pay', amount: 60000 + Math.floor(r() * 150000), startAge: myAge, endAge: ret - 1, cola: 0.03 },
    { id: 2, type: 'social_security', owner: 'me', name: 'SS', amount: 20000 + Math.floor(r() * 25000), startAge: 62 + Math.floor(r() * 9), endAge: 120, cola: 0.025 }];
  if (married) {
    streams.push({ id: 4, type: 'earned_income', owner: 'spouse', name: 'Pay 2', amount: 30000 + Math.floor(r() * 120000), startAge: myAge - 5, endAge: ret + Math.floor(r() * 8), cola: 0.03 });
    streams.push({ id: 3, type: 'social_security', owner: 'spouse', name: 'SS 2', amount: 15000 + Math.floor(r() * 15000), startAge: 67, endAge: 120, cola: 0.025 });
  }
  const shocks = r() < 0.6
    ? new Array(80).fill(0).map(() => ({ marketReturn: -0.35 + r() * 0.65, inflation: r() * 0.07 }))
    : undefined;

  for (const st of E.WITHDRAWAL_STRATEGIES) {
    let proj;
    try {
      proj = E.computeProjections({ ...pi, withdrawalStrategy: st, spendingGuardrailsEnabled: st === 'guardrails' },
        accts, streams, [], [], [], 2026, shocks ? { yearOverrides: shocks } : {});
    } catch (e) { note(`throws (${st})`, e.message); continue; }
    runs++;
    proj.forEach(row => {
      rows++;
      ['desiredIncome', 'portfolioWithdrawal', 'totalPortfolio', 'totalTax', 'netIncome'].forEach(f => {
        if (!Number.isFinite(row[f])) note(`non-finite ${f} (${st})`, [myAge, row.myAge]);
      });
      ['preTaxBalance', 'rothBalance', 'brokerageBalance'].forEach(f => {
        if (row[f] < -1) note(`negative ${f} (${st})`, [row.myAge, row[f]]);
      });
      if (row.desiredIncome < 0) note(`negative spending (${st})`, row.myAge);
      if (Math.abs(row.solverResidual || 0) > 25) note(`solver residual > $25 (${st})`, [t, row.myAge, row.solverResidual]);
      if (row.strategyDraw > 0 && !(row.earnedIncome > 0) && row.portfolioWithdrawal + 1 < row.strategyDraw && row.totalPortfolio > 1000) {
        note(`draw below strategy (${st})`, [row.myAge, row.portfolioWithdrawal, row.strategyDraw]);
      }
    });
  }
}

const keys = Object.keys(issues);
console.log(`${runs} projections, ${rows} years`);
if (!keys.length) { console.log('✓ NO ISSUES'); process.exit(0); }
keys.sort().forEach(k => console.log(String(issues[k].n).padStart(6), k, JSON.stringify(issues[k].ex)));
process.exit(1);
