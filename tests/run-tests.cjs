// Tests for the four targeted fixes (B2, B3, B5, B6) plus regression smoke tests.
// Run: node tests/run-tests.cjs
//
// Each test calls computeProjections with a tweaked scenario, then asserts on
// specific projection-row fields. Asserts fail-fast and the runner exits non-zero
// on any failure.

// Shared engine — same module the desktop + mobile JSX files load via <script src>.
const engine = require('../engine.js');
console.log('Engine under test: ../engine.js (shared)');
const { computeProjections, calculateFederalTax, calculateStateTax, calculateSocialSecurityTaxableAmount,
        calculateCapitalGainsTax, calculateNIIT, calculateRMD, calculateIRMAA,
        getHistoricalSequence, HISTORICAL_RETURNS } = engine;
const IS_MOBILE = false; // single shared engine — no desktop/mobile split

const TODAY_YEAR = new Date().getFullYear();

let pass = 0, fail = 0;
const failures = [];

function eq(actual, expected, label, tol = 0) {
  const ok = tol > 0 ? Math.abs(actual - expected) <= tol : actual === expected;
  if (ok) { pass++; }
  else {
    fail++;
    failures.push(`  ✗ ${label}\n      expected ${JSON.stringify(expected)}${tol > 0 ? ` (±${tol})` : ''}\n      actual   ${JSON.stringify(actual)}`);
  }
}
function gt(actual, threshold, label) {
  if (actual > threshold) { pass++; }
  else { fail++; failures.push(`  ✗ ${label}\n      expected > ${threshold}\n      actual   ${actual}`); }
}
function lt(actual, threshold, label) {
  if (actual < threshold) { pass++; }
  else { fail++; failures.push(`  ✗ ${label}\n      expected < ${threshold}\n      actual   ${actual}`); }
}
function approx(actual, expected, label, relTol = 0.01) {
  const ok = Math.abs(actual - expected) / Math.max(1, Math.abs(expected)) <= relTol;
  if (ok) { pass++; }
  else { fail++; failures.push(`  ✗ ${label}\n      expected ≈${expected} (±${relTol * 100}%)\n      actual   ${actual}`); }
}

function section(name) { console.log('\n' + name); }

// ── Scenario factory ─────────────────────────────────────────────────────────
function baseScenario(overrides = {}) {
  const pi = {
    myAge: 60,
    spouseAge: 60,
    myRetirementAge: 60,
    spouseRetirementAge: 60,
    myBirthYear: TODAY_YEAR - 60,
    spouseBirthYear: TODAY_YEAR - 60,
    filingStatus: 'married_joint',
    state: 'Florida',           // no state income tax — keeps assertions cleaner
    desiredRetirementIncome: 60000,
    inflationRate: 0.03,
    withdrawalPriority: ['pretax', 'brokerage', 'roth'],
    charitableGivingPercent: 0,
    rothConversionAmount: 0,
    rothConversionStartAge: 0,
    rothConversionEndAge: 0,
    rothConversionBracket: '',
    rothConversionTaxSource: 'withdrawal',
    legacyAge: 95,
    survivorModelEnabled: false,
    myLifeExpectancy: 95,
    spouseLifeExpectancy: 95,
    healthcareModel: 'none',
    pre65HealthcareAnnual: 0,
    post65OOPAnnual: 0,
    includeMedigap: false,
    ltcModel: 'none',
    ltcMonthlyAmount: 0,
    ltcDurationMonths: 0,
    medicalInflation: 0.05,
    ...overrides,
  };
  const accts = [
    { id: 1, name: '401k', type: '401k', balance: 1000000, contribution: 0, contributionGrowth: 0, cagr: 0.06, startAge: 60, stopAge: 60, owner: 'me', contributor: 'me' },
    { id: 2, name: 'Roth', type: 'roth_ira', balance: 200000, contribution: 0, contributionGrowth: 0, cagr: 0.06, startAge: 60, stopAge: 60, owner: 'me', contributor: 'me' },
    { id: 3, name: 'Brokerage', type: 'brokerage', balance: 500000, contribution: 0, contributionGrowth: 0, cagr: 0.05, startAge: 60, stopAge: 60, owner: 'joint', contributor: 'me', costBasisPercent: 0.30 },
  ];
  const streams = [
    { id: 1, name: 'My SS', type: 'social_security', amount: 30000, startAge: 67, endAge: 95, cola: 0.02, owner: 'me' },
    { id: 2, name: 'Spouse SS', type: 'social_security', amount: 24000, startAge: 67, endAge: 95, cola: 0.02, owner: 'spouse' },
    { id: 3, name: 'My Pension', type: 'pension', amount: 20000, startAge: 60, endAge: 95, cola: 0.02, owner: 'me' },
  ];
  return { pi, accts, streams, assets: [], events: [], recurring: [] };
}

