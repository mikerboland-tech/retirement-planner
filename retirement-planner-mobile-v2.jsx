// React globals are provided by mobile.html
// Do not add import statements - this file runs in browser via Babel transform

// ============================================================================
// MOBILE WHAT-IF CALCULATOR
// ============================================================================
// A standalone, simplified retirement planner for mobile.
//
// Design philosophy:
//   - One screen of inputs, results update live underneath
//   - Use native HTML range sliders (great mobile UX, big touch targets)
//   - Single filer only; couples can mentally adjust by halving spending
//   - One synthetic portfolio account + one SS stream feeds the FULL engine
//   - No data persistence — refresh = start over (intentional, lightweight)
//
// This file does NOT import or share state with the desktop version.
// They live side-by-side as independent apps at separate URLs.
// ============================================================================

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
// HSA withdrawals for qualified medical expenses are tax-free (like Roth).
// For simplicity, we model all HSA withdrawals as tax-free in retirement,
// since the vast majority of retiree HSA usage is for medical expenses.

// ============================================
// Sankey Diagram Component for Cash Flow Visualization
// ============================================

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
    { min: 0, max: 17850, rate: 0.10 },
    { min: 17850, max: 67850, rate: 0.12 },
    { min: 67850, max: 105700, rate: 0.22 },
    { min: 105700, max: 201775, rate: 0.24 },
    { min: 201775, max: 256225, rate: 0.32 },
    { min: 256225, max: 640600, rate: 0.35 },
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
//   3. Personal exemption: $3,000 (S), $7,500 (MFJ) — NOT inflation-adjusted.
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

