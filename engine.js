// SHARED CALC ENGINE — single source of truth for all financial logic.
// Consumed directly (via window.PlannerEngine / CommonJS) by the desktop build
// (retirement-planner.jsx), the mobile build (retirement-planner-mobile.jsx),
// the Web Worker (worker.js), and the test suite (tests/run-tests.cjs). There is
// no longer an embedded copy in any JSX file, so edit engine logic HERE only —
// every runtime path imports this module, which makes drift impossible.
// Loadable in browser (sets window.PlannerEngine) and Node (CommonJS module.exports).
(function (root, factory) {
  const exports = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.PlannerEngine = exports;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

// React and Recharts globals are provided by index.html
// Do not add import statements - this file runs in browser via Babel transform

// ============================================
// CONSTANTS - Extracted magic numbers and repeated arrays
// ============================================
const MAX_AGE = 95;
// The oldest age any projection will model. Distinct from MAX_AGE, which is the
// DEFAULT planning age when a plan does not set one. Conflating the two capped
// an explicitly-entered life expectancy at 95, which was invisible until Monte
// Carlo began sampling lifespans: draws above 95 were silently truncated and the
// reported distribution of death ages piled up at a hard ceiling.
const MAX_MODELED_AGE = 120;
const BROKERAGE_COST_BASIS_ESTIMATE = 0.50; // Fallback default when account.costBasisPercent is not set
const MAX_ITERATIONS_FOR_TAX_CALC = 15;
const MONTE_CARLO_TAX_ESTIMATE = 0.15;
const SAVE_DEBOUNCE_MS = 500;

// ── TAX BASE YEAR ────────────────────────────────────────────────────────────
// Every federal and state tax table in this file is stated in dollars of ONE
// year: 2026. Tax functions take `yearsFromNow`, which they use to index those
// tables forward — so `yearsFromNow` means "years after BASE_TAX_YEAR", NOT
// "years after today".
//
// Those were the same number only for as long as the app ran during 2026.
// computeProjections derived its year offset from `new Date().getFullYear()`,
// so running the app in 2027 applied the raw 2026 brackets to 2027 and indexed
// every later year from the wrong base — the whole schedule silently slipped a
// year, and the error grew with every calendar year that passed. Nothing in the
// output looked wrong, which is what made it worth pinning down before building
// anything that names a specific tax year.
//
// Two clocks now run side by side inside the projection loop, and they are not
// interchangeable:
//   yearsFromNow   = year - currentYear    → spending, COLA, asset growth,
//                                            healthcare — things measured from
//                                            TODAY, in today's dollars
//   taxIndexYears  = year - BASE_TAX_YEAR  → bracket edges, standard deduction,
//                                            FICA wage base, IRMAA tiers, LTCG
//                                            thresholds — things measured from
//                                            the year the tables were published
const BASE_TAX_YEAR = 2026;

// Index a BASE_TAX_YEAR dollar amount forward. One definition replacing twelve
// open-coded copies of the same Math.pow, so a change to how tax figures index
// happens in one place.
const indexTo = (amount, yearsFromNow = 0, inflationRate = 0.03) =>
  amount * Math.pow(1 + inflationRate, yearsFromNow);

// Account type categories - used throughout for consistent classification
const PRE_TAX_TYPES = ['401k', 'traditional_ira', '457b', '403b'];
const ROTH_TYPES = ['roth_401k', 'roth_ira', 'roth_457b', 'roth_403b'];
const BROKERAGE_TYPES = ['brokerage'];
const HSA_TYPES = ['hsa'];

// Helper functions for account type checking
const isPreTaxAccount = (type) => PRE_TAX_TYPES.includes(type);
const isRothAccount = (type) => ROTH_TYPES.includes(type);
const isBrokerageAccount = (type) => BROKERAGE_TYPES.includes(type);
const isHSAAccount = (type) => HSA_TYPES.includes(type);

const FEDERAL_TAX_BRACKETS_2026 = {
  single: [
    { min: 0, max: 12400, rate: 0.10 },
    { min: 12400, max: 50400, rate: 0.12 },
    { min: 50400, max: 105700, rate: 0.22 },
    { min: 105700, max: 201775, rate: 0.24 },
    { min: 201775, max: 256225, rate: 0.32 },
    { min: 256225, max: 640600, rate: 0.35 },
    { min: 640600, max: Infinity, rate: 0.37 }
  ],
  married_joint: [
    { min: 0, max: 24800, rate: 0.10 },
    { min: 24800, max: 100800, rate: 0.12 },
    { min: 100800, max: 211400, rate: 0.22 },
    { min: 211400, max: 403550, rate: 0.24 },
    { min: 403550, max: 512450, rate: 0.32 },
    { min: 512450, max: 768700, rate: 0.35 },
    { min: 768700, max: Infinity, rate: 0.37 }
  ],
  married_separate: [
    { min: 0, max: 12400, rate: 0.10 },
    { min: 12400, max: 50400, rate: 0.12 },
    { min: 50400, max: 105700, rate: 0.22 },
    { min: 105700, max: 201775, rate: 0.24 },
    { min: 201775, max: 256225, rate: 0.32 },
    { min: 256225, max: 384350, rate: 0.35 },
    { min: 384350, max: Infinity, rate: 0.37 }
  ],
  head_of_household: [
    { min: 0, max: 17700, rate: 0.10 },
    { min: 17700, max: 67450, rate: 0.12 },
    { min: 67450, max: 105700, rate: 0.22 },
    { min: 105700, max: 201775, rate: 0.24 },
    { min: 201775, max: 256225, rate: 0.32 },
    { min: 256225, max: 640600, rate: 0.35 },
    { min: 640600, max: Infinity, rate: 0.37 }
  ]
};

// Map UI bracket labels to FEDERAL_TAX_BRACKETS_2026 indices.
// Used by Roth conversion bracket-fill mode. An unrecognized label resolves
// to undefined and the caller skips the conversion that year, rather than
// silently mis-bracketing (the pre-fix default was index 2 = '22%').
const RATE_TO_BRACKET_IDX = {
  '10%': 0, '12%': 1, '22%': 2, '24%': 3, '32%': 4, '35%': 5, '37%': 6,
};

// 2026 Standard Deductions — Source: IRS Revenue Procedure 2025-32
const STANDARD_DEDUCTION_2026 = {
  single: 16100,
  married_joint: 32200,
  married_separate: 16100,
  head_of_household: 24150
};

// ── AGE-65 FEDERAL DEDUCTIONS ────────────────────────────────────────────────
// Two separate provisions, with different rules. Both matter enormously for a
// retirement projection, where most years are lived at 65+.

// 1. IRC §63(f) additional standard deduction, PER qualifying person age 65+.
//    Permanent and inflation-indexed (like the base standard deduction).
//    2026 amounts per Rev. Proc. 2025-32. (The identical amount for blindness is
//    not modeled — the engine has no disability input.)
const ADDITIONAL_STD_DEDUCTION_65_2026 = {
  single: 2050,
  head_of_household: 2050,
  married_joint: 1650,
  married_separate: 1650
};

// 2. The OBBBA "senior deduction" (P.L. 119-21 §70103): $6,000 per person 65+,
//    available on top of the standard deduction. Two properties the §63(f)
//    amount does not share:
//      • It is STATUTORY, not inflation-indexed.
//      • It applies to tax years 2025–2028 ONLY, then sunsets. The engine models
//        the sunset — treating it as permanent would overstate the deduction for
//        every year of a 30-year projection. If Congress extends it, bump
//        SENIOR_DEDUCTION_LAST_YEAR.
//    It phases out at 6% of MAGI above the threshold, applied to each person's
//    $6,000, so it is fully gone at $175,000 (single) / $250,000 (joint).
const SENIOR_DEDUCTION_AMOUNT = 6000;
const SENIOR_DEDUCTION_FIRST_YEAR = 2025;
const SENIOR_DEDUCTION_LAST_YEAR = 2028;
const SENIOR_DEDUCTION_PHASEOUT_RATE = 0.06;
const SENIOR_DEDUCTION_PHASEOUT_START = {
  single: 75000,
  head_of_household: 75000,
  married_separate: 75000,
  married_joint: 150000
};

// ── §72(t) EARLY WITHDRAWAL PENALTY ──────────────────────────────────────────
// A 10% additional federal tax on distributions from pre-tax retirement accounts
// taken before age 59½. This is the single biggest tax fact for anyone retiring
// early, and it changes the arithmetic of a bridge-year plan materially.
//
// Modeled exceptions:
//   • Governmental 457(b) plans are exempt at any age (statutory).
//   • "Rule of 55": distributions from the 401(k)/403(b) of the employer you
//     separated from, in or after the year you turn 55, are exempt. The engine
//     treats reaching myRetirementAge as separation from service. It does NOT
//     apply to IRAs — and the account TYPE is the signal: money rolled to an IRA
//     should be entered as traditional_ira, which correctly loses the exception.
//   • 72(t) SEPP (substantially equal periodic payments), via pi.sepp72tEnabled.
//
// NOT modeled (each requires inputs the planner doesn't collect): disability,
// death, unreimbursed medical above 7.5% of AGI, health insurance while
// unemployed, first-home ($10k) and higher-education IRA exceptions, birth or
// adoption ($5k), qualified disaster and public-safety-employee rules. Also not
// modeled: the Roth 5-year conversion clock (converted dollars withdrawn within
// five years are penalized) — the engine does not track Roth basis vintages, so
// Roth withdrawals are always treated as penalty-free.
// State-level early-distribution penalties (e.g. California's extra 2.5%) are
// not modeled either; this is federal only.
const EARLY_WITHDRAWAL_PENALTY_RATE = 0.10;
const EARLY_WITHDRAWAL_AGE = 59.5;
const RULE_OF_55_AGE = 55;
// Account types never subject to the additional tax (governmental 457(b)).
const PENALTY_EXEMPT_TYPES = new Set(['457b']);
// Types the rule-of-55 separation exception can reach (employer plans, not IRAs).
const RULE_OF_55_TYPES = new Set(['401k', '403b']);

// Fraction of a projection year's pre-tax draw that is subject to the penalty.
// Ages are integers, but the threshold falls mid-year: someone who is 59 for the
// whole projection year crosses 59½ partway through it, so on average half that
// year's distributions are early. Returns 1 below 59, 0.5 at 59, 0 from 60.
const earlyWithdrawalPenaltyFraction = (ownerAge) => {
  if (ownerAge >= EARLY_WITHDRAWAL_AGE + 0.5) return 0;   // 60+
  if (ownerAge >= EARLY_WITHDRAWAL_AGE - 0.5) return 0.5; // the year spanning 59½
  return 1;
};

// Penalized share of a distribution from `account` by an owner aged `ownerAge`.
// ownerRetirementAge drives the rule-of-55 test; sepp72t exempts everything.
const earlyWithdrawalPenaltyShare = (account, ownerAge, ownerRetirementAge, sepp72t) => {
  if (!isPreTaxAccount(account.type)) return 0;         // Roth/HSA/brokerage: not §72(t)
  if (sepp72t) return 0;
  if (PENALTY_EXEMPT_TYPES.has(account.type)) return 0;
  const fraction = earlyWithdrawalPenaltyFraction(ownerAge);
  if (fraction === 0) return 0;
  // Rule of 55: separated from service in or after the year you turn 55, and the
  // money is still in that employer's plan.
  if (RULE_OF_55_TYPES.has(account.type)
      && ownerRetirementAge >= RULE_OF_55_AGE
      && ownerAge >= ownerRetirementAge) return 0;
  return fraction;
};

const seniorDeduction = (age65Count, taxYear, magi, filingStatus) => {
  if (!age65Count || !taxYear) return 0;
  if (taxYear < SENIOR_DEDUCTION_FIRST_YEAR || taxYear > SENIOR_DEDUCTION_LAST_YEAR) return 0;
  const threshold = SENIOR_DEDUCTION_PHASEOUT_START[filingStatus] ?? SENIOR_DEDUCTION_PHASEOUT_START.single;
  const excess = Math.max(0, (magi || 0) - threshold);
  const perPerson = Math.max(0, SENIOR_DEDUCTION_AMOUNT - SENIOR_DEDUCTION_PHASEOUT_RATE * excess);
  return age65Count * perPerson;
};

// Total federal deduction against ordinary income for a projection year:
// standard deduction + the §63(f) 65+ amount (both indexed) + the OBBBA senior
// deduction (statutory, MAGI-phased, 2025-2028).
//   opts.age65Count — people 65+ in the tax household (clamped to the filing
//                     status: 2 for MFJ, 1 otherwise)
//   opts.taxYear    — calendar tax year, needed for the senior-deduction sunset
//   opts.magi       — MAGI driving the senior-deduction phaseout
// Callers that pass no opts get exactly the old behavior (plain standard
// deduction), so every existing call site is unaffected until it opts in.
const getFederalDeduction = (filingStatus, yearsFromNow = 0, inflationRate = 0.03, opts = {}) => {
  const base = STANDARD_DEDUCTION_2026[filingStatus] || STANDARD_DEDUCTION_2026.married_joint;
  const maxAge65 = filingStatus === 'married_joint' ? 2 : 1;
  const age65Count = Math.min(Math.max(0, opts.age65Count || 0), maxAge65);
  const per65 = ADDITIONAL_STD_DEDUCTION_65_2026[filingStatus] || ADDITIONAL_STD_DEDUCTION_65_2026.married_joint;
  const indexed = indexTo(base + age65Count * per65, yearsFromNow, inflationRate);
  return indexed + seniorDeduction(age65Count, opts.taxYear, opts.magi, filingStatus);
};

// Flat / top-rate fallback table. Used by calculateStateTax for any state NOT in
// STATE_TAX_CONFIG (i.e. the genuinely flat-tax states). Progressive states are
// handled by the config-driven engine below and ignore these values.
// Rates are 2026. Several flat states enacted rate cuts effective 1/1/2026:
//   GA 5.49→4.99, KY 4.0→3.5, IN 3.15→2.95, MS 5.0→4.0, NC 4.75→3.99,
//   UT 4.65→4.45, and OH dropped its top progressive bracket to a flat 2.75%
//   (OH technically exempts the first ~$26,050; approximated here via the
//   standard-deduction subtraction in the flat path).
const STATE_TAX_RATES = {
  'None': 0, 'Alabama': 0.05, 'Alaska': 0, 'Arizona': 0.025, 'Arkansas': 0.044,
  'California': 0.093, 'Colorado': 0.044, 'Connecticut': 0.0699, 'Delaware': 0.066,
  'Florida': 0, 'Georgia': 0.0499, 'Hawaii': 0.11, 'Idaho': 0.058, 'Illinois': 0.0495,
  'Indiana': 0.0295, 'Iowa': 0.057, 'Kansas': 0.057, 'Kentucky': 0.035, 'Louisiana': 0.03,
  'Maine': 0.0715, 'Maryland': 0.0575, 'Massachusetts': 0.05, 'Michigan': 0.0425,
  'Minnesota': 0.0985, 'Mississippi': 0.04, 'Missouri': 0.048, 'Montana': 0.059,
  'Nebraska': 0.0584, 'Nevada': 0, 'New Hampshire': 0, 'New Jersey': 0.1075,
  'New Mexico': 0.059, 'New York': 0.109, 'North Carolina': 0.0399, 'North Dakota': 0.025,
  'Ohio': 0.0275, 'Oklahoma': 0.0475, 'Oregon': 0.099, 'Pennsylvania': 0.0307,
  'Rhode Island': 0.0599, 'South Carolina': 0.064, 'South Dakota': 0, 'Tennessee': 0,
  'Texas': 0, 'Utah': 0.0445, 'Vermont': 0.0875, 'Virginia': 0.0575, 'Washington': 0,
  'West Virginia': 0.055, 'Wisconsin': 0.0765, 'Wyoming': 0,
  // DC routes through STATE_TAX_CONFIG (progressive); this flat value is only a
  // never-hit fallback, but it must exist so DC appears in the UI dropdowns.
  'District of Columbia': 0.1075
};

// States that exempt defined-benefit pension income from state income tax.
// Note: This covers pension/annuity income only — 401(k)/IRA distributions are generally
// still subject to state tax in most of these states (rules vary by state and plan type).
// States with no income tax are included since all income is inherently exempt.
const STATES_EXEMPT_RETIREMENT_INCOME = new Set([
  'Alabama',        // Exempt: pension/defined-benefit income (401k/IRA distributions ARE taxed)
  'Alaska',         // No state income tax
  'Florida',        // No state income tax
  'Hawaii',         // Exempt: employer pension contributions (most distributions)
  'Illinois',       // Exempt: all qualified retirement plan distributions
  'Mississippi',    // Exempt: all qualified retirement plan distributions
  'Nevada',         // No state income tax
  'New Hampshire',  // No state income tax (interest/dividends only until 2025, fully repealed)
  'Pennsylvania',   // Exempt: all retirement income for retirees
  'South Dakota',   // No state income tax
  'Tennessee',      // No state income tax
  'Texas',          // No state income tax
  'Washington',     // No state income tax
  'Wyoming'         // No state income tax
]);

// States that exempt ALL qualified retirement-plan distributions (pension + 401k/403b/IRA
// withdrawals + Roth distributions), not just defined-benefit pensions. The above set already
// exempts whatever amount is passed as `retirementIncome` to calculateStateTax (which from
// the projection engine is just `totalPension`). For the states below we ALSO exempt the
// taxable portion of pre-tax retirement withdrawals + RMDs via the extraParams field
// `qualifiedRetirementWithdrawals` (B9).
const STATES_EXEMPT_ALL_RETIREMENT_DISTRIBUTIONS = new Set([
  'Illinois',
  'Mississippi',
  'Pennsylvania',
]);

// ── ALABAMA STATE TAX ENGINE ─────────────────────────────────────────────────
// Alabama uses progressive brackets (2% / 4% / 5%) with its own standard deduction,
// federal income tax deductibility, Social Security exemption, government pension
// exemption, and a retirement income exclusion for those age 65+.
// Source: Alabama Department of Revenue, Code of Alabama §40-18-15, §40-18-19.
//
// Key Alabama-specific rules implemented here:
//   1. Progressive brackets: 2% on first $500 (S) / $1,000 (MFJ), 
//      4% on next $2,500 (S) / $5,000 (MFJ), 5% on the remainder.
//   2. Alabama standard deduction uses a sliding scale based on AGI:
//      MFJ: $7,500 (AGI ≤ $20,000), phasing to $4,000 (AGI ≥ $30,000+)
//      Single: $2,500 (AGI ≤ $20,000), phasing to $2,000 (AGI ≥ $30,000+)
//   3. Personal exemption: $1,500 (S) / $3,000 (MFJ) — NOT inflation-adjusted.
//   4. Federal income tax paid is deductible from Alabama taxable income (this is
//      one of only 3 states that allow this — it creates a circular dependency
//      resolved by iteration).
//   5. Social Security income is fully exempt from Alabama state tax.
//   6. Government/military pensions (including FERS/CSRS/military) are exempt.
//   7. Over-65 retirement income exclusion: up to $6,000/year excluded.
//   8. No local income taxes in Alabama (Jefferson County occupational tax is
//      employer-withheld and not modeled here).

const ALABAMA_TAX_BRACKETS = {
  single: [
    { min: 0, max: 500, rate: 0.02 },
    { min: 500, max: 3000, rate: 0.04 },
    { min: 3000, max: Infinity, rate: 0.05 }
  ],
  married_joint: [
    { min: 0, max: 1000, rate: 0.02 },
    { min: 1000, max: 6000, rate: 0.04 },
    { min: 6000, max: Infinity, rate: 0.05 }
  ],
  married_separate: [
    { min: 0, max: 500, rate: 0.02 },
    { min: 500, max: 3000, rate: 0.04 },
    { min: 3000, max: Infinity, rate: 0.05 }
  ],
  head_of_household: [
    { min: 0, max: 500, rate: 0.02 },
    { min: 500, max: 3000, rate: 0.04 },
    { min: 3000, max: Infinity, rate: 0.05 }
  ]
};

// Alabama standard deduction: sliding scale based on AGI
// MFJ: $7,500 at ≤$20,000 AGI → phases to $4,000 at $30,000+ AGI
// Single/HoH: $2,500 at ≤$20,000 AGI → phases to $2,000 at $30,000+ AGI
// MFS: Half of MFJ amounts
const getAlabamaStandardDeduction = (agi, filingStatus) => {
  if (filingStatus === 'married_joint') {
    if (agi <= 20000) return 7500;
    if (agi >= 30000) return 4000;
    // Linear phase-out between $20K and $30K
    return Math.round(7500 - (agi - 20000) / 10000 * 3500);
  } else if (filingStatus === 'married_separate') {
    if (agi <= 10000) return 3750;
    if (agi >= 15000) return 2000;
    return Math.round(3750 - (agi - 10000) / 5000 * 1750);
  } else {
    // Single and Head of Household
    if (agi <= 20000) return 2500;
    if (agi >= 30000) return 2000;
    return Math.round(2500 - (agi - 20000) / 10000 * 500);
  }
};

// Alabama personal exemption (NOT inflation-adjusted)
const ALABAMA_PERSONAL_EXEMPTION = {
  single: 1500,
  married_joint: 3000,
  married_separate: 1500,
  head_of_household: 3000
};

// Dependent exemption: $1,000 per dependent (we don't model dependents, so 0 for retirees)
// Over-65 retirement income exclusion
const ALABAMA_OVER_65_RETIREMENT_EXCLUSION = 6000; // Per person

// ── GENERIC PROGRESSIVE STATE TAX ENGINE ─────────────────────────────────────
// Config-driven replacement for per-state tax functions. Each progressive state
// (and DC) is described by an entry in STATE_TAX_CONFIG; calculateStateTaxProgressive
// applies the brackets + deductions + exemptions/credits + exclusions generically.
// Flat-tax states are NOT in the config — they keep the simple flat-rate path in
// calculateStateTax. Alabama is migrated here as the reference implementation.
//
// All dollar figures in the config are 2026 values. When `inflationIndexed` is
// true, brackets / standard deduction / exemptions are scaled forward by
// (1+inflationRate)^yearsFromNow, mirroring how the federal engine indexes.
//
// SCOPE NOTES:
//  - Local/municipal income taxes (NYC & Yonkers, MD county, OR Portland metro,
//    etc.) are intentionally NOT modeled — the app only knows the state. State
//    liability only.
//  - Social Security taxation is binary via STATES_THAT_TAX_SS (no per-state
//    income phaseouts modeled).

// Resolve a state's standard deduction for the given (post-exclusion, post-
// federal-deduction) AGI. Modes:
//   'fixed'            — flat per-status amount (inflation-indexed if `inf` ≠ 1)
//   'sliding'          — custom fn(agi, filingStatus, inf) (e.g. Alabama, ME, WI)
//   'percent'          — `rate` × AGI, clamped to [min, max] per status
//   'federal_taxable'  — state starts from federal taxable income: subtract the
//                        federal standard deduction (MT, ND, SC)
//   'federal_plus'     — federal standard deduction + a per-state `offset` (MO 2026: +$4,000)
//   'federal_agi'      — state starts from federal AGI: no state std deduction here (VT, WV)
//   'none'             — no standard deduction (CT, NJ)
const resolveStateStdDeduction = (cfg, agi, filingStatus, inf) => {
  if (!cfg || cfg.mode === 'none') return 0;
  if (cfg.mode === 'sliding') return cfg.fn(agi, filingStatus, inf);
  if (cfg.mode === 'percent') {
    const amt = agi * cfg.rate;
    const lo = (cfg.min && (cfg.min[filingStatus] ?? cfg.min.single) || 0) * inf;
    const hi = (cfg.max && (cfg.max[filingStatus] ?? cfg.max.single)) ;
    const hiScaled = (hi === undefined || hi === Infinity) ? Infinity : hi * inf;
    return Math.min(Math.max(amt, lo), hiScaled);
  }
  if (cfg.mode === 'federal_taxable') {
    return (STANDARD_DEDUCTION_2026[filingStatus] || STANDARD_DEDUCTION_2026.single) * inf;
  }
  if (cfg.mode === 'federal_plus') {
    const base = (STANDARD_DEDUCTION_2026[filingStatus] || STANDARD_DEDUCTION_2026.single);
    return (base + (cfg.offset || 0)) * inf;
  }
  if (cfg.mode === 'federal_agi') return 0;
  // 'fixed' (default)
  return (cfg[filingStatus] ?? cfg.single ?? 0) * inf;
};

// Apply contiguous progressive brackets (each {min, max, rate}) to a taxable
// amount. Bracket edges scale by `inf` so a 2026 schedule indexes forward.
const applyStateBrackets = (taxableIncome, brackets, inf) => {
  let tax = 0;
  let remaining = taxableIncome;
  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const lo = bracket.min * inf;
    const hi = bracket.max === Infinity ? Infinity : bracket.max * inf;
    const width = hi - lo;
    const amt = Math.min(remaining, width);
    tax += amt * bracket.rate;
    remaining -= amt;
  }
  return tax;
};

// ── NEW YORK helpers ─────────────────────────────────────────────────────────
// NY benefit recapture (IT-201 Tax Computation Worksheets). When NY AGI exceeds
// $107,650 the benefit of the lower brackets is recaptured, phasing the liability
// toward the taxpayer's top marginal rate over a $50,000 AGI band. Above the band
// the entire taxable income is effectively taxed at the top applicable rate —
// NY's "high earners pay their top rate on all income" rule.
// NOTE: this models the dominant first recapture band faithfully; the exact
// multi-band worksheet constants for >$1M income are approximated. The $107,650
// entry threshold is statutory (same for all filing statuses) and NOT indexed.
// Verify against the 2026 IT-201 instructions: https://www.tax.ny.gov/pdf/current_forms/it/it201i.pdf
const NY_RECAPTURE_THRESHOLD = 107650;
const nyBenefitRecapture = (tax, taxableIncome, agi, filingStatus, inf, brackets) => {
  if (agi <= NY_RECAPTURE_THRESHOLD) return tax;
  // Top marginal rate the taxpayer reaches at this taxable income.
  let topRate = brackets[0].rate;
  for (const b of brackets) { if (taxableIncome > b.min) topRate = b.rate; }
  const flatTax = topRate * taxableIncome;          // tax if ALL income at top rate
  const benefit = Math.max(0, flatTax - tax);       // dollar benefit of lower brackets
  const fraction = Math.min(Math.max(agi - NY_RECAPTURE_THRESHOLD, 0), 50000) / 50000;
  return tax + benefit * fraction;
};
// NY retirement exclusion: up to $20,000 of pension/annuity/IRA income per
// recipient age 59½+ (Tax Law §612(c)(3-a)). Government pensions are separately
// fully exempt, but the engine cannot distinguish govt vs private pensions, so we
// apply the conservative $20k private exclusion to combined retirement income.
const nyRetirementExclusion = ({ retirementIncome, qualifiedWithdrawals, filingStatus, primaryAge, spouseAge }) => {
  const base = (retirementIncome || 0) + (qualifiedWithdrawals || 0);
  let cap = 0;
  if (primaryAge >= 59.5) cap += 20000;
  if (filingStatus === 'married_joint' && spouseAge >= 59.5) cap += 20000;
  return Math.min(base, cap);
};

// ── NEW JERSEY helpers ───────────────────────────────────────────────────────
// NJ pension/retirement income exclusion (age 62+). Full exclusion when NJ gross
// income (which excludes Social Security) ≤ $100k; 50% in $100k–$125k; 25% in
// $125k–$150k; nothing above $150k (hard cliff). Max excludable amount by status.
// Also adds NJ's additional $1,000 personal exemption for filers age 65+.
// Source: https://www.nj.gov/treasury/taxation/njit7.shtml
const njRetirementExclusion = ({ grossIncome, retirementIncome, qualifiedWithdrawals, taxableSS, filingStatus, primaryAge, spouseAge }) => {
  const njGross = Math.max(0, (grossIncome || 0) - (taxableSS || 0));
  const ageEligible = primaryAge >= 62 || (filingStatus === 'married_joint' && spouseAge >= 62);
  let exclusion = 0;
  if (ageEligible && njGross <= 150000) {
    const maxByStatus = filingStatus === 'married_joint' ? 100000
      : filingStatus === 'married_separate' ? 50000
      : 75000; // single / head_of_household
    let pct = njGross <= 100000 ? 1.0 : njGross <= 125000 ? 0.5 : 0.25;
    const retBase = (retirementIncome || 0) + (qualifiedWithdrawals || 0);
    exclusion = Math.min(retBase, maxByStatus * pct);
  }
  // Additional $1,000 personal exemption per filer age 65+ (taken as a deduction).
  if (primaryAge >= 65) exclusion += 1000;
  if (filingStatus === 'married_joint' && spouseAge >= 65) exclusion += 1000;
  return exclusion;
};

// ── OREGON helper ────────────────────────────────────────────────────────────
// Oregon lets you subtract federal income tax paid, but the subtraction is
// CAPPED ($8,500 base; $4,250 MFS — 2025, inflation-indexed) and PHASES OUT to
// $0 over a federal-AGI band (single $125k→$145k; MFJ/HOH $250k→$290k; MFS
// halved). OR's published table is stepped; we model a linear taper, which is a
// faithful approximation. Flag VERIFY against Pub OR-17 federal-tax worksheet.
// Source: https://www.oregon.gov/dor/programs/individuals/pages/pit.aspx
const OR_FED_SUBTRACTION = {
  single:            { cap: 8500, phaseStart: 125000, phaseEnd: 145000 },
  married_separate:  { cap: 4250, phaseStart: 62500,  phaseEnd: 72500 },
  married_joint:     { cap: 8500, phaseStart: 250000, phaseEnd: 290000 },
  head_of_household: { cap: 8500, phaseStart: 250000, phaseEnd: 290000 },
};
const orFederalSubtraction = (fed, agi, filingStatus, inf) => {
  const p = OR_FED_SUBTRACTION[filingStatus] || OR_FED_SUBTRACTION.single;
  const cap = p.cap * inf;
  const start = p.phaseStart * inf;
  const end = p.phaseEnd * inf;
  let fraction = 1;
  if (agi >= end) fraction = 0;
  else if (agi > start) fraction = (end - agi) / (end - start);
  return Math.min(fed, cap) * fraction;
};

// ── MISSOURI ── public-pension exclusion (an `exclusionFn`). MO exempts public
// (federal/state/local govt) pension income up to a per-taxpayer cap that is
// REDUCED dollar-for-dollar by taxable Social Security received. We model the cap
// against the supplied retirementIncome (pension component) and reduce it by
// taxableSS. MFJ doubles the cap. 2026 cap ≈ $49,824/taxpayer (indexes ~maximum
// SS benefit). Private-pension exclusion (income-tested) is omitted — VERIFY
// against MO-1040 / MO DOR pension worksheet.
// Source: https://dor.mo.gov/  (MO §143.124)
const MO_PUBLIC_PENSION_CAP = 49824;
const moPublicPensionExclusion = ({ retirementIncome, taxableSS, filingStatus, inf }) => {
  const taxpayers = filingStatus === 'married_joint' ? 2 : 1;
  const cap = Math.max(0, MO_PUBLIC_PENSION_CAP * taxpayers * inf - (taxableSS || 0));
  return Math.min(retirementIncome || 0, cap);
};

// ── CONNECTICUT ── personal exemption (phased) + pension/annuity & IRA exclusion
// (phased), bundled as one `exclusionFn` subtracted before brackets. CT has NO
// standard deduction. Personal exemption: full below phaseStart, reduced $1,000
// per $1,000 of CT-AGI over the start, to zero. Pension/IRA exclusion: 100% of
// retirement income below the lower threshold, tapering linearly to 0% at the
// upper threshold (CT fully exempts qualifying pension/IRA income for filers
// under the income limits as of 2025+). Constants approximate 2026 (CT DRS not
// fetchable on this network) — VERIFY against CT-1040 instructions.
// Source: https://portal.ct.gov/drs
const CT_PARAMS = {
  single:            { exBase: 15000, exStart: 30000, penLo: 75000,  penHi: 100000 },
  married_separate:  { exBase: 12000, exStart: 24000, penLo: 75000,  penHi: 100000 },
  married_joint:     { exBase: 24000, exStart: 48000, penLo: 100000, penHi: 150000 },
  head_of_household: { exBase: 19000, exStart: 38000, penLo: 75000,  penHi: 100000 },
};
const ctExclusions = ({ retirementIncome, filingStatus, inf, agi }) => {
  const p = CT_PARAMS[filingStatus] || CT_PARAMS.single;
  // Personal exemption phaseout: $1,000 reduction per $1,000 over start.
  const exStart = p.exStart * inf;
  let exemption = p.exBase * inf;
  if (agi > exStart) {
    const steps = Math.ceil((agi - exStart) / (1000 * inf));
    exemption = Math.max(0, exemption - steps * 1000 * inf);
  }
  // Pension/IRA exclusion: 100% below penLo, linear taper to 0% at penHi.
  const penLo = p.penLo * inf;
  const penHi = p.penHi * inf;
  let penFraction = 1;
  if (agi >= penHi) penFraction = 0;
  else if (agi > penLo) penFraction = (penHi - agi) / (penHi - penLo);
  const pensionExcl = (retirementIncome || 0) * penFraction;
  return exemption + pensionExcl;
};

// CT benefit-recapture (Table D): high earners lose the benefit of the lower
// brackets, flattening toward the top marginal rate. Modeled like NY — once AGI
// exceeds a threshold, add back the bracket savings over a phase band so the
// effective rate converges to 6.99%. Approximate bands (CT DRS not fetchable) —
// VERIFY against CT-1040 Tax Calculation Schedule (Table D). Table C (the small
// 2% add-back) is OMITTED as immaterial (≤~$180) and unverifiable.
const CT_RECAPTURE = {
  single:            { start: 200000, band: 90000 },
  married_separate:  { start: 200000, band: 90000 },
  married_joint:     { start: 400000, band: 180000 },
  head_of_household: { start: 320000, band: 140000 },
};
const ctRecapture = (tax, taxableIncome, agi, filingStatus, inf, brackets) => {
  const p = CT_RECAPTURE[filingStatus] || CT_RECAPTURE.single;
  const start = p.start * inf;
  if (agi <= start) return tax;
  // Top marginal rate reached at this taxable income.
  let topRate = brackets[0].rate;
  for (const b of brackets) { if (taxableIncome > b.min * inf) topRate = b.rate; }
  const flatTax = topRate * taxableIncome;            // tax if ALL income at top rate
  const benefit = Math.max(0, flatTax - tax);         // dollar benefit of lower brackets
  const fraction = Math.min(Math.max(agi - start, 0), p.band * inf) / (p.band * inf);
  return tax + benefit * fraction;
};

// ── VIRGINIA ── age deduction (an `exclusionFn`). Filers 65+ get a $12,000
// deduction per person, reduced $1 for every $1 of AGI over $50,000 (single) /
// $75,000 (married). VA brackets and std deduction are statutory and NOT indexed.
// SS fully exempt. No local income tax in VA.
// Source: https://www.tax.virginia.gov/age-deduction
const vaAgeDeduction = ({ filingStatus, agi, primaryAge, spouseAge }) => {
  let count = 0;
  if ((primaryAge || 0) >= 65) count++;
  if (filingStatus === 'married_joint' && (spouseAge || 0) >= 65) count++;
  if (count === 0) return 0;
  const base = 12000 * count;
  const threshold = filingStatus === 'married_joint' ? 75000 : 50000;
  const reduction = Math.max(0, agi - threshold);
  return Math.max(0, base - reduction);
};

// ── WISCONSIN ── Sliding-Scale Standard Deduction (SSSD): starts at a max, then
// phases down by a per-status rate once WAGI exceeds a start point, to $0. 2025-ish
// parameters (WI indexes annually → inflationIndexed handles forward years). Exact
// table is in Form 1 instructions p.35 — VERIFY max/start/rate against current year.
// Source: https://www.revenue.wi.gov/TaxForms2025/2025-Form1-Inst.pdf
const WI_SSSD = {
  single:            { max: 13930, start: 19310, rate: 0.12 },
  head_of_household: { max: 17980, start: 19310, rate: 0.22515 },
  married_joint:     { max: 25890, start: 26810, rate: 0.19778 },
  married_separate:  { max: 12290, start: 12730, rate: 0.19778 },
};
const getWisconsinStandardDeduction = (agi, filingStatus, inf) => {
  const p = WI_SSSD[filingStatus] || WI_SSSD.single;
  const max = p.max * inf;
  const start = p.start * inf;
  if (agi <= start) return max;
  return Math.max(0, max - p.rate * (agi - start));
};
// WI retirement exclusion (2025 Act 15): up to $24,000 of qualified retirement
// income per person age 67+ ($48k MFJ if both qualify). Excludes SS (already
// untaxed). The smaller low-income $5k subtraction is omitted.
const wiRetirementExclusion = ({ retirementIncome, qualifiedWithdrawals, filingStatus, primaryAge, spouseAge }) => {
  const base = (retirementIncome || 0) + (qualifiedWithdrawals || 0);
  let cap = 0;
  if ((primaryAge || 0) >= 67) cap += 24000;
  if (filingStatus === 'married_joint' && (spouseAge || 0) >= 67) cap += 24000;
  return Math.min(base, cap);
};

// ── MAINE ── std deduction = federal std deduction, phased out for high earners
// (single: full ≤$100k, $0 by $175k; MFJ: full ≤$200,050, $0 by ~$350,150). ME
// indexes annually → inflationIndexed. Source: 2025 Form 1040ME instructions.
const getMaineStandardDeduction = (agi, filingStatus, inf) => {
  const base = (STANDARD_DEDUCTION_2026[filingStatus] || STANDARD_DEDUCTION_2026.single) * inf;
  const start = (filingStatus === 'married_joint' ? 200050
    : filingStatus === 'married_separate' ? 100025 : 100000) * inf;
  const range = (filingStatus === 'married_joint' ? 150100 : 75000) * inf;
  if (agi <= start) return base;
  if (agi >= start + range) return 0;
  return base * (1 - (agi - start) / range);
};
// ME pension income deduction: up to $48,216/person (2025), REDUCED by Social
// Security received, and phased out above $125k single / $187.5k HOH / $250k MFJ.
// SS itself is exempt in ME. Phaseout range approximated at $25k — VERIFY against
// Worksheet for Pension Income Deduction. Source: 2025 Schedule 1S instructions.
const ME_PENSION_CAP = 48216;
const maineRetirementExclusion = ({ retirementIncome, qualifiedWithdrawals, taxableSS, filingStatus, inf, agi }) => {
  const base = (retirementIncome || 0) + (qualifiedWithdrawals || 0);
  const taxpayers = filingStatus === 'married_joint' ? 2 : 1;
  let cap = Math.max(0, ME_PENSION_CAP * taxpayers * inf - (taxableSS || 0));
  const start = (filingStatus === 'married_joint' ? 250000
    : filingStatus === 'head_of_household' ? 187500 : 125000) * inf;
  const range = 25000 * inf;
  let frac = 1;
  if (agi >= start + range) frac = 0;
  else if (agi > start) frac = (start + range - agi) / range;
  cap *= frac;
  return Math.min(base, cap);
};

// ── MARYLAND ── pension exclusion (an `exclusionFn`): age 65+ may exclude up to
// $41,200/person (2025) of qualifying retirement income, REDUCED by Social
// Security received. MD does not tax SS. The personal-exemption high-income
// phaseout is omitted (most retirees are below it) — VERIFY. Local (county)
// income tax and the 2% high-income capital-gains surtax are intentionally NOT
// modeled (app knows state only). Source: https://www.marylandtaxes.gov
const MD_PENSION_CAP = 41200;
const mdPensionExclusion = ({ retirementIncome, qualifiedWithdrawals, taxableSS, filingStatus, primaryAge, spouseAge }) => {
  let persons = 0;
  if ((primaryAge || 0) >= 65) persons++;
  if (filingStatus === 'married_joint' && (spouseAge || 0) >= 65) persons++;
  if (persons === 0) return 0;
  const base = (retirementIncome || 0) + (qualifiedWithdrawals || 0);
  const cap = Math.max(0, MD_PENSION_CAP * persons - (taxableSS || 0));
  return Math.min(base, cap);
};

// ── DELAWARE ── pension/retirement exclusion (an `exclusionFn`): age 60+ may
// exclude up to $12,500/person of eligible retirement income (under 60: $2,000).
// The separate $2,500 age-65 additional standard deduction is handled via
// over65Exclusion. SS exempt. Source: 30 Del. C. §1106.
const deRetirementExclusion = ({ retirementIncome, qualifiedWithdrawals, filingStatus, primaryAge, spouseAge }) => {
  const base = (retirementIncome || 0) + (qualifiedWithdrawals || 0);
  let cap = 0;
  cap += (primaryAge || 0) >= 60 ? 12500 : 2000;
  if (filingStatus === 'married_joint') cap += (spouseAge || 0) >= 60 ? 12500 : 2000;
  return Math.min(base, cap);
};

// ── RHODE ISLAND ── pension/annuity modification (an `exclusionFn`): at/above
// full retirement age (≈67), with federal AGI under the limit ($107,000 single /
// $133,750 MFJ, 2025), exclude up to $50,000/person of qualifying pension/annuity
// income. HARD income cliff. IRAs are technically ineligible, so we apply it only
// to pension income (retirementIncome), not 401k/IRA withdrawals. RI TAXES SS
// (binary flag; the FRA/income SS modification is intentionally not modeled).
// Source: https://tax.ri.gov (2025 Retirement Income Tax Guide).
const riRetirementExclusion = ({ retirementIncome, filingStatus, primaryAge, spouseAge, agi, inf }) => {
  const limit = (filingStatus === 'married_joint' ? 133750 : 107000) * inf;
  if (agi > limit) return 0;
  let cap = 0;
  if ((primaryAge || 0) >= 67) cap += 50000 * inf;
  if (filingStatus === 'married_joint' && (spouseAge || 0) >= 67) cap += 50000 * inf;
  return Math.min(retirementIncome || 0, cap);
};

// ── ARKANSAS ── $6,000/person retirement-income exclusion for age 59½+ (an
// `exclusionFn`). SS exempt. The high-income bracket-adjustment smoothing
// ($92k–$95k) is omitted. Source: Ark. Code §26-51-307.
const arRetirementExclusion = ({ retirementIncome, qualifiedWithdrawals, filingStatus, primaryAge, spouseAge }) => {
  const base = (retirementIncome || 0) + (qualifiedWithdrawals || 0);
  let cap = 0;
  if ((primaryAge || 0) >= 59.5) cap += 6000;
  if (filingStatus === 'married_joint' && (spouseAge || 0) >= 59.5) cap += 6000;
  return Math.min(base, cap);
};

// ── OKLAHOMA ── $10,000/person exclusion of qualifying retirement income
// (pension/401k/IRA), no age test (an `exclusionFn`). SS exempt.
// Source: 68 O.S. §2358(E).
const okRetirementExclusion = ({ retirementIncome, qualifiedWithdrawals, filingStatus }) => {
  const base = (retirementIncome || 0) + (qualifiedWithdrawals || 0);
  const cap = 10000 * (filingStatus === 'married_joint' ? 2 : 1);
  return Math.min(base, cap);
};

// ── SOUTH CAROLINA ── retirement-income deduction: $10,000/person under 65,
// $15,000/person at 65+ (an `exclusionFn`). SS exempt. The separate $15k general
// age-65 deduction is omitted to avoid double-counting. Source: S.C. Code §12-6-1170.
const scRetirementExclusion = ({ retirementIncome, qualifiedWithdrawals, filingStatus, primaryAge, spouseAge }) => {
  const base = (retirementIncome || 0) + (qualifiedWithdrawals || 0);
  let cap = (primaryAge || 0) >= 65 ? 15000 : 10000;
  if (filingStatus === 'married_joint') cap += (spouseAge || 0) >= 65 ? 15000 : 10000;
  return Math.min(base, cap);
};

// Per-state progressive tax configuration. Keyed by state name. Add states here
// to route them through calculateStateTaxProgressive instead of the flat path.
const STATE_TAX_CONFIG = {
  // ── ALABAMA ── reference implementation (sliding std deduction, full federal
  // deductibility, over-65 exclusion, SS + pension exempt, NOT inflation-indexed).
  // Source: Alabama DOR §40-18-15/§40-18-19.
  Alabama: {
    inflationIndexed: false,
    brackets: ALABAMA_TAX_BRACKETS,
    stdDeduction: { mode: 'sliding', fn: getAlabamaStandardDeduction },
    exemption: { mode: 'deduction', ...ALABAMA_PERSONAL_EXEMPTION },
    federalDeductible: true, // full, uncapped
    retirement: { pensionExempt: true, over65Exclusion: ALABAMA_OVER_65_RETIREMENT_EXCLUSION, over65Age: 65 },
    recapture: null,
  },

  // ── CALIFORNIA ── 9 brackets + 1% Mental Health Services Tax (MHST) over $1M.
  // CA fully taxes pensions/401k/IRA; exempts Social Security. Personal exemption
  // is a CREDIT ($153/filer), not a deduction. CA indexes brackets/std-deduction/
  // credit annually by CA-CPI → inflationIndexed. The $1M MHST threshold is NOT
  // indexed (applied as a flat surtax via the recapture hook).
  // Base = 2025 FTB Form 540 schedules (the 2026-indexed schedule publishes ~late
  // 2026; the engine inflates the base forward). MFS shares the single schedule;
  // MFJ = 2× single. HOH (Schedule Z) upper brackets above $505,462 are
  // reconstructed — VERIFY against the FTB 540 PDF.
  // Source: https://www.ftb.ca.gov/forms/2025/2025-540-tax-rate-schedules.pdf
  California: {
    inflationIndexed: true,
    brackets: {
      single: [
        { min: 0, max: 11079, rate: 0.01 }, { min: 11079, max: 26264, rate: 0.02 },
        { min: 26264, max: 41452, rate: 0.04 }, { min: 41452, max: 57542, rate: 0.06 },
        { min: 57542, max: 72724, rate: 0.08 }, { min: 72724, max: 371479, rate: 0.093 },
        { min: 371479, max: 445771, rate: 0.103 }, { min: 445771, max: 742953, rate: 0.113 },
        { min: 742953, max: Infinity, rate: 0.123 },
      ],
      married_separate: [
        { min: 0, max: 11079, rate: 0.01 }, { min: 11079, max: 26264, rate: 0.02 },
        { min: 26264, max: 41452, rate: 0.04 }, { min: 41452, max: 57542, rate: 0.06 },
        { min: 57542, max: 72724, rate: 0.08 }, { min: 72724, max: 371479, rate: 0.093 },
        { min: 371479, max: 445771, rate: 0.103 }, { min: 445771, max: 742953, rate: 0.113 },
        { min: 742953, max: Infinity, rate: 0.123 },
      ],
      married_joint: [
        { min: 0, max: 22158, rate: 0.01 }, { min: 22158, max: 52528, rate: 0.02 },
        { min: 52528, max: 82904, rate: 0.04 }, { min: 82904, max: 115084, rate: 0.06 },
        { min: 115084, max: 145448, rate: 0.08 }, { min: 145448, max: 742958, rate: 0.093 },
        { min: 742958, max: 891542, rate: 0.103 }, { min: 891542, max: 1485906, rate: 0.113 },
        { min: 1485906, max: Infinity, rate: 0.123 },
      ],
      head_of_household: [
        { min: 0, max: 22179, rate: 0.01 }, { min: 22179, max: 52553, rate: 0.02 },
        { min: 52553, max: 67750, rate: 0.04 }, { min: 67750, max: 83864, rate: 0.06 },
        { min: 83864, max: 99063, rate: 0.08 }, { min: 99063, max: 505462, rate: 0.093 },
        { min: 505462, max: 606554, rate: 0.103 }, { min: 606554, max: 1010924, rate: 0.113 },
        { min: 1010924, max: Infinity, rate: 0.123 },
      ],
    },
    stdDeduction: { mode: 'fixed', single: 5706, married_separate: 5706, married_joint: 11412, head_of_household: 11412 },
    exemption: { mode: 'credit', single: 153, married_separate: 153, married_joint: 306, head_of_household: 153 },
    federalDeductible: false,
    retirement: {}, // pensions fully taxable; SS exempt via STATES_THAT_TAX_SS (CA not listed)
    // 1% Mental Health Services Tax on taxable income over $1,000,000 (not indexed).
    recapture: (tax, taxableIncome) => tax + 0.01 * Math.max(0, taxableIncome - 1000000),
  },

  // ── NEW YORK ── 9 brackets (2026 partial rate cut on first five) + benefit
  // recapture. No personal/spousal exemption. Exempts SS; $20k private pension
  // exclusion (59½+) plus full govt-pension exemption (modeled conservatively as
  // $20k). NY does NOT index brackets/std-deduction → inflationIndexed false.
  // 2026 rates per Ch.59 Laws of 2025 (Part A); thresholds statutory.
  // Source: https://www.tax.ny.gov/pdf/current_forms/it/it201i.pdf
  'New York': {
    inflationIndexed: false,
    brackets: {
      single: [
        { min: 0, max: 8500, rate: 0.039 }, { min: 8500, max: 11700, rate: 0.044 },
        { min: 11700, max: 13900, rate: 0.0515 }, { min: 13900, max: 80650, rate: 0.054 },
        { min: 80650, max: 215400, rate: 0.059 }, { min: 215400, max: 1077550, rate: 0.0685 },
        { min: 1077550, max: 5000000, rate: 0.0965 }, { min: 5000000, max: 25000000, rate: 0.103 },
        { min: 25000000, max: Infinity, rate: 0.109 },
      ],
      married_separate: [
        { min: 0, max: 8500, rate: 0.039 }, { min: 8500, max: 11700, rate: 0.044 },
        { min: 11700, max: 13900, rate: 0.0515 }, { min: 13900, max: 80650, rate: 0.054 },
        { min: 80650, max: 215400, rate: 0.059 }, { min: 215400, max: 1077550, rate: 0.0685 },
        { min: 1077550, max: 5000000, rate: 0.0965 }, { min: 5000000, max: 25000000, rate: 0.103 },
        { min: 25000000, max: Infinity, rate: 0.109 },
      ],
      married_joint: [
        { min: 0, max: 17150, rate: 0.039 }, { min: 17150, max: 23600, rate: 0.044 },
        { min: 23600, max: 27900, rate: 0.0515 }, { min: 27900, max: 161550, rate: 0.054 },
        { min: 161550, max: 323200, rate: 0.059 }, { min: 323200, max: 2155350, rate: 0.0685 },
        { min: 2155350, max: 5000000, rate: 0.0965 }, { min: 5000000, max: 25000000, rate: 0.103 },
        { min: 25000000, max: Infinity, rate: 0.109 },
      ],
      head_of_household: [
        { min: 0, max: 12800, rate: 0.039 }, { min: 12800, max: 17650, rate: 0.044 },
        { min: 17650, max: 20900, rate: 0.0515 }, { min: 20900, max: 107650, rate: 0.054 },
        { min: 107650, max: 269300, rate: 0.059 }, { min: 269300, max: 1616450, rate: 0.0685 },
        { min: 1616450, max: 5000000, rate: 0.0965 }, { min: 5000000, max: 25000000, rate: 0.103 },
        { min: 25000000, max: Infinity, rate: 0.109 },
      ],
    },
    stdDeduction: { mode: 'fixed', single: 8000, married_separate: 8000, married_joint: 16050, head_of_household: 11200 },
    exemption: { mode: 'none' },
    federalDeductible: false,
    retirement: { exclusionFn: nyRetirementExclusion },
    recapture: nyBenefitRecapture,
  },

  // ── NEW JERSEY ── gross income tax: NO standard deduction. Single/MFS share a
  // 7-bracket schedule; MFJ/HOH/QSS share an 8-bracket schedule (extra 2.45%
  // bracket). $1,000 personal exemption (deduction); +$1,000 age-65 and phased
  // pension exclusion handled in njRetirementExclusion. Exempts SS. NJ does NOT
  // index → inflationIndexed false. Amounts statutory.
  // Source: https://www.nj.gov/treasury/taxation/taxtables.shtml
  'New Jersey': {
    inflationIndexed: false,
    brackets: {
      single: [
        { min: 0, max: 20000, rate: 0.014 }, { min: 20000, max: 35000, rate: 0.0175 },
        { min: 35000, max: 40000, rate: 0.035 }, { min: 40000, max: 75000, rate: 0.05525 },
        { min: 75000, max: 500000, rate: 0.0637 }, { min: 500000, max: 1000000, rate: 0.0897 },
        { min: 1000000, max: Infinity, rate: 0.1075 },
      ],
      married_separate: [
        { min: 0, max: 20000, rate: 0.014 }, { min: 20000, max: 35000, rate: 0.0175 },
        { min: 35000, max: 40000, rate: 0.035 }, { min: 40000, max: 75000, rate: 0.05525 },
        { min: 75000, max: 500000, rate: 0.0637 }, { min: 500000, max: 1000000, rate: 0.0897 },
        { min: 1000000, max: Infinity, rate: 0.1075 },
      ],
      married_joint: [
        { min: 0, max: 20000, rate: 0.014 }, { min: 20000, max: 50000, rate: 0.0175 },
        { min: 50000, max: 70000, rate: 0.0245 }, { min: 70000, max: 80000, rate: 0.035 },
        { min: 80000, max: 150000, rate: 0.05525 }, { min: 150000, max: 500000, rate: 0.0637 },
        { min: 500000, max: 1000000, rate: 0.0897 }, { min: 1000000, max: Infinity, rate: 0.1075 },
      ],
      head_of_household: [
        { min: 0, max: 20000, rate: 0.014 }, { min: 20000, max: 50000, rate: 0.0175 },
        { min: 50000, max: 70000, rate: 0.0245 }, { min: 70000, max: 80000, rate: 0.035 },
        { min: 80000, max: 150000, rate: 0.05525 }, { min: 150000, max: 500000, rate: 0.0637 },
        { min: 500000, max: 1000000, rate: 0.0897 }, { min: 1000000, max: Infinity, rate: 0.1075 },
      ],
    },
    stdDeduction: { mode: 'none' },
    exemption: { mode: 'deduction', single: 1000, married_separate: 1000, married_joint: 2000, head_of_household: 1000 },
    federalDeductible: false,
    retirement: { exclusionFn: njRetirementExclusion },
    recapture: null,
  },

  // ── HAWAII ── 12 brackets (most of any state), 1.4%–11.0% (Act 46, SLH 2024 /
  // GAP II schedule effective 2025; rates unchanged for 2026). MFS shares the
  // single schedule; MFJ = 2× single thresholds; HOH = 1.5× single
  // (reconstructed — VERIFY against the DOTAX HOH rate schedule). Own standard
  // deduction (2026 step-up: single $8,000 / MFJ $16,000 / HOH $12,000) and a
  // $1,144 deduction-mode personal exemption per filer. Exempts SS and
  // employer-funded pensions (pensionExempt); 401k/IRA distributions stay
  // taxable. NOT CPI-indexed — increases are statutory step phase-ins, so we use
  // the static 2026 figures (per the "don't hardcode future scheduled cuts"
  // decision) → inflationIndexed false. The high-income personal-exemption
  // cutout (AGI > $250k single / $500k MFJ) is omitted (rare for retirees).
  // Source: https://tax.hawaii.gov/forms/d_25table-on/ ; Act 46, SLH 2024.
  Hawaii: {
    inflationIndexed: false,
    brackets: {
      single: [
        { min: 0, max: 9600, rate: 0.014 }, { min: 9600, max: 14400, rate: 0.032 },
        { min: 14400, max: 19200, rate: 0.055 }, { min: 19200, max: 24000, rate: 0.064 },
        { min: 24000, max: 36000, rate: 0.068 }, { min: 36000, max: 48000, rate: 0.072 },
        { min: 48000, max: 125000, rate: 0.076 }, { min: 125000, max: 175000, rate: 0.079 },
        { min: 175000, max: 225000, rate: 0.0825 }, { min: 225000, max: 275000, rate: 0.09 },
        { min: 275000, max: 325000, rate: 0.10 }, { min: 325000, max: Infinity, rate: 0.11 },
      ],
      married_separate: [
        { min: 0, max: 9600, rate: 0.014 }, { min: 9600, max: 14400, rate: 0.032 },
        { min: 14400, max: 19200, rate: 0.055 }, { min: 19200, max: 24000, rate: 0.064 },
        { min: 24000, max: 36000, rate: 0.068 }, { min: 36000, max: 48000, rate: 0.072 },
        { min: 48000, max: 125000, rate: 0.076 }, { min: 125000, max: 175000, rate: 0.079 },
        { min: 175000, max: 225000, rate: 0.0825 }, { min: 225000, max: 275000, rate: 0.09 },
        { min: 275000, max: 325000, rate: 0.10 }, { min: 325000, max: Infinity, rate: 0.11 },
      ],
      married_joint: [
        { min: 0, max: 19200, rate: 0.014 }, { min: 19200, max: 28800, rate: 0.032 },
        { min: 28800, max: 38400, rate: 0.055 }, { min: 38400, max: 48000, rate: 0.064 },
        { min: 48000, max: 72000, rate: 0.068 }, { min: 72000, max: 96000, rate: 0.072 },
        { min: 96000, max: 250000, rate: 0.076 }, { min: 250000, max: 350000, rate: 0.079 },
        { min: 350000, max: 450000, rate: 0.0825 }, { min: 450000, max: 550000, rate: 0.09 },
        { min: 550000, max: 650000, rate: 0.10 }, { min: 650000, max: Infinity, rate: 0.11 },
      ],
      head_of_household: [
        { min: 0, max: 14400, rate: 0.014 }, { min: 14400, max: 21600, rate: 0.032 },
        { min: 21600, max: 28800, rate: 0.055 }, { min: 28800, max: 36000, rate: 0.064 },
        { min: 36000, max: 54000, rate: 0.068 }, { min: 54000, max: 72000, rate: 0.072 },
        { min: 72000, max: 187500, rate: 0.076 }, { min: 187500, max: 262500, rate: 0.079 },
        { min: 262500, max: 337500, rate: 0.0825 }, { min: 337500, max: 412500, rate: 0.09 },
        { min: 412500, max: 487500, rate: 0.10 }, { min: 487500, max: Infinity, rate: 0.11 },
      ],
    },
    stdDeduction: { mode: 'fixed', single: 8000, married_separate: 8000, married_joint: 16000, head_of_household: 12000 },
    exemption: { mode: 'deduction', single: 1144, married_separate: 1144, married_joint: 2288, head_of_household: 1144 },
    federalDeductible: false,
    retirement: { pensionExempt: true }, // employer-funded pensions exempt; 401k/IRA taxable; SS exempt (HI not in STATES_THAT_TAX_SS)
    recapture: null,
  },

  // ── OREGON ── 4 brackets (4.75/6.75/8.75/9.9%). Federal income tax is
  // deductible but CAPPED + AGI-phased (orFederalSubtraction). Own standard
  // deduction (2025 base, CPI-indexed forward). Personal exemption is a CREDIT
  // ($256/filer 2025 base). Exempts SS; pensions/401k/IRA fully taxable (the
  // low-income retirement-income credit is omitted). MFS shares the single
  // schedule; HOH shares the MFJ schedule (OR statute). OR indexes brackets/
  // std-deduction/cap annually → inflationIndexed true. The exemption-credit
  // phaseout (federal AGI > $100k single / $200k MFJ) is omitted (small credit).
  // Local Portland-area taxes (Metro SHS, Multnomah PFA) are NOT modeled — the
  // app only knows state. Source: https://www.oregon.gov/dor/programs/individuals/pages/pit.aspx
  Oregon: {
    inflationIndexed: true,
    brackets: {
      single: [
        { min: 0, max: 4050, rate: 0.0475 }, { min: 4050, max: 10200, rate: 0.0675 },
        { min: 10200, max: 125000, rate: 0.0875 }, { min: 125000, max: Infinity, rate: 0.099 },
      ],
      married_separate: [
        { min: 0, max: 4050, rate: 0.0475 }, { min: 4050, max: 10200, rate: 0.0675 },
        { min: 10200, max: 125000, rate: 0.0875 }, { min: 125000, max: Infinity, rate: 0.099 },
      ],
      married_joint: [
        { min: 0, max: 8100, rate: 0.0475 }, { min: 8100, max: 20400, rate: 0.0675 },
        { min: 20400, max: 250000, rate: 0.0875 }, { min: 250000, max: Infinity, rate: 0.099 },
      ],
      head_of_household: [
        { min: 0, max: 8100, rate: 0.0475 }, { min: 8100, max: 20400, rate: 0.0675 },
        { min: 20400, max: 250000, rate: 0.0875 }, { min: 250000, max: Infinity, rate: 0.099 },
      ],
    },
    stdDeduction: { mode: 'fixed', single: 2835, married_separate: 2835, married_joint: 5670, head_of_household: 4560 },
    exemption: { mode: 'credit', single: 256, married_separate: 256, married_joint: 512, head_of_household: 256 },
    federalDeductible: orFederalSubtraction,
    retirement: {}, // pensions/401k/IRA taxable; SS exempt (OR not in STATES_THAT_TAX_SS)
    recapture: null,
  },

  // ── MINNESOTA ── 4 brackets (5.35/6.8/7.85/9.85%), 2026 figures published by
  // MN DOR (2025-12-16 release; indexed +2.369%). Federal-style standard
  // deduction (2026: single/MFS $15,300 / MFJ $30,600 / HOH $23,000). MN has NO
  // personal exemption (only a dependent exemption, not modeled). MN TAXES SS
  // (in STATES_THAT_TAX_SS) — the partial SS subtraction is intentionally not
  // modeled (binary SS decision); pensions/401k/IRA taxable. Brackets + std
  // deduction are CPI-indexed annually → inflationIndexed true.
  // Source: https://www.revenue.state.mn.us/minnesota-income-tax-rates-and-brackets
  Minnesota: {
    inflationIndexed: true,
    brackets: {
      single: [
        { min: 0, max: 33310, rate: 0.0535 }, { min: 33310, max: 109430, rate: 0.068 },
        { min: 109430, max: 203150, rate: 0.0785 }, { min: 203150, max: Infinity, rate: 0.0985 },
      ],
      married_separate: [
        { min: 0, max: 24350, rate: 0.0535 }, { min: 24350, max: 96740, rate: 0.068 },
        { min: 96740, max: 168965, rate: 0.0785 }, { min: 168965, max: Infinity, rate: 0.0985 },
      ],
      married_joint: [
        { min: 0, max: 48700, rate: 0.0535 }, { min: 48700, max: 193480, rate: 0.068 },
        { min: 193480, max: 337930, rate: 0.0785 }, { min: 337930, max: Infinity, rate: 0.0985 },
      ],
      head_of_household: [
        { min: 0, max: 41010, rate: 0.0535 }, { min: 41010, max: 164800, rate: 0.068 },
        { min: 164800, max: 270060, rate: 0.0785 }, { min: 270060, max: Infinity, rate: 0.0985 },
      ],
    },
    stdDeduction: { mode: 'fixed', single: 15300, married_separate: 15300, married_joint: 30600, head_of_household: 23000 },
    exemption: { mode: 'none' },
    federalDeductible: false,
    retirement: {}, // SS taxed (MN in STATES_THAT_TAX_SS); pensions/401k/IRA taxable
    recapture: null,
  },

  // ── CONNECTICUT ── 7 brackets by status; NO standard deduction. Personal
  // exemption (phased) and pension/IRA exclusion (phased) bundled in ctExclusions.
  // Table D benefit recapture flattens high earners toward 6.99% (ctRecapture);
  // tiny Table C 2% add-back omitted as immaterial/unverifiable. CT TAXES SS (in
  // STATES_THAT_TAX_SS) — partial SS subtraction not modeled (binary decision).
  // NOT inflation-indexed (CT brackets/exemptions are statutory, not CPI-tied).
  // Local income tax: none in CT. Source: https://portal.ct.gov/drs (CT-1040).
  Connecticut: {
    inflationIndexed: false,
    brackets: {
      single: [
        { min: 0, max: 10000, rate: 0.02 }, { min: 10000, max: 50000, rate: 0.045 },
        { min: 50000, max: 100000, rate: 0.055 }, { min: 100000, max: 200000, rate: 0.06 },
        { min: 200000, max: 250000, rate: 0.065 }, { min: 250000, max: 500000, rate: 0.069 },
        { min: 500000, max: Infinity, rate: 0.0699 },
      ],
      married_separate: [
        { min: 0, max: 10000, rate: 0.02 }, { min: 10000, max: 50000, rate: 0.045 },
        { min: 50000, max: 100000, rate: 0.055 }, { min: 100000, max: 200000, rate: 0.06 },
        { min: 200000, max: 250000, rate: 0.065 }, { min: 250000, max: 500000, rate: 0.069 },
        { min: 500000, max: Infinity, rate: 0.0699 },
      ],
      married_joint: [
        { min: 0, max: 20000, rate: 0.02 }, { min: 20000, max: 100000, rate: 0.045 },
        { min: 100000, max: 200000, rate: 0.055 }, { min: 200000, max: 400000, rate: 0.06 },
        { min: 400000, max: 500000, rate: 0.065 }, { min: 500000, max: 1000000, rate: 0.069 },
        { min: 1000000, max: Infinity, rate: 0.0699 },
      ],
      head_of_household: [
        { min: 0, max: 16000, rate: 0.02 }, { min: 16000, max: 80000, rate: 0.045 },
        { min: 80000, max: 160000, rate: 0.055 }, { min: 160000, max: 320000, rate: 0.06 },
        { min: 320000, max: 400000, rate: 0.065 }, { min: 400000, max: 800000, rate: 0.069 },
        { min: 800000, max: Infinity, rate: 0.0699 },
      ],
    },
    stdDeduction: { mode: 'none' },
    exemption: { mode: 'none' }, // personal exemption handled in ctExclusions (phased)
    federalDeductible: false,
    retirement: { exclusionFn: ctExclusions },
    recapture: ctRecapture,
  },

  // ── MISSOURI ── 2026: FLAT 4.7% (HB 798 collapsed the brackets; top rate cut).
  // Federal-tax deduction for individuals was ELIMINATED (SB 151) → federalDeductible
  // false. Standard deduction = federal std deduction + $4,000 (federal_plus mode).
  // Public-pension exclusion (capped, SS-reduced) modeled via moPublicPensionExclusion;
  // SS fully exempt (MO not in STATES_THAT_TAX_SS). Indexed forward.
  // Source: https://dor.mo.gov/ (MO-1040).
  Missouri: {
    inflationIndexed: true,
    brackets: {
      single:            [{ min: 0, max: Infinity, rate: 0.047 }],
      married_separate:  [{ min: 0, max: Infinity, rate: 0.047 }],
      married_joint:     [{ min: 0, max: Infinity, rate: 0.047 }],
      head_of_household: [{ min: 0, max: Infinity, rate: 0.047 }],
    },
    stdDeduction: { mode: 'federal_plus', offset: 4000 },
    exemption: { mode: 'none' },
    federalDeductible: false,
    retirement: { exclusionFn: moPublicPensionExclusion },
    recapture: null,
  },

  // ── MONTANA ── 2026: two brackets 4.7% / 5.65% (HB 337), starting from FEDERAL
  // TAXABLE INCOME (federal_taxable std deduction). SS now EXEMPT for 2026 (HB148)
  // → removed from STATES_THAT_TAX_SS. Federal-tax deduction repealed → false.
  // Over-65 subtraction ($5,500/person) modeled. Long-term capital-gains lower
  // rate (3.0%/4.1%) NOT modeled (engine has no LTCG split).
  // Source: https://mtrevenue.gov/ (Form 2).
  Montana: {
    inflationIndexed: true,
    brackets: {
      single:            [{ min: 0, max: 47500, rate: 0.047 }, { min: 47500, max: Infinity, rate: 0.0565 }],
      married_separate:  [{ min: 0, max: 47500, rate: 0.047 }, { min: 47500, max: Infinity, rate: 0.0565 }],
      married_joint:     [{ min: 0, max: 95000, rate: 0.047 }, { min: 95000, max: Infinity, rate: 0.0565 }],
      head_of_household: [{ min: 0, max: 71250, rate: 0.047 }, { min: 71250, max: Infinity, rate: 0.0565 }],
    },
    stdDeduction: { mode: 'federal_taxable' },
    exemption: { mode: 'none' },
    federalDeductible: false,
    retirement: { over65Exclusion: 5500, over65Age: 65 },
    recapture: null,
  },

  // ── VIRGINIA ── 4 brackets, FIRST-DOLLAR (bottom bracket starts at $0), SAME
  // for all filing statuses, and NOT inflation-indexed (statutory since 1990).
  // Std deduction statutory (2026: $8,750 single/HOH/MFS, $17,500 MFJ — the
  // post-2026 sunset to $6,000 is a scheduled future cut, intentionally NOT
  // modeled). $930/person personal exemption (deduction). Age deduction (65+,
  // income-phased) via vaAgeDeduction. SS exempt; no local income tax.
  // Source: https://www.tax.virginia.gov/income-tax-calculator
  Virginia: {
    inflationIndexed: false,
    brackets: {
      single: [
        { min: 0, max: 3000, rate: 0.02 }, { min: 3000, max: 5000, rate: 0.03 },
        { min: 5000, max: 17000, rate: 0.05 }, { min: 17000, max: Infinity, rate: 0.0575 },
      ],
      married_separate: [
        { min: 0, max: 3000, rate: 0.02 }, { min: 3000, max: 5000, rate: 0.03 },
        { min: 5000, max: 17000, rate: 0.05 }, { min: 17000, max: Infinity, rate: 0.0575 },
      ],
      married_joint: [
        { min: 0, max: 3000, rate: 0.02 }, { min: 3000, max: 5000, rate: 0.03 },
        { min: 5000, max: 17000, rate: 0.05 }, { min: 17000, max: Infinity, rate: 0.0575 },
      ],
      head_of_household: [
        { min: 0, max: 3000, rate: 0.02 }, { min: 3000, max: 5000, rate: 0.03 },
        { min: 5000, max: 17000, rate: 0.05 }, { min: 17000, max: Infinity, rate: 0.0575 },
      ],
    },
    stdDeduction: { mode: 'fixed', single: 8750, married_separate: 8750, married_joint: 17500, head_of_household: 8750 },
    exemption: { mode: 'deduction', single: 930, married_separate: 930, married_joint: 1860, head_of_household: 930 },
    federalDeductible: false,
    retirement: { exclusionFn: vaAgeDeduction },
    recapture: null,
  },

  // ── WISCONSIN ── 4 brackets 3.5/4.4/5.3/7.65% (2025 Act 15 widened the 4.4%
  // band). Sliding-scale standard deduction (getWisconsinStandardDeduction).
  // $700/person personal exemption (deduction). Retirement exclusion $24k/person
  // age 67+ (Act 15) via wiRetirementExclusion. SS exempt; indexed annually.
  // Top-bracket thresholds vary by source — VERIFY against 2026 Form 1.
  // Source: https://www.revenue.wi.gov/Pages/FAQS/pcs-taxrates.aspx
  Wisconsin: {
    inflationIndexed: true,
    brackets: {
      single: [
        { min: 0, max: 14680, rate: 0.035 }, { min: 14680, max: 50480, rate: 0.044 },
        { min: 50480, max: 323290, rate: 0.053 }, { min: 323290, max: Infinity, rate: 0.0765 },
      ],
      head_of_household: [
        { min: 0, max: 14680, rate: 0.035 }, { min: 14680, max: 50480, rate: 0.044 },
        { min: 50480, max: 323290, rate: 0.053 }, { min: 323290, max: Infinity, rate: 0.0765 },
      ],
      married_joint: [
        { min: 0, max: 19580, rate: 0.035 }, { min: 19580, max: 67300, rate: 0.044 },
        { min: 67300, max: 431060, rate: 0.053 }, { min: 431060, max: Infinity, rate: 0.0765 },
      ],
      married_separate: [
        { min: 0, max: 9790, rate: 0.035 }, { min: 9790, max: 33650, rate: 0.044 },
        { min: 33650, max: 215530, rate: 0.053 }, { min: 215530, max: Infinity, rate: 0.0765 },
      ],
    },
    stdDeduction: { mode: 'sliding', fn: getWisconsinStandardDeduction },
    exemption: { mode: 'deduction', single: 700, married_separate: 700, married_joint: 1400, head_of_household: 700 },
    federalDeductible: false,
    retirement: { exclusionFn: wiRetirementExclusion },
    recapture: null,
  },

  // ── MAINE ── 3 brackets 5.8/6.75/7.15%. Std deduction = federal std deduction,
  // phased out for high earners (getMaineStandardDeduction). $5,150/person
  // personal exemption (deduction). Pension income deduction up to $48,216/person,
  // SS-reduced and income-phased (maineRetirementExclusion). SS exempt; indexed.
  // Source: https://www.maine.gov/revenue (2025 1040ME instructions).
  Maine: {
    inflationIndexed: true,
    brackets: {
      single: [
        { min: 0, max: 26800, rate: 0.058 }, { min: 26800, max: 63450, rate: 0.0675 },
        { min: 63450, max: Infinity, rate: 0.0715 },
      ],
      married_separate: [
        { min: 0, max: 26800, rate: 0.058 }, { min: 26800, max: 63450, rate: 0.0675 },
        { min: 63450, max: Infinity, rate: 0.0715 },
      ],
      married_joint: [
        { min: 0, max: 53600, rate: 0.058 }, { min: 53600, max: 126900, rate: 0.0675 },
        { min: 126900, max: Infinity, rate: 0.0715 },
      ],
      head_of_household: [
        { min: 0, max: 40200, rate: 0.058 }, { min: 40200, max: 95150, rate: 0.0675 },
        { min: 95150, max: Infinity, rate: 0.0715 },
      ],
    },
    stdDeduction: { mode: 'sliding', fn: getMaineStandardDeduction },
    exemption: { mode: 'deduction', single: 5150, married_separate: 5150, married_joint: 10300, head_of_household: 5150 },
    federalDeductible: false,
    retirement: { exclusionFn: maineRetirementExclusion },
    recapture: null,
  },

  // ── MARYLAND ── 8 base brackets 2%–5.75% + two 2025 high-earner brackets
  // (6.25%, 6.5%). Different upper thresholds by status. NEW 2025 fixed standard
  // deduction ($3,350 single/MFS, $6,700 MFJ/HOH). $3,200/person exemption
  // (phaseout omitted). Pension exclusion (65+, SS-reduced) via mdPensionExclusion.
  // SS exempt. Local county income tax NOT modeled (state only); 2% high-income
  // cap-gains surtax NOT modeled. Brackets statutory (not indexed).
  // Source: https://www.marylandtaxes.gov (FY2026 BRFA / HB352).
  Maryland: {
    inflationIndexed: false,
    brackets: {
      single: [
        { min: 0, max: 1000, rate: 0.02 }, { min: 1000, max: 2000, rate: 0.03 },
        { min: 2000, max: 3000, rate: 0.04 }, { min: 3000, max: 100000, rate: 0.0475 },
        { min: 100000, max: 125000, rate: 0.05 }, { min: 125000, max: 150000, rate: 0.0525 },
        { min: 150000, max: 250000, rate: 0.055 }, { min: 250000, max: 500000, rate: 0.0575 },
        { min: 500000, max: 1000000, rate: 0.0625 }, { min: 1000000, max: Infinity, rate: 0.065 },
      ],
      married_separate: [
        { min: 0, max: 1000, rate: 0.02 }, { min: 1000, max: 2000, rate: 0.03 },
        { min: 2000, max: 3000, rate: 0.04 }, { min: 3000, max: 100000, rate: 0.0475 },
        { min: 100000, max: 125000, rate: 0.05 }, { min: 125000, max: 150000, rate: 0.0525 },
        { min: 150000, max: 250000, rate: 0.055 }, { min: 250000, max: 500000, rate: 0.0575 },
        { min: 500000, max: 1000000, rate: 0.0625 }, { min: 1000000, max: Infinity, rate: 0.065 },
      ],
      married_joint: [
        { min: 0, max: 1000, rate: 0.02 }, { min: 1000, max: 2000, rate: 0.03 },
        { min: 2000, max: 3000, rate: 0.04 }, { min: 3000, max: 150000, rate: 0.0475 },
        { min: 150000, max: 175000, rate: 0.05 }, { min: 175000, max: 225000, rate: 0.0525 },
        { min: 225000, max: 300000, rate: 0.055 }, { min: 300000, max: 600000, rate: 0.0575 },
        { min: 600000, max: 1200000, rate: 0.0625 }, { min: 1200000, max: Infinity, rate: 0.065 },
      ],
      head_of_household: [
        { min: 0, max: 1000, rate: 0.02 }, { min: 1000, max: 2000, rate: 0.03 },
        { min: 2000, max: 3000, rate: 0.04 }, { min: 3000, max: 150000, rate: 0.0475 },
        { min: 150000, max: 175000, rate: 0.05 }, { min: 175000, max: 225000, rate: 0.0525 },
        { min: 225000, max: 300000, rate: 0.055 }, { min: 300000, max: 600000, rate: 0.0575 },
        { min: 600000, max: 1200000, rate: 0.0625 }, { min: 1200000, max: Infinity, rate: 0.065 },
      ],
    },
    stdDeduction: { mode: 'fixed', single: 3350, married_separate: 3350, married_joint: 6700, head_of_household: 6700 },
    exemption: { mode: 'deduction', single: 3200, married_separate: 3200, married_joint: 6400, head_of_household: 3200 },
    federalDeductible: false,
    retirement: { exclusionFn: mdPensionExclusion },
    recapture: null,
  },

  // ── DISTRICT OF COLUMBIA ── 7 brackets 4%–10.75%, SAME for all filing statuses
  // (unchanged since 2022, not indexed). Std deduction = federal std deduction.
  // $1,675/person personal exemption (deduction). SS exempt; no local tax.
  // Source: https://otr.cfo.dc.gov/page/dc-individual-and-fiduciary-income-tax-rates
  'District of Columbia': {
    inflationIndexed: false,
    brackets: {
      single: [
        { min: 0, max: 10000, rate: 0.04 }, { min: 10000, max: 40000, rate: 0.06 },
        { min: 40000, max: 60000, rate: 0.065 }, { min: 60000, max: 250000, rate: 0.085 },
        { min: 250000, max: 500000, rate: 0.0925 }, { min: 500000, max: 1000000, rate: 0.0975 },
        { min: 1000000, max: Infinity, rate: 0.1075 },
      ],
      married_separate: [
        { min: 0, max: 10000, rate: 0.04 }, { min: 10000, max: 40000, rate: 0.06 },
        { min: 40000, max: 60000, rate: 0.065 }, { min: 60000, max: 250000, rate: 0.085 },
        { min: 250000, max: 500000, rate: 0.0925 }, { min: 500000, max: 1000000, rate: 0.0975 },
        { min: 1000000, max: Infinity, rate: 0.1075 },
      ],
      married_joint: [
        { min: 0, max: 10000, rate: 0.04 }, { min: 10000, max: 40000, rate: 0.06 },
        { min: 40000, max: 60000, rate: 0.065 }, { min: 60000, max: 250000, rate: 0.085 },
        { min: 250000, max: 500000, rate: 0.0925 }, { min: 500000, max: 1000000, rate: 0.0975 },
        { min: 1000000, max: Infinity, rate: 0.1075 },
      ],
      head_of_household: [
        { min: 0, max: 10000, rate: 0.04 }, { min: 10000, max: 40000, rate: 0.06 },
        { min: 40000, max: 60000, rate: 0.065 }, { min: 60000, max: 250000, rate: 0.085 },
        { min: 250000, max: 500000, rate: 0.0925 }, { min: 500000, max: 1000000, rate: 0.0975 },
        { min: 1000000, max: Infinity, rate: 0.1075 },
      ],
    },
    stdDeduction: { mode: 'federal_taxable' },
    exemption: { mode: 'deduction', single: 1675, married_separate: 1675, married_joint: 3350, head_of_household: 1675 },
    federalDeductible: false,
    retirement: {},
    recapture: null,
  },

  // ── DELAWARE ── 6 brackets 2.2%–6.6% (first $2,000 untaxed), SAME for all
  // statuses, not indexed. Fixed std deduction ($3,250 single/HOH, $6,500 MFJ).
  // $110/person personal CREDIT. Pension exclusion (60+ $12,500/person, else
  // $2,000) via deRetirementExclusion; the $2,500 age-65 additional std deduction
  // via over65Exclusion. SS exempt. Source: 30 Del. C. ch. 11.
  Delaware: {
    inflationIndexed: false,
    brackets: {
      single: [
        { min: 0, max: 2000, rate: 0 }, { min: 2000, max: 5000, rate: 0.022 },
        { min: 5000, max: 10000, rate: 0.039 }, { min: 10000, max: 20000, rate: 0.048 },
        { min: 20000, max: 25000, rate: 0.052 }, { min: 25000, max: 60000, rate: 0.0555 },
        { min: 60000, max: Infinity, rate: 0.066 },
      ],
      married_separate: [
        { min: 0, max: 2000, rate: 0 }, { min: 2000, max: 5000, rate: 0.022 },
        { min: 5000, max: 10000, rate: 0.039 }, { min: 10000, max: 20000, rate: 0.048 },
        { min: 20000, max: 25000, rate: 0.052 }, { min: 25000, max: 60000, rate: 0.0555 },
        { min: 60000, max: Infinity, rate: 0.066 },
      ],
      married_joint: [
        { min: 0, max: 2000, rate: 0 }, { min: 2000, max: 5000, rate: 0.022 },
        { min: 5000, max: 10000, rate: 0.039 }, { min: 10000, max: 20000, rate: 0.048 },
        { min: 20000, max: 25000, rate: 0.052 }, { min: 25000, max: 60000, rate: 0.0555 },
        { min: 60000, max: Infinity, rate: 0.066 },
      ],
      head_of_household: [
        { min: 0, max: 2000, rate: 0 }, { min: 2000, max: 5000, rate: 0.022 },
        { min: 5000, max: 10000, rate: 0.039 }, { min: 10000, max: 20000, rate: 0.048 },
        { min: 20000, max: 25000, rate: 0.052 }, { min: 25000, max: 60000, rate: 0.0555 },
        { min: 60000, max: Infinity, rate: 0.066 },
      ],
    },
    stdDeduction: { mode: 'fixed', single: 3250, married_separate: 3250, married_joint: 6500, head_of_household: 3250 },
    exemption: { mode: 'credit', single: 110, married_separate: 110, married_joint: 220, head_of_household: 110 },
    federalDeductible: false,
    retirement: { exclusionFn: deRetirementExclusion, over65Exclusion: 2500, over65Age: 65 },
    recapture: null,
  },

  // ── RHODE ISLAND ── 3 brackets 3.75/4.75/5.99% (indexed annually). Fixed std
  // deduction ($10,900 single/MFS, $21,800 MFJ, $16,350 HOH; high-income phaseout
  // omitted). $5,100/person exemption (phaseout omitted). RI TAXES SS (binary).
  // Pension/annuity modification (FRA + income-limited) via riRetirementExclusion.
  // Source: https://tax.ri.gov (2025 Tax Rate & Worksheets).
  'Rhode Island': {
    inflationIndexed: true,
    brackets: {
      single: [
        { min: 0, max: 79900, rate: 0.0375 }, { min: 79900, max: 181650, rate: 0.0475 },
        { min: 181650, max: Infinity, rate: 0.0599 },
      ],
      married_separate: [
        { min: 0, max: 79900, rate: 0.0375 }, { min: 79900, max: 181650, rate: 0.0475 },
        { min: 181650, max: Infinity, rate: 0.0599 },
      ],
      married_joint: [
        { min: 0, max: 79900, rate: 0.0375 }, { min: 79900, max: 181650, rate: 0.0475 },
        { min: 181650, max: Infinity, rate: 0.0599 },
      ],
      head_of_household: [
        { min: 0, max: 79900, rate: 0.0375 }, { min: 79900, max: 181650, rate: 0.0475 },
        { min: 181650, max: Infinity, rate: 0.0599 },
      ],
    },
    stdDeduction: { mode: 'fixed', single: 10900, married_separate: 10900, married_joint: 21800, head_of_household: 16350 },
    exemption: { mode: 'deduction', single: 5100, married_separate: 5100, married_joint: 10200, head_of_household: 5100 },
    federalDeductible: false,
    retirement: { exclusionFn: riRetirementExclusion },
    recapture: null,
  },

  // ── ARKANSAS ── condensed schedule; top rate 3.9% (2024 cut). Note the AR
  // quirk: the middle bracket rate (4.0%) exceeds the top (3.9%). Brackets do
  // NOT vary by filing status. $29/person personal tax CREDIT. SS exempt.
  // VERIFY 2026 figures vs AR1000F instructions (Tax Foundation 2026).
  'Arkansas': {
    inflationIndexed: true,
    brackets: {
      single: [{ min: 0, max: 4500, rate: 0.02 }, { min: 4500, max: 8900, rate: 0.04 }, { min: 8900, max: Infinity, rate: 0.039 }],
      married_separate: [{ min: 0, max: 4500, rate: 0.02 }, { min: 4500, max: 8900, rate: 0.04 }, { min: 8900, max: Infinity, rate: 0.039 }],
      married_joint: [{ min: 0, max: 4500, rate: 0.02 }, { min: 4500, max: 8900, rate: 0.04 }, { min: 8900, max: Infinity, rate: 0.039 }],
      head_of_household: [{ min: 0, max: 4500, rate: 0.02 }, { min: 4500, max: 8900, rate: 0.04 }, { min: 8900, max: Infinity, rate: 0.039 }],
    },
    stdDeduction: { mode: 'fixed', single: 2400, married_separate: 2400, married_joint: 4800, head_of_household: 2400 },
    exemption: { mode: 'credit', single: 29, married_separate: 29, married_joint: 58, head_of_household: 29 },
    federalDeductible: false,
    retirement: { exclusionFn: arRetirementExclusion },
    recapture: null,
  },

  // ── KANSAS ── two brackets (5.2% / 5.58%) per 2024 reform (SB 1). $9,160
  // personal exemption per filer (deduction mode). SS fully exempt 2024+.
  // KS taxes private pensions / IRA / 401k (only KPERS exempt) → no broad
  // retirement exclusion modeled. VERIFY 2026 thresholds vs K-40 instructions.
  'Kansas': {
    inflationIndexed: true,
    brackets: {
      single: [{ min: 0, max: 23000, rate: 0.052 }, { min: 23000, max: Infinity, rate: 0.0558 }],
      married_separate: [{ min: 0, max: 23000, rate: 0.052 }, { min: 23000, max: Infinity, rate: 0.0558 }],
      married_joint: [{ min: 0, max: 46000, rate: 0.052 }, { min: 46000, max: Infinity, rate: 0.0558 }],
      head_of_household: [{ min: 0, max: 23000, rate: 0.052 }, { min: 23000, max: Infinity, rate: 0.0558 }],
    },
    stdDeduction: { mode: 'fixed', single: 3605, married_separate: 4120, married_joint: 8240, head_of_household: 6180 },
    exemption: { mode: 'deduction', single: 9160, married_separate: 9160, married_joint: 18320, head_of_household: 9160 },
    federalDeductible: false,
    retirement: {},
    recapture: null,
  },

  // ── NEBRASKA ── 2026 base year: top marginal 4.55% (LB754 schedule; the
  // further 2027 cut to 3.99% is NOT applied). Lower brackets kept. $157/person
  // personal-exemption CREDIT. SS fully exempt 2025+. NE taxes IRA/401k/pensions
  // → no broad exclusion. VERIFY 2026 bracket consolidation vs 1040N instructions.
  'Nebraska': {
    inflationIndexed: true,
    brackets: {
      single: [{ min: 0, max: 3700, rate: 0.0246 }, { min: 3700, max: 22170, rate: 0.0351 }, { min: 22170, max: 35730, rate: 0.0455 }, { min: 35730, max: Infinity, rate: 0.0455 }],
      married_separate: [{ min: 0, max: 3695, rate: 0.0246 }, { min: 3695, max: 22175, rate: 0.0351 }, { min: 22175, max: 35730, rate: 0.0455 }, { min: 35730, max: Infinity, rate: 0.0455 }],
      married_joint: [{ min: 0, max: 7390, rate: 0.0246 }, { min: 7390, max: 44350, rate: 0.0351 }, { min: 44350, max: 71460, rate: 0.0455 }, { min: 71460, max: Infinity, rate: 0.0455 }],
      head_of_household: [{ min: 0, max: 6900, rate: 0.0246 }, { min: 6900, max: 35480, rate: 0.0351 }, { min: 35480, max: 53120, rate: 0.0455 }, { min: 53120, max: Infinity, rate: 0.0455 }],
    },
    stdDeduction: { mode: 'fixed', single: 7900, married_separate: 7900, married_joint: 15800, head_of_household: 11600 },
    exemption: { mode: 'credit', single: 157, married_separate: 157, married_joint: 314, head_of_household: 157 },
    federalDeductible: false,
    retirement: {},
    recapture: null,
  },

  // ── NEW MEXICO ── taxes SS (binary STATES_THAT_TAX_SS, with statutory low-
  // income SS exemption not modeled). Starts from federal taxable income →
  // federal std deduction subtracted. No separate personal exemption (NM low-
  // income comprehensive exemption omitted). VERIFY 2026 brackets vs PIT-1.
  'New Mexico': {
    inflationIndexed: true,
    brackets: {
      single: [{ min: 0, max: 5500, rate: 0.017 }, { min: 5500, max: 11000, rate: 0.032 }, { min: 11000, max: 16000, rate: 0.047 }, { min: 16000, max: 210000, rate: 0.049 }, { min: 210000, max: Infinity, rate: 0.059 }],
      married_separate: [{ min: 0, max: 4000, rate: 0.017 }, { min: 4000, max: 8000, rate: 0.032 }, { min: 8000, max: 12000, rate: 0.047 }, { min: 12000, max: 157500, rate: 0.049 }, { min: 157500, max: Infinity, rate: 0.059 }],
      married_joint: [{ min: 0, max: 8000, rate: 0.017 }, { min: 8000, max: 16000, rate: 0.032 }, { min: 16000, max: 24000, rate: 0.047 }, { min: 24000, max: 315000, rate: 0.049 }, { min: 315000, max: Infinity, rate: 0.059 }],
      head_of_household: [{ min: 0, max: 8000, rate: 0.017 }, { min: 8000, max: 16000, rate: 0.032 }, { min: 16000, max: 24000, rate: 0.047 }, { min: 24000, max: 315000, rate: 0.049 }, { min: 315000, max: Infinity, rate: 0.059 }],
    },
    stdDeduction: { mode: 'federal_taxable' },
    exemption: { mode: 'none' },
    federalDeductible: false,
    retirement: {},
    recapture: null,
  },

  // ── NORTH DAKOTA ── 2023 reform: zero-rate bottom bracket, then 1.95% / 2.50%.
  // Starts from federal taxable income → federal std deduction subtracted. No
  // separate exemption. SS exempt. VERIFY 2026 thresholds vs ND-1 instructions.
  'North Dakota': {
    inflationIndexed: true,
    brackets: {
      single: [{ min: 0, max: 44725, rate: 0 }, { min: 44725, max: 225975, rate: 0.0195 }, { min: 225975, max: Infinity, rate: 0.025 }],
      married_separate: [{ min: 0, max: 37375, rate: 0 }, { min: 37375, max: 137550, rate: 0.0195 }, { min: 137550, max: Infinity, rate: 0.025 }],
      married_joint: [{ min: 0, max: 74750, rate: 0 }, { min: 74750, max: 275100, rate: 0.0195 }, { min: 275100, max: Infinity, rate: 0.025 }],
      head_of_household: [{ min: 0, max: 59950, rate: 0 }, { min: 59950, max: 250500, rate: 0.0195 }, { min: 250500, max: Infinity, rate: 0.025 }],
    },
    stdDeduction: { mode: 'federal_taxable' },
    exemption: { mode: 'none' },
    federalDeductible: false,
    retirement: {},
    recapture: null,
  },

  // ── OKLAHOMA ── six fixed brackets (top 4.75%); NOT inflation-indexed.
  // $1,000/person personal exemption (deduction). $10,000/person retirement-
  // income exclusion (exclusionFn). SS exempt. VERIFY vs 511 instructions.
  'Oklahoma': {
    inflationIndexed: false,
    brackets: {
      single: [{ min: 0, max: 1000, rate: 0.0025 }, { min: 1000, max: 2500, rate: 0.0075 }, { min: 2500, max: 3750, rate: 0.0175 }, { min: 3750, max: 4900, rate: 0.0275 }, { min: 4900, max: 7200, rate: 0.0375 }, { min: 7200, max: Infinity, rate: 0.0475 }],
      married_separate: [{ min: 0, max: 1000, rate: 0.0025 }, { min: 1000, max: 2500, rate: 0.0075 }, { min: 2500, max: 3750, rate: 0.0175 }, { min: 3750, max: 4900, rate: 0.0275 }, { min: 4900, max: 7200, rate: 0.0375 }, { min: 7200, max: Infinity, rate: 0.0475 }],
      married_joint: [{ min: 0, max: 2000, rate: 0.0025 }, { min: 2000, max: 5000, rate: 0.0075 }, { min: 5000, max: 7500, rate: 0.0175 }, { min: 7500, max: 9800, rate: 0.0275 }, { min: 9800, max: 14400, rate: 0.0375 }, { min: 14400, max: Infinity, rate: 0.0475 }],
      head_of_household: [{ min: 0, max: 2000, rate: 0.0025 }, { min: 2000, max: 5000, rate: 0.0075 }, { min: 5000, max: 7500, rate: 0.0175 }, { min: 7500, max: 9800, rate: 0.0275 }, { min: 9800, max: 14400, rate: 0.0375 }, { min: 14400, max: Infinity, rate: 0.0475 }],
    },
    stdDeduction: { mode: 'fixed', single: 6350, married_separate: 6350, married_joint: 12700, head_of_household: 9350 },
    exemption: { mode: 'deduction', single: 1000, married_separate: 1000, married_joint: 2000, head_of_household: 1000 },
    federalDeductible: false,
    retirement: { exclusionFn: okRetirementExclusion },
    recapture: null,
  },

  // ── SOUTH CAROLINA ── 2026 base top rate 6.0% (statutory reduction from 6.2%).
  // Brackets do NOT vary by filing status. Starts from federal taxable income →
  // federal std deduction subtracted. $10k/$15k (65+) retirement deduction per
  // person (exclusionFn). SS exempt. VERIFY vs SC1040 instructions.
  'South Carolina': {
    inflationIndexed: true,
    brackets: {
      single: [{ min: 0, max: 3560, rate: 0 }, { min: 3560, max: 17830, rate: 0.03 }, { min: 17830, max: Infinity, rate: 0.06 }],
      married_separate: [{ min: 0, max: 3560, rate: 0 }, { min: 3560, max: 17830, rate: 0.03 }, { min: 17830, max: Infinity, rate: 0.06 }],
      married_joint: [{ min: 0, max: 3560, rate: 0 }, { min: 3560, max: 17830, rate: 0.03 }, { min: 17830, max: Infinity, rate: 0.06 }],
      head_of_household: [{ min: 0, max: 3560, rate: 0 }, { min: 3560, max: 17830, rate: 0.03 }, { min: 17830, max: Infinity, rate: 0.06 }],
    },
    stdDeduction: { mode: 'federal_taxable' },
    exemption: { mode: 'none' },
    federalDeductible: false,
    retirement: { exclusionFn: scRetirementExclusion },
    recapture: null,
  },

  // ── VERMONT ── taxes SS (binary; statutory income-based SS exclusion not
  // modeled). Own std deduction + $4,850/person personal exemption (deduction).
  // No broad pension exclusion. VERIFY 2026 brackets vs IN-111 instructions.
  'Vermont': {
    inflationIndexed: true,
    brackets: {
      single: [{ min: 0, max: 45400, rate: 0.0335 }, { min: 45400, max: 110050, rate: 0.066 }, { min: 110050, max: 229550, rate: 0.076 }, { min: 229550, max: Infinity, rate: 0.0875 }],
      married_separate: [{ min: 0, max: 37925, rate: 0.0335 }, { min: 37925, max: 91700, rate: 0.066 }, { min: 91700, max: 139725, rate: 0.076 }, { min: 139725, max: Infinity, rate: 0.0875 }],
      married_joint: [{ min: 0, max: 75850, rate: 0.0335 }, { min: 75850, max: 183400, rate: 0.066 }, { min: 183400, max: 279450, rate: 0.076 }, { min: 279450, max: Infinity, rate: 0.0875 }],
      head_of_household: [{ min: 0, max: 60850, rate: 0.0335 }, { min: 60850, max: 157150, rate: 0.066 }, { min: 157150, max: 254500, rate: 0.076 }, { min: 254500, max: Infinity, rate: 0.0875 }],
    },
    stdDeduction: { mode: 'fixed', single: 7000, married_separate: 7025, married_joint: 14050, head_of_household: 10500 },
    exemption: { mode: 'deduction', single: 4850, married_separate: 4850, married_joint: 9700, head_of_household: 4850 },
    federalDeductible: false,
    retirement: {},
    recapture: null,
  },

  // ── WEST VIRGINIA ── SS FULLY exempt for 2026 (phase-out complete) → removed
  // from STATES_THAT_TAX_SS. No standard deduction; starts from federal AGI.
  // $2,000/person personal exemption (deduction). $8,000 senior income
  // modification (over-65). Single & MFJ share the schedule; MFS is halved.
  // NOT inflation-indexed (fixed statutory brackets). VERIFY 2026 rates vs IT-140.
  'West Virginia': {
    inflationIndexed: false,
    brackets: {
      single: [{ min: 0, max: 10000, rate: 0.0222 }, { min: 10000, max: 25000, rate: 0.0296 }, { min: 25000, max: 40000, rate: 0.0333 }, { min: 40000, max: 60000, rate: 0.044 }, { min: 60000, max: Infinity, rate: 0.0482 }],
      married_separate: [{ min: 0, max: 5000, rate: 0.0222 }, { min: 5000, max: 12500, rate: 0.0296 }, { min: 12500, max: 20000, rate: 0.0333 }, { min: 20000, max: 30000, rate: 0.044 }, { min: 30000, max: Infinity, rate: 0.0482 }],
      married_joint: [{ min: 0, max: 10000, rate: 0.0222 }, { min: 10000, max: 25000, rate: 0.0296 }, { min: 25000, max: 40000, rate: 0.0333 }, { min: 40000, max: 60000, rate: 0.044 }, { min: 60000, max: Infinity, rate: 0.0482 }],
      head_of_household: [{ min: 0, max: 10000, rate: 0.0222 }, { min: 10000, max: 25000, rate: 0.0296 }, { min: 25000, max: 40000, rate: 0.0333 }, { min: 40000, max: 60000, rate: 0.044 }, { min: 60000, max: Infinity, rate: 0.0482 }],
    },
    stdDeduction: { mode: 'none' },
    exemption: { mode: 'deduction', single: 2000, married_separate: 2000, married_joint: 4000, head_of_household: 2000 },
    federalDeductible: false,
    retirement: { over65Exclusion: 8000, over65Age: 65 },
    recapture: null,
  },
};

// Generic progressive state tax calculator. Signature mirrors calculateStateTax
// so the dispatcher can forward arguments unchanged.
//   extraParams: { federalTaxPaid, primaryAge, spouseAge, qualifiedRetirementWithdrawals }
const calculateStateTaxProgressive = (grossIncome, state, filingStatus, yearsFromNow = 0, inflationRate = 0.03, taxableSS = 0, retirementIncome = 0, extraParams = {}) => {
  const config = STATE_TAX_CONFIG[state];
  if (!config) return 0;
  if (grossIncome <= 0) return 0;

  const inf = config.inflationIndexed ? indexTo(1, yearsFromNow, inflationRate) : 1;
  const r = config.retirement || {};

  let agi = grossIncome;

  // Social Security exclusion (binary — most states exempt SS entirely).
  if (!STATES_THAT_TAX_SS.has(state)) agi -= taxableSS;

  // Pension / defined-benefit exclusion.
  if (r.pensionExempt) agi -= retirementIncome;

  // Broad qualified-distribution exclusion (401k/IRA/RMD) for states that exempt all.
  if (r.qualifiedExempt) agi -= (extraParams.qualifiedRetirementWithdrawals || 0);

  // Custom income-phased retirement exclusion (e.g. NJ pension exclusion with
  // total-income tiers + per-status caps; NY $20k private exclusion). The fn
  // returns the dollar amount to exclude from state AGI.
  if (typeof r.exclusionFn === 'function') {
    const excluded = r.exclusionFn({
      grossIncome, retirementIncome,
      qualifiedWithdrawals: extraParams.qualifiedRetirementWithdrawals || 0,
      taxableSS, filingStatus,
      primaryAge: extraParams.primaryAge || 0,
      spouseAge: extraParams.spouseAge || 0,
      agi, inf,
    });
    agi -= Math.min(Math.max(0, excluded), Math.max(0, agi));
  }

  // Over-65 retirement income exclusion (per person; spouse counts only when MFJ).
  if (r.over65Exclusion) {
    const over65Age = r.over65Age || 65;
    const primaryAge = extraParams.primaryAge || 0;
    const spouseAge = extraParams.spouseAge || 0;
    let exclusion = 0;
    if (primaryAge >= over65Age) exclusion += r.over65Exclusion;
    if (filingStatus === 'married_joint' && spouseAge >= over65Age) exclusion += r.over65Exclusion;
    agi -= Math.min(exclusion, Math.max(0, agi));
  }

  agi = Math.max(0, agi);

  // Federal income tax deductibility (AL full; MO/MT/OR capped). Creates a
  // circular dependency resolved by the projection solver passing federalTaxPaid.
  if (config.federalDeductible) {
    const fed = extraParams.federalTaxPaid !== undefined
      ? extraParams.federalTaxPaid
      : calculateFederalTax(grossIncome, filingStatus, yearsFromNow, inflationRate);
    let deductibleFed = fed;
    if (typeof config.federalDeductible === 'function') {
      // Bespoke rule (e.g. OR: capped + AGI-phased). Receives running AGI as a
      // federal-AGI proxy (SS already removed for states that exempt it).
      deductibleFed = config.federalDeductible(fed, agi, filingStatus, inf);
    } else if (typeof config.federalDeductible === 'object' && config.federalDeductible.cap) {
      const cap = config.federalDeductible.cap[filingStatus] ?? config.federalDeductible.cap.single ?? Infinity;
      deductibleFed = Math.min(fed, cap * inf);
    }
    agi = Math.max(0, agi - deductibleFed);
  }

  // Standard deduction.
  const stdDed = resolveStateStdDeduction(config.stdDeduction, agi, filingStatus, inf);

  // Personal exemption taken as a deduction (vs. credit-mode handled after brackets).
  let exemptionDeduction = 0;
  const ex = config.exemption;
  if (ex && ex.mode === 'deduction') {
    exemptionDeduction = (ex[filingStatus] ?? ex.single ?? 0) * inf;
  }

  const taxableIncome = Math.max(0, agi - stdDed - exemptionDeduction);

  const brackets = config.brackets[filingStatus] || config.brackets.single;
  let tax = applyStateBrackets(taxableIncome, brackets, inf);

  // Personal exemption taken as a tax credit (CA, OR, DE, AR, NE).
  if (ex && ex.mode === 'credit') {
    const credit = (ex[filingStatus] ?? ex.single ?? 0) * inf;
    tax = Math.max(0, tax - credit);
  }

  // Benefit/bracket recapture override (CT add-back, NY top-rate-on-all).
  if (typeof config.recapture === 'function') {
    tax = config.recapture(tax, taxableIncome, agi, filingStatus, inf, brackets);
  }

  return Math.max(0, tax);
};

// Backward-compatible Alabama wrapper — delegates to the generic engine using the
// Alabama config. Kept so existing callers/tests that import calculateAlabamaTax
// continue to work unchanged.
//   isGovernmentPension=false → pension is NOT exempted (pass retirementIncome as 0).
const calculateAlabamaTax = (grossIncome, federalTaxPaid, filingStatus, taxableSS = 0, retirementIncome = 0, primaryAge = 0, spouseAge = 0, isGovernmentPension = true) => {
  return calculateStateTaxProgressive(
    grossIncome, 'Alabama', filingStatus, 0, 0, taxableSS,
    isGovernmentPension ? retirementIncome : 0,
    { federalTaxPaid, primaryAge, spouseAge }
  );
};


// FICA / payroll tax constants (2025/2026)
// Social Security: 6.2% employee + 6.2% employer (we model employee share only)
// Medicare: 1.45% + 0.9% Additional Medicare Tax above threshold
const FICA_SS_RATE = 0.062;
const FICA_SS_WAGE_BASE_2025 = 184500; // 2026 wage base (SSA); inflation-indexed below. Name kept for stability; value is 2026.
const FICA_MEDICARE_RATE = 0.0145;
const FICA_ADDITIONAL_MEDICARE_RATE = 0.009;
const FICA_ADDITIONAL_MEDICARE_THRESHOLD = {
  single: 200000,
  married_joint: 250000,
  married_separate: 125000,
  head_of_household: 200000
};

// Calculate employee FICA taxes on earned income
const calculateFICA = (earnedIncome, filingStatus, yearsFromNow = 0, inflationRate = 0.03) => {
  if (earnedIncome <= 0) return { socialSecurity: 0, medicare: 0, total: 0 };
  
  // Inflate the SS wage base
  const inflationFactor = indexTo(1, yearsFromNow, inflationRate);
  const wageBase = FICA_SS_WAGE_BASE_2025 * inflationFactor;
  
  // Social Security tax (capped at wage base)
  const ssTax = Math.min(earnedIncome, wageBase) * FICA_SS_RATE;
  
  // Medicare tax (no cap) + Additional Medicare Tax for high earners.
  // NOTE: the Additional Medicare Tax threshold ($200k single / $250k MFJ) is fixed by
  // statute and is NOT inflation-indexed, so it is applied as-is (no inflationFactor).
  const threshold = FICA_ADDITIONAL_MEDICARE_THRESHOLD[filingStatus] || FICA_ADDITIONAL_MEDICARE_THRESHOLD.married_joint;
  let medicareTax = earnedIncome * FICA_MEDICARE_RATE;
  if (earnedIncome > threshold) {
    medicareTax += (earnedIncome - threshold) * FICA_ADDITIONAL_MEDICARE_RATE;
  }
  
  return {
    socialSecurity: ssTax,
    medicare: medicareTax,
    total: ssTax + medicareTax
  };
};

// IRS Uniform Lifetime Table (updated per IRS Publication 590-B)
// MORTALITY TABLE -- CDC/NCHS National Vital Statistics Reports vol. 74 no. 2,
// Table 1: life table for the TOTAL population, United States, 2022. qx is the
// probability of dying between age x and x+1.
//
// Total-population (unisex) rates are used because the app does not ask anyone
// their sex, and inventing a field to collect it in order to run a simulation
// would be a poor trade. Real male/female life expectancy at 65 differs by
// roughly three years, so a single plan should be read as the household average.
//
// Two extraction details that materially affect the tail:
//   - the CDC final row is "100 and over", an OPEN interval carrying a synthetic
//     qx of 1 rather than a real one-year rate. Taken literally it truncates the
//     hazard and cost 0.30 years of life expectancy at age 95, so it is discarded.
//   - the table is extended to 115 with a Gompertz fit (log qx is near-linear in
//     age) over ages 79-99, reaching certainty at 115.
// Reconstructing ex from these rates reproduces the published life expectancy
// column within 0.06 years from age 50 through 95; that check is a test.
const MORTALITY_MIN_AGE = 50;
const MORTALITY_QX = '0.004515,0.004833,0.005204,0.005647,0.006162,0.006709,0.007285,0.007930,0.008641,0.009392,0.010173,0.010960,0.011741,0.012524,0.013340,0.014218,0.015280,0.016329,0.017524,0.018824,0.020179,0.021711,0.023521,0.025618,0.028122,0.030467,0.034339,0.037380,0.041500,0.045247,0.050833,0.056254,0.062471,0.069526,0.076869,0.086054,0.094545,0.106195,0.118983,0.132946,0.148104,0.164457,0.181983,0.200630,0.220320,0.240942,0.262361,0.284411,0.306908,0.329650,0.394361,0.436526,0.483199,0.534862,0.592048,0.655349,0.725418,0.802979,0.888833,0.983865,1.000000,1.000000,1.000000,1.000000,1.000000,1.000000';

// Parsed once, not on every lookup — Monte Carlo calls this millions of times.
const MORTALITY_QX_ARR = MORTALITY_QX.split(',').map(Number);

// Probability of dying between `age` and age+1. Below the table everyone
// survives (nobody runs a retirement projection from 30), above it nobody does.
const mortalityQx = (age) => {
  if (age < MORTALITY_MIN_AGE) return 0;
  const q = MORTALITY_QX_ARR[age - MORTALITY_MIN_AGE];
  return q === undefined ? 1 : q;
};

// Mean remaining years for someone alive at `age`, computed from the hazard.
// Deaths are credited half a year, matching the convention the published ex
// column uses — which is what lets the reconstruction be checked against it.
const lifeExpectancyAt = (age) => {
  let alive = 1, total = 0;
  for (let a = Math.max(age, MORTALITY_MIN_AGE); ; a++) {
    const p = mortalityQx(a);
    total += alive * (1 - p) + alive * p * 0.5;
    alive *= (1 - p);
    if (alive < 1e-12 || a > 200) break;
  }
  return total;
};

// Draw an age at death for someone alive at `currentAge`.
//
// `shiftYears` slides the whole distribution so a plan's own life-expectancy
// input still sets the central tendency. Someone who enters 95 on the strength
// of family history should not have every simulation quietly re-centre on the
// national average of ~83 — but they should still get the SHAPE of real
// mortality around it, which is the entire point of sampling rather than
// assuming. The shape is population data; the level is the user's judgement.
const sampleAgeAtDeath = (currentAge, rand, shiftYears = 0) => {
  const start = Math.max(Math.floor(currentAge), MORTALITY_MIN_AGE);
  for (let a = start; a <= 200; a++) {
    if (rand() < mortalityQx(a)) {
      return Math.max(Math.floor(currentAge) + 1, a + Math.round(shiftYears));
    }
  }
  return Math.max(Math.floor(currentAge) + 1, 200 + Math.round(shiftYears));
};

// IRS Pub 590-B, Appendix B, Table II (Joint and Last Survivor Life Expectancy).
// Governs when the spouse is the sole designated beneficiary AND more than 10
// years younger. Extracted directly from the publication PDF -- not transcribed
// by hand, not interpolated, not curve fitted. Three independent checks confirm
// the extraction:
//   1. the 4,640 parsed pairs agree wherever the printed blocks overlap, with
//      zero conflicts;
//   2. the result is perfectly symmetric, as any joint life expectancy must be;
//   3. Table II at exactly a 10-year gap reproduces the Uniform Lifetime divisor
//      at every age tested. That identity is what makes the ">10 years younger"
//      rule meaningful, and any row/column misalignment in the parse would have
//      broken it immediately.
// The publication's own worked example (owner 75, spouse 64 -> 25.3) is pinned
// as a test, alongside the 10-year identity.
//
// Only the reachable slice is stored: owner 72+ (the earliest SECURE 2.0 start
// age) and spouse 20 through owner-11. Each row is comma-separated factors
// indexed from RMD_JOINT_MIN_SPOUSE_AGE.
const RMD_JOINT_MIN_SPOUSE_AGE = 20;
const RMD_JOINT_FACTORS = {
  72: '65.1,64.2,63.2,62.2,61.3,60.3,59.3,58.4,57.4,56.5,55.5,54.5,53.6,52.6,51.7,50.8,49.8,48.9,47.9,47,46,45.1,44.2,43.2,42.3,41.4,40.5,39.6,38.7,37.8,36.9,36,35.2,34.3,33.5,32.7,31.9,31.1,30.3,29.5,28.8,28.1,27.4',
  73: '65.1,64.2,63.2,62.2,61.2,60.3,59.3,58.4,57.4,56.4,55.5,54.5,53.6,52.6,51.7,50.7,49.8,48.8,47.9,46.9,46,45.1,44.1,43.2,42.3,41.4,40.4,39.5,38.6,37.7,36.8,36,35.1,34.2,33.4,32.6,31.7,30.9,30.1,29.4,28.6,27.9,27.2,26.5',
  74: '65.1,64.1,63.2,62.2,61.2,60.3,59.3,58.3,57.4,56.4,55.5,54.5,53.6,52.6,51.7,50.7,49.8,48.8,47.9,46.9,46,45,44.1,43.2,42.2,41.3,40.4,39.5,38.6,37.7,36.8,35.9,35,34.1,33.3,32.4,31.6,30.8,30,29.2,28.4,27.7,27,26.2,25.5',
  75: '65.1,64.1,63.2,62.2,61.2,60.3,59.3,58.3,57.4,56.4,55.5,54.5,53.5,52.6,51.6,50.7,49.7,48.8,47.8,46.9,45.9,45,44.1,43.1,42.2,41.3,40.3,39.4,38.5,37.6,36.7,35.8,34.9,34.1,33.2,32.4,31.5,30.7,29.9,29.1,28.3,27.5,26.8,26.1,25.3,24.6',
  76: '65.1,64.1,63.2,62.2,61.2,60.2,59.3,58.3,57.4,56.4,55.4,54.5,53.5,52.6,51.6,50.7,49.7,48.8,47.8,46.9,45.9,45,44,43.1,42.2,41.2,40.3,39.4,38.5,37.5,36.6,35.7,34.9,34,33.1,32.3,31.4,30.6,29.8,29,28.2,27.4,26.6,25.9,25.2,24.4,23.7',
  77: '65.1,64.1,63.1,62.2,61.2,60.2,59.3,58.3,57.3,56.4,55.4,54.5,53.5,52.6,51.6,50.7,49.7,48.8,47.8,46.9,45.9,45,44,43.1,42.1,41.2,40.3,39.3,38.4,37.5,36.6,35.7,34.8,33.9,33,32.2,31.3,30.5,29.7,28.8,28,27.3,26.5,25.7,25,24.3,23.5,22.9',
  78: '65.1,64.1,63.1,62.2,61.2,60.2,59.3,58.3,57.3,56.4,55.4,54.5,53.5,52.6,51.6,50.6,49.7,48.7,47.8,46.8,45.9,44.9,44,43,42.1,41.2,40.2,39.3,38.4,37.5,36.5,35.6,34.7,33.9,33,32.1,31.2,30.4,29.6,28.7,27.9,27.1,26.4,25.6,24.8,24.1,23.4,22.7,22',
  79: '65.1,64.1,63.1,62.2,61.2,60.2,59.3,58.3,57.3,56.4,55.4,54.5,53.5,52.5,51.6,50.6,49.7,48.7,47.8,46.8,45.9,44.9,44,43,42.1,41.1,40.2,39.3,38.3,37.4,36.5,35.6,34.7,33.8,32.9,32,31.2,30.3,29.5,28.7,27.8,27,26.2,25.5,24.7,23.9,23.2,22.5,21.8,21.1',
  80: '65.1,64.1,63.1,62.1,61.2,60.2,59.2,58.3,57.3,56.4,55.4,54.4,53.5,52.5,51.6,50.6,49.7,48.7,47.8,46.8,45.9,44.9,43.9,43,42.1,41.1,40.2,39.2,38.3,37.4,36.5,35.5,34.6,33.7,32.9,32,31.1,30.3,29.4,28.6,27.8,26.9,26.1,25.3,24.6,23.8,23.1,22.3,21.6,20.9,20.2',
  81: '65.1,64.1,63.1,62.1,61.2,60.2,59.2,58.3,57.3,56.4,55.4,54.4,53.5,52.5,51.6,50.6,49.7,48.7,47.7,46.8,45.8,44.9,43.9,43,42,41.1,40.1,39.2,38.3,37.3,36.4,35.5,34.6,33.7,32.8,31.9,31.1,30.2,29.3,28.5,27.7,26.9,26,25.2,24.5,23.7,22.9,22.2,21.5,20.7,20,19.4',
  82: '65.1,64.1,63.1,62.1,61.2,60.2,59.2,58.3,57.3,56.3,55.4,54.4,53.5,52.5,51.6,50.6,49.7,48.7,47.7,46.8,45.8,44.9,43.9,43,42,41.1,40.1,39.2,38.3,37.3,36.4,35.5,34.6,33.7,32.8,31.9,31,30.1,29.3,28.4,27.6,26.8,26,25.2,24.4,23.6,22.8,22.1,21.3,20.6,19.9,19.2,18.5',
  83: '65.1,64.1,63.1,62.1,61.2,60.2,59.2,58.3,57.3,56.3,55.4,54.4,53.5,52.5,51.6,50.6,49.6,48.7,47.7,46.8,45.8,44.9,43.9,43,42,41.1,40.1,39.2,38.2,37.3,36.4,35.4,34.5,33.6,32.7,31.8,31,30.1,29.2,28.4,27.5,26.7,25.9,25.1,24.3,23.5,22.7,22,21.2,20.5,19.7,19,18.3,17.7',
  84: '65.1,64.1,63.1,62.1,61.2,60.2,59.2,58.3,57.3,56.3,55.4,54.4,53.5,52.5,51.5,50.6,49.6,48.7,47.7,46.8,45.8,44.9,43.9,42.9,42,41,40.1,39.2,38.2,37.3,36.3,35.4,34.5,33.6,32.7,31.8,30.9,30,29.2,28.3,27.5,26.7,25.8,25,24.2,23.4,22.6,21.9,21.1,20.4,19.6,18.9,18.2,17.5,16.8',
  85: '65.1,64.1,63.1,62.1,61.2,60.2,59.2,58.3,57.3,56.3,55.4,54.4,53.5,52.5,51.5,50.6,49.6,48.7,47.7,46.8,45.8,44.8,43.9,42.9,42,41,40.1,39.1,38.2,37.3,36.3,35.4,34.5,33.6,32.7,31.8,30.9,30,29.1,28.3,27.4,26.6,25.8,25,24.1,23.3,22.6,21.8,21,20.3,19.5,18.8,18.1,17.4,16.7,16',
  86: '65.1,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.4,54.4,53.5,52.5,51.5,50.6,49.6,48.7,47.7,46.7,45.8,44.8,43.9,42.9,42,41,40.1,39.1,38.2,37.2,36.3,35.4,34.5,33.5,32.6,31.7,30.9,30,29.1,28.2,27.4,26.6,25.7,24.9,24.1,23.3,22.5,21.7,20.9,20.2,19.4,18.7,17.9,17.2,16.5,15.9,15.2',
  87: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.4,54.4,53.4,52.5,51.5,50.6,49.6,48.7,47.7,46.7,45.8,44.8,43.9,42.9,42,41,40.1,39.1,38.2,37.2,36.3,35.4,34.4,33.5,32.6,31.7,30.8,29.9,29.1,28.2,27.4,26.5,25.7,24.9,24,23.2,22.4,21.6,20.9,20.1,19.3,18.6,17.8,17.1,16.4,15.7,15.1,14.4',
  88: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.4,54.4,53.4,52.5,51.5,50.6,49.6,48.7,47.7,46.7,45.8,44.8,43.9,42.9,42,41,40,39.1,38.2,37.2,36.3,35.3,34.4,33.5,32.6,31.7,30.8,29.9,29,28.2,27.3,26.5,25.6,24.8,24,23.2,22.4,21.6,20.8,20,19.2,18.5,17.7,17,16.3,15.6,14.9,14.3,13.7',
  89: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.4,54.4,53.4,52.5,51.5,50.6,49.6,48.7,47.7,46.7,45.8,44.8,43.9,42.9,41.9,41,40,39.1,38.1,37.2,36.3,35.3,34.4,33.5,32.6,31.7,30.8,29.9,29,28.2,27.3,26.4,25.6,24.8,24,23.1,22.3,21.5,20.7,20,19.2,18.4,17.7,16.9,16.2,15.5,14.8,14.2,13.5,12.9',
  90: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.4,54.4,53.4,52.5,51.5,50.6,49.6,48.6,47.7,46.7,45.8,44.8,43.9,42.9,41.9,41,40,39.1,38.1,37.2,36.3,35.3,34.4,33.5,32.6,31.7,30.8,29.9,29,28.1,27.3,26.4,25.6,24.7,23.9,23.1,22.3,21.5,20.7,19.9,19.1,18.4,17.6,16.9,16.1,15.4,14.8,14.1,13.4,12.8,12.2',
  91: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.6,49.6,48.6,47.7,46.7,45.8,44.8,43.9,42.9,41.9,41,40,39.1,38.1,37.2,36.2,35.3,34.4,33.5,32.5,31.6,30.7,29.9,29,28.1,27.3,26.4,25.6,24.7,23.9,23.1,22.3,21.5,20.7,19.9,19.1,18.3,17.5,16.8,16.1,15.3,14.6,14,13.3,12.7,12.1,11.5',
  92: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.6,49.6,48.6,47.7,46.7,45.8,44.8,43.8,42.9,41.9,41,40,39.1,38.1,37.2,36.2,35.3,34.4,33.5,32.5,31.6,30.7,29.8,29,28.1,27.2,26.4,25.5,24.7,23.9,23,22.2,21.4,20.6,19.8,19,18.3,17.5,16.7,16,15.3,14.6,13.9,13.2,12.6,11.9,11.4,10.8',
  93: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.6,49.6,48.6,47.7,46.7,45.8,44.8,43.8,42.9,41.9,41,40,39.1,38.1,37.2,36.2,35.3,34.4,33.4,32.5,31.6,30.7,29.8,29,28.1,27.2,26.4,25.5,24.7,23.8,23,22.2,21.4,20.6,19.8,19,18.2,17.4,16.7,15.9,15.2,14.5,13.8,13.1,12.5,11.9,11.3,10.7,10.1',
  94: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.6,49.6,48.6,47.7,46.7,45.8,44.8,43.8,42.9,41.9,41,40,39.1,38.1,37.2,36.2,35.3,34.4,33.4,32.5,31.6,30.7,29.8,28.9,28.1,27.2,26.3,25.5,24.7,23.8,23,22.2,21.4,20.6,19.8,19,18.2,17.4,16.6,15.9,15.2,14.4,13.7,13.1,12.4,11.8,11.2,10.6,10,9.5',
  95: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.6,49.6,48.6,47.7,46.7,45.8,44.8,43.8,42.9,41.9,41,40,39.1,38.1,37.2,36.2,35.3,34.4,33.4,32.5,31.6,30.7,29.8,28.9,28.1,27.2,26.3,25.5,24.6,23.8,23,22.2,21.4,20.6,19.7,18.9,18.2,17.4,16.6,15.9,15.1,14.4,13.7,13,12.3,11.7,11.1,10.5,9.9,9.4,8.9',
  96: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.6,49.6,48.6,47.7,46.7,45.8,44.8,43.8,42.9,41.9,41,40,39.1,38.1,37.2,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.2,26.3,25.5,24.6,23.8,23,22.2,21.3,20.5,19.7,18.9,18.1,17.4,16.6,15.8,15.1,14.3,13.6,12.9,12.3,11.6,11,10.4,9.9,9.3,8.8,8.4',
  97: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.6,49.6,48.6,47.7,46.7,45.8,44.8,43.8,42.9,41.9,41,40,39.1,38.1,37.2,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.2,26.3,25.5,24.6,23.8,23,22.1,21.3,20.5,19.7,18.9,18.1,17.3,16.6,15.8,15,14.3,13.6,12.9,12.2,11.6,11,10.4,9.8,9.2,8.7,8.3,7.8',
  98: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.6,49.6,48.6,47.7,46.7,45.8,44.8,43.8,42.9,41.9,41,40,39.1,38.1,37.2,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.2,26.3,25.5,24.6,23.8,22.9,22.1,21.3,20.5,19.7,18.9,18.1,17.3,16.5,15.8,15,14.3,13.6,12.9,12.2,11.5,10.9,10.3,9.7,9.2,8.7,8.2,7.7,7.3',
  99: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.6,49.6,48.6,47.7,46.7,45.8,44.8,43.8,42.9,41.9,41,40,39.1,38.1,37.2,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.2,26.3,25.4,24.6,23.8,22.9,22.1,21.3,20.5,19.7,18.9,18.1,17.3,16.5,15.7,15,14.3,13.5,12.8,12.2,11.5,10.9,10.2,9.7,9.1,8.6,8.1,7.6,7.2,6.8',
  100: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.6,49.6,48.6,47.7,46.7,45.8,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.8,22.9,22.1,21.3,20.5,19.7,18.9,18.1,17.3,16.5,15.7,15,14.2,13.5,12.8,12.1,11.5,10.8,10.2,9.6,9.1,8.5,8,7.6,7.2,6.8,6.4',
  101: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.6,49.6,48.6,47.7,46.7,45.8,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.8,22.9,22.1,21.3,20.5,19.7,18.9,18.1,17.3,16.5,15.7,15,14.2,13.5,12.8,12.1,11.4,10.8,10.2,9.6,9,8.5,8,7.5,7.1,6.7,6.3,6',
  102: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.6,49.6,48.6,47.7,46.7,45.8,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.5,19.7,18.8,18,17.3,16.5,15.7,14.9,14.2,13.5,12.8,12.1,11.4,10.8,10.1,9.6,9,8.5,8,7.5,7,6.6,6.3,5.9,5.6',
  103: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.5,49.6,48.6,47.7,46.7,45.8,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.5,19.6,18.8,18,17.3,16.5,15.7,14.9,14.2,13.5,12.8,12.1,11.4,10.7,10.1,9.5,9,8.4,7.9,7.4,7,6.6,6.2,5.9,5.5,5.2',
  104: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.5,49.6,48.6,47.7,46.7,45.8,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.5,19.6,18.8,18,17.2,16.5,15.7,14.9,14.2,13.5,12.7,12,11.4,10.7,10.1,9.5,8.9,8.4,7.9,7.4,7,6.6,6.2,5.8,5.5,5.2,4.9',
  105: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.5,49.6,48.6,47.7,46.7,45.7,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.5,19.6,18.8,18,17.2,16.5,15.7,14.9,14.2,13.4,12.7,12,11.4,10.7,10.1,9.5,8.9,8.4,7.9,7.4,6.9,6.5,6.1,5.8,5.4,5.1,4.9,4.6',
  106: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.5,49.6,48.6,47.7,46.7,45.7,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.5,19.6,18.8,18,17.2,16.5,15.7,14.9,14.2,13.4,12.7,12,11.4,10.7,10.1,9.5,8.9,8.4,7.9,7.4,6.9,6.5,6.1,5.8,5.4,5.1,4.8,4.6,4.3',
  107: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.5,49.6,48.6,47.7,46.7,45.7,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.5,19.6,18.8,18,17.2,16.5,15.7,14.9,14.2,13.4,12.7,12,11.4,10.7,10.1,9.5,8.9,8.4,7.9,7.4,6.9,6.5,6.1,5.8,5.4,5.1,4.8,4.6,4.3,4.1',
  108: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.5,49.6,48.6,47.7,46.7,45.7,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.5,19.6,18.8,18,17.2,16.5,15.7,14.9,14.2,13.4,12.7,12,11.4,10.7,10.1,9.5,8.9,8.4,7.8,7.4,6.9,6.5,6.1,5.7,5.4,5.1,4.8,4.5,4.3,4.1,3.9',
  109: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.5,49.6,48.6,47.7,46.7,45.7,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.4,19.6,18.8,18,17.2,16.4,15.7,14.9,14.2,13.4,12.7,12,11.3,10.7,10.1,9.5,8.9,8.4,7.8,7.4,6.9,6.5,6.1,5.7,5.4,5.1,4.8,4.5,4.3,4.1,3.9,3.7',
  110: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.5,49.6,48.6,47.7,46.7,45.7,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.4,19.6,18.8,18,17.2,16.4,15.7,14.9,14.2,13.4,12.7,12,11.3,10.7,10.1,9.5,8.9,8.3,7.8,7.4,6.9,6.5,6.1,5.7,5.4,5.1,4.8,4.5,4.3,4.1,3.9,3.7,3.5',
  111: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.5,49.6,48.6,47.7,46.7,45.7,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.4,19.6,18.8,18,17.2,16.4,15.7,14.9,14.2,13.4,12.7,12,11.3,10.7,10.1,9.5,8.9,8.3,7.8,7.3,6.9,6.5,6.1,5.7,5.4,5.1,4.8,4.5,4.3,4.1,3.9,3.7,3.5,3.4',
  112: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.5,49.6,48.6,47.7,46.7,45.7,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.4,19.6,18.8,18,17.2,16.4,15.7,14.9,14.2,13.4,12.7,12,11.3,10.7,10.1,9.5,8.9,8.3,7.8,7.3,6.9,6.5,6.1,5.7,5.4,5.1,4.8,4.5,4.3,4,3.8,3.7,3.5,3.4,3.2',
  113: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.5,49.6,48.6,47.7,46.7,45.7,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.4,19.6,18.8,18,17.2,16.4,15.7,14.9,14.2,13.4,12.7,12,11.3,10.7,10,9.4,8.9,8.3,7.8,7.3,6.9,6.4,6.1,5.7,5.3,5,4.7,4.5,4.2,4,3.8,3.6,3.5,3.4,3.2,3.1',
  114: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.5,49.6,48.6,47.7,46.7,45.7,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.4,19.6,18.8,18,17.2,16.4,15.7,14.9,14.1,13.4,12.7,12,11.3,10.7,10,9.4,8.9,8.3,7.8,7.3,6.9,6.4,6,5.7,5.3,5,4.7,4.4,4.2,4,3.8,3.6,3.5,3.3,3.2,3.1,3',
  115: '65,64.1,63.1,62.1,61.1,60.2,59.2,58.2,57.3,56.3,55.3,54.4,53.4,52.5,51.5,50.5,49.6,48.6,47.7,46.7,45.7,44.8,43.8,42.9,41.9,41,40,39,38.1,37.1,36.2,35.3,34.3,33.4,32.5,31.6,30.7,29.8,28.9,28,27.1,26.3,25.4,24.6,23.7,22.9,22.1,21.3,20.4,19.6,18.8,18,17.2,16.4,15.7,14.9,14.1,13.4,12.7,12,11.3,10.7,10,9.4,8.8,8.3,7.8,7.3,6.8,6.4,6,5.6,5.3,5,4.7,4.4,4.2,4,3.8,3.6,3.4,3.3,3.2,3.1,3,2.9',
};

const RMD_FACTORS = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1,
  80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4,
  88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9,
  96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4, 101: 6.0, 102: 5.6, 103: 5.2,
  104: 4.9, 105: 4.6, 106: 4.3, 107: 4.0, 108: 3.7, 109: 3.4, 110: 3.1, 111: 2.9,
  112: 2.6, 113: 2.4, 114: 2.1, 115: 1.9, 116: 1.9, 117: 1.9, 118: 1.9, 119: 1.9, 120: 1.9
};

// Medicare IRMAA Thresholds 2026 (based on 2024 MAGI with 2-year lookback). Source: CMS
// "2026 Medicare Parts A & B Premiums and Deductibles" fact sheet. Standard Part B = $202.90/mo.
// partB = TOTAL monthly Part B premium for the tier (standard 202.90 × 1.0/1.4/2.0/2.6/3.2/3.4);
// partD = monthly Part D IRMAA surcharge for the tier. Name kept for stability; values are 2026.
const IRMAA_THRESHOLDS_2025 = {
  single: [
    { maxIncome: 109000, partB: 202.90, partD: 0 },
    { maxIncome: 137000, partB: 284.10, partD: 14.50 },
    { maxIncome: 171000, partB: 405.80, partD: 37.50 },
    { maxIncome: 205000, partB: 527.50, partD: 60.40 },
    { maxIncome: 500000, partB: 649.20, partD: 83.30 },
    { maxIncome: Infinity, partB: 689.90, partD: 91.00 }
  ],
  married_joint: [
    { maxIncome: 218000, partB: 202.90, partD: 0 },
    { maxIncome: 274000, partB: 284.10, partD: 14.50 },
    { maxIncome: 342000, partB: 405.80, partD: 37.50 },
    { maxIncome: 410000, partB: 527.50, partD: 60.40 },
    { maxIncome: 750000, partB: 649.20, partD: 83.30 },
    { maxIncome: Infinity, partB: 689.90, partD: 91.00 }
  ],
  married_separate: [
    { maxIncome: 109000, partB: 202.90, partD: 0 },
    { maxIncome: 391000, partB: 649.20, partD: 83.30 },
    { maxIncome: Infinity, partB: 689.90, partD: 91.00 }
  ]
};

// Social Security Full Retirement Age by birth year
const SS_FULL_RETIREMENT_AGE = {
  1943: 66, 1944: 66, 1945: 66, 1946: 66, 1947: 66, 1948: 66, 1949: 66, 1950: 66, 1951: 66, 1952: 66, 1953: 66, 1954: 66,
  1955: 66.167, 1956: 66.333, 1957: 66.5, 1958: 66.667, 1959: 66.833,
  1960: 67, // 1960 and later = 67
};

// Pre-1943 FRA phase-in. SSA: 1937 and earlier = 65; 1938-1942 phase from 65y2m to 65y10m.
const SS_FRA_PRE_1943 = {
  1938: 65 + 2/12, 1939: 65 + 4/12, 1940: 65 + 6/12,
  1941: 65 + 8/12, 1942: 65 + 10/12,
};

// Single source of truth for FRA lookup. Used by calculateSSBenefit and the
// SS earnings-test caller. Defends against missing/invalid birth years and
// against the prior fallthrough that treated all pre-1943 cohorts as FRA 67.
const getFullRetirementAge = (birthYear) => {
  if (!birthYear || typeof birthYear !== 'number') return 67;
  if (birthYear <= 1937) return 65;
  if (birthYear >= 1960) return 67;
  return SS_FRA_PRE_1943[birthYear] || SS_FULL_RETIREMENT_AGE[birthYear] || 67;
};

// ACA Federal Poverty Level — 2025 HHS guidelines (48 contiguous states), which
// govern PREMIUM TAX CREDITS for the 2026 coverage year (the ACA uses the prior
// year's FPL). $15,650 for one person + $5,500 per additional person.
// Name kept for stability; values are the 2025 guidelines / 2026 coverage year.
const ACA_FPL_2025 = {
  1: 15650, 2: 21150, 3: 26650, 4: 32150, 5: 37650, 6: 43150, 7: 48650, 8: 54150
};

// Post-ARPA applicable-percentage table for 2026 (IRS Rev. Proc. 2025-25).
// The enhanced ARPA/IRA subsidies expired 12/31/2025: the 400% FPL hard cliff is
// BACK, and the required contribution runs 2.10% → 9.96% of MAGI with linear
// interpolation inside each band. Rows: from `lo`% to `hi`% of FPL, the
// contribution percentage interpolates pctLo → pctHi.
const ACA_APPLICABLE_PCT_2026 = [
  { lo: 100, hi: 133, pctLo: 0.0210, pctHi: 0.0210 },
  { lo: 133, hi: 150, pctLo: 0.0314, pctHi: 0.0419 },
  { lo: 150, hi: 200, pctLo: 0.0419, pctHi: 0.0660 },
  { lo: 200, hi: 250, pctLo: 0.0660, pctHi: 0.0844 },
  { lo: 250, hi: 300, pctLo: 0.0844, pctHi: 0.0996 },
  { lo: 300, hi: 400, pctLo: 0.0996, pctHi: 0.0996 },
];

// QCD (Qualified Charitable Distribution) constants
// QCDs allow direct IRA-to-charity transfers that satisfy RMD but aren't taxable income
const QCD_ANNUAL_LIMIT = 111000; // 2026 limit per person (indexed for inflation under SECURE 2.0; was 108k in 2025)
const QCD_START_AGE = 70; // Must be 70½ or older (we use 70 for simplicity)

// Social Security Earnings Test (2026 values per SSA COLA fact sheet, inflation-indexed)
// Before FRA: $1 withheld per $2 earned above limit
// Year of FRA: $1 withheld per $3 earned above higher limit (only months before FRA)
// After FRA: no limit
// Names kept for stability; values are 2026.
const SS_EARNINGS_TEST_LIMIT_2025 = 24480;     // Annual limit for years before FRA year
const SS_EARNINGS_TEST_FRA_LIMIT_2025 = 65160;  // Annual limit in the year you reach FRA

// Standard Medicare Part B premium (2025) — used to calculate IRMAA surcharge (amount ABOVE standard)
const MEDICARE_PART_B_STANDARD_2025 = 202.90; // 2026 standard Part B premium per month (CMS). Name kept for stability; value is 2026.

// States that tax Social Security benefits (2025/2026)
// Most have income-based exemptions, but we include them as "may tax SS"
// All other states with income tax exempt SS entirely
const STATES_THAT_TAX_SS = new Set([
  // Montana removed for 2026 — HB148 exempts Social Security starting 2026.
  // West Virginia removed for 2026 — SB 2033 phase-out complete, SS fully exempt.
  'Colorado', 'Connecticut', 'Minnesota',
  'New Mexico', 'Rhode Island', 'Utah', 'Vermont'
]);

// Calculate IRMAA premiums based on MAGI.
// Both the MAGI tier thresholds AND the premium dollar amounts are indexed
// forward by the general inflation rate. Previously only the thresholds were
// indexed while the premiums stayed frozen at base-year dollars, which
// systematically understated late-life Medicare surcharges in a projection
// where every other dollar figure is nominal (inflated).
// ── HOW CLOSE IS THIS YEAR TO A MEDICARE CLIFF? ──────────────────────────────
// IRMAA is a step function, not a slope: exceeding a tier edge by one dollar
// costs the entire surcharge, for a full year, per person. That makes proximity
// to an edge a real property of a plan year — any extra income trips it, not
// just a Roth conversion — and nothing in the model surfaced it.
//
// Returns the next edge ABOVE the given MAGI and the distance to it, or null
// when already in the top tier (where there is no further cliff to fall off).
//
// Filing status must come from the year being asked about, not from the plan:
// survivorship switches married_joint to single mid-projection, and the single
// thresholds are roughly half. A year that sat comfortably inside a band while
// filing jointly can be a dollar from the edge as a survivor.
const nextIRMAAThreshold = (magi, filingStatus, yearsFromNow = 0, inflationRate = 0.03) => {
  const lookupStatus = filingStatus === 'head_of_household' ? 'single' : filingStatus;
  const thresholds = IRMAA_THRESHOLDS_2025[lookupStatus] || IRMAA_THRESHOLDS_2025.married_joint;
  const inflationFactor = indexTo(1, yearsFromNow, inflationRate);
  const income = Math.max(0, magi || 0);
  for (let i = 0; i < thresholds.length; i++) {
    const max = thresholds[i].maxIncome;
    // The top tier is open-ended (null / Infinity depending on the table) — there
    // is no edge beyond it.
    if (max === null || max === undefined || max === Infinity) continue;
    const edge = max * inflationFactor;
    if (income <= edge) return { threshold: edge, distance: edge - income, tier: i };
  }
  return null;
};

const calculateIRMAA = (magi, filingStatus, yearsFromNow = 0, inflationRate = 0.03) => {
  // Head of household uses single thresholds per CMS rules
  const lookupStatus = filingStatus === 'head_of_household' ? 'single' : filingStatus;
  const thresholds = IRMAA_THRESHOLDS_2025[lookupStatus] || IRMAA_THRESHOLDS_2025.married_joint;
  const inflationFactor = indexTo(1, yearsFromNow, inflationRate);

  // Find the applicable tier
  for (const tier of thresholds) {
    const adjustedMax = tier.maxIncome === Infinity ? Infinity : tier.maxIncome * inflationFactor;
    if (magi <= adjustedMax) {
      return {
        partBMonthly: tier.partB * inflationFactor,
        partDMonthly: tier.partD * inflationFactor,
        partBAnnual: tier.partB * 12 * inflationFactor,
        partDAnnual: tier.partD * 12 * inflationFactor,
        totalAnnual: (tier.partB + tier.partD) * 12 * inflationFactor,
        tier: thresholds.indexOf(tier)
      };
    }
  }
  // Highest tier
  const lastTier = thresholds[thresholds.length - 1];
  return {
    partBMonthly: lastTier.partB * inflationFactor,
    partDMonthly: lastTier.partD * inflationFactor,
    partBAnnual: lastTier.partB * 12 * inflationFactor,
    partDAnnual: lastTier.partD * 12 * inflationFactor,
    totalAnnual: (lastTier.partB + lastTier.partD) * 12 * inflationFactor,
    tier: thresholds.length - 1
  };
};

// Calculate IRMAA SURCHARGE — the extra cost above the standard premium
// For married couples, each spouse 65+ pays their own surcharge
// Uses 2-year MAGI lookback (we approximate by using current year's MAGI)
const calculateIRMAASurcharge = (magi, filingStatus, yearsFromNow = 0, inflationRate = 0.03, numMedicareEligible = 1) => {
  const irmaa = calculateIRMAA(magi, filingStatus, yearsFromNow, inflationRate);
  // Standard premium indexed by the same rate as the tier premiums above, so the
  // surcharge (tier premium − standard premium) scales consistently in nominal dollars.
  const standardPartB = indexTo(MEDICARE_PART_B_STANDARD_2025, yearsFromNow, inflationRate);
  const surchargePerPerson = Math.max(0, irmaa.partBMonthly - standardPartB) * 12 + irmaa.partDAnnual;
  return {
    surchargePerPerson: Math.round(surchargePerPerson),
    totalSurcharge: Math.round(surchargePerPerson * numMedicareEligible),
    tier: irmaa.tier,
    partBSurchargeMonthly: Math.max(0, irmaa.partBMonthly - standardPartB),
    partDSurchargeMonthly: irmaa.partDMonthly
  };
};

// Social Security Earnings Test
// Reduces SS benefits when claiming before FRA and still earning above the limit
// Returns the annual reduction in SS benefits
const calculateSSEarningsTestReduction = (earnedIncome, claimAge, fra, yearsFromNow = 0, inflationRate = 0.03) => {
  // No reduction at or after FRA
  if (claimAge >= fra) return 0;
  
  const inflationFactor = indexTo(1, yearsFromNow, inflationRate);
  
  // Check if this is the year you reach FRA (use higher limit, $1 per $3)
  const isFRAYear = Math.floor(claimAge) === Math.floor(fra);
  
  if (isFRAYear) {
    const limit = SS_EARNINGS_TEST_FRA_LIMIT_2025 * inflationFactor;
    const excess = Math.max(0, earnedIncome - limit);
    return excess / 3; // $1 withheld per $3 over
  } else {
    const limit = SS_EARNINGS_TEST_LIMIT_2025 * inflationFactor;
    const excess = Math.max(0, earnedIncome - limit);
    return excess / 2; // $1 withheld per $2 over
  }
};

// Calculate Social Security benefit at different claiming ages
// ── HSA WITHDRAWALS (IRC §223(f)) ────────────────────────────────────────────
// An HSA is only tax-free to the extent it pays QUALIFIED MEDICAL EXPENSES.
// Beyond that it is ordinary income, plus a 20% additional tax before age 65.
// From 65 the penalty disappears and a non-qualified withdrawal is simply
// ordinary income — which is why an HSA is often described as becoming a
// traditional IRA at 65. It is strictly better than one, because the medical
// share stays tax-free for life.
//
// Treating the whole balance as tax-free (as this engine did) turns an HSA into
// an unlimited Roth, and the error grows with the balance: a household that
// front-loaded an HSA for decades gets a six-figure tax-free windfall that does
// not exist.
const HSA_NONQUALIFIED_PENALTY_RATE = 0.20;
const HSA_PENALTY_END_AGE = 65;

// ── IRC §121 PRIMARY RESIDENCE GAIN EXCLUSION ────────────────────────────────
// Up to $250,000 of gain on the sale of a primary residence is excluded from
// income; $500,000 for a couple filing jointly. Not inflation-indexed — the
// figures have been unchanged since the Taxpayer Relief Act of 1997, which is
// why an increasing share of long-held homes now produce taxable gain.
//
// Eligibility (ownership and use as a principal residence for 2 of the last 5
// years, and no other §121 exclusion in the prior 2 years) is not verifiable
// from anything this app stores. Marking an asset as a primary residence is the
// user asserting they qualify.
//
// Gain above the exclusion is LONG-TERM capital gain, so it stacks on ordinary
// income for the 0/15/20% brackets, counts for NIIT, and lands in MAGI — which
// is why a downsize can quietly cost two years of IRMAA surcharges on top of
// the capital gains tax itself.
// Remaining mortgage balance on an asset, `yearsFromNow` years out.
//
// Proper amortization, not linear. Real mortgages are back-loaded: early
// payments are mostly interest, so the balance drops slowly at first and then
// accelerates. Linear payoff materially understates debt through the first half
// to two-thirds of the loan.
//
//   B(t) = P x [(1+r)^N - (1+r)^t] / [(1+r)^N - 1]
//
// asset.mortgage is TODAY's outstanding balance (treated as fresh principal),
// mortgagePayoffAge is when it is fully paid, mortgageRate defaults to 6.5%.
// Extracted so a sale pays off the SAME balance the net-worth line carries --
// two implementations of this would drift and the discrepancy would surface as
// unexplained cash at the sale.
const remainingMortgageAt = (asset, myAge, yearsFromNow, pi) => {
  if (!(asset.mortgage > 0) || !asset.mortgagePayoffAge) return 0;
  if (myAge >= asset.mortgagePayoffAge) return 0;
  const N = asset.mortgagePayoffAge - pi.myAge;
  const t = yearsFromNow;
  const r = asset.mortgageRate !== undefined && asset.mortgageRate !== null ? asset.mortgageRate : 0.065;
  if (r > 0 && N > 0) {
    const factorN = Math.pow(1 + r, N);
    const factorT = Math.pow(1 + r, t);
    return Math.max(0, asset.mortgage * (factorN - factorT) / (factorN - 1));
  }
  return Math.max(0, asset.mortgage * Math.max(0, 1 - (t / N))); // r=0 -> linear
};

const SECTION_121_EXCLUSION_SINGLE = 250000;
const SECTION_121_EXCLUSION_JOINT = 500000;

const section121Exclusion = (filingStatus) =>
  filingStatus === 'married_joint' ? SECTION_121_EXCLUSION_JOINT : SECTION_121_EXCLUSION_SINGLE;

// Split an asset sale into the pieces the tax engine needs.
//   salePrice     — gross, before costs
//   costBasis     — purchase price plus improvements
//   sellingCosts  — commission and closing, which REDUCE the gain (they are
//                   added to basis in substance, not deducted separately)
//   mortgage      — paid off out of proceeds; affects cash, never the gain
// Returns { grossGain, excludedGain, taxableGain, netProceeds }.
const computeAssetSale = ({ salePrice = 0, costBasis = 0, sellingCosts = 0, mortgage = 0,
                            isPrimaryResidence = false, filingStatus = 'single' } = {}) => {
  const grossGain = Math.max(0, salePrice - sellingCosts - costBasis);
  const cap = isPrimaryResidence ? section121Exclusion(filingStatus) : 0;
  const excludedGain = Math.min(grossGain, cap);
  const taxableGain = Math.max(0, grossGain - excludedGain);
  // A loss on a personal residence is not deductible (§165(c)), and this engine
  // does not model business-asset losses either, so proceeds never go negative
  // for tax purposes — only the cash does.
  const netProceeds = salePrice - sellingCosts - mortgage;
  return { grossGain, excludedGain, taxableGain, netProceeds };
};

// ── SPOUSAL BENEFIT (42 U.S.C. 402(b)/(c)) ───────────────────────────────────
// A spouse is entitled to the GREATER of their own retired-worker benefit or a
// spousal benefit worth 50% of the higher earner's PIA. This is the difference
// between a stay-at-home spouse projecting $0 of Social Security and projecting
// half of their partner's full benefit, which for a single-earner household is
// one of the largest numbers in the whole plan.
//
// Two rules make this NOT just calculateSSBenefit(workerPia / 2, ...):
//   1. The early-claiming reduction runs on a different schedule — 25/36 of 1%
//      per month for the first 36 months before the claimant's own FRA, then
//      5/12 of 1% per month beyond. (A retired-worker benefit uses 5/9, not
//      25/36, for the first 36.) At 62 against FRA 67 that is a 35% haircut on
//      the spousal benefit versus 30% on a worker benefit.
//   2. Delayed retirement credits do NOT accrue on a spousal benefit. Waiting
//      past FRA to claim as a spouse buys nothing, which is why it caps at 50%.
//
// The 50% is of the worker's PIA, never of the worker's actual check — the
// worker claiming early or late does not change what the spouse receives.
const calculateSpousalBenefit = (workerPia, claimAge, birthYear) => {
  if (!workerPia || workerPia <= 0) return 0;
  if (claimAge < 62) return 0;
  const fra = getFullRetirementAge(birthYear);
  const base = workerPia * 0.5;
  if (claimAge >= fra) return base; // no delayed credits on the spousal portion
  const monthsEarly = Math.round((fra - claimAge) * 12);
  const reduction = monthsEarly <= 36
    ? monthsEarly * (25 / 36) / 100
    : 36 * (25 / 36) / 100 + (monthsEarly - 36) * (5 / 12) / 100;
  return base * Math.max(0, 1 - reduction);
};

const calculateSSBenefit = (pia, claimAge, birthYear) => {
  // Get Full Retirement Age (FRA) — includes pre-1943 phase-in
  const fra = getFullRetirementAge(birthYear);

  if (claimAge < 62) return 0; // Can't claim before 62
  if (claimAge > 70) claimAge = 70; // No additional credits after 70
  
  const monthsFromFRA = (claimAge - fra) * 12;
  
  let adjustmentFactor;
  if (monthsFromFRA < 0) {
    // Early claiming: reduce by 5/9 of 1% for first 36 months, 5/12 of 1% for additional months
    const monthsEarly = Math.abs(monthsFromFRA);
    if (monthsEarly <= 36) {
      adjustmentFactor = 1 - (monthsEarly * 5/9/100);
    } else {
      adjustmentFactor = 1 - (36 * 5/9/100) - ((monthsEarly - 36) * 5/12/100);
    }
  } else {
    // Delayed claiming: increase by 8% per year (2/3 of 1% per month)
    adjustmentFactor = 1 + (monthsFromFRA * 2/3/100);
  }
  
  return Math.round(pia * adjustmentFactor);
};

// Recover the PIA (the benefit at Full Retirement Age) from a benefit the user
// entered for a SPECIFIC claiming age, by inverting calculateSSBenefit's
// adjustment factor.
//
// This matters wherever the app re-prices a benefit at a different claiming age.
// A stream entered as "$2,400/mo starting at 62" is already reduced ~30%; using
// that figure AS the PIA understates every alternative the Social Security tab
// offers, because each one is then computed off a PIA that is 30% too low. The
// error is silent and always in the same direction.
const inferPiaFromBenefit = (monthlyBenefit, claimAge, birthYear) => {
  if (!(monthlyBenefit > 0)) return 0;
  // calculateSSBenefit(pia, ...) is linear in pia, so probe it with 1000 and
  // scale. That keeps the two functions inverse by construction — the reduction
  // and delayed-credit rules live in exactly one place.
  const probe = calculateSSBenefit(1000, claimAge, birthYear);
  if (!(probe > 0)) return monthlyBenefit;
  return monthlyBenefit * 1000 / probe;
};

// SECURE 2.0 RMD start age based on birth year.
// The age at which Required Minimum Distributions begin from traditional pre-tax
// retirement accounts (401k, traditional IRA, etc.). This affects:
//   1. When RMDs are forced (and their tax cost)
//   2. The natural "end" of the cheap Roth conversion window — once RMDs start,
//      they fill your tax brackets and reduce conversion opportunities
//
// History of SECURE 2.0 changes:
//   - Born before 1951: RMDs started at 70½ (pre-SECURE Act) or 72 (SECURE 1.0)
//   - Born 1951-1959:    RMDs start at 73
//   - Born 1960+:        RMDs start at 75
//
// For users born before 1951 we use 72 since most of those folks would have
// already started RMDs and aren't the primary audience for this tool.
const getRmdStartAge = (birthYear) => {
  if (!birthYear || typeof birthYear !== 'number') return 75; // Default to most generous
  if (birthYear <= 1950) return 72;
  if (birthYear <= 1959) return 73;
  return 75;
};

// Smart defaults for the Roth conversion window.
// Returns { startAge, endAge } based on retirement age and RMD start age.
//
// Rationale:
//   - START at retirement age — earned income has stopped, putting you in your
//     lowest-bracket years. Every year before retirement that you have a salary
//     is usually a poor conversion year (salary already fills your bracket).
//   - END the year before RMDs start — once RMDs hit, they're ordinary income
//     that pushes you up the bracket scale, dramatically reducing the value of
//     additional conversions. Converting during the bridge years between
//     retirement and RMDs is the textbook approach.
//
// The end age is INCLUSIVE (the engine does `myAge <= conversionEndAge`), so
// rmdStartAge - 1 means "the last full year before RMDs."
// ── INCOME STREAM COLA ───────────────────────────────────────────────────────
// COLA base for an income stream. Default: the entered amount is nominal at the
// stream's startAge (COLA compounds from start). With todaysDollars: true, the
// amount is in TODAY's dollars and COLA compounds from the current year — so a
// future-dated stream (SS from an SSA statement, future rental) is indexed
// between now and its start instead of paying today's number in future dollars.
//
// At module scope, not inside computeProjections, because the Withdrawals tab
// needs the identical rule. It used to carry its own copy, which had drifted:
// it omitted the (stream.cola || 0) guard, so a stream saved without a COLA
// produced NaN and silently poisoned that tab's income figures.
const streamColaYears = (stream, ownerAge, yearsFromNow) => {
  if (stream.todaysDollars) return yearsFromNow;
  // Standard: COLA compounds from the start age. A colaStartAge delays the first
  // adjustment — the benefit stays frozen at its start-age value until the owner
  // reaches that age (FERS pensions receive NO COLA before 62). Undefined/0 →
  // colaFrom = startAge, i.e. unchanged behavior for every non-FERS stream.
  const colaFrom = stream.colaStartAge ? Math.max(stream.startAge, stream.colaStartAge) : stream.startAge;
  return Math.max(0, ownerAge - colaFrom);
};

// What a stream actually pays when its owner is ownerAge, yearsFromNow from today.
// Returns 0 outside the stream's age window so callers don't repeat that test.
const streamAmountAtAge = (stream, ownerAge, yearsFromNow) => {
  if (!stream || ownerAge < stream.startAge || ownerAge > stream.endAge) return 0;
  return (stream.amount || 0) * Math.pow(1 + (stream.cola || 0), streamColaYears(stream, ownerAge, yearsFromNow));
};

// ── CONTRIBUTION LIMITS ──────────────────────────────────────────────────────
// 2026 IRS limits. Sources: Notice 2025-67 / IR-2025-111 for retirement plans,
// Rev. Proc. 2025-19 for the HSA.
//   402(g) elective deferral   $24,500  — shared across traditional AND Roth
//                                         401(k)/403(b)/457(b) for one person
//   415(c) annual additions    $72,000  — employee + employer, per employer plan
//   age-50 catch-up            $8,000
//   ages 60-63 super catch-up  $11,250  (SECURE 2.0; replaces the age-50 amount)
//   IRA (traditional + Roth)   $7,500 + $1,100 catch-up at 50+
//   HSA                        $4,400 self / $8,750 family + $1,000 at 55+
const LIMIT_402G = 24500;
const LIMIT_415C = 72000;
const LIMIT_CATCHUP_50 = 8000;
const LIMIT_CATCHUP_60_63 = 11250;
const LIMIT_IRA = 7500;
const LIMIT_IRA_CATCHUP = 1100;
const LIMIT_HSA_SELF = 4400;
const LIMIT_HSA_FAMILY = 8750;
const LIMIT_HSA_CATCHUP_55 = 1000;

const workplaceCatchUp = (age) => age >= 60 && age <= 63 ? LIMIT_CATCHUP_60_63 : (age >= 50 ? LIMIT_CATCHUP_50 : 0);

// SECURE 2.0 §603: from 2026, a participant whose PRIOR-YEAR FICA wages from the
// employer sponsoring the plan exceeded this threshold may only make catch-up
// contributions on a ROTH basis. Base figure $145,000 (2023 wages), indexed
// annually; $150,000 applies to 2025 wages, which is what governs 2026 catch-up
// treatment. Originally slated for 2024 and delayed by Notice 2023-62; final
// regulations landed September 2025.
//
// Two caveats the app cannot see, so the warning is worded as "check", not "wrong":
// the test is per-EMPLOYER wages rather than household or total earned income, and
// it uses FICA wages, which exclude the pre-tax deferrals themselves. The app only
// stores one salary per person, so it is used as the best available proxy.
const ROTH_CATCHUP_WAGE_THRESHOLD = 150000;

// Types that share one person's 402(g) elective-deferral limit.
const DEFERRAL_TYPES = new Set(['401k', '403b', '457b', 'roth_401k', 'roth_403b', 'roth_457b']);
// The Roth subset of those — the only place a mandated Roth catch-up may land.
const ROTH_DEFERRAL_TYPES = new Set(['roth_401k', 'roth_403b', 'roth_457b']);
const IRA_TYPES = new Set(['traditional_ira', 'roth_ira']);

// Check a WHOLE account list against the per-person limits and return an array of
// { owner, kind, amount, limit, message }.
//
// This is plan-wide on purpose. The wizard's original check looked at its own
// fixed slots one person at a time, so a deferral spread across three accounts —
// a traditional 401(k), a Roth 401(k), and a percent-mode ESOP added later on the
// Accounts tab — could each look reasonable while together breaching 402(g). That
// is a real configuration, and nothing in the app caught it.
//
// salaries: { me, spouse } current earned income, needed to size percent-mode
// contributions. Percent-mode rows are skipped when the relevant salary is 0,
// since their dollar amount cannot be known.
const checkContributionLimits = (accounts, pi, salaries = {}) => {
  const out = [];
  if (!accounts || !accounts.length) return out;
  const owners = ['me', 'spouse'];
  const ageOf = (o) => o === 'spouse' ? (pi.spouseAge || 0) : (pi.myAge || 0);
  const salaryOf = (o) => (o === 'spouse' ? salaries.spouse : salaries.me) || 0;

  // Dollar contribution for a row, split into the employee and employer slices.
  const split = (a) => {
    if (a.contributionMode === 'percent') {
      const sal = salaryOf(a.owner === 'spouse' ? 'spouse' : 'me');
      if (sal <= 0) return null; // unknowable without a salary
      return {
        employee: sal * (a.employeePercent || 0),
        employer: sal * (a.employerMatchPercent || 0),
      };
    }
    const amt = a.contribution || 0;
    // 'employer' rows are all employer money; 'both' lumps the two together and
    // cannot be split, so it is counted as employee (the conservative reading for
    // a deferral check).
    return (a.contributor === 'employer') ? { employee: 0, employer: amt } : { employee: amt, employer: 0 };
  };

  for (const owner of owners) {
    if (owner === 'spouse' && pi.filingStatus !== 'married_joint' && pi.filingStatus !== 'married_separate') continue;
    const mine = accounts.filter(a => (a.owner === 'spouse' ? 'spouse' : 'me') === owner);
    if (!mine.length) continue;
    const age = ageOf(owner);
    const who = owner === 'spouse' ? "Spouse's" : 'Your';

    let deferral = 0, additions = 0, ira = 0, hsa = 0, rothDeferral = 0;
    for (const a of mine) {
      const s = split(a);
      if (!s) continue;
      if (DEFERRAL_TYPES.has(a.type)) { deferral += s.employee; additions += s.employee + s.employer;
        if (ROTH_DEFERRAL_TYPES.has(a.type)) rothDeferral += s.employee; }
      else if (IRA_TYPES.has(a.type)) ira += s.employee;
      else if (a.type === 'hsa') hsa += s.employee + s.employer;
    }

    const cu = workplaceCatchUp(age);
    const deferralCap = LIMIT_402G + cu;
    const additionsCap = LIMIT_415C + cu;
    const note = cu > 0 ? ` (including the $${cu.toLocaleString()} age-${age >= 60 && age <= 63 ? '60–63 super' : '50'} catch-up)` : '';

    if (deferral > deferralCap + 1) out.push({ owner, kind: 'deferral', amount: deferral, limit: deferralCap,
      message: `${who} 401(k)/403(b)/457(b) contributions total $${Math.round(deferral).toLocaleString()}/yr, above the $${deferralCap.toLocaleString()} IRS elective-deferral limit${note}. Traditional and Roth share this one limit.` });
    if (additions > additionsCap + 1) out.push({ owner, kind: 'additions', amount: additions, limit: additionsCap,
      message: `${who} combined employee + employer workplace contributions total $${Math.round(additions).toLocaleString()}/yr, above the $${additionsCap.toLocaleString()} IRS annual-additions limit${note}.` });
    // Mandated-Roth catch-up. Only meaningful once someone is actually USING
    // catch-up room: deferrals above the $24,500 base are catch-up by definition.
    // Deferrals beyond the cap are already reported as a violation above, so the
    // catch-up actually in play is capped at the legal maximum.
    const catchUpUsed = Math.max(0, Math.min(deferral, deferralCap) - LIMIT_402G);
    if (cu > 0 && catchUpUsed > 0 && salaryOf(owner) > ROTH_CATCHUP_WAGE_THRESHOLD
        && rothDeferral < catchUpUsed - 1) {
      out.push({ owner, kind: 'roth_catchup', amount: rothDeferral, limit: catchUpUsed,
        message: `${who} catch-up contributions are $${Math.round(catchUpUsed).toLocaleString()}/yr, but only $${Math.round(rothDeferral).toLocaleString()} of ${owner === 'spouse' ? 'their' : 'your'} workplace deferrals go to a Roth account. From 2026, SECURE 2.0 requires catch-up to be Roth for anyone whose prior-year wages from that employer exceeded $${ROTH_CATCHUP_WAGE_THRESHOLD.toLocaleString()} — check how your plan is set up.` });
    }

    const iraCap = LIMIT_IRA + (age >= 50 ? LIMIT_IRA_CATCHUP : 0);
    if (ira > iraCap + 1) out.push({ owner, kind: 'ira', amount: ira, limit: iraCap,
      message: `${who} IRA contributions total $${Math.round(ira).toLocaleString()}/yr, above the $${iraCap.toLocaleString()} limit. Traditional and Roth IRAs share it.` });
    const hsaCap = (pi.filingStatus === 'married_joint' ? LIMIT_HSA_FAMILY : LIMIT_HSA_SELF) + (age >= 55 ? LIMIT_HSA_CATCHUP_55 : 0);
    if (hsa > hsaCap + 1) out.push({ owner, kind: 'hsa', amount: hsa, limit: hsaCap,
      message: `${who} HSA contributions total $${Math.round(hsa).toLocaleString()}/yr, above the $${hsaCap.toLocaleString()} limit.` });
  }
  return out;
};

// ── REAL vs NOMINAL DOLLARS ──────────────────────────────────────────────────
// The engine works in NOMINAL dollars: every projected figure is in the dollars
// of its own year. User inputs like desiredRetirementIncome are in TODAY's
// dollars. Mixing the two has been the most repeated bug in this codebase — a
// today's-dollar spend divided by a future portfolio produced a 6.7% withdrawal
// rate displayed as 1.5%, and the same shape of error appeared in the Stress
// Test header, the setup preview, the Monte Carlo percentiles, Coast FIRE and
// the withdrawal-strategy comparison.
//
// These three primitives exist so the conversion is named at every call site
// instead of being open-coded (and mis-coded) again.

// Growth net of inflation. Note this is the Fisher ratio, not `nominal -
// inflation`: at 7% and 3% the true real return is 3.88%, not 4%. Small per year,
// ~2% of the answer over 20 years.
const realReturn = (nominalReturn, inflationRate) =>
  ((1 + (nominalReturn || 0)) / (1 + (inflationRate || 0))) - 1;

// Carry a today's-dollar amount forward to the dollars of the year the household
// is `atAge`. Compounds from `currentAge` — the same epoch computeProjections
// uses (yearsFromNow = 0 at the current age), which is the detail the withdrawal
// tab got wrong by compounding from the retirement age instead.
const inflateToAge = (amountToday, currentAge, atAge, inflationRate) =>
  (amountToday || 0) * Math.pow(1 + (inflationRate || 0), Math.max(0, (atAge || 0) - (currentAge || 0)));

// Inverse: express a figure from the year the household is `atAge` in today's
// dollars, so it can be compared with a user input or another deflated figure.
const deflateToToday = (amountAtAge, currentAge, atAge, inflationRate) =>
  (amountAtAge || 0) / Math.pow(1 + (inflationRate || 0), Math.max(0, (atAge || 0) - (currentAge || 0)));

// ── COAST FIRE ───────────────────────────────────────────────────────────────
// The balance you need TODAY for growth alone — no further contributions — to
// fund retirement. Everything here is in TODAY's dollars, discounted at the REAL
// return, which is the only internally consistent way to state it and the form a
// user can actually judge against their current balance.
//
// The previous version mixed all three bases at once: it subtracted a nominal
// at-retirement guaranteed income from a today's-dollar spend, took 25x of the
// result as a FUTURE portfolio target, then discounted that real target at the
// NOMINAL return. Each step pushed the answer the same way, so the reported
// coast number was far too low and the progress bar far too flattering.
const coastFire = ({
  spendingToday = 0,
  guaranteedIncomeToday = 0,
  yearsToRetirement = 0,
  nominalReturn = 0.07,
  inflationRate = 0.03,
  withdrawalRate = 0.04,
} = {}) => {
  const portfolioSpendingToday = Math.max(0, spendingToday - guaranteedIncomeToday);
  const targetToday = withdrawalRate > 0 ? portfolioSpendingToday / withdrawalRate : 0;
  const rr = realReturn(nominalReturn, inflationRate);
  // A real return of exactly -100% would divide by zero; clamp just above it.
  const growth = Math.pow(1 + Math.max(-0.9999, rr), Math.max(0, yearsToRetirement));
  return {
    portfolioSpendingToday,
    targetToday: Math.round(targetToday),
    realReturn: rr,
    coastNumberToday: Math.round(targetToday / growth),
  };
};

// ── SETUP ESTIMATES ──────────────────────────────────────────────────────────
// Benchmarks the Guided Setup uses to fill a number the user doesn't have to
// hand. The point is to get someone to a working plan instead of losing them at
// a field they can't answer — so every one of these is a published, citable
// median or rule of thumb, NOT a guess, and the UI tags any value it fills so
// the user knows to replace it.
//
// They live in the engine (not the wizard) so the test suite can pin them and so
// the citation sits next to the number.

// Fidelity's savings-milestone ladder: total retirement savings as a multiple of
// CURRENT salary, by age. Interpolated between the published anchors, flat
// outside them. This is a whole-household retirement total, not a per-account
// figure — the wizard divides it across the accounts the user actually has.
const SAVINGS_MULTIPLE_BY_AGE = [
  { age: 30, x: 1 }, { age: 35, x: 2 }, { age: 40, x: 3 }, { age: 45, x: 4 },
  { age: 50, x: 6 }, { age: 55, x: 7 }, { age: 60, x: 8 }, { age: 67, x: 10 },
];

const savingsMultipleForAge = (age) => {
  const pts = SAVINGS_MULTIPLE_BY_AGE;
  if (!(age > 0)) return 0;
  if (age <= pts[0].age) return pts[0].x;
  if (age >= pts[pts.length - 1].age) return pts[pts.length - 1].x;
  for (let i = 1; i < pts.length; i++) {
    if (age <= pts[i].age) {
      const a = pts[i - 1], b = pts[i];
      return a.x + (b.x - a.x) * ((age - a.age) / (b.age - a.age));
    }
  }
  return pts[pts.length - 1].x;
};

// Typical employee deferral rate. Vanguard's "How America Saves" has reported
// participant deferrals a little over 7% for years; 8% is the round figure in
// that range. Deliberately not 10% — an optimistic default would flatter the
// projection of the very users who need it to be honest.
const TYPICAL_DEFERRAL_RATE = 0.08;

// The most common employer formula is 50% of pay deferred up to 6%, i.e. 3% of
// salary once the employee defers at least 6%.
const TYPICAL_MATCH_RATE = 0.03;

// Social Security replaces roughly 40% of pre-retirement earnings for a median
// worker claiming at full retirement age (SSA). Capped by the maximum benefit.
const SS_REPLACEMENT_RATE = 0.40;
const SS_MAX_ANNUAL_AT_FRA = 45600;

// Estimated total retirement savings for a household, in today's dollars.
const estimateRetirementSavings = (age, householdSalary) =>
  Math.max(0, Math.round(savingsMultipleForAge(age) * (householdSalary || 0) / 1000) * 1000);

// Estimated annual Social Security benefit at full retirement age.
const estimateAnnualSocialSecurity = (salary) => {
  if (!(salary > 0)) return 0;
  return Math.round(Math.min(salary * SS_REPLACEMENT_RATE, SS_MAX_ANNUAL_AT_FRA) / 600) * 600;
};

// ── PLANNING HORIZON ─────────────────────────────────────────────────────────
// How many projection years a plan needs. `legacyAge` means "plan until this
// age" — and for a married household that has to hold for BOTH people, not just
// the primary. Anchoring on myAge alone silently truncated the plan whenever the
// spouse was younger: a 70-year-old with a 55-year-old spouse and legacyAge 90
// got 21 years, leaving the spouse's last 15 years (ages 75-90) unmodelled,
// including every dollar the portfolio still had to cover.
//
// Returns the number of years AFTER the current one, so a projection has
// getPlanningHorizonYears(pi) + 1 rows (survivor modeling may end it earlier,
// once both spouses have died).
// A second way the same truncation happened: with survivor modelling on, deaths
// are scheduled at each person's LIFE EXPECTANCY, which is a separate input from
// legacyAge. Set legacyAge 85 with a spouse expected to reach 87 and the
// projection stopped with the widow still alive — her last two years, and every
// dollar of spending in them, simply absent. legacyAge is where you measure the
// legacy; it cannot also be allowed to cut a life short.
//
// Extending is self-limiting: the projection already stops the year both spouses
// have died, so a longer horizon adds rows only while someone is still alive.
// Capped at MAX_AGE so an implausible life-expectancy entry cannot run away.
const getPlanningHorizonYears = (pi) => {
  const legacyAge = pi.legacyAge || MAX_AGE;
  const isMarried = pi.filingStatus === 'married_joint';
  let years = legacyAge - pi.myAge;
  if (isMarried && typeof pi.spouseAge === 'number') {
    years = Math.max(years, legacyAge - pi.spouseAge);
  }
  // Mirrors the engine's own survivorEnabled condition — life expectancy only
  // drives behaviour, and can only strand a living person, when this is on.
  if (pi.survivorModelEnabled && isMarried) {
    const cover = (lifeExp, currentAge) => {
      if (typeof lifeExp !== 'number' || typeof currentAge !== 'number') return;
      years = Math.max(years, Math.min(lifeExp, MAX_MODELED_AGE) - currentAge);
    };
    cover(pi.myLifeExpectancy, pi.myAge);
    cover(pi.spouseLifeExpectancy, pi.spouseAge);
  }
  return Math.max(0, years);
};

const getDefaultRothConversionWindow = (personalInfo) => {
  const retirementAge = personalInfo?.myRetirementAge ?? 65;
  const rmdAge = getRmdStartAge(personalInfo?.myBirthYear);
  return {
    startAge: retirementAge,
    endAge: rmdAge - 1,
  };
};

// ── END-OF-PLAN ROW LOOKUP ───────────────────────────────────────────────────
// The row to measure terminal wealth on. A plain `find(p => p.myAge === age)`
// is not safe: with survivor modeling on, the projection STOPS the year both
// spouses have died (see the `break` at the end of computeProjections), so any
// legacyAge past both life expectancies matches nothing. Callers that treated
// the miss as "portfolio is zero" silently ranked every scenario as a tie —
// which is exactly what the SS claiming grid did before this existed.
//
// Falling back to the last row means "measure at the end of the plan, whenever
// that turned out to be". Returns null only for an empty projection.
const rowAtOrLast = (proj, age) => {
  if (!proj || proj.length === 0) return null;
  return proj.find(p => p.myAge === age) || proj[proj.length - 1];
};

// ── SS RE-INDEXATION UNDER STOCHASTIC INFLATION ──────────────────────────────
// The engine grows each income stream by its own fixed `stream.cola`, which is
// independent of the inflation used for expenses. Under a stochastic-inflation
// simulation that combination is actively wrong for Social Security: a
// high-inflation draw would raise the household's costs while pinning SS to its
// baseline COLA, modelling the one CPI-indexed asset in the plan as
// inflation-EXPOSED. Delayed claiming would then look worst in exactly the
// scenarios where it is worth most — the sign of the hedge, backwards.
//
// This rescales SS COLA to a run's drawn inflation while preserving the stream's
// real spread against baseline: a stream entered at exactly the inflation rate
// stays fully indexed, one entered below it stays proportionally behind.
//
// ONLY social_security. Its CPI indexation is statutory (42 U.S.C. 415(i)); a
// fixed-nominal pension must keep its nominal value and lose real value, which
// is what leaving its cola untouched already does. Passing drawnInflation equal
// to baseInflation is a no-op, as is a non-positive baseline.
const reindexSSForInflation = (streams, baseInflation, drawnInflation) => {
  if (!Array.isArray(streams)) return streams;
  if (!(baseInflation > -1) || drawnInflation === baseInflation) return streams;
  return streams.map(s => {
    if (!s || s.type !== 'social_security') return s;
    const realSpread = (1 + (s.cola || 0)) / (1 + baseInflation) - 1;
    return { ...s, cola: (1 + realSpread) * (1 + drawnInflation) - 1 };
  });
};

// ── CLAIMING-SCENARIO ORDERING ───────────────────────────────────────────────
// Sort comparator for the Social Security grid: best scenario first.
//
//   1. Does the plan run dry at all, and if so how late? A plan that survives
//      beats one that does not, whatever the balances say. Terminal wealth alone
//      cannot make this distinction — every depleted plan ends at $0 and ties,
//      so the ranking among them was previously decided by array order.
//   2. After-tax terminal wealth. Claiming ages differ in how hard they drain
//      pre-tax accounts during the bridge years, so equal RAW balances can mean
//      unequal spendable wealth.
//
// Shared by the worker and the UI so the ranking and the winner tiles cannot
// disagree about what "best" means.
const compareClaimingScenarios = (a, b) => {
  const aDry = a.depletionAge ?? Infinity;
  const bDry = b.depletionAge ?? Infinity;
  if (aDry !== bDry) return bDry - aDry;                     // later / never first
  return (b.afterTaxAtLegacy || 0) - (a.afterTaxAtLegacy || 0);
};

// ── WHAT A ROTH CONVERSION ACTUALLY COSTS ────────────────────────────────────
// Differences two projections to price a conversion, and says WHERE the cost
// came from. The headline number routinely lands well above the bracket the
// conversion nominally sits in, and without a breakdown that reads like a bug
// rather than the several real effects it is:
//
//   • Social Security torpedo — a conversion dollar drags up to $0.85 of SS into
//     taxability (Pub 915 combined income), so a 22% dollar can cost ~40%.
//   • Capital gains stacking — ordinary income pushes LTCG from 0% to 15% to 20%.
//   • IRMAA — a step function, per person, charged TWO YEARS LATER.
//   • NIIT — 3.8% once MAGI crosses the threshold.
//   • Senior deduction phaseout — the 2025-2028 OBBBA 6% phaseout.
//   • State tax, and the tax on any withdrawal taken to pay the tax.
//   • Lost ACA premium subsidy, which is NOT a tax and so is absent from
//     totalTax, but is money out the door all the same. Pre-65 it can exceed the
//     income tax on the conversion outright.
//
// ── THE TWO-YEAR IRMAA LAG ──────────────────────────────────────────────────
// This is the part that is easy to get wrong. Year Y's surcharge is fixed by
// year Y−2 MAGI (see the irmaaLookbackMAGI logic in computeProjections), so the
// IRMAA a conversion causes shows up two rows later. Charging the conversion for
// the surcharge sitting in ITS OWN year would attribute a cost created two years
// earlier, and would miss the cost it actually creates — for a single isolated
// conversion, that means missing the IRMAA hit entirely.
//
// So the same-year surcharge is REMOVED from the same-year tax delta (it is
// already inside totalTax) and the year Y+2 surcharge is added in its place.
// For a steady multi-year conversion the two are nearly equal and this reduces
// to the obvious answer; for a one-off it is the difference between pricing
// IRMAA and ignoring it.
//
// Pass full projections; the function finds the rows it needs. Returns null when
// nothing was converted — a $0 conversion has no rate, and reporting 0% would
// read as "free" rather than "did not happen".
const conversionCostComponents = (withProj, withoutProj, age, convertedAmount) => {
  if (!(convertedAmount > 0) || !withProj || !withoutProj) return null;
  const w = withProj.find(p => p.myAge === age);
  const o = withoutProj.find(p => p.myAge === age);
  if (!w || !o) return null;

  const d = (row, other, field) => (row[field] || 0) - (other[field] || 0);

  // Same-year IRMAA is stripped out; it belongs to a conversion two years back.
  const sameYearIrmaa = d(w, o, 'irmaaSurcharge');
  const taxDeltaExIrmaa = d(w, o, 'totalTax') - sameYearIrmaa;

  // The surcharge this conversion causes, two years on. When the plan does not
  // reach that year (conversion near the end of the horizon) there is no row and
  // the cost genuinely never lands.
  const wLag = withProj.find(p => p.myAge === age + 2);
  const oLag = withoutProj.find(p => p.myAge === age + 2);
  const irmaaDelta = (wLag && oLag) ? d(wLag, oLag, 'irmaaSurcharge') : 0;

  // Subsidy LOST is a positive cost, hence the reversed subtraction.
  const acaSubsidyLost = (o.acaSubsidy || 0) - (w.acaSubsidy || 0);

  const federalDelta = d(w, o, 'federalTax');
  const stateDelta = d(w, o, 'stateTax');
  const ficaDelta = d(w, o, 'ficaTax');
  const totalCost = taxDeltaExIrmaa + irmaaDelta + acaSubsidyLost;

  const pct = (n) => n / convertedAmount;
  return {
    converted: convertedAmount,
    federalDelta, stateDelta, ficaDelta, irmaaDelta, acaSubsidyLost,
    // Income tax only, no surcharge, no subsidy — comparable to a bracket.
    taxDeltaExIrmaa,
    // What totalTax alone would have said, kept so the UI can show the gap.
    taxOnlyRate: pct(d(w, o, 'totalTax')),
    totalCost,
    rate: pct(totalCost),
    // Same figures as rate contributions, so a stacked breakdown sums to `rate`.
    ratePoints: {
      incomeTax: pct(taxDeltaExIrmaa),
      irmaa: pct(irmaaDelta),
      aca: pct(acaSubsidyLost),
    },
  };
};

// Top statutory federal bracket a given taxable income reaches, as a decimal.
// The reference line the all-in cost is compared against — the number most
// people have in mind when they say "my tax rate". Brackets inflate with the
// same factor the tax calculator uses, so the comparison stays honest in future
// years rather than drifting against unindexed 2026 thresholds.
const topMarginalBracket = (taxableIncome, filingStatus, yearsFromNow = 0, inflationRate = 0.03) => {
  const brackets = FEDERAL_TAX_BRACKETS_2026[filingStatus] || FEDERAL_TAX_BRACKETS_2026.single;
  const factor = indexTo(1, yearsFromNow, inflationRate);
  const income = Math.max(0, taxableIncome || 0);
  let rate = brackets[0].rate;
  for (const b of brackets) {
    if (income >= Math.round(b.min * factor)) rate = b.rate;
    else break;
  }
  return rate;
};

// ── ROTH OPTIMIZER SCORING ───────────────────────────────────────────────────
// Reduce a projection to the metrics the Roth Conversion Optimizer ranks by.
// Lives in the engine (not the worker) so the test suite can exercise it.
//
// afterTaxLegacy discounts remaining PRE-TAX dollars by the heirs' assumed
// ordinary tax rate — a $1M traditional IRA is not worth $1M to a beneficiary
// (SECURE Act: non-spouse heirs must drain inherited IRAs within 10 years, at
// their own marginal rates). Roth and brokerage pass at face value (brokerage
// basis steps up at death; embedded-gain nuance is ignored).
const scoreRothStrategy = (proj, { legacyAge, retirementAge, heirTaxRate = 0.25 } = {}) => {
  if (!proj || proj.length === 0) return null;
  const atLegacy = rowAtOrLast(proj, legacyAge);
  const retYears = proj.filter(p => p.myAge >= (retirementAge ?? 0));
  const sum = (field) => retYears.reduce((s, p) => s + (p[field] || 0), 0);
  const afterTaxLegacy = (atLegacy.rothBalance || 0) + (atLegacy.brokerageBalance || 0)
    + (atLegacy.preTaxBalance || 0) * (1 - heirTaxRate);
  return {
    afterTaxLegacy: Math.round(afterTaxLegacy),
    lifetimeTax: Math.round(sum('totalTax')),
    lifetimeIRMAA: Math.round(sum('irmaaSurcharge')),
    lifetimeACASubsidy: Math.round(sum('acaSubsidy')),
    lifetimeConversions: Math.round(sum('rothConversion')),
    endPreTax: atLegacy.preTaxBalance || 0,
    endRoth: atLegacy.rothBalance || 0,
    endTotal: atLegacy.totalPortfolio || 0,
  };
};

// ── SPENDING PHASES (go-go / slow-go / no-go) ────────────────────────────────
// Real retirement spending is not flat: T. Rowe Price and JPMorgan spending
// research show a "retirement smile" — spending runs 20-30% higher in the
// active early years (go-go), declines through the slow-go years, and settles
// lower in the no-go years (healthcare is modeled separately and rises, which
// is why this multiplier applies to BASE discretionary spending only).
// Band semantics: myAge <= goGoEndAge → goGo; <= slowGoEndAge → slowGo; else noGo.
// Returns 1 (no adjustment) when the feature is disabled or fields are absent,
// so plans saved before this feature behave identically.
const getSpendingPhaseMultiplier = (pi, myAge) => {
  if (!pi || !pi.spendingPhasesEnabled) return 1;
  const goGoEnd = pi.goGoEndAge ?? 75;
  const slowGoEnd = pi.slowGoEndAge ?? 85;
  if (myAge <= goGoEnd) return pi.goGoMultiplier ?? 1.0;
  if (myAge <= slowGoEnd) return pi.slowGoMultiplier ?? 0.85;
  return pi.noGoMultiplier ?? 0.75;
};

// Applicable percentage (required contribution as a fraction of MAGI) for a
// given % of FPL, per the 2026 post-ARPA table. Returns null when the household
// is outside the 100%–400% eligibility window.
const getACAApplicablePercentage = (fplPercent) => {
  if (fplPercent < 100 || fplPercent > 400) return null;
  const row = ACA_APPLICABLE_PCT_2026.find(r => fplPercent <= r.hi) || ACA_APPLICABLE_PCT_2026[ACA_APPLICABLE_PCT_2026.length - 1];
  const span = row.hi - row.lo;
  const t = span > 0 ? Math.min(Math.max((fplPercent - row.lo) / span, 0), 1) : 0;
  return row.pctLo + (row.pctHi - row.pctLo) * t;
};

// Premium tax credit for a household. The credit = benchmark (SLCSP) premium
// minus the required contribution (applicablePct × MAGI), floored at 0.
// FPL is indexed forward by general inflation for future projection years.
// ACA MAGI = AGI + tax-exempt interest + UNTAXED Social Security (the caller is
// responsible for building that base — see computeProjections).
const calculateACAPremiumCredit = ({ magi, householdSize, benchmarkPremium, yearsFromNow = 0, inflationRate = 0.03 }) => {
  const inf = indexTo(1, yearsFromNow, inflationRate);
  const fpl = (ACA_FPL_2025[Math.min(Math.max(householdSize, 1), 8)] || ACA_FPL_2025[1]) * inf;
  const fplPercent = fpl > 0 ? (magi / fpl) * 100 : Infinity;
  const applicablePct = getACAApplicablePercentage(fplPercent);
  if (applicablePct === null) {
    // Below 100% FPL (Medicaid territory in expansion states) or above the 400%
    // hard cliff (back since 1/1/2026): no marketplace credit — full premium.
    return { subsidy: 0, netPremium: benchmarkPremium, fplPercent, applicablePct: null, cliff: fplPercent > 400 };
  }
  const requiredContribution = magi * applicablePct;
  const subsidy = Math.max(0, benchmarkPremium - requiredContribution);
  return { subsidy, netPremium: benchmarkPremium - subsidy, fplPercent, applicablePct, cliff: false };
};

// Calculate ACA subsidy eligibility (simplified summary — 2026 post-ARPA rules).
// The ARPA-era "no cliff, 8.5% cap above 400%" law expired 12/31/2025; above
// 400% FPL there is NO premium tax credit at all.
const calculateACASubsidy = (income, householdSize, filingStatus) => {
  const fpl = ACA_FPL_2025[Math.min(householdSize, 8)] || ACA_FPL_2025[2];
  const fplPercent = (income / fpl) * 100;

  if (fplPercent < 100) {
    return { eligible: false, fplPercent, reason: 'Below 100% FPL - may qualify for Medicaid' };
  }
  if (fplPercent > 400) {
    return { eligible: false, fplPercent, premiumCap: null, reason: 'Above 400% FPL - subsidy cliff (no premium tax credit as of 2026)' };
  }
  const applicablePct = getACAApplicablePercentage(fplPercent);
  return { eligible: true, fplPercent, premiumCap: applicablePct * 100, tier: fplPercent <= 150 ? 'Silver 94' : fplPercent <= 200 ? 'Silver 87' : fplPercent <= 250 ? 'Silver 73' : 'Silver' };
};


// Two settings mean "the engine charges no pre-65 healthcare", and they differ
// only in what the user is asserting:
//   'none'        — not accounted for anywhere. A pre-65 retirement is understated,
//                   and getDataWarnings says so.
//   'in_spending' — already inside Desired Retirement Income. Common and correct:
//                   retiree coverage through a spouse's employer or pension system,
//                   or a premium the user simply budgeted themselves. Nothing is
//                   missing, so warning about it is noise.
// Both take the same $0 pre-65 path below; keeping them behind one predicate stops
// the next variant from being missed at one of the call sites that gate the UI.
const HEALTHCARE_MODELS_UNPRICED = ['none', 'in_spending'];
const healthcareCostsModeled = (pi) =>
  !HEALTHCARE_MODELS_UNPRICED.includes((pi && pi.healthcareModel) || 'none');

// ── HEALTHCARE EXPENSE CALCULATOR ───────────────────────────────────────────────
// Unified function that computes annual healthcare costs for a given year.
// Called by the projection engine for each year — results flow into the year data.
const calculateHealthcareExpenses = (pi, myAge, spouseAge, yearsFromNow, primaryAlive, spouseAlive) => {
  if (!healthcareCostsModeled(pi)) {
    // Even with healthcare modeling off, standard Medicare Part B + Part D
    // premiums are charged for each person 65+. The engine always charges
    // IRMAA surcharges (they're income-driven, like a tax), and a surcharge
    // without the base premium it surcharges is inconsistent. Pre-65 costs,
    // Medigap, OOP, and LTC remain opted out under 'none'.
    const medInflation = pi.medicalInflation || MEDICAL_INFLATION_RATE;
    const medInflationFactor = Math.pow(1 + medInflation, yearsFromNow);
    const basePremiumAnnual = (MEDICARE_PART_B_PREMIUM_2025 + MEDICARE_PART_D_PREMIUM_2025) * 12 * medInflationFactor;
    let medicareCost = 0;
    if (primaryAlive && myAge >= 65) medicareCost += basePremiumAnnual;
    if (pi.filingStatus === 'married_joint' && spouseAlive && spouseAge >= 65) medicareCost += basePremiumAnnual;
    medicareCost = Math.round(medicareCost);
    return { total: medicareCost, pre65: 0, medicare: medicareCost, ltc: 0, breakdown: null };
  }
  
  const medInflation = pi.medicalInflation || MEDICAL_INFLATION_RATE;
  const medInflationFactor = Math.pow(1 + medInflation, yearsFromNow);
  
  let pre65Cost = 0;
  let medicareCost = 0;
  let ltcCost = 0;
  let acaPersons = 0; // under-65 retired persons whose premium is MAGI-based (pre65Coverage: 'aca')
  const isMarried = pi.filingStatus === 'married_joint';

  // Determine who needs healthcare costs modeled
  const people = [];
  if (primaryAlive) people.push({ age: myAge, label: 'me', lifeExp: pi.myLifeExpectancy || 85, retirementAge: pi.myRetirementAge ?? 65 });
  if (spouseAlive && isMarried) people.push({ age: spouseAge, label: 'spouse', lifeExp: pi.spouseLifeExpectancy || 87, retirementAge: pi.spouseRetirementAge ?? 65 });

  people.forEach(person => {
    if (person.age < 65) {
      // PRE-MEDICARE. Two coverage models:
      //  - 'flat' (default): fixed annual cost (employer or self-estimated ACA).
      //  - 'aca': once the person is RETIRED, the premium is MAGI-driven
      //    (benchmark − premium tax credit) and cannot be computed here — the
      //    projection loop prices it after MAGI is known. We only COUNT those
      //    people. Pre-retirement years still use the flat cost (employer coverage).
      if (pi.pre65Coverage === 'aca' && person.age >= person.retirementAge) {
        acaPersons++;
      } else {
        const annualPre65 = (pi.pre65HealthcareAnnual || PRE_65_HEALTHCARE_ANNUAL_2025);
        pre65Cost += annualPre65 * medInflationFactor;
      }
    } else {
      // MEDICARE (age 65+): Part B + Part D + optional Medigap + OOP
      // Note: IRMAA surcharges are handled separately in the engine
      let annualMedicare = MEDICARE_PART_B_PREMIUM_2025 * 12;
      annualMedicare += MEDICARE_PART_D_PREMIUM_2025 * 12;
      
      if (pi.healthcareModel === 'moderate' || pi.healthcareModel === 'comprehensive' || 
          (pi.healthcareModel === 'custom' && pi.includeMedigap)) {
        annualMedicare += MEDICARE_SUPPLEMENT_PREMIUM_2025 * 12;
      }
      
      annualMedicare += (pi.post65OOPAnnual || MEDICARE_OOP_ANNUAL_2025);
      medicareCost += annualMedicare * medInflationFactor;
    }
    
    // LONG-TERM CARE: model the final `ltcDuration` months before death.
    if (pi.ltcModel !== 'none' && (pi.healthcareModel === 'comprehensive' || pi.ltcModel === 'custom' || pi.ltcModel === 'default')) {
      const ltcDuration = pi.ltcDurationMonths || LTC_DEFAULT_DURATION_MONTHS;   // total months of LTC
      const ltcMonthly = pi.ltcMonthlyAmount || LTC_MONTHLY_ASSISTED_LIVING_2025;
      // The LTC window is the final `ltcDuration` months ending at life expectancy, clamped
      // so it never begins before age 65. For this projection year [person.age, person.age+1)
      // we bill only the fraction of months that fall inside the window. Summed across all
      // years the lifetime total equals exactly `ltcDuration` months (the previous logic
      // assigned a full 12 months to every overlapping year and then ADDED a partial final
      // year, over-billing by ~40% for a typical 28-month duration).
      const ltcWindowStartAge = Math.max(65, person.lifeExp - ltcDuration / 12);
      const overlapStart = Math.max(person.age, ltcWindowStartAge);
      const overlapEnd = Math.min(person.age + 1, person.lifeExp);
      const monthsThisYear = Math.max(0, (overlapEnd - overlapStart) * 12);
      if (monthsThisYear > 0) {
        ltcCost += ltcMonthly * monthsThisYear * medInflationFactor;
      }
    }
  });
  
  const total = Math.round(pre65Cost + medicareCost + ltcCost);
  return { total, pre65: Math.round(pre65Cost), medicare: Math.round(medicareCost), ltc: Math.round(ltcCost),
    acaPersons, // priced by the projection loop (MAGI-dependent), NOT included in `total`
    breakdown: { numPeople: people.length, pre65Count: people.filter(p => p.age < 65).length, medicareCount: people.filter(p => p.age >= 65).length }
  };
};

// ── RECURRING EXPENSE CALCULATOR ────────────────────────────────────────────────
// Computes total recurring expenses for a given year based on the expense list.
// survivorSpendFactor: under survivor modeling, recurring expenses are household-
// level line items (the UI exposes no per-person owner), so when exactly one
// spouse is alive they get the same spending haircut as the base retirement
// income (pi.survivorSpendingFactor, default 0.75). Previously they continued at
// 100% after a death, inconsistent with the base-spending step-down.
const calculateRecurringExpenses = (expenses, myAge, spouseAge, yearsFromNow, generalInflation, survivorSpendFactor = 1) => {
  if (!expenses || expenses.length === 0) return { total: 0, byCategory: {} };

  let total = 0;
  const byCategory = {};

  expenses.forEach(exp => {
    const ownerAge = exp.owner === 'spouse' ? spouseAge : myAge;
    if (ownerAge >= exp.startAge && ownerAge <= exp.endAge) {
      const expInflation = exp.inflationRate !== undefined ? exp.inflationRate : generalInflation;
      const inflationFactor = Math.pow(1 + expInflation, yearsFromNow);
      const adjustedAmount = exp.amount * inflationFactor * survivorSpendFactor;
      total += adjustedAmount;
      const cat = exp.category || 'other';
      byCategory[cat] = (byCategory[cat] || 0) + adjustedAmount;
    }
  });

  return { total: Math.round(total), byCategory };
};

// Alias of MEDICARE_PART_B_STANDARD_2025 (declared above with the IRMAA table).
// Kept as a separate export name for the healthcare components, but pointed at
// the same value so a CMS update only has to be made in one place.
const MEDICARE_PART_B_PREMIUM_2025 = MEDICARE_PART_B_STANDARD_2025;
const MEDICARE_PART_D_PREMIUM_2025 = 39;     // Avg monthly Part D base premium (2026; national base ~$38.99)
const MEDICARE_SUPPLEMENT_PREMIUM_2025 = 175; // Avg monthly Medigap premium (2025)
const MEDICARE_OOP_ANNUAL_2025 = 2000;       // Avg annual out-of-pocket (copays, dental, vision)
const PRE_65_HEALTHCARE_ANNUAL_2025 = 12000; // Avg annual ACA/employer premium for one person
const ACA_BENCHMARK_PREMIUM_2026 = 14000;    // Default unsubsidized silver benchmark (SLCSP) per person/yr — typical for an early retiree in their late 50s/60s; users should replace with their healthcare.gov quote
const MEDICAL_INFLATION_RATE = 0.05;         // Healthcare cost inflation (higher than general CPI)
const LTC_MONTHLY_ASSISTED_LIVING_2025 = 5900; // Median monthly assisted living cost (Genworth 2024)
const LTC_DEFAULT_DURATION_MONTHS = 28;      // Default LTC planning: 28 months before death

const HISTORICAL_RETURNS = [
  { year: 1928, stock:  0.4361, bond:  0.0084, cpi: -0.0117 },
  { year: 1929, stock: -0.0830, bond:  0.0420, cpi:  0.0058 },
  { year: 1930, stock: -0.2512, bond:  0.0454, cpi: -0.0640 },
  { year: 1931, stock: -0.4384, bond: -0.0256, cpi: -0.0932 },
  { year: 1932, stock: -0.0864, bond:  0.0879, cpi: -0.1027 },
  { year: 1933, stock:  0.4998, bond:  0.0186, cpi:  0.0076 },
  { year: 1934, stock: -0.0119, bond:  0.0796, cpi:  0.0152 },
  { year: 1935, stock:  0.4674, bond:  0.0447, cpi:  0.0299 },
  { year: 1936, stock:  0.3194, bond:  0.0502, cpi:  0.0145 },
  { year: 1937, stock: -0.3534, bond:  0.0138, cpi:  0.0286 },
  { year: 1938, stock:  0.2928, bond:  0.0421, cpi: -0.0278 },
  { year: 1939, stock: -0.0110, bond:  0.0441, cpi: -0.0048 },
  { year: 1940, stock: -0.1067, bond:  0.0540, cpi:  0.0096 },
  { year: 1941, stock: -0.1277, bond: -0.0202, cpi:  0.0972 },
  { year: 1942, stock:  0.1917, bond:  0.0229, cpi:  0.0929 },
  { year: 1943, stock:  0.2506, bond:  0.0249, cpi:  0.0316 },
  { year: 1944, stock:  0.1903, bond:  0.0258, cpi:  0.0211 },
  { year: 1945, stock:  0.3582, bond:  0.0380, cpi:  0.0225 },
  { year: 1946, stock: -0.0843, bond:  0.0313, cpi:  0.1817 },
  { year: 1947, stock:  0.0520, bond:  0.0092, cpi:  0.0901 },
  { year: 1948, stock:  0.0570, bond:  0.0195, cpi:  0.0271 },
  { year: 1949, stock:  0.1830, bond:  0.0466, cpi: -0.0180 },
  { year: 1950, stock:  0.3081, bond:  0.0043, cpi:  0.0579 },
  { year: 1951, stock:  0.2368, bond: -0.0030, cpi:  0.0587 },
  { year: 1952, stock:  0.1815, bond:  0.0227, cpi:  0.0088 },
  { year: 1953, stock: -0.0121, bond:  0.0414, cpi:  0.0062 },
  { year: 1954, stock:  0.5256, bond:  0.0329, cpi: -0.0050 },
  { year: 1955, stock:  0.3260, bond: -0.0134, cpi:  0.0037 },
  { year: 1956, stock:  0.0744, bond: -0.0226, cpi:  0.0286 },
  { year: 1957, stock: -0.1046, bond:  0.0680, cpi:  0.0302 },
  { year: 1958, stock:  0.4372, bond: -0.0210, cpi:  0.0176 },
  { year: 1959, stock:  0.1206, bond: -0.0265, cpi:  0.0150 },
  { year: 1960, stock:  0.0034, bond:  0.1164, cpi:  0.0148 },
  { year: 1961, stock:  0.2664, bond:  0.0206, cpi:  0.0067 },
  { year: 1962, stock: -0.0881, bond:  0.0569, cpi:  0.0122 },
  { year: 1963, stock:  0.2261, bond:  0.0168, cpi:  0.0165 },
  { year: 1964, stock:  0.1642, bond:  0.0373, cpi:  0.0119 },
  { year: 1965, stock:  0.1240, bond:  0.0072, cpi:  0.0192 },
  { year: 1966, stock: -0.0997, bond:  0.0291, cpi:  0.0335 },
  { year: 1967, stock:  0.2380, bond: -0.0158, cpi:  0.0304 },
  { year: 1968, stock:  0.1081, bond:  0.0327, cpi:  0.0472 },
  { year: 1969, stock: -0.0824, bond: -0.0501, cpi:  0.0611 },
  { year: 1970, stock:  0.0356, bond:  0.1675, cpi:  0.0549 },
  { year: 1971, stock:  0.1422, bond:  0.0979, cpi:  0.0336 },
  { year: 1972, stock:  0.1876, bond:  0.0282, cpi:  0.0341 },
  { year: 1973, stock: -0.1431, bond:  0.0366, cpi:  0.0880 },
  { year: 1974, stock: -0.2590, bond:  0.0199, cpi:  0.1220 },
  { year: 1975, stock:  0.3700, bond:  0.0361, cpi:  0.0701 },
  { year: 1976, stock:  0.2384, bond:  0.1598, cpi:  0.0481 },
  { year: 1977, stock: -0.0718, bond:  0.0129, cpi:  0.0677 },
  { year: 1978, stock:  0.0656, bond: -0.0078, cpi:  0.0903 },
  { year: 1979, stock:  0.1844, bond:  0.0067, cpi:  0.1331 },
  { year: 1980, stock:  0.3242, bond: -0.0299, cpi:  0.1240 },
  { year: 1981, stock: -0.0491, bond:  0.0820, cpi:  0.0894 },
  { year: 1982, stock:  0.2141, bond:  0.3281, cpi:  0.0387 },
  { year: 1983, stock:  0.2251, bond:  0.0320, cpi:  0.0380 },
  { year: 1984, stock:  0.0627, bond:  0.1373, cpi:  0.0395 },
  { year: 1985, stock:  0.3216, bond:  0.2571, cpi:  0.0377 },
  { year: 1986, stock:  0.1847, bond:  0.2428, cpi:  0.0113 },
  { year: 1987, stock:  0.0523, bond: -0.0496, cpi:  0.0441 },
  { year: 1988, stock:  0.1681, bond:  0.0822, cpi:  0.0442 },
  { year: 1989, stock:  0.3149, bond:  0.1769, cpi:  0.0465 },
  { year: 1990, stock: -0.0317, bond:  0.0624, cpi:  0.0611 },
  { year: 1991, stock:  0.3055, bond:  0.1500, cpi:  0.0306 },
  { year: 1992, stock:  0.0767, bond:  0.0936, cpi:  0.0290 },
  { year: 1993, stock:  0.0999, bond:  0.1421, cpi:  0.0275 },
  { year: 1994, stock:  0.0131, bond: -0.0804, cpi:  0.0267 },
  { year: 1995, stock:  0.3711, bond:  0.2348, cpi:  0.0254 },
  { year: 1996, stock:  0.2268, bond:  0.0143, cpi:  0.0332 },
  { year: 1997, stock:  0.3310, bond:  0.0994, cpi:  0.0170 },
  { year: 1998, stock:  0.2834, bond:  0.1492, cpi:  0.0161 },
  { year: 1999, stock:  0.2089, bond: -0.0825, cpi:  0.0268 },
  { year: 2000, stock: -0.0903, bond:  0.1666, cpi:  0.0339 },
  { year: 2001, stock: -0.1185, bond:  0.0557, cpi:  0.0155 },
  { year: 2002, stock: -0.2197, bond:  0.1525, cpi:  0.0238 },
  { year: 2003, stock:  0.2864, bond:  0.0038, cpi:  0.0188 },
  { year: 2004, stock:  0.1077, bond:  0.0449, cpi:  0.0326 },
  { year: 2005, stock:  0.0483, bond:  0.0287, cpi:  0.0342 },
  { year: 2006, stock:  0.1561, bond:  0.0196, cpi:  0.0254 },
  { year: 2007, stock:  0.0548, bond:  0.1021, cpi:  0.0408 },
  { year: 2008, stock: -0.3655, bond:  0.2010, cpi:  0.0009 },
  { year: 2009, stock:  0.2594, bond: -0.1112, cpi:  0.0272 },
  { year: 2010, stock:  0.1482, bond:  0.0846, cpi:  0.0150 },
  { year: 2011, stock:  0.0210, bond:  0.1604, cpi:  0.0296 },
  { year: 2012, stock:  0.1589, bond:  0.0297, cpi:  0.0174 },
  { year: 2013, stock:  0.3215, bond: -0.0911, cpi:  0.0150 },
  { year: 2014, stock:  0.1352, bond:  0.1075, cpi:  0.0076 },
  { year: 2015, stock:  0.0136, bond:  0.0128, cpi:  0.0073 },
  { year: 2016, stock:  0.1196, bond:  0.0069, cpi:  0.0207 },
  { year: 2017, stock:  0.2183, bond:  0.0228, cpi:  0.0211 },
  { year: 2018, stock: -0.0438, bond: -0.0002, cpi:  0.0191 },
  { year: 2019, stock:  0.3149, bond:  0.0986, cpi:  0.0229 },
  { year: 2020, stock:  0.1840, bond:  0.1133, cpi:  0.0136 },
  { year: 2021, stock:  0.2871, bond: -0.0442, cpi:  0.0703 },
  { year: 2022, stock: -0.1811, bond: -0.1786, cpi:  0.0645 },
  { year: 2023, stock:  0.2629, bond:  0.0561, cpi:  0.0334 },
  { year: 2024, stock:  0.2502, bond:  0.0098, cpi:  0.0290 },
];

// Build a sequence of N years of returns starting at the given calendar year.
// For an N-year retirement starting in startYear, returns the N consecutive
// historical returns. If we'd run past the end of the dataset, we wrap by
// continuing from the first available year (this only matters for very long
// horizons starting in recent years; for typical 30-year retirements
// starting before 1995, the wrap never happens).
const getHistoricalSequence = (startYear, numYears, assetMix = 0.7) => {
  // B10: previously, an unknown startYear silently fell back to the 1928 sequence —
  // users got Great-Depression returns thinking they'd run their selected year. Reject
  // out-of-range years explicitly so callers see the problem.
  const startIdx = HISTORICAL_RETURNS.findIndex(r => r.year === startYear);
  if (startIdx < 0) {
    const first = HISTORICAL_RETURNS[0].year;
    const last = HISTORICAL_RETURNS[HISTORICAL_RETURNS.length - 1].year;
    throw new Error(`getHistoricalSequence: startYear ${startYear} is outside the historical range (${first}–${last}).`);
  }
  const sequence = [];
  for (let i = 0; i < numYears; i++) {
    const idx = (startIdx + i) % HISTORICAL_RETURNS.length;
    const data = HISTORICAL_RETURNS[idx];
    // Blend stock/bond per the asset mix (e.g., 70/30 default)
    const blendedReturn = data.stock * assetMix + data.bond * (1 - assetMix);
    sequence.push({
      year: data.year,
      yearOffset: i,
      stockReturn: data.stock,
      bondReturn: data.bond,
      blendedReturn,
      cpi: data.cpi,
    });
  }
  return sequence;
};

// Get the list of valid starting years for a given horizon.
// For a 30-year retirement, the latest start year that has 30 years of data
// is 1995 (1995..2024). We can still allow later starts and wrap, but by
// default we restrict to "complete" historical sequences.
const getValidStartYears = (numYears, allowWrap = false) => {
  if (allowWrap) {
    return HISTORICAL_RETURNS.map(r => r.year);
  }
  const lastYear = HISTORICAL_RETURNS[HISTORICAL_RETURNS.length - 1].year;
  return HISTORICAL_RETURNS
    .filter(r => r.year + numYears - 1 <= lastYear)
    .map(r => r.year);
};

// Walk the ordinary federal brackets over an ALREADY-DEDUCTED taxable income.
//
// Split out of calculateFederalTax, which takes gross and applies the deduction
// itself. Both shapes are needed: a projection year knows its gross and wants a
// number, while a Form 1040 arrives at taxable income on line 15 and computes
// the tax on line 16 — the deduction was already spent on line 12, and feeding
// gross to a function that deducts again would double-count it.
//
// This mirrors applyStateBrackets, which the state engine already separates the
// same way for the same reason.
const federalTaxOnTaxableIncome = (taxableIncome, filingStatus, yearsFromNow = 0, inflationRate = 0.03) => {
  const baseBrackets = FEDERAL_TAX_BRACKETS_2026[filingStatus] || FEDERAL_TAX_BRACKETS_2026.married_joint;
  let tax = 0;
  let remainingIncome = Math.max(0, taxableIncome);
  for (const bracket of baseBrackets) {
    if (remainingIncome <= 0) break;
    const width = bracket.max === Infinity ? Infinity : bracket.max - bracket.min;
    const taxableInBracket = Math.min(remainingIncome, indexTo(width, yearsFromNow, inflationRate));
    tax += taxableInBracket * bracket.rate;
    remainingIncome -= taxableInBracket;
  }
  return tax;
};

// opts (all optional): { age65Count, taxYear, magi } — see getFederalDeduction.
// Omitting them yields the plain standard deduction, i.e. the historic behavior.
// `magi` defaults to grossIncome; pass it explicitly at call sites where the two
// differ (e.g. the final tax block, whose base excludes capital gains).
const calculateFederalTax = (grossIncome, filingStatus, yearsFromNow = 0, inflationRate = 0.03, opts = {}) => {
  const adjustedDeduction = getFederalDeduction(filingStatus, yearsFromNow, inflationRate, {
    ...opts,
    magi: opts.magi !== undefined && opts.magi !== null ? opts.magi : grossIncome,
  });
  const taxableIncome = Math.max(0, grossIncome - adjustedDeduction);
  return federalTaxOnTaxableIncome(taxableIncome, filingStatus, yearsFromNow, inflationRate);
};

const calculateStateTax = (grossIncome, state, filingStatus, yearsFromNow = 0, inflationRate = 0.03, taxableSS = 0, retirementIncome = 0, extraParams = {}) => {
  // ── PROGRESSIVE STATES: config-driven engine (brackets, per-state deductions,
  //    exemptions/credits, federal deductibility, retirement exclusions) ──
  if (STATE_TAX_CONFIG[state]) {
    return calculateStateTaxProgressive(
      grossIncome, state, filingStatus, yearsFromNow, inflationRate,
      taxableSS, retirementIncome, extraParams
    );
  }

  // ── FLAT-TAX STATES: Simplified flat-rate approximation ──
  // Apply inflation-adjusted standard deduction for state tax too (simplified)
  const baseDeduction = STANDARD_DEDUCTION_2026[filingStatus] || STANDARD_DEDUCTION_2026.married_joint;
  const inflationFactor = indexTo(1, yearsFromNow, inflationRate);
  const adjustedDeduction = baseDeduction * inflationFactor;
  // Exclude taxable SS from state income for states that don't tax it (41 of 50 states)
  const ssExclusion = STATES_THAT_TAX_SS.has(state) ? 0 : taxableSS;
  // Pension exclusion (most states with retirement-income exemption only exempt pensions).
  const pensionExclusion = STATES_EXEMPT_RETIREMENT_INCOME.has(state) ? retirementIncome : 0;
  // Broad qualified-distribution exclusion (IL/MS/PA exempt 401k/IRA withdrawals too — B9).
  const qualifiedWithdrawals = extraParams.qualifiedRetirementWithdrawals || 0;
  const qualifiedExclusion = STATES_EXEMPT_ALL_RETIREMENT_DISTRIBUTIONS.has(state) ? qualifiedWithdrawals : 0;
  const stateGrossIncome = grossIncome - ssExclusion - pensionExclusion - qualifiedExclusion;
  const taxableIncome = Math.max(0, stateGrossIncome - adjustedDeduction);
  return (STATE_TAX_RATES[state] || 0) * taxableIncome;
};

// IMPROVED: RMD calculation with birth year consideration (SECURE 2.0 Act)
// Does IRS Pub 590-B Table II (Joint and Last Survivor) govern instead of Table
// III (Uniform Lifetime)? It does when the spouse is the SOLE designated
// beneficiary and more than 10 years younger. Beneficiary designations are not
// an input to this app, so a married plan assumes the spouse — overwhelmingly
// the common case, and the assumption is stated in the warning this drives.
const rmdUsesJointTable = (pi) =>
  !!(pi && pi.filingStatus === 'married_joint' &&
     typeof pi.myAge === 'number' && typeof pi.spouseAge === 'number' &&
     (pi.myAge - pi.spouseAge) > 10);

// Look up a Table II divisor. Returns undefined when the pair is outside the
// stored slice, so callers fall back to Uniform Lifetime rather than to a
// fabricated number.
const getRmdJointFactor = (ownerAge, spouseAge) => {
  const row = RMD_JOINT_FACTORS[ownerAge];
  if (!row) return undefined;
  const v = row.split(',')[spouseAge - RMD_JOINT_MIN_SPOUSE_AGE];
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// `spouseAge` is optional. Supply it and, when the spouse qualifies as a sole
// beneficiary more than 10 years younger, the larger Table II divisor is used --
// producing the smaller distribution the statute actually requires. Omit it and
// Uniform Lifetime applies, which is the correct table for everyone else.
const calculateRMD = (balance, age, birthYear, spouseAge) => {
  // Determine RMD start age based on birth year (SECURE 2.0 Act rules)
  // Single source of truth — getRmdStartAge handles missing/unknown birthYear (defaults to 75).
  const rmdStartAge = getRmdStartAge(birthYear);

  // No RMD required before start age
  if (age < rmdStartAge) return 0;
  
  // Table II when a sole-beneficiary spouse is more than 10 years younger. The
  // >10 test is what the statute turns on, and it is not redundant with the
  // lookup: at exactly 10 years Table II equals Uniform Lifetime, and inside 10
  // years it would give a SMALLER divisor and so overstate the distribution.
  if (typeof spouseAge === 'number' && (age - spouseAge) > 10) {
    const joint = getRmdJointFactor(Math.min(age, 115), spouseAge);
    if (joint) return balance / joint;
  }

  // Get the divisor from the IRS Uniform Lifetime Table
  // Clamp age to 120 (minimum factor of 1.9)
  const clampedAge = Math.min(age, 120);
  const factor = RMD_FACTORS[clampedAge] || 1.9;
  return balance / factor;
};

// NEW: Calculate taxable portion of Social Security benefits
// Based on IRS Publication 915
const calculateSocialSecurityTaxableAmount = (ssIncome, otherIncome, filingStatus, taxExemptInterest = 0) => {
  // Combined income per IRS Pub 915 = AGI (excluding SS) + tax-exempt interest + 1/2 of SS benefits.
  // Muni-bond holders previously had SS taxability understated because tax-exempt interest
  // was missing from this sum (B1).
  const combinedIncome = otherIncome + (taxExemptInterest || 0) + (ssIncome * 0.5);
  
  // Define thresholds based on filing status
  const thresholds = filingStatus === 'married_joint' 
    ? { base: 32000, max: 44000 }
    : filingStatus === 'married_separate'
    ? { base: 0, max: 0 } // Married filing separately has $0 thresholds if living together
    : { base: 25000, max: 34000 }; // Single, Head of Household
  
  // Special case: Married filing separately with any combined income means 85% taxable
  if (filingStatus === 'married_separate' && combinedIncome > 0) {
    return Math.min(ssIncome * 0.85, ssIncome);
  }
  
  // Below first threshold: 0% taxable
  if (combinedIncome <= thresholds.base) {
    return 0;
  }
  
  // Between first and second threshold: up to 50% taxable
  if (combinedIncome <= thresholds.max) {
    const taxableAmount = Math.min(
      ssIncome * 0.5,
      (combinedIncome - thresholds.base) * 0.5
    );
    return taxableAmount;
  }
  
  // Above second threshold: up to 85% taxable.
  // Tier-1 contribution is min(0.5*SS, amountAt50) per IRS Pub 915 Worksheet 1 (B4).
  // Pre-fix used amountAt50 unconditionally, over-stating taxable SS in the narrow band
  // where 0.5*SS < amountAt50 AND the outer 85%-of-SS cap doesn't bind.
  const amountAt50Percent = (thresholds.max - thresholds.base) * 0.5;
  const tier1Contribution = Math.min(ssIncome * 0.5, amountAt50Percent);
  const excess = combinedIncome - thresholds.max;
  const taxableAmount = Math.min(
    ssIncome * 0.85,
    tier1Contribution + (excess * 0.85)
  );

  return taxableAmount;
};

// 2026 Long-term Capital Gains Rate Thresholds (IRS Rev. Proc. 2025-32). zeroRate = top of the
// 0% bracket; fifteenRate = top of the 15% bracket (20% applies above). Name kept for stability.
// Single/MFJ/MFS are exact IRS figures; HoH 15%→20% breakpoint is inflation-derived (~$579,700).
const CAPITAL_GAINS_THRESHOLDS_2025 = {
  single: { zeroRate: 49450, fifteenRate: 545500 },
  married_joint: { zeroRate: 98900, fifteenRate: 613700 },
  married_separate: { zeroRate: 49450, fifteenRate: 306850 },
  head_of_household: { zeroRate: 66200, fifteenRate: 579700 }
};

// Calculate long-term capital gains tax based on taxable income and filing status
// Returns the capital gains tax amount
const calculateCapitalGainsTax = (capitalGains, taxableIncome, filingStatus, yearsFromNow = 0, inflationRate = 0.03) => {
  if (capitalGains <= 0) return 0;
  
  const thresholds = CAPITAL_GAINS_THRESHOLDS_2025[filingStatus] || CAPITAL_GAINS_THRESHOLDS_2025.married_joint;
  const inflationFactor = indexTo(1, yearsFromNow, inflationRate);
  
  // Adjust thresholds for inflation
  const zeroRateThreshold = thresholds.zeroRate * inflationFactor;
  const fifteenRateThreshold = thresholds.fifteenRate * inflationFactor;
  
  // Capital gains "stack" on top of ordinary income to determine the rate
  const incomeBeforeGains = taxableIncome - capitalGains;
  
  let tax = 0;
  let remainingGains = capitalGains;
  
  // 0% bracket
  if (incomeBeforeGains < zeroRateThreshold) {
    const gainsAt0Pct = Math.min(remainingGains, zeroRateThreshold - Math.max(0, incomeBeforeGains));
    remainingGains -= gainsAt0Pct;
    // No tax at 0%
  }
  
  // 15% bracket
  if (remainingGains > 0) {
    const startOfGainsIn15 = Math.max(incomeBeforeGains, zeroRateThreshold);
    const gainsAt15Pct = Math.min(remainingGains, fifteenRateThreshold - startOfGainsIn15);
    if (gainsAt15Pct > 0) {
      tax += gainsAt15Pct * 0.15;
      remainingGains -= gainsAt15Pct;
    }
  }
  
  // 20% bracket
  if (remainingGains > 0) {
    tax += remainingGains * 0.20;
  }
  
  return tax;
};

// Net Investment Income Tax (NIIT) - 3.8% on investment income for high earners
const calculateNIIT = (investmentIncome, magi, filingStatus) => {
  const thresholds = {
    single: 200000,
    married_joint: 250000,
    married_separate: 125000,
    head_of_household: 200000
  };
  
  const threshold = thresholds[filingStatus] || thresholds.married_joint;
  
  if (magi <= threshold) return 0;
  
  // NIIT applies to the lesser of: net investment income OR excess MAGI over threshold
  const excessMAGI = magi - threshold;
  const taxableAmount = Math.min(investmentIncome, excessMAGI);
  
  return taxableAmount * 0.038;
};

// ── GOVERNMENT DEFINED-BENEFIT PENSION ESTIMATOR ─────────────────────────────
// Estimates a government pension from the standard formula shared by every major
// U.S. public system:  annual = years of service × multiplier × high-3 salary.
// The result is emitted as a normal pension income stream (nominal at retirement)
// plus the COLA rate and colaStartAge the stream should carry, so the projection
// engine needs no pension-specific logic — it just receives a dollar amount.
//
// Sources: OPM (FERS/CSRS computation), DoD FINRED (military BRS), OPM/FedWeek
// (CSRS tiers), TeacherPensions.org (state final-average-salary formula).

// FERS "diet" COLA: no full CPI pass-through. CPI < 2% → CPI; 2–3% → capped at 2%;
// above 3% → CPI − 1%. Applied only from age 62 (see colaStartAge on the stream).
const dietCola = (cpi) => {
  if (cpi < 0.02) return cpi;
  if (cpi <= 0.03) return 0.02;
  return cpi - 0.01;
};

// System registry. `mult` is a fixed per-year multiplier where one applies; FERS
// and CSRS compute their multiplier from age/service and tiers respectively.
const GOV_PENSION_SYSTEMS = {
  fers:           { label: 'FERS (federal)',                       colaType: 'diet',   colaStartAge: 62 },
  csrs:           { label: 'CSRS (federal, legacy)',               colaType: 'full',   colaStartAge: null },
  military_brs:   { label: 'Military — Blended Retirement System', mult: 0.020, colaType: 'full', colaStartAge: null },
  military_high3: { label: 'Military — legacy High-3',             mult: 0.025, colaType: 'full', colaStartAge: null },
  state:          { label: 'State / local / teacher',             colaType: 'custom', colaStartAge: null },
};

// Project a nominal high-3 (average of the highest 36 consecutive months of base
// pay) to the retirement date from a current salary and annual raise assumption:
// the average of the final three years' salary at retirement.
const projectHigh3 = (currentSalary, salaryGrowth, yearsUntilRetirement) => {
  const n = Math.max(0, yearsUntilRetirement || 0);
  const salAt = (k) => currentSalary * Math.pow(1 + (salaryGrowth || 0), k);
  return (salAt(n) + salAt(Math.max(0, n - 1)) + salAt(Math.max(0, n - 2))) / 3;
};

const estimateGovernmentPension = ({
  system,
  yearsOfService,
  retirementAge,
  currentSalary = 0,
  salaryGrowth = 0.03,
  yearsUntilRetirement = 0,
  high3Direct = null,            // if given (> 0), used as the nominal high-3 at retirement
  stateMultiplier = 0.02,        // used only for system === 'state'
  inflationRate = 0.03,          // drives the derived COLA rate
  survivorElection = false,      // 50% survivor annuity → base reduction
  survivorReductionPct = 0.10,   // standard ~10% for a 50% survivor benefit
} = {}) => {
  const cfg = GOV_PENSION_SYSTEMS[system] || GOV_PENSION_SYSTEMS.state;
  const years = Math.max(0, yearsOfService || 0);

  // 1. High-3 average salary (nominal at retirement).
  const high3 = (high3Direct != null && high3Direct > 0)
    ? high3Direct
    : projectHigh3(currentSalary, salaryGrowth, yearsUntilRetirement);

  // 2. Multiplier → gross annual pension.
  let annual, multiplierUsed;
  if (system === 'fers') {
    multiplierUsed = (retirementAge >= 62 && years >= 20) ? 0.011 : 0.010;
    annual = years * multiplierUsed * high3;
  } else if (system === 'csrs') {
    // Tiered: 1.5% for the first 5 years, 1.75% for the next 5, 2% beyond 10.
    const factor = Math.min(years, 5) * 0.015
      + Math.min(Math.max(years - 5, 0), 5) * 0.0175
      + Math.max(years - 10, 0) * 0.020;
    annual = factor * high3;
    multiplierUsed = years > 0 ? factor / years : 0; // effective blended rate
  } else if (system === 'military_brs' || system === 'military_high3') {
    multiplierUsed = cfg.mult;
    annual = years * multiplierUsed * high3;
  } else { // state / local / teacher — caller supplies the multiplier
    multiplierUsed = stateMultiplier;
    annual = years * multiplierUsed * high3;
  }

  // 3. Survivor election reduces the base annuity.
  if (survivorElection) annual *= (1 - survivorReductionPct);

  // 4. COLA rate the emitted stream should carry.
  let colaRate;
  if (cfg.colaType === 'diet') colaRate = dietCola(inflationRate);
  else colaRate = inflationRate; // 'full' and 'custom' both track CPI by default

  return {
    annualPension: Math.round(annual),
    high3: Math.round(high3),
    multiplierUsed,
    colaRate,
    colaStartAge: cfg.colaStartAge,
  };
};

// FERS Special Retirement Supplement: bridges the gap from a pre-62 retirement
// (at the Minimum Retirement Age with enough service) to age 62, approximating
// the Social Security benefit earned during federal service. OPM's rule of thumb:
//   supplement ≈ (estimated SS benefit at 62) × (years of FERS service ÷ 40).
// No COLA; paid until the month before 62; reduced by an earnings test (not modeled).
const estimateFersSupplement = ({ ssAt62Annual = 0, yearsOfService = 0 } = {}) =>
  Math.round(ssAt62Annual * Math.min(yearsOfService, 40) / 40);

function computeProjections(pi, accts, streams, assetList, events = [], recurringExpensesList = [], currentYearArg, opts = {}) {
  // currentYear used to be captured from RetirementPlanner's closure. It's now an
  // explicit parameter (with a fallback) so this function can be moved to module
  // scope and run in a Web Worker.
  const currentYear = currentYearArg !== undefined ? currentYearArg : new Date().getFullYear();
  // opts.yearOverrides: optional array indexed by yearsFromNow (0 = currentYear).
  // Each slot is null/undefined (use deterministic cagr + pi.inflationRate) or
  // { marketReturn, inflation } to drive Monte Carlo / historical sequence runs.
  const yearOverrides = opts.yearOverrides;
  // opts.spendingRule: optional Guyton-Klinger-style dynamic spending guardrails
  // { bandPct = 0.20, adjustPct = 0.10, initialWithdrawalRate? }. Each retirement
  // year after the first, the PRIOR year's withdrawal rate is compared to the
  // anchor rate (first retirement year's rate unless given) ± band. Outside the
  // band, the real spending target is cut/raised by adjustPct — persistently
  // (multiplier compounds). Rates use withdrawal ÷ end-of-year portfolio,
  // consistently for both anchor and comparison.
  const spendingRule = opts.spendingRule || null;
  let guardrailMultiplier = 1;
  let guardrailAnchorRate = (spendingRule && spendingRule.initialWithdrawalRate > 0)
    ? spendingRule.initialWithdrawalRate : null;
  let guardrailPrevYear = null; // last pushed year row (for prior-year rate)
  const years = [];
  let accountBalances = accts.reduce((acc, account) => ({ ...acc, [account.id]: account.balance }), {});
  
  // Track reinvested excess RMDs when no brokerage account exists
  // This prevents excess RMDs from vanishing — they grow at a conservative rate
  let excessReinvestmentPool = 0;
  const reinvestmentGrowthRate = 0.06; // Conservative brokerage-like return
  
  // Planning horizon in years. Covers the YOUNGER spouse when married, so a plan
  // is never truncated before the person who has to live off it reaches
  // legacyAge (see getPlanningHorizonYears).
  const horizonYears = getPlanningHorizonYears(pi);

  // Pre-calculate inflation factors for better performance.
  // Cumulative product so per-year overrides (MC / historical) can replace
  // pi.inflationRate one year at a time. When yearOverrides is absent, this is
  // mathematically identical to Math.pow(1 + pi.inflationRate, i).
  const maxYears = horizonYears + 1;
  const inflationFactors = new Array(maxYears);
  inflationFactors[0] = 1;
  for (let i = 1; i < maxYears; i++) {
    const yrInflation = (yearOverrides && yearOverrides[i - 1])
      ? yearOverrides[i - 1].inflation
      : pi.inflationRate;
    inflationFactors[i] = inflationFactors[i - 1] * (1 + yrInflation);
  }
  
  // ── SURVIVOR MODELING STATE ───────────────────────────────────────────────────
  // Track whether each spouse is alive. When one dies, their income stops,
  // filing status changes, and the survivor gets the higher SS benefit.
  const survivorEnabled = pi.survivorModelEnabled && pi.filingStatus === 'married_joint';
  let primaryAlive = true;
  let spouseAlive = true;
  let yearOfFirstDeath = null;        // Calendar year when first spouse dies
  let survivorSSBenefit = 0;          // The higher SS benefit the survivor inherits
  let deceasedSSBenefit = 0;          // The SS benefit that stopped
  // Cache original SS amounts for survivor benefit calculation (in today's dollars)
  // ── SPOUSAL TOP-UP ──────────────────────────────────────────────────────────
  // Applied here, once, by raising each SS stream's amount to the greater of the
  // person's own benefit and their spousal entitlement. Doing it at the stream
  // level rather than inside the year loop means COLA, the today's-dollars flag,
  // taxation and the survivor rules all keep working unchanged — they simply see
  // the correct benefit.
  //
  // It also composes correctly with survivorship without special-casing: the
  // survivor rule already pays the GREATER of the survivor's own benefit and the
  // deceased's. A widow(er) who had been drawing 50% steps up to 100%, because
  // the deceased's benefit is necessarily the larger of the two.
  //
  // Requires a PIA on both streams. Streams built by the wizard carry one; a
  // hand-entered stream may not, and without the worker's PIA there is nothing
  // to take half of, so the top-up is skipped rather than guessed at.
  if (pi.filingStatus === 'married_joint') {
    const applySpousal = (stream, otherStream, birthYear) => {
      if (!stream || !otherStream || !otherStream.pia) return;
      const spousalMonthly = calculateSpousalBenefit(otherStream.pia, stream.startAge, birthYear);
      const spousalAnnual = spousalMonthly * 12;
      if (spousalAnnual > (stream.amount || 0)) {
        stream.spousalTopUp = spousalAnnual - (stream.amount || 0);
        stream.amount = spousalAnnual;
      }
    };
    // Copy first — callers reuse their stream objects across scenarios (the
    // Sensitivity and Monte Carlo tabs run the engine dozens of times on the same
    // array), and a top-up applied in place would compound on every run.
    const idxMe = streams.findIndex(s => s.type === 'social_security' && s.owner === 'me');
    const idxSp = streams.findIndex(s => s.type === 'social_security' && s.owner === 'spouse');
    if (idxMe >= 0 || idxSp >= 0) {
      streams = streams.slice();
      if (idxMe >= 0) streams[idxMe] = { ...streams[idxMe] };
      if (idxSp >= 0) streams[idxSp] = { ...streams[idxSp] };
      const me = idxMe >= 0 ? streams[idxMe] : null;
      const sp = idxSp >= 0 ? streams[idxSp] : null;
      const myBirth = pi.myBirthYear || (currentYear - (pi.myAge || 0));
      const spBirth = pi.spouseBirthYear || (currentYear - (pi.spouseAge || 0));
      applySpousal(me, sp, myBirth);
      applySpousal(sp, me, spBirth);
    }
  }

  const primarySSStream = streams.find(s => s.type === 'social_security' && s.owner === 'me');
  const spouseSSStream = streams.find(s => s.type === 'social_security' && s.owner === 'spouse');
  const primarySSAmount = primarySSStream ? primarySSStream.amount : 0;
  const spouseSSAmount = spouseSSStream ? spouseSSStream.amount : 0;

  // streamColaYears / streamAmountAtAge are at module scope (see above) so the
  // Withdrawals tab can share the exact same COLA rule instead of re-deriving it.

  // MAGI by projection year (index = yearsFromNow). IRMAA in year t is based on
  // MAGI from year t−2 (the real Medicare lookback); for the first two years we
  // have no history and fall back to the current-year approximation.
  const magiByYear = [];

  for (let year = currentYear; year <= currentYear + horizonYears; year++) {
    const myAge = pi.myAge + (year - currentYear);
    const spouseAge = pi.spouseAge + (year - currentYear);
    const yearsFromNow = year - currentYear;
    // Years of tax-table indexing for THIS calendar year. See BASE_TAX_YEAR: the
    // tables are 2026 dollars, so they index from 2026, not from whenever the app
    // happens to be running. Equal to yearsFromNow only during 2026 — which is
    // exactly why the difference went unnoticed. Every call that reads a tax
    // table (brackets, deductions, FICA wage base, IRMAA tiers, LTCG thresholds,
    // the SS earnings-test limit, ACA FPL) takes this; everything measured from
    // today in today's dollars (spending, COLA, asset growth, healthcare) keeps
    // taking yearsFromNow.
    const taxIndexYears = year - BASE_TAX_YEAR;
    // IRMAA 2-year MAGI lookback: this year's surcharge is FIXED by income from
    // two years ago — it does not respond to this year's withdrawals or
    // conversions (those hit the surcharge two years from now). null = no
    // history yet (first two projection years) → current-year approximation.
    const irmaaLookbackMAGI = yearsFromNow >= 2 ? magiByYear[yearsFromNow - 2] : null;
    
    // ── SURVIVOR EVENT CHECK ────────────────────────────────────────────────────
    // Detect death events and update survivor state for this year
    let survivorEvent = null; // 'primary_died' | 'spouse_died' | null (only in the year it happens)
    if (survivorEnabled) {
      // Death triggers in the year the person reaches their life-expectancy age:
      // they are not alive for income, RMDs, or SS in that year (B2).
      if (primaryAlive && myAge >= pi.myLifeExpectancy) {
        primaryAlive = false;
        if (!yearOfFirstDeath) yearOfFirstDeath = year;
        survivorEvent = 'primary_died';
        deceasedSSBenefit = primarySSAmount;
        survivorSSBenefit = spouseSSAmount;
      }
      if (spouseAlive && spouseAge >= pi.spouseLifeExpectancy) {
        spouseAlive = false;
        if (!yearOfFirstDeath) yearOfFirstDeath = year;
        survivorEvent = survivorEvent ? 'both_died' : 'spouse_died';
        deceasedSSBenefit = spouseSSAmount;
        survivorSSBenefit = primarySSAmount;
      }
    }

    // Effective filing status: changes after a spouse dies.
    // Year of death: MFJ (joint final return). Year 1+: Single.
    // Qualifying Surviving Spouse (MFJ brackets for 2 more years) requires a
    // dependent child per IRC §2(a) — not modeled here since retirement plans
    // rarely have dependents (B3).
    let effectiveFilingStatus = pi.filingStatus;
    if (survivorEnabled && yearOfFirstDeath && (primaryAlive !== spouseAlive)) {
      const yearsSinceDeath = year - yearOfFirstDeath;
      if (yearsSinceDeath >= 1) {
        effectiveFilingStatus = 'single';
      }
    }
    if (survivorEnabled && !primaryAlive && !spouseAlive) {
      // Both deceased — no more projections needed, but we'll still calculate for the record
      effectiveFilingStatus = 'single';
    }

    // Living members of the tax household who have reached 65. Drives BOTH the
    // age-65 federal deductions and Medicare eligibility — the predicate is
    // identical, so it lives in one place rather than being re-derived at each
    // of the three sites that used to compute it independently.
    // Count LIVING household members who have reached 65. Gated on whether the
    // plan has a spouse at all (pi.filingStatus), NOT on the effective status:
    // once the first spouse dies the survivor files single, and keying off the
    // effective status meant they satisfied neither branch — a surviving spouse
    // silently lost their own age-65 additional standard deduction and their
    // Medicare/IRMAA eligibility for the rest of the projection.
    const planHasSpouse = pi.filingStatus === 'married_joint' || pi.filingStatus === 'married_separate';
    // Who Medicare is billing: only people actually alive. A decedent is not
    // billed premiums for a year they did not live through.
    let age65Count = 0;
    if (primaryAlive && myAge >= 65) age65Count++;
    if (planHasSpouse && spouseAlive && spouseAge >= 65) age65Count++;

    // Who the TAX RETURN covers, which is not the same set in the year of a
    // death: the final return still includes the decedent, and their age-65
    // additional standard deduction still applies. Counting only the living
    // dropped it in that year. (The engine deliberately gives a decedent no
    // income in their death year — see the survivor block above — so this affects
    // the deduction alone, never their income.)
    const diedThisYear = { primary: survivorEvent === 'primary_died' || survivorEvent === 'both_died',
                           spouse: survivorEvent === 'spouse_died' || survivorEvent === 'both_died' };
    let age65OnReturn = 0;
    if ((primaryAlive || diedThisYear.primary) && myAge >= 65) age65OnReturn++;
    if (planHasSpouse && (spouseAlive || diedThisYear.spouse) && spouseAge >= 65) age65OnReturn++;

    // Federal deduction opts for this year. `magi` is supplied per call site,
    // since the senior deduction phases out on MAGI and the various tax bases
    // (with/without capital gains, pre/post conversion) differ.
    const fedOpts = (magiForPhaseout) => ({ age65Count: age65OnReturn, taxYear: year, magi: magiForPhaseout });

    // Penalized share of a distribution from a given account this year (§72(t)).
    // Resolves the owner's age and retirement age, then defers to the shared rule.
    const penaltyShareFor = (account) => {
      const ownerAge = account.owner === 'spouse' ? spouseAge : myAge;
      const ownerRetirementAge = account.owner === 'spouse'
        ? (pi.spouseRetirementAge ?? pi.myRetirementAge) : pi.myRetirementAge;
      return earlyWithdrawalPenaltyShare(account, ownerAge, ownerRetirementAge, !!pi.sepp72tEnabled);
    };

    // Use pre-calculated inflation factor
    const inflationFactor = inflationFactors[yearsFromNow] || Math.pow(1 + pi.inflationRate, yearsFromNow);
    // Survivor spending step-down: when exactly one spouse is alive under survivor
    // modeling, the household spends a fraction of the couple's target (default 75%).
    // A single person's fixed costs don't halve, so this is a haircut, not a split.
    const survivorActive = survivorEnabled && (primaryAlive !== spouseAlive);
    const spendFactor = survivorActive ? (pi.survivorSpendingFactor ?? 0.75) : 1;
    // Spending-phase multiplier (go-go/slow-go/no-go) applies to BASE spending
    // only — recurring expense items carry their own age windows, and healthcare
    // is modeled separately (and typically rises while discretionary falls).
    const phaseMultiplier = getSpendingPhaseMultiplier(pi, myAge);

    // ── GUARDRAILS (dynamic spending) ─────────────────────────────────────────
    // Evaluate the prior year's withdrawal rate against the anchor ± band and
    // adjust the persistent spending multiplier before setting this year's target.
    let guardrailEvent; // 'cut' | 'raise' | undefined
    if (spendingRule && guardrailAnchorRate !== null && guardrailPrevYear
        && myAge > pi.myRetirementAge && guardrailPrevYear.totalPortfolio > 0) {
      // Spending-only rate: exclude excess RMD (forced out but reinvested, not
      // spent) — otherwise RMD age would trip phantom "cuts" in healthy plans.
      const prevRate = (guardrailPrevYear.portfolioWithdrawal - (guardrailPrevYear.excessRMD || 0)) / guardrailPrevYear.totalPortfolio;
      const band = spendingRule.bandPct ?? 0.20;
      const adjust = spendingRule.adjustPct ?? 0.10;
      if (prevRate > guardrailAnchorRate * (1 + band)) {
        guardrailMultiplier *= (1 - adjust);
        guardrailEvent = 'cut';
      } else if (prevRate < guardrailAnchorRate * (1 - band)) {
        guardrailMultiplier *= (1 + adjust);
        guardrailEvent = 'raise';
      }
    }
    const desiredIncome = pi.desiredRetirementIncome * inflationFactor * spendFactor * phaseMultiplier
      * (spendingRule ? guardrailMultiplier : 1);
    
    let totalSocialSecurity = 0, totalPension = 0, totalOtherIncome = 0, earnedIncome = 0;
    let nonSSIncome = 0; // Track non-SS income for calculating SS taxation
    let myEarnedIncome = 0, spouseEarnedIncome = 0; // Per-person for FICA wage base
    
    streams.forEach(stream => {
      const ownerAge = stream.owner === 'me' ? myAge : spouseAge;
      const ownerAlive = stream.owner === 'me' ? primaryAlive : spouseAlive;
      
      // Skip income from deceased owner (survivor modeling)
      // Exception: pensions with survivorBenefit flag continue for the survivor
      if (survivorEnabled && !ownerAlive) {
        if (stream.type === 'pension' && stream.survivorBenefit) {
          // Pension continues at survivor benefit rate (default 50%)
          const survivorRate = stream.survivorBenefitRate || 0.5;
          if (ownerAge >= stream.startAge && ownerAge <= stream.endAge) {
            const colaYears = streamColaYears(stream, ownerAge, yearsFromNow);
            const adjustedAmount = stream.amount * Math.pow(1 + (stream.cola || 0), colaYears) * survivorRate;
            totalPension += adjustedAmount;
            nonSSIncome += adjustedAmount;
          }
        }
        // Social Security for deceased is handled separately via survivor benefit below
        return; // Skip all other income from deceased
      }
      
      if (ownerAge >= stream.startAge && ownerAge <= stream.endAge) {
        const colaYears = streamColaYears(stream, ownerAge, yearsFromNow);
        const adjustedAmount = stream.amount * Math.pow(1 + (stream.cola || 0), colaYears);

        if (stream.type === 'earned_income') {
          earnedIncome += adjustedAmount;
          nonSSIncome += adjustedAmount;
          if (stream.owner === 'me') myEarnedIncome += adjustedAmount;
          else spouseEarnedIncome += adjustedAmount;
        } else if (stream.type === 'social_security') {
          // If survivor modeling is active and the other spouse has died,
          // the survivor gets the HIGHER of their own benefit or the deceased's.
          // We handle this by: keeping the living person's SS as-is here,
          // then adding a survivor SS adjustment below.
          totalSocialSecurity += adjustedAmount;
          // SS taxation calculated separately below
        } else if (stream.type === 'pension') {
          totalPension += adjustedAmount;
          nonSSIncome += adjustedAmount;
        } else {
          totalOtherIncome += adjustedAmount;
          nonSSIncome += adjustedAmount;
        }
      }
    });
    
    // ── SURVIVOR SS BENEFIT ADJUSTMENT ──────────────────────────────────────────
    // SSA rule: when one spouse dies, the survivor receives the HIGHER of:
    //   (a) their own benefit, or
    //   (b) what the deceased was getting (the survivor benefit).
    // The survivor cannot collect both. We model this by adding the difference
    // (uplift) when the deceased's benefit was higher.
    if (survivorEnabled && yearOfFirstDeath && (primaryAlive !== spouseAlive) && deceasedSSBenefit > 0) {
      const survivorOwner = primaryAlive ? 'me' : 'spouse';
      const survivorAge = primaryAlive ? myAge : spouseAge;
      const survivorStream = streams.find(s => s.type === 'social_security' && s.owner === survivorOwner);
      const deceasedStream = streams.find(s => s.type === 'social_security' && s.owner !== survivorOwner);
      
      // Years of COLA that have accumulated on the deceased's benefit.
      // If they claimed before death, COLA from claim age onwards.
      // If they hadn't claimed yet at death, COLA only after the survivor claims.
      const deceasedCOLA = (deceasedStream && deceasedStream.cola) || 0;
      
      if (survivorStream && survivorAge >= survivorStream.startAge && survivorAge <= survivorStream.endAge) {
        // Case 1: Survivor is currently collecting their own SS.
        // totalSocialSecurity already includes the survivor's own COLA-adjusted benefit.
        // Add the uplift if the deceased's benefit (with COLA) exceeds it.
        const ownColaYears = streamColaYears(survivorStream, survivorAge, yearsFromNow);
        const currentOwnSS = survivorStream.amount * Math.pow(1 + (survivorStream.cola || 0), ownColaYears);
        // Approximation: apply same number of COLA years to the deceased's benefit.
        // (More precise would track each spouse's actual claim date and COLA history.)
        const deceasedColaYears = (deceasedStream && deceasedStream.todaysDollars) ? yearsFromNow : ownColaYears;
        const inheritedSS = deceasedSSBenefit * Math.pow(1 + deceasedCOLA, deceasedColaYears);
        if (inheritedSS > currentOwnSS) {
          totalSocialSecurity += (inheritedSS - currentOwnSS);
        }
      } else if (deceasedStream) {
        // Case 2: Survivor hasn't started their own SS yet.
        // Survivor benefits can be claimed as early as age 60 (50 if disabled).
        // We assume they claim at the deceased's start age or 60, whichever is later.
        const survivorClaimAge = Math.max(60, deceasedStream.startAge);
        if (survivorAge >= survivorClaimAge) {
          // Years of COLA since the deceased's stream would have started
          const yearsFromDeceasedStart = deceasedStream.todaysDollars
            ? yearsFromNow
            : Math.max(0, survivorAge - deceasedStream.startAge);
          const inheritedSS = deceasedSSBenefit * Math.pow(1 + deceasedCOLA, yearsFromDeceasedStart);
          totalSocialSecurity += inheritedSS;
          // Note: nonSSIncome doesn't change — SS is handled separately for tax purposes
        }
      }
    }
    
    // ── SOCIAL SECURITY EARNINGS TEST ─────────────────────────────────────────
    // If claiming SS before FRA while still earning, benefits are reduced.
    // $1 withheld per $2 earned above limit (or $1 per $3 in FRA year).
    // After FRA, benefits are recalculated upward to credit withheld months,
    // but the cash flow impact during working years matters for planning.
    let ssEarningsTestReduction = 0;
    if (totalSocialSecurity > 0 && earnedIncome > 0) {
      // Check each SS stream's owner against their FRA
      streams.forEach(stream => {
        if (stream.type !== 'social_security') return;
        const ownerAge = stream.owner === 'me' ? myAge : spouseAge;
        const ownerBirthYear = stream.owner === 'me'
          ? (pi.myBirthYear || (currentYear - pi.myAge))
          : (pi.spouseBirthYear || (currentYear - pi.spouseAge));
        const ownerFRA = getFullRetirementAge(ownerBirthYear);
        const ownerEarned = stream.owner === 'me' ? myEarnedIncome : spouseEarnedIncome;
        
        if (ownerAge >= stream.startAge && ownerAge < ownerFRA && ownerEarned > 0) {
          const reduction = calculateSSEarningsTestReduction(ownerEarned, ownerAge, ownerFRA, taxIndexYears, pi.inflationRate);
          // Can't reduce more than the SS benefit itself
          const colaYears = streamColaYears(stream, ownerAge, yearsFromNow);
          const thisBenefit = stream.amount * Math.pow(1 + (stream.cola || 0), colaYears);
          const cappedReduction = Math.min(reduction, thisBenefit);
          ssEarningsTestReduction += cappedReduction;
        }
      });
      
      // Apply reduction to total SS
      totalSocialSecurity = Math.max(0, totalSocialSecurity - ssEarningsTestReduction);
    }
    
    // ── ONE-TIME EVENTS ─────────────────────────────────────────────────────────
    // Process one-time income/expense events for this year
    let oneTimeExpenseTotal = 0;
    let oneTimeTaxableIncome = 0;
    let oneTimeNontaxableIncome = 0;
    let yearEvents = []; // Track which events fire this year
    
    events.forEach(evt => {
      const evtOwnerAge = evt.owner === 'spouse' ? spouseAge : myAge;
      if (evtOwnerAge === evt.age) {
        const adjustedAmount = evt.inflationAdjusted
          ? evt.amount * inflationFactor
          : evt.amount;
        
        if (evt.type === 'expense') {
          oneTimeExpenseTotal += adjustedAmount;
        } else if (evt.type === 'taxable_income') {
          oneTimeTaxableIncome += adjustedAmount;
          nonSSIncome += adjustedAmount;
        } else if (evt.type === 'nontaxable_income') {
          oneTimeNontaxableIncome += adjustedAmount;
        }
        yearEvents.push({ name: evt.name, amount: adjustedAmount, type: evt.type });
      }
    });

    // ── ASSET SALES ─────────────────────────────────────────────────────────────
    // An asset with a saleAge is disposed of in that year: the mortgage is paid
    // off out of the proceeds, the net cash becomes spendable, and any gain above
    // the §121 exclusion is a long-term capital gain.
    //
    // The cash and the tax are deliberately routed separately. Net proceeds join
    // oneTimeNontaxableIncome, which reduces this year's withdrawal need and
    // sweeps any remainder into a brokerage account. The taxable gain is added to
    // the capital-gains bucket further down. Splitting them is what keeps return
    // of basis and excluded gain untaxed while still spendable -- the whole point
    // of §121. Sending the gross through either channel alone would either tax
    // money that is not income or hide income that is.
    let assetSaleTaxableGain = 0;
    let assetSaleProceeds = 0;
    let assetSaleExcludedGain = 0;
    assetList.forEach(asset => {
      if (!asset.saleAge) return;
      const ownerAge = asset.owner === 'spouse' ? spouseAge : myAge;
      if (ownerAge !== asset.saleAge) return;

      // The asset appreciates to the sale year; basis and costs do not. Cost
      // basis is a historical purchase price, and a percentage selling cost
      // scales with the sale price by construction.
      const salePrice = (asset.value || 0) * Math.pow(1 + (asset.appreciationRate || 0), yearsFromNow);
      const sellingCosts = salePrice * (asset.sellingCostPercent ?? 0.06);
      const mortgageOwed = remainingMortgageAt(asset, myAge, yearsFromNow, pi);
      const sale = computeAssetSale({
        salePrice,
        costBasis: asset.costBasis || 0,
        sellingCosts,
        mortgage: mortgageOwed,
        isPrimaryResidence: !!asset.isPrimaryResidence,
        filingStatus: effectiveFilingStatus,
      });
      assetSaleTaxableGain += sale.taxableGain;
      assetSaleExcludedGain += sale.excludedGain;
      assetSaleProceeds += Math.max(0, sale.netProceeds);
      oneTimeNontaxableIncome += Math.max(0, sale.netProceeds);
      yearEvents.push({ name: `Sold ${asset.name}`, amount: Math.max(0, sale.netProceeds), type: 'asset_sale' });
    });

    // Calculate FICA (employee share) on earned income — per-person for correct wage base application
    const myFICA = calculateFICA(myEarnedIncome, effectiveFilingStatus, taxIndexYears, pi.inflationRate);
    const spouseFICA = calculateFICA(spouseEarnedIncome, effectiveFilingStatus, taxIndexYears, pi.inflationRate);
    const totalFICA = myFICA.total + spouseFICA.total;
    
    // NOTE: taxable SS is computed below, AFTER the accounts loop, because the
    // pre-tax contribution deduction (which reduces AGI, and therefore the IRS
    // Pub 915 combined-income base) isn't known until contributions are tallied.

    // Determine if we're in retirement based on age (not earned income).
    // Hoisted above the contributions loop: a dated expense before retirement is
    // paid by pausing that year's saving, which means the loop below has to know.
    const isRetired = myAge >= pi.myRetirementAge;

    // ── RECURRING EXPENSES (categorized, with per-item inflation) ───────────────
    // spendFactor applies the survivor step-down to these household line items,
    // matching the haircut already applied to desiredIncome above. Computed here,
    // above the contributions loop, because the pre-retirement funding rule below
    // needs the total before contributions are committed.
    const recurringResult = calculateRecurringExpenses(recurringExpensesList, myAge, spouseAge, yearsFromNow, pi.inflationRate, spendFactor);
    const totalRecurringExpenses = recurringResult.total;

    // ── PRE-RETIREMENT DATED EXPENSES ──────────────────────────────────────────
    // Before retirement the engine assumes salary covers ordinary living — there
    // is no current-spending input to net against. But an expense the user
    // explicitly DATED (tuition at 55, a wedding at 58) is on top of ordinary
    // living and has to come from somewhere, and previously it came from nowhere:
    // the projection reported the figure and the portfolio was untouched, so a
    // $200k pre-retirement expense cost the plan exactly zero.
    //
    // Funding order is what households actually do: pause saving first, then draw.
    // Healthcare is deliberately excluded — pre-65 coverage while working is
    // employer/salary-funded, so treating it as unfunded is correct there.
    const preRetirementExpenseNeed = isRetired ? 0 : (totalRecurringExpenses + oneTimeExpenseTotal);

    // First pass: add contributions and calculate RMDs (before growth)
    let totalRMD = 0;
    const accountRMDs = {}; // Track RMD per account
    let preTaxContributions = 0; // Track pre-tax (401k/403b/457b/IRA) contributions for tax deduction
    const accountContributions = {}; // Track contribution per account for display
    const deductibleShareOf = {};    // id -> fraction of the contribution that was deductible
    
    accts.forEach(account => {
      accountContributions[account.id] = 0; // Initialize
      const ownerAge = account.owner === 'me' ? myAge : account.owner === 'spouse' ? spouseAge : Math.max(myAge, spouseAge);
      const yearsContributing = ownerAge - account.startAge;
      const contributionGrowth = account.contributionGrowth || 0;
      const ownerAlive = account.owner === 'me' ? primaryAlive : account.owner === 'spouse' ? spouseAlive : (primaryAlive || spouseAlive);
      
      // Add contributions if in contribution period AND owner is alive
      if (ownerAlive && ownerAge >= account.startAge && ownerAge < account.stopAge) {
        // Determine base contribution: fixed-$ from the field, or % of this year's salary.
        // In 'percent' mode the saver thinks "X% of paycheck" — the contribution scales
        // with the owner's salary COLA automatically, so contributionGrowth defaults to 0.
        let baseContribution = account.contribution;
        if (account.contributionMode === 'percent') {
          const ownerSalary = account.owner === 'me' ? myEarnedIncome
                            : account.owner === 'spouse' ? spouseEarnedIncome
                            : 0;
          baseContribution = ownerSalary * ((account.employeePercent || 0) + (account.employerMatchPercent || 0));
        }
        const adjustedContribution = baseContribution * Math.pow(1 + contributionGrowth, Math.max(0, yearsContributing));
        accountBalances[account.id] += adjustedContribution;
        accountContributions[account.id] = Math.round(adjustedContribution);
        
        // Pre-tax contributions reduce AGI (above-the-line deduction).
        // 401k, 403b, 457b, Traditional IRA contributions are tax-deductible.
        // Roth contributions are NOT deductible (already taxed).
        // Employer contributions (match, profit sharing) are NOT deducted from YOUR income
        // — they're an added benefit that doesn't come from your paycheck.
        // Employee contributions are deductible whether made by the primary ('me') or the
        // spouse ('spouse'), so both are credited here.
        // The 'both' option lumps employee + employer together and can't be cleanly split,
        // so it is NOT deducted — separate such an account into an employee row ('me'/'spouse')
        // and an employer row for accurate tax modeling.
        // Only money that actually left the saver's paycheck reduces taxable income.
        // Fixed mode: the whole contribution is the saver's, unless it's an
        // employer/both row (those aren't deducted — see note above).
        // Percent mode: a single account can hold BOTH the employee deferral and the
        // employer match (employeePercent + employerMatchPercent). Only the employee's
        // own % was ever in wages, so only that slice is deductible — the employer
        // match was never income and must not reduce AGI.
        const contributorRole = account.contributor || 'me';
        if (isPreTaxAccount(account.type) && adjustedContribution > 0) {
          let deductible = 0;
          // eslint-disable-next-line no-unused-vars -- captured below for the clawback
          if (account.contributionMode === 'percent') {
            const eePct = account.employeePercent || 0;
            const erPct = account.employerMatchPercent || 0;
            if (eePct + erPct > 0) deductible = adjustedContribution * (eePct / (eePct + erPct));
          } else if (contributorRole === 'me' || contributorRole === 'spouse') {
            deductible = adjustedContribution;
          }
          preTaxContributions += deductible;
          // Remember the deductible share so pausing this contribution can
          // reverse the deduction proportionally — you cannot deduct money you
          // did not end up contributing.
          deductibleShareOf[account.id] = adjustedContribution > 0 ? deductible / adjustedContribution : 0;
        }
      }
      
      // Calculate RMD for pre-tax accts using constant
      // Skip if the account's owner is deceased — consistent with the engine's "not alive for
      // income/RMDs/SS in the death year" convention (see survivor-event block above). A
      // surviving spouse on a joint account still triggers RMDs (ownerAlive uses OR for joint).
      if (isPreTaxAccount(account.type) && ownerAlive) {
        // Get birth year based on account owner
        const ownerBirthYear = account.owner === 'me'
          ? pi.myBirthYear
          : account.owner === 'spouse'
          ? pi.spouseBirthYear
          : pi.myBirthYear; // Default to primary owner for joint accts

        // Table II needs the OTHER spouse's age, and only applies while they are
        // alive to be the beneficiary. Once they have died the account owner is
        // back on Uniform Lifetime.
        const beneficiaryAge = pi.filingStatus !== 'married_joint' ? undefined
          : account.owner === 'spouse' ? (primaryAlive ? myAge : undefined)
          : (spouseAlive ? spouseAge : undefined);
        const rmd = calculateRMD(accountBalances[account.id], ownerAge, ownerBirthYear, beneficiaryAge);
        accountRMDs[account.id] = rmd;
        totalRMD += rmd;
      }
    });
    
    // ── FUND PRE-RETIREMENT DATED EXPENSES: PAUSE SAVING FIRST ─────────────────
    // Reduce this year's contributions to cover a dated pre-retirement expense
    // before touching the portfolio, proportionally across every account that was
    // contributing. Reversing a contribution also reverses its deduction, which
    // raises taxable income — that is real, and it is why this cannot simply be
    // netted off the balance.
    let contributionsPaused = 0;
    let preRetirementDrawNeed = 0;
    if (preRetirementExpenseNeed > 0) {
      const contributingIds = accts.map(a => a.id).filter(id => (accountContributions[id] || 0) > 0);
      const totalContributed = contributingIds.reduce((sum, id) => sum + accountContributions[id], 0);
      const toPause = Math.min(preRetirementExpenseNeed, totalContributed);
      if (toPause > 0 && totalContributed > 0) {
        contributingIds.forEach(id => {
          const share = accountContributions[id] / totalContributed;
          const cut = toPause * share;
          accountBalances[id] = Math.max(0, accountBalances[id] - cut);
          accountContributions[id] = Math.round(accountContributions[id] - cut);
          preTaxContributions -= cut * (deductibleShareOf[id] || 0);
          contributionsPaused += cut;
        });
      }
      preTaxContributions = Math.max(0, preTaxContributions);
      // Whatever pausing could not cover has to be withdrawn.
      preRetirementDrawNeed = Math.max(0, preRetirementExpenseNeed - contributionsPaused);
    }

    // ── PRE-TAX CONTRIBUTION DEDUCTION ──────────────────────────────────────────
    // Pre-tax 401k/403b/457b/IRA contributions are above-the-line deductions that
    // reduce AGI and therefore federal/state taxable income.
    // We cap the deduction at earned income (can't deduct more than you earn).
    const preTaxDeduction = Math.min(preTaxContributions, earnedIncome);

    // AGI-side non-SS income. IRS Pub 915 "combined income" starts from AGI, and
    // pre-tax deferrals are excluded from AGI — they are NOT added back for SS
    // taxation. (A prior comment here claimed the opposite, which overstated
    // taxable SS for anyone collecting SS while still contributing pre-tax.)
    const nonSSIncomeAfterDeduction = nonSSIncome - preTaxDeduction;

    // Taxable portion of Social Security benefits, on the deduction-adjusted base.
    const taxableSS = calculateSocialSecurityTaxableAmount(
      totalSocialSecurity,
      nonSSIncomeAfterDeduction,
      effectiveFilingStatus
    );

    // Taxable income after the pre-tax deduction, including taxable SS.
    const totalTaxableIncome_adjusted = nonSSIncomeAfterDeduction + taxableSS;
    
    // ── HALF-YEAR CONVENTION: PRE-WITHDRAWAL GROWTH ────────────────────────────
    // In reality, withdrawals happen throughout the year (mid-year on average),
    // not at year-end. Apply half the annual growth BEFORE withdrawals and the
    // other half AFTER. The product (1+cagr)^0.5 * (1+cagr)^0.5 = (1+cagr) keeps
    // total annual growth unchanged, but properly credits interim growth to
    // funds that were withdrawn mid-year (rather than crediting nothing).
    // Note: RMDs were already computed on post-contribution balances above
    // (consistent with prior behavior — IRS technically uses prior year-end).
    // Per-year market-return override (Monte Carlo / historical sequence). When
    // set, ALL accounts grow at the same marketReturn for this year — matching
    // the prior worker MC's behavior of a single market shock per sim-year.
    const yrOverride = (yearOverrides && yearOverrides[yearsFromNow]) || null;
    accts.forEach(account => {
      // Clamp at -1: a return below -100% is impossible for a long-only position
      // and would make Math.pow(1+r, 0.5) NaN, which then silently counts as a
      // surviving portfolio in the Monte Carlo success tally.
      const growthRate = Math.max(-1, yrOverride ? yrOverride.marketReturn : (account.cagr || 0));
      const halfGrowth = Math.pow(1 + growthRate, 0.5);
      accountBalances[account.id] = Math.max(0, accountBalances[account.id]) * halfGrowth;
    });
    const poolGrowthRate = Math.max(-1, yrOverride ? yrOverride.marketReturn : reinvestmentGrowthRate);
    excessReinvestmentPool *= Math.pow(1 + poolGrowthRate, 0.5);

    // Calculate totals AFTER pre-withdrawal half-growth (used by withdrawal solver below)
    let totalPreTaxBalance = 0, totalRothBalance = 0, totalBrokerageBalance = 0;
    accts.forEach(account => {
      if (isPreTaxAccount(account.type)) {
        totalPreTaxBalance += accountBalances[account.id];
      } else if (isRothAccount(account.type)) {
        totalRothBalance += accountBalances[account.id];
      } else {
        totalBrokerageBalance += accountBalances[account.id];
      }
    });
    
    // ── TAXABLE-ACCOUNT DIVIDENDS ──────────────────────────────────────────────
    // A taxable brokerage account distributes dividends and interest every year,
    // and they are taxed in that year whether or not you sell anything. The
    // engine previously ignored this: account CAGRs are TOTAL returns (dividends
    // included), so the whole yield compounded untaxed, as if a taxable account
    // were an IRA. That understated lifetime tax and biased withdrawal-order
    // comparisons toward draining tax-sheltered accounts first.
    //
    // Modeled as qualified dividends — preferential 0/15/20% rates, like realized
    // gains — which fits a typical broad index portfolio. A holder of bond funds,
    // REITs or high-turnover funds would owe ORDINARY rates on much of it and is
    // better off raising the yield to compensate. Balances are not reduced: the
    // dividend is already inside the CAGR (i.e. reinvested); what this adds is
    // the tax on it, which the withdrawal solver then funds.
    const dividendYield = pi.brokerageDividendYield ?? 0.02;
    const brokerageDividends = Math.max(0, totalBrokerageBalance * dividendYield);

    const totalGuaranteedIncome = totalSocialSecurity + totalPension + totalOtherIncome;
    // What the solver ASKS the portfolio for. The amount actually withdrawn is
    // computed in Steps 1-2 below and can be less when balances run out — see
    // `portfolioWithdrawal` / `unfundedShortfall`.
    let requestedWithdrawal = 0;
    let portfolioWithdrawal = 0;
    let federalTax = 0;
    let stateTax = 0;
    let actualWithdrawalNeeded = 0; // Track withdrawal needed for spending (excluding forced RMDs)
    // Initialize here so they're always in scope for the data push at end of loop,
    // regardless of whether we enter the isRetired block this year.
    let qcdAmount = 0;
    const charitablePercent = pi.charitableGivingPercent || 0;
    let finalTotalTaxableIncome = totalTaxableIncome_adjusted; // Updated inside isRetired block with actual withdrawal income
    let finalTaxableSS_out = taxableSS; // Updated inside isRetired block when withdrawals change SS taxation
    
    // isRetired is computed above the contributions loop (see there).
    
    // Adjust desired income for one-time events:
    // - Expenses increase what we need to withdraw
    // - Non-taxable income (inheritance, gift) directly reduces withdrawal need
    // - Taxable one-time income already added to nonSSIncome above
    
    // ── HEALTHCARE EXPENSES (unified model) ─────────────────────────────────────
    const healthcareResult = calculateHealthcareExpenses(pi, myAge, spouseAge, yearsFromNow, primaryAlive, spouseAlive);
    const healthcareExpense = healthcareResult.total;

    // Qualified medical expenses an HSA may reimburse tax-free this year.
    //
    // Two sources, because neither alone is right. The modelled healthcare cost
    // is real QME, but it is zero for a plan whose healthcare sits inside its
    // spending target — and telling those households their HSA is suddenly all
    // taxable would be both alarming and wrong. So pi.hsaQualifiedExpenses lets
    // a plan state its medical spending directly, in today's dollars, indexed at
    // the medical rate rather than general inflation.
    //
    // Dental, vision, hearing, and long-term care premiums are qualified and are
    // typically NOT in the modelled figure, which is another reason the manual
    // input exists.
    const medInflation = pi.medicalInflation ?? MEDICAL_INFLATION_RATE;
    const hsaQualifiedBudget = healthcareExpense
      + (pi.hsaQualifiedExpenses || 0) * Math.pow(1 + medInflation, yearsFromNow);

    // ── ACA MARKETPLACE PREMIUM (MAGI-driven, pre-65 retired persons) ───────────
    // When pi.pre65Coverage === 'aca', retired under-65 household members buy
    // marketplace coverage: net premium = benchmark − premium tax credit, and the
    // credit depends on MAGI — which depends on withdrawals. Mirrors the IRMAA
    // pattern: estimate here from pre-withdrawal income, correct per solver
    // iteration, and settle from final MAGI after withdrawals are known.
    // ACA MAGI = AGI + tax-exempt interest (not modeled) + UNTAXED Social Security.
    const acaPersons = healthcareResult.acaPersons || 0;
    const acaMedInflationFactor = Math.pow(1 + (pi.medicalInflation || MEDICAL_INFLATION_RATE), yearsFromNow);
    const acaGrossPremium = acaPersons > 0
      ? acaPersons * (pi.acaBenchmarkPremium || ACA_BENCHMARK_PREMIUM_2026) * acaMedInflationFactor
      : 0;
    // FPL household = the tax household (both spouses when MFJ and both alive),
    // even if one of them is already on Medicare.
    const acaHouseholdSize = (effectiveFilingStatus === 'married_joint' && primaryAlive && spouseAlive) ? 2 : 1;
    const acaCredit = (acaMagi) => calculateACAPremiumCredit({
      magi: acaMagi, householdSize: acaHouseholdSize,
      benchmarkPremium: acaGrossPremium, yearsFromNow: taxIndexYears, inflationRate: pi.inflationRate,
    });
    // AGI ≈ totalTaxableIncome_adjusted (net non-SS income + taxable SS).
    const baseACAMagi = totalTaxableIncome_adjusted + (totalSocialSecurity - taxableSS);
    const estACANetPremium = acaGrossPremium > 0 ? acaCredit(baseACAMagi).netPremium : 0;
    
    // recurringResult / totalRecurringExpenses are computed above (see there).
    
    // Adjusted desired income includes: base retirement spending + one-time expenses
    // + healthcare + recurring expense items + estimated ACA net premium (the
    // solver books MAGI-driven premium movement as a delta, like IRMAA)
    const adjustedDesiredIncome = desiredIncome + oneTimeExpenseTotal + healthcareExpense + totalRecurringExpenses + estACANetPremium;
    
    // Pre-tax floor, needed by BOTH the solver's composition estimate and the
    // execution loop below. They have to agree: if the estimate ignores the floor
    // it predicts a large taxable pre-tax draw, grosses the withdrawal up for tax
    // that execution never incurs (it takes tax-free Roth instead), and the plan
    // over-withdraws by the difference every year.
    const preTaxFloorToday = pi.rothConversionPreTaxFloor || 0;
    const preTaxFloorAdj = preTaxFloorToday > 0 ? preTaxFloorToday * inflationFactor : 0;

    // Retired: the portfolio funds the whole spending target. Not retired but with
    // a dated expense left unfunded after pausing contributions: the portfolio
    // funds that remainder, and nothing else. Both go through one solver so the
    // gross-up for tax, capital gains, NIIT and the early-withdrawal penalty is
    // identical in each case.
    if (isRetired || preRetirementDrawNeed > 0) {
      // Calculate taxes on guaranteed income + any earned income first
      const baseGrossIncome = totalTaxableIncome_adjusted; // Adjusted for pre-tax contributions
      const baseFederalTax = calculateFederalTax(baseGrossIncome, effectiveFilingStatus, taxIndexYears, pi.inflationRate, fedOpts(baseGrossIncome + preTaxDeduction));
      // For state tax, pension is retirement income exempt in some states (e.g., Alabama)
      const baseRetirementIncome = totalPension;
      const baseStateTax = calculateStateTax(baseGrossIncome, pi.state, effectiveFilingStatus, taxIndexYears, pi.inflationRate, taxableSS, baseRetirementIncome, { federalTaxPaid: baseFederalTax, primaryAge: myAge, spouseAge: spouseAge });
      
      // Net income from guaranteed sources + earned income + non-taxable one-time income
      const netCurrentIncome = totalGuaranteedIncome + earnedIncome + oneTimeNontaxableIncome - baseFederalTax - baseStateTax - totalFICA;
      
      // Estimate IRMAA surcharge (Medicare premium increases for high earners)
      // This is an out-of-pocket cost that must be covered by withdrawals
      // Use base MAGI as starting estimate; actual IRMAA recalculated after final MAGI known
      let estimatedIRMAA = 0;
      const estMedicareEligible = age65Count; // same predicate as the 65+ deductions
      if (estMedicareEligible > 0) {
        // With lookback history the surcharge is exact (fixed by year t−2 MAGI);
        // only the first two projection years fall back to a current-year estimate.
        const baseMAGI = irmaaLookbackMAGI !== null ? irmaaLookbackMAGI : baseGrossIncome;
        estimatedIRMAA = calculateIRMAASurcharge(baseMAGI, effectiveFilingStatus, taxIndexYears, pi.inflationRate, estMedicareEligible).totalSurcharge;
      }
      
      // How much the portfolio must deliver AFTER tax this year.
      //  - retired: the whole spending target, less what guaranteed income covers
      //  - still working: only the dated expense that pausing contributions could
      //    not absorb. Salary is NOT netted here — it is already spoken for by
      //    ordinary living, which this engine does not model as a line item.
      const afterTaxGap = isRetired
        ? Math.max(0, adjustedDesiredIncome + estimatedIRMAA - netCurrentIncome)
        : preRetirementDrawNeed;
      
      // Calculate QCD parameters for this year (needed for tax estimation)
      // Note: charitablePercent is declared in outer scope for pre-retirement year access
      const charitableGiving = charitablePercent > 0 ? desiredIncome * (charitablePercent / 100) : 0;
      // Use pre-calculated inflation factor for QCD limit
      const adjustedQCDLimit = QCD_ANNUAL_LIMIT * inflationFactor;
      const householdQCDLimit = effectiveFilingStatus === 'married_joint' ? adjustedQCDLimit * 2 : adjustedQCDLimit;
      const canDoQCD = charitablePercent > 0 && myAge >= QCD_START_AGE;

      // ── WITHDRAWAL-COMPOSITION ESTIMATOR ────────────────────────────────────────
      // Used by the solver so the tax gross-up reflects the ACTUAL draw (Roth = tax-free,
      // brokerage = mostly basis), not a fixed guess. Mirrors the real Step-2 sequencing.
      const solverPriority = pi.withdrawalPriority || ['pretax', 'brokerage', 'roth'];
      const solverAccountTypes = (category) => {
        switch (category) {
          case 'pretax': return PRE_TAX_TYPES;
          case 'roth': return ROTH_TYPES;
          case 'brokerage': return [...BROKERAGE_TYPES, ...HSA_TYPES];
          default: return [];
        }
      };
      // Simulate spending `gross` across the priority order on a COPY of current balances.
      // RMDs are removed from pre-tax balances first (they're withdrawn before voluntary draws).
      // Returns { preTax: ordinary pre-tax voluntarily drawn, gains: realized LT capital gains }.
      const estimateDrawComposition = (gross) => {
        let need = Math.max(0, gross - totalRMD); // voluntary draw beyond the mandatory RMD
        let preTax = 0, gains = 0, penalized = 0, hsaNonQual = 0;
        const bal = {};
        accts.forEach(a => {
          bal[a.id] = accountBalances[a.id];
          if (isPreTaxAccount(a.type)) bal[a.id] = Math.max(0, bal[a.id] - (accountRMDs[a.id] || 0));
        });
        // Mirror of the execution loop's floor logic — see the comment there. The
        // two must stay in step or the gross-up is priced off the wrong accounts.
        const simPreTaxTotal = () => accts.reduce((sum, a) =>
          sum + (isPreTaxAccount(a.type) ? Math.max(0, bal[a.id] || 0) : 0), 0);
        const simAllowance = (respectFloor) =>
          respectFloor && preTaxFloorAdj > 0 ? Math.max(0, simPreTaxTotal() - preTaxFloorAdj) : Infinity;
        // Mirror of the executor's HSA limit. Teaching the executor about a cap
        // and not the solver is a mistake this codebase has already made once
        // with the pre-tax floor: the solver priced the gross-up off accounts the
        // executor then refused to touch, and over-withdrew every year as a
        // result. Non-qualified HSA money is ordinary income AND penalised, so a
        // solver that thinks it is tax-free understates the gross-up twice over.
        let simHsaQualified = hsaQualifiedBudget;
        const simHsaAllowance = (respectFloor) =>
          respectFloor ? Math.max(0, simHsaQualified) : Infinity;
        const simAnyHsa = accts.some(a => isHSAAccount(a.type) && (bal[a.id] || 0) > 0);
        let pool = excessReinvestmentPool;
        for (const respectFloor of [true, false]) {
        if (need <= 0) break;
        if (!respectFloor && preTaxFloorAdj <= 0 && !simAnyHsa) break;
        for (const category of solverPriority) {
          if (need <= 0) break;
          const types = solverAccountTypes(category);
          accts.forEach(a => {
            if (types.includes(a.type) && need > 0) {
              const cap = isPreTaxAccount(a.type) ? simAllowance(respectFloor)
                        : isHSAAccount(a.type) ? simHsaAllowance(respectFloor)
                        : Infinity;
              const w = Math.min(bal[a.id], need, cap);
              if (w <= 0) return;
              bal[a.id] -= w; need -= w;
              if (isPreTaxAccount(a.type)) {
                preTax += w;
                // §72(t): the solver must gross up for the penalty, or an early
                // retiree's spending target is silently missed by 10% of the draw.
                penalized += w * penaltyShareFor(a);
              }
              else if (isHSAAccount(a.type)) {
                const qualified = Math.min(w, Math.max(0, simHsaQualified));
                simHsaQualified -= qualified;
                const nonQualified = w - qualified;
                if (nonQualified > 0) {
                  preTax += nonQualified;
                  hsaNonQual += nonQualified;
                }
              }
              else if (isBrokerageAccount(a.type)) {
                const basisPct = (a.costBasisPercent !== undefined && a.costBasisPercent !== null) ? a.costBasisPercent : BROKERAGE_COST_BASIS_ESTIMATE;
                gains += w * (1 - basisPct);
              }
              // roth: tax-free, contributes nothing to taxable income
            }
          });
          if (category === 'brokerage' && need > 0 && pool > 0) {
            const pw = Math.min(pool, need); pool -= pw; need -= pw;
            gains += pw * 0.20; // reinvestment pool is basis-heavy (≈80% basis)
          }
        }
        } // end floor pass
        return { preTax, gains, penalized, hsaNonQual };
      };

      // Iteratively calculate the right withdrawal to hit desired net income
      // This properly accts for actual marginal tax rates, QCD benefits,
      // and the circular dependency where withdrawals affect SS taxation
      let withdrawalNeeded = 0;
      if (afterTaxGap > 0) {
        let testWithdrawal = afterTaxGap; // Start with the gap
        
        for (let i = 0; i < MAX_ITERATIONS_FOR_TAX_CALC; i++) { // Iterate to converge
          // Estimate the ACTUAL draw composition for this test withdrawal by simulating the
          // withdrawal priority against current balances (see estimateDrawComposition above).
          // This replaces the old fixed guess (100% pre-tax if pre-tax-first, else 70%), which
          // grossed the withdrawal up for phantom tax on Roth-first / brokerage-first strategies.
          const draw = estimateDrawComposition(testWithdrawal);
          const totalPreTaxFromWithdrawals = totalRMD + draw.preTax; // ordinary income: RMD + voluntary pre-tax
          // Preferential-rate income: realized long-term gains PLUS the year's
          // qualified dividends, which are taxable whether or not anything sold.
          const estimatedGains = draw.gains + brokerageDividends;

          // Calculate QCD if applicable (reduces taxable ordinary income)
          let estimatedQCD = 0;
          if (canDoQCD) {
            estimatedQCD = Math.min(charitableGiving, totalPreTaxFromWithdrawals, householdQCDLimit);
          }

          // Taxable ordinary portion of withdrawals (pre-tax minus QCD)
          const taxableWithdrawals = Math.max(0, totalPreTaxFromWithdrawals - estimatedQCD);

          // SS taxable amount uses "combined income" which INCLUDES capital gains (IRS Pub 915).
          // Base is net of the pre-tax contribution deduction (AGI-side), matching the final calc.
          const adjustedNonSSIncome = nonSSIncomeAfterDeduction + taxableWithdrawals + estimatedGains;
          const adjustedTaxableSS = calculateSocialSecurityTaxableAmount(
            totalSocialSecurity, adjustedNonSSIncome, effectiveFilingStatus
          );
          // Federal ORDINARY tax base EXCLUDES capital gains (taxed at preferential LTCG rates below).
          const ordinaryBaseGross = nonSSIncomeAfterDeduction + taxableWithdrawals + adjustedTaxableSS;
          // MAGI drives both the NIIT threshold and the senior-deduction phaseout,
          // so it is derived before the federal tax that depends on the deduction.
          const iterMAGI = ordinaryBaseGross + estimatedGains + preTaxDeduction;
          const totalFedOrdinary = calculateFederalTax(ordinaryBaseGross, effectiveFilingStatus, taxIndexYears, pi.inflationRate, fedOpts(iterMAGI));
          // LTCG tax on realized gains, stacked above ordinary taxable income.
          // The 65+ deductions lower ordinary taxable income, so gains stack lower too.
          const iterAdjDeduction = getFederalDeduction(effectiveFilingStatus, taxIndexYears, pi.inflationRate, fedOpts(iterMAGI));
          const estCapGainsTax = calculateCapitalGainsTax(
            estimatedGains, Math.max(0, ordinaryBaseGross - iterAdjDeduction) + estimatedGains,
            effectiveFilingStatus, taxIndexYears, pi.inflationRate
          );
          // NIIT (3.8%) — kicks in when MAGI crosses the filing-status threshold.
          // Mirrors the final-block calc at the bottom of the year loop so the solver
          // pre-funds the surtax instead of having it eat into realized net income.
          const iterInvestmentIncome = estimatedGains; // gains + dividends, already combined above
          const iterNIIT = calculateNIIT(iterInvestmentIncome, iterMAGI, effectiveFilingStatus);
          // §72(t) additional tax on the early-distribution slice of this draw,
          // plus §223(f)'s 20% on any HSA money drawn beyond qualified medical
          // expenses before 65. Both are additional taxes the gross-up must fund.
          const iterPenalty = draw.penalized * EARLY_WITHDRAWAL_PENALTY_RATE
            + (myAge < HSA_PENALTY_END_AGE ? (draw.hsaNonQual || 0) * HSA_NONQUALIFIED_PENALTY_RATE : 0);
          const totalFedTax = totalFedOrdinary + estCapGainsTax + iterNIIT + iterPenalty;
          // Retirement income for state exemption: pension only (401k/IRA withdrawals are NOT exempt).
          // State taxes capital gains as ordinary income → use the gains-inclusive base.
          const iterRetirementIncome = totalPension;
          const totalStateTax = calculateStateTax(adjustedNonSSIncome + adjustedTaxableSS, pi.state, effectiveFilingStatus, taxIndexYears, pi.inflationRate, adjustedTaxableSS, iterRetirementIncome, { federalTaxPaid: totalFedOrdinary, primaryAge: myAge, spouseAge: spouseAge });

          // Tax attributable to the withdrawal = total tax minus tax on guaranteed income alone.
          const withdrawalFedTax = totalFedTax - baseFederalTax;
          const withdrawalStateTax = totalStateTax - baseStateTax;
          const withdrawalTax = withdrawalFedTax + withdrawalStateTax;

          // IRMAA cliff correction — only relevant in the first two projection
          // years (no lookback history): there the surcharge tracks current MAGI,
          // so withdrawals can push it up. Under lookback the surcharge is fixed
          // by year t−2 income and this year's withdrawals cannot move it.
          const iterIRMAA = (estMedicareEligible > 0 && irmaaLookbackMAGI === null)
            ? calculateIRMAASurcharge(iterMAGI, effectiveFilingStatus, taxIndexYears, pi.inflationRate, estMedicareEligible).totalSurcharge
            : estimatedIRMAA;
          const iterIRMAADelta = iterIRMAA - estimatedIRMAA;

          // ACA premium correction — withdrawals move MAGI, which moves the
          // premium tax credit. Book only the delta vs. the pre-loop estimate
          // (estACANetPremium is already inside adjustedDesiredIncome), exactly
          // like the IRMAA correction above. ACA MAGI adds UNTAXED SS to AGI.
          let iterACADelta = 0;
          if (acaGrossPremium > 0) {
            const iterACAMagi = ordinaryBaseGross + estimatedGains + (totalSocialSecurity - adjustedTaxableSS);
            iterACADelta = acaCredit(iterACAMagi).netPremium - estACANetPremium;
          }

          // Net income from this withdrawal (after taxes, IRMAA tier crossings,
          // and ACA subsidy movement)
          const netFromWithdrawal = testWithdrawal - withdrawalTax - iterIRMAADelta - iterACADelta;
          
          // How far off are we?
          const shortfall = afterTaxGap - netFromWithdrawal;
          
          // Adjust withdrawal
          if (Math.abs(shortfall) < 10) break; // Close enough
          testWithdrawal += shortfall;
          testWithdrawal = Math.max(0, testWithdrawal); // Don't go negative
        }
        
        withdrawalNeeded = testWithdrawal;
        requestedWithdrawal = Math.max(totalRMD, withdrawalNeeded);
      } else {
        withdrawalNeeded = 0;
        requestedWithdrawal = totalRMD;
      }

      // Store actual withdrawal needed for excess RMD calculation
      actualWithdrawalNeeded = withdrawalNeeded;
    } else {
      // Still pre-retirement AND no dated expense needing a draw — take any RMD
      // that applies and nothing more. (Someone still working past 73/75 can owe
      // an RMD; the branch above handles the dated-expense case.)
      requestedWithdrawal = totalRMD;
      actualWithdrawalNeeded = 0;
      // Taxes will be calculated after actual withdrawals are made
    }

    // Now actually withdraw from accts
    // Step 1: Withdraw RMDs from pre-tax accts (mandatory - regardless of priority)
    // A balance can fall short of its own RMD only after a catastrophic negative
    // return (the RMD was computed on the pre-growth balance), but when it does,
    // only what's there comes out — so totalRMD is re-stated to the amount actually
    // distributed. Everything downstream (taxable ordinary income, QCD eligibility,
    // the bracket-fill base, the reported `rmd` field) then reflects reality.
    let rmdWithdrawn = 0;
    accts.forEach(account => {
      if (isPreTaxAccount(account.type)) {
        const rmd = accountRMDs[account.id] || 0;
        if (rmd > 0) {
          const drawn = Math.min(Math.max(0, accountBalances[account.id]), rmd);
          accountBalances[account.id] -= drawn;
          rmdWithdrawn += drawn;
        }
      }
    });
    totalRMD = rmdWithdrawn;

    // Excess RMD is the RMD amount that exceeds what we actually need for spending.
    // Pre-retirement, ALL of the RMD is "excess" since we don't need it for spending.
    // Computed from the DISTRIBUTED figure above, so a short RMD can't reinvest
    // dollars that never left the account.
    let excessRMD = Math.max(0, totalRMD - actualWithdrawalNeeded);

    // Step 2: If RETIRED and we need more than RMD, withdraw based on user's priority
    // Pre-retirement, we do NOT withdraw extra even if income < desired spending
    // Pre-retirement this is 0 unless a dated expense went unfunded by pausing
    // contributions — in which case the solver above sized a real draw for it.
    const additionalRequested = Math.max(0, actualWithdrawalNeeded - totalRMD);
    let additionalNeeded = additionalRequested;

    // Get withdrawal priority (default: pretax, brokerage, roth)
    const priority = pi.withdrawalPriority || ['pretax', 'brokerage', 'roth'];
    
    // Helper to get account types for each category (using constants)
    // HSA is withdrawn in the 'brokerage' priority slot but tracked separately for tax
    const getAccountTypes = (category) => {
      switch(category) {
        case 'pretax': return PRE_TAX_TYPES;
        case 'roth': return ROTH_TYPES;
        case 'brokerage': return [...BROKERAGE_TYPES, ...HSA_TYPES];
        default: return [];
      }
    };
    
    // Withdraw in priority order
    // Track withdrawals by type for proper tax treatment. All four are reported
    // on the row so a year's draw can be decomposed by tax treatment; only
    // preTaxWithdrawals feeds the tax calculation itself.
    let preTaxWithdrawals = 0;
    let brokerageWithdrawals = 0;
    let rothWithdrawals = 0;
    // Qualified HSA draws are tax-free like a Roth draw, but they are NOT Roth
    // money — reimbursing medical costs and spending Roth principal are different
    // decisions with different balances behind them. Kept separate so a reader of
    // the row can tell them apart.
    let hsaQualifiedWithdrawals = 0;
    // Pre-tax dollars distributed before 59½ without an exception (§72(t) base).
    // RMDs can never be early (they start at 73/75), so only voluntary draws and
    // the conversion-tax draw contribute. Converting to Roth is NOT a
    // distribution and is not penalized — but pre-tax dollars pulled out to PAY
    // the conversion's tax bill are, and are booked below.
    let penalizedWithdrawals = 0;
    // Per-account cost-basis tracking: each brokerage account can have its own
    // costBasisPercent (e.g. 0.30 for an old account with deep gains, 0.95 for a new one).
    // We accumulate the actual capital gains and basis recovered to use them in tax calc.
    // Seeded with this year's qualified dividends: from here down, this variable
    // is "income taxed at preferential rates", i.e. realized gains + dividends.
    // Every downstream use (Pub 915 combined income, removal from the ordinary
    // federal base, LTCG stacking, the state gains-inclusive base, NIIT) applies
    // to dividends identically.
    // Gain on an asset sold this year above the §121 exclusion is long-term
    // capital gain, and joins the same bucket so it picks up every downstream
    // consequence without special-casing: LTCG stacking on ordinary income, the
    // Pub 915 combined-income base for Social Security, state taxation as
    // ordinary income, NIIT, and MAGI — which is what makes a large downsize
    // gain reach forward two years into IRMAA.
    let brokerageCapitalGains = brokerageDividends + assetSaleTaxableGain;
    let brokerageBasisRecovered = 0;
    // HSA withdrawals for qualified medical expenses are tax-free (not tracked for tax)
    
    // ── PRESERVE PRE-TAX FLOOR ────────────────────────────────────────────────
    // pi.rothConversionPreTaxFloor is labelled "Preserve Pre-Tax Floor" and the
    // app SUGGESTS a value sized from lifetime QCD giving plus low-bracket room.
    // It used to constrain conversions only, so with a pretax-first withdrawal
    // order spending drained straight through it — the balance the user asked to
    // preserve hit zero and QCDs (which need a live IRA at 70+) stopped working
    // for the rest of the plan. The floor now also holds back spending draws.
    //
    // It is deliberately SOFT: honoured while other categories can still fund the
    // year, abandoned when they cannot. A hard floor would invent an unfunded
    // shortfall for a household that actually has the money, just in the wrong
    // bucket. RMDs are never held back — they are mandatory regardless.
    const totalPreTaxNow = () => accts.reduce((sum, a) =>
      sum + (isPreTaxAccount(a.type) ? (accountBalances[a.id] || 0) : 0), 0);
    // How much pre-tax may still be drawn this pass before touching the floor.
    const preTaxDrawAllowance = (respectFloor) =>
      respectFloor && preTaxFloorAdj > 0 ? Math.max(0, totalPreTaxNow() - preTaxFloorAdj) : Infinity;

    // How much tax-free HSA room is left this year. Drawn down as the HSA is
    // tapped; once exhausted, further HSA withdrawals are ordinary income.
    let hsaQualifiedRemaining = hsaQualifiedBudget;
    let hsaNonQualifiedWithdrawals = 0;
    const hsaDrawAllowance = (respectFloor) =>
      respectFloor ? Math.max(0, hsaQualifiedRemaining) : Infinity;
    const anyHsaBalance = accts.some(a => isHSAAccount(a.type) && (accountBalances[a.id] || 0) > 0);

    // Pass 1 honours the floor and the HSA's qualified-expense limit; pass 2 only
    // runs if pass 1 left the year short. Deferring non-qualified HSA money to
    // the second pass is what a real household does — you do not volunteer a 20%
    // penalty while a taxable account still has money in it — and it keeps the
    // HSA intact for the medical costs it exists to cover.
    for (const respectFloor of [true, false]) {
      if (additionalNeeded <= 0) break;
      if (!respectFloor && preTaxFloorAdj <= 0 && !anyHsaBalance) break; // nothing held back -> nothing to retry
    for (const category of priority) {
      if (additionalNeeded <= 0) break;
      const categoryAccountTypes = getAccountTypes(category);
      accts.forEach(account => {
        if (categoryAccountTypes.includes(account.type) && additionalNeeded > 0) {
          const cap = isPreTaxAccount(account.type) ? preTaxDrawAllowance(respectFloor)
                    : isHSAAccount(account.type) ? hsaDrawAllowance(respectFloor)
                    : Infinity;
          const withdrawal = Math.min(accountBalances[account.id], additionalNeeded, cap);
          if (withdrawal <= 0) return;
          accountBalances[account.id] -= withdrawal;
          additionalNeeded -= withdrawal;
          
          // Track withdrawal by type for tax purposes
          // HSA withdrawals for qualified medical expenses are tax-free
          if (isPreTaxAccount(account.type)) {
            preTaxWithdrawals += withdrawal;
            penalizedWithdrawals += withdrawal * penaltyShareFor(account);
          } else if (isBrokerageAccount(account.type)) {
            brokerageWithdrawals += withdrawal;
            // Apply this account's specific cost basis (default 0.50 if not set)
            const basisPct = (account.costBasisPercent !== undefined && account.costBasisPercent !== null)
              ? account.costBasisPercent
              : BROKERAGE_COST_BASIS_ESTIMATE;
            brokerageBasisRecovered += withdrawal * basisPct;
            brokerageCapitalGains += withdrawal * (1 - basisPct);
          } else if (isHSAAccount(account.type)) {
            // Split the draw at the qualified-expense line. The qualified part is
            // tax-free like a Roth; the rest is ordinary income, and carries a
            // 20% additional tax before 65.
            const qualified = Math.min(withdrawal, Math.max(0, hsaQualifiedRemaining));
            const nonQualified = withdrawal - qualified;
            hsaQualifiedRemaining -= qualified;
            hsaQualifiedWithdrawals += qualified;
            if (nonQualified > 0) {
              hsaNonQualifiedWithdrawals += nonQualified;
              preTaxWithdrawals += nonQualified; // ordinary income, same as an IRA draw
            }
          } else if (isRothAccount(account.type)) {
            rothWithdrawals += withdrawal;
          }
        }
      });
      // Also draw from reinvestment pool when brokerage category is being accessed
      // The reinvestment pool is "fresh" money (after-tax RMDs reinvested), so basis = 100%
      // until it grows. We approximate by treating it as basis-heavy (only growth is taxable).
      if (category === 'brokerage' && additionalNeeded > 0 && excessReinvestmentPool > 0) {
        const poolWithdrawal = Math.min(excessReinvestmentPool, additionalNeeded);
        excessReinvestmentPool -= poolWithdrawal;
        additionalNeeded -= poolWithdrawal;
        brokerageWithdrawals += poolWithdrawal;
        // Pool is mostly basis (after-tax dollars); use a conservative 0.80 basis estimate
        brokerageBasisRecovered += poolWithdrawal * 0.80;
        brokerageCapitalGains += poolWithdrawal * 0.20;
      }
    }
    } // end floor pass

    // ── WHAT THE PORTFOLIO ACTUALLY DELIVERED ──────────────────────────────────
    // The solver sizes `requestedWithdrawal` from the spending target alone; it
    // has no view of account balances. Steps 1-2 above draw against real balances
    // and stop when they're empty, leaving the unfunded remainder in
    // `additionalNeeded`. Report the amount actually withdrawn — not the amount
    // asked for — so netIncome, totalIncome, totalTax, the charts, and the
    // guardrail withdrawal rate all describe money that exists. The gap is
    // surfaced as `unfundedShortfall` so the UI can say "this plan runs dry".
    // (Previously portfolioWithdrawal carried the request, and a fully depleted
    // plan kept reporting that it met its spending target every year.)
    portfolioWithdrawal = totalRMD + (additionalRequested - additionalNeeded);
    const unfundedShortfall = Math.max(0, requestedWithdrawal - portfolioWithdrawal);

    // Step 2.5: Calculate ACTUAL taxes based on withdrawal composition
    // Now that we know which accts were tapped, calculate proper taxes
    // Pre-tax withdrawals (including RMDs) are ordinary income
    // Brokerage withdrawals: assume cost basis is tax-free, remainder is long-term capital gains

    // Pre-tax dollars withdrawn FOR SPENDING — captured before the conversion
    // block adds the conversion and its tax draw to preTaxWithdrawals. QCD
    // eligibility below is based on these (charity is paid out of spending money;
    // conversion dollars went to the Roth, not to charity).
    const spendingPreTaxWithdrawals = preTaxWithdrawals;

    // ── ROTH CONVERSION ──────────────────────────────────────────────────────────
    // If the user has configured a planned Roth conversion strategy, execute it now.
    // Conversions move money from the largest pre-tax account to the largest Roth account.
    // The converted amount is treated as ordinary income this year (increases taxable income
    // and can push more SS into the taxable range — all properly reflected in tax calculations below).
    // We skip conversions in years where:
    //   • The user is not yet in the conversion window (age < start or age > end)
    //   • There are no pre-tax funds available to convert
    //   • There is no Roth account to receive the funds
    let rothConversionThisYear = 0;
    let conversionTaxWithdrawal = 0; // Extra portfolio draw executed to pay the conversion's tax bill
    const conversionAmount = pi.rothConversionAmount || 0;
    // Use smart defaults when start/end ages aren't explicitly set.
    // The engine respects any non-zero value the user has configured, but
    // falls back to dynamic defaults (retirement age → year before RMDs)
    // when the values are 0/null/missing.
    const defaultWindow = getDefaultRothConversionWindow(pi);
    const conversionStartAge = pi.rothConversionStartAge && pi.rothConversionStartAge > 0
      ? pi.rothConversionStartAge
      : defaultWindow.startAge;
    const conversionEndAge = pi.rothConversionEndAge && pi.rothConversionEndAge > 0
      ? pi.rothConversionEndAge
      : defaultWindow.endAge;
    const conversionBracket = pi.rothConversionBracket || ''; // e.g. '22%', '24%', '32%'

    if (myAge >= conversionStartAge && myAge <= conversionEndAge) {
      // Determine the target conversion amount for this year
      let targetConversion = 0;

      if (conversionBracket) {
        // ── BRACKET-FILL MODE ────────────────────────────────────────────────
        // Convert up to the top of the chosen bracket. Two things make this a
        // solve rather than a subtraction:
        //
        //  1. Bracket tops are TAXABLE-income figures (post-standard-deduction),
        //     but a conversion adds GROSS income. So the target must be grossed
        //     up by the deduction. The old code computed `currentTaxable` with a
        //     Math.max(0, …) floor, which silently discarded any unused deduction
        //     — under-converting by up to a full standard deduction in exactly
        //     the low-income bridge years this feature exists to exploit.
        //
        //  2. The conversion RAISES the taxable portion of Social Security
        //     (Pub 915 combined income), and that extra taxable SS consumes
        //     bracket room the conversion was about to use. Pricing it from the
        //     PRE-conversion taxable SS (one pass) overshot into the next
        //     bracket by roughly the taxable-SS amount for anyone collecting SS.
        //
        // Capital gains are deliberately kept OUT of the ordinary base: they
        // stack ABOVE ordinary income at preferential rates and consume no
        // ordinary bracket space. They do raise Pub 915 combined income, so they
        // stay in the taxable-SS base below.
        // (Not modeled: filling the ordinary bracket can push stacked gains from
        // the 0%/15% LTCG rate into 15%/20%. The bracket label refers to the
        // ordinary bracket, as the UI presents it.)
        const baseBrackets = FEDERAL_TAX_BRACKETS_2026[effectiveFilingStatus] || FEDERAL_TAX_BRACKETS_2026.married_joint;
        // Full federal deduction including the 65+ amounts — every extra dollar of
        // deduction is another dollar of cheap conversion headroom. The senior
        // deduction's own phaseout depends on the conversion, so it is evaluated
        // inside the solve below rather than fixed here.
        const deductionAt = (magiForPhaseout) =>
          getFederalDeduction(effectiveFilingStatus, taxIndexYears, pi.inflationRate, fedOpts(magiForPhaseout));

        // Ordinary income already recognized this year, EXCLUDING SS and the
        // conversion itself. RMDs are ordinary income but tracked in totalRMD
        // separately from preTaxWithdrawals (which holds only the additional
        // voluntary pre-tax withdrawals beyond the RMD).
        // A QCD is excluded from income entirely, so pre-tax dollars destined for
        // charity are NOT part of the base the bracket has to accommodate.
        // Counting them made the fill under-convert by exactly the QCD every year
        // from 70 onward — surrendering cheap bracket room in precisely the years
        // a charitable retiree has the most of it. Mirrors the QCD calculation
        // further down; both are capped by pre-tax income actually withdrawn for
        // spending, since conversion dollars and the conversion-tax draw go to the
        // Roth and the IRS rather than to charity.
        const anticipatedQCD = (charitablePercent > 0 && isRetired && myAge >= QCD_START_AGE)
          ? Math.min(
              desiredIncome * (charitablePercent / 100),
              totalRMD + spendingPreTaxWithdrawals,
              (effectiveFilingStatus === 'married_joint' ? 2 : 1) * QCD_ANNUAL_LIMIT * inflationFactor)
          : 0;
        const ordinaryBeforeConversion = Math.max(0,
          nonSSIncomeAfterDeduction + totalRMD + preTaxWithdrawals - anticipatedQCD);

        const bracketIdx = RATE_TO_BRACKET_IDX[conversionBracket];
        if (bracketIdx === undefined) {
          // Unrecognized bracket label — skip this year rather than silently
          // mis-bracketing into the prior 22% fallback.
          targetConversion = 0;
        } else {
          const bracketCap = baseBrackets[bracketIdx].max * inflationFactor;
          // Taxable income produced by converting X: the conversion plus the
          // extra taxable SS it drags in, less the deduction that X's own MAGI
          // supports. Capital gains are in the Pub 915 combined-income base (they
          // raise taxable SS) but not in the result (they stack above ordinary
          // income at preferential rates).
          const taxableAt = (X) => {
            const nonSS = ordinaryBeforeConversion + X + brokerageCapitalGains;
            const ssT = calculateSocialSecurityTaxableAmount(totalSocialSecurity, nonSS, effectiveFilingStatus);
            return ordinaryBeforeConversion + X + ssT - deductionAt(nonSS + ssT + preTaxDeduction);
          };
          // taxableAt is continuous and strictly increasing in X: each converted
          // dollar adds itself, up to $0.85 of newly taxable SS, and (inside the
          // senior-deduction phaseout band) up to $0.06 per person of lost
          // deduction. So the bracket top is found by bisection. A fixed-point
          // iteration alternates across the SS tier boundaries and converges too
          // slowly to land on the cent.
          // Upper bound: the answer with no taxable SS and the largest deduction
          // (both of which only move against the conversion as X grows).
          const hiBound = Math.max(0, bracketCap
            + deductionAt(ordinaryBeforeConversion + brokerageCapitalGains + preTaxDeduction)
            - ordinaryBeforeConversion);

          // ── THE CONVERSION'S OWN TAX BILL EATS BRACKET ROOM ─────────────────
          // Filling to the top of a bracket and then withdrawing MORE pre-tax to
          // pay the resulting tax pushes the year straight past that top — the
          // tax draw is ordinary income too. The overshoot equalled the tax draw
          // to the dollar: on a real plan, ~$14-19k/yr spilling from 22% into 24%
          // in exactly the years the feature exists to keep cheap.
          //
          // Only pre-tax draws do this. With rothConversionTaxSource ===
          // 'brokerage' the bill is met from a taxable account, whose gains are
          // preferential and consume no ordinary bracket space at all.
          // Only the PRE-TAX share of that draw is ordinary income. A draw funded
          // from a taxable account realizes preferential gains, which stack above
          // ordinary income and consume no ordinary bracket room; a Roth draw is
          // tax-free. So the correction has to follow the withdrawal order rather
          // than assume the worst — a brokerage-first plan needs no correction at
          // all, and applying one anyway would under-convert it.
          const preTaxShareOfDraw = (amount, convertedAlready) => {
            if (!(amount > 0)) return 0;
            let need = amount, ordinary = 0;
            const bal = {};
            accts.forEach(a => { bal[a.id] = accountBalances[a.id] || 0; });
            // The conversion itself comes out of pre-tax first, so it is not
            // available to fund the tax bill.
            let toRemove = convertedAlready || 0;
            for (const a of accts) {
              if (toRemove <= 0) break;
              if (!isPreTaxAccount(a.type)) continue;
              const cut = Math.min(bal[a.id], toRemove);
              bal[a.id] -= cut; toRemove -= cut;
            }
            for (const category of priority) {
              if (need <= 0) break;
              const types = getAccountTypes(category);
              for (const a of accts) {
                if (!types.includes(a.type) || need <= 0) continue;
                const w = Math.min(bal[a.id], need);
                if (w <= 0) continue;
                bal[a.id] -= w; need -= w;
                if (isPreTaxAccount(a.type)) ordinary += w;
              }
            }
            return ordinary;
          };
          const taxDrawIsOrdinary = pi.rothConversionTaxSource !== 'brokerage';
          // What the year owes with no conversion — the baseline the incremental
          // bill is measured against, mirroring the execution block below.
          // NOTE: this baseline deliberately does NOT subtract the QCD, because the
          // execution block below prices the real tax bill from the pre-QCD base.
          // Estimating the bill from a lower base than the one actually used puts
          // the same conversion in cheaper brackets and under-funds the draw, which
          // reappears as an overshoot once the true bill is withdrawn. The QCD
          // adjustment belongs in the bracket TARGET (ordinaryBeforeConversion),
          // not in the tax-bill estimate.
          const preConvNonSSForDraw = nonSSIncomeAfterDeduction + totalRMD + preTaxWithdrawals + brokerageCapitalGains;
          const preConvSSForDraw = calculateSocialSecurityTaxableAmount(totalSocialSecurity, preConvNonSSForDraw, effectiveFilingStatus);
          const preConvGrossForDraw = preConvNonSSForDraw + preConvSSForDraw;
          const preConvFedForDraw = calculateFederalTax(preConvGrossForDraw, effectiveFilingStatus, taxIndexYears, pi.inflationRate, fedOpts(preConvGrossForDraw + preTaxDeduction));
          const preConvStateForDraw = calculateStateTax(preConvGrossForDraw, pi.state, effectiveFilingStatus, taxIndexYears, pi.inflationRate, preConvSSForDraw, totalPension, { federalTaxPaid: preConvFedForDraw, primaryAge: myAge, spouseAge: spouseAge });
          // IRMAA moves with the conversion only in the first two projection years,
          // where there is no 2-year MAGI history to look back on. Omitting it made
          // the estimated bill too small by the surcharge, and the shortfall came
          // back as an overshoot when the real bill was withdrawn.
          const convMedicareEligibleForDraw = irmaaLookbackMAGI !== null ? 0 :
            (primaryAlive && myAge >= 65 ? 1 : 0) +
            (effectiveFilingStatus === 'married_joint' && spouseAlive && spouseAge >= 65 ? 1 : 0);
          const irmaaAt = (gross) => convMedicareEligibleForDraw > 0
            ? calculateIRMAASurcharge(gross + preTaxDeduction, effectiveFilingStatus, taxIndexYears, pi.inflationRate, convMedicareEligibleForDraw).totalSurcharge
            : 0;
          const preConvIRMAAForDraw = irmaaAt(preConvGrossForDraw);
          // Extra ordinary income created by paying the tax on a conversion of X.
          // Self-referential (a bigger draw is itself taxed), so iterate to a
          // fixed point — the same shape as the execution block's loop.
          const taxDrawOrdinaryAt = (X) => {
            if (!taxDrawIsOrdinary || X <= 0) return 0;
            let bill = 0, ordinaryFromDraw = 0;
            for (let i = 0; i < 6; i++) {
              const nonSS = preConvNonSSForDraw + X + ordinaryFromDraw;
              const ssT = calculateSocialSecurityTaxableAmount(totalSocialSecurity, nonSS, effectiveFilingStatus);
              const gross = nonSS + ssT;
              const fed = calculateFederalTax(gross, effectiveFilingStatus, taxIndexYears, pi.inflationRate, fedOpts(gross + preTaxDeduction));
              const st = calculateStateTax(gross, pi.state, effectiveFilingStatus, taxIndexYears, pi.inflationRate, ssT, totalPension, { federalTaxPaid: fed, primaryAge: myAge, spouseAge: spouseAge });
              const nextBill = Math.max(0, (fed - preConvFedForDraw) + (st - preConvStateForDraw)
                + (irmaaAt(gross) - preConvIRMAAForDraw));
              const nextOrdinary = preTaxShareOfDraw(nextBill, X);
              const settled = Math.abs(nextBill - bill) < 1;
              bill = nextBill; ordinaryFromDraw = nextOrdinary;
              if (settled) break;
            }
            return ordinaryFromDraw;
          };
          // Total ordinary taxable income the year ends up with if X is converted.
          const taxableWithDrawAt = (X) => taxableAt(X) + taxDrawOrdinaryAt(X);

          if (hiBound <= 0 || taxableWithDrawAt(0) >= bracketCap) {
            targetConversion = 0; // already at or past the top of the bracket
          } else if (taxableWithDrawAt(hiBound) <= bracketCap) {
            targetConversion = hiBound; // no SS in play — the bound is the answer
          } else {
            let lo = 0, hi = hiBound;
            // Halve to sub-cent precision (typically ~30 steps; the 60-step bound
            // covers any conceivable range and keeps the loop provably finite).
            // taxableWithDrawAt is still strictly increasing in X: both terms are.
            for (let i = 0; i < 60 && hi - lo > 0.005; i++) {
              const mid = (lo + hi) / 2;
              if (taxableWithDrawAt(mid) > bracketCap) hi = mid; else lo = mid;
            }
            targetConversion = lo; // the side that never crosses the bracket top
          }
        }
      } else if (conversionAmount > 0) {
        // Fixed-amount mode. By default the entered amount is in TODAY's dollars
        // and is inflation-indexed each year, so it keeps filling the same REAL
        // bracket space as the brackets themselves inflate. With
        // rothConversionInflationAdjust === false, the same nominal amount is
        // converted every year instead.
        targetConversion = pi.rothConversionInflationAdjust === false
          ? conversionAmount
          : conversionAmount * inflationFactor;
      }

      // Pre-tax floor: stop converting once total pre-tax would drop below the
      // user's preserved balance (entered in today's dollars, inflation-adjusted
      // here). Lets the user keep pre-tax funds for QCDs (need an IRA balance at
      // 70+) and for filling the low (0–12%) brackets each year, instead of
      // converting everything away. 0 = no floor (unchanged behavior).
      const floorToday = pi.rothConversionPreTaxFloor || 0;
      if (floorToday > 0 && targetConversion > 0) {
        const floorAdj = floorToday * inflationFactor;
        const totalPreTax = accts.filter(a => isPreTaxAccount(a.type))
          .reduce((s, a) => s + (accountBalances[a.id] || 0), 0);
        targetConversion = Math.min(targetConversion, Math.max(0, totalPreTax - floorAdj));
      }

      if (targetConversion > 0) {
        // Find the largest pre-tax account with available balance (source)
        const preTaxAccounts = accts.filter(a => isPreTaxAccount(a.type));
        const sourceAccount = preTaxAccounts.length > 0
          ? preTaxAccounts.reduce((best, a) =>
              (accountBalances[a.id] || 0) > (accountBalances[best.id] || 0) ? a : best,
              preTaxAccounts[0])
          : null;

        // Find the largest Roth account to receive the conversion (destination)
        const rothAccounts = accts.filter(a => isRothAccount(a.type));
        const destAccount = rothAccounts.length > 0
          ? rothAccounts.reduce((best, a) =>
              (accountBalances[a.id] || 0) > (accountBalances[best.id] || 0) ? a : best,
              rothAccounts[0])
          : null;

        if (sourceAccount && destAccount && (accountBalances[sourceAccount.id] || 0) > 0) {
          // Limit the conversion to what's actually available in the source account
          rothConversionThisYear = Math.min(targetConversion, accountBalances[sourceAccount.id]);
          // Move the money: reduce pre-tax, increase Roth
          accountBalances[sourceAccount.id] -= rothConversionThisYear;
          accountBalances[destAccount.id] = (accountBalances[destAccount.id] || 0) + rothConversionThisYear;
          // The converted amount is ordinary income — add to pre-tax withdrawals for tax calculation
          preTaxWithdrawals += rothConversionThisYear;
          
          // Conversion creates an incremental tax bill on top of the spending
          // withdrawals the solver already sized. The cash for that bill has to
          // come from somewhere — either the user's chosen brokerage account, or
          // from the normal withdrawal priority. Either way, we account for the
          // tax-side effects (capital gains realized, ordinary income added) so
          // downstream tax calcs see the full picture (B5, B6).
          if (rothConversionThisYear > 0) {
            // Price the conversion's incremental tax on top of the income the year
            // ALREADY has: guaranteed income PLUS the spending withdrawals executed
            // above (RMDs, voluntary pre-tax draws, realized gains) and the taxable
            // SS that base implies. (Previously the delta was measured from the
            // pre-withdrawal base, which priced the conversion in lower brackets
            // and under-collected the tax — the gap silently reduced net income.)
            const spendingPreTax = preTaxWithdrawals - rothConversionThisYear; // conversion itself was added above
            const preConvNonSS = nonSSIncomeAfterDeduction + totalRMD + spendingPreTax + brokerageCapitalGains;
            const preConvTaxableSS = calculateSocialSecurityTaxableAmount(totalSocialSecurity, preConvNonSS, effectiveFilingStatus);
            const preConvGross = preConvNonSS + preConvTaxableSS;
            const preConvFed = calculateFederalTax(preConvGross, effectiveFilingStatus, taxIndexYears, pi.inflationRate, fedOpts(preConvGross + preTaxDeduction));
            const preConvState = calculateStateTax(preConvGross, pi.state, effectiveFilingStatus, taxIndexYears, pi.inflationRate, preConvTaxableSS, totalPension, { federalTaxPaid: preConvFed, primaryAge: myAge, spouseAge: spouseAge });

            // IRMAA: under the 2-year lookback this year's surcharge is fixed by
            // past MAGI — the conversion's IRMAA impact lands two years from now,
            // where that year's solver funds it as a known cost. Only in the first
            // two projection years (no history → current-year approximation) does
            // the conversion move THIS year's surcharge, so fund the delta then.
            const convMedicareEligible = irmaaLookbackMAGI !== null ? 0 :
              (primaryAlive && myAge >= 65 ? 1 : 0) +
              (effectiveFilingStatus === 'married_joint' && spouseAlive && spouseAge >= 65 ? 1 : 0);
            const preConvIRMAA = convMedicareEligible > 0
              ? calculateIRMAASurcharge(preConvGross + preTaxDeduction, effectiveFilingStatus, taxIndexYears, pi.inflationRate, convMedicareEligible).totalSurcharge
              : 0;

            // The bill is paid with a portfolio draw that may itself be taxable
            // (pre-tax dollars, or brokerage gains), which raises the bill again.
            // Simulate the draw against current balances WITHOUT mutating them,
            // and iterate to the fixed point (converges in a few passes). Gains
            // in the funding draw are approximated at ordinary rates here; the
            // final tax block below applies exact preferential LTCG treatment.
            const simulateTaxDrawTaxable = (amount) => {
              let need = amount, taxable = 0;
              const bal = {};
              accts.forEach(a => { bal[a.id] = accountBalances[a.id] || 0; });
              const bookTaxable = (account, w) => {
                if (isPreTaxAccount(account.type)) {
                  taxable += w;
                } else if (isBrokerageAccount(account.type)) {
                  const basisPct = (account.costBasisPercent !== undefined && account.costBasisPercent !== null)
                    ? account.costBasisPercent
                    : BROKERAGE_COST_BASIS_ESTIMATE;
                  taxable += w * (1 - basisPct);
                } // Roth / HSA: tax-free
              };
              if (pi.rothConversionTaxSource === 'brokerage') {
                const brokerageAccts = accts.filter(a => isBrokerageAccount(a.type) || isHSAAccount(a.type));
                if (brokerageAccts.length > 0) {
                  const src = brokerageAccts.reduce((best, a) => bal[a.id] > bal[best.id] ? a : best, brokerageAccts[0]);
                  bookTaxable(src, Math.min(need, bal[src.id]));
                }
                return taxable; // any unfundable remainder stays unfunded (unchanged behavior)
              }
              for (const category of priority) {
                if (need <= 0) break;
                const types = getAccountTypes(category);
                for (const account of accts) {
                  if (!types.includes(account.type) || need <= 0) continue;
                  const w = Math.min(bal[account.id], need);
                  if (w <= 0) continue;
                  bal[account.id] -= w;
                  need -= w;
                  bookTaxable(account, w);
                }
              }
              return taxable;
            };

            let conversionTaxNeeded = 0;
            let taxDrawTaxable = 0;
            for (let i = 0; i < MAX_ITERATIONS_FOR_TAX_CALC; i++) {
              const postConvNonSS = preConvNonSS + rothConversionThisYear + taxDrawTaxable;
              const postConvTaxableSS = calculateSocialSecurityTaxableAmount(totalSocialSecurity, postConvNonSS, effectiveFilingStatus);
              const postConvGross = postConvNonSS + postConvTaxableSS;
              const postConvFed = calculateFederalTax(postConvGross, effectiveFilingStatus, taxIndexYears, pi.inflationRate, fedOpts(postConvGross + preTaxDeduction));
              const postConvState = calculateStateTax(postConvGross, pi.state, effectiveFilingStatus, taxIndexYears, pi.inflationRate, postConvTaxableSS, totalPension, { federalTaxPaid: postConvFed, primaryAge: myAge, spouseAge: spouseAge });
              const postConvIRMAA = convMedicareEligible > 0
                ? calculateIRMAASurcharge(postConvGross + preTaxDeduction, effectiveFilingStatus, taxIndexYears, pi.inflationRate, convMedicareEligible).totalSurcharge
                : 0;
              const nextBill = Math.max(0, (postConvFed - preConvFed) + (postConvState - preConvState) + (postConvIRMAA - preConvIRMAA));
              const converged = Math.abs(nextBill - conversionTaxNeeded) < 1;
              conversionTaxNeeded = nextBill;
              taxDrawTaxable = simulateTaxDrawTaxable(nextBill);
              if (converged) break;
            }

            if (conversionTaxNeeded > 0 && pi.rothConversionTaxSource === 'brokerage') {
              // Pull from the largest brokerage (or HSA) account.
              const brokerageAccts = accts.filter(a => isBrokerageAccount(a.type) || isHSAAccount(a.type));
              if (brokerageAccts.length > 0) {
                const brokerageSource = brokerageAccts.reduce((best, a) =>
                  (accountBalances[a.id] || 0) > (accountBalances[best.id] || 0) ? a : best,
                  brokerageAccts[0]);
                const taxPayment = Math.min(conversionTaxNeeded, accountBalances[brokerageSource.id] || 0);
                accountBalances[brokerageSource.id] -= taxPayment;
                brokerageWithdrawals += taxPayment;
                conversionTaxWithdrawal += taxPayment;
                // B6: book the embedded capital gain so cap-gains tax and NIIT
                // see it. HSA "qualified medical" withdrawals are tax-free, so
                // only book gains for true brokerage accounts.
                if (isBrokerageAccount(brokerageSource.type)) {
                  const basisPct = (brokerageSource.costBasisPercent !== undefined && brokerageSource.costBasisPercent !== null)
                    ? brokerageSource.costBasisPercent
                    : BROKERAGE_COST_BASIS_ESTIMATE;
                  brokerageBasisRecovered += taxPayment * basisPct;
                  brokerageCapitalGains += taxPayment * (1 - basisPct);
                }
                conversionTaxNeeded -= taxPayment;
              }
            }

            if (conversionTaxNeeded > 0 && pi.rothConversionTaxSource !== 'brokerage') {
              // B5: default 'withdrawal' source. Pull the conversion tax bill
              // from the user's normal priority order so the spending solver
              // isn't left short. Approximate (no gross-up for the tax on this
              // extra draw); the second-order effect is small and any residual
              // shortfall flows naturally into next year's brokerage balance.
              for (const category of priority) {
                if (conversionTaxNeeded <= 0) break;
                const types = getAccountTypes(category);
                for (const account of accts) {
                  if (!types.includes(account.type) || conversionTaxNeeded <= 0) continue;
                  const w = Math.min(accountBalances[account.id], conversionTaxNeeded);
                  if (w <= 0) continue;
                  accountBalances[account.id] -= w;
                  conversionTaxNeeded -= w;
                  conversionTaxWithdrawal += w;
                  if (isPreTaxAccount(account.type)) {
                    preTaxWithdrawals += w;
                    // Paying the conversion tax out of pre-tax dollars IS a
                    // distribution, so it carries the §72(t) penalty even though
                    // the conversion itself does not.
                    penalizedWithdrawals += w * penaltyShareFor(account);
                  } else if (isBrokerageAccount(account.type)) {
                    brokerageWithdrawals += w;
                    const basisPct = (account.costBasisPercent !== undefined && account.costBasisPercent !== null)
                      ? account.costBasisPercent
                      : BROKERAGE_COST_BASIS_ESTIMATE;
                    brokerageBasisRecovered += w * basisPct;
                    brokerageCapitalGains += w * (1 - basisPct);
                  } else if (isRothAccount(account.type)) {
                    rothWithdrawals += w;
                  } else if (isHSAAccount(account.type)) {
                    // NOTE: unlike the spending path above, this conversion-tax
                    // draw does not split at the qualified-expense line — it
                    // treats the whole draw as tax-free. Pre-existing behaviour,
                    // left as-is here; funding a Roth conversion's tax bill from
                    // an HSA is a corner of a corner. Reported under the HSA
                    // field rather than the Roth one so the row stays honest
                    // about which account the money left.
                    hsaQualifiedWithdrawals += w;
                  }
                }
              }
            }
          }
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────────
    // Roth withdrawals are tax-free
    
    // Calculate QCD (Qualified Charitable Distribution) if applicable
    // QCDs allow direct IRA-to-charity transfers that:
    // 1. Can start at age 70½ (before RMDs begin)
    // 2. Are NOT included in taxable income
    // 3. Still allow taking the standard deduction (better than itemizing)
    // 4. If RMDs have started, QCDs count toward satisfying the RMD
    // Note: qcdAmount and charitablePercent are declared in outer scope above the isRetired block
    
    if (charitablePercent > 0 && isRetired && myAge >= QCD_START_AGE) {
      // Calculate desired charitable giving as % of retirement spending
      const charitableGiving = desiredIncome * (charitablePercent / 100);
      
      // QCD annual limit ($105,000 per person, inflation-adjusted) - use pre-calculated factor
      const adjustedQCDLimit = QCD_ANNUAL_LIMIT * inflationFactor;
      
      // For married couples, each spouse can do their own QCD from their own IRA
      const householdQCDLimit = effectiveFilingStatus === 'married_joint' ? adjustedQCDLimit * 2 : adjustedQCDLimit;
      
      // QCD can come from any IRA withdrawal taken for spending (RMD or voluntary).
      // The engine models QCDs as re-labeling part of those withdrawals as a direct
      // IRA→charity transfer, so the cap is the pre-tax INCOME actually withdrawn —
      // not the remaining account balance. (The old balance-based cap zeroed the QCD
      // in the year pre-tax depleted even though the withdrawals happened, and could
      // exclude more income than was ever withdrawn. It also disagreed with the
      // spending solver's estimate, leaving net income short of desired spending.)
      // Conversion dollars and the conversion-tax draw are NOT QCD-eligible: they
      // went to the Roth / the IRS, not to charity.
      const qcdEligibleIncome = totalRMD + spendingPreTaxWithdrawals;

      // QCD is limited to:
      // 1. The charitable giving amount (what you want to give)
      // 2. Pre-tax dollars actually withdrawn for spending this year
      // 3. The annual QCD limit
      // Note: We can do QCD even if there's no RMD yet (age 70-74)
      if (qcdEligibleIncome > 0) {
        qcdAmount = Math.min(charitableGiving, qcdEligibleIncome, householdQCDLimit);
      }
    }
    
    // Ordinary income from withdrawals is reduced by QCD amount
    // QCD is excluded from taxable income entirely
    const ordinaryIncomeFromWithdrawals = Math.max(0, totalRMD + preTaxWithdrawals - qcdAmount);
    
    // For brokerage withdrawals, capital gains and basis recovered are tracked
    // per-account during the withdrawal loop (each account has its own costBasisPercent).
    // This is more accurate than applying a single global cost-basis assumption.
    const capitalGainsFromWithdrawals = brokerageCapitalGains;
    
    // CRITICAL: Recalculate SS taxable amount with actual withdrawal income.
    // Capital gains ARE included in finalNonSSIncome because they count toward the IRS
    // "combined income" formula that determines how much SS is taxable (Pub 915). They are
    // removed from the *federal ordinary* tax base below and taxed separately at preferential
    // 0/15/20% rates. State tax (most states, including Alabama, tax LT gains as ordinary
    // income) keeps the gains-inclusive figure via finalTotalTaxableIncome.
    const finalNonSSIncome = nonSSIncomeAfterDeduction + ordinaryIncomeFromWithdrawals + capitalGainsFromWithdrawals;
    const finalTaxableSS = calculateSocialSecurityTaxableAmount(
      totalSocialSecurity, finalNonSSIncome, effectiveFilingStatus
    );
    finalTotalTaxableIncome = finalNonSSIncome + finalTaxableSS; // Updates outer-scope let (finalNonSSIncome is already net of preTaxDeduction)
    finalTaxableSS_out = finalTaxableSS; // Update outer-scope for year push

    // ── FEDERAL ORDINARY TAX ───────────────────────────────────────────────────
    // Capital gains receive preferential federal rates, so they must NOT be taxed at
    // ordinary bracket rates. Remove them from the ordinary base here; the LTCG tax is
    // added separately below. (Previously the gains were left in this base AND taxed again
    // via calculateCapitalGainsTax — double taxation that materially overstated federal tax.)
    const federalOrdinaryTaxableIncome = Math.max(0, finalTotalTaxableIncome - capitalGainsFromWithdrawals);
    // MAGI ≈ AGI with certain deductions added back. finalTotalTaxableIncome already
    // includes capital gains and the taxable portion of SS, with the pre-tax contribution
    // deduction removed — so we add only that deduction back here. Derived BEFORE the
    // federal tax because it drives the senior-deduction phaseout (and, further down,
    // the NIIT threshold and the IRMAA lookback record).
    const magi = finalTotalTaxableIncome + preTaxDeduction;
    federalTax = calculateFederalTax(federalOrdinaryTaxableIncome, effectiveFilingStatus, taxIndexYears, pi.inflationRate, fedOpts(magi));
    // Retirement income exempt in some states: pension only (401k/IRA withdrawals are NOT exempt)
    const finalRetirementIncome = totalPension;
    // For IL/MS/PA, ALL qualified retirement distributions (pre-tax 401k/IRA + RMDs) are also
    // exempt — pass that figure via extraParams so calculateStateTax can subtract it (B9).
    const qualifiedRetirementWithdrawals = preTaxWithdrawals + totalRMD;
    // Pass extraParams for Alabama progressive tax engine (federal deductibility, age-based exclusions)
    const stateExtraParams = { federalTaxPaid: federalTax, primaryAge: myAge, spouseAge: spouseAge, qualifiedRetirementWithdrawals };
    stateTax = calculateStateTax(finalTotalTaxableIncome, pi.state, effectiveFilingStatus, taxIndexYears, pi.inflationRate, finalTaxableSS, finalRetirementIncome, stateExtraParams);
    
    // Calculate state taxable income (for display in detailed table)
    // For Alabama: mirror the progressive engine's deductions (federal tax, over-65, personal exemption)
    // For others: mirror the simplified flat-rate logic
    let stateTaxableIncome;
    if (pi.state === 'Alabama') {
      // Reconstruct Alabama taxable income for display
      let alAGI = finalTotalTaxableIncome;
      alAGI -= (STATES_THAT_TAX_SS.has('Alabama') ? 0 : finalTaxableSS); // SS exempt
      alAGI -= finalRetirementIncome; // Pension exempt
      let over65Ex = 0;
      if (myAge >= 65) over65Ex += ALABAMA_OVER_65_RETIREMENT_EXCLUSION;
      if (effectiveFilingStatus === 'married_joint' && spouseAge >= 65) over65Ex += ALABAMA_OVER_65_RETIREMENT_EXCLUSION;
      alAGI -= Math.min(over65Ex, Math.max(0, alAGI));
      alAGI = Math.max(0, alAGI - federalTax); // Federal tax deductibility
      const alStdDed = getAlabamaStandardDeduction(alAGI, effectiveFilingStatus);
      const alPersonalEx = ALABAMA_PERSONAL_EXEMPTION[effectiveFilingStatus] || ALABAMA_PERSONAL_EXEMPTION.single;
      stateTaxableIncome = Math.max(0, alAGI - alStdDed - alPersonalEx);
    } else {
      const stateSSExclusion = STATES_THAT_TAX_SS.has(pi.state) ? 0 : finalTaxableSS;
      const stateRetExclusion = STATES_EXEMPT_RETIREMENT_INCOME.has(pi.state) ? finalRetirementIncome : 0;
      const stateBroadExclusion = STATES_EXEMPT_ALL_RETIREMENT_DISTRIBUTIONS.has(pi.state) ? qualifiedRetirementWithdrawals : 0;
      const stateGrossForCalc = finalTotalTaxableIncome - stateSSExclusion - stateRetExclusion - stateBroadExclusion;
      const stateDeduction = (STANDARD_DEDUCTION_2026[effectiveFilingStatus] || STANDARD_DEDUCTION_2026.married_joint) * inflationFactor;
      stateTaxableIncome = Math.max(0, stateGrossForCalc - stateDeduction);
    }
    
    // Determine the LTCG stacking position. The "income below the gains" is ordinary
    // taxable income with capital gains EXCLUDED (federalOrdinaryTaxableIncome), after the
    // standard deduction. calculateCapitalGainsTax expects TOTAL taxable income (ordinary +
    // gains) and derives the stacking point internally, so we pass ordinary-after-deduction
    // PLUS the gains. (Previously this used finalTotalTaxableIncome, which already contained
    // the gains, then added them again — placing the gains too high in the brackets.)
    // When ordinary income is less than the standard deduction, IRS Qualified Dividends and
    // Capital Gain Tax Worksheet absorbs the unused deduction against the gains (line 5 clamps
    // to 0). Mirror that by reducing the taxable-gains figure by any unused deduction.
    // Full federal deduction including the 65+ amounts — they reduce ordinary
    // taxable income, so gains stack lower in the LTCG brackets.
    const adjustedDeduction = getFederalDeduction(effectiveFilingStatus, taxIndexYears, pi.inflationRate, fedOpts(magi));
    const unusedDeduction = Math.max(0, adjustedDeduction - federalOrdinaryTaxableIncome);
    const taxableGains = Math.max(0, capitalGainsFromWithdrawals - unusedDeduction);
    const taxableOrdinaryIncome = Math.max(0, federalOrdinaryTaxableIncome - adjustedDeduction);

    // Add capital gains tax on brokerage withdrawals using tiered rates (0%/15%/20%)
    const capitalGainsTax = calculateCapitalGainsTax(
      taxableGains,
      taxableOrdinaryIncome + taxableGains,
      effectiveFilingStatus,
      taxIndexYears,
      pi.inflationRate
    );
    federalTax += capitalGainsTax;
    
    // Add NIIT (3.8% surtax) for high earners on investment income
    // Investment income includes: realized capital gains + dividends/interest from
    // the entire brokerage portfolio (not just the withdrawn portion).
    // Use a 2% dividend/interest yield on the start-of-year brokerage balance
    // (totalBrokerageBalance was computed before withdrawals).
    const totalInvestmentIncome = capitalGainsFromWithdrawals; // realized gains + dividends
    // `magi` was derived above the federal ordinary tax (it drives the senior-
    // deduction phaseout). Capital gains are ALREADY in finalTotalTaxableIncome;
    // an earlier version added them a second time, overstating MAGI and pushing
    // IRMAA tiers / NIIT too high whenever there were brokerage gains.
    // Record this year's MAGI so years t+2 onward can apply the IRMAA lookback.
    magiByYear[yearsFromNow] = magi;
    const niitTax = calculateNIIT(totalInvestmentIncome, magi, effectiveFilingStatus);
    federalTax += niitTax;

    // ── §72(t) EARLY WITHDRAWAL PENALTY ────────────────────────────────────────
    // 10% additional federal tax on pre-59½ distributions without an exception.
    // Added here alongside the capital-gains tax and NIIT — i.e. AFTER the state
    // tax was priced off `federalTaxPaid`, matching how those two are handled
    // (Alabama's federal deductibility uses the ordinary tax only).
    const earlyWithdrawalPenalty = penalizedWithdrawals * EARLY_WITHDRAWAL_PENALTY_RATE;
    federalTax += earlyWithdrawalPenalty;
    // §223(f)(4): 20% additional tax on non-qualified HSA distributions before
    // 65. At 65 and beyond the penalty vanishes and the withdrawal is simply
    // ordinary income — already counted above via preTaxWithdrawals.
    const hsaPenalty = myAge < HSA_PENALTY_END_AGE
      ? hsaNonQualifiedWithdrawals * HSA_NONQUALIFIED_PENALTY_RATE : 0;
    federalTax += hsaPenalty;

    // ── MEDICARE IRMAA SURCHARGE ──────────────────────────────────────────────
    // IRMAA adds surcharges to Part B and Part D premiums for high-income beneficiaries.
    // Based on MAGI from TWO YEARS PRIOR (real Medicare lookback), applied against
    // this year's inflation-indexed thresholds. The first two projection years have
    // no MAGI history and fall back to current-year MAGI as an approximation.
    // Each Medicare-eligible person (age 65+) pays their own surcharge.
    let irmaaSurcharge = 0;
    let irmaaInfo = null; // IRMAA tier detail for display components
    const numMedicareEligible = age65Count; // same predicate as the 65+ deductions
    if (numMedicareEligible > 0) {
      const irmaaMAGI = irmaaLookbackMAGI !== null ? irmaaLookbackMAGI : magi;
      const irmaaResult = calculateIRMAASurcharge(irmaaMAGI, effectiveFilingStatus, taxIndexYears, pi.inflationRate, numMedicareEligible);
      irmaaSurcharge = irmaaResult.totalSurcharge;
      // Store IRMAA detail for display components (avoids independent recalculation).
      // tier/premium fields describe the surcharge being PAID this year (lookback MAGI).
      const irmaaDetail = calculateIRMAA(irmaaMAGI, effectiveFilingStatus, taxIndexYears, pi.inflationRate);
      irmaaInfo = { tier: irmaaDetail.tier, totalAnnual: irmaaDetail.totalAnnual,
        partBAnnual: irmaaDetail.partBAnnual, partDAnnual: irmaaDetail.partDAnnual,
        partBMonthly: irmaaDetail.partBMonthly, partDMonthly: irmaaDetail.partDMonthly };
      // distToNextTier is PLANNING info: headroom in THIS year's MAGI before the
      // surcharge that lands two years from now crosses a tier. Hence THIS year's
      // MAGI against thresholds inflated to `yearsFromNow + 2` — the year the
      // surcharge will actually be paid.
      //
      // Left undefined in the top tier: there is no further cliff to fall off,
      // and reporting a distance of 0 or Infinity would both read as "you are
      // about to cross something".
      const nextTier = nextIRMAAThreshold(magi, effectiveFilingStatus, taxIndexYears + 2, pi.inflationRate);
      if (nextTier) irmaaInfo.distToNextTier = Math.round(nextTier.distance);
    }
    
    // ── ACA PREMIUM: settle from final MAGI ────────────────────────────────────
    // The solver worked from estimates; price the year's actual net premium from
    // the settled income figure (finalTotalTaxableIncome = AGI incl. gains and
    // taxable SS, net of the pre-tax deduction).
    let acaSubsidy = 0, acaNetPremium = 0, acaFplPercent = null;
    if (acaGrossPremium > 0) {
      const finalACAMagi = finalTotalTaxableIncome + (totalSocialSecurity - finalTaxableSS);
      const finalACA = acaCredit(finalACAMagi);
      acaSubsidy = finalACA.subsidy;
      acaNetPremium = finalACA.netPremium;
      acaFplPercent = finalACA.fplPercent;
    }

    // Update total taxes for downstream calculations
    const totalTaxes = federalTax + stateTax;
    
    // Step 3: Add excess RMD to brokerage (after paying taxes)
    // The excess RMD is money you were forced to withdraw but don't need to spend
    // After paying taxes on it, the remainder gets reinvested in brokerage
    if (excessRMD > 0) {
      // Calculate the ACTUAL marginal tax on the excess RMD by differencing taxes WITH vs.
      // WITHOUT it. The excess RMD is ordinary income, so for the FEDERAL marginal we use a
      // base that EXCLUDES capital gains (consistent with the federal ordinary tax above —
      // gains are taxed separately and are unaffected by the RMD). For STATE we use the
      // gains-INCLUSIVE base (most states, incl. Alabama, tax gains as ordinary income).
      // Removing the excess also lowers the taxable portion of SS (Pub 915 combined income).
      const nonSSWithoutExcess = Math.max(0, finalNonSSIncome - excessRMD);
      const taxableSSWithoutExcess = calculateSocialSecurityTaxableAmount(
        totalSocialSecurity, nonSSWithoutExcess, effectiveFilingStatus
      );
      // Federal: gains-excluded ordinary base, with and without the excess RMD.
      // (nonSSWithoutExcess derives from finalNonSSIncome, which is already net of preTaxDeduction.)
      const fedOrdinaryWithoutExcess = Math.max(0, nonSSWithoutExcess - capitalGainsFromWithdrawals + taxableSSWithoutExcess);
      // Each side is priced at its OWN MAGI so the senior deduction's 6% phaseout
      // shows up in the marginal rate — dropping the excess RMD restores deduction,
      // which is a real part of what that RMD costs.
      const magiWithoutExcess = Math.max(0, nonSSWithoutExcess + taxableSSWithoutExcess + preTaxDeduction);
      const fedTaxWithoutExcess = calculateFederalTax(fedOrdinaryWithoutExcess, effectiveFilingStatus, taxIndexYears, pi.inflationRate, fedOpts(magiWithoutExcess));
      const fedTaxWithExcess = calculateFederalTax(federalOrdinaryTaxableIncome, effectiveFilingStatus, taxIndexYears, pi.inflationRate, fedOpts(magi));
      // State: gains-inclusive base, without the excess RMD (compare against the already-
      // computed `stateTax`, which is the gains-inclusive with-excess figure).
      const stateBaseWithoutExcess = Math.max(0, nonSSWithoutExcess + taxableSSWithoutExcess);
      const stateTaxWithoutExcess = calculateStateTax(
        stateBaseWithoutExcess, pi.state, effectiveFilingStatus, taxIndexYears, pi.inflationRate,
        taxableSSWithoutExcess, finalRetirementIncome,
        { federalTaxPaid: fedTaxWithoutExcess, primaryAge: myAge, spouseAge: spouseAge }
      );
      // Marginal tax = tax(with excess) − tax(without excess), attributable to excessRMD.
      // (Capital gains / NIIT / IRMAA aren't driven by the excess RMD here.)
      const marginalTax = Math.max(0, (fedTaxWithExcess - fedTaxWithoutExcess) + (stateTax - stateTaxWithoutExcess));
      const afterTaxExcess = Math.max(0, excessRMD - marginalTax);
      
      // Find the largest brokerage account to add to (B8: was .find() which silently picked
      // the first by array order, causing inconsistent draws across call sites).
      const largestBrokerage = accts
        .filter(a => a.type === 'brokerage')
        .reduce((best, a) => (!best || accountBalances[a.id] > accountBalances[best.id]) ? a : best, null);
      if (largestBrokerage) {
        accountBalances[largestBrokerage.id] += afterTaxExcess;
      } else {
        // No brokerage account exists — track excess in the synthetic reinvestment bucket
        excessReinvestmentPool += afterTaxExcess;
      }
    }

    // Deposit non-taxable one-time income (inheritance, gifts, home sale proceeds)
    // into the largest brokerage account (B8).
    if (oneTimeNontaxableIncome > 0) {
      const largestBrokerage = accts
        .filter(a => a.type === 'brokerage')
        .reduce((best, a) => (!best || accountBalances[a.id] > accountBalances[best.id]) ? a : best, null);
      if (largestBrokerage) {
        accountBalances[largestBrokerage.id] += oneTimeNontaxableIncome;
      } else {
        excessReinvestmentPool += oneTimeNontaxableIncome;
      }
    }
    
    // Step 4: Apply remaining half-year growth to all accts (after withdrawals).
    // Combined with pre-withdrawal half-growth above, total annual growth = (1+cagr).
    // This is the half-year convention — funds withdrawn earlier in the year
    // earn the pre-withdrawal half; funds remaining at year end earn both halves.
    // Second half-year growth — re-uses yrOverride from the pre-withdrawal site
    // above so both halves apply the same marketReturn: (1+r)^0.5 * (1+r)^0.5 = 1+r.
    accts.forEach(account => {
      // Clamp at -1: a return below -100% is impossible for a long-only position
      // and would make Math.pow(1+r, 0.5) NaN, which then silently counts as a
      // surviving portfolio in the Monte Carlo success tally.
      const growthRate = Math.max(-1, yrOverride ? yrOverride.marketReturn : (account.cagr || 0));
      const halfGrowth = Math.pow(1 + growthRate, 0.5);
      accountBalances[account.id] = Math.max(0, accountBalances[account.id]) * halfGrowth;
    });
    // Grow the excess reinvestment pool's remaining half (for users without brokerage accounts)
    const poolGrowthRate2 = Math.max(-1, yrOverride ? yrOverride.marketReturn : reinvestmentGrowthRate);
    excessReinvestmentPool *= Math.pow(1 + poolGrowthRate2, 0.5);
    
    // Calculate final balances (after withdrawals and growth)
    let finalPreTaxBalance = 0, finalRothBalance = 0, finalBrokerageBalance = 0;
    accts.forEach(account => {
      if (isPreTaxAccount(account.type)) {
        finalPreTaxBalance += accountBalances[account.id];
      } else if (isRothAccount(account.type)) {
        finalRothBalance += accountBalances[account.id];
      } else {
        finalBrokerageBalance += accountBalances[account.id];
      }
    });
    // Include reinvested excess RMDs in brokerage balance
    finalBrokerageBalance += Math.round(excessReinvestmentPool);
    
    // Weighted average growth rate across all accounts (for CoastFIRE, Withdrawal Strategies).
    // Numerator and denominator both range over real accounts ONLY. The excess
    // reinvestment pool is deliberately excluded from both: it has no per-account
    // cagr, so folding it into the denominator alone (as the old code did via
    // finalBrokerageBalance) silently diluted the weighted rate toward zero.
    let weightedCAGR = 0.07; // fallback
    let weightedSum = 0, weightBase = 0;
    accts.forEach(a => {
      const bal = accountBalances[a.id] || 0;
      weightedSum += bal * (a.cagr || 0); // missing cagr must not poison the weighted average with NaN
      weightBase += bal;
    });
    if (weightBase > 0) {
      weightedCAGR = weightedSum / weightBase;
    }
    
    // Calculate non-liquid assetList (for legacy planning)
    let totalAssetValue = 0;
    let totalAssetDebt = 0;
    assetList.forEach(asset => {
      // A sold asset leaves the balance sheet in the year of sale — its value has
      // already been converted to cash and swept into the portfolio, so carrying
      // it here as well would double-count it in net worth and legacy.
      if (asset.saleAge) {
        const ownerAge = asset.owner === 'spouse' ? spouseAge : myAge;
        if (ownerAge >= asset.saleAge) return;
      }
      const assetValue = asset.value * Math.pow(1 + (asset.appreciationRate || 0), yearsFromNow);
      totalAssetValue += Math.max(0, assetValue); // Don't go negative for depreciating assetList
      totalAssetDebt += remainingMortgageAt(asset, myAge, yearsFromNow, pi);
    });
    const netAssetValue = totalAssetValue - totalAssetDebt;
    
    years.push({
      year, myAge, spouseAge,
      desiredIncome: Math.round(desiredIncome),
      earnedIncome: Math.round(earnedIncome),
      socialSecurity: Math.round(totalSocialSecurity),
      pension: Math.round(totalPension),
      otherIncome: Math.round(totalOtherIncome),
      totalGuaranteedIncome: Math.round(totalGuaranteedIncome),
      portfolioWithdrawal: Math.round(portfolioWithdrawal),
      // Spending dollars the portfolio could not supply this year (0 in a funded
      // plan). > 0 means the plan is short: netIncome below the spending target.
      unfundedShortfall: Math.round(unfundedShortfall),
      rmd: Math.round(totalRMD),
      excessRMD: Math.round(excessRMD),
      qcd: Math.round(qcdAmount),
      // Qualified dividends thrown off by taxable accounts this year. Taxable
      // whether or not anything was sold; included in taxableIncome and magi.
      brokerageDividends: Math.round(brokerageDividends),
      // Realized long-term gains booked this year (brokerage draws x (1 - basis)).
      // Exposed because without it the federal tax on a row cannot be reconciled:
      // preferential income is taxed at 0/15/20%, and dividends alone don't
      // account for it once a taxable account is being drawn down.
      realizedCapitalGains: Math.round(Math.max(0, brokerageCapitalGains - brokerageDividends)),
      // Asset sales, reported separately so the UI can explain a spike in tax.
      // A downsize can produce the largest single-year capital gain in a whole
      // plan, and without these the year just looks inexplicably expensive.
      assetSaleProceeds: Math.round(assetSaleProceeds),
      assetSaleTaxableGain: Math.round(assetSaleTaxableGain),
      assetSaleExcludedGain: Math.round(assetSaleExcludedGain),
      rothConversion: Math.round(rothConversionThisYear), // Planned Roth conversion executed this year
      conversionTaxWithdrawal: Math.round(conversionTaxWithdrawal), // Extra portfolio draw that paid the conversion's tax bill
      charitableGiving: Math.round(isRetired ? desiredIncome * (charitablePercent / 100) : 0),
      totalIncome: Math.round(earnedIncome + totalGuaranteedIncome + portfolioWithdrawal + conversionTaxWithdrawal),
      // Tax computation intermediate values (for display components to consume)
      // Contributions NOT made this year because a dated pre-retirement expense
      // consumed them. > 0 means saving was paused to pay for something.
      contributionsPaused: Math.round(contributionsPaused),
      preTaxDeduction: Math.round(preTaxDeduction), // Pre-tax retirement contributions (above-the-line deduction)
      nonSSIncome: Math.round(nonSSIncome), // Non-SS income before pre-tax deduction (used for SS taxation display)
      taxableSS: Math.round(finalTaxableSS_out), // Taxable portion of SS benefits (IRS combined income formula)
      taxableIncome: Math.round(finalTotalTaxableIncome), // Federal taxable income (after pre-tax deduction, before standard deduction)
      // The total federal deduction actually applied this year: standard deduction
      // + the §63(f) 65+ amount + the OBBBA senior deduction net of its phaseout.
      // Exposed so display components show the same figure the tax used instead of
      // re-deriving a plain standard deduction and disagreeing with the engine.
      federalDeduction: Math.round(adjustedDeduction),
      age65Count, // living people 65+ (drives Medicare/IRMAA billing)
      age65OnReturn, // people 65+ the tax return covers (includes a decedent in their final year)
      magi: Math.round(magi), // Modified Adjusted Gross Income (gains-inclusive AGI with pre-tax deduction added back)
      stateTaxableIncome: Math.round(stateTaxableIncome), // State taxable income after SS/retirement exclusions and deduction
      federalTax: Math.round(federalTax),
      // §72(t) additional tax, already included in federalTax above. Broken out
      // so the UI can show it as its own line — it is the dominant cost of an
      // early-retirement withdrawal plan and shouldn't hide inside "federal tax".
      earlyWithdrawalPenalty: Math.round(earlyWithdrawalPenalty),
      // HSA money drawn beyond qualified medical expenses: ordinary income, and
      // penalised before 65. Reported so a year that suddenly costs more tax can
      // be explained rather than just observed.
      hsaQualifiedBudget: Math.round(hsaQualifiedBudget),
      hsaNonQualifiedWithdrawals: Math.round(hsaNonQualifiedWithdrawals),
      hsaPenalty: Math.round(hsaPenalty),
      penalizedWithdrawals: Math.round(penalizedWithdrawals),
      // The year's draw decomposed by tax treatment. preTaxWithdrawals is the
      // ordinary-income base (RMDs + voluntary pre-tax + the non-qualified HSA
      // share + any pre-tax conversion-tax draw); the other three are reported
      // for explanation, not used in the tax arithmetic. Qualified HSA draws are
      // tax-free like Roth draws but are tracked apart from them — spending Roth
      // principal and reimbursing a medical bill are different decisions.
      preTaxWithdrawals: Math.round(preTaxWithdrawals),
      brokerageWithdrawals: Math.round(brokerageWithdrawals),
      rothWithdrawals: Math.round(rothWithdrawals),
      hsaQualifiedWithdrawals: Math.round(hsaQualifiedWithdrawals),
      stateTax: Math.round(stateTax),
      ficaTax: Math.round(totalFICA), // Employee FICA (SS + Medicare) on earned income
      irmaaSurcharge: Math.round(irmaaSurcharge), // Medicare IRMAA surcharge (Part B + Part D above standard)
      irmaaInfo, // IRMAA tier detail { tier, totalAnnual, partBAnnual, partDAnnual, distToNextTier }
      ssEarningsTestReduction: Math.round(ssEarningsTestReduction), // SS benefits withheld due to earnings test
      // Healthcare and recurring expense data (from unified model).
      // The ACA net premium (MAGI-priced in this loop) is folded into the totals
      // here — calculateHealthcareExpenses only counted the people.
      healthcareExpense: healthcareExpense + Math.round(acaNetPremium), // Total healthcare costs this year
      healthcarePre65: healthcareResult.pre65 + Math.round(acaNetPremium),
      // ACA marketplace detail (pre65Coverage === 'aca' and someone is retired & under 65)
      acaGrossPremium: Math.round(acaGrossPremium),
      acaSubsidy: Math.round(acaSubsidy),
      acaNetPremium: Math.round(acaNetPremium),
      acaFplPercent: acaFplPercent !== null ? Math.round(acaFplPercent) : null,
      healthcareMedicare: healthcareResult.medicare,
      healthcareLTC: healthcareResult.ltc,
      recurringExpenses: totalRecurringExpenses, // Total categorized recurring expenses
      recurringExpensesByCategory: recurringResult.byCategory, // Breakdown by category
      totalTax: Math.round(federalTax + stateTax + totalFICA + irmaaSurcharge),
      netIncome: Math.round(earnedIncome + totalGuaranteedIncome + portfolioWithdrawal + conversionTaxWithdrawal - federalTax - stateTax - totalFICA - irmaaSurcharge),
      filingStatus: effectiveFilingStatus, // Actual filing status used (may differ from input after survivor event)
      preTaxBalance: Math.round(finalPreTaxBalance),
      rothBalance: Math.round(finalRothBalance),
      brokerageBalance: Math.round(finalBrokerageBalance),
      totalPortfolio: Math.round(finalPreTaxBalance + finalRothBalance + finalBrokerageBalance),
      weightedCAGR, // Balance-weighted average growth rate across all accounts
      assetValue: Math.round(totalAssetValue),
      assetDebt: Math.round(totalAssetDebt),
      netAssetValue: Math.round(netAssetValue),
      totalNetWorth: Math.round(finalPreTaxBalance + finalRothBalance + finalBrokerageBalance + netAssetValue),
      // Per-account balances snapshot (used by individual account view in Accounts tab)
      perAccountBalances: accts.reduce((obj, a) => {
        obj[a.id] = Math.round(accountBalances[a.id] || 0);
        return obj;
      }, {}),
      // Per-account contributions snapshot (used by contribution view in Accounts tab)
      perAccountContributions: { ...accountContributions },
      // One-time events that occurred this year
      oneTimeEvents: yearEvents.length > 0 ? yearEvents : undefined,
      oneTimeExpense: Math.round(oneTimeExpenseTotal),
      oneTimeIncome: Math.round(oneTimeTaxableIncome + oneTimeNontaxableIncome),
      // Survivor modeling status
      survivorEvent: survivorEvent || undefined,
      effectiveFilingStatus: effectiveFilingStatus !== pi.filingStatus ? effectiveFilingStatus : undefined,
      primaryAlive, spouseAlive,
      // Guardrails (only when opts.spendingRule is active)
      guardrailMultiplier: spendingRule ? guardrailMultiplier : undefined,
      guardrailEvent
    });

    // Guardrails bookkeeping: remember this row for next year's rate check, and
    // anchor the target withdrawal rate at the FIRST retirement year's actual rate
    // (unless the caller supplied initialWithdrawalRate explicitly).
    if (spendingRule) {
      guardrailPrevYear = years[years.length - 1];
      if (guardrailAnchorRate === null && isRetired && guardrailPrevYear.totalPortfolio > 0) {
        // Same spending-only definition as the per-year rate check above.
        guardrailAnchorRate = (guardrailPrevYear.portfolioWithdrawal - (guardrailPrevYear.excessRMD || 0)) / guardrailPrevYear.totalPortfolio;
      }
    }

    // After both spouses are dead, stop generating rows (B7). Otherwise the loop
    // would keep producing zero-income, untouched-balance rows out to legacyAge,
    // skewing charts and any end-of-plan aggregates. Only fires when survivor
    // mode is on — single filers never trip this.
    if (survivorEnabled && !primaryAlive && !spouseAlive) break;
  }
  return years;
}

  return {
    // ── Generic constants ─────────────────────────────────────────────────
    MAX_AGE, MAX_MODELED_AGE, BROKERAGE_COST_BASIS_ESTIMATE, MAX_ITERATIONS_FOR_TAX_CALC,
    MONTE_CARLO_TAX_ESTIMATE, SAVE_DEBOUNCE_MS,

    // ── Tax base year and inflation indexing ──────────────────────────────
    BASE_TAX_YEAR, indexTo,

    // ── Account type taxonomy ─────────────────────────────────────────────
    PRE_TAX_TYPES, ROTH_TYPES, BROKERAGE_TYPES, HSA_TYPES,
    isPreTaxAccount, isRothAccount, isBrokerageAccount, isHSAAccount,

    // ── Federal income tax ────────────────────────────────────────────────
    FEDERAL_TAX_BRACKETS_2026, STANDARD_DEDUCTION_2026,
    ADDITIONAL_STD_DEDUCTION_65_2026, SENIOR_DEDUCTION_AMOUNT,
    SENIOR_DEDUCTION_FIRST_YEAR, SENIOR_DEDUCTION_LAST_YEAR,
    SENIOR_DEDUCTION_PHASEOUT_RATE, SENIOR_DEDUCTION_PHASEOUT_START,
    seniorDeduction, getFederalDeduction,
    calculateFederalTax, federalTaxOnTaxableIncome,
    calculateSocialSecurityTaxableAmount,
    CAPITAL_GAINS_THRESHOLDS_2025, calculateCapitalGainsTax, calculateNIIT,

    // ── State income tax ──────────────────────────────────────────────────
    STATE_TAX_RATES, STATES_EXEMPT_RETIREMENT_INCOME,
    STATES_EXEMPT_ALL_RETIREMENT_DISTRIBUTIONS, STATES_THAT_TAX_SS,
    calculateStateTax,
    STATE_TAX_CONFIG, calculateStateTaxProgressive,
    resolveStateStdDeduction, applyStateBrackets,
    ALABAMA_TAX_BRACKETS, ALABAMA_PERSONAL_EXEMPTION,
    ALABAMA_OVER_65_RETIREMENT_EXCLUSION,
    getAlabamaStandardDeduction, calculateAlabamaTax,

    // ── FICA / payroll ────────────────────────────────────────────────────
    FICA_SS_RATE, FICA_SS_WAGE_BASE_2025, FICA_MEDICARE_RATE,
    FICA_ADDITIONAL_MEDICARE_RATE, FICA_ADDITIONAL_MEDICARE_THRESHOLD,
    calculateFICA,

    // ── Retirement accounts (RMD, Roth conversion windows) ────────────────
    RMD_FACTORS, calculateRMD, getRmdStartAge, rmdUsesJointTable, getDefaultRothConversionWindow,
    RMD_JOINT_FACTORS, RMD_JOINT_MIN_SPOUSE_AGE, getRmdJointFactor,
    QCD_ANNUAL_LIMIT, QCD_START_AGE,
    EARLY_WITHDRAWAL_PENALTY_RATE, EARLY_WITHDRAWAL_AGE, RULE_OF_55_AGE,
    PENALTY_EXEMPT_TYPES, RULE_OF_55_TYPES,
    earlyWithdrawalPenaltyFraction, earlyWithdrawalPenaltyShare,

    // ── Social Security ───────────────────────────────────────────────────
    SS_FULL_RETIREMENT_AGE, SS_FRA_PRE_1943, getFullRetirementAge,
    SS_EARNINGS_TEST_LIMIT_2025, SS_EARNINGS_TEST_FRA_LIMIT_2025,
    calculateSSBenefit, calculateSSEarningsTestReduction, inferPiaFromBenefit,
    calculateSpousalBenefit,
    mortalityQx, lifeExpectancyAt, sampleAgeAtDeath, MORTALITY_MIN_AGE,
    HSA_NONQUALIFIED_PENALTY_RATE, HSA_PENALTY_END_AGE,
    computeAssetSale, section121Exclusion, remainingMortgageAt,
    SECTION_121_EXCLUSION_SINGLE, SECTION_121_EXCLUSION_JOINT,

    // ── Medicare / IRMAA / healthcare ─────────────────────────────────────
    IRMAA_THRESHOLDS_2025, MEDICARE_PART_B_STANDARD_2025,
    calculateIRMAA, calculateIRMAASurcharge, nextIRMAAThreshold,
    MEDICARE_PART_B_PREMIUM_2025, MEDICARE_PART_D_PREMIUM_2025,
    MEDICARE_SUPPLEMENT_PREMIUM_2025, MEDICARE_OOP_ANNUAL_2025,
    PRE_65_HEALTHCARE_ANNUAL_2025, MEDICAL_INFLATION_RATE,
    LTC_MONTHLY_ASSISTED_LIVING_2025, LTC_DEFAULT_DURATION_MONTHS,
    ACA_FPL_2025, calculateACASubsidy,
    ACA_APPLICABLE_PCT_2026, ACA_BENCHMARK_PREMIUM_2026,
    getACAApplicablePercentage, calculateACAPremiumCredit,
    getSpendingPhaseMultiplier, scoreRothStrategy, rowAtOrLast,
    reindexSSForInflation, compareClaimingScenarios,
    conversionCostComponents, topMarginalBracket,
    calculateHealthcareExpenses, calculateRecurringExpenses,
    healthcareCostsModeled, HEALTHCARE_MODELS_UNPRICED,

    // ── Government pension estimator ──────────────────────────────────────
    GOV_PENSION_SYSTEMS, estimateGovernmentPension, estimateFersSupplement,
    projectHigh3, dietCola,

    // ── Historical sequences + main projection entry point ────────────────
    HISTORICAL_RETURNS, getHistoricalSequence, getValidStartYears,
    getPlanningHorizonYears,
    realReturn, inflateToAge, deflateToToday, coastFire,
    LIMIT_402G, LIMIT_415C, LIMIT_IRA, LIMIT_HSA_SELF, LIMIT_HSA_FAMILY,
    DEFERRAL_TYPES, IRA_TYPES, workplaceCatchUp, checkContributionLimits,
    streamColaYears, streamAmountAtAge,
    SAVINGS_MULTIPLE_BY_AGE, savingsMultipleForAge, TYPICAL_DEFERRAL_RATE,
    TYPICAL_MATCH_RATE, SS_REPLACEMENT_RATE, SS_MAX_ANNUAL_AT_FRA,
    estimateRetirementSavings, estimateAnnualSocialSecurity,
    computeProjections,
  };
});