function run(scenario, planningAge) {
  const { pi, accts, streams, assets, events, recurring } = scenario;
  return computeProjections(pi, accts, streams, assets, events, recurring, TODAY_YEAR);
}

// ── B2: death year skips the deceased's income ───────────────────────────────
section('B2 — survivor death timing (myAge >= lifeExpectancy)');
{
  // Spouse dies at age 70. Survivor modeling on.
  const s = baseScenario({
    survivorModelEnabled: true,
    spouseLifeExpectancy: 70,
    myLifeExpectancy: 95,
  });
  const proj = run(s, 95);
  // Find year when spouseAge === 70 → that should be the death year
  const deathYear = proj.find(r => r.spouseAge === 70);
  eq(deathYear.survivorEvent, 'spouse_died', 'survivorEvent fires at age 70 (was 71 pre-fix)');
  // Spouse's pension+SS at age 70: there's no spouse pension/SS configured pre-67, so let's
  // pick a death-at-68 scenario to verify SS gets cut.
}
{
  // Spouse dies at 68 — they're already claiming SS at 67. Pre-fix: SS still paid year-of-death.
  const s = baseScenario({
    survivorModelEnabled: true,
    spouseLifeExpectancy: 68,
    myLifeExpectancy: 95,
  });
  const proj = run(s, 95);
  const deathYear = proj.find(r => r.spouseAge === 68);
  const yearBefore = proj.find(r => r.spouseAge === 67);
  eq(deathYear.survivorEvent, 'spouse_died', 'death event fires in year spouse turns 68');
  // SS at age 68 should reflect ONLY my SS + survivor uplift, not both spouses' SS combined.
  // Pre-fix this row had both my+spouse SS plus uplift. Post-fix the spouse stream is skipped
  // and only the survivor uplift (if any) is added on top of my SS.
  // My SS = 30000 (claim age 67, +1yr COLA at 2%), spouse SS = 24000 (claim age 67, +1yr COLA at 2%).
  // Pre-fix expected SS ≈ 30600 + 24480 = ~55080 (both claimed)
  // Post-fix expected SS = 30600 (my own; my own > spouse's, so no uplift)
  approx(deathYear.socialSecurity, 30600, 'death year SS reflects survivor only (no double-counting)', 0.02);
  approx(yearBefore.socialSecurity, 30600 + 24480, 'year before death has both spouses claiming', 0.02);
}

// ── B3: filing status — year of death MFJ, year+1 Single ─────────────────────
section('B3 — filing status switch after first death');
{
  const s = baseScenario({
    survivorModelEnabled: true,
    spouseLifeExpectancy: 70,
    myLifeExpectancy: 95,
  });
  const proj = run(s, 95);
  const yod = proj.find(r => r.spouseAge === 70);
  const yodPlus1 = proj.find(r => r.spouseAge === 71);
  const yodPlus2 = proj.find(r => r.spouseAge === 72);
  eq(yod.filingStatus, 'married_joint', 'year of death uses MFJ (joint final return)');
  eq(yodPlus1.filingStatus, 'single', 'year+1 switches to Single (was MFJ pre-fix)');
  eq(yodPlus2.filingStatus, 'single', 'year+2 stays Single (was MFJ pre-fix)');
}

