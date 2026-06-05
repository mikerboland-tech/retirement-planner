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
        getHistoricalSequence, HISTORICAL_RETURNS,
        getRmdStartAge, getFullRetirementAge, calculateACASubsidy, calculateSSEarningsTestReduction,
        calculateSSBenefit, calculateIRMAASurcharge, calculateAlabamaTax,
        FEDERAL_TAX_BRACKETS_2026, STANDARD_DEDUCTION_2026,
        CAPITAL_GAINS_THRESHOLDS_2025, IRMAA_THRESHOLDS_2025,
        SS_FULL_RETIREMENT_AGE, SS_EARNINGS_TEST_LIMIT_2025,
        ALABAMA_TAX_BRACKETS,
        PRE_TAX_TYPES, ROTH_TYPES, BROKERAGE_TYPES, HSA_TYPES,
        isPreTaxAccount, isRothAccount, isBrokerageAccount, isHSAAccount } = engine;
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

// ── Percent-mode contributions track salary COLA ─────────────────────────────
section('Percent-mode — contribution scales with salary COLA');
{
  // Two parallel young savers, identical except contribution mode.
  // Acct A: fixed $10K/yr, 0% growth — flat in nominal $.
  // Acct B: 10% of $100K salary with 3% COLA — should grow with salary.
  // After 10 years of identical 7% CAGR, Acct B should be the larger balance.
  const TODAY = TODAY_YEAR;
  const pi = {
    myAge: 35, spouseAge: 35,
    myRetirementAge: 65, spouseRetirementAge: 65,
    myBirthYear: TODAY - 35, spouseBirthYear: TODAY - 35,
    filingStatus: 'single',
    state: 'Florida',
    desiredRetirementIncome: 60000,
    inflationRate: 0.03,
    withdrawalPriority: ['pretax', 'brokerage', 'roth'],
    charitableGivingPercent: 0,
    rothConversionAmount: 0, rothConversionStartAge: 0, rothConversionEndAge: 0,
    rothConversionBracket: '', rothConversionTaxSource: 'withdrawal',
    legacyAge: 95, survivorModelEnabled: false,
    myLifeExpectancy: 95, spouseLifeExpectancy: 95,
    healthcareModel: 'none', pre65HealthcareAnnual: 0, post65OOPAnnual: 0,
    includeMedigap: false, ltcModel: 'none', ltcMonthlyAmount: 0, ltcDurationMonths: 0,
    medicalInflation: 0.05,
  };
  const accts = [
    { id: 1, name: 'Fixed', type: '401k', balance: 0, contribution: 10000, contributionGrowth: 0, cagr: 0.07, startAge: 35, stopAge: 65, owner: 'me', contributor: 'me' },
    { id: 2, name: 'Percent', type: '401k', balance: 0, contributionMode: 'percent', employeePercent: 0.10, employerMatchPercent: 0, cagr: 0.07, startAge: 35, stopAge: 65, owner: 'me', contributor: 'me' },
  ];
  const streams = [
    { id: 1, name: 'Salary', type: 'earned_income', amount: 100000, startAge: 35, endAge: 64, cola: 0.03, owner: 'me' },
  ];
  const proj = computeProjections(pi, accts, streams, [], [], [], TODAY);
  const yr10 = proj.find(r => r.myAge === 45);
  const fixedBal = yr10.perAccountBalances ? yr10.perAccountBalances[1] : null;
  const percentBal = yr10.perAccountBalances ? yr10.perAccountBalances[2] : null;
  // Sanity — both balances exist and grew.
  gt(fixedBal, 100000, 'fixed-$ account has accumulated balance after 10 yrs');
  gt(percentBal, 100000, 'percent-mode account has accumulated balance after 10 yrs');
  // The percent-mode account should outpace the fixed account because its contribution
  // grew from $10K (10% of $100K) to ~$13,439 (10% of $100K × 1.03^10) by year 10.
  gt(percentBal, fixedBal, 'percent-mode balance > fixed-$ balance after 10 yrs of salary COLA');

  // Backwards-compat: omitting contributionMode behaves exactly like 'fixed'.
  // Re-run with the same first account but no mode field — should match the prior result.
  const acctsNoMode = [
    { id: 1, name: 'NoMode', type: '401k', balance: 0, contribution: 10000, contributionGrowth: 0, cagr: 0.07, startAge: 35, stopAge: 65, owner: 'me', contributor: 'me' },
  ];
  const projNoMode = computeProjections(pi, acctsNoMode, streams, [], [], [], TODAY);
  const noModeYr10 = projNoMode.find(r => r.myAge === 45);
  const noModeBal = noModeYr10.perAccountBalances[1];
  approx(noModeBal, fixedBal, 'missing contributionMode field == fixed mode (backwards-compat)', 0.001);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPANDED COVERAGE — direct unit tests for tax/SS/RMD pure functions
// Added so future engine math fixes (Batch 2) are guarded by direct tests.
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. Federal tax bracket boundaries (2026) ─────────────────────────────────
section('Unit — calculateFederalTax bracket boundaries');
{
  // MFJ 2026: brackets 10/12/22/24/32/35/37 at 24800/100800/211400/403550/512450/768700.
  // Gross income at each boundary = bracket_top + std_deduction (32200).
  // Marginal rate test: tax(gross + $1000) - tax(gross) ≈ $1000 * upper_rate.
  const mfjBoundaries = [
    { name: '10/12', gross: 24800 + 32200, upper: 0.12 },
    { name: '12/22', gross: 100800 + 32200, upper: 0.22 },
    { name: '22/24', gross: 211400 + 32200, upper: 0.24 },
    { name: '24/32', gross: 403550 + 32200, upper: 0.32 },
    { name: '32/35', gross: 512450 + 32200, upper: 0.35 },
    { name: '35/37', gross: 768700 + 32200, upper: 0.37 },
  ];
  for (const b of mfjBoundaries) {
    const t0 = calculateFederalTax(b.gross, 'married_joint', 0, 0.03);
    const t1 = calculateFederalTax(b.gross + 1000, 'married_joint', 0, 0.03);
    approx(t1 - t0, 1000 * b.upper, `MFJ ${b.name} boundary: next $1k taxed at ${b.upper * 100}%`, 0.01);
  }

  // Single 2026: brackets at 12400/50400/105700/201775/256225/640600. Std deduction 16100.
  const singleBoundaries = [
    { name: '10/12', gross: 12400 + 16100, upper: 0.12 },
    { name: '12/22', gross: 50400 + 16100, upper: 0.22 },
    { name: '22/24', gross: 105700 + 16100, upper: 0.24 },
    { name: '24/32', gross: 201775 + 16100, upper: 0.32 },
    { name: '32/35', gross: 256225 + 16100, upper: 0.35 },
    { name: '35/37', gross: 640600 + 16100, upper: 0.37 },
  ];
  for (const b of singleBoundaries) {
    const t0 = calculateFederalTax(b.gross, 'single', 0, 0.03);
    const t1 = calculateFederalTax(b.gross + 1000, 'single', 0, 0.03);
    approx(t1 - t0, 1000 * b.upper, `Single ${b.name} boundary: next $1k taxed at ${b.upper * 100}%`, 0.01);
  }

  // Inflation indexing: same nominal income should be taxed less in year 10.
  const t_y0 = calculateFederalTax(100000, 'married_joint', 0, 0.03);
  const t_y10 = calculateFederalTax(100000, 'married_joint', 10, 0.03);
  lt(t_y10, t_y0, 'MFJ $100k taxed less in year 10 (brackets/deduction inflate)');
  approx(t_y0, 7640, 'MFJ $100k year 0 baseline ≈ $7,640');
  // Year 10: deduction 32200 * 1.03^10 = ~43,278 → taxable ~56,722; tax = 10%*33,329 + 12%*23,393 ≈ $6,140
  approx(t_y10, 6140, 'MFJ $100k year 10 ≈ $6,140 (inflated brackets)', 0.02);

  // Zero / negative gross income → 0 tax.
  eq(calculateFederalTax(0, 'married_joint', 0, 0.03), 0, 'gross income 0 → 0 tax');
  eq(calculateFederalTax(20000, 'married_joint', 0, 0.03), 0, 'gross below std deduction → 0 tax');
}

// ── 2. SECURE 2.0 RMD start-age cutovers ─────────────────────────────────────
section('Unit — getRmdStartAge SECURE 2.0 cutovers');
{
  // Born ≤1950: RMD age 72 (SECURE 1.0 grandfathered)
  eq(getRmdStartAge(1925), 72, 'birthYear 1925 → 72');
  eq(getRmdStartAge(1949), 72, 'birthYear 1949 → 72');
  eq(getRmdStartAge(1950), 72, 'birthYear 1950 (boundary) → 72');
  // 1951–1959: RMD age 73 (SECURE 2.0 phase 1)
  eq(getRmdStartAge(1951), 73, 'birthYear 1951 (just past 72 cutoff) → 73');
  eq(getRmdStartAge(1958), 73, 'birthYear 1958 → 73');
  eq(getRmdStartAge(1959), 73, 'birthYear 1959 (boundary) → 73');
  // 1960+: RMD age 75 (SECURE 2.0 phase 2)
  eq(getRmdStartAge(1960), 75, 'birthYear 1960 (just past 73 cutoff) → 75');
  eq(getRmdStartAge(1975), 75, 'birthYear 1975 → 75');
  // Defensive defaults
  eq(getRmdStartAge(undefined), 75, 'undefined birthYear → 75 (most generous default)');
  eq(getRmdStartAge(null), 75, 'null birthYear → 75 (most generous default)');
  eq(getRmdStartAge('1950'), 75, 'string birthYear → 75 (typeof !== number)');
}

// ── 3. calculateRMD across cutover ages ──────────────────────────────────────
section('Unit — calculateRMD birth-year cutovers');
{
  // Born 1951 → start age 73
  eq(calculateRMD(100000, 72, 1951), 0, '$100k @ age 72, born 1951 → 0 (below age 73)');
  approx(calculateRMD(100000, 73, 1951), 100000 / 26.5, 'born 1951, age 73 → factor 26.5', 0.001);
  // Born 1959 → start age 73 (1959 boundary)
  eq(calculateRMD(100000, 72, 1959), 0, '$100k @ age 72, born 1959 → 0');
  approx(calculateRMD(100000, 73, 1959), 100000 / 26.5, 'born 1959, age 73 → factor 26.5', 0.001);
  // Born 1960 → start age 75
  eq(calculateRMD(100000, 73, 1960), 0, '$100k @ age 73, born 1960 → 0 (below age 75)');
  eq(calculateRMD(100000, 74, 1960), 0, '$100k @ age 74, born 1960 → 0');
  approx(calculateRMD(100000, 75, 1960), 100000 / 24.6, 'born 1960, age 75 → factor 24.6', 0.001);
  // IRS Uniform Lifetime Table spot checks
  approx(calculateRMD(100000, 75, 1925), 100000 / 24.6, 'IRS factor age 75 = 24.6', 0.001);
  approx(calculateRMD(100000, 80, 1925), 100000 / 20.2, 'IRS factor age 80 = 20.2', 0.001);
  approx(calculateRMD(100000, 90, 1925), 100000 / 12.2, 'IRS factor age 90 = 12.2', 0.001);
  // Age clamp at 120
  approx(calculateRMD(100000, 130, 1925), 100000 / 1.9, 'age clamped to 120 → factor 1.9', 0.001);
}

// ── 4. Capital gains brackets + NIIT thresholds ──────────────────────────────
section('Unit — calculateCapitalGainsTax bracket walk');
{
  // MFJ 2025: zeroRate $98,900 / fifteenRate $613,700
  // 0% bracket: $50k cap gains with no other income → entirely in 0%
  eq(calculateCapitalGainsTax(50000, 50000, 'married_joint', 0, 0.03), 0,
    'MFJ $50k LTCG, no ordinary → all in 0% bracket → $0 tax');
  // 15% bracket: $50k cap gains stacked on $150k ordinary (already above zeroRate)
  approx(calculateCapitalGainsTax(50000, 200000, 'married_joint', 0, 0.03), 7500,
    'MFJ $50k LTCG on $150k income → $50k × 15% = $7,500');
  // 20% bracket: $50k cap gains stacked on $650k ordinary (above fifteenRate)
  approx(calculateCapitalGainsTax(50000, 700000, 'married_joint', 0, 0.03), 10000,
    'MFJ $50k LTCG on $650k income → $50k × 20% = $10,000');
  // Single: $50k LTCG no ordinary → $49,450 at 0%, $550 at 15% = $82.50
  approx(calculateCapitalGainsTax(50000, 50000, 'single', 0, 0.03), 82.50,
    'Single $50k LTCG, no ordinary → $49,450 at 0% + $550 at 15% = $82.50', 0.01);
  // Single: $100k LTCG with $500k ordinary income → straddles 15/20 boundary
  // taxableIncome=600k, incomeBeforeGains=500k. fifteenRate=545,500.
  // $45,500 at 15% + $54,500 at 20% = $6,825 + $10,900 = $17,725
  approx(calculateCapitalGainsTax(100000, 600000, 'single', 0, 0.03), 17725,
    'Single $100k LTCG on $500k ordinary → straddles 15/20 = $17,725', 0.01);
  // Zero/negative gains → 0
  eq(calculateCapitalGainsTax(0, 100000, 'married_joint', 0, 0.03), 0, '0 capital gains → 0 tax');
  eq(calculateCapitalGainsTax(-1000, 100000, 'married_joint', 0, 0.03), 0, 'negative capital gains → 0 tax');
}

section('Unit — calculateNIIT thresholds and clamps');
{
  // MFJ threshold $250k
  eq(calculateNIIT(10000, 240000, 'married_joint'), 0, 'MAGI below $250k MFJ → no NIIT');
  eq(calculateNIIT(10000, 250000, 'married_joint'), 0, 'MAGI at $250k MFJ exact → no NIIT');
  approx(calculateNIIT(10000, 260000, 'married_joint'), 380, '$10k inv income, $10k over → 3.8% × $10k = $380');
  approx(calculateNIIT(5000, 260000, 'married_joint'), 190, '$5k inv income, $10k over → clamped to $5k × 3.8% = $190');
  approx(calculateNIIT(100000, 500000, 'married_joint'), 3800, '$100k inv income, $250k over → 3.8% × $100k = $3,800');
  // Single $200k threshold
  eq(calculateNIIT(10000, 195000, 'single'), 0, 'MAGI below $200k single → no NIIT');
  approx(calculateNIIT(10000, 210000, 'single'), 380, 'single $10k inv on $10k excess → $380');
  // Married separate $125k
  approx(calculateNIIT(5000, 135000, 'married_separate'), 190, 'MFS $5k inv on $10k excess → $190');
}

// ── 5. IRMAA tier walk + surcharge calculation ───────────────────────────────
section('Unit — calculateIRMAA tier boundaries');
{
  // MFJ thresholds: 218000, 274000, 342000, 410000, 750000, Infinity
  // Code uses `magi <= adjustedMax`, so exact-boundary value stays in lower tier.
  eq(calculateIRMAA(218000, 'married_joint', 0, 0.03).partBMonthly, 202.90, 'MFJ MAGI=$218k → tier 0');
  eq(calculateIRMAA(218001, 'married_joint', 0, 0.03).partBMonthly, 284.10, 'MFJ MAGI=$218,001 → tier 1 (cliff)');
  eq(calculateIRMAA(274001, 'married_joint', 0, 0.03).partBMonthly, 405.80, 'MFJ MAGI=$274,001 → tier 2');
  eq(calculateIRMAA(342001, 'married_joint', 0, 0.03).partBMonthly, 527.50, 'MFJ MAGI=$342,001 → tier 3');
  eq(calculateIRMAA(410001, 'married_joint', 0, 0.03).partBMonthly, 649.20, 'MFJ MAGI=$410,001 → tier 4');
  eq(calculateIRMAA(750001, 'married_joint', 0, 0.03).partBMonthly, 689.90, 'MFJ MAGI=$750,001 → tier 5 (top)');

  // Single thresholds: 109000, 137000, 171000, 205000, 500000, Infinity
  eq(calculateIRMAA(109000, 'single', 0, 0.03).partBMonthly, 202.90, 'Single MAGI=$109k → tier 0');
  eq(calculateIRMAA(109001, 'single', 0, 0.03).partBMonthly, 284.10, 'Single MAGI=$109,001 → tier 1');
  eq(calculateIRMAA(500001, 'single', 0, 0.03).partBMonthly, 689.90, 'Single MAGI=$500,001 → tier 5');

  // Head-of-household uses single thresholds
  eq(calculateIRMAA(109001, 'head_of_household', 0, 0.03).partBMonthly, 284.10, 'HoH uses single thresholds');

  // tier index matches position
  eq(calculateIRMAA(217999, 'married_joint', 0, 0.03).tier, 0, 'tier index 0 for MFJ low');
  eq(calculateIRMAA(218001, 'married_joint', 0, 0.03).tier, 1, 'tier index 1 for MFJ first cliff');

  // Inflation indexing: at year 10, $218k MAGI should still be tier 0 (thresholds inflated)
  eq(calculateIRMAA(218000, 'married_joint', 10, 0.03).partBMonthly, 202.90,
    'MFJ MAGI=$218k at year 10 still tier 0 (threshold inflated to ~$293k)');
}

section('Unit — calculateIRMAASurcharge');
{
  // Standard Part B = $202.90/mo. Tier 0 surcharge = 0. Higher tiers compute
  // (tierPartB - standardPartB) × 12 + tierPartDAnnual.
  const tier0 = calculateIRMAASurcharge(218000, 'married_joint', 0, 0.03, 2);
  eq(tier0.surchargePerPerson, 0, 'MFJ tier 0 → no surcharge');
  eq(tier0.totalSurcharge, 0, 'MFJ tier 0 × 2 Medicare-eligible → 0');

  // Tier 1: (284.10 - 202.90)*12 + 14.50*12 = 81.20*12 + 174 = 974.40 + 174 = 1148.40
  // Note: totalSurcharge multiplies the UN-rounded per-person value, so MFJ × 2 = round(2296.80) = 2297.
  const tier1 = calculateIRMAASurcharge(218001, 'married_joint', 0, 0.03, 2);
  eq(tier1.surchargePerPerson, 1148, 'MFJ tier 1 per-person surcharge ≈ $1,148');
  eq(tier1.totalSurcharge, 2297, 'MFJ tier 1 × 2 = $2,297 household (round-after-multiply)');

  // Single only (numMedicareEligible=1)
  const single1 = calculateIRMAASurcharge(109001, 'single', 0, 0.03, 1);
  eq(single1.totalSurcharge, single1.surchargePerPerson, 'single household surcharge = per-person');
}

// ── 6. SS taxable amount across thresholds ───────────────────────────────────
section('Unit — calculateSocialSecurityTaxableAmount across thresholds');
{
  // MFJ thresholds: base $32k, max $44k (combined = 0.5*SS + other + tax-exempt)
  // Below base: 0 taxable
  eq(calculateSocialSecurityTaxableAmount(30000, 5000, 'married_joint'), 0,
    'MFJ SS $30k + other $5k → combined $20k < $32k → 0 taxable');
  // Tier 1 (between base and max): min(0.5*SS, 0.5*(combined - base))
  approx(calculateSocialSecurityTaxableAmount(40000, 15000, 'married_joint'), 1500,
    'MFJ SS $40k + other $15k → combined $35k → 50%×$3k = $1,500');
  // Cap at 0.5*SS in tier 1
  approx(calculateSocialSecurityTaxableAmount(2000, 42000, 'married_joint'), 1000,
    'MFJ SS $2k + other $42k → tier 1 capped at 0.5*SS = $1,000');
  // Tier 2 (above max): up to 85% of SS, plus capped tier-1 contribution.
  // combined=$45k, tier1Contribution=min(0.5*$30k, $6k)=$6k, excess=$1k → $6k + 0.85*$1k = $6,850
  approx(calculateSocialSecurityTaxableAmount(30000, 30000, 'married_joint'), 6850,
    'MFJ SS $30k + other $30k → combined $45k upper tier ≈ $6,850', 0.01);
  // Cap at 0.85*SS
  approx(calculateSocialSecurityTaxableAmount(40000, 100000, 'married_joint'), 34000,
    'MFJ SS $40k + other $100k → capped at 0.85*SS = $34,000');

  // Single thresholds: base $25k, max $34k
  eq(calculateSocialSecurityTaxableAmount(30000, 0, 'single'), 0,
    'Single SS $30k, no other → combined $15k < $25k → 0 taxable');
  approx(calculateSocialSecurityTaxableAmount(30000, 12000, 'single'), 1000,
    'Single SS $30k + other $12k → combined $27k → 50%×$2k = $1,000');
  approx(calculateSocialSecurityTaxableAmount(30000, 30000, 'single'), 13850,
    'Single SS $30k + other $30k → combined $45k upper tier ≈ $13,850', 0.01);

  // Married filing separately: any combined income → 85% taxable
  approx(calculateSocialSecurityTaxableAmount(30000, 1, 'married_separate'), 25500,
    'MFS with any combined income → 85% taxable');

  // Tax-exempt interest enters combined-income (extends B1)
  const noMuni = calculateSocialSecurityTaxableAmount(40000, 15000, 'married_joint', 0);
  const withMuni = calculateSocialSecurityTaxableAmount(40000, 15000, 'married_joint', 10000);
  gt(withMuni, noMuni, 'muni interest pushes more SS into taxable bracket');
}

// ── 7. SS earnings test reduction ────────────────────────────────────────────
section('Unit — calculateSSEarningsTestReduction');
{
  // Below limit → 0 reduction
  eq(calculateSSEarningsTestReduction(20000, 63, 67, 0, 0.03), 0,
    'earned $20k below $23,400 limit, pre-FRA → 0 reduction');
  // Pre-FRA: $1 withheld per $2 over limit
  approx(calculateSSEarningsTestReduction(33400, 63, 67, 0, 0.03), 5000,
    'earned $33,400 ($10k over), pre-FRA → $10k / 2 = $5,000');
  // At/after FRA → 0 regardless of earnings
  eq(calculateSSEarningsTestReduction(200000, 70, 67, 0, 0.03), 0, 'post-FRA → 0 reduction');
  eq(calculateSSEarningsTestReduction(200000, 67, 67, 0, 0.03), 0, 'at FRA exact → 0 reduction');
  // FRA-year (floor(claimAge) === floor(fra)): $1 withheld per $3 over higher limit ($62,160)
  // claimAge 66.0, fra 66.5 → floor matches → FRA year
  approx(calculateSSEarningsTestReduction(72160, 66, 66.5, 0, 0.03), (72160 - 62160) / 3,
    'FRA-year: $72,160 ($10k over $62,160 limit) → $10k/3 ≈ $3,333');
  // Inflation indexing: limit grows over years
  const y0 = calculateSSEarningsTestReduction(30000, 63, 67, 0, 0.03);
  const y10 = calculateSSEarningsTestReduction(30000, 63, 67, 10, 0.03);
  lt(y10, y0, 'same nominal earnings → less reduction in year 10 (limit inflated)');
}

// ── 8. Alabama state tax engine ──────────────────────────────────────────────
section('Unit — calculateAlabamaTax progressive brackets');
{
  // Test 1: simple wage earner, MFJ, age 50
  // AGI 50k → minus fed tax 4k = 46k → std deduction 4k (AGI >= 30k) → minus exempt 3k = 39k
  // Brackets MFJ: 2%*1k + 4%*5k + 5%*(39k-6k) = 20 + 200 + 1650 = 1870
  approx(calculateAlabamaTax(50000, 4000, 'married_joint', 0, 0, 50, 50, false), 1870,
    'MFJ $50k wages, $4k fed tax → ~$1,870 AL tax', 0.01);

  // Test 2: SS exempt
  // AGI 50k - SS 20k = 30k. minus fed 2k = 28k. std deduction at AGI 28k = 7500 - (8000/10000)*3500 = 4700
  // minus exempt 3k = 20,300. Tax = 20 + 200 + 5%*14,300 = 935
  approx(calculateAlabamaTax(50000, 2000, 'married_joint', 20000, 0, 50, 50, false), 935,
    'MFJ SS exempt from AL → ~$935', 0.01);

  // Test 3: government pension exempt
  // AGI 80k - pension 30k = 50k. minus fed 5k = 45k. std deduction 4k - exempt 3k = 38k
  // Tax = 20 + 200 + 5%*32k = 1820
  approx(calculateAlabamaTax(80000, 5000, 'married_joint', 0, 30000, 50, 50, true), 1820,
    'MFJ govt pension exempt → ~$1,820', 0.01);

  // Test 4: over-65 exclusion (both spouses 65+, $6k each)
  // AGI 50k - 12k over65 = 38k. minus fed 4k = 34k. std deduction at 34k = 4k. minus exempt 3k = 27k
  // Tax = 20 + 200 + 5%*21k = 1270
  approx(calculateAlabamaTax(50000, 4000, 'married_joint', 0, 0, 66, 66, false), 1270,
    'MFJ over-65 exclusion (both spouses) → ~$1,270', 0.01);

  // Test 5: hits all brackets (single, low income)
  // AGI 10k. std deduction 2500 (AGI < 20k). exempt 1500. taxable 6000.
  // Single brackets: 2%*500 + 4%*2500 + 5%*3000 = 10 + 100 + 150 = 260
  approx(calculateAlabamaTax(10000, 0, 'single', 0, 0, 40, 0, false), 260,
    'Single $10k → walks all 3 brackets → $260', 0.01);

  // Test 6: zero income
  eq(calculateAlabamaTax(0, 0, 'married_joint', 0, 0, 0, 0, false), 0, 'zero income → 0 tax');

  // Test 7: federal-deduction floor (federal tax > AGI after exemptions)
  // AGI 10k, fed 20k → alabamaAGI clamped to 0
  eq(calculateAlabamaTax(10000, 20000, 'married_joint', 0, 0, 50, 50, false), 0,
    'fed tax > AGI → clamps to 0 (no negative)');
}

// ── 9. ACA subsidy cliff ─────────────────────────────────────────────────────
section('Unit — calculateACASubsidy thresholds');
{
  // FPL 2025: household 1 = $15,060, 4 = $31,200, 8 = $52,720
  // Below 100% FPL: ineligible (Medicaid territory)
  const below = calculateACASubsidy(10000, 1, 'single');
  eq(below.eligible, false, '<100% FPL → ineligible');
  // At 100% FPL: Silver 94 tier
  const at100 = calculateACASubsidy(15060, 1, 'single');
  eq(at100.eligible, true, '100% FPL → eligible');
  eq(at100.tier, 'Silver 94', '100% FPL tier = Silver 94');
  eq(at100.premiumCap, 0, '100% FPL premium cap = 0%');
  // 150% FPL boundary (≤150 still Silver 94)
  const at150 = calculateACASubsidy(15060 * 1.5, 1, 'single');
  eq(at150.tier, 'Silver 94', '150% FPL → Silver 94');
  // Just above 150%: Silver 87, 2% cap
  const above150 = calculateACASubsidy(15060 * 1.5 + 100, 1, 'single');
  eq(above150.tier, 'Silver 87', '>150% FPL → Silver 87');
  eq(above150.premiumCap, 2.0, '>150% FPL cap = 2%');
  // 250% FPL: Silver 73, 4% cap
  const at250 = calculateACASubsidy(15060 * 2.5, 1, 'single');
  eq(at250.premiumCap, 4.0, '250% FPL cap = 4%');
  // Above 400% FPL: still eligible (ARPA/IRA extension) with note
  const above400 = calculateACASubsidy(15060 * 5, 1, 'single');
  eq(above400.eligible, true, '>400% FPL still eligible under ARPA/IRA');
  eq(above400.premiumCap, 8.5, '>400% FPL cap = 8.5%');
  eq(typeof above400.note, 'string', '>400% FPL includes note about reduced subsidy');
  // Household size handling: size 4 uses larger FPL
  const family100 = calculateACASubsidy(31200, 4, 'married_joint');
  eq(family100.eligible, true, 'family of 4 at $31,200 → 100% FPL → eligible');
  eq(family100.tier, 'Silver 94', 'family of 4 at 100% FPL → Silver 94');
  // Household size > 8 capped at 8
  const big = calculateACASubsidy(52720, 12, 'married_joint');
  eq(big.fplPercent, 100, 'household 12 capped to household 8 FPL ($52,720)');
}

// ── 10. Account-type predicate completeness ──────────────────────────────────
section('Unit — account-type predicates partition correctly');
{
  // For every declared type, exactly one predicate returns true.
  const allTypes = [
    ...PRE_TAX_TYPES.map(t => ({ type: t, expect: 'pretax' })),
    ...ROTH_TYPES.map(t => ({ type: t, expect: 'roth' })),
    ...BROKERAGE_TYPES.map(t => ({ type: t, expect: 'brokerage' })),
    ...HSA_TYPES.map(t => ({ type: t, expect: 'hsa' })),
  ];
  for (const { type, expect } of allTypes) {
    const flags = {
      pretax: isPreTaxAccount(type),
      roth: isRothAccount(type),
      brokerage: isBrokerageAccount(type),
      hsa: isHSAAccount(type),
    };
    const trueCount = Object.values(flags).filter(Boolean).length;
    eq(trueCount, 1, `type '${type}' matches exactly one predicate`);
    eq(flags[expect], true, `type '${type}' classified as ${expect}`);
  }
  // Unknown type → no predicate fires
  eq(isPreTaxAccount('unknown_type'), false, 'unknown type → not pretax');
  eq(isRothAccount('unknown_type'), false, 'unknown type → not roth');
  eq(isBrokerageAccount('unknown_type'), false, 'unknown type → not brokerage');
  eq(isHSAAccount('unknown_type'), false, 'unknown type → not HSA');
}

// ── 11. Integration — early withdrawal age 55 vs 60 ──────────────────────────
section('Integration — pre-59½ pre-tax withdrawal completes (engine has no penalty)');
{
  // The engine does not currently model the IRS 10% early-withdrawal penalty.
  // These assertions PIN that behavior so a future engine change that adds the
  // penalty (or accidentally removes pre-tax withdrawals at age 55) will fail.
  const youngScenario = baseScenario({
    myAge: 55, spouseAge: 55,
    myRetirementAge: 55, spouseRetirementAge: 55,
    myBirthYear: TODAY_YEAR - 55, spouseBirthYear: TODAY_YEAR - 55,
    desiredRetirementIncome: 60000,
    withdrawalPriority: ['pretax', 'brokerage', 'roth'],
    legacyAge: 80,
  });
  const olderScenario = baseScenario({
    myAge: 60, spouseAge: 60,
    myRetirementAge: 60, spouseRetirementAge: 60,
    myBirthYear: TODAY_YEAR - 60, spouseBirthYear: TODAY_YEAR - 60,
    desiredRetirementIncome: 60000,
    withdrawalPriority: ['pretax', 'brokerage', 'roth'],
    legacyAge: 80,
  });
  const youngProj = run(youngScenario, 80);
  const olderProj = run(olderScenario, 80);
  // Both runs complete without crashing
  gt(youngProj.length, 0, 'age-55 retirement projection generates rows');
  gt(olderProj.length, 0, 'age-60 retirement projection generates rows');
  // Find the first withdrawal row in each
  const young56 = youngProj.find(r => r.myAge === 56);
  const old61 = olderProj.find(r => r.myAge === 61);
  // Federal tax is a finite number (no NaN/penalty crash)
  eq(typeof young56.federalTax, 'number', 'age 56 federalTax is numeric');
  eq(isNaN(young56.federalTax), false, 'age 56 federalTax not NaN');
  eq(typeof old61.federalTax, 'number', 'age 61 federalTax is numeric');
  // Pinning current (no-penalty) behavior: the comparable-income age-56 tax should
  // NOT be dramatically higher than age-61 (would indicate a penalty was added).
  // If a 10% penalty is ever modeled, this assertion will trip and force a review.
  lt(young56.federalTax, old61.federalTax * 2,
    'age-56 tax not dramatically higher than age-61 (pins no-penalty behavior)');
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH 2 — engine math fixes (FRA pre-1943, Roth bracket map, IRMAA/NIIT in solver)
// ═══════════════════════════════════════════════════════════════════════════

// ── B2-1. FRA helper covers pre-1943 cohort ──────────────────────────────────
section('Unit — getFullRetirementAge pre-1943 cohort');
{
  // SSA rules: ≤1937 = 65; 1938-1942 phase-in; 1943-1954 = 66; 1955-1959 phase to 67; ≥1960 = 67
  eq(getFullRetirementAge(1900), 65, 'birthYear 1900 → 65');
  eq(getFullRetirementAge(1937), 65, 'birthYear 1937 (boundary) → 65');
  approx(getFullRetirementAge(1938), 65 + 2/12, '1938 → 65y2m', 0.001);
  approx(getFullRetirementAge(1940), 65 + 6/12, '1940 → 65y6m', 0.001);
  approx(getFullRetirementAge(1942), 65 + 10/12, '1942 → 65y10m', 0.001);
  eq(getFullRetirementAge(1943), 66, '1943 → 66 (start of 66-flat era)');
  eq(getFullRetirementAge(1954), 66, '1954 → 66');
  approx(getFullRetirementAge(1959), 66.833, '1959 → 66y10m', 0.01);
  eq(getFullRetirementAge(1960), 67, '1960 → 67');
  eq(getFullRetirementAge(2000), 67, '2000 → 67');
  // Defensive defaults
  eq(getFullRetirementAge(undefined), 67, 'undefined → 67');
  eq(getFullRetirementAge(null), 67, 'null → 67');
  eq(getFullRetirementAge('1940'), 67, 'string → 67 (typeof !== number)');

  // Downstream: calculateSSBenefit no longer over-discounts pre-1943 claimants
  // claimAge=65, born 1935 → claimAge ≥ fra (65) → no early-claim reduction
  eq(calculateSSBenefit(2000, 65, 1935), 2000, 'born 1935, claim at 65 → no reduction (FRA = 65)');
  // Pre-fix behavior would have treated FRA as 67 and reduced ~13.33%
  gt(calculateSSBenefit(2000, 65, 1935), calculateSSBenefit(2000, 65, 1960),
    'born 1935 at 65 (FRA=65) gets full PIA; born 1960 at 65 (FRA=67) is reduced');
}

// ── B2-2. Roth bracket validation ────────────────────────────────────────────
section('Integration — Roth bracket validation (rate→idx map)');
{
  // Custom pi + accts (don't use baseScenario's accts — we need a specific balance mix
  // to make conversion-size differences observable in a single year).
  const makePI = (bracketLabel) => ({
    myAge: 62, spouseAge: 62,
    myRetirementAge: 62, spouseRetirementAge: 62,
    myBirthYear: TODAY_YEAR - 62, spouseBirthYear: TODAY_YEAR - 62,
    filingStatus: 'married_joint', state: 'Florida',
    desiredRetirementIncome: 40000,
    inflationRate: 0.03,
    withdrawalPriority: ['pretax', 'brokerage', 'roth'],
    charitableGivingPercent: 0,
    rothConversionAmount: 0,
    rothConversionStartAge: 62, rothConversionEndAge: 62,
    rothConversionBracket: bracketLabel,
    rothConversionTaxSource: 'brokerage',
    legacyAge: 65,
    survivorModelEnabled: false,
    myLifeExpectancy: 95, spouseLifeExpectancy: 95,
    healthcareModel: 'none', pre65HealthcareAnnual: 0, post65OOPAnnual: 0,
    includeMedigap: false, ltcModel: 'none', ltcMonthlyAmount: 0, ltcDurationMonths: 0,
    medicalInflation: 0.05,
  });
  const accts = [
    { id: 1, name: '401k', type: '401k', balance: 3000000, contribution: 0, contributionGrowth: 0, cagr: 0, startAge: 62, stopAge: 62, owner: 'me', contributor: 'me' },
    { id: 2, name: 'Brok', type: 'brokerage', balance: 500000, contribution: 0, contributionGrowth: 0, cagr: 0, startAge: 62, stopAge: 62, owner: 'me', contributor: 'me', costBasisPercent: 0.5 },
    { id: 3, name: 'Roth', type: 'roth_ira', balance: 0, contribution: 0, contributionGrowth: 0, cagr: 0, startAge: 62, stopAge: 62, owner: 'me', contributor: 'me' },
  ];

  // '35%' should now actually fill the 35% bracket. Pre-fix it silently fell back to '22%'.
  const proj35 = computeProjections(makePI('35%'), accts, [], [], [], [], TODAY_YEAR);
  const proj22 = computeProjections(makePI('22%'), accts, [], [], [], [], TODAY_YEAR);
  const y35 = proj35.find(r => r.myAge === 62);
  const y22 = proj22.find(r => r.myAge === 62);
  // 35% bracket top (MFJ) = $768,700 vs 22% top = $100,800 → much larger conversion
  gt(y35.rothBalance, y22.rothBalance * 2,
    "'35%' bracket fills further than '22%' (post-fix; pre-fix both used '22%')");

  // Unknown bracket label → safe skip (0 conversion), NOT silent fallback to 22%
  const projBad = computeProjections(makePI('banana'), accts, [], [], [], [], TODAY_YEAR);
  const yBad = projBad.find(r => r.myAge === 62);
  eq(yBad.rothBalance, 0, "unknown bracket label 'banana' → 0 conversion (no silent fallback)");

  // Sanity: all 7 valid labels resolve without throwing
  for (const label of ['10%', '12%', '22%', '24%', '32%', '35%', '37%']) {
    const projV = computeProjections(makePI(label), accts, [], [], [], [], TODAY_YEAR);
    gt(projV.length, 0, `bracket '${label}' produces a projection without error`);
  }
}

// ── B2-3. IRMAA recomputed inside the solver loop ────────────────────────────
section('Integration — solver recomputes IRMAA per iteration');
{
  // High-MAGI year with both spouses Medicare-eligible — the solver should
  // pre-fund the IRMAA surcharge so the withdrawal covers desired + tax + IRMAA.
  const pi = {
    myAge: 67, spouseAge: 67,
    myRetirementAge: 65, spouseRetirementAge: 65,
    myBirthYear: TODAY_YEAR - 67, spouseBirthYear: TODAY_YEAR - 67,
    filingStatus: 'married_joint', state: 'Florida',
    desiredRetirementIncome: 220000,  // large draw → crosses IRMAA tier
    inflationRate: 0.03,
    withdrawalPriority: ['pretax', 'brokerage', 'roth'],
    charitableGivingPercent: 0,
    rothConversionAmount: 0, rothConversionStartAge: 0, rothConversionEndAge: 0,
    rothConversionBracket: '', rothConversionTaxSource: 'withdrawal',
    legacyAge: 70, survivorModelEnabled: false,
    myLifeExpectancy: 95, spouseLifeExpectancy: 95,
    healthcareModel: 'none', pre65HealthcareAnnual: 0, post65OOPAnnual: 0,
    includeMedigap: false, ltcModel: 'none', ltcMonthlyAmount: 0, ltcDurationMonths: 0,
    medicalInflation: 0.05,
  };
  const accts = [
    { id: 1, name: '401k', type: '401k', balance: 5000000, contribution: 0, contributionGrowth: 0, cagr: 0, startAge: 67, stopAge: 67, owner: 'me', contributor: 'me' },
  ];
  const proj = computeProjections(pi, accts, [], [], [], [], TODAY_YEAR);
  const y67 = proj.find(r => r.myAge === 67);
  gt(y67.irmaaSurcharge, 0, 'large pre-tax draw at 67 triggers IRMAA surcharge');
  gt(y67.portfolioWithdrawal, 220000, 'portfolio withdrawal exceeds desired income (covers tax + IRMAA)');
  eq(isNaN(y67.federalTax), false, 'high-MAGI federal tax is numeric');
  eq(isNaN(y67.irmaaSurcharge), false, 'high-MAGI IRMAA is numeric');
}

// ── B2-4. NIIT inside the solver loop ────────────────────────────────────────
section('Integration — solver pre-funds NIIT on investment income');
{
  // Pretax-first draw of $280k → MAGI well above $250k MFJ NIIT threshold.
  // Large brokerage balance generates ~$20k dividend estimate (2% yield).
  // NIIT = 3.8% × min(investment income, MAGI − threshold).
  // The solver must size the pretax draw to cover desired + ordinary fed/state +
  // NIIT, otherwise realized net falls short by the surtax amount.
  const pi = {
    myAge: 65, spouseAge: 65,
    myRetirementAge: 65, spouseRetirementAge: 65,
    myBirthYear: TODAY_YEAR - 65, spouseBirthYear: TODAY_YEAR - 65,
    filingStatus: 'married_joint', state: 'Florida',
    desiredRetirementIncome: 280000,  // forces MAGI past $250k MFJ NIIT threshold
    inflationRate: 0.03,
    withdrawalPriority: ['pretax', 'brokerage', 'roth'],
    charitableGivingPercent: 0,
    rothConversionAmount: 0, rothConversionStartAge: 0, rothConversionEndAge: 0,
    rothConversionBracket: '', rothConversionTaxSource: 'withdrawal',
    legacyAge: 68, survivorModelEnabled: false,
    myLifeExpectancy: 95, spouseLifeExpectancy: 95,
    healthcareModel: 'none', pre65HealthcareAnnual: 0, post65OOPAnnual: 0,
    includeMedigap: false, ltcModel: 'none', ltcMonthlyAmount: 0, ltcDurationMonths: 0,
    medicalInflation: 0.05,
  };
  const accts = [
    { id: 1, name: '401k', type: '401k', balance: 5000000, contribution: 0, contributionGrowth: 0, cagr: 0, startAge: 65, stopAge: 65, owner: 'me', contributor: 'me' },
    { id: 2, name: 'Brok', type: 'brokerage', balance: 1000000, contribution: 0, contributionGrowth: 0, cagr: 0, costBasisPercent: 0.3, startAge: 65, stopAge: 65, owner: 'me', contributor: 'me' },
  ];
  const proj = computeProjections(pi, accts, [], [], [], [], TODAY_YEAR);
  const y65 = proj.find(r => r.myAge === 65);
  gt(y65.federalTax, 0, 'federalTax > 0 on high-MAGI NIIT scenario');
  gt(y65.portfolioWithdrawal, 280000, 'portfolio withdrawal exceeds desired (covers tax + NIIT)');
  eq(isNaN(y65.federalTax), false, 'NIIT-scenario federal tax is numeric');
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