const FICA_SS_WAGE_BASE_2025 = 176100; // 2025 wage base; inflation-indexed below

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
  
  // Medicare tax (no cap) + Additional Medicare Tax for high earners
  const threshold = FICA_ADDITIONAL_MEDICARE_THRESHOLD[filingStatus] || FICA_ADDITIONAL_MEDICARE_THRESHOLD.married_joint;
  const adjustedThreshold = threshold * inflationFactor;
  let medicareTax = earnedIncome * FICA_MEDICARE_RATE;
  if (earnedIncome > adjustedThreshold) {
    medicareTax += (earnedIncome - adjustedThreshold) * FICA_ADDITIONAL_MEDICARE_RATE;
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

// Medicare IRMAA Thresholds 2025 (based on 2023 MAGI with 2-year lookback)
// Part B standard premium: $185.00/month in 2025

const IRMAA_THRESHOLDS_2025 = {
  single: [
    { maxIncome: 106000, partB: 185.00, partD: 0 },
    { maxIncome: 133000, partB: 259.00, partD: 13.70 },
    { maxIncome: 167000, partB: 370.00, partD: 35.30 },
    { maxIncome: 200000, partB: 480.90, partD: 57.00 },
    { maxIncome: 500000, partB: 591.90, partD: 78.60 },
    { maxIncome: Infinity, partB: 628.90, partD: 85.80 }
  ],
  married_joint: [
    { maxIncome: 212000, partB: 185.00, partD: 0 },
    { maxIncome: 266000, partB: 259.00, partD: 13.70 },
    { maxIncome: 334000, partB: 370.00, partD: 35.30 },
    { maxIncome: 400000, partB: 480.90, partD: 57.00 },
    { maxIncome: 750000, partB: 591.90, partD: 78.60 },
    { maxIncome: Infinity, partB: 628.90, partD: 85.80 }
  ],
  married_separate: [
    { maxIncome: 106000, partB: 185.00, partD: 0 },
    { maxIncome: 394000, partB: 591.90, partD: 78.60 },
    { maxIncome: Infinity, partB: 628.90, partD: 85.80 }
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

const MEDICARE_PART_B_STANDARD_2025 = 185.00; // per month

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
    
    // LONG-TERM CARE: model in final N months before death
    if (pi.ltcModel !== 'none' && (pi.healthcareModel === 'comprehensive' || pi.ltcModel === 'custom' || pi.ltcModel === 'default')) {
      const ltcDuration = pi.ltcDurationMonths || LTC_DEFAULT_DURATION_MONTHS;
      const ltcMonthly = pi.ltcMonthlyAmount || LTC_MONTHLY_ASSISTED_LIVING_2025;
      const ltcStartAge = Math.max(65, person.lifeExp - Math.ceil(ltcDuration / 12));
      
      if (person.age >= ltcStartAge && person.age <= person.lifeExp) {
        const monthsThisYear = (person.age === person.lifeExp)
          ? Math.max(0, ltcDuration - (person.lifeExp - ltcStartAge) * 12 + 12)
          : 12;
        const ltcThisYear = ltcMonthly * Math.min(12, monthsThisYear);
        ltcCost += ltcThisYear * medInflationFactor;
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

const MEDICARE_PART_B_PREMIUM_2025 = 185;    // Monthly Part B base premium (2025)

const MEDICARE_PART_D_PREMIUM_2025 = 35;     // Avg monthly Part D base premium (2025)

const MEDICARE_SUPPLEMENT_PREMIUM_2025 = 175; // Avg monthly Medigap premium (2025)

const MEDICARE_OOP_ANNUAL_2025 = 2000;       // Avg annual out-of-pocket (copays, dental, vision)

const PRE_65_HEALTHCARE_ANNUAL_2025 = 12000; // Avg annual ACA/employer premium for one person

const MEDICAL_INFLATION_RATE = 0.05;         // Healthcare cost inflation (higher than general CPI)

const LTC_MONTHLY_ASSISTED_LIVING_2025 = 5900; // Median monthly assisted living cost (Genworth 2024)

const LTC_DEFAULT_DURATION_MONTHS = 28;      // Default LTC planning: 28 months before death

// Healthcare modeling presets

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
  // Exclude retirement income (pension, 401k/IRA withdrawals) for states that exempt it
  const retirementExclusion = STATES_EXEMPT_RETIREMENT_INCOME.has(state) ? retirementIncome : 0;
  const stateGrossIncome = grossIncome - ssExclusion - retirementExclusion;
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

const calculateSocialSecurityTaxableAmount = (ssIncome, otherIncome, filingStatus) => {
  // Combined income = AGI + nontaxable interest + 1/2 of SS benefits
  const combinedIncome = otherIncome + (ssIncome * 0.5);
  
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
  
  // Above second threshold: up to 85% taxable
  const amountAt50Percent = (thresholds.max - thresholds.base) * 0.5;
  const excess = combinedIncome - thresholds.max;
  const taxableAmount = Math.min(
    ssIncome * 0.85,
    amountAt50Percent + (excess * 0.85)
  );
  
  return taxableAmount;
};

// 2025 Long-term Capital Gains Rate Thresholds (adjusted for OBBB)

const CAPITAL_GAINS_THRESHOLDS_2025 = {
  single: { zeroRate: 48350, fifteenRate: 533400 },
  married_joint: { zeroRate: 96700, fifteenRate: 600050 },
  married_separate: { zeroRate: 48350, fifteenRate: 300025 },
  head_of_household: { zeroRate: 64750, fifteenRate: 566700 }
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

// Load data from localStorage

function computeProjections(pi, accts, streams, assetList, events = [], recurringExpensesList = [], currentYearArg) {
  // currentYear used to be captured from RetirementPlanner's closure. It's now an
  // explicit parameter (with a fallback) so this function can be moved to module
  // scope and run in a Web Worker.
  const currentYear = currentYearArg !== undefined ? currentYearArg : new Date().getFullYear();
  const years = [];
  let accountBalances = accts.reduce((acc, account) => ({ ...acc, [account.id]: account.balance }), {});
  
  // Track reinvested excess RMDs when no brokerage account exists
  // This prevents excess RMDs from vanishing — they grow at a conservative rate
  let excessReinvestmentPool = 0;
  const reinvestmentGrowthRate = 0.06; // Conservative brokerage-like return
  
  // Use legacyAge as the planning horizon (default 95 if not set)
  const planningAge = pi.legacyAge || MAX_AGE;
  
  // Pre-calculate inflation factors for better performance
  const maxYears = planningAge - pi.myAge + 1;
  const inflationFactors = new Array(maxYears);
  for (let i = 0; i < maxYears; i++) {
    inflationFactors[i] = Math.pow(1 + pi.inflationRate, i);
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
      if (primaryAlive && myAge > pi.myLifeExpectancy) {
        primaryAlive = false;
        if (!yearOfFirstDeath) yearOfFirstDeath = year;
        survivorEvent = 'primary_died';
        // Track both benefits at the moment of death so downstream uplift logic
        // can compare correctly. Survivor benefits = MAX(own, deceased's), so we
        // need to know what the deceased was entitled to even when own was higher.
        deceasedSSBenefit = primarySSAmount; // What primary (the deceased) had
        survivorSSBenefit = spouseSSAmount;  // What spouse (the survivor) has on their own
      }
      if (spouseAlive && spouseAge > pi.spouseLifeExpectancy) {
        spouseAlive = false;
        if (!yearOfFirstDeath) yearOfFirstDeath = year;
        survivorEvent = survivorEvent ? 'both_died' : 'spouse_died';
        // Track both benefits at the moment of death (see comment above).
        deceasedSSBenefit = spouseSSAmount;   // What spouse (the deceased) had
        survivorSSBenefit = primarySSAmount;  // What primary (the survivor) has on their own
      }
    }
    
    // Effective filing status: changes after a spouse dies
    // Year of death + 2 qualifying surviving spouse years: keep MFJ brackets
    // After that: file as single
    let effectiveFilingStatus = pi.filingStatus;
    if (survivorEnabled && yearOfFirstDeath && (primaryAlive !== spouseAlive)) {
      const yearsSinceDeath = year - yearOfFirstDeath;
      if (yearsSinceDeath > 2) {
        effectiveFilingStatus = 'single';
      }
      // Years 0-2: keep married_joint brackets (qualifying surviving spouse)
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
        
        // Pre-tax contributions reduce AGI (above-the-line deduction)
        // 401k, 403b, 457b, Traditional IRA contributions are tax-deductible
        // Roth contributions are NOT deductible (already taxed)
        // Employer contributions (match, profit sharing) are NOT deducted from YOUR income
        // — they're an added benefit that doesn't come from your paycheck.
        // For 'both' contributor, the combined amount can't be split, so we don't deduct
        // — users should separate into two account rows for accurate tax modeling.
        if (isPreTaxAccount(account.type) && adjustedContribution > 0 && (account.contributor || 'me') === 'me') {
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
    accts.forEach(account => {
      const halfGrowth = Math.pow(1 + (account.cagr || 0), 0.5);
      accountBalances[account.id] = Math.max(0, accountBalances[account.id]) * halfGrowth;
    });
    excessReinvestmentPool *= Math.pow(1 + reinvestmentGrowthRate, 0.5);
    
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
      
      // Iteratively calculate the right withdrawal to hit desired net income
      // This properly accts for actual marginal tax rates, QCD benefits,
      // and the circular dependency where withdrawals affect SS taxation
      let withdrawalNeeded = 0;
      if (afterTaxGap > 0) {
        let testWithdrawal = afterTaxGap; // Start with the gap
        
        for (let i = 0; i < MAX_ITERATIONS_FOR_TAX_CALC; i++) { // Iterate to converge
          // Estimate how much of this withdrawal would be from pre-tax (for tax calculation).
          // IMPORTANT: cap by testWithdrawal (not totalPreTaxBalance) so the first iteration
          // doesn't massively over-estimate pre-tax income and overshoot SS taxation thresholds.
          // If pre-tax is the priority we'd draw up to testWithdrawal from it (limited by
          // the available pre-tax balance); otherwise assume 70% of the draw is pre-tax.
          const priority = pi.withdrawalPriority || ['pretax', 'brokerage', 'roth'];
          const estimatedPreTaxWithdrawal = priority[0] === 'pretax'
            ? Math.min(testWithdrawal, totalPreTaxBalance)  // pre-tax first: withdraw up to the test amount, bounded by available balance
            : Math.min(testWithdrawal * 0.7, totalPreTaxBalance); // other priority: estimate 70% pre-tax, still bounded by balance
          
          // Total pre-tax from withdrawals: the RMD is already INCLUDED in 
          // the spending withdrawal (not additional). The total pre-tax amount
          // is the larger of the two — either the full spending withdrawal
          // (which subsumes the RMD) or the RMD alone (if it exceeds spending)
          const totalPreTaxFromWithdrawals = Math.max(totalRMD, estimatedPreTaxWithdrawal);
          
          // Calculate QCD if applicable (reduces taxable income)
          let estimatedQCD = 0;
          if (canDoQCD) {
            estimatedQCD = Math.min(charitableGiving, totalPreTaxFromWithdrawals, householdQCDLimit);
          }
          
          // Taxable portion of withdrawals (pre-tax minus QCD)
          const taxableWithdrawals = Math.max(0, totalPreTaxFromWithdrawals - estimatedQCD);
          
          // CRITICAL: Recalculate SS taxable amount including withdrawal income
          // Pre-tax withdrawals are ordinary income that affects "combined income"
          // for determining how much of SS is taxable (IRS Pub 915)
          const adjustedNonSSIncome = nonSSIncome + taxableWithdrawals;
          const adjustedTaxableSS = calculateSocialSecurityTaxableAmount(
            totalSocialSecurity, adjustedNonSSIncome, effectiveFilingStatus
          );
          const adjustedBaseGross = adjustedNonSSIncome + adjustedTaxableSS;
          
          // Calculate actual taxes on total income including SS re-taxation
          const totalFedTax = calculateFederalTax(adjustedBaseGross, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
          // Retirement income for state exemption: pension only (401k/IRA withdrawals are NOT exempt)
          const iterRetirementIncome = totalPension;
          const totalStateTax = calculateStateTax(adjustedBaseGross, pi.state, effectiveFilingStatus, yearsFromNow, pi.inflationRate, adjustedTaxableSS, iterRetirementIncome, { federalTaxPaid: totalFedTax, primaryAge: myAge, spouseAge: spouseAge });
          
          // Tax attributable to the withdrawal = total tax minus tax on guaranteed income alone
          // Use base taxes computed on original (no-withdrawal) income
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
          
          // If user chose to pay conversion tax from brokerage, estimate the marginal tax
          // on the conversion and withdraw that amount from the largest brokerage account.
          // This prevents the withdrawal solver from pulling more pre-tax to cover the tax,
          // which would defeat the purpose of the conversion.
          if (pi.rothConversionTaxSource === 'brokerage' && rothConversionThisYear > 0) {
            // Estimate marginal tax on the conversion amount
            // At this point, totalTaxableIncome_adjusted is the base income before withdrawals
            const preConvGross = totalTaxableIncome_adjusted;
            const postConvGross = preConvGross + rothConversionThisYear;
            const preConvFed = calculateFederalTax(preConvGross, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
            const postConvFed = calculateFederalTax(postConvGross, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
            const preConvState = calculateStateTax(preConvGross, pi.state, effectiveFilingStatus, yearsFromNow, pi.inflationRate, taxableSS, totalPension, { federalTaxPaid: preConvFed, primaryAge: myAge, spouseAge: spouseAge });
            const postConvState = calculateStateTax(postConvGross, pi.state, effectiveFilingStatus, yearsFromNow, pi.inflationRate, taxableSS, totalPension, { federalTaxPaid: postConvFed, primaryAge: myAge, spouseAge: spouseAge });
            const estimatedConversionTax = (postConvFed - preConvFed) + (postConvState - preConvState);
            
            if (estimatedConversionTax > 0) {
              // Find the largest brokerage account
              const brokerageAccts = accts.filter(a => isBrokerageAccount(a.type) || isHSAAccount(a.type));
              if (brokerageAccts.length > 0) {
                const brokerageSource = brokerageAccts.reduce((best, a) =>
                  (accountBalances[a.id] || 0) > (accountBalances[best.id] || 0) ? a : best,
                  brokerageAccts[0]);
                const taxPayment = Math.min(estimatedConversionTax, accountBalances[brokerageSource.id] || 0);
                accountBalances[brokerageSource.id] -= taxPayment;
                // This withdrawal is a brokerage withdrawal — track for capital gains
                brokerageWithdrawals += taxPayment;
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
    
    // CRITICAL: Recalculate SS taxable amount with actual withdrawal income
    // Pre-tax withdrawals are ordinary income that affects SS taxation thresholds
    const finalNonSSIncome = nonSSIncome + ordinaryIncomeFromWithdrawals + capitalGainsFromWithdrawals;
    const finalTaxableSS = calculateSocialSecurityTaxableAmount(
      totalSocialSecurity, finalNonSSIncome, effectiveFilingStatus
    );
    finalTotalTaxableIncome = finalNonSSIncome + finalTaxableSS - preTaxDeduction; // Updates outer-scope let variable
    finalTaxableSS_out = finalTaxableSS; // Update outer-scope for year push
    
    // Calculate taxes on total ordinary income (with corrected SS taxation)
    federalTax = calculateFederalTax(finalTotalTaxableIncome, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
    // Retirement income exempt in some states: pension only (401k/IRA withdrawals are NOT exempt)
    const finalRetirementIncome = totalPension;
    // Pass extraParams for Alabama progressive tax engine (federal deductibility, age-based exclusions)
    const stateExtraParams = { federalTaxPaid: federalTax, primaryAge: myAge, spouseAge: spouseAge };
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
      const stateGrossForCalc = finalTotalTaxableIncome - stateSSExclusion - stateRetExclusion;
      const stateDeduction = (STANDARD_DEDUCTION_2026[effectiveFilingStatus] || STANDARD_DEDUCTION_2026.married_joint) * inflationFactor;
      stateTaxableIncome = Math.max(0, stateGrossForCalc - stateDeduction);
    }
    
    // Calculate taxable income for capital gains rate determination
    // Use pre-calculated inflation factor
    const baseDeduction = STANDARD_DEDUCTION_2026[effectiveFilingStatus] || STANDARD_DEDUCTION_2026.married_joint;
    const adjustedDeduction = baseDeduction * inflationFactor;
    const taxableOrdinaryIncome = Math.max(0, finalTotalTaxableIncome - adjustedDeduction);
    
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
    // MAGI = AGI + certain deductions added back
    // finalTotalTaxableIncome already has pre-tax contributions subtracted,
    // so MAGI adds them back (along with capital gains for investment income tests)
    const magi = finalTotalTaxableIncome + capitalGainsFromWithdrawals + preTaxDeduction;
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
      // Calculate ACTUAL marginal tax rate by computing taxes WITHOUT the excess RMD
      // and comparing to taxes WITH it. The excess RMD is already included in
      // finalTotalTaxableIncome (via ordinaryIncomeFromWithdrawals), so we subtract
      // it to get the "without excess" baseline.
      // Note: removing the excess also reduces the taxable portion of SS, since
      // pre-tax income affects the IRS combined-income formula.
      const nonSSWithoutExcess = Math.max(0, finalNonSSIncome - excessRMD);
      const taxableSSWithoutExcess = calculateSocialSecurityTaxableAmount(
        totalSocialSecurity, nonSSWithoutExcess, effectiveFilingStatus
      );
      const taxableIncomeWithoutExcess = Math.max(0, nonSSWithoutExcess + taxableSSWithoutExcess - preTaxDeduction);
      const fedTaxWithoutExcess = calculateFederalTax(taxableIncomeWithoutExcess, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
      const stateTaxWithoutExcess = calculateStateTax(
        taxableIncomeWithoutExcess, pi.state, effectiveFilingStatus, yearsFromNow, pi.inflationRate,
        taxableSSWithoutExcess, finalRetirementIncome,
        { federalTaxPaid: fedTaxWithoutExcess, primaryAge: myAge, spouseAge: spouseAge }
      );
      // Marginal tax = tax(with excess) − tax(without excess), all attributable to excessRMD.
      // Use the ordinary federal+state portion (capital gains / NIIT / IRMAA aren't driven by excess RMD here).
      const fedOrdinary = calculateFederalTax(finalTotalTaxableIncome, effectiveFilingStatus, yearsFromNow, pi.inflationRate);
      const marginalTax = Math.max(0, (fedOrdinary - fedTaxWithoutExcess) + (stateTax - stateTaxWithoutExcess));
      const afterTaxExcess = Math.max(0, excessRMD - marginalTax);
      
      // Find a brokerage account to add to
      let brokerageAccount = accts.find(a => a.type === 'brokerage');
      if (brokerageAccount) {
        accountBalances[brokerageAccount.id] += afterTaxExcess;
      } else {
        // No brokerage account exists — track excess in the synthetic reinvestment bucket
        excessReinvestmentPool += afterTaxExcess;
      }
    }
    
    // Deposit non-taxable one-time income (inheritance, gifts, home sale proceeds)
    // into brokerage account (these aren't taxed but increase available savings)
    if (oneTimeNontaxableIncome > 0) {
      let brokerageAcct = accts.find(a => a.type === 'brokerage');
      if (brokerageAcct) {
        accountBalances[brokerageAcct.id] += oneTimeNontaxableIncome;
      } else {
        excessReinvestmentPool += oneTimeNontaxableIncome;
      }
    }
    
    // Step 4: Apply remaining half-year growth to all accts (after withdrawals).
    // Combined with pre-withdrawal half-growth above, total annual growth = (1+cagr).
    // This is the half-year convention — funds withdrawn earlier in the year
    // earn the pre-withdrawal half; funds remaining at year end earn both halves.
    accts.forEach(account => {
      const halfGrowth = Math.pow(1 + (account.cagr || 0), 0.5);
      accountBalances[account.id] = Math.max(0, accountBalances[account.id]) * halfGrowth;
    });
    // Grow the excess reinvestment pool's remaining half (for users without brokerage accounts)
    excessReinvestmentPool *= Math.pow(1 + reinvestmentGrowthRate, 0.5);
    
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
      magi: Math.round(magi), // Modified Adjusted Gross Income (adds back pre-tax deduction + cap gains)
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
  }
  return years;
}


// ============================================================================
// MOBILE UI
// ============================================================================

// Formatters tailored for mobile (shorter strings, larger units)
const fmt = (n) => {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + Math.round(n).toLocaleString();
};
const fmtFull = (n) => {
  if (n == null || isNaN(n)) return '—';
  return '$' + Math.round(n).toLocaleString();
};

// A labeled slider row. Mobile-friendly: large hit target, value badge on the right.
function SliderRow({ label, value, onChange, min, max, step = 1, format }) {
  const displayValue = format ? format(value) : value;
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm text-slate-300 font-medium">{label}</span>
        <span className="text-base text-emerald-400 font-semibold tabular-nums">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-3 rounded-lg appearance-none cursor-pointer bg-slate-700 accent-emerald-500"
        style={{ touchAction: 'manipulation' }}
      />
    </div>
  );
}

// A labeled number input for amounts that need precise typing.
function MoneyInput({ label, value, onChange, hint }) {
  return (
    <div className="py-2">
      <label className="block text-sm text-slate-300 font-medium mb-1">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
        <input
          type="number"
          inputMode="decimal"
          value={value === 0 ? '' : value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          onFocus={(e) => e.target.select()}
          placeholder="0"
          className="w-full pl-7 pr-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-base text-slate-100 focus:outline-none focus:border-emerald-500"
        />
      </div>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

// A compact result card. Big number, label below.
function ResultCard({ label, value, sublabel, color = 'emerald' }) {
  const colorClass = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    sky: 'text-sky-400',
    red: 'text-red-400',
    purple: 'text-purple-400',
  }[color] || 'text-emerald-400';
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3">
      <div className="text-xs text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold ${colorClass} tabular-nums mt-0.5`}>{value}</div>
      {sublabel && <div className="text-xs text-slate-500 mt-0.5">{sublabel}</div>}
    </div>
  );
}

// Tiny inline sparkline showing portfolio over time.
// Uses SVG, no external library. Renders a smooth filled area.
function Sparkline({ data, retirementAge }) {
  if (!data || data.length === 0) return null;
  const width = 320;
  const height = 80;
  const padding = 4;
  
  const values = data.map(d => d.totalPortfolio);
  const ages = data.map(d => d.myAge);
  const maxV = Math.max(...values, 1);
  const minV = 0;
  const minAge = Math.min(...ages);
  const maxAge = Math.max(...ages);
  
  const xOf = (age) => padding + ((age - minAge) / (maxAge - minAge)) * (width - 2 * padding);
  const yOf = (v) => padding + (1 - (v - minV) / (maxV - minV)) * (height - 2 * padding);
  
  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xOf(d.myAge).toFixed(1)} ${yOf(d.totalPortfolio).toFixed(1)}`).join(' ');
  const fillPath = `${linePath} L ${xOf(maxAge).toFixed(1)} ${height - padding} L ${xOf(minAge).toFixed(1)} ${height - padding} Z`;
  const retirementX = xOf(retirementAge);
  
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#sparkFill)" />
      <path d={linePath} fill="none" stroke="#10b981" strokeWidth="2" />
      {/* Retirement age marker */}
      <line x1={retirementX} y1={padding} x2={retirementX} y2={height - padding} stroke="#fbbf24" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
    </svg>
  );
}

// A collapsible income stream section. Header shows the stream name + its current annual
// contribution. When the toggle is off, the body is hidden — keeping the inputs panel short
// for users who only have one or two streams. When on, shows amount, start age, and COLA toggle.
//
// Layout note: each section is its own visually distinct block (subtle border, label color).
// Three of these stacked vertically is about 2/3 of a screen when all enabled, less when off.
function IncomeStreamSection({ title, accentColor, enabled, onToggle, annualPreview, children }) {
  const accentClass = {
    sky: 'border-sky-700/40 bg-sky-900/10',
    violet: 'border-violet-700/40 bg-violet-900/10',
    cyan: 'border-cyan-700/40 bg-cyan-900/10',
  }[accentColor] || 'border-slate-700 bg-slate-800/40';
  const labelClass = {
    sky: 'text-sky-300',
    violet: 'text-violet-300',
    cyan: 'text-cyan-300',
  }[accentColor] || 'text-slate-300';
  
  return (
    <div className={`rounded-lg border ${accentClass} p-3 mb-2`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Toggle switch */}
          <button
            onClick={() => onToggle(!enabled)}
            role="switch"
            aria-checked={enabled}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-600' : 'bg-slate-700'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
          <span className={`text-sm font-semibold ${labelClass}`}>{title}</span>
        </div>
        {enabled && annualPreview != null && (
          <span className="text-sm text-emerald-400 font-medium tabular-nums">
            {annualPreview > 0 ? `$${Math.round(annualPreview).toLocaleString()}/yr` : '—'}
          </span>
        )}
      </div>
      {enabled && <div className="mt-2 pt-2 border-t border-slate-700/40">{children}</div>}
    </div>
  );
}

// A simple toggle row used inside an IncomeStreamSection (for the COLA toggle).
// Compact, designed to fit alongside other compact controls.
function ToggleRow({ label, value, onChange, hint }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex-1 pr-3">
        <div className="text-sm text-slate-300">{label}</div>
        {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${value ? 'bg-emerald-600' : 'bg-slate-600'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function MobilePlanner() {
  // === Inputs (state) ===
  const [currentAge, setCurrentAge] = useState(45);
  const [retirementAge, setRetirementAge] = useState(65);
  const [legacyAge, setLegacyAge] = useState(90);
  const [portfolio, setPortfolio] = useState(250000);
  const [annualContribution, setAnnualContribution] = useState(20000);
  const [desiredSpending, setDesiredSpending] = useState(60000);
  const [cagr, setCagr] = useState(7);
  const [inflationRate, setInflationRate] = useState(3);
  
  // Three income streams: Social Security, Pension, Other.
  // Each has: enabled flag (so user can zero one out cleanly), amount, start age, and inflation toggle.
  // - SS uses PIA (monthly benefit at FRA) since that's what ssa.gov gives you.
  // - Pension and Other use direct annual amounts.
  // - Defaults reflect typical real-world behavior:
  //     SS: COLA on (Social Security has annual COLA)
  //     Pension: COLA off (most private pensions are not inflation-adjusted)
  //     Other: COLA on (rentals, royalties, part-time work roughly track inflation)
  const [ssEnabled, setSsEnabled] = useState(true);
  const [ssMonthly, setSsMonthly] = useState(2500);
  const [ssClaimAge, setSsClaimAge] = useState(67);
  const [ssCola, setSsCola] = useState(true);
  
  const [pensionEnabled, setPensionEnabled] = useState(false);
  const [pensionAnnual, setPensionAnnual] = useState(0);
  const [pensionStartAge, setPensionStartAge] = useState(65);
  const [pensionCola, setPensionCola] = useState(false);
  
  const [otherEnabled, setOtherEnabled] = useState(false);
  const [otherAnnual, setOtherAnnual] = useState(0);
  const [otherStartAge, setOtherStartAge] = useState(65);
  const [otherEndAge, setOtherEndAge] = useState(90);
  const [otherCola, setOtherCola] = useState(true);
  
  const [showDetails, setShowDetails] = useState(false);
  
  const birthYear = new Date().getFullYear() - currentAge;
  
  // === Run the engine ===
  // Build minimal personalInfo/accounts/streams from the simple inputs.
  // Use useMemo so calc only re-runs when inputs change.
  const { projections, retirementProj, legacyProj, sustainableAnnual, ssAnnual, pensionFirstYear, otherFirstYear, guaranteedAtRetirement } = useMemo(() => {
    const pi = {
      myAge: currentAge,
      myBirthYear: birthYear,
      myRetirementAge: retirementAge,
      myLifeExpectancy: legacyAge,
      legacyAge: legacyAge,
      filingStatus: 'single',
      state: 'CA', // Generic non-special-cased state
      currentExpenses: desiredSpending,
      desiredRetirementIncome: desiredSpending,
      inflationRate: inflationRate / 100,
      survivorModelEnabled: false,
      rothConversionAmount: 0,
      rothConversionBracket: '',
      rothConversionStartAge: 0,
      rothConversionEndAge: 0,
      charitableGivingPercent: 0,
      healthcareModelEnabled: false,
    };
    const accounts = [{
      id: 1,
      name: 'Portfolio',
      type: '401k',
      balance: portfolio,
      contribution: annualContribution,
      contributionGrowth: 0,
      cagr: cagr / 100,
      startAge: currentAge,
      stopAge: retirementAge,
      owner: 'me',
    }];
    
    // Build the income streams array based on which are enabled.
    // The COLA toggle controls whether the stream inflates year-over-year:
    //   - COLA on:  stream uses 2.5% (SS-like) for SS, or matches user inflationRate for others.
    //                Since the engine treats `cola` as a fixed rate, we set it to the user's inflation
    //                rate so the stream maintains real purchasing power. Special case for SS: it has
    //                its own COLA tradition close to but not identical to CPI; we use the same rate
    //                as inflation for simplicity rather than introducing a separate slider.
    //   - COLA off: cola = 0, meaning the stream is fixed in nominal dollars and shrinks in real terms.
    const inflationFraction = inflationRate / 100;
    const streams = [];
    
    let annualSS = 0;
    if (ssEnabled && ssMonthly > 0) {
      annualSS = calculateSSBenefit(ssMonthly, ssClaimAge, birthYear) * 12;
      if (annualSS > 0) {
        streams.push({
          id: 10,
          type: 'social_security',
          owner: 'me',
          amount: annualSS,
          cola: ssCola ? inflationFraction : 0,
          startAge: ssClaimAge,
          endAge: legacyAge,
          pia: ssMonthly,
        });
      }
    }
    
    // Pension: treat as the engine's "pension" type — fully taxable ordinary income, no FICA.
    if (pensionEnabled && pensionAnnual > 0) {
      streams.push({
        id: 11,
        type: 'pension',
        owner: 'me',
        amount: pensionAnnual,
        cola: pensionCola ? inflationFraction : 0,
        startAge: pensionStartAge,
        endAge: legacyAge,
      });
    }
    
    // Other: also use "pension" type for tax treatment (ordinary income, no FICA).
    // This is conservative — slightly overstates tax for rentals (which often have depreciation),
    // slightly understates for part-time work (no FICA modeled). Mobile tool, simplification accepted.
    if (otherEnabled && otherAnnual > 0) {
      streams.push({
        id: 12,
        type: 'pension',
        owner: 'me',
        amount: otherAnnual,
        cola: otherCola ? inflationFraction : 0,
        startAge: otherStartAge,
        endAge: otherEndAge,
      });
    }
    
    let proj = [];
    try {
      proj = computeProjections(pi, accounts, streams, [], [], []);
    } catch (e) {
      console.error('Projection error:', e);
      return { projections: [], retirementProj: null, legacyProj: null, sustainableAnnual: 0, ssAnnual: 0, pensionFirstYear: 0, otherFirstYear: 0, guaranteedAtRetirement: 0 };
    }
    
    const retirementProj = proj.find(p => p.myAge === retirementAge) || null;
    const legacyProj = proj.find(p => p.myAge === legacyAge) || null;
    
    // Guaranteed income at retirement = sum of all streams active in that year (nominal $$)
    const guaranteedAtRetirement = Math.round(
      (retirementProj?.socialSecurity || 0) +
      (retirementProj?.pension || 0)
    );
    
    // Sustainable annual spending = 4% of portfolio at retirement + guaranteed income at retirement
    const safe4 = (retirementProj?.totalPortfolio || 0) * 0.04;
    const sustainableAnnual = Math.round(safe4 + guaranteedAtRetirement);
    
    // First-year values (today's-dollar equivalents): grab the projection at each stream's start age
    // to show users what their stream actually pays out when it begins. Then deflate back to today's $.
    // Actually simpler: show the user the today's-dollar values they entered, since those are easier
    // to reason about. The nominal future values are visible in the details panel via the engine's output.
    const pensionFirstYear = pensionEnabled ? Math.round(pensionAnnual) : 0;
    const otherFirstYear = otherEnabled ? Math.round(otherAnnual) : 0;
    
    return {
      projections: proj,
      retirementProj,
      legacyProj,
      sustainableAnnual,
      ssAnnual: Math.round(annualSS),
      pensionFirstYear,
      otherFirstYear,
      guaranteedAtRetirement,
    };
  }, [currentAge, retirementAge, legacyAge, portfolio, annualContribution, desiredSpending, cagr, inflationRate,
      ssEnabled, ssMonthly, ssClaimAge, ssCola,
      pensionEnabled, pensionAnnual, pensionStartAge, pensionCola,
      otherEnabled, otherAnnual, otherStartAge, otherEndAge, otherCola,
      birthYear]);
  
  // Find depletion age (first year after retirement where portfolio hits 0)
  const depletionAge = useMemo(() => {
    if (!projections.length) return null;
    const dep = projections.find(p => p.myAge >= retirementAge && p.totalPortfolio <= 0);
    return dep ? dep.myAge : null;
  }, [projections, retirementAge]);
  
  const yearsToRetirement = Math.max(0, retirementAge - currentAge);
  const planSurvives = depletionAge === null || depletionAge > legacyAge;
  const surplusAtLegacy = legacyProj?.totalPortfolio || 0;
  
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 sticky top-0 z-10" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <h1 className="text-lg font-bold text-slate-100">Retirement What-If</h1>
        <p className="text-xs text-slate-500">Quick gut-check using the full engine</p>
      </header>
      
      {/* Results panel — sticky-ish, lives at top of scrolling area */}
      <section className="px-4 py-3 bg-slate-900/50 border-b border-slate-800">
        <div className="grid grid-cols-2 gap-2 mb-3">
          <ResultCard
            label="You retire in"
            value={yearsToRetirement === 0 ? 'Now' : `${yearsToRetirement} yr${yearsToRetirement === 1 ? '' : 's'}`}
            sublabel={`Age ${retirementAge}`}
            color="sky"
          />
          <ResultCard
            label="Portfolio at retirement"
            value={fmt(retirementProj?.totalPortfolio)}
            sublabel="Inflation-adjusted up"
            color="emerald"
          />
          <ResultCard
            label="Sustainable spending"
            value={fmt(sustainableAnnual)}
            sublabel="4% portfolio + income"
            color="amber"
          />
          <ResultCard
            label={planSurvives ? `Cushion at ${legacyAge}` : 'Portfolio runs out'}
            value={planSurvives ? fmt(surplusAtLegacy) : `Age ${depletionAge}`}
            sublabel={planSurvives ? 'Money outlives you' : 'Plan may fail'}
            color={planSurvives ? 'emerald' : 'red'}
          />
        </div>
        {/* Plan health pill */}
        <div className={`text-center text-xs font-medium py-1.5 px-3 rounded-full ${planSurvives ? 'bg-emerald-900/40 text-emerald-300' : 'bg-red-900/40 text-red-300'}`}>
          {planSurvives 
            ? `✓ Sustainable through age ${legacyAge}` 
            : `⚠ Portfolio depletes at age ${depletionAge} (before age ${legacyAge})`}
        </div>
        {/* Sparkline */}
        {projections.length > 0 && (
          <div className="mt-3">
            <Sparkline data={projections} retirementAge={retirementAge} />
            <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
              <span>Age {currentAge}</span>
              <span className="text-amber-500">↑ Retire {retirementAge}</span>
              <span>Age {legacyAge}</span>
            </div>
          </div>
        )}
      </section>
      
      {/* Inputs panel — scrolling area */}
      <section className="px-4 py-3 space-y-1">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Your Situation</h2>
        
        <SliderRow label="Your age now" value={currentAge} onChange={setCurrentAge} min={18} max={75} />
        <SliderRow label="Retirement age" value={retirementAge} onChange={setRetirementAge} min={Math.max(currentAge, 50)} max={75} />
        <SliderRow label="Plan through age" value={legacyAge} onChange={setLegacyAge} min={75} max={100} />
        
        <MoneyInput label="Current portfolio total" value={portfolio} onChange={setPortfolio} hint="All your retirement & investment accounts combined" />
        <MoneyInput label="Annual contributions" value={annualContribution} onChange={setAnnualContribution} hint="What you save each year (yours + employer match)" />
        <MoneyInput label="Desired annual spending" value={desiredSpending} onChange={setDesiredSpending} hint="What you want to spend each year in retirement (today's dollars)" />
        
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 mt-4">Assumptions</h2>
        <SliderRow label="Investment return (CAGR)" value={cagr} onChange={setCagr} min={2} max={12} step={0.5} format={(v) => `${v}%`} />
        <SliderRow label="Inflation rate" value={inflationRate} onChange={setInflationRate} min={1} max={6} step={0.5} format={(v) => `${v}%`} />
        
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 mt-4">Retirement Income Streams</h2>
        <p className="text-[11px] text-slate-500 mb-2">Income you'll receive in retirement that isn't from your portfolio. Toggle each one on/off and configure.</p>
        
        {/* Social Security — uses PIA-based engine math */}
        <IncomeStreamSection
          title="Social Security"
          accentColor="sky"
          enabled={ssEnabled}
          onToggle={setSsEnabled}
          annualPreview={ssEnabled ? ssAnnual : null}
        >
          <MoneyInput
            label="Monthly benefit at FRA (PIA)"
            value={ssMonthly}
            onChange={setSsMonthly}
            hint="See ssa.gov for your PIA estimate"
          />
          <SliderRow
            label="Claim age"
            value={ssClaimAge}
            onChange={setSsClaimAge}
            min={62}
            max={70}
            format={(v) => v === 67 ? '67 (FRA)' : String(v)}
          />
          <ToggleRow
            label="Inflation-adjusted (COLA)"
            value={ssCola}
            onChange={setSsCola}
            hint="SS has annual COLA — usually leave on"
          />
        </IncomeStreamSection>
        
        {/* Pension — flat annual amount, defaults to COLA off (most private pensions don't adjust) */}
        <IncomeStreamSection
          title="Pension"
          accentColor="violet"
          enabled={pensionEnabled}
          onToggle={setPensionEnabled}
          annualPreview={pensionEnabled ? pensionAnnual : null}
        >
          <MoneyInput
            label="Annual amount (today's dollars)"
            value={pensionAnnual}
            onChange={setPensionAnnual}
            hint="Combined annual pension income"
          />
          <SliderRow
            label="Start age"
            value={pensionStartAge}
            onChange={setPensionStartAge}
            min={50}
            max={75}
          />
          <ToggleRow
            label="Inflation-adjusted (COLA)"
            value={pensionCola}
            onChange={setPensionCola}
            hint="Most private pensions are NOT adjusted"
          />
        </IncomeStreamSection>
        
        {/* Other — flexible catch-all for rentals, royalties, part-time work, etc. */}
        <IncomeStreamSection
          title="Other Income"
          accentColor="cyan"
          enabled={otherEnabled}
          onToggle={setOtherEnabled}
          annualPreview={otherEnabled ? otherAnnual : null}
        >
          <MoneyInput
            label="Annual amount (today's dollars)"
            value={otherAnnual}
            onChange={setOtherAnnual}
            hint="Rental, business, royalties, part-time work, etc."
          />
          <SliderRow
            label="Start age"
            value={otherStartAge}
            onChange={setOtherStartAge}
            min={50}
            max={75}
          />
          <SliderRow
            label="End age"
            value={otherEndAge}
            onChange={setOtherEndAge}
            min={Math.max(otherStartAge, 60)}
            max={100}
          />
          <ToggleRow
            label="Inflation-adjusted"
            value={otherCola}
            onChange={setOtherCola}
            hint="Rentals/royalties usually inflate; business income varies"
          />
        </IncomeStreamSection>
        
        {/* Summary line showing total guaranteed income at retirement */}
        {(ssEnabled || pensionEnabled || otherEnabled) && (
          <p className="text-xs text-slate-400 mt-1 px-2">
            Total guaranteed income at retirement (age {retirementAge}): <span className="text-emerald-400 font-medium">{fmtFull(guaranteedAtRetirement)}/yr</span>
          </p>
        )}
        
        {/* Details reveal */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full mt-6 py-2.5 text-sm text-slate-400 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors"
        >
          {showDetails ? '▲ Hide details' : '▼ Show plan details'}
        </button>
        
        {showDetails && retirementProj && legacyProj && (
          <div className="mt-3 space-y-2 text-sm bg-slate-800/40 border border-slate-700 rounded-lg p-3">
            <div className="flex justify-between"><span className="text-slate-400">Years until retirement</span><span className="text-slate-200 tabular-nums">{yearsToRetirement}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Total contributions</span><span className="text-slate-200 tabular-nums">{fmtFull(annualContribution * yearsToRetirement)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Portfolio at retirement</span><span className="text-emerald-300 tabular-nums">{fmtFull(retirementProj.totalPortfolio)}</span></div>
            {ssEnabled && ssAnnual > 0 && (
              <div className="flex justify-between"><span className="text-slate-400">Lifetime SS received</span><span className="text-sky-300 tabular-nums">{fmtFull(projections.filter(p => p.myAge >= ssClaimAge).reduce((s, p) => s + (p.socialSecurity || 0), 0))}</span></div>
            )}
            {(pensionEnabled || otherEnabled) && (
              <div className="flex justify-between"><span className="text-slate-400">Lifetime pension + other</span><span className="text-violet-300 tabular-nums">{fmtFull(projections.reduce((s, p) => s + (p.pension || 0), 0))}</span></div>
            )}
            <div className="flex justify-between"><span className="text-slate-400">Lifetime taxes paid</span><span className="text-purple-300 tabular-nums">{fmtFull(projections.filter(p => p.myAge >= retirementAge).reduce((s, p) => s + (p.totalTax || 0), 0))}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Net worth at age {legacyAge}</span><span className="text-emerald-300 tabular-nums">{fmtFull(legacyProj.totalPortfolio)}</span></div>
          </div>
        )}
        
        <p className="text-[11px] text-slate-600 mt-6 px-2 leading-relaxed text-center">
          Simplified single-filer model. For full multi-account, spousal, tax, Roth conversion, and IRMAA analysis, use the desktop version. Educational tool — not financial advice.
        </p>
      </section>
    </div>
  );
}