// ── B5: withdrawal-source conversion tax actually drawn from portfolio ────────
section('B5 — Roth conversion tax (withdrawal source) is funded');
{
  // No conversion — baseline
  const s0 = baseScenario({ myRetirementAge: 65, myAge: 65, spouseAge: 65,
    myBirthYear: TODAY_YEAR - 65, spouseBirthYear: TODAY_YEAR - 65 });
  // Big conversion: $100k/yr starting at 65, withdrawal-source
  const sConv = baseScenario({
    myRetirementAge: 65, myAge: 65, spouseAge: 65,
    myBirthYear: TODAY_YEAR - 65, spouseBirthYear: TODAY_YEAR - 65,
    rothConversionAmount: 100000,
    rothConversionStartAge: 65,
    rothConversionEndAge: 65,
    rothConversionTaxSource: 'withdrawal',
  });
  const proj0 = run(s0, 70);
  const projC = run(sConv, 70);
  const y0 = proj0.find(r => r.myAge === 65);
  const yC = projC.find(r => r.myAge === 65);

  // The conversion adds 100k of ordinary income → fed tax goes up.
  gt(yC.federalTax - y0.federalTax, 10000,
    'conversion adds substantial federal tax (>$10k incremental on $100k @22%+)');
  gt(yC.rothConversion, 99000, 'rothConversion row field reflects ~100k conversion');

  // Post-fix: pre-tax balance at end of year is LOWER than without the fix, because
  // we now pull additional pre-tax to cover the conversion tax. Verify the pre-tax
  // balance drop is at LEAST the conversion amount + a chunk of conversion tax.
  // Pre-tax drop (s0 → sConv) should be conversion ($100k) + meaningful tax draw.
  const preTaxDrop = y0.preTaxBalance - yC.preTaxBalance;
  // Allow for half-year growth on the pulled cash; expect drop > 100k + ~10k tax draw
  gt(preTaxDrop, 108000, 'pre-tax balance drops by >$108k (conversion + tax cash pulled)');

  // Brokerage balance should match the baseline (we pulled tax from pre-tax first per priority)
  approx(yC.brokerageBalance, y0.brokerageBalance,
    'brokerage balance unchanged when tax comes from pre-tax priority', 0.01);

  // Roth balance should be HIGHER by ~conversion amount (after half-year growth)
  gt(yC.rothBalance - y0.rothBalance, 95000, 'roth balance up by ~conversion amount');
}

// ── B6: brokerage-source conversion realizes capital gains ───────────────────
section('B6 — Roth conversion tax (brokerage source) realizes capital gains');
{
  const s0 = baseScenario({ myRetirementAge: 65, myAge: 65, spouseAge: 65,
    myBirthYear: TODAY_YEAR - 65, spouseBirthYear: TODAY_YEAR - 65 });
  const sConv = baseScenario({
    myRetirementAge: 65, myAge: 65, spouseAge: 65,
    myBirthYear: TODAY_YEAR - 65, spouseBirthYear: TODAY_YEAR - 65,
    rothConversionAmount: 100000,
    rothConversionStartAge: 65,
    rothConversionEndAge: 65,
    rothConversionTaxSource: 'brokerage',
    // Make brokerage the only place to draw from for tax:
    withdrawalPriority: ['pretax', 'brokerage', 'roth'],
  });
  const proj0 = run(s0, 70);
  const projC = run(sConv, 70);
  const y0 = proj0.find(r => r.myAge === 65);
  const yC = projC.find(r => r.myAge === 65);

  // Brokerage balance should be lower in conversion scenario (tax pulled from brokerage)
  lt(yC.brokerageBalance, y0.brokerageBalance,
    'brokerage drops when conversion tax pulled from it');

  // Capital gains: brokerage cost basis = 30%, so 70% of any brokerage withdrawal is gain.
  // Pre-fix: the tax payment from brokerage booked $0 capital gains (B6 bug).
  // Post-fix: a brokerage withdrawal of ~$25k–30k for tax should yield ~$17k–21k cap gains.
  // We can't read cap gains directly from the row, but we CAN see that federalTax
  // includes a LTCG component that didn't exist pre-fix. Compare against an equivalent
  // scenario where conversion is OFF (no tax to pay from brokerage):
  // The DIFF between yC.federalTax and y0.federalTax should INCLUDE both the conversion
  // ordinary tax AND the cap gains tax on the brokerage sale used to fund that tax.
  const fedDiff = yC.federalTax - y0.federalTax;
  // Ordinary tax on $100k conv ≈ $14k–18k at 22%. Add cap gains ~15% on ~$20k gain = ~$3k.
  // With B6 fix: total should be ~$17k–22k. Pre-fix (no cap gains booked): ~$14k–18k.
  gt(fedDiff, 16000, 'fed tax includes both conversion ordinary tax AND cap gains tax on brokerage sale');

  // Also: with NIIT threshold at $250k MFJ, the $100k conversion + $20k cap gains
  // pushes MAGI above threshold → NIIT should also kick in. magi field is exposed.
  gt(yC.magi, 100000, 'MAGI > $100k after conversion');
}

