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

// ── Percent-mode deduction: only the employee slice reduces taxable income ────
section('Percent-mode — employer match is NOT tax-deductible');
{
  // A combined 401(k) holds the employee deferral (10%) + employer match (5%).
  // Only the employee 10% ever left the paycheck, so only it reduces taxable income;
  // the 5% match was never wages and must not be deducted.
  const TODAY = TODAY_YEAR;
  const pi = {
    myAge: 40, spouseAge: 40, myRetirementAge: 65, spouseRetirementAge: 65,
    myBirthYear: TODAY - 40, spouseBirthYear: TODAY - 40,
    filingStatus: 'single', state: 'Florida', desiredRetirementIncome: 60000,
    inflationRate: 0.03, withdrawalPriority: ['pretax', 'brokerage', 'roth'],
    charitableGivingPercent: 0, rothConversionAmount: 0, rothConversionStartAge: 0,
    rothConversionEndAge: 0, rothConversionBracket: '', rothConversionTaxSource: 'withdrawal',
    legacyAge: 95, survivorModelEnabled: false, myLifeExpectancy: 95, spouseLifeExpectancy: 95,
    healthcareModel: 'none', pre65HealthcareAnnual: 0, post65OOPAnnual: 0,
    includeMedigap: false, ltcModel: 'none', ltcMonthlyAmount: 0, ltcDurationMonths: 0,
    medicalInflation: 0.05,
  };
  const streams = [{ id: 1, name: 'Salary', type: 'earned_income', amount: 100000, startAge: 40, endAge: 64, cola: 0.03, owner: 'me' }];
  const mk = (ee, er) => [{ id: 1, name: '401k', type: '401k', balance: 0, contributionMode: 'percent', employeePercent: ee, employerMatchPercent: er, cagr: 0.07, startAge: 40, stopAge: 65, owner: 'me', contributor: 'me' }];
  const fed = (accts) => computeProjections(pi, accts, streams, [], [], [], TODAY).find(r => r.myAge === 41).federalTax;
  const bal = (accts) => computeProjections(pi, accts, streams, [], [], [], TODAY).find(r => r.myAge === 45).perAccountBalances[1];

  const fed10_5 = fed(mk(0.10, 0.05));  // employee 10% + match 5%
  const fed10_0 = fed(mk(0.10, 0.00));  // employee 10%, no match
  const fed15_0 = fed(mk(0.15, 0.00));  // employee 15%, no match

  // Adding a 5% employer match must not change taxes (match isn't deducted).
  approx(fed10_5, fed10_0, 'employer match % does not lower taxable income (only employee % deducts)', 0.001);
  // A real 15% employee deferral deducts more than 10%, so taxes must be strictly lower —
  // proving the 5% match in the combined account was genuinely NOT deducted.
  lt(fed15_0, fed10_5, 'employee 15% deferral deducts more than employee 10% + 5% match');
  // The match money still lands in the account: 10%+5% accumulates more than 10% alone.
  gt(bal(mk(0.10, 0.05)), bal(mk(0.10, 0.00)), 'employer match still flows into the account balance');
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

  // Inflation indexing: at year 10, $218k MAGI should still be tier 0 (thresholds inflated).
  // Premium DOLLARS index forward too (R2026-07b), so tier-0 Part B = 202.90 × 1.03^10.
  eq(calculateIRMAA(218000, 'married_joint', 10, 0.03).tier, 0,
    'MFJ MAGI=$218k at year 10 still tier 0 (threshold inflated to ~$293k)');
  approx(calculateIRMAA(218000, 'married_joint', 10, 0.03).partBMonthly, 202.90 * Math.pow(1.03, 10),
    'tier-0 Part B premium indexed forward 10 years', 0.001);
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

// ── 8b. CA / NY / NJ progressive state tax engines ───────────────────────────
// All use yearsFromNow=0 so no inflation factor applies (hand-computed against
// the 2026 base schedules encoded in STATE_TAX_CONFIG).
section('Unit — California progressive tax (credit-mode exemption + MHST)');
{
  // Single $60k, no SS/pension. taxable = 60000 - 5706 std = 54294.
  // .01*11079 + .02*15185 + .04*15188 + .06*(54294-41452) = 110.79+303.70+607.52+770.52 = 1792.53
  // minus $153 personal-exemption credit = 1639.53
  approx(calculateStateTax(60000, 'California', 'single', 0, 0.03, 0, 0), 1639.53,
    'CA single $60k → $1,639.53 (after $153 credit)', 0.002);

  // MFJ $150k. taxable = 150000 - 11412 = 138588.
  // .01*22158 + .02*30370 + .04*30376 + .06*32180 + .08*(138588-115084)
  //  = 221.58+607.40+1215.04+1930.80+1880.32 = 5855.14  minus $306 credit = 5549.14
  approx(calculateStateTax(150000, 'California', 'married_joint', 0, 0.03, 0, 0), 5549.14,
    'CA MFJ $150k → $5,549.14 (after $306 credit)', 0.002);

  // SS is exempt in CA: $60k gross of which $20k is taxable SS → taxed like $40k.
  // taxable = 40000 - 5706 = 34294. .01*11079+.02*15185+.04*(34294-26264)=110.79+303.70+321.20=735.69 -153 = 582.69
  approx(calculateStateTax(60000, 'California', 'single', 0, 0.03, 20000, 0), 582.69,
    'CA single $60k w/ $20k SS exempt → $582.69', 0.003);

  // MHST: 1% surtax on taxable income over $1M. Single $1.1M, taxable = 1,094,294.
  // bracket tax to 742,953 = 72,219.83; + .123*(1,094,294-742,953)=43,214.94 → 115,434.77
  // minus $153 credit + .01*(1,094,294-1,000,000)=942.94 → 116,224.71
  approx(calculateStateTax(1100000, 'California', 'single', 0, 0.03, 0, 0), 116224.71,
    'CA single $1.1M → includes 1% MHST = $116,224.71', 0.002);
}

section('Unit — New York progressive tax (benefit recapture + pension exclusion)');
{
  // Single $60k. taxable = 60000 - 8000 std = 52000 (no personal exemption).
  // .039*8500+.044*3200+.0515*2200+.054*(52000-13900) = 331.50+140.80+113.30+2057.40 = 2643.00
  approx(calculateStateTax(60000, 'New York', 'single', 0, 0.03, 0, 0), 2643.00,
    'NY single $60k → $2,643.00', 0.002);

  // Retiree single, $50k gross of which $25k is pension, age 65.
  // $20k pension exclusion → AGI 30k; taxable = 30000-8000 = 22000.
  // .039*8500+.044*3200+.0515*2200+.054*(22000-13900)=331.50+140.80+113.30+437.40 = 1023.00
  approx(calculateStateTax(50000, 'New York', 'single', 0, 0.03, 0, 25000,
    { primaryAge: 65 }), 1023.00, 'NY single retiree $50k ($25k pension, $20k excl) → $1,023.00', 0.003);

  // Benefit recapture: single $200k AGI > $107,650 and ≥ $157,650 → fully flattened
  // to top marginal rate (5.9%) on entire taxable income. taxable = 200000-8000 = 192000.
  // 0.059 * 192000 = 11328.00
  approx(calculateStateTax(200000, 'New York', 'single', 0, 0.03, 0, 0), 11328.00,
    'NY single $200k → recapture flattens to 5.9% = $11,328.00', 0.002);
}

section('Unit — New Jersey progressive tax (no std deduction, pension exclusion)');
{
  // Single $60k, under 62. No std deduction; $1,000 personal exemption. taxable = 59000.
  // .014*20000+.0175*15000+.035*5000+.05525*(59000-40000)=280+262.50+175+1049.75 = 1767.25
  approx(calculateStateTax(60000, 'New Jersey', 'single', 0, 0.03, 0, 0), 1767.25,
    'NJ single $60k (age <62) → $1,767.25', 0.002);

  // Retiree MFJ $90k gross, $30k pension, both 66. njGross 90k ≤100k → 100% excl,
  // min($30k, $100k)=30k; +$1k×2 age-65 = $32k excluded → AGI 58k; minus $2k exemption = 56000.
  // .014*20000+.0175*30000+.0245*(56000-50000)=280+525+147 = 952.00
  approx(calculateStateTax(90000, 'New Jersey', 'married_joint', 0, 0.03, 0, 30000,
    { primaryAge: 66, spouseAge: 66 }), 952.00, 'NJ MFJ retiree $90k ($30k pension) → $952.00', 0.003);

  // NJ pension exclusion cliff: same retiree but njGross $160k > $150k → no exclusion.
  // gross 160k, $30k pension, both 66. exclusion = $1k×2 age-65 only = 2000 → AGI 158000;
  // minus $2k exemption = 156000.
  // .014*20000+.0175*30000+.0245*20000+.035*10000+.05525*70000+.0637*(156000-150000)
  //  =280+525+490+350+3867.50+382.20 = 5894.70
  approx(calculateStateTax(160000, 'New Jersey', 'married_joint', 0, 0.03, 0, 30000,
    { primaryAge: 66, spouseAge: 66 }), 5894.70, 'NJ MFJ $160k → over $150k cliff, no pension excl → $5,894.70', 0.003);
}

// ── 8c. HI / OR / MN progressive state tax engines ───────────────────────────
// yearsFromNow=0 → no inflation factor; hand-computed against 2026 base schedules.
section('Unit — Hawaii progressive tax (12 brackets, std ded + exemption, pension exempt)');
{
  // Single $40k, no SS/pension. taxable = 40000 - 8000 std - 1144 exemption = 30856.
  // .014*9600+.032*4800+.055*4800+.064*4800+.068*(30856-24000)
  //  = 134.40+153.60+264.00+307.20+466.208 = 1325.408
  approx(calculateStateTax(40000, 'Hawaii', 'single', 0, 0.03, 0, 0), 1325.41,
    'HI single $40k → $1,325.41', 0.002);

  // MFJ $120k. taxable = 120000 - 16000 std - 2288 exemption = 101712.
  // .014*19200+.032*9600+.055*9600+.064*9600+.068*24000+.072*24000+.076*(101712-96000)
  //  = 268.80+307.20+528.00+614.40+1632.00+1728.00+434.112 = 5512.512
  approx(calculateStateTax(120000, 'Hawaii', 'married_joint', 0, 0.03, 0, 0), 5512.51,
    'HI MFJ $120k → $5,512.51', 0.002);

  // Retiree single $60k = $20k SS (exempt) + $20k employer pension (exempt) + $20k IRA (taxable).
  // AGI 60000 -20000 SS -20000 pension = 20000; taxable = 20000-8000-1144 = 10856.
  // .014*9600 + .032*(10856-9600) = 134.40+40.192 = 174.592
  approx(calculateStateTax(60000, 'Hawaii', 'single', 0, 0.03, 20000, 20000,
    { qualifiedRetirementWithdrawals: 20000 }), 174.59,
    'HI single retiree $60k ($20k SS + $20k pension exempt) → $174.59', 0.004);
}

section('Unit — Oregon progressive tax (federal-tax subtraction + credit exemption)');
{
  // Single $50k, federalTaxPaid $4k (< cap, AGI < phaseout). AGI 50000-4000 = 46000;
  // taxable = 46000 - 2835 std = 43165.
  // .0475*4050+.0675*6150+.0875*(43165-10200) = 192.375+415.125+2884.4375 = 3491.9375
  // minus $256 personal-exemption credit = 3235.9375
  approx(calculateStateTax(50000, 'Oregon', 'single', 0, 0.03, 0, 0, { federalTaxPaid: 4000 }), 3235.94,
    'OR single $50k (fed $4k deductible) → $3,235.94', 0.002);

  // MFJ $120k, federalTaxPaid $10k → capped at $8,500. AGI 120000-8500 = 111500;
  // taxable = 111500 - 5670 std = 105830.
  // .0475*8100+.0675*12300+.0875*(105830-20400) = 384.75+830.25+7475.125 = 8690.125
  // minus $512 credit = 8178.125
  approx(calculateStateTax(120000, 'Oregon', 'married_joint', 0, 0.03, 0, 0, { federalTaxPaid: 10000 }), 8178.13,
    'OR MFJ $120k (fed capped at $8.5k) → $8,178.13', 0.002);

  // Retiree single $40k = $15k SS (exempt) + $25k pension/IRA (taxable). fed $1.5k.
  // AGI 40000 -15000 SS = 25000; -1500 fed = 23500; taxable = 23500-2835 = 20665.
  // .0475*4050+.0675*6150+.0875*(20665-10200) = 192.375+415.125+915.6875 = 1523.1875 -256 = 1267.1875
  approx(calculateStateTax(40000, 'Oregon', 'single', 0, 0.03, 15000, 25000, { federalTaxPaid: 1500 }), 1267.19,
    'OR single retiree $40k ($15k SS exempt, pension taxable) → $1,267.19', 0.003);
}

section('Unit — Minnesota progressive tax (federal-style std ded, taxes SS)');
{
  // Single $50k, no SS. taxable = 50000 - 15300 std = 34700 (no personal exemption).
  // .0535*33310 + .068*(34700-33310) = 1782.085 + 94.52 = 1876.605
  approx(calculateStateTax(50000, 'Minnesota', 'single', 0, 0.03, 0, 0), 1876.61,
    'MN single $50k → $1,876.61', 0.002);

  // MFJ $150k. taxable = 150000 - 30600 = 119400.
  // .0535*48700 + .068*(119400-48700) = 2605.45 + 4807.60 = 7413.05
  approx(calculateStateTax(150000, 'Minnesota', 'married_joint', 0, 0.03, 0, 0), 7413.05,
    'MN MFJ $150k → $7,413.05', 0.002);

  // MN TAXES SS: retiree single $40k incl $18k SS → SS NOT subtracted.
  // taxable = 40000 - 15300 = 24700; .0535*24700 = 1321.45
  approx(calculateStateTax(40000, 'Minnesota', 'single', 0, 0.03, 18000, 0), 1321.45,
    'MN single $40k w/ $18k SS (SS taxed) → $1,321.45', 0.002);
}

// ── 8d. CT / MO / MT progressive state tax engines ───────────────────────────
section('Unit — Missouri (flat 4.7%, fed+$4k std ded, SS exempt, public-pension excl)');
{
  // Single $50k. std ded = 16100 (fed) + 4000 = 20100. taxable = 29900.
  // 29900 * .047 = 1405.30
  approx(calculateStateTax(50000, 'Missouri', 'single', 0, 0.03, 0, 0), 1405.30,
    'MO single $50k → $1,405.30', 0.002);

  // MFJ $120k. std ded = 32200 + 4000 = 36200. taxable = 83800. *.047 = 3938.60
  approx(calculateStateTax(120000, 'Missouri', 'married_joint', 0, 0.03, 0, 0), 3938.60,
    'MO MFJ $120k → $3,938.60', 0.002);

  // Retiree single $60k incl $20k public pension. Pension excl (cap $49,824) = 20000.
  // agi = 40000; std ded 20100 → taxable 19900; *.047 = 935.30
  approx(calculateStateTax(60000, 'Missouri', 'single', 0, 0.03, 0, 20000), 935.30,
    'MO single $60k w/ $20k pension excluded → $935.30', 0.002);
}

section('Unit — Montana (two brackets 4.7%/5.65%, fed-taxable start, SS exempt 2026)');
{
  // Single $50k. std ded = 16100 (fed). taxable = 33900. All in 4.7% bracket (<47500).
  // 33900 * .047 = 1593.30
  approx(calculateStateTax(50000, 'Montana', 'single', 0, 0.03, 0, 0), 1593.30,
    'MT single $50k → $1,593.30', 0.002);

  // Single $80k crosses into 5.65%. taxable = 63900. 47500*.047 + (63900-47500)*.0565
  // = 2232.50 + 926.60 = 3159.10
  approx(calculateStateTax(80000, 'Montana', 'single', 0, 0.03, 0, 0), 3159.10,
    'MT single $80k (spans brackets) → $3,159.10', 0.002);

  // Retiree single $50k incl $10k SS, age 67. SS exempt (MT off the taxes-SS list);
  // over-65 subtraction $5,500. agi = 50000-10000-5500 = 34500; std ded 16100 →
  // taxable 18400; *.047 = 864.80
  approx(calculateStateTax(50000, 'Montana', 'single', 0, 0.03, 10000, 0, { primaryAge: 67 }), 864.80,
    'MT single $50k w/ $10k SS + over-65 (age 67) → $864.80', 0.002);
}

section('Unit — Connecticut (7 brackets, no std ded, phased exemption/pension, recapture)');
{
  // Single $50k. Personal exemption fully phased out (>$30k start). taxable = 50000.
  // 10000*.02 + 40000*.045 = 200 + 1800 = 2000
  approx(calculateStateTax(50000, 'Connecticut', 'single', 0, 0.03, 0, 0), 2000.00,
    'CT single $50k → $2,000.00', 0.002);

  // Retiree single $60k incl $30k pension. AGI $60k < $75k pension-excl threshold →
  // 100% pension exclusion ($30k). taxable = 30000. 10000*.02 + 20000*.045 = 1100
  approx(calculateStateTax(60000, 'Connecticut', 'single', 0, 0.03, 0, 30000), 1100.00,
    'CT single $60k w/ $30k pension fully excluded → $1,100.00', 0.002);

  // Single $300k triggers Table D benefit recapture → flattened to top rate 6.9%.
  // 300000 * .069 = 20700
  approx(calculateStateTax(300000, 'Connecticut', 'single', 0, 0.03, 0, 0), 20700.00,
    'CT single $300k (benefit recapture → top rate) → $20,700.00', 0.002);
}

// ── 8e. VA / WI / ME progressive state tax engines ───────────────────────────
section('Unit — Virginia (first-dollar 4 brackets, fixed std ded, age deduction)');
{
  // Single $50k. std ded 8750, exemption 930. taxable = 40320.
  // 3000*.02 + 2000*.03 + 12000*.05 + (40320-17000)*.0575 = 60+60+600+1340.90 = 2060.90
  approx(calculateStateTax(50000, 'Virginia', 'single', 0, 0.03, 0, 0), 2060.90,
    'VA single $50k → $2,060.90', 0.002);

  // MFJ $120k. std ded 17500, exemption 1860. taxable = 100640.
  approx(calculateStateTax(120000, 'Virginia', 'married_joint', 0, 0.03, 0, 0), 5529.30,
    'VA MFJ $120k → $5,529.30', 0.002);

  // Retiree single $60k incl $10k SS, age 67. SS exempt → agi 50000; age deduction
  // $12,000 (no phaseout at exactly $50k). taxable = 50000-12000-8750-930 = 28320.
  approx(calculateStateTax(60000, 'Virginia', 'single', 0, 0.03, 10000, 0, { primaryAge: 67 }), 1370.90,
    'VA single $60k w/ $10k SS + age-65 deduction → $1,370.90', 0.002);
}

section('Unit — Wisconsin (sliding std ded, 4 brackets, Act 15 retirement excl)');
{
  // Single $50k. SSSD = 13930 - .12*(50000-19310) = 10247.20; exemption 700.
  // taxable = 39052.80. 14680*.035 + (39052.80-14680)*.044 = 513.80 + 1072.40 = 1586.20
  approx(calculateStateTax(50000, 'Wisconsin', 'single', 0, 0.03, 0, 0), 1586.20,
    'WI single $50k → $1,586.20', 0.002);

  // MFJ $120k.
  approx(calculateStateTax(120000, 'Wisconsin', 'married_joint', 0, 0.03, 0, 0), 5108.56,
    'WI MFJ $120k → $5,108.56', 0.002);

  // Retiree MFJ $100k incl $40k pension, both age 68 → $48k Act-15 exclusion caps
  // at the $40k pension. agi 60000.
  approx(calculateStateTax(100000, 'Wisconsin', 'married_joint', 0, 0.03, 0, 40000, { primaryAge: 68, spouseAge: 68 }), 1551.85,
    'WI MFJ $100k w/ $40k pension excluded (age 67+) → $1,551.85', 0.002);
}

section('Unit — Maine (3 brackets, federal std ded phaseout, pension deduction)');
{
  // Single $50k. std ded 16100 (federal, no phaseout <$100k); exemption 5150.
  // taxable = 28750. 26800*.058 + (28750-26800)*.0675 = 1554.40 + 131.625 = 1686.03
  approx(calculateStateTax(50000, 'Maine', 'single', 0, 0.03, 0, 0), 1686.03,
    'ME single $50k → $1,686.03', 0.002);

  // MFJ $150k.
  approx(calculateStateTax(150000, 'Maine', 'married_joint', 0, 0.03, 0, 0), 6747.05,
    'ME MFJ $150k → $6,747.05', 0.002);

  // Retiree single $60k incl $10k SS + $25k pension, age 70. SS exempt → agi 50000;
  // pension deduction caps at $25k (cap $48,216-$10k SS, no income phaseout).
  // taxable = 25000-16100-5150 = 3750; *.058 = 217.50
  approx(calculateStateTax(60000, 'Maine', 'single', 0, 0.03, 10000, 25000, { primaryAge: 70 }), 217.50,
    'ME single $60k w/ $10k SS + $25k pension excluded → $217.50', 0.002);
}

// ── 8f. MD / DC / DE / RI progressive state tax engines ──────────────────────
section('Unit — Maryland (8+2 brackets, fixed std ded, pension exclusion; no local)');
{
  // Single $50k. std ded 3350, exemption 3200. taxable = 43450.
  // 20+30+40 + (43450-3000)*.0475 = 90 + 1921.375 = 2011.38 (state only, no county)
  approx(calculateStateTax(50000, 'Maryland', 'single', 0, 0.03, 0, 0), 2011.38,
    'MD single $50k (state only) → $2,011.38', 0.002);

  approx(calculateStateTax(120000, 'Maryland', 'married_joint', 0, 0.03, 0, 0), 5025.25,
    'MD MFJ $120k (state only) → $5,025.25', 0.002);

  // Retiree single $60k incl $10k SS + $25k pension, age 67. SS exempt; pension
  // exclusion caps at $25k ($41,200 - $10k SS). taxable = 25000-3350-3200 = 18450.
  approx(calculateStateTax(60000, 'Maryland', 'single', 0, 0.03, 10000, 25000, { primaryAge: 67 }), 823.88,
    'MD single $60k w/ $10k SS + $25k pension excluded → $823.88', 0.002);
}

section('Unit — District of Columbia (7 brackets, federal std ded, $1,675 exemption)');
{
  // Single $50k. std ded 16100 (federal), exemption 1675. taxable = 32225.
  // 10000*.04 + (32225-10000)*.06 = 400 + 1333.50 = 1733.50
  approx(calculateStateTax(50000, 'District of Columbia', 'single', 0, 0.03, 0, 0), 1733.50,
    'DC single $50k → $1,733.50', 0.002);

  approx(calculateStateTax(120000, 'District of Columbia', 'married_joint', 0, 0.03, 0, 0), 5578.25,
    'DC MFJ $120k → $5,578.25', 0.002);

  // $250k spans into the 8.5% bracket.
  approx(calculateStateTax(250000, 'District of Columbia', 'single', 0, 0.03, 0, 0), 18139.13,
    'DC single $250k → $18,139.13', 0.002);
}

section('Unit — Delaware (6 brackets first $2k untaxed, credit exemption, pension excl)');
{
  // Single $50k. std ded 3250; taxable = 46750. Bracket tax 2208.125 − $110 credit = 2098.13
  approx(calculateStateTax(50000, 'Delaware', 'single', 0, 0.03, 0, 0), 2098.13,
    'DE single $50k → $2,098.13', 0.002);

  approx(calculateStateTax(120000, 'Delaware', 'married_joint', 0, 0.03, 0, 0), 6254.50,
    'DE MFJ $120k → $6,254.50', 0.002);

  // Retiree single $60k incl $15k pension, age 65. $12,500 pension exclusion +
  // $2,500 age-65 additional std deduction. agi = 60000-12500-2500 = 45000.
  approx(calculateStateTax(60000, 'Delaware', 'single', 0, 0.03, 0, 15000, { primaryAge: 65 }), 1820.63,
    'DE single $60k w/ $15k pension (age 65) → $1,820.63', 0.002);
}

section('Unit — Rhode Island (3 brackets, taxes SS, pension modification at FRA)');
{
  // Single $50k. std ded 10900, exemption 5100. taxable = 34000. *.0375 = 1275.00
  approx(calculateStateTax(50000, 'Rhode Island', 'single', 0, 0.03, 0, 0), 1275.00,
    'RI single $50k → $1,275.00', 0.002);

  approx(calculateStateTax(150000, 'Rhode Island', 'married_joint', 0, 0.03, 0, 0), 4806.00,
    'RI MFJ $150k → $4,806.00', 0.002);

  // Retiree single $60k incl $10k SS (RI TAXES SS → not subtracted) + $20k pension,
  // age 67, AGI under $107k limit → $20k pension excluded. taxable = 40000-10900-5100.
  approx(calculateStateTax(60000, 'Rhode Island', 'single', 0, 0.03, 10000, 20000, { primaryAge: 67 }), 900.00,
    'RI single $60k w/ $20k pension excl (SS still taxed) → $900.00', 0.002);
}

// ── 8g. AR / KS / NE / NM / ND / OK / SC / VT / WV progressive engines ───────
section('Unit — Arkansas (3 brackets w/ 4%>3.9% quirk, $29 credit, $6k retire excl)');
{
  // Single $50k. std 2400; taxable 47600. 90+176+(38700)*.039 = 1775.30 − $29 = 1746.30
  approx(calculateStateTax(50000, 'Arkansas', 'single', 0, 0.03, 0, 0), 1746.30,
    'AR single $50k → $1,746.30', 0.002);

  approx(calculateStateTax(120000, 'Arkansas', 'married_joint', 0, 0.03, 0, 0), 4353.70,
    'AR MFJ $120k → $4,353.70', 0.002);

  // Retiree single $60k incl $10k SS + $20k pension, age 65. SS exempt → 50000;
  // $6k retirement exclusion → agi 44000; taxable 41600.
  approx(calculateStateTax(60000, 'Arkansas', 'single', 0, 0.03, 10000, 20000, { primaryAge: 65 }), 1512.30,
    'AR single $60k w/ SS+$6k retire excl → $1,512.30', 0.002);
}

section('Unit — Kansas (2 brackets 5.2/5.58%, $9,160 exemption, SS exempt)');
{
  // Single $50k. std 3605 + exemption 9160; taxable 37235. 1196 + 14235*.0558 = 1990.31
  approx(calculateStateTax(50000, 'Kansas', 'single', 0, 0.03, 0, 0), 1990.31,
    'KS single $50k → $1,990.31', 0.002);

  approx(calculateStateTax(120000, 'Kansas', 'married_joint', 0, 0.03, 0, 0), 5039.15,
    'KS MFJ $120k → $5,039.15', 0.002);

  // Retiree single $60k incl $10k SS + $20k pension. SS exempt → 50000 (pension
  // taxed by KS); same taxable as $50k case → $1,990.31.
  approx(calculateStateTax(60000, 'Kansas', 'single', 0, 0.03, 10000, 20000, { primaryAge: 67 }), 1990.31,
    'KS single $60k SS-exempt (pension taxed) → $1,990.31', 0.002);
}

section('Unit — Nebraska (2026 top 4.55%, $157 credit, SS exempt)');
{
  // Single $50k. std 7900; taxable 42100. 91.02+648.297+906.815 = 1646.13 − $157 = 1489.13
  approx(calculateStateTax(50000, 'Nebraska', 'single', 0, 0.03, 0, 0), 1489.13,
    'NE single $50k → $1,489.13', 0.002);

  approx(calculateStateTax(120000, 'Nebraska', 'married_joint', 0, 0.03, 0, 0), 3888.27,
    'NE MFJ $120k → $3,888.27', 0.002);

  approx(calculateStateTax(60000, 'Nebraska', 'single', 0, 0.03, 10000, 20000, { primaryAge: 67 }), 1489.13,
    'NE single $60k SS-exempt (pension taxed) → $1,489.13', 0.002);
}

section('Unit — New Mexico (5 brackets, federal std ded, TAXES SS)');
{
  // Single $50k. std 16100 (federal); taxable 33900. 93.5+176+235+17900*.049 = 1381.60
  approx(calculateStateTax(50000, 'New Mexico', 'single', 0, 0.03, 0, 0), 1381.60,
    'NM single $50k → $1,381.60', 0.002);

  approx(calculateStateTax(120000, 'New Mexico', 'married_joint', 0, 0.03, 0, 0), 3894.20,
    'NM MFJ $120k → $3,894.20', 0.002);

  // Retiree single $60k incl $10k SS — NM TAXES SS so full $60k less fed std ded.
  approx(calculateStateTax(60000, 'New Mexico', 'single', 0, 0.03, 10000, 20000, { primaryAge: 67 }), 1871.60,
    'NM single $60k (SS taxed) → $1,871.60', 0.002);
}

section('Unit — North Dakota (0% bottom bracket, federal std ded, SS exempt)');
{
  // Single $100k. std 16100; taxable 83900. (83900-44725)*.0195 = 763.91
  approx(calculateStateTax(100000, 'North Dakota', 'single', 0, 0.03, 0, 0), 763.91,
    'ND single $100k → $763.91', 0.002);

  approx(calculateStateTax(200000, 'North Dakota', 'married_joint', 0, 0.03, 0, 0), 1814.48,
    'ND MFJ $200k → $1,814.48', 0.002);

  // Retiree single $80k incl $10k SS. SS exempt → 70000; taxable 53900.
  approx(calculateStateTax(80000, 'North Dakota', 'single', 0, 0.03, 10000, 20000, { primaryAge: 67 }), 178.91,
    'ND single $80k w/ SS exempt → $178.91', 0.002);
}

section('Unit — Oklahoma (6 fixed brackets, $1k exemption, $10k retire excl)');
{
  // Single $50k. std 6350 + exemption 1000; taxable 42650. 153.5 + 35450*.0475 = 1837.38
  approx(calculateStateTax(50000, 'Oklahoma', 'single', 0, 0.03, 0, 0), 1837.38,
    'OK single $50k → $1,837.38', 0.002);

  approx(calculateStateTax(120000, 'Oklahoma', 'married_joint', 0, 0.03, 0, 0), 4624.75,
    'OK MFJ $120k → $4,624.75', 0.002);

  // Retiree single $60k incl $10k SS + $20k pension, age 67. SS exempt → 50000;
  // $10k retirement exclusion → 40000; taxable 32650.
  approx(calculateStateTax(60000, 'Oklahoma', 'single', 0, 0.03, 10000, 20000, { primaryAge: 67 }), 1362.38,
    'OK single $60k w/ SS+$10k retire excl → $1,362.38', 0.002);
}

section('Unit — South Carolina (top 6%, federal std ded, $10k/$15k retire excl)');
{
  // Single $50k. std 16100; taxable 33900. 14270*.03 + 16070*.06 = 1392.30
  approx(calculateStateTax(50000, 'South Carolina', 'single', 0, 0.03, 0, 0), 1392.30,
    'SC single $50k → $1,392.30', 0.002);

  approx(calculateStateTax(120000, 'South Carolina', 'married_joint', 0, 0.03, 0, 0), 4626.30,
    'SC MFJ $120k → $4,626.30', 0.002);

  // Retiree single $60k incl $10k SS + $20k pension, age 67. SS exempt → 50000;
  // $15k (65+) retirement exclusion → 35000; taxable 18900.
  approx(calculateStateTax(60000, 'South Carolina', 'single', 0, 0.03, 10000, 20000, { primaryAge: 67 }), 492.30,
    'SC single $60k w/ SS+$15k retire excl → $492.30', 0.002);
}

section('Unit — Vermont (4 brackets, $4,850 exemption, TAXES SS)');
{
  // Single $50k. std 7000 + exemption 4850; taxable 38150. *.0335 = 1278.03
  approx(calculateStateTax(50000, 'Vermont', 'single', 0, 0.03, 0, 0), 1278.03,
    'VT single $50k → $1,278.03', 0.002);

  approx(calculateStateTax(150000, 'Vermont', 'married_joint', 0, 0.03, 0, 0), 5867.38,
    'VT MFJ $150k → $5,867.38', 0.002);

  // Retiree single $60k incl $10k SS — VT TAXES SS; taxable 48150 spans 2nd bracket.
  approx(calculateStateTax(60000, 'Vermont', 'single', 0, 0.03, 10000, 20000, { primaryAge: 67 }), 1702.40,
    'VT single $60k (SS taxed) → $1,702.40', 0.002);
}

section('Unit — West Virginia (no std ded, $2k exemption, SS exempt 2026, $8k 65+)');
{
  // Single $50k. exemption 2000; taxable 48000. 222+444+499.5+8000*.044 = 1517.50
  approx(calculateStateTax(50000, 'West Virginia', 'single', 0, 0.03, 0, 0), 1517.50,
    'WV single $50k → $1,517.50', 0.002);

  approx(calculateStateTax(120000, 'West Virginia', 'married_joint', 0, 0.03, 0, 0), 4744.70,
    'WV MFJ $120k → $4,744.70', 0.002);

  // Retiree single $60k incl $10k SS + $20k pension, age 67. SS exempt (2026!) →
  // 50000; $8k over-65 exclusion → 42000; exemption 2000; taxable 40000.
  approx(calculateStateTax(60000, 'West Virginia', 'single', 0, 0.03, 10000, 20000, { primaryAge: 67 }), 1165.50,
    'WV single $60k w/ SS exempt + $8k 65+ → $1,165.50', 0.002);
}

// ── 9. ACA subsidy cliff (2026 post-ARPA law: Rev. Proc. 2025-25) ─────────────
section('Unit — calculateACASubsidy thresholds (2026 law)');
{
  // FPL (2025 HHS guidelines, governing 2026 coverage): household 1 = $15,650,
  // 4 = $32,150, 8 = $54,150. Above 400% FPL: HARD CLIFF, no credit at all.
  const below = calculateACASubsidy(10000, 1, 'single');
  eq(below.eligible, false, '<100% FPL → ineligible');
  const at100 = calculateACASubsidy(15650, 1, 'single');
  eq(at100.eligible, true, '100% FPL → eligible');
  eq(at100.tier, 'Silver 94', '100% FPL tier = Silver 94');
  approx(at100.premiumCap, 2.10, '100% FPL required contribution = 2.10% of MAGI', 0.01);
  // 150% FPL: top of the 133–150 band → 4.19%
  const at150 = calculateACASubsidy(15650 * 1.5, 1, 'single');
  approx(at150.premiumCap, 4.19, '150% FPL contribution = 4.19%', 0.01);
  // 250% FPL: 8.44%
  const at250 = calculateACASubsidy(15650 * 2.5, 1, 'single');
  approx(at250.premiumCap, 8.44, '250% FPL contribution = 8.44%', 0.01);
  // 300–400% FPL: flat 9.96%
  const at350 = calculateACASubsidy(15650 * 3.5, 1, 'single');
  approx(at350.premiumCap, 9.96, '350% FPL contribution = 9.96%', 0.01);
  // Above 400% FPL: the cliff is BACK (ARPA/IRA enhancement expired 12/31/2025)
  const above400 = calculateACASubsidy(15650 * 4.01, 1, 'single');
  eq(above400.eligible, false, '>400% FPL → INELIGIBLE (2026 cliff)');
  // Household size handling: size 4 uses larger FPL
  const family100 = calculateACASubsidy(32150, 4, 'married_joint');
  eq(family100.eligible, true, 'family of 4 at $32,150 → 100% FPL → eligible');
  // Household size > 8 capped at 8
  const big = calculateACASubsidy(54150, 12, 'married_joint');
  eq(big.fplPercent, 100, 'household 12 capped to household 8 FPL ($54,150)');
}

section('P2 — calculateACAPremiumCredit (dollar credit + cliff)');
{
  const { calculateACAPremiumCredit } = engine;
  // Single, MAGI exactly 2× FPL ($31,300), benchmark $14,000.
  // Contribution = 6.60% × 31,300 = $2,065.80 → subsidy = 14,000 − 2,065.80.
  const mid = calculateACAPremiumCredit({ magi: 31300, householdSize: 1, benchmarkPremium: 14000 });
  approx(mid.subsidy, 14000 - 31300 * 0.066, '200% FPL: subsidy = benchmark − 6.60% of MAGI', 0.005);
  approx(mid.netPremium, 31300 * 0.066, '200% FPL: net premium = required contribution', 0.005);
  // One dollar over the cliff: subsidy vanishes entirely.
  const cliffEdge = 15650 * 4;
  const under = calculateACAPremiumCredit({ magi: cliffEdge - 1, householdSize: 1, benchmarkPremium: 14000 });
  const over = calculateACAPremiumCredit({ magi: cliffEdge + 1, householdSize: 1, benchmarkPremium: 14000 });
  gt(under.subsidy, 7000, 'just under 400% FPL: substantial subsidy remains');
  eq(over.subsidy, 0, 'just over 400% FPL: subsidy = 0 (hard cliff)');
  eq(over.cliff, true, 'cliff flag set above 400%');
  eq(over.netPremium, 14000, 'above cliff: full benchmark premium due');
  // FPL indexes forward: same REAL income 10 years out keeps the same % of FPL.
  const later = calculateACAPremiumCredit({ magi: 31300 * Math.pow(1.03, 10), householdSize: 1, benchmarkPremium: 14000, yearsFromNow: 10, inflationRate: 0.03 });
  approx(later.fplPercent, 200, 'inflation-scaled MAGI stays at 200% FPL 10 years out', 0.01);
}

section('P2 — ACA premiums wired into projections (pre65Coverage: aca)');
{
  // Retired couple, both 60 (pre-65). Brokerage-first withdrawals (30% basis)
  // keep MAGI ≈ pension $20k + realized gains ≈ $55-65k — inside the 100–400%
  // FPL band (household-2 cliff ≈ $84.6k), so a subsidy exists. (Pre-tax-first
  // at $60k spending lands ON the cliff — a correct but useless test point.)
  const mk = (overrides = {}) => baseScenario({
    healthcareModel: 'basic', pre65Coverage: 'aca', acaBenchmarkPremium: 14000,
    pre65HealthcareAnnual: 10000, medicalInflation: 0.05,
    desiredRetirementIncome: 50000,
    withdrawalPriority: ['brokerage', 'pretax', 'roth'],
    ...overrides,
  });
  const { pi, accts, streams } = mk();
  const proj = computeProjections(pi, accts, streams, [], [], [], TODAY_YEAR);
  const y0 = proj[0];
  gt(y0.acaGrossPremium, 27999, 'two under-65 retirees → gross benchmark = 2 × $14k');
  gt(y0.acaSubsidy, 0, 'subsidy present at moderate MAGI');
  eq(y0.acaNetPremium, y0.acaGrossPremium - y0.acaSubsidy, 'net = gross − subsidy', 1);
  eq(y0.healthcarePre65, y0.acaNetPremium, 'pre-65 healthcare = ACA net premium (no flat cost double-charge)', 1);
  // At 65+ the ACA fields go quiet (Medicare takes over).
  const y65 = proj.find(r => r.myAge === 65);
  eq(y65.acaGrossPremium, 0, 'no ACA premium once both are 65');

  // Flat mode (default) must be unaffected by the new fields' presence.
  const { pi: piFlat, accts: aF, streams: sF } = mk({ pre65Coverage: 'flat' });
  const projFlat = computeProjections(piFlat, aF, sF, [], [], [], TODAY_YEAR);
  eq(projFlat[0].acaGrossPremium, 0, 'flat mode → no ACA pricing');
  eq(projFlat[0].healthcarePre65, Math.round(2 * 10000), 'flat mode → flat pre-65 cost, both persons', 1);

  // A large Roth conversion in an ACA year reduces (or kills) the subsidy.
  const { pi: piConv, accts: aC, streams: sC } = mk({ rothConversionAmount: 100000, rothConversionStartAge: 60, rothConversionEndAge: 64 });
  const projConv = computeProjections(piConv, aC, sC, [], [], [], TODAY_YEAR);
  lt(projConv[0].acaSubsidy, y0.acaSubsidy, 'Roth conversion raises MAGI → smaller ACA subsidy');
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

// ── MC NaN guard: a sub-(-100%) return draw depletes, never goes NaN ──────────
// Regression for the Monte Carlo bug where an unbounded return draw below -100%
// made Math.pow(1+r, 0.5) NaN. The worker's `portfolio <= 0` survival check is
// false for NaN, so a blown-up sim was silently tallied as a SUCCESS. The engine
// now clamps the per-year growth rate at -1, so a catastrophic year depletes the
// portfolio to 0 (a real failure) instead of poisoning the path with NaN.
section('MC NaN guard — sub-(-100%) return depletes, never NaN');
{
  const s = baseScenario({ myRetirementAge: 60, legacyAge: 95 });
  const overrides = [];
  for (let y = 0; y < 40; y++) overrides[y] = { marketReturn: -1.5, inflation: 0.03 };
  const proj = computeProjections(
    s.pi, s.accts, s.streams, s.assets, s.events, s.recurring, TODAY_YEAR,
    { yearOverrides: overrides }
  );
  const allFinite = proj.every(r => Number.isFinite(r.totalPortfolio));
  eq(allFinite, true, 'every projection year has a finite totalPortfolio (no NaN)');
  const last = proj[proj.length - 1];
  eq(Number.isFinite(last.totalPortfolio), true, 'final totalPortfolio is numeric');
  lt(last.totalPortfolio, 1, 'catastrophic returns deplete the portfolio (real failure, not phantom survival)');
}

// ── weightedCAGR: reinvestment pool must not dilute the weighted rate ─────────
// Regression for the denominator bug: the numerator summed only real accounts but
// the denominator included the excess-RMD reinvestment pool, pulling weightedCAGR
// below the true balance-weighted average. With a single account, the answer must
// equal that account's cagr exactly — no matter how large the pool grows.
section('weightedCAGR — excess reinvestment pool must not dilute the rate');
{
  const s = baseScenario({
    myAge: 75, spouseAge: 75,
    myRetirementAge: 65, spouseRetirementAge: 65,
    myBirthYear: TODAY_YEAR - 75, spouseBirthYear: TODAY_YEAR - 75,
    desiredRetirementIncome: 20000, // far below RMDs on $2M → excess reinvested into the pool
    legacyAge: 90,
  });
  // One pre-tax account, no brokerage/roth → excess RMDs accumulate in the reinvestment pool.
  s.accts = [
    { id: 1, name: '401k', type: '401k', balance: 2000000, contribution: 0, contributionGrowth: 0, cagr: 0.06, startAge: 65, stopAge: 65, owner: 'me', contributor: 'me' },
  ];
  s.streams = [];
  const proj = computeProjections(s.pi, s.accts, s.streams, s.assets, s.events, s.recurring, TODAY_YEAR);
  const late = proj.find(r => r.myAge === 85);
  gt(late.weightedCAGR, 0.0599, 'weightedCAGR equals the sole account cagr (not diluted by the pool)');
  lt(late.weightedCAGR, 0.0601, 'weightedCAGR is not inflated either');
}

// ── survivor spending step-down ──────────────────────────────────────────────
// When exactly one spouse is alive under survivor modeling, household spending
// drops to survivorSpendingFactor × the couple's target (default 0.75).
section('survivor spending step-down (survivorSpendingFactor)');
{
  const common = {
    survivorModelEnabled: true,
    spouseLifeExpectancy: 70,
    myLifeExpectancy: 95,
  };
  // Baseline: survivor modeling off — desiredIncome never steps down.
  const sOff = baseScenario({ ...common, survivorModelEnabled: false });
  const projOff = run(sOff, 95);
  // Default factor (0.75).
  const sDef = baseScenario({ ...common });
  const projDef = run(sDef, 95);
  // Custom factor (0.60).
  const sCustom = baseScenario({ ...common, survivorSpendingFactor: 0.60 });
  const projCustom = run(sCustom, 95);

  // Pick a year well after the first death (spouse dies at 70, single thereafter).
  const yr = 80;
  const off = projOff.find(r => r.spouseAge === yr);
  const def = projDef.find(r => r.spouseAge === yr);
  const cust = projCustom.find(r => r.spouseAge === yr);
  // Same calendar year & inflation in all runs → ratio isolates the spend factor.
  approx(def.desiredIncome / off.desiredIncome, 0.75, 'default survivor spending is 75% of couple target', 0.001);
  approx(cust.desiredIncome / off.desiredIncome, 0.60, 'custom survivor spending factor (0.60) honored', 0.001);

  // Before the first death, both alive → no step-down.
  const before = projDef.find(r => r.spouseAge === 65);
  const beforeOff = projOff.find(r => r.spouseAge === 65);
  approx(before.desiredIncome / beforeOff.desiredIncome, 1.0, 'no step-down while both spouses alive', 0.001);
}

// ── Roth conversion pre-tax floor (QCD / low-bracket preservation) ───────────
// rothConversionPreTaxFloor preserves a today's-$ pre-tax balance: conversions
// stop once total pre-tax would drop below the (inflation-adjusted) floor, while
// spending/RMD withdrawals are untouched. Built so pre-tax is only moved by
// conversions: inflation 0 (floor stays nominal), pre-tax cagr 0 (predictable),
// brokerage-first priority + brokerage tax source + no RMDs in the window.
section('Roth conversion — pre-tax floor caps conversions');
{
  const makeFloorScenario = (floor) => ({
    myAge: 65, spouseAge: 65, myRetirementAge: 65, spouseRetirementAge: 65,
    myBirthYear: TODAY_YEAR - 65, spouseBirthYear: TODAY_YEAR - 65,
    filingStatus: 'married_joint', state: 'Florida',
    desiredRetirementIncome: 40000,
    inflationRate: 0,                                  // floor stays nominal
    withdrawalPriority: ['brokerage', 'roth', 'pretax'], // spending avoids pre-tax
    charitableGivingPercent: 0,
    rothConversionAmount: 200000,                      // fixed $200k/yr
    rothConversionStartAge: 65, rothConversionEndAge: 72, // before RMD age (73)
    rothConversionBracket: '',
    rothConversionTaxSource: 'brokerage',             // tax avoids pre-tax too
    rothConversionPreTaxFloor: floor,
    legacyAge: 75, survivorModelEnabled: false,
    myLifeExpectancy: 95, spouseLifeExpectancy: 95,
    healthcareModel: 'none', pre65HealthcareAnnual: 0, post65OOPAnnual: 0,
    includeMedigap: false, ltcModel: 'none', ltcMonthlyAmount: 0, ltcDurationMonths: 0,
    medicalInflation: 0.05,
  });
  const floorAccts = () => ([
    { id: 1, name: '401k', type: '401k', balance: 1000000, contribution: 0, contributionGrowth: 0, cagr: 0, startAge: 65, stopAge: 65, owner: 'me', contributor: 'me' },
    { id: 2, name: 'Brok', type: 'brokerage', balance: 3000000, contribution: 0, contributionGrowth: 0, cagr: 0, costBasisPercent: 0.5, startAge: 65, stopAge: 65, owner: 'me', contributor: 'me' },
    { id: 3, name: 'Roth', type: 'roth_ira', balance: 0, contribution: 0, contributionGrowth: 0, cagr: 0, startAge: 65, stopAge: 65, owner: 'me', contributor: 'me' },
  ]);
  const sumConv = (proj, a, b) => proj.filter(r => r.myAge >= a && r.myAge <= b)
    .reduce((s, r) => s + (r.rothConversion || 0), 0);

  // (c) Floor of $400k: $1M pre-tax converts down to $400k then stops.
  const projFloor = computeProjections(makeFloorScenario(400000), floorAccts(), [], [], [], [], TODAY_YEAR);
  const yFloorEnd = projFloor.find(r => r.myAge === 72);
  approx(yFloorEnd.preTaxBalance, 400000, 'pre-tax bottoms out at the $400k floor (not below)', 0.02);
  approx(sumConv(projFloor, 65, 72), 600000, 'only ~$600k converted (down to the floor), not the full $1M', 0.02);
  // Floor is never breached by conversions in any window year.
  const breached = projFloor.filter(r => r.myAge >= 65 && r.myAge <= 72)
    .some(r => r.preTaxBalance < 400000 - 1);
  eq(breached, false, 'no window year drops pre-tax below the floor');

  // No-floor baseline converts much further (pre-tax nearly depleted).
  const projNoFloor = computeProjections(makeFloorScenario(0), floorAccts(), [], [], [], [], TODAY_YEAR);
  const yNoFloorEnd = projNoFloor.find(r => r.myAge === 72);
  lt(yNoFloorEnd.preTaxBalance, 50000, 'without a floor, pre-tax is nearly fully converted away');
  gt(yFloorEnd.preTaxBalance - yNoFloorEnd.preTaxBalance, 350000, 'floor preserves >$350k more pre-tax than no floor');

  // (b) Floor above the starting balance ⇒ zero conversions.
  const projHugeFloor = computeProjections(makeFloorScenario(5000000), floorAccts(), [], [], [], [], TODAY_YEAR);
  eq(sumConv(projHugeFloor, 65, 72), 0, 'floor above pre-tax balance ⇒ no conversions at all');
  approx(projHugeFloor.find(r => r.myAge === 72).preTaxBalance, 1000000, 'pre-tax untouched when floor ≥ balance', 0.02);

  // (a) Explicit floor:0 is identical to omitting the field (no regression).
  const sOmit = makeFloorScenario(0); delete sOmit.rothConversionPreTaxFloor;
  const projOmit = computeProjections(sOmit, floorAccts(), [], [], [], [], TODAY_YEAR);
  eq(projOmit.find(r => r.myAge === 72).preTaxBalance, yNoFloorEnd.preTaxBalance,
    'floor:0 and omitted floor produce identical pre-tax balances');
  eq(projOmit.find(r => r.myAge === 72).rothBalance, yNoFloorEnd.rothBalance,
    'floor:0 and omitted floor produce identical Roth balances');
}

// ── R2026-07 review fixes ─────────────────────────────────────────────────────
section('R2026-07a — taxable SS uses AGI net of pre-tax contributions (Pub 915)');
{
  // Age 68, still working (retires at 75), collecting SS since 67, deferring
  // $12k into a 401k. Combined income must use AGI (salary MINUS the deferral):
  //   net:   18,000 + 10,000 = 28,000 → phase-in band → taxable SS = 1,500
  //   gross: 30,000 + 10,000 = 40,000 → 85% band     → taxable SS = 9,600 (old bug)
  const pi = {
    myAge: 68, spouseAge: 68, myRetirementAge: 75, spouseRetirementAge: 75,
    myBirthYear: TODAY_YEAR - 68, spouseBirthYear: TODAY_YEAR - 68,
    filingStatus: 'single', state: 'Florida',
    desiredRetirementIncome: 40000, inflationRate: 0.03,
    withdrawalPriority: ['pretax', 'brokerage', 'roth'],
    charitableGivingPercent: 0, rothConversionAmount: 0,
    rothConversionStartAge: 0, rothConversionEndAge: 0, rothConversionBracket: '',
    legacyAge: 95, survivorModelEnabled: false,
    myLifeExpectancy: 95, spouseLifeExpectancy: 95, healthcareModel: 'none', ltcModel: 'none',
  };
  const accts = [
    { id: 1, name: '401k', type: '401k', balance: 300000, contribution: 12000, contributionGrowth: 0, cagr: 0.06, startAge: 60, stopAge: 75, owner: 'me', contributor: 'me' },
  ];
  const streams = [
    { id: 1, name: 'Salary', type: 'earned_income', amount: 30000, startAge: 60, endAge: 74, cola: 0, owner: 'me' },
    { id: 2, name: 'SS', type: 'social_security', amount: 20000, startAge: 67, endAge: 95, cola: 0, owner: 'me' },
  ];
  const proj = computeProjections(pi, accts, streams, [], [], [], TODAY_YEAR);
  const y0 = proj[0];
  eq(y0.preTaxDeduction, 12000, 'pre-tax deferral recognized as above-the-line deduction');
  eq(y0.taxableSS, 1500, 'taxable SS computed on deduction-adjusted combined income', 1);
  // Direct cross-check against the Pub 915 helper on the net base.
  eq(y0.taxableSS, Math.round(calculateSocialSecurityTaxableAmount(20000, 18000, 'single')),
    'engine taxableSS matches helper called with AGI-net other income', 1);
  eq(y0.taxableIncome, 18000 + 1500, 'federal taxable income = net non-SS income + taxable SS', 1);
}

section('R2026-07b — IRMAA premium dollars index forward with the thresholds');
{
  // Base year: single, MAGI $300k → tier 4 (Part B 649.20, Part D 83.30).
  // Surcharge = (649.20 − 202.90) × 12 + 83.30 × 12 = 6,355.2/yr.
  const s0 = calculateIRMAASurcharge(300000, 'single', 0, 0.03, 1);
  eq(s0.totalSurcharge, 6355, 'base-year surcharge unchanged by the indexing fix', 1);
  eq(s0.tier, 4, 'MAGI $300k lands in tier 4 (single)');
  // 20 years out with the same REAL income (MAGI scaled by inflation): the tier is
  // unchanged and the nominal surcharge scales by the same inflation factor.
  const factor = Math.pow(1.03, 20);
  const s20 = calculateIRMAASurcharge(300000 * factor, 'single', 20, 0.03, 1);
  eq(s20.tier, 4, 'inflation-scaled MAGI stays in the same tier 20 years out');
  approx(s20.totalSurcharge, 6355.2 * factor, 'surcharge scales with inflation (was frozen at base-year dollars)', 0.005);
  // The IRMAA detail premiums scale too (consumed by display + healthcare totals).
  const d20 = calculateIRMAA(300000 * factor, 'single', 20, 0.03);
  approx(d20.partBMonthly, 649.20 * factor, 'Part B tier premium indexed', 0.005);
  approx(d20.partDMonthly, 83.30 * factor, 'Part D surcharge indexed', 0.005);
}

section('R2026-07c — recurring expenses step down for the survivor');
{
  // Unit: the survivor spend factor scales the total (default arg = 1 → unchanged).
  const exps = [{ id: 1, name: 'Property Tax', category: 'housing', amount: 10000, startAge: 60, endAge: 95, inflationRate: 0, owner: 'me' }];
  eq(engine.calculateRecurringExpenses(exps, 70, 70, 0, 0.03).total, 10000, 'no factor → unchanged (backward compatible)');
  eq(engine.calculateRecurringExpenses(exps, 70, 70, 0, 0.03, 0.75).total, 7500, 'factor 0.75 scales recurring total');

  // Integration: survivor modeling on, spouse dies at 80 → household recurring
  // expenses get the same 75% step-down as base spending from the death year on.
  const { pi, accts, streams } = baseScenario({
    myAge: 70, spouseAge: 70,
    myBirthYear: TODAY_YEAR - 70, spouseBirthYear: TODAY_YEAR - 70,
    myRetirementAge: 70, spouseRetirementAge: 70,
    survivorModelEnabled: true, myLifeExpectancy: 95, spouseLifeExpectancy: 80,
  });
  const proj = computeProjections(pi, accts, streams, [], [], exps, TODAY_YEAR);
  const before = proj.find(r => r.spouseAge === 79);
  const after = proj.find(r => r.spouseAge === 80);
  eq(before.recurringExpenses, 10000, 'both alive → full recurring expense');
  eq(after.recurringExpenses, 7500, 'survivor year → recurring expense × survivorSpendingFactor');
}

section('R2026-07d — weightedCAGR survives an account with no cagr');
{
  const { pi } = baseScenario();
  const accts = [
    { id: 1, name: 'No-cagr brokerage', type: 'brokerage', balance: 100000, contribution: 0, contributionGrowth: 0, startAge: 60, stopAge: 60, owner: 'me', contributor: 'me' }, // cagr intentionally missing
    { id: 2, name: '401k', type: '401k', balance: 100000, contribution: 0, contributionGrowth: 0, cagr: 0.06, startAge: 60, stopAge: 60, owner: 'me', contributor: 'me' },
  ];
  const proj = computeProjections(pi, accts, [], [], [], [], TODAY_YEAR);
  eq(Number.isFinite(proj[0].weightedCAGR), true, 'weightedCAGR is finite with a missing cagr (was NaN)');
  gt(proj[0].weightedCAGR, 0, 'weighted rate reflects the account that HAS a cagr');
}

// ── P1 — spending phases (go-go / slow-go / no-go) ────────────────────────────
section('P1 — getSpendingPhaseMultiplier band boundaries');
{
  const pi = { spendingPhasesEnabled: true, goGoEndAge: 75, slowGoEndAge: 85, goGoMultiplier: 1.0, slowGoMultiplier: 0.85, noGoMultiplier: 0.75 };
  eq(engine.getSpendingPhaseMultiplier(pi, 65), 1.0, 'age 65 → go-go');
  eq(engine.getSpendingPhaseMultiplier(pi, 75), 1.0, 'age 75 (boundary, inclusive) → go-go');
  eq(engine.getSpendingPhaseMultiplier(pi, 76), 0.85, 'age 76 → slow-go');
  eq(engine.getSpendingPhaseMultiplier(pi, 85), 0.85, 'age 85 (boundary, inclusive) → slow-go');
  eq(engine.getSpendingPhaseMultiplier(pi, 86), 0.75, 'age 86 → no-go');
  eq(engine.getSpendingPhaseMultiplier({ ...pi, spendingPhasesEnabled: false }, 86), 1, 'disabled → always 1');
  eq(engine.getSpendingPhaseMultiplier({}, 86), 1, 'fields absent (pre-feature plan) → always 1');
}

section('P1 — desiredIncome steps down across phase boundaries');
{
  const { pi, accts, streams } = baseScenario({
    spendingPhasesEnabled: true, goGoEndAge: 75, slowGoEndAge: 85,
    goGoMultiplier: 1.0, slowGoMultiplier: 0.85, noGoMultiplier: 0.75,
  });
  const proj = computeProjections(pi, accts, streams, [], [], [], TODAY_YEAR);
  const expected = (age, mult) => Math.round(60000 * Math.pow(1.03, age - 60) * mult);
  eq(proj.find(r => r.myAge === 74).desiredIncome, expected(74, 1.0), 'age 74 spends full go-go target', 1);
  eq(proj.find(r => r.myAge === 76).desiredIncome, expected(76, 0.85), 'age 76 spends 85% (slow-go)', 1);
  eq(proj.find(r => r.myAge === 86).desiredIncome, expected(86, 0.75), 'age 86 spends 75% (no-go)', 1);

  // Disabled (or fields absent) must be byte-identical to the pre-feature engine.
  const { pi: piOff, accts: aOff, streams: sOff } = baseScenario();
  const projOff = computeProjections(piOff, aOff, sOff, [], [], [], TODAY_YEAR);
  eq(projOff.find(r => r.myAge === 76).desiredIncome, expected(76, 1.0), 'feature absent → flat spending unchanged', 1);
  // Lower late-life spending must preserve more portfolio.
  gt(proj.find(r => r.myAge === 90).totalPortfolio, projOff.find(r => r.myAge === 90).totalPortfolio,
    'phased spending preserves more portfolio by age 90 than flat spending');
}

// ── P3 — Roth conversion optimizer scoring ────────────────────────────────────
section('P3 — scoreRothStrategy (Roth optimizer scoring)');
{
  const { scoreRothStrategy } = engine;
  const proj = [
    { myAge: 94, totalTax: 10000, irmaaSurcharge: 1000, acaSubsidy: 0, rothConversion: 50000, preTaxBalance: 500000, rothBalance: 300000, brokerageBalance: 200000, totalPortfolio: 1000000 },
    { myAge: 95, totalTax: 12000, irmaaSurcharge: 2000, acaSubsidy: 3000, rothConversion: 0, preTaxBalance: 400000, rothBalance: 350000, brokerageBalance: 250000, totalPortfolio: 1000000 },
  ];
  const s = scoreRothStrategy(proj, { legacyAge: 95, retirementAge: 90, heirTaxRate: 0.25 });
  eq(s.afterTaxLegacy, Math.round(350000 + 250000 + 400000 * 0.75), 'after-tax legacy discounts pre-tax by heir rate');
  eq(s.lifetimeTax, 22000, 'lifetime tax sums retirement years');
  eq(s.lifetimeIRMAA, 3000, 'lifetime IRMAA sums retirement years');
  eq(s.lifetimeACASubsidy, 3000, 'lifetime ACA subsidy sums retirement years');
  eq(s.lifetimeConversions, 50000, 'lifetime conversions sum');
  // Legacy row missing (e.g. survivor-mode early termination) → falls back to last row.
  const s2 = scoreRothStrategy(proj, { legacyAge: 99, retirementAge: 90, heirTaxRate: 0 });
  eq(s2.afterTaxLegacy, 400000 + 350000 + 250000, 'missing legacy row → final row; 0% heir rate = face value');
}

section('P3 — bracket-fill strategy vs baseline (integration)');
{
  // $1M pre-tax + modest spending: filling the 12% bracket during the
  // retirement→RMD window should beat no-conversions on after-tax legacy when
  // heirs would pay 25% — the canonical case for Roth conversions.
  const { pi, accts, streams } = baseScenario();
  const noConv = computeProjections(pi, accts, streams, [], [], [], TODAY_YEAR);
  const { pi: piConv, accts: aC, streams: sC } = baseScenario({ rothConversionBracket: '12%', rothConversionStartAge: 60, rothConversionEndAge: 72 });
  const conv = computeProjections(piConv, aC, sC, [], [], [], TODAY_YEAR);
  const sNo = engine.scoreRothStrategy(noConv, { legacyAge: 95, retirementAge: 60, heirTaxRate: 0.25 });
  const sConv = engine.scoreRothStrategy(conv, { legacyAge: 95, retirementAge: 60, heirTaxRate: 0.25 });
  gt(sConv.lifetimeConversions, 0, '12% bracket-fill executes conversions');
  gt(sConv.endRoth, sNo.endRoth, 'conversions grow the ending Roth balance');
  gt(sConv.afterTaxLegacy, sNo.afterTaxLegacy, '12% fill beats baseline on after-tax legacy at 25% heir rate');
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
