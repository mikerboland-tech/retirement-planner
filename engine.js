// AUTO-GENERATED engine bundle. Source: desktop retirement-planner.jsx.
// Edit the original JSX file(s) for engine logic, then re-run extraction.
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
const BROKERAGE_COST_BASIS_ESTIMATE = 0.50; // Fallback default when account.costBasisPercent is not set
const MAX_ITERATIONS_FOR_TAX_CALC = 15;
const MONTE_CARLO_TAX_ESTIMATE = 0.15;
const SAVE_DEBOUNCE_MS = 500;

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
    { min: 105700, max: 201750, rate: 0.24 },
    { min: 201750, max: 256200, rate: 0.32 },
    { min: 256200, max: 640600, rate: 0.35 },
    { min: 640600, max: Infinity, rate: 0.37 }
  ]
};

// 2026 Standard Deductions — Source: IRS Revenue Procedure 2025-32
const STANDARD_DEDUCTION_2026 = {
  single: 16100,
  married_joint: 32200,
  married_separate: 16100,
  head_of_household: 24150
};

const STATE_TAX_RATES = {
  'None': 0, 'Alabama': 0.05, 'Alaska': 0, 'Arizona': 0.025, 'Arkansas': 0.044,
  'California': 0.093, 'Colorado': 0.044, 'Connecticut': 0.0699, 'Delaware': 0.066,
  'Florida': 0, 'Georgia': 0.0549, 'Hawaii': 0.11, 'Idaho': 0.058, 'Illinois': 0.0495,
  'Indiana': 0.0315, 'Iowa': 0.057, 'Kansas': 0.057, 'Kentucky': 0.04, 'Louisiana': 0.0425,
  'Maine': 0.0715, 'Maryland': 0.0575, 'Massachusetts': 0.05, 'Michigan': 0.0425,
  'Minnesota': 0.0985, 'Mississippi': 0.05, 'Missouri': 0.048, 'Montana': 0.059,
  'Nebraska': 0.0584, 'Nevada': 0, 'New Hampshire': 0, 'New Jersey': 0.1075,
  'New Mexico': 0.059, 'New York': 0.109, 'North Carolina': 0.0475, 'North Dakota': 0.025,
  'Ohio': 0.035, 'Oklahoma': 0.0475, 'Oregon': 0.099, 'Pennsylvania': 0.0307,
  'Rhode Island': 0.0599, 'South Carolina': 0.064, 'South Dakota': 0, 'Tennessee': 0,
  'Texas': 0, 'Utah': 0.0465, 'Vermont': 0.0875, 'Virginia': 0.0575, 'Washington': 0,
  'West Virginia': 0.055, 'Wisconsin': 0.0765, 'Wyoming': 0
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

// Calculate Alabama state tax with progressive brackets and federal deductibility
// This replaces the flat-rate calculation for Alabama and is called by calculateStateTax
// when state === 'Alabama'.
//
// Parameters:
//   grossIncome: Total gross income (same as federal gross before deductions)
//   federalTaxPaid: Federal income tax liability (deductible in Alabama)
//   filingStatus: 'single', 'married_joint', 'married_separate', 'head_of_household'
//   taxableSS: Taxable portion of Social Security (exempt in Alabama)
//   retirementIncome: Pension/government retirement income (exempt in Alabama)
//   primaryAge: Primary filer's age (for over-65 exclusion)
//   spouseAge: Spouse's age (for over-65 exclusion, married_joint only)
//   isGovernmentPension: Whether pension is from government (FERS/CSRS/military/state)
const calculateAlabamaTax = (grossIncome, federalTaxPaid, filingStatus, taxableSS = 0, retirementIncome = 0, primaryAge = 0, spouseAge = 0, isGovernmentPension = true) => {
  if (grossIncome <= 0) return 0;
  
  // Step 1: Start with gross income
  let alabamaAGI = grossIncome;
  
  // Step 2: Exclude Social Security (fully exempt in Alabama)
  alabamaAGI -= taxableSS;
  
  // Step 3: Exclude government/military pension income
  // Alabama exempts ALL defined-benefit pension income, plus government pensions broadly.
  // For simplicity we exempt the retirementIncome parameter (pension streams).
  if (isGovernmentPension) {
    alabamaAGI -= retirementIncome;
  }
  
  // Step 4: Over-65 retirement income exclusion ($6,000 per person)
  // Applies to distributions from retirement plans (401k, IRA) for those 65+
  let over65Exclusion = 0;
  if (primaryAge >= 65) over65Exclusion += ALABAMA_OVER_65_RETIREMENT_EXCLUSION;
  if (filingStatus === 'married_joint' && spouseAge >= 65) over65Exclusion += ALABAMA_OVER_65_RETIREMENT_EXCLUSION;
  alabamaAGI -= Math.min(over65Exclusion, Math.max(0, alabamaAGI));
  
  alabamaAGI = Math.max(0, alabamaAGI);
  
  // Step 5: Deduct federal income tax paid (Alabama is one of 3 states that allows this)
  // This creates a circular dependency that we resolve iteratively:
  // AL tax depends on federal deduction, which depends on AL taxable income.
  // In practice, federal tax is computed first and passed in.
  alabamaAGI = Math.max(0, alabamaAGI - federalTaxPaid);
  
  // Step 6: Alabama standard deduction (sliding scale based on AGI)
  const alStdDeduction = getAlabamaStandardDeduction(alabamaAGI, filingStatus);
  
  // Step 7: Personal exemption
  const personalExemption = ALABAMA_PERSONAL_EXEMPTION[filingStatus] || ALABAMA_PERSONAL_EXEMPTION.single;
  
  // Step 8: Taxable income
  const taxableIncome = Math.max(0, alabamaAGI - alStdDeduction - personalExemption);
  
  // Step 9: Apply progressive brackets
  const brackets = ALABAMA_TAX_BRACKETS[filingStatus] || ALABAMA_TAX_BRACKETS.single;
  let tax = 0;
  let remaining = taxableIncome;
  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const taxableInBracket = Math.min(remaining, bracket.max - bracket.min);
    tax += taxableInBracket * bracket.rate;
    remaining -= taxableInBracket;
  }
  
  return Math.max(0, tax);
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
  const inflationFactor = Math.pow(1 + inflationRate, yearsFromNow);
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

// ACA Federal Poverty Level 2025 (for subsidy calculations)
const ACA_FPL_2025 = {
  1: 15060, 2: 20440, 3: 25820, 4: 31200, 5: 36580, 6: 41960, 7: 47340, 8: 52720
};

// QCD (Qualified Charitable Distribution) constants
// QCDs allow direct IRA-to-charity transfers that satisfy RMD but aren't taxable income
const QCD_ANNUAL_LIMIT = 111000; // 2026 limit per person (indexed for inflation under SECURE 2.0; was 108k in 2025)
const QCD_START_AGE = 70; // Must be 70½ or older (we use 70 for simplicity)

// Social Security Earnings Test (2025 values, inflation-indexed)
// Before FRA: $1 withheld per $2 earned above limit
// Year of FRA: $1 withheld per $3 earned above higher limit (only months before FRA)
// After FRA: no limit
const SS_EARNINGS_TEST_LIMIT_2025 = 23400;     // Annual limit for years before FRA year
const SS_EARNINGS_TEST_FRA_LIMIT_2025 = 62160;  // Annual limit in the year you reach FRA

// Standard Medicare Part B premium (2025) — used to calculate IRMAA surcharge (amount ABOVE standard)
const MEDICARE_PART_B_STANDARD_2025 = 202.90; // 2026 standard Part B premium per month (CMS). Name kept for stability; value is 2026.

// States that tax Social Security benefits (2025/2026)
// Most have income-based exemptions, but we include them as "may tax SS"
// All other states with income tax exempt SS entirely
const STATES_THAT_TAX_SS = new Set([
  'Colorado', 'Connecticut', 'Minnesota', 'Montana',
  'New Mexico', 'Rhode Island', 'Utah', 'Vermont', 'West Virginia'
]);

// Calculate IRMAA premiums based on MAGI
const calculateIRMAA = (magi, filingStatus, yearsFromNow = 0, inflationRate = 0.03) => {
  // Head of household uses single thresholds per CMS rules
  const lookupStatus = filingStatus === 'head_of_household' ? 'single' : filingStatus;
  const thresholds = IRMAA_THRESHOLDS_2025[lookupStatus] || IRMAA_THRESHOLDS_2025.married_joint;
  const inflationFactor = Math.pow(1 + inflationRate, yearsFromNow);
  
  // Find the applicable tier
  for (const tier of thresholds) {
    const adjustedMax = tier.maxIncome === Infinity ? Infinity : tier.maxIncome * inflationFactor;
    if (magi <= adjustedMax) {
      return {
        partBMonthly: tier.partB,
        partDMonthly: tier.partD,
        partBAnnual: tier.partB * 12,
        partDAnnual: tier.partD * 12,
        totalAnnual: (tier.partB + tier.partD) * 12,
        tier: thresholds.indexOf(tier)
      };
    }
  }
  // Highest tier
  const lastTier = thresholds[thresholds.length - 1];
  return {
    partBMonthly: lastTier.partB,
    partDMonthly: lastTier.partD,
    partBAnnual: lastTier.partB * 12,
    partDAnnual: lastTier.partD * 12,
    totalAnnual: (lastTier.partB + lastTier.partD) * 12,
    tier: thresholds.length - 1
  };
};

// Calculate IRMAA SURCHARGE — the extra cost above the standard premium
// For married couples, each spouse 65+ pays their own surcharge
// Uses 2-year MAGI lookback (we approximate by using current year's MAGI)
const calculateIRMAASurcharge = (magi, filingStatus, yearsFromNow = 0, inflationRate = 0.03, numMedicareEligible = 1) => {
  const irmaa = calculateIRMAA(magi, filingStatus, yearsFromNow, inflationRate);
  const standardPartB = MEDICARE_PART_B_STANDARD_2025; // Not inflation-adjusted (CMS sets annually)
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
  
  const inflationFactor = Math.pow(1 + inflationRate, yearsFromNow);
  
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
const calculateSSBenefit = (pia, claimAge, birthYear) => {
  // Get Full Retirement Age (FRA)
  const fra = birthYear >= 1960 ? 67 : (SS_FULL_RETIREMENT_AGE[birthYear] || 67);
  
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
const getDefaultRothConversionWindow = (personalInfo) => {
  const retirementAge = personalInfo?.myRetirementAge ?? 65;
  const rmdAge = getRmdStartAge(personalInfo?.myBirthYear);
  return {
    startAge: retirementAge,
    endAge: rmdAge - 1,
  };
};

// Calculate ACA subsidy eligibility (simplified)
const calculateACASubsidy = (income, householdSize, filingStatus) => {
  const fpl = ACA_FPL_2025[Math.min(householdSize, 8)] || ACA_FPL_2025[2];
  const fplPercent = (income / fpl) * 100;
  
  // Subsidy cliff is at 400% FPL (after American Rescue Plan extension)
  // Enhanced subsidies available above 400% but phase out
  if (fplPercent < 100) {
    return { eligible: false, fplPercent, reason: 'Below 100% FPL - may qualify for Medicaid' };
  } else if (fplPercent <= 150) {
    return { eligible: true, fplPercent, premiumCap: 0, tier: 'Silver 94' };
  } else if (fplPercent <= 200) {
    return { eligible: true, fplPercent, premiumCap: 2.0, tier: 'Silver 87' };
  } else if (fplPercent <= 250) {
    return { eligible: true, fplPercent, premiumCap: 4.0, tier: 'Silver 73' };
  } else if (fplPercent <= 300) {
    return { eligible: true, fplPercent, premiumCap: 6.0, tier: 'Silver' };
  } else if (fplPercent <= 400) {
    return { eligible: true, fplPercent, premiumCap: 8.5, tier: 'Silver' };
  } else {
    return { eligible: true, fplPercent, premiumCap: 8.5, tier: 'Silver', note: 'Above 400% FPL - reduced subsidy' };
  }
};


// ── HEALTHCARE EXPENSE CALCULATOR ───────────────────────────────────────────────
// Unified function that computes annual healthcare costs for a given year.
// Called by the projection engine for each year — results flow into the year data.
const calculateHealthcareExpenses = (pi, myAge, spouseAge, yearsFromNow, primaryAlive, spouseAlive) => {
  if (pi.healthcareModel === 'none') {
    return { total: 0, pre65: 0, medicare: 0, ltc: 0, breakdown: null };
  }
  
  const medInflation = pi.medicalInflation || MEDICAL_INFLATION_RATE;
  const medInflationFactor = Math.pow(1 + medInflation, yearsFromNow);
  
  let pre65Cost = 0;
  let medicareCost = 0;
  let ltcCost = 0;
  const isMarried = pi.filingStatus === 'married_joint';
  
  // Determine who needs healthcare costs modeled
  const people = [];
  if (primaryAlive) people.push({ age: myAge, label: 'me', lifeExp: pi.myLifeExpectancy || 85 });
  if (spouseAlive && isMarried) people.push({ age: spouseAge, label: 'spouse', lifeExp: pi.spouseLifeExpectancy || 87 });
  
  people.forEach(person => {
    if (person.age < 65) {
      // PRE-MEDICARE: ACA/employer healthcare
      const annualPre65 = (pi.pre65HealthcareAnnual || PRE_65_HEALTHCARE_ANNUAL_2025);
      pre65Cost += annualPre65 * medInflationFactor;
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
    breakdown: { numPeople: people.length, pre65Count: people.filter(p => p.age < 65).length, medicareCount: people.filter(p => p.age >= 65).length }
  };
};

// ── RECURRING EXPENSE CALCULATOR ────────────────────────────────────────────────
// Computes total recurring expenses for a given year based on the expense list.
const calculateRecurringExpenses = (expenses, myAge, spouseAge, yearsFromNow, generalInflation) => {
  if (!expenses || expenses.length === 0) return { total: 0, byCategory: {} };
  
  let total = 0;
  const byCategory = {};
  
  expenses.forEach(exp => {
    const ownerAge = exp.owner === 'spouse' ? spouseAge : myAge;
    if (ownerAge >= exp.startAge && ownerAge <= exp.endAge) {
      const expInflation = exp.inflationRate !== undefined ? exp.inflationRate : generalInflation;
      const inflationFactor = Math.pow(1 + expInflation, yearsFromNow);
      const adjustedAmount = exp.amount * inflationFactor;
      total += adjustedAmount;
      const cat = exp.category || 'other';
      byCategory[cat] = (byCategory[cat] || 0) + adjustedAmount;
    }
  });
  
  return { total: Math.round(total), byCategory };
};

const MEDICARE_PART_B_PREMIUM_2025 = 202.90; // Monthly Part B base premium (2026, CMS)
const MEDICARE_PART_D_PREMIUM_2025 = 39;     // Avg monthly Part D base premium (2026; national base ~$38.99)
const MEDICARE_SUPPLEMENT_PREMIUM_2025 = 175; // Avg monthly Medigap premium (2025)
const MEDICARE_OOP_ANNUAL_2025 = 2000;       // Avg annual out-of-pocket (copays, dental, vision)
const PRE_65_HEALTHCARE_ANNUAL_2025 = 12000; // Avg annual ACA/employer premium for one person
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

const calculateFederalTax = (grossIncome, filingStatus, yearsFromNow = 0, inflationRate = 0.03) => {
  const baseBrackets = FEDERAL_TAX_BRACKETS_2026[filingStatus] || FEDERAL_TAX_BRACKETS_2026.married_joint;
  const baseDeduction = STANDARD_DEDUCTION_2026[filingStatus] || STANDARD_DEDUCTION_2026.married_joint;
  
  // Adjust standard deduction and brackets for inflation
  const inflationFactor = Math.pow(1 + inflationRate, yearsFromNow);
  const adjustedDeduction = baseDeduction * inflationFactor;
  
  // Apply standard deduction
  const taxableIncome = Math.max(0, grossIncome - adjustedDeduction);
  
  // Adjust brackets for inflation
  const adjustedBrackets = baseBrackets.map(bracket => ({
    min: bracket.min * inflationFactor,
    max: bracket.max === Infinity ? Infinity : bracket.max * inflationFactor,
    rate: bracket.rate
  }));
  
  let tax = 0;
  let remainingIncome = taxableIncome;
  for (const bracket of adjustedBrackets) {
    if (remainingIncome <= 0) break;
    const taxableInBracket = Math.min(remainingIncome, bracket.max - bracket.min);
    tax += taxableInBracket * bracket.rate;
    remainingIncome -= taxableInBracket;
  }
  return tax;
};

const calculateStateTax = (grossIncome, state, filingStatus, yearsFromNow = 0, inflationRate = 0.03, taxableSS = 0, retirementIncome = 0, extraParams = {}) => {
  // ── ALABAMA: Use full progressive engine with federal tax deductibility ──
  if (state === 'Alabama') {
    // Alabama requires federal tax paid (for deductibility) and ages (for over-65 exclusion).
    // These are passed via extraParams from the projection engine.
    // When called from contexts that don't supply them, we estimate federal tax here.
    const federalTaxPaid = extraParams.federalTaxPaid !== undefined 
      ? extraParams.federalTaxPaid 
      : calculateFederalTax(grossIncome, filingStatus, yearsFromNow, inflationRate);
    const primaryAge = extraParams.primaryAge || 0;
    const spouseAge = extraParams.spouseAge || 0;
    
    return calculateAlabamaTax(
      grossIncome, federalTaxPaid, filingStatus, taxableSS, retirementIncome,
      primaryAge, spouseAge, true // isGovernmentPension default true
    );
  }
  
  // ── ALL OTHER STATES: Simplified flat-rate approximation ──
  // Apply inflation-adjusted standard deduction for state tax too (simplified)
  const baseDeduction = STANDARD_DEDUCTION_2026[filingStatus] || STANDARD_DEDUCTION_2026.married_joint;
  const inflationFactor = Math.pow(1 + inflationRate, yearsFromNow);
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
const calculateRMD = (balance, age, birthYear) => {
  // Determine RMD start age based on birth year (SECURE 2.0 Act rules)
  // Confirmed by IRS final regulations (July 2024)
  let rmdStartAge = 73; // Default for those born 1951-1959
  
  if (birthYear >= 1960) {
    rmdStartAge = 75; // Age 75 for those born 1960 or later
  } else if (birthYear <= 1950) {
    rmdStartAge = 72; // Age 72 for those born 1950 or earlier
  }
  // Note: Those born in 1959 have RMD age of 73 (IRS clarified the SECURE 2.0 drafting error)
  
  // No RMD required before start age
  if (age < rmdStartAge) return 0;
  
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
  const inflationFactor = Math.pow(1 + inflationRate, yearsFromNow);
  
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

function computeProjections(pi, accts, streams, assetList, events = [], recurringExpensesList = [], currentYearArg, opts = {}) {
  // currentYear used to be captured from RetirementPlanner's closure. It's now an
  // explicit parameter (with a fallback) so this function can be moved to module
  // scope and run in a Web Worker.
  const currentYear = currentYearArg !== undefined ? currentYearArg : new Date().getFullYear();
  // opts.yearOverrides: optional array indexed by yearsFromNow (0 = currentYear).
  // Each slot is null/undefined (use deterministic cagr + pi.inflationRate) or
  // { marketReturn, inflation } to drive Monte Carlo / historical sequence runs.
  const yearOverrides = opts.yearOverrides;
  const years = [];
  let accountBalances = accts.reduce((acc, account) => ({ ...acc, [account.id]: account.balance }), {});
  
  // Track reinvested excess RMDs when no brokerage account exists
  // This prevents excess RMDs from vanishing — they grow at a conservative rate
  let excessReinvestmentPool = 0;
  const reinvestmentGrowthRate = 0.06; // Conservative brokerage-like return
  
  // Use legacyAge as the planning horizon (default 95 if not set)
  const planningAge = pi.legacyAge || MAX_AGE;
  
  // Pre-calculate inflation factors for better performance.
  // Cumulative product so per-year overrides (MC / historical) can replace
  // pi.inflationRate one year at a time. When yearOverrides is absent, this is
  // mathematically identical to Math.pow(1 + pi.inflationRate, i).
  const maxYears = planningAge - pi.myAge + 1;
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
  const primarySSStream = streams.find(s => s.type === 'social_security' && s.owner === 'me');
  const spouseSSStream = streams.find(s => s.type === 'social_security' && s.owner === 'spouse');
  const primarySSAmount = primarySSStream ? primarySSStream.amount : 0;
  const spouseSSAmount = spouseSSStream ? spouseSSStream.amount : 0;
  
  for (let year = currentYear; year <= currentYear + (planningAge - pi.myAge); year++) {
    const myAge = pi.myAge + (year - currentYear);
    const spouseAge = pi.spouseAge + (year - currentYear);
    const yearsFromNow = year - currentYear;
    
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
    
    // Use pre-calculated inflation factor
    const inflationFactor = inflationFactors[yearsFromNow] || Math.pow(1 + pi.inflationRate, yearsFromNow);
    const desiredIncome = pi.desiredRetirementIncome * inflationFactor;
    
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
            const yearsFromStart = ownerAge - stream.startAge;
            const adjustedAmount = stream.amount * Math.pow(1 + (stream.cola || 0), yearsFromStart) * survivorRate;
            totalPension += adjustedAmount;
            nonSSIncome += adjustedAmount;
          }
        }
        // Social Security for deceased is handled separately via survivor benefit below
        return; // Skip all other income from deceased
      }
      
      if (ownerAge >= stream.startAge && ownerAge <= stream.endAge) {
        const yearsFromStart = ownerAge - stream.startAge;
        const adjustedAmount = stream.amount * Math.pow(1 + (stream.cola || 0), yearsFromStart);
        
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
        const yearsFromStart = survivorAge - survivorStream.startAge;
        const currentOwnSS = survivorStream.amount * Math.pow(1 + (survivorStream.cola || 0), yearsFromStart);
        // Approximation: apply same number of COLA years to the deceased's benefit.
        // (More precise would track each spouse's actual claim date and COLA history.)
        const inheritedSS = deceasedSSBenefit * Math.pow(1 + deceasedCOLA, yearsFromStart);
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
          const yearsFromDeceasedStart = Math.max(0, survivorAge - deceasedStream.startAge);
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
        const ownerFRA = ownerBirthYear >= 1960 ? 67 : (SS_FULL_RETIREMENT_AGE[ownerBirthYear] || 67);
        const ownerEarned = stream.owner === 'me' ? myEarnedIncome : spouseEarnedIncome;
        
        if (ownerAge >= stream.startAge && ownerAge < ownerFRA && ownerEarned > 0) {
          const reduction = calculateSSEarningsTestReduction(ownerEarned, ownerAge, ownerFRA, yearsFromNow, pi.inflationRate);
          // Can't reduce more than the SS benefit itself
          const yearsFromStart = ownerAge - stream.startAge;
          const thisBenefit = stream.amount * Math.pow(1 + (stream.cola || 0), yearsFromStart);
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
    
    // Calculate FICA (employee share) on earned income — per-person for correct wage base application
    const myFICA = calculateFICA(myEarnedIncome, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
    const spouseFICA = calculateFICA(spouseEarnedIncome, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
    const totalFICA = myFICA.total + spouseFICA.total;
    
    // Calculate the taxable portion of Social Security benefits
    // This must be done AFTER we know total SS and other income
    const taxableSS = calculateSocialSecurityTaxableAmount(
      totalSocialSecurity, 
      nonSSIncome, 
      effectiveFilingStatus
    );
    
    // Now calculate total taxable income including properly-taxed SS
    const totalTaxableIncome = nonSSIncome + taxableSS;
    
    // First pass: add contributions and calculate RMDs (before growth)
    let totalRMD = 0;
    const accountRMDs = {}; // Track RMD per account
    let preTaxContributions = 0; // Track pre-tax (401k/403b/457b/IRA) contributions for tax deduction
    const accountContributions = {}; // Track contribution per account for display
    
    accts.forEach(account => {
      accountContributions[account.id] = 0; // Initialize
      const ownerAge = account.owner === 'me' ? myAge : account.owner === 'spouse' ? spouseAge : Math.max(myAge, spouseAge);
      const yearsContributing = ownerAge - account.startAge;
      const contributionGrowth = account.contributionGrowth || 0;
      const ownerAlive = account.owner === 'me' ? primaryAlive : account.owner === 'spouse' ? spouseAlive : (primaryAlive || spouseAlive);
      
      // Add contributions if in contribution period AND owner is alive
      if (ownerAlive && ownerAge >= account.startAge && ownerAge < account.stopAge) {
        const adjustedContribution = account.contribution * Math.pow(1 + contributionGrowth, Math.max(0, yearsContributing));
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
        const contributorRole = account.contributor || 'me';
        if (isPreTaxAccount(account.type) && adjustedContribution > 0 &&
            (contributorRole === 'me' || contributorRole === 'spouse')) {
          preTaxContributions += adjustedContribution;
        }
      }
      
      // Calculate RMD for pre-tax accts using constant
      if (isPreTaxAccount(account.type)) {
        // Get birth year based on account owner
        const ownerBirthYear = account.owner === 'me' 
          ? pi.myBirthYear 
          : account.owner === 'spouse' 
          ? pi.spouseBirthYear 
          : pi.myBirthYear; // Default to primary owner for joint accts
        
        const rmd = calculateRMD(accountBalances[account.id], ownerAge, ownerBirthYear);
        accountRMDs[account.id] = rmd;
        totalRMD += rmd;
      }
    });
    
    // ── PRE-TAX CONTRIBUTION DEDUCTION ──────────────────────────────────────────
    // Pre-tax 401k/403b/457b/IRA contributions are above-the-line deductions that
    // reduce AGI and therefore federal/state taxable income.
    // Note: For SS taxation, IRS uses MAGI which adds these back, so the taxableSS
    // calculation above (using gross nonSSIncome) is correct.
    // We cap the deduction at earned income (can't deduct more than you earn).
    const preTaxDeduction = Math.min(preTaxContributions, earnedIncome);
    
    // Adjusted taxable income after pre-tax contribution deduction
    // totalTaxableIncome was computed as nonSSIncome + taxableSS (gross)
    // Now subtract the pre-tax deduction for the actual taxable income
    const totalTaxableIncome_adjusted = totalTaxableIncome - preTaxDeduction;
    
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
      const growthRate = yrOverride ? yrOverride.marketReturn : (account.cagr || 0);
      const halfGrowth = Math.pow(1 + growthRate, 0.5);
      accountBalances[account.id] = Math.max(0, accountBalances[account.id]) * halfGrowth;
    });
    const poolGrowthRate = yrOverride ? yrOverride.marketReturn : reinvestmentGrowthRate;
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
    
    const totalGuaranteedIncome = totalSocialSecurity + totalPension + totalOtherIncome;
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
    
    // Determine if we're in retirement based on age (not earned income)
    // This allows for part-time work during retirement while still supplementing from portfolio
    const isRetired = myAge >= pi.myRetirementAge;
    
    // Adjust desired income for one-time events:
    // - Expenses increase what we need to withdraw
    // - Non-taxable income (inheritance, gift) directly reduces withdrawal need
    // - Taxable one-time income already added to nonSSIncome above
    
    // ── HEALTHCARE EXPENSES (unified model) ─────────────────────────────────────
    const healthcareResult = calculateHealthcareExpenses(pi, myAge, spouseAge, yearsFromNow, primaryAlive, spouseAlive);
    const healthcareExpense = healthcareResult.total;
    
    // ── RECURRING EXPENSES (categorized, with per-item inflation) ───────────────
    const recurringResult = calculateRecurringExpenses(recurringExpensesList, myAge, spouseAge, yearsFromNow, pi.inflationRate);
    const totalRecurringExpenses = recurringResult.total;
    
    // Adjusted desired income includes: base retirement spending + one-time expenses
    // + healthcare + recurring expense items
    const adjustedDesiredIncome = desiredIncome + oneTimeExpenseTotal + healthcareExpense + totalRecurringExpenses;
    
    // If retired, calculate portfolio withdrawal needs to meet desired income
    if (isRetired) {
      // Calculate taxes on guaranteed income + any earned income first
      const baseGrossIncome = totalTaxableIncome_adjusted; // Adjusted for pre-tax contributions
      const baseFederalTax = calculateFederalTax(baseGrossIncome, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
      // For state tax, pension is retirement income exempt in some states (e.g., Alabama)
      const baseRetirementIncome = totalPension;
      const baseStateTax = calculateStateTax(baseGrossIncome, pi.state, effectiveFilingStatus, yearsFromNow, pi.inflationRate, taxableSS, baseRetirementIncome, { federalTaxPaid: baseFederalTax, primaryAge: myAge, spouseAge: spouseAge });
      
      // Net income from guaranteed sources + earned income + non-taxable one-time income
      const netCurrentIncome = totalGuaranteedIncome + earnedIncome + oneTimeNontaxableIncome - baseFederalTax - baseStateTax - totalFICA;
      
      // Estimate IRMAA surcharge (Medicare premium increases for high earners)
      // This is an out-of-pocket cost that must be covered by withdrawals
      // Use base MAGI as starting estimate; actual IRMAA recalculated after final MAGI known
      let estimatedIRMAA = 0;
      let estMedicareEligible = 0;
      if (primaryAlive && myAge >= 65) estMedicareEligible++;
      if (effectiveFilingStatus === 'married_joint' && spouseAlive && spouseAge >= 65) estMedicareEligible++;
      if (estMedicareEligible > 0) {
        const baseMAGI = baseGrossIncome; // Pre-withdrawal MAGI estimate
        estimatedIRMAA = calculateIRMAASurcharge(baseMAGI, effectiveFilingStatus, yearsFromNow, pi.inflationRate, estMedicareEligible).totalSurcharge;
      }
      
      // How much more do we need after taxes to hit desired income?
      // Include IRMAA as an additional cost that must be covered
      const afterTaxGap = Math.max(0, adjustedDesiredIncome + estimatedIRMAA - netCurrentIncome);
      
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
        let preTax = 0, gains = 0;
        const bal = {};
        accts.forEach(a => {
          bal[a.id] = accountBalances[a.id];
          if (isPreTaxAccount(a.type)) bal[a.id] = Math.max(0, bal[a.id] - (accountRMDs[a.id] || 0));
        });
        let pool = excessReinvestmentPool;
        for (const category of solverPriority) {
          if (need <= 0) break;
          const types = solverAccountTypes(category);
          accts.forEach(a => {
            if (types.includes(a.type) && need > 0) {
              const w = Math.min(bal[a.id], need);
              bal[a.id] -= w; need -= w;
              if (isPreTaxAccount(a.type)) preTax += w;
              else if (isBrokerageAccount(a.type)) {
                const basisPct = (a.costBasisPercent !== undefined && a.costBasisPercent !== null) ? a.costBasisPercent : BROKERAGE_COST_BASIS_ESTIMATE;
                gains += w * (1 - basisPct);
              }
              // roth / hsa: tax-free, contributes nothing to taxable income
            }
          });
          if (category === 'brokerage' && need > 0 && pool > 0) {
            const pw = Math.min(pool, need); pool -= pw; need -= pw;
            gains += pw * 0.20; // reinvestment pool is basis-heavy (≈80% basis)
          }
        }
        return { preTax, gains };
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
          const estimatedGains = draw.gains;                          // realized long-term capital gains

          // Calculate QCD if applicable (reduces taxable ordinary income)
          let estimatedQCD = 0;
          if (canDoQCD) {
            estimatedQCD = Math.min(charitableGiving, totalPreTaxFromWithdrawals, householdQCDLimit);
          }

          // Taxable ordinary portion of withdrawals (pre-tax minus QCD)
          const taxableWithdrawals = Math.max(0, totalPreTaxFromWithdrawals - estimatedQCD);

          // SS taxable amount uses "combined income" which INCLUDES capital gains (IRS Pub 915).
          const adjustedNonSSIncome = nonSSIncome + taxableWithdrawals + estimatedGains;
          const adjustedTaxableSS = calculateSocialSecurityTaxableAmount(
            totalSocialSecurity, adjustedNonSSIncome, effectiveFilingStatus
          );
          // Federal ORDINARY tax base EXCLUDES capital gains (taxed at preferential LTCG rates below).
          const ordinaryBaseGross = nonSSIncome + taxableWithdrawals + adjustedTaxableSS;
          const totalFedOrdinary = calculateFederalTax(ordinaryBaseGross, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
          // LTCG tax on realized gains, stacked above ordinary taxable income.
          const iterAdjDeduction = (STANDARD_DEDUCTION_2026[effectiveFilingStatus] || STANDARD_DEDUCTION_2026.married_joint) * inflationFactor;
          const estCapGainsTax = calculateCapitalGainsTax(
            estimatedGains, Math.max(0, ordinaryBaseGross - iterAdjDeduction) + estimatedGains,
            effectiveFilingStatus, yearsFromNow, pi.inflationRate
          );
          const totalFedTax = totalFedOrdinary + estCapGainsTax;
          // Retirement income for state exemption: pension only (401k/IRA withdrawals are NOT exempt).
          // State taxes capital gains as ordinary income → use the gains-inclusive base.
          const iterRetirementIncome = totalPension;
          const totalStateTax = calculateStateTax(adjustedNonSSIncome + adjustedTaxableSS, pi.state, effectiveFilingStatus, yearsFromNow, pi.inflationRate, adjustedTaxableSS, iterRetirementIncome, { federalTaxPaid: totalFedOrdinary, primaryAge: myAge, spouseAge: spouseAge });

          // Tax attributable to the withdrawal = total tax minus tax on guaranteed income alone.
          const withdrawalFedTax = totalFedTax - baseFederalTax;
          const withdrawalStateTax = totalStateTax - baseStateTax;
          const withdrawalTax = withdrawalFedTax + withdrawalStateTax;
          
          // Net income from this withdrawal
          const netFromWithdrawal = testWithdrawal - withdrawalTax;
          
          // How far off are we?
          const shortfall = afterTaxGap - netFromWithdrawal;
          
          // Adjust withdrawal
          if (Math.abs(shortfall) < 10) break; // Close enough
          testWithdrawal += shortfall;
          testWithdrawal = Math.max(0, testWithdrawal); // Don't go negative
        }
        
        withdrawalNeeded = testWithdrawal;
        portfolioWithdrawal = Math.max(totalRMD, withdrawalNeeded);
      } else {
        withdrawalNeeded = 0;
        portfolioWithdrawal = totalRMD;
      }
      
      // Store actual withdrawal needed for excess RMD calculation
      actualWithdrawalNeeded = withdrawalNeeded;
    } else {
      // Still pre-retirement - just ensure RMDs are taken if required, no extra withdrawals
      portfolioWithdrawal = totalRMD;
      actualWithdrawalNeeded = 0; // Pre-retirement, we don't need portfolio withdrawals for spending
      // Taxes will be calculated after actual withdrawals are made
    }
    
    // Excess RMD is the RMD amount that exceeds what we actually need for spending
    // Pre-retirement, ALL of the RMD is "excess" since we don't need it for spending
    let excessRMD = Math.max(0, totalRMD - actualWithdrawalNeeded);
    
    // Now actually withdraw from accts
    // Step 1: Withdraw RMDs from pre-tax accts (mandatory - regardless of priority)
    accts.forEach(account => {
      if (isPreTaxAccount(account.type)) {
        const rmd = accountRMDs[account.id] || 0;
        if (rmd > 0) {
          accountBalances[account.id] = Math.max(0, accountBalances[account.id] - rmd);
        }
      }
    });
    
    // Step 2: If RETIRED and we need more than RMD, withdraw based on user's priority
    // Pre-retirement, we do NOT withdraw extra even if income < desired spending
    let additionalNeeded = isRetired ? Math.max(0, actualWithdrawalNeeded - totalRMD) : 0;
    
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
    // Track withdrawals by type for proper tax treatment
    let preTaxWithdrawals = 0;
    let brokerageWithdrawals = 0;
    let rothWithdrawals = 0;
    // Per-account cost-basis tracking: each brokerage account can have its own
    // costBasisPercent (e.g. 0.30 for an old account with deep gains, 0.95 for a new one).
    // We accumulate the actual capital gains and basis recovered to use them in tax calc.
    let brokerageCapitalGains = 0;
    let brokerageBasisRecovered = 0;
    // HSA withdrawals for qualified medical expenses are tax-free (not tracked for tax)
    
    for (const category of priority) {
      if (additionalNeeded <= 0) break;
      const categoryAccountTypes = getAccountTypes(category);
      accts.forEach(account => {
        if (categoryAccountTypes.includes(account.type) && additionalNeeded > 0) {
          const withdrawal = Math.min(accountBalances[account.id], additionalNeeded);
          accountBalances[account.id] -= withdrawal;
          additionalNeeded -= withdrawal;
          
          // Track withdrawal by type for tax purposes
          // HSA withdrawals for qualified medical expenses are tax-free
          if (isPreTaxAccount(account.type)) {
            preTaxWithdrawals += withdrawal;
          } else if (isBrokerageAccount(account.type)) {
            brokerageWithdrawals += withdrawal;
            // Apply this account's specific cost basis (default 0.50 if not set)
            const basisPct = (account.costBasisPercent !== undefined && account.costBasisPercent !== null)
              ? account.costBasisPercent
              : BROKERAGE_COST_BASIS_ESTIMATE;
            brokerageBasisRecovered += withdrawal * basisPct;
            brokerageCapitalGains += withdrawal * (1 - basisPct);
          } else if (isRothAccount(account.type) || isHSAAccount(account.type)) {
            rothWithdrawals += withdrawal; // Both Roth and HSA (qualified) are tax-free
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
    
    // Step 2.5: Calculate ACTUAL taxes based on withdrawal composition
    // Now that we know which accts were tapped, calculate proper taxes
    // Pre-tax withdrawals (including RMDs) are ordinary income
    // Brokerage withdrawals: assume cost basis is tax-free, remainder is long-term capital gains

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
        // Bracket-fill mode: convert up to the top of the chosen bracket.
        // We must account for ALL taxable income already recognized this year:
        //   - nonSSIncome: earned income + pension + other income
        //   - totalRMD: mandatory pre-tax distributions (ordinary income, tracked separately)
        //   - preTaxWithdrawals: additional voluntary pre-tax withdrawals for spending
        //   - taxable SS: recalculated with the full non-SS income base including all withdrawals
        const baseBrackets = FEDERAL_TAX_BRACKETS_2026[effectiveFilingStatus] || FEDERAL_TAX_BRACKETS_2026.married_joint;
        const baseDeduction = STANDARD_DEDUCTION_2026[effectiveFilingStatus] || STANDARD_DEDUCTION_2026.married_joint;
        const adjDeduction = baseDeduction * inflationFactor;

        // Full non-SS income base: everything taxable EXCEPT SS and the conversion itself.
        // RMDs are ordinary income but tracked in totalRMD separately from preTaxWithdrawals
        // (which only holds additional voluntary pre-tax withdrawals beyond the RMD).
        const fullNonSSIncome = nonSSIncome + totalRMD + preTaxWithdrawals;
        // Recalculate SS taxable with the full income base (withdrawals push more SS into taxable range)
        const taxableSSWithWithdrawals = calculateSocialSecurityTaxableAmount(totalSocialSecurity, fullNonSSIncome, effectiveFilingStatus);
        const currentTaxable = Math.max(0, fullNonSSIncome + taxableSSWithWithdrawals - adjDeduction);

        const bracketIdx = conversionBracket === '12%' ? 1 : conversionBracket === '22%' ? 2 : conversionBracket === '24%' ? 3 : conversionBracket === '32%' ? 4 : 2;
        const bracketCap = baseBrackets[bracketIdx].max * inflationFactor;
        targetConversion = Math.max(0, bracketCap - currentTaxable);
      } else if (conversionAmount > 0) {
        // Fixed-amount mode: inflate the nominal amount
        targetConversion = conversionAmount * inflationFactor;
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
            const preConvGross = totalTaxableIncome_adjusted;
            const postConvGross = preConvGross + rothConversionThisYear;
            const preConvFed = calculateFederalTax(preConvGross, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
            const postConvFed = calculateFederalTax(postConvGross, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
            const preConvState = calculateStateTax(preConvGross, pi.state, effectiveFilingStatus, yearsFromNow, pi.inflationRate, taxableSS, totalPension, { federalTaxPaid: preConvFed, primaryAge: myAge, spouseAge: spouseAge });
            const postConvState = calculateStateTax(postConvGross, pi.state, effectiveFilingStatus, yearsFromNow, pi.inflationRate, taxableSS, totalPension, { federalTaxPaid: postConvFed, primaryAge: myAge, spouseAge: spouseAge });
            let conversionTaxNeeded = (postConvFed - preConvFed) + (postConvState - preConvState);

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
                  if (isPreTaxAccount(account.type)) {
                    preTaxWithdrawals += w;
                  } else if (isBrokerageAccount(account.type)) {
                    brokerageWithdrawals += w;
                    const basisPct = (account.costBasisPercent !== undefined && account.costBasisPercent !== null)
                      ? account.costBasisPercent
                      : BROKERAGE_COST_BASIS_ESTIMATE;
                    brokerageBasisRecovered += w * basisPct;
                    brokerageCapitalGains += w * (1 - basisPct);
                  } else if (isRothAccount(account.type) || isHSAAccount(account.type)) {
                    rothWithdrawals += w;
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
      
      // QCD can come from any IRA withdrawal (RMD or voluntary)
      // Total pre-tax withdrawals available for QCD = RMD + any additional pre-tax withdrawals
      const totalPreTaxAvailable = totalRMD + preTaxWithdrawals;
      
      // Check if there are pre-tax accts with balance to do QCD from
      const totalPreTaxBalanceForQCD = accts
        .filter(a => isPreTaxAccount(a.type))
        .reduce((sum, a) => sum + (accountBalances[a.id] || 0), 0);
      
      // QCD is limited to:
      // 1. The charitable giving amount (what you want to give)
      // 2. Available pre-tax balance (need IRA funds to do QCD)
      // 3. The annual QCD limit
      // Note: We can do QCD even if there's no RMD yet (age 70-74)
      if (totalPreTaxBalanceForQCD > 0) {
        qcdAmount = Math.min(charitableGiving, totalPreTaxBalanceForQCD, householdQCDLimit);
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
    const finalNonSSIncome = nonSSIncome + ordinaryIncomeFromWithdrawals + capitalGainsFromWithdrawals;
    const finalTaxableSS = calculateSocialSecurityTaxableAmount(
      totalSocialSecurity, finalNonSSIncome, effectiveFilingStatus
    );
    finalTotalTaxableIncome = finalNonSSIncome + finalTaxableSS - preTaxDeduction; // Updates outer-scope let variable
    finalTaxableSS_out = finalTaxableSS; // Update outer-scope for year push

    // ── FEDERAL ORDINARY TAX ───────────────────────────────────────────────────
    // Capital gains receive preferential federal rates, so they must NOT be taxed at
    // ordinary bracket rates. Remove them from the ordinary base here; the LTCG tax is
    // added separately below. (Previously the gains were left in this base AND taxed again
    // via calculateCapitalGainsTax — double taxation that materially overstated federal tax.)
    const federalOrdinaryTaxableIncome = Math.max(0, finalTotalTaxableIncome - capitalGainsFromWithdrawals);
    federalTax = calculateFederalTax(federalOrdinaryTaxableIncome, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
    // Retirement income exempt in some states: pension only (401k/IRA withdrawals are NOT exempt)
    const finalRetirementIncome = totalPension;
    // For IL/MS/PA, ALL qualified retirement distributions (pre-tax 401k/IRA + RMDs) are also
    // exempt — pass that figure via extraParams so calculateStateTax can subtract it (B9).
    const qualifiedRetirementWithdrawals = preTaxWithdrawals + totalRMD;
    // Pass extraParams for Alabama progressive tax engine (federal deductibility, age-based exclusions)
    const stateExtraParams = { federalTaxPaid: federalTax, primaryAge: myAge, spouseAge: spouseAge, qualifiedRetirementWithdrawals };
    stateTax = calculateStateTax(finalTotalTaxableIncome, pi.state, effectiveFilingStatus, yearsFromNow, pi.inflationRate, finalTaxableSS, finalRetirementIncome, stateExtraParams);
    
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
    const baseDeduction = STANDARD_DEDUCTION_2026[effectiveFilingStatus] || STANDARD_DEDUCTION_2026.married_joint;
    const adjustedDeduction = baseDeduction * inflationFactor;
    const taxableOrdinaryIncome = Math.max(0, federalOrdinaryTaxableIncome - adjustedDeduction);
    
    // Add capital gains tax on brokerage withdrawals using tiered rates (0%/15%/20%)
    const capitalGainsTax = calculateCapitalGainsTax(
      capitalGainsFromWithdrawals, 
      taxableOrdinaryIncome + capitalGainsFromWithdrawals,
      effectiveFilingStatus,
      yearsFromNow,
      pi.inflationRate
    );
    federalTax += capitalGainsTax;
    
    // Add NIIT (3.8% surtax) for high earners on investment income
    // Investment income includes: realized capital gains + dividends/interest from
    // the entire brokerage portfolio (not just the withdrawn portion).
    // Use a 2% dividend/interest yield on the start-of-year brokerage balance
    // (totalBrokerageBalance was computed before withdrawals).
    const dividendYieldEstimate = 0.02;
    const totalInvestmentIncome = capitalGainsFromWithdrawals + (totalBrokerageBalance * dividendYieldEstimate);
    // MAGI ≈ AGI with certain deductions added back. finalTotalTaxableIncome already
    // includes capital gains and the taxable portion of SS, with the pre-tax contribution
    // deduction removed — so we add only that deduction back here. (Capital gains are ALREADY
    // in finalTotalTaxableIncome; the previous code added them a second time, overstating
    // MAGI and pushing IRMAA tiers / NIIT too high whenever there were brokerage gains.)
    const magi = finalTotalTaxableIncome + preTaxDeduction;
    const niitTax = calculateNIIT(totalInvestmentIncome, magi, effectiveFilingStatus);
    federalTax += niitTax;
    
    // ── MEDICARE IRMAA SURCHARGE ──────────────────────────────────────────────
    // IRMAA adds surcharges to Part B and Part D premiums for high-income beneficiaries.
    // Based on MAGI (uses 2-year lookback in reality; we use current year as approximation).
    // Each Medicare-eligible person (age 65+) pays their own surcharge.
    let irmaaSurcharge = 0;
    let irmaaInfo = null; // IRMAA tier detail for display components
    let numMedicareEligible = 0;
    if (primaryAlive && myAge >= 65) numMedicareEligible++;
    if (effectiveFilingStatus === 'married_joint' && spouseAlive && spouseAge >= 65) numMedicareEligible++;
    if (numMedicareEligible > 0) {
      const irmaaResult = calculateIRMAASurcharge(magi, effectiveFilingStatus, yearsFromNow, pi.inflationRate, numMedicareEligible);
      irmaaSurcharge = irmaaResult.totalSurcharge;
      // Store IRMAA detail for display components (avoids independent recalculation)
      const irmaaDetail = calculateIRMAA(magi, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
      irmaaInfo = { tier: irmaaDetail.tier, totalAnnual: irmaaDetail.totalAnnual, 
        partBAnnual: irmaaDetail.partBAnnual, partDAnnual: irmaaDetail.partDAnnual,
        partBMonthly: irmaaDetail.partBMonthly, partDMonthly: irmaaDetail.partDMonthly };
      // Calculate distance to next IRMAA tier
      const lookupStatus = effectiveFilingStatus === 'head_of_household' ? 'single' : effectiveFilingStatus;
      const tiers = IRMAA_THRESHOLDS_2025[lookupStatus] || IRMAA_THRESHOLDS_2025.married_joint;
      const inflFactor = Math.pow(1 + pi.inflationRate, yearsFromNow);
      for (const tier of tiers) {
        const adjMax = tier.maxIncome === Infinity ? Infinity : tier.maxIncome * inflFactor;
        if (magi < adjMax) {
          irmaaInfo.distToNextTier = Math.round(adjMax - magi);
          break;
        }
      }
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
      const fedOrdinaryWithoutExcess = Math.max(0, nonSSWithoutExcess - capitalGainsFromWithdrawals + taxableSSWithoutExcess - preTaxDeduction);
      const fedTaxWithoutExcess = calculateFederalTax(fedOrdinaryWithoutExcess, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
      const fedTaxWithExcess = calculateFederalTax(federalOrdinaryTaxableIncome, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
      // State: gains-inclusive base, without the excess RMD (compare against the already-
      // computed `stateTax`, which is the gains-inclusive with-excess figure).
      const stateBaseWithoutExcess = Math.max(0, nonSSWithoutExcess + taxableSSWithoutExcess - preTaxDeduction);
      const stateTaxWithoutExcess = calculateStateTax(
        stateBaseWithoutExcess, pi.state, effectiveFilingStatus, yearsFromNow, pi.inflationRate,
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
      const growthRate = yrOverride ? yrOverride.marketReturn : (account.cagr || 0);
      const halfGrowth = Math.pow(1 + growthRate, 0.5);
      accountBalances[account.id] = Math.max(0, accountBalances[account.id]) * halfGrowth;
    });
    // Grow the excess reinvestment pool's remaining half (for users without brokerage accounts)
    const poolGrowthRate2 = yrOverride ? yrOverride.marketReturn : reinvestmentGrowthRate;
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
    
    // Weighted average growth rate across all accounts (for CoastFIRE, Withdrawal Strategies)
    const totalPortfolioForWeighting = finalPreTaxBalance + finalRothBalance + finalBrokerageBalance;
    let weightedCAGR = 0.07; // fallback
    if (totalPortfolioForWeighting > 0) {
      let weightedSum = 0;
      accts.forEach(a => { weightedSum += (accountBalances[a.id] || 0) * a.cagr; });
      weightedCAGR = weightedSum / totalPortfolioForWeighting;
    }
    
    // Calculate non-liquid assetList (for legacy planning)
    let totalAssetValue = 0;
    let totalAssetDebt = 0;
    assetList.forEach(asset => {
      const assetValue = asset.value * Math.pow(1 + (asset.appreciationRate || 0), yearsFromNow);
      totalAssetValue += Math.max(0, assetValue); // Don't go negative for depreciating assetList
      
      // Calculate remaining mortgage using proper amortization (not linear).
      // Real mortgages are back-loaded: early payments are mostly interest, so the
      // outstanding balance drops slowly at first then accelerates. Linear payoff
      // significantly underestimates debt during the first 1/2 to 2/3 of the loan.
      //
      // Formula for remaining balance after t years on a fixed-rate mortgage:
      //   B(t) = P × [(1+r)^N - (1+r)^t] / [(1+r)^N - 1]
      // where P = current outstanding balance (treated as fresh principal today),
      //       r = annual interest rate, N = remaining years to payoff, t = years elapsed.
      //
      // We treat asset.mortgage as TODAY's outstanding balance and the
      // mortgagePayoffAge as when it will be fully paid. mortgageRate (default 6.5%)
      // is the annual rate. If mortgageRate is 0, we fall back to linear (zero-interest case).
      if (asset.mortgage > 0 && asset.mortgagePayoffAge) {
        if (myAge < asset.mortgagePayoffAge) {
          const N = asset.mortgagePayoffAge - pi.myAge;     // total remaining years from today
          const t = yearsFromNow;                           // years elapsed from today
          const r = asset.mortgageRate !== undefined && asset.mortgageRate !== null
            ? asset.mortgageRate
            : 0.065;                                        // default 6.5% annual
          let remainingMortgage;
          if (r > 0 && N > 0) {
            const factorN = Math.pow(1 + r, N);
            const factorT = Math.pow(1 + r, t);
            remainingMortgage = asset.mortgage * (factorN - factorT) / (factorN - 1);
          } else {
            // r=0 → linear payoff (no interest)
            remainingMortgage = asset.mortgage * Math.max(0, 1 - (t / N));
          }
          totalAssetDebt += Math.max(0, remainingMortgage);
        }
      }
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
      rmd: Math.round(totalRMD),
      excessRMD: Math.round(excessRMD),
      qcd: Math.round(qcdAmount),
      rothConversion: Math.round(rothConversionThisYear), // Planned Roth conversion executed this year
      charitableGiving: Math.round(isRetired ? desiredIncome * (charitablePercent / 100) : 0),
      totalIncome: Math.round(earnedIncome + totalGuaranteedIncome + portfolioWithdrawal),
      // Tax computation intermediate values (for display components to consume)
      preTaxDeduction: Math.round(preTaxDeduction), // Pre-tax retirement contributions (above-the-line deduction)
      nonSSIncome: Math.round(nonSSIncome), // Non-SS income before pre-tax deduction (used for SS taxation display)
      taxableSS: Math.round(finalTaxableSS_out), // Taxable portion of SS benefits (IRS combined income formula)
      taxableIncome: Math.round(finalTotalTaxableIncome), // Federal taxable income (after pre-tax deduction, before standard deduction)
      magi: Math.round(magi), // Modified Adjusted Gross Income (gains-inclusive AGI with pre-tax deduction added back)
      stateTaxableIncome: Math.round(stateTaxableIncome), // State taxable income after SS/retirement exclusions and deduction
      federalTax: Math.round(federalTax),
      stateTax: Math.round(stateTax),
      ficaTax: Math.round(totalFICA), // Employee FICA (SS + Medicare) on earned income
      irmaaSurcharge: Math.round(irmaaSurcharge), // Medicare IRMAA surcharge (Part B + Part D above standard)
      irmaaInfo, // IRMAA tier detail { tier, totalAnnual, partBAnnual, partDAnnual, distToNextTier }
      ssEarningsTestReduction: Math.round(ssEarningsTestReduction), // SS benefits withheld due to earnings test
      // Healthcare and recurring expense data (from unified model)
      healthcareExpense: healthcareExpense, // Total healthcare costs this year
      healthcarePre65: healthcareResult.pre65,
      healthcareMedicare: healthcareResult.medicare,
      healthcareLTC: healthcareResult.ltc,
      recurringExpenses: totalRecurringExpenses, // Total categorized recurring expenses
      recurringExpensesByCategory: recurringResult.byCategory, // Breakdown by category
      totalTax: Math.round(federalTax + stateTax + totalFICA + irmaaSurcharge),
      netIncome: Math.round(earnedIncome + totalGuaranteedIncome + portfolioWithdrawal - federalTax - stateTax - totalFICA - irmaaSurcharge),
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
      primaryAlive, spouseAlive
    });

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
    MAX_AGE, BROKERAGE_COST_BASIS_ESTIMATE, MAX_ITERATIONS_FOR_TAX_CALC,
    MONTE_CARLO_TAX_ESTIMATE, SAVE_DEBOUNCE_MS,

    // ── Account type taxonomy ─────────────────────────────────────────────
    PRE_TAX_TYPES, ROTH_TYPES, BROKERAGE_TYPES, HSA_TYPES,
    isPreTaxAccount, isRothAccount, isBrokerageAccount, isHSAAccount,

    // ── Federal income tax ────────────────────────────────────────────────
    FEDERAL_TAX_BRACKETS_2026, STANDARD_DEDUCTION_2026,
    calculateFederalTax, calculateSocialSecurityTaxableAmount,
    CAPITAL_GAINS_THRESHOLDS_2025, calculateCapitalGainsTax, calculateNIIT,

    // ── State income tax ──────────────────────────────────────────────────
    STATE_TAX_RATES, STATES_EXEMPT_RETIREMENT_INCOME,
    STATES_EXEMPT_ALL_RETIREMENT_DISTRIBUTIONS, STATES_THAT_TAX_SS,
    calculateStateTax,
    ALABAMA_TAX_BRACKETS, ALABAMA_PERSONAL_EXEMPTION,
    ALABAMA_OVER_65_RETIREMENT_EXCLUSION,
    getAlabamaStandardDeduction, calculateAlabamaTax,

    // ── FICA / payroll ────────────────────────────────────────────────────
    FICA_SS_RATE, FICA_SS_WAGE_BASE_2025, FICA_MEDICARE_RATE,
    FICA_ADDITIONAL_MEDICARE_RATE, FICA_ADDITIONAL_MEDICARE_THRESHOLD,
    calculateFICA,

    // ── Retirement accounts (RMD, Roth conversion windows) ────────────────
    RMD_FACTORS, calculateRMD, getRmdStartAge, getDefaultRothConversionWindow,
    QCD_ANNUAL_LIMIT, QCD_START_AGE,

    // ── Social Security ───────────────────────────────────────────────────
    SS_FULL_RETIREMENT_AGE,
    SS_EARNINGS_TEST_LIMIT_2025, SS_EARNINGS_TEST_FRA_LIMIT_2025,
    calculateSSBenefit, calculateSSEarningsTestReduction,

    // ── Medicare / IRMAA / healthcare ─────────────────────────────────────
    IRMAA_THRESHOLDS_2025, MEDICARE_PART_B_STANDARD_2025,
    calculateIRMAA, calculateIRMAASurcharge,
    MEDICARE_PART_B_PREMIUM_2025, MEDICARE_PART_D_PREMIUM_2025,
    MEDICARE_SUPPLEMENT_PREMIUM_2025, MEDICARE_OOP_ANNUAL_2025,
    PRE_65_HEALTHCARE_ANNUAL_2025, MEDICAL_INFLATION_RATE,
    LTC_MONTHLY_ASSISTED_LIVING_2025, LTC_DEFAULT_DURATION_MONTHS,
    ACA_FPL_2025, calculateACASubsidy,
    calculateHealthcareExpenses, calculateRecurringExpenses,

    // ── Historical sequences + main projection entry point ────────────────
    HISTORICAL_RETURNS, getHistoricalSequence, getValidStartYears,
    computeProjections,
  };
});