// ── Regression smoke tests: baseline projection is sane ──────────────────────
section('Regression — baseline projection sanity');
{
  const s = baseScenario({ myAge: 65, spouseAge: 65, myRetirementAge: 65,
    myBirthYear: TODAY_YEAR - 65, spouseBirthYear: TODAY_YEAR - 65 });
  const proj = run(s, 75);
  gt(proj.length, 9, 'projection covers age 65–75 (>=10 rows)');
  const y65 = proj[0];
  eq(y65.myAge, 65, 'first row is age 65');
  // Pension stream starts at 60, so at 65 it's had 5y of 2% COLA: 20000 * 1.02^5 ≈ 22082.
  approx(y65.pension, 22082, 'pension at 65 reflects 5y COLA from start age 60');
  eq(y65.socialSecurity, 0, 'SS not yet claimed at 65 (starts at 67)');
  // At 67 SS kicks in
  const y67 = proj.find(r => r.myAge === 67);
  gt(y67.socialSecurity, 50000, 'SS at 67 includes both spouses (>$50k)');

  // Federal tax should be positive in retirement
  gt(y65.federalTax, 0, 'federal tax is positive in retirement');
  // FL has no state tax
  eq(y65.stateTax, 0, 'FL state tax is zero');
}

// ── Unit-level tests on tax helpers (no engine) ──────────────────────────────
section('Unit — calculateFederalTax');
{
  // MFJ $100k 2026: std deduction $32,200 → taxable $67,800.
  // Brackets: 10% to $24,800 ($2,480) + 12% × ($67,800 - $24,800) ($5,160) = $7,640
  approx(calculateFederalTax(100000, 'married_joint', 0, 0.03), 7640, 'MFJ $100k → $7,640 fed tax');
  // Single $50k 2026: std deduction $16,100 → taxable $33,900.
  // Brackets: 10% to $12,400 ($1,240) + 12% × ($33,900 - $12,400) ($2,580) = $3,820
  approx(calculateFederalTax(50000, 'single', 0, 0.03), 3820, 'Single $50k → $3,820 fed tax');
}

section('Unit — calculateSocialSecurityTaxableAmount');
{
  // MFJ: SS $40k, other income $20k. Combined = 20k + 20k = 40k → below $32k? No, above.
  // Actually combined = otherIncome + 0.5*SS = 20k + 20k = 40k. Thresholds: 32k, 44k MFJ.
  // First tier: min(0.5*SS, 0.5*(combined - 32k)) = min(20k, 4k) = 4k → 4k taxable
  approx(calculateSocialSecurityTaxableAmount(40000, 20000, 'married_joint'), 4000,
    '$40k SS + $20k other (MFJ) → ~$4k taxable SS');
  // High income: SS $40k, other $100k. Combined = 120k. Above 44k.
  // Upper tier: min(0.85*40 = 34k, 0.85*(120 - 44) + min(0.5*40, 6k)) = min(34k, 64.6k + 6k) = 34k
  approx(calculateSocialSecurityTaxableAmount(40000, 100000, 'married_joint'), 34000,
    '$40k SS + $100k other (MFJ) → 85% taxable ($34k)');
}

