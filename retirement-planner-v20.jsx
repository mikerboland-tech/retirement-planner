import React, { useState, useMemo, useEffect, useCallback, memo } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area, ReferenceLine } from 'recharts';

// ============================================
// CONSTANTS - Extracted magic numbers and repeated arrays
// ============================================
const MAX_AGE = 95;
const BROKERAGE_COST_BASIS_ESTIMATE = 0.50;
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
const SankeyDiagram = memo(({ data, width = 900, height = 500 }) => {
  const { income, expenses, title } = data;
  
  // Calculate positions and dimensions
  const padding = { top: 40, right: 150, bottom: 40, left: 150 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  
  // Income sources on the left - guard against division by zero
  const incomeTotal = income.reduce((sum, item) => sum + item.value, 0);
  
  // Expenses on the right - guard against division by zero
  const expenseTotal = expenses.reduce((sum, item) => sum + item.value, 0);
  
  // Early return if no data to display
  if (incomeTotal === 0 || expenseTotal === 0 || income.length === 0 || expenses.length === 0) {
    return (
      <svg width={width} height={height} style={{ background: 'transparent' }}>
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="#64748b" fontSize="14">
          No cash flow data to display
        </text>
      </svg>
    );
  }
  
  // Calculate vertical positions for income sources
  let incomeY = padding.top;
  const incomeNodes = income.map(item => {
    const nodeHeight = (item.value / incomeTotal) * chartHeight;
    const node = {
      ...item,
      x: padding.left,
      y: incomeY,
      height: nodeHeight,
      width: 20
    };
    incomeY += nodeHeight + 5; // 5px gap between nodes
    return node;
  });
  
  // Calculate vertical positions for expenses
  let expenseY = padding.top;
  const expenseNodes = expenses.map(item => {
    const nodeHeight = (item.value / expenseTotal) * chartHeight;
    const node = {
      ...item,
      x: width - padding.right,
      y: expenseY,
      height: nodeHeight,
      width: 20
    };
    expenseY += nodeHeight + 5;
    return node;
  });
  
  // Generate flow paths (Bezier curves)
  const generatePath = (sx, sy, sh, tx, ty, th) => {
    const midX = (sx + tx) / 2;
    
    return `
      M ${sx} ${sy}
      C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}
      L ${tx} ${ty + th}
      C ${midX} ${ty + th}, ${midX} ${sy + sh}, ${sx} ${sy + sh}
      Z
    `;
  };
  
  // FIXED: Properly allocate flows from income to expenses
  // Each dollar from income is proportionally distributed to all expenses
  const flows = [];
  let flowId = 0;
  
  // Track how much of each expense node has been filled
  const expenseAllocations = expenseNodes.map(() => ({ allocated: 0, startY: 0 }));
  
  incomeNodes.forEach((incomeNode, incomeIdx) => {
    let remainingFromSource = incomeNode.value;
    let sourceStartY = incomeNode.y;
    
    expenseNodes.forEach((expenseNode, expenseIdx) => {
      if (remainingFromSource <= 0) return;
      
      // Calculate how much of this income source goes to this expense
      // Each income contributes proportionally to each expense based on expense/total
      const expenseRatio = expenseNode.value / expenseTotal;
      const flowValue = incomeNode.value * expenseRatio;
      
      if (flowValue > 0) {
        // Source dimensions
        const sourceHeight = (flowValue / incomeNode.value) * incomeNode.height;
        
        // Target dimensions  
        const targetHeight = (flowValue / expenseNode.value) * expenseNode.height;
        const targetStartY = expenseNode.y + expenseAllocations[expenseIdx].startY;
        
        flows.push({
          id: flowId++,
          path: generatePath(
            incomeNode.x + incomeNode.width,
            sourceStartY,
            sourceHeight,
            expenseNode.x,
            targetStartY,
            targetHeight
          ),
          value: flowValue,
          color: incomeNode.color
        });
        
        // Update tracking
        sourceStartY += sourceHeight;
        expenseAllocations[expenseIdx].startY += targetHeight;
        remainingFromSource -= flowValue;
      }
    });
  });
  
  return (
    <svg width={width} height={height} style={{ background: 'transparent' }}>
      {/* Title */}
      <text x={width / 2} y={25} textAnchor="middle" fill="#e2e8f0" fontSize="18" fontWeight="600">
        {title}
      </text>
      
      {/* Flow paths */}
      {flows.map(flow => (
        <path
          key={flow.id}
          d={flow.path}
          fill={flow.color}
          opacity={0.4}
          stroke="none"
        />
      ))}
      
      {/* Income nodes */}
      {incomeNodes.map((node, i) => (
        <g key={`income-${i}`}>
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            fill={node.color}
            rx={3}
          />
          <text
            x={node.x - 10}
            y={node.y + node.height / 2}
            textAnchor="end"
            fill="#cbd5e1"
            fontSize="13"
            fontWeight="500"
            dominantBaseline="middle"
          >
            {node.label}
          </text>
          <text
            x={node.x - 10}
            y={node.y + node.height / 2 + 14}
            textAnchor="end"
            fill="#64748b"
            fontSize="11"
            dominantBaseline="middle"
          >
            ${(node.value / 1000).toFixed(0)}k
          </text>
        </g>
      ))}
      
      {/* Expense nodes */}
      {expenseNodes.map((node, i) => (
        <g key={`expense-${i}`}>
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            fill={node.color}
            rx={3}
          />
          <text
            x={node.x + node.width + 10}
            y={node.y + node.height / 2}
            textAnchor="start"
            fill="#cbd5e1"
            fontSize="13"
            fontWeight="500"
            dominantBaseline="middle"
          >
            {node.label}
          </text>
          <text
            x={node.x + node.width + 10}
            y={node.y + node.height / 2 + 14}
            textAnchor="start"
            fill="#64748b"
            fontSize="11"
            dominantBaseline="middle"
          >
            ${(node.value / 1000).toFixed(0)}k
          </text>
        </g>
      ))}
      
      {/* Left label */}
      <text
        x={padding.left}
        y={padding.top - 20}
        textAnchor="middle"
        fill="#94a3b8"
        fontSize="12"
        fontWeight="600"
      >
        INCOME SOURCES
      </text>
      
      {/* Right label */}
      <text
        x={width - padding.right + 10}
        y={padding.top - 20}
        textAnchor="middle"
        fill="#94a3b8"
        fontSize="12"
        fontWeight="600"
      >
        USES OF INCOME
      </text>
    </svg>
  );
});

// Give display name for React DevTools
SankeyDiagram.displayName = 'SankeyDiagram';

// 2026 Federal Tax Brackets — Source: IRS Revenue Procedure 2025-32
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
const QCD_ANNUAL_LIMIT = 105000; // 2024 limit per person (inflation-indexed)
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

// Calculate Social Security breakeven age between two claiming strategies
const calculateSSBreakeven = (pia, earlyAge, laterAge, birthYear) => {
  const earlyBenefit = calculateSSBenefit(pia, earlyAge, birthYear) * 12;
  const laterBenefit = calculateSSBenefit(pia, laterAge, birthYear) * 12;
  
  if (laterBenefit <= earlyBenefit) return null; // Later benefit should be higher
  
  // Calculate cumulative benefits at each age
  const yearsDelay = laterAge - earlyAge;
  const forgoneAmount = earlyBenefit * yearsDelay;
  const annualDifference = laterBenefit - earlyBenefit;
  
  const yearsToBreakeven = forgoneAmount / annualDifference;
  return Math.round((laterAge + yearsToBreakeven) * 10) / 10;
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

const STORAGE_KEY = 'retirement_planner_data';

const DEFAULT_DASHBOARD_VISIBILITY = {
  summaryCards: true,
  netWorth: true,
  retirementIncome: true,
  cashFlow: true,
  withdrawalRate: true,
  taxSummary: true,
  safeSpending: true,
  coastFire: true,
  lifestyleLegacy: true,
};

// ── HEALTHCARE COST CONSTANTS ───────────────────────────────────────────────────
// Source: Medicare.gov, KFF, Genworth CareScout 2024 survey
const MEDICARE_PART_B_PREMIUM_2025 = 185;    // Monthly Part B base premium (2025)
const MEDICARE_PART_D_PREMIUM_2025 = 35;     // Avg monthly Part D base premium (2025)
const MEDICARE_SUPPLEMENT_PREMIUM_2025 = 175; // Avg monthly Medigap premium (2025)
const MEDICARE_OOP_ANNUAL_2025 = 2000;       // Avg annual out-of-pocket (copays, dental, vision)
const PRE_65_HEALTHCARE_ANNUAL_2025 = 12000; // Avg annual ACA/employer premium for one person
const MEDICAL_INFLATION_RATE = 0.05;         // Healthcare cost inflation (higher than general CPI)
const LTC_MONTHLY_ASSISTED_LIVING_2025 = 5900; // Median monthly assisted living cost (Genworth 2024)
const LTC_DEFAULT_DURATION_MONTHS = 28;      // Default LTC planning: 28 months before death

// Healthcare modeling presets
const HEALTHCARE_PRESETS = {
  none: { label: 'Not Modeled', description: 'Healthcare costs not included in projections' },
  basic: { label: 'Basic', description: 'Medicare premiums + modest OOP after 65; flat estimate pre-65' },
  moderate: { label: 'Moderate', description: 'Medicare + supplemental + OOP; employer/ACA pre-65' },
  comprehensive: { label: 'Comprehensive', description: 'Full Medicare + Medigap + OOP + long-term care' },
  custom: { label: 'Custom', description: 'Set your own pre-65 and post-65 costs' }
};

// ── RECURRING EXPENSE CATEGORIES ────────────────────────────────────────────────
const EXPENSE_CATEGORIES = [
  { value: 'housing', label: 'Housing (rent/maintenance)', icon: '🏠' },
  { value: 'healthcare', label: 'Healthcare', icon: '🏥' },
  { value: 'transportation', label: 'Transportation', icon: '🚗' },
  { value: 'travel', label: 'Travel & Leisure', icon: '✈️' },
  { value: 'education', label: 'Education', icon: '🎓' },
  { value: 'insurance', label: 'Insurance Premiums', icon: '🛡️' },
  { value: 'caregiving', label: 'Caregiving / Support', icon: '👨‍👩‍👧' },
  { value: 'debt_payment', label: 'Debt Payment', icon: '💳' },
  { value: 'long_term_care', label: 'Long-Term Care', icon: '🏥' },
  { value: 'other', label: 'Other', icon: '📋' }
];

const DEFAULT_PERSONAL_INFO = {
  myAge: 45, 
  spouseAge: 43, 
  myRetirementAge: 65, 
  spouseRetirementAge: 65,
  myBirthYear: 1980,  // For accurate RMD age calculation
  spouseBirthYear: 1982, // For accurate RMD age calculation
  filingStatus: 'married_joint', 
  state: 'Alabama', 
  desiredRetirementIncome: 60000, 
  inflationRate: 0.03,
  withdrawalPriority: ['pretax', 'brokerage', 'roth'], // Order: first to last
  charitableGivingPercent: 0, // Percentage of retirement spending donated to charity (enables QCD strategy)
  // Planned Roth conversions: move this much per year from largest pre-tax account to largest Roth account.
  // Conversions are treated as ordinary income in the projection engine (affects taxes and SS taxation).
  rothConversionAmount: 0,       // Annual conversion amount in today's dollars (0 = disabled)
  rothConversionStartAge: 65,    // Age to begin converting
  rothConversionEndAge: 74,      // Age to stop converting (typically just before RMDs dominate)
  rothConversionBracket: '',     // If set ('22%','24%','32%'), fill to this bracket instead of fixed amount
  legacyAge: 95,                 // Planning horizon / legacy target age
  // Survivor modeling: when enabled, models the financial impact of a spouse dying
  // before the planning horizon ends. Changes filing status, stops income streams,
  // and applies SS survivor benefit rules.
  survivorModelEnabled: false,
  myLifeExpectancy: 85,          // Expected age at death (primary)
  spouseLifeExpectancy: 87,      // Expected age at death (spouse)
  // Healthcare expense modeling
  healthcareModel: 'none',       // 'none','basic','moderate','comprehensive','custom'
  pre65HealthcareAnnual: 12000,  // Annual healthcare cost per person before Medicare (ACA/employer)
  post65OOPAnnual: 2000,         // Annual out-of-pocket after Medicare (copays, dental, vision)
  includeMedigap: true,          // Include supplemental/Medigap insurance
  ltcModel: 'default',           // 'none','default','custom' — long-term care expense modeling
  ltcMonthlyAmount: 5900,        // Custom LTC monthly cost
  ltcDurationMonths: 28,         // How many months of LTC to plan for before death
  medicalInflation: 0.05         // Healthcare-specific inflation rate
};

const DEFAULT_ACCOUNTS = [
  { id: 1, name: 'My 401(k)', type: '401k', balance: 100000, contribution: 10000, contributionGrowth: 0.02, cagr: 0.07, startAge: 45, stopAge: 65, owner: 'me', contributor: 'both' },
  { id: 2, name: 'Spouse 401(k)', type: '401k', balance: 45000, contribution: 4500, contributionGrowth: 0.02, cagr: 0.07, startAge: 43, stopAge: 65, owner: 'spouse', contributor: 'both' },
  { id: 3, name: 'My Roth IRA', type: 'roth_ira', balance: 25000, contribution: 5000, contributionGrowth: 0.02, cagr: 0.07, startAge: 45, stopAge: 65, owner: 'me', contributor: 'me' },
  { id: 4, name: 'Savings', type: 'brokerage', balance: 15000, contribution: 2400, contributionGrowth: 0.02, cagr: 0.04, startAge: 45, stopAge: 65, owner: 'joint', contributor: 'me' }
];

const DEFAULT_INCOME_STREAMS = [
  { id: 1, name: 'My Salary', type: 'earned_income', amount: 75000, startAge: 45, endAge: 65, cola: 0.02, owner: 'me' },
  { id: 2, name: 'Spouse Salary', type: 'earned_income', amount: 60000, startAge: 43, endAge: 65, cola: 0.02, owner: 'spouse' },
  { id: 3, name: 'My Social Security', type: 'social_security', amount: 30000, startAge: 67, endAge: 95, cola: 0.02, owner: 'me', pia: 2000 },
  { id: 4, name: 'Spouse Social Security', type: 'social_security', amount: 25000, startAge: 67, endAge: 95, cola: 0.02, owner: 'spouse', pia: 1500 }
];

const DEFAULT_ASSETS = [
  { id: 1, name: 'Primary Residence', type: 'real_estate', value: 350000, appreciationRate: 0.03, mortgage: 150000, mortgagePayoffAge: 70 },
  { id: 2, name: 'Vehicles', type: 'vehicle', value: 35000, appreciationRate: -0.10, mortgage: 0, mortgagePayoffAge: null }
];

// Recurring expenses: modeled separately from desiredRetirementIncome for granularity.
// Each expense has its own start/end age, inflation rate, and category.
// When recurringExpenses has entries, they ADD to the flat desiredRetirementIncome.
const DEFAULT_RECURRING_EXPENSES = [];

const formatCurrency = (value) => {
  if (value === undefined || value === null || isNaN(value)) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
};

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`;

// Calculate federal tax with inflation-adjusted brackets and standard deduction
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

const calculateStateTax = (grossIncome, state, filingStatus, yearsFromNow = 0, inflationRate = 0.03, taxableSS = 0, retirementIncome = 0) => {
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
const loadFromStorage = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Error loading from localStorage:', e);
  }
  return null;
};

// Save data to localStorage
const saveToStorage = (data) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Error saving to localStorage:', e);
  }
};

// ============================================
// Spreadsheet-style Input Components
// These solve: select-on-focus, raw editing of formatted values,
// Enter/Tab to advance, Escape to revert
// ============================================

// Generic spreadsheet cell: selects all on focus, Enter advances to next input
// ============================================
// Spreadsheet Cell Components — select-on-focus, raw editing, same-column Enter nav
// ============================================
// Navigation helper: Enter moves to the same column in the next row (true spreadsheet behavior)
// Enter/Escape navigation for table cells
// Thin wrappers around plain <input>/<select> — matching the modal pattern.
// No onKeyDown, no editing state. Tab works natively.

const SpreadsheetCell = ({ value, onChange, onCommit, className, ...props }) => (
  <input type="text" value={value} onChange={onChange} onBlur={onCommit} className={className} {...props} />
);

const CurrencyCell = ({ value, onValueChange, onCommit, className, prefix = true, ...props }) => (
  <div className="flex items-center justify-end">
    {prefix && <span className="text-slate-500 mr-1 text-sm">$</span>}
    <input type="number" value={value || 0}
      onChange={e => onValueChange(Number(e.target.value) || 0)}
      onBlur={() => { if (onCommit) onCommit(); }}
      className={className} {...props} />
  </div>
);

const PercentCell = ({ value, onValueChange, onCommit, className, ...props }) => (
  <div className="flex items-center justify-end">
    <input type="number" step="0.1" value={((value || 0) * 100).toFixed(1)}
      onChange={e => onValueChange((Number(e.target.value) || 0) / 100)}
      onBlur={() => { if (onCommit) onCommit(); }}
      className={className} {...props} />
    <span className="text-slate-500 ml-0.5 text-sm">%</span>
  </div>
);

const AgeCell = ({ value, onChange, onCommit, className, ...props }) => (
  <input type="number" value={value ?? ''}
    onChange={onChange}
    onBlur={() => { if (onCommit) onCommit(); }}
    className={className} {...props} />
);

const GridSelect = ({ value, onChange, options, className, children, ...props }) => (
  <select value={value} onChange={onChange} className={className} {...props}>
    {children || options?.map(o => typeof o === 'string'
      ? <option key={o} value={o}>{o}</option>
      : <option key={o.value} value={o.value}>{o.label}</option>
    )}
  </select>
);

const InfoCard = memo(({ title, sections, isOpen, onToggle }) => {
  if (!isOpen) {
    return (
      <button
        tabIndex={-1}
        onClick={onToggle}
        className="flex items-center gap-1.5 text-amber-400/70 hover:text-amber-400 transition-colors px-2.5 py-1 rounded-full border border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/10 text-xs font-medium"
        title={`What is ${title}?`}
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
          <text x="10" y="14.5" textAnchor="middle" fill="currentColor" fontSize="12" fontWeight="600">i</text>
        </svg>
        <span>Guide</span>
      </button>
    );
  }

  return (
    <div className="mt-3 mb-1 bg-slate-800/90 border border-amber-500/30 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
        <span className="text-sm font-semibold text-amber-400">ℹ️ Understanding: {title}</span>
        <button
          onClick={onToggle}
          className="text-slate-400 hover:text-slate-200 text-lg leading-none px-1"
        >
          ✕
        </button>
      </div>
      <div className="px-4 py-3 space-y-3 max-h-[28rem] overflow-y-auto">
        {sections.map((section, idx) => (
          <div key={idx}>
            {section.heading && (
              <div className="text-xs font-semibold text-amber-400/80 uppercase tracking-wide mb-1">{section.heading}</div>
            )}
            {section.body && (
              <p className="text-sm text-slate-300 leading-relaxed">{section.body}</p>
            )}
            {section.items && (
              <div className="space-y-1.5 mt-1">
                {section.items.map((item, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="flex-shrink-0 mt-0.5">{item.color && (
                      <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
                    )}{item.icon && <span>{item.icon}</span>}</span>
                    <div>
                      <span className="text-slate-200 font-medium">{item.label}</span>
                      {item.desc && <span className="text-slate-400"> — {item.desc}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {section.tip && (
              <div className="mt-1.5 px-3 py-2 bg-amber-500/5 border-l-2 border-amber-500/40 rounded-r">
                <p className="text-xs text-amber-300/90">💡 {section.tip}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
InfoCard.displayName = 'InfoCard';

export default function RetirementPlanner() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currentYear] = useState(new Date().getFullYear());
  const [saveStatus, setSaveStatus] = useState('');
  const [showImportExport, setShowImportExport] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(() => {
    // Show wizard automatically on first visit (no saved data)
    const saved = loadFromStorage();
    return !saved;
  });
  
  // Logo Component - Bitcoin B logo
  const Logo = ({ size = 'large' }) => {
    const dimensions = size === 'large' ? 'w-14 h-14' : 'w-10 h-10';
    
    return (
      <div className={`${dimensions} flex items-center justify-center`}>
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <g fill="none" fillRule="evenodd">
            <circle cx="16" cy="16" r="16" fill="#F7931A"/>
            <path fill="#FFF" fillRule="nonzero" d="M23.189 14.02c.314-2.096-1.283-3.223-3.465-3.975l.708-2.84-1.728-.43-.69 2.765c-.454-.114-.92-.22-1.385-.326l.695-2.783L15.596 6l-.708 2.839c-.376-.086-.746-.17-1.104-.26l.002-.009-2.384-.595-.46 1.846s1.283.294 1.256.312c.7.175.826.638.805 1.006l-.806 3.235c.048.012.11.03.18.057l-.183-.045-1.13 4.532c-.086.212-.303.531-.793.41.018.025-1.256-.313-1.256-.313l-.858 1.978 2.25.561c.418.105.828.215 1.231.318l-.715 2.872 1.727.43.708-2.84c.472.127.93.245 1.378.357l-.706 2.828 1.728.43.715-2.866c2.948.558 5.164.333 6.097-2.333.752-2.146-.037-3.385-1.588-4.192 1.13-.26 1.98-1.003 2.207-2.538zm-3.95 5.538c-.533 2.147-4.148.986-5.32.695l.95-3.805c1.172.293 4.929.872 4.37 3.11zm.535-5.569c-.487 1.953-3.495.96-4.47.717l.86-3.45c.975.243 4.118.696 3.61 2.733z"/>
          </g>
        </svg>
      </div>
    );
  };
  
  // Initialize state from localStorage or defaults - load once for all state slices
  const [savedData] = useState(() => loadFromStorage());
  
  const [personalInfo, setPersonalInfo] = useState(() => {
    const currentYear = new Date().getFullYear();
    // Merge saved data with defaults to ensure new fields are present
    const merged = savedData?.personalInfo ? { ...DEFAULT_PERSONAL_INFO, ...savedData.personalInfo } : DEFAULT_PERSONAL_INFO;
    
    // Auto-calculate birth years if missing (for backward compatibility)
    if (!merged.myBirthYear) {
      merged.myBirthYear = currentYear - merged.myAge;
    }
    if (!merged.spouseBirthYear) {
      merged.spouseBirthYear = currentYear - merged.spouseAge;
    }
    
    return merged;
  });
  
  const [accounts, setAccounts] = useState(() => {
    return savedData?.accounts || DEFAULT_ACCOUNTS;
  });
  
  const [incomeStreams, setIncomeStreams] = useState(() => {
    return savedData?.incomeStreams || DEFAULT_INCOME_STREAMS;
  });
  
  const [assets, setAssets] = useState(() => {
    return savedData?.assets || DEFAULT_ASSETS;
  });
  const [oneTimeEvents, setOneTimeEvents] = useState(() => {
    return savedData?.oneTimeEvents || [];
  });
  const [recurringExpenses, setRecurringExpenses] = useState(() => {
    return savedData?.recurringExpenses || DEFAULT_RECURRING_EXPENSES;
  });

  const [dashboardVisibility, setDashboardVisibility] = useState(() => {
    return savedData?.dashboardVisibility || DEFAULT_DASHBOARD_VISIBILITY;
  });

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showDashboardSettings, setShowDashboardSettings] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [editingIncome, setEditingIncome] = useState(null);
  const [editingAsset, setEditingAsset] = useState(null);
  
  // Scenario comparison state
  const [scenarios, setScenarios] = useState([]);
  const [activeScenarioId, setActiveScenarioId] = useState(null);
  
  // Create a scenario from current settings
  const createScenario = (name) => {
    const newScenario = {
      id: Date.now(),
      name,
      personalInfo: { ...personalInfo },
      accounts: accounts.map(a => ({ ...a })),
      incomeStreams: incomeStreams.map(i => ({ ...i })),
      assets: assets.map(a => ({ ...a })),
      oneTimeEvents: oneTimeEvents.map(e => ({ ...e })),
      recurringExpenses: recurringExpenses.map(e => ({ ...e })),
      createdAt: new Date().toISOString()
    };
    setScenarios(prev => [...prev, newScenario]);
    return newScenario.id;
  };
  
  // Delete a scenario
  const deleteScenario = (id) => {
    setScenarios(prev => prev.filter(s => s.id !== id));
    if (activeScenarioId === id) setActiveScenarioId(null);
  };
  
  // Load a scenario's settings
  const loadScenario = (id) => {
    const scenario = scenarios.find(s => s.id === id);
    if (scenario) {
      setPersonalInfo(scenario.personalInfo);
      setAccounts(scenario.accounts);
      setIncomeStreams(scenario.incomeStreams);
      if (scenario.assets) setAssets(scenario.assets);
      if (scenario.oneTimeEvents) setOneTimeEvents(scenario.oneTimeEvents);
      if (scenario.recurringExpenses) setRecurringExpenses(scenario.recurringExpenses);
      setActiveScenarioId(id);
    }
  };
  
  // Auto-save to localStorage with debouncing to prevent excessive saves
  useEffect(() => {
    const saveTimer = setTimeout(() => {
      const data = { personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses, dashboardVisibility, scenarios, lastSaved: new Date().toISOString() };
      saveToStorage(data);
      setSaveStatus('Saved');
    }, SAVE_DEBOUNCE_MS);
    
    // Clear the save status after showing it
    const clearTimer = setTimeout(() => setSaveStatus(''), SAVE_DEBOUNCE_MS + 2000);
    
    return () => {
      clearTimeout(saveTimer);
      clearTimeout(clearTimer);
    };
  }, [personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses, dashboardVisibility, scenarios]);
  
  // Export data as JSON file
  const handleExport = () => {
    const data = {
      personalInfo,
      accounts,
      incomeStreams,
      assets,
      oneTimeEvents,
      dashboardVisibility,
      scenarios,
      exportDate: new Date().toISOString(),
      version: '1.7'  // v19 - P1 fixes + one-time events + survivor modeling
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `retirement-plan-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSaveStatus('Exported!');
    setTimeout(() => setSaveStatus(''), 2000);
  };
  
  // Import data from JSON file
  const handleImport = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result);
        if (data.personalInfo) setPersonalInfo(data.personalInfo);
        if (data.accounts) setAccounts(data.accounts);
        if (data.incomeStreams) setIncomeStreams(data.incomeStreams);
        if (data.assets) setAssets(data.assets);
        if (data.oneTimeEvents) setOneTimeEvents(data.oneTimeEvents);
        if (data.recurringExpenses) setRecurringExpenses(data.recurringExpenses);
        setDashboardVisibility(data.dashboardVisibility || DEFAULT_DASHBOARD_VISIBILITY);
        if (data.scenarios) setScenarios(data.scenarios);
        setSaveStatus('Imported!');
        setTimeout(() => setSaveStatus(''), 2000);
      } catch (err) {
        alert('Error importing file. Please make sure it\'s a valid retirement plan export.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };
  
  // Reset to defaults
  const handleReset = () => {
    // Clear localStorage first
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.log('localStorage not available');
    }
    
    // Force reset all state to defaults
    setPersonalInfo(DEFAULT_PERSONAL_INFO);
    setAccounts(DEFAULT_ACCOUNTS);
    setIncomeStreams(DEFAULT_INCOME_STREAMS);
    setAssets(DEFAULT_ASSETS);
    setOneTimeEvents([]);
    setRecurringExpenses(DEFAULT_RECURRING_EXPENSES);
    setDashboardVisibility(DEFAULT_DASHBOARD_VISIBILITY);
    setScenarios([]);
    
    setShowResetConfirm(false);
    setShowImportExport(false);
    setSaveStatus('Data Cleared!');
    setTimeout(() => setSaveStatus(''), 2000);
  };
  
  const assetTypes = [
    { value: 'real_estate', label: 'Real Estate' },
    { value: 'business', label: 'Business Ownership' },
    { value: 'vehicle', label: 'Vehicle' },
    { value: 'collectibles', label: 'Collectibles/Art' },
    { value: 'other', label: 'Other Asset' }
  ];
  
  const accountTypes = [
    { value: '401k', label: '401(k)' },
    { value: 'roth_401k', label: 'Roth 401(k)' },
    { value: '403b', label: '403(b)' },
    { value: 'roth_403b', label: 'Roth 403(b)' },
    { value: 'roth_ira', label: 'Roth IRA' },
    { value: 'traditional_ira', label: 'Traditional IRA' },
    { value: 'brokerage', label: 'Brokerage' },
    { value: '457b', label: '457(b)' },
    { value: 'roth_457b', label: 'Roth 457(b)' },
    { value: 'hsa', label: 'HSA' }
  ];
  
  const contributorTypes = [
    { value: 'me', label: 'Me' },
    { value: 'employer', label: 'Employer' },
    { value: 'both', label: 'Both' }
  ];
  
  const incomeTypes = [
    { value: 'earned_income', label: 'Earned Income (Salary/Wages)' },
    { value: 'social_security', label: 'Social Security' },
    { value: 'pension', label: 'Pension' },
    { value: 'business', label: 'Business Income' },
    { value: 'rental', label: 'Rental Income' },
    { value: 'annuity', label: 'Annuity' },
    { value: 'other', label: 'Other Income' }
  ];
  
  const computeProjections = (pi, accts, streams, assetList, events = [], recurringExpensesList = []) => {
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
          // Survivor gets the higher SS benefit
          if (primarySSAmount >= spouseSSAmount) {
            survivorSSBenefit = primarySSAmount;  // Spouse inherits primary's higher benefit
            deceasedSSBenefit = spouseSSAmount;    // Spouse's own benefit stops (replaced)
          }
        }
        if (spouseAlive && spouseAge > pi.spouseLifeExpectancy) {
          spouseAlive = false;
          if (!yearOfFirstDeath) yearOfFirstDeath = year;
          survivorEvent = survivorEvent ? 'both_died' : 'spouse_died';
          // Survivor gets the higher SS benefit
          if (spouseSSAmount >= primarySSAmount) {
            survivorSSBenefit = spouseSSAmount;   // Primary inherits spouse's higher benefit
            deceasedSSBenefit = primarySSAmount;   // Primary's own benefit stops (replaced)
          }
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
      // When one spouse dies, the survivor receives the HIGHER of their own or
      // the deceased's SS benefit (but not both). Add the uplift if applicable.
      if (survivorEnabled && yearOfFirstDeath && (primaryAlive !== spouseAlive)) {
        // Determine which SS stream belongs to the survivor
        const survivorOwner = primaryAlive ? 'me' : 'spouse';
        const survivorAge = primaryAlive ? myAge : spouseAge;
        const survivorStream = streams.find(s => s.type === 'social_security' && s.owner === survivorOwner);
        
        if (survivorStream && survivorAge >= survivorStream.startAge && survivorAge <= survivorStream.endAge) {
          // The survivor is already collecting their own SS (added above).
          // If the deceased's benefit was higher, add the difference as a survivor uplift.
          if (survivorSSBenefit > 0) {
            const yearsFromStart = survivorAge - survivorStream.startAge;
            const currentOwnSS = survivorStream.amount * Math.pow(1 + (survivorStream.cola || 0), yearsFromStart);
            // Apply same COLA to the inherited benefit 
            const inheritedSS = survivorSSBenefit * Math.pow(1 + (survivorStream.cola || 0), yearsFromStart);
            if (inheritedSS > currentOwnSS) {
              // Replace own benefit with inherited (add the uplift)
              totalSocialSecurity += (inheritedSS - currentOwnSS);
            }
          }
        } else if (survivorSSBenefit > 0) {
          // Survivor hasn't started their own SS yet but may still be eligible
          // for the deceased's benefit at the deceased's start age
          const deceasedStream = streams.find(s => s.type === 'social_security' && s.owner !== survivorOwner);
          if (deceasedStream) {
            const deceasedStartAge = deceasedStream.startAge;
            // Survivor can claim survivor benefits as early as age 60
            const survivorClaimAge = Math.max(60, deceasedStartAge);
            if (survivorAge >= survivorClaimAge) {
              const yearsFromDeceasedStart = survivorAge - deceasedStartAge;
              const inheritedSS = survivorSSBenefit * Math.pow(1 + (deceasedStream.cola || 0), Math.max(0, yearsFromDeceasedStart));
              totalSocialSecurity += inheritedSS;
            }
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
      
      accts.forEach(account => {
        const ownerAge = account.owner === 'me' ? myAge : account.owner === 'spouse' ? spouseAge : Math.max(myAge, spouseAge);
        const yearsContributing = ownerAge - account.startAge;
        const contributionGrowth = account.contributionGrowth || 0;
        const ownerAlive = account.owner === 'me' ? primaryAlive : account.owner === 'spouse' ? spouseAlive : (primaryAlive || spouseAlive);
        
        // Add contributions if in contribution period AND owner is alive
        if (ownerAlive && ownerAge >= account.startAge && ownerAge < account.stopAge) {
          const adjustedContribution = account.contribution * Math.pow(1 + contributionGrowth, Math.max(0, yearsContributing));
          accountBalances[account.id] += adjustedContribution;
          
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
      
      // Calculate totals BEFORE withdrawals (for reporting beginning-of-year balances)
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
        const baseStateTax = calculateStateTax(baseGrossIncome, pi.state, effectiveFilingStatus, yearsFromNow, pi.inflationRate, taxableSS, baseRetirementIncome);
        
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
            const totalStateTax = calculateStateTax(adjustedBaseGross, pi.state, effectiveFilingStatus, yearsFromNow, pi.inflationRate, adjustedTaxableSS, iterRetirementIncome);
            
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
            } else if (isRothAccount(account.type) || isHSAAccount(account.type)) {
              rothWithdrawals += withdrawal; // Both Roth and HSA (qualified) are tax-free
            }
          }
        });
        // Also draw from reinvestment pool when brokerage category is being accessed
        if (category === 'brokerage' && additionalNeeded > 0 && excessReinvestmentPool > 0) {
          const poolWithdrawal = Math.min(excessReinvestmentPool, additionalNeeded);
          excessReinvestmentPool -= poolWithdrawal;
          additionalNeeded -= poolWithdrawal;
          brokerageWithdrawals += poolWithdrawal;
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
      const conversionStartAge = pi.rothConversionStartAge ?? 65;
      const conversionEndAge = pi.rothConversionEndAge ?? 74;
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
      
      // For brokerage, estimate that portion is taxable gains (simplified assumption)
      // In reality, this depends on cost basis which varies by account
      const capitalGainsFromWithdrawals = brokerageWithdrawals * (1 - BROKERAGE_COST_BASIS_ESTIMATE);
      
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
      stateTax = calculateStateTax(finalTotalTaxableIncome, pi.state, effectiveFilingStatus, yearsFromNow, pi.inflationRate, finalTaxableSS, finalRetirementIncome);
      
      // Calculate state taxable income (for display in detailed table)
      // Mirror the logic inside calculateStateTax
      const stateSSExclusion = STATES_THAT_TAX_SS.has(pi.state) ? 0 : finalTaxableSS;
      const stateRetExclusion = STATES_EXEMPT_RETIREMENT_INCOME.has(pi.state) ? finalRetirementIncome : 0;
      const stateGrossForCalc = finalTotalTaxableIncome - stateSSExclusion - stateRetExclusion;
      const stateDeduction = (STANDARD_DEDUCTION_2026[effectiveFilingStatus] || STANDARD_DEDUCTION_2026.married_joint) * inflationFactor;
      const stateTaxableIncome = Math.max(0, stateGrossForCalc - stateDeduction);
      
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
      const totalInvestmentIncome = capitalGainsFromWithdrawals + (brokerageWithdrawals * BROKERAGE_COST_BASIS_ESTIMATE * 0.02); // Rough estimate of dividends
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
      let numMedicareEligible = 0;
      if (primaryAlive && myAge >= 65) numMedicareEligible++;
      if (effectiveFilingStatus === 'married_joint' && spouseAlive && spouseAge >= 65) numMedicareEligible++;
      if (numMedicareEligible > 0) {
        const irmaaResult = calculateIRMAASurcharge(magi, effectiveFilingStatus, yearsFromNow, pi.inflationRate, numMedicareEligible);
        irmaaSurcharge = irmaaResult.totalSurcharge;
      }
      
      // Update total taxes for downstream calculations
      const totalTaxes = federalTax + stateTax;
      
      // Step 3: Add excess RMD to brokerage (after paying taxes)
      // The excess RMD is money you were forced to withdraw but don't need to spend
      // After paying taxes on it, the remainder gets reinvested in brokerage
      if (excessRMD > 0) {
        // Calculate marginal tax rate on the excess
        const totalGrossIncome = finalTotalTaxableIncome + capitalGainsFromWithdrawals;
        const effectiveTaxRate = totalGrossIncome > 0 ? totalTaxes / totalGrossIncome : 0.25;
        // Use marginal rate (roughly) - the excess is taxed at your marginal rate
        const marginalRate = Math.min(0.40, effectiveTaxRate * 1.3); // Estimate marginal as ~30% higher than effective
        const afterTaxExcess = excessRMD * (1 - marginalRate);
        
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
      
      // Step 4: Apply growth to all accts (after withdrawals)
      accts.forEach(account => {
        accountBalances[account.id] = Math.max(0, accountBalances[account.id]) * (1 + account.cagr);
      });
      // Grow the excess reinvestment pool (for users without brokerage accounts)
      excessReinvestmentPool *= (1 + reinvestmentGrowthRate);
      
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
      
      // Calculate non-liquid assetList (for legacy planning)
      let totalAssetValue = 0;
      let totalAssetDebt = 0;
      assetList.forEach(asset => {
        const assetValue = asset.value * Math.pow(1 + (asset.appreciationRate || 0), yearsFromNow);
        totalAssetValue += Math.max(0, assetValue); // Don't go negative for depreciating assetList
        
        // Calculate remaining mortgage
        if (asset.mortgage > 0 && asset.mortgagePayoffAge) {
          if (myAge < asset.mortgagePayoffAge) {
            // Simple linear payoff assumption
            const yearsToPayoff = asset.mortgagePayoffAge - pi.myAge;
            const yearsPaid = yearsFromNow;
            const remainingMortgage = asset.mortgage * Math.max(0, 1 - (yearsPaid / yearsToPayoff));
            totalAssetDebt += remainingMortgage;
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
        assetValue: Math.round(totalAssetValue),
        assetDebt: Math.round(totalAssetDebt),
        netAssetValue: Math.round(netAssetValue),
        totalNetWorth: Math.round(finalPreTaxBalance + finalRothBalance + finalBrokerageBalance + netAssetValue),
        // Per-account balances snapshot (used by individual account view in Accounts tab)
        perAccountBalances: accts.reduce((obj, a) => {
          obj[a.id] = Math.round(accountBalances[a.id] || 0);
          return obj;
        }, {}),
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
  };

  const projections = useMemo(() => {
    return computeProjections(personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses);
  }, [accounts, incomeStreams, assets, personalInfo, oneTimeEvents, recurringExpenses, currentYear]);
  
  // Input validation helper
  const validateAccount = (account) => {
    if (!account.name?.trim()) return 'Account name is required';
    if (account.balance < 0) return 'Balance cannot be negative';
    if (account.contribution < 0) return 'Contribution cannot be negative';
    if (account.startAge >= account.stopAge) return 'Start age must be less than stop age';
    return null;
  };
  
  const validateIncome = (income) => {
    if (!income.name?.trim()) return 'Income name is required';
    if (income.amount < 0) return 'Amount cannot be negative';
    if (income.startAge > income.endAge) return 'Start age must not exceed end age';
    return null;
  };
  
  const handleSaveAccount = (account) => {
    const error = validateAccount(account);
    if (error) {
      alert(error);
      return;
    }
    if (account.id) setAccounts(accounts.map(a => a.id === account.id ? account : a));
    else setAccounts([...accounts, { ...account, id: Date.now() }]);
    setShowAccountModal(false);
    setEditingAccount(null);
  };
  
  const handleSaveIncome = (income) => {
    const error = validateIncome(income);
    if (error) {
      alert(error);
      return;
    }
    if (income.id) setIncomeStreams(incomeStreams.map(i => i.id === income.id ? income : i));
    else setIncomeStreams([...incomeStreams, { ...income, id: Date.now() }]);
    setShowIncomeModal(false);
    setEditingIncome(null);
  };

  // Dark mode styles
  const cardStyle = "bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6 shadow-xl";
  const inputStyle = "w-full bg-slate-900/80 border border-slate-600/50 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all";
  const labelStyle = "block text-sm font-medium text-slate-400 mb-1.5";
  const buttonPrimary = "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900 font-semibold px-6 py-2.5 rounded-lg transition-all shadow-lg";
  const buttonSecondary = "bg-slate-700 hover:bg-slate-600 text-slate-100 font-medium px-4 py-2 rounded-lg transition-all";
  
  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Navigation structure with groups
  const navGroups = [
    {
      label: 'OVERVIEW',
      icon: '📊',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: '🏠' }
      ]
    },
    {
      label: 'PLAN SETUP',
      icon: '⚙️',
      items: [
        { id: 'personal', label: 'Personal Info', icon: '👤' },
        { id: 'accounts', label: 'Accounts', icon: '💰' },
        { id: 'assets', label: 'Assets', icon: '🏠' },
        { id: 'income', label: 'Income Streams', icon: '💵' }
      ]
    },
    {
      label: 'ANALYSIS',
      icon: '📈',
      items: [
        { id: 'socialsecurity', label: 'Social Security', icon: '🎯' },
        { id: 'taxplanning', label: 'Tax Planning', icon: '📋' },
        { id: 'withdrawal', label: 'Withdrawals', icon: '📤' },
        { id: 'montecarlo', label: 'Monte Carlo', icon: '🎲' }
      ]
    },
    {
      label: 'TOOLS',
      icon: '🔧',
      items: [
        { id: 'scenarios', label: 'Scenarios', icon: '🔀' },
        { id: 'table', label: 'Detailed Table', icon: '📊' },
        { id: 'faq', label: 'Assumptions', icon: '❓' }
      ]
    }
  ];
  
  const NavItem = ({ id, label, icon }) => (
    <button 
      onClick={() => setActiveTab(id)} 
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
        activeTab === id 
          ? 'bg-amber-500/20 text-amber-400 border-l-2 border-amber-500' 
          : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
      }`}
    >
      <span className="text-base">{icon}</span>
      {!sidebarCollapsed && <span className="font-medium">{label}</span>}
    </button>
  );
  
  const NavGroup = ({ group }) => (
    <div className="mb-4">
      {!sidebarCollapsed && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-700/50 pb-2 mb-1">
          <span>{group.icon}</span>
          <span>{group.label}</span>
        </div>
      )}
      {sidebarCollapsed && (
        <div className="flex justify-center py-2 text-slate-600">
          <span className="text-lg">{group.icon}</span>
        </div>
      )}
      <div className="space-y-1">
        {group.items.map(item => (
          <NavItem key={item.id} {...item} />
        ))}
      </div>
    </div>
  );
  
  const AccountModal = () => {
    const [formData, setFormData] = useState(editingAccount || { name: '', type: '401k', balance: 0, contribution: 0, contributionGrowth: 0.02, cagr: 0.07, startAge: personalInfo.myAge, stopAge: personalInfo.myRetirementAge, owner: 'me', contributor: 'me' });
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className={`${cardStyle} max-w-lg w-full max-h-[90vh] overflow-y-auto`}>
          <h3 className="text-xl font-bold text-slate-100 mb-6">{editingAccount ? 'Edit Account' : 'Add New Account'}</h3>
          <div className="space-y-4">
            <div><label className={labelStyle}>Account Name</label><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className={inputStyle} /></div>
            <div><label className={labelStyle}>Account Type</label><select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className={inputStyle}>{accountTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelStyle}>Owner</label><select value={formData.owner} onChange={e => setFormData({...formData, owner: e.target.value})} className={inputStyle}><option value="me">Me</option><option value="spouse">Spouse</option><option value="joint">Joint</option></select></div>
              <div><label className={labelStyle}>Contributor</label><select value={formData.contributor || 'me'} onChange={e => setFormData({...formData, contributor: e.target.value})} className={inputStyle}>{contributorTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelStyle}>Current Balance</label><input type="number" value={formData.balance} onChange={e => setFormData({...formData, balance: Number(e.target.value)})} className={inputStyle} /></div>
              <div><label className={labelStyle}>Annual Contribution</label><input type="number" value={formData.contribution} onChange={e => setFormData({...formData, contribution: Number(e.target.value)})} className={inputStyle} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelStyle}>Contribution Growth (%/yr)</label><input type="number" step="0.1" value={((formData.contributionGrowth || 0) * 100).toFixed(1)} onChange={e => setFormData({...formData, contributionGrowth: Number(e.target.value) / 100})} className={inputStyle} /></div>
              <div><label className={labelStyle}>Expected CAGR (%)</label><input type="number" step="0.1" value={(formData.cagr * 100).toFixed(1)} onChange={e => setFormData({...formData, cagr: Number(e.target.value) / 100})} className={inputStyle} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelStyle}>Contribution Start Age</label><input type="number" value={formData.startAge} onChange={e => setFormData({...formData, startAge: Number(e.target.value)})} className={inputStyle} /></div>
              <div><label className={labelStyle}>Contribution Stop Age</label><input type="number" value={formData.stopAge} onChange={e => setFormData({...formData, stopAge: Number(e.target.value)})} className={inputStyle} /></div>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-8">
            <button onClick={() => { setShowAccountModal(false); setEditingAccount(null); }} className={buttonSecondary}>Cancel</button>
            <button onClick={() => handleSaveAccount(formData)} className={buttonPrimary}>Save Account</button>
          </div>
        </div>
      </div>
    );
  };
  
  const IncomeModal = () => {
    const [formData, setFormData] = useState(editingIncome || { name: '', type: 'pension', amount: 0, startAge: 62, endAge: 95, cola: 0.02, owner: 'me', pia: 0 });
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className={`${cardStyle} max-w-lg w-full max-h-[90vh] overflow-y-auto`}>
          <h3 className="text-xl font-bold text-slate-100 mb-6">{editingIncome ? 'Edit Income Stream' : 'Add Income Stream'}</h3>
          <div className="space-y-4">
            <div><label className={labelStyle}>Income Name</label><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className={inputStyle} /></div>
            <div><label className={labelStyle}>Income Type</label><select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className={inputStyle}>{incomeTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
            <div><label className={labelStyle}>Owner</label><select value={formData.owner} onChange={e => setFormData({...formData, owner: e.target.value})} className={inputStyle}><option value="me">Me</option><option value="spouse">Spouse</option></select></div>
            {formData.type === 'social_security' && <div><label className={labelStyle}>PIA (Monthly)</label><input type="number" value={formData.pia} onChange={e => setFormData({...formData, pia: Number(e.target.value), amount: Number(e.target.value) * 12})} className={inputStyle} /></div>}
            <div><label className={labelStyle}>Annual Amount</label><input type="number" value={formData.amount} onChange={e => setFormData({...formData, amount: Number(e.target.value)})} className={inputStyle} /></div>
            <div><label className={labelStyle}>COLA (%)</label><input type="number" step="0.1" value={(formData.cola * 100).toFixed(1)} onChange={e => setFormData({...formData, cola: Number(e.target.value) / 100})} className={inputStyle} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelStyle}>Start Age</label><input type="number" value={formData.startAge} onChange={e => setFormData({...formData, startAge: Number(e.target.value)})} className={inputStyle} /></div>
              <div><label className={labelStyle}>End Age</label><input type="number" value={formData.endAge} onChange={e => setFormData({...formData, endAge: Number(e.target.value)})} className={inputStyle} /></div>
            </div>
            {formData.type === 'pension' && personalInfo.survivorModelEnabled && (
              <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-lg space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={formData.survivorBenefit || false}
                    onChange={e => setFormData({...formData, survivorBenefit: e.target.checked})}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500"
                  />
                  <span className="text-sm text-slate-300">Continues for surviving spouse</span>
                </label>
                {formData.survivorBenefit && (
                  <div>
                    <label className={labelStyle}>Survivor Benefit Rate (%)</label>
                    <input 
                      type="number" step="5" min={0} max={100}
                      value={Math.round((formData.survivorBenefitRate || 0.5) * 100)}
                      onChange={e => setFormData({...formData, survivorBenefitRate: Number(e.target.value) / 100})}
                      className={inputStyle}
                    />
                    <p className="text-xs text-slate-500 mt-1">Percentage of pension paid to survivor (typically 50-100%)</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 mt-8">
            <button onClick={() => { setShowIncomeModal(false); setEditingIncome(null); }} className={buttonSecondary}>Cancel</button>
            <button onClick={() => handleSaveIncome(formData)} className={buttonPrimary}>Save Income</button>
          </div>
        </div>
      </div>
    );
  };
  
  const AssetModal = () => {
    const [formData, setFormData] = useState(editingAsset || { name: '', type: 'real_estate', value: 0, appreciationRate: 0.03, mortgage: 0, mortgagePayoffAge: null });
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className={`${cardStyle} max-w-lg w-full max-h-[90vh] overflow-y-auto`}>
          <h3 className="text-xl font-bold text-slate-100 mb-6">{editingAsset ? 'Edit Asset' : 'Add New Asset'}</h3>
          <div className="space-y-4">
            <div><label className={labelStyle}>Asset Name</label><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className={inputStyle} placeholder="e.g., Primary Residence, Rental Property" /></div>
            <div><label className={labelStyle}>Asset Type</label><select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className={inputStyle}>{assetTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelStyle}>Current Value</label><input type="number" value={formData.value} onChange={e => setFormData({...formData, value: Number(e.target.value)})} className={inputStyle} /></div>
              <div><label className={labelStyle}>Annual Appreciation (%)</label><input type="number" step="0.5" value={(formData.appreciationRate * 100).toFixed(1)} onChange={e => setFormData({...formData, appreciationRate: Number(e.target.value) / 100})} className={inputStyle} /><p className="text-xs text-slate-500 mt-1">Use negative for depreciation (e.g., vehicles)</p></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelStyle}>Outstanding Mortgage/Loan</label><input type="number" value={formData.mortgage} onChange={e => setFormData({...formData, mortgage: Number(e.target.value)})} className={inputStyle} /></div>
              <div><label className={labelStyle}>Payoff Age</label><input type="number" value={formData.mortgagePayoffAge || ''} onChange={e => setFormData({...formData, mortgagePayoffAge: e.target.value ? Number(e.target.value) : null})} className={inputStyle} placeholder="Leave blank if no loan" /></div>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-8">
            <button onClick={() => { setShowAssetModal(false); setEditingAsset(null); }} className={buttonSecondary}>Cancel</button>
            <button onClick={() => handleSaveAsset(formData)} className={buttonPrimary}>Save Asset</button>
          </div>
        </div>
      </div>
    );
  };
  
  const handleSaveAsset = (asset) => {
    if (asset.id) setAssets(assets.map(a => a.id === asset.id ? asset : a));
    else setAssets([...assets, { ...asset, id: Date.now() }]);
    setShowAssetModal(false);
    setEditingAsset(null);
  };
  const ImportExportModal = () => (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`${cardStyle} max-w-md w-full`}>
        <h3 className="text-xl font-bold text-slate-100 mb-6">Import / Export Data</h3>
        <div className="space-y-6">
          <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
            <h4 className="text-sm font-medium text-slate-300 mb-2">Export Your Data</h4>
            <p className="text-xs text-slate-500 mb-3">Download your retirement plan as a JSON file for backup or to transfer to another device.</p>
            <button onClick={handleExport} className={buttonPrimary + " w-full"}>
              📥 Download Backup File
            </button>
          </div>
          
          <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
            <h4 className="text-sm font-medium text-slate-300 mb-2">Import Data</h4>
            <p className="text-xs text-slate-500 mb-3">Load a previously exported retirement plan file. This will replace your current data.</p>
            <label className={buttonSecondary + " w-full block text-center cursor-pointer"}>
              📤 Choose File to Import
              <input type="file" accept=".json" onChange={handleImport} className="hidden" />
            </label>
          </div>
          
          <div className="p-4 bg-red-900/20 rounded-lg border border-red-700/50">
            <h4 className="text-sm font-medium text-red-400 mb-2">Clear My Data</h4>
            <p className="text-xs text-slate-500 mb-3">Remove all your personal data from this browser and reset to sample data.</p>
            {!showResetConfirm ? (
              <button onClick={() => setShowResetConfirm(true)} className="w-full bg-red-600 hover:bg-red-500 text-white font-medium px-4 py-2 rounded-lg transition-all">
                🗑️ Clear All My Data
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-red-300 font-medium">Are you sure? This cannot be undone!</p>
                <div className="flex gap-2">
                  <button onClick={handleReset} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-medium px-4 py-2 rounded-lg transition-all">
                    Yes, Delete Everything
                  </button>
                  <button onClick={() => setShowResetConfirm(false)} className="flex-1 bg-slate-600 hover:bg-slate-500 text-white font-medium px-4 py-2 rounded-lg transition-all">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end mt-6">
          <button onClick={() => setShowImportExport(false)} className={buttonSecondary}>Close</button>
        </div>
      </div>
    </div>
  );
  
  const DashboardTab = () => {
    const current = projections[0];
    
    // Use dashboardVisibility from parent state (passed via closure)
    const visibilitySettings = dashboardVisibility;
    const setVisibilitySettings = setDashboardVisibility;
    const showSettings = showDashboardSettings;
    const setShowSettings = setShowDashboardSettings;
    
    const toggleVisibility = (key) => {
      setVisibilitySettings(prev => ({ ...prev, [key]: !prev[key] }));
    };
    
    // Find retirement age (first year with no earned income)
    const retirementProjection = projections.find(p => p.earnedIncome === 0);
    const retirementAge = retirementProjection?.myAge || 65;
    
    // Savings rate for dashboard card (pre-retirement only)
    const dashEarnedIncome = incomeStreams
      .filter(s => {
        if (s.type !== 'earned_income' && s.type !== 'business') return false;
        const ownerAge = s.owner === 'me' ? personalInfo.myAge : personalInfo.spouseAge;
        return ownerAge >= s.startAge && ownerAge <= s.endAge;
      })
      .reduce((sum, s) => sum + s.amount, 0);
    const dashMyContributions = accounts
      .filter(a => (a.contributor || 'me') === 'me' || (a.contributor || 'me') === 'both')
      .reduce((sum, a) => sum + a.contribution, 0);
    const dashTotalContributions = accounts.reduce((sum, a) => sum + a.contribution, 0);
    const dashSavingsRate = dashEarnedIncome > 0 ? (dashMyContributions / dashEarnedIncome) * 100 : null;
    const isPreRetirement = current?.earnedIncome > 0;
    
    const [netWorthRange, setNetWorthRange] = useState({ start: personalInfo.myAge, end: personalInfo.legacyAge || MAX_AGE });
    const [incomeRange, setIncomeRange] = useState({ start: personalInfo.myAge, end: personalInfo.legacyAge || MAX_AGE });
    const [sankeyAge, setSankeyAge] = useState(retirementAge);
    
    // Info card open/close state — tracks which section's info card is visible
    const [openInfoCard, setOpenInfoCard] = useState(null);
    const toggleInfoCard = useCallback((id) => {
      setOpenInfoCard(prev => prev === id ? null : id);
    }, []);
    
    // Memoize filtered data to prevent recalculation on every render
    const netWorthData = useMemo(() => 
      projections.filter(p => p.myAge >= netWorthRange.start && p.myAge <= netWorthRange.end),
      [projections, netWorthRange.start, netWorthRange.end]
    );
    
    const incomeData = useMemo(() => 
      projections.filter(p => p.myAge >= incomeRange.start && p.myAge <= incomeRange.end),
      [projections, incomeRange.start, incomeRange.end]
    );
    
    return (
      <div className="space-y-4">
        {/* View Settings Toggle Button */}
        <div className="flex justify-end">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-4 py-2 bg-slate-800/60 border border-slate-600/50 rounded-lg text-sm text-slate-300 hover:bg-slate-700/60 transition-colors flex items-center gap-2"
          >
            <span>{showSettings ? 'Hide Settings' : 'View Settings'}</span>
          </button>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className={cardStyle}>
            <h3 className="text-lg font-semibold text-slate-100 mb-3">Dashboard Visibility Settings</h3>
            <p className="text-sm text-slate-400 mb-4">Toggle sections on/off. Hidden sections can be restored here.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { key: 'summaryCards', label: 'Summary Cards' },
                { key: 'netWorth', label: 'Net Worth Projection' },
                { key: 'retirementIncome', label: 'Retirement Income vs Spending' },
                { key: 'cashFlow', label: 'Annual Cash Flow' },
                { key: 'withdrawalRate', label: 'Portfolio Withdrawal Rate' },
                { key: 'taxSummary', label: 'Lifetime Tax Summary' },
                { key: 'safeSpending', label: 'Safe Spending Capacity' },
                { key: 'coastFire', label: 'Coast FIRE Indicator' },
                { key: 'lifestyleLegacy', label: 'Lifestyle vs Legacy' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => toggleVisibility(key)}
                  className={`px-4 py-3 rounded-lg border text-left transition-all ${
                    visibilitySettings[key]
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-800/40 border-slate-700/40 text-slate-500'
                  }`}
                >
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs mt-1 opacity-70">
                    {visibilitySettings[key] ? '✓ Visible' : '✗ Hidden'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Compact Summary Row */}
        {visibilitySettings.summaryCards && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <InfoCard
              title="Summary Cards"
              isOpen={openInfoCard === 'summaryCards'}
              onToggle={() => toggleInfoCard('summaryCards')}
              sections={[
                {
                  heading: 'What These Show',
                  body: 'These cards are your financial dashboard at a glance — the key numbers that summarize your entire retirement plan. Each card answers a different question about where you stand.'
                },
                {
                  heading: 'The Cards',
                  items: [
                    { icon: '💰', label: 'Total Net Worth', desc: 'Everything you own minus everything you owe, right now. This includes retirement accounts, brokerage, HSA, plus non-liquid assets like real estate (net of mortgages). It\'s your complete financial snapshot today.' },
                    { icon: '📊', label: 'Liquid Portfolio', desc: 'Just your investable retirement accounts (401k, IRA, Roth, brokerage, HSA) — money that can be converted to income. This excludes real estate and other illiquid assets since you can\'t easily spend those in retirement.' },
                    { icon: '🎯', label: 'At Retirement', desc: 'Your projected total net worth on the day you retire, based on continued contributions and expected growth rates. The subtitle shows just the liquid portfolio portion. This is the nest egg that needs to fund your retirement.' },
                    { icon: '📥', label: 'Retirement Income', desc: 'Your projected guaranteed annual income at retirement — Social Security, pensions, and any other recurring income streams. This is money that arrives regardless of market performance.' },
                    { icon: '🏦', label: 'Legacy at 95', desc: 'What\'s projected to be left at age 95 if you follow your plan. A positive number means you have money to leave to heirs or as a safety margin. Zero or negative means your plan may not sustain you that long.' },
                    { icon: '💵', label: 'Savings Rate', desc: 'Only shown if you\'re still working. Your annual retirement contributions as a percentage of earned income. Financial planners typically recommend 15–20% minimum. This card shows your personal contributions and total (including employer match).' }
                  ]
                },
                {
                  heading: 'How to Use These',
                  body: 'Think of these as your retirement vital signs. The most important relationship is between your "At Retirement" portfolio and "Retirement Income" — together they determine if your plan is sustainable. The "Legacy at 95" card is your bottom-line indicator: positive means your plan works, near-zero means it\'s tight.',
                  tip: 'All dollar amounts are in future (nominal) dollars, meaning they include inflation. A retirement portfolio of $3M in 20 years has less purchasing power than $3M today. The planner accounts for this in its calculations, but the raw numbers may look larger than expected.'
                }
              ]}
            />
          </div>
          <div className={`grid gap-3 ${isPreRetirement && dashSavingsRate !== null ? 'grid-cols-2 lg:grid-cols-6' : 'grid-cols-2 lg:grid-cols-5'}`}>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-0.5">Total Net Worth</div>
            <div className="text-xl font-bold text-emerald-400">{formatCurrency(current?.totalNetWorth)}</div>
            <div className="text-xs text-slate-500">Portfolio + Assets</div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-0.5">Liquid Portfolio</div>
            <div className="text-xl font-bold text-sky-400">{formatCurrency(current?.totalPortfolio)}</div>
            <div className="text-xs text-slate-500">Retirement funds</div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-0.5">At Retirement (Age {retirementAge})</div>
            <div className="text-xl font-bold text-amber-400">{formatCurrency(retirementProjection?.totalNetWorth)}</div>
            <div className="text-xs text-slate-500">Portfolio: {formatCurrency(retirementProjection?.totalPortfolio)}</div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-0.5">Retirement Income</div>
            <div className="text-xl font-bold text-purple-400">{formatCurrency(retirementProjection?.totalGuaranteedIncome)}</div>
            <div className="text-xs text-slate-500">SS + Pension + Other</div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-0.5">Legacy at {personalInfo.legacyAge || 95}</div>
            <div className="text-xl font-bold text-pink-400">{formatCurrency(projections.find(p => p.myAge === (personalInfo.legacyAge || 95))?.totalNetWorth)}</div>
            <div className="text-xs text-slate-500">Total estate value</div>
          </div>
          {isPreRetirement && dashSavingsRate !== null && (
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
              <div className="text-slate-500 text-xs mb-0.5">Savings Rate</div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold text-amber-400">{dashSavingsRate.toFixed(1)}%</span>
              </div>
              <div className="text-xs text-slate-500">{formatCurrency(dashMyContributions)} mine{dashTotalContributions > dashMyContributions ? ` · ${formatCurrency(dashTotalContributions)} total` : ''}</div>
            </div>
          )}
        </div>
        </div>
        )}
        
        {/* Net Worth Chart with Range Controls */}
        {visibilitySettings.netWorth && (
        <div className={cardStyle}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-100">Net Worth Projection</h3>
              <InfoCard
                title="Net Worth Projection"
                isOpen={openInfoCard === 'netWorth'}
                onToggle={() => toggleInfoCard('netWorth')}
                sections={[
                  {
                    heading: 'What This Shows',
                    body: 'This chart projects your total net worth from today through age 95, broken down by the type of money you hold. The stacked colored areas show how your wealth is distributed, while the cyan line traces your combined total.'
                  },
                  {
                    heading: 'The Colored Layers',
                    items: [
                      { color: '#f59e0b', label: 'Pre-Tax (Gold)', desc: '401(k), Traditional IRA, 403(b), 457(b). Contributions reduced your taxable income, but every dollar withdrawn in retirement will be taxed as ordinary income. This is typically your largest bucket during accumulation.' },
                      { color: '#10b981', label: 'Roth (Green)', desc: 'Roth IRA, Roth 401(k), etc. You paid tax on contributions upfront, so withdrawals in retirement are completely tax-free. This layer growing large is very favorable for retirement flexibility.' },
                      { color: '#6366f1', label: 'Brokerage (Indigo)', desc: 'Taxable investment accounts and HSAs. Withdrawals may generate capital gains taxes, but there are no age restrictions or required minimum distributions (except HSAs are tax-free for medical expenses).' },
                      { color: '#ec4899', label: 'Non-Liquid Assets (Pink)', desc: 'Real estate, vehicles, business equity — things with value but not easily converted to spending cash. Shown net of any remaining mortgages or debt.' }
                    ]
                  },
                  {
                    heading: 'The Lines & Markers',
                    items: [
                      { color: '#22d3ee', label: 'Cyan Line — Total Net Worth', desc: 'The sum of all four layers. This is your complete financial picture at each age.' },
                      { color: '#ef4444', label: 'Red Dashed Line — Retirement Age', desc: 'Marks when you plan to stop working. Expect the curve to shift from growing (contributions + returns) to declining (withdrawals for living expenses).' }
                    ]
                  },
                  {
                    heading: 'How to Read It',
                    body: 'Before retirement the chart should climb as contributions and market returns build wealth. After retirement it typically descends as you draw down savings. A chart that stays above zero through age 95 suggests your plan is sustainable. If the total drops to zero before 95, you may need to save more, delay retirement, or reduce spending.',
                    tip: 'Use the age range buttons above the chart to zoom into specific periods. "To Retire" focuses on the accumulation phase, "Retire-85" focuses on the critical early drawdown years when sequence-of-returns risk is highest.'
                  },
                  {
                    heading: 'What\'s NOT Included',
                    body: 'All values are shown in future (nominal) dollars — they include inflation, so the numbers look larger than today\'s purchasing power. Taxes are accounted for in withdrawals but not shown as a separate deduction on the chart. The projection uses your fixed expected return rates (CAGR) for each account — real markets will be more volatile (see Monte Carlo for stress-testing).'
                  }
                ]}
              />
              <button
                onClick={() => toggleVisibility('netWorth')}
                className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
                title="Hide this section"
              >
                Hide
              </button>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Age:</span>
              <input
                type="number"
                value={netWorthRange.start}
                onChange={e => setNetWorthRange(prev => ({ ...prev, start: Math.max(personalInfo.myAge, Number(e.target.value)) }))}
                className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-center"
              />
              <span className="text-slate-500">to</span>
              <input
                type="number"
                value={netWorthRange.end}
                onChange={e => setNetWorthRange(prev => ({ ...prev, end: Math.min(personalInfo.legacyAge || MAX_AGE, Number(e.target.value)) }))}
                className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-center"
              />
              <div className="flex gap-1 ml-2">
                <button 
                  onClick={() => setNetWorthRange({ start: personalInfo.myAge, end: retirementAge + 5 })}
                  className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                >
                  To Retire
                </button>
                <button 
                  onClick={() => setNetWorthRange({ start: retirementAge, end: 85 })}
                  className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                >
                  Retire-85
                </button>
                <button 
                  onClick={() => setNetWorthRange({ start: personalInfo.myAge, end: personalInfo.legacyAge || MAX_AGE })}
                  className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                >
                  All
                </button>
              </div>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={netWorthData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="myAge" stroke="#94a3b8" tick={{ fill: '#94a3b8' }} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8' }} tickFormatter={v => `$${(v/1e6).toFixed(1)}M`} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }} formatter={v => formatCurrency(v)} labelFormatter={l => `Age ${l}`} />
                <Legend />
                <Area type="monotone" dataKey="preTaxBalance" stackId="1" fill="#f59e0b" stroke="#f59e0b" fillOpacity={0.6} name="Pre-Tax" />
                <Area type="monotone" dataKey="rothBalance" stackId="1" fill="#10b981" stroke="#10b981" fillOpacity={0.6} name="Roth" />
                <Area type="monotone" dataKey="brokerageBalance" stackId="1" fill="#6366f1" stroke="#6366f1" fillOpacity={0.6} name="Brokerage" />
                <Area type="monotone" dataKey="netAssetValue" stackId="1" fill="#ec4899" stroke="#ec4899" fillOpacity={0.4} name="Non-Liquid Assets" />
                <Line type="monotone" dataKey="totalNetWorth" stroke="#22d3ee" strokeWidth={2} dot={false} name="Total Net Worth" />
                <ReferenceLine x={retirementAge} stroke="#ef4444" strokeDasharray="5 5" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        )}
        
        {/* Income vs Spending Chart with Range Controls */}
        {visibilitySettings.retirementIncome && (
        <div className={cardStyle}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-100">Retirement Income vs Spending Needs</h3>
              <InfoCard
                title="Retirement Income vs Spending"
                isOpen={openInfoCard === 'retirementIncome'}
                onToggle={() => toggleInfoCard('retirementIncome')}
                sections={[
                  {
                    heading: 'What This Shows',
                    body: 'This chart answers the fundamental retirement question: will your income cover your spending? The stacked bars represent your total gross income from all sources at each age, while the lines show what you want to spend, what you actually take home after taxes, and how much goes to taxes.'
                  },
                  {
                    heading: 'The Income Bars (Stacked)',
                    body: 'Each colored bar segment is a different source of income. They stack on top of each other so the total bar height equals your total gross income for that year.',
                    items: [
                      { color: '#22c55e', label: 'Earned Income (Green)', desc: 'Salary, wages, or business income while you\'re still working. This typically drops to zero at your retirement age.' },
                      { color: '#3b82f6', label: 'Social Security (Blue)', desc: 'Your monthly Social Security benefit, shown annually. Starts at your claiming age (usually 62–70). Delaying increases the amount.' },
                      { color: '#8b5cf6', label: 'Pension (Purple)', desc: 'Any defined-benefit pension income. Starts at the age you specified in your income streams.' },
                      { color: '#06b6d4', label: 'Other Income (Teal)', desc: 'Rental income, annuities, part-time work, or any other income streams you\'ve entered.' },
                      { color: '#f59e0b', label: 'Portfolio Withdrawal (Gold)', desc: 'Money pulled from your retirement accounts (401k, IRA, Roth, brokerage) to cover the gap between your guaranteed income and your spending needs. This is the piece the planner calculates for you.' }
                    ]
                  },
                  {
                    heading: 'The Lines',
                    items: [
                      { color: '#ef4444', label: 'Red Solid — Desired Spending', desc: 'The annual income you said you need in retirement (from Personal Info), adjusted upward each year for inflation. This is your spending target.' },
                      { color: '#10b981', label: 'Green Dashed — Net Income After Tax', desc: 'What you actually take home after federal and state taxes. This is the number that matters — it needs to meet or exceed the red line for your plan to work.' },
                      { color: '#dc2626', label: 'Dark Red Dotted — Total Tax', desc: 'Your combined federal + state + FICA payroll tax burden. The gap between the top of the bars and the green dashed line.' }
                    ]
                  },
                  {
                    heading: 'How to Read It',
                    body: 'The key relationship is between the green dashed line (net income) and the red solid line (desired spending). When green is above red, you\'re in good shape — you have more income than you need. When they\'re close together, your plan is tight. If the bars shrink below the red line, your portfolio can\'t fully cover your spending.',
                    tip: 'Watch for the "income gap" in early retirement — the years between when earned income stops and when Social Security begins. This is often when portfolio withdrawals are heaviest and sequence-of-returns risk is greatest. Use "First 10yr Ret" to zoom in on this critical period.'
                  },
                  {
                    heading: 'Key Concepts',
                    items: [
                      { icon: '📊', label: 'Gross vs Net', desc: 'The bars show gross (pre-tax) income. You can\'t spend all of it — taxes take a portion. The green dashed line shows what\'s actually available to spend.' },
                      { icon: '📈', label: 'Inflation Effect', desc: 'Notice the red line climbs over time — that\'s inflation increasing your spending needs. Your income sources with COLA adjustments (like Social Security) help keep pace.' },
                      { icon: '💰', label: 'Portfolio Withdrawal', desc: 'The gold bar is calculated to bridge the gap between your other income and your spending target, accounting for taxes on the withdrawal itself. Larger gold bars mean heavier reliance on savings.' },
                      { icon: '🏛️', label: 'QCD Savings', desc: 'If you\'ve set a charitable giving percentage in Personal Info, Qualified Charitable Distributions can reduce your tax burden, which shows up as a higher green line (more net income) for the same gross income.' }
                    ]
                  }
                ]}
              />
              <button
                onClick={() => toggleVisibility('retirementIncome')}
                className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
                title="Hide this section"
              >
                Hide
              </button>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Age:</span>
              <input
                type="number"
                value={incomeRange.start}
                onChange={e => setIncomeRange(prev => ({ ...prev, start: Math.max(personalInfo.myAge, Number(e.target.value)) }))}
                className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-center"
              />
              <span className="text-slate-500">to</span>
              <input
                type="number"
                value={incomeRange.end}
                onChange={e => setIncomeRange(prev => ({ ...prev, end: Math.min(personalInfo.legacyAge || 95, Number(e.target.value)) }))}
                className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-center"
              />
              <div className="flex gap-1 ml-2">
                <button 
                  onClick={() => setIncomeRange({ start: personalInfo.myAge, end: retirementAge + 5 })}
                  className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                >
                  To Retire
                </button>
                <button 
                  onClick={() => setIncomeRange({ start: retirementAge, end: retirementAge + 10 })}
                  className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                >
                  First 10yr Ret
                </button>
                <button 
                  onClick={() => setIncomeRange({ start: personalInfo.myAge, end: personalInfo.legacyAge || 95 })}
                  className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                >
                  All
                </button>
              </div>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={incomeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="myAge" stroke="#94a3b8" tick={{ fill: '#94a3b8' }} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8' }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }} formatter={v => formatCurrency(v)} labelFormatter={l => `Age ${l}`} />
                <Legend />
                <Bar dataKey="earnedIncome" stackId="income" fill="#22c55e" name="Earned Income" />
                <Bar dataKey="socialSecurity" stackId="income" fill="#3b82f6" name="Social Security" />
                <Bar dataKey="pension" stackId="income" fill="#8b5cf6" name="Pension" />
                <Bar dataKey="otherIncome" stackId="income" fill="#06b6d4" name="Other Income" />
                <Bar dataKey="portfolioWithdrawal" stackId="income" fill="#f59e0b" name="Portfolio Withdrawal" />
                <Line type="monotone" dataKey="desiredIncome" stroke="#ef4444" strokeWidth={3} dot={false} name="Desired Spending" />
                <Line type="monotone" dataKey="netIncome" stroke="#10b981" strokeWidth={2} dot={false} name="Net Income (after tax)" strokeDasharray="5 5" />
                <Line type="monotone" dataKey="totalTax" stroke="#dc2626" strokeWidth={1} dot={false} name="Total Tax" strokeDasharray="3 3" />
                <ReferenceLine x={retirementAge} stroke="#ef4444" strokeDasharray="5 5" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Bars show gross income sources. <span className="text-red-400">Red solid line</span> = desired spending. 
            <span className="text-emerald-400 ml-1">Green dashed line</span> = net income after taxes (affected by QCD savings). 
            <span className="text-red-600 ml-1">Dark red dotted line</span> = total tax burden.
          </p>
        </div>
        )}
        
        {/* Cash Flow Sankey Diagram */}
        {visibilitySettings.cashFlow && (() => {
          const sankeyData = projections.find(p => p.myAge === sankeyAge) || current;
          
          // Prepare Sankey data
          const income = [
            { label: 'Earned Income', value: sankeyData.earnedIncome || 0, color: '#22c55e' },
            { label: 'Social Security', value: sankeyData.socialSecurity || 0, color: '#3b82f6' },
            { label: 'Pension', value: sankeyData.pension || 0, color: '#8b5cf6' },
            { label: 'Other Income', value: sankeyData.otherIncome || 0, color: '#06b6d4' },
            { label: 'Portfolio Withdrawal', value: sankeyData.portfolioWithdrawal || 0, color: '#f59e0b' }
          ].filter(item => item.value > 0);
          
          const totalIncome = income.reduce((sum, item) => sum + item.value, 0);
          const totalTaxes = sankeyData.totalTax || 0;
          const netIncome = sankeyData.netIncome || 0;
          const baseSpending = sankeyData.desiredIncome || 0;
          const healthcareSpending = sankeyData.healthcareExpense || 0;
          const recurringSpending = sankeyData.recurringExpenses || 0;
          const coreSpending = baseSpending; // Base desired retirement income
          const savings = Math.max(0, netIncome - baseSpending - healthcareSpending - recurringSpending);
          
          const expenses = [
            { label: 'Federal Tax', value: sankeyData.federalTax || 0, color: '#ef4444' },
            { label: 'State Tax', value: sankeyData.stateTax || 0, color: '#dc2626' },
            { label: 'FICA', value: sankeyData.ficaTax || 0, color: '#b91c1c' },
            { label: 'IRMAA', value: sankeyData.irmaaSurcharge || 0, color: '#be185d' },
            { label: 'Spending', value: coreSpending, color: '#10b981' },
            { label: 'Healthcare', value: healthcareSpending, color: '#ec4899' },
            { label: 'Recurring Exp.', value: recurringSpending, color: '#06b6d4' },
            { label: 'Savings', value: savings, color: '#6366f1' }
          ].filter(item => item.value > 0);
          
          const sankeyChartData = {
            income,
            expenses,
            title: `Cash Flow Analysis - Age ${sankeyAge}`
          };
          
          return (
            <div className={cardStyle}>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-slate-100">Annual Cash Flow</h3>
                  <InfoCard
                    title="Annual Cash Flow"
                    isOpen={openInfoCard === 'cashFlow'}
                    onToggle={() => toggleInfoCard('cashFlow')}
                    sections={[
                      {
                        heading: 'What This Shows',
                        body: 'This Sankey (flow) diagram shows where your money comes from and where it goes in a single year. The colored streams on the left are income sources flowing into your total, and the streams on the right show how that money gets divided between taxes, spending, and savings.'
                      },
                      {
                        heading: 'Left Side — Income Sources',
                        items: [
                          { color: '#22c55e', label: 'Earned Income', desc: 'Salary and wages from employment.' },
                          { color: '#3b82f6', label: 'Social Security', desc: 'Your Social Security benefits for this year.' },
                          { color: '#8b5cf6', label: 'Pension', desc: 'Defined-benefit pension payments.' },
                          { color: '#06b6d4', label: 'Other Income', desc: 'Rental income, annuities, side income.' },
                          { color: '#f59e0b', label: 'Portfolio Withdrawal', desc: 'Money drawn from retirement accounts to cover spending gaps.' }
                        ]
                      },
                      {
                        heading: 'Right Side — Where It Goes',
                        items: [
                          { color: '#ef4444', label: 'Federal Tax', desc: 'Federal income tax on your combined income.' },
                          { color: '#dc2626', label: 'State Tax', desc: 'State income tax based on your selected state.' },
                          { color: '#10b981', label: 'Spending', desc: 'Your desired retirement spending (the money you actually live on).' },
                          { color: '#6366f1', label: 'Savings', desc: 'Any excess income beyond taxes and spending — this gets reinvested.' }
                        ]
                      },
                      {
                        heading: 'The Summary Cards Below',
                        items: [
                          { icon: '💰', label: 'Total Income', desc: 'Sum of all income sources (gross, before tax).' },
                          { icon: '🏛️', label: 'Total Taxes', desc: 'Combined federal and state taxes, shown as a percentage of gross income.' },
                          { icon: '📥', label: 'Net Income', desc: 'What\'s left after taxes — the actual money available to you.' },
                          { icon: '📊', label: 'Savings Rate', desc: 'Percentage of net income that exceeds your spending needs. During retirement this may be zero or come from excess RMDs.' }
                        ],
                        tip: 'Change the age to see how your cash flow evolves over time. Try comparing "Now" (working years) vs "Retirement" vs "Age 75" (when RMDs start) to see how the income mix shifts dramatically.'
                      }
                    ]}
                  />
                  <button
                    onClick={() => toggleVisibility('cashFlow')}
                    className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
                    title="Hide this section"
                  >
                    Hide
                  </button>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400">View Age:</span>
                  <input
                    type="number"
                    value={sankeyAge}
                    onChange={e => setSankeyAge(Math.max(personalInfo.myAge, Math.min(personalInfo.legacyAge || 95, Number(e.target.value))))}
                    className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-center"
                    min={personalInfo.myAge}
                    max={personalInfo.legacyAge || 95}
                  />
                  <div className="flex gap-1 ml-2">
                    <button 
                      onClick={() => setSankeyAge(personalInfo.myAge)}
                      className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                    >
                      Now
                    </button>
                    <button 
                      onClick={() => setSankeyAge(retirementAge)}
                      className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                    >
                      Retirement
                    </button>
                    <button 
                      onClick={() => setSankeyAge(75)}
                      className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                    >
                      Age 75
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="flex justify-center bg-slate-900/30 rounded-lg p-4">
                <SankeyDiagram data={sankeyChartData} width={900} height={400} />
              </div>
              
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/30">
                  <div className="text-slate-500 text-xs mb-1">Total Income</div>
                  <div className="text-lg font-semibold text-emerald-400">{formatCurrency(totalIncome)}</div>
                </div>
                <div className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/30">
                  <div className="text-slate-500 text-xs mb-1">Total Taxes</div>
                  <div className="text-lg font-semibold text-red-400">{formatCurrency(totalTaxes)}</div>
                  <div className="text-xs text-slate-500">{totalIncome > 0 ? ((totalTaxes/totalIncome)*100).toFixed(1) : 0}% of income</div>
                </div>
                <div className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/30">
                  <div className="text-slate-500 text-xs mb-1">Net Income</div>
                  <div className="text-lg font-semibold text-sky-400">{formatCurrency(netIncome)}</div>
                </div>
                <div className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/30">
                  <div className="text-slate-500 text-xs mb-1">Savings Rate</div>
                  <div className="text-lg font-semibold text-purple-400">
                    {netIncome > 0 ? ((savings/netIncome)*100).toFixed(1) : 0}%
                  </div>
                  <div className="text-xs text-slate-500">{formatCurrency(savings)}</div>
                </div>
              </div>
            </div>
          );
        })()}
        
        {/* Portfolio Stress / Withdrawal Rate Section */}
        {visibilitySettings.withdrawalRate && (() => {
          // Calculate withdrawal rates for retirement years only
          const retirementData = projections.filter(p => p.myAge >= personalInfo.myRetirementAge && p.totalPortfolio > 0);
          const withdrawalRateData = retirementData.map(p => {
            const totalWithdrawalRate = p.totalPortfolio > 0 ? (p.portfolioWithdrawal / p.totalPortfolio) * 100 : 0;
            const rmdRate = p.totalPortfolio > 0 ? (p.rmd / p.totalPortfolio) * 100 : 0;
            const neededRate = p.totalPortfolio > 0 ? ((p.portfolioWithdrawal - (p.excessRMD || 0)) / p.totalPortfolio) * 100 : 0;
            const excessRate = p.totalPortfolio > 0 ? ((p.excessRMD || 0) / p.totalPortfolio) * 100 : 0;
            return {
              ...p,
              withdrawalRate: totalWithdrawalRate,
              rmdRate,
              neededRate: Math.max(0, neededRate),
              excessRate
            };
          });
          
          // Find peak and average withdrawal rates
          const peakData = withdrawalRateData.reduce((max, p) => p.withdrawalRate > (max?.withdrawalRate || 0) ? p : max, null);
          const avgWithdrawalRate = withdrawalRateData.length > 0 
            ? withdrawalRateData.reduce((sum, p) => sum + p.withdrawalRate, 0) / withdrawalRateData.length 
            : 0;
          
          // RMD-specific metrics
          const rmdYears = withdrawalRateData.filter(p => p.rmd > 0);
          const peakRmdRate = rmdYears.reduce((max, p) => p.rmdRate > (max?.rmdRate || 0) ? p : max, null);
          const peakExcessRate = rmdYears.reduce((max, p) => p.excessRate > (max?.excessRate || 0) ? p : max, null);
          const avgExcessRate = rmdYears.length > 0
            ? rmdYears.reduce((sum, p) => sum + p.excessRate, 0) / rmdYears.length
            : 0;
          
          // Count years above thresholds
          const yearsAbove4 = withdrawalRateData.filter(p => p.withdrawalRate > 4).length;
          const yearsAbove6 = withdrawalRateData.filter(p => p.withdrawalRate > 6).length;
          
          // Color coding helper
          const getRateColor = (rate) => {
            if (rate <= 4) return 'text-emerald-400';
            if (rate <= 6) return 'text-amber-400';
            return 'text-red-400';
          };
          
          const getRateBgColor = (rate) => {
            if (rate <= 4) return 'bg-emerald-500/20 border-emerald-500/50';
            if (rate <= 6) return 'bg-amber-500/20 border-amber-500/50';
            return 'bg-red-500/20 border-red-500/50';
          };
          
          return (
            <>
              {/* Portfolio Stress Summary Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className={`border rounded-lg px-4 py-3 ${getRateBgColor(peakData?.withdrawalRate || 0)}`}>
                  <div className="text-slate-400 text-xs mb-0.5">Peak Withdrawal Rate</div>
                  <div className={`text-xl font-bold ${getRateColor(peakData?.withdrawalRate || 0)}`}>
                    {(peakData?.withdrawalRate || 0).toFixed(1)}%
                  </div>
                  <div className="text-xs text-slate-500">Age {peakData?.myAge || '—'} ({peakData?.year || '—'})</div>
                </div>
                <div className={`border rounded-lg px-4 py-3 ${getRateBgColor(avgWithdrawalRate)}`}>
                  <div className="text-slate-400 text-xs mb-0.5">Avg Withdrawal Rate</div>
                  <div className={`text-xl font-bold ${getRateColor(avgWithdrawalRate)}`}>
                    {avgWithdrawalRate.toFixed(1)}%
                  </div>
                  <div className="text-xs text-slate-500">During retirement</div>
                </div>
                <div className={`border rounded-lg px-4 py-3 ${yearsAbove4 > 5 ? 'bg-amber-500/20 border-amber-500/50' : 'bg-slate-800/60 border-slate-700/50'}`}>
                  <div className="text-slate-400 text-xs mb-0.5">Years Above 4%</div>
                  <div className={`text-xl font-bold ${yearsAbove4 > 5 ? 'text-amber-400' : 'text-slate-300'}`}>
                    {yearsAbove4} years
                  </div>
                  <div className="text-xs text-slate-500">Traditional "safe" threshold</div>
                </div>
                <div className={`border rounded-lg px-4 py-3 ${yearsAbove6 > 0 ? 'bg-red-500/20 border-red-500/50' : 'bg-slate-800/60 border-slate-700/50'}`}>
                  <div className="text-slate-400 text-xs mb-0.5">Years Above 6%</div>
                  <div className={`text-xl font-bold ${yearsAbove6 > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {yearsAbove6} years
                  </div>
                  <div className="text-xs text-slate-500">High stress zone</div>
                </div>
              </div>
              
              {/* RMD Excess Cards - only show if there are RMD years */}
              {rmdYears.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="border rounded-lg px-4 py-3 bg-orange-500/20 border-orange-500/50">
                    <div className="text-slate-400 text-xs mb-0.5">Peak RMD Rate</div>
                    <div className="text-xl font-bold text-orange-400">
                      {(peakRmdRate?.rmdRate || 0).toFixed(1)}%
                    </div>
                    <div className="text-xs text-slate-500">Age {peakRmdRate?.myAge || '—'}</div>
                  </div>
                  <div className="border rounded-lg px-4 py-3 bg-cyan-500/20 border-cyan-500/50">
                    <div className="text-slate-400 text-xs mb-0.5">Peak Excess RMD Rate</div>
                    <div className="text-xl font-bold text-cyan-400">
                      {(peakExcessRate?.excessRate || 0).toFixed(1)}%
                    </div>
                    <div className="text-xs text-slate-500">Age {peakExcessRate?.myAge || '—'} (forced withdrawal)</div>
                  </div>
                  <div className="border rounded-lg px-4 py-3 bg-cyan-500/10 border-cyan-500/30">
                    <div className="text-slate-400 text-xs mb-0.5">Avg Excess RMD Rate</div>
                    <div className="text-xl font-bold text-cyan-300">
                      {avgExcessRate.toFixed(1)}%
                    </div>
                    <div className="text-xs text-slate-500">During RMD years</div>
                  </div>
                  <div className="border rounded-lg px-4 py-3 bg-slate-800/60 border-slate-700/50">
                    <div className="text-slate-400 text-xs mb-0.5">RMD Years</div>
                    <div className="text-xl font-bold text-slate-300">
                      {rmdYears.length} years
                    </div>
                    <div className="text-xs text-slate-500">Age 75+</div>
                  </div>
                </div>
              )}
              
              {/* Withdrawal Rate Over Time Chart */}
              <div className={cardStyle}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-slate-100">Portfolio Withdrawal Rate Over Time</h3>
                    <InfoCard
                      title="Portfolio Withdrawal Rate"
                      isOpen={openInfoCard === 'withdrawalRate'}
                      onToggle={() => toggleInfoCard('withdrawalRate')}
                      sections={[
                        {
                          heading: 'What This Shows',
                          body: 'This section monitors how hard you\'re drawing down your portfolio each year of retirement. The withdrawal rate — how much you take out as a percentage of your remaining portfolio — is one of the most important indicators of plan sustainability.'
                        },
                        {
                          heading: 'The Summary Cards',
                          items: [
                            { icon: '📈', label: 'Peak Withdrawal Rate', desc: 'The highest single-year withdrawal rate during retirement. This is your most stressed year. Color-coded: green (≤4%), amber (4–6%), red (>6%).' },
                            { icon: '📊', label: 'Avg Withdrawal Rate', desc: 'The average rate across all retirement years. A healthy average is 3–4%.' },
                            { icon: '⚠️', label: 'Years Above 4%', desc: 'How many years you exceed the traditional "safe" withdrawal rate. A few years is normal (especially early on), but many consecutive years increases the risk of running out.' },
                            { icon: '🔴', label: 'Years Above 6%', desc: 'Years in the danger zone. At 6%+ withdrawal rates, your portfolio is under severe stress and depletion risk rises sharply.' }
                          ]
                        },
                        {
                          heading: 'RMD Cards (When Applicable)',
                          body: 'Once you reach RMD age (72–75 depending on birth year), the IRS requires minimum withdrawals from pre-tax accounts. These cards appear when RMDs are projected:',
                          items: [
                            { icon: '🏛️', label: 'Peak RMD Rate', desc: 'The highest year\'s RMD as a percentage of your total portfolio.' },
                            { icon: '💸', label: 'Peak Excess RMD Rate', desc: 'When RMDs force you to withdraw MORE than you need for spending. This excess gets reinvested in brokerage (after paying taxes on it).' },
                            { icon: '📉', label: 'Avg Excess RMD Rate', desc: 'Average forced over-withdrawal during RMD years.' }
                          ]
                        },
                        {
                          heading: 'The Chart',
                          items: [
                            { color: '#f59e0b', label: 'Gold Area — Needed for Spending', desc: 'The withdrawal rate driven by your actual spending needs. This is the portion you\'re choosing to take out.' },
                            { color: '#06b6d4', label: 'Cyan Area — Excess from RMD', desc: 'Additional withdrawals forced by RMD rules beyond what you need. You pay tax on these but reinvest the after-tax amount.' },
                            { color: '#ffffff', label: 'White Line — Total Rate', desc: 'Your combined withdrawal rate (needed + excess). This is what matters for portfolio sustainability.' },
                            { color: '#22c55e', label: 'Green Dashed — 4% Safe Line', desc: 'The traditional safe withdrawal rate from the Trinity Study. Staying below this line means historically your portfolio would last 30+ years.' },
                            { color: '#ef4444', label: 'Red Dashed — 6% Risk Line', desc: 'Above this level, portfolio failure risk increases significantly.' }
                          ],
                          tip: 'A rising withdrawal rate over time is a warning sign — it means your portfolio is shrinking faster than your spending is. Ideally, the rate stays flat or decreases. If you see it climbing toward 6%, consider whether reducing spending or delaying retirement would help.'
                        }
                      ]}
                    />
                    <button
                      onClick={() => toggleVisibility('withdrawalRate')}
                      className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
                      title="Hide this section"
                    >
                      Hide
                    </button>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 rounded bg-amber-500"></div>
                      <span className="text-slate-400">Needed for Spending</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 rounded bg-cyan-500"></div>
                      <span className="text-slate-400">Excess from RMD</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-8 h-0.5 bg-emerald-500"></div>
                      <span className="text-slate-400">4% Safe</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-8 h-0.5 bg-red-500"></div>
                      <span className="text-slate-400">6% Risk</span>
                    </div>
                  </div>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={withdrawalRateData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="myAge" stroke="#94a3b8" tick={{ fill: '#94a3b8' }} />
                      <YAxis 
                        stroke="#94a3b8" 
                        tick={{ fill: '#94a3b8' }} 
                        tickFormatter={v => `${v.toFixed(0)}%`}
                        domain={[0, Math.max(8, Math.ceil((peakData?.withdrawalRate || 4) + 1))]}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }} 
                        formatter={(v, name) => {
                          const labels = {
                            neededRate: 'Needed for Spending',
                            excessRate: 'Excess from RMD',
                            withdrawalRate: 'Total Withdrawal Rate',
                            rmdRate: 'RMD Rate'
                          };
                          return [`${v.toFixed(2)}%`, labels[name] || name];
                        }}
                        labelFormatter={l => `Age ${l}`} 
                      />
                      <ReferenceLine y={4} stroke="#22c55e" strokeDasharray="5 5" />
                      <ReferenceLine y={6} stroke="#ef4444" strokeDasharray="5 5" />
                      <Area 
                        type="monotone" 
                        dataKey="neededRate" 
                        stackId="1"
                        stroke="#f59e0b" 
                        fill="#f59e0b"
                        fillOpacity={0.6}
                        name="neededRate"
                      />
                      <Area 
                        type="monotone" 
                        dataKey="excessRate" 
                        stackId="1"
                        stroke="#06b6d4" 
                        fill="#06b6d4"
                        fillOpacity={0.6}
                        name="excessRate"
                      />
                      <Line 
                        type="monotone" 
                        dataKey="withdrawalRate" 
                        stroke="#ffffff" 
                        strokeWidth={2}
                        dot={false}
                        name="withdrawalRate"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-slate-500 mt-3">
                  <strong className="text-amber-400">Needed for Spending</strong> is what you actually need from your portfolio to meet your desired income. 
                  <strong className="text-cyan-400 ml-2">Excess from RMD</strong> is the additional amount RMDs force you to withdraw beyond your spending needs (this gets reinvested in brokerage after taxes).
                  The white line shows your total withdrawal rate.
                </p>
              </div>
            </>
          );
        })()}
        
        {/* Tax & QCD Summary Section */}
        {visibilitySettings.taxSummary && (() => {
          const retirementYears = projections.filter(p => p.myAge >= retirementAge);
          const lifetimeFederalTax = retirementYears.reduce((sum, p) => sum + p.federalTax, 0);
          const lifetimeStateTax = retirementYears.reduce((sum, p) => sum + p.stateTax, 0);
          const lifetimeFICA = retirementYears.reduce((sum, p) => sum + (p.ficaTax || 0), 0);
          const lifetimeTotalTax = lifetimeFederalTax + lifetimeStateTax + lifetimeFICA;
          const lifetimeQCD = retirementYears.reduce((sum, p) => sum + (p.qcd || 0), 0);
          const charitablePercent = personalInfo.charitableGivingPercent || 0;
          
          // Estimate tax savings from QCD (QCD amount * marginal rate)
          // Use a rough estimate of 22% marginal rate for the savings calculation
          const estimatedQCDTaxSavings = lifetimeQCD * 0.22;
          
          return (
            <div className={cardStyle}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-slate-100">Lifetime Tax Summary (Retirement Years)</h3>
                  <InfoCard
                    title="Lifetime Tax Summary"
                    isOpen={openInfoCard === 'taxSummary'}
                    onToggle={() => toggleInfoCard('taxSummary')}
                    sections={[
                      {
                        heading: 'What This Shows',
                        body: 'This section totals up all the taxes you\'re projected to pay throughout retirement — from your retirement age through age 95. These are cumulative lifetime totals, not annual amounts.'
                      },
                      {
                        heading: 'The Cards',
                        items: [
                          { icon: '🏛️', label: 'Federal Taxes', desc: 'Total federal income tax paid during retirement. This comes from pre-tax account withdrawals (401k, traditional IRA), taxable Social Security benefits, pension income, and capital gains from brokerage sales.' },
                          { icon: '🏠', label: 'State Taxes', desc: 'Total state income tax based on your selected state. Some states have no income tax (FL, TX, NV, etc.), dramatically reducing this number.' },
                          { icon: '📊', label: 'Total Lifetime Tax', desc: 'Combined federal + state taxes over all retirement years. This number can be surprisingly large — it\'s common to pay $200K–$500K+ in retirement taxes, especially with large pre-tax accounts.' },
                          { icon: '💚', label: 'QCD Tax Savings', desc: 'If you\'ve set a charitable giving percentage, this estimates tax savings from Qualified Charitable Distributions — direct IRA-to-charity transfers that satisfy RMDs without counting as taxable income. Estimated at a 22% marginal rate.' }
                        ]
                      },
                      {
                        heading: 'Key Concepts',
                        items: [
                          { icon: '📋', label: 'Why Retirement Taxes Matter', desc: 'Many people assume they\'ll pay little tax in retirement. But RMDs from large pre-tax accounts, Social Security taxation, and capital gains can push retirees into higher brackets than expected.' },
                          { icon: '🔄', label: 'QCD Strategy', desc: 'Qualified Charitable Distributions let you donate directly from your IRA to charity (up to $105K/year per person, age 70½+). The donation satisfies your RMD but isn\'t taxable income — a powerful strategy if you\'re already charitably inclined.' },
                          { icon: '💡', label: 'Roth Advantage', desc: 'Roth withdrawals don\'t show up in these tax numbers at all — they\'re completely tax-free. A higher Roth balance relative to pre-tax can significantly reduce lifetime taxes.' }
                        ],
                        tip: 'To reduce lifetime taxes, consider Roth conversions before retirement (paying tax now at potentially lower rates), maximizing QCDs if you give to charity, and choosing a tax-friendly state for retirement.'
                      }
                    ]}
                  />
                </div>
                <button
                  onClick={() => toggleVisibility('taxSummary')}
                  className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
                  title="Hide this section"
                >
                  Hide
                </button>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                <div className="border rounded-lg px-4 py-3 bg-red-500/10 border-red-500/30">
                  <div className="text-slate-400 text-xs mb-0.5">Federal Taxes</div>
                  <div className="text-xl font-bold text-red-400">{formatCurrency(lifetimeFederalTax)}</div>
                  <div className="text-xs text-slate-500">Ages {retirementAge}-{personalInfo.legacyAge || 95}</div>
                </div>
                <div className="border rounded-lg px-4 py-3 bg-orange-500/10 border-orange-500/30">
                  <div className="text-slate-400 text-xs mb-0.5">State Taxes</div>
                  <div className="text-xl font-bold text-orange-400">{formatCurrency(lifetimeStateTax)}</div>
                  <div className="text-xs text-slate-500">{personalInfo.state}</div>
                </div>
                <div className="border rounded-lg px-4 py-3 bg-slate-500/10 border-slate-500/30">
                  <div className="text-slate-400 text-xs mb-0.5">Total Lifetime Tax</div>
                  <div className="text-xl font-bold text-slate-300">{formatCurrency(lifetimeTotalTax)}</div>
                  <div className="text-xs text-slate-500">Combined fed + state{lifetimeFICA > 0 ? ' + FICA' : ''}</div>
                </div>
                {charitablePercent > 0 ? (
                  <div className="border rounded-lg px-4 py-3 bg-emerald-500/10 border-emerald-500/30">
                    <div className="text-slate-400 text-xs mb-0.5">QCD Tax Savings</div>
                    <div className="text-xl font-bold text-emerald-400">~{formatCurrency(estimatedQCDTaxSavings)}</div>
                    <div className="text-xs text-slate-500">{formatCurrency(lifetimeQCD)} in QCDs</div>
                  </div>
                ) : (
                  <div className="border rounded-lg px-4 py-3 bg-slate-700/30 border-slate-600/30">
                    <div className="text-slate-400 text-xs mb-0.5">QCD Strategy</div>
                    <div className="text-lg font-bold text-slate-500">Not Active</div>
                    <div className="text-xs text-slate-500">Set charitable % in Personal Info</div>
                  </div>
                )}
              </div>
              {charitablePercent > 0 && lifetimeQCD > 0 && (
                <p className="text-xs text-emerald-400/80">
                  💡 Your {charitablePercent}% charitable giving generates {formatCurrency(lifetimeQCD)} in QCDs, 
                  saving approximately {formatCurrency(estimatedQCDTaxSavings)} in taxes while still taking the standard deduction.
                </p>
              )}
            </div>
          );
        })()}
        
        {/* Marginal Tax Impact Dashboard Card */}
        {visibilitySettings.taxSummary && (() => {
          // Compute marginal rates for current year and a few key ages
          const computeMarginalForAge = (targetAge) => {
            const p = projections.find(pr => pr.myAge === targetAge);
            if (!p) return null;
            const yearsFromNow = targetAge - personalInfo.myAge;
            const inflationFactor = Math.pow(1 + personalInfo.inflationRate, yearsFromNow);
            const extra = 1000;
            const rothConv = p.rothConversion || 0;
            const currentNonSS = p.earnedIncome + p.pension + p.otherIncome + p.portfolioWithdrawal + rothConv - (p.qcd || 0);
            const currentTaxableSS = calculateSocialSecurityTaxableAmount(p.socialSecurity, currentNonSS, personalInfo.filingStatus);
            const newTaxableSS = calculateSocialSecurityTaxableAmount(p.socialSecurity, currentNonSS + extra, personalInfo.filingStatus);
            const currentGross = currentNonSS + currentTaxableSS;
            const newGross = currentNonSS + extra + newTaxableSS;
            
            // Total tax deltas (include torpedo effect)
            const retIncome = p.pension; // Only pension is exempt from state tax (not 401k/IRA withdrawals)
            const currentFed = calculateFederalTax(currentGross, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate);
            const currentSt = calculateStateTax(currentGross, personalInfo.state, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate, currentTaxableSS, retIncome);
            const newFed = calculateFederalTax(newGross, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate);
            const newSt = calculateStateTax(newGross, personalInfo.state, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate, newTaxableSS, retIncome);
            const fedDelta = newFed - currentFed;
            const stDelta = newSt - currentSt;
            
            // Direct deltas (without torpedo - keep SS taxable unchanged)
            const directGross = currentGross + extra;
            const directFed = calculateFederalTax(directGross, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate);
            const directSt = calculateStateTax(directGross, personalInfo.state, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate, currentTaxableSS, retIncome);
            const directFedDelta = directFed - currentFed;
            const directStDelta = directSt - currentSt;
            
            // Torpedo = total delta minus direct delta (the tax COST of SS becoming more taxable)
            const torpedoCost = (fedDelta - directFedDelta) + (stDelta - directStDelta);
            
            const currentMAGI = p.earnedIncome + p.socialSecurity + p.pension + p.otherIncome + p.portfolioWithdrawal + rothConv;
            const irm1 = targetAge >= 65 ? calculateIRMAA(currentMAGI, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate) : { totalAnnual: 0, tier: 0 };
            const irm2 = targetAge >= 65 ? calculateIRMAA(currentMAGI + extra, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate) : { totalAnnual: 0, tier: 0 };
            const irmDelta = irm2.totalAnnual - irm1.totalAnnual;
            const totalCost = fedDelta + stDelta + irmDelta;
            return {
              age: targetAge, rate: Math.round(totalCost / extra * 1000) / 10,
              fed: Math.round(directFedDelta / extra * 1000) / 10, 
              state: Math.round(directStDelta / extra * 1000) / 10,
              ssTorpedo: Math.round(torpedoCost / extra * 1000) / 10,
              irmaa: Math.round(irmDelta / extra * 1000) / 10,
              irmaaAnnual: irm1.totalAnnual, irmaaTier: irm1.tier,
            };
          };
          
          const currentMarg = computeMarginalForAge(personalInfo.myAge);
          const ages = [personalInfo.myAge, 70, 75, 80, 85, 90].filter((a, i, arr) => a >= personalInfo.myAge && arr.indexOf(a) === i);
          const marginals = ages.map(computeMarginalForAge).filter(Boolean);
          
          return (
            <div className={cardStyle}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-slate-100">Marginal Tax Impact & IRMAA</h3>
                <span className="text-xs text-slate-500">Cost per extra $1,000 withdrawn</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
                <div className="border rounded-lg px-4 py-3 bg-amber-500/10 border-amber-500/30">
                  <div className="text-slate-400 text-xs mb-0.5">True Marginal Rate (Now)</div>
                  <div className={`text-2xl font-bold ${(currentMarg?.rate || 0) > 35 ? 'text-red-400' : (currentMarg?.rate || 0) > 25 ? 'text-amber-400' : 'text-emerald-400'}`}>{currentMarg?.rate || 0}%</div>
                  <div className="text-xs text-slate-500">Age {personalInfo.myAge} — each extra $1K costs ${Math.round((currentMarg?.rate || 0) * 10)}</div>
                </div>
                <div className="border rounded-lg px-4 py-3 bg-purple-500/10 border-purple-500/30">
                  <div className="text-slate-400 text-xs mb-0.5">SS Tax Torpedo</div>
                  <div className="text-2xl font-bold text-purple-400">{currentMarg?.ssTorpedo || 0}%</div>
                  <div className="text-xs text-slate-500">{(currentMarg?.ssTorpedo || 0) > 0 ? 'Extra withdrawals make SS taxable' : 'SS not yet in taxable range'}</div>
                </div>
                <div className="border rounded-lg px-4 py-3 bg-pink-500/10 border-pink-500/30">
                  <div className="text-slate-400 text-xs mb-0.5">IRMAA Surcharge</div>
                  <div className="text-2xl font-bold text-pink-400">{currentMarg?.irmaaAnnual > 0 ? formatCurrency(currentMarg.irmaaAnnual) : '$0'}<span className="text-sm text-slate-400">/yr</span></div>
                  <div className="text-xs text-slate-500">Tier {currentMarg?.irmaaTier || 0}{currentMarg?.irmaa > 0 ? ' — near next cliff!' : ''}</div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-1 px-2 text-slate-400">Age</th>
                      <th className="text-right py-1 px-2 text-red-400">Federal</th>
                      <th className="text-right py-1 px-2 text-orange-400">State</th>
                      <th className="text-right py-1 px-2 text-purple-400">SS Torpedo</th>
                      <th className="text-right py-1 px-2 text-pink-400">IRMAA</th>
                      <th className="text-right py-1 px-2 text-amber-400 font-bold">True Rate</th>
                      <th className="text-right py-1 px-2 text-slate-400">$/yr IRMAA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marginals.map((m, i) => (
                      <tr key={i} className={`border-b border-slate-700/50 ${i === 0 ? 'bg-amber-900/10' : ''}`}>
                        <td className="py-1 px-2 text-slate-100 font-medium">{m.age}</td>
                        <td className="py-1 px-2 text-right text-red-400">{m.fed}%</td>
                        <td className="py-1 px-2 text-right text-orange-400">{m.state}%</td>
                        <td className="py-1 px-2 text-right text-purple-400">{m.ssTorpedo > 0 ? `${m.ssTorpedo}%` : '—'}</td>
                        <td className="py-1 px-2 text-right text-pink-400">{m.irmaa > 0 ? `${m.irmaa}%` : '—'}</td>
                        <td className={`py-1 px-2 text-right font-bold ${m.rate > 35 ? 'text-red-400' : m.rate > 25 ? 'text-amber-400' : 'text-emerald-400'}`}>{m.rate}%</td>
                        <td className="py-1 px-2 text-right text-slate-400">{m.irmaaAnnual > 0 ? formatCurrency(m.irmaaAnnual) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                True Rate = combined impact of federal tax, state tax, SS becoming taxable, and IRMAA surcharges on each extra $1,000 of pre-tax withdrawal. See Tax Planning tab for full year-by-year detail.
              </p>
            </div>
          );
        })()}
        
        {/* Healthcare Cost Projection Card */}
        {personalInfo.healthcareModel !== 'none' && (() => {
          const retirementYears = projections.filter(p => p.myAge >= personalInfo.myRetirementAge);
          const lifetimeHealthcare = retirementYears.reduce((sum, p) => sum + (p.healthcareExpense || 0), 0);
          const lifetimePre65 = retirementYears.reduce((sum, p) => sum + (p.healthcarePre65 || 0), 0);
          const lifetimeMedicare = retirementYears.reduce((sum, p) => sum + (p.healthcareMedicare || 0), 0);
          const lifetimeLTC = retirementYears.reduce((sum, p) => sum + (p.healthcareLTC || 0), 0);
          const lifetimeIRMAA = retirementYears.reduce((sum, p) => sum + (p.irmaaSurcharge || 0), 0);
          const peakYear = retirementYears.reduce((max, p) => (p.healthcareExpense || 0) > (max.healthcareExpense || 0) ? p : max, retirementYears[0] || {});
          
          return (
            <div className={cardStyle}>
              <h3 className="text-lg font-semibold text-slate-100 mb-3">Healthcare Cost Projection</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-xs text-slate-400 mb-1">Lifetime Healthcare</div>
                  <div className="text-xl font-bold text-pink-400">{formatCurrency(lifetimeHealthcare)}</div>
                  <div className="text-xs text-slate-500">Retirement years only</div>
                </div>
                {lifetimePre65 > 0 && (
                  <div className="bg-slate-800/50 rounded-lg p-3">
                    <div className="text-xs text-slate-400 mb-1">Pre-Medicare (before 65)</div>
                    <div className="text-lg font-bold text-orange-400">{formatCurrency(lifetimePre65)}</div>
                  </div>
                )}
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-xs text-slate-400 mb-1">Medicare + OOP</div>
                  <div className="text-lg font-bold text-blue-400">{formatCurrency(lifetimeMedicare)}</div>
                  <div className="text-xs text-slate-500">+{formatCurrency(lifetimeIRMAA)} IRMAA</div>
                </div>
                {lifetimeLTC > 0 && (
                  <div className="bg-slate-800/50 rounded-lg p-3">
                    <div className="text-xs text-slate-400 mb-1">Long-Term Care</div>
                    <div className="text-lg font-bold text-red-400">{formatCurrency(lifetimeLTC)}</div>
                  </div>
                )}
              </div>
              {peakYear && peakYear.healthcareExpense > 0 && (
                <p className="text-xs text-slate-400">
                  Peak healthcare year: age {peakYear.myAge} at {formatCurrency(peakYear.healthcareExpense)}/yr. 
                  Model: {HEALTHCARE_PRESETS[personalInfo.healthcareModel]?.label}. 
                  Medical inflation: {((personalInfo.medicalInflation || 0.05) * 100).toFixed(1)}%.
                </p>
              )}
            </div>
          );
        })()}
        
        {/* Safe Spending Capacity Section */}
        {visibilitySettings.safeSpending && (() => {
          const retirementPortfolio = retirementProjection?.totalPortfolio || 0;
          
          // Inflate desired income to retirement-year dollars to match the nominal portfolio value
          const yearsToRetirement = Math.max(0, retirementAge - personalInfo.myAge);
          const currentDesired = personalInfo.desiredRetirementIncome * Math.pow(1 + personalInfo.inflationRate, yearsToRetirement);
          
          // Calculate sustainable income at different withdrawal rates
          const safeIncome3 = Math.round(retirementPortfolio * 0.03);
          const safeIncome4 = Math.round(retirementPortfolio * 0.04);
          const safeIncome5 = Math.round(retirementPortfolio * 0.05);
          
          // Add guaranteed income to get total sustainable lifestyle
          const guaranteedAtRetirement = retirementProjection?.totalGuaranteedIncome || 0;
          const totalLifestyle3 = safeIncome3 + guaranteedAtRetirement;
          const totalLifestyle4 = safeIncome4 + guaranteedAtRetirement;
          const totalLifestyle5 = safeIncome5 + guaranteedAtRetirement;
          
          // Calculate implied withdrawal rate of current plan
          const impliedRate = retirementPortfolio > 0 
            ? ((currentDesired - guaranteedAtRetirement) / retirementPortfolio) * 100 
            : 0;
          
          // Spending cushion
          const spendingCushion = totalLifestyle4 - currentDesired;
          
          return (
            <div className={cardStyle}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-slate-100">Safe Spending Capacity</h3>
                  <InfoCard
                    title="Safe Spending Capacity"
                    isOpen={openInfoCard === 'safeSpending'}
                    onToggle={() => toggleInfoCard('safeSpending')}
                    sections={[
                      {
                        heading: 'What This Shows',
                        body: 'This section answers: "How much can I safely spend each year in retirement?" It applies different withdrawal rate rules to your projected retirement portfolio and adds your guaranteed income to show total sustainable spending at each risk level.'
                      },
                      {
                        heading: 'The Withdrawal Rate Scenarios',
                        items: [
                          { icon: '🟢', label: 'Conservative (3%)', desc: 'Withdraw 3% of your portfolio annually. Very high probability of lasting 30+ years, even in poor markets. Best for early retirees or those wanting maximum safety margin.' },
                          { icon: '🟡', label: 'Traditional (4%)', desc: 'The classic "4% Rule" from the Trinity Study. Historically, a 4% initial withdrawal rate (adjusted for inflation) sustained a portfolio for 30 years in ~95% of scenarios.' },
                          { icon: '🟠', label: 'Aggressive (5%)', desc: 'Higher spending but greater risk of depletion. May work for shorter retirements (under 25 years) or if you have backup income sources.' },
                          { icon: '🟣', label: 'Your Plan', desc: 'Your actual implied withdrawal rate based on your desired spending minus guaranteed income, divided by your projected portfolio. Shows how your plan compares to the standard rules.' }
                        ]
                      },
                      {
                        heading: 'Key Concepts',
                        items: [
                          { icon: '📐', label: 'How It\'s Calculated', desc: 'Each scenario takes your projected retirement portfolio × the withdrawal rate to get annual portfolio income, then adds your guaranteed income (Social Security, pension, etc.) for total sustainable spending.' },
                          { icon: '📊', label: 'The Spending Cushion', desc: 'The difference between the 4% rule sustainable income and your desired spending. Positive (green) means you have room to spare. Negative (red) means your plan exceeds the traditional safe rate.' },
                          { icon: '💵', label: 'Nominal Dollars', desc: 'All amounts shown are in future dollars at your retirement age — they\'ve been adjusted for inflation so they\'re directly comparable to your projected portfolio value.' }
                        ],
                        tip: 'If your implied rate is above 4%, consider: increasing savings, delaying retirement by even 1–2 years (which both grows the portfolio and shortens the drawdown period), or adjusting spending expectations. Each year of delay has an outsized positive impact.'
                      }
                    ]}
                  />
                </div>
                <button
                  onClick={() => toggleVisibility('safeSpending')}
                  className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
                  title="Hide this section"
                >
                  Hide
                </button>
              </div>
              <p className="text-sm text-slate-400 mb-4">
                Based on your projected portfolio of {formatCurrency(retirementPortfolio)} at retirement (age {retirementAge}) 
                plus {formatCurrency(guaranteedAtRetirement)}/year in guaranteed income.
              </p>
              
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <div className="border rounded-lg px-4 py-3 bg-emerald-500/10 border-emerald-500/30">
                  <div className="text-slate-400 text-xs mb-0.5">Conservative (3%)</div>
                  <div className="text-xl font-bold text-emerald-400">{formatCurrency(totalLifestyle3)}</div>
                  <div className="text-xs text-slate-500">{formatCurrency(safeIncome3)} from portfolio</div>
                </div>
                <div className="border rounded-lg px-4 py-3 bg-amber-500/10 border-amber-500/30">
                  <div className="text-slate-400 text-xs mb-0.5">Traditional (4%)</div>
                  <div className="text-xl font-bold text-amber-400">{formatCurrency(totalLifestyle4)}</div>
                  <div className="text-xs text-slate-500">{formatCurrency(safeIncome4)} from portfolio</div>
                </div>
                <div className="border rounded-lg px-4 py-3 bg-orange-500/10 border-orange-500/30">
                  <div className="text-slate-400 text-xs mb-0.5">Aggressive (5%)</div>
                  <div className="text-xl font-bold text-orange-400">{formatCurrency(totalLifestyle5)}</div>
                  <div className="text-xs text-slate-500">{formatCurrency(safeIncome5)} from portfolio</div>
                </div>
                <div className="border rounded-lg px-4 py-3 bg-purple-500/10 border-purple-500/30">
                  <div className="text-slate-400 text-xs mb-0.5">Your Plan ({impliedRate.toFixed(1)}%)</div>
                  <div className="text-xl font-bold text-purple-400">{formatCurrency(currentDesired)}</div>
                  <div className="text-xs text-slate-500">
                    {spendingCushion >= 0 
                      ? <span className="text-emerald-400">+{formatCurrency(spendingCushion)} cushion vs 4%</span>
                      : <span className="text-red-400">{formatCurrency(spendingCushion)} above 4%</span>
                    }
                  </div>
                </div>
              </div>
              
              <p className="text-xs text-slate-500">
                The 4% rule suggests you can withdraw 4% of your portfolio annually with low risk of running out over 30 years.
                {spendingCushion > 0 && ` You have room to increase spending by ${formatCurrency(spendingCushion)}/year or gift to heirs.`}
              </p>
            </div>
          );
        })()}
        
        {/* Coast FIRE Indicator */}
        {visibilitySettings.coastFire && (
        <CoastFireSection
          accounts={accounts}
          personalInfo={personalInfo}
          retirementProjection={retirementProjection}
          cardStyle={cardStyle}
          formatCurrency={formatCurrency}
          openInfoCard={openInfoCard}
          toggleInfoCard={toggleInfoCard}
        />
        )}
        
        {/* Lifestyle vs Legacy Interactive Section */}
        {visibilitySettings.lifestyleLegacy && (
        <LifestyleVsLegacy 
          projections={projections}
          personalInfo={personalInfo}
          accounts={accounts}
          incomeStreams={incomeStreams}
          assets={assets}
          oneTimeEvents={oneTimeEvents}
          recurringExpenses={recurringExpenses}
          retirementAge={retirementAge}
          cardStyle={cardStyle}
          formatCurrency={formatCurrency}
          openInfoCard={openInfoCard}
          toggleInfoCard={toggleInfoCard}
          computeProjections={computeProjections}
        />
        )}
      </div>
    );
  };
  
  // Coast FIRE Section Component with Test Scenarios
  const CoastFireSection = ({ accounts, personalInfo, retirementProjection, cardStyle, formatCurrency, openInfoCard, toggleInfoCard }) => {
    const [showTestScenarios, setShowTestScenarios] = useState(false);
    const [selectedScenario, setSelectedScenario] = useState(null);
    const [showMathBreakdown, setShowMathBreakdown] = useState(false);
    
    // Test scenarios from published sources
    const testScenarios = [
      { 
        id: 1, 
        name: 'SmartAsset Example', 
        source: 'smartasset.com',
        annualSpending: 100000, 
        yearsToRetirement: 35, 
        returnRate: 0.06,
        expectedCoastNumber: 334000,
        description: 'Target $100k/year spending, 35 years out, 6% return'
      },
      { 
        id: 2, 
        name: 'TheFireCalculator Example', 
        source: 'thefirecalculator.com',
        annualSpending: 50000, 
        yearsToRetirement: 25, 
        returnRate: 0.07,
        expectedCoastNumber: 230000,
        description: 'Target $50k/year spending, 25 years out, 7% return'
      },
      { 
        id: 3, 
        name: 'Kubera Example', 
        source: 'kubera.com',
        annualSpending: 40000, 
        yearsToRetirement: 25, 
        returnRate: 0.07,
        expectedCoastNumber: 184249,
        description: 'Target $40k/year spending (=$1M FIRE), 25 years out, 7% return'
      },
      { 
        id: 4, 
        name: 'FinancialAha Example', 
        source: 'financialaha.com',
        annualSpending: 60000, 
        yearsToRetirement: 30, 
        returnRate: 0.07,
        expectedCoastNumber: 197105,
        description: 'Target $60k/year spending (=$1.5M FIRE), 30 years out, 7% return'
      },
      { 
        id: 5, 
        name: 'Marriage Kids Money Example', 
        source: 'marriagekidsandmoney.com',
        currentPortfolio: 500000, 
        yearsToRetirement: 25, 
        returnRate: 0.07,
        expectedFutureValue: 2714076,
        isGrowthTest: true,
        description: '$500k today grows to $2.7M in 25 years at 7%'
      },
    ];
    
    // Calculate for a test scenario
    const calculateScenario = (scenario) => {
      if (scenario.isGrowthTest) {
        // Future value test
        const calculated = scenario.currentPortfolio * Math.pow(1 + scenario.returnRate, scenario.yearsToRetirement);
        return {
          calculated: Math.round(calculated),
          expected: scenario.expectedFutureValue,
          difference: Math.round(calculated - scenario.expectedFutureValue),
          percentDiff: ((calculated - scenario.expectedFutureValue) / scenario.expectedFutureValue * 100).toFixed(2)
        };
      } else {
        // Coast FIRE number test
        const fireNumber = scenario.annualSpending / 0.04; // 25x rule
        const coastNumber = fireNumber / Math.pow(1 + scenario.returnRate, scenario.yearsToRetirement);
        return {
          fireNumber: Math.round(fireNumber),
          calculated: Math.round(coastNumber),
          expected: scenario.expectedCoastNumber,
          difference: Math.round(coastNumber - scenario.expectedCoastNumber),
          percentDiff: ((coastNumber - scenario.expectedCoastNumber) / scenario.expectedCoastNumber * 100).toFixed(2)
        };
      }
    };
    
    // Use actual data or selected test scenario
    const useTestData = selectedScenario !== null;
    const scenario = useTestData ? testScenarios.find(s => s.id === selectedScenario) : null;
    
    // Calculate Coast FIRE values
    const currentPortfolio = useTestData && scenario?.currentPortfolio 
      ? scenario.currentPortfolio 
      : accounts.reduce((sum, a) => sum + a.balance, 0);
    
    const yearsToRetirement = useTestData && scenario?.yearsToRetirement
      ? scenario.yearsToRetirement
      : Math.max(0, personalInfo.myRetirementAge - personalInfo.myAge);
    
    const guaranteedAtRetirement = useTestData ? 0 : (retirementProjection?.totalGuaranteedIncome || 0);
    
    const spendingFromPortfolio = useTestData && scenario?.annualSpending
      ? scenario.annualSpending
      : Math.max(0, personalInfo.desiredRetirementIncome - guaranteedAtRetirement);
    
    const weightedCAGR = useTestData && scenario?.returnRate
      ? scenario.returnRate
      : (currentPortfolio > 0 
          ? accounts.reduce((sum, a) => sum + (a.balance * a.cagr), 0) / currentPortfolio 
          : 0.07);
    
    // Core calculations
    const targetPortfolioAtRetirement = spendingFromPortfolio / 0.04; // 4% rule (25x)
    const targetPortfolioAt3Pct = spendingFromPortfolio / 0.03; // Conservative 3%
    const growthFactor = Math.pow(1 + weightedCAGR, yearsToRetirement);
    const coastFireNumber4Pct = targetPortfolioAtRetirement / growthFactor;
    const coastFireNumber3Pct = targetPortfolioAt3Pct / growthFactor;
    const coastProgress4Pct = coastFireNumber4Pct > 0 ? (currentPortfolio / coastFireNumber4Pct) * 100 : 0;
    const coastProgress3Pct = coastFireNumber3Pct > 0 ? (currentPortfolio / coastFireNumber3Pct) * 100 : 0;
    const reachedCoast4Pct = currentPortfolio >= coastFireNumber4Pct;
    const projectedCoasting = currentPortfolio * growthFactor;
    const projectedWithContributions = retirementProjection?.totalPortfolio || projectedCoasting;
    const coastSurplus = projectedCoasting - targetPortfolioAtRetirement;
    
    let earlyRetirementAge = null;
    if (reachedCoast4Pct && !useTestData) {
      const yearsNeeded = Math.log(targetPortfolioAtRetirement / currentPortfolio) / Math.log(1 + weightedCAGR);
      earlyRetirementAge = Math.ceil(personalInfo.myAge + yearsNeeded);
    }
    
    return (
      <div className={cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-100">Coast FIRE Progress</h3>
            <InfoCard
              title="Coast FIRE"
              isOpen={openInfoCard === 'coastFire'}
              onToggle={() => toggleInfoCard('coastFire')}
              sections={[
                {
                  heading: 'What Is Coast FIRE?',
                  body: 'Coast FIRE (Financial Independence, Retire Early) is the point where your current retirement savings, if left completely alone with no further contributions, will grow enough through market returns to fully fund your retirement by your target retirement age.'
                },
                {
                  heading: 'What The Numbers Mean',
                  items: [
                    { icon: '🎯', label: 'Coast FIRE Number (4%)', desc: 'The portfolio balance you need TODAY so that compound growth alone gets you to a retirement portfolio that supports your spending at a 4% withdrawal rate. Calculated as: (Annual spending need ÷ 0.04) ÷ (1 + growth rate)^years to retirement.' },
                    { icon: '🛡️', label: 'Conservative (3%)', desc: 'Same calculation but using a safer 3% withdrawal rate — requires a larger number but provides more margin.' },
                    { icon: '📊', label: 'Progress Percentage', desc: 'How close you are to your Coast FIRE number. At 100%+, you could theoretically stop all retirement contributions and still be on track.' },
                    { icon: '🏖️', label: 'Early Retirement Age', desc: 'If you\'ve reached Coast FIRE, this shows the earliest age your current portfolio could grow to meet your target — without any additional contributions.' }
                  ]
                },
                {
                  heading: 'What Reaching Coast FIRE Means',
                  body: 'Reaching Coast FIRE doesn\'t mean you should stop saving — it means you have options. You could take a lower-paying but more fulfilling job, reduce hours, or simply have peace of mind that your retirement is funded even if life throws curveballs.',
                  tip: 'Coast FIRE assumes your portfolio earns your weighted average return every year without interruption. Real markets are volatile — continuing to contribute beyond Coast FIRE provides a buffer against bad sequence of returns. Think of it as a milestone, not a finish line.'
                },
                {
                  heading: 'The Math',
                  items: [
                    { icon: '1️⃣', label: 'Step 1', desc: 'Calculate retirement spending need from portfolio (desired income minus guaranteed income like SS/pension).' },
                    { icon: '2️⃣', label: 'Step 2', desc: 'Apply the 4% rule in reverse: spending ÷ 0.04 = required portfolio at retirement (the "25x rule").' },
                    { icon: '3️⃣', label: 'Step 3', desc: 'Discount that future amount back to today: required portfolio ÷ (1 + growth rate)^years = Coast FIRE number.' },
                    { icon: '4️⃣', label: 'Step 4', desc: 'Compare your current portfolio to the Coast FIRE number to get your progress percentage.' }
                  ]
                }
              ]}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowMathBreakdown(!showMathBreakdown)}
              className={`px-3 py-1 text-xs rounded ${showMathBreakdown ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              {showMathBreakdown ? '✓ Math Breakdown' : 'Show Math'}
            </button>
            <button
              onClick={() => setShowTestScenarios(!showTestScenarios)}
              className={`px-3 py-1 text-xs rounded ${showTestScenarios ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              {showTestScenarios ? '✓ Test Scenarios' : 'Validate Calculator'}
            </button>
          </div>
        </div>
        
        <p className="text-sm text-slate-400 mb-4">
          Coast FIRE is when your current portfolio, with no additional contributions, will grow to support your retirement spending goals.
        </p>
        
        {/* Test Scenarios Panel */}
        {showTestScenarios && (
          <div className="mb-4 p-3 bg-slate-800/80 rounded-lg border border-amber-500/30">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-amber-400">🧪 Test Scenarios from Published Sources</h4>
              {selectedScenario && (
                <button 
                  onClick={() => setSelectedScenario(null)}
                  className="px-2 py-1 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600"
                >
                  ← Back to My Data
                </button>
              )}
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-1.5 px-2 text-slate-400">Scenario</th>
                    <th className="text-right py-1.5 px-2 text-slate-400">Expected</th>
                    <th className="text-right py-1.5 px-2 text-slate-400">Calculated</th>
                    <th className="text-right py-1.5 px-2 text-slate-400">Diff</th>
                    <th className="text-center py-1.5 px-2 text-slate-400">Status</th>
                    <th className="text-center py-1.5 px-2 text-slate-400">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {testScenarios.map(s => {
                    const result = calculateScenario(s);
                    const isMatch = Math.abs(parseFloat(result.percentDiff)) < 1;
                    return (
                      <tr key={s.id} className={`border-b border-slate-700/50 ${selectedScenario === s.id ? 'bg-amber-500/20' : ''}`}>
                        <td className="py-1.5 px-2">
                          <div className="text-slate-300">{s.name}</div>
                          <div className="text-slate-500 text-[10px]">{s.description}</div>
                        </td>
                        <td className="py-1.5 px-2 text-right text-slate-300 font-mono">
                          {formatCurrency(s.isGrowthTest ? s.expectedFutureValue : s.expectedCoastNumber)}
                        </td>
                        <td className="py-1.5 px-2 text-right text-purple-400 font-mono">
                          {formatCurrency(result.calculated)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono">
                          <span className={isMatch ? 'text-emerald-400' : 'text-amber-400'}>
                            {result.percentDiff}%
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          {isMatch 
                            ? <span className="text-emerald-400">✓ Match</span>
                            : <span className="text-amber-400">~ Close</span>
                          }
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <button
                            onClick={() => setSelectedScenario(selectedScenario === s.id ? null : s.id)}
                            className={`px-2 py-0.5 text-[10px] rounded ${selectedScenario === s.id ? 'bg-amber-600 text-white' : 'bg-slate-600 text-slate-300 hover:bg-slate-500'}`}
                          >
                            {selectedScenario === s.id ? 'Active' : 'Load'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {selectedScenario && scenario && (
              <div className="mt-3 p-2 bg-amber-500/10 rounded text-xs text-amber-300">
                <strong>Testing:</strong> {scenario.name} — {scenario.description}
                <br/>
                <span className="text-slate-400">Source: {scenario.source}</span>
              </div>
            )}
          </div>
        )}
        
        {/* Math Breakdown Panel */}
        {showMathBreakdown && (
          <div className="mb-4 p-3 bg-slate-800/80 rounded-lg border border-purple-500/30">
            <h4 className="text-sm font-semibold text-purple-400 mb-3">📐 Calculation Breakdown</h4>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-slate-400 mb-2 font-medium">Step 1: Calculate FIRE Number (25x Rule)</div>
                <div className="font-mono bg-slate-900/50 p-2 rounded text-slate-300">
                  <div>Annual Spending from Portfolio = {formatCurrency(spendingFromPortfolio)}</div>
                  <div className="text-slate-500">FIRE Number = Spending ÷ 0.04</div>
                  <div className="text-purple-400">FIRE Number = {formatCurrency(spendingFromPortfolio)} ÷ 0.04 = {formatCurrency(targetPortfolioAtRetirement)}</div>
                </div>
              </div>
              
              <div>
                <div className="text-slate-400 mb-2 font-medium">Step 2: Calculate Growth Factor</div>
                <div className="font-mono bg-slate-900/50 p-2 rounded text-slate-300">
                  <div>Return Rate = {(weightedCAGR * 100).toFixed(1)}%</div>
                  <div>Years = {yearsToRetirement}</div>
                  <div className="text-slate-500">Growth Factor = (1 + r)^n</div>
                  <div className="text-purple-400">= (1 + {weightedCAGR.toFixed(3)})^{yearsToRetirement} = {growthFactor.toFixed(3)}</div>
                </div>
              </div>
              
              <div>
                <div className="text-slate-400 mb-2 font-medium">Step 3: Calculate Coast FIRE Number</div>
                <div className="font-mono bg-slate-900/50 p-2 rounded text-slate-300">
                  <div className="text-slate-500">Coast FIRE = FIRE Number ÷ Growth Factor</div>
                  <div className="text-purple-400">= {formatCurrency(targetPortfolioAtRetirement)} ÷ {growthFactor.toFixed(3)}</div>
                  <div className="text-emerald-400 font-bold">= {formatCurrency(coastFireNumber4Pct)}</div>
                </div>
              </div>
              
              <div>
                <div className="text-slate-400 mb-2 font-medium">Step 4: Project Future Value (Coasting)</div>
                <div className="font-mono bg-slate-900/50 p-2 rounded text-slate-300">
                  <div className="text-slate-500">FV = Current Portfolio × Growth Factor</div>
                  <div className="text-purple-400">= {formatCurrency(currentPortfolio)} × {growthFactor.toFixed(3)}</div>
                  <div className="text-emerald-400 font-bold">= {formatCurrency(projectedCoasting)}</div>
                </div>
              </div>
            </div>
            
            <div className="mt-3 p-2 bg-purple-500/10 rounded text-xs">
              <strong className="text-purple-400">Formula Summary:</strong>
              <div className="text-slate-300 mt-1">
                Coast FIRE Number = (Annual Spending ÷ 0.04) ÷ (1 + return)^years
              </div>
              <div className="text-slate-300">
                = ({formatCurrency(spendingFromPortfolio)} ÷ 0.04) ÷ (1 + {(weightedCAGR * 100).toFixed(1)}%)^{yearsToRetirement}
              </div>
              <div className="text-emerald-400">
                = {formatCurrency(targetPortfolioAtRetirement)} ÷ {growthFactor.toFixed(3)} = <strong>{formatCurrency(coastFireNumber4Pct)}</strong>
              </div>
            </div>
          </div>
        )}
        
        {/* Using Test Data Indicator */}
        {useTestData && (
          <div className="mb-4 p-2 bg-amber-500/20 rounded-lg border border-amber-500/50 text-xs text-amber-300">
            ⚠️ Showing test scenario data, not your actual portfolio. Click "Back to My Data" to return.
          </div>
        )}
        
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className={`border rounded-lg px-4 py-3 ${reachedCoast4Pct ? 'bg-emerald-500/20 border-emerald-500/50' : 'bg-slate-800/60 border-slate-700/50'}`}>
            <div className="text-slate-400 text-xs mb-0.5">Coast FIRE Number (4%)</div>
            <div className={`text-xl font-bold ${reachedCoast4Pct ? 'text-emerald-400' : 'text-slate-300'}`}>
              {formatCurrency(coastFireNumber4Pct)}
            </div>
            <div className="text-xs text-slate-500">Portfolio needed today</div>
          </div>
          <div className="border rounded-lg px-4 py-3 bg-purple-500/20 border-purple-500/50">
            <div className="text-slate-400 text-xs mb-0.5">{useTestData ? 'Test Portfolio' : 'Your Current Portfolio'}</div>
            <div className="text-xl font-bold text-purple-400">{formatCurrency(currentPortfolio)}</div>
            <div className="text-xs text-slate-500">
              {reachedCoast4Pct 
                ? <span className="text-emerald-400">✓ Coast FIRE reached!</span>
                : <span>{formatCurrency(coastFireNumber4Pct - currentPortfolio)} to go</span>
              }
            </div>
          </div>
          <div className={`border rounded-lg px-4 py-3 ${coastProgress4Pct >= 100 ? 'bg-emerald-500/20 border-emerald-500/50' : coastProgress4Pct >= 75 ? 'bg-amber-500/20 border-amber-500/50' : 'bg-slate-800/60 border-slate-700/50'}`}>
            <div className="text-slate-400 text-xs mb-0.5">Progress to Coast FIRE</div>
            <div className={`text-xl font-bold ${coastProgress4Pct >= 100 ? 'text-emerald-400' : coastProgress4Pct >= 75 ? 'text-amber-400' : 'text-slate-300'}`}>
              {Math.min(coastProgress4Pct, 100).toFixed(0)}%
            </div>
            <div className="text-xs text-slate-500">
              {coastProgress4Pct > 100 ? `${(coastProgress4Pct - 100).toFixed(0)}% buffer` : 'of 4% rule target'}
            </div>
          </div>
          <div className="border rounded-lg px-4 py-3 bg-sky-500/20 border-sky-500/50">
            <div className="text-slate-400 text-xs mb-0.5">Target at Retirement</div>
            <div className="text-xl font-bold text-sky-400">{formatCurrency(targetPortfolioAtRetirement)}</div>
            <div className="text-xs text-slate-500">To support {formatCurrency(spendingFromPortfolio)}/yr</div>
          </div>
        </div>
        
        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Progress to Coast FIRE (4% rule)</span>
            <span>{coastProgress4Pct.toFixed(1)}%</span>
          </div>
          <div className="h-4 bg-slate-700 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all ${coastProgress4Pct >= 100 ? 'bg-emerald-500' : coastProgress4Pct >= 75 ? 'bg-amber-500' : 'bg-purple-500'}`}
              style={{ width: `${Math.min(coastProgress4Pct, 100)}%` }}
            />
          </div>
          {coastProgress4Pct < 100 && (
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>{formatCurrency(currentPortfolio)}</span>
              <span>{formatCurrency(coastFireNumber4Pct)}</span>
            </div>
          )}
        </div>
        
        {/* Comparison: With vs Without Contributions */}
        {!useTestData && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <div className="text-sm font-medium text-slate-300 mb-2">If You Coast Now (No More Contributions)</div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Portfolio at {personalInfo.myRetirementAge}:</span>
                <span className={coastSurplus >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatCurrency(projectedCoasting)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">vs Target needed:</span>
                <span className={coastSurplus >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {coastSurplus >= 0 ? '+' : ''}{formatCurrency(coastSurplus)}
                </span>
              </div>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <div className="text-sm font-medium text-slate-300 mb-2">With Continued Contributions</div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Portfolio at {personalInfo.myRetirementAge}:</span>
                <span className="text-emerald-400">{formatCurrency(projectedWithContributions)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Extra vs coasting:</span>
                <span className="text-emerald-400">+{formatCurrency(projectedWithContributions - projectedCoasting)}</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Status Message */}
        {!useTestData && (
          <div className={`p-3 rounded-lg ${reachedCoast4Pct ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
            {reachedCoast4Pct ? (
              <p className="text-sm text-emerald-300">
                <strong>🎉 You've reached Coast FIRE!</strong> Your current portfolio of {formatCurrency(currentPortfolio)}, 
                even with no additional contributions, is projected to grow to {formatCurrency(projectedCoasting)} by age {personalInfo.myRetirementAge}. 
                This exceeds your target of {formatCurrency(targetPortfolioAtRetirement)} needed to support {formatCurrency(spendingFromPortfolio)}/year in retirement.
                {earlyRetirementAge && earlyRetirementAge < personalInfo.myRetirementAge && (
                  <span className="block mt-2">
                    💡 You could potentially retire as early as age <strong>{earlyRetirementAge}</strong> if you continued contributing.
                  </span>
                )}
              </p>
            ) : (
              <p className="text-sm text-amber-300">
                <strong>📈 Keep going!</strong> You're {coastProgress4Pct.toFixed(0)}% of the way to Coast FIRE. 
                You need {formatCurrency(coastFireNumber4Pct - currentPortfolio)} more to reach the point where you could stop contributing 
                and still hit your retirement goals.
              </p>
            )}
          </div>
        )}
        
        <p className="text-xs text-slate-500 mt-3">
          Assumes {(weightedCAGR * 100).toFixed(1)}% average annual return{!useTestData && ' (weighted by your account balances)'} and {yearsToRetirement} years until retirement.
          Conservative Coast FIRE (3% rule) requires {formatCurrency(coastFireNumber3Pct)} — you're at {coastProgress3Pct.toFixed(0)}% of that target.
        </p>
      </div>
    );
  };
  
  // Lifestyle vs Legacy Component
  const LifestyleVsLegacy = ({ projections, personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses, retirementAge, cardStyle, formatCurrency, openInfoCard, toggleInfoCard, computeProjections }) => {
    const scenarios = useMemo(() => {
      const baseDesired = personalInfo.desiredRetirementIncome;
      const adjustments = [-30, -20, -10, 0, 10, 20, 30, 50];
      const legacyAge = personalInfo.legacyAge || 95;
      
      return adjustments.map(adj => {
        const adjustedDesired = baseDesired * (1 + adj / 100);
        
        // Use the unified projection engine with modified spending target
        const modifiedPI = { ...personalInfo, desiredRetirementIncome: adjustedDesired };
        const proj = computeProjections(modifiedPI, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses);
        
        const legacyYear = proj.find(p => p.myAge === legacyAge);
        const legacyAtTarget = legacyYear ? legacyYear.totalPortfolio : 0;
        const runsOutAge = proj.find(p => p.myAge >= retirementAge && p.totalPortfolio <= 0)?.myAge || null;
        
        return { adjustment: adj, spending: adjustedDesired, legacy: Math.round(legacyAtTarget), runsOut: runsOutAge };
      });
    }, [personalInfo, accounts, incomeStreams, assets, oneTimeEvents]);
    
    return (
      <div className={cardStyle}>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-lg font-semibold text-slate-100">Lifestyle vs Legacy Tradeoff</h3>
          <InfoCard
            title="Lifestyle vs Legacy Tradeoff"
            isOpen={openInfoCard === 'lifestyleLegacy'}
            onToggle={() => toggleInfoCard('lifestyleLegacy')}
            sections={[
              {
                heading: 'What This Shows',
                body: 'This table explores a fundamental retirement tension: spending more means a better lifestyle but a smaller inheritance, while spending less preserves wealth for heirs but may mean unnecessary frugality. It runs your complete financial plan at 8 different spending levels to show the tradeoff.'
              },
              {
                heading: 'Reading The Table',
                items: [
                  { icon: '📋', label: 'Scenario', desc: 'Each row adjusts your base desired income by the shown percentage. "Your Plan (Base)" at 0% is your current settings. Negative percentages mean spending less; positive means spending more.' },
                  { icon: '💜', label: 'Annual Spend', desc: 'The actual dollar amount of desired retirement income for that scenario (in today\'s dollars — inflation is applied internally during the simulation).' },
                  { icon: '💚', label: 'Legacy at 95', desc: 'What\'s left in your accounts at age 95 under this spending level. This is the money available for heirs, charitable giving, or as a safety buffer.' },
                  { icon: '✅', label: 'Status', desc: '"Sustainable" (green ✓) means money lasts through 95. "Runs out at [age]" (red) means the portfolio is depleted before 95 at that spending level.' }
                ]
              },
              {
                heading: 'How to Use This',
                body: 'Find the row where your plan sits (highlighted in gold). Look at your legacy amount — is it larger than you need? You might be able to spend more and enjoy retirement. Is status showing "Runs out"? You need to reduce spending or boost savings. The table lets you see exactly where the sustainability boundary lies.',
                tip: 'Many people discover they\'re being unnecessarily conservative — leaving hundreds of thousands behind when they could have enjoyed a richer retirement. Others find they\'re right on the edge. This table helps you make that tradeoff intentionally rather than by accident.'
              },
              {
                heading: 'What\'s Behind The Numbers',
                body: 'Each row runs a full year-by-year projection from today through age 95 — including contributions during working years, tax-aware withdrawals, RMDs, Social Security, pensions, and account growth. It uses the same engine as your main projection, just with adjusted spending targets.'
              }
            ]}
          />
        </div>
        <p className="text-sm text-slate-400 mb-4">
          See how different spending levels affect your legacy. Your current plan is highlighted.
        </p>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-2 px-2 text-slate-400">Scenario</th>
                <th className="text-right py-2 px-2 text-slate-400">Annual Spend</th>
                <th className="text-right py-2 px-2 text-slate-400">Legacy at {personalInfo.legacyAge || 95}</th>
                <th className="text-center py-2 px-2 text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map(s => (
                <tr key={s.adjustment} className={`border-b border-slate-700/50 ${s.adjustment === 0 ? 'bg-amber-500/20' : ''}`}>
                  <td className="py-1.5 px-2 text-slate-300">{s.adjustment === 0 ? 'Your Plan (Base)' : `${s.adjustment > 0 ? '+' : ''}${s.adjustment}%`}</td>
                  <td className="py-1.5 px-2 text-right text-purple-400">{formatCurrency(s.spending)}</td>
                  <td className="py-1.5 px-2 text-right text-emerald-400">{formatCurrency(s.legacy)}</td>
                  <td className="py-1.5 px-2 text-center">
                    {s.runsOut ? <span className="text-red-400 text-xs">Runs out at {s.runsOut}</span> : <span className="text-emerald-400 text-xs">✓ Sustainable</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  
  const PersonalInfoTab = () => {
    const [localInfo, setLocalInfo] = useState(personalInfo);
    const [dirtyPI, setDirtyPI] = useState(false);
    
    // Only sync from parent on structural changes (import/clear), not field edits
    const piVersion = personalInfo.myAge + '|' + personalInfo.spouseAge + '|' + personalInfo.filingStatus + '|' + (personalInfo.state || '');
    // Actually, just never sync — local state is master during editing
    // Parent sync happens only via Save button
    
    const handleChange = (field, value) => {
      setLocalInfo(prev => ({ ...prev, [field]: value }));
      setDirtyPI(true);
    };
    
    const savePersonalInfo = () => {
      const currentYear = new Date().getFullYear();
      const updates = { ...localInfo };
      updates.myBirthYear = currentYear - localInfo.myAge;
      if (localInfo.spouseAge) updates.spouseBirthYear = currentYear - localInfo.spouseAge;
      setPersonalInfo(updates);
      setDirtyPI(false);
    };
    
    const compactInputStyle = "w-full bg-slate-900/80 border border-slate-600/50 rounded px-3 py-1.5 text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50 transition-all text-sm";
    const compactLabelStyle = "text-xs font-medium text-slate-400";
    
    return (
      <div className="space-y-4">
        {dirtyPI && (
          <div className="flex justify-end">
            <button onClick={savePersonalInfo} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium transition-colors">💾 Save Changes</button>
          </div>
        )}
        <div className={cardStyle}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Ages Section */}
            <div>
              <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Ages</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={compactLabelStyle}>My Current Age</label>
                  <AgeCell
                    value={localInfo.myAge}
                    onChange={e => handleChange('myAge', Number(e.target.value) || 0)}
                    className={compactInputStyle}
                  />
                </div>
                <div>
                  <label className={compactLabelStyle}>Spouse Current Age</label>
                  <AgeCell
                    value={localInfo.spouseAge}
                    onChange={e => handleChange('spouseAge', Number(e.target.value) || 0)}
                    className={compactInputStyle}
                  />
                </div>
                <div>
                  <label className={compactLabelStyle}>My Retirement Age</label>
                  <AgeCell
                    value={localInfo.myRetirementAge}
                    onChange={e => handleChange('myRetirementAge', Number(e.target.value) || 0)}
                    className={compactInputStyle}
                  />
                </div>
                <div>
                  <label className={compactLabelStyle}>Spouse Retirement Age</label>
                  <AgeCell
                    value={localInfo.spouseRetirementAge}
                    onChange={e => handleChange('spouseRetirementAge', Number(e.target.value) || 0)}
                    className={compactInputStyle}
                  />
                </div>
                <div>
                  <label className={compactLabelStyle}>Planning / Legacy Age</label>
                  <AgeCell
                    value={localInfo.legacyAge || 95}
                    onChange={e => handleChange('legacyAge', Number(e.target.value) || 95)}
                    className={compactInputStyle}
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-2">Retirement age determines when portfolio withdrawals begin. Birth year determines RMD start age per SECURE 2.0 Act. Planning/Legacy Age sets the end of all projections (default 95).</p>
            </div>
            
            {/* Tax Settings Section */}
            <div>
              <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Tax Settings</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={compactLabelStyle}>Filing Status</label>
                  <select 
                    value={localInfo.filingStatus} 
                    onChange={e => handleChange('filingStatus', e.target.value)} 
                    className={compactInputStyle}
                  >
                    <option value="married_joint">Married Joint</option>
                    <option value="married_separate">Married Separate</option>
                    <option value="single">Single</option>
                    <option value="head_of_household">Head of Household</option>
                  </select>
                </div>
                <div>
                  <label className={compactLabelStyle}>State</label>
                  <select 
                    value={localInfo.state} 
                    onChange={e => handleChange('state', e.target.value)} 
                    className={compactInputStyle}
                  >
                    {Object.keys(STATE_TAX_RATES).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
          
          <div className="border-t border-slate-700/50 mt-5 pt-5">
            <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Retirement Spending Goal</h4>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className={compactLabelStyle}>Desired Annual Income</label>
                <CurrencyCell
                  value={localInfo.desiredRetirementIncome}
                  onValueChange={v => handleChange('desiredRetirementIncome', v)}
                  className={compactInputStyle + " text-emerald-400 font-medium"}
                />
              </div>
              <div>
                <label className={compactLabelStyle}>Inflation Rate %</label>
                <PercentCell
                  value={localInfo.inflationRate}
                  onValueChange={v => handleChange('inflationRate', v)}
                  className={compactInputStyle}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">This is your target annual spending in retirement (in today's dollars). It will be adjusted for inflation each year.</p>
          </div>
          
          {/* Charitable Giving / QCD Section */}
          <div className="border-t border-slate-700/50 mt-5 pt-5">
            <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Charitable Giving & QCD Strategy</h4>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className={compactLabelStyle}>Charitable Giving (% of Spending)</label>
                <PercentCell
                  value={(localInfo.charitableGivingPercent || 0) / 100}
                  onValueChange={v => handleChange('charitableGivingPercent', Math.round(v * 10000) / 100)}
                  className={compactInputStyle}
                />
              </div>
              <div className="col-span-1 lg:col-span-3 flex items-center">
                {(localInfo.charitableGivingPercent || 0) > 0 && (
                  <div className="text-sm text-slate-400">
                    <span className="text-emerald-400 font-medium">
                      {formatCurrency(localInfo.desiredRetirementIncome * (localInfo.charitableGivingPercent / 100))}
                    </span>
                    {' '}per year in today's dollars
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 p-3 bg-emerald-900/20 border border-emerald-700/30 rounded-lg">
              <p className="text-xs text-emerald-300 font-medium mb-1">&#128161; QCD Tax Strategy (Qualified Charitable Distribution)</p>
              <p className="text-xs text-slate-400">
                Starting at age 70&#189;, you can donate up to $105,000/year directly from your IRA to charity. 
                This satisfies your RMD but <strong className="text-emerald-400">isn't counted as taxable income</strong>. 
                Unlike itemizing deductions, you still get the full standard deduction. 
                When charitable giving % is set, the planner automatically applies QCDs to reduce your tax burden during RMD years.
              </p>
            </div>
          </div>
          
          {/* Roth Conversion Strategy Section */}
          <div className="border-t border-slate-700/50 mt-5 pt-5">
            <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Planned Roth Conversion Strategy</h4>
            
            {/* Mode toggle */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => handleChange('rothConversionBracket', '')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  !(localInfo.rothConversionBracket)
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                    : 'text-slate-400 border-slate-600/50 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                Fixed Amount
              </button>
              <button
                onClick={() => { handleChange('rothConversionAmount', 0); handleChange('rothConversionBracket', '22%'); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  localInfo.rothConversionBracket
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                    : 'text-slate-400 border-slate-600/50 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                Fill to Bracket
              </button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Fixed amount input OR bracket selector */}
              {!localInfo.rothConversionBracket ? (
                <div>
                  <label className={compactLabelStyle}>Annual Conversion Amount</label>
                  <CurrencyCell
                    value={localInfo.rothConversionAmount || 0}
                    onValueChange={v => handleChange('rothConversionAmount', v)}
                    className={compactInputStyle}
                  />
                </div>
              ) : (
                <div>
                  <label className={compactLabelStyle}>Target Tax Bracket</label>
                  <select 
                    value={localInfo.rothConversionBracket || '22%'} 
                    onChange={e => handleChange('rothConversionBracket', e.target.value)} 
                    className={compactInputStyle}
                  >
                    <option value="12%">12% Bracket</option>
                    <option value="22%">22% Bracket</option>
                    <option value="24%">24% Bracket</option>
                    <option value="32%">32% Bracket</option>
                  </select>
                </div>
              )}
              <div>
                <label className={compactLabelStyle}>Start Age</label>
                <AgeCell
                  value={localInfo.rothConversionStartAge}
                  onChange={e => handleChange('rothConversionStartAge', Number(e.target.value) || 0)}
                  className={compactInputStyle}
                />
              </div>
              <div>
                <label className={compactLabelStyle}>End Age</label>
                <AgeCell
                  value={localInfo.rothConversionEndAge}
                  onChange={e => handleChange('rothConversionEndAge', Number(e.target.value) || 0)}
                  className={compactInputStyle}
                />
              </div>
            </div>
            <div className="mt-3 p-3 bg-purple-900/20 border border-purple-700/30 rounded-lg">
              <p className="text-xs text-purple-300 font-medium mb-1">&#128161; Roth Conversion Strategy</p>
              <p className="text-xs text-slate-400">
                Each year during the specified age range, funds are moved from the largest pre-tax account to the largest Roth account. 
                The conversion is added to your taxable income for that year. 
                Roth conversions appear as <strong className="text-purple-400">purple-highlighted rows</strong> in the Detailed Table.
                {localInfo.rothConversionBracket ? ` Fill-to-bracket mode converts enough each year to fully utilize the ${localInfo.rothConversionBracket} bracket (based on other income).` : ''}
              </p>
            </div>
          </div>
          
          {/* Withdrawal Priority Section */}
          <div className="border-t border-slate-700/50 mt-5 pt-5">
            <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Withdrawal Priority</h4>
            <p className="text-xs text-slate-500 mb-3">
              Set the order in which account types are used for retirement withdrawals. Drag to reorder, or use the arrows. 
              Note: RMDs from pre-tax accounts are always taken first regardless of this setting.
            </p>
            <div className="flex flex-col gap-2">
              {(localInfo.withdrawalPriority || ['pretax', 'brokerage', 'roth']).map((item, idx) => {
                const labels = { pretax: 'Pre-Tax (401k, Trad IRA, 457b)', brokerage: 'Brokerage & HSA', roth: 'Roth Accounts' };
                const colors = { pretax: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400', brokerage: 'bg-sky-500/20 border-sky-500/50 text-sky-400', roth: 'bg-purple-500/20 border-purple-500/50 text-purple-400' };
                const priority = localInfo.withdrawalPriority || ['pretax', 'brokerage', 'roth'];
                
                const moveUp = () => {
                  if (idx === 0) return;
                  const newPriority = [...priority];
                  [newPriority[idx - 1], newPriority[idx]] = [newPriority[idx], newPriority[idx - 1]];
                  setPersonalInfo(prev => ({ ...prev, withdrawalPriority: newPriority }));
                };
                
                const moveDown = () => {
                  if (idx === priority.length - 1) return;
                  const newPriority = [...priority];
                  [newPriority[idx], newPriority[idx + 1]] = [newPriority[idx + 1], newPriority[idx]];
                  setPersonalInfo(prev => ({ ...prev, withdrawalPriority: newPriority }));
                };
                
                return (
                  <div key={item} className={`flex items-center gap-3 px-4 py-2 rounded-lg border ${colors[item]}`}>
                    <span className="text-slate-500 font-bold text-lg w-6">{idx + 1}.</span>
                    <span className="flex-1 font-medium">{labels[item]}</span>
                    <div className="flex gap-1">
                      <button 
                        onClick={moveUp}
                        disabled={idx === 0}
                        className={`px-2 py-1 rounded text-sm ${idx === 0 ? 'text-slate-600 cursor-not-allowed' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                      >
                        &#9650;
                      </button>
                      <button 
                        onClick={moveDown}
                        disabled={idx === priority.length - 1}
                        className={`px-2 py-1 rounded text-sm ${idx === priority.length - 1 ? 'text-slate-600 cursor-not-allowed' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                      >
                        &#9660;
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 mt-3">
              <strong className="text-slate-400">Current strategy:</strong> After mandatory RMDs, withdraw from {
                (localInfo.withdrawalPriority || ['pretax', 'brokerage', 'roth']).map((item, idx, arr) => {
                  const labels = { pretax: 'Pre-Tax', brokerage: 'Brokerage', roth: 'Roth' };
                  if (idx === arr.length - 1) return labels[item];
                  if (idx === arr.length - 2) return labels[item] + ', then ';
                  return labels[item] + ', ';
                }).join('')
              } last.
            </p>
          </div>
          
          {/* Survivor Modeling Section */}
          {localInfo.filingStatus === 'married_joint' && (
            <div className="border-t border-slate-700/50 mt-5 pt-5">
              <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Survivor Modeling</h4>
              <div className="flex items-center gap-3 mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={localInfo.survivorModelEnabled || false}
                    onChange={e => handleChange('survivorModelEnabled', e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/50"
                  />
                  <span className="text-sm text-slate-300">Enable survivor modeling</span>
                </label>
              </div>
              
              {localInfo.survivorModelEnabled && (
                <>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className={compactLabelStyle}>My Life Expectancy</label>
                      <AgeCell
                        value={localInfo.myLifeExpectancy || 85}
                        onChange={e => handleChange('myLifeExpectancy', Number(e.target.value) || 85)}
                        className={compactInputStyle}
                      />
                    </div>
                    <div>
                      <label className={compactLabelStyle}>Spouse Life Expectancy</label>
                      <AgeCell
                        value={localInfo.spouseLifeExpectancy || 87}
                        onChange={e => handleChange('spouseLifeExpectancy', Number(e.target.value) || 87)}
                        className={compactInputStyle}
                      />
                    </div>
                  </div>
                  <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-lg">
                    <p className="text-xs text-slate-400">
                      <strong className="text-slate-300">When a spouse passes:</strong> Their earned income, pension, and other income stop. 
                      Social Security switches to the <strong className="text-amber-400">higher of the two benefits</strong> (survivor benefit). 
                      Filing status changes from Married Joint to Single after 2 years, which narrows tax brackets significantly. 
                      Pensions marked with "survivor benefit" continue at 50% (configurable in Income tab).
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
          
          {/* Healthcare Expense Modeling */}
          <div className="border-t border-slate-700/50 mt-5 pt-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Healthcare Expenses</h4>
                <p className="text-xs text-slate-500 mt-1">Model healthcare costs: pre-Medicare, Medicare premiums, out-of-pocket, and long-term care</p>
              </div>
            </div>
            
            <div className="mb-3">
              <label className={compactLabelStyle}>Healthcare Model</label>
              <select
                value={localInfo.healthcareModel || 'none'}
                onChange={e => handleChange('healthcareModel', e.target.value)}
                className={compactInputStyle}
              >
                {Object.entries(HEALTHCARE_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>{preset.label} — {preset.description}</option>
                ))}
              </select>
            </div>
            
            {localInfo.healthcareModel !== 'none' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className={compactLabelStyle}>Pre-65 Annual Cost (per person)</label>
                    <CurrencyCell
                      value={localInfo.pre65HealthcareAnnual || 12000}
                      onValueChange={v => handleChange('pre65HealthcareAnnual', v)}
                      className={compactInputStyle}
                    />
                    <span className="text-xs text-slate-500">ACA/employer premiums + copays</span>
                  </div>
                  <div>
                    <label className={compactLabelStyle}>Post-65 OOP Annual (per person)</label>
                    <CurrencyCell
                      value={localInfo.post65OOPAnnual || 2000}
                      onValueChange={v => handleChange('post65OOPAnnual', v)}
                      className={compactInputStyle}
                    />
                    <span className="text-xs text-slate-500">Copays, dental, vision beyond Medicare</span>
                  </div>
                  <div>
                    <label className={compactLabelStyle}>Medical Inflation Rate</label>
                    <PercentCell
                      value={(localInfo.medicalInflation || 0.05) * 100}
                      onChange={e => handleChange('medicalInflation', (Number(e.target.value) || 5) / 100)}
                      className={compactInputStyle}
                    />
                    <span className="text-xs text-slate-500">Typically 5-7% (above general CPI)</span>
                  </div>
                </div>
                
                {(localInfo.healthcareModel === 'moderate' || localInfo.healthcareModel === 'comprehensive' || localInfo.healthcareModel === 'custom') && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={localInfo.includeMedigap !== false}
                      onChange={e => handleChange('includeMedigap', e.target.checked)}
                      className="accent-blue-500"
                    />
                    <span className="text-xs text-slate-400">Include Medigap/supplemental insurance (~${MEDICARE_SUPPLEMENT_PREMIUM_2025}/mo in 2025)</span>
                  </div>
                )}
                
                {localInfo.healthcareModel === 'comprehensive' && (
                  <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-slate-300">Long-Term Care Modeling</span>
                      <select
                        value={localInfo.ltcModel || 'default'}
                        onChange={e => handleChange('ltcModel', e.target.value)}
                        className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
                      >
                        <option value="none">None</option>
                        <option value="default">Default (28 months, median cost)</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    {(localInfo.ltcModel === 'custom') && (
                      <div className="grid grid-cols-2 gap-3 mt-2">
                        <div>
                          <label className={compactLabelStyle}>Monthly LTC Cost</label>
                          <CurrencyCell
                            value={localInfo.ltcMonthlyAmount || 5900}
                            onValueChange={v => handleChange('ltcMonthlyAmount', v)}
                            className={compactInputStyle}
                          />
                        </div>
                        <div>
                          <label className={compactLabelStyle}>Duration (months)</label>
                          <input
                            type="number"
                            value={localInfo.ltcDurationMonths || 28}
                            onChange={e => handleChange('ltcDurationMonths', Number(e.target.value) || 28)}
                            className={compactInputStyle}
                          />
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-slate-500 mt-2">
                      Default models ${LTC_MONTHLY_ASSISTED_LIVING_2025.toLocaleString()}/mo assisted living for {LTC_DEFAULT_DURATION_MONTHS} months before death (Genworth 2024 median).
                    </p>
                  </div>
                )}
                
                <div className="p-2 bg-blue-900/20 border border-blue-800/30 rounded text-xs text-blue-300">
                  Healthcare costs are added to your retirement spending target and flow through the tax-aware withdrawal solver. 
                  IRMAA surcharges are calculated separately based on MAGI. Medicare Part B/D base premiums are included here; IRMAA adds on top.
                </div>
              </div>
            )}
          </div>
          
          {/* Recurring Expenses (Categorized) */}
          <div className="border-t border-slate-700/50 mt-5 pt-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Recurring Expenses</h4>
                <p className="text-xs text-slate-500 mt-1">Model expenses with their own time ranges and inflation rates (car payments, tuition, travel budgets, caregiving)</p>
              </div>
              <button
                onClick={() => {
                  const newId = Math.max(0, ...recurringExpenses.map(e => e.id)) + 1;
                  setRecurringExpenses(prev => [...prev, {
                    id: newId,
                    name: 'New Expense',
                    category: 'other',
                    amount: 5000,
                    startAge: personalInfo.myAge,
                    endAge: personalInfo.legacyAge || 95,
                    inflationRate: personalInfo.inflationRate,
                    owner: 'me'
                  }]);
                }}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded"
              >
                + Add Expense
              </button>
            </div>
            
            {recurringExpenses.length > 0 && (
              <div className="space-y-2">
                {recurringExpenses.map(exp => (
                  <div key={exp.id} className="grid grid-cols-12 gap-2 items-center bg-slate-800/40 rounded-lg p-2">
                    <div className="col-span-3">
                      <input
                        type="text"
                        value={exp.name}
                        onChange={e => setRecurringExpenses(prev => prev.map(ex => ex.id === exp.id ? { ...ex, name: e.target.value } : ex))}
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
                        placeholder="Expense name"
                      />
                    </div>
                    <div className="col-span-2">
                      <select
                        value={exp.category || 'other'}
                        onChange={e => setRecurringExpenses(prev => prev.map(ex => ex.id === exp.id ? { ...ex, category: e.target.value } : ex))}
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
                      >
                        {EXPENSE_CATEGORIES.map(cat => (
                          <option key={cat.value} value={cat.value}>{cat.icon} {cat.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <CurrencyCell
                        value={exp.amount}
                        onValueChange={v => setRecurringExpenses(prev => prev.map(ex => ex.id === exp.id ? { ...ex, amount: v } : ex))}
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
                      />
                    </div>
                    <div className="col-span-1">
                      <input
                        type="number"
                        value={exp.startAge}
                        onChange={e => setRecurringExpenses(prev => prev.map(ex => ex.id === exp.id ? { ...ex, startAge: Number(e.target.value) } : ex))}
                        className="w-full bg-slate-700 border border-slate-600 rounded px-1 py-1 text-xs text-slate-200 text-center"
                        title="Start age"
                      />
                    </div>
                    <div className="col-span-1 text-center text-slate-500 text-xs">to</div>
                    <div className="col-span-1">
                      <input
                        type="number"
                        value={exp.endAge}
                        onChange={e => setRecurringExpenses(prev => prev.map(ex => ex.id === exp.id ? { ...ex, endAge: Number(e.target.value) } : ex))}
                        className="w-full bg-slate-700 border border-slate-600 rounded px-1 py-1 text-xs text-slate-200 text-center"
                        title="End age"
                      />
                    </div>
                    <div className="col-span-1">
                      <PercentCell
                        value={(exp.inflationRate || 0) * 100}
                        onChange={e => setRecurringExpenses(prev => prev.map(ex => ex.id === exp.id ? { ...ex, inflationRate: (Number(e.target.value) || 0) / 100 } : ex))}
                        className="w-full bg-slate-700 border border-slate-600 rounded px-1 py-1 text-xs text-slate-200 text-center"
                        title="Inflation %"
                      />
                    </div>
                    <div className="col-span-1 text-center">
                      <button
                        onClick={() => setRecurringExpenses(prev => prev.filter(ex => ex.id !== exp.id))}
                        className="text-red-400 hover:text-red-300 text-sm"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between text-xs text-slate-400 px-2">
                  <span>Column: Name | Category | Annual $ | Start Age | → | End Age | Inflation | ✕</span>
                  <span className="text-amber-400 font-medium">
                    These add to your base retirement spending ({formatCurrency(personalInfo.desiredRetirementIncome)}/yr)
                  </span>
                </div>
              </div>
            )}
            
            {recurringExpenses.length === 0 && (
              <p className="text-xs text-slate-500 italic">
                No recurring expenses defined. Your retirement spending is based solely on the Desired Retirement Income ({formatCurrency(personalInfo.desiredRetirementIncome)}/yr) above. 
                Add expenses here for things like car payments (ages 55-60), college tuition (ages 54-58), or travel budgets (ages 65-80).
              </p>
            )}
          </div>
          
          {/* One-Time Life Events */}
          <div className="border-t border-slate-700/50 mt-5 pt-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">One-Time Life Events</h4>
                <p className="text-xs text-slate-500 mt-1">Model large expenses or income windfalls (renovations, car purchases, inheritance, downsizing)</p>
              </div>
              <button
                onClick={() => {
                  const newEvent = {
                    id: Date.now(),
                    name: 'New Event',
                    amount: 25000,
                    type: 'expense',
                    age: Math.max(localInfo.myRetirementAge, localInfo.myAge + 1),
                    owner: 'me',
                    inflationAdjusted: true
                  };
                  setOneTimeEvents(prev => [...prev, newEvent]);
                }}
                className="px-3 py-1.5 bg-amber-600/20 text-amber-400 rounded-lg text-xs font-medium hover:bg-amber-600/30 border border-amber-500/30 transition-colors"
              >
                + Add Event
              </button>
            </div>
            
            {oneTimeEvents.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-sm border border-dashed border-slate-700 rounded-lg">
                No life events configured. Click "Add Event" to model a major expense or income.
              </div>
            ) : (
              <div className="space-y-2">
                {oneTimeEvents.map(evt => (
                  <div key={evt.id} className={`flex flex-wrap items-center gap-2 p-3 rounded-lg border ${
                    evt.type === 'expense' ? 'bg-red-900/10 border-red-500/20' 
                    : evt.type === 'taxable_income' ? 'bg-green-900/10 border-green-500/20'
                    : 'bg-blue-900/10 border-blue-500/20'
                  }`}>
                    <input 
                      type="text" value={evt.name}
                      onChange={e => setOneTimeEvents(prev => prev.map(ev => ev.id === evt.id ? { ...ev, name: e.target.value } : ev))}
                      className="flex-1 min-w-[120px] bg-slate-900/80 border border-slate-600/50 rounded px-2 py-1 text-slate-100 text-sm"
                      placeholder="Event name"
                    />
                    <select 
                      value={evt.type}
                      onChange={e => setOneTimeEvents(prev => prev.map(ev => ev.id === evt.id ? { ...ev, type: e.target.value } : ev))}
                      className="bg-slate-900/80 border border-slate-600/50 rounded px-2 py-1 text-slate-100 text-xs"
                    >
                      <option value="expense">Expense</option>
                      <option value="taxable_income">Taxable Income</option>
                      <option value="nontaxable_income">Non-Taxable Income</option>
                    </select>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-500 text-xs">$</span>
                      <input 
                        type="number" value={evt.amount} min={0}
                        onChange={e => setOneTimeEvents(prev => prev.map(ev => ev.id === evt.id ? { ...ev, amount: Number(e.target.value) } : ev))}
                        className="w-24 bg-slate-900/80 border border-slate-600/50 rounded px-2 py-1 text-slate-100 text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-500 text-xs">Age</span>
                      <input 
                        type="number" value={evt.age} min={localInfo.myAge} max={110}
                        onChange={e => setOneTimeEvents(prev => prev.map(ev => ev.id === evt.id ? { ...ev, age: Number(e.target.value) } : ev))}
                        className="w-16 bg-slate-900/80 border border-slate-600/50 rounded px-2 py-1 text-slate-100 text-sm"
                      />
                    </div>
                    <select 
                      value={evt.owner || 'me'}
                      onChange={e => setOneTimeEvents(prev => prev.map(ev => ev.id === evt.id ? { ...ev, owner: e.target.value } : ev))}
                      className="bg-slate-900/80 border border-slate-600/50 rounded px-2 py-1 text-slate-100 text-xs"
                    >
                      <option value="me">My Age</option>
                      <option value="spouse">Spouse Age</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
                      <input 
                        type="checkbox" checked={evt.inflationAdjusted !== false}
                        onChange={e => setOneTimeEvents(prev => prev.map(ev => ev.id === evt.id ? { ...ev, inflationAdjusted: e.target.checked } : ev))}
                        className="w-3 h-3 rounded border-slate-600 bg-slate-800"
                      />
                      Inflation adj.
                    </label>
                    <button
                      onClick={() => setOneTimeEvents(prev => prev.filter(ev => ev.id !== evt.id))}
                      className="text-red-400 hover:text-red-300 px-1"
                      title="Delete event"
                    >
                      &#10005;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };
  const AccountsTab = () => {
    const [acctInfoOpen, setAcctInfoOpen] = useState(null);
    const [showIndividualAccounts, setShowIndividualAccounts] = useState(false);
    const [localAccounts, setLocalAccounts] = useState(accounts);
    const [dirty, setDirty] = useState(false);
    
    // Sync from parent only on add/delete (length/id change)
    const accountIds = accounts.map(a => a.id).join(',');
    useEffect(() => {
      setLocalAccounts(accounts);
      setDirty(false);
    }, [accountIds]);
    
    // Local-only update while typing
    const updateAccount = (id, field, value) => {
      setLocalAccounts(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
      setDirty(true);
    };
    
    // Save button pushes all local changes to parent
    const saveChanges = () => {
      setAccounts(localAccounts);
      setDirty(false);
    };
    
    const totalBalance = localAccounts.reduce((sum, a) => sum + a.balance, 0);
    const totalContributions = localAccounts.reduce((sum, a) => sum + a.contribution, 0);
    // Split contributions by contributor type
    const myContributions = localAccounts
      .filter(a => (a.contributor || 'me') === 'me' || (a.contributor || 'me') === 'both')
      .reduce((sum, a) => sum + a.contribution, 0);
    const employerContributions = localAccounts
      .filter(a => a.contributor === 'employer' || a.contributor === 'both')
      .reduce((sum, a) => sum + a.contribution, 0);
    
    // Savings rate: my contributions / current earned + business income (only meaningful pre-retirement)
    const currentEarnedIncome = incomeStreams
      .filter(s => {
        if (s.type !== 'earned_income' && s.type !== 'business') return false;
        const ownerAge = s.owner === 'me' ? personalInfo.myAge : personalInfo.spouseAge;
        return ownerAge >= s.startAge && ownerAge <= s.endAge;
      })
      .reduce((sum, s) => sum + s.amount, 0);
    const savingsRate = currentEarnedIncome > 0 ? (myContributions / currentEarnedIncome) * 100 : null;
    
    const maxNameWidth = Math.max(8, ...localAccounts.map(a => a.name.length + 2));
    
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-semibold text-slate-100">Investment Accounts</h3>
          <button onClick={() => { setEditingAccount(null); setShowAccountModal(true); }} className={buttonPrimary}>+ Add Account</button>
        </div>
        
        {/* Quick Edit Table */}
        <div className={cardStyle}>
          <div className="flex items-center gap-2 mb-4">
            <h4 className="text-lg font-semibold text-slate-100">Quick Edit - Balances & Contributions</h4>
            <InfoCard
              title="Accounts — Balances & Contributions"
              isOpen={acctInfoOpen === 'quickEdit'}
              onToggle={() => setAcctInfoOpen(prev => prev === 'quickEdit' ? null : 'quickEdit')}
              sections={[
                {
                  heading: 'What This Table Does',
                  body: 'This is a spreadsheet-style editor for all your retirement and investment accounts. Each row is one account. You can edit any value directly — changes save automatically when you click out of a field (on blur).'
                },
                {
                  heading: 'Column Definitions',
                  items: [
                    { icon: '📝', label: 'Account', desc: 'A descriptive name for this account (e.g., "My 401k at Fidelity"). For your reference only — doesn\'t affect calculations.' },
                    { icon: '🏷️', label: 'Type', desc: 'The tax treatment of the account. This is critical — it determines how withdrawals are taxed. Pre-tax types (401k, Traditional IRA, 403b, 457b) are taxed as ordinary income. Roth types are tax-free. Brokerage generates capital gains. HSA is tax-free for medical expenses.' },
                    { icon: '👤', label: 'Owner', desc: '"Me", "Spouse", or "Joint". Determines whose age is used for contribution periods, RMD calculations, and retirement timing.' },
                    { icon: '💁', label: 'Contributor', desc: 'Who makes the contributions — used for calculating your personal savings rate. "Employer" contributions (like a match) don\'t count toward your savings rate but do grow your balance.' },
                    { icon: '💰', label: 'Balance', desc: 'Current account balance as of today. This is your starting point — the projection grows this balance forward using contributions and the CAGR you set.' },
                    { icon: '📥', label: 'Contribution', desc: 'Annual contribution amount in today\'s dollars. Include your contribution AND any employer match as separate accounts (or combined). This is added to the balance each year during the contribution period.' },
                    { icon: '📈', label: 'Contrib +%', desc: 'Annual growth rate of your contribution amount (not the account itself). For example, if you increase contributions by 2% each year to keep pace with salary raises, enter 2.0%. Set to 0% if contributions stay flat.' },
                    { icon: '📅', label: 'Period', desc: 'The age range during which contributions are made (e.g., 45–65). Contributions stop after the end age. Typically your start age to your retirement age.' },
                    { icon: '📊', label: 'CAGR', desc: 'Compound Annual Growth Rate — the expected average annual return for this account. Stocks typically 7–10%, bonds 3–5%, savings 2–4%. This is applied to the entire balance each year after withdrawals.' }
                  ]
                },
                {
                  heading: 'Tips',
                  items: [
                    { icon: '➕', label: 'Adding Accounts', desc: 'Use the "+ Add Account" button below the table. Create separate entries for each account with different types or owners.' },
                    { icon: '🔄', label: 'Employer Match', desc: 'Enter employer matches as a separate account or add the match amount to your contribution. Either way, set the contributor to "Employer" for match-only entries so your savings rate calculates correctly.' },
                    { icon: '⚠️', label: 'Account Types Matter', desc: 'The type field has the biggest impact on your projections. A 401k vs Roth 401k with the same balance and growth will produce very different retirement outcomes because of tax treatment on withdrawals.' }
                  ],
                  tip: 'If you have both a 401k and an employer match, consider adding them as two rows: one for your personal contribution (contributor = "Me") and one for the match (contributor = "Employer"). This gives you an accurate savings rate while still modeling the full growth.'
                }
              ]}
            />
          </div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-500">Click any value to edit · Tab between fields · Click Save when done</p>
            {dirty && <button onClick={saveChanges} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium transition-colors">💾 Save Changes</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-auto">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Account</th>
                  <th className="text-left py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Type</th>
                  <th className="text-left py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Owner</th>
                  <th className="text-left py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Contributor</th>
                  <th className="text-right py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Balance</th>
                  <th className="text-right py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Contribution</th>
                  <th className="text-right py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Contrib +%</th>
                  <th className="text-center py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Period</th>
                  <th className="text-right py-3 px-1 text-slate-400 font-medium whitespace-nowrap">CAGR</th>
                  <th className="text-center py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {localAccounts.map((account, idx) => (
                  <tr key={account.id} className={`border-b border-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''}`}>
                    <td className="py-2 px-1">
                      <SpreadsheetCell
                        value={account.name}
                        onChange={e => updateAccount(account.id, 'name', e.target.value)}
                        style={{ width: `${maxNameWidth}ch` }}
                        className="bg-transparent border border-transparent rounded px-2 py-1.5 text-slate-100 font-medium focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    </td>
                    <td className="py-2 px-1">
                      <GridSelect
                        value={account.type}
                        onChange={e => updateAccount(account.id, 'type', e.target.value)}
                        className="bg-transparent border border-transparent rounded px-1 py-1.5 text-slate-300 text-sm focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors cursor-pointer"
                      >
                        {accountTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </GridSelect>
                    </td>
                    <td className="py-2 px-1">
                      <GridSelect
                        value={account.owner}
                        onChange={e => updateAccount(account.id, 'owner', e.target.value)}
                        className="bg-transparent border border-transparent rounded px-1 py-1.5 text-slate-300 text-sm focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors cursor-pointer"
                      >
                        <option value="me">Me</option>
                        <option value="spouse">Spouse</option>
                        <option value="joint">Joint</option>
                      </GridSelect>
                    </td>
                    <td className="py-2 px-1">
                      <GridSelect
                        value={account.contributor || 'me'}
                        onChange={e => updateAccount(account.id, 'contributor', e.target.value)}
                        className="bg-transparent border border-transparent rounded px-1 py-1.5 text-slate-300 text-sm focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors cursor-pointer"
                      >
                        {contributorTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </GridSelect>
                    </td>
                    <td className="py-2 px-1">
                      <CurrencyCell
                        value={account.balance}
                        onValueChange={v => updateAccount(account.id, 'balance', v)}
                        className="bg-transparent border border-transparent rounded px-2 py-1.5 text-emerald-400 font-semibold text-right w-24 focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    </td>
                    <td className="py-2 px-1">
                      <CurrencyCell
                        value={account.contribution}
                        onValueChange={v => updateAccount(account.id, 'contribution', v)}
                        className="bg-transparent border border-transparent rounded px-2 py-1.5 text-sky-400 font-semibold text-right w-20 focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    </td>
                    <td className="py-2 px-1">
                      <PercentCell
                        value={account.contributionGrowth || 0}
                        onValueChange={v => updateAccount(account.id, 'contributionGrowth', v)}
                        className="bg-transparent border border-transparent rounded px-2 py-1.5 text-cyan-400 font-semibold text-right w-16 focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    </td>
                    <td className="py-2 px-1">
                      <div className="flex items-center justify-center gap-0.5">
                        <AgeCell
                          value={account.startAge}
                          onChange={e => updateAccount(account.id, 'startAge', Number(e.target.value))}
                          className="w-12 bg-transparent border border-transparent rounded px-1 py-1.5 text-slate-300 text-center text-sm focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                        />
                        <span className="text-slate-500">-</span>
                        <AgeCell
                          value={account.stopAge}
                          onChange={e => updateAccount(account.id, 'stopAge', Number(e.target.value))}
                          className="w-12 bg-transparent border border-transparent rounded px-1 py-1.5 text-slate-300 text-center text-sm focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                        />
                      </div>
                    </td>
                    <td className="py-2 px-1">
                      <PercentCell
                        value={account.cagr}
                        onValueChange={v => updateAccount(account.id, 'cagr', v)}
                        className="bg-transparent border border-transparent rounded px-2 py-1.5 text-amber-400 font-semibold text-right w-16 focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    </td>
                    <td className="py-2 px-1 text-center">
                      <div className="flex justify-center gap-1">
                        <button tabIndex={-1} onClick={() => { setEditingAccount(account); setShowAccountModal(true); }} className="text-slate-400 hover:text-amber-400 text-sm px-1 py-1" title="Edit all details">⚙️</button>
                        <button tabIndex={-1} onClick={() => setAccounts(accounts.filter(a => a.id !== account.id))} className="text-slate-400 hover:text-red-400 text-sm px-1 py-1" title="Delete">🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-600 bg-slate-800/50">
                  <td colSpan="4" className="py-3 px-1 text-slate-300 font-semibold">Totals</td>
                  <td className="py-3 px-1 text-right text-emerald-400 font-bold">{formatCurrency(totalBalance)}</td>
                  <td className="py-3 px-1 text-right text-sky-400 font-bold">{formatCurrency(totalContributions)}</td>
                  <td colSpan="4"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        
        {/* Contributions & Savings Rate Card */}
        <div className={cardStyle}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-slate-500 text-xs mb-0.5">My Contributions</div>
                <div className="text-xl font-bold text-sky-400">{formatCurrency(myContributions)}</div>
              </div>
              {employerContributions > 0 && (
                <>
                  <div className="w-px h-10 bg-slate-700"></div>
                  <div>
                    <div className="text-slate-500 text-xs mb-0.5">Employer Contributions</div>
                    <div className="text-xl font-bold text-indigo-400">{formatCurrency(employerContributions)}</div>
                  </div>
                </>
              )}
              <div className="w-px h-10 bg-slate-700"></div>
              <div>
                <div className="text-slate-500 text-xs mb-0.5">Total Contributions</div>
                <div className="text-xl font-bold text-emerald-400">{formatCurrency(totalContributions)}</div>
              </div>
              <div className="w-px h-10 bg-slate-700"></div>
              <div>
                <div className="text-slate-500 text-xs mb-0.5">Earned + Business Income</div>
                <div className="text-xl font-bold text-emerald-400">{formatCurrency(currentEarnedIncome)}</div>
              </div>
              {savingsRate !== null && (
                <>
                  <div className="w-px h-10 bg-slate-700"></div>
                  <div>
                    <div className="text-slate-500 text-xs mb-0.5">Savings Rate</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold text-amber-400">{savingsRate.toFixed(1)}%</span>
                      <div className="w-24 h-2.5 bg-slate-700 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${savingsRate >= 50 ? 'bg-emerald-400' : savingsRate >= 25 ? 'bg-amber-400' : 'bg-sky-400'}`}
                          style={{ width: `${Math.min(savingsRate, 100)}%` }}
                        ></div>
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">Your savings only</div>
                  </div>
                </>
              )}
            </div>
            {savingsRate === null && (
              <p className="text-xs text-slate-500 italic">Add earned income streams to see savings rate</p>
            )}
          </div>
        </div>
        
        {/* Year-by-Year Account Balances Table */}
        <div className={cardStyle}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-lg font-semibold text-slate-100">Year-by-Year Account Balances</h4>
              <InfoCard
                title="Year-by-Year Account Balances"
                isOpen={acctInfoOpen === 'yearByYear'}
                onToggle={() => setAcctInfoOpen(prev => prev === 'yearByYear' ? null : 'yearByYear')}
                sections={[
                  {
                    heading: 'What This Table Shows',
                    body: 'This is the detailed output of the projection engine — one row per year from today through age 95. It shows your account balances after all transactions (contributions, withdrawals, growth) have been applied for that year, plus the key cash flow events that happened during the year.'
                  },
                  {
                    heading: 'The Balance Columns',
                    items: [
                      { color: '#10b981', label: 'Pre-Tax (Green)', desc: 'Combined balance of all pre-tax accounts (401k, Traditional IRA, 403b, 457b). These balances shrink in retirement as RMDs and spending withdrawals are taken. Every dollar withdrawn is taxed as ordinary income.' },
                      { color: '#a855f7', label: 'Roth (Purple)', desc: 'Combined balance of all Roth accounts. These grow tax-free and withdrawals are tax-free. The planner typically draws from Roth last (per your withdrawal priority), so this balance may grow well into retirement.' },
                      { color: '#38bdf8', label: 'Brokerage (Sky Blue)', desc: 'Combined taxable investment and HSA balances. Notice this column may jump UP in RMD years — that\'s excess RMD money being reinvested here after taxes.' },
                      { color: '#f59e0b', label: 'Total (Gold)', desc: 'Sum of all three account types — your total liquid investment portfolio. This is the number that needs to stay above zero through age 95.' }
                    ]
                  },
                  {
                    heading: 'The Transaction Columns',
                    items: [
                      { color: '#f87171', label: 'RMD (Red)', desc: 'Required Minimum Distribution — the amount the IRS mandates you withdraw from pre-tax accounts starting at age 72–75 (depending on birth year). This is calculated using your account balance and the IRS Uniform Lifetime Table. Shows "—" in years with no RMD.' },
                      { color: '#fb923c', label: 'Withdrawal (Orange)', desc: 'Total portfolio withdrawal for the year — the gross amount taken from your accounts to fund spending (after accounting for guaranteed income). This includes the RMD if it covers part of your spending need, plus any additional withdrawal beyond the RMD.' },
                      { color: '#22d3ee', label: 'Excess → Brok (Cyan)', desc: 'When your RMD exceeds what you need for spending, the surplus is "excess RMD." You must withdraw it (and pay taxes on it), but the after-tax remainder gets reinvested into your brokerage account. This is why brokerage balances sometimes grow during RMD years.' }
                    ]
                  },
                  {
                    heading: 'Row Highlighting',
                    items: [
                      { icon: '🟧', label: 'Orange-tinted rows', desc: 'Years where RMDs are active. These rows have a subtle orange background to help you quickly identify when mandatory distributions begin and how they affect your balances.' },
                      { icon: '📅', label: 'Year & Age', desc: 'The calendar year and your age. Use the age column to quickly find key milestones — retirement age, Social Security start, RMD start, etc.' }
                    ]
                  },
                  {
                    heading: 'How to Use This Table',
                    body: 'Scan the Total column to see if your portfolio stays positive through age 95. Watch for the transition from growth (pre-retirement, balances climbing) to drawdown (post-retirement, balances declining). The rate of decline tells you how sustainable your plan is.',
                    tip: 'Pay special attention to the "Excess → Brok" column. Large excess RMDs mean your pre-tax accounts may be too heavily weighted — Roth conversions before retirement could reduce these forced withdrawals and the associated tax hit. If you see consistent excess RMDs, it may be worth exploring conversion strategies.'
                  }
                ]}
              />
            </div>
            {/* Aggregated / Individual toggle */}
            <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700 gap-0.5">
              <button
                onClick={() => setShowIndividualAccounts(false)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  !showIndividualAccounts
                    ? 'bg-slate-600 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                By Type
              </button>
              <button
                onClick={() => setShowIndividualAccounts(true)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  showIndividualAccounts
                    ? 'bg-slate-600 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                By Account
              </button>
            </div>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            {showIndividualAccounts
              ? 'Individual account balances year-by-year — each column is one account, useful for cross-checking against other planning tools.'
              : 'Detailed projection showing contributions, RMDs, withdrawals, and excess RMD transfers to brokerage. Balances shown are end-of-year after all transactions and growth.'}
          </p>

          {showIndividualAccounts ? (() => {
            // Stable color palette per account index
            const acctColors = [
              '#34d399','#a78bfa','#38bdf8','#fb923c','#f472b6',
              '#facc15','#818cf8','#4ade80','#f87171','#22d3ee'
            ];
            const colorFor = (idx) => acctColors[idx % acctColors.length];
            const typeLabel = (type) => ({
              '401k':'401k','traditional_ira':'Trad IRA','457b':'457b','403b':'403b',
              'roth_401k':'Roth 401k','roth_ira':'Roth IRA','roth_457b':'Roth 457b','roth_403b':'Roth 403b',
              'brokerage':'Brokerage','hsa':'HSA'
            }[type] || type);
            return (
              <>
                <div className="overflow-x-auto max-h-[500px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-900 z-10">
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-2 px-2 text-slate-400 font-medium whitespace-nowrap">Year</th>
                        <th className="text-center py-2 px-2 text-slate-400 font-medium">Age</th>
                        {accounts.map((acct, i) => (
                          <th key={acct.id} className="text-right py-2 px-2 font-medium whitespace-nowrap" style={{ color: colorFor(i) }}>
                            {acct.name}
                            <div className="text-slate-500 font-normal text-xs">{typeLabel(acct.type)}{acct.owner === 'spouse' ? ' · spouse' : ''} · {(acct.cagr * 100).toFixed(1)}%</div>
                          </th>
                        ))}
                        <th className="text-right py-2 px-2 text-amber-400 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projections.filter((_, idx) => idx <= 50).map((p, idx) => {
                        const hasRMD = p.rmd > 0;
                        return (
                          <tr key={p.year} className={`border-b border-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''} ${hasRMD ? 'bg-orange-900/10' : ''}`}>
                            <td className="py-1.5 px-2 text-slate-300">{p.year}</td>
                            <td className="py-1.5 px-2 text-center text-slate-400">{p.myAge}</td>
                            {accounts.map((acct, i) => {
                              const bal = (p.perAccountBalances || {})[acct.id] || 0;
                              return (
                                <td key={acct.id} className="py-1.5 px-2 text-right font-mono" style={{ color: bal > 0 ? colorFor(i) : '#475569' }}>
                                  {bal > 0 ? formatCurrency(bal) : '—'}
                                </td>
                              );
                            })}
                            <td className="py-1.5 px-2 text-right text-amber-400 font-mono font-semibold">{formatCurrency(p.totalPortfolio)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex flex-wrap gap-4 text-xs">
                  {accounts.map((acct, i) => (
                    <div key={acct.id} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded" style={{ background: colorFor(i) }}></div>
                      <span className="text-slate-400">{acct.name} <span className="text-slate-500">({typeLabel(acct.type)})</span></span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 p-3 bg-slate-800/50 rounded-lg">
                  <p className="text-xs text-slate-400">
                    <strong className="text-slate-300">By Account view:</strong> Each column tracks one account independently. Balances reflect end-of-year values after contributions, withdrawals, RMDs, Roth conversions, and growth. When an account is fully depleted it shows "—". The Total column matches the aggregated view.
                  </p>
                </div>
              </>
            );
          })() : (
            <>
              <div className="overflow-x-auto max-h-[500px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900 z-10">
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 px-2 text-slate-400 font-medium">Year</th>
                      <th className="text-center py-2 px-2 text-slate-400 font-medium">Age</th>
                      <th className="text-right py-2 px-2 text-emerald-400 font-medium">Pre-Tax</th>
                      <th className="text-right py-2 px-2 text-purple-400 font-medium">Roth</th>
                      <th className="text-right py-2 px-2 text-sky-400 font-medium">Brokerage</th>
                      <th className="text-right py-2 px-2 text-amber-400 font-medium">Total</th>
                      <th className="text-right py-2 px-2 text-red-400 font-medium">RMD</th>
                      <th className="text-right py-2 px-2 text-orange-400 font-medium">Withdrawal</th>
                      <th className="text-right py-2 px-2 text-cyan-400 font-medium">Excess → Brok</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projections.filter((p, idx) => idx <= 50).map((p, idx) => {
                      const hasRMD = p.rmd > 0;
                      const hasExcess = p.excessRMD > 0;
                      return (
                        <tr
                          key={p.year}
                          className={`border-b border-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''} ${hasRMD ? 'bg-orange-900/10' : ''}`}
                        >
                          <td className="py-1.5 px-2 text-slate-300">{p.year}</td>
                          <td className="py-1.5 px-2 text-center text-slate-400">{p.myAge}</td>
                          <td className="py-1.5 px-2 text-right text-emerald-400 font-mono">{formatCurrency(p.preTaxBalance)}</td>
                          <td className="py-1.5 px-2 text-right text-purple-400 font-mono">{formatCurrency(p.rothBalance)}</td>
                          <td className="py-1.5 px-2 text-right text-sky-400 font-mono">{formatCurrency(p.brokerageBalance)}</td>
                          <td className="py-1.5 px-2 text-right text-amber-400 font-mono font-semibold">{formatCurrency(p.totalPortfolio)}</td>
                          <td className={`py-1.5 px-2 text-right font-mono ${hasRMD ? 'text-red-400' : 'text-slate-600'}`}>
                            {hasRMD ? formatCurrency(p.rmd) : '—'}
                          </td>
                          <td className={`py-1.5 px-2 text-right font-mono ${p.portfolioWithdrawal > 0 ? 'text-orange-400' : 'text-slate-600'}`}>
                            {p.portfolioWithdrawal > 0 ? formatCurrency(p.portfolioWithdrawal) : '—'}
                          </td>
                          <td className={`py-1.5 px-2 text-right font-mono ${hasExcess ? 'text-cyan-400' : 'text-slate-600'}`}>
                            {hasExcess ? formatCurrency(p.excessRMD) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-emerald-400"></div>
                  <span className="text-slate-400">Pre-Tax (401k, Trad IRA, 457b)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-purple-400"></div>
                  <span className="text-slate-400">Roth Accounts</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-sky-400"></div>
                  <span className="text-slate-400">Brokerage</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-red-400"></div>
                  <span className="text-slate-400">Required Minimum Distribution</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-cyan-400"></div>
                  <span className="text-slate-400">Excess RMD → Brokerage (after tax)</span>
                </div>
              </div>
              <div className="mt-3 p-3 bg-slate-800/50 rounded-lg">
                <p className="text-xs text-slate-400">
                  <strong className="text-slate-300">How to read this table:</strong> RMDs begin at age 75 and are withdrawn from pre-tax accounts.
                  If the RMD exceeds your spending needs, the excess (after paying taxes) is transferred to your brokerage account.
                  The "Withdrawal" column shows total portfolio withdrawals needed to meet your desired income.
                  When RMD &gt; Withdrawal needed, the difference becomes "Excess → Brok".
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };
  
  const AssetsTab = () => {
    const [assetInfoOpen, setAssetInfoOpen] = useState(false);
    const [localAssets, setLocalAssets] = useState(assets);
    const [dirtyAssets, setDirtyAssets] = useState(false);
    
    const assetIds = assets.map(a => a.id).join(',');
    useEffect(() => {
      setLocalAssets(assets);
      setDirtyAssets(false);
    }, [assetIds]);
    
    const updateAsset = (id, field, value) => {
      setLocalAssets(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
      setDirtyAssets(true);
    };
    const saveAssetChanges = () => {
      setAssets(localAssets);
      setDirtyAssets(false);
    };
    
    const totalAssetValue = assets.reduce((sum, a) => sum + a.value, 0);
    const totalDebt = assets.reduce((sum, a) => sum + (a.mortgage || 0), 0);
    const totalEquity = totalAssetValue - totalDebt;
    const maxNameWidth = Math.max(8, ...localAssets.map(a => a.name.length + 2));
    
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-xl font-semibold text-slate-100">Non-Liquid Assets</h3>
            <p className="text-sm text-slate-400">Real estate, business ownership, vehicles, and other assets for legacy planning. These don't affect cash flow projections.</p>
          </div>
          <button onClick={() => { setEditingAsset(null); setShowAssetModal(true); }} className={buttonPrimary}>+ Add Asset</button>
        </div>
        
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-0.5">Total Asset Value</div>
            <div className="text-xl font-bold text-emerald-400">{formatCurrency(totalAssetValue)}</div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-0.5">Outstanding Debt</div>
            <div className="text-xl font-bold text-red-400">{formatCurrency(totalDebt)}</div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-0.5">Net Equity</div>
            <div className="text-xl font-bold text-amber-400">{formatCurrency(totalEquity)}</div>
          </div>
        </div>
        
        {/* Quick Edit Table */}
        <div className={cardStyle}>
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
            <h4 className="text-lg font-semibold text-slate-100">Quick Edit - Assets</h4>
            <InfoCard
              title="Non-Liquid Assets"
              isOpen={assetInfoOpen}
              onToggle={() => setAssetInfoOpen(prev => !prev)}
              sections={[
                {
                  heading: 'What This Table Does',
                  body: 'This tracks your non-liquid assets — things that have value but aren\'t retirement investment accounts. These contribute to your net worth but generally aren\'t used to fund retirement spending directly. Think of them as the "other" side of your balance sheet.'
                },
                {
                  heading: 'Column Definitions',
                  items: [
                    { icon: '📝', label: 'Asset Name', desc: 'A descriptive name (e.g., "Primary Home", "Rental Property", "2022 Toyota"). For your reference only.' },
                    { icon: '🏷️', label: 'Type', desc: 'Category of asset: Real Estate, Vehicle, Business Equity, or Other. Currently used for labeling — all types appreciate at the rate you specify.' },
                    { icon: '💰', label: 'Value', desc: 'Current market value of the asset as of today. For real estate, use a realistic estimate of what it would sell for, not the purchase price.' },
                    { icon: '📈', label: 'Apprec.', desc: 'Annual appreciation rate. Real estate typically 2–4%, vehicles -10–15% (depreciation — enter as negative), businesses vary widely. This rate is applied each year to project future value.' },
                    { icon: '🏦', label: 'Debt', desc: 'Outstanding debt against this asset (mortgage balance, auto loan, etc.). This is subtracted from the value to calculate your equity.' },
                    { icon: '📅', label: 'Payoff', desc: 'The age at which the debt will be fully paid off. After this age, the full asset value counts as equity. For a 30-year mortgage, calculate your age when the last payment is made.' },
                    { icon: '✅', label: 'Equity', desc: 'Calculated automatically: Value minus Debt. This is your actual ownership stake and what contributes to your net worth.' }
                  ]
                },
                {
                  heading: 'How Assets Affect Your Plan',
                  items: [
                    { icon: '📊', label: 'Net Worth', desc: 'Assets (net of debt) are added to your portfolio value in the Net Worth Projection chart. They appear as the pink "Non-Liquid Assets" layer.' },
                    { icon: '⚠️', label: 'Not Spendable', desc: 'Unlike retirement accounts, these assets are NOT used to fund retirement withdrawals. You can\'t easily spend your house equity for groceries (without selling it or taking a reverse mortgage).' },
                    { icon: '🏠', label: 'Legacy Value', desc: 'Assets do contribute to your "Legacy at 95" number — they represent what you\'d leave to heirs even if your portfolio is depleted.' }
                  ],
                  tip: 'For vehicles, use a negative appreciation rate to model depreciation (e.g., -12% per year). For a home you plan to sell in retirement, you might model it here and then adjust your income streams to reflect the proceeds at the planned sale age.'
                }
              ]}
            />
            </div>
            {dirtyAssets && <button onClick={saveAssetChanges} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium transition-colors">💾 Save Changes</button>}
          </div>
          <p className="text-xs text-slate-500 mb-4">Click any value to edit · Tab between fields · Click Save when done</p>
          <div className="overflow-x-auto">
            <table className="w-auto">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Asset Name</th>
                  <th className="text-left py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Type</th>
                  <th className="text-right py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Value</th>
                  <th className="text-right py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Apprec.</th>
                  <th className="text-right py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Debt</th>
                  <th className="text-right py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Payoff</th>
                  <th className="text-right py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Equity</th>
                  <th className="text-center py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {localAssets.map((asset, idx) => (
                  <tr key={asset.id} className={`border-b border-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''}`}>
                    <td className="py-2 px-1">
                      <SpreadsheetCell
                        value={asset.name}
                        onChange={e => updateAsset(asset.id, 'name', e.target.value)}
                        style={{ width: `${maxNameWidth}ch` }}
                        className="bg-transparent border border-transparent rounded px-2 py-1.5 text-slate-100 font-medium focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    </td>
                    <td className="py-2 px-1">
                      <GridSelect
                        value={asset.type}
                        onChange={e => updateAsset(asset.id, 'type', e.target.value)}
                        className="bg-transparent border border-transparent rounded px-1 py-1.5 text-slate-300 text-sm focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors cursor-pointer"
                      >
                        {assetTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </GridSelect>
                    </td>
                    <td className="py-2 px-1 text-right">
                      <CurrencyCell
                        value={asset.value}
                        onValueChange={v => updateAsset(asset.id, 'value', v)}
                        className="bg-transparent border border-transparent rounded px-2 py-1.5 text-emerald-400 font-semibold text-right w-24 focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    </td>
                    <td className="py-2 px-1 text-right">
                      <PercentCell
                        value={asset.appreciationRate}
                        onValueChange={v => updateAsset(asset.id, 'appreciationRate', v)}
                        className={`bg-transparent border border-transparent rounded px-1 py-1.5 font-medium text-right w-12 focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors ${asset.appreciationRate >= 0 ? 'text-green-400' : 'text-red-400'}`}
                      />
                    </td>
                    <td className="py-2 px-1 text-right">
                      <CurrencyCell
                        value={asset.mortgage || 0}
                        onValueChange={v => updateAsset(asset.id, 'mortgage', v)}
                        className="bg-transparent border border-transparent rounded px-2 py-1.5 text-red-400 font-medium text-right w-24 focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    </td>
                    <td className="py-2 px-1 text-right">
                      <AgeCell
                        value={asset.mortgagePayoffAge || ''}
                        onChange={e => updateAsset(asset.id, 'mortgagePayoffAge', e.target.value ? Number(e.target.value.replace(/[^0-9]/g, '')) : null)}
                        placeholder="—"
                        className="bg-transparent border border-transparent rounded px-1 py-1.5 text-slate-400 text-center w-12 focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    </td>
                    <td className="py-2 px-1 text-right text-amber-400 font-semibold whitespace-nowrap">
                      {formatCurrency(asset.value - (asset.mortgage || 0))}
                    </td>
                    <td className="py-2 px-1 text-center">
                      <div className="flex justify-center gap-1">
                        <button tabIndex={-1} onClick={() => { setEditingAsset(asset); setShowAssetModal(true); }} className="text-slate-400 hover:text-amber-400 text-sm px-1 py-1" title="Edit all details">⚙️</button>
                        <button tabIndex={-1} onClick={() => setAssets(assets.filter(a => a.id !== asset.id))} className="text-slate-400 hover:text-red-400 text-sm px-1 py-1" title="Delete">🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-600 bg-slate-800/50">
                  <td colSpan="2" className="py-3 px-1 text-slate-300 font-semibold">Totals</td>
                  <td className="py-3 px-1 text-right text-emerald-400 font-bold">{formatCurrency(totalAssetValue)}</td>
                  <td></td>
                  <td className="py-3 px-1 text-right text-red-400 font-bold">{formatCurrency(totalDebt)}</td>
                  <td></td>
                  <td className="py-3 px-1 text-right text-amber-400 font-bold">{formatCurrency(totalEquity)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        
        <div className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-lg">
          <p className="text-sm text-slate-400">
            💡 <strong>Note:</strong> Non-liquid assets are included in your Total Net Worth on the Dashboard but do not affect retirement cash flow calculations. 
            They're useful for legacy planning and tracking overall wealth. Mortgages are assumed to pay down linearly until the payoff age.
          </p>
        </div>
      </div>
    );
  };
  
  // Income Streams Tab with integrated detailed projections table
  const IncomeStreamsTab = () => {
    const [incomeInfoOpen, setIncomeInfoOpen] = useState(false);
    const [localIncomes, setLocalIncomes] = useState(incomeStreams);
    const [dirtyIncomes, setDirtyIncomes] = useState(false);
    
    const incomeIds = incomeStreams.map(i => i.id).join(',');
    useEffect(() => {
      setLocalIncomes(incomeStreams);
      setDirtyIncomes(false);
    }, [incomeIds]);
    
    const updateIncome = (id, field, value) => {
      setLocalIncomes(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i));
      setDirtyIncomes(true);
    };
    const saveIncomeChanges = () => {
      setIncomeStreams(localIncomes);
      setDirtyIncomes(false);
    };
    
    const totalAnnualIncome = incomeStreams.reduce((sum, i) => sum + i.amount, 0);
    const maxNameWidth = Math.max(8, ...localIncomes.map(i => i.name.length + 2));
    
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-semibold text-slate-100">Income Streams</h3>
          <button onClick={() => { setEditingIncome(null); setShowIncomeModal(true); }} className={buttonPrimary}>+ Add Income Stream</button>
        </div>
        
        {/* Quick Edit Table */}
        <div className={cardStyle}>
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
            <h4 className="text-lg font-semibold text-slate-100">Quick Edit - Income Streams</h4>
            <InfoCard
              title="Income Streams"
              isOpen={incomeInfoOpen}
              onToggle={() => setIncomeInfoOpen(prev => !prev)}
              sections={[
                {
                  heading: 'What This Table Does',
                  body: 'This defines all your income sources — both current (like salary) and future (like Social Security and pensions). Each row is a stream of income that starts and stops at specific ages. The planner uses these to calculate how much of your retirement spending is covered by guaranteed income vs. portfolio withdrawals.'
                },
                {
                  heading: 'Column Definitions',
                  items: [
                    { icon: '📝', label: 'Name', desc: 'A descriptive label (e.g., "My Social Security", "John\'s Pension", "Part-time Consulting"). For your reference only.' },
                    { icon: '🏷️', label: 'Type', desc: 'The category of income. This affects how the planner treats it for tax calculations: Earned Income is subject to payroll taxes and signals you\'re still working. Social Security uses special IRS taxation rules (only 50–85% may be taxable). Pension and Other Income are taxed as ordinary income.' },
                    { icon: '👤', label: 'Owner', desc: '"Me" or "Spouse". Determines whose age triggers the start/stop of this income stream. Critical for Social Security where each spouse has their own benefit and claiming age.' },
                    { icon: '💰', label: 'Amount', desc: 'Annual income in today\'s dollars. For Social Security, enter your estimated annual benefit at the claiming age you plan to use (check ssa.gov for your estimate). For salary, enter your current annual gross pay.' },
                    { icon: '📈', label: 'COLA', desc: 'Cost-of-Living Adjustment — the annual percentage increase for this income. Social Security typically gets 2–3% COLA. Pensions may have 0–2%. Salary might grow 2–4%. This compounds each year from the start age.' },
                    { icon: '📅', label: 'Ages', desc: 'The start and end ages for this income. Social Security: typically 62–95 (or your chosen claiming age). Salary: current age to retirement age. Pension: pension start age to 95. Set end age to 95 for lifetime income.' }
                  ]
                },
                {
                  heading: 'Income Types Explained',
                  items: [
                    { icon: '💼', label: 'Earned Income', desc: 'Salary, wages, or self-employment income. Having earned income tells the planner you\'re still working — it won\'t draw from your portfolio during these years (except for RMDs if applicable). Subject to payroll taxes.' },
                    { icon: '🏛️', label: 'Social Security', desc: 'Your SS benefit. Taxed differently than other income: depending on your total income, 0%, 50%, or up to 85% of your benefit may be subject to federal income tax. The planner handles this automatically using IRS combined income thresholds.' },
                    { icon: '📋', label: 'Pension', desc: 'Defined-benefit pension payments. Fully taxed as ordinary income. If your pension has a COLA provision, enter the annual adjustment rate.' },
                    { icon: '📦', label: 'Other Income', desc: 'Catch-all for rental income, annuity payments, part-time work in retirement, royalties, etc. Taxed as ordinary income.' }
                  ]
                },
                {
                  heading: 'Tips',
                  items: [
                    { icon: '🔑', label: 'Social Security Claiming Age', desc: 'The start age for SS has a huge impact. Benefits are permanently reduced ~6–7% per year before Full Retirement Age (66–67) and increase 8% per year from FRA to age 70. The planner applies these adjustments automatically based on your birth year.' },
                    { icon: '👫', label: 'Spousal Benefits', desc: 'Add separate income streams for each spouse\'s Social Security, pension, etc. Set the owner field to match. The planner uses each person\'s age independently.' },
                    { icon: '📊', label: 'Impact on Dashboard', desc: 'These income streams flow directly into the "Retirement Income" summary card, the stacked bars in the Income vs Spending chart, and the Cash Flow Sankey diagram. They determine how much the planner needs to pull from your portfolio.' }
                  ],
                  tip: 'Not sure about your Social Security amount? Visit ssa.gov/myaccount to get your personalized estimate. Enter the amount for the age you plan to claim — the planner will apply the correct early/delayed claiming adjustments.'
                }
              ]}
            />
            </div>
            {dirtyIncomes && <button onClick={saveIncomeChanges} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-medium transition-colors">💾 Save Changes</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-auto">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Name</th>
                  <th className="text-left py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Type</th>
                  <th className="text-left py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Owner</th>
                  <th className="text-right py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Amount</th>
                  <th className="text-right py-3 px-1 text-slate-400 font-medium whitespace-nowrap">COLA</th>
                  <th className="text-center py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Ages</th>
                  <th className="text-center py-3 px-1 text-slate-400 font-medium whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {localIncomes.map((stream, idx) => (
                  <tr key={stream.id} className={`border-b border-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''}`}>
                    <td className="py-2 px-1">
                      <SpreadsheetCell
                        value={stream.name}
                        onChange={e => updateIncome(stream.id, 'name', e.target.value)}
                        style={{ width: `${maxNameWidth}ch` }}
                        className="bg-transparent border border-transparent rounded px-2 py-1.5 text-slate-100 font-medium focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    </td>
                    <td className="py-2 px-1">
                      <GridSelect
                        value={stream.type}
                        onChange={e => updateIncome(stream.id, 'type', e.target.value)}
                        className="bg-transparent border border-transparent rounded px-1 py-1.5 text-slate-300 text-sm focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors cursor-pointer"
                      >
                        {incomeTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </GridSelect>
                    </td>
                    <td className="py-2 px-1">
                      <GridSelect
                        value={stream.owner}
                        onChange={e => updateIncome(stream.id, 'owner', e.target.value)}
                        className="bg-transparent border border-transparent rounded px-1 py-1.5 text-slate-300 text-sm focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors cursor-pointer"
                      >
                        <option value="me">Me</option>
                        <option value="spouse">Spouse</option>
                      </GridSelect>
                    </td>
                    <td className="py-2 px-1">
                      <CurrencyCell
                        value={stream.amount}
                        onValueChange={v => updateIncome(stream.id, 'amount', v)}
                        className="bg-transparent border border-transparent rounded px-2 py-1.5 text-emerald-400 font-semibold text-right w-20 focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    </td>
                    <td className="py-2 px-1">
                      <PercentCell
                        value={stream.cola}
                        onValueChange={v => updateIncome(stream.id, 'cola', v)}
                        className="bg-transparent border border-transparent rounded px-2 py-1.5 text-sky-400 font-semibold text-right w-16 focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    </td>
                    <td className="py-2 px-1">
                      <div className="flex items-center justify-center gap-0.5">
                        <AgeCell
                          value={stream.startAge}
                          onChange={e => updateIncome(stream.id, 'startAge', Number(e.target.value))}
                          className="w-12 bg-transparent border border-transparent rounded px-1 py-1.5 text-amber-400 font-medium text-center text-sm focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                        />
                        <span className="text-slate-500">-</span>
                        <AgeCell
                          value={stream.endAge}
                          onChange={e => updateIncome(stream.id, 'endAge', Number(e.target.value))}
                          className="w-12 bg-transparent border border-transparent rounded px-1 py-1.5 text-amber-400 font-medium text-center text-sm focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                        />
                      </div>
                    </td>
                    <td className="py-2 px-1 text-center">
                      <div className="flex justify-center gap-1">
                        <button tabIndex={-1} onClick={() => { setEditingIncome(stream); setShowIncomeModal(true); }} className="text-slate-400 hover:text-amber-400 text-sm px-1 py-1" title="Edit all details">⚙️</button>
                        <button tabIndex={-1} onClick={() => setIncomeStreams(incomeStreams.filter(i => i.id !== stream.id))} className="text-slate-400 hover:text-red-400 text-sm px-1 py-1" title="Delete">🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-600 bg-slate-800/50">
                  <td colSpan="3" className="py-3 px-1 text-slate-300 font-semibold">Total Annual Income</td>
                  <td className="py-3 px-1 text-right text-emerald-400 font-bold">{formatCurrency(totalAnnualIncome)}</td>
                  <td colSpan="3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        
      </div>
    );
  };
  
  const DetailedTableTab = () => {
    const [tableStartAge, setTableStartAge] = useState(personalInfo.myRetirementAge);
    const tableData = projections.filter(p => p.myAge >= tableStartAge && p.myAge <= Math.min(tableStartAge + 30, personalInfo.legacyAge || 95));
    const charitablePercent = personalInfo.charitableGivingPercent || 0;
    
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <h3 className="text-xl font-semibold text-slate-100">Detailed Annual Projections</h3>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-400">Starting Age:</label>
            <input type="number" value={tableStartAge} onChange={e => setTableStartAge(Number(e.target.value))} className="w-20 bg-slate-900 border border-slate-600 rounded px-3 py-1 text-slate-100" />
          </div>
        </div>
        <div className={`${cardStyle} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-3 px-2 text-slate-400 font-medium">Age</th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">Year</th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">Desired Income</th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">Social Security</th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">Pension</th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">Other Income</th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">Portfolio Draw</th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">RMD</th>
                <th className="text-right py-3 px-2 text-emerald-400 font-medium">QCD</th>
                <th className="text-right py-3 px-2 text-purple-400 font-medium">Roth Conv.</th>
                <th className="text-right py-3 px-2 text-amber-400 font-medium">Taxable Income</th>
                <th className="text-right py-3 px-2 text-amber-400 font-medium">MAGI</th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">Federal Tax</th>
                <th className="text-right py-3 px-2 text-amber-400 font-medium">State Taxable</th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">State Tax</th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">FICA</th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">IRMAA</th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">Net Income</th>
                <th className="text-right py-3 px-2 text-slate-400 font-medium">Portfolio</th>
              </tr>
            </thead>
            <tbody>
              {tableData.map((row, idx) => (
                <tr key={row.year} className={`border-b border-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''} ${row.qcd > 0 ? 'bg-emerald-900/10' : ''} ${row.rothConversion > 0 ? 'bg-purple-900/10' : ''} ${row.survivorEvent ? 'bg-red-900/15 border-red-500/30' : ''} ${row.oneTimeEvents?.length ? 'bg-amber-900/10' : ''}`}>
                  <td className="py-2 px-2 text-slate-100 font-medium">
                    {row.myAge}
                    {row.survivorEvent === 'spouse_died' && <span title="Spouse passed" className="ml-1">🕊️</span>}
                    {row.survivorEvent === 'primary_died' && <span title="Primary passed" className="ml-1">🕊️</span>}
                    {row.effectiveFilingStatus === 'single' && <span title="Filing as Single" className="ml-1 text-xs text-red-400">(S)</span>}
                  </td>
                  <td className="py-2 px-2 text-right text-slate-300">{row.year}</td>
                  <td className="py-2 px-2 text-right text-amber-400">
                    {formatCurrency(row.desiredIncome)}
                    {row.healthcareExpense > 0 && <div className="text-xs text-pink-400" title="Healthcare costs">+{formatCurrency(row.healthcareExpense)} HC</div>}
                    {row.recurringExpenses > 0 && <div className="text-xs text-cyan-400" title="Recurring expenses">+{formatCurrency(row.recurringExpenses)} RE</div>}
                    {row.oneTimeExpense > 0 && <div className="text-xs text-red-400">+{formatCurrency(row.oneTimeExpense)}</div>}
                  </td>
                  <td className="py-2 px-2 text-right text-blue-400">
                    {formatCurrency(row.socialSecurity)}
                    {row.ssEarningsTestReduction > 0 && <div className="text-xs text-red-400" title="SS reduced by earnings test">-{formatCurrency(row.ssEarningsTestReduction)} ET</div>}
                  </td>
                  <td className="py-2 px-2 text-right text-purple-400">{formatCurrency(row.pension)}</td>
                  <td className="py-2 px-2 text-right text-cyan-400">{formatCurrency(row.otherIncome)}</td>
                  <td className="py-2 px-2 text-right text-yellow-400">{formatCurrency(row.portfolioWithdrawal)}</td>
                  <td className="py-2 px-2 text-right text-orange-400">{row.rmd > 0 ? formatCurrency(row.rmd) : '—'}</td>
                  <td className="py-2 px-2 text-right text-emerald-400 font-medium">{row.qcd > 0 ? formatCurrency(row.qcd) : '—'}</td>
                  <td className="py-2 px-2 text-right text-purple-400 font-medium">{row.rothConversion > 0 ? formatCurrency(row.rothConversion) : '—'}</td>
                  <td className="py-2 px-2 text-right text-amber-400">{formatCurrency(row.taxableIncome)}</td>
                  <td className="py-2 px-2 text-right text-amber-400">{formatCurrency(row.magi)}</td>
                  <td className="py-2 px-2 text-right text-red-400">({formatCurrency(row.federalTax)})</td>
                  <td className="py-2 px-2 text-right text-amber-400">{formatCurrency(row.stateTaxableIncome)}</td>
                  <td className="py-2 px-2 text-right text-red-400">({formatCurrency(row.stateTax)})</td>
                  <td className="py-2 px-2 text-right text-red-400">{row.ficaTax > 0 ? `(${formatCurrency(row.ficaTax)})` : '—'}</td>
                  <td className="py-2 px-2 text-right text-red-400">{row.irmaaSurcharge > 0 ? `(${formatCurrency(row.irmaaSurcharge)})` : '—'}</td>
                  <td className="py-2 px-2 text-right text-emerald-400 font-medium">{formatCurrency(row.netIncome)}</td>
                  <td className="py-2 px-2 text-right text-slate-300">{formatCurrency(row.totalPortfolio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {charitablePercent > 0 && (
          <div className="p-3 bg-emerald-900/20 border border-emerald-700/30 rounded-lg">
            <p className="text-sm text-emerald-300">
              <strong>💡 QCD Active ({charitablePercent}% charitable giving):</strong> Starting at age 70, your charitable giving is fulfilled via Qualified Charitable Distributions from your IRA. 
              QCD amounts are excluded from taxable income, reducing your tax burden while still allowing the standard deduction.
            </p>
          </div>
        )}
        {(personalInfo.rothConversionAmount || 0) > 0 && (
          <div className="p-3 bg-purple-900/20 border border-purple-700/30 rounded-lg">
            <p className="text-sm text-purple-300">
              <strong>🔄 Roth Conversions Active ({formatCurrency(personalInfo.rothConversionAmount)}/yr, ages {personalInfo.rothConversionStartAge ?? 65}–{personalInfo.rothConversionEndAge ?? 74}):</strong> Purple-highlighted rows show years where conversions execute. The converted amount increases taxable income (and federal/state tax) that year but shifts assets to tax-free Roth growth. Watch the "Portfolio" column — pre-tax balance decreases while Roth balance grows, reducing future RMDs.
            </p>
          </div>
        )}
      </div>
    );
  };
  
  
  const TaxYearSnapshot = ({ projections, personalInfo, cardStyle, formatCurrency }) => {
    const [selectedAge, setSelectedAge] = useState(personalInfo.myAge);
    const p = projections.find(pr => pr.myAge === selectedAge);
    if (!p) return null;
    
    const yearsFromNow = selectedAge - personalInfo.myAge;
    const inflationFactor = Math.pow(1 + personalInfo.inflationRate, yearsFromNow);
    
    // ── ALL VALUES READ FROM UNIFIED ENGINE ──────────────────────────────────────
    const rothConversion = p.rothConversion || 0;
    const filingStatus = p.filingStatus || personalInfo.filingStatus;
    const preTaxDeduction = p.preTaxDeduction || 0;
    const taxableIncome = p.taxableIncome || 0;       // Federal AGI (after pre-tax deduction, before std deduction)
    const magi = p.magi || 0;
    const stateTaxableIncome = p.stateTaxableIncome || 0;
    const irmaaSurcharge = p.irmaaSurcharge || 0;
    const taxableSS = p.taxableSS || 0;
    const ssPct = p.socialSecurity > 0 ? Math.round(taxableSS / p.socialSecurity * 100) : 0;
    
    // Derived values for display (not recalculating taxes — just for the breakdown layout)
    const nonSSIncome = p.nonSSIncome || (p.earnedIncome + p.pension + p.otherIncome + p.portfolioWithdrawal + rothConversion - (p.qcd || 0));
    const grossTaxableIncome = nonSSIncome + taxableSS;
    const agiAfterContribs = grossTaxableIncome - preTaxDeduction;
    
    // Standard deduction (for display in breakdown)
    const baseDeduction = STANDARD_DEDUCTION_2026[filingStatus] || STANDARD_DEDUCTION_2026.single;
    const adjDeduction = Math.round(baseDeduction * inflationFactor);
    
    // Federal taxable income after standard deduction (for bracket walk-through)
    const federalTaxableIncome = Math.max(0, taxableIncome - adjDeduction);
    
    // SS combined income calculation for display
    const combinedIncome = nonSSIncome + p.socialSecurity * 0.5;
    const ssThreshold1 = filingStatus === 'married_joint' ? 32000 : 25000;
    const ssThreshold2 = filingStatus === 'married_joint' ? 44000 : 34000;
    
    // ── BRACKET WALK-THROUGH (display logic only — not recalculating tax) ────────
    const baseBrackets = FEDERAL_TAX_BRACKETS_2026[filingStatus] || FEDERAL_TAX_BRACKETS_2026.single;
    const bracketDetails = [];
    let remainingIncome = federalTaxableIncome;
    let cumulativeTax = 0;
    for (let i = 0; i < baseBrackets.length; i++) {
      const b = baseBrackets[i];
      const adjMin = Math.round(b.min * inflationFactor);
      const adjMax = b.max === Infinity ? Infinity : Math.round(b.max * inflationFactor);
      const bracketWidth = adjMax === Infinity ? Infinity : adjMax - adjMin;
      const incomeInBracket = adjMax === Infinity 
        ? Math.max(0, remainingIncome) 
        : Math.min(Math.max(0, remainingIncome), bracketWidth);
      const taxInBracket = incomeInBracket * b.rate;
      cumulativeTax += taxInBracket;
      
      bracketDetails.push({
        rate: `${(b.rate * 100).toFixed(0)}%`,
        rateNum: b.rate,
        rangeStart: adjMin,
        rangeEnd: adjMax,
        width: bracketWidth,
        incomeInBracket: Math.round(incomeInBracket),
        taxInBracket: Math.round(taxInBracket),
        cumulativeTax: Math.round(cumulativeTax),
        filled: incomeInBracket > 0,
        full: adjMax !== Infinity && incomeInBracket >= bracketWidth - 1,
        remaining: adjMax !== Infinity ? Math.round(Math.max(0, bracketWidth - incomeInBracket)) : null
      });
      
      remainingIncome -= incomeInBracket;
      if (remainingIncome <= 0 && adjMax !== Infinity) break;
    }
    
    // Use engine values for taxes (not recalculated)
    const totalFedTax = p.federalTax;
    const stateTax = p.stateTax;
    const ficaTax = p.ficaTax || 0;
    
    // State tax display info
    const stateRate = STATE_TAX_RATES[personalInfo.state] || 0;
    const stateExemptSS = !STATES_THAT_TAX_SS.has(personalInfo.state);
    const stateExemptRetirement = STATES_EXEMPT_RETIREMENT_INCOME.has(personalInfo.state);
    const retirementIncomeForExemption = p.pension;
    
    // IRMAA display (use engine data, show tier info for detail)
    const isMedicareAge = selectedAge >= 65;
    const irmaa = isMedicareAge ? calculateIRMAA(magi, filingStatus, yearsFromNow, personalInfo.inflationRate) : null;
    
    const totalTax = p.totalTax;
    const effectiveRate = grossTaxableIncome > 0 ? (totalTax / grossTaxableIncome * 100) : 0;
    
    // Net income from engine
    const grossIncome = p.earnedIncome + p.socialSecurity + p.pension + p.otherIncome + p.portfolioWithdrawal + rothConversion;
    const netAfterTax = grossIncome - totalTax;
    
    // Bar width helper for bracket visualization
    const maxBracketIncome = Math.max(...bracketDetails.filter(b => b.filled).map(b => b.incomeInBracket), 1);
    
    return (
      <div className={cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h4 className="text-lg font-semibold text-slate-100">Tax Year Snapshot</h4>
            <p className="text-slate-400 text-xs">Detailed tax breakdown showing how each dollar of income is taxed</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm">Age:</span>
            <input
              type="range"
              min={personalInfo.myAge}
              max={personalInfo.legacyAge || 95}
              value={selectedAge}
              onChange={e => setSelectedAge(Number(e.target.value))}
              className="w-32 accent-amber-500"
            />
            <input
              type="number"
              min={personalInfo.myAge}
              max={personalInfo.legacyAge || 95}
              value={selectedAge}
              onChange={e => setSelectedAge(Math.max(personalInfo.myAge, Math.min(personalInfo.legacyAge || 95, Number(e.target.value))))}
              className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-center text-sm"
            />
            <span className="text-slate-500 text-xs">(Year {personalInfo.myBirthYear + selectedAge})</span>
          </div>
        </div>
        
        {/* Income Sources */}
        <div className="mb-5">
          <h5 className="text-sm font-semibold text-slate-300 mb-2 border-b border-slate-700 pb-1">Income Sources</h5>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
            {p.earnedIncome > 0 && (
              <div className="bg-slate-800/50 rounded px-3 py-2">
                <div className="text-slate-500">Earned Income</div>
                <div className="text-green-400 font-semibold">{formatCurrency(p.earnedIncome)}</div>
              </div>
            )}
            <div className="bg-slate-800/50 rounded px-3 py-2">
              <div className="text-slate-500">Social Security</div>
              <div className="text-blue-400 font-semibold">{formatCurrency(p.socialSecurity)}</div>
            </div>
            {p.pension > 0 && (
              <div className="bg-slate-800/50 rounded px-3 py-2">
                <div className="text-slate-500">Pension</div>
                <div className="text-purple-400 font-semibold">{formatCurrency(p.pension)}</div>
              </div>
            )}
            <div className="bg-slate-800/50 rounded px-3 py-2">
              <div className="text-slate-500">Portfolio Withdrawal</div>
              <div className="text-amber-400 font-semibold">{formatCurrency(p.portfolioWithdrawal)}</div>
            </div>
            {(p.qcd || 0) > 0 && (
              <div className="bg-slate-800/50 rounded px-3 py-2">
                <div className="text-slate-500">QCD (tax-free)</div>
                <div className="text-emerald-400 font-semibold">−{formatCurrency(p.qcd)}</div>
              </div>
            )}
            {rothConversion > 0 && (
              <div className="bg-purple-900/30 rounded px-3 py-2 border border-purple-700/40">
                <div className="text-slate-500">Roth Conversion</div>
                <div className="text-purple-400 font-semibold">{formatCurrency(rothConversion)}</div>
              </div>
            )}
            <div className="bg-slate-800/50 rounded px-3 py-2 border border-slate-600">
              <div className="text-slate-500">Gross Income</div>
              <div className="text-slate-100 font-bold">{formatCurrency(grossIncome)}</div>
            </div>
          </div>
        </div>
        
        {/* Social Security Taxation */}
        <div className="mb-5">
          <h5 className="text-sm font-semibold text-slate-300 mb-2 border-b border-slate-700 pb-1">Social Security Taxation</h5>
          <div className="bg-slate-800/40 rounded-lg p-3 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400">Non-SS taxable income</span>
              <span className="text-slate-300">{formatCurrency(Math.round(nonSSIncome))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">+ 50% of Social Security</span>
              <span className="text-slate-300">{formatCurrency(Math.round(p.socialSecurity * 0.5))}</span>
            </div>
            <div className="flex justify-between border-t border-slate-700 pt-1">
              <span className="text-slate-300 font-medium">= Combined income</span>
              <span className="text-slate-100 font-semibold">{formatCurrency(Math.round(combinedIncome))}</span>
            </div>
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${combinedIncome <= ssThreshold1 ? 'bg-emerald-500' : 'bg-slate-600'}`}></div>
                <span className={combinedIncome <= ssThreshold1 ? 'text-emerald-400' : 'text-slate-500'}>Below {formatCurrency(ssThreshold1)}: 0% taxable</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${combinedIncome > ssThreshold1 && combinedIncome <= ssThreshold2 ? 'bg-amber-500' : 'bg-slate-600'}`}></div>
                <span className={combinedIncome > ssThreshold1 && combinedIncome <= ssThreshold2 ? 'text-amber-400' : 'text-slate-500'}>{formatCurrency(ssThreshold1)}–{formatCurrency(ssThreshold2)}: up to 50% taxable</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${combinedIncome > ssThreshold2 ? 'bg-red-500' : 'bg-slate-600'}`}></div>
                <span className={combinedIncome > ssThreshold2 ? 'text-red-400' : 'text-slate-500'}>Above {formatCurrency(ssThreshold2)}: up to 85% taxable</span>
              </div>
            </div>
            <div className="flex justify-between border-t border-slate-700 pt-2 mt-2">
              <span className="text-slate-300 font-medium">Taxable SS</span>
              <span className="text-amber-400 font-bold">{formatCurrency(Math.round(taxableSS))} <span className="text-slate-500 font-normal">({ssPct}% of {formatCurrency(p.socialSecurity)})</span></span>
            </div>
          </div>
        </div>
        
        {/* Standard Deduction & Taxable Income */}
        <div className="mb-5">
          <h5 className="text-sm font-semibold text-slate-300 mb-2 border-b border-slate-700 pb-1">Taxable Income Calculation</h5>
          <div className="bg-slate-800/40 rounded-lg p-3 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400">Taxable non-SS income (earned + pension + withdrawal{rothConversion > 0 ? ' + Roth conv.' : ''} − QCD)</span>
              <span className="text-slate-300">{formatCurrency(Math.round(nonSSIncome))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">+ Taxable Social Security ({ssPct}%)</span>
              <span className="text-slate-300">{formatCurrency(Math.round(taxableSS))}</span>
            </div>
            <div className="flex justify-between border-t border-slate-700 pt-1">
              <span className="text-slate-300">= Gross taxable income</span>
              <span className="text-slate-100 font-semibold">{formatCurrency(Math.round(grossTaxableIncome))}</span>
            </div>
            {preTaxDeduction > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-400">− Pre-tax retirement contributions (401k/403b/IRA)</span>
                <span className="text-emerald-400">−{formatCurrency(Math.round(preTaxDeduction))}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-400">− Standard deduction</span>
              <span className="text-red-400">−{formatCurrency(adjDeduction)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-700 pt-1">
              <span className="text-slate-100 font-semibold">= Federal taxable income</span>
              <span className="text-amber-400 font-bold text-sm">{formatCurrency(taxableIncome)}</span>
            </div>
            {preTaxDeduction > 0 && (
              <div className="flex justify-between mt-2 pt-2 border-t border-slate-700/50">
                <span className="text-slate-400">MAGI (adds back pre-tax contributions)</span>
                <span className="text-amber-400">{formatCurrency(Math.round(magi))}</span>
              </div>
            )}
          </div>
        </div>
        
        {/* Federal Bracket Breakdown */}
        <div className="mb-5">
          <h5 className="text-sm font-semibold text-slate-300 mb-2 border-b border-slate-700 pb-1">Federal Tax by Bracket</h5>
          <div className="space-y-1.5">
            {bracketDetails.map((b, i) => (
              <div key={i} className={`rounded-lg p-2.5 text-xs ${b.filled ? 'bg-slate-800/60' : 'bg-slate-800/20'}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded font-bold text-xs ${
                      b.rateNum <= 0.12 ? 'bg-emerald-500/20 text-emerald-400' :
                      b.rateNum <= 0.22 ? 'bg-yellow-500/20 text-yellow-400' :
                      b.rateNum <= 0.24 ? 'bg-orange-500/20 text-orange-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>{b.rate}</span>
                    <span className="text-slate-500">
                      {formatCurrency(b.rangeStart)} – {b.rangeEnd === Infinity ? '∞' : formatCurrency(b.rangeEnd)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {b.filled && (
                      <>
                        <span className="text-slate-300">{formatCurrency(b.incomeInBracket)}</span>
                        <span className="text-slate-500">×</span>
                        <span className="text-slate-400">{b.rate}</span>
                        <span className="text-slate-500">=</span>
                        <span className={`font-semibold ${b.rateNum <= 0.12 ? 'text-emerald-400' : b.rateNum <= 0.22 ? 'text-yellow-400' : b.rateNum <= 0.24 ? 'text-orange-400' : 'text-red-400'}`}>
                          {formatCurrency(b.taxInBracket)}
                        </span>
                      </>
                    )}
                    {!b.filled && <span className="text-slate-600 italic">—</span>}
                  </div>
                </div>
                {b.filled && (
                  <div className="mt-1">
                    <div className="w-full bg-slate-700/50 rounded-full h-1.5">
                      <div 
                        className={`h-1.5 rounded-full ${
                          b.rateNum <= 0.12 ? 'bg-emerald-500' :
                          b.rateNum <= 0.22 ? 'bg-yellow-500' :
                          b.rateNum <= 0.24 ? 'bg-orange-500' :
                          'bg-red-500'
                        }`}
                        style={{ width: `${b.full ? 100 : Math.max(3, (b.incomeInBracket / (b.width || 1)) * 100)}%` }}
                      ></div>
                    </div>
                    {b.remaining !== null && b.remaining > 0 && (
                      <div className="text-slate-600 text-xs mt-0.5">{formatCurrency(b.remaining)} room remaining in bracket</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* State Tax */}
        <div className="mb-5">
          <h5 className="text-sm font-semibold text-slate-300 mb-2 border-b border-slate-700 pb-1">State Tax — {personalInfo.state}</h5>
          <div className="bg-slate-800/40 rounded-lg p-3 text-xs space-y-2">
            {stateRate === 0 ? (
              <div className="text-emerald-400">No state income tax</div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-400">State taxable income {stateExemptSS ? '(SS exempt)' : '(includes SS)'}</span>
                  <span className="text-slate-300">{formatCurrency(stateTaxableIncome)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">× State rate</span>
                  <span className="text-slate-300">{(stateRate * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between border-t border-slate-700 pt-1">
                  <span className="text-slate-300 font-medium">State tax</span>
                  <span className="text-orange-400 font-bold">{formatCurrency(stateTax)}</span>
                </div>
                {stateExemptSS && taxableSS > 0 && (
                  <div className="text-emerald-400/80 text-xs mt-1">
                    ✓ {personalInfo.state} does not tax Social Security — {formatCurrency(Math.round(taxableSS))} excluded from state taxable income
                  </div>
                )}
                {stateExemptRetirement && retirementIncomeForExemption > 0 && (
                  <div className="text-emerald-400/80 text-xs mt-1">
                    ✓ {personalInfo.state} exempts pension income — {formatCurrency(Math.round(retirementIncomeForExemption))} excluded from state taxable income
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        
        {/* FICA / Payroll Tax */}
        {ficaTax > 0 && (
          <div className="mb-5">
            <h5 className="text-sm font-semibold text-slate-300 mb-2 border-b border-slate-700 pb-1">FICA / Payroll Tax</h5>
            <div className="bg-slate-800/40 rounded-lg p-3 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Earned income subject to FICA</span>
                <span className="text-slate-300">{formatCurrency(p.earnedIncome)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Social Security (6.2%, capped at wage base)</span>
                <span className="text-slate-300">included</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Medicare (1.45% + 0.9% Additional)</span>
                <span className="text-slate-300">included</span>
              </div>
              <div className="flex justify-between border-t border-slate-700 pt-1">
                <span className="text-slate-300 font-medium">Total FICA (employee share)</span>
                <span className="text-orange-400 font-bold">{formatCurrency(ficaTax)}</span>
              </div>
            </div>
          </div>
        )}
        
        {/* IRMAA */}
        {isMedicareAge && irmaa && (
          <div className="mb-5">
            <h5 className="text-sm font-semibold text-slate-300 mb-2 border-b border-slate-700 pb-1">Medicare IRMAA</h5>
            <div className="bg-slate-800/40 rounded-lg p-3 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">MAGI (all income incl. full SS)</span>
                <span className="text-slate-300">{formatCurrency(Math.round(magi))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">IRMAA tier</span>
                <span className="text-slate-300">Tier {irmaa.tier}{irmaa.tier === 0 ? ' (base — no surcharge)' : ''}</span>
              </div>
              {irmaa.tier > 0 && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Part B monthly premium</span>
                    <span className="text-pink-400">${irmaa.partBMonthly.toFixed(2)}/mo</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Part D surcharge</span>
                    <span className="text-pink-400">${irmaa.partDMonthly.toFixed(2)}/mo</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-700 pt-1">
                    <span className="text-slate-300 font-medium">Annual IRMAA surcharge</span>
                    <span className="text-pink-400 font-bold">{formatCurrency(irmaa.totalAnnual)}</span>
                  </div>
                </>
              )}
              {irmaa.tier === 0 && (
                <div className="text-emerald-400/80">✓ Below IRMAA threshold — standard Medicare premiums apply</div>
              )}
            </div>
          </div>
        )}
        
        {/* Earnings Test Notice */}
        {(p.ssEarningsTestReduction || 0) > 0 && (
          <div className="mb-5 bg-amber-900/20 border border-amber-700/30 rounded-lg p-3">
            <p className="text-xs text-amber-300">
              <strong>⚠️ SS Earnings Test:</strong> {formatCurrency(p.ssEarningsTestReduction)} of Social Security benefits withheld this year due to earned income above the annual limit. 
              SSA will recalculate your benefit upward at FRA to credit the withheld months, but cash flow is reduced now.
            </p>
          </div>
        )}
        
        {/* Summary */}
        <div>
          <h5 className="text-sm font-semibold text-slate-300 mb-2 border-b border-slate-700 pb-1">Tax Summary — Age {selectedAge}</h5>
          <div className="flex flex-wrap gap-3">
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-center">
              <div className="text-slate-400 text-xs">Federal Tax</div>
              <div className="text-red-400 font-bold text-lg">{formatCurrency(totalFedTax)}</div>
            </div>
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg px-3 py-2 text-center">
              <div className="text-slate-400 text-xs">State Tax{stateExemptRetirement ? ' (pension exempt)' : ''}</div>
              <div className="text-orange-400 font-bold text-lg">{formatCurrency(stateTax)}</div>
            </div>
            {ficaTax > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 text-center">
                <div className="text-slate-400 text-xs">FICA (Payroll)</div>
                <div className="text-yellow-400 font-bold text-lg">{formatCurrency(ficaTax)}</div>
              </div>
            )}
            {irmaaSurcharge > 0 && (
              <div className="bg-pink-500/10 border border-pink-500/30 rounded-lg px-3 py-2 text-center">
                <div className="text-slate-400 text-xs">IRMAA Surcharge</div>
                <div className="text-pink-400 font-bold text-lg">{formatCurrency(irmaaSurcharge)}</div>
              </div>
            )}
            {(p.healthcareExpense || 0) > 0 && (
              <div className="bg-pink-500/10 border border-pink-500/30 rounded-lg px-3 py-2 text-center">
                <div className="text-slate-400 text-xs">Healthcare Costs</div>
                <div className="text-pink-400 font-bold text-lg">{formatCurrency(p.healthcareExpense)}</div>
                <div className="text-slate-500 text-xs">
                  {p.healthcarePre65 > 0 ? 'Pre-Medicare' : 'Medicare+OOP'}
                  {p.healthcareLTC > 0 && ' +LTC'}
                </div>
              </div>
            )}
            {(p.recurringExpenses || 0) > 0 && (
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3 py-2 text-center">
                <div className="text-slate-400 text-xs">Recurring Expenses</div>
                <div className="text-cyan-400 font-bold text-lg">{formatCurrency(p.recurringExpenses)}</div>
              </div>
            )}
            <div className="bg-slate-500/10 border border-slate-500/30 rounded-lg px-3 py-2 text-center">
              <div className="text-slate-400 text-xs">Total Tax</div>
              <div className="text-slate-100 font-bold text-lg">{formatCurrency(totalTax)}</div>
              <div className="text-slate-500 text-xs">{effectiveRate.toFixed(1)}% effective rate</div>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 text-center">
              <div className="text-slate-400 text-xs">Net After Tax</div>
              <div className="text-emerald-400 font-bold text-lg">{formatCurrency(Math.round(netAfterTax))}</div>
              <div className="text-slate-500 text-xs">of {formatCurrency(Math.round(grossIncome))} gross</div>
            
            {(p.healthcareExpense || 0) > 0 && (
              <div className="bg-pink-500/10 border border-pink-500/30 rounded-lg px-3 py-2 text-center">
                <div className="text-slate-400 text-xs">Healthcare</div>
                <div className="text-pink-400 font-bold text-lg">{formatCurrency(p.healthcareExpense)}</div>
                <div className="text-slate-500 text-xs">
                  {p.healthcarePre65 > 0 && 'Pre-65 '}
                  {p.healthcareMedicare > 0 && 'Medicare '}
                  {p.healthcareLTC > 0 && 'LTC'}
                </div>
              </div>
            )}
            {(p.recurringExpenses || 0) > 0 && (
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3 py-2 text-center">
                <div className="text-slate-400 text-xs">Recurring Expenses</div>
                <div className="text-cyan-400 font-bold text-lg">{formatCurrency(p.recurringExpenses)}</div>
              </div>
            )}
</div>
          </div>
          {(p.qcd || 0) > 0 && (
            <p className="text-xs text-emerald-400/70 mt-2">
              💡 QCD of {formatCurrency(p.qcd)} excluded from taxable income, saving approximately {formatCurrency(Math.round((p.qcd) * (bracketDetails.find(b => b.filled && !bracketDetails.find(b2 => b2.filled && b2.rateNum > b.rateNum))?.rateNum || 0.22)))} in federal taxes.
            </p>
          )}
        </div>
      </div>
    );
  };
  
  const RothConversionSimulator = ({ projections, personalInfo, accounts, retirementAge, cardStyle, formatCurrency }) => {
    const [conversionSettings, setConversionSettings] = useState({
      startAge: retirementAge,
      endAge: 74, // Before RMDs start at 75
      targetBracket: '22%',
      futureWithdrawalBracket: '24%' // Assumed bracket when withdrawing in retirement
    });
    
    const bracketOptions = [
      { value: '12%', label: '12% Bracket', rate: 0.12 },
      { value: '22%', label: '22% Bracket', rate: 0.22 },
      { value: '24%', label: '24% Bracket', rate: 0.24 },
      { value: '32%', label: '32% Bracket', rate: 0.32 }
    ];
    
    const futureRateOptions = [
      { value: '22%', label: '22%', rate: 0.22 },
      { value: '24%', label: '24%', rate: 0.24 },
      { value: '32%', label: '32%', rate: 0.32 },
      { value: '35%', label: '35%', rate: 0.35 }
    ];
    
    // Calculate conversion opportunities for each year
    const conversionAnalysis = useMemo(() => {
      const results = [];
      let cumulativeConversion = 0;
      let cumulativeTaxPaid = 0;
      let cumulativeTaxSaved = 0;
      
      const targetRate = bracketOptions.find(b => b.value === conversionSettings.targetBracket)?.rate || 0.22;
      const futureRate = futureRateOptions.find(b => b.value === conversionSettings.futureWithdrawalBracket)?.rate || 0.24;
      
      for (let age = conversionSettings.startAge; age <= conversionSettings.endAge; age++) {
        const projection = projections.find(p => p.myAge === age);
        if (!projection) continue;
        
        const yearsFromNow = age - personalInfo.myAge;
        const inflationFactor = Math.pow(1 + personalInfo.inflationRate, yearsFromNow);
        const baseBrackets = FEDERAL_TAX_BRACKETS_2026[personalInfo.filingStatus] || FEDERAL_TAX_BRACKETS_2026.married_joint;
        const baseDeduction = STANDARD_DEDUCTION_2026[personalInfo.filingStatus] || STANDARD_DEDUCTION_2026.married_joint;
        const adjustedDeduction = baseDeduction * inflationFactor;
        
        // Use the projection engine's actual taxableIncome — this already reflects the real
        // taxable SS, all withdrawals, RMDs, and any planned Roth conversion already executed.
        // The simulator shows room *above* the planned conversion amount.
        const taxableIncome = projection.taxableIncome;
        
        // Gross income (pre-deduction) for tax delta calculations
        const grossIncome = projection.earnedIncome + projection.socialSecurity + projection.pension
          + projection.otherIncome + projection.portfolioWithdrawal + (projection.rothConversion || 0);
        
        // Find the target bracket threshold
        let targetThreshold = 0;
        if (conversionSettings.targetBracket === '12%') {
          targetThreshold = baseBrackets[1].max * inflationFactor;
        } else if (conversionSettings.targetBracket === '22%') {
          targetThreshold = baseBrackets[2].max * inflationFactor;
        } else if (conversionSettings.targetBracket === '24%') {
          targetThreshold = baseBrackets[3].max * inflationFactor;
        } else if (conversionSettings.targetBracket === '32%') {
          targetThreshold = baseBrackets[4].max * inflationFactor;
        }
        
        // Room available for conversion (to fill up to target bracket)
        const roomInBracket = Math.max(0, targetThreshold - taxableIncome);
        
        // Use this year's projected pre-tax balance, reduced by cumulative conversions done so far
        // We assume conversions reduce the balance and that money doesn't grow further in pre-tax
        // A more accurate model would account for growth, but this gives a reasonable approximation
        const availablePreTax = Math.max(0, projection.preTaxBalance - cumulativeConversion);
        const conversionAmount = Math.min(roomInBracket, availablePreTax);
        
        // Calculate tax on conversion (simplified - uses marginal rate)
        // In reality, would need to calculate actual marginal rates
        const taxOnConversion = conversionAmount * targetRate;
        
        // Tax saved = what you would have paid later minus what you pay now
        const futureTaxAvoided = conversionAmount * futureRate;
        const taxSavings = futureTaxAvoided - taxOnConversion;
        
        cumulativeConversion += conversionAmount;
        cumulativeTaxPaid += taxOnConversion;
        cumulativeTaxSaved += taxSavings;
        
        // Calculate new total income with conversion
        const newGrossIncome = grossIncome + conversionAmount;
        const newTaxableIncome = Math.max(0, newGrossIncome - adjustedDeduction);
        const newFederalTax = calculateFederalTax(newGrossIncome, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate);
        const baseFederalTax = calculateFederalTax(grossIncome, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate);
        const actualTaxOnConversion = newFederalTax - baseFederalTax;
        
        results.push({
          age,
          year: projection.year,
          baseIncome: Math.round(grossIncome),
          taxableIncome: Math.round(taxableIncome),
          targetThreshold: Math.round(targetThreshold),
          roomInBracket: Math.round(roomInBracket),
          conversionAmount: Math.round(conversionAmount),
          taxOnConversion: Math.round(actualTaxOnConversion),
          effectiveRate: conversionAmount > 0 ? (actualTaxOnConversion / conversionAmount) : 0,
          futureTaxAvoided: Math.round(conversionAmount * futureRate),
          taxSavings: Math.round(conversionAmount * futureRate - actualTaxOnConversion),
          cumulativeConversion: Math.round(cumulativeConversion),
          cumulativeTaxPaid: Math.round(cumulativeTaxPaid),
          newTotalIncome: Math.round(newGrossIncome),
          remainingPreTax: Math.round(availablePreTax - conversionAmount)
        });
      }
      
      return results;
    }, [projections, personalInfo, conversionSettings]);
    
    const totalConversion = conversionAnalysis.reduce((sum, r) => sum + r.conversionAmount, 0);
    const totalTaxPaid = conversionAnalysis.reduce((sum, r) => sum + r.taxOnConversion, 0);
    const totalTaxSaved = conversionAnalysis.reduce((sum, r) => sum + r.taxSavings, 0);
    const avgEffectiveRate = totalConversion > 0 ? totalTaxPaid / totalConversion : 0;
    
    return (
      <div className={cardStyle}>
        <h4 className="text-lg font-semibold text-slate-100 mb-2">🔄 Roth Conversion Simulator</h4>
        <p className="text-sm text-slate-400 mb-4">
          Simulate filling a tax bracket with Roth conversions during your "tax valley" years (typically between retirement and RMDs at age 75).
        </p>
        
        {/* Settings */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 bg-slate-800/50 rounded-lg">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Start Age</label>
            <input
              type="number"
              value={conversionSettings.startAge}
              onChange={e => setConversionSettings({...conversionSettings, startAge: Number(e.target.value)})}
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">End Age (before RMDs)</label>
            <input
              type="number"
              value={conversionSettings.endAge}
              onChange={e => setConversionSettings({...conversionSettings, endAge: Number(e.target.value)})}
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Fill Up To Bracket</label>
            <select
              value={conversionSettings.targetBracket}
              onChange={e => setConversionSettings({...conversionSettings, targetBracket: e.target.value})}
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
            >
              {bracketOptions.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Future Withdrawal Rate</label>
            <select
              value={conversionSettings.futureWithdrawalBracket}
              onChange={e => setConversionSettings({...conversionSettings, futureWithdrawalBracket: e.target.value})}
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
            >
              {futureRateOptions.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
            <p className="text-xs text-slate-500 mt-1">Expected rate if NOT converted</p>
          </div>
        </div>
        
        {/* Summary Results */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-0.5">Starting Pre-Tax Balance</div>
            <div className="text-xl font-bold text-sky-400">{formatCurrency(conversionAnalysis[0]?.remainingPreTax + conversionAnalysis[0]?.conversionAmount || 0)}</div>
            <div className="text-xs text-slate-500">Age {conversionSettings.startAge}</div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-0.5">Total Converted</div>
            <div className="text-xl font-bold text-emerald-400">{formatCurrency(totalConversion)}</div>
            <div className="text-xs text-slate-500">{conversionAnalysis.length} years</div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-0.5">Remaining Pre-Tax</div>
            <div className="text-xl font-bold text-amber-400">{formatCurrency(conversionAnalysis[conversionAnalysis.length - 1]?.remainingPreTax || 0)}</div>
            <div className="text-xs text-slate-500">Age {conversionSettings.endAge}</div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-0.5">Tax Paid on Conversions</div>
            <div className="text-xl font-bold text-red-400">{formatCurrency(totalTaxPaid)}</div>
            <div className="text-xs text-slate-500">Avg rate: {(avgEffectiveRate * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
            <div className="text-slate-500 text-xs mb-0.5">Lifetime Tax Savings</div>
            <div className={`text-xl font-bold ${totalTaxSaved >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCurrency(totalTaxSaved)}
            </div>
            <div className="text-xs text-slate-500">{totalTaxSaved >= 0 ? 'Net benefit' : 'Net cost'}</div>
          </div>
        </div>
        
        {/* Income vs Bracket Thresholds Chart - With Conversions */}
        <div className="mb-6">
          <h5 className="text-md font-semibold text-slate-200 mb-3">Income + Conversions vs. Tax Bracket Thresholds</h5>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={conversionAnalysis} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="age" stroke="#94a3b8" tick={{ fill: '#94a3b8' }} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8' }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }} 
                  formatter={(v, name) => [formatCurrency(v), name]}
                  labelFormatter={l => `Age ${l}`}
                />
                <Legend />
                
                {/* Stacked bars: base income + conversion */}
                <Bar dataKey="baseIncome" stackId="income" fill="#3b82f6" name="Base Income" />
                <Bar dataKey="conversionAmount" stackId="income" fill="#10b981" name="Roth Conversion" />
                
                {/* Target bracket threshold line */}
                <Line type="monotone" dataKey="targetThreshold" stroke="#eab308" strokeWidth={3} dot={false} name={`Top of ${conversionSettings.targetBracket} Bracket`} strokeDasharray="5 5" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            * Blue bars show your base income. Green bars show Roth conversions filling up to the {conversionSettings.targetBracket} bracket threshold (yellow dashed line).
          </p>
        </div>
        
        {/* Year-by-Year Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-2 px-2 text-slate-400 font-medium">Age</th>
                <th className="text-right py-2 px-2 text-slate-400 font-medium">Base Income</th>
                <th className="text-right py-2 px-2 text-slate-400 font-medium">Bracket Cap</th>
                <th className="text-right py-2 px-2 text-slate-400 font-medium">Room</th>
                <th className="text-right py-2 px-2 text-slate-400 font-medium">Conversion</th>
                <th className="text-right py-2 px-2 text-slate-400 font-medium">Tax Paid</th>
                <th className="text-right py-2 px-2 text-slate-400 font-medium">Eff. Rate</th>
                <th className="text-right py-2 px-2 text-slate-400 font-medium">Tax Saved</th>
                <th className="text-right py-2 px-2 text-slate-400 font-medium">Cumulative</th>
                <th className="text-right py-2 px-2 text-slate-400 font-medium">Pre-Tax Left</th>
              </tr>
            </thead>
            <tbody>
              {conversionAnalysis.map((row, idx) => (
                <tr key={row.age} className={`border-b border-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''}`}>
                  <td className="py-2 px-2 text-slate-300 font-medium">{row.age}</td>
                  <td className="py-2 px-2 text-right text-slate-400">{formatCurrency(row.baseIncome)}</td>
                  <td className="py-2 px-2 text-right text-slate-400">{formatCurrency(row.targetThreshold)}</td>
                  <td className="py-2 px-2 text-right text-sky-400">{formatCurrency(row.roomInBracket)}</td>
                  <td className="py-2 px-2 text-right text-emerald-400 font-semibold">
                    {row.conversionAmount > 0 ? formatCurrency(row.conversionAmount) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right text-red-400">
                    {row.taxOnConversion > 0 ? formatCurrency(row.taxOnConversion) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right text-amber-400">
                    {row.conversionAmount > 0 ? `${(row.effectiveRate * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td className={`py-2 px-2 text-right font-medium ${row.taxSavings >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {row.conversionAmount > 0 ? formatCurrency(row.taxSavings) : '—'}
                  </td>
                  <td className="py-2 px-2 text-right text-purple-400">{formatCurrency(row.cumulativeConversion)}</td>
                  <td className="py-2 px-2 text-right text-sky-400">{formatCurrency(row.remainingPreTax)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-600 bg-slate-800/50">
                <td className="py-3 px-2 text-slate-300 font-semibold">Total</td>
                <td></td>
                <td></td>
                <td></td>
                <td className="py-3 px-2 text-right text-emerald-400 font-bold">{formatCurrency(totalConversion)}</td>
                <td className="py-3 px-2 text-right text-red-400 font-bold">{formatCurrency(totalTaxPaid)}</td>
                <td className="py-3 px-2 text-right text-amber-400 font-bold">{(avgEffectiveRate * 100).toFixed(1)}%</td>
                <td className={`py-3 px-2 text-right font-bold ${totalTaxSaved >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatCurrency(totalTaxSaved)}
                </td>
                <td></td>
                <td className="py-3 px-2 text-right text-sky-400 font-bold">{formatCurrency(conversionAnalysis[conversionAnalysis.length - 1]?.remainingPreTax || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        
        <div className="mt-4 p-3 bg-slate-800/50 border border-slate-700/50 rounded-lg">
          <p className="text-xs text-slate-400">
            <strong>💡 How to read this:</strong> Each year shows the room available to fill the {conversionSettings.targetBracket} bracket. 
            "Tax Paid" is what you pay now on the conversion. "Tax Saved" compares this to what you'd pay later at {conversionSettings.futureWithdrawalBracket}. 
            Positive savings means converting now is beneficial. "Pre-Tax Left" shows your remaining traditional IRA/401k balance after conversions.
            This assumes your future withdrawals would be taxed at the higher rate — adjust the "Future Withdrawal Rate" based on your expected RMD situation.
          </p>
        </div>
      </div>
    );
  };
  const TaxPlanningTab = () => {
    const [ageRange, setAgeRange] = useState({ start: personalInfo.myAge, end: personalInfo.legacyAge || 95 });
    
    // Find retirement age (first year with no earned income)
    const retirementProjection = projections.find(p => p.earnedIncome === 0);
    const retirementAge = retirementProjection?.myAge || 65;
    
    // Calculate inflation-adjusted bracket thresholds for each year
    const taxPlanningData = projections
      .filter(p => p.myAge >= ageRange.start && p.myAge <= ageRange.end)
      .map(p => {
        const yearsFromNow = p.myAge - personalInfo.myAge;
        const inflationFactor = Math.pow(1 + personalInfo.inflationRate, yearsFromNow);
        const baseBrackets = FEDERAL_TAX_BRACKETS_2026[personalInfo.filingStatus] || FEDERAL_TAX_BRACKETS_2026.married_joint;
        const baseDeduction = STANDARD_DEDUCTION_2026[personalInfo.filingStatus] || STANDARD_DEDUCTION_2026.married_joint;
        const adjustedDeduction = baseDeduction * inflationFactor;
        
        // Use the projection engine's actual taxableIncome — this already includes the real
        // taxable SS amount (not the flat 85% approximation), all portfolio withdrawals,
        // RMDs, and the planned Roth conversion. This ensures the Bracket column and
        // Room figures are consistent with what the engine actually computed.
        const plannedConversion = p.rothConversion || 0;
        const taxableIncome = p.taxableIncome; // engine-computed, includes conversion

        // Gross income for chart display (SS shown at 85% is a display approximation only)
        const grossIncome = p.earnedIncome + p.socialSecurity * 0.85 + p.pension + p.otherIncome + p.portfolioWithdrawal + plannedConversion;
        
        // Bracket thresholds are in terms of taxable income, so add back deduction for display
        // This shows where income needs to be (gross) to hit each bracket
        const bracket10 = baseBrackets[0].max * inflationFactor + adjustedDeduction;
        const bracket12 = baseBrackets[1].max * inflationFactor + adjustedDeduction;
        const bracket22 = baseBrackets[2].max * inflationFactor + adjustedDeduction;
        const bracket24 = baseBrackets[3].max * inflationFactor + adjustedDeduction;
        const bracket32 = baseBrackets[4].max * inflationFactor + adjustedDeduction;
        const bracket35 = baseBrackets[5].max * inflationFactor + adjustedDeduction;
        
        // Calculate room in each bracket (space before hitting next bracket)
        // taxableIncome already set above from engine output
        // "Room to 22%" = how much more can be added before crossing into 22% bracket
        // "Room to 24%" = how much more can be added before crossing into 24% bracket (from current position)
        const cap10  = baseBrackets[0].max * inflationFactor;
        const cap12  = baseBrackets[1].max * inflationFactor;
        const cap22  = baseBrackets[2].max * inflationFactor;
        const cap24  = baseBrackets[3].max * inflationFactor;
        const cap32  = baseBrackets[4].max * inflationFactor;
        const cap35  = baseBrackets[5].max * inflationFactor;

        let currentBracket = '10%';
        let roomInBracket = 0;
        // roomTo22: additional income before entering the 22% bracket (0 if already in 22%+)
        const roomTo22 = Math.max(0, cap12 - taxableIncome);
        // roomTo24: additional income before entering the 24% bracket (0 if already in 24%+)
        const roomTo24 = Math.max(0, cap24 - taxableIncome);

        if (taxableIncome <= cap10) {
          currentBracket = '10%';
          roomInBracket = cap10 - taxableIncome;
        } else if (taxableIncome <= cap12) {
          currentBracket = '12%';
          roomInBracket = cap12 - taxableIncome;
        } else if (taxableIncome <= cap22) {
          currentBracket = '22%';
          roomInBracket = cap22 - taxableIncome;
        } else if (taxableIncome <= cap24) {
          currentBracket = '24%';
          roomInBracket = cap24 - taxableIncome;
        } else if (taxableIncome <= cap32) {
          currentBracket = '32%';
          roomInBracket = cap32 - taxableIncome;
        } else if (taxableIncome <= cap35) {
          currentBracket = '35%';
          roomInBracket = cap35 - taxableIncome;
        } else {
          currentBracket = '37%';
          roomInBracket = 0;
        }
        
        // Distance to next IRMAA tier (retained for RothConversionSimulator use)
        let distToNextIRMAA = null;
        const isMedicareAge = p.myAge >= 65;
        const currentMAGI = p.earnedIncome + p.socialSecurity + p.pension + p.otherIncome + p.portfolioWithdrawal + (p.rothConversion || 0);
        let currentIRMAA = null;
        if (isMedicareAge) {
          currentIRMAA = calculateIRMAA(currentMAGI, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate);
          const lookupStatus = personalInfo.filingStatus === 'head_of_household' ? 'single' : personalInfo.filingStatus;
          const tiers = IRMAA_THRESHOLDS_2025[lookupStatus] || IRMAA_THRESHOLDS_2025.married_joint;
          for (const tier of tiers) {
            const adjMax = tier.maxIncome === Infinity ? Infinity : tier.maxIncome * inflationFactor;
            if (currentMAGI < adjMax) {
              distToNextIRMAA = Math.round(adjMax - currentMAGI);
              break;
            }
          }
        }

        return {
          myAge: p.myAge,
          year: p.year,
          earnedIncome: p.earnedIncome,
          socialSecurity: Math.round(p.socialSecurity * 0.85),
          pension: p.pension,
          otherIncome: p.otherIncome,
          portfolioWithdrawal: p.portfolioWithdrawal,
          plannedConversion: Math.round(plannedConversion),
          grossIncome: Math.round(grossIncome),
          standardDeduction: Math.round(adjustedDeduction),
          taxableIncome: Math.round(taxableIncome),
          bracket10,
          bracket12,
          bracket22,
          bracket24,
          bracket32,
          bracket35,
          currentBracket,
          roomInBracket: Math.round(Math.max(0, roomInBracket)),
          roomTo22: Math.round(Math.max(0, roomTo22)),
          roomTo24: Math.round(Math.max(0, roomTo24)),
          // IRMAA fields (used by RothConversionSimulator)
          currentIRMAATier: currentIRMAA?.tier || 0,
          currentIRMAAannual: currentIRMAA?.totalAnnual || 0,
          distToNextIRMAA,
          currentMAGI: Math.round(currentMAGI),
        };
      });
    
    const currentYearData = taxPlanningData.find(d => d.myAge === personalInfo.myAge);
    const retirementYearData = taxPlanningData.find(d => d.myAge === retirementAge);
    
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-xl font-semibold text-slate-100 mb-2">Tax Planning & Roth Conversion Opportunities</h3>
          <p className="text-slate-400 text-sm">Identify years with room in lower tax brackets for potential Roth conversions. The chart shows your taxable income vs. federal bracket thresholds (adjusted for inflation).</p>
        </div>
        
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={cardStyle}>
            <div className="text-slate-400 text-sm mb-1">Current Tax Bracket</div>
            <div className="text-2xl font-bold text-amber-400">{currentYearData?.currentBracket || 'N/A'}</div>
            <div className="text-slate-500 text-xs mt-1">Age {personalInfo.myAge}</div>
          </div>
          <div className={cardStyle}>
            <div className="text-slate-400 text-sm mb-1">Room to Fill 22% Bracket</div>
            <div className="text-2xl font-bold text-emerald-400">{formatCurrency(currentYearData?.roomTo22 || 0)}</div>
            <div className="text-slate-500 text-xs mt-1">Potential Roth conversion space this year</div>
          </div>
          <div className={cardStyle}>
            <div className="text-slate-400 text-sm mb-1">At Retirement (Age {retirementAge})</div>
            <div className="text-2xl font-bold text-sky-400">{retirementYearData?.currentBracket || 'N/A'} bracket</div>
            <div className="text-slate-500 text-xs mt-1">Room to 22%: {formatCurrency(retirementYearData?.roomTo22 || 0)}</div>
          </div>
        </div>
        
        {/* Chart */}
        <div className={cardStyle}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h4 className="text-lg font-semibold text-slate-100">Income vs. Tax Bracket Thresholds</h4>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Age:</span>
              <input
                type="number"
                value={ageRange.start}
                onChange={e => setAgeRange(prev => ({ ...prev, start: Math.max(personalInfo.myAge, Number(e.target.value)) }))}
                className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-center"
              />
              <span className="text-slate-500">to</span>
              <input
                type="number"
                value={ageRange.end}
                onChange={e => setAgeRange(prev => ({ ...prev, end: Math.min(personalInfo.legacyAge || 95, Number(e.target.value)) }))}
                className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-center"
              />
              <div className="flex gap-1 ml-2">
                <button 
                  onClick={() => setAgeRange({ start: retirementAge, end: Math.min(retirementAge + 15, personalInfo.legacyAge || 95) })}
                  className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                >
                  Early Retirement
                </button>
                <button 
                  onClick={() => setAgeRange({ start: personalInfo.myAge, end: personalInfo.legacyAge || 95 })}
                  className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                >
                  All Years
                </button>
              </div>
            </div>
          </div>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={taxPlanningData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="myAge" stroke="#94a3b8" tick={{ fill: '#94a3b8' }} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8' }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }} 
                  formatter={(v, name) => [formatCurrency(v), name]}
                  labelFormatter={l => `Age ${l}`}
                />
                <Legend />
                
                {/* Stacked income bars */}
                <Bar dataKey="earnedIncome" stackId="income" fill="#22c55e" name="Earned Income" />
                <Bar dataKey="socialSecurity" stackId="income" fill="#3b82f6" name="Social Security (85%)" />
                <Bar dataKey="pension" stackId="income" fill="#8b5cf6" name="Pension" />
                <Bar dataKey="otherIncome" stackId="income" fill="#06b6d4" name="Other Income" />
                <Bar dataKey="portfolioWithdrawal" stackId="income" fill="#f59e0b" name="Portfolio Withdrawal" />
                <Bar dataKey="plannedConversion" stackId="income" fill="#a855f7" name="Planned Roth Conv." />
                
                {/* Tax bracket threshold lines */}
                <Line type="monotone" dataKey="bracket12" stroke="#10b981" strokeWidth={2} dot={false} name="Top of 12% Bracket" strokeDasharray="5 5" />
                <Line type="monotone" dataKey="bracket22" stroke="#eab308" strokeWidth={2} dot={false} name="Top of 22% Bracket" strokeDasharray="5 5" />
                <Line type="monotone" dataKey="bracket24" stroke="#f97316" strokeWidth={2} dot={false} name="Top of 24% Bracket" strokeDasharray="5 5" />
                <Line type="monotone" dataKey="bracket32" stroke="#ef4444" strokeWidth={2} dot={false} name="Top of 32% Bracket" strokeDasharray="5 5" />
                
                {/* Retirement reference line */}
                <ReferenceLine x={retirementAge} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Retirement', position: 'top', fill: '#ef4444', fontSize: 12 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            * Bracket thresholds shown are gross income levels (before standard deduction). The gap between your income bars and the bracket lines represents potential Roth conversion space.
          </p>
        </div>
        
        {/* Detailed Table */}
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-slate-100 mb-4">Roth Conversion Opportunity by Year</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 px-2 text-slate-400">Age</th>
                  <th className="text-left py-2 px-2 text-slate-400">Year</th>
                  <th className="text-right py-2 px-2 text-slate-400">Gross Income</th>
                  <th className="text-right py-2 px-2 text-slate-400">Std Deduction</th>
                  <th className="text-right py-2 px-2 text-slate-400">Taxable Income</th>
                  <th className="text-right py-2 px-2 text-purple-400">Planned Conv.</th>
                  <th className="text-center py-2 px-2 text-slate-400">Bracket</th>
                  <th className="text-right py-2 px-2 text-slate-400">Room to 22%</th>
                  <th className="text-right py-2 px-2 text-slate-400">Room to 24%</th>
                </tr>
              </thead>
              <tbody>
                {taxPlanningData.filter(d => d.myAge >= retirementAge - 2).slice(0, 20).map((row, idx) => (
                  <tr key={idx} className={`border-b border-slate-700/50 ${
                    row.plannedConversion > 0 ? 'bg-purple-900/15' :
                    row.myAge >= retirementAge && row.myAge < retirementAge + 10 ? 'bg-emerald-900/20' :
                    idx % 2 === 0 ? 'bg-slate-800/30' : ''
                  }`}>
                    <td className="py-2 px-2 text-slate-100 font-medium">{row.myAge}</td>
                    <td className="py-2 px-2 text-slate-300">{row.year}</td>
                    <td className="py-2 px-2 text-right text-slate-300">{formatCurrency(row.grossIncome)}</td>
                    <td className="py-2 px-2 text-right text-slate-500">{formatCurrency(row.standardDeduction)}</td>
                    <td className="py-2 px-2 text-right text-amber-400">{formatCurrency(row.taxableIncome)}</td>
                    <td className="py-2 px-2 text-right text-purple-400 font-medium">
                      {row.plannedConversion > 0 ? formatCurrency(row.plannedConversion) : '—'}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        row.currentBracket === '10%' ? 'bg-emerald-500/20 text-emerald-400' :
                        row.currentBracket === '12%' ? 'bg-green-500/20 text-green-400' :
                        row.currentBracket === '22%' ? 'bg-yellow-500/20 text-yellow-400' :
                        row.currentBracket === '24%' ? 'bg-orange-500/20 text-orange-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {row.currentBracket}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right text-emerald-400 font-medium">
                      {row.roomTo22 > 0 ? formatCurrency(row.roomTo22) : '—'}
                    </td>
                    <td className="py-2 px-2 text-right text-sky-400">
                      {row.roomTo24 > 0 ? formatCurrency(row.roomTo24) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            💡 <strong>Roth Conversion Strategy:</strong> The highlighted rows (first 10 years of retirement) often present the best Roth conversion opportunities.
            <strong className="text-purple-400"> Purple rows</strong> show years where a planned conversion is already executing — the Taxable Income and Room columns already include that conversion, so Room shows what's <em>still available</em> above your planned amount.
            {(personalInfo.rothConversionAmount > 0 || personalInfo.rothConversionBracket) && (
              <span className="text-purple-400"> Your planned conversion is active (ages {personalInfo.rothConversionStartAge ?? 65}–{personalInfo.rothConversionEndAge ?? 74}{personalInfo.rothConversionBracket ? `, filling to ${personalInfo.rothConversionBracket} bracket` : `, ${formatCurrency(personalInfo.rothConversionAmount)}/yr`}).</span>
            )}
          </p>
        </div>
        
        {/* Tax Year Snapshot */}
        <TaxYearSnapshot 
          projections={projections}
          personalInfo={personalInfo}
          cardStyle={cardStyle}
          formatCurrency={formatCurrency}
        />
        
        {/* Roth Conversion Simulator */}
        <RothConversionSimulator 
          projections={projections}
          personalInfo={personalInfo}
          accounts={accounts}
          retirementAge={retirementAge}
          cardStyle={cardStyle}
          formatCurrency={formatCurrency}
        />
      </div>
    );
  };
  

  const MonteCarloTab = () => {
    // Find retirement age
    const retirementProjection = projections.find(p => p.earnedIncome === 0);
    const defaultRetirementAge = retirementProjection?.myAge || 65;
    
    const [simSettings, setSimSettings] = useState({
      numSimulations: 1000,
      startAge: defaultRetirementAge,
      meanReturn: 0.07,
      stdDev: 0.15,
      inflationMean: 0.03,
      inflationStdDev: 0.01
    });
    const [simResults, setSimResults] = useState(null);
    const [isRunning, setIsRunning] = useState(false);
    
    const endAge = 95;
    const yearsToSimulate = endAge - simSettings.startAge + 1;
    
    // Get projected portfolio balance at simulation start age
    const startProjection = projections.find(p => p.myAge === simSettings.startAge);
    const startingPortfolio = startProjection?.totalPortfolio || 0;
    
    // Box-Muller transform for normal distribution
    const randomNormal = (mean, stdDev) => {
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return mean + stdDev * z;
    };
    
    const runSimulation = () => {
      setIsRunning(true);
      
      // Use setTimeout to allow UI to update
      setTimeout(() => {
        const results = [];
        const portfolioPathsToStore = [];
        const numPathsToStore = 100; // Store subset for visualization
        
        // Calculate account balances at start age using deterministic projection.
        // IMPORTANT: mirrors the main engine's order — contributions first, then RMDs deducted,
        // then growth applied — so pre-tax balances aren't overstated by skipped RMDs.
        const getStartingBalances = () => {
          const balances = {};
          const accountBalancesCopy = {};
          accounts.forEach(a => { accountBalancesCopy[a.id] = a.balance; });
          
          // Run deterministic projection to start age
          for (let year = 0; year < (simSettings.startAge - personalInfo.myAge); year++) {
            const myAge = personalInfo.myAge + year;
            const spouseAge = personalInfo.spouseAge + year;
            
            accounts.forEach(account => {
              const ownerAge = account.owner === 'me' ? myAge : account.owner === 'spouse' ? spouseAge : Math.max(myAge, spouseAge);
              const yearsContributing = ownerAge - account.startAge;
              const contributionGrowth = account.contributionGrowth || 0;
              
              if (ownerAge >= account.startAge && ownerAge < account.stopAge) {
                const adjustedContribution = account.contribution * Math.pow(1 + contributionGrowth, Math.max(0, yearsContributing));
                accountBalancesCopy[account.id] += adjustedContribution;
              }

              // Deduct RMDs before growth (matches main engine: withdraw then grow)
              if (isPreTaxAccount(account.type)) {
                const ownerBirthYear = account.owner === 'me'
                  ? personalInfo.myBirthYear
                  : account.owner === 'spouse'
                  ? personalInfo.spouseBirthYear
                  : personalInfo.myBirthYear;
                const rmd = calculateRMD(accountBalancesCopy[account.id], ownerAge, ownerBirthYear);
                accountBalancesCopy[account.id] = Math.max(0, accountBalancesCopy[account.id] - rmd);
              }

              accountBalancesCopy[account.id] *= (1 + account.cagr);
            });
          }
          
          accounts.forEach(a => { balances[a.id] = accountBalancesCopy[a.id]; });
          return balances;
        };
        
        const initialBalances = getStartingBalances();
        
        for (let sim = 0; sim < simSettings.numSimulations; sim++) {
          // Initialize account balances for this simulation at the start age
          const accountBalances = { ...initialBalances };
          
          const portfolioPath = [];
          let portfolioSurvived = true;
          let failureAge = null;
          
          // Track cumulative inflation as a running product of each year's random inflation
          const yearsBeforeSim = simSettings.startAge - personalInfo.myAge;
          const inflationBeforeSim = Math.pow(1 + simSettings.inflationMean, yearsBeforeSim);
          let cumulativeInflationDuringSim = 1;
          
          for (let year = 0; year < yearsToSimulate; year++) {
            const myAge = simSettings.startAge + year;
            const spouseAge = personalInfo.spouseAge + (simSettings.startAge - personalInfo.myAge) + year;
            const yearsFromToday = (simSettings.startAge - personalInfo.myAge) + year;
            
            // Random returns for this year
            const marketReturn = randomNormal(simSettings.meanReturn, simSettings.stdDev);
            const inflation = randomNormal(simSettings.inflationMean, simSettings.inflationStdDev);
            
            // Compound this year's random inflation into the running cumulative factor
            // Each year's inflation is independent, properly compounded year-over-year
            if (year > 0) {
              cumulativeInflationDuringSim *= (1 + inflation);
            }
            const desiredIncome = personalInfo.desiredRetirementIncome * inflationBeforeSim * cumulativeInflationDuringSim;
            
            // Healthcare and recurring expenses (unified model — same as main engine)
            const mcHealthcare = calculateHealthcareExpenses(personalInfo, myAge, spouseAge, yearsFromToday, true, personalInfo.filingStatus === 'married_joint');
            const mcRecurring = calculateRecurringExpenses(recurringExpenses, myAge, spouseAge, yearsFromToday, personalInfo.inflationRate);
            const mcAdjustedDesired = desiredIncome + mcHealthcare.total + mcRecurring.total;
            
            // Calculate income streams
            let totalSocialSecurity = 0, totalPension = 0, totalOtherIncome = 0, earnedIncome = 0;
            let nonSSIncome = 0; // Track non-SS income for calculating SS taxation
            
            incomeStreams.forEach(stream => {
              const ownerAge = stream.owner === 'me' ? myAge : spouseAge;
              if (ownerAge >= stream.startAge && ownerAge <= stream.endAge) {
                const yearsFromStart = ownerAge - stream.startAge;
                const adjustedAmount = stream.amount * Math.pow(1 + (stream.cola || 0), yearsFromStart);
                
                if (stream.type === 'earned_income') {
                  earnedIncome += adjustedAmount;
                  nonSSIncome += adjustedAmount;
                } else if (stream.type === 'social_security') {
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
            
            // Calculate the taxable portion of Social Security benefits
            const taxableSS = calculateSocialSecurityTaxableAmount(
              totalSocialSecurity, 
              nonSSIncome, 
              personalInfo.filingStatus
            );
            
            // Now calculate total taxable income including properly-taxed SS
            // Subtract pre-tax contributions (above-the-line deduction), capped at earned income
            const mcPreTaxDeduction = Math.min(mcPreTaxContributions, earnedIncome);
            const totalTaxableIncome = nonSSIncome + taxableSS - mcPreTaxDeduction;
            
            // Add contributions and calculate totals/RMDs (before growth)
            let totalPreTax = 0, totalRoth = 0, totalBrokerage = 0, totalRMD = 0;
            let mcPreTaxContributions = 0;
            
            accounts.forEach(account => {
              const ownerAge = account.owner === 'me' ? myAge : account.owner === 'spouse' ? spouseAge : Math.max(myAge, spouseAge);
              const yearsContributing = ownerAge - account.startAge;
              const contributionGrowth = account.contributionGrowth || 0;
              
              if (ownerAge >= account.startAge && ownerAge < account.stopAge) {
                const adjustedContribution = account.contribution * Math.pow(1 + contributionGrowth, Math.max(0, yearsContributing));
                accountBalances[account.id] += adjustedContribution;
                if (isPreTaxAccount(account.type) && adjustedContribution > 0 && (account.contributor || 'me') === 'me') {
                  mcPreTaxContributions += adjustedContribution;
                }
              }
              
              if (isPreTaxAccount(account.type)) {
                // Get birth year based on account owner
                const ownerBirthYear = account.owner === 'me' 
                  ? personalInfo.myBirthYear 
                  : account.owner === 'spouse' 
                  ? personalInfo.spouseBirthYear 
                  : personalInfo.myBirthYear;
                
                totalRMD += calculateRMD(accountBalances[account.id], ownerAge, ownerBirthYear);
                totalPreTax += accountBalances[account.id];
              } else if (isRothAccount(account.type)) {
                totalRoth += accountBalances[account.id];
              } else {
                totalBrokerage += accountBalances[account.id];
              }
            });
            
            const totalPortfolio = totalPreTax + totalRoth + totalBrokerage;
            const totalGuaranteedIncome = totalSocialSecurity + totalPension + totalOtherIncome;
            
            // Calculate withdrawal need using the same iterative tax solver as the deterministic engine.
            // This replaces the old flat MONTE_CARLO_TAX_ESTIMATE constant (15%) which was inaccurate
            // for high-bracket retirees and ignored filing status, state, and withdrawal composition.
            let portfolioWithdrawal = 0;
            if (earnedIncome === 0) {
              const baseFedTax = calculateFederalTax(totalTaxableIncome, personalInfo.filingStatus, yearsFromToday, simSettings.inflationMean);
              const mcBaseRetIncome = totalPension; // Pension only (no withdrawals yet in base)
              const baseStateTax = calculateStateTax(totalTaxableIncome, personalInfo.state, personalInfo.filingStatus, yearsFromToday, simSettings.inflationMean, taxableSS, mcBaseRetIncome);
              const netGuaranteed = totalGuaranteedIncome + earnedIncome - baseFedTax - baseStateTax;
              const afterTaxGap = Math.max(0, mcAdjustedDesired - netGuaranteed);

              if (afterTaxGap > 0) {
                let testWithdrawal = afterTaxGap;
                const mcPriority = personalInfo.withdrawalPriority || ['pretax', 'brokerage', 'roth'];

                for (let i = 0; i < 8; i++) {
                  // Estimate pre-tax portion of this withdrawal (bounded by test amount and available balance)
                  const estimatedPreTax = mcPriority[0] === 'pretax'
                    ? Math.min(testWithdrawal, totalPreTax)
                    : Math.min(testWithdrawal * 0.7, totalPreTax);

                  // Max of RMD and spending-driven pre-tax draw (RMD is subsumed by spending draw if larger)
                  const totalPreTaxFromWithdrawals = Math.max(totalRMD, estimatedPreTax);

                  // Brokerage portion of withdrawal: anything beyond what pre-tax covers
                  const brokerageEstimate = Math.max(0, testWithdrawal - totalPreTaxFromWithdrawals);
                  const capitalGainsEstimate = brokerageEstimate * (1 - BROKERAGE_COST_BASIS_ESTIMATE);

                  // Recalculate SS taxation with new ordinary income (pre-tax withdrawals add to combined income)
                  const adjustedNonSS = nonSSIncome + totalPreTaxFromWithdrawals + capitalGainsEstimate;
                  const adjustedTaxableSS = calculateSocialSecurityTaxableAmount(
                    totalSocialSecurity, adjustedNonSS, personalInfo.filingStatus
                  );
                  const adjustedGross = adjustedNonSS + adjustedTaxableSS;

                  // Full federal + state on the combined ordinary income
                  const totalFed = calculateFederalTax(adjustedGross, personalInfo.filingStatus, yearsFromToday, simSettings.inflationMean);
                  // Retirement income for state exemption: pension only
                  const mcIterRetIncome = totalPension;
                  const totalState = calculateStateTax(adjustedGross, personalInfo.state, personalInfo.filingStatus, yearsFromToday, simSettings.inflationMean, adjustedTaxableSS, mcIterRetIncome);

                  // Capital gains tax on brokerage portion (tiered 0/15/20%)
                  const baseDeduction = STANDARD_DEDUCTION_2026[personalInfo.filingStatus] || STANDARD_DEDUCTION_2026.married_joint;
                  const adjustedDeduction = baseDeduction * Math.pow(1 + simSettings.inflationMean, yearsFromToday);
                  const taxableOrdinary = Math.max(0, adjustedGross - adjustedDeduction);
                  const cgTax = calculateCapitalGainsTax(capitalGainsEstimate, taxableOrdinary + capitalGainsEstimate, personalInfo.filingStatus, yearsFromToday, simSettings.inflationMean);

                  const withdrawalTax = (totalFed + totalState + cgTax) - (baseFedTax + baseStateTax);
                  const netFromWithdrawal = testWithdrawal - Math.max(0, withdrawalTax);
                  const shortfall = afterTaxGap - netFromWithdrawal;

                  if (Math.abs(shortfall) < 10) break;
                  testWithdrawal = Math.max(0, testWithdrawal + shortfall);
                }
                portfolioWithdrawal = Math.max(totalRMD, testWithdrawal);
              } else {
                portfolioWithdrawal = totalRMD;
              }
            }
            
            // Step 1: Withdraw RMDs from pre-tax accounts first (mandatory)
            // Then withdraw remaining need based on user's priority order
            // (matches main projection engine's priority-based withdrawal logic)
            if (portfolioWithdrawal > 0 && totalPortfolio > 0) {
              let remaining = portfolioWithdrawal;
              
              // Step 1a: RMDs from pre-tax (mandatory, regardless of priority)
              if (totalRMD > 0) {
                const rmdRatio = totalPreTax > 0 ? Math.min(1, totalRMD / totalPreTax) : 0;
                accounts.forEach(account => {
                  if (isPreTaxAccount(account.type)) {
                    const rmdDraw = accountBalances[account.id] * rmdRatio;
                    accountBalances[account.id] -= rmdDraw;
                  }
                });
                remaining = Math.max(0, remaining - totalRMD);
              }
              
              // Step 1b: Additional withdrawals by priority order
              const mcPriority = personalInfo.withdrawalPriority || ['pretax', 'brokerage', 'roth'];
              const mcGetTypes = (cat) => {
                switch(cat) {
                  case 'pretax': return PRE_TAX_TYPES;
                  case 'roth': return ROTH_TYPES;
                  case 'brokerage': return [...BROKERAGE_TYPES, ...HSA_TYPES];
                  default: return [];
                }
              };
              
              for (const category of mcPriority) {
                if (remaining <= 0) break;
                const catTypes = mcGetTypes(category);
                accounts.forEach(account => {
                  if (catTypes.includes(account.type) && remaining > 0) {
                    const draw = Math.min(accountBalances[account.id], remaining);
                    accountBalances[account.id] -= draw;
                    remaining -= draw;
                  }
                });
              }
            }
            
            // Step 1.5: Execute Roth conversions (if configured)
            // Mirrors main engine: move money from largest pre-tax to largest Roth
            const mcConversionAmount = personalInfo.rothConversionAmount || 0;
            const mcConversionStartAge = personalInfo.rothConversionStartAge ?? 65;
            const mcConversionEndAge = personalInfo.rothConversionEndAge ?? 74;
            const mcConversionBracket = personalInfo.rothConversionBracket || '';
            
            if (myAge >= mcConversionStartAge && myAge <= mcConversionEndAge) {
              let mcTargetConversion = 0;
              const mcInflationFactor = inflationBeforeSim * cumulativeInflationDuringSim;
              
              if (mcConversionBracket) {
                // Bracket-fill mode (simplified for MC — uses mean inflation, not random)
                const baseBrackets = FEDERAL_TAX_BRACKETS_2026[personalInfo.filingStatus] || FEDERAL_TAX_BRACKETS_2026.married_joint;
                const baseDeduction = STANDARD_DEDUCTION_2026[personalInfo.filingStatus] || STANDARD_DEDUCTION_2026.married_joint;
                const adjDed = baseDeduction * mcInflationFactor;
                const fullNonSS = nonSSIncome + totalRMD;
                const adjSS = calculateSocialSecurityTaxableAmount(totalSocialSecurity, fullNonSS, personalInfo.filingStatus);
                const currTaxable = Math.max(0, fullNonSS + adjSS - adjDed);
                const bracketIdx = mcConversionBracket === '12%' ? 1 : mcConversionBracket === '22%' ? 2 : mcConversionBracket === '24%' ? 3 : mcConversionBracket === '32%' ? 4 : 2;
                const bracketCap = baseBrackets[bracketIdx].max * mcInflationFactor;
                mcTargetConversion = Math.max(0, bracketCap - currTaxable);
              } else if (mcConversionAmount > 0) {
                mcTargetConversion = mcConversionAmount * mcInflationFactor;
              }
              
              if (mcTargetConversion > 0) {
                const mcPreTaxAccts = accounts.filter(a => isPreTaxAccount(a.type));
                const mcSource = mcPreTaxAccts.length > 0
                  ? mcPreTaxAccts.reduce((best, a) => (accountBalances[a.id] || 0) > (accountBalances[best.id] || 0) ? a : best, mcPreTaxAccts[0])
                  : null;
                const mcRothAccts = accounts.filter(a => isRothAccount(a.type));
                const mcDest = mcRothAccts.length > 0
                  ? mcRothAccts.reduce((best, a) => (accountBalances[a.id] || 0) > (accountBalances[best.id] || 0) ? a : best, mcRothAccts[0])
                  : null;
                
                if (mcSource && mcDest && (accountBalances[mcSource.id] || 0) > 0) {
                  const convAmt = Math.min(mcTargetConversion, accountBalances[mcSource.id]);
                  accountBalances[mcSource.id] -= convAmt;
                  accountBalances[mcDest.id] = (accountBalances[mcDest.id] || 0) + convAmt;
                }
              }
            }
            
            // Step 2: Apply random market return AFTER withdrawals and conversions
            accounts.forEach(account => {
              accountBalances[account.id] = Math.max(0, accountBalances[account.id]) * (1 + marketReturn);
            });
            
            const endingPortfolio = Object.values(accountBalances).reduce((sum, bal) => sum + Math.max(0, bal), 0);
            portfolioPath.push({ age: myAge, portfolio: endingPortfolio });
            
            // Check for portfolio failure
            if (endingPortfolio <= 0 && portfolioSurvived) {
              portfolioSurvived = false;
              failureAge = myAge;
            }
          }
          
          results.push({
            finalPortfolio: portfolioPath[portfolioPath.length - 1].portfolio,
            survived: portfolioSurvived,
            failureAge: failureAge,
            portfolioAt75: portfolioPath.find(p => p.age === 75)?.portfolio || 0,
            portfolioAt85: portfolioPath.find(p => p.age === 85)?.portfolio || 0
          });
          
          if (sim < numPathsToStore) {
            portfolioPathsToStore.push(portfolioPath);
          }
        }
        
        // Calculate statistics
        const successCount = results.filter(r => r.survived).length;
        const successRate = successCount / simSettings.numSimulations;
        
        const finalPortfolios = results.map(r => r.finalPortfolio).sort((a, b) => a - b);
        const percentile = (arr, p) => arr[Math.floor(arr.length * p)];
        
        const failureAges = results.filter(r => !r.survived).map(r => r.failureAge);
        const avgFailureAge = failureAges.length > 0 ? failureAges.reduce((a, b) => a + b, 0) / failureAges.length : null;
        
        // Create percentile bands for chart
        const percentileBands = [];
        for (let year = 0; year < yearsToSimulate; year++) {
          const age = simSettings.startAge + year;
          const portfoliosAtYear = portfolioPathsToStore.map(path => path[year]?.portfolio || 0).sort((a, b) => a - b);
          percentileBands.push({
            age,
            p10: percentile(portfoliosAtYear, 0.10),
            p25: percentile(portfoliosAtYear, 0.25),
            p50: percentile(portfoliosAtYear, 0.50),
            p75: percentile(portfoliosAtYear, 0.75),
            p90: percentile(portfoliosAtYear, 0.90)
          });
        }
        
        setSimResults({
          successRate,
          successCount,
          totalSimulations: simSettings.numSimulations,
          startAge: simSettings.startAge,
          startingPortfolio: Object.values(initialBalances).reduce((sum, bal) => sum + bal, 0),
          percentile5: percentile(finalPortfolios, 0.05),
          percentile25: percentile(finalPortfolios, 0.25),
          percentile50: percentile(finalPortfolios, 0.50),
          percentile75: percentile(finalPortfolios, 0.75),
          percentile95: percentile(finalPortfolios, 0.95),
          avgFailureAge,
          percentileBands,
          portfolioPaths: portfolioPathsToStore.slice(0, 20) // Store 20 paths for spaghetti chart
        });
        
        setIsRunning(false);
      }, 50);
    };
    
    const getSuccessColor = (rate) => {
      if (rate >= 0.9) return 'text-emerald-400';
      if (rate >= 0.75) return 'text-green-400';
      if (rate >= 0.5) return 'text-yellow-400';
      return 'text-red-400';
    };
    
    const getSuccessLabel = (rate) => {
      if (rate >= 0.9) return 'Excellent';
      if (rate >= 0.75) return 'Good';
      if (rate >= 0.5) return 'Fair';
      return 'At Risk';
    };
    
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-xl font-semibold text-slate-100 mb-2">Monte Carlo Simulation</h3>
          <p className="text-slate-400 text-sm">Stress-test your retirement plan against thousands of randomized market scenarios based on historical volatility patterns.</p>
        </div>
        
        {/* Settings */}
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-slate-100 mb-4">Simulation Parameters</h4>
          
          {/* Starting Point */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 pb-4 border-b border-slate-700">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Start Simulation at Age</label>
              <input 
                type="number" 
                value={simSettings.startAge} 
                onChange={e => setSimSettings({...simSettings, startAge: Math.max(personalInfo.myAge, Math.min(90, Number(e.target.value)))})}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Projected Portfolio at Start</label>
              <div className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-emerald-400 font-semibold">
                {formatCurrency(startingPortfolio)}
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Years to Simulate</label>
              <div className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-300">
                {yearsToSimulate} years (to age {endAge})
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Quick Select</label>
              <div className="flex gap-2">
                <button 
                  onClick={() => setSimSettings({...simSettings, startAge: defaultRetirementAge})}
                  className="flex-1 px-2 py-2 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                >
                  At Retirement ({defaultRetirementAge})
                </button>
                <button 
                  onClick={() => setSimSettings({...simSettings, startAge: personalInfo.myAge})}
                  className="flex-1 px-2 py-2 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                >
                  From Today ({personalInfo.myAge})
                </button>
              </div>
            </div>
          </div>
          
          {/* Market Parameters */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1"># Simulations</label>
              <select 
                value={simSettings.numSimulations} 
                onChange={e => setSimSettings({...simSettings, numSimulations: Number(e.target.value)})}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-100"
              >
                <option value={500}>500</option>
                <option value={1000}>1,000</option>
                <option value={2500}>2,500</option>
                <option value={5000}>5,000</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Mean Return (%)</label>
              <input 
                type="number" 
                step="0.5"
                value={(simSettings.meanReturn * 100).toFixed(1)} 
                onChange={e => setSimSettings({...simSettings, meanReturn: Number(e.target.value) / 100})}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Volatility/Std Dev (%)</label>
              <input 
                type="number" 
                step="0.5"
                value={(simSettings.stdDev * 100).toFixed(1)} 
                onChange={e => setSimSettings({...simSettings, stdDev: Number(e.target.value) / 100})}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Inflation Mean (%)</label>
              <input 
                type="number" 
                step="0.25"
                value={(simSettings.inflationMean * 100).toFixed(2)} 
                onChange={e => setSimSettings({...simSettings, inflationMean: Number(e.target.value) / 100})}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Inflation Std Dev (%)</label>
              <input 
                type="number" 
                step="0.25"
                value={(simSettings.inflationStdDev * 100).toFixed(2)} 
                onChange={e => setSimSettings({...simSettings, inflationStdDev: Number(e.target.value) / 100})}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-100"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={runSimulation} 
              disabled={isRunning}
              className={`${buttonPrimary} ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isRunning ? '⏳ Running...' : '▶️ Run Simulation'}
            </button>
            <p className="text-xs text-slate-500">
              Historical reference: S&P 500 has ~10% mean return with ~15% standard deviation. After inflation, real returns are ~7%.
            </p>
          </div>
        </div>
        
        {/* Income Assumptions - What's Being Tested */}
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-slate-100 mb-3">💰 Income & Withdrawal Context</h4>
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-3 border-b border-slate-700">
              <div>
                <div className="text-xs text-slate-500 mb-1">Annual Spending Goal</div>
                <div className="text-lg font-semibold text-slate-100">
                  {formatCurrency(personalInfo.desiredRetirementIncome)}
                </div>
                <div className="text-xs text-slate-400">Grows with inflation</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Guaranteed Income Streams</div>
                <div className="text-lg font-semibold text-emerald-400">
                  {formatCurrency(
                    incomeStreams
                      .filter(s => {
                        const ownerAge = s.owner === 'me' 
                          ? simSettings.startAge 
                          : personalInfo.spouseAge + (simSettings.startAge - personalInfo.myAge);
                        return ownerAge >= s.startAge && ownerAge <= s.endAge;
                      })
                      .reduce((sum, s) => sum + s.amount, 0)
                  )}
                </div>
                <div className="text-xs text-slate-400">
                  {incomeStreams.filter(s => {
                    const ownerAge = s.owner === 'me' 
                      ? simSettings.startAge 
                      : personalInfo.spouseAge + (simSettings.startAge - personalInfo.myAge);
                    return ownerAge >= s.startAge && ownerAge <= s.endAge;
                  }).length} streams at age {simSettings.startAge}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Est. Portfolio Withdrawal</div>
                <div className="text-lg font-semibold text-amber-400">
                  {formatCurrency(
                    Math.max(0, personalInfo.desiredRetirementIncome - 
                      incomeStreams
                        .filter(s => {
                          const ownerAge = s.owner === 'me' 
                            ? simSettings.startAge 
                            : personalInfo.spouseAge + (simSettings.startAge - personalInfo.myAge);
                          return ownerAge >= s.startAge && ownerAge <= s.endAge;
                        })
                        .reduce((sum, s) => sum + s.amount, 0)
                    )
                  )}
                </div>
                <div className="text-xs text-slate-400">Initial gap to fill from savings</div>
              </div>
            </div>
            <div className="bg-blue-900/20 border border-blue-700/30 rounded p-3">
              <p className="text-sm text-blue-300">
                <strong>What the simulation tests:</strong> The Monte Carlo simulation calculates how much you need to withdraw from your portfolio each year to meet your spending goals <em>after</em> accounting for Social Security, pensions, and other guaranteed income. It only tests withdrawals needed to cover the remaining gap.
              </p>
            </div>
          </div>
        </div>
        
        {/* Results */}
        {simResults && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className={cardStyle}>
                <div className="text-slate-400 text-sm mb-1">Success Rate</div>
                <div className={`text-3xl font-bold ${getSuccessColor(simResults.successRate)}`}>
                  {(simResults.successRate * 100).toFixed(1)}%
                </div>
                <div className={`text-sm ${getSuccessColor(simResults.successRate)}`}>
                  {getSuccessLabel(simResults.successRate)}
                </div>
              </div>
              <div className={cardStyle}>
                <div className="text-slate-400 text-sm mb-1">Starting Portfolio</div>
                <div className="text-2xl font-bold text-emerald-400">
                  {formatCurrency(simResults.startingPortfolio)}
                </div>
                <div className="text-sm text-slate-500">at age {simResults.startAge}</div>
              </div>
              <div className={cardStyle}>
                <div className="text-slate-400 text-sm mb-1">Median Final Portfolio</div>
                <div className="text-2xl font-bold text-amber-400">
                  {formatCurrency(simResults.percentile50)}
                </div>
                <div className="text-sm text-slate-500">at age 95</div>
              </div>
              <div className={cardStyle}>
                <div className="text-slate-400 text-sm mb-1">Avg Failure Age</div>
                <div className="text-2xl font-bold text-red-400">
                  {simResults.avgFailureAge ? simResults.avgFailureAge.toFixed(1) : 'N/A'}
                </div>
                <div className="text-sm text-slate-500">{simResults.avgFailureAge ? 'when funds depleted' : 'no failures'}</div>
              </div>
            </div>
            
            {/* Percentile Distribution */}
            <div className={cardStyle}>
              <h4 className="text-lg font-semibold text-slate-100 mb-4">Portfolio Outcome Distribution (at Age 95)</h4>
              <div className="grid grid-cols-5 gap-4 text-center">
                <div>
                  <div className="text-red-400 text-sm mb-1">5th Percentile</div>
                  <div className="text-lg font-semibold text-slate-100">{formatCurrency(simResults.percentile5)}</div>
                  <div className="text-xs text-slate-500">Worst case</div>
                </div>
                <div>
                  <div className="text-orange-400 text-sm mb-1">25th Percentile</div>
                  <div className="text-lg font-semibold text-slate-100">{formatCurrency(simResults.percentile25)}</div>
                  <div className="text-xs text-slate-500">Poor scenario</div>
                </div>
                <div>
                  <div className="text-amber-400 text-sm mb-1">50th Percentile</div>
                  <div className="text-lg font-semibold text-slate-100">{formatCurrency(simResults.percentile50)}</div>
                  <div className="text-xs text-slate-500">Median outcome</div>
                </div>
                <div>
                  <div className="text-green-400 text-sm mb-1">75th Percentile</div>
                  <div className="text-lg font-semibold text-slate-100">{formatCurrency(simResults.percentile75)}</div>
                  <div className="text-xs text-slate-500">Good scenario</div>
                </div>
                <div>
                  <div className="text-emerald-400 text-sm mb-1">95th Percentile</div>
                  <div className="text-lg font-semibold text-slate-100">{formatCurrency(simResults.percentile95)}</div>
                  <div className="text-xs text-slate-500">Best case</div>
                </div>
              </div>
            </div>
            
            {/* Percentile Bands Chart */}
            <div className={cardStyle}>
              <h4 className="text-lg font-semibold text-slate-100 mb-4">Portfolio Projection Bands</h4>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={simResults.percentileBands}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="age" stroke="#94a3b8" tick={{ fill: '#94a3b8' }} />
                    <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8' }} tickFormatter={v => `$${(v/1e6).toFixed(1)}M`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }} 
                      formatter={(v) => formatCurrency(v)}
                      labelFormatter={l => `Age ${l}`}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="p90" stackId="1" fill="#10b981" stroke="#10b981" fillOpacity={0.2} name="90th Percentile" />
                    <Area type="monotone" dataKey="p75" stackId="2" fill="#22c55e" stroke="#22c55e" fillOpacity={0.2} name="75th Percentile" />
                    <Area type="monotone" dataKey="p50" stackId="3" fill="#eab308" stroke="#eab308" fillOpacity={0.3} name="Median (50th)" />
                    <Area type="monotone" dataKey="p25" stackId="4" fill="#f97316" stroke="#f97316" fillOpacity={0.2} name="25th Percentile" />
                    <Area type="monotone" dataKey="p10" stackId="5" fill="#ef4444" stroke="#ef4444" fillOpacity={0.2} name="10th Percentile" />
                    {simSettings.startAge > personalInfo.myAge && (
                      <ReferenceLine x={simSettings.startAge} stroke="#10b981" strokeDasharray="5 5" label={{ value: 'Sim Start', position: 'top', fill: '#10b981', fontSize: 12 }} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                This chart shows the range of possible portfolio outcomes. The median line (yellow) represents the most likely outcome, while the bands show the spread of results from the simulation.
              </p>
            </div>
            
            {/* Sample Paths (Spaghetti Chart) */}
            <div className={cardStyle}>
              <h4 className="text-lg font-semibold text-slate-100 mb-4">Sample Simulation Paths (20 scenarios)</h4>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis 
                      dataKey="age" 
                      stroke="#94a3b8" 
                      tick={{ fill: '#94a3b8' }}
                      domain={[simResults.startAge, 95]}
                      type="number"
                      allowDataOverflow
                    />
                    <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8' }} tickFormatter={v => `$${(v/1e6).toFixed(1)}M`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }} 
                      formatter={(v) => formatCurrency(v)}
                      labelFormatter={l => `Age ${l}`}
                    />
                    {simResults.portfolioPaths.map((path, idx) => (
                      <Line 
                        key={idx}
                        data={path}
                        type="monotone" 
                        dataKey="portfolio" 
                        stroke={`hsl(${(idx * 18) % 360}, 70%, 50%)`}
                        strokeWidth={1}
                        dot={false}
                        opacity={0.5}
                        name={`Scenario ${idx + 1}`}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Each line represents a single simulation showing how your portfolio might evolve with random market returns. Notice the wide spread - this illustrates the uncertainty inherent in retirement planning.
              </p>
            </div>
            
            {/* Interpretation */}
            <div className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-lg">
              <h4 className="font-semibold text-slate-100 mb-2">📊 How to Interpret These Results</h4>
              <ul className="text-sm text-slate-400 space-y-1">
                <li><span className="text-emerald-400 font-medium">90%+ success rate:</span> Your plan is robust and can withstand most market conditions.</li>
                <li><span className="text-green-400 font-medium">75-90% success rate:</span> Good plan, but consider having a backup strategy or flexibility in spending.</li>
                <li><span className="text-yellow-400 font-medium">50-75% success rate:</span> Moderate risk - consider reducing spending, working longer, or saving more.</li>
                <li><span className="text-red-400 font-medium">Below 50%:</span> High risk of running out of money - significant adjustments recommended.</li>
              </ul>
              <p className="text-xs text-slate-500 mt-3">
                Note: Monte Carlo simulations assume returns are normally distributed, which underestimates the probability of extreme events. Real markets have "fat tails" and can experience more severe crashes than the model predicts.
              </p>
            </div>
          </>
        )}
        
        {!simResults && !isRunning && (
          <div className="text-center py-12 text-slate-500">
            <p className="text-lg mb-2">Click "Run Simulation" to analyze your retirement plan</p>
            <p className="text-sm">The simulation will test {simSettings.numSimulations.toLocaleString()} random scenarios</p>
          </div>
        )}
      </div>
    );
  };


  const WithdrawalStrategiesTab = () => {
    // Find retirement info
    const retirementProjection = projections.find(p => p.earnedIncome === 0);
    const retirementAge = retirementProjection?.myAge || 65;
    const retirementPortfolio = retirementProjection?.totalPortfolio || 0;
    
    const [settings, setSettings] = useState({
      retirementAge: retirementAge,
      endAge: 95,
      initialWithdrawalRate: 0.04,
      // Guyton-Klinger settings
      gkCeilingRate: 0.05,
      gkFloorRate: 0.03,
      gkAdjustmentPercent: 0.10,
      // Dynamic/CAPE settings
      capeWithdrawalBase: 0.04,
      // Bucket strategy
      cashYears: 2,
      bondYears: 5,
      // Go-go, slow-go, no-go
      gogoEndAge: 75,
      slowgoEndAge: 85,
      gogoSpendingBoost: 0.20,
      slowgoReduction: 0.20,
      nogoReduction: 0.40
    });
    
    // Get portfolio at retirement and calculate other income
    const getOtherIncomeForAge = (age) => {
      let ssIncome = 0;
      let pensionIncome = 0;
      let otherIncome = 0;
      
      incomeStreams.forEach(stream => {
        const ownerAge = stream.owner === 'me' ? age : age - (personalInfo.myAge - personalInfo.spouseAge);
        if (ownerAge >= stream.startAge && ownerAge <= stream.endAge) {
          const yearsActive = ownerAge - stream.startAge;
          const amount = stream.amount * Math.pow(1 + stream.cola, yearsActive);
          if (stream.type === 'social_security') {
            ssIncome += amount;
          } else if (stream.type === 'pension' || stream.type === 'annuity') {
            pensionIncome += amount;
          } else if (stream.type !== 'earned_income') {
            otherIncome += amount;
          }
        }
      });
      
      return { ssIncome, pensionIncome, otherIncome, total: ssIncome + pensionIncome + otherIncome };
    };
    
    // Calculate desired spending (inflation-adjusted retirement income)
    const getDesiredSpending = (age) => {
      const yearsFromRetirement = age - settings.retirementAge;
      return personalInfo.desiredRetirementIncome * Math.pow(1 + personalInfo.inflationRate, yearsFromRetirement);
    };
    
    // Strategy implementations
    const strategies = useMemo(() => {
      const results = {};
      const years = settings.endAge - settings.retirementAge + 1;
      const startPortfolio = projections.find(p => p.myAge === settings.retirementAge)?.totalPortfolio || retirementPortfolio;
      const avgReturn = accounts.reduce((sum, a) => sum + a.cagr * a.balance, 0) / accounts.reduce((sum, a) => sum + a.balance, 0) || 0.07;
      
      // 1. FIXED PERCENTAGE (e.g., 4% Rule)
      const fixedPercent = [];
      let fpPortfolio = startPortfolio;
      for (let i = 0; i < years; i++) {
        const age = settings.retirementAge + i;
        const otherIncome = getOtherIncomeForAge(age);
        const desiredSpending = getDesiredSpending(age);
        const withdrawal = fpPortfolio * settings.initialWithdrawalRate;
        const totalIncome = withdrawal + otherIncome.total;
        const spending = Math.min(totalIncome, desiredSpending);
        const actualWithdrawal = Math.max(0, Math.min(withdrawal, fpPortfolio));
        
        fixedPercent.push({
          age,
          portfolio: Math.round(fpPortfolio),
          withdrawal: Math.round(actualWithdrawal),
          otherIncome: Math.round(otherIncome.total),
          totalIncome: Math.round(actualWithdrawal + otherIncome.total),
          desiredSpending: Math.round(desiredSpending),
          withdrawalRate: fpPortfolio > 0 ? actualWithdrawal / fpPortfolio : 0
        });
        
        fpPortfolio = Math.max(0, (fpPortfolio - actualWithdrawal) * (1 + avgReturn));
      }
      results.fixedPercent = fixedPercent;
      
      // 2. CONSTANT DOLLAR (Inflation-adjusted initial withdrawal)
      const constantDollar = [];
      let cdPortfolio = startPortfolio;
      const initialWithdrawal = startPortfolio * settings.initialWithdrawalRate;
      for (let i = 0; i < years; i++) {
        const age = settings.retirementAge + i;
        const otherIncome = getOtherIncomeForAge(age);
        const desiredSpending = getDesiredSpending(age);
        const inflationAdjustedWithdrawal = initialWithdrawal * Math.pow(1 + personalInfo.inflationRate, i);
        const actualWithdrawal = Math.max(0, Math.min(inflationAdjustedWithdrawal, cdPortfolio));
        
        constantDollar.push({
          age,
          portfolio: Math.round(cdPortfolio),
          withdrawal: Math.round(actualWithdrawal),
          otherIncome: Math.round(otherIncome.total),
          totalIncome: Math.round(actualWithdrawal + otherIncome.total),
          desiredSpending: Math.round(desiredSpending),
          withdrawalRate: cdPortfolio > 0 ? actualWithdrawal / cdPortfolio : 0
        });
        
        cdPortfolio = Math.max(0, (cdPortfolio - actualWithdrawal) * (1 + avgReturn));
      }
      results.constantDollar = constantDollar;
      
      // 3. GUYTON-KLINGER GUARDRAILS
      const guytonKlinger = [];
      let gkPortfolio = startPortfolio;
      let gkBaseWithdrawal = startPortfolio * settings.initialWithdrawalRate;
      for (let i = 0; i < years; i++) {
        const age = settings.retirementAge + i;
        const otherIncome = getOtherIncomeForAge(age);
        const desiredSpending = getDesiredSpending(age);
        
        // Inflation adjust the base withdrawal
        const inflationAdjusted = gkBaseWithdrawal * Math.pow(1 + personalInfo.inflationRate, i);
        let withdrawal = inflationAdjusted;
        
        // Apply guardrails
        const currentRate = gkPortfolio > 0 ? withdrawal / gkPortfolio : 0;
        
        if (currentRate > settings.gkCeilingRate) {
          // Cut withdrawal by adjustment percent
          withdrawal = withdrawal * (1 - settings.gkAdjustmentPercent);
        } else if (currentRate < settings.gkFloorRate && i > 0) {
          // Raise withdrawal by adjustment percent (prosperity rule)
          withdrawal = withdrawal * (1 + settings.gkAdjustmentPercent);
        }
        
        const actualWithdrawal = Math.max(0, Math.min(withdrawal, gkPortfolio));
        
        guytonKlinger.push({
          age,
          portfolio: Math.round(gkPortfolio),
          withdrawal: Math.round(actualWithdrawal),
          otherIncome: Math.round(otherIncome.total),
          totalIncome: Math.round(actualWithdrawal + otherIncome.total),
          desiredSpending: Math.round(desiredSpending),
          withdrawalRate: gkPortfolio > 0 ? actualWithdrawal / gkPortfolio : 0
        });
        
        gkPortfolio = Math.max(0, (gkPortfolio - actualWithdrawal) * (1 + avgReturn));
      }
      results.guytonKlinger = guytonKlinger;
      
      // 4. DYNAMIC SPENDING (% of portfolio each year, smoothed)
      const dynamic = [];
      let dynPortfolio = startPortfolio;
      let prevWithdrawal = startPortfolio * settings.initialWithdrawalRate;
      for (let i = 0; i < years; i++) {
        const age = settings.retirementAge + i;
        const otherIncome = getOtherIncomeForAge(age);
        const desiredSpending = getDesiredSpending(age);
        
        // Target: percentage of current portfolio
        const targetWithdrawal = dynPortfolio * settings.initialWithdrawalRate;
        // Smooth: 70% previous year + 30% target (reduces volatility)
        const smoothedWithdrawal = i === 0 ? targetWithdrawal : prevWithdrawal * 0.7 + targetWithdrawal * 0.3;
        const actualWithdrawal = Math.max(0, Math.min(smoothedWithdrawal, dynPortfolio));
        
        dynamic.push({
          age,
          portfolio: Math.round(dynPortfolio),
          withdrawal: Math.round(actualWithdrawal),
          otherIncome: Math.round(otherIncome.total),
          totalIncome: Math.round(actualWithdrawal + otherIncome.total),
          desiredSpending: Math.round(desiredSpending),
          withdrawalRate: dynPortfolio > 0 ? actualWithdrawal / dynPortfolio : 0
        });
        
        prevWithdrawal = actualWithdrawal;
        dynPortfolio = Math.max(0, (dynPortfolio - actualWithdrawal) * (1 + avgReturn));
      }
      results.dynamic = dynamic;
      
      // 5. GO-GO, SLOW-GO, NO-GO (Retirement Phases)
      const phases = [];
      let phasePortfolio = startPortfolio;
      const baseWithdrawal = startPortfolio * settings.initialWithdrawalRate;
      for (let i = 0; i < years; i++) {
        const age = settings.retirementAge + i;
        const otherIncome = getOtherIncomeForAge(age);
        const desiredSpending = getDesiredSpending(age);
        
        // Inflation adjust base
        let withdrawal = baseWithdrawal * Math.pow(1 + personalInfo.inflationRate, i);
        
        // Apply phase multiplier
        if (age <= settings.gogoEndAge) {
          withdrawal = withdrawal * (1 + settings.gogoSpendingBoost); // Go-go: spend more
        } else if (age <= settings.slowgoEndAge) {
          withdrawal = withdrawal * (1 - settings.slowgoReduction); // Slow-go: reduce
        } else {
          withdrawal = withdrawal * (1 - settings.nogoReduction); // No-go: reduce more
        }
        
        const actualWithdrawal = Math.max(0, Math.min(withdrawal, phasePortfolio));
        
        phases.push({
          age,
          portfolio: Math.round(phasePortfolio),
          withdrawal: Math.round(actualWithdrawal),
          otherIncome: Math.round(otherIncome.total),
          totalIncome: Math.round(actualWithdrawal + otherIncome.total),
          desiredSpending: Math.round(desiredSpending),
          withdrawalRate: phasePortfolio > 0 ? actualWithdrawal / phasePortfolio : 0,
          phase: age <= settings.gogoEndAge ? 'Go-Go' : age <= settings.slowgoEndAge ? 'Slow-Go' : 'No-Go'
        });
        
        phasePortfolio = Math.max(0, (phasePortfolio - actualWithdrawal) * (1 + avgReturn));
      }
      results.phases = phases;
      
      // 6. FLOOR + UPSIDE (Spend guaranteed income + % of portfolio growth)
      const floorUpside = [];
      let fuPortfolio = startPortfolio;
      let fuPrevPortfolio = startPortfolio;
      for (let i = 0; i < years; i++) {
        const age = settings.retirementAge + i;
        const otherIncome = getOtherIncomeForAge(age);
        const desiredSpending = getDesiredSpending(age);
        
        // Floor: minimal withdrawal from portfolio
        const floorWithdrawal = fuPortfolio * 0.03;
        
        // Upside: if portfolio grew, take some of the gains
        const portfolioGrowth = fuPortfolio - fuPrevPortfolio;
        const upsideWithdrawal = portfolioGrowth > 0 ? portfolioGrowth * 0.5 : 0;
        
        const totalWithdrawal = floorWithdrawal + upsideWithdrawal;
        const actualWithdrawal = Math.max(0, Math.min(totalWithdrawal, fuPortfolio));
        
        floorUpside.push({
          age,
          portfolio: Math.round(fuPortfolio),
          withdrawal: Math.round(actualWithdrawal),
          otherIncome: Math.round(otherIncome.total),
          totalIncome: Math.round(actualWithdrawal + otherIncome.total),
          desiredSpending: Math.round(desiredSpending),
          withdrawalRate: fuPortfolio > 0 ? actualWithdrawal / fuPortfolio : 0
        });
        
        fuPrevPortfolio = fuPortfolio;
        fuPortfolio = Math.max(0, (fuPortfolio - actualWithdrawal) * (1 + avgReturn));
      }
      results.floorUpside = floorUpside;
      
      // 7. RMD-BASED (Use IRS RMD tables)
      const rmdBased = [];
      let rmdPortfolio = startPortfolio;
      const rmdFactors = {
        72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2,
        81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
        90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9
      };
      for (let i = 0; i < years; i++) {
        const age = settings.retirementAge + i;
        const otherIncome = getOtherIncomeForAge(age);
        const desiredSpending = getDesiredSpending(age);
        
        // Use RMD factor if available, otherwise use a reasonable rate
        let withdrawal;
        if (age < 72) {
          withdrawal = rmdPortfolio * settings.initialWithdrawalRate;
        } else {
          const factor = rmdFactors[age] || Math.max(5, 27.4 - (age - 72) * 0.9);
          withdrawal = rmdPortfolio / factor;
        }
        
        const actualWithdrawal = Math.max(0, Math.min(withdrawal, rmdPortfolio));
        
        rmdBased.push({
          age,
          portfolio: Math.round(rmdPortfolio),
          withdrawal: Math.round(actualWithdrawal),
          otherIncome: Math.round(otherIncome.total),
          totalIncome: Math.round(actualWithdrawal + otherIncome.total),
          desiredSpending: Math.round(desiredSpending),
          withdrawalRate: rmdPortfolio > 0 ? actualWithdrawal / rmdPortfolio : 0
        });
        
        rmdPortfolio = Math.max(0, (rmdPortfolio - actualWithdrawal) * (1 + avgReturn));
      }
      results.rmdBased = rmdBased;
      
      return results;
    }, [settings, projections, personalInfo, incomeStreams, accounts, retirementPortfolio]);
    
    const strategyInfo = [
      { key: 'fixedPercent', name: 'Fixed Percentage', color: '#3b82f6', description: 'Withdraw a fixed % of current portfolio each year (e.g., 4% rule variant)' },
      { key: 'constantDollar', name: 'Constant Dollar (4% Rule)', color: '#10b981', description: 'Withdraw initial amount adjusted for inflation regardless of portfolio' },
      { key: 'guytonKlinger', name: 'Guyton-Klinger Guardrails', color: '#f59e0b', description: 'Adjust withdrawals up/down based on portfolio performance guardrails' },
      { key: 'dynamic', name: 'Dynamic Smoothed', color: '#8b5cf6', description: 'Percentage of portfolio with smoothing to reduce year-to-year volatility' },
      { key: 'phases', name: 'Go-Go / Slow-Go / No-Go', color: '#ef4444', description: 'Higher spending early in retirement, decreasing with age' },
      { key: 'floorUpside', name: 'Floor + Upside', color: '#06b6d4', description: 'Minimum floor withdrawal plus share of portfolio gains' },
      { key: 'rmdBased', name: 'RMD-Based', color: '#ec4899', description: 'Follow IRS Required Minimum Distribution schedule' }
    ];
    
    const [selectedStrategies, setSelectedStrategies] = useState(['constantDollar', 'guytonKlinger', 'phases']);
    const [showDetails, setShowDetails] = useState('constantDollar');
    
    const toggleStrategy = (key) => {
      if (selectedStrategies.includes(key)) {
        if (selectedStrategies.length > 1) {
          setSelectedStrategies(selectedStrategies.filter(s => s !== key));
          if (showDetails === key) setShowDetails(selectedStrategies.find(s => s !== key));
        }
      } else {
        setSelectedStrategies([...selectedStrategies, key]);
      }
    };
    
    // Prepare chart data
    const chartData = useMemo(() => {
      const data = [];
      const years = settings.endAge - settings.retirementAge + 1;
      for (let i = 0; i < years; i++) {
        const age = settings.retirementAge + i;
        const point = { age };
        selectedStrategies.forEach(key => {
          if (strategies[key] && strategies[key][i]) {
            point[`${key}Portfolio`] = strategies[key][i].portfolio;
            point[`${key}Withdrawal`] = strategies[key][i].withdrawal;
            point[`${key}TotalIncome`] = strategies[key][i].totalIncome;
          }
        });
        data.push(point);
      }
      return data;
    }, [strategies, selectedStrategies, settings]);
    
    // Summary stats
    const getSummaryStats = (strategyData) => {
      if (!strategyData || strategyData.length === 0) return {};
      const finalPortfolio = strategyData[strategyData.length - 1].portfolio;
      const totalWithdrawals = strategyData.reduce((sum, d) => sum + d.withdrawal, 0);
      const avgWithdrawal = totalWithdrawals / strategyData.length;
      const minWithdrawal = Math.min(...strategyData.map(d => d.withdrawal));
      const maxWithdrawal = Math.max(...strategyData.map(d => d.withdrawal));
      const portfolioRanOut = strategyData.findIndex(d => d.portfolio <= 0);
      return { finalPortfolio, totalWithdrawals, avgWithdrawal, minWithdrawal, maxWithdrawal, portfolioRanOut };
    };
    
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-xl font-semibold text-slate-100 mb-2">Withdrawal Strategy Comparison</h3>
          <p className="text-slate-400 text-sm">
            Compare different retirement withdrawal strategies to see how they affect your portfolio longevity and income stability. 
            All strategies account for your other income streams (Social Security, pensions, etc.).
          </p>
        </div>
        
        {/* Settings */}
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-slate-100 mb-4">Simulation Settings</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Retirement Age</label>
              <input
                type="number"
                value={settings.retirementAge}
                onChange={e => setSettings({...settings, retirementAge: Number(e.target.value)})}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">End Age</label>
              <input
                type="number"
                value={settings.endAge}
                onChange={e => setSettings({...settings, endAge: Number(e.target.value)})}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Initial Withdrawal Rate</label>
              <div className="flex items-center">
                <input
                  type="number"
                  step="0.1"
                  value={(settings.initialWithdrawalRate * 100).toFixed(1)}
                  onChange={e => setSettings({...settings, initialWithdrawalRate: Number(e.target.value) / 100})}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-100"
                />
                <span className="text-slate-400 ml-2">%</span>
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Starting Portfolio</label>
              <div className="text-xl font-bold text-emerald-400 py-2">
                {formatCurrency(projections.find(p => p.myAge === settings.retirementAge)?.totalPortfolio || retirementPortfolio)}
              </div>
            </div>
          </div>
          
          {/* Guyton-Klinger Settings */}
          <div className="mt-4 pt-4 border-t border-slate-700">
            <h5 className="text-sm font-semibold text-slate-300 mb-3">Guyton-Klinger Guardrail Settings</h5>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Ceiling (cut trigger)</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="0.1"
                    value={(settings.gkCeilingRate * 100).toFixed(1)}
                    onChange={e => setSettings({...settings, gkCeilingRate: Number(e.target.value) / 100})}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm"
                  />
                  <span className="text-slate-400 ml-1 text-sm">%</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Floor (raise trigger)</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="0.1"
                    value={(settings.gkFloorRate * 100).toFixed(1)}
                    onChange={e => setSettings({...settings, gkFloorRate: Number(e.target.value) / 100})}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm"
                  />
                  <span className="text-slate-400 ml-1 text-sm">%</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Adjustment %</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="1"
                    value={(settings.gkAdjustmentPercent * 100).toFixed(0)}
                    onChange={e => setSettings({...settings, gkAdjustmentPercent: Number(e.target.value) / 100})}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm"
                  />
                  <span className="text-slate-400 ml-1 text-sm">%</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Go-go/Slow-go/No-go Settings */}
          <div className="mt-4 pt-4 border-t border-slate-700">
            <h5 className="text-sm font-semibold text-slate-300 mb-3">Retirement Phases (Go-Go / Slow-Go / No-Go)</h5>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Go-Go ends at age</label>
                <input
                  type="number"
                  value={settings.gogoEndAge}
                  onChange={e => setSettings({...settings, gogoEndAge: Number(e.target.value)})}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Slow-Go ends at age</label>
                <input
                  type="number"
                  value={settings.slowgoEndAge}
                  onChange={e => setSettings({...settings, slowgoEndAge: Number(e.target.value)})}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Go-Go boost</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="5"
                    value={(settings.gogoSpendingBoost * 100).toFixed(0)}
                    onChange={e => setSettings({...settings, gogoSpendingBoost: Number(e.target.value) / 100})}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm"
                  />
                  <span className="text-slate-400 ml-1 text-sm">%</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Slow-Go reduction</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="5"
                    value={(settings.slowgoReduction * 100).toFixed(0)}
                    onChange={e => setSettings({...settings, slowgoReduction: Number(e.target.value) / 100})}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm"
                  />
                  <span className="text-slate-400 ml-1 text-sm">%</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">No-Go reduction</label>
                <div className="flex items-center">
                  <input
                    type="number"
                    step="5"
                    value={(settings.nogoReduction * 100).toFixed(0)}
                    onChange={e => setSettings({...settings, nogoReduction: Number(e.target.value) / 100})}
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm"
                  />
                  <span className="text-slate-400 ml-1 text-sm">%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Strategy Selection */}
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-slate-100 mb-4">Select Strategies to Compare</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {strategyInfo.map(s => (
              <button
                key={s.key}
                onClick={() => toggleStrategy(s.key)}
                className={`p-3 rounded-lg border text-left transition-all ${
                  selectedStrategies.includes(s.key)
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }}></div>
                  <span className="font-medium text-slate-200 text-sm">{s.name}</span>
                </div>
                <p className="text-xs text-slate-400">{s.description}</p>
              </button>
            ))}
          </div>
        </div>
        
        {/* Summary Comparison */}
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-slate-100 mb-4">Strategy Summary Comparison</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 px-3 text-slate-400">Strategy</th>
                  <th className="text-right py-2 px-3 text-slate-400">Avg Annual Withdrawal</th>
                  <th className="text-right py-2 px-3 text-slate-400">Min Withdrawal</th>
                  <th className="text-right py-2 px-3 text-slate-400">Max Withdrawal</th>
                  <th className="text-right py-2 px-3 text-slate-400">Total Withdrawn</th>
                  <th className="text-right py-2 px-3 text-slate-400">Final Portfolio</th>
                  <th className="text-center py-2 px-3 text-slate-400">Runs Out?</th>
                </tr>
              </thead>
              <tbody>
                {selectedStrategies.map(key => {
                  const info = strategyInfo.find(s => s.key === key);
                  const stats = getSummaryStats(strategies[key]);
                  return (
                    <tr key={key} className="border-b border-slate-700/50 hover:bg-slate-800/30">
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: info?.color }}></div>
                          <span className="text-slate-200 font-medium">{info?.name}</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right text-emerald-400">{formatCurrency(stats.avgWithdrawal)}</td>
                      <td className="py-2 px-3 text-right text-slate-400">{formatCurrency(stats.minWithdrawal)}</td>
                      <td className="py-2 px-3 text-right text-slate-400">{formatCurrency(stats.maxWithdrawal)}</td>
                      <td className="py-2 px-3 text-right text-sky-400">{formatCurrency(stats.totalWithdrawals)}</td>
                      <td className="py-2 px-3 text-right text-amber-400 font-semibold">{formatCurrency(stats.finalPortfolio)}</td>
                      <td className="py-2 px-3 text-center">
                        {stats.portfolioRanOut >= 0 ? (
                          <span className="text-red-400 font-medium">Age {settings.retirementAge + stats.portfolioRanOut}</span>
                        ) : (
                          <span className="text-emerald-400">✓ Lasts</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        
        {/* Portfolio Value Chart */}
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-slate-100 mb-4">Portfolio Value Over Time</h4>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="age" stroke="#94a3b8" tick={{ fill: '#94a3b8' }} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8' }} tickFormatter={v => `$${(v/1000000).toFixed(1)}M`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }} 
                  formatter={(v, name) => [formatCurrency(v), name.replace('Portfolio', '')]}
                  labelFormatter={l => `Age ${l}`}
                />
                <Legend />
                {selectedStrategies.map(key => {
                  const info = strategyInfo.find(s => s.key === key);
                  return (
                    <Line 
                      key={key}
                      type="monotone" 
                      dataKey={`${key}Portfolio`} 
                      stroke={info?.color} 
                      strokeWidth={2} 
                      dot={false}
                      name={info?.name}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        {/* Withdrawal Amount Chart */}
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-slate-100 mb-4">Annual Portfolio Withdrawal by Strategy</h4>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="age" stroke="#94a3b8" tick={{ fill: '#94a3b8' }} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8' }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }} 
                  formatter={(v, name) => [formatCurrency(v), name.replace('Withdrawal', '')]}
                  labelFormatter={l => `Age ${l}`}
                />
                <Legend />
                {selectedStrategies.map(key => {
                  const info = strategyInfo.find(s => s.key === key);
                  return (
                    <Line 
                      key={key}
                      type="monotone" 
                      dataKey={`${key}Withdrawal`} 
                      stroke={info?.color} 
                      strokeWidth={2} 
                      dot={false}
                      name={info?.name}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        {/* Detailed Year-by-Year Table */}
        <div className={cardStyle}>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-slate-100">Detailed Year-by-Year</h4>
            <select
              value={showDetails}
              onChange={e => setShowDetails(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-3 py-1 text-slate-100"
            >
              {selectedStrategies.map(key => {
                const info = strategyInfo.find(s => s.key === key);
                return <option key={key} value={key}>{info?.name}</option>;
              })}
            </select>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 px-2 text-slate-400">Age</th>
                  <th className="text-right py-2 px-2 text-slate-400">Portfolio</th>
                  <th className="text-right py-2 px-2 text-slate-400">Withdrawal</th>
                  <th className="text-right py-2 px-2 text-slate-400">Rate</th>
                  <th className="text-right py-2 px-2 text-slate-400">Other Income</th>
                  <th className="text-right py-2 px-2 text-slate-400">Total Income</th>
                  <th className="text-right py-2 px-2 text-slate-400">Desired</th>
                  <th className="text-center py-2 px-2 text-slate-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {strategies[showDetails]?.map((row, idx) => (
                  <tr key={row.age} className={`border-b border-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''}`}>
                    <td className="py-2 px-2 text-slate-300 font-medium">
                      {row.age}
                      {row.phase && <span className="text-xs text-slate-500 ml-1">({row.phase})</span>}
                    </td>
                    <td className="py-2 px-2 text-right text-emerald-400">{formatCurrency(row.portfolio)}</td>
                    <td className="py-2 px-2 text-right text-amber-400">{formatCurrency(row.withdrawal)}</td>
                    <td className="py-2 px-2 text-right text-slate-400">{(row.withdrawalRate * 100).toFixed(1)}%</td>
                    <td className="py-2 px-2 text-right text-sky-400">{formatCurrency(row.otherIncome)}</td>
                    <td className="py-2 px-2 text-right text-purple-400 font-medium">{formatCurrency(row.totalIncome)}</td>
                    <td className="py-2 px-2 text-right text-slate-400">{formatCurrency(row.desiredSpending)}</td>
                    <td className="py-2 px-2 text-center">
                      {row.totalIncome >= row.desiredSpending ? (
                        <span className="text-emerald-400">✓</span>
                      ) : row.totalIncome >= row.desiredSpending * 0.8 ? (
                        <span className="text-amber-400">~</span>
                      ) : (
                        <span className="text-red-400">✗</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        
        {/* Strategy Explanations */}
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-slate-100 mb-4">📚 Strategy Explanations</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <h5 className="font-medium text-blue-400 mb-1">Fixed Percentage</h5>
              <p className="text-xs text-slate-400">Withdraw a constant percentage of your current portfolio each year. Simple but volatile - income fluctuates with market.</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <h5 className="font-medium text-emerald-400 mb-1">Constant Dollar (4% Rule)</h5>
              <p className="text-xs text-slate-400">The classic Bengen approach: withdraw 4% initially, then adjust for inflation. Stable income but may deplete in bad markets.</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <h5 className="font-medium text-amber-400 mb-1">Guyton-Klinger Guardrails</h5>
              <p className="text-xs text-slate-400">Dynamic rules: cut spending if withdrawal rate exceeds ceiling, raise it if below floor. Balances income stability with portfolio protection.</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <h5 className="font-medium text-purple-400 mb-1">Dynamic Smoothed</h5>
              <p className="text-xs text-slate-400">Take a percentage of portfolio but smooth changes over time (70/30 blend). Reduces year-to-year income volatility.</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <h5 className="font-medium text-red-400 mb-1">Go-Go / Slow-Go / No-Go</h5>
              <p className="text-xs text-slate-400">Spend more in early active retirement (Go-Go), less as activity decreases (Slow-Go), minimal in later years (No-Go). Matches spending to lifestyle.</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <h5 className="font-medium text-cyan-400 mb-1">Floor + Upside</h5>
              <p className="text-xs text-slate-400">Guaranteed minimum (3% floor) plus 50% of portfolio gains. Protects downside while sharing in good years.</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <h5 className="font-medium text-pink-400 mb-1">RMD-Based</h5>
              <p className="text-xs text-slate-400">Follow IRS Required Minimum Distribution tables. Conservative early, increases with age. Never runs out by design.</p>
            </div>
          </div>
        </div>
      </div>
    );
  };
  // ============================================
  // SOCIAL SECURITY OPTIMIZER TAB
  // ============================================
  const SocialSecurityTab = () => {
    const mySSStream = incomeStreams.find(s => s.type === 'social_security' && s.owner === 'me');
    const spouseSSStream = incomeStreams.find(s => s.type === 'social_security' && s.owner === 'spouse');
    
    const [myPIA, setMyPIA] = useState(() => mySSStream?.pia || 2500);
    const [spousePIA, setSpousePIA] = useState(() => spouseSSStream?.pia || 1800);
    const [lifeExpectancy, setLifeExpectancy] = useState(90);
    const [spouseLifeExpectancy, setSpouseLifeExpectancy] = useState(92);
    
    const myCurrentClaimAge = mySSStream?.startAge || 67;
    const spouseCurrentClaimAge = spouseSSStream?.startAge || 67;
    
    const myBirthYear = personalInfo.myBirthYear || (new Date().getFullYear() - personalInfo.myAge);
    const spouseBirthYear = personalInfo.spouseBirthYear || (new Date().getFullYear() - personalInfo.spouseAge);
    const myFRA = myBirthYear >= 1960 ? 67 : (SS_FULL_RETIREMENT_AGE[myBirthYear] || 67);
    const spouseFRA = spouseBirthYear >= 1960 ? 67 : (SS_FULL_RETIREMENT_AGE[spouseBirthYear] || 67);
    
    const claimingAges = [62, 63, 64, 65, 66, 67, 68, 69, 70];
    
    const myBenefits = claimingAges.map(age => ({
      age,
      monthlyBenefit: calculateSSBenefit(myPIA, age, myBirthYear),
      annualBenefit: calculateSSBenefit(myPIA, age, myBirthYear) * 12,
      percentOfFRA: Math.round((calculateSSBenefit(myPIA, age, myBirthYear) / myPIA) * 100)
    }));
    
    const calculateCumulative = (pia, claimAge, birthYear, endAge) => {
      const annualBenefit = calculateSSBenefit(pia, claimAge, birthYear) * 12;
      const yearsReceiving = Math.max(0, endAge - claimAge);
      return annualBenefit * yearsReceiving;
    };
    
    const myCumulativeData = claimingAges.map(claimAge => ({
      claimAge,
      cumulative: calculateCumulative(myPIA, claimAge, myBirthYear, lifeExpectancy),
      breakeven62: claimAge > 62 ? calculateSSBreakeven(myPIA, 62, claimAge, myBirthYear) : null,
      breakeven67: claimAge > 67 ? calculateSSBreakeven(myPIA, 67, claimAge, myBirthYear) : null
    }));
    
    const myOptimalAge = myCumulativeData.reduce((best, current) => 
      current.cumulative > best.cumulative ? current : best
    ).claimAge;
    
    const spouseOptimalAge = claimingAges.reduce((best, age) => {
      const cumulative = calculateCumulative(spousePIA, age, spouseBirthYear, spouseLifeExpectancy);
      return cumulative > best.cumulative ? { age, cumulative } : best;
    }, { age: 62, cumulative: 0 }).age;
    
    const updateMyClaimAge = (newAge) => {
      if (mySSStream) {
        const newBenefit = calculateSSBenefit(myPIA, newAge, myBirthYear) * 12;
        setIncomeStreams(incomeStreams.map(s => 
          s.id === mySSStream.id ? { ...s, startAge: newAge, amount: newBenefit, pia: myPIA } : s
        ));
      }
    };
    
    const updateSpouseClaimAge = (newAge) => {
      if (spouseSSStream) {
        const newBenefit = calculateSSBenefit(spousePIA, newAge, spouseBirthYear) * 12;
        setIncomeStreams(incomeStreams.map(s => 
          s.id === spouseSSStream.id ? { ...s, startAge: newAge, amount: newBenefit, pia: spousePIA } : s
        ));
      }
    };
    
    const cumulativeChartData = [];
    for (let age = 62; age <= 95; age++) {
      const dataPoint = { age };
      claimingAges.forEach(claimAge => {
        if (age >= claimAge) {
          const yearsReceiving = age - claimAge;
          const annualBenefit = calculateSSBenefit(myPIA, claimAge, myBirthYear) * 12;
          dataPoint[`claim${claimAge}`] = annualBenefit * yearsReceiving;
        }
      });
      cumulativeChartData.push(dataPoint);
    }
    
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-xl font-semibold text-slate-100 mb-2">Social Security Claiming Strategy Optimizer</h3>
          <p className="text-slate-400 text-sm">Compare benefits at different claiming ages and find your optimal strategy based on life expectancy.</p>
        </div>
        
        {/* Current Plan Summary */}
        <div className={`${cardStyle} border-l-4 border-l-amber-500`}>
          <h4 className="text-lg font-semibold text-amber-400 mb-3">Your Current Plan</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <div>
                <p className="text-slate-400 text-sm">My Claiming Age</p>
                <p className="text-2xl font-bold text-slate-100">{myCurrentClaimAge}</p>
                <p className="text-slate-500 text-xs">{formatCurrency(calculateSSBenefit(myPIA, myCurrentClaimAge, myBirthYear) * 12)}/year</p>
              </div>
              <select value={myCurrentClaimAge} onChange={e => updateMyClaimAge(Number(e.target.value))} className={`${inputStyle} w-24`}>
                {claimingAges.map(age => <option key={age} value={age}>{age}</option>)}
              </select>
            </div>
            {personalInfo.filingStatus === 'married_joint' && spouseSSStream && (
              <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                <div>
                  <p className="text-slate-400 text-sm">Spouse Claiming Age</p>
                  <p className="text-2xl font-bold text-slate-100">{spouseCurrentClaimAge}</p>
                  <p className="text-slate-500 text-xs">{formatCurrency(calculateSSBenefit(spousePIA, spouseCurrentClaimAge, spouseBirthYear) * 12)}/year</p>
                </div>
                <select value={spouseCurrentClaimAge} onChange={e => updateSpouseClaimAge(Number(e.target.value))} className={`${inputStyle} w-24`}>
                  {claimingAges.map(age => <option key={age} value={age}>{age}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className={cardStyle}>
            <h4 className="text-lg font-semibold text-amber-400 mb-4">Your Social Security</h4>
            <div className="space-y-4">
              <div>
                <label className={labelStyle}>Primary Insurance Amount (PIA) at FRA</label>
                <input type="number" value={myPIA} onChange={e => setMyPIA(Number(e.target.value))} className={inputStyle} />
                <p className="text-xs text-slate-500 mt-1">Monthly benefit at Full Retirement Age ({myFRA}). Find this on your SSA statement.</p>
              </div>
              <div>
                <label className={labelStyle}>Your Life Expectancy</label>
                <input type="number" value={lifeExpectancy} onChange={e => setLifeExpectancy(Number(e.target.value))} className={inputStyle} />
              </div>
              <div className="p-3 bg-emerald-900/30 border border-emerald-700/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-emerald-300 text-sm font-medium">Optimal Claiming Age: {myOptimalAge}</p>
                    <p className="text-emerald-400/70 text-xs mt-1">Based on life expectancy of {lifeExpectancy}</p>
                  </div>
                  {myCurrentClaimAge !== myOptimalAge && (
                    <button onClick={() => updateMyClaimAge(myOptimalAge)} className={`${buttonPrimary} text-xs py-1 px-3`}>
                      Use {myOptimalAge}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {personalInfo.filingStatus === 'married_joint' && (
            <div className={cardStyle}>
              <h4 className="text-lg font-semibold text-amber-400 mb-4">Spouse's Social Security</h4>
              <div className="space-y-4">
                <div>
                  <label className={labelStyle}>Spouse's PIA at FRA</label>
                  <input type="number" value={spousePIA} onChange={e => setSpousePIA(Number(e.target.value))} className={inputStyle} />
                </div>
                <div>
                  <label className={labelStyle}>Spouse Life Expectancy</label>
                  <input type="number" value={spouseLifeExpectancy} onChange={e => setSpouseLifeExpectancy(Number(e.target.value))} className={inputStyle} />
                </div>
                <div className="p-3 bg-emerald-900/30 border border-emerald-700/50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <p className="text-emerald-300 text-sm font-medium">Spouse Optimal Age: {spouseOptimalAge}</p>
                    {spouseSSStream && spouseCurrentClaimAge !== spouseOptimalAge && (
                      <button onClick={() => updateSpouseClaimAge(spouseOptimalAge)} className={`${buttonPrimary} text-xs py-1 px-3`}>
                        Use {spouseOptimalAge}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-amber-400 mb-4">Monthly Benefits by Claiming Age</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 px-3 text-slate-400">Claiming Age</th>
                  <th className="text-right py-2 px-3 text-slate-400">% of PIA</th>
                  <th className="text-right py-2 px-3 text-slate-400">Monthly</th>
                  <th className="text-right py-2 px-3 text-slate-400">Annual</th>
                  <th className="text-right py-2 px-3 text-slate-400">Breakeven vs 62</th>
                  <th className="text-right py-2 px-3 text-slate-400">Cumulative at {lifeExpectancy}</th>
                  <th className="text-center py-2 px-3 text-slate-400">Action</th>
                </tr>
              </thead>
              <tbody>
                {myBenefits.map((row) => {
                  const cumulativeInfo = myCumulativeData.find(d => d.claimAge === row.age);
                  const isOptimal = row.age === myOptimalAge;
                  const isCurrent = row.age === myCurrentClaimAge;
                  return (
                    <tr key={row.age} className={`border-b border-slate-700/50 ${isOptimal ? 'bg-emerald-900/20' : ''} ${isCurrent ? 'bg-amber-900/20' : ''}`}>
                      <td className="py-2 px-3 text-slate-200">
                        {row.age} {row.age === Math.round(myFRA) && <span className="text-amber-400 text-xs">(FRA)</span>}
                        {isOptimal && <span className="ml-2 text-emerald-400 text-xs">★ Optimal</span>}
                        {isCurrent && <span className="ml-2 text-amber-400 text-xs">◆ Current</span>}
                      </td>
                      <td className="text-right py-2 px-3 text-slate-300">{row.percentOfFRA}%</td>
                      <td className="text-right py-2 px-3 text-slate-200">{formatCurrency(row.monthlyBenefit)}</td>
                      <td className="text-right py-2 px-3 text-slate-200">{formatCurrency(row.annualBenefit)}</td>
                      <td className="text-right py-2 px-3 text-slate-400">
                        {cumulativeInfo?.breakeven62 ? `Age ${cumulativeInfo.breakeven62}` : '—'}
                      </td>
                      <td className="text-right py-2 px-3 text-emerald-400">{formatCurrency(cumulativeInfo?.cumulative || 0)}</td>
                      <td className="text-center py-2 px-3">
                        {!isCurrent && (
                          <button onClick={() => updateMyClaimAge(row.age)} className="text-xs text-amber-400 hover:text-amber-300">
                            Select
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-amber-400 mb-4">Cumulative Lifetime Benefits</h4>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={cumulativeChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="age" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} formatter={(value) => [formatCurrency(value), '']} />
              <Legend />
              <ReferenceLine x={lifeExpectancy} stroke="#f59e0b" strokeDasharray="5 5" />
              <Line type="monotone" dataKey="claim62" name="Claim at 62" stroke="#ef4444" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="claim67" name="Claim at 67" stroke="#eab308" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="claim70" name="Claim at 70" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-amber-400 mb-4">Key Insights</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <p className="text-slate-300 font-medium">Claiming at 62 vs 70</p>
              <p className="text-slate-400 mt-1">Monthly difference: {formatCurrency(myBenefits.find(b => b.age === 70)?.monthlyBenefit - myBenefits.find(b => b.age === 62)?.monthlyBenefit)}</p>
              <p className="text-slate-400">Breakeven age: {calculateSSBreakeven(myPIA, 62, 70, myBirthYear) || 'N/A'}</p>
            </div>
            <div className="p-3 bg-slate-800/50 rounded-lg">
              <p className="text-slate-300 font-medium">Lifetime Difference</p>
              <p className="text-emerald-400 mt-1">
                Waiting to 70 vs 62: {formatCurrency(calculateCumulative(myPIA, 70, myBirthYear, lifeExpectancy) - calculateCumulative(myPIA, 62, myBirthYear, lifeExpectancy))}
              </p>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            COMPREHENSIVE PORTFOLIO IMPACT ANALYSIS
            Runs full projection engine for each combination of claiming ages.
            For single filers: varies your age 62-70.
            For married: explores grid of your age × spouse age.
            Accounts for: taxes, RMDs, withdrawal priority, Roth conversions,
            survivor SS benefits, state taxes, FICA, and one-time events.
            ═══════════════════════════════════════════════════════════════════ */}
        {(() => {
          const legacyAge = personalInfo.legacyAge || 95;
          const isMarried = personalInfo.filingStatus === 'married_joint' && spouseSSStream;
          
          // For married: build grid of my × spouse claiming ages
          // For single: just vary my age
          const myAges = [62, 64, 66, 67, 68, 70];
          const spouseAges = isMarried ? [62, 64, 66, 67, 68, 70] : [null];
          
          const allScenarios = [];
          myAges.forEach(myClaimAge => {
            spouseAges.forEach(spClaimAge => {
              const modifiedStreams = incomeStreams.map(s => {
                if (s.type === 'social_security' && s.owner === 'me') {
                  const newBenefit = calculateSSBenefit(myPIA, myClaimAge, myBirthYear) * 12;
                  return { ...s, startAge: myClaimAge, amount: newBenefit, pia: myPIA };
                }
                if (s.type === 'social_security' && s.owner === 'spouse' && spClaimAge !== null) {
                  const newBenefit = calculateSSBenefit(spousePIA, spClaimAge, spouseBirthYear) * 12;
                  return { ...s, startAge: spClaimAge, amount: newBenefit, pia: spousePIA };
                }
                return s;
              });
              
              const proj = computeProjections(personalInfo, accounts, modifiedStreams, assets, oneTimeEvents, recurringExpenses);
              
              const retirementYears = proj.filter(p => p.myAge >= personalInfo.myRetirementAge);
              const lifetimeTax = retirementYears.reduce((sum, p) => sum + p.totalTax, 0);
              const lifetimeWithdrawals = retirementYears.reduce((sum, p) => sum + p.portfolioWithdrawal, 0);
              const lifetimeSS = retirementYears.reduce((sum, p) => sum + p.socialSecurity, 0);
              const atLegacy = proj.find(p => p.myAge === legacyAge);
              const at75 = proj.find(p => p.myAge === 75);
              const at80 = proj.find(p => p.myAge === 80);
              const at85 = proj.find(p => p.myAge === 85);
              
              allScenarios.push({
                myClaimAge, spClaimAge,
                label: isMarried ? `Me ${myClaimAge} / Spouse ${spClaimAge}` : `Claim at ${myClaimAge}`,
                myAnnualSS: calculateSSBenefit(myPIA, myClaimAge, myBirthYear) * 12,
                spAnnualSS: spClaimAge !== null ? calculateSSBenefit(spousePIA, spClaimAge, spouseBirthYear) * 12 : 0,
                portfolioAt75: at75?.totalPortfolio || 0,
                portfolioAt80: at80?.totalPortfolio || 0,
                portfolioAt85: at85?.totalPortfolio || 0,
                portfolioAtLegacy: atLegacy?.totalPortfolio || 0,
                lifetimeTax,
                lifetimeWithdrawals,
                lifetimeSS,
                netLifetimeWealth: (atLegacy?.totalPortfolio || 0) + lifetimeSS,
                projections: proj
              });
            });
          });
          
          // Find winners
          const bestByWealth = allScenarios.reduce((b, c) => c.netLifetimeWealth > b.netLifetimeWealth ? c : b);
          const bestByPortfolio = allScenarios.reduce((b, c) => c.portfolioAtLegacy > b.portfolioAtLegacy ? c : b);
          const lowestTax = allScenarios.reduce((b, c) => c.lifetimeTax < b.lifetimeTax ? c : b);
          const lowestWithdrawals = allScenarios.reduce((b, c) => c.lifetimeWithdrawals < b.lifetimeWithdrawals ? c : b);
          const currentScenario = allScenarios.find(s => s.myClaimAge === myCurrentClaimAge && (s.spClaimAge === spouseCurrentClaimAge || s.spClaimAge === null)) 
            || allScenarios.find(s => s.myClaimAge === myCurrentClaimAge) || allScenarios[0];
          
          // Sort by net lifetime wealth descending
          const ranked = [...allScenarios].sort((a, b) => b.netLifetimeWealth - a.netLifetimeWealth);
          
          // Portfolio chart data for top scenarios
          const chartScenarios = [
            allScenarios.find(s => s.myClaimAge === 62 && (s.spClaimAge === 62 || s.spClaimAge === null)),
            allScenarios.find(s => s.myClaimAge === 67 && (s.spClaimAge === 67 || s.spClaimAge === null)),
            allScenarios.find(s => s.myClaimAge === 70 && (s.spClaimAge === 70 || s.spClaimAge === null)),
            bestByWealth.myClaimAge !== 62 && bestByWealth.myClaimAge !== 67 && bestByWealth.myClaimAge !== 70 ? bestByWealth : null,
            isMarried ? allScenarios.find(s => s.myClaimAge === 70 && s.spClaimAge === 62) : null
          ].filter(Boolean);
          
          const portfolioChartData = [];
          if (chartScenarios.length > 0) {
            const baseProj = chartScenarios[0].projections;
            for (let i = 0; i < baseProj.length; i++) {
              const row = { age: baseProj[i]?.myAge };
              if (row.age === undefined) break;
              chartScenarios.forEach(s => {
                const yr = s.projections.find(p => p.myAge === row.age);
                row[s.label] = yr?.totalPortfolio || 0;
              });
              portfolioChartData.push(row);
            }
          }
          
          const chartColors = ['#ef4444', '#eab308', '#22c55e', '#8b5cf6', '#3b82f6'];
          
          return (
            <>
              {/* Winner Summary */}
              <div className={`${cardStyle} border-l-4 border-l-emerald-500`}>
                <h4 className="text-lg font-semibold text-emerald-400 mb-3">📊 Full Plan Impact Analysis</h4>
                <p className="text-slate-400 text-sm mb-4">
                  {isMarried 
                    ? `Runs your complete retirement plan for ${myAges.length * spouseAges.length} combinations of your and your spouse's claiming ages — including taxes, withdrawals, RMDs, growth, and survivor benefits — to show the true financial impact.`
                    : 'Runs your complete retirement plan for each claiming age — including taxes, portfolio withdrawals, RMDs, and growth — to show the true financial impact beyond simple breakeven math.'}
                </p>
                {isMarried && personalInfo.survivorModelEnabled && (
                  <div className="mb-4 p-3 bg-sky-900/30 border border-sky-700/50 rounded-lg text-sm">
                    <p className="text-sky-300 font-medium">👤 Survivor benefits are modeled</p>
                    <p className="text-sky-400/70 text-xs mt-1">When the first spouse passes, the survivor inherits the higher of the two SS benefits. Claiming later as the higher earner increases the survivor benefit — this is factored into every scenario below.</p>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-3 bg-slate-800/50 rounded-lg">
                    <p className="text-slate-500 text-xs uppercase tracking-wide">Highest Net Wealth</p>
                    <p className="text-xl font-bold text-emerald-400">{bestByWealth.label}</p>
                    <p className="text-slate-400 text-xs mt-1">{formatCurrency(bestByWealth.netLifetimeWealth)}</p>
                  </div>
                  <div className="p-3 bg-slate-800/50 rounded-lg">
                    <p className="text-slate-500 text-xs uppercase tracking-wide">Largest Legacy</p>
                    <p className="text-xl font-bold text-sky-400">{bestByPortfolio.label}</p>
                    <p className="text-slate-400 text-xs mt-1">{formatCurrency(bestByPortfolio.portfolioAtLegacy)} at {legacyAge}</p>
                  </div>
                  <div className="p-3 bg-slate-800/50 rounded-lg">
                    <p className="text-slate-500 text-xs uppercase tracking-wide">Lowest Taxes</p>
                    <p className="text-xl font-bold text-purple-400">{lowestTax.label}</p>
                    <p className="text-slate-400 text-xs mt-1">{formatCurrency(lowestTax.lifetimeTax)}</p>
                  </div>
                  <div className="p-3 bg-slate-800/50 rounded-lg">
                    <p className="text-slate-500 text-xs uppercase tracking-wide">Fewest Withdrawals</p>
                    <p className="text-xl font-bold text-orange-400">{lowestWithdrawals.label}</p>
                    <p className="text-slate-400 text-xs mt-1">{formatCurrency(lowestWithdrawals.lifetimeWithdrawals)}</p>
                  </div>
                </div>
              </div>

              {/* Ranked Comparison Table */}
              <div className={cardStyle}>
                <h4 className="text-lg font-semibold text-amber-400 mb-2">All Scenarios Ranked by Net Lifetime Wealth</h4>
                <p className="text-xs text-slate-500 mb-3">Net Wealth = portfolio at age {legacyAge} + total SS received during retirement. Lifetime taxes and withdrawals are summed from retirement through {legacyAge}.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-2 px-2 text-slate-400">#</th>
                        <th className="text-left py-2 px-2 text-slate-400">{isMarried ? 'My Age / Spouse Age' : 'Claim Age'}</th>
                        {isMarried && <th className="text-right py-2 px-2 text-slate-400">Combined SS</th>}
                        <th className="text-right py-2 px-2 text-slate-400">Portfolio @{legacyAge}</th>
                        <th className="text-right py-2 px-2 text-slate-400">Lifetime SS</th>
                        <th className="text-right py-2 px-2 text-slate-400">Lifetime Taxes</th>
                        <th className="text-right py-2 px-2 text-slate-400">Withdrawals</th>
                        <th className="text-right py-2 px-2 text-slate-400">Net Wealth</th>
                        <th className="text-right py-2 px-2 text-slate-400">Δ vs Current</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranked.map((s, i) => {
                        const isCurrent = s === currentScenario;
                        const isBest = i === 0;
                        const delta = s.netLifetimeWealth - currentScenario.netLifetimeWealth;
                        return (
                          <tr key={s.label} className={`border-b border-slate-700/50 ${isBest ? 'bg-emerald-900/20' : ''} ${isCurrent ? 'bg-amber-900/20' : ''}`}>
                            <td className="py-2 px-2 text-slate-500">{i + 1}</td>
                            <td className="py-2 px-2 text-slate-200">
                              {s.label}
                              {isBest && <span className="ml-1 text-emerald-400 text-xs">★</span>}
                              {isCurrent && <span className="ml-1 text-amber-400 text-xs">◆ Current</span>}
                            </td>
                            {isMarried && <td className="text-right py-2 px-2 text-slate-300">{formatCurrency(s.myAnnualSS + s.spAnnualSS)}/yr</td>}
                            <td className={`text-right py-2 px-2 font-medium ${s.portfolioAtLegacy > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {formatCurrency(s.portfolioAtLegacy)}
                            </td>
                            <td className="text-right py-2 px-2 text-sky-400">{formatCurrency(s.lifetimeSS)}</td>
                            <td className="text-right py-2 px-2 text-purple-400">{formatCurrency(s.lifetimeTax)}</td>
                            <td className="text-right py-2 px-2 text-orange-400">{formatCurrency(s.lifetimeWithdrawals)}</td>
                            <td className="text-right py-2 px-2 text-emerald-400 font-semibold">{formatCurrency(s.netLifetimeWealth)}</td>
                            <td className={`text-right py-2 px-2 font-medium ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                              {isCurrent ? '—' : `${delta >= 0 ? '+' : ''}${formatCurrency(delta)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {isMarried && (
                <div className={cardStyle}>
                  <h4 className="text-lg font-semibold text-amber-400 mb-2">Portfolio at Age {legacyAge} — Heat Map</h4>
                  <p className="text-xs text-slate-500 mb-3">Each cell shows the ending portfolio value. Green = highest, red = lowest. Rows = your claiming age, columns = spouse's claiming age.</p>
                  <div className="overflow-x-auto">
                    <table className="text-sm">
                      <thead>
                        <tr>
                          <th className="py-2 px-3 text-slate-400 text-left">Me ↓ / Spouse →</th>
                          {spouseAges.filter(a => a !== null).map(a => (
                            <th key={a} className="py-2 px-3 text-slate-400 text-center">{a}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {myAges.map(myAge => (
                          <tr key={myAge} className="border-t border-slate-700/50">
                            <td className="py-2 px-3 text-slate-300 font-medium">{myAge}</td>
                            {spouseAges.filter(a => a !== null).map(spAge => {
                              const s = allScenarios.find(x => x.myClaimAge === myAge && x.spClaimAge === spAge);
                              const val = s?.portfolioAtLegacy || 0;
                              const maxVal = bestByPortfolio.portfolioAtLegacy;
                              const minVal = Math.min(...allScenarios.map(x => x.portfolioAtLegacy));
                              const range = maxVal - minVal || 1;
                              const pct = (val - minVal) / range;
                              const isCur = myAge === myCurrentClaimAge && spAge === spouseCurrentClaimAge;
                              // Color: red(0) -> yellow(0.5) -> green(1)
                              const r = pct < 0.5 ? 220 : Math.round(220 - (pct - 0.5) * 2 * 180);
                              const g = pct < 0.5 ? Math.round(80 + pct * 2 * 140) : 220;
                              const bg = `rgba(${r}, ${g}, 80, 0.15)`;
                              return (
                                <td key={spAge} className={`py-2 px-3 text-center text-xs ${isCur ? 'ring-2 ring-amber-500 rounded' : ''}`} style={{ backgroundColor: bg }}>
                                  <span className="text-slate-200">{formatCurrency(val)}</span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">◆ Amber ring = your current plan</p>
                </div>
              )}

              {/* Portfolio Chart */}
              <div className={cardStyle}>
                <h4 className="text-lg font-semibold text-amber-400 mb-4">Portfolio Value Over Time — Key Scenarios</h4>
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={portfolioChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="age" stroke="#94a3b8" label={{ value: 'Your Age', position: 'insideBottom', offset: -5, fill: '#94a3b8' }} />
                    <YAxis stroke="#94a3b8" tickFormatter={v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} 
                      formatter={(value, name) => [formatCurrency(value), name]} 
                    />
                    <Legend />
                    <ReferenceLine x={personalInfo.myRetirementAge} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: 'Retire', fill: '#f59e0b', fontSize: 11 }} />
                    {chartScenarios.map((s, i) => (
                      <Line key={s.label} type="monotone" dataKey={s.label} stroke={chartColors[i % chartColors.length]} 
                        strokeWidth={s === currentScenario ? 3 : 1.5} dot={false} 
                        strokeDasharray={s === bestByWealth ? undefined : undefined} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-xs text-slate-500 mt-2">
                  {isMarried 
                    ? 'Shows both-claim-early, both-at-FRA, both-claim-late, and the asymmetric strategy (higher earner late / lower earner early) that is often recommended.'
                    : 'Shows portfolio trajectories for early (62), FRA (67), and delayed (70) claiming.'}
                </p>
              </div>

              {/* Planning Notes */}
              <div className={`${cardStyle} bg-slate-800/30`}>
                <h4 className="text-lg font-semibold text-slate-300 mb-3">📝 What to Consider</h4>
                <div className="space-y-2 text-sm text-slate-400">
                  <p>These projections use your actual plan data — tax brackets, withdrawal priority, RMD schedules, Roth conversions, and state taxes are all calculated for each scenario. A few things to keep in mind:</p>
                  <p><span className="text-slate-300 font-medium">Taxes are complex:</span> More SS income means more SS is taxable (up to 85%), but it also means fewer withdrawals from tax-deferred accounts, which reduces taxable income from that source. These effects partially offset, which is why the tax differences between scenarios are often smaller than expected.</p>
                  <p><span className="text-slate-300 font-medium">Portfolio preservation:</span> Claiming later means drawing down your portfolio faster in the gap years before SS starts. But once the higher benefit kicks in, withdrawals drop and the portfolio recovers — sometimes significantly. The chart above shows these crossover dynamics clearly.</p>
                  {isMarried && <p><span className="text-slate-300 font-medium">Survivor benefits matter:</span> {personalInfo.survivorModelEnabled ? 'Your survivor modeling is ON — when the first spouse passes, the survivor inherits the higher SS benefit. This significantly favors the higher earner claiming later.' : '⚠️ Your survivor modeling is currently OFF. Enable it in Plan Settings to see how the surviving spouse inheriting the higher SS benefit affects these results — it often changes the optimal strategy.'}</p>}
                  <p><span className="text-slate-300 font-medium">Life expectancy uncertainty:</span> These projections assume you live to age {legacyAge}. If longevity is shorter, earlier claiming may win; if longer, delayed claiming becomes increasingly valuable. The breakeven analysis above helps quantify this tradeoff.</p>
                </div>
              </div>
            </>
          );
        })()}
      </div>
    );
  };

  // ============================================
  // SCENARIO COMPARISON TAB
  // ============================================
  const ScenarioComparisonTab = () => {
    const [newScenarioName, setNewScenarioName] = useState('');
    const [selectedScenarios, setSelectedScenarios] = useState([]);
    
    const generateScenarioProjections = (scenario) => {
      return computeProjections(
        scenario.personalInfo, 
        scenario.accounts, 
        scenario.incomeStreams, 
        scenario.assets || assets, // fallback to current assets for old saved scenarios missing assets
        scenario.oneTimeEvents || oneTimeEvents, // fallback to current events
        scenario.recurringExpenses || recurringExpenses // fallback to current expenses
      );
    };
    
    const currentSummary = (() => {
      const retYears = projections.filter(p => p.myAge >= personalInfo.myRetirementAge);
      const legAge = personalInfo.legacyAge || 95;
      return {
        name: 'Current Plan', retirementAge: personalInfo.myRetirementAge,
        projectedAt65: projections.find(p => p.myAge === 65)?.totalPortfolio || 0,
        projectedAt80: projections.find(p => p.myAge === 80)?.totalPortfolio || 0,
        projectedAt95: projections.find(p => p.myAge === legAge)?.totalPortfolio || 0,
        lifetimeTax: retYears.reduce((sum, p) => sum + p.totalTax, 0),
        lifetimeIRMAA: retYears.reduce((sum, p) => sum + (p.irmaaSurcharge || 0), 0),
        lifetimeSS: retYears.reduce((sum, p) => sum + p.socialSecurity, 0),
        netWealth: (projections.find(p => p.myAge === legAge)?.totalPortfolio || 0) + retYears.reduce((sum, p) => sum + p.socialSecurity, 0)
      };
    })();
    
    const scenarioSummaries = scenarios.map(s => {
      const proj = generateScenarioProjections(s);
      const retYears = proj.filter(p => p.myAge >= s.personalInfo.myRetirementAge);
      const legAge = s.personalInfo.legacyAge || personalInfo.legacyAge || 95;
      return {
        ...s,
        projectedAt65: proj.find(p => p.myAge === 65)?.totalPortfolio || 0,
        projectedAt80: proj.find(p => p.myAge === 80)?.totalPortfolio || 0,
        projectedAt95: proj.find(p => p.myAge === legAge)?.totalPortfolio || 0,
        lifetimeTax: retYears.reduce((sum, p) => sum + p.totalTax, 0),
        lifetimeIRMAA: retYears.reduce((sum, p) => sum + (p.irmaaSurcharge || 0), 0),
        lifetimeSS: retYears.reduce((sum, p) => sum + p.socialSecurity, 0),
        netWealth: (proj.find(p => p.myAge === legAge)?.totalPortfolio || 0) + retYears.reduce((sum, p) => sum + p.socialSecurity, 0)
      };
    });
    
    const handleCreateScenario = () => {
      if (newScenarioName.trim()) {
        createScenario(newScenarioName.trim());
        setNewScenarioName('');
      }
    };
    
    const toggleScenarioSelection = (id) => {
      setSelectedScenarios(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
    };
    
    const comparisonChartData = projections.slice(0, 51).map(p => {
      const dataPoint = { age: p.myAge, 'Current Plan': p.totalPortfolio };
      selectedScenarios.forEach(id => {
        const scenario = scenarios.find(s => s.id === id);
        if (scenario) {
          const proj = generateScenarioProjections(scenario);
          const yearData = proj.find(pr => pr.myAge === p.myAge);
          dataPoint[scenario.name] = yearData?.totalPortfolio || 0;
        }
      });
      return dataPoint;
    });
    
    const chartColors = ['#f59e0b', '#22c55e', '#3b82f6', '#ef4444', '#8b5cf6'];
    
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-xl font-semibold text-slate-100 mb-2">Scenario Comparison</h3>
          <p className="text-slate-400 text-sm">Create and compare multiple "what-if" scenarios.</p>
        </div>
        
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-amber-400 mb-4">Create New Scenario</h4>
          <div className="flex gap-3">
            <input type="text" value={newScenarioName} onChange={e => setNewScenarioName(e.target.value)}
              placeholder="Scenario name (e.g., 'Retire at 60')" className={`${inputStyle} flex-1`} />
            <button onClick={handleCreateScenario} className={buttonPrimary} disabled={!newScenarioName.trim()}>
              Save Current as Scenario
            </button>
          </div>
        </div>
        
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-amber-400 mb-4">Saved Scenarios ({scenarios.length})</h4>
          {scenarios.length === 0 ? (
            <p className="text-slate-400 text-sm">No scenarios saved yet. Create one above to start comparing.</p>
          ) : (
            <div className="space-y-3">
              {scenarios.map((scenario) => (
                <div key={scenario.id} className={`p-4 rounded-lg border ${selectedScenarios.includes(scenario.id) ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700 bg-slate-800/50'}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <input type="checkbox" checked={selectedScenarios.includes(scenario.id)}
                          onChange={() => toggleScenarioSelection(scenario.id)} className="w-4 h-4" />
                        <p className="font-medium text-slate-200">{scenario.name}</p>
                        {activeScenarioId === scenario.id && (
                          <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">Active</span>
                        )}
                      </div>
                      <p className="text-slate-400 text-xs mt-1">
                        Retirement age: {scenario.personalInfo.myRetirementAge} | Created: {new Date(scenario.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => loadScenario(scenario.id)} className={buttonSecondary + ' text-xs'}>Load</button>
                      <button onClick={() => deleteScenario(scenario.id)} className="text-red-400 hover:text-red-300 text-xs px-3 py-1">Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {scenarios.length > 0 && (
          <div className={cardStyle}>
            <h4 className="text-lg font-semibold text-amber-400 mb-4">Portfolio Comparison</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 px-3 text-slate-400">Scenario</th>
                    <th className="text-right py-2 px-3 text-slate-400">Retire Age</th>
                    <th className="text-right py-2 px-3 text-slate-400">Portfolio at 65</th>
                    <th className="text-right py-2 px-3 text-slate-400">Portfolio at 80</th>
                    <th className="text-right py-2 px-3 text-slate-400">Portfolio at {personalInfo.legacyAge || 95}</th>
                    <th className="text-right py-2 px-3 text-slate-400">Lifetime Taxes</th>
                    <th className="text-right py-2 px-3 text-slate-400">IRMAA</th>
                    <th className="text-right py-2 px-3 text-slate-400">Net Wealth</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-700/50 bg-amber-900/10">
                    <td className="py-2 px-3 text-amber-400 font-medium">Current Plan</td>
                    <td className="text-right py-2 px-3 text-slate-300">{personalInfo.myRetirementAge}</td>
                    <td className="text-right py-2 px-3 text-slate-200">{formatCurrency(currentSummary.projectedAt65)}</td>
                    <td className="text-right py-2 px-3 text-slate-200">{formatCurrency(currentSummary.projectedAt80)}</td>
                    <td className="text-right py-2 px-3 text-slate-200">{formatCurrency(currentSummary.projectedAt95)}</td>
                    <td className="text-right py-2 px-3 text-purple-400">{formatCurrency(currentSummary.lifetimeTax)}</td>
                    <td className="text-right py-2 px-3 text-red-400">{formatCurrency(currentSummary.lifetimeIRMAA)}</td>
                    <td className="text-right py-2 px-3 text-emerald-400 font-medium">{formatCurrency(currentSummary.netWealth)}</td>
                  </tr>
                  {scenarioSummaries.map(s => (
                    <tr key={s.id} className="border-b border-slate-700/50">
                      <td className="py-2 px-3 text-slate-200">{s.name}</td>
                      <td className="text-right py-2 px-3 text-slate-300">{s.personalInfo.myRetirementAge}</td>
                      <td className="text-right py-2 px-3 text-slate-200">{formatCurrency(s.projectedAt65)}</td>
                      <td className="text-right py-2 px-3 text-slate-200">{formatCurrency(s.projectedAt80)}</td>
                      <td className="text-right py-2 px-3 text-slate-200">{formatCurrency(s.projectedAt95)}</td>
                      <td className="text-right py-2 px-3 text-purple-400">{formatCurrency(s.lifetimeTax)}</td>
                      <td className="text-right py-2 px-3 text-red-400">{formatCurrency(s.lifetimeIRMAA)}</td>
                      <td className="text-right py-2 px-3 text-emerald-400 font-medium">{formatCurrency(s.netWealth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        
        {selectedScenarios.length > 0 && (
          <div className={cardStyle}>
            <h4 className="text-lg font-semibold text-amber-400 mb-4">Portfolio Projection Comparison</h4>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={comparisonChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="age" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" tickFormatter={(v) => `$${(v/1000000).toFixed(1)}M`} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} formatter={(value) => [formatCurrency(value), '']} />
                <Legend />
                <Line type="monotone" dataKey="Current Plan" stroke="#f59e0b" strokeWidth={2} dot={false} />
                {selectedScenarios.map((id, idx) => {
                  const scenario = scenarios.find(s => s.id === id);
                  return scenario ? (
                    <Line key={id} type="monotone" dataKey={scenario.name} stroke={chartColors[(idx + 1) % chartColors.length]} strokeWidth={2} dot={false} />
                  ) : null;
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  };

  const FAQTab = () => {
    const [openSection, setOpenSection] = useState(null);
    
    const faqs = [
      {
        category: "Income Calculations",
        items: [
          {
            q: "How is earned income calculated during working years?",
            a: "Earned income (salary/wages) is treated as an income stream. The annual amount you enter grows each year by the COLA % you specify until the end age. For example, if you enter $65,000 with a 2% COLA starting at age 45 and ending at age 64, you'll earn $65,000 at 45, $66,300 at 46, and so on. The income stops completely after the end age."
          },
          {
            q: "How is Social Security calculated?",
            a: "Social Security is modeled as an income stream starting at your specified claiming age. The annual amount grows by the COLA % each year (default 2-3%). The PIA (Primary Insurance Amount) field is used by the Social Security analysis tab to model different claiming ages. Social Security benefits are taxed progressively using IRS combined income thresholds — 0%, up to 50%, or up to 85% may be taxable depending on your total income (see the Tax Planning tab for details)."
          },
          {
            q: "How are pension and other income streams handled?",
            a: "All income streams (pension, rental, business, annuity, other) work the same way: they pay the specified annual amount, adjusted by COLA each year, between the start and end ages. All non-Social Security income is treated as 100% taxable."
          },
          {
            q: "When am I considered 'retired' in the projections?",
            a: "Retirement begins at the 'Retirement Age' you set in Personal Info (your age, not spouse's). Once that age is reached, the engine begins drawing from your portfolio to supplement income. You can still have earned income during retirement (e.g., part-time work) — the planner simply draws less from the portfolio since your income covers more of the spending need. FICA payroll taxes apply to any earned income regardless of retirement status."
          }
        ]
      },
      {
        category: "Account & Investment Calculations",
        items: [
          {
            q: "How do account balances grow?",
            a: "Each account balance grows by its specified CAGR (Compound Annual Growth Rate) every year. Growth is applied after contributions are added. For example, a 7% CAGR means your balance is multiplied by 1.07 each year."
          },
          {
            q: "How do contributions work?",
            a: "Contributions are added to accounts each year between the start and stop ages you specify. If you set a contribution growth rate (Contrib +%), your contribution amount increases by that percentage each year. For example, $6,500 with 2% growth becomes $6,630 the next year."
          },
          {
            q: "What's the difference between Pre-Tax, Roth, and Brokerage accounts?",
            a: "Pre-Tax accounts (401k, Traditional IRA, 457b): Contributions reduce taxable income (not modeled here), withdrawals are fully taxable, and Required Minimum Distributions (RMDs) apply at age 75. Roth accounts (Roth 401k, Roth IRA, Roth 457b): Withdrawals are tax-free, no RMDs required. Brokerage accounts: Taxable accounts with no special tax treatment in this model - withdrawals are added to taxable income (simplified assumption)."
          },
          {
            q: "How are Required Minimum Distributions (RMDs) calculated?",
            a: "RMDs are calculated for pre-tax accounts starting at age 75 (per SECURE 2.0 Act for those born 1960+). The RMD amount equals the account balance divided by the IRS Uniform Lifetime Table factor for your age. For example, at age 75 the factor is 24.6, so a $1M balance requires a ~$40,650 RMD."
          }
        ]
      },
      {
        category: "Tax Calculations",
        items: [
          {
            q: "How are federal taxes calculated?",
            a: "Federal taxes use the 2026 progressive tax brackets (per IRS Revenue Procedure 2025-32) for your selected filing status, with the standard deduction applied first. Both the standard deduction and tax brackets are adjusted for inflation each year using your specified inflation rate. The brackets are: 10%, 12%, 22%, 24%, 32%, 35%, and 37%. FICA payroll taxes (6.2% Social Security up to the wage base + 1.45% Medicare + 0.9% Additional Medicare Tax for high earners) are also applied to earned income."
          },
          {
            q: "What is the standard deduction?",
            a: "The standard deduction is subtracted from your gross income before calculating taxes. 2026 base amounts: Single $16,100, Married Filing Jointly $32,200, Married Filing Separately $16,100, Head of Household $24,150. These amounts are adjusted upward each year by the inflation rate you specify."
          },
          {
            q: "How are state taxes calculated?",
            a: "State taxes use a simplified flat rate approximation for each state, with the inflation-adjusted standard deduction also applied. For example, Texas and Florida are 0%, California is 9.3%, New York is 10.9%. States that fully exempt retirement income (pension + 401k/IRA distributions) — including Alabama, Illinois, Mississippi, Pennsylvania, and Hawaii — automatically exclude those amounts from state taxable income. Social Security is also excluded from state tax in the 41 states that don't tax it. This is still a simplification — actual state taxes often have their own brackets, deductions, and partial exemption rules."
          },
          {
            q: "What income is considered taxable?",
            a: "Gross income includes: 100% of earned income, pension/annuity/other income, and portfolio withdrawals from pre-tax accounts (taxed as ordinary income). Social Security is taxed progressively based on 'combined income' (AGI + 50% of SS benefits): For married filing jointly, 0% is taxable if combined income is under $32,000, up to 50% taxable between $32,000-$44,000, and up to 85% taxable above $44,000. Brokerage withdrawals are taxed as long-term capital gains at 15%. Roth withdrawals are not taxable. The standard deduction is then subtracted from ordinary income to calculate taxable income."
          },
          {
            q: "Are tax brackets adjusted for inflation?",
            a: "Yes! Both the federal tax brackets and standard deduction are adjusted each year using your specified inflation rate (default 3%). This prevents 'bracket creep' where inflation pushes you into higher tax brackets over time. The adjustment uses the same rate as your retirement income inflation adjustment."
          },
          {
            q: "What are the 2026 tax bracket thresholds?",
            a: "For Married Filing Jointly: 10% up to $24,800, 12% up to $100,800, 22% up to $211,400, 24% up to $403,550, 32% up to $512,450, 35% up to $768,700, and 37% above. For Single filers, the brackets are roughly half these amounts. These thresholds are adjusted for inflation in future projection years."
          },
          {
            q: "How is Social Security taxed?",
            a: "Social Security benefits are taxed based on your 'combined income' (AGI + 50% of SS benefits + tax-exempt interest). For married filing jointly: If combined income is under $32,000, benefits are not taxed. Between $32,000-$44,000, up to 50% is taxable. Above $44,000, up to 85% is taxable. Single filers have lower thresholds: $25,000 and $34,000. This calculator accurately models these progressive taxation rules, which typically results in lower taxes than the old 85% assumption."
          },
          {
            q: "When do Required Minimum Distributions (RMDs) start?",
            a: "Under the SECURE 2.0 Act, RMD age depends on your birth year: Age 72 for those born in 1950 or earlier, Age 73 for those born 1951-1959, Age 75 for those born 1960 or later. This calculator uses your birth year (auto-calculated from your age, or you can edit it manually) to determine the correct RMD start age. RMDs apply to traditional 401(k)s, traditional IRAs, and similar pre-tax accounts."
          },
          {
            q: "How are brokerage account withdrawals taxed?",
            a: "Brokerage account withdrawals use a 50% cost basis estimate (i.e., half is return of principal, half is gain). The gain portion is taxed at long-term capital gains rates using the tiered 0%/15%/20% structure based on your total taxable income. For married filing jointly in 2025, gains are taxed at 0% up to ~$96,700 of taxable income, 15% up to ~$600,000, and 20% above that. These thresholds are inflation-adjusted each year. The Net Investment Income Tax (NIIT) of 3.8% also applies for high earners above $250,000 MAGI (married filing jointly)."
          }
        ]
      },
      {
        category: "Retirement Spending & Withdrawals",
        items: [
          {
            q: "How is 'Desired Retirement Income' used?",
            a: "The desired retirement income represents your target annual after-tax spending in today's dollars. It's adjusted upward by the inflation rate each year. During retirement, the model calculates how much you need to withdraw from your portfolio so that after paying taxes, your net (take-home) income equals this target."
          },
          {
            q: "How are portfolio withdrawals determined?",
            a: "During retirement, the model 'grosses up' withdrawals to account for taxes. It first calculates your net income from guaranteed sources (SS + pension + other, minus taxes on those). Then it determines how much additional withdrawal is needed so that after paying taxes on the withdrawal, you end up with your desired income. The withdrawal is the larger of this calculated amount or your RMD. This ensures your Net Income column matches your Desired Income."
          },
          {
            q: "Which accounts are withdrawals taken from?",
            a: "Withdrawals follow the priority order you set in Plan Settings (under Withdrawal Priority). The default is: Pre-Tax first, then Brokerage & HSA, then Roth. Pre-tax withdrawals are fully taxable, brokerage withdrawals use a 50% cost basis estimate taxed at capital gains rates, and Roth withdrawals are tax-free. You can drag to reorder the priority — for example, drawing from Roth first to keep taxable income low in early retirement."
          },
          {
            q: "What if my portfolio runs out?",
            a: "The projections will show a $0 or negative portfolio balance if withdrawals exceed available funds. This indicates you may need to reduce spending, work longer, save more, or adjust your plan. The model continues calculations but results become less meaningful once the portfolio is depleted."
          }
        ]
      },
      {
        category: "One-Time Events",
        items: [
          {
            q: "How do one-time events work?",
            a: "One-time events let you model expenses or income at a specific age — things like a home renovation, inheritance, car purchase, or college tuition. Expenses increase how much you need to withdraw that year. Taxable income events add to your gross income and taxes. Non-taxable income (inheritance, gifts) directly reduces your withdrawal need without adding to taxable income."
          },
          {
            q: "Are one-time events inflation-adjusted?",
            a: "Each event has an 'inflation adjusted' toggle. When enabled, the amount grows by the inflation rate from today until the year it occurs. A $50,000 event at age 75 with 3% inflation and you currently at age 55 would become about $90,300 in actual dollars when it hits."
          }
        ]
      },
      {
        category: "Charitable Giving & QCD",
        items: [
          {
            q: "How is charitable giving modeled?",
            a: "The charitable giving percentage (set in Plan Settings) is applied to your desired retirement income each year during retirement. For example, 5% charitable giving on a $100,000 desired income means $5,000 per year goes to charity. This does not reduce your withdrawal — it's part of your spending."
          },
          {
            q: "What are Qualified Charitable Distributions (QCDs)?",
            a: "QCDs allow you to donate directly from a traditional IRA to charity after age 70½, up to $105,000/year (2024 limit, inflation-adjusted). The donated amount counts toward your RMD but is excluded from taxable income. The model automatically uses QCDs to offset charitable giving when you have RMDs, reducing your tax bill."
          }
        ]
      },
      {
        category: "Roth Conversions",
        items: [
          {
            q: "How are Roth conversions modeled?",
            a: "You can model Roth conversions in two modes. Fixed Amount converts a specific dollar amount each year between your start and end ages. Bracket Fill automatically converts up to the top of a specified tax bracket (e.g., fill the 22% bracket) each year, which varies based on your other income. Both modes move funds from pre-tax to Roth accounts, adding the converted amount to taxable income that year."
          },
          {
            q: "When should I consider Roth conversions?",
            a: "The gap years between retirement and RMDs (or SS) are often ideal — your taxable income is low, so conversions are taxed at lower brackets. Converting reduces future RMDs and grows tax-free in Roth. The Tax Planning tab models this year-by-year. The tradeoff is paying taxes now vs. later."
          }
        ]
      },
      {
        category: "Non-Liquid Assets",
        items: [
          {
            q: "What are non-liquid assets and how do they affect projections?",
            a: "Non-liquid assets (real estate, vehicles, business equity) are tracked for net worth purposes but do not fund retirement spending. They appreciate (or depreciate) at the rate you specify, and any associated debt reduces toward your payoff age. These show up in your Total Net Worth but not in your portfolio balance."
          }
        ]
      },
      {
        category: "Survivor Modeling",
        items: [
          {
            q: "What does survivor modeling do?",
            a: "When enabled (Plan Settings), the projection models what happens financially when the first spouse passes away at their specified life expectancy. The surviving spouse inherits the higher of the two Social Security benefits, loses the deceased spouse's other income, switches to Single filing status (with its lower bracket thresholds and standard deduction), and continues drawing from all accounts."
          },
          {
            q: "Why does survivor modeling change my plan significantly?",
            a: "Switching from Married Filing Jointly to Single roughly halves the tax bracket thresholds, which can push the survivor into higher brackets. Losing one SS benefit (replaced by the higher of the two) reduces guaranteed income. This is why the higher earner claiming SS later is often recommended — it maximizes the survivor benefit. The SS Analysis tab models this explicitly."
          }
        ]
      },
      {
        category: "Social Security Claiming Analysis",
        items: [
          {
            q: "How does the full plan SS analysis work?",
            a: "The analysis runs your complete retirement plan for each combination of claiming ages (yours and your spouse's). For each scenario, it calculates portfolio values, lifetime taxes, total withdrawals, and net lifetime wealth using the full projection engine — not simplified breakeven math. This captures the tax interactions, withdrawal effects, and survivor benefit dynamics."
          },
          {
            q: "What is Net Lifetime Wealth in the SS analysis?",
            a: "Net Lifetime Wealth equals portfolio value at your legacy age plus total Social Security received during retirement. This combines what remains in your accounts with what SS paid you over your lifetime, giving a single number to compare claiming strategies holistically."
          },
          {
            q: "Why are the tax differences between claiming ages smaller than expected?",
            a: "Two offsetting effects: Claiming later means higher SS income, and up to 85% of that is taxable. But it also means fewer withdrawals from tax-deferred accounts, which reduces that taxable income. These partially cancel out. The analysis captures both effects because it runs the full tax calculation for every year of every scenario."
          },
          {
            q: "How are Medicare IRMAA surcharges modeled?",
            a: "IRMAA (Income-Related Monthly Adjustment Amount) adds surcharges to Medicare Part B and Part D premiums when your MAGI exceeds certain thresholds. The model calculates IRMAA for each person age 65+ based on that year's MAGI, using the 2025 CMS brackets adjusted for inflation. The surcharge is included in total taxes and increases your withdrawal need — different SS claiming ages produce different MAGI profiles, which can push you into or out of IRMAA tiers. For married couples, each eligible spouse pays their own surcharge."
          },
          {
            q: "What is the Social Security earnings test?",
            a: "If you claim SS before Full Retirement Age (FRA) and are still earning above the annual limit ($23,400 in 2025, inflation-adjusted), $1 of SS benefits is withheld for every $2 earned above the limit. In the year you reach FRA, the limit is higher ($62,160 in 2025) and only $1 per $3 is withheld. After FRA there is no limit. The model automatically applies this reduction to any year where you are collecting SS, earning income, and below FRA. Note: SSA recalculates your benefit upward at FRA to credit the withheld months, but the cash flow impact during those years is real and affects portfolio withdrawals."
          }
        ]
      },
      {
        category: "Inflation & Growth Assumptions",
        items: [
          {
            q: "How is inflation applied?",
            a: "The inflation rate you specify (default 3%) is applied to: (1) your desired retirement income target, (2) the standard deduction, and (3) federal tax brackets. It compounds annually. Income stream COLAs are separate and specified per stream."
          },
          {
            q: "What CAGR should I use for investments?",
            a: "Historical stock market returns average 7-10% nominally, or 4-7% after inflation. A 7% CAGR is a common assumption for a balanced portfolio. Conservative investors might use 5-6%, aggressive investors 8-9%. Remember: past performance doesn't guarantee future results."
          },
          {
            q: "Are the tax brackets adjusted for inflation?",
            a: "Yes! Tax brackets and the standard deduction are both adjusted each year using your specified inflation rate. This prevents 'bracket creep' and provides more realistic long-term tax projections."
          }
        ]
      },
      {
        category: "Monte Carlo Simulation",
        items: [
          {
            q: "What is a Monte Carlo simulation?",
            a: "Monte Carlo simulation runs thousands of randomized scenarios to test how your retirement plan performs under different market conditions. Instead of assuming a fixed return every year, it uses random returns drawn from a probability distribution based on historical market behavior."
          },
          {
            q: "How does the simulation work?",
            a: "For each simulation: (1) Random annual returns are generated using a normal distribution with the mean and standard deviation you specify. (2) Random inflation rates are generated similarly. (3) Your portfolio grows or shrinks based on these random returns while withdrawals are made to fund retirement spending. (4) The simulation tracks whether your portfolio survives to age 95. This is repeated thousands of times to calculate the probability of success."
          },
          {
            q: "What do the parameters mean?",
            a: "Mean Return: The average annual return (7% is typical for a balanced portfolio). Volatility/Std Dev: How much returns vary year-to-year (15% is typical for stocks). Higher volatility means more uncertainty. Inflation Mean/Std Dev: Similar parameters for inflation variability."
          },
          {
            q: "What is a good success rate?",
            a: "90%+ is considered excellent - your plan can handle most bad scenarios. 75-90% is good but consider having flexibility. 50-75% suggests moderate risk - consider adjustments. Below 50% indicates high risk of running out of money. Many financial planners target 80-90% success rates."
          },
          {
            q: "What are the limitations of Monte Carlo?",
            a: "The simulation assumes returns follow a normal (bell curve) distribution, but real markets have 'fat tails' - extreme events happen more often than the model predicts. It also assumes returns are independent year-to-year (no momentum or mean reversion). Sequence of returns risk may be underestimated. Use results as a guide, not a guarantee."
          },
          {
            q: "How should I use the percentile bands?",
            a: "The bands show the range of possible outcomes. The 50th percentile (median) is the most likely outcome. The 10th-25th percentile shows poor scenarios to plan for. If even your 25th percentile outcome is acceptable, your plan is robust. If your 50th percentile barely works, you have significant risk."
          }
        ]
      },
      {
        category: "Data & Privacy",
        items: [
          {
            q: "Where is my data stored?",
            a: "All data is stored locally in your browser's localStorage. Nothing is sent to any server. Your data stays on your device and persists between sessions in the same browser."
          },
          {
            q: "How do I backup my data?",
            a: "Use the Import/Export button in the header to download a JSON backup file. This file contains all your personal info, accounts, and income streams. You can import this file later to restore your data."
          },
          {
            q: "How do I clear my data for sharing?",
            a: "Use Import/Export → 'Clear My Data' to reset everything to sample defaults. This removes your personal data from the browser. Export a backup first if you want to restore your data later."
          }
        ]
      },
      {
        category: "Limitations & Disclaimers",
        items: [
          {
            q: "What are the main limitations of this tool?",
            a: "This is a comprehensive but simplified planning tool. Key limitations: Uses standard deduction only (no itemized), simplified state tax rates (flat rates with retirement income exemptions for qualifying states — partial exemptions in other states are not modeled), no tax-loss harvesting, no estate planning, no healthcare costs modeling (beyond IRMAA surcharges), brokerage cost basis is estimated at 50% (actual depends on your purchase history). Features included: Configurable withdrawal priority ordering, Roth conversion modeling (fixed-amount and bracket-fill), QCD optimization, FICA payroll taxes on earned income, tiered capital gains rates (0%/15%/20%), NIIT surtax, Medicare IRMAA surcharges (Part B + Part D based on MAGI), Social Security earnings test for early claimers still working, survivor modeling with SS benefit inheritance, one-time events (expenses and income), charitable giving, non-liquid asset tracking, full-plan SS claiming age analysis, and Monte Carlo stress testing. Results are estimates for planning purposes only."
          },
          {
            q: "Should I use this for actual financial decisions?",
            a: "This tool is for educational and planning purposes only. It is not financial advice. For important financial decisions, consult with a qualified financial advisor, tax professional, or CFP who can consider your complete financial picture."
          },
          {
            q: "How accurate are the projections?",
            a: "Projections are based on the assumptions you enter and simplified calculations. Actual results will vary due to: market volatility, tax law changes, inflation variations, healthcare costs, life events, and many other factors. Use this as a directional planning tool, not a precise forecast."
          },
          {
            q: "What tax calculations are included?",
            a: "Federal income tax uses 2026 brackets (inflation-adjusted) with standard deduction. Capital gains uses tiered rates (0%/15%/20%) based on taxable income. Net Investment Income Tax (NIIT) of 3.8% applies to high earners. Social Security taxation uses correct IRS thresholds. State taxes use simplified flat rates with retirement income exemptions for 14 qualifying states. FICA payroll taxes (Social Security 6.2% + Medicare 1.45%) are calculated on earned income during working years, including Additional Medicare Tax (0.9%) for high earners."
          }
        ]
      }
    ];
    
    const toggleSection = (idx) => {
      setOpenSection(openSection === idx ? null : idx);
    };
    
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-xl font-semibold text-slate-100 mb-2">Assumptions & Methodology FAQ</h3>
          <p className="text-slate-400 text-sm">Understanding how this retirement planner calculates your projections. Click each question to expand.</p>
        </div>
        
        {faqs.map((section, sectionIdx) => (
          <div key={sectionIdx} className={cardStyle}>
            <h4 className="text-lg font-semibold text-amber-400 mb-4">{section.category}</h4>
            <div className="space-y-2">
              {section.items.map((item, itemIdx) => {
                const idx = `${sectionIdx}-${itemIdx}`;
                const isOpen = openSection === idx;
                return (
                  <div key={itemIdx} className="border border-slate-700/50 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleSection(idx)}
                      className="w-full text-left px-4 py-3 bg-slate-800/50 hover:bg-slate-800 transition-colors flex justify-between items-center"
                    >
                      <span className="text-slate-200 font-medium pr-4">{item.q}</span>
                      <span className="text-amber-400 text-lg flex-shrink-0">{isOpen ? '−' : '+'}</span>
                    </button>
                    {isOpen && (
                      <div className="px-4 py-3 bg-slate-900/50 text-slate-300 text-sm leading-relaxed">
                        {item.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        
        <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
          <p className="text-amber-300 text-sm">
            <strong>Disclaimer:</strong> This tool is for educational and planning purposes only. It does not constitute financial, tax, or investment advice. Consult with qualified professionals before making financial decisions.
          </p>
        </div>
      </div>
    );
  };

  // ============================================
  // Guided Setup Wizard
  // ============================================
  const SetupWizard = ({ onComplete, onExplore, existingData }) => {
    const [step, setStep] = useState(0);
    const yr = new Date().getFullYear();
    const hasExisting = existingData && existingData.personalInfo;
    
    // Build pre-populated state from existing data
    const buildFromExisting = () => {
      const pi = existingData.personalInfo;
      const accts = existingData.accounts || [];
      const incomes = existingData.incomeStreams || [];
      const assets = existingData.assets || [];
      const hasSpouse = pi.filingStatus === 'married_joint' || pi.filingStatus === 'married_separate' || incomes.some(i => i.owner === 'spouse');
      
      // Find salary streams for the "Current Income" step display
      const mySalaryStream = incomes.find(i => i.type === 'earned_income' && i.owner === 'me');
      const spouseSalaryStream = incomes.find(i => i.type === 'earned_income' && i.owner === 'spouse');
      
      return {
        myAge: pi.myAge || '', spouseAge: pi.spouseAge || '', hasSpouse,
        filingStatus: pi.filingStatus || 'married_joint', state: pi.state || 'Alabama',
        myRetirementAge: pi.myRetirementAge || 65, spouseRetirementAge: pi.spouseRetirementAge || 65,
        // Current income step still uses simple fields for salary display
        mySalary: mySalaryStream ? String(mySalaryStream.amount) : '',
        spouseSalary: spouseSalaryStream ? String(spouseSalaryStream.amount) : '',
        mySalaryGrowth: mySalaryStream ? Number((mySalaryStream.cola * 100).toFixed(1)) : 2,
        // Accounts — all fields as display strings
        accounts: accts.map(a => ({
          id: a.id, name: a.name, type: a.type,
          balance: String(a.balance || 0), contribution: String(a.contribution || 0),
          contributionGrowth: String(Number(((a.contributionGrowth || 0) * 100).toFixed(2))),
          cagr: String(Number(((a.cagr || 0.07) * 100).toFixed(2))),
          startAge: String(a.startAge || ''), stopAge: String(a.stopAge || ''),
          owner: a.owner || 'me', contributor: a.contributor || 'both',
        })),
        // Income streams — all fields as display strings
        incomes: incomes.map(i => ({
          id: i.id, name: i.name, type: i.type,
          amount: String(i.amount || 0), startAge: String(i.startAge || ''),
          endAge: String(i.endAge || 95), cola: String(Number(((i.cola || 0) * 100).toFixed(2))),
          owner: i.owner || 'me', ...(i.pia !== undefined ? { pia: i.pia } : {}),
        })),
        // Assets — all fields as display strings
        assets: assets.map(a => ({
          id: a.id, name: a.name, type: a.type,
          value: String(a.value || 0),
          appreciationRate: String(Number(((a.appreciationRate || 0) * 100).toFixed(2))),
          mortgage: String(a.mortgage || 0),
          mortgagePayoffAge: a.mortgagePayoffAge ? String(a.mortgagePayoffAge) : '',
        })),
        desiredRetirementIncome: pi.desiredRetirementIncome ? String(pi.desiredRetirementIncome) : '',
        charitableGivingPercent: pi.charitableGivingPercent || 0,
        inflationRate: pi.inflationRate !== undefined ? String(Number((pi.inflationRate * 100).toFixed(2))) : '3',
        withdrawalPriority: pi.withdrawalPriority || ['pretax', 'brokerage', 'roth'],
      };
    };
    
    const blankState = {
      myAge: '', spouseAge: '', hasSpouse: true,
      filingStatus: 'married_joint', state: 'Alabama',
      myRetirementAge: 65, spouseRetirementAge: 65,
      mySalary: '', spouseSalary: '', mySalaryGrowth: 2,
      accounts: [],
      incomes: [],
      assets: [],
      desiredRetirementIncome: '', charitableGivingPercent: 0,
      inflationRate: '3', withdrawalPriority: ['pretax', 'brokerage', 'roth'],
    };
    
    const [w, setW] = useState(blankState);

    const update = (field, value) => setW(prev => ({ ...prev, [field]: value }));

    const addAccount = (type) => {
      const myAge = Number(w.myAge) || 45;
      const spAge = Number(w.spouseAge) || 43;
      const myRet = Number(w.myRetirementAge) || 65;
      const templates = {
        '401k': { name: 'My 401(k)', type: '401k', balance: '', contribution: '', contributionGrowth: '2', cagr: '7', startAge: String(myAge), stopAge: String(myRet), owner: 'me', contributor: 'both' },
        'roth_401k': { name: 'My Roth 401(k)', type: 'roth_401k', balance: '', contribution: '', contributionGrowth: '2', cagr: '7', startAge: String(myAge), stopAge: String(myRet), owner: 'me', contributor: 'both' },
        'roth_ira': { name: 'My Roth IRA', type: 'roth_ira', balance: '', contribution: '', contributionGrowth: '2', cagr: '7', startAge: String(myAge), stopAge: String(myRet), owner: 'me', contributor: 'me' },
        'traditional_ira': { name: 'My Traditional IRA', type: 'traditional_ira', balance: '', contribution: '', contributionGrowth: '2', cagr: '7', startAge: String(myAge), stopAge: String(myRet), owner: 'me', contributor: 'me' },
        'brokerage': { name: 'Brokerage Account', type: 'brokerage', balance: '', contribution: '', contributionGrowth: '2', cagr: '6', startAge: String(myAge), stopAge: String(myRet), owner: 'me', contributor: 'me' },
        '403b': { name: 'My 403(b)', type: '403b', balance: '', contribution: '', contributionGrowth: '2', cagr: '7', startAge: String(myAge), stopAge: String(myRet), owner: 'me', contributor: 'both' },
        '457b': { name: 'My 457(b)', type: '457b', balance: '', contribution: '', contributionGrowth: '2', cagr: '7', startAge: String(myAge), stopAge: String(myRet), owner: 'me', contributor: 'both' },
        'hsa': { name: 'HSA', type: 'hsa', balance: '', contribution: '', contributionGrowth: '2', cagr: '6', startAge: String(myAge), stopAge: String(myRet), owner: 'me', contributor: 'me' },
      };
      setW(prev => ({ ...prev, accounts: [...prev.accounts, { ...(templates[type] || templates['401k']), id: Date.now() + Math.random() }] }));
    };
    const updateAccount = (id, field, value) => setW(prev => ({ ...prev, accounts: prev.accounts.map(a => a.id === id ? { ...a, [field]: value } : a) }));
    const removeAccount = (id) => setW(prev => ({ ...prev, accounts: prev.accounts.filter(a => a.id !== id) }));

    // Income stream management
    const addIncome = (type) => {
      const myAge = Number(w.myAge) || 45;
      const myRet = Number(w.myRetirementAge) || 65;
      const templates = {
        'earned_income': { name: 'Salary', type: 'earned_income', amount: '', startAge: String(myAge), endAge: String(myRet), cola: '2', owner: 'me' },
        'social_security': { name: 'Social Security', type: 'social_security', amount: '', startAge: '67', endAge: '95', cola: '2', owner: 'me' },
        'pension': { name: 'Pension', type: 'pension', amount: '', startAge: String(myRet), endAge: '95', cola: '1', owner: 'me' },
        'rental': { name: 'Rental Income', type: 'rental', amount: '', startAge: String(myAge), endAge: '95', cola: '2', owner: 'me' },
        'annuity': { name: 'Annuity', type: 'annuity', amount: '', startAge: String(myRet), endAge: '95', cola: '0', owner: 'me' },
        'business': { name: 'Business Income', type: 'business', amount: '', startAge: String(myAge), endAge: String(myRet), cola: '2', owner: 'me' },
        'other': { name: 'Other Income', type: 'other', amount: '', startAge: String(myAge), endAge: '95', cola: '2', owner: 'me' },
      };
      setW(prev => ({ ...prev, incomes: [...prev.incomes, { ...(templates[type] || templates['other']), id: Date.now() + Math.random() }] }));
    };
    const updateIncome = (id, field, value) => setW(prev => ({ ...prev, incomes: prev.incomes.map(i => i.id === id ? { ...i, [field]: value } : i) }));
    const removeIncome = (id) => setW(prev => ({ ...prev, incomes: prev.incomes.filter(i => i.id !== id) }));

    // Asset management
    const addAsset = (type) => {
      const templates = {
        'real_estate': { name: 'Home', type: 'real_estate', value: '', appreciationRate: '3', mortgage: '', mortgagePayoffAge: '' },
        'vehicle': { name: 'Vehicles', type: 'vehicle', value: '', appreciationRate: '-10', mortgage: '', mortgagePayoffAge: '' },
        'business': { name: 'Business', type: 'business', value: '', appreciationRate: '3', mortgage: '', mortgagePayoffAge: '' },
        'other': { name: 'Other Asset', type: 'other', value: '', appreciationRate: '0', mortgage: '', mortgagePayoffAge: '' },
      };
      setW(prev => ({ ...prev, assets: [...prev.assets, { ...(templates[type] || templates['other']), id: Date.now() + Math.random() }] }));
    };
    const updateAsset = (id, field, value) => setW(prev => ({ ...prev, assets: prev.assets.map(a => a.id === id ? { ...a, [field]: value } : a) }));
    const removeAsset = (id) => setW(prev => ({ ...prev, assets: prev.assets.filter(a => a.id !== id) }));

    const finishWizard = () => {
      const myAge = Number(w.myAge) || 45;
      const spouseAge = Number(w.spouseAge) || 43;
      const myRetAge = Number(w.myRetirementAge) || 65;
      const pct = v => (Number(v) || 0) / 100;
      
      const newPersonalInfo = {
        ...DEFAULT_PERSONAL_INFO,
        ...(existingData && existingData.personalInfo ? existingData.personalInfo : {}),
        myAge, spouseAge: w.hasSpouse ? spouseAge : myAge,
        myRetirementAge: myRetAge, spouseRetirementAge: Number(w.spouseRetirementAge) || 65,
        myBirthYear: yr - myAge, spouseBirthYear: yr - (w.hasSpouse ? spouseAge : myAge),
        filingStatus: w.filingStatus, state: w.state,
        desiredRetirementIncome: Number(w.desiredRetirementIncome) || 60000,
        charitableGivingPercent: Number(w.charitableGivingPercent) || 0,
        inflationRate: pct(w.inflationRate) || 0.03,
        withdrawalPriority: w.withdrawalPriority || ['pretax', 'brokerage', 'roth'],
      };

      const newAccounts = w.accounts.length > 0 
        ? w.accounts.map((a, idx) => ({
            id: a.id || idx + 1, name: a.name, type: a.type,
            balance: Number(a.balance) || 0, contribution: Number(a.contribution) || 0,
            contributionGrowth: pct(a.contributionGrowth),
            cagr: pct(a.cagr) || 0.07,
            startAge: Number(a.startAge) || myAge, stopAge: Number(a.stopAge) || myRetAge,
            owner: a.owner || 'me', contributor: a.contributor || 'both',
          }))
        : DEFAULT_ACCOUNTS;

      const newIncomes = w.incomes.length > 0
        ? w.incomes.map((i, idx) => ({
            id: i.id || idx + 1, name: i.name, type: i.type,
            amount: Number(i.amount) || 0,
            startAge: Number(i.startAge) || myAge, endAge: Number(i.endAge) || 95,
            cola: pct(i.cola), owner: i.owner || 'me',
            ...(i.pia !== undefined ? { pia: i.pia } : {}),
          }))
        : DEFAULT_INCOME_STREAMS;

      const newAssets = w.assets.length > 0
        ? w.assets.map((a, idx) => ({
            id: a.id || idx + 1, name: a.name, type: a.type,
            value: Number(a.value) || 0, appreciationRate: pct(a.appreciationRate),
            mortgage: Number(a.mortgage) || 0,
            mortgagePayoffAge: Number(a.mortgagePayoffAge) || null,
          }))
        : DEFAULT_ASSETS;

      onComplete(newPersonalInfo, newAccounts, newIncomes, newAssets);
    };

    const inputStyle = "w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all";
    const labelStyle = "block text-sm font-medium text-slate-300 mb-1";
    const helpStyle = "text-xs text-slate-500 mt-1";

    const steps = [
      { title: 'Welcome', icon: '👋' },
      { title: 'About You', icon: '👤' },
      { title: 'Income Streams', icon: '💼' },
      { title: 'Accounts', icon: '💰' },
      { title: 'Assets', icon: '🏠' },
      { title: 'Spending', icon: '🎯' },
      { title: 'Review', icon: '✅' },
    ];

    return (
      <div style={{position:'fixed',inset:0,zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem',backgroundColor:'rgba(0,0,0,0.8)',backdropFilter:'blur(4px)',overflow:'hidden'}}>
        <div style={{backgroundColor:'#0f172a',border:'1px solid #334155',borderRadius:'1rem',boxShadow:'0 25px 50px -12px rgba(0,0,0,.5)',width:'100%',maxWidth:'42rem',maxHeight:'90vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
          {/* Header */}
          <div style={{padding:'1.25rem 1.5rem 1rem',borderBottom:'1px solid rgba(51,65,85,0.5)',flexShrink:0}}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-100">{steps[step].icon} {steps[step].title}</h2>
              {step > 0 && <button onClick={onExplore} className="text-sm text-slate-500 hover:text-slate-300">Skip & explore →</button>}
            </div>
            {step > 0 && (
              <div className="flex gap-1">
                {steps.slice(1).map((s, idx) => (
                  <div key={idx} className="flex-1">
                    <div className={`h-1.5 rounded-full transition-colors ${idx + 1 <= step ? 'bg-amber-500' : 'bg-slate-700'}`} />
                    <span className={`text-[10px] hidden sm:block mt-1 text-center ${idx + 1 <= step ? 'text-amber-400' : 'text-slate-600'}`}>{s.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Content - scrollable */}
          <div style={{flex:'1 1 0%',minHeight:0,overflowY:'auto',padding:'1.25rem 1.5rem'}}>
            {step === 0 && (
              <div className="text-center py-6 space-y-6">
                <div className="text-5xl">📊</div>
                <h3 className="text-2xl font-bold text-slate-100">{hasExisting ? 'Plan Setup' : 'Welcome to Retirement Planner'}</h3>
                <p className="text-slate-400 max-w-md mx-auto">
                  {hasExisting 
                    ? 'You already have a plan set up. Would you like to walk through the wizard with your current data to make changes, or start over from scratch?'
                    : 'This tool projects your financial future through retirement, modeling taxes, Social Security, Required Minimum Distributions, and more.'}
                </p>
                <div className={`grid grid-cols-1 ${hasExisting ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-4 max-w-2xl mx-auto pt-4`}>
                  {hasExisting && (
                    <button onClick={() => { setW(buildFromExisting()); setStep(1); }} className="px-5 py-4 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl transition-colors text-left">
                      <div className="text-lg mb-1">✏️ Modify My Plan</div>
                      <div className="text-sm text-amber-200/80 font-normal">Walk through with your current data</div>
                    </button>
                  )}
                  <button onClick={() => { setW(blankState); setStep(1); }} className={`px-5 py-4 ${hasExisting ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'bg-amber-600 hover:bg-amber-500 text-white'} font-semibold rounded-xl transition-colors text-left`}>
                    <div className="text-lg mb-1">🚀 {hasExisting ? 'Start Fresh' : 'Set Up My Plan'}</div>
                    <div className={`text-sm ${hasExisting ? 'text-slate-400' : 'text-amber-200/80'} font-normal`}>{hasExisting ? 'Clear everything and start over' : 'Guided walkthrough (~5 min)'}</div>
                  </button>
                  <button onClick={onExplore} className="px-5 py-4 bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold rounded-xl transition-colors text-left">
                    <div className="text-lg mb-1">{hasExisting ? '← Go Back' : '🔍 Explore First'}</div>
                    <div className="text-sm text-slate-400 font-normal">{hasExisting ? 'Keep current plan as-is' : 'Browse with sample data'}</div>
                  </button>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <p className="text-sm text-slate-400">These basics drive the entire projection timeline.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className={labelStyle}>My Current Age</label><input type="number" value={w.myAge} onChange={e => update('myAge', e.target.value)} placeholder="45" className={inputStyle} /></div>
                  <div><label className={labelStyle}>My Retirement Age</label><input type="number" value={w.myRetirementAge} onChange={e => update('myRetirementAge', e.target.value)} placeholder="65" className={inputStyle} /><p className={helpStyle}>When you plan to stop working</p></div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={w.hasSpouse} onChange={e => update('hasSpouse', e.target.checked)} className="w-4 h-4 rounded border-slate-600 text-amber-500 focus:ring-amber-500/50" />
                  <span className="text-sm text-slate-300">I have a spouse/partner to include</span>
                </label>
                {w.hasSpouse && (
                  <div className="grid grid-cols-2 gap-4 pl-6 border-l-2 border-amber-500/30">
                    <div><label className={labelStyle}>Spouse Age</label><input type="number" value={w.spouseAge} onChange={e => update('spouseAge', e.target.value)} placeholder="43" className={inputStyle} /></div>
                    <div><label className={labelStyle}>Spouse Retirement Age</label><input type="number" value={w.spouseRetirementAge} onChange={e => update('spouseRetirementAge', e.target.value)} placeholder="65" className={inputStyle} /></div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div><label className={labelStyle}>Filing Status</label><select value={w.filingStatus} onChange={e => update('filingStatus', e.target.value)} className={inputStyle}><option value="married_joint">Married Filing Jointly</option><option value="single">Single</option><option value="head_of_household">Head of Household</option><option value="married_separate">Married Filing Separately</option></select></div>
                  <div><label className={labelStyle}>State</label><select value={w.state} onChange={e => update('state', e.target.value)} className={inputStyle}>{Object.keys(STATE_TAX_RATES).map(s => <option key={s} value={s}>{s}</option>)}</select><p className={helpStyle}>For state tax calculations</p></div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <p className="text-sm text-slate-400">Add all income sources — current employment, Social Security, pensions, rental, etc.</p>
                <div className="space-y-2">
                  {w.incomes.map(i => (
                    <div key={i.id} className="p-2.5 bg-slate-800/60 rounded-lg border border-slate-700/50">
                      <div className="flex items-center justify-between mb-2">
                        <input type="text" value={i.name} onChange={e => updateIncome(i.id, 'name', e.target.value)} className="bg-transparent border-none text-slate-100 font-medium focus:outline-none text-sm flex-1 min-w-0" />
                        <button onClick={() => removeIncome(i.id)} className="text-red-400/70 hover:text-red-400 text-xs font-medium ml-2 shrink-0">Delete</button>
                      </div>
                      <div className="grid grid-cols-6 gap-2">
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Type</label><select value={i.type} onChange={e => updateIncome(i.id, 'type', e.target.value)} className={`${inputStyle} text-xs py-1.5`}><option value="earned_income">Salary/Wages</option><option value="social_security">Social Security</option><option value="pension">Pension</option><option value="rental">Rental</option><option value="business">Business</option><option value="annuity">Annuity</option><option value="other">Other</option></select></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Annual Amt</label><div className="relative"><span className="absolute left-2 top-1.5 text-slate-500 text-xs">$</span><input type="text" inputMode="numeric" value={i.amount ? Number(i.amount).toLocaleString() : ''} onChange={e => updateIncome(i.id, 'amount', e.target.value.replace(/[^0-9]/g, ''))} className={`${inputStyle} text-xs py-1.5 pl-5`} /></div></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Start Age</label><input type="number" value={i.startAge} onChange={e => updateIncome(i.id, 'startAge', e.target.value)} className={`${inputStyle} text-xs py-1.5`} /></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">End Age</label><input type="number" value={i.endAge} onChange={e => updateIncome(i.id, 'endAge', e.target.value)} className={`${inputStyle} text-xs py-1.5`} /></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">COLA %</label><input type="number" step="0.1" value={i.cola} onChange={e => updateIncome(i.id, 'cola', e.target.value)} className={`${inputStyle} text-xs py-1.5`} /></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Owner</label><select value={i.owner} onChange={e => updateIncome(i.id, 'owner', e.target.value)} className={`${inputStyle} text-xs py-1.5`}><option value="me">Me</option>{w.hasSpouse && <option value="spouse">Spouse</option>}</select></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div><p className="text-xs text-slate-500 mb-2">Add income:</p>
                  <div className="flex flex-wrap gap-2">
                    {[['earned_income','Salary'],['social_security','Social Security'],['pension','Pension'],['rental','Rental'],['business','Business'],['annuity','Annuity'],['other','Other']].map(([t,l]) => (
                      <button key={t} onClick={() => addIncome(t)} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors">+ {l}</button>
                    ))}
                  </div>
                </div>
                {w.incomes.length === 0 && <div className="p-4 bg-amber-900/20 border border-amber-700/30 rounded-lg"><p className="text-sm text-amber-300">💡 Add at least your salary. Check <span className="text-amber-400">ssa.gov/myaccount</span> for Social Security estimates.</p></div>}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <p className="text-sm text-slate-400">Add each retirement/investment account with all details.</p>
                <div className="space-y-2">
                  {w.accounts.map(a => (
                    <div key={a.id} className="p-2.5 bg-slate-800/60 rounded-lg border border-slate-700/50">
                      <div className="flex items-center justify-between mb-2">
                        <input type="text" value={a.name} onChange={e => updateAccount(a.id, 'name', e.target.value)} className="bg-transparent border-none text-slate-100 font-medium focus:outline-none text-sm flex-1 min-w-0" />
                        <button onClick={() => removeAccount(a.id)} className="text-red-400/70 hover:text-red-400 text-xs font-medium ml-2 shrink-0">Delete</button>
                      </div>
                      <div className="grid grid-cols-4 gap-2 mb-1.5">
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Type</label><select value={a.type} onChange={e => updateAccount(a.id, 'type', e.target.value)} className={`${inputStyle} text-xs py-1.5`}><option value="401k">401(k)</option><option value="roth_401k">Roth 401(k)</option><option value="403b">403(b)</option><option value="roth_403b">Roth 403(b)</option><option value="roth_ira">Roth IRA</option><option value="traditional_ira">Traditional IRA</option><option value="brokerage">Brokerage</option><option value="457b">457(b)</option><option value="roth_457b">Roth 457(b)</option><option value="hsa">HSA</option></select></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Balance</label><div className="relative"><span className="absolute left-2 top-1.5 text-slate-500 text-xs">$</span><input type="text" inputMode="numeric" value={a.balance ? Number(a.balance).toLocaleString() : ''} onChange={e => updateAccount(a.id, 'balance', e.target.value.replace(/[^0-9]/g, ''))} className={`${inputStyle} text-xs py-1.5 pl-5`} /></div></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Annual Contrib.</label><div className="relative"><span className="absolute left-2 top-1.5 text-slate-500 text-xs">$</span><input type="text" inputMode="numeric" value={a.contribution ? Number(a.contribution).toLocaleString() : ''} onChange={e => updateAccount(a.id, 'contribution', e.target.value.replace(/[^0-9]/g, ''))} className={`${inputStyle} text-xs py-1.5 pl-5`} /></div></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Contrib +%/yr</label><input type="number" step="0.1" value={a.contributionGrowth} onChange={e => updateAccount(a.id, 'contributionGrowth', e.target.value)} className={`${inputStyle} text-xs py-1.5`} /></div>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">CAGR %</label><input type="number" step="0.1" value={a.cagr} onChange={e => updateAccount(a.id, 'cagr', e.target.value)} className={`${inputStyle} text-xs py-1.5`} /></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Start Age</label><input type="number" value={a.startAge} onChange={e => updateAccount(a.id, 'startAge', e.target.value)} className={`${inputStyle} text-xs py-1.5`} /></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Stop Age</label><input type="number" value={a.stopAge} onChange={e => updateAccount(a.id, 'stopAge', e.target.value)} className={`${inputStyle} text-xs py-1.5`} /></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Owner</label><select value={a.owner} onChange={e => updateAccount(a.id, 'owner', e.target.value)} className={`${inputStyle} text-xs py-1.5`}><option value="me">Me</option>{w.hasSpouse && <option value="spouse">Spouse</option>}<option value="joint">Joint</option></select></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Contributor</label><select value={a.contributor} onChange={e => updateAccount(a.id, 'contributor', e.target.value)} className={`${inputStyle} text-xs py-1.5`}><option value="me">Me</option><option value="employer">Employer</option><option value="both">Both</option></select></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div><p className="text-xs text-slate-500 mb-2">Add an account:</p>
                  <div className="flex flex-wrap gap-2">
                    {[['401k','401(k)'],['roth_401k','Roth 401(k)'],['roth_ira','Roth IRA'],['traditional_ira','Trad IRA'],['brokerage','Brokerage'],['403b','403(b)'],['hsa','HSA']].map(([t,l]) => (
                      <button key={t} onClick={() => addAccount(t)} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors">+ {l}</button>
                    ))}
                  </div>
                </div>
                {w.accounts.length === 0 && <div className="p-4 bg-amber-900/20 border border-amber-700/30 rounded-lg"><p className="text-sm text-amber-300">💡 Add at least one account. Start with a 401(k) if unsure.</p></div>}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <p className="text-sm text-slate-400">Non-liquid assets contribute to net worth but aren't used for retirement withdrawals. <span className="text-slate-500">(Optional)</span></p>
                <div className="space-y-2">
                  {w.assets.map(a => (
                    <div key={a.id} className="p-2.5 bg-slate-800/60 rounded-lg border border-slate-700/50">
                      <div className="flex items-center justify-between mb-2">
                        <input type="text" value={a.name} onChange={e => updateAsset(a.id, 'name', e.target.value)} className="bg-transparent border-none text-slate-100 font-medium focus:outline-none text-sm flex-1 min-w-0" />
                        <button onClick={() => removeAsset(a.id)} className="text-red-400/70 hover:text-red-400 text-xs font-medium ml-2 shrink-0">Delete</button>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Type</label><select value={a.type} onChange={e => updateAsset(a.id, 'type', e.target.value)} className={`${inputStyle} text-xs py-1.5`}><option value="real_estate">Real Estate</option><option value="vehicle">Vehicle</option><option value="business">Business</option><option value="collectibles">Collectibles</option><option value="other">Other</option></select></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Value</label><div className="relative"><span className="absolute left-2 top-1.5 text-slate-500 text-xs">$</span><input type="text" inputMode="numeric" value={a.value ? Number(a.value).toLocaleString() : ''} onChange={e => updateAsset(a.id, 'value', e.target.value.replace(/[^0-9]/g, ''))} className={`${inputStyle} text-xs py-1.5 pl-5`} /></div></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Apprec. %</label><input type="number" step="0.5" value={a.appreciationRate} onChange={e => updateAsset(a.id, 'appreciationRate', e.target.value)} className={`${inputStyle} text-xs py-1.5`} /></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Debt</label><div className="relative"><span className="absolute left-2 top-1.5 text-slate-500 text-xs">$</span><input type="text" inputMode="numeric" value={a.mortgage ? Number(a.mortgage).toLocaleString() : ''} onChange={e => updateAsset(a.id, 'mortgage', e.target.value.replace(/[^0-9]/g, ''))} className={`${inputStyle} text-xs py-1.5 pl-5`} /></div></div>
                        <div><label className="block text-[10px] text-slate-500 mb-0.5">Payoff Age</label><input type="number" value={a.mortgagePayoffAge} onChange={e => updateAsset(a.id, 'mortgagePayoffAge', e.target.value)} className={`${inputStyle} text-xs py-1.5`} /></div>
                      </div>
                    </div>
                  ))}
                </div>
                <div><p className="text-xs text-slate-500 mb-2">Add an asset:</p>
                  <div className="flex flex-wrap gap-2">
                    {[['real_estate','Home/Property'],['vehicle','Vehicle'],['business','Business'],['other','Other']].map(([t,l]) => (
                      <button key={t} onClick={() => addAsset(t)} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors">+ {l}</button>
                    ))}
                  </div>
                </div>
                {w.assets.length === 0 && <p className="text-sm text-slate-500 italic">No assets — that's fine! You can add them later.</p>}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4">
                <p className="text-sm text-slate-400">How much annual income do you want in retirement?</p>
                <div><label className={labelStyle}>Desired Annual Retirement Income</label><div className="relative"><span className="absolute left-3 top-2.5 text-slate-500">$</span><input type="text" inputMode="numeric" value={w.desiredRetirementIncome ? Number(w.desiredRetirementIncome).toLocaleString() : ''} onChange={e => update('desiredRetirementIncome', e.target.value.replace(/[^0-9]/g, ''))} placeholder="60,000" className={`${inputStyle} pl-7 text-lg`} /></div><p className={helpStyle}>In today's dollars — inflation applied automatically. Rule of thumb: 70–80% of current income.</p></div>
                <div><label className={labelStyle}>Charitable Giving (% of spending)</label><div className="relative"><input type="number" step="1" value={w.charitableGivingPercent} onChange={e => update('charitableGivingPercent', e.target.value)} className={`${inputStyle} pr-7`} /><span className="absolute right-3 top-2.5 text-slate-500">%</span></div><p className={helpStyle}>Enables QCD tax optimization. Set 0 if not applicable.</p></div>
              </div>
            )}

            {step === 6 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-400">Here's your plan summary. You can change anything later from the individual tabs.</p>
                <div className="p-3 bg-slate-800/60 rounded-lg"><div className="text-xs font-semibold text-amber-400 mb-2">ABOUT YOU</div><div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm"><span className="text-slate-500">Age:</span><span className="text-slate-200">{w.myAge || '—'}, retire at {w.myRetirementAge || '—'}</span>{w.hasSpouse && <><span className="text-slate-500">Spouse:</span><span className="text-slate-200">{w.spouseAge || '—'}, retire at {w.spouseRetirementAge || '—'}</span></>}<span className="text-slate-500">Filing / State:</span><span className="text-slate-200">{w.filingStatus.replace(/_/g, ' ')} · {w.state}</span></div></div>
                <div className="p-3 bg-slate-800/60 rounded-lg"><div className="text-xs font-semibold text-amber-400 mb-2">INCOME STREAMS ({w.incomes.length})</div>{w.incomes.length > 0 ? <div className="space-y-1 text-sm">{w.incomes.map(i => <div key={i.id} className="flex justify-between"><span className="text-slate-400">{i.name} ({i.owner})</span><span className="text-emerald-400">${Number(i.amount || 0).toLocaleString()} ages {i.startAge}–{i.endAge}</span></div>)}</div> : <p className="text-sm text-slate-500 italic">Sample defaults will be used</p>}</div>
                <div className="p-3 bg-slate-800/60 rounded-lg"><div className="text-xs font-semibold text-amber-400 mb-2">ACCOUNTS ({w.accounts.length})</div>{w.accounts.length > 0 ? <div className="space-y-1 text-sm">{w.accounts.map(a => <div key={a.id} className="flex justify-between"><span className="text-slate-400">{a.name}</span><span className="text-emerald-400">${Number(a.balance || 0).toLocaleString()} · {a.cagr}% · {a.contributor}</span></div>)}</div> : <p className="text-sm text-slate-500 italic">Sample defaults will be used</p>}</div>
                <div className="p-3 bg-slate-800/60 rounded-lg"><div className="text-xs font-semibold text-amber-400 mb-2">ASSETS ({w.assets.length})</div>{w.assets.length > 0 ? <div className="space-y-1 text-sm">{w.assets.map(a => <div key={a.id} className="flex justify-between"><span className="text-slate-400">{a.name}</span><span className="text-emerald-400">${Number(a.value || 0).toLocaleString()}</span></div>)}</div> : <p className="text-sm text-slate-500 italic">Sample defaults will be used</p>}</div>
                <div className="p-3 bg-slate-800/60 rounded-lg"><div className="text-xs font-semibold text-amber-400 mb-2">SPENDING GOAL</div><div className="text-lg font-bold text-amber-400">{Number(w.desiredRetirementIncome) > 0 ? `$${Number(w.desiredRetirementIncome).toLocaleString()}/year` : '$60,000/year (default)'}</div></div>
              </div>
            )}
          </div>

          {/* Footer nav */}
          <div style={{padding:'1rem 1.5rem',borderTop:'1px solid rgba(51,65,85,0.5)',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>{step > 0 && <button onClick={() => setStep(step - 1)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">← Back</button>}</div>
            <div className="flex gap-3">
              {step > 0 && step < 6 && <button onClick={() => setStep(step + 1)} className="px-5 py-2.5 text-sm bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg transition-colors">Continue →</button>}
              {step === 6 && <button onClick={finishWizard} className="px-6 py-2.5 text-sm bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors">✓ Launch My Plan</button>}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex">
      {/* Hide number input spinners globally for clean table cells */}
      <style>{`
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>
      {/* Setup Wizard Modal */}
      {showSetupWizard && (
        <SetupWizard
          existingData={{ personalInfo, accounts, incomeStreams, assets }}
          onComplete={(pi, accts, incomes, assetList) => {
            setPersonalInfo(pi);
            setAccounts(accts);
            setIncomeStreams(incomes);
            setAssets(assetList);
            setShowSetupWizard(false);
            setSaveStatus('Plan updated!');
            setTimeout(() => setSaveStatus(''), 3000);
          }}
          onExplore={() => setShowSetupWizard(false)}
        />
      )}
      
      {/* Sidebar Navigation */}
      <aside className={`${sidebarCollapsed ? 'w-16' : 'w-56'} flex-shrink-0 bg-slate-900/95 border-r border-slate-700/50 backdrop-blur-sm transition-all duration-300 flex flex-col`}>
        {/* Logo / Header */}
        <div className="p-4 border-b border-slate-700/50">
          {sidebarCollapsed ? (
            <div className="flex justify-center">
              <Logo size="small" />
            </div>
          ) : (
            <div className="text-center">
              <div className="mx-auto mb-3 flex justify-center">
                <Logo size="large" />
              </div>
              <h1 className="text-base font-bold text-slate-100">Retirement</h1>
              <h1 className="text-base font-bold text-slate-100 -mt-1">Planner</h1>
              <p className="text-xs text-slate-500 mt-1">v1.7</p>
            </div>
          )}
        </div>
        
        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto">
          {navGroups.map((group, idx) => (
            <NavGroup key={idx} group={group} />
          ))}
          
          {/* Utility buttons - right after nav groups */}
          <div className="mt-4 pt-4 border-t border-slate-700/50">
            <button 
              onClick={() => setShowSetupWizard(true)} 
              className="w-full flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-all"
            >
              <span className="text-base">🚀</span>
              {!sidebarCollapsed && <span className="text-sm font-medium">Guided Setup</span>}
            </button>
            <button 
              onClick={() => setShowImportExport(true)} 
              className="w-full flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-all"
            >
              <span className="text-base">💾</span>
              {!sidebarCollapsed && <span className="text-sm font-medium">Import/Export</span>}
            </button>
            <button 
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="w-full flex items-center gap-3 px-3 py-2 mt-1 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 rounded-lg transition-all"
            >
              <span className="text-base">{sidebarCollapsed ? '▶' : '◀'}</span>
              {!sidebarCollapsed && <span className="text-sm font-medium">Collapse Sidebar</span>}
            </button>
          </div>
        </nav>
      </aside>
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-14 border-b border-slate-700/50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-200">
              {navGroups.flatMap(g => g.items).find(i => i.id === activeTab)?.label || 'Dashboard'}
            </h2>
            {saveStatus && (
              <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">
                ✓ {saveStatus}
              </span>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Current Year</div>
            <div className="text-sm font-semibold text-slate-300">{currentYear}</div>
          </div>
        </header>
        
        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'dashboard' && <DashboardTab />}
            {activeTab === 'personal' && <PersonalInfoTab />}
            {activeTab === 'accounts' && <AccountsTab />}
            {activeTab === 'assets' && <AssetsTab />}
            {activeTab === 'income' && <IncomeStreamsTab />}
            {activeTab === 'socialsecurity' && <SocialSecurityTab />}
            {activeTab === 'scenarios' && <ScenarioComparisonTab />}
            {activeTab === 'taxplanning' && <TaxPlanningTab />}
            {activeTab === 'withdrawal' && <WithdrawalStrategiesTab />}
            {activeTab === 'montecarlo' && <MonteCarloTab />}
            {activeTab === 'table' && <DetailedTableTab />}
            {activeTab === 'faq' && <FAQTab />}
          </div>
        </main>
        
        {/* Footer */}
        <footer className="border-t border-slate-700/50 bg-slate-900/30 py-4 px-6">
          <p className="text-center text-xs text-slate-500">
            Your data is automatically saved to this browser. This tool is for educational purposes only.
          </p>
        </footer>
      </div>
      
      {/* Modals */}
      {showAccountModal && <AccountModal />}
      {showIncomeModal && <IncomeModal />}
      {showAssetModal && <AssetModal />}
      {showImportExport && <ImportExportModal />}
    </div>
  );
}