section('Unit — calculateRMD');
{
  // Age 75, balance $500k. SECURE 2.0: born 1950 → RMD age 73, factor at 75 = 24.6
  // 500000 / 24.6 = $20,325
  approx(calculateRMD(500000, 75, 1950), 20325, 'age 75, $500k → ~$20,325 RMD');
  // Pre-RMD age returns 0
  eq(calculateRMD(500000, 70, 1950), 0, 'age 70 < RMD start age 73 → no RMD');
}

// ── Long-horizon integration: 30 years with active conversions ───────────────
section('Integration — 30-year run with conversions does not crash or go negative');
{
  const s = baseScenario({
    myAge: 65, spouseAge: 65, myRetirementAge: 65,
    myBirthYear: TODAY_YEAR - 65, spouseBirthYear: TODAY_YEAR - 65,
    legacyAge: 95,
    survivorModelEnabled: true,
    spouseLifeExpectancy: 88,
    myLifeExpectancy: 92,
    rothConversionAmount: 30000,
    rothConversionStartAge: 65,
    rothConversionEndAge: 72,
    rothConversionTaxSource: 'withdrawal',
    state: 'Alabama',  // exercise the progressive engine path
  });
  const proj = run(s, 95);
  // B7: with survivorModelEnabled and primary dying at 92, projection truncates at age 92.
  // 65→92 inclusive = 28 rows (was 31 pre-B7 fix).
  eq(proj.length, 28, 'projection truncates when both die (B7) — 28 rows for 65→92');
  // Every year should have a defined federalTax and totalPortfolio
  for (const row of proj) {
    if (typeof row.federalTax !== 'number' || isNaN(row.federalTax)) {
      fail++; failures.push(`  ✗ NaN federalTax at age ${row.myAge}`); break;
    }
    if (typeof row.totalPortfolio !== 'number' || isNaN(row.totalPortfolio)) {
      fail++; failures.push(`  ✗ NaN totalPortfolio at age ${row.myAge}`); break;
    }
    if (row.preTaxBalance < 0 || row.rothBalance < 0 || row.brokerageBalance < 0) {
      fail++; failures.push(`  ✗ Negative balance at age ${row.myAge}: pre=${row.preTaxBalance} roth=${row.rothBalance} brok=${row.brokerageBalance}`); break;
    }
  }
  pass++; // if we got here, the loop assertions held
  // Spouse death at 88 should trigger survivor event somewhere
  const spouseDeath = proj.find(r => r.survivorEvent === 'spouse_died');
  if (spouseDeath) { pass++; } else { fail++; failures.push('  ✗ no spouse_died event in 30-year run'); }
  // Conversion years should show roth balance growing meaningfully
  const y65 = proj.find(r => r.myAge === 65);
  const y73 = proj.find(r => r.myAge === 73);
  gt(y73.rothBalance, y65.rothBalance, 'roth balance grew across conversion window (65→73)');
}

// ── B1: tax-exempt interest enters SS combined-income formula ────────────────
section('B1 — tax-exempt interest in SS MAGI (IRS Pub 915)');
{
  // Without tax-exempt interest: SS $40k + $20k other → combined $40k → first tier → $4k taxable
  const withoutMuni = calculateSocialSecurityTaxableAmount(40000, 20000, 'married_joint');
  // With $15k tax-exempt interest: combined = 20k + 20k + 15k = 55k → upper tier
  // Upper: min(0.85*40k, (44k-32k)*0.5 + 0.85*(55k-44k)) = min(34k, 6k + 9.35k) = 15.35k
  const withMuni = calculateSocialSecurityTaxableAmount(40000, 20000, 'married_joint', 15000);
  approx(withoutMuni, 4000, 'no muni interest → $4k taxable SS (baseline)');
  approx(withMuni, 15350, 'with $15k muni interest, taxable SS jumps to $15,350 (B1 fix)');
  gt(withMuni - withoutMuni, 10000, 'muni interest materially increases taxable SS');
}

// ── B7: projection terminates after both spouses die ─────────────────────────
section('B7 — both_died terminates the projection loop');
{
  const s = baseScenario({
    survivorModelEnabled: true,
    myLifeExpectancy: 70,
    spouseLifeExpectancy: 72,
    legacyAge: 95,  // planning runs through 95
  });
  const proj = run(s, 95);
  // Pre-fix: 36 rows (age 60 → 95). Post-fix: should stop in the year both are dead.
  // Spouse dies at 72 (the later death); both dead in/after age-72 row for primary,
  // which is age 72 for both since they share birth year.
  lt(proj.length, 36, 'projection truncated after both spouses die (was 36 pre-fix)');
  const last = proj[proj.length - 1];
  eq(last.primaryAlive, false, 'last row: primary is dead');
  eq(last.spouseAlive, false, 'last row: spouse is dead');
  // The first 'both_died' (or final death) row should be the terminal row
  const bothDeadIdx = proj.findIndex(r => !r.primaryAlive && !r.spouseAlive);
  eq(bothDeadIdx, proj.length - 1, 'first both-dead row is the terminal row');
}

// ── B8: brokerage selection picks the LARGEST account, not the first ─────────
section('B8 — brokerage deposit targets largest account');
{
  const { pi, accts, streams } = baseScenario({
    myAge: 65, spouseAge: 65, myRetirementAge: 65,
    myBirthYear: TODAY_YEAR - 65, spouseBirthYear: TODAY_YEAR - 65,
  });
  // Replace the single brokerage with two: small first, large second.
  const smallId = 10, largeId = 11;
  const acctsTwoBrok = [
    accts[0],  // 401k
    accts[1],  // Roth
    { id: smallId, name: 'Small Brokerage', type: 'brokerage', balance: 50000, contribution: 0, contributionGrowth: 0, cagr: 0.05, startAge: 65, stopAge: 65, owner: 'joint', contributor: 'me', costBasisPercent: 0.30 },
    { id: largeId, name: 'Large Brokerage', type: 'brokerage', balance: 500000, contribution: 0, contributionGrowth: 0, cagr: 0.05, startAge: 65, stopAge: 65, owner: 'joint', contributor: 'me', costBasisPercent: 0.30 },
  ];
  // Inject a one-time non-taxable income event at age 65 (inheritance-style).
  const events = [
    { name: 'Inheritance', type: 'nontaxable_income', amount: 200000, age: 65, owner: 'me', inflationAdjusted: false },
  ];
  const proj = computeProjections(pi, acctsTwoBrok, streams, [], events, [], TODAY_YEAR);
  const y65 = proj.find(r => r.myAge === 65);
  const smallEnd = y65.perAccountBalances[smallId];
  const largeEnd = y65.perAccountBalances[largeId];
  // Pre-fix: $200k goes to the FIRST brokerage in the array (small). Post-fix: largest gets it.
  // Small starts at $50k → grows to ~$52.5k (5% cagr). Post-fix should stay ~that level.
  // Large starts at $500k → grows + $200k deposit → ~$735k post-fix.
  lt(smallEnd, 100000, 'small brokerage stays small (deposit did NOT go here)');
  gt(largeEnd, 700000, 'large brokerage absorbed the $200k deposit (B8 fix)');
}

// ── B4: SS 85% upper-tier tier1 contribution capped at 0.5*SS ────────────────
section('B4 — SS upper-tier tier1 capped at 0.5*SS (IRS Pub 915 Worksheet 1)');
{
  // SS=$8,000, other=$40,800, MFJ. combined = 40,800 + 4,000 = 44,800. Just above 44k.
  // IRS correct: tier1 = min(0.5*8000, (44k-32k)*0.5) = min(4000, 6000) = $4,000
  //              tier2 = 0.85 * (44,800 - 44,000) = $680
  //              sum   = $4,680. Outer cap = 0.85*8000 = $6,800. min = $4,680.
  // Pre-fix:    tier1 = $6,000 (unconditional); tier2 = $680; sum = $6,680. Returned $6,680.
  approx(calculateSocialSecurityTaxableAmount(8000, 40800, 'married_joint'), 4680,
    'low-SS / just-above-upper-threshold caps tier1 at 0.5*SS (was $6,680 pre-fix)');

  // Sanity: at high SS, tier1 cap doesn't bind and the formula matches.
  // SS=$40k, other=$100k, MFJ. tier1 = min(20k, 6k) = $6k. tier2 = 0.85*(120-44) = $64.6k.
  // sum = $70.6k. Outer cap = $34k. min = $34k. (unchanged from pre-fix)
  approx(calculateSocialSecurityTaxableAmount(40000, 100000, 'married_joint'), 34000,
    'high-SS upper-tier unchanged by B4 fix (outer cap binds)');
}

// ── B9: state retirement-income exemption granularity ────────────────────────
section('B9 — IL/MS/PA exempt qualified withdrawals, not just pension');
{
  // Pennsylvania: 3.07% flat, exempts ALL qualified retirement plan distributions.
  // Pre-fix: only `retirementIncome` (= pension) was exempt → 401k/IRA withdrawals taxed.
  // Post-fix: pass qualifiedRetirementWithdrawals via extraParams; PA exempts both.
  //
  // Scenario: $100k gross taxable income, $20k of it is pension, $50k of it is pre-tax
  // 401k/IRA withdrawals, $0 SS. MFJ.
  //
  // Pre-fix: stateGross = 100k - 0 (SS) - 20k (pension) = $80k. PA flat 3.07% applies after
  //          a $32.2k std deduction → ~$1,468 state tax.
  // Post-fix: also subtract $50k qualified withdrawals → stateGross = $30k. After std deduction
  //           $0 taxable, $0 tax.
  const paWithFix = calculateStateTax(
    100000, 'Pennsylvania', 'married_joint', 0, 0.03,
    0,      // taxable SS
    20000,  // pension
    { qualifiedRetirementWithdrawals: 50000 }
  );
  approx(paWithFix, 0, 'PA with $50k qualified withdrawals + $20k pension → $0 state tax (B9)', 0.05);

  // Mississippi: same rule. 4.7% flat (or 5% — varies by year/source) — should also be ~$0.
  const msWithFix = calculateStateTax(
    100000, 'Mississippi', 'married_joint', 0, 0.03,
    0, 20000,
    { qualifiedRetirementWithdrawals: 50000 }
  );
  approx(msWithFix, 0, 'MS with $50k qualified withdrawals + $20k pension → $0 state tax (B9)', 0.05);

  // Sanity: states NOT in the broad-exemption set still ignore the new param.
  // California has no special retirement-income exemption — should be unchanged.
  const caBaseline = calculateStateTax(100000, 'California', 'married_joint', 0, 0.03, 0, 20000);
  const caWithParam = calculateStateTax(
    100000, 'California', 'married_joint', 0, 0.03,
    0, 20000,
    { qualifiedRetirementWithdrawals: 50000 }
  );
  approx(caWithParam, caBaseline, 'CA state tax unaffected by qualifiedRetirementWithdrawals param', 0.001);
}

// ── B10: getHistoricalSequence rejects out-of-range startYear ────────────────
if (!IS_MOBILE) {
  section('B10 — getHistoricalSequence throws on invalid startYear');
  {
    let threw = false;
    try { getHistoricalSequence(1900, 5); }
    catch (e) { threw = true; }
    eq(threw, true, 'startYear 1900 (out of range) throws instead of silently using 1928');

    // Valid year still works
    const valid = HISTORICAL_RETURNS[0].year;
    const seq = getHistoricalSequence(valid, 3);
    eq(seq.length, 3, 'valid startYear still produces sequence');
    eq(seq[0].year, valid, 'first row matches requested startYear');
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
if (fail === 0) {
  console.log(`✓ ALL ${pass} ASSERTIONS PASSED`);
  process.exit(0);
} else {
  console.log(`✗ ${fail} FAILED, ${pass} passed`);
  console.log('\nFailures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
