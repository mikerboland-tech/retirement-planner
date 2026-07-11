// React and Recharts globals are provided by index.html
// Do not add import statements - this file runs in browser via Babel transform

// ── shared calc engine (loaded via engine.js in index.html) ──
// The desktop app consumes the single shared engine.js exactly like the mobile
// build does. All financial constants, tax/SS/Medicare/RMD helpers, and
// computeProjections come from window.PlannerEngine — there is no embedded copy
// here anymore, so the desktop, mobile, worker, and tests can never drift apart.
const PlannerEngine = (typeof window !== 'undefined' && window.PlannerEngine) || {};
const {
  MAX_AGE, BROKERAGE_COST_BASIS_ESTIMATE, MAX_ITERATIONS_FOR_TAX_CALC,
  MONTE_CARLO_TAX_ESTIMATE, SAVE_DEBOUNCE_MS, PRE_TAX_TYPES, ROTH_TYPES,
  BROKERAGE_TYPES, HSA_TYPES, isPreTaxAccount, isRothAccount, isBrokerageAccount,
  isHSAAccount, FEDERAL_TAX_BRACKETS_2026, STANDARD_DEDUCTION_2026,
  calculateFederalTax, calculateSocialSecurityTaxableAmount,
  CAPITAL_GAINS_THRESHOLDS_2025, calculateCapitalGainsTax, calculateNIIT,
  STATE_TAX_RATES, STATES_EXEMPT_RETIREMENT_INCOME,
  STATES_EXEMPT_ALL_RETIREMENT_DISTRIBUTIONS, STATES_THAT_TAX_SS,
  calculateStateTax, ALABAMA_TAX_BRACKETS, ALABAMA_PERSONAL_EXEMPTION,
  ALABAMA_OVER_65_RETIREMENT_EXCLUSION, getAlabamaStandardDeduction,
  calculateAlabamaTax, FICA_SS_RATE, FICA_SS_WAGE_BASE_2025, FICA_MEDICARE_RATE,
  FICA_ADDITIONAL_MEDICARE_RATE, FICA_ADDITIONAL_MEDICARE_THRESHOLD,
  calculateFICA, RMD_FACTORS, calculateRMD, getRmdStartAge,
  getDefaultRothConversionWindow, QCD_ANNUAL_LIMIT, QCD_START_AGE,
  SS_FULL_RETIREMENT_AGE, SS_FRA_PRE_1943, getFullRetirementAge,
  SS_EARNINGS_TEST_LIMIT_2025, SS_EARNINGS_TEST_FRA_LIMIT_2025,
  calculateSSBenefit, calculateSSEarningsTestReduction, IRMAA_THRESHOLDS_2025,
  MEDICARE_PART_B_STANDARD_2025, calculateIRMAA, calculateIRMAASurcharge,
  MEDICARE_PART_B_PREMIUM_2025, MEDICARE_PART_D_PREMIUM_2025,
  MEDICARE_SUPPLEMENT_PREMIUM_2025, MEDICARE_OOP_ANNUAL_2025,
  PRE_65_HEALTHCARE_ANNUAL_2025, MEDICAL_INFLATION_RATE,
  LTC_MONTHLY_ASSISTED_LIVING_2025, LTC_DEFAULT_DURATION_MONTHS, ACA_FPL_2025,
  calculateACASubsidy, calculateACAPremiumCredit, ACA_BENCHMARK_PREMIUM_2026,
  calculateHealthcareExpenses, calculateRecurringExpenses,
  HISTORICAL_RETURNS, getHistoricalSequence, getValidStartYears,
  computeProjections,
} = PlannerEngine;

// ============================================
// Sankey Diagram Component for Cash Flow Visualization
// ============================================
const SankeyDiagram = React.memo(({ data, width = 900, height = 500 }) => {
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

const STORAGE_KEY = 'retirement_planner_data';
// Bump this whenever the persisted data shape changes in a way an older build
// could not safely consume. loadFromStorage refuses to read anything with a
// future schemaVersion so a downgrade doesn't silently shred the user's data (B8).
// v2: account.contributionMode ('fixed' | 'percent') + employeePercent + employerMatchPercent
//     are optional; absent → engine treats as 'fixed' so older saved scenarios still load.
//     Spending-phase fields (spendingPhasesEnabled, goGoEndAge, ...) are also optional;
//     absent → engine multiplier is 1 (flat spending), so no version bump needed.
const SCHEMA_VERSION = 2;

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
  myAge: 35,
  spouseAge: 33,
  myRetirementAge: 65,
  spouseRetirementAge: 65,
  myBirthYear: 1991,  // For accurate RMD age calculation
  spouseBirthYear: 1993, // For accurate RMD age calculation
  filingStatus: 'married_joint',
  state: 'Alabama',
  desiredRetirementIncome: 95000,  // ~70% of $135K household income (conventional replacement-rate guidance)
  inflationRate: 0.03,
  withdrawalPriority: ['pretax', 'brokerage', 'roth'], // Order: first to last
  charitableGivingPercent: 0, // Percentage of retirement spending donated to charity (enables QCD strategy)
  // Planned Roth conversions: move this much per year from largest pre-tax account to largest Roth account.
  // Conversions are treated as ordinary income in the projection engine (affects taxes and SS taxation).
  rothConversionAmount: 0,       // Annual conversion amount in today's dollars (0 = disabled)
  rothConversionStartAge: 0,     // Age to begin converting (0 = use smart default: myRetirementAge)
  rothConversionEndAge: 0,       // Age to stop converting (0 = use smart default: rmdStartAge - 1)
  rothConversionBracket: '',     // If set ('22%','24%','32%'), fill to this bracket instead of fixed amount
  rothConversionTaxSource: 'withdrawal', // 'withdrawal' = tax paid via normal withdrawal priority, 'brokerage' = tax paid from brokerage account
  rothConversionPreTaxFloor: 0,  // Preserve this much pre-tax balance (today's $); stop converting once pre-tax hits it (0 = no floor)
  heirTaxRate: 0.25,             // Heirs' assumed ordinary rate on inherited PRE-TAX dollars (SECURE Act 10-year drain) — used by the Roth optimizer's after-tax legacy score
  legacyAge: 95,                 // Planning horizon / legacy target age
  // Spending phases (go-go / slow-go / no-go): staged multipliers on base
  // retirement spending. Disabled by default — flat spending is the classic
  // (conservative) assumption; enabling this models the "retirement smile."
  spendingPhasesEnabled: false,
  goGoEndAge: 75,                // Last age of the go-go phase (inclusive)
  slowGoEndAge: 85,              // Last age of the slow-go phase (inclusive); no-go after
  goGoMultiplier: 1.0,           // Spending multiplier during go-go years
  slowGoMultiplier: 0.85,        // Spending multiplier during slow-go years
  noGoMultiplier: 0.75,          // Spending multiplier during no-go years
  // Survivor modeling: when enabled, models the financial impact of a spouse dying
  // before the planning horizon ends. Changes filing status, stops income streams,
  // and applies SS survivor benefit rules.
  survivorModelEnabled: false,
  survivorSpendingFactor: 0.75,  // Surviving spouse spends this fraction of the couple's target income
  myLifeExpectancy: 85,          // Expected age at death (primary)
  spouseLifeExpectancy: 87,      // Expected age at death (spouse)
  // Healthcare expense modeling
  healthcareModel: 'none',       // 'none','basic','moderate','comprehensive','custom' — default OFF: the engine's modeled costs overestimate for most people, so users should bake healthcare into their desired spending. Opt in on the Personal tab.
  pre65HealthcareAnnual: 12000,  // Annual healthcare cost per person before Medicare (ACA/employer)
  // Pre-65 coverage model: 'flat' = fixed annual cost above; 'aca' = retired
  // under-65 members buy marketplace coverage where the premium is MAGI-driven
  // (benchmark − premium tax credit, 2026 post-ARPA rules with the 400% FPL cliff).
  pre65Coverage: 'flat',
  acaBenchmarkPremium: 14000,    // Unsubsidized silver benchmark (SLCSP) per person/yr — replace with your healthcare.gov quote
  post65OOPAnnual: 2000,         // Annual out-of-pocket after Medicare (copays, dental, vision)
  includeMedigap: true,          // Include supplemental/Medigap insurance
  ltcModel: 'none',              // 'none','default','custom' — LTC off by default so the starter scenario doesn't show two large spike clusters at ages 82–84 (my LTC window) and 86–88 (spouse's). Real risk, but a probabilistic/insurance concern that confuses first-time users looking at point-estimate cash flow. Enable on the Personal tab when ready.
  ltcMonthlyAmount: 5900,        // Custom LTC monthly cost
  ltcDurationMonths: 28,         // How many months of LTC to plan for before death
  medicalInflation: 0.05         // Healthcare-specific inflation rate
};

// contributionGrowth is set to match inflationRate (3%) so real contributions stay
// constant over the 30-year accumulation. 2% growth vs 3% inflation silently erodes
// real contributions ~1%/yr (~26% by year 30) and produces an unsustainable scenario.
const DEFAULT_ACCOUNTS = [
  { id: 1, name: 'My 401(k)', type: '401k', balance: 60000, contribution: 20000, contributionGrowth: 0.03, cagr: 0.07, startAge: 35, stopAge: 65, owner: 'me', contributor: 'both' },
  { id: 2, name: 'Spouse 401(k)', type: '401k', balance: 30000, contribution: 8000, contributionGrowth: 0.03, cagr: 0.07, startAge: 33, stopAge: 65, owner: 'spouse', contributor: 'both' },
  { id: 3, name: 'My Roth IRA', type: 'roth_ira', balance: 15000, contribution: 6000, contributionGrowth: 0.03, cagr: 0.07, startAge: 35, stopAge: 65, owner: 'me', contributor: 'me' },
  { id: 4, name: 'Savings', type: 'brokerage', balance: 15000, contribution: 2400, contributionGrowth: 0.03, cagr: 0.04, startAge: 35, stopAge: 65, owner: 'joint', contributor: 'me' }
];

// Salary COLA and SS COLA set to 3% to match inflation. Lower values silently erode
// the real purchasing power of every income stream — SS benefits set at 2% COLA
// lose ~25% of their value by age 95 vs. real-world SS which tracks CPI.
const DEFAULT_INCOME_STREAMS = [
  { id: 1, name: 'My Salary', type: 'earned_income', amount: 105000, startAge: 35, endAge: 65, cola: 0.03, owner: 'me' },
  { id: 2, name: 'Spouse Salary', type: 'earned_income', amount: 75000, startAge: 33, endAge: 65, cola: 0.03, owner: 'spouse' },
  { id: 3, name: 'My Social Security', type: 'social_security', amount: 36000, startAge: 67, endAge: 95, cola: 0.03, owner: 'me', pia: 2400 },
  { id: 4, name: 'Spouse Social Security', type: 'social_security', amount: 30000, startAge: 67, endAge: 95, cola: 0.03, owner: 'spouse', pia: 2000 }
];

const DEFAULT_ASSETS = [
  { id: 1, name: 'Primary Residence', type: 'real_estate', value: 315000, appreciationRate: 0.03, mortgage: 260000, mortgagePayoffAge: 60 },
  { id: 2, name: 'Vehicles', type: 'vehicle', value: 35000, appreciationRate: -0.10, mortgage: 0, mortgagePayoffAge: null }
];

// Recurring expenses: modeled separately from desiredRetirementIncome for granularity.
// Each expense has its own start/end age, inflation rate, and category.
// When recurringExpenses has entries, they ADD to the flat desiredRetirementIncome.
// The single placeholder below exists so the cash-flow tab isn't empty for first-time
// users — they can edit/delete it once they understand the feature.
const DEFAULT_RECURRING_EXPENSES = [
  { id: 1, name: 'Property Tax', category: 'housing', amount: 4000, startAge: 35, endAge: 95, inflationRate: 0.03, owner: 'me' }
];

const formatCurrency = (value) => {
  if (value === undefined || value === null || isNaN(value)) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
};

const formatPercent = (value) => `${(value * 100).toFixed(1)}%`;

// Load data from localStorage. Returns null when there is nothing usable —
// missing key, parse error, OR a saved schemaVersion from a future build (B8).
// Missing schemaVersion is treated as v0 (pre-versioning) and accepted; future
// migrations can branch on saved.schemaVersion here.
function loadFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > SCHEMA_VERSION) {
      console.warn(`Saved data is from a newer schema (v${parsed.schemaVersion}); this build only understands v${SCHEMA_VERSION}. Ignoring to avoid corruption.`);
      return null;
    }
    return parsed;
  } catch (e) {
    console.error('Error loading from localStorage:', e);
  }
  return null;
};

// Save data to localStorage. Returns { ok: true } or { ok: false, reason } so
// the caller can surface quota / private-mode failures instead of silently
// losing the user's edits (B7).
function saveToStorage(data) {
  try {
    const payload = { ...data, schemaVersion: SCHEMA_VERSION };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (e) {
    console.error('Error saving to localStorage:', e);
    // QuotaExceededError is the common failure (large scenarios + big monte-carlo
    // history can push us past the ~5 MB origin cap). DOMException.name covers
    // both standard and Firefox's NS_ERROR_DOM_QUOTA_REACHED variant.
    const quota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
    return { ok: false, reason: quota ? 'quota' : 'unknown', error: e };
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

// ============================================
// INPUT CELL COMPONENTS
// ============================================
// All number/percent/age cells follow a unified pattern that makes typing feel natural:
//
//   1. While focused: hold the user's typing as a raw string in local state. No
//      reformatting, no rounding, no division — what they type is what stays in
//      the field. This is critical because the previous implementation called
//      .toFixed(1) on every keystroke, which scrambled cursor position and
//      effectively prevented typing multi-digit numbers (e.g., typing "10"
//      registered as "1" because "1" → "1.0" → cursor jumped → next "0" replaced).
//
//   2. On change: store the raw string, parse-and-commit to parent only when
//      the string parses to a valid number. Empty string is allowed during typing.
//
//   3. On blur: format the final value cleanly and re-sync with parent (handles
//      cases like "1." or "" by treating them as 0).
//
//   4. On wheel: prevent the default behavior. Scroll-wheel on focused number
//      inputs is a common source of accidental value changes — we disable it.
//
//   5. Backward compatible: existing call sites use either `onChange(event)` or
//      `onValueChange(number)`. We support both — `onValueChange` is preferred
//      and takes a parsed number; `onChange` receives a synthetic event-like
//      object for compatibility with the older `e => Number(e.target.value)` pattern.

// Spreadsheet text cell — used for free-form text (no number coercion)
const SpreadsheetCell = ({ value, onChange, onCommit, className, ...props }) => (
  <input type="text" value={value} onChange={onChange} onBlur={onCommit} className={className} {...props} />
);

// Shared hook for number input behavior. Returns the props an <input> needs.
// `value` = the parent's committed numeric value
// `formatForDisplay(num)` = converts numeric value to string for display when NOT focused
// `parseFromInput(str)` = converts raw input string to numeric value to commit
// `commit(num)` = called with parsed number on change (when valid) and on blur
const useNumberInput = (value, formatForDisplay, parseFromInput, commit) => {
  const [focused, setFocused] = React.useState(false);
  const [raw, setRaw] = React.useState('');
  
  const displayValue = focused ? raw : formatForDisplay(value);
  
  return {
    value: displayValue,
    onFocus: (e) => {
      setFocused(true);
      // Pre-fill the editor with the current value (without formatting suffixes).
      // For percent: show "5" not "5.0". For age/currency: show "65" not "65.0".
      setRaw(formatForDisplay(value));
      // Select all text on focus so the user can immediately overwrite by typing.
      // This is the common spreadsheet behavior and what most users expect.
      e.target.select();
    },
    onChange: (e) => {
      const newRaw = e.target.value;
      setRaw(newRaw);
      // Commit only if it parses cleanly. Empty string / "1." / "-" stay local.
      const parsed = parseFromInput(newRaw);
      if (parsed !== null) commit(parsed);
    },
    onBlur: () => {
      setFocused(false);
      // Final commit: ensure parent has the cleaned-up value, even if the user
      // left something like "1." or "" in the field (treat as 0 or last valid).
      const parsed = parseFromInput(raw);
      if (parsed !== null) commit(parsed);
      else commit(value); // Re-commit existing value to trigger any onCommit logic
    },
    // Suppress scroll-wheel value changes — a common UX pitfall with type=number
    onWheel: (e) => e.target.blur(),
  };
};

// Currency input. Stores a plain number (dollars). Displays without commas
// in the input itself (browser-native number input doesn't support them).
const CurrencyCell = ({ value, onValueChange, onCommit, className, prefix = true, ...props }) => {
  const inputProps = useNumberInput(
    value,
    (num) => (num == null || num === 0 ? '' : String(num)),
    (str) => {
      if (str === '' || str === '-') return 0;
      const n = Number(str);
      return Number.isFinite(n) ? n : null;
    },
    (num) => onValueChange && onValueChange(num)
  );
  return (
    <div className="flex items-center justify-end">
      {prefix && <span className="text-slate-500 mr-1 text-sm">$</span>}
      <input type="number" inputMode="decimal" {...inputProps} {...props}
        onBlur={(e) => { inputProps.onBlur(e); if (onCommit) onCommit(); }}
        className={className} />
    </div>
  );
};

// Percent input. Parent stores fraction (0.05 = 5%). User types percent (5 = 5%).
// We convert: display value × 100, user input ÷ 100 on commit.
const PercentCell = ({ value, onValueChange, onCommit, className, ...props }) => {
  // Parent's value is a fraction (0.05); we work in percent display (5).
  // useNumberInput's value should be the "raw percent" not the fraction.
  // We translate at the boundary.
  const percentValue = (value || 0) * 100;
  const inputProps = useNumberInput(
    percentValue,
    (num) => {
      if (num == null || num === 0) return '';
      // Trim trailing zeros: 10.00 → "10", 10.50 → "10.5", 10.55 → "10.55"
      return Number(num.toFixed(4)).toString();
    },
    (str) => {
      if (str === '' || str === '-' || str === '.') return 0;
      const n = Number(str);
      return Number.isFinite(n) ? n : null;
    },
    (num) => onValueChange && onValueChange(num / 100)
  );
  return (
    <div className="flex items-center justify-end">
      <input type="number" inputMode="decimal" step="any" {...inputProps} {...props}
        onBlur={(e) => { inputProps.onBlur(e); if (onCommit) onCommit(); }}
        className={className} />
      <span className="text-slate-500 ml-0.5 text-sm">%</span>
    </div>
  );
};

// Age input. Plain integer-valued number input with the same UX treatment.
// Supports both `onChange(event)` (legacy) and `onValueChange(number)` (preferred).
const AgeCell = ({ value, onChange, onValueChange, onCommit, className, ...props }) => {
  const inputProps = useNumberInput(
    value,
    (num) => (num == null || num === 0 ? '' : String(num)),
    (str) => {
      if (str === '' || str === '-') return 0;
      const n = Number(str);
      return Number.isFinite(n) ? Math.round(n) : null;
    },
    (num) => {
      if (onValueChange) onValueChange(num);
      if (onChange) onChange({ target: { value: String(num) } }); // legacy event shape
    }
  );
  return (
    <input type="number" inputMode="numeric" {...inputProps} {...props}
      onBlur={(e) => { inputProps.onBlur(e); if (onCommit) onCommit(); }}
      className={className} />
  );
};


const GridSelect = ({ value, onChange, options, className, children, ...props }) => (
  <select value={value} onChange={onChange} className={className} {...props}>
    {children || options?.map(o => typeof o === 'string'
      ? <option key={o} value={o}>{o}</option>
      : <option key={o.value} value={o.value}>{o.label}</option>
    )}
  </select>
);

const InfoCard = React.memo(({ title, sections, isOpen, onToggle }) => {
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

// ============================================
// Shared Style Constants (Module Scope)
// Lifted out of RetirementPlanner so child components can be defined at module
// scope and avoid the unmount/remount cycle on every parent state change.
// ============================================
const cardStyle = "bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6 shadow-xl";
const inputStyle = "w-full bg-slate-900/80 border border-slate-600/50 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all";
const labelStyle = "block text-sm font-medium text-slate-400 mb-1.5";
const buttonPrimary = "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900 font-semibold px-6 py-2.5 rounded-lg transition-all shadow-lg";
const buttonSecondary = "bg-slate-700 hover:bg-slate-600 text-slate-100 font-medium px-4 py-2 rounded-lg transition-all";

// ============================================
// FAQTab — Lifted to module scope (no longer recreated on every parent render)
// ============================================
function FAQTab() {
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
          a: "RMDs are calculated for pre-tax accounts (Traditional IRA, 401k, 403b, 457b, TSP) starting at the SECURE 2.0 RMD age for your birth year: age 72 if born ≤1950, age 73 if born 1951-1959, age 75 if born 1960+. The engine uses your actual birth year to pick the correct RMD age. The RMD amount equals the account balance divided by the IRS Uniform Lifetime Table factor for your age. For example, at age 75 the factor is 24.6, so a $1M balance requires a ~$40,650 RMD."
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
          a: "Most states use a simplified flat rate approximation with the inflation-adjusted standard deduction applied. For example, Texas and Florida are 0%, California is 9.3%, New York is 10.9%. Alabama uses a full progressive tax engine with its actual 2%/4%/5% brackets, sliding-scale standard deduction, personal exemption, federal income tax deductibility (Alabama is one of only 3 states that allows this), Social Security exemption, government pension exemption, and an over-65 retirement income exclusion of $6,000 per person. States that fully exempt retirement income — including Illinois, Mississippi, Pennsylvania, and Hawaii — automatically exclude those amounts from state taxable income. Social Security is also excluded from state tax in the 41 states that don't tax it."
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
          a: "Withdrawals follow the priority order you set in Personal Info (under Withdrawal Priority). The default is: Pre-Tax first, then Brokerage & HSA, then Roth. Pre-tax withdrawals are fully taxable, brokerage withdrawals use a 50% cost basis estimate taxed at capital gains rates, and Roth withdrawals are tax-free. You can drag to reorder the priority — for example, drawing from Roth first to keep taxable income low in early retirement."
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
          a: "The charitable giving percentage (set in Personal Info) is applied to your desired retirement income each year during retirement. For example, 5% charitable giving on a $100,000 desired income means $5,000 per year goes to charity. This does not reduce your withdrawal — it's part of your spending."
        },
        {
          q: "What are Qualified Charitable Distributions (QCDs)?",
          a: "QCDs allow you to donate directly from a traditional IRA to charity after age 70½, up to $111,000/year per person (2026 limit, indexed annually for inflation under SECURE 2.0). The donated amount counts toward your RMD but is excluded from taxable income. The model automatically uses QCDs to offset charitable giving when you have RMDs, reducing your tax bill."
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
          q: "What are the default conversion start and end ages?",
          a: "The 'bridge years' — the gap between retirement and RMDs — are the textbook window for Roth conversions, and the tool uses these as smart defaults. Start age defaults to your retirement age (the year your earned income ends and bracket room opens up). End age defaults to the year before RMDs start (age 71 if born ≤1950, age 72 if born 1951-1959, age 74 if born 1960+ — per SECURE 2.0). The Personal Info form shows the calculated default below each age input and offers a one-click reset button if your saved values differ. The SS Claim Analysis tab also warns when your window is narrower than the standard bridge years, since missed bridge years are missed cheap conversion opportunities."
        },
        {
          q: "Where do the taxes on Roth conversions come from?",
          a: "You can choose the tax payment source in Personal Info under Roth Conversions. The default ('Normal Withdrawal Priority') pays conversion taxes the same way as any other withdrawal — from your accounts in priority order. The 'Pay from Brokerage' option estimates the marginal tax on the conversion amount and withdraws that amount from your largest brokerage account, leaving your pre-tax and Roth accounts untouched for the conversion itself. Paying from brokerage is often the more efficient strategy — it maximizes the dollars moved to Roth without also depleting a pre-tax account for taxes."
        },
        {
          q: "When should I consider Roth conversions?",
          a: "The gap years between retirement and RMDs (or SS) are often ideal — your taxable income is low, so conversions are taxed at lower brackets. Converting reduces future RMDs and grows tax-free in Roth. The Tax Planning tab models this year-by-year. The tradeoff is paying taxes now vs. later. The Social Security Claim Analysis tab additionally shows how SS timing affects how much room you have for cheap conversions — claiming SS earlier fills your brackets faster and reduces conversion opportunities."
        }
      ]
    },
    {
      category: "Recurring Expenses",
      items: [
        {
          q: "What are recurring expenses and how are they different from desired retirement income?",
          a: "Recurring expenses are specific, named spending categories that add on top of your base desired retirement income. Examples: travel budget, healthcare premiums, club memberships, property taxes. Each expense has its own inflation rate, age range, and optional spouse-contingent toggle. The planner sums all active recurring expenses for each year and adds them to your base income target before calculating withdrawals."
        },
        {
          q: "Can recurring expenses have different inflation rates?",
          a: "Yes — each recurring expense has its own COLA (cost-of-living adjustment). Healthcare expenses often inflate faster than general inflation (6–8% is historically common). Travel or discretionary spending might match general inflation (2–3%). Setting per-expense inflation rates produces more accurate long-term projections than a single blanket rate."
        },
        {
          q: "What does the 'spouse contingent' option do?",
          a: "When 'spouse contingent' is enabled, the expense stops when a spouse passes away (if survivor modeling is active). This is useful for expenses that depend on having two people — a two-person travel budget or a second car, for example. Expenses not marked contingent continue at the same level regardless of survivor status."
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
          a: "When enabled (Personal Info → Survivor Modeling), the projection models what happens financially when the first spouse passes away at their specified life expectancy. The surviving spouse inherits the higher of the two Social Security benefits, loses the deceased spouse's other income, switches to Single filing status (with its lower bracket thresholds and standard deduction), and continues drawing from all accounts."
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
          a: "The analysis runs your complete retirement plan for each combination of claiming ages (yours and your spouse's). For each scenario, it calculates portfolio values, lifetime taxes, total withdrawals, lifetime Roth conversions, and net lifetime wealth using the full projection engine — not simplified breakeven math. This captures tax interactions, withdrawal effects, survivor benefit dynamics, and the way SS timing changes how much bracket room you have for Roth conversions. For a married couple it runs a 6×6 grid of claim ages (36 scenarios); for single filers it varies just your claim age across 6 values."
        },
        {
          q: "What is Net Lifetime Wealth in the SS analysis?",
          a: "Net Lifetime Wealth equals portfolio value at your legacy age plus total Social Security received during retirement. This combines what remains in your accounts with what SS paid you over your lifetime, giving a single number to compare claiming strategies holistically."
        },
        {
          q: "What does the CAGR sensitivity slider do?",
          a: "The slider (±3% in 0.5% increments) adjusts every account's CAGR by the chosen delta and re-runs the full claiming-age grid. This addresses a critical insight: the optimal SS claim age depends heavily on assumed portfolio growth. Higher growth makes claiming early more attractive (keeping more money invested), while lower growth favors delaying (capturing SS's guaranteed 8%/year delayed-retirement credits). Move the slider to see how the winner shifts. The flip-point is often somewhere between 6% and 10% nominal returns, and finding yours is more valuable than relying on a single deterministic baseline."
        },
        {
          q: "What does the Monte Carlo stress test toggle do?",
          a: "When enabled, each claiming scenario is run through N simulations (50-500 selectable) with randomized returns based on your chosen volatility (σ from 8% bonds-heavy to 22% all-stocks). The analysis then ranks scenarios by success rate — the percentage of simulations where your portfolio survives to legacy age — instead of a single deterministic outcome. New columns appear in the ranking table: Success Rate, p10 Portfolio (the unlucky scenario), and p50 Portfolio (median). This captures sequence-of-returns risk that the deterministic analysis cannot. Methodology note: each simulation applies a single Normal(0, σ) shock to all accounts. This correctly ranks scenarios but exaggerates tail magnitudes vs a year-by-year simulation — trust the rankings, treat the p10/p90 dollar values as relative."
        },
        {
          q: "How does Roth conversion strategy affect SS claim timing?",
          a: "If you have Roth conversions enabled (Personal Info → Roth Conversions), the analysis automatically reflects them in every claiming scenario. Earlier SS claims push more income into your tax brackets during the conversion years, leaving less room for cheap bracket-fill conversions. Later claims open a wider bridge-year window for conversions at lower marginal rates. The Full Plan Impact banner shows the actual range of lifetime conversions across all scenarios, and the ranking table includes a 'Roth Conv.' column when conversions are active. The standard 'bridge years' conversion window is retirement age through the year before RMDs start — the tool uses your retirement age and SECURE 2.0 RMD age to suggest these defaults."
        },
        {
          q: "Why are the tax differences between claiming ages smaller than expected?",
          a: "Two offsetting effects: Claiming later means higher SS income, and up to 85% of that is taxable. But it also means fewer withdrawals from tax-deferred accounts, which reduces that taxable income. These partially cancel out. The analysis captures both effects because it runs the full tax calculation for every year of every scenario, including IRMAA Medicare surcharges and state-specific rules (e.g., Alabama exempts SS from state tax)."
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
          a: "For each simulation: (1) Random annual returns are generated using a normal distribution with the mean and standard deviation you specify. (2) Random inflation rates are generated similarly. (3) Your portfolio grows or shrinks based on these random returns while withdrawals are made to fund retirement spending. (4) The simulation tracks whether your portfolio survives to your planning age. This is repeated thousands of times to calculate the probability of success."
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
      category: "Sequence-of-Returns Stress Test",
      items: [
        {
          q: "What is sequence-of-returns risk?",
          a: "Sequence-of-returns risk is the danger that bad market years occur early in your retirement. Two portfolios with identical average returns over 30 years can produce dramatically different outcomes depending on WHEN the losses happen. Losing 30% in year 1 of retirement is devastating because you're withdrawing from a shrinking portfolio — you sell low, permanently reducing your capital base. The same 30% loss in year 25 has minimal impact because the portfolio has already grown substantially."
        },
        {
          q: "How does the stress test work?",
          a: "The stress test replaces your first N years of retirement returns with actual historical bear market sequences (e.g., the 2000-2002 dot-com crash, the 2008 financial crisis). After the stress period ends, returns revert to your normal expected CAGR. This shows whether your plan can absorb real-world downturns in the critical early retirement years. Unlike Monte Carlo (which uses random returns), these are actual historical sequences that really happened."
        },
        {
          q: "What are the available historical scenarios?",
          a: "The tool includes several historical scenarios: the 2000-2002 dot-com crash (3 years of losses), the 2007-2009 financial crisis (including the -37% crash of 2008), the 1973-1974 stagflation period, the full 2000-2009 'lost decade' (two crashes in one decade), the 2020 COVID crash, a mild bear market, and a Japan-style prolonged stagnation. You can also define custom return sequences."
        },
        {
          q: "How should I interpret the results?",
          a: "If your plan survives the worst historical scenarios, it is highly robust. If it fails under 2-3 of them, consider building buffers: a cash reserve (1-2 years of expenses in cash/bonds), a 'bond tent' (higher bond allocation in early retirement years), a dynamic withdrawal strategy that reduces spending during downturns, or delaying retirement by a year or two. The gap between your baseline and the worst scenario shows how much sequence risk you carry."
        },
        {
          q: "Why does the stress test use simplified tax calculations?",
          a: "The stress test uses a simplified marginal tax estimate for speed, since it runs multiple full-length scenarios. The deterministic and Monte Carlo engines use the full iterative tax solver. The stress test results are directionally accurate for comparing scenarios but may differ slightly in exact dollar amounts from the main projections."
        }
      ]
    },
    {
      category: "Alabama State Tax Engine",
      items: [
        {
          q: "How does the Alabama tax calculation work?",
          a: "Alabama uses a full progressive tax engine instead of a flat rate approximation. The engine implements Alabama's actual 2%/4%/5% tax brackets, the sliding-scale standard deduction (which phases from $7,500 to $4,000 for MFJ based on AGI), personal exemptions ($3,000 MFJ / $1,500 Single), federal income tax deductibility (Alabama is one of only 3 states that allows deducting federal taxes paid), Social Security exemption, government pension exemption, and the over-65 retirement income exclusion of $6,000 per person."
        },
        {
          q: "What is federal tax deductibility and why does it matter?",
          a: "Alabama allows you to deduct your federal income tax liability from your Alabama taxable income. This is a significant benefit — for example, if you pay $15,000 in federal taxes, your Alabama taxable income is reduced by that full $15,000 before Alabama's own brackets are applied. This typically reduces Alabama state taxes by $500-$750 compared to a flat-rate estimate. Only Alabama, Iowa, and Louisiana currently offer this deduction."
        },
        {
          q: "What is the over-65 retirement income exclusion?",
          a: "Alabama allows each person age 65 or older to exclude up to $6,000 per year of retirement income (401k/IRA distributions) from state taxable income. For a married couple where both are 65+, that is $12,000 excluded. This is in addition to the full exemption for government pensions and Social Security."
        }
      ]
    },
    {
      category: "Sensitivity Analysis",
      items: [
        {
          q: "What does the sensitivity analysis show?",
          a: "The sensitivity analysis varies one input at a time while holding everything else constant, then runs your full projection engine for each variation. This tells you exactly how much your ending portfolio changes for each unit of change in returns, spending, retirement age, inflation, SS claiming age, and contributions. It answers 'what if?' questions with precision."
        },
        {
          q: "What is the tornado chart?",
          a: "The tornado chart ranks all variables by their impact on your ending portfolio. The widest bar = the variable your plan is most sensitive to. Red bars show the downside (what happens if that variable goes against you), green bars show the upside. If your plan has a massive red bar for 'Investment Returns', that means your outcome is highly dependent on market performance — you may want to build more buffers."
        },
        {
          q: "How is this different from Monte Carlo?",
          a: "Monte Carlo randomizes ALL variables simultaneously across thousands of runs to produce a probability of success. Sensitivity analysis changes ONE variable at a time to show exactly how much each input matters. They're complementary: Monte Carlo tells you 'how likely is success?', sensitivity tells you 'which assumption should I worry about most?'"
        },
        {
          q: "What should I do with the results?",
          a: "Focus on the variables with the widest bars in the tornado chart. If your plan is extremely sensitive to investment returns, consider a more conservative spending level or a cash buffer. If it's sensitive to retirement age, even one extra working year might dramatically improve outcomes. Variables with narrow bars are ones where your plan is resilient — being off by a bit won't matter much."
        }
      ]
    },
    {
      category: "Data Storage & Privacy",
      items: [
        {
          q: "Where is my data stored?",
          a: "All data is stored locally in your browser's localStorage. Nothing is sent to any server. Your data stays on your device and persists between sessions in the same browser."
        },
        {
          q: "How do I backup my data?",
          a: "Use the Import/Export button in the header to download a JSON backup file. This file contains all your personal info, accounts, income streams, recurring expenses, one-time events, assets, and visibility settings. You can import this file later to restore your data, or share it across devices."
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
          a: "This is a comprehensive but simplified planning tool. Key limitations: Uses standard deduction only (no itemized — so the engine doesn't model the 2026 OBBBA changes that capped charitable deductions at 35% for high earners or imposed the 0.5%-of-AGI floor for itemizers; QCDs are modeled separately as an above-the-line exclusion). Most states use simplified flat tax rates (Alabama has a full progressive engine with federal deductibility — other states use flat rate approximations). No tax-loss harvesting, no estate planning, brokerage cost basis is estimated at 50% (actual depends on your purchase history), no contribution limit enforcement. Features included: Configurable withdrawal priority ordering, Roth conversion modeling (fixed-amount and bracket-fill, with smart defaults for bridge-year windows), QCD optimization, FICA payroll taxes on earned income, tiered capital gains rates (0%/15%/20%), NIIT surtax, Medicare IRMAA surcharges (Part B + Part D based on MAGI), Social Security earnings test for early claimers still working, survivor modeling with SS benefit inheritance, one-time events (expenses and income), healthcare expense modeling (pre-65, Medicare, long-term care), charitable giving, non-liquid asset tracking, full-plan SS claiming age analysis with CAGR sensitivity and Monte Carlo stress testing, sequence-of-returns stress testing with historical scenarios, and dedicated Monte Carlo simulation. Results are estimates for planning purposes only."
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
          a: "Federal income tax uses 2026 brackets (inflation-adjusted) with standard deduction. Capital gains uses tiered rates (0%/15%/20%) based on taxable income. Net Investment Income Tax (NIIT) of 3.8% applies to high earners. Social Security taxation uses correct IRS thresholds. Alabama uses a full progressive state tax engine with 2%/4%/5% brackets, federal tax deductibility, over-65 exclusions, and pension exemptions. All other states use simplified flat rates with retirement income exemptions for qualifying states. FICA payroll taxes (Social Security 6.2% + Medicare 1.45%) are calculated on earned income during working years, including Additional Medicare Tax (0.9%) for high earners."
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
}

// ============================================
// AssetsTab — Lifted to module scope
// ============================================
function AssetsTab({ assetTypes, assets, setAssets, setEditingAsset, setShowAssetModal }) {
  const [assetInfoOpen, setAssetInfoOpen] = useState(false);
  const [localAssets, setLocalAssets] = useState(assets);
  const [dirtyAssets, setDirtyAssets] = useState(false);
  
  // Re-sync on any external content change (add/delete/edit/wholesale replace,
  // e.g. wizard relaunch or plan load). In-tab typing only mutates the local
  // mirror, not the parent prop, so this signature stays stable while editing.
  const assetsSig = JSON.stringify(assets);
  useEffect(() => {
    setLocalAssets(assets);
    setDirtyAssets(false);
  }, [assetsSig]);
  
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
                  { icon: '🏠', label: 'Legacy Value', desc: 'Assets contribute to your final net worth at your legacy age — they represent what you\'d leave to heirs even if your portfolio is depleted.' }
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
}

// ============================================
// IncomeStreamsTab — Lifted to module scope
// ============================================
function IncomeStreamsTab({ incomeStreams, incomeTypes, personalInfo, projections, setEditingIncome, setIncomeStreams, setShowIncomeModal }) {
  const [incomeInfoOpen, setIncomeInfoOpen] = useState(false);
  const [localIncomes, setLocalIncomes] = useState(incomeStreams);
  const [dirtyIncomes, setDirtyIncomes] = useState(false);
  
  // Detailed table state (embedded from former DetailedTableTab)
  const [tableStartAge, setTableStartAge] = useState(personalInfo.myRetirementAge);
  const tableData = projections.filter(p => p.myAge >= tableStartAge && p.myAge <= Math.min(tableStartAge + 30, personalInfo.legacyAge || 95));
  const charitablePercent = personalInfo.charitableGivingPercent || 0;
  
  // Re-sync on any external content change (see AssetsTab note); id-only keys
  // missed wizard relaunches that rebuild streams with the same id sequence.
  const incomeSig = JSON.stringify(incomeStreams);
  useEffect(() => {
    setLocalIncomes(incomeStreams);
    setDirtyIncomes(false);
  }, [incomeSig]);
  
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
                  { icon: '📅', label: 'Ages', desc: `The start and end ages for this income. Social Security: typically 62 to your planning age (or your chosen claiming age). Salary: current age to retirement age. Pension: pension start age to your planning age. Set end age to ${personalInfo.legacyAge || 95} for lifetime income.` }
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
      
      {/* Detailed Annual Projections (formerly its own tab) */}
      <div className="border-t border-slate-700/50 pt-6 mt-6">
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
            <strong>🔄 Roth Conversions Active ({formatCurrency(personalInfo.rothConversionAmount)}/yr, ages {personalInfo.rothConversionStartAge || getDefaultRothConversionWindow(personalInfo).startAge}–{personalInfo.rothConversionEndAge || getDefaultRothConversionWindow(personalInfo).endAge}):</strong> Purple-highlighted rows show years where conversions execute. The converted amount increases taxable income (and federal/state tax) that year but shifts assets to tax-free Roth growth. Watch the "Portfolio" column — pre-tax balance decreases while Roth balance grows, reducing future RMDs.
          </p>
        </div>
      )}
    </div>

      </div>
      
    </div>
  );
}

// ============================================
// TaxYearSnapshot — Lifted to module scope
// ============================================
function TaxYearSnapshot({ projections, personalInfo }) {
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
  
  // IRMAA display (read from unified engine data)
  const isMedicareAge = selectedAge >= 65;
  const irmaa = p.irmaaInfo; // Engine-computed IRMAA tier detail
  
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
}

// ============================================
// RothConversionSimulator — Lifted to module scope
// ============================================
// Heuristic suggested pre-tax floor (today's $): the pool of pre-tax dollars
// worth preserving rather than converting, sized to cover two tax-efficient uses
// across the rest of the plan — (1) lifetime QCD giving (needs an IRA balance at
// 70+) and (2) the unused room under the 12% bracket each year (pre-tax dollars
// you could withdraw at ≤12%). Computed from the NO-conversion baseline so it
// reflects the user's own giving/income, then deflated to today's dollars. This
// is a rough sizing aid, not an optimizer.
function suggestPreTaxFloor(baselineProj, pi) {
  if (!baselineProj || !baselineProj.length) return 0;
  const inflation = pi.inflationRate || 0.03;
  const myAge = pi.myAge;
  let total = 0;
  for (const row of baselineProj) {
    const age = row.myAge;
    if (age == null) continue;
    const yearsFromNow = age - myAge;
    if (yearsFromNow < 0) continue;
    const inflationFactor = Math.pow(1 + inflation, yearsFromNow);
    const fs = row.filingStatus || pi.filingStatus || 'married_joint';
    // (1) QCD giving this year, capped at the household QCD limit
    let qcdYear = 0;
    if (age >= QCD_START_AGE) {
      const householdQCD = (fs === 'married_joint' ? 2 : 1) * QCD_ANNUAL_LIMIT * inflationFactor;
      qcdYear = Math.min(row.charitableGiving || 0, householdQCD);
    }
    // (2) room remaining under the top of the 12% bracket (post-std-deduction)
    const fsBrackets = FEDERAL_TAX_BRACKETS_2026[fs] || FEDERAL_TAX_BRACKETS_2026.married_joint;
    const twelve = fsBrackets.find(b => b.rate === 0.12);
    const adjDed = (STANDARD_DEDUCTION_2026[fs] || STANDARD_DEDUCTION_2026.married_joint) * inflationFactor;
    let lowRoom = 0;
    if (twelve) {
      const netTaxable = Math.max(0, (row.taxableIncome || 0) - adjDed);
      lowRoom = Math.max(0, twelve.max * inflationFactor - netTaxable);
    }
    total += (qcdYear + lowRoom) / inflationFactor; // deflate to today's $
  }
  return Math.round(total);
}

function RothConversionSimulator({ projections, personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses, retirementAge, computeProjections, setPersonalInfo }) {
  // Seed the simulator from the user's SAVED plan (plus the engine's smart
  // window defaults) so the simulator and the Personal Info "planned strategy"
  // agree out of the box, instead of starting from hardcoded sandbox values.
  const planToSettings = (pi) => {
    const dw = getDefaultRothConversionWindow(pi);
    return {
      mode: pi.rothConversionBracket ? 'bracket' : 'fixed',
      startAge: pi.rothConversionStartAge || dw.startAge,
      endAge: pi.rothConversionEndAge || dw.endAge,
      targetBracket: pi.rothConversionBracket || '22%',
      fixedAmount: pi.rothConversionAmount || 0,
      taxSource: pi.rothConversionTaxSource || 'withdrawal',
      preTaxFloor: pi.rothConversionPreTaxFloor || 0,
    };
  };
  const [conversionSettings, setConversionSettings] = useState(() => planToSettings(personalInfo));
  const [savedFlash, setSavedFlash] = useState(false);

  const bracketOptions = [
    { value: '12%', label: '12% Bracket' },
    { value: '22%', label: '22% Bracket' },
    { value: '24%', label: '24% Bracket' },
    { value: '32%', label: '32% Bracket' }
  ];
  
  // Run two full projections through the unified engine:
  // 1. "With conversions" — using the simulator's conversion settings
  // 2. "Without conversions" — no Roth conversions at all
  // The difference between them IS the impact of conversions.
  const { conversionProj, baselineProj, conversionAnalysis, totals } = useMemo(() => {
    // Projection WITH the simulator's conversion settings
    const withPI = {
      ...personalInfo,
      rothConversionAmount: conversionSettings.mode === 'fixed' ? conversionSettings.fixedAmount : 0,
      rothConversionStartAge: conversionSettings.startAge,
      rothConversionEndAge: conversionSettings.endAge,
      rothConversionBracket: conversionSettings.mode === 'bracket' ? conversionSettings.targetBracket : '',
      rothConversionTaxSource: conversionSettings.taxSource,
      rothConversionPreTaxFloor: conversionSettings.preTaxFloor
    };
    const withProj = computeProjections(withPI, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses);

    // Projection WITHOUT any conversions (baseline)
    const withoutPI = {
      ...personalInfo,
      rothConversionAmount: 0,
      rothConversionBracket: '',
      rothConversionPreTaxFloor: 0
    };
    const withoutProj = computeProjections(withoutPI, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses);
    
    // Build year-by-year comparison for the conversion window
    const analysis = [];
    let cumulativeConversion = 0;
    let cumulativeTaxDelta = 0;
    
    for (let age = conversionSettings.startAge; age <= conversionSettings.endAge; age++) {
      const withYear = withProj.find(p => p.myAge === age);
      const withoutYear = withoutProj.find(p => p.myAge === age);
      if (!withYear || !withoutYear) continue;
      
      const conversionAmount = withYear.rothConversion || 0;
      const taxDelta = withYear.totalTax - withoutYear.totalTax; // Additional tax from conversion
      cumulativeConversion += conversionAmount;
      cumulativeTaxDelta += taxDelta;
      
      const effectiveRate = conversionAmount > 0 ? taxDelta / conversionAmount : 0;
      
      analysis.push({
        age,
        year: withYear.year,
        // Without conversions (baseline)
        baseIncome: withoutYear.totalIncome,
        baseTaxableIncome: withoutYear.taxableIncome,
        baseTotalTax: withoutYear.totalTax,
        basePreTax: withoutYear.preTaxBalance,
        baseRoth: withoutYear.rothBalance,
        basePortfolio: withoutYear.totalPortfolio,
        // With conversions
        conversionAmount,
        withTaxableIncome: withYear.taxableIncome,
        withTotalTax: withYear.totalTax,
        withPreTax: withYear.preTaxBalance,
        withRoth: withYear.rothBalance,
        withPortfolio: withYear.totalPortfolio,
        withMagi: withYear.magi,
        withIrmaa: withYear.irmaaSurcharge,
        baseIrmaa: withoutYear.irmaaSurcharge,
        // Deltas
        taxDelta,
        effectiveRate,
        irmaaDelta: (withYear.irmaaSurcharge || 0) - (withoutYear.irmaaSurcharge || 0),
        cumulativeConversion,
        cumulativeTaxDelta,
        remainingPreTax: withYear.preTaxBalance
      });
    }
    
    // Compute lifetime totals (all years, not just conversion window)
    const allWithTax = withProj.reduce((s, p) => s + p.totalTax, 0);
    const allWithoutTax = withoutProj.reduce((s, p) => s + p.totalTax, 0);
    const endWithPortfolio = withProj[withProj.length - 1]?.totalPortfolio || 0;
    const endWithoutPortfolio = withoutProj[withoutProj.length - 1]?.totalPortfolio || 0;
    
    return {
      conversionProj: withProj,
      baselineProj: withoutProj,
      conversionAnalysis: analysis,
      totals: {
        totalConverted: cumulativeConversion,
        conversionWindowTax: cumulativeTaxDelta,
        lifetimeTaxWith: allWithTax,
        lifetimeTaxWithout: allWithoutTax,
        lifetimeTaxSavings: allWithoutTax - allWithTax,
        endPortfolioWith: endWithPortfolio,
        endPortfolioWithout: endWithoutPortfolio,
        portfolioBenefit: endWithPortfolio - endWithoutPortfolio,
        avgEffRate: cumulativeConversion > 0 ? cumulativeTaxDelta / cumulativeConversion : 0
      }
    };
  }, [personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses, conversionSettings]);

  const suggestedFloor = useMemo(() => suggestPreTaxFloor(baselineProj, personalInfo), [baselineProj, personalInfo]);

  const saveToPlan = () => {
    setPersonalInfo(prev => ({
      ...prev,
      rothConversionAmount: conversionSettings.mode === 'fixed' ? conversionSettings.fixedAmount : 0,
      rothConversionBracket: conversionSettings.mode === 'bracket' ? conversionSettings.targetBracket : '',
      rothConversionStartAge: conversionSettings.startAge,
      rothConversionEndAge: conversionSettings.endAge,
      rothConversionTaxSource: conversionSettings.taxSource,
      rothConversionPreTaxFloor: conversionSettings.preTaxFloor,
    }));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2500);
  };
  const resetToPlan = () => setConversionSettings(planToSettings(personalInfo));

  return (
    <div className={cardStyle}>
      <h4 className="text-lg font-semibold text-slate-100 mb-2">🔄 Roth Conversion Simulator</h4>
      <p className="text-sm text-slate-400 mb-4">
        Compare your plan WITH vs. WITHOUT Roth conversions. Uses the full projection engine — same tax calculations, SS re-taxation, IRMAA, and withdrawal solver as your main plan.
      </p>
      
      {/* Settings */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6 p-4 bg-slate-800/50 rounded-lg">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Mode</label>
          <select
            value={conversionSettings.mode}
            onChange={e => setConversionSettings({...conversionSettings, mode: e.target.value})}
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
          >
            <option value="bracket">Fill to Bracket</option>
            <option value="fixed">Fixed Amount</option>
          </select>
        </div>
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
          <label className="block text-sm text-slate-400 mb-1">End Age</label>
          <input
            type="number"
            value={conversionSettings.endAge}
            onChange={e => setConversionSettings({...conversionSettings, endAge: Number(e.target.value)})}
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
          />
        </div>
        {conversionSettings.mode === 'bracket' ? (
          <div>
            <label className="block text-sm text-slate-400 mb-1">Fill Up To</label>
            <select
              value={conversionSettings.targetBracket}
              onChange={e => setConversionSettings({...conversionSettings, targetBracket: e.target.value})}
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
            >
              {bracketOptions.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label className="block text-sm text-slate-400 mb-1">Annual Amount</label>
            <CurrencyCell
              value={conversionSettings.fixedAmount}
              onValueChange={v => setConversionSettings({...conversionSettings, fixedAmount: v})}
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
            />
          </div>
        )}
        <div>
          <label className="block text-sm text-slate-400 mb-1">Tax Payment Source</label>
          <select
            value={conversionSettings.taxSource}
            onChange={e => setConversionSettings({...conversionSettings, taxSource: e.target.value})}
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
          >
            <option value="withdrawal">Normal Withdrawal Priority</option>
            <option value="brokerage">Pay from Brokerage</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Preserve Pre-Tax Floor</label>
          <CurrencyCell
            value={conversionSettings.preTaxFloor}
            onValueChange={v => setConversionSettings({...conversionSettings, preTaxFloor: v})}
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-100"
          />
          <div className="text-[10px] text-slate-500 mt-1">
            Stop converting at this pre-tax balance (today's $). 0 = no floor.
            {suggestedFloor > 0 && (
              <span className="block mt-0.5">
                Suggested: <span className="text-amber-400">{formatCurrency(suggestedFloor)}</span>
                <button
                  onClick={() => setConversionSettings(cs => ({...cs, preTaxFloor: suggestedFloor}))}
                  className="ml-1.5 px-1.5 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30"
                >
                  Apply
                </button>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-end">
          <div className="text-xs text-slate-500">
            {conversionSettings.mode === 'bracket'
              ? `Converts enough each year to fill the ${conversionSettings.targetBracket} bracket`
              : `Converts ${formatCurrency(conversionSettings.fixedAmount)}/yr (inflation-adjusted)`}
          </div>
        </div>
      </div>
      
      {/* Summary: With vs Without */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
          <div className="text-slate-500 text-xs mb-0.5">Total Converted</div>
          <div className="text-xl font-bold text-emerald-400">{formatCurrency(totals.totalConverted)}</div>
          <div className="text-xs text-slate-500">{conversionAnalysis.length} years</div>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
          <div className="text-slate-500 text-xs mb-0.5">Tax During Conversions</div>
          <div className="text-xl font-bold text-red-400">+{formatCurrency(totals.conversionWindowTax)}</div>
          <div className="text-xs text-slate-500">Avg rate: {(totals.avgEffRate * 100).toFixed(1)}%</div>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
          <div className="text-slate-500 text-xs mb-0.5">Lifetime Tax Savings</div>
          <div className={`text-xl font-bold ${totals.lifetimeTaxSavings >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totals.lifetimeTaxSavings >= 0 ? '' : '−'}{formatCurrency(Math.abs(totals.lifetimeTaxSavings))}
          </div>
          <div className="text-xs text-slate-500">Without: {formatCurrency(totals.lifetimeTaxWithout)} → With: {formatCurrency(totals.lifetimeTaxWith)}</div>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
          <div className="text-slate-500 text-xs mb-0.5">Portfolio at End</div>
          <div className={`text-xl font-bold ${totals.portfolioBenefit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totals.portfolioBenefit >= 0 ? '+' : '−'}{formatCurrency(Math.abs(totals.portfolioBenefit))}
          </div>
          <div className="text-xs text-slate-500">{formatCurrency(totals.endPortfolioWith)} vs {formatCurrency(totals.endPortfolioWithout)}</div>
        </div>
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-3">
          <div className="text-slate-500 text-xs mb-0.5">Pre-Tax Remaining</div>
          <div className="text-xl font-bold text-amber-400">{formatCurrency(conversionAnalysis[conversionAnalysis.length - 1]?.remainingPreTax || 0)}</div>
          <div className="text-xs text-slate-500">Age {conversionSettings.endAge}</div>
        </div>
      </div>
      
      {/* Chart */}
      <div className="mb-6">
        <h5 className="text-md font-semibold text-slate-200 mb-3">Income + Conversions vs. Baseline</h5>
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
              <Bar dataKey="baseIncome" stackId="income" fill="#3b82f6" name="Base Income" />
              <Bar dataKey="conversionAmount" stackId="income" fill="#10b981" name="Roth Conversion" />
              <Line type="monotone" dataKey="baseTotalTax" stroke="#ef4444" strokeWidth={2} dot={false} name="Tax Without Conv." strokeDasharray="5 5" />
              <Line type="monotone" dataKey="withTotalTax" stroke="#f97316" strokeWidth={2} dot={false} name="Tax With Conv." />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Year-by-Year Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left py-2 px-2 text-slate-400 font-medium">Age</th>
              <th className="text-right py-2 px-2 text-slate-400 font-medium">Base Income</th>
              <th className="text-right py-2 px-2 text-slate-400 font-medium">Conversion</th>
              <th className="text-right py-2 px-2 text-slate-400 font-medium">Tax (no conv)</th>
              <th className="text-right py-2 px-2 text-slate-400 font-medium">Tax (w/ conv)</th>
              <th className="text-right py-2 px-2 text-slate-400 font-medium">Tax Delta</th>
              <th className="text-right py-2 px-2 text-slate-400 font-medium">Eff. Rate</th>
              <th className="text-right py-2 px-2 text-slate-400 font-medium">IRMAA Δ</th>
              <th className="text-right py-2 px-2 text-slate-400 font-medium">Cumulative</th>
              <th className="text-right py-2 px-2 text-slate-400 font-medium">Pre-Tax Left</th>
            </tr>
          </thead>
          <tbody>
            {conversionAnalysis.map((row, idx) => (
              <tr key={row.age} className={`border-b border-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''}`}>
                <td className="py-2 px-2 text-slate-300 font-medium">{row.age}</td>
                <td className="py-2 px-2 text-right text-slate-400">{formatCurrency(row.baseIncome)}</td>
                <td className="py-2 px-2 text-right text-emerald-400 font-semibold">
                  {row.conversionAmount > 0 ? formatCurrency(row.conversionAmount) : '—'}
                </td>
                <td className="py-2 px-2 text-right text-slate-400">{formatCurrency(row.baseTotalTax)}</td>
                <td className="py-2 px-2 text-right text-amber-400">{formatCurrency(row.withTotalTax)}</td>
                <td className="py-2 px-2 text-right text-red-400">
                  {row.taxDelta > 0 ? '+' : ''}{formatCurrency(row.taxDelta)}
                </td>
                <td className="py-2 px-2 text-right text-amber-400">
                  {row.conversionAmount > 0 ? `${(row.effectiveRate * 100).toFixed(1)}%` : '—'}
                </td>
                <td className={`py-2 px-2 text-right ${row.irmaaDelta > 0 ? 'text-pink-400' : 'text-slate-500'}`}>
                  {row.irmaaDelta > 0 ? '+' + formatCurrency(row.irmaaDelta) : '—'}
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
              <td className="py-3 px-2 text-right text-emerald-400 font-bold">{formatCurrency(totals.totalConverted)}</td>
              <td></td>
              <td></td>
              <td className="py-3 px-2 text-right text-red-400 font-bold">+{formatCurrency(totals.conversionWindowTax)}</td>
              <td className="py-3 px-2 text-right text-amber-400 font-bold">{(totals.avgEffRate * 100).toFixed(1)}%</td>
              <td></td>
              <td></td>
              <td className="py-3 px-2 text-right text-sky-400 font-bold">{formatCurrency(conversionAnalysis[conversionAnalysis.length - 1]?.remainingPreTax || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Save the simulated settings back to the user's plan */}
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          onClick={saveToPlan}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
        >
          Save to my plan
        </button>
        <button
          onClick={resetToPlan}
          className="px-4 py-2 text-sm font-medium rounded-lg text-slate-300 border border-slate-600/60 hover:bg-slate-700/50"
        >
          Reset to my saved plan
        </button>
        {savedFlash && <span className="text-sm text-emerald-400">Saved ✓ — this is now your baseline plan.</span>}
        <span className="text-xs text-slate-500">Saving makes these conversion settings the baseline used everywhere (Dashboard, Detailed Table).</span>
      </div>

      <div className="mt-4 p-3 bg-blue-900/20 border border-blue-800/30 rounded-lg">
        <p className="text-xs text-blue-300">
          <strong>How this works:</strong> The simulator runs your complete financial plan twice through the projection engine — once with the conversion settings above, once without any conversions. 
          Every number reflects the full tax model: SS re-taxation, IRMAA surcharges, state taxes, withdrawal solver adjustments, and portfolio growth differences. 
          "Lifetime Tax Savings" is the total tax difference across ALL years (not just the conversion window) — conversions pay more tax now but reduce RMDs and taxes later.
          "Portfolio at End" shows the total portfolio difference at age {personalInfo.legacyAge || 95}, reflecting tax-free Roth growth vs. taxable pre-tax growth.
        </p>
      </div>
    </div>
  );
}

// ============================================
// TaxPlanningTab — Lifted to module scope
// ============================================
// ============================================
// ROTH CONVERSION OPTIMIZER
// Goal-based strategy sweep (bracket-fill targets × conversion windows) run in
// the Web Worker; each candidate is a full computeProjections pass scored by
// engine.scoreRothStrategy. Mirrors MonteCarloTab's job-handle pattern.
// ============================================
function RothConversionOptimizer({ personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses, setPersonalInfo }) {
  const [goal, setGoal] = useState('legacy');
  const [optResult, setOptResult] = useState(null);
  const [optError, setOptError] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [appliedLabel, setAppliedLabel] = useState(null);
  const jobRef = useRef(null);

  // Cancel any in-flight job on unmount (same pattern as MonteCarloTab).
  useEffect(() => () => {
    if (jobRef.current && window.PlannerWorker) { window.PlannerWorker.cancel(); jobRef.current = null; }
  }, []);

  const heirTaxRate = personalInfo.heirTaxRate ?? 0.25;

  const GOALS = {
    legacy: { label: 'Maximize after-tax legacy', sort: (a, b) => b.afterTaxLegacy - a.afterTaxLegacy },
    taxes: { label: 'Minimize lifetime taxes', sort: (a, b) => a.lifetimeTax - b.lifetimeTax },
    irmaa: { label: 'Avoid IRMAA surcharges', sort: (a, b) => (a.lifetimeIRMAA - b.lifetimeIRMAA) || (b.afterTaxLegacy - a.afterTaxLegacy) },
  };

  const runOptimizer = () => {
    if (!window.PlannerWorker) { setOptError('Worker not available — reload the page.'); return; }
    setIsRunning(true); setProgress(0); setOptResult(null); setOptError(null); setAppliedLabel(null);
    const handle = window.PlannerWorker.run({
      type: 'rothOptimizer',
      payload: { personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses, heirTaxRate },
      onProgress: (pct) => setProgress(pct),
    });
    jobRef.current = handle;
    handle.promise
      .then((data) => { if (jobRef.current !== handle) return; jobRef.current = null; setOptResult(data); setIsRunning(false); })
      .catch((err) => { if (jobRef.current !== handle) return; jobRef.current = null; setIsRunning(false); if (err.message !== 'Cancelled') setOptError(err.message); });
  };

  const applyStrategy = (row) => {
    setPersonalInfo(prev => ({
      ...prev,
      rothConversionAmount: 0,
      rothConversionBracket: row.bracket || '',
      rothConversionStartAge: row.startAge || 0,
      rothConversionEndAge: row.endAge || 0,
    }));
    setAppliedLabel(row.label);
  };

  const ranked = optResult ? [...optResult.results].sort(GOALS[goal].sort) : [];
  const best = ranked[0] || null;
  const baseline = optResult ? optResult.baseline : null;
  const showACA = optResult && optResult.results.some(r => (r.lifetimeACASubsidy || 0) > 0);
  const deltaFmt = (v) => (v >= 0 ? '+' : '−') + formatCurrency(Math.abs(v)).replace('$', '$');

  return (
    <div className={cardStyle}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h4 className="text-lg font-semibold text-slate-100 mb-1">Roth Conversion Optimizer</h4>
          <p className="text-xs text-slate-400 max-w-xl">
            Sweeps bracket-fill targets and conversion windows (a full projection each — taxes, IRMAA, ACA,
            RMDs all included), then ranks them against your goal. Apply the winner to make it your plan.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Goal</label>
            <select value={goal} onChange={e => setGoal(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100">
              {Object.entries(GOALS).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1" title="Heirs' assumed ordinary tax rate on inherited pre-tax dollars (SECURE Act 10-year rule)">Heir Tax Rate %</label>
            <input type="number" min="0" max="60" step="1"
              value={Math.round(heirTaxRate * 100)}
              onChange={e => setPersonalInfo(prev => ({ ...prev, heirTaxRate: Math.min(0.6, Math.max(0, (Number(e.target.value) || 0) / 100)) }))}
              className="w-20 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-100 text-center" />
          </div>
          <button onClick={isRunning ? undefined : runOptimizer} disabled={isRunning}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium ${isRunning ? 'bg-slate-700 text-slate-400' : 'bg-amber-600/20 text-amber-400 border border-amber-500/30 hover:bg-amber-600/30'}`}>
            {isRunning ? `Optimizing… ${progress}%` : 'Run Optimizer'}
          </button>
        </div>
      </div>

      {optError && <p className="text-sm text-red-400 mb-2">{optError}</p>}
      {appliedLabel && <p className="text-sm text-emerald-400 mb-2">✓ Applied: {appliedLabel} — every tab now reflects this strategy.</p>}

      {optResult && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-700">
                <th className="py-2 pr-3">Strategy</th>
                <th className="py-2 pr-3">Total Converted</th>
                <th className="py-2 pr-3">After-Tax Legacy (vs none)</th>
                <th className="py-2 pr-3">Lifetime Tax (vs none)</th>
                <th className="py-2 pr-3">Lifetime IRMAA</th>
                {showACA && <th className="py-2 pr-3">ACA Subsidy Kept</th>}
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, 8).map((r) => (
                <tr key={r.label} className={`border-b border-slate-800 ${best && r.label === best.label ? 'bg-amber-900/20' : ''}`}>
                  <td className="py-2 pr-3 text-slate-200">{best && r.label === best.label ? '★ ' : ''}{r.label}</td>
                  <td className="py-2 pr-3 text-slate-300">{formatCurrency(r.lifetimeConversions)}</td>
                  <td className="py-2 pr-3 text-slate-200">
                    {formatCurrency(r.afterTaxLegacy)}
                    {baseline && <span className={`ml-1 text-xs ${r.afterTaxLegacy >= baseline.afterTaxLegacy ? 'text-emerald-400' : 'text-red-400'}`}>({deltaFmt(r.afterTaxLegacy - baseline.afterTaxLegacy)})</span>}
                  </td>
                  <td className="py-2 pr-3 text-slate-200">
                    {formatCurrency(r.lifetimeTax)}
                    {baseline && <span className={`ml-1 text-xs ${r.lifetimeTax <= baseline.lifetimeTax ? 'text-emerald-400' : 'text-red-400'}`}>({deltaFmt(r.lifetimeTax - baseline.lifetimeTax)})</span>}
                  </td>
                  <td className="py-2 pr-3 text-slate-300">{formatCurrency(r.lifetimeIRMAA)}</td>
                  {showACA && <td className="py-2 pr-3 text-slate-300">{formatCurrency(r.lifetimeACASubsidy)}</td>}
                  <td className="py-2 pr-3">
                    <button onClick={() => applyStrategy(r)}
                      className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-200">Apply</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-2">
            ★ = best for "{GOALS[goal].label}". After-tax legacy values pre-tax balances at {Math.round(heirTaxRate * 100)}¢ on
            the dollar (your heirs' rate under the SECURE Act 10-year rule); Roth and brokerage pass at face value.
            Change the goal to re-rank without re-running.
          </p>
        </div>
      )}
    </div>
  );
}

function TaxPlanningTab({ accounts, assets, computeProjections, incomeStreams, oneTimeEvents, personalInfo, projections, recurringExpenses, setPersonalInfo }) {
  const [ageRange, setAgeRange] = useState({ start: personalInfo.myAge, end: personalInfo.legacyAge || 95 });
  
  // Retirement age: always use personalInfo as source of truth
  const retirementAge = personalInfo.myRetirementAge;
  const retirementProjection = projections.find(p => p.myAge === retirementAge);
  
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
      
      // IRMAA data from unified engine (avoids independent recalculation)
      const distToNextIRMAA = p.irmaaInfo?.distToNextTier || null;
      const currentIRMAATier = p.irmaaInfo?.tier || 0;
      const currentIRMAAannual = p.irmaaInfo?.totalAnnual || 0;
      const currentMAGI = Math.round(p.magi || 0);

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
        currentIRMAATier,
        currentIRMAAannual,
        distToNextIRMAA,
        currentMAGI,
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
            <span className="text-purple-400"> Your planned conversion is active (ages {personalInfo.rothConversionStartAge || getDefaultRothConversionWindow(personalInfo).startAge}–{personalInfo.rothConversionEndAge || getDefaultRothConversionWindow(personalInfo).endAge}{personalInfo.rothConversionBracket ? `, filling to ${personalInfo.rothConversionBracket} bracket` : `, ${formatCurrency(personalInfo.rothConversionAmount)}/yr`}).</span>
          )}
        </p>
      </div>

      {/* ACA subsidy impact of Roth conversions (pre-65, ACA coverage mode).
          Near the 400% FPL cliff a conversion dollar costs marginal tax PLUS
          lost premium credit — this table makes that second cost visible. */}
      {personalInfo.pre65Coverage === 'aca' && (() => {
        const acaConvYears = projections.filter(p => (p.rothConversion || 0) > 0 && (p.acaGrossPremium || 0) > 0);
        if (acaConvYears.length === 0) return null;
        const rows = acaConvYears.map(p => {
          const acaMagi = (p.taxableIncome || 0) + Math.max(0, (p.socialSecurity || 0) - (p.taxableSS || 0));
          const householdSize = p.filingStatus === 'married_joint' ? 2 : 1;
          const without = calculateACAPremiumCredit({
            magi: Math.max(0, acaMagi - p.rothConversion),
            householdSize,
            benchmarkPremium: p.acaGrossPremium,
            yearsFromNow: p.myAge - personalInfo.myAge,
            inflationRate: personalInfo.inflationRate,
          });
          const subsidyLost = Math.max(0, Math.round(without.subsidy - (p.acaSubsidy || 0)));
          const crossesCliff = (p.acaSubsidy || 0) === 0 && without.subsidy > 0;
          return { age: p.myAge, conversion: p.rothConversion, fplPercent: p.acaFplPercent, subsidyKept: p.acaSubsidy || 0, subsidyLost, crossesCliff };
        });
        const totalLost = rows.reduce((s, r) => s + r.subsidyLost, 0);
        return (
          <div className={cardStyle}>
            <h4 className="text-lg font-semibold text-slate-100 mb-1">Roth Conversions vs. ACA Subsidy</h4>
            <p className="text-xs text-slate-400 mb-3">
              Conversions raise MAGI, which shrinks your marketplace premium credit — and above 400% of the poverty
              level the credit vanishes entirely (the 2026 cliff). Near the cliff, a conversion dollar costs its
              marginal tax rate <em>plus</em> lost subsidy.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-700">
                    <th className="py-2 pr-3">Age</th>
                    <th className="py-2 pr-3">Conversion</th>
                    <th className="py-2 pr-3">% of FPL</th>
                    <th className="py-2 pr-3">Subsidy Kept</th>
                    <th className="py-2 pr-3">Subsidy Lost to Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.age} className={`border-b border-slate-800 ${r.crossesCliff ? 'bg-red-900/20' : ''}`}>
                      <td className="py-2 pr-3 text-slate-300">{r.age}</td>
                      <td className="py-2 pr-3 text-slate-300">{formatCurrency(r.conversion)}</td>
                      <td className="py-2 pr-3 text-slate-300">{r.fplPercent !== null ? `${r.fplPercent}%` : '—'}</td>
                      <td className="py-2 pr-3 text-emerald-400">{formatCurrency(r.subsidyKept)}</td>
                      <td className={`py-2 pr-3 ${r.subsidyLost > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                        {formatCurrency(r.subsidyLost)}{r.crossesCliff ? ' ⚠ crosses the 400% cliff' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalLost > 0 && (
              <p className="text-xs text-red-400/90 mt-2">
                Your planned conversions forfeit {formatCurrency(totalLost)} of premium credits across these years.
                Consider smaller conversions in pre-65 years (staying under the cliff) and larger ones from 65 on,
                when IRMAA — not the ACA — becomes the constraint.
              </p>
            )}
          </div>
        );
      })()}

      {/* Tax Year Snapshot */}
      <TaxYearSnapshot
        projections={projections}
        personalInfo={personalInfo}
      />
      
      {/* Roth Conversion Optimizer — goal-based strategy sweep (worker) */}
      <RothConversionOptimizer
        personalInfo={personalInfo}
        accounts={accounts}
        incomeStreams={incomeStreams}
        assets={assets}
        oneTimeEvents={oneTimeEvents}
        recurringExpenses={recurringExpenses}
        setPersonalInfo={setPersonalInfo}
      />

      {/* Roth Conversion Simulator */}
      <RothConversionSimulator
        projections={projections}
        personalInfo={personalInfo}
        accounts={accounts}
        incomeStreams={incomeStreams}
        assets={assets}
        oneTimeEvents={oneTimeEvents}
        recurringExpenses={recurringExpenses}
        retirementAge={retirementAge}
        computeProjections={computeProjections}
        setPersonalInfo={setPersonalInfo}
      />
    </div>
  );
}

// ============================================
// MonteCarloTab — Lifted to module scope
// ============================================
function MonteCarloTab({ accounts, assets, incomeStreams, oneTimeEvents, personalInfo, projections, recurringExpenses }) {
  // Retirement age: always use personalInfo as source of truth
  const retirementProjection = projections.find(p => p.myAge === personalInfo.myRetirementAge);
  const defaultRetirementAge = personalInfo.myRetirementAge;
  
  const [simSettings, setSimSettings] = useState({
    numSimulations: 1000,
    startAge: defaultRetirementAge,
    meanReturn: 0.07,
    stdDev: 0.15,
    inflationMean: 0.03,
    inflationStdDev: 0.01,
    method: 'random',     // 'random' or 'historical'
    assetMix: 0.7,        // For historical mode: 0.7 = 70% stocks / 30% bonds
    historicalStartYear: 'all',  // 'all' = run every valid start year (and resample), or a specific year
  });
  const [simResults, setSimResults] = useState(null);
  const [simError, setSimError] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  
  const endAge = personalInfo.legacyAge || 95;
  const yearsToSimulate = endAge - simSettings.startAge + 1;
  
  // Get projected portfolio balance at simulation start age
  const startProjection = projections.find(p => p.myAge === simSettings.startAge);
  const startingPortfolio = startProjection?.totalPortfolio || 0;
  
  const [simProgress, setSimProgress] = useState(0);
  
  const activeJobRef = useRef(null);

  // R6: cancel any in-flight worker job on unmount so we don't leak the worker
  // across remount cycles.
  useEffect(() => {
    return () => {
      if (activeJobRef.current && window.PlannerWorker) {
        window.PlannerWorker.cancel();
        activeJobRef.current = null;
      }
    };
  }, []);

  const runSimulation = () => {
    if (!window.PlannerWorker) {
      setSimError('Worker not available — reload the page.');
      return;
    }
    setIsRunning(true);
    setSimProgress(0);
    setSimResults(null);
    setSimError(null);
    const handle = window.PlannerWorker.run({
      type: 'monteCarlo',
      payload: { simSettings, personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses },
      onProgress: (pct) => setSimProgress(pct),
    });
    activeJobRef.current = handle;
    handle.promise
      .then((result) => {
        if (activeJobRef.current !== handle) return;  // superseded by another run
        activeJobRef.current = null;
        setSimResults(result);
        setIsRunning(false);
      })
      .catch((err) => {
        if (activeJobRef.current !== handle) return;
        activeJobRef.current = null;
        setIsRunning(false);
        if (err.message !== 'Cancelled') setSimError(err.message);
      });
  };

  const cancelSimulation = () => {
    if (!window.PlannerWorker) return;
    window.PlannerWorker.cancel();
    activeJobRef.current = null;
    setIsRunning(false);
    setSimProgress(0);
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
      
      {/* Method Selector */}
      <div className={cardStyle}>
        <h4 className="text-lg font-semibold text-slate-100 mb-3">Simulation Method</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={() => setSimSettings({...simSettings, method: 'random'})}
            className={`p-4 rounded-lg border text-left transition-all ${
              simSettings.method === 'random' 
                ? 'border-amber-500 bg-amber-500/10' 
                : 'border-slate-700 bg-slate-900 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">🎲</span>
              <span className="text-base font-semibold text-slate-100">Random Sampling</span>
            </div>
            <p className="text-xs text-slate-400">
              Each year's return is drawn independently from a normal distribution with your chosen mean and volatility. Mathematically clean. Doesn't model the correlation between bad-return years and high-inflation years that history actually shows.
            </p>
          </button>
          <button
            onClick={() => setSimSettings({...simSettings, method: 'historical'})}
            className={`p-4 rounded-lg border text-left transition-all ${
              simSettings.method === 'historical' 
                ? 'border-amber-500 bg-amber-500/10' 
                : 'border-slate-700 bg-slate-900 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">📜</span>
              <span className="text-base font-semibold text-slate-100">Historical Sequences</span>
            </div>
            <p className="text-xs text-slate-400">
              Replays actual market history (Shiller dataset, 1928-2024). Each simulation starts in a different real year (1929, 1966, 2000…). Captures the real correlations between stocks, bonds, and inflation. The most credible answer to "would my plan survive a real bad sequence?"
            </p>
          </button>
        </div>
        
        {simSettings.method === 'historical' && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-slate-900/50 rounded-lg border border-slate-700">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Stock / Bond Mix</label>
              <select
                value={simSettings.assetMix}
                onChange={e => setSimSettings({...simSettings, assetMix: Number(e.target.value)})}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-100"
              >
                <option value={1.0}>100% Stocks</option>
                <option value={0.9}>90 / 10</option>
                <option value={0.8}>80 / 20</option>
                <option value={0.7}>70 / 30 (default)</option>
                <option value={0.6}>60 / 40</option>
                <option value={0.5}>50 / 50</option>
                <option value={0.4}>40 / 60</option>
                <option value={0.3}>30 / 70 (conservative)</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">Asset allocation for the historical replay.</p>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Starting Year</label>
              <select
                value={simSettings.historicalStartYear}
                onChange={e => setSimSettings({...simSettings, historicalStartYear: e.target.value})}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-slate-100"
              >
                <option value="all">All valid years (rotate through {getValidStartYears(yearsToSimulate).length})</option>
                {getValidStartYears(yearsToSimulate).map(y => (
                  <option key={y} value={y}>{y} (run all sims as if retired in {y})</option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">Pick "all" for a true historical-success-rate, or one year for a "what if I retired in X" analysis.</p>
            </div>
            <div className="flex items-end">
              <div className="text-xs text-slate-400 leading-relaxed">
                <strong className="text-slate-300">Coverage:</strong> {HISTORICAL_RETURNS[0].year}–{HISTORICAL_RETURNS[HISTORICAL_RETURNS.length - 1].year} ({HISTORICAL_RETURNS.length} years).
                <br />
                {getValidStartYears(yearsToSimulate).length} complete {yearsToSimulate}-year sequences available.
              </div>
            </div>
          </div>
        )}
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
        <div className={`grid grid-cols-2 md:grid-cols-5 gap-4 mb-4 ${simSettings.method === 'historical' ? 'opacity-50 pointer-events-none' : ''}`}>
          {simSettings.method === 'historical' && (
            <div className="col-span-2 md:col-span-5 text-xs text-amber-300 -mb-2">
              ⓘ Random-mode parameters below are disabled. Historical mode uses real return sequences instead.
            </div>
          )}
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
          {isRunning ? (
            <button
              onClick={cancelSimulation}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium transition-colors"
            >
              ⏹ Cancel ({simProgress}%)
            </button>
          ) : (
            <button
              onClick={runSimulation}
              className={buttonPrimary}
            >
              ▶️ Run Simulation
            </button>
          )}
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
              <div className="text-sm text-slate-500">at age {endAge}</div>
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
          
          {/* Method Indicator */}
          <div className="flex items-center gap-3 px-4 py-3 bg-slate-800/40 rounded-lg border border-slate-700/50">
            <span className="text-2xl">{simResults.method === 'historical' ? '📜' : '🎲'}</span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-200">
                {simResults.method === 'historical' ? 'Historical Sequences' : 'Random Sampling'}
              </div>
              <div className="text-xs text-slate-400">
                {simResults.method === 'historical'
                  ? (simResults.historicalStartYearSetting === 'all'
                      ? `One deterministic replay of each of the ${simResults.totalSimulations.toLocaleString()} valid starting years from the Shiller dataset.`
                      : `Deterministic replay of returns starting in ${simResults.historicalStartYearSetting}.`)
                  : `${simResults.totalSimulations.toLocaleString()} simulations sampled from a normal distribution.`}
              </div>
            </div>
          </div>
          
          {/* Historical Summary Table — only when historical mode + 'all' years */}
          {simResults.method === 'historical' && simResults.historicalSummary && simResults.historicalSummary.length > 0 && (
            <div className={cardStyle}>
              <h4 className="text-lg font-semibold text-slate-100 mb-2">Per-Year Historical Outcomes</h4>
              <p className="text-xs text-slate-400 mb-4">
                Each row is a real {yearsToSimulate}-year sequence starting in the year shown. Sorted worst-first
                so you can see the historical sequences that would have broken your plan.
              </p>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-800/95 backdrop-blur-sm">
                    <tr className="text-left text-slate-400 border-b border-slate-700">
                      <th className="py-2 px-3">Start Year</th>
                      <th className="py-2 px-3 text-right">Outcome</th>
                      <th className="py-2 px-3 text-right">Final Portfolio</th>
                      <th className="py-2 px-3 text-right">Failure Age</th>
                      <th className="py-2 px-3">Era Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simResults.historicalSummary.map((row, i) => {
                      const survived = row.successRate >= 0.5;
                      const eraNote = (() => {
                        const y = row.startYear;
                        if (y >= 1929 && y <= 1932) return 'Great Depression';
                        if (y >= 1937 && y <= 1939) return 'Recession of 1937-38';
                        if (y >= 1965 && y <= 1968) return 'Pre-stagflation peak';
                        if (y >= 1969 && y <= 1974) return 'Stagflation start';
                        if (y >= 1975 && y <= 1981) return 'High inflation era';
                        if (y === 2000) return 'Dot-com peak';
                        if (y === 2007) return 'Pre-GFC';
                        if (y === 2008) return 'Global Financial Crisis';
                        if (y >= 1982 && y <= 1999) return 'Bull market era';
                        if (y >= 2009 && y <= 2019) return 'Post-GFC bull';
                        return '';
                      })();
                      return (
                        <tr 
                          key={row.startYear} 
                          className={`border-b border-slate-700/50 ${survived ? '' : 'bg-red-900/10'}`}
                        >
                          <td className="py-2 px-3 font-semibold text-slate-200">{row.startYear}</td>
                          <td className={`py-2 px-3 text-right font-medium ${survived ? 'text-emerald-400' : 'text-red-400'}`}>
                            {survived ? '✓ Survived' : '✗ Failed'}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-300 font-mono">
                            {formatCurrency(row.avgFinalPortfolio)}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-400">
                            {row.earliestFailureAge !== null ? row.earliestFailureAge : '—'}
                          </td>
                          <td className="py-2 px-3 text-xs text-slate-500">{eraNote}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 text-xs text-slate-500">
                Counts: {simResults.historicalSummary.filter(r => r.successRate >= 0.5).length} sequences survived,
                {' '}{simResults.historicalSummary.filter(r => r.successRate < 0.5).length} sequences failed.
                Overall success rate: <strong className={getSuccessColor(simResults.successRate)}>{(simResults.successRate * 100).toFixed(1)}%</strong>.
              </div>
            </div>
          )}
          
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
            <h4 className="text-lg font-semibold text-slate-100 mb-4">Sample Simulation Paths ({simResults.portfolioPaths.length} of {simResults.totalSimulations} scenarios)</h4>
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
      
      {simError && (
        <div className="p-4 bg-red-900/30 border border-red-500/50 rounded-lg mb-4">
          <h4 className="text-red-400 font-semibold mb-2">Monte Carlo Error</h4>
          <pre className="text-xs text-red-300 whitespace-pre-wrap">{simError}</pre>
        </div>
      )}
      
      {!simResults && !isRunning && !simError && (
        <div className="text-center py-12 text-slate-500">
          <p className="text-lg mb-2">Click "Run Simulation" to analyze your retirement plan</p>
          <p className="text-sm">The simulation will test {simSettings.numSimulations.toLocaleString()} random scenarios</p>
        </div>
      )}
    </div>
  );
}

// ============================================
// ScenarioComparisonTab — Lifted to module scope
// ============================================
function ScenarioComparisonTab({ activeScenarioId, assets, computeProjections, createScenario, deleteScenario, loadScenario, oneTimeEvents, personalInfo, projections, recurringExpenses, scenarios }) {
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
}

// ============================================
// StressTestTab — Lifted to module scope
// ============================================
function StressTestTab({ accounts, currentYear, incomeStreams, personalInfo, projections, recurringExpenses }) {
  const retirementAge = personalInfo.myRetirementAge;
  const endAge = personalInfo.legacyAge || 95;
  const retirementProjection = projections.find(p => p.myAge === retirementAge);
  const retirementPortfolio = retirementProjection?.totalPortfolio || 0;
  
  // Historical bear market sequences (real annual total returns, S&P 500)
  const HISTORICAL_SCENARIOS = [
    {
      id: 'dotcom_2000',
      name: '2000–2002 Dot-Com Crash',
      description: 'Three consecutive years of losses after the tech bubble burst',
      returns: [-9.1, -11.9, -22.1, 28.7, 10.9], // 2000-2004
      color: '#ef4444'
    },
    {
      id: 'gfc_2008',
      name: '2007–2009 Financial Crisis',
      description: 'The Great Recession with a devastating 2008',
      returns: [5.5, -37.0, 26.5, 15.1, 2.1], // 2007-2011
      color: '#f97316'
    },
    {
      id: 'stagflation_1973',
      name: '1973–1974 Stagflation',
      description: 'Oil crisis + high inflation + recession',
      returns: [-14.7, -26.5, 37.2, 23.8, -7.2], // 1973-1977
      color: '#eab308'
    },
    {
      id: 'lost_decade_2000',
      name: '2000–2009 Lost Decade',
      description: 'Full decade of near-zero stock returns with two crashes',
      returns: [-9.1, -11.9, -22.1, 28.7, 10.9, 4.9, 15.8, 5.5, -37.0, 26.5],
      color: '#a855f7'
    },
    {
      id: 'covid_2020',
      name: '2020 COVID Crash + Recovery',
      description: 'Sharp crash followed by rapid recovery',
      returns: [-34.0, 30.0, 18.4, 28.7, -18.1], // Approximate Q1 drawdown as annual, then recovery
      color: '#06b6d4'
    },
    {
      id: 'mild_bear',
      name: 'Mild Bear (–15%, –10%)',
      description: 'A moderate downturn in the first two years',
      returns: [-15.0, -10.0, 5.0, 8.0, 12.0],
      color: '#84cc16'
    },
    {
      id: 'japan_1990',
      name: '1990s Japan-Style Stagnation',
      description: 'Prolonged low/negative returns (no quick recovery)',
      returns: [-3.0, -5.0, 2.0, -2.0, 1.0, -4.0, 3.0, 0.0, -1.0, 2.0],
      color: '#ec4899'
    }
  ];
  
  const [selectedScenarios, setSelectedScenarios] = useState(['dotcom_2000', 'gfc_2008', 'lost_decade_2000']);
  const [stressResults, setStressResults] = useState(null);
  const [customReturns, setCustomReturns] = useState('-20, -15, 5, 8, 10');
  const [showCustom, setShowCustom] = useState(false);
  
  const toggleScenario = (id) => {
    setSelectedScenarios(prev => 
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };
  
  const runStressTest = () => {
    const scenarios = HISTORICAL_SCENARIOS.filter(s => selectedScenarios.includes(s.id));
    
    // Add custom scenario if enabled
    if (showCustom && customReturns.trim()) {
      const parsed = customReturns.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      if (parsed.length > 0) {
        scenarios.push({
          id: 'custom',
          name: 'Custom Scenario',
          description: `User-defined: ${parsed.map(r => r > 0 ? '+' + r + '%' : r + '%').join(', ')}`,
          returns: parsed,
          color: '#64748b'
        });
      }
    }
    
    // Always include baseline (deterministic)
    const baselineCAGR = retirementProjection?.weightedCAGR || 0.07;
    
    const results = scenarios.map(scenario => {
      // Clone account balances at retirement
      const accountBalances = {};
      accounts.forEach(a => {
        const retBal = retirementProjection?.perAccountBalances?.[a.id] || a.balance;
        accountBalances[a.id] = retBal;
      });
      
      const yearData = [];
      let portfolioSurvived = true;
      let failureAge = null;
      
      for (let year = 0; year <= endAge - retirementAge; year++) {
        const myAge = retirementAge + year;
        const spouseAge = personalInfo.spouseAge + (retirementAge - personalInfo.myAge) + year;
        const yearsFromNow = retirementAge - personalInfo.myAge + year;
        const inflationFactor = Math.pow(1 + personalInfo.inflationRate, yearsFromNow);
        
        // Determine this year's return: use scenario returns for early years, then revert to CAGR
        let yearReturn;
        if (year < scenario.returns.length) {
          yearReturn = scenario.returns[year] / 100; // Convert percentage to decimal
        } else {
          yearReturn = baselineCAGR; // Revert to normal returns after scenario period
        }
        
        // Calculate income
        let totalSS = 0, totalPension = 0, totalOther = 0, earned = 0, nonSSIncome = 0;
        incomeStreams.forEach(stream => {
          const ownerAge = stream.owner === 'me' ? myAge : spouseAge;
          if (ownerAge >= stream.startAge && ownerAge <= stream.endAge) {
            const yearsFromStart = ownerAge - stream.startAge;
            const adj = stream.amount * Math.pow(1 + (stream.cola || 0), yearsFromStart);
            if (stream.type === 'social_security') totalSS += adj;
            else if (stream.type === 'pension') { totalPension += adj; nonSSIncome += adj; }
            else if (stream.type === 'earned_income') { earned += adj; nonSSIncome += adj; }
            else { totalOther += adj; nonSSIncome += adj; }
          }
        });
        
        // RMDs
        let totalRMD = 0;
        accounts.forEach(account => {
          const ownerAge = account.owner === 'me' ? myAge : account.owner === 'spouse' ? spouseAge : Math.max(myAge, spouseAge);
          const ownerBirthYear = account.owner === 'me' ? personalInfo.myBirthYear : personalInfo.spouseBirthYear || personalInfo.myBirthYear;
          if (isPreTaxAccount(account.type)) {
            totalRMD += calculateRMD(accountBalances[account.id] || 0, ownerAge, ownerBirthYear);
          }
        });
        
        // Desired income
        const desiredIncome = personalInfo.desiredRetirementIncome * inflationFactor;
        const healthcare = calculateHealthcareExpenses(personalInfo, myAge, spouseAge, yearsFromNow, true, personalInfo.filingStatus === 'married_joint');
        const recurring = calculateRecurringExpenses(recurringExpenses, myAge, spouseAge, yearsFromNow, personalInfo.inflationRate);
        const adjustedDesired = desiredIncome + healthcare.total + recurring.total;
        
        // Simplified withdrawal calculation (use flat tax estimate for speed)
        const totalGuaranteed = totalSS + totalPension + totalOther;
        const taxableSS = calculateSocialSecurityTaxableAmount(totalSS, nonSSIncome, personalInfo.filingStatus);
        const grossIncome = nonSSIncome + taxableSS;
        const fedTax = calculateFederalTax(grossIncome, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate);
        const stTax = calculateStateTax(grossIncome, personalInfo.state, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate, taxableSS, totalPension, { federalTaxPaid: fedTax, primaryAge: myAge, spouseAge: spouseAge });
        const netGuaranteed = totalGuaranteed + earned - fedTax - stTax;
        const gap = Math.max(0, adjustedDesired - netGuaranteed);
        
        // Gross-up for taxes on withdrawal
        const marginalRate = grossIncome > 0 ? Math.min(0.40, (fedTax + stTax) / grossIncome * 1.3) : 0.25;
        const portfolioWithdrawal = gap > 0 ? Math.max(totalRMD, gap / (1 - marginalRate * 0.7)) : totalRMD;
        
        // Withdraw from accounts (priority order)
        let remaining = portfolioWithdrawal;
        // RMDs first
        accounts.forEach(account => {
          if (isPreTaxAccount(account.type) && remaining > 0) {
            const rmd = calculateRMD(accountBalances[account.id] || 0, 
              account.owner === 'me' ? myAge : spouseAge,
              account.owner === 'me' ? personalInfo.myBirthYear : personalInfo.spouseBirthYear || personalInfo.myBirthYear);
            const draw = Math.min(accountBalances[account.id] || 0, rmd);
            accountBalances[account.id] -= draw;
            remaining -= draw;
          }
        });
        
        // Then priority order
        const priority = personalInfo.withdrawalPriority || ['pretax', 'brokerage', 'roth'];
        const getTypes = (cat) => {
          if (cat === 'pretax') return PRE_TAX_TYPES;
          if (cat === 'roth') return ROTH_TYPES;
          return [...BROKERAGE_TYPES, ...HSA_TYPES];
        };
        for (const cat of priority) {
          if (remaining <= 0) break;
          accounts.forEach(account => {
            if (getTypes(cat).includes(account.type) && remaining > 0) {
              const draw = Math.min(accountBalances[account.id] || 0, remaining);
              accountBalances[account.id] -= draw;
              remaining -= draw;
            }
          });
        }
        
        // Apply this year's return
        accounts.forEach(account => {
          accountBalances[account.id] = Math.max(0, accountBalances[account.id] || 0) * (1 + yearReturn);
        });
        
        const totalPortfolio = Object.values(accountBalances).reduce((s, b) => s + Math.max(0, b), 0);
        
        if (totalPortfolio <= 0 && portfolioSurvived) {
          portfolioSurvived = false;
          failureAge = myAge;
        }
        
        yearData.push({
          age: myAge,
          year: currentYear + yearsFromNow,
          portfolio: Math.round(totalPortfolio),
          yearReturn: yearReturn,
          withdrawal: Math.round(portfolioWithdrawal),
          isScenarioYear: year < scenario.returns.length
        });
      }
      
      return {
        ...scenario,
        yearData,
        survived: portfolioSurvived,
        failureAge,
        finalPortfolio: yearData[yearData.length - 1]?.portfolio || 0,
        worstDrawdown: Math.min(...yearData.map(y => y.portfolio)) - retirementPortfolio,
        maxDrawdownPct: retirementPortfolio > 0 ? ((Math.min(...yearData.map(y => y.portfolio)) - retirementPortfolio) / retirementPortfolio * 100) : 0
      };
    });
    
    // Also run baseline (steady returns)
    const baseAccountBalances = {};
    accounts.forEach(a => {
      baseAccountBalances[a.id] = retirementProjection?.perAccountBalances?.[a.id] || a.balance;
    });
    const baseYearData = projections
      .filter(p => p.myAge >= retirementAge && p.myAge <= endAge)
      .map(p => ({
        age: p.myAge,
        year: p.year,
        portfolio: p.totalPortfolio,
        yearReturn: baselineCAGR,
        withdrawal: p.portfolioWithdrawal,
        isScenarioYear: false
      }));
    
    results.unshift({
      id: 'baseline',
      name: `Baseline (${(baselineCAGR * 100).toFixed(1)}% steady)`,
      description: 'Your current deterministic projection with constant returns',
      returns: [],
      color: '#22c55e',
      yearData: baseYearData,
      survived: baseYearData[baseYearData.length - 1]?.portfolio > 0,
      failureAge: null,
      finalPortfolio: baseYearData[baseYearData.length - 1]?.portfolio || 0,
      worstDrawdown: 0,
      maxDrawdownPct: 0
    });
    
    setStressResults(results);
  };
  
  // Chart colors for the lines
  const { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } = window.Recharts || {};
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold text-slate-100 mb-2">Sequence-of-Returns Stress Test</h3>
        <p className="text-slate-400 text-sm">
          Test how your retirement plan holds up when bad market years happen early. 
          Two portfolios with identical average returns can produce dramatically different outcomes 
          depending on <em>when</em> the bad years hit — this is sequence-of-returns risk.
        </p>
      </div>
      
      {/* Starting conditions */}
      <div className={cardStyle}>
        <h4 className="text-lg font-semibold text-slate-200 mb-3">Starting Conditions at Retirement (Age {retirementAge})</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-slate-500">Portfolio at Retirement</div>
            <div className="text-lg font-bold text-emerald-400">{formatCurrency(retirementPortfolio)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Annual Spending Goal</div>
            <div className="text-lg font-bold text-amber-400">{formatCurrency(personalInfo.desiredRetirementIncome)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Withdrawal Rate</div>
            <div className="text-lg font-bold text-slate-200">{retirementPortfolio > 0 ? ((personalInfo.desiredRetirementIncome / retirementPortfolio) * 100).toFixed(1) : '—'}%</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Planning Horizon</div>
            <div className="text-lg font-bold text-slate-200">{endAge - retirementAge} years (to age {endAge})</div>
          </div>
        </div>
      </div>
      
      {/* Scenario selection */}
      <div className={cardStyle}>
        <h4 className="text-lg font-semibold text-slate-200 mb-3">Select Stress Scenarios</h4>
        <p className="text-xs text-slate-500 mb-3">Each scenario replaces your first N years of retirement returns with historical bear market data, then reverts to your normal CAGR.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {HISTORICAL_SCENARIOS.map(s => (
            <label key={s.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
              selectedScenarios.includes(s.id) 
                ? 'border-amber-500/50 bg-amber-500/10' 
                : 'border-slate-700/50 hover:border-slate-600/50 bg-slate-800/30'
            }`}>
              <input 
                type="checkbox" 
                checked={selectedScenarios.includes(s.id)} 
                onChange={() => toggleScenario(s.id)}
                className="mt-1 w-4 h-4 rounded border-slate-600 text-amber-500 focus:ring-amber-500/50"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-sm font-medium text-slate-200">{s.name}</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{s.description}</p>
                <p className="text-xs text-slate-600 mt-0.5 font-mono">
                  Returns: {s.returns.map(r => (r >= 0 ? '+' : '') + r.toFixed(1) + '%').join(', ')}
                </p>
              </div>
            </label>
          ))}
        </div>
        
        {/* Custom scenario */}
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showCustom} onChange={e => setShowCustom(e.target.checked)} className="w-4 h-4 rounded border-slate-600 text-amber-500 focus:ring-amber-500/50" />
            <span className="text-sm text-slate-300">Add custom scenario</span>
          </label>
          {showCustom && (
            <div className="mt-2 flex gap-2 items-center">
              <label className="text-xs text-slate-500">Returns (%, comma-separated):</label>
              <input 
                type="text" value={customReturns} 
                onChange={e => setCustomReturns(e.target.value)}
                placeholder="-20, -15, 5, 8, 10"
                className="flex-1 bg-slate-900/80 border border-slate-600/50 rounded px-3 py-1.5 text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/50"
              />
            </div>
          )}
        </div>
        
        <div className="mt-4">
          <button onClick={runStressTest} className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900 font-semibold rounded-lg transition-all shadow-lg">
            ⚡ Run Stress Test
          </button>
        </div>
      </div>
      
      {/* Results */}
      {stressResults && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stressResults.map(result => (
              <div key={result.id} className={`${cardStyle} ${!result.survived ? 'border-red-500/50' : ''}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: result.color }} />
                  <h5 className="text-sm font-semibold text-slate-200">{result.name}</h5>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Survives to {endAge}?</span>
                    <span className={result.survived ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                      {result.survived ? '✓ Yes' : `✗ Fails at ${result.failureAge}`}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Final Portfolio</span>
                    <span className={`font-medium ${result.finalPortfolio > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatCurrency(result.finalPortfolio)}
                    </span>
                  </div>
                  {result.id !== 'baseline' && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">vs Baseline</span>
                      <span className={result.finalPortfolio < stressResults[0].finalPortfolio ? 'text-red-400' : 'text-emerald-400'}>
                        {formatCurrency(result.finalPortfolio - stressResults[0].finalPortfolio)}
                        {stressResults[0].finalPortfolio > 0 && (
                          <span className="text-xs ml-1">
                            ({((result.finalPortfolio - stressResults[0].finalPortfolio) / stressResults[0].finalPortfolio * 100).toFixed(0)}%)
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          {/* Portfolio chart */}
          {LineChart && (
            <div className={cardStyle}>
              <h4 className="text-lg font-semibold text-slate-200 mb-4">Portfolio Value Under Each Scenario</h4>
              <div style={{ height: 450 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis 
                      dataKey="age" 
                      type="number" 
                      domain={[retirementAge, endAge]}
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                      label={{ value: 'Age', position: 'insideBottom', offset: -5, fill: '#94a3b8' }}
                      allowDuplicatedCategory={false}
                    />
                    <YAxis 
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                      tickFormatter={v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : `$${(v/1000).toFixed(0)}k`}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                      labelStyle={{ color: '#e2e8f0' }}
                      formatter={(value, name) => [formatCurrency(value), name]}
                      labelFormatter={label => `Age ${label}`}
                    />
                    <Legend />
                    <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
                    {stressResults.map(result => (
                      <Line 
                        key={result.id}
                        data={result.yearData}
                        dataKey="portfolio"
                        name={result.name}
                        stroke={result.color}
                        strokeWidth={result.id === 'baseline' ? 3 : 2}
                        strokeDasharray={result.id === 'baseline' ? '8 4' : undefined}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Dashed green line = your baseline (constant {((retirementProjection?.weightedCAGR || 0.07) * 100).toFixed(1)}% returns). 
                Solid lines show each stress scenario. Bad years early in retirement permanently reduce 
                the portfolio's growth base, which compounds over decades.
              </p>
            </div>
          )}
          
          {/* Year-by-year returns table for worst scenario */}
          {(() => {
            const worstScenario = stressResults
              .filter(s => s.id !== 'baseline')
              .sort((a, b) => a.finalPortfolio - b.finalPortfolio)[0];
            
            if (!worstScenario) return null;
            
            const scenarioYears = worstScenario.yearData.filter(y => y.isScenarioYear);
            
            return (
              <div className={cardStyle}>
                <h4 className="text-lg font-semibold text-slate-200 mb-3">
                  Worst-Case Detail: {worstScenario.name}
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700/50">
                        <th className="text-left py-2 px-3 text-slate-400 font-medium">Year</th>
                        <th className="text-left py-2 px-3 text-slate-400 font-medium">Age</th>
                        <th className="text-right py-2 px-3 text-slate-400 font-medium">Return</th>
                        <th className="text-right py-2 px-3 text-slate-400 font-medium">Withdrawal</th>
                        <th className="text-right py-2 px-3 text-slate-400 font-medium">Portfolio</th>
                        <th className="text-right py-2 px-3 text-slate-400 font-medium">vs Baseline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {worstScenario.yearData.slice(0, Math.max(scenarioYears.length + 5, 15)).map((y, i) => {
                        const baselineYear = stressResults[0].yearData.find(b => b.age === y.age);
                        const diff = baselineYear ? y.portfolio - baselineYear.portfolio : 0;
                        return (
                          <tr key={y.age} className={`border-b border-slate-800/50 ${y.isScenarioYear ? 'bg-red-900/10' : ''}`}>
                            <td className="py-1.5 px-3 text-slate-300">{y.year}</td>
                            <td className="py-1.5 px-3 text-slate-300">{y.age}</td>
                            <td className={`py-1.5 px-3 text-right font-mono ${y.yearReturn < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {(y.yearReturn * 100).toFixed(1)}%
                              {y.isScenarioYear && <span className="text-red-500 ml-1">⚡</span>}
                            </td>
                            <td className="py-1.5 px-3 text-right text-slate-300">{formatCurrency(y.withdrawal)}</td>
                            <td className="py-1.5 px-3 text-right font-medium text-slate-200">{formatCurrency(y.portfolio)}</td>
                            <td className={`py-1.5 px-3 text-right ${diff < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {formatCurrency(diff)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  ⚡ = Stress scenario year (historical returns applied). After the stress period, 
                  returns revert to your normal CAGR — but the portfolio never fully catches up because 
                  withdrawals during the downturn permanently reduce the growth base.
                </p>
              </div>
            );
          })()}
          
          {/* Key insight */}
          <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
            <p className="text-amber-300 text-sm font-medium mb-1">💡 Why Sequence Risk Matters</p>
            <p className="text-slate-400 text-sm">
              A portfolio that earns 7% average returns over 30 years produces vastly different outcomes depending on 
              <em> when</em> the bad years occur. Losing 30% in year 1 of retirement is catastrophic because you're 
              simultaneously withdrawing from a shrinking portfolio — you sell low, permanently reducing your capital base. 
              The same 30% loss in year 25 has minimal impact because the portfolio has already grown.
              This is why many advisors recommend a cash buffer (1-2 years of expenses), a bond tent, or a 
              dynamic withdrawal strategy that reduces spending during downturns.
            </p>
          </div>
        </>
      )}
      
      {!stressResults && (
        <div className="text-center py-12 text-slate-500">
          <p className="text-lg mb-2">Select scenarios and click "Run Stress Test"</p>
          <p className="text-sm">See how historical bear markets would affect your retirement plan</p>
        </div>
      )}
    </div>
  );
}

// ============================================
// WithdrawalStrategiesTab — Lifted to module scope
// ============================================
function WithdrawalStrategiesTab({ accounts, incomeStreams, personalInfo, projections }) {
  // Retirement age: always use personalInfo as source of truth
  const retirementAge = personalInfo.myRetirementAge;
  const retirementProjection = projections.find(p => p.myAge === retirementAge);
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
    const startProjectionData = projections.find(p => p.myAge === settings.retirementAge);
    const startPortfolio = startProjectionData?.totalPortfolio || retirementPortfolio;
    const avgReturn = startProjectionData?.weightedCAGR || 0.07;
    
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
}

// ============================================
// SocialSecurityTab — Lifted to module scope
// ============================================
function SocialSecurityTab({ accounts, assets, computeProjections, incomeStreams, oneTimeEvents, personalInfo, recurringExpenses, setIncomeStreams }) {
  const mySSStream = incomeStreams.find(s => s.type === 'social_security' && s.owner === 'me');
  const spouseSSStream = incomeStreams.find(s => s.type === 'social_security' && s.owner === 'spouse');
  
  const [myPIA, setMyPIA] = useState(() => mySSStream?.pia || 2500);
  const [spousePIA, setSpousePIA] = useState(() => spouseSSStream?.pia || 1800);
  const [lifeExpectancy, setLifeExpectancy] = useState(90);
  const [spouseLifeExpectancy, setSpouseLifeExpectancy] = useState(92);
  
  // NEW in v38: Rate-of-return sensitivity
  // The article you sent makes the point that the optimal SS claim age depends
  // critically on assumed portfolio growth. High growth → delayed SS may not win
  // because the bridge-year withdrawals lose valuable compounding. Low growth →
  // delaying SS gives you a guaranteed 8%/yr "return" via delayed-retirement
  // credits that beats most portfolio returns.
  //
  // This slider applies a delta to every account's CAGR, then re-runs the full
  // analysis grid. Users see how the optimal claim age shifts with their growth
  // assumption — eliminating the false confidence of a single deterministic run.
  const [cagrDelta, setCagrDelta] = useState(0);  // Percentage points: -2 to +2
  
  // NEW in v38: Monte Carlo stress test
  // When enabled, each scenario in the grid runs through N simulations with
  // randomized returns (using the user's volatility assumptions). The result
  // shows success rate per scenario, capturing sequence-of-returns risk that
  // the deterministic analysis cannot model.
  const [useMcStressTest, setUseMcStressTest] = useState(false);
  const [mcRunsPerScenario, setMcRunsPerScenario] = useState(100);
  const [mcVolatility, setMcVolatility] = useState(0.15);  // 15% std dev = typical 60/40
  const [mcAnalysisStatus, setMcAnalysisStatus] = useState('idle');  // idle | running | done

  // R6: heavy SS-grid computation runs in a Web Worker. Status: 'idle' | 'running' | 'error'.
  // gridResult.allScenarios is read by the JSX below; null while a job is in flight.
  const [gridResult, setGridResult] = useState(null);
  const [gridStatus, setGridStatus] = useState('idle');
  const [gridProgress, setGridProgress] = useState(0);
  const [gridError, setGridError] = useState(null);
  const gridJobRef = useRef(null);

  const myCurrentClaimAge = mySSStream?.startAge || 67;
  const spouseCurrentClaimAge = spouseSSStream?.startAge || 67;
  
  const myBirthYear = personalInfo.myBirthYear || (new Date().getFullYear() - personalInfo.myAge);
  const spouseBirthYear = personalInfo.spouseBirthYear || (new Date().getFullYear() - personalInfo.spouseAge);
  const myFRA = getFullRetirementAge(myBirthYear);
  const spouseFRA = getFullRetirementAge(spouseBirthYear);
  
  const claimingAges = [62, 63, 64, 65, 66, 67, 68, 69, 70];
  
  // Reference table data: PIA-adjusted benefits at each claiming age.
  // Pure SSA math, no opinion. Used by the "Monthly Benefits by Claiming Age" table.
  const myBenefits = claimingAges.map(age => ({
    age,
    monthlyBenefit: calculateSSBenefit(myPIA, age, myBirthYear),
    annualBenefit: calculateSSBenefit(myPIA, age, myBirthYear) * 12,
    percentOfFRA: Math.round((calculateSSBenefit(myPIA, age, myBirthYear) / myPIA) * 100)
  }));
  
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

  // R6: dispatch the 6x6 (married) or 6x1 (single) claiming-age grid to the worker.
  // Re-runs on any input that affects the analysis. Cancels any in-flight job when
  // inputs change so the user always sees results for the latest inputs.
  const ssIsMarried = personalInfo.filingStatus === 'married_joint' && !!spouseSSStream;
  useEffect(() => {
    if (!window.PlannerWorker) {
      setGridError('Worker not available — reload the page.');
      setGridStatus('error');
      return;
    }

    // Debounce: object-ref deps (personalInfo, accounts, ...) get a new identity
    // on every parent state update, so unthrottled this fires on every keystroke
    // and slider tick — kicking off (then immediately cancelling) a worker job per
    // pointer event. 350 ms is short enough to feel snappy but long enough that a
    // typical typing burst or slider drag collapses to a single worker run.
    const DEBOUNCE_MS = 350;
    let dispatchHandle = null;
    const timer = setTimeout(() => {
      if (gridJobRef.current) {
        window.PlannerWorker.cancel();
        gridJobRef.current = null;
      }
      setGridStatus('running');
      setGridProgress(0);
      setGridError(null);

      dispatchHandle = window.PlannerWorker.run({
        type: useMcStressTest ? 'ssMonteCarlo' : 'ssGrid',
        payload: {
          personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses,
          legacyAge: lifeExpectancy, cagrDelta,
          myPIA, spousePIA, myBirthYear, spouseBirthYear,
          isMarried: ssIsMarried,
          mcRunsPerScenario, mcVolatility,
        },
        onProgress: (pct) => setGridProgress(pct),
      });
      gridJobRef.current = dispatchHandle;
      dispatchHandle.promise
        .then((data) => {
          if (gridJobRef.current !== dispatchHandle) return;
          gridJobRef.current = null;
          setGridResult(data);
          setGridStatus('idle');
          setGridProgress(100);
        })
        .catch((err) => {
          if (gridJobRef.current !== dispatchHandle) return;
          gridJobRef.current = null;
          if (err.message === 'Cancelled') return;  // expected on supersession
          setGridError(err.message);
          setGridStatus('error');
        });
    }, DEBOUNCE_MS);

    return () => {
      // Cleanup on dep change / unmount: clear the pending debounce timer AND
      // cancel any worker job that already dispatched.
      clearTimeout(timer);
      if (gridJobRef.current === dispatchHandle && dispatchHandle && window.PlannerWorker) {
        window.PlannerWorker.cancel();
        gridJobRef.current = null;
      }
    };
  }, [
    personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses,
    lifeExpectancy, cagrDelta, myPIA, spousePIA, myBirthYear, spouseBirthYear,
    ssIsMarried, useMcStressTest,
    // MC knobs are only consumed when the stress test is on. Going inert when it's
    // off prevents adjusting the slider from re-firing the deterministic grid for
    // no reason (R4).
    useMcStressTest ? mcRunsPerScenario : null,
    useMcStressTest ? mcVolatility : null,
  ]);

  const cancelGridJob = () => {
    if (!window.PlannerWorker) return;
    window.PlannerWorker.cancel();
    gridJobRef.current = null;
    setGridStatus('idle');
    setGridProgress(0);
  };

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
              <p className="text-xs text-slate-500 mt-1">Used by the Full Plan Impact Analysis below as the planning horizon. The longer you expect to live, the more delayed claiming tends to win.</p>
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
                <p className="text-xs text-slate-500 mt-1">Used by the Full Plan Impact Analysis below as the planning horizon for spouse.</p>
              </div>
            </div>
          </div>
        )}
      </div>
      
      <div className={cardStyle}>
        <h4 className="text-lg font-semibold text-amber-400 mb-2">Monthly Benefits by Claiming Age</h4>
        <p className="text-xs text-slate-500 mb-3">Reference table: what your benefit would be at each claim age based on your PIA. This is just SSA math — no recommendation. Scroll down for the Full Plan Impact Analysis to see which age is best for your full plan.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-2 px-3 text-slate-400">Claiming Age</th>
                <th className="text-right py-2 px-3 text-slate-400">% of PIA</th>
                <th className="text-right py-2 px-3 text-slate-400">Monthly</th>
                <th className="text-right py-2 px-3 text-slate-400">Annual</th>
                <th className="text-center py-2 px-3 text-slate-400">Action</th>
              </tr>
            </thead>
            <tbody>
              {myBenefits.map((row) => {
                const isCurrent = row.age === myCurrentClaimAge;
                return (
                  <tr key={row.age} className={`border-b border-slate-700/50 ${isCurrent ? 'bg-amber-900/20' : ''}`}>
                    <td className="py-2 px-3 text-slate-200">
                      {row.age} {row.age === Math.round(myFRA) && <span className="text-amber-400 text-xs">(FRA)</span>}
                      {isCurrent && <span className="ml-2 text-amber-400 text-xs">◆ Current</span>}
                    </td>
                    <td className="text-right py-2 px-3 text-slate-300">{row.percentOfFRA}%</td>
                    <td className="text-right py-2 px-3 text-slate-200">{formatCurrency(row.monthlyBenefit)}</td>
                    <td className="text-right py-2 px-3 text-slate-200">{formatCurrency(row.annualBenefit)}</td>
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
      
      {/* ═══════════════════════════════════════════════════════════════════
          ANALYSIS CONTROLS — Affect the Full Plan Impact Analysis below
          ═══════════════════════════════════════════════════════════════════ */}
      <div className={`${cardStyle} border-l-4 border-l-sky-500`}>
        <h4 className="text-lg font-semibold text-sky-400 mb-2">⚙️ Analysis Sensitivity Controls</h4>
        <p className="text-slate-400 text-sm mb-4">
          The full-plan analysis below depends heavily on your assumed portfolio growth rate.
          Researchers and practitioners increasingly agree that the optimal SS claiming age
          can <strong className="text-slate-200">flip</strong> based on this assumption — higher growth makes early
          claiming more attractive (keeping money invested in your portfolio), lower growth
          favors delaying (capturing SS's guaranteed 8%/year delayed-retirement credits).
        </p>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* CAGR sensitivity slider */}
          <div className="p-3 bg-slate-800/40 rounded-lg border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-200">Portfolio Growth Adjustment</label>
              <span className={`text-sm font-mono font-bold ${cagrDelta > 0 ? 'text-emerald-400' : cagrDelta < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                {cagrDelta > 0 ? '+' : ''}{(cagrDelta * 100).toFixed(1)}%
              </span>
            </div>
            <input
              type="range"
              min={-0.03}
              max={0.03}
              step={0.005}
              value={cagrDelta}
              onChange={e => setCagrDelta(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>−3% (pessimistic)</span>
              <span>0% (your inputs)</span>
              <span>+3% (optimistic)</span>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Applies a delta to every account's CAGR. {cagrDelta !== 0 && (
                <>The analysis below uses adjusted growth rates. Reset to 0 to see your baseline assumptions.</>
              )}
              {cagrDelta === 0 && <>Move the slider to see how the optimal SS strategy shifts with different growth assumptions.</>}
            </p>
          </div>
          
          {/* Monte Carlo stress test toggle */}
          <div className="p-3 bg-slate-800/40 rounded-lg border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-200">Monte Carlo Stress Test</label>
              <button
                onClick={() => setUseMcStressTest(!useMcStressTest)}
                className={`text-xs px-3 py-1 rounded font-medium transition-all ${
                  useMcStressTest 
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-slate-700 text-slate-400 border border-slate-600 hover:bg-slate-600'
                }`}
              >
                {useMcStressTest ? '✓ On' : '○ Off'}
              </button>
            </div>
            {useMcStressTest ? (
              <>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className="text-xs text-slate-400">Runs per scenario</label>
                    <select
                      value={mcRunsPerScenario}
                      onChange={e => setMcRunsPerScenario(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 mt-1"
                    >
                      <option value={50}>50 (fast)</option>
                      <option value={100}>100 (default)</option>
                      <option value={200}>200 (slow)</option>
                      <option value={500}>500 (very slow)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">Return volatility (σ)</label>
                    <select
                      value={mcVolatility}
                      onChange={e => setMcVolatility(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 mt-1"
                    >
                      <option value={0.08}>8% (bonds-heavy)</option>
                      <option value={0.12}>12% (60/40)</option>
                      <option value={0.15}>15% (70/30 default)</option>
                      <option value={0.18}>18% (stocks-heavy)</option>
                      <option value={0.22}>22% (100% stocks)</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-amber-300 mt-2">
                  ⚠️ With Monte Carlo, each scenario runs {mcRunsPerScenario} simulations across the SS-claiming-age grid (typically 6×6 for married, 6 for single).
                  This may take {mcRunsPerScenario >= 200 ? 'tens of seconds' : 'a few seconds'} to compute on slower machines.
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-400 mt-2">
                When enabled, the deterministic analysis is replaced by Monte Carlo — each scenario runs N simulations with randomized returns, reporting success rate (% of sims where portfolio survives to legacy age) instead of just a single outcome. This captures sequence-of-returns risk on the bridge years.
              </p>
            )}
            {useMcStressTest && (
              <p className="text-xs text-slate-500 mt-2 italic">
                Methodology note: Each simulation applies a single Normal(0, σ) shock to all accounts (correlated, sustained). This correctly ranks scenarios by their robustness to growth assumptions, but the p10/p90 tail values are wider than a true year-by-year simulation would produce. Use success rate and ranking; treat the tail dollar amounts as relative not absolute.
              </p>
            )}
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
        // R6: heavy compute runs in the worker (see useEffect above). Here we just
        // consume the result. Show loading / error states when results aren't ready.
        const legacyAge = lifeExpectancy;
        const isMarried = ssIsMarried;
        const myAges = [62, 64, 66, 67, 68, 70];
        const spouseAges = isMarried ? [62, 64, 66, 67, 68, 70] : [null];

        if (gridStatus === 'error') {
          return (
            <div className={`${cardStyle} border-l-4 border-l-red-500`}>
              <h4 className="text-lg font-semibold text-red-400 mb-2">Analysis failed</h4>
              <p className="text-slate-300 text-sm">{gridError || 'Unknown error.'}</p>
            </div>
          );
        }
        const allScenarios = gridResult?.allScenarios;
        if (!allScenarios) {
          return (
            <div className={`${cardStyle} border-l-4 border-l-sky-500`}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-lg font-semibold text-sky-400 mb-1">Computing scenarios…</h4>
                  <p className="text-slate-400 text-sm">
                    {useMcStressTest
                      ? `Running ${myAges.length * spouseAges.length} scenarios × ${mcRunsPerScenario} Monte Carlo runs`
                      : `Running ${myAges.length * spouseAges.length} deterministic scenarios`}
                    {' '}— {gridProgress}%
                  </p>
                </div>
                {gridStatus === 'running' && (
                  <button
                    onClick={cancelGridJob}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          );
        }

        // Find winners
        const bestByWealth = allScenarios.reduce((b, c) => c.netLifetimeWealth > b.netLifetimeWealth ? c : b);
        const bestByPortfolio = allScenarios.reduce((b, c) => c.portfolioAtLegacy > b.portfolioAtLegacy ? c : b);
        const lowestTax = allScenarios.reduce((b, c) => c.lifetimeTax < b.lifetimeTax ? c : b);
        const lowestWithdrawals = allScenarios.reduce((b, c) => c.lifetimeWithdrawals < b.lifetimeWithdrawals ? c : b);
        // When MC is enabled: also find the highest success rate. Tiebreak by net wealth.
        const bestBySuccessRate = useMcStressTest
          ? allScenarios.reduce((b, c) => {
              if (!c.mcResults || !b.mcResults) return b;
              if (c.mcResults.successRate !== b.mcResults.successRate) {
                return c.mcResults.successRate > b.mcResults.successRate ? c : b;
              }
              return c.netLifetimeWealth > b.netLifetimeWealth ? c : b;
            })
          : null;
        const currentScenario = allScenarios.find(s => s.myClaimAge === myCurrentClaimAge && (s.spClaimAge === spouseCurrentClaimAge || s.spClaimAge === null)) 
          || allScenarios.find(s => s.myClaimAge === myCurrentClaimAge) || allScenarios[0];
        
        // Sort by net lifetime wealth descending
        // When MC is enabled, sort by success rate primarily (with net wealth as tiebreaker).
        // Otherwise sort by net lifetime wealth as before.
        const ranked = [...allScenarios].sort((a, b) => {
          if (useMcStressTest && a.mcResults && b.mcResults) {
            if (b.mcResults.successRate !== a.mcResults.successRate) {
              return b.mcResults.successRate - a.mcResults.successRate;
            }
          }
          return b.netLifetimeWealth - a.netLifetimeWealth;
        });
        
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
        
        // Whether the user has Roth conversions enabled. Affects banner display
        // and whether the ranking table shows a "Roth Conv." column.
        const rothConversionActive = (personalInfo.rothConversionAmount || 0) > 0 || !!personalInfo.rothConversionBracket;
        
        return (
          <>
            {/* R6: in-flight banner — visible whenever the worker is recomputing,
                even when stale results are still on screen. Gives the user a cancel
                affordance during the (potentially multi-second) MC stress test. */}
            {gridStatus === 'running' && (
              <div className={`${cardStyle} border-l-4 border-l-sky-500`}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sky-300 font-medium">⏳ Recomputing scenarios… {gridProgress}%</p>
                    <p className="text-slate-400 text-xs mt-1">
                      {useMcStressTest
                        ? `${myAges.length * spouseAges.length} scenarios × ${mcRunsPerScenario} Monte Carlo runs`
                        : `${myAges.length * spouseAges.length} deterministic scenarios`}
                      {' '}— results below reflect previous inputs until this finishes.
                    </p>
                  </div>
                  <button
                    onClick={cancelGridJob}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {/* Winner Summary */}
            <div className={`${cardStyle} border-l-4 border-l-emerald-500`}>
              <h4 className="text-lg font-semibold text-emerald-400 mb-3">📊 Full Plan Impact Analysis</h4>
              <p className="text-slate-400 text-sm mb-2">
                {isMarried 
                  ? `Runs your complete retirement plan for ${myAges.length * spouseAges.length} combinations of your and your spouse's claiming ages — including taxes, withdrawals, RMDs, growth, survivor benefits, and Roth conversions — to show the true financial impact.`
                  : 'Runs your complete retirement plan for each claiming age — including taxes, portfolio withdrawals, RMDs, growth, and Roth conversions — to show the true financial impact beyond simple breakeven math.'}
              </p>
              <p className="text-slate-500 text-xs mb-4">
                Using life expectancy of {legacyAge} from the controls above. Both the breakeven analysis and this full-plan analysis use the same planning horizon so their recommendations align. Adjust the life expectancy slider above to see how longevity affects the optimal strategy.
              </p>
              {isMarried && personalInfo.survivorModelEnabled && (
                <div className="mb-4 p-3 bg-sky-900/30 border border-sky-700/50 rounded-lg text-sm">
                  <p className="text-sky-300 font-medium">👤 Survivor benefits are modeled</p>
                  <p className="text-sky-400/70 text-xs mt-1">When the first spouse passes, the survivor inherits the higher of the two SS benefits. Claiming later as the higher earner increases the survivor benefit — this is factored into every scenario below.</p>
                </div>
              )}
              {/* Roth conversion status banner — surfaces whether the analysis below
                  reflects active Roth conversion strategy. The engine already passes
                  the full personalInfo (including rothConversion* fields) into each
                  scenario's computeProjections call, so conversions ARE modeled. But
                  without this banner, users can't tell that's happening — and the
                  conversion amount changes with SS claim age, which is the whole point
                  of comparing scenarios. */}
              {(() => {
                const conversionActive = (personalInfo.rothConversionAmount || 0) > 0 || personalInfo.rothConversionBracket;
                if (!conversionActive) {
                  return (
                    <div className="mb-4 p-3 bg-slate-800/50 border border-slate-700 rounded-lg text-sm">
                      <p className="text-slate-300 font-medium">🔄 Roth conversions are OFF in this plan</p>
                      <p className="text-slate-500 text-xs mt-1">If you enable Roth conversions in <strong className="text-slate-300">Personal Info → Roth Conversions</strong>, the analysis below will model them in each scenario. Conversion amounts depend on SS timing (earlier SS = less bracket room for cheap conversions), which can shift the optimal claim age.</p>
                    </div>
                  );
                }
                // Build the config description
                const mode = personalInfo.rothConversionBracket
                  ? `fill to ${personalInfo.rothConversionBracket} bracket`
                  : `${formatCurrency(personalInfo.rothConversionAmount || 0)}/yr (fixed)`;
                const ssDefaultWindow = getDefaultRothConversionWindow(personalInfo);
                const ages = `ages ${personalInfo.rothConversionStartAge || ssDefaultWindow.startAge}–${personalInfo.rothConversionEndAge || ssDefaultWindow.endAge}`;
                // Find scenarios with most/fewest conversions to give the user a teaser of the interaction
                const mostConv = allScenarios.reduce((b, c) => c.lifetimeRothConversions > b.lifetimeRothConversions ? c : b);
                const fewestConv = allScenarios.reduce((b, c) => c.lifetimeRothConversions < b.lifetimeRothConversions ? c : b);
                const convSpread = mostConv.lifetimeRothConversions - fewestConv.lifetimeRothConversions;
                // Detect a narrower-than-optimal window for the warning hint
                const userStart = personalInfo.rothConversionStartAge || ssDefaultWindow.startAge;
                const userEnd = personalInfo.rothConversionEndAge || ssDefaultWindow.endAge;
                const narrowerThanOptimal = userStart > ssDefaultWindow.startAge || userEnd < ssDefaultWindow.endAge;
                const userYears = userEnd - userStart + 1;
                const smartYears = ssDefaultWindow.endAge - ssDefaultWindow.startAge + 1;
                
                return (
                  <div className="mb-4 p-3 bg-purple-900/30 border border-purple-700/50 rounded-lg text-sm">
                    <p className="text-purple-300 font-medium">🔄 Roth conversions are ACTIVE in this analysis</p>
                    <p className="text-purple-400/70 text-xs mt-1">Strategy: <strong className="text-purple-200">{mode}</strong>, {ages}. Each scenario below executes conversions according to this strategy.</p>
                    {narrowerThanOptimal && (
                      <p className="text-amber-300/90 text-xs mt-2">
                        ⚠ Your conversion window is {userYears} year{userYears !== 1 ? 's' : ''}, but the standard "bridge years" approach uses {smartYears} years (retirement age {ssDefaultWindow.startAge} through {ssDefaultWindow.endAge}, the year before RMDs at {getRmdStartAge(personalInfo.myBirthYear)}). Adjust in <strong className="text-amber-200">Personal Info → Roth Conversions</strong> for a more complete analysis.
                      </p>
                    )}
                    {convSpread > 1000 && (
                      <p className="text-purple-400/70 text-xs mt-2">
                        <strong className="text-purple-200">SS timing affects conversion size:</strong> across the {allScenarios.length} scenarios below, lifetime Roth conversions range from <strong className="text-purple-200">{formatCurrency(fewestConv.lifetimeRothConversions)}</strong> ({fewestConv.label}) to <strong className="text-purple-200">{formatCurrency(mostConv.lifetimeRothConversions)}</strong> ({mostConv.label}) — a spread of {formatCurrency(convSpread)}. Earlier SS claims push you into higher brackets, leaving less room for cheap conversions. The "Roth Conv." column in the ranking table below shows the conversion total for each scenario.
                      </p>
                    )}
                  </div>
                );
              })()}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* When MC is on, Highest Success Rate is the most decision-relevant
                    winner — it tells you which strategy survives the most bad-luck
                    scenarios. We swap it in for "Fewest Withdrawals" which is the
                    least-actionable of the deterministic metrics. */}
                {useMcStressTest && bestBySuccessRate?.mcResults ? (
                  <div className="p-3 bg-emerald-900/30 rounded-lg border border-emerald-700/40">
                    <p className="text-emerald-300 text-xs uppercase tracking-wide font-semibold">🎯 Highest Success Rate</p>
                    <p className="text-xl font-bold text-emerald-400">{bestBySuccessRate.label}</p>
                    <p className="text-slate-400 text-xs mt-1">{(bestBySuccessRate.mcResults.successRate * 100).toFixed(1)}% of {mcRunsPerScenario} sims survived</p>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-800/50 rounded-lg">
                    <p className="text-slate-500 text-xs uppercase tracking-wide">Highest Net Wealth</p>
                    <p className="text-xl font-bold text-emerald-400">{bestByWealth.label}</p>
                    <p className="text-slate-400 text-xs mt-1">{formatCurrency(bestByWealth.netLifetimeWealth)}</p>
                  </div>
                )}
                {useMcStressTest ? (
                  <div className="p-3 bg-slate-800/50 rounded-lg">
                    <p className="text-slate-500 text-xs uppercase tracking-wide">Highest Net Wealth</p>
                    <p className="text-xl font-bold text-emerald-400">{bestByWealth.label}</p>
                    <p className="text-slate-400 text-xs mt-1">{formatCurrency(bestByWealth.netLifetimeWealth)}</p>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-800/50 rounded-lg">
                    <p className="text-slate-500 text-xs uppercase tracking-wide">Largest Legacy</p>
                    <p className="text-xl font-bold text-sky-400">{bestByPortfolio.label}</p>
                    <p className="text-slate-400 text-xs mt-1">{formatCurrency(bestByPortfolio.portfolioAtLegacy)} at {legacyAge}</p>
                  </div>
                )}
                <div className="p-3 bg-slate-800/50 rounded-lg">
                  <p className="text-slate-500 text-xs uppercase tracking-wide">Lowest Taxes</p>
                  <p className="text-xl font-bold text-purple-400">{lowestTax.label}</p>
                  <p className="text-slate-400 text-xs mt-1">{formatCurrency(lowestTax.lifetimeTax)}</p>
                </div>
                <div className="p-3 bg-slate-800/50 rounded-lg">
                  <p className="text-slate-500 text-xs uppercase tracking-wide">{useMcStressTest ? 'Largest Legacy' : 'Fewest Withdrawals'}</p>
                  <p className={`text-xl font-bold ${useMcStressTest ? 'text-sky-400' : 'text-orange-400'}`}>
                    {useMcStressTest ? bestByPortfolio.label : lowestWithdrawals.label}
                  </p>
                  <p className="text-slate-400 text-xs mt-1">
                    {useMcStressTest 
                      ? `${formatCurrency(bestByPortfolio.portfolioAtLegacy)} at ${legacyAge}`
                      : formatCurrency(lowestWithdrawals.lifetimeWithdrawals)
                    }
                  </p>
                </div>
              </div>
            </div>

            {/* Ranked Comparison Table */}
            <div className={cardStyle}>
              <h4 className="text-lg font-semibold text-amber-400 mb-2">
                All Scenarios Ranked by {useMcStressTest ? 'Success Rate' : 'Net Lifetime Wealth'}
              </h4>
              <p className="text-xs text-slate-500 mb-3">
                {useMcStressTest 
                  ? `Each scenario was stress-tested with ${mcRunsPerScenario} Monte Carlo simulations. Success rate = % of sims where portfolio survived to age ${legacyAge}. Median (p50) is the typical outcome; p10 is the bad-luck scenario (90% of sims did better).`
                  : `Net Wealth = portfolio at age ${legacyAge} + total SS received during retirement. Lifetime taxes and withdrawals are summed from retirement through ${legacyAge}.`
                }
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 px-2 text-slate-400">#</th>
                      <th className="text-left py-2 px-2 text-slate-400">{isMarried ? 'My Age / Spouse Age' : 'Claim Age'}</th>
                      {isMarried && <th className="text-right py-2 px-2 text-slate-400">Combined SS</th>}
                      {useMcStressTest && <th className="text-right py-2 px-2 text-slate-400">Success Rate</th>}
                      {useMcStressTest && <th className="text-right py-2 px-2 text-slate-400">p10 Portfolio</th>}
                      {useMcStressTest && <th className="text-right py-2 px-2 text-slate-400">p50 Portfolio</th>}
                      <th className="text-right py-2 px-2 text-slate-400">Portfolio @{legacyAge}</th>
                      <th className="text-right py-2 px-2 text-slate-400">Lifetime SS</th>
                      <th className="text-right py-2 px-2 text-slate-400">Lifetime Taxes</th>
                      <th className="text-right py-2 px-2 text-slate-400">Withdrawals</th>
                      {rothConversionActive && <th className="text-right py-2 px-2 text-slate-400">Roth Conv.</th>}
                      <th className="text-right py-2 px-2 text-slate-400">Net Wealth</th>
                      <th className="text-right py-2 px-2 text-slate-400">Δ vs Current</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((s, i) => {
                      const isCurrent = s === currentScenario;
                      const isBest = i === 0;
                      const delta = s.netLifetimeWealth - currentScenario.netLifetimeWealth;
                      const mc = s.mcResults;
                      const successColor = mc ? (mc.successRate >= 0.9 ? 'text-emerald-400' : mc.successRate >= 0.75 ? 'text-amber-400' : 'text-red-400') : '';
                      return (
                        <tr key={s.label} className={`border-b border-slate-700/50 ${isBest ? 'bg-emerald-900/20' : ''} ${isCurrent ? 'bg-amber-900/20' : ''}`}>
                          <td className="py-2 px-2 text-slate-500">{i + 1}</td>
                          <td className="py-2 px-2 text-slate-200">
                            {s.label}
                            {isBest && <span className="ml-1 text-emerald-400 text-xs">★</span>}
                            {isCurrent && <span className="ml-1 text-amber-400 text-xs">◆ Current</span>}
                          </td>
                          {isMarried && <td className="text-right py-2 px-2 text-slate-300">{formatCurrency(s.myAnnualSS + s.spAnnualSS)}/yr</td>}
                          {useMcStressTest && mc && (
                            <td className={`text-right py-2 px-2 font-bold ${successColor}`}>
                              {(mc.successRate * 100).toFixed(1)}%
                            </td>
                          )}
                          {useMcStressTest && mc && (
                            <td className="text-right py-2 px-2 text-red-300">{formatCurrency(mc.p10)}</td>
                          )}
                          {useMcStressTest && mc && (
                            <td className="text-right py-2 px-2 text-amber-300">{formatCurrency(mc.p50)}</td>
                          )}
                          <td className={`text-right py-2 px-2 font-medium ${s.portfolioAtLegacy > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {formatCurrency(s.portfolioAtLegacy)}
                          </td>
                          <td className="text-right py-2 px-2 text-sky-400">{formatCurrency(s.lifetimeSS)}</td>
                          <td className="text-right py-2 px-2 text-purple-400">{formatCurrency(s.lifetimeTax)}</td>
                          <td className="text-right py-2 px-2 text-orange-400">{formatCurrency(s.lifetimeWithdrawals)}</td>
                          {rothConversionActive && (
                            <td className="text-right py-2 px-2 text-purple-300">{formatCurrency(s.lifetimeRothConversions)}</td>
                          )}
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
                <p><span className="text-slate-300 font-medium">Portfolio preservation:</span> Claiming later means drawing down your portfolio faster in the gap years before SS starts. But once the higher benefit kicks in, withdrawals drop and the portfolio recovers — sometimes significantly. The portfolio trajectory chart above shows these crossover dynamics clearly.</p>
                <p><span className="text-slate-300 font-medium">Don't trust a single deterministic answer:</span> The "Analysis Sensitivity Controls" above let you test how the optimal claim age responds to different return assumptions (the CAGR slider) and to sequence-of-returns risk (the Monte Carlo toggle). The optimal age can flip between early and late depending on these. Try ±2% on the CAGR slider before committing to a strategy.</p>
                {isMarried && <p><span className="text-slate-300 font-medium">Survivor benefits matter:</span> {personalInfo.survivorModelEnabled ? 'Your survivor modeling is ON — when the first spouse passes, the survivor inherits the higher SS benefit. This significantly favors the higher earner claiming later.' : '⚠️ Your survivor modeling is currently OFF. Enable it in Personal Info → Survivor Modeling to see how the surviving spouse inheriting the higher SS benefit affects these results — it often changes the optimal strategy.'}</p>}
                {((personalInfo.rothConversionAmount || 0) > 0 || personalInfo.rothConversionBracket) && (
                  <p><span className="text-slate-300 font-medium">Roth conversion interaction:</span> Your active Roth conversion strategy is reflected in every scenario. The 'Roth Conv.' column in the ranking table shows lifetime conversion amounts — SS claim age changes how much bracket room you have for cheap conversions. See the conversion total range in the banner above the analysis.</p>
                )}
                <p><span className="text-slate-300 font-medium">Life expectancy uncertainty:</span> These projections assume you live to age {legacyAge}. If longevity is shorter, earlier claiming may win; if longer, delayed claiming becomes increasingly valuable. Adjust the life expectancy slider at the top of the tab to test different assumptions.</p>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

// ============================================
// SensitivityTab — Lifted to module scope
// ============================================
function SensitivityTab({ accounts, assets, computeProjections, incomeStreams, oneTimeEvents, personalInfo, projections, recurringExpenses }) {
  const retirementAge = personalInfo.myRetirementAge;
  const endAge = personalInfo.legacyAge || 95;
  const baseRetirementProj = projections.find(p => p.myAge === retirementAge);
  const baseEndProj = projections.find(p => p.myAge === endAge);
  
  const [results, setResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  
  // Define the sensitivity variables and their ranges
  const sensitivityVars = [
    {
      id: 'returns',
      label: 'Investment Returns (CAGR)',
      baseLabel: 'Current CAGR',
      baseValue: accounts.length > 0
        ? (accounts.reduce((sum, a) => sum + a.cagr * a.balance, 0) / Math.max(1, accounts.reduce((sum, a) => sum + a.balance, 0)))
        : 0.07,
      steps: [-0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04],
      formatStep: (base, delta) => `${((base + delta) * 100).toFixed(1)}%`,
      formatDelta: (delta) => `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(0)}%`,
      apply: (delta) => {
        const modifiedAccounts = accounts.map(a => ({ ...a, cagr: Math.max(0, a.cagr + delta) }));
        return computeProjections(personalInfo, modifiedAccounts, incomeStreams, assets, oneTimeEvents, recurringExpenses);
      }
    },
    {
      id: 'retirement_age',
      label: 'Retirement Age',
      baseLabel: 'Current age',
      baseValue: personalInfo.myRetirementAge,
      steps: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5],
      formatStep: (base, delta) => `Age ${base + delta}`,
      formatDelta: (delta) => `${delta > 0 ? '+' : ''}${delta} yr`,
      apply: (delta) => {
        const newRetAge = personalInfo.myRetirementAge + delta;
        const modifiedPI = { ...personalInfo, myRetirementAge: newRetAge };
        
        // Adjust earned income streams: shift endAge by the same delta
        // Only adjust streams whose endAge currently aligns with retirement age
        // (within 1 year), so we don't break intentionally early/late income
        const modifiedStreams = incomeStreams.map(s => {
          if (s.type === 'earned_income') {
            const ownerRetAge = s.owner === 'spouse' 
              ? personalInfo.spouseRetirementAge 
              : personalInfo.myRetirementAge;
            // If this stream's endAge is close to the owner's retirement age,
            // shift it in lockstep (e.g., salary ending at 64 when retiring at 65)
            if (Math.abs(s.endAge - (ownerRetAge - 1)) <= 1 || Math.abs(s.endAge - ownerRetAge) <= 1) {
              return { ...s, endAge: s.endAge + (s.owner === 'me' ? delta : 0) };
            }
          }
          return s;
        });
        
        // Adjust account contribution stop ages similarly
        const modifiedAccounts = accounts.map(a => {
          const ownerRetAge = a.owner === 'spouse' 
            ? personalInfo.spouseRetirementAge 
            : personalInfo.myRetirementAge;
          // If stopAge aligns with retirement age, shift it
          if (Math.abs(a.stopAge - ownerRetAge) <= 1 && a.owner !== 'spouse') {
            return { ...a, stopAge: a.stopAge + delta };
          }
          return a;
        });
        
        return computeProjections(modifiedPI, modifiedAccounts, modifiedStreams, assets, oneTimeEvents, recurringExpenses);
      }
    },
    {
      id: 'spending',
      label: 'Annual Spending Goal',
      baseLabel: 'Current goal',
      baseValue: personalInfo.desiredRetirementIncome,
      steps: [-40000, -20000, 0, 20000, 40000],
      formatStep: (base, delta) => formatCurrency(base + delta),
      formatDelta: (delta) => `${delta > 0 ? '+' : ''}${formatCurrency(delta)}`,
      apply: (delta) => {
        const modifiedPI = { ...personalInfo, desiredRetirementIncome: Math.max(0, personalInfo.desiredRetirementIncome + delta) };
        return computeProjections(modifiedPI, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses);
      }
    },
    {
      id: 'inflation',
      label: 'Inflation Rate',
      baseLabel: 'Current rate',
      baseValue: personalInfo.inflationRate,
      steps: [-0.01, -0.005, 0, 0.005, 0.01],
      formatStep: (base, delta) => `${((base + delta) * 100).toFixed(1)}%`,
      formatDelta: (delta) => `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`,
      apply: (delta) => {
        const modifiedPI = { ...personalInfo, inflationRate: Math.max(0, personalInfo.inflationRate + delta) };
        return computeProjections(modifiedPI, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses);
      }
    },
    {
      id: 'ss_age',
      label: 'Social Security Claiming Age',
      baseLabel: 'Current claim age',
      baseValue: (() => {
        const mySSStream = incomeStreams.find(s => s.type === 'social_security' && s.owner === 'me');
        return mySSStream ? mySSStream.startAge : 67;
      })(),
      // Test every claiming age from 62 to 70 — steps are absolute ages, not deltas
      steps: [62, 63, 64, 65, 66, 67, 68, 69, 70],
      isAbsolute: true, // Flag: steps are absolute values, not deltas from base
      formatStep: (base, step) => `Age ${step}`,
      formatDelta: (step) => {
        const mySSStream = incomeStreams.find(s => s.type === 'social_security' && s.owner === 'me');
        const baseAge = mySSStream ? mySSStream.startAge : 67;
        const diff = step - baseAge;
        return diff === 0 ? 'current' : `${diff > 0 ? '+' : ''}${diff} yr`;
      },
      apply: (claimAge) => {
        const modifiedStreams = incomeStreams.map(s => {
          if (s.type === 'social_security' && s.owner === 'me') {
            // Recalculate benefit amount based on new claiming age
            const pia = s.pia || Math.round(s.amount / 12);
            const birthYear = personalInfo.myBirthYear || (new Date().getFullYear() - personalInfo.myAge);
            const newAnnualBenefit = calculateSSBenefit(pia, claimAge, birthYear) * 12;
            return { ...s, startAge: claimAge, amount: newAnnualBenefit };
          }
          return s;
        });
        return computeProjections(personalInfo, accounts, modifiedStreams, assets, oneTimeEvents, recurringExpenses);
      }
    },
    {
      id: 'contributions',
      label: 'Annual Contributions',
      baseLabel: 'Current total',
      baseValue: accounts.reduce((sum, a) => sum + (a.contribution || 0), 0),
      steps: [-80000, -60000, -40000, -20000, 0, 20000, 40000, 60000, 80000],
      formatStep: (base, delta) => formatCurrency(base + delta),
      formatDelta: (delta) => `${delta > 0 ? '+' : ''}${formatCurrency(delta)}`,
      apply: (delta) => {
        // IRS annual contribution limits (2026: Notice 2025-67 / IR-2025-111; HSA: Rev. Proc. 2025-19)
        // These are EMPLOYEE limits — employer match is separate and not capped here.
        // Accounts with contributor='employer' or 'both' may exceed these limits because
        // the combined amount includes employer match. We only cap 'me' contributions.
        const CONTRIBUTION_LIMITS = {
          '401k':           { base: 24500, catchUp50: 8000, superCatchUp60: 11250 },
          'roth_401k':      { base: 24500, catchUp50: 8000, superCatchUp60: 11250 },
          '403b':           { base: 24500, catchUp50: 8000, superCatchUp60: 11250 },
          'roth_403b':      { base: 24500, catchUp50: 8000, superCatchUp60: 11250 },
          '457b':           { base: 24500, catchUp50: 8000, superCatchUp60: 0 },
          'roth_457b':      { base: 24500, catchUp50: 8000, superCatchUp60: 0 },
          'traditional_ira':{ base: 7500,  catchUp50: 1100, superCatchUp60: 0 },
          'roth_ira':       { base: 7500,  catchUp50: 1100, superCatchUp60: 0 },
          'hsa':            { base: 4400,  catchUp55: 1000 },  // Single; family is $8,750
          'brokerage':      { base: Infinity } // No limit
        };
        
        const getLimit = (accountType, ownerAge, filingStatus) => {
          const limits = CONTRIBUTION_LIMITS[accountType];
          if (!limits) return Infinity;
          if (accountType === 'hsa') {
            let limit = filingStatus === 'married_joint' ? 8750 : limits.base;
            if (ownerAge >= 55) limit += (limits.catchUp55 || 0);
            return limit;
          }
          let limit = limits.base;
          if (ownerAge >= 50) limit += (limits.catchUp50 || 0);
          // SECURE 2.0 super catch-up for ages 60-63 (replaces regular catch-up)
          if (ownerAge >= 60 && ownerAge <= 63 && limits.superCatchUp60) {
            limit = limits.base + limits.superCatchUp60;
          }
          return limit;
        };
        
        // Distribute delta proportionally across accounts with contributions,
        // capped at IRS limits for employee contributions
        const totalContrib = accounts.reduce((sum, a) => sum + (a.contribution || 0), 0);
        const modifiedAccounts = accounts.map(a => {
          if (a.contribution > 0 && totalContrib > 0) {
            const share = a.contribution / totalContrib;
            let newContrib = Math.max(0, a.contribution + delta * share);
            
            // Only enforce limits on employee contributions (contributor = 'me')
            // 'employer' and 'both' include match which has its own 415(c) total limit
            if ((a.contributor || 'me') === 'me') {
              const ownerAge = a.owner === 'spouse' ? personalInfo.spouseAge : personalInfo.myAge;
              const limit = getLimit(a.type, ownerAge, personalInfo.filingStatus);
              newContrib = Math.min(newContrib, limit);
            }
            
            return { ...a, contribution: newContrib };
          }
          return a;
        });
        return computeProjections(personalInfo, modifiedAccounts, incomeStreams, assets, oneTimeEvents, recurringExpenses);
      }
    }
  ];
  
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' });
  
  const runAnalysis = () => {
    setIsRunning(true);
    setResults(null);
    
    // Yield to the UI between each sensitivity variable so the page stays responsive.
    // Each variable runs N projections (typically 5), so we yield between variables
    // rather than between projections within a variable. This keeps the simulation
    // semantically atomic per variable while preventing UI freeze on slow phones.
    const totalVars = sensitivityVars.length;
    setProgress({ current: 0, total: totalVars, label: 'Starting…' });
    
    const analysisResults = [];
    let varIndex = 0;
    
    const runOneVariable = () => {
      try {
        if (varIndex >= sensitivityVars.length) {
          setResults(analysisResults);
          setProgress({ current: totalVars, total: totalVars, label: 'Complete' });
          setIsRunning(false);
          return;
        }
        
        const variable = sensitivityVars[varIndex];
        setProgress({ current: varIndex, total: totalVars, label: variable.label });
        
        const stepResults = variable.steps.map(step => {
          // For absolute-step variables (like SS age 62-70), step IS the value.
          // For delta-step variables, step is added to the base.
          const isBase = variable.isAbsolute 
            ? step === variable.baseValue 
            : step === 0;
          const delta = variable.isAbsolute ? step - variable.baseValue : step;
          
          const proj = isBase ? projections : variable.apply(step);
          
          // For retirement age variations, use the modified retirement age
          const scenarioRetAge = variable.id === 'retirement_age' 
            ? retirementAge + delta 
            : retirementAge;
          
          const atRetirement = proj.find(p => p.myAge === scenarioRetAge);
          const atEnd = proj.find(p => p.myAge === endAge);
          const failureAge = proj.find(p => p.myAge >= scenarioRetAge && p.totalPortfolio <= 0);
          
          // Calculate lifetime taxes over the full projection (not just post-retirement)
          // This captures how retirement age shifts affect total tax burden
          const lifetimeTax = proj.reduce((sum, p) => sum + (p.totalTax || 0), 0);
          const lifetimeWithdrawals = proj.filter(p => p.myAge >= scenarioRetAge)
            .reduce((sum, p) => sum + (p.portfolioWithdrawal || 0), 0);
          
          return {
            delta,
            step,
            label: variable.formatStep(variable.baseValue, step),
            deltaLabel: variable.formatDelta(step),
            isBase,
            portfolioAtRetirement: atRetirement?.totalPortfolio || 0,
            portfolioAtEnd: atEnd?.totalPortfolio || 0,
            survives: !failureAge,
            failureAge: failureAge?.myAge || null,
            lifetimeTax,
            lifetimeWithdrawals,
            netIncomeAtRetirement: atRetirement?.netIncome || 0
          };
        });
        
        analysisResults.push({
          ...variable,
          stepResults
        });
        
        varIndex++;
        // Yield to the browser before running the next variable
        setTimeout(runOneVariable, 0);
      } catch (err) {
        console.error('Sensitivity analysis error:', err);
        setIsRunning(false);
        setProgress({ current: 0, total: 0, label: '' });
      }
    };
    
    // Kick off after a brief delay so the "Running" state can paint
    setTimeout(runOneVariable, 50);
  };
  
  // Color scale for impact cells
  const getImpactColor = (value, baseValue) => {
    if (baseValue === 0) return '';
    const pctChange = (value - baseValue) / Math.abs(baseValue);
    if (pctChange > 0.1) return 'text-emerald-400';
    if (pctChange > 0.02) return 'text-emerald-400/70';
    if (pctChange < -0.1) return 'text-red-400';
    if (pctChange < -0.02) return 'text-red-400/70';
    return 'text-slate-300';
  };
  
  const getImpactBg = (value, baseValue) => {
    if (baseValue === 0) return '';
    const pctChange = (value - baseValue) / Math.abs(baseValue);
    if (pctChange > 0.1) return 'bg-emerald-500/10';
    if (pctChange < -0.1) return 'bg-red-500/10';
    return '';
  };
  
  const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, Cell } = window.Recharts || {};
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold text-slate-100 mb-2">Sensitivity Analysis</h3>
        <p className="text-slate-400 text-sm">
          See how your retirement plan changes when you adjust one variable at a time. 
          This answers questions like "what if returns are 1% lower?" or "what if I spend $10K more per year?" 
          — making it easy to identify which assumptions your plan is most sensitive to.
        </p>
      </div>
      
      <div className={cardStyle}>
        <h4 className="text-lg font-semibold text-slate-200 mb-3">Your Current Baseline</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <div className="text-xs text-slate-500">Portfolio at Retirement</div>
            <div className="text-lg font-bold text-emerald-400">{formatCurrency(baseRetirementProj?.totalPortfolio)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Portfolio at Age {endAge}</div>
            <div className="text-lg font-bold text-amber-400">{formatCurrency(baseEndProj?.totalPortfolio)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Spending Goal</div>
            <div className="text-lg font-bold text-slate-200">{formatCurrency(personalInfo.desiredRetirementIncome)}/yr</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Retire at / Plan to</div>
            <div className="text-lg font-bold text-slate-200">Age {retirementAge} → {endAge}</div>
          </div>
        </div>
        <button 
          onClick={runAnalysis} 
          disabled={isRunning}
          className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900 font-semibold rounded-lg transition-all shadow-lg disabled:opacity-50"
        >
          {isRunning 
            ? `⏳ ${progress.label || 'Starting…'} (${progress.current}/${progress.total})` 
            : '🔬 Run Sensitivity Analysis'}
        </button>
        {isRunning && progress.total > 0 && (
          <div className="mt-2 w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-gradient-to-r from-amber-500 to-orange-500 h-full transition-all duration-200" 
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        )}
        <p className="text-xs text-slate-500 mt-2">
          Runs your full projection engine {sensitivityVars.reduce((sum, v) => sum + v.steps.length, 0)} times (one per variable × step combination). UI stays responsive while running.
        </p>
      </div>
      
      {results && (
        <>
          {/* Tornado chart: which variables matter most */}
          <div className={cardStyle}>
            <h4 className="text-lg font-semibold text-slate-200 mb-2">Impact Ranking: Which Variables Matter Most?</h4>
            <p className="text-xs text-slate-500 mb-4">Shows the range of ending portfolio values when each variable is adjusted to its minimum and maximum test values. Wider bars = your plan is more sensitive to that variable.</p>
            
            {(() => {
              // Build tornado data: for each variable, get the min and max portfolio-at-end
              const basePortfolio = results[0]?.stepResults.find(s => s.isBase)?.portfolioAtEnd || 0;
              const tornadoData = results.map(variable => {
                const portfolios = variable.stepResults.map(s => s.portfolioAtEnd);
                const minPortfolio = Math.min(...portfolios);
                const maxPortfolio = Math.max(...portfolios);
                return {
                  name: variable.label,
                  downside: minPortfolio - basePortfolio,
                  upside: maxPortfolio - basePortfolio,
                  range: maxPortfolio - minPortfolio
                };
              }).sort((a, b) => b.range - a.range);
              
              return (
                <div className="space-y-3">
                  {tornadoData.map((item, idx) => {
                    const maxRange = Math.max(...tornadoData.map(d => d.range));
                    const barScale = maxRange > 0 ? 100 / maxRange : 1;
                    const downsideWidth = Math.abs(item.downside) * barScale;
                    const upsideWidth = Math.abs(item.upside) * barScale;
                    
                    return (
                      <div key={idx} className="flex items-center gap-3">
                        <div className="w-40 text-sm text-slate-300 text-right flex-shrink-0 truncate">{item.name}</div>
                        <div className="flex-1 flex items-center h-8">
                          {/* Downside bar (left, red) */}
                          <div className="flex-1 flex justify-end">
                            <div 
                              className="h-6 bg-red-500/60 rounded-l flex items-center justify-start pl-1"
                              style={{ width: `${Math.max(2, downsideWidth)}%` }}
                            >
                              {downsideWidth > 15 && (
                                <span className="text-[10px] text-red-200 whitespace-nowrap">{formatCurrency(item.downside)}</span>
                              )}
                            </div>
                          </div>
                          {/* Center line */}
                          <div className="w-px h-8 bg-slate-500 flex-shrink-0" />
                          {/* Upside bar (right, green) */}
                          <div className="flex-1">
                            <div 
                              className="h-6 bg-emerald-500/60 rounded-r flex items-center justify-end pr-1"
                              style={{ width: `${Math.max(2, upsideWidth)}%` }}
                            >
                              {upsideWidth > 15 && (
                                <span className="text-[10px] text-emerald-200 whitespace-nowrap">+{formatCurrency(item.upside)}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="w-24 text-xs text-slate-500 flex-shrink-0">
                          Range: {formatCurrency(item.range)}
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-3 mt-1">
                    <div className="w-40" />
                    <div className="flex-1 flex text-[10px] text-slate-600">
                      <div className="flex-1 text-right pr-1">← Worse</div>
                      <div className="w-px" />
                      <div className="flex-1 pl-1">Better →</div>
                    </div>
                    <div className="w-24" />
                  </div>
                </div>
              );
            })()}
          </div>
          
          {/* Detailed results per variable */}
          {results.map((variable, varIdx) => (
            <div key={variable.id} className={cardStyle}>
              <h4 className="text-lg font-semibold text-slate-200 mb-1">{variable.label}</h4>
              <p className="text-xs text-slate-500 mb-3">
                Base: {variable.formatStep(variable.baseValue, 0)}
              </p>
              
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/50">
                      <th className="text-left py-2 px-3 text-slate-400 font-medium">Scenario</th>
                      <th className="text-right py-2 px-3 text-slate-400 font-medium">Portfolio at {retirementAge}</th>
                      <th className="text-right py-2 px-3 text-slate-400 font-medium">Portfolio at {endAge}</th>
                      <th className="text-right py-2 px-3 text-slate-400 font-medium">vs Base</th>
                      <th className="text-center py-2 px-3 text-slate-400 font-medium">Survives?</th>
                      <th className="text-right py-2 px-3 text-slate-400 font-medium">Lifetime Tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variable.stepResults.map((step, stepIdx) => {
                      const baseEnd = variable.stepResults.find(s => s.isBase)?.portfolioAtEnd || 0;
                      const diff = step.portfolioAtEnd - baseEnd;
                      
                      return (
                        <tr key={stepIdx} className={`border-b border-slate-800/50 ${step.isBase ? 'bg-amber-500/10' : ''} ${getImpactBg(step.portfolioAtEnd, baseEnd)}`}>
                          <td className="py-2 px-3">
                            <span className={`font-medium ${step.isBase ? 'text-amber-400' : 'text-slate-200'}`}>
                              {step.label}
                            </span>
                            {step.isBase && <span className="text-amber-500 text-xs ml-2">◆ Current</span>}
                            {!step.isBase && <span className="text-slate-600 text-xs ml-2">({step.deltaLabel})</span>}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-300">{formatCurrency(step.portfolioAtRetirement)}</td>
                          <td className={`py-2 px-3 text-right font-medium ${getImpactColor(step.portfolioAtEnd, baseEnd)}`}>
                            {formatCurrency(step.portfolioAtEnd)}
                          </td>
                          <td className={`py-2 px-3 text-right ${diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                            {step.isBase ? '—' : `${diff > 0 ? '+' : ''}${formatCurrency(diff)}`}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {step.survives 
                              ? <span className="text-emerald-400">✓</span>
                              : <span className="text-red-400">✗ {step.failureAge}</span>
                            }
                          </td>
                          <td className="py-2 px-3 text-right text-slate-400">{formatCurrency(step.lifetimeTax)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          
          {/* Key insight */}
          <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
            <p className="text-amber-300 text-sm font-medium mb-1">💡 How to Use This</p>
            <p className="text-slate-400 text-sm">
              The tornado chart at the top shows which variables have the biggest impact on your ending portfolio. 
              Focus your planning effort on the variables with the widest bars — those are where small changes 
              in assumptions create the largest swings in outcomes. Variables with narrow bars are ones where 
              your plan is resilient even if your assumptions are off.
            </p>
          </div>
        </>
      )}
      
      {!results && !isRunning && (
        <div className="text-center py-12 text-slate-500">
          <p className="text-lg mb-2">Click "Run Sensitivity Analysis" to see what matters most</p>
          <p className="text-sm">Tests how your plan responds to changes in returns, spending, retirement age, inflation, SS timing, and contributions</p>
        </div>
      )}
    </div>
  );
}

// ============================================
// PersonalInfoTab — Lifted to module scope
// ============================================
function PersonalInfoTab({ accounts, dataWarnings, incomeStreams, oneTimeEvents, personalInfo, recurringExpenses, setDataWarnings, setOneTimeEvents, setPersonalInfo, setRecurringExpenses }) {
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
  
  // Check for data inconsistencies that need user attention
  const getDataWarnings = (info) => {
    const warnings = [];
    
    // Check accounts with stopAge that don't match retirement age
    const accountsWithOldStopAge = accounts.filter(a => {
      const ownerRetAge = a.owner === 'spouse' ? info.spouseRetirementAge : info.myRetirementAge;
      return a.contribution > 0 && a.stopAge !== ownerRetAge && a.stopAge > info.myAge;
    });
    if (accountsWithOldStopAge.length > 0) {
      warnings.push({
        type: 'retirement_age_accounts',
        severity: 'warning',
        message: `${accountsWithOldStopAge.length} account(s) have contribution stop ages that don't match your retirement age (${info.myRetirementAge}):`,
        details: accountsWithOldStopAge.map(a => `"${a.name}" stops contributions at age ${a.stopAge}`),
        action: 'Update stop ages on the Accounts tab, or this may be intentional (e.g., employer match ending early).'
      });
    }
    
    // Check earned income streams that extend into or past retirement age
    const incomeStreamsPastRetirement = incomeStreams.filter(s => {
      const ownerRetAge = s.owner === 'spouse' ? info.spouseRetirementAge : info.myRetirementAge;
      return s.type === 'earned_income' && s.endAge >= ownerRetAge;
    });
    if (incomeStreamsPastRetirement.length > 0) {
      warnings.push({
        type: 'retirement_age_income',
        severity: 'warning',
        message: `${incomeStreamsPastRetirement.length} earned income stream(s) extend past your retirement age (${info.myRetirementAge}):`,
        details: incomeStreamsPastRetirement.map(s => `"${s.name}" runs to age ${s.endAge}`),
        action: 'Update end ages on the Income tab. Earned income during retirement affects SS taxation and earnings test.'
      });
    }
    
    // Check earned income streams that end before retirement age
    const incomeStreamsBeforeRetirement = incomeStreams.filter(s => {
      const ownerRetAge = s.owner === 'spouse' ? info.spouseRetirementAge : info.myRetirementAge;
      // Only warn if there's an actual gap — endAge of (retirementAge - 1) is the normal case
      // (income through age 59, retire at 60 = no gap). Warn if gap is 2+ years.
      return s.type === 'earned_income' && s.endAge < (ownerRetAge - 1) && s.endAge > info.myAge;
    });
    if (incomeStreamsBeforeRetirement.length > 0) {
      warnings.push({
        type: 'retirement_age_income_gap',
        severity: 'info',
        message: `${incomeStreamsBeforeRetirement.length} earned income stream(s) end well before your retirement age (${info.myRetirementAge}):`,
        details: incomeStreamsBeforeRetirement.map(s => {
          const ownerRetAge = s.owner === 'spouse' ? info.spouseRetirementAge : info.myRetirementAge;
          const gapYears = ownerRetAge - 1 - s.endAge;
          return `"${s.name}" ends at age ${s.endAge} — ${gapYears} year gap with no earned income before retirement`;
        }),
        action: 'You\'ll have no earned income during this gap. The portfolio won\'t be drawn down (you\'re not yet retired), but contributions will stop. If this is intentional (career change, sabbatical), no action needed.'
      });
    }
    
    // Check if SS claiming ages are before 62
    const ssStreams = incomeStreams.filter(s => s.type === 'social_security');
    const earlySSClaims = ssStreams.filter(s => s.startAge < 62);
    if (earlySSClaims.length > 0) {
      warnings.push({
        type: 'ss_too_early',
        severity: 'error',
        message: 'Social Security cannot be claimed before age 62:',
        details: earlySSClaims.map(s => `"${s.name}" starts at age ${s.startAge}`),
        action: 'Update the start age on the Income tab to 62 or later.'
      });
    }
    
    // Check if Roth conversion window starts before retirement
    if ((info.rothConversionAmount > 0 || info.rothConversionBracket) && info.rothConversionStartAge < info.myRetirementAge) {
      warnings.push({
        type: 'roth_before_retirement',
        severity: 'info',
        message: `Roth conversions start at age ${info.rothConversionStartAge}, before retirement at ${info.myRetirementAge}.`,
        details: ['Conversions during working years add to already-high income, potentially pushing you into higher brackets.'],
        action: 'Consider starting conversions at retirement age when income drops.'
      });
    }
    
    // Check if myAge > myRetirementAge (already retired)
    if (info.myAge >= info.myRetirementAge) {
      const activeEarned = incomeStreams.filter(s => s.type === 'earned_income' && s.endAge > info.myAge && s.owner === 'me');
      if (activeEarned.length > 0) {
        warnings.push({
          type: 'already_retired_but_earning',
          severity: 'info',
          message: `You're at or past your retirement age (${info.myRetirementAge}) but still have active earned income:`,
          details: activeEarned.map(s => `"${s.name}" runs to age ${s.endAge}`),
          action: 'The engine treats you as retired (withdrawing from portfolio). Earned income will supplement but not prevent withdrawals. This is fine for part-time work in retirement.'
        });
      }
    }
    
    // Check if spouse earned income endAge doesn't match spouseRetirementAge
    // The engine uses myRetirementAge to trigger portfolio withdrawals, but spouse income
    // streams have their own endAge. If spouse earned income ends at a different age than
    // spouseRetirementAge, the user may have a modeling gap they're not aware of.
    if (info.hasSpouse || info.filingStatus === 'married_joint' || info.filingStatus === 'married_separate') {
      const spouseEarned = incomeStreams.filter(s => s.type === 'earned_income' && s.owner === 'spouse');
      const spouseRetAge = info.spouseRetirementAge || 65;
      
      // Spouse earned income that doesn't end at spouseRetirementAge - 1 (normal case)
      const spouseMismatched = spouseEarned.filter(s => {
        // Normal: endAge = retirementAge - 1 (earns through age 64, retires at 65)
        // Also OK: endAge = retirementAge (earns through retirement year)
        return Math.abs(s.endAge - (spouseRetAge - 1)) > 1 && s.endAge > info.spouseAge;
      });
      
      if (spouseMismatched.length > 0) {
        const isEarly = spouseMismatched.some(s => s.endAge < spouseRetAge - 1);
        const isLate = spouseMismatched.some(s => s.endAge > spouseRetAge);
        
        warnings.push({
          type: 'spouse_income_retirement_mismatch',
          severity: 'warning',
          message: `Spouse earned income end age doesn't match spouse retirement age (${spouseRetAge}):`,
          details: spouseMismatched.map(s => {
            const diff = s.endAge - (spouseRetAge - 1);
            const direction = diff > 0 ? `continues ${diff} year(s) past retirement` : `ends ${Math.abs(diff)} year(s) before retirement`;
            return `"${s.name}" ends at age ${s.endAge} — ${direction}`;
          }),
          action: isEarly 
            ? 'The spouse will have no earned income before their retirement age. Contributions to spouse accounts will stop but no portfolio withdrawals occur until YOUR retirement age. Update the income end age or spouse retirement age if this is unintentional.'
            : isLate 
            ? 'Spouse earned income continuing past retirement age is fine (part-time work). The spouseRetirementAge field is informational — the engine uses each income stream\'s end age directly.'
            : 'Update the income end age on the Income tab or the spouse retirement age in Personal Info to align them.'
        });
      }
      
      // Warn if spouse has no earned income streams at all but has a retirement age set
      if (spouseEarned.length === 0 && info.spouseAge && info.spouseAge < spouseRetAge) {
        const spouseAcctsWithContributions = accounts.filter(a => a.owner === 'spouse' && a.contribution > 0);
        if (spouseAcctsWithContributions.length > 0) {
          warnings.push({
            type: 'spouse_no_income_but_contributing',
            severity: 'info',
            message: 'Spouse has account contributions but no earned income stream:',
            details: spouseAcctsWithContributions.map(a => `"${a.name}" contributes ${formatCurrency(a.contribution)}/year`),
            action: 'Spouse contributions are being modeled but there\'s no earned income to fund them. Add a spouse earned income stream on the Income tab, or this may be intentional (e.g., funded by your income in a community property state).'
          });
        }
      }
    }
    
    return warnings;
  };
  
  // dataWarnings state is in parent RetirementPlanner scope (survives re-renders)
  
  const savePersonalInfo = () => {
    const currentYear = new Date().getFullYear();
    const updates = { ...localInfo };
    updates.myBirthYear = currentYear - localInfo.myAge;
    if (localInfo.spouseAge) updates.spouseBirthYear = currentYear - localInfo.spouseAge;
    
    // Check for data inconsistencies and warn user
    const warnings = getDataWarnings(updates);
    setDataWarnings(warnings);
    
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
      
      {/* Data consistency warnings — shown after saving when mismatches detected */}
      {dataWarnings.length > 0 && (
        <div className="space-y-2">
          {dataWarnings.map((w, i) => (
            <div key={i} className={`p-3 rounded-lg border ${
              w.severity === 'error' ? 'bg-red-900/30 border-red-500/50' :
              w.severity === 'warning' ? 'bg-amber-900/30 border-amber-500/50' :
              'bg-blue-900/30 border-blue-500/50'
            }`}>
              <div className="flex items-start gap-2">
                <span className="text-lg">{w.severity === 'error' ? '🚫' : w.severity === 'warning' ? '⚠️' : 'ℹ️'}</span>
                <div className="flex-1">
                  <p className={`text-sm font-medium ${
                    w.severity === 'error' ? 'text-red-300' :
                    w.severity === 'warning' ? 'text-amber-300' :
                    'text-blue-300'
                  }`}>{w.message}</p>
                  {w.details && (
                    <ul className="mt-1 space-y-0.5">
                      {w.details.map((d, j) => (
                        <li key={j} className="text-xs text-slate-400">• {d}</li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-slate-500 mt-1 italic">{w.action}</p>
                </div>
                <button 
                  onClick={() => setDataWarnings(prev => prev.filter((_, idx) => idx !== i))}
                  className="text-slate-500 hover:text-slate-300 text-sm"
                  title="Dismiss"
                >✕</button>
              </div>
            </div>
          ))}
          <button 
            onClick={() => setDataWarnings([])}
            className="text-xs text-slate-500 hover:text-slate-300"
          >Dismiss all warnings</button>
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
              <p className="text-[10px] text-slate-500 mt-0.5">
                {(localInfo.rothConversionStartAge || 0) === 0
                  ? `Defaults to retirement age (${getDefaultRothConversionWindow(localInfo).startAge})`
                  : `Smart default: ${getDefaultRothConversionWindow(localInfo).startAge} (retirement age)`}
              </p>
            </div>
            <div>
              <label className={compactLabelStyle}>End Age</label>
              <AgeCell
                value={localInfo.rothConversionEndAge}
                onChange={e => handleChange('rothConversionEndAge', Number(e.target.value) || 0)}
                className={compactInputStyle}
              />
              <p className="text-[10px] text-slate-500 mt-0.5">
                {(localInfo.rothConversionEndAge || 0) === 0
                  ? `Defaults to ${getDefaultRothConversionWindow(localInfo).endAge} (year before RMDs at age ${getRmdStartAge(localInfo.myBirthYear)})`
                  : `Smart default: ${getDefaultRothConversionWindow(localInfo).endAge} (year before RMDs at age ${getRmdStartAge(localInfo.myBirthYear)})`}
              </p>
            </div>
            <div>
              <label className={compactLabelStyle}>Tax Payment Source</label>
              <select
                value={localInfo.rothConversionTaxSource || 'withdrawal'}
                onChange={e => handleChange('rothConversionTaxSource', e.target.value)}
                className={compactInputStyle}
              >
                <option value="withdrawal">Normal Withdrawal Priority</option>
                <option value="brokerage">Pay from Brokerage</option>
              </select>
            </div>
            <div>
              <label className={compactLabelStyle}>Preserve Pre-Tax Floor</label>
              <CurrencyCell
                value={localInfo.rothConversionPreTaxFloor || 0}
                onValueChange={v => handleChange('rothConversionPreTaxFloor', v)}
                className={compactInputStyle}
              />
              <p className="text-[10px] text-slate-500 mt-0.5">
                Stop converting once pre-tax (today's $) hits this — keeps room for QCDs and low-bracket withdrawals. 0 = convert per the window.
              </p>
            </div>
          </div>
          <div className="mt-3 p-3 bg-purple-900/20 border border-purple-700/30 rounded-lg">
            <p className="text-xs text-purple-300 font-medium mb-1">&#128161; Roth Conversion Strategy</p>
            <p className="text-xs text-slate-400">
              Each year during the specified age range, funds are moved from the largest pre-tax account to the largest Roth account. 
              The conversion is added to your taxable income for that year. 
              Roth conversions appear as <strong className="text-purple-400">purple-highlighted rows</strong> in the Detailed Table.
              {localInfo.rothConversionBracket ? ` Fill-to-bracket mode converts enough each year to fully utilize the ${localInfo.rothConversionBracket} bracket (based on other income).` : ''}
              {localInfo.rothConversionTaxSource === 'brokerage'
                ? ' Tax on conversions is paid by withdrawing from your brokerage account, preserving pre-tax and Roth balances.'
                : ' Tax on conversions is covered by the normal withdrawal solver (using your withdrawal priority order), which may pull additional pre-tax funds.'}
              {(localInfo.rothConversionPreTaxFloor || 0) > 0
                ? ` Conversions stop once your pre-tax balance reaches ${formatCurrency(localInfo.rothConversionPreTaxFloor)} (today's dollars), leaving funds for QCDs and low-bracket withdrawals.`
                : ''}
            </p>
          </div>
          
          {/* Smart-default reset / suboptimal window warning.
              Compares the user's explicit window against the smart defaults
              (retirement age → RMD age - 1). If the user's window is significantly
              narrower than the optimal bridge years, surface a hint with a
              one-click reset. */}
          {(() => {
            const smart = getDefaultRothConversionWindow(localInfo);
            const userStart = localInfo.rothConversionStartAge || 0;
            const userEnd = localInfo.rothConversionEndAge || 0;
            const usingDefaults = userStart === 0 && userEnd === 0;
            const userMatchesSmart = userStart === smart.startAge && userEnd === smart.endAge;
            const startsTooLate = userStart > 0 && userStart > smart.startAge;
            const endsTooEarly = userEnd > 0 && userEnd < smart.endAge;
            const suboptimal = (startsTooLate || endsTooEarly) && !usingDefaults && !userMatchesSmart;
            
            const resetToSmartDefaults = () => {
              handleChange('rothConversionStartAge', smart.startAge);
              handleChange('rothConversionEndAge', smart.endAge);
            };
            
            if (usingDefaults || userMatchesSmart) {
              return (
                <div className="mt-3 p-3 bg-emerald-900/15 border border-emerald-700/30 rounded-lg">
                  <p className="text-xs text-emerald-300">
                    ✓ Using the standard bridge-year conversion window (retirement age {smart.startAge} → year before RMDs {smart.endAge}). This is the textbook approach for maximizing cheap conversions.
                  </p>
                </div>
              );
            }
            
            if (suboptimal) {
              const userYears = userEnd - userStart + 1;
              const smartYears = smart.endAge - smart.startAge + 1;
              const missing = smartYears - userYears;
              return (
                <div className="mt-3 p-3 bg-amber-900/20 border border-amber-700/40 rounded-lg">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-xs text-amber-300 font-medium mb-1">
                        ⚠ Your conversion window may be missing {missing} year{missing !== 1 ? 's' : ''} of cheap conversion opportunities
                      </p>
                      <p className="text-xs text-slate-400">
                        Your window: ages {userStart}–{userEnd} ({userYears} year{userYears !== 1 ? 's' : ''}). 
                        Standard bridge: ages {smart.startAge}–{smart.endAge} ({smartYears} years).
                        {startsTooLate && ` You're skipping ${smart.startAge}-${userStart - 1} (after retirement, before SS or RMDs — typically lowest-bracket years).`}
                        {endsTooEarly && ` You're stopping early at ${userEnd} instead of the year before RMDs ({smart.endAge}).`}
                      </p>
                    </div>
                    <button
                      onClick={resetToSmartDefaults}
                      className="text-xs px-3 py-1 bg-amber-700/30 hover:bg-amber-700/50 border border-amber-600/50 rounded text-amber-200 font-medium whitespace-nowrap transition-colors"
                    >
                      Use {smart.startAge}–{smart.endAge}
                    </button>
                  </div>
                </div>
              );
            }
            
            // User chose a wider window than smart defaults — assume intentional, no warning
            return (
              <div className="mt-3 p-3 bg-slate-800/40 border border-slate-700 rounded-lg flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  Your custom window: ages {userStart || smart.startAge}–{userEnd || smart.endAge}. 
                  Standard would be ages {smart.startAge}–{smart.endAge}.
                </p>
                <button
                  onClick={resetToSmartDefaults}
                  className="text-xs px-3 py-1 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded text-slate-300 font-medium whitespace-nowrap transition-colors"
                >
                  Reset to defaults
                </button>
              </div>
            );
          })()}
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
        
        {/* Spending Phases Section (go-go / slow-go / no-go) */}
        <div className="border-t border-slate-700/50 mt-5 pt-5">
          <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Spending Phases</h4>
          <div className="flex items-center gap-3 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={localInfo.spendingPhasesEnabled || false}
                onChange={e => handleChange('spendingPhasesEnabled', e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/50"
              />
              <span className="text-sm text-slate-300">Enable staged spending (go-go / slow-go / no-go)</span>
            </label>
          </div>

          {localInfo.spendingPhasesEnabled && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className={compactLabelStyle}>Go-Go Phase (% of base, through age)</label>
                  <div className="flex gap-2">
                    <input
                      type="number" min="0" max="200" step="1"
                      value={Math.round((localInfo.goGoMultiplier ?? 1.0) * 100)}
                      onChange={e => handleChange('goGoMultiplier', Math.max(0, (Number(e.target.value) || 0) / 100))}
                      className={compactInputStyle}
                      title="Spending as % of your base retirement income during the active go-go years"
                    />
                    <AgeCell
                      value={localInfo.goGoEndAge ?? 75}
                      onChange={e => handleChange('goGoEndAge', Number(e.target.value) || 75)}
                      className={compactInputStyle}
                    />
                  </div>
                  <span className="text-xs text-slate-500">Active travel years</span>
                </div>
                <div>
                  <label className={compactLabelStyle}>Slow-Go Phase (% of base, through age)</label>
                  <div className="flex gap-2">
                    <input
                      type="number" min="0" max="200" step="1"
                      value={Math.round((localInfo.slowGoMultiplier ?? 0.85) * 100)}
                      onChange={e => handleChange('slowGoMultiplier', Math.max(0, (Number(e.target.value) || 0) / 100))}
                      className={compactInputStyle}
                      title="Spending as % of your base retirement income during the slow-go years"
                    />
                    <AgeCell
                      value={localInfo.slowGoEndAge ?? 85}
                      onChange={e => handleChange('slowGoEndAge', Number(e.target.value) || 85)}
                      className={compactInputStyle}
                    />
                  </div>
                  <span className="text-xs text-slate-500">Settling down</span>
                </div>
                <div>
                  <label className={compactLabelStyle}>No-Go Phase (% of base)</label>
                  <input
                    type="number" min="0" max="200" step="1"
                    value={Math.round((localInfo.noGoMultiplier ?? 0.75) * 100)}
                    onChange={e => handleChange('noGoMultiplier', Math.max(0, (Number(e.target.value) || 0) / 100))}
                    className={compactInputStyle}
                    title="Spending as % of your base retirement income after the slow-go phase ends"
                  />
                  <span className="text-xs text-slate-500">All remaining years</span>
                </div>
              </div>
              <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-lg">
                <p className="text-xs text-slate-400">
                  <strong className="text-slate-300">The retirement smile:</strong> research (T. Rowe Price, JPMorgan) shows
                  real spending isn't flat — it runs highest in the active early years, declines ~20%+ through the slow-go
                  years, and settles lower after. These multipliers scale your <strong className="text-amber-400">base desired
                  retirement income</strong> only. Recurring expense line items keep their own age windows, and healthcare
                  costs are modeled separately (they typically rise while discretionary spending falls).
                </p>
              </div>
            </>
          )}
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
                  <div>
                    <label className={compactLabelStyle}>Survivor Spending (% of couple's)</label>
                    <input
                      type="number"
                      min="0" max="100" step="1"
                      value={Math.round((localInfo.survivorSpendingFactor ?? 0.75) * 100)}
                      onChange={e => handleChange('survivorSpendingFactor', Math.min(1, Math.max(0, (Number(e.target.value) || 0) / 100)))}
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
                    Spending drops to the <strong className="text-amber-400">survivor spending %</strong> of the couple's target.
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
              <div className="mb-3">
                <label className={compactLabelStyle}>Pre-65 Coverage Model</label>
                <select
                  value={localInfo.pre65Coverage || 'flat'}
                  onChange={e => handleChange('pre65Coverage', e.target.value)}
                  className={compactInputStyle}
                >
                  <option value="flat">Fixed annual cost — same premium every pre-65 year</option>
                  <option value="aca">ACA marketplace — premium depends on your income (MAGI) with the 2026 subsidy cliff</option>
                </select>
                {(localInfo.pre65Coverage || 'flat') === 'aca' && (
                  <p className="text-xs text-amber-400/90 mt-2">
                    Once retired and under 65, your premium = benchmark − premium tax credit. The credit shrinks as MAGI rises
                    and disappears entirely above 400% of the poverty level (the cliff returned in 2026) — so withdrawals and
                    Roth conversions in those years directly raise your healthcare cost. Working years still use the fixed
                    annual cost (employer coverage).
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {(localInfo.pre65Coverage || 'flat') === 'aca' && (
                  <div>
                    <label className={compactLabelStyle}>ACA Benchmark Premium (per person)</label>
                    <CurrencyCell
                      value={localInfo.acaBenchmarkPremium || ACA_BENCHMARK_PREMIUM_2026 || 14000}
                      onValueChange={v => handleChange('acaBenchmarkPremium', v)}
                      className={compactInputStyle}
                    />
                    <span className="text-xs text-slate-500">Full unsubsidized silver (SLCSP) — get yours at healthcare.gov</span>
                  </div>
                )}
                <div>
                  <label className={compactLabelStyle}>Pre-65 Annual Cost (per person)</label>
                  <CurrencyCell
                    value={localInfo.pre65HealthcareAnnual || 12000}
                    onValueChange={v => handleChange('pre65HealthcareAnnual', v)}
                    className={compactInputStyle}
                  />
                  <span className="text-xs text-slate-500">{(localInfo.pre65Coverage || 'flat') === 'aca' ? 'Used for WORKING years (employer coverage)' : 'ACA/employer premiums + copays'}</span>
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
                    value={localInfo.medicalInflation || 0.05}
                    onValueChange={v => handleChange('medicalInflation', v)}
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
              
              <div className="p-2 bg-blue-900/20 border border-blue-800/30 rounded text-xs text-blue-300">
                Healthcare costs are added to your retirement spending target and flow through the tax-aware withdrawal solver.
                IRMAA surcharges are calculated separately based on MAGI. Medicare Part B/D base premiums are included here; IRMAA adds on top.
              </div>
            </div>
          )}
        </div>

        {/* Long-Term Care — separate from Healthcare because the engine bills LTC
            whenever ltcModel !== 'none' regardless of healthcareModel. Keeping
            this control always-visible prevents the bug where users turned off
            healthcare but LTC kept spiking their projection at ages 82–88. */}
        <div className="border-t border-slate-700/50 mt-5 pt-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Long-Term Care</h4>
              <p className="text-xs text-slate-500 mt-1">Bills assisted-living cost over the final months of life expectancy (one window per spouse)</p>
            </div>
          </div>
          <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-300">LTC Model</span>
              <select
                value={localInfo.ltcModel || 'none'}
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
              Default models ${LTC_MONTHLY_ASSISTED_LIVING_2025.toLocaleString()}/mo assisted living for {LTC_DEFAULT_DURATION_MONTHS} months before death (Genworth 2024 median). Cost compounds at the medical inflation rate and appears as a spike in the final years before each spouse's life expectancy.
            </p>
          </div>
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
                      value={exp.inflationRate || 0}
                      onValueChange={v => setRecurringExpenses(prev => prev.map(ex => ex.id === exp.id ? { ...ex, inflationRate: v } : ex))}
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
}

// Split a contribution into the saver's own money vs. the employer's.
// A percent-mode account can fold an employee deferral and an employer match into
// one row (contributor 'both'); split it by the two percentages — the match was
// never the saver's income. Fixed-mode rows fall back to the contributor field.
// myContribShare is gated to owner==='me' so it only ever counts the PRIMARY saver's
// own money toward the personal savings rate.
function myContribShare(account, amount) {
  if (!amount) return 0;
  if (account.contributionMode === 'percent') {
    if (account.owner !== 'me') return 0;
    const ee = account.employeePercent || 0, er = account.employerMatchPercent || 0;
    return ee + er > 0 ? amount * (ee / (ee + er)) : 0;
  }
  return (account.contributor || 'me') === 'me' ? amount : 0;
}
function employerContribShare(account, amount) {
  if (!amount) return 0;
  if (account.contributionMode === 'percent') {
    const ee = account.employeePercent || 0, er = account.employerMatchPercent || 0;
    return ee + er > 0 ? amount * (er / (ee + er)) : 0;
  }
  return (account.contributor || 'me') === 'employer' ? amount : 0;
}

// ============================================
// AccountsTab — Lifted to module scope
// ============================================
function AccountsTab({ accountTypes, accounts, contributorTypes, personalInfo, projections, setAccounts, setEditingAccount, setShowAccountModal }) {
  const [acctInfoOpen, setAcctInfoOpen] = useState(null);
  const [showIndividualAccounts, setShowIndividualAccounts] = useState(false);
  const [showIndividualContribs, setShowIndividualContribs] = useState(false);
  const [localAccounts, setLocalAccounts] = useState(accounts);
  const [dirty, setDirty] = useState(false);
  
  // Re-sync on any external content change (add/delete/edit/wholesale replace).
  // An id-only key missed wizard relaunches: finishWizard rebuilds accounts with
  // the same id sequence (1,2,3…), so the key was identical and the tab showed
  // stale data. In-tab typing only mutates the local mirror, so this signature
  // stays stable while editing and won't clobber unsaved changes.
  const accountsSig = JSON.stringify(accounts);
  useEffect(() => {
    setLocalAccounts(accounts);
    setDirty(false);
  }, [accountsSig]);
  
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
  // Savings rate: use projection engine data for current year (same source as the table)
  const currentYearProjection = projections.find(p => p.myAge === personalInfo.myAge);
  const currentEarnedIncome = currentYearProjection?.earnedIncome || 0;
  
  // My contributions from the engine's per-account data (includes contribution growth)
  const currentContribs = currentYearProjection?.perAccountContributions || {};
  let myContributions = 0;
  let employerContributions = 0;
  localAccounts.forEach(a => {
    const c = currentContribs[a.id] || 0;
    myContributions += myContribShare(a, c);
    employerContributions += employerContribShare(a, c);
  });
  const totalContributions = myContributions + employerContributions;
  
  const savingsRate = currentEarnedIncome > 0 ? (myContributions / currentEarnedIncome) * 100 : null;
  
  // After-tax savings rate using engine tax data
  const currentTotalTax = currentYearProjection ? (currentYearProjection.federalTax + currentYearProjection.stateTax + currentYearProjection.ficaTax) : 0;
  const afterTaxIncome = currentEarnedIncome - currentTotalTax;
  const afterTaxSavingsRate = afterTaxIncome > 0 ? (myContributions / afterTaxIncome) * 100 : null;
  
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
                body: 'This is a spreadsheet-style editor for all your retirement and investment accounts. Each row is one account. Click any value to edit it, then tab between fields. When you have unsaved changes, a green "💾 Save Changes" button appears — click it to apply your edits to the projections.'
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
                    {account.contributionMode === 'percent' ? (
                      <div
                        onClick={() => { setEditingAccount(account); setShowAccountModal(true); }}
                        className="px-2 py-1.5 text-sky-400 font-semibold text-right w-20 cursor-pointer hover:bg-slate-800/50 rounded text-sm"
                        title="Percent-mode contribution — click to edit in modal"
                      >% salary</div>
                    ) : (
                      <CurrencyCell
                        value={account.contribution}
                        onValueChange={v => updateAccount(account.id, 'contribution', v)}
                        className="bg-transparent border border-transparent rounded px-2 py-1.5 text-sky-400 font-semibold text-right w-20 focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    )}
                  </td>
                  <td className="py-2 px-1">
                    {account.contributionMode === 'percent' ? (
                      <div
                        onClick={() => { setEditingAccount(account); setShowAccountModal(true); }}
                        className="px-2 py-1.5 text-cyan-400 font-semibold text-right w-20 cursor-pointer hover:bg-slate-800/50 rounded text-xs whitespace-nowrap"
                        title="Employee + employer match — click to edit"
                      >{((account.employeePercent || 0) * 100).toFixed(1)}%+{((account.employerMatchPercent || 0) * 100).toFixed(1)}%</div>
                    ) : (
                      <PercentCell
                        value={account.contributionGrowth || 0}
                        onValueChange={v => updateAccount(account.id, 'contributionGrowth', v)}
                        className="bg-transparent border border-transparent rounded px-2 py-1.5 text-cyan-400 font-semibold text-right w-16 focus:bg-slate-800 focus:border-amber-500/70 focus:outline-none hover:bg-slate-800/50 hover:border-slate-600 transition-colors"
                      />
                    )}
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
                  <div className="text-slate-500 text-xs mb-0.5">Savings Rate (Gross)</div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-amber-400">{savingsRate.toFixed(1)}%</span>
                    <div className="w-24 h-2.5 bg-slate-700 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${savingsRate >= 50 ? 'bg-emerald-400' : savingsRate >= 25 ? 'bg-amber-400' : 'bg-sky-400'}`}
                        style={{ width: `${Math.min(savingsRate, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">your contributions / gross income</div>
                </div>
              </>
            )}
            {afterTaxSavingsRate !== null && (
              <>
                <div className="w-px h-10 bg-slate-700"></div>
                <div>
                  <div className="text-slate-500 text-xs mb-0.5">Savings Rate (Net)</div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-emerald-400">{afterTaxSavingsRate.toFixed(1)}%</span>
                    <div className="w-24 h-2.5 bg-slate-700 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${afterTaxSavingsRate >= 50 ? 'bg-emerald-400' : afterTaxSavingsRate >= 25 ? 'bg-amber-400' : 'bg-sky-400'}`}
                        style={{ width: `${Math.min(afterTaxSavingsRate, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">your contributions / after-tax ({formatCurrency(afterTaxIncome)})</div>
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
                  body: `This is the detailed output of the projection engine — one row per year from today through age ${personalInfo.legacyAge || 95}. It shows your account balances after all transactions (contributions, withdrawals, growth) have been applied for that year, plus the key cash flow events that happened during the year.`
                },
                {
                  heading: 'The Balance Columns',
                  items: [
                    { color: '#10b981', label: 'Pre-Tax (Green)', desc: 'Combined balance of all pre-tax accounts (401k, Traditional IRA, 403b, 457b). These balances shrink in retirement as RMDs and spending withdrawals are taken. Every dollar withdrawn is taxed as ordinary income.' },
                    { color: '#a855f7', label: 'Roth (Purple)', desc: 'Combined balance of all Roth accounts. These grow tax-free and withdrawals are tax-free. The planner typically draws from Roth last (per your withdrawal priority), so this balance may grow well into retirement.' },
                    { color: '#38bdf8', label: 'Brokerage (Sky Blue)', desc: 'Combined taxable investment and HSA balances. Notice this column may jump UP in RMD years — that\'s excess RMD money being reinvested here after taxes.' },
                    { color: '#f59e0b', label: 'Total (Gold)', desc: `Sum of all three account types — your total liquid investment portfolio. This is the number that needs to stay above zero through age ${personalInfo.legacyAge || 95}.` }
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
                  body: `Scan the Total column to see if your portfolio stays positive through age ${personalInfo.legacyAge || 95}. Watch for the transition from growth (pre-retirement, balances climbing) to drawdown (post-retirement, balances declining). The rate of decline tells you how sustainable your plan is.`,
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
      
      {/* Year-by-Year Contributions Table */}
      <div className={cardStyle}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <h4 className="text-lg font-semibold text-slate-100">Year-by-Year Contributions</h4>
            <InfoCard
              title="Year-by-Year Contributions"
              isOpen={acctInfoOpen === 'yearByYearContribs'}
              onToggle={() => setAcctInfoOpen(prev => prev === 'yearByYearContribs' ? null : 'yearByYearContribs')}
              sections={[
                {
                  heading: 'What This Table Shows',
                  body: 'Annual contributions flowing into each account from the projection engine. Contributions are calculated based on the base amount, growth rate, and active contribution period (start age to stop age) you defined for each account.'
                },
                {
                  heading: 'By Type View',
                  items: [
                    { color: '#10b981', label: 'Pre-Tax (Green)', desc: 'Combined contributions to all pre-tax accounts (401k, Traditional IRA, 403b, 457b). These reduce your taxable income in the year contributed.' },
                    { color: '#a855f7', label: 'Roth (Purple)', desc: 'Combined contributions to all Roth accounts. These are made with after-tax dollars but grow and withdraw tax-free.' },
                    { color: '#38bdf8', label: 'Brokerage (Sky Blue)', desc: 'Combined contributions to taxable brokerage and HSA accounts.' },
                    { color: '#f59e0b', label: 'Total (Gold)', desc: 'Sum of all contributions for the year across all account types.' }
                  ]
                },
                {
                  heading: 'By Account View',
                  body: 'Shows each individual account as its own column so you can see exactly how much goes into each account each year. Contributions grow annually by the contribution growth rate you set, and stop at the stop age.'
                },
                {
                  heading: 'How to Use This',
                  body: 'Verify your contribution assumptions look correct year by year. Watch for the transition when contributions stop at retirement — this is when your accounts shift from accumulation to drawdown. If you see zeros where you expect contributions, check the start/stop ages on your accounts.',
                  tip: 'The contribution growth rate compounds each year. A $10,000 contribution growing at 3% becomes $10,300 next year, then $10,609, etc. This models annual raise-based increases to retirement savings.'
                }
              ]}
            />
          </div>
          {/* Aggregated / Individual toggle */}
          <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700 gap-0.5">
            <button
              onClick={() => setShowIndividualContribs(false)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                !showIndividualContribs
                  ? 'bg-slate-600 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              By Type
            </button>
            <button
              onClick={() => setShowIndividualContribs(true)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                showIndividualContribs
                  ? 'bg-slate-600 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              By Account
            </button>
          </div>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          {showIndividualContribs
            ? 'Individual account contributions year-by-year — each column is one account.'
            : 'Contributions aggregated by account type (pre-tax, Roth, brokerage). Shows annual amounts including contribution growth.'}
        </p>
        
        {showIndividualContribs ? (() => {
          const acctColors = [
            '#34d399','#a78bfa','#38bdf8','#fb923c','#f472b6',
            '#facc15','#818cf8','#4ade80','#f87171','#22d3ee'
          ];
          const colorFor = (idx) => acctColors[idx % acctColors.length];
          const contribYears = projections.filter(p => {
            const contribs = p.perAccountContributions || {};
            return Object.values(contribs).some(v => v > 0);
          });
          // Show all years up to last contribution year + 2 for context, max 50
          const lastContribAge = contribYears.length > 0 ? contribYears[contribYears.length - 1].myAge : personalInfo.myAge;
          const displayYears = projections.filter(p => p.myAge <= Math.min(lastContribAge + 2, personalInfo.myAge + 50));
          
          return (
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-900 z-10">
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 px-2 text-slate-400 font-medium">Year</th>
                    <th className="text-center py-2 px-2 text-slate-400 font-medium">Age</th>
                    {accounts.map((acct, i) => (
                      <th key={acct.id} className="text-right py-2 px-2 font-medium" style={{ color: colorFor(i) }}>
                        {acct.name.length > 12 ? acct.name.substring(0, 12) + '…' : acct.name}
                      </th>
                    ))}
                    <th className="text-right py-2 px-2 text-amber-400 font-medium">Total</th>
                    <th className="text-right py-2 px-2 text-amber-400 font-medium">Gross %</th>
                    <th className="text-right py-2 px-2 text-emerald-400 font-medium">Net %</th>
                  </tr>
                </thead>
                <tbody>
                  {displayYears.map((p, idx) => {
                    const contribs = p.perAccountContributions || {};
                    const total = Object.values(contribs).reduce((s, v) => s + v, 0);
                    let myTotal = 0;
                    accounts.forEach(a => {
                      myTotal += myContribShare(a, contribs[a.id] || 0);
                    });
                    const grossRate = p.earnedIncome > 0 ? (myTotal / p.earnedIncome) * 100 : null;
                    const afterTax = p.earnedIncome - (p.federalTax || 0) - (p.stateTax || 0) - (p.ficaTax || 0);
                    const netRate = afterTax > 0 ? (myTotal / afterTax) * 100 : null;
                    return (
                      <tr key={p.year} className={`border-b border-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''} ${total === 0 ? 'opacity-40' : ''}`}>
                        <td className="py-1.5 px-2 text-slate-300">{p.year}</td>
                        <td className="py-1.5 px-2 text-center text-slate-400">{p.myAge}</td>
                        {accounts.map((acct, i) => {
                          const c = contribs[acct.id] || 0;
                          return (
                            <td key={acct.id} className="py-1.5 px-2 text-right font-mono" style={{ color: c > 0 ? colorFor(i) : '#475569' }}>
                              {c > 0 ? formatCurrency(c) : '—'}
                            </td>
                          );
                        })}
                        <td className="py-1.5 px-2 text-right text-amber-400 font-mono font-semibold">
                          {total > 0 ? formatCurrency(total) : '—'}
                        </td>
                        <td className={`py-1.5 px-2 text-right font-mono ${grossRate !== null && grossRate > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                          {grossRate !== null && grossRate > 0 ? `${grossRate.toFixed(1)}%` : '—'}
                        </td>
                        <td className={`py-1.5 px-2 text-right font-mono ${netRate !== null && netRate > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                          {netRate !== null && netRate > 0 ? `${netRate.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })() : (
          <>
            {(() => {
              const contribYears = projections.filter(p => {
                const contribs = p.perAccountContributions || {};
                return Object.values(contribs).some(v => v > 0);
              });
              const lastContribAge = contribYears.length > 0 ? contribYears[contribYears.length - 1].myAge : personalInfo.myAge;
              const displayYears = projections.filter(p => p.myAge <= Math.min(lastContribAge + 2, personalInfo.myAge + 50));
              
              return (
                <div className="overflow-x-auto max-h-[500px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-900 z-10">
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-2 px-2 text-slate-400 font-medium">Year</th>
                        <th className="text-center py-2 px-2 text-slate-400 font-medium">Age</th>
                        <th className="text-right py-2 px-2 text-emerald-400 font-medium">Pre-Tax</th>
                        <th className="text-right py-2 px-2 text-purple-400 font-medium">Roth</th>
                        <th className="text-right py-2 px-2 text-sky-400 font-medium">Brokerage/HSA</th>
                        <th className="text-right py-2 px-2 text-amber-400 font-medium">Total</th>
                        <th className="text-right py-2 px-2 text-amber-400 font-medium">Gross %</th>
                        <th className="text-right py-2 px-2 text-emerald-400 font-medium">Net %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayYears.map((p, idx) => {
                        const contribs = p.perAccountContributions || {};
                        let preTaxC = 0, rothC = 0, brokerageC = 0;
                        accounts.forEach(a => {
                          const c = contribs[a.id] || 0;
                          if (isPreTaxAccount(a.type)) preTaxC += c;
                          else if (isRothAccount(a.type)) rothC += c;
                          else brokerageC += c;
                        });
                        const total = preTaxC + rothC + brokerageC;
                        // Only count the saver's own money for savings rate (exclude employer match)
                        let myTotal = 0;
                        accounts.forEach(a => {
                          myTotal += myContribShare(a, contribs[a.id] || 0);
                        });
                        const grossRate = p.earnedIncome > 0 ? (myTotal / p.earnedIncome) * 100 : null;
                        const afterTax = p.earnedIncome - (p.federalTax || 0) - (p.stateTax || 0) - (p.ficaTax || 0);
                        const netRate = afterTax > 0 ? (myTotal / afterTax) * 100 : null;
                        return (
                          <tr key={p.year} className={`border-b border-slate-700/50 ${idx % 2 === 0 ? 'bg-slate-800/30' : ''} ${total === 0 ? 'opacity-40' : ''}`}>
                            <td className="py-1.5 px-2 text-slate-300">{p.year}</td>
                            <td className="py-1.5 px-2 text-center text-slate-400">{p.myAge}</td>
                            <td className={`py-1.5 px-2 text-right font-mono ${preTaxC > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                              {preTaxC > 0 ? formatCurrency(preTaxC) : '—'}
                            </td>
                            <td className={`py-1.5 px-2 text-right font-mono ${rothC > 0 ? 'text-purple-400' : 'text-slate-600'}`}>
                              {rothC > 0 ? formatCurrency(rothC) : '—'}
                            </td>
                            <td className={`py-1.5 px-2 text-right font-mono ${brokerageC > 0 ? 'text-sky-400' : 'text-slate-600'}`}>
                              {brokerageC > 0 ? formatCurrency(brokerageC) : '—'}
                            </td>
                            <td className="py-1.5 px-2 text-right text-amber-400 font-mono font-semibold">
                              {total > 0 ? formatCurrency(total) : '—'}
                            </td>
                            <td className={`py-1.5 px-2 text-right font-mono ${grossRate !== null && grossRate > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                              {grossRate !== null && grossRate > 0 ? `${grossRate.toFixed(1)}%` : '—'}
                            </td>
                            <td className={`py-1.5 px-2 text-right font-mono ${netRate !== null && netRate > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                              {netRate !== null && netRate > 0 ? `${netRate.toFixed(1)}%` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
            <div className="mt-4 flex flex-wrap gap-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-emerald-400"></div>
                <span className="text-slate-400">Pre-Tax (401k, Trad IRA, 457b, 403b)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-purple-400"></div>
                <span className="text-slate-400">Roth Accounts</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-sky-400"></div>
                <span className="text-slate-400">Brokerage / HSA</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================
// CoastFireSection — Lifted to module scope
// ============================================
function CoastFireSection({ accounts, personalInfo, retirementProjection, openInfoCard, toggleInfoCard, toggleVisibility, projections }) {
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
  
  // Calculate Coast FIRE values — use engine data for current portfolio and growth rate
  const currentYearData = projections[0]; // Current year from unified engine
  const currentPortfolio = useTestData && scenario?.currentPortfolio 
    ? scenario.currentPortfolio 
    : (currentYearData?.totalPortfolio || 0);
  
  const yearsToRetirement = useTestData && scenario?.yearsToRetirement
    ? scenario.yearsToRetirement
    : Math.max(0, personalInfo.myRetirementAge - personalInfo.myAge);
  
  const guaranteedAtRetirement = useTestData ? 0 : (retirementProjection?.totalGuaranteedIncome || 0);
  
  const spendingFromPortfolio = useTestData && scenario?.annualSpending
    ? scenario.annualSpending
    : Math.max(0, personalInfo.desiredRetirementIncome - guaranteedAtRetirement);
  
  const weightedCAGR = useTestData && scenario?.returnRate
    ? scenario.returnRate
    : (currentYearData?.weightedCAGR || 0.07);
  
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
          <button
            onClick={() => toggleVisibility('coastFire')}
            className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
            title="Hide this section"
          >
            Hide
          </button>
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
}

// ============================================
// LifestyleVsLegacy — Lifted to module scope
// ============================================
function LifestyleVsLegacy({ projections, personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses, retirementAge, openInfoCard, toggleInfoCard, computeProjections, toggleVisibility }) {
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
                { icon: '💚', label: `Legacy at ${personalInfo.legacyAge || 95}`, desc: `What's left in your accounts at your legacy age under this spending level. This is the money available for heirs, charitable giving, or as a safety buffer.` },
                { icon: '✅', label: 'Status', desc: `"Sustainable" (green ✓) means money lasts through age ${personalInfo.legacyAge || 95}. "Runs out at [age]" (red) means the portfolio is depleted before age ${personalInfo.legacyAge || 95} at that spending level.` }
              ]
            },
            {
              heading: 'How to Use This',
              body: 'Find the row where your plan sits (highlighted in gold). Look at your legacy amount — is it larger than you need? You might be able to spend more and enjoy retirement. Is status showing "Runs out"? You need to reduce spending or boost savings. The table lets you see exactly where the sustainability boundary lies.',
              tip: 'Many people discover they\'re being unnecessarily conservative — leaving hundreds of thousands behind when they could have enjoyed a richer retirement. Others find they\'re right on the edge. This table helps you make that tradeoff intentionally rather than by accident.'
            },
            {
              heading: 'What\'s Behind The Numbers',
              body: `Each row runs a full year-by-year projection from today through age ${personalInfo.legacyAge || 95} — including contributions during working years, tax-aware withdrawals, RMDs, Social Security, pensions, and account growth. It uses the same engine as your main projection, just with adjusted spending targets.`
            }
          ]}
        />
        <button
          onClick={() => toggleVisibility('lifestyleLegacy')}
          className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
          title="Hide this section"
        >
          Hide
        </button>
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
}

// ============================================
// DashboardTab — Lifted to module scope
// ============================================
function DashboardTab({ accounts, assets, computeProjections, dashboardVisibility, incomeStreams, oneTimeEvents, personalInfo, projections, recurringExpenses, setDashboardVisibility, setShowDashboardSettings, showDashboardSettings }) {
  const current = projections[0];
  
  // Use dashboardVisibility from parent state (passed via closure)
  const visibilitySettings = dashboardVisibility;
  const setVisibilitySettings = setDashboardVisibility;
  const showSettings = showDashboardSettings;
  const setShowSettings = setShowDashboardSettings;
  
  const toggleVisibility = (key) => {
    setVisibilitySettings(prev => ({ ...prev, [key]: !prev[key] }));
  };
  
  // Retirement age: always use personalInfo as source of truth
  const retirementAge = personalInfo.myRetirementAge;
  const retirementProjection = projections.find(p => p.myAge === retirementAge);
  // Savings rate for dashboard card — read from unified engine (same as Accounts tab)
  const dashEarnedIncome = current?.earnedIncome || 0;
  const dashContribs = current?.perAccountContributions || {};
  let dashMyContributions = 0;
  let dashTotalContributions = 0;
  accounts.forEach(a => {
    const c = dashContribs[a.id] || 0;
    dashMyContributions += myContribShare(a, c);
    dashTotalContributions += c;
  });
  const dashSavingsRate = dashEarnedIncome > 0 ? (dashMyContributions / dashEarnedIncome) * 100 : null;
  const dashTotalTax = current ? (current.federalTax + current.stateTax + current.ficaTax) : 0;
  const dashAfterTaxIncome = dashEarnedIncome - dashTotalTax;
  const dashAfterTaxSavingsRate = dashAfterTaxIncome > 0 ? (dashMyContributions / dashAfterTaxIncome) * 100 : null;
  const isPreRetirement = current?.earnedIncome > 0;
  
  const [netWorthRange, setNetWorthRange] = useState({ start: personalInfo.myAge, end: personalInfo.legacyAge || MAX_AGE });
  const [incomeRange, setIncomeRange] = useState({ start: personalInfo.myAge, end: personalInfo.legacyAge || MAX_AGE });
  const [sankeyAge, setSankeyAge] = useState(retirementAge);
  // Roth conversion overlay on the Income vs Spending chart. Only offered when
  // the plan actually executes conversions; defaults ON so the tax-line spike and
  // net-income dip in conversion years are self-explanatory. The checkbox exists
  // because a large bracket-fill conversion can dominate the y-axis scale.
  const planHasConversions = useMemo(() => projections.some(p => (p.rothConversion || 0) > 0), [projections]);
  const [showConversionsOnIncomeChart, setShowConversionsOnIncomeChart] = useState(true);
  
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
                  { icon: '🏦', label: `Legacy at ${personalInfo.legacyAge || 95}`, desc: `What's projected to be left at age ${personalInfo.legacyAge || 95} if you follow your plan. A positive number means you have money to leave to heirs or as a safety margin. Zero or negative means your plan may not sustain you that long.` },
                  { icon: '💵', label: 'Savings Rate', desc: 'Only shown if you\'re still working. Your annual retirement contributions as a percentage of earned income. Financial planners typically recommend 15–20% minimum. This card shows your personal contributions and total (including employer match).' }
                ]
              },
              {
                heading: 'How to Use These',
                body: `Think of these as your retirement vital signs. The most important relationship is between your "At Retirement" portfolio and "Retirement Income" — together they determine if your plan is sustainable. The "Legacy at ${personalInfo.legacyAge || 95}" card is your bottom-line indicator: positive means your plan works, near-zero means it's tight.`,
                tip: 'All dollar amounts are in future (nominal) dollars, meaning they include inflation. A retirement portfolio of $3M in 20 years has less purchasing power than $3M today. The planner accounts for this in its calculations, but the raw numbers may look larger than expected.'
              }
            ]}
          />
          <button
            onClick={() => toggleVisibility('summaryCards')}
            className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
            title="Hide this section"
          >
            Hide
          </button>
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
            <div className="flex items-center gap-3">
              <div>
                <span className="text-xl font-bold text-amber-400">{dashSavingsRate.toFixed(1)}%</span>
                <span className="text-xs text-slate-500 ml-1">gross</span>
              </div>
              {dashAfterTaxSavingsRate !== null && (
                <div>
                  <span className="text-xl font-bold text-emerald-400">{dashAfterTaxSavingsRate.toFixed(1)}%</span>
                  <span className="text-xs text-slate-500 ml-1">net</span>
                </div>
              )}
            </div>
            <div className="text-xs text-slate-500">
              {formatCurrency(dashMyContributions)}/yr (your contributions)
              {dashTotalContributions > dashMyContributions ? ` · ${formatCurrency(dashTotalContributions)} with employer` : ''}
            </div>
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
                  body: `This chart projects your total net worth from today through age ${personalInfo.legacyAge || 95}, broken down by the type of money you hold. The stacked colored areas show how your wealth is distributed, while the cyan line traces your combined total.`
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
                  body: `Before retirement the chart should climb as contributions and market returns build wealth. After retirement it typically descends as you draw down savings. A chart that stays above zero through age ${personalInfo.legacyAge || 95} suggests your plan is sustainable. If the total drops to zero before age ${personalInfo.legacyAge || 95}, you may need to save more, delay retirement, or reduce spending.`,
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
                    { color: '#f59e0b', label: 'Portfolio Withdrawal (Gold)', desc: 'Money pulled from your retirement accounts (401k, IRA, Roth, brokerage) to cover the gap between your guaranteed income and your spending needs. This is the piece the planner calculates for you.' },
                    { color: '#ec4899', label: 'Roth Conversion (Pink, translucent)', desc: 'Only shown when your plan includes Roth conversions. This is an account TRANSFER (pre-tax → Roth), not spendable income — that\'s why it\'s drawn translucent with a dashed outline, unlike the solid income segments. It\'s taxed as ordinary income in the year it happens, which is what drives the tax spike in conversion years. Use the checkbox above the chart to hide it if a large conversion dominates the scale.' }
                  ]
                },
                {
                  heading: 'The Lines',
                  items: [
                    { color: '#ef4444', label: 'Red Solid — Desired Spending', desc: 'The annual income you said you need in retirement (from Personal Info), adjusted upward each year for inflation. If Spending Phases are enabled, this line also steps down at your go-go and slow-go boundary ages. This is your spending target.' },
                    { color: '#10b981', label: 'Green Dashed — Net Income After Tax', desc: 'What you actually take home after federal and state taxes. This is the number that matters — it needs to meet or exceed the red line for your plan to work.' },
                    { color: '#dc2626', label: 'Dark Red Dotted — Total Tax', desc: 'Your combined federal + state + FICA payroll tax burden. The gap between the top of the bars and the green dashed line.' }
                  ]
                },
                {
                  heading: 'How to Read It',
                  body: 'The key relationship is between the green dashed line (net income) and the red solid line (desired spending). When green is above red, you\'re in good shape — you have more income than you need. When they\'re close together, your plan is tight. If the bars shrink below the red line, your portfolio can\'t fully cover your spending. One important exception: in Roth conversion years, the green net-income line dips (sometimes below the red line) because the conversion tax is being prepaid that year. That\'s a deliberate transfer of tax from your future to your present — not a spending shortfall. The pink translucent segment marks those years.',
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
            {planHasConversions && (
              <label className="flex items-center gap-1.5 mr-2 text-slate-400 cursor-pointer select-none" title="Roth conversions are account transfers, not spendable income — shown as a distinct translucent segment so the tax spike in conversion years is explained. Uncheck if a large conversion dominates the chart scale.">
                <input
                  type="checkbox"
                  checked={showConversionsOnIncomeChart}
                  onChange={e => setShowConversionsOnIncomeChart(e.target.checked)}
                  className="accent-pink-500"
                />
                <span>Roth conversions</span>
              </label>
            )}
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
              {/* Roth conversions ride on top of the stack but are styled translucent
                  with a dashed outline: they are account TRANSFERS (pre-tax → Roth),
                  not spendable income, so they must read as "different in kind" from
                  the solid income segments. Their presence explains why the tax line
                  spikes and the net-income line dips in conversion years. */}
              {planHasConversions && showConversionsOnIncomeChart && (
                <Bar dataKey="rothConversion" stackId="income" fill="#ec4899" fillOpacity={0.3} stroke="#ec4899" strokeDasharray="4 2" name="Roth Conversion (transfer)" />
              )}
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
          {planHasConversions && showConversionsOnIncomeChart && (
            <span className="text-pink-400 ml-1">Pink translucent segment</span>
          )}
          {planHasConversions && showConversionsOnIncomeChart && (
            <span> = Roth conversion — an account transfer, not spendable income. Its tax is prepaid in that year, which is why the green line dips during the conversion window.</span>
          )}
        </p>
      </div>
      )}
      
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
        
        // QCD tax savings: for each year with QCD, estimate the marginal tax rate
        // by looking at the ratio of federal tax to taxable income (effective rate on that income slice).
        // More accurate than a hardcoded 22% — uses actual projected tax brackets.
        let estimatedQCDTaxSavings = 0;
        retirementYears.forEach(p => {
          if ((p.qcd || 0) > 0 && p.taxableIncome > 0) {
            // Marginal rate approximation: federal tax / taxable income gives avg rate,
            // but QCD comes off the top, so use a slightly higher estimate
            const avgFedRate = p.federalTax / Math.max(1, p.taxableIncome);
            const avgStateRate = p.stateTax / Math.max(1, p.taxableIncome);
            const marginalEstimate = Math.min(0.40, (avgFedRate + avgStateRate) * 1.15); // Bump 15% above avg to approximate marginal
            estimatedQCDTaxSavings += p.qcd * marginalEstimate;
          }
        });
        estimatedQCDTaxSavings = Math.round(estimatedQCDTaxSavings);
        
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
                      body: `This section totals up all the taxes you're projected to pay throughout retirement — from your retirement age through age ${personalInfo.legacyAge || 95}. These are cumulative lifetime totals, not annual amounts.`
                    },
                    {
                      heading: 'The Cards',
                      items: [
                        { icon: '🏛️', label: 'Federal Taxes', desc: 'Total federal income tax paid during retirement. This comes from pre-tax account withdrawals (401k, traditional IRA), taxable Social Security benefits, pension income, and capital gains from brokerage sales.' },
                        { icon: '🏠', label: 'State Taxes', desc: 'Total state income tax based on your selected state. Some states have no income tax (FL, TX, NV, etc.), dramatically reducing this number.' },
                        { icon: '📊', label: 'Total Lifetime Tax', desc: 'Combined federal + state taxes over all retirement years. This number can be surprisingly large — it\'s common to pay $200K–$500K+ in retirement taxes, especially with large pre-tax accounts.' },
                        { icon: '💚', label: 'QCD Tax Savings', desc: 'If you\'ve set a charitable giving percentage, this estimates tax savings from Qualified Charitable Distributions — direct IRA-to-charity transfers that satisfy RMDs without counting as taxable income. Calculated using your projected marginal tax rate for each year (federal + state, approximated from your actual taxable income), so it reflects the brackets you\'ll actually be in rather than a flat estimate.' }
                      ]
                    },
                    {
                      heading: 'Key Concepts',
                      items: [
                        { icon: '📋', label: 'Why Retirement Taxes Matter', desc: 'Many people assume they\'ll pay little tax in retirement. But RMDs from large pre-tax accounts, Social Security taxation, and capital gains can push retirees into higher brackets than expected.' },
                        { icon: '🔄', label: 'QCD Strategy', desc: 'Qualified Charitable Distributions let you donate directly from your IRA to charity (up to $111K/year per person in 2026, indexed for inflation; age 70½+). The donation satisfies your RMD but isn\'t taxable income — a powerful strategy if you\'re already charitably inclined.' },
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
          const currentSt = calculateStateTax(currentGross, personalInfo.state, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate, currentTaxableSS, retIncome, { federalTaxPaid: currentFed, primaryAge: targetAge, spouseAge: personalInfo.spouseAge + (targetAge - personalInfo.myAge) });
          const newFed = calculateFederalTax(newGross, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate);
          const newSt = calculateStateTax(newGross, personalInfo.state, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate, newTaxableSS, retIncome, { federalTaxPaid: newFed, primaryAge: targetAge, spouseAge: personalInfo.spouseAge + (targetAge - personalInfo.myAge) });
          const fedDelta = newFed - currentFed;
          const stDelta = newSt - currentSt;
          
          // Direct deltas (without torpedo - keep SS taxable unchanged)
          const directGross = currentGross + extra;
          const directFed = calculateFederalTax(directGross, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate);
          const directSt = calculateStateTax(directGross, personalInfo.state, personalInfo.filingStatus, yearsFromNow, personalInfo.inflationRate, currentTaxableSS, retIncome, { federalTaxPaid: directFed, primaryAge: targetAge, spouseAge: personalInfo.spouseAge + (targetAge - personalInfo.myAge) });
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
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-100">Marginal Tax Impact & IRMAA</h3>
                <InfoCard
                  title="Marginal Tax Impact & IRMAA"
                  isOpen={openInfoCard === 'marginalRates'}
                  onToggle={() => toggleInfoCard('marginalRates')}
                  sections={[
                    {
                      heading: 'What This Shows',
                      body: 'This card shows the TRUE cost of withdrawing an extra $1,000 from your pre-tax retirement accounts at different ages. The "true marginal rate" includes not just your tax bracket, but also the hidden costs: Social Security becoming more taxable (the "torpedo" effect) and potential IRMAA surcharges on Medicare premiums.'
                    },
                    {
                      heading: 'SS Tax Torpedo',
                      body: 'When your income rises, more of your Social Security becomes taxable (up to 85%). This creates a "torpedo zone" where each extra dollar of withdrawal effectively gets taxed at a much higher rate than your bracket suggests — sometimes 1.5x to 1.85x your marginal bracket.'
                    },
                    {
                      heading: 'IRMAA Impact',
                      body: 'Medicare Income-Related Monthly Adjustment Amount (IRMAA) adds surcharges to your Part B and Part D premiums when your MAGI exceeds certain thresholds. These are cliff-based — crossing a threshold by even $1 triggers the full surcharge for the year. The "Distance to Next Tier" shows how much room you have.'
                    },
                    {
                      heading: 'How to Use This',
                      body: 'Use this to plan Roth conversions — convert in years when your true marginal rate is lowest. Avoid pushing income into IRMAA tiers. The best conversion years are typically early retirement before Social Security and RMDs begin.',
                      tip: 'See the Tax Planning tab for a full year-by-year bracket analysis.'
                    }
                  ]}
                />
                <button
                  onClick={() => toggleVisibility('taxSummary')}
                  className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
                  title="Hide this section"
                >
                  Hide
                </button>
              </div>
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
        openInfoCard={openInfoCard}
        toggleInfoCard={toggleInfoCard}
        toggleVisibility={toggleVisibility}
        projections={projections}
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
        openInfoCard={openInfoCard}
        toggleInfoCard={toggleInfoCard}
        computeProjections={computeProjections}
        toggleVisibility={toggleVisibility}
      />
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
                        { color: '#b91c1c', label: 'FICA', desc: 'Social Security + Medicare payroll taxes on earned income (working years).' },
                        { color: '#be185d', label: 'IRMAA', desc: 'Medicare Part B & D surcharge if your MAGI exceeds the thresholds (age 65+).' },
                        { color: '#10b981', label: 'Spending', desc: 'Your desired retirement spending (the money you actually live on).' },
                        { color: '#ec4899', label: 'Healthcare', desc: 'Modeled healthcare costs separate from base spending (if healthcare modeling is enabled).' },
                        { color: '#06b6d4', label: 'Recurring Exp.', desc: 'Active recurring expenses like a mortgage, car payment, or long-term care premium.' },
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
    </div>
  );
}

// ── Module-scope constants and modal components ─────────────────────────────
// Hoisted out of RetirementPlanner so React keeps a stable component identity
// across parent renders. Inner-function components were unmounting/remounting
// on every parent state change, blowing away the user's in-progress form input.
const ASSET_TYPES = [
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'business', label: 'Business Ownership' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'collectibles', label: 'Collectibles/Art' },
  { value: 'other', label: 'Other Asset' }
];

const ACCOUNT_TYPES = [
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

const CONTRIBUTOR_TYPES = [
  { value: 'me', label: 'Me' },
  { value: 'employer', label: 'Employer' },
  { value: 'both', label: 'Both' }
];

const INCOME_TYPES = [
  { value: 'earned_income', label: 'Earned Income (Salary/Wages)' },
  { value: 'social_security', label: 'Social Security' },
  { value: 'pension', label: 'Pension' },
  { value: 'business', label: 'Business Income' },
  { value: 'rental', label: 'Rental Income' },
  { value: 'annuity', label: 'Annuity' },
  { value: 'other', label: 'Other Income' }
];

function AccountModal({ editingAccount, personalInfo, incomeStreams, onClose, onSave }) {
  const [formData, setFormData] = useState(editingAccount || { name: '', type: '401k', balance: 0, contribution: 0, contributionGrowth: personalInfo.inflationRate || 0.03, cagr: 0.07, startAge: personalInfo.myAge, stopAge: personalInfo.myRetirementAge, owner: 'me', contributor: 'me', costBasisPercent: 0.50 });
  const isPercentMode = formData.contributionMode === 'percent';
  const percentEligible = (formData.owner === 'me' || formData.owner === 'spouse')
    && ['401k','roth_401k','traditional_ira','roth_ira','403b'].includes(formData.type);
  const ownerSalaryStream = isPercentMode
    ? incomeStreams.find(s => s.type === 'earned_income' && s.owner === formData.owner)
    : null;
  const employeeFrac = Number(formData.employeePercent) || 0;
  const matchFrac = Number(formData.employerMatchPercent) || 0;
  const totalFrac = employeeFrac + matchFrac;
  const year1Contrib = ownerSalaryStream ? Math.round(ownerSalaryStream.amount * totalFrac) : null;
  const year30Salary = ownerSalaryStream ? ownerSalaryStream.amount * Math.pow(1 + (ownerSalaryStream.cola || 0), 30) : null;
  const year30Contrib = year30Salary !== null ? Math.round(year30Salary * totalFrac) : null;
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`${cardStyle} max-w-lg w-full max-h-[90vh] overflow-y-auto`}>
        <h3 className="text-xl font-bold text-slate-100 mb-6">{editingAccount ? 'Edit Account' : 'Add New Account'}</h3>
        <div className="space-y-4">
          <div><label className={labelStyle}>Account Name</label><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className={inputStyle} /></div>
          <div><label className={labelStyle}>Account Type</label><select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className={inputStyle}>{ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelStyle}>Owner</label><select value={formData.owner} onChange={e => setFormData({...formData, owner: e.target.value})} className={inputStyle}><option value="me">Me</option><option value="spouse">Spouse</option><option value="joint">Joint</option></select></div>
            <div><label className={labelStyle}>Contributor</label><select value={formData.contributor || 'me'} onChange={e => setFormData({...formData, contributor: e.target.value})} className={inputStyle}>{CONTRIBUTOR_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
          </div>
          {percentEligible && (
            <div className="border-t border-slate-700/50 pt-3">
              <label className={labelStyle}>Contribution Mode</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({...formData, contributionMode: 'fixed'})}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition ${!isPercentMode ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:text-slate-200'}`}
                >$ Fixed Amount</button>
                <button
                  type="button"
                  onClick={() => setFormData({...formData, contributionMode: 'percent', employeePercent: formData.employeePercent ?? 0.10, employerMatchPercent: formData.employerMatchPercent ?? 0.04, contributionGrowth: 0})}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition ${isPercentMode ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:text-slate-200'}`}
                >% of Salary</button>
              </div>
              {isPercentMode && (
                <p className="text-xs text-slate-500 mt-2">Pulls from this owner's earned-income stream. If you also have a separate "Employer Match" account, delete it to avoid double-counting.</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelStyle}>Current Balance</label><input type="number" value={formData.balance} onChange={e => setFormData({...formData, balance: Number(e.target.value)})} className={inputStyle} /></div>
            {!isPercentMode && (
              <div><label className={labelStyle}>Annual Contribution</label><input type="number" value={formData.contribution} onChange={e => setFormData({...formData, contribution: Number(e.target.value)})} className={inputStyle} /></div>
            )}
            {isPercentMode && (
              <div><label className={labelStyle}>Expected CAGR (%)</label><input type="number" step="0.1" value={(formData.cagr * 100).toFixed(1)} onChange={e => setFormData({...formData, cagr: Number(e.target.value) / 100})} className={inputStyle} /></div>
            )}
          </div>
          {!isPercentMode && (
            <div className="grid grid-cols-2 gap-4">
              <div><label className={labelStyle}>Contribution Growth (%/yr)</label><input type="number" step="0.1" value={((formData.contributionGrowth || 0) * 100).toFixed(1)} onChange={e => setFormData({...formData, contributionGrowth: Number(e.target.value) / 100})} className={inputStyle} /></div>
              <div><label className={labelStyle}>Expected CAGR (%)</label><input type="number" step="0.1" value={(formData.cagr * 100).toFixed(1)} onChange={e => setFormData({...formData, cagr: Number(e.target.value) / 100})} className={inputStyle} /></div>
            </div>
          )}
          {isPercentMode && (
            <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-lg space-y-3">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className={labelStyle} style={{marginBottom: 0}}>Employee Contribution</label>
                  <span className="text-sm font-semibold text-amber-300">{(employeeFrac * 100).toFixed(1)}%</span>
                </div>
                <input type="range" min="0" max="0.25" step="0.005" value={employeeFrac}
                  onChange={e => setFormData({...formData, employeePercent: Number(e.target.value)})}
                  className="w-full" />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className={labelStyle} style={{marginBottom: 0}}>Employer Match</label>
                  <span className="text-sm font-semibold text-amber-300">{(matchFrac * 100).toFixed(1)}%</span>
                </div>
                <input type="range" min="0" max="0.10" step="0.005" value={matchFrac}
                  onChange={e => setFormData({...formData, employerMatchPercent: Number(e.target.value)})}
                  className="w-full" />
              </div>
              <div className="text-xs text-slate-400 border-t border-slate-700/50 pt-2">
                {ownerSalaryStream ? (
                  <>Year 1: <span className="text-emerald-400 font-semibold">${year1Contrib.toLocaleString()}</span>
                  {' → '}Year 30: <span className="text-emerald-400 font-semibold">${year30Contrib.toLocaleString()}</span>
                  <span className="text-slate-500"> (salary ${Math.round(ownerSalaryStream.amount).toLocaleString()} × {(totalFrac*100).toFixed(1)}%)</span></>
                ) : (
                  <span className="text-rose-400">No earned-income stream found for this owner. Add one in the Income tab — contribution will be $0 otherwise.</span>
                )}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelStyle}>Contribution Start Age</label><input type="number" value={formData.startAge} onChange={e => setFormData({...formData, startAge: Number(e.target.value)})} className={inputStyle} /></div>
            <div><label className={labelStyle}>Contribution Stop Age</label><input type="number" value={formData.stopAge} onChange={e => setFormData({...formData, stopAge: Number(e.target.value)})} className={inputStyle} /></div>
          </div>
          {formData.type === 'brokerage' && (
            <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-lg">
              <label className={labelStyle}>Cost Basis (% of current balance)</label>
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={Math.round(((formData.costBasisPercent ?? 0.50) * 100))}
                onChange={e => setFormData({...formData, costBasisPercent: Math.min(1, Math.max(0, Number(e.target.value) / 100))})}
                className={inputStyle}
              />
              <p className="text-xs text-slate-400 mt-2">
                What % of this balance is your cost basis (after-tax dollars you contributed)?
                The remainder is unrealized capital gains. New accounts: ~95%. Old accounts with deep gains: 30–50%. Default: 50%.
              </p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 mt-8">
          <button onClick={onClose} className={buttonSecondary}>Cancel</button>
          <button onClick={() => onSave(formData)} className={buttonPrimary}>Save Account</button>
        </div>
      </div>
    </div>
  );
}

function IncomeModal({ editingIncome, personalInfo, onClose, onSave }) {
  const [formData, setFormData] = useState(editingIncome || { name: '', type: 'pension', amount: 0, startAge: 62, endAge: 95, cola: 0.02, owner: 'me', pia: 0 });
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`${cardStyle} max-w-lg w-full max-h-[90vh] overflow-y-auto`}>
        <h3 className="text-xl font-bold text-slate-100 mb-6">{editingIncome ? 'Edit Income Stream' : 'Add Income Stream'}</h3>
        <div className="space-y-4">
          <div><label className={labelStyle}>Income Name</label><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className={inputStyle} /></div>
          <div><label className={labelStyle}>Income Type</label><select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className={inputStyle}>{INCOME_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
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
          <button onClick={onClose} className={buttonSecondary}>Cancel</button>
          <button onClick={() => onSave(formData)} className={buttonPrimary}>Save Income</button>
        </div>
      </div>
    </div>
  );
}

function AssetModal({ editingAsset, onClose, onSave }) {
  const [formData, setFormData] = useState(editingAsset || { name: '', type: 'real_estate', value: 0, appreciationRate: 0.03, mortgage: 0, mortgagePayoffAge: null, mortgageRate: 0.065 });
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`${cardStyle} max-w-lg w-full max-h-[90vh] overflow-y-auto`}>
        <h3 className="text-xl font-bold text-slate-100 mb-6">{editingAsset ? 'Edit Asset' : 'Add New Asset'}</h3>
        <div className="space-y-4">
          <div><label className={labelStyle}>Asset Name</label><input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className={inputStyle} placeholder="e.g., Primary Residence, Rental Property" /></div>
          <div><label className={labelStyle}>Asset Type</label><select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className={inputStyle}>{ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelStyle}>Current Value</label><input type="number" value={formData.value} onChange={e => setFormData({...formData, value: Number(e.target.value)})} className={inputStyle} /></div>
            <div><label className={labelStyle}>Annual Appreciation (%)</label><input type="number" step="0.5" value={(formData.appreciationRate * 100).toFixed(1)} onChange={e => setFormData({...formData, appreciationRate: Number(e.target.value) / 100})} className={inputStyle} /><p className="text-xs text-slate-500 mt-1">Use negative for depreciation (e.g., vehicles)</p></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelStyle}>Outstanding Mortgage/Loan</label><input type="number" value={formData.mortgage} onChange={e => setFormData({...formData, mortgage: Number(e.target.value)})} className={inputStyle} /></div>
            <div><label className={labelStyle}>Payoff Age</label><input type="number" value={formData.mortgagePayoffAge || ''} onChange={e => setFormData({...formData, mortgagePayoffAge: e.target.value ? Number(e.target.value) : null})} className={inputStyle} placeholder="Leave blank if no loan" /></div>
          </div>
          {formData.mortgage > 0 && (
            <div>
              <label className={labelStyle}>Mortgage Rate (%)</label>
              <input
                type="number" step="0.125" min="0" max="20"
                value={((formData.mortgageRate ?? 0.065) * 100).toFixed(3)}
                onChange={e => setFormData({...formData, mortgageRate: Number(e.target.value) / 100})}
                className={inputStyle}
              />
              <p className="text-xs text-slate-500 mt-1">Annual interest rate. Used for proper amortization (default 6.5%). Set to 0 for interest-free loans.</p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 mt-8">
          <button onClick={onClose} className={buttonSecondary}>Cancel</button>
          <button onClick={() => onSave(formData)} className={buttonPrimary}>Save Asset</button>
        </div>
      </div>
    </div>
  );
}

function ImportExportModal({ showResetConfirm, setShowResetConfirm, onClose, handleExport, handleImport, handleReset }) {
  return (
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
          <button onClick={onClose} className={buttonSecondary}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// "Your Next 12 Months" action report
// Derives a near-term, actionable checklist from the current-year projection
// row. Almost everything is read straight off the year object; only the two
// bracket-headroom figures are derived here from already-exported engine tables.
// Pure function — no React, easy to unit-test and reuse for future reports.
// ============================================
function buildNextYearActions(projections, personalInfo, accounts, incomeStreams) {
  const currentYear = new Date().getFullYear();
  const y = (projections || []).find(p => p.year === currentYear) || (projections || [])[0];
  if (!y) return [];

  const fs = y.filingStatus || (personalInfo && personalInfo.filingStatus) || 'married_joint';
  const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const actions = [];

  // 1. Required Minimum Distribution — hard deadline, steep penalty.
  if (y.rmd > 0) {
    actions.push({
      id: 'rmd', severity: 'high',
      title: 'Take your Required Minimum Distribution',
      amount: fmt(y.rmd),
      detail: `Withdraw at least ${fmt(y.rmd)} from your pre-tax retirement accounts by Dec 31, ${currentYear}. Missing it triggers a 25% IRS penalty on the shortfall.`,
    });
  }

  // 2. Planned Roth conversion already in the plan for this year.
  if (y.rothConversion > 0) {
    actions.push({
      id: 'roth-planned', severity: 'info',
      title: 'Execute your planned Roth conversion',
      amount: fmt(y.rothConversion),
      detail: `Your plan converts ${fmt(y.rothConversion)} from pre-tax to Roth this year. Complete it with your custodian before Dec 31, ${currentYear}.`,
    });
  }

  // Taxable income after the standard deduction — the basis the federal brackets
  // and the LTCG 0% threshold are measured against. Current year => no inflation
  // indexing (yearsFromNow = 0), matching calculateFederalTax at year 0.
  const brackets = (FEDERAL_TAX_BRACKETS_2026 && (FEDERAL_TAX_BRACKETS_2026[fs] || FEDERAL_TAX_BRACKETS_2026.married_joint)) || null;
  const stdDed = (STANDARD_DEDUCTION_2026 && (STANDARD_DEDUCTION_2026[fs] || STANDARD_DEDUCTION_2026.married_joint)) || 0;
  const taxableAfterStdDed = Math.max(0, (y.taxableIncome || 0) - stdDed);

  // 3. Headroom to the top of the current federal bracket (Roth conversion room).
  if (brackets) {
    const idx = brackets.findIndex(b => taxableAfterStdDed >= b.min && taxableAfterStdDed < b.max);
    const cur = idx >= 0 ? brackets[idx] : null;
    if (cur && cur.max !== Infinity) {
      const headroom = cur.max - taxableAfterStdDed;
      const next = brackets[idx + 1];
      if (headroom > 0) {
        const curPct = Math.round(cur.rate * 100);
        const nextPct = next ? Math.round(next.rate * 100) : curPct;
        actions.push({
          id: 'roth-headroom', severity: 'info',
          title: `Room left in your ${curPct}% federal bracket`,
          amount: fmt(headroom),
          detail: `You can realize about ${fmt(headroom)} more ordinary income (e.g. a Roth conversion) before crossing into the ${nextPct}% bracket. Income added now is taxed at ${curPct}%.`,
        });
      }
    }
  }

  // 4. Long-term capital gains 0%-rate harvesting room.
  const cg = CAPITAL_GAINS_THRESHOLDS_2025 && (CAPITAL_GAINS_THRESHOLDS_2025[fs] || CAPITAL_GAINS_THRESHOLDS_2025.married_joint);
  if (cg) {
    const room = cg.zeroRate - taxableAfterStdDed;
    if (room > 0) {
      actions.push({
        id: 'cap-gains', severity: 'info',
        title: 'Harvest long-term capital gains at 0%',
        amount: fmt(room),
        detail: `Up to ${fmt(room)} of long-term capital gains can be realized this year at the 0% federal rate, based on your projected taxable income.`,
      });
    }
  }

  // 5. IRMAA — only populated at Medicare age; skip the top tier (no next tier).
  if (y.irmaaInfo && isFinite(y.irmaaInfo.distToNextTier) && y.irmaaInfo.distToNextTier > 0 && y.magi > 0) {
    actions.push({
      id: 'irmaa', severity: 'warn',
      title: 'Watch your Medicare IRMAA threshold',
      amount: fmt(y.irmaaInfo.distToNextTier),
      detail: `Your projected MAGI is ${fmt(y.magi)}. Adding more than ${fmt(y.irmaaInfo.distToNextTier)} of income would push you into the next IRMAA tier and raise your Medicare Part B & D premiums.`,
    });
  }

  // 6. Estimated quarterly taxes.
  if (y.totalTax > 0) {
    actions.push({
      id: 'quarterly', severity: 'info',
      title: 'Set aside estimated quarterly taxes',
      amount: fmt(y.totalTax / 4) + '/qtr',
      detail: `Projected total tax this year is ${fmt(y.totalTax)} (about ${fmt(y.totalTax / 4)} per quarter). Federal estimated-payment deadlines: Apr 15, Jun 15, Sep 15, and Jan 15 next year.`,
    });
  }

  // 7. QCD opportunity (70+, has a pre-tax balance to give from).
  if (y.myAge >= (QCD_START_AGE || 70) && (y.preTaxBalance || 0) > 0) {
    actions.push({
      id: 'qcd', severity: 'info',
      title: 'Consider a Qualified Charitable Distribution',
      detail: `At ${y.myAge} you can give directly from an IRA via a QCD. QCDs count toward your RMD but are excluded from taxable income — more tax-efficient than deducting cash gifts.`,
    });
  }

  // 8. HSA contribution (still eligible: under 65 and holding an HSA).
  const hasHSA = (accounts || []).some(a => typeof isHSAAccount === 'function' && isHSAAccount(a.type));
  if (hasHSA && y.myAge < 65) {
    actions.push({
      id: 'hsa', severity: 'info',
      title: 'Make your HSA contribution',
      detail: `You're under 65 and still HSA-eligible. Contributing before the tax-filing deadline gives a triple tax advantage: deductible going in, tax-free growth, and tax-free for medical costs.`,
    });
  }

  // 9. Social Security claiming decision approaching (within a year of claim age).
  (incomeStreams || []).filter(s => s.type === 'social_security').forEach(s => {
    const age = s.owner === 'spouse' ? y.spouseAge : y.myAge;
    if (age != null && s.startAge != null && age >= s.startAge - 1 && age <= s.startAge) {
      const who = s.owner === 'spouse' ? 'Your spouse is' : 'You are';
      actions.push({
        id: 'ss-' + s.id, severity: 'warn',
        title: 'Social Security claiming decision approaching',
        detail: `${who} near the planned claim age of ${s.startAge}. Confirm the strategy and file with the SSA about three months before benefits should begin.`,
      });
    }
  });

  return actions;
}

function NextYearReport({ projections, personalInfo, accounts, incomeStreams, onClose }) {
  const currentYear = new Date().getFullYear();
  const actions = useMemo(
    () => buildNextYearActions(projections, personalInfo, accounts, incomeStreams),
    [projections, personalInfo, accounts, incomeStreams]
  );
  const preparedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const SEVERITY = {
    high: { tag: 'Action required', border: '#dc2626', chipBg: '#fee2e2', chipText: '#991b1b' },
    warn: { tag: 'Plan ahead', border: '#d97706', chipBg: '#fef3c7', chipText: '#92400e' },
    info: { tag: 'Opportunity', border: '#2563eb', chipBg: '#dbeafe', chipText: '#1e40af' },
  };

  // Rendered through a portal as a direct child of <body> (sibling of #root) so
  // print CSS can hide the whole app with `#root { display:none }` and let the
  // report flow as a single normal-flow block. Keeping it inside the app tree
  // made it a child of a position:fixed overlay, which browsers re-stamp onto
  // every printed page (the 7-identical-pages bug).
  const overlay = (
    <div className="report-overlay fixed inset-0 bg-black/60 flex items-start justify-center z-50 overflow-y-auto py-8 px-4">
      <div
        id="report-print"
        style={{ background: '#ffffff', color: '#0f172a' }}
        className="w-full max-w-3xl rounded-xl shadow-2xl p-8"
      >
        {/* Toolbar — hidden in print */}
        <div className="print-hide flex justify-end gap-2 mb-6">
          <button onClick={() => window.print()} className={buttonPrimary}>Print / Save as PDF</button>
          <button onClick={onClose} className={buttonSecondary}>Close</button>
        </div>

        {/* Report header */}
        <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 12, marginBottom: 20 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Your Next 12 Months</h1>
          <p style={{ fontSize: 14, color: '#475569', margin: '4px 0 0' }}>
            Retirement action plan for {currentYear} &nbsp;·&nbsp; Prepared {preparedOn}
          </p>
        </div>

        {actions.length === 0 ? (
          <p style={{ fontSize: 15, color: '#475569' }}>
            No specific actions are flagged for this year based on your current plan. Keep contributing
            and revisit as you approach retirement, RMD age, or Medicare enrollment.
          </p>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {actions.map((a, i) => {
              const sv = SEVERITY[a.severity] || SEVERITY.info;
              return (
                <li
                  key={a.id}
                  style={{
                    borderLeft: `4px solid ${sv.border}`,
                    background: '#f8fafc',
                    borderRadius: 6,
                    padding: '12px 16px',
                    marginBottom: 12,
                    breakInside: 'avoid',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{i + 1}. {a.title}</span>
                    {a.amount && <span style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap' }}>{a.amount}</span>}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', background: sv.chipBg, color: sv.chipText, padding: '2px 8px', borderRadius: 999 }}>
                      {sv.tag}
                    </span>
                  </div>
                  <p style={{ fontSize: 14, color: '#334155', margin: '8px 0 0', lineHeight: 1.5 }}>{a.detail}</p>
                </li>
              );
            })}
          </ol>
        )}

        <p style={{ fontSize: 11, color: '#64748b', marginTop: 24, lineHeight: 1.5, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          This report is a directional planning tool generated from the assumptions in your plan, not tax or
          investment advice. Figures are estimates based on current-year projections and 2026 tax parameters.
          Confirm amounts and deadlines with a qualified professional before acting.
        </p>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}

function RetirementPlanner() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currentYear] = useState(new Date().getFullYear());
  const [saveStatus, setSaveStatus] = useState('');
  const [showImportExport, setShowImportExport] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [dataWarnings, setDataWarnings] = useState([]);
  // Single localStorage read for the whole component — savedData feeds both
  // the wizard check below and every state slice's initializer further down (B9).
  const [savedData] = useState(() => loadFromStorage());

  const [showSetupWizard, setShowSetupWizard] = useState(() => !savedData);
  
  // Logo Component - MB makers mark on blue circle
  const Logo = ({ size = 'large' }) => {
    const dimensions = size === 'large' ? 'w-14 h-14' : 'w-10 h-10';
    
    return (
      <div className={`${dimensions} flex items-center justify-center`}>
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <circle cx="16" cy="16" r="16" fill="#3b82f6"/>
          <g transform="translate(2.5, 4.1) scale(0.165)" fill="#FFFFFF" stroke="none">
            <path d="M50.82 136.87 c-0.55 -0.51 -0.55 -0.52 -0.55 -1.71 0 -1.32 0.19 -1.77 1.08 -2.35 0.37 -0.25 3.81 -1.51 14.56 -5.32 l1.54 -0.55 0.34 -1.33 c0.70 -2.71 1.56 -4.81 3.64 -9 4.72 -9.50 11.81 -20.99 19.58 -31.72 0.52 -0.75 0.94 -1.36 0.93 -1.38 -0.01 -0.01 -0.70 0.10 -1.53 0.25 -3.94 0.72 -5.24 0.16 -5.24 -2.26 0 -0.91 0.06 -1.23 0.34 -1.68 0.61 -0.99 1.15 -1.20 3.67 -1.42 2.47 -0.21 7.40 -1.03 7.72 -1.29 0.12 -0.09 0.96 -1.14 1.86 -2.34 2.83 -3.72 9.12 -11.52 17.80 -22.08 2.02 -2.46 3.78 -4.61 3.90 -4.79 0.19 -0.30 0.19 -0.31 0 -0.16 -0.81 0.58 -5.26 3.73 -7.19 5.08 -2.56 1.78 -2.50 1.75 -9.44 6.52 -18.65 12.82 -23.97 16.67 -34.91 25.24 -10.74 8.43 -14.31 10.88 -17.51 12.08 -1.08 0.40 -1.50 0.49 -2.64 0.49 -1.57 0.01 -2.32 -0.27 -2.89 -1.12 -0.31 -0.46 -0.34 -0.64 -0.30 -1.86 0.04 -1.24 0.10 -1.48 0.78 -2.97 0.93 -2.04 4.31 -8.40 6.02 -11.31 0.72 -1.21 3.04 -4.82 5.15 -8.05 2.11 -3.21 4.37 -6.68 5.03 -7.72 0.64 -1.03 1.89 -3.01 2.77 -4.42 0.88 -1.39 1.59 -2.56 1.56 -2.59 -0.03 -0.04 -1.66 1.12 -7.19 5.11 -2.34 1.69 -5.65 4.05 -8.33 5.92 -0.85 0.60 -3.10 2.17 -5 3.51 -1.89 1.32 -4.66 3.25 -6.14 4.28 -9.09 6.31 -15.55 10.98 -21.39 15.49 -2.13 1.65 -4.19 3.15 -4.60 3.36 -1.51 0.76 -3.51 0.36 -4.31 -0.88 -0.36 -0.54 -0.40 -0.75 -0.40 -1.83 0 -1.08 0.04 -1.30 0.37 -1.77 0.21 -0.30 1.63 -1.60 3.15 -2.91 4.24 -3.63 9.24 -8.64 20.38 -20.42 6.26 -6.62 12.46 -13.86 16.66 -19.40 2.37 -3.13 4.03 -6.07 4.60 -8.16 0.61 -2.19 0.40 -2.55 -1.30 -2.25 -3.51 0.60 -9.30 2.35 -20.03 6.07 -12.45 4.30 -21.80 7.75 -24.18 8.87 -0.97 0.48 -1.20 0.52 -1.98 0.45 -1.60 -0.13 -2.23 -0.90 -2.23 -2.67 0 -1.44 0.30 -1.93 1.54 -2.52 2.17 -1.03 6.44 -2.62 16.73 -6.26 10.07 -3.55 13.42 -4.69 18.95 -6.41 7.87 -2.44 10.56 -3.07 13.29 -3.07 2.73 0 3.91 0.57 4.76 2.31 0.42 0.84 0.49 1.17 0.55 2.53 0.13 2.59 -0.36 4.97 -1.56 7.34 -1.98 3.96 -11.18 15.45 -20.33 25.41 -4.05 4.40 -3.87 4.12 -1.65 2.58 1.06 -0.73 3.39 -2.34 5.15 -3.55 6.28 -4.31 14.05 -9.87 23.45 -16.76 7.61 -5.57 6.82 -5.08 8.24 -5.15 1.47 -0.06 2.02 0.18 2.47 1.11 0.66 1.35 0.27 3.15 -1.36 6.41 -1.30 2.59 -2.74 4.91 -6.49 10.52 -9.57 14.29 -11.52 17.38 -13.84 22.05 -0.78 1.59 -1.39 2.92 -1.35 2.97 0.10 0.10 5.11 -3.22 8.14 -5.42 1.48 -1.08 4.85 -3.55 7.49 -5.50 10.77 -7.96 13.95 -10.22 25.09 -17.92 10.16 -7.01 12.11 -8.36 13.93 -9.65 15.16 -10.61 19.46 -14.08 33.18 -26.85 4.25 -3.94 7.85 -7.57 9.57 -9.62 0.72 -0.87 1.36 -1.48 1.68 -1.62 0.63 -0.27 1.87 -0.27 2.50 0 1.38 0.57 2.02 2.67 1.30 4.25 -0.46 1.02 -0.57 1.12 -10.26 10.05 -3.69 3.40 -7.21 6.82 -8.70 8.42 -0.57 0.63 -2.46 2.82 -4.18 4.87 -1.72 2.05 -3.99 4.70 -5.02 5.90 -2.41 2.77 -5.18 6.04 -9.60 11.31 -1.93 2.31 -5.11 6.08 -7.04 8.39 -3.79 4.51 -7.97 9.66 -7.90 9.74 0.03 0.03 1.36 -0.18 2.97 -0.46 11.96 -2.10 22.71 -3.66 25.21 -3.66 2.47 0 3.72 1.32 3.51 3.70 -0.06 0.51 -0.22 1.20 -0.39 1.53 -0.70 1.35 -3.06 3.67 -6.23 6.13 -1.30 1 -6.01 4.24 -7.01 4.81 -0.25 0.15 -1.39 0.82 -2.50 1.47 -1.98 1.17 -4.36 2.47 -14.61 8.02 -5.72 3.10 -6.88 3.79 -6.73 4.05 0.15 0.22 4.57 2.35 8.52 4.09 7.34 3.22 7.82 3.48 8.25 4.28 0.31 0.63 0.43 2.01 0.22 2.77 -0.24 0.88 -0.93 1.75 -1.93 2.44 -3.34 2.26 -15.12 7.33 -25.35 10.91 -2.68 0.94 -4.25 1.48 -11.91 4.09 -1.98 0.67 -3.66 1.29 -3.73 1.35 -0.19 0.19 0.28 0.85 0.85 1.21 0.39 0.25 0.64 0.28 1.38 0.21 0.49 -0.04 1.48 -0.12 2.19 -0.16 1.23 -0.09 1.30 -0.07 1.54 0.25 0.27 0.40 0.33 1.78 0.09 2.23 -0.24 0.45 -0.60 0.58 -2.79 0.99 -1.57 0.30 -2.40 0.37 -3.60 0.33 -1.42 -0.04 -1.57 -0.07 -2.17 -0.49 -0.75 -0.54 -1.56 -1.66 -1.81 -2.52 -0.09 -0.34 -0.18 -0.64 -0.21 -0.67 -0.01 -0.03 -0.72 0.22 -1.57 0.55 -4.39 1.66 -10.20 3.76 -11.01 3.97 -0.51 0.13 -1.51 0.24 -2.22 0.24 -1.26 0 -1.30 -0.01 -1.86 -0.51z m27.70 -13.71 c10.80 -3.73 15.04 -5.32 20.43 -7.61 3.58 -1.53 7.42 -3.55 7.16 -3.79 -0.06 -0.06 -2.28 -1.03 -4.91 -2.17 -5.75 -2.47 -10.26 -4.57 -11.09 -5.14 -0.87 -0.61 -1.27 -1.39 -1.27 -2.52 0 -1.39 0.54 -2.32 1.87 -3.22 1.20 -0.79 9.75 -5.50 17.06 -9.38 7.54 -4 9.95 -5.41 13.12 -7.67 1.69 -1.20 4.28 -3.25 4.63 -3.67 0.21 -0.24 0.18 -0.25 -0.30 -0.18 -0.28 0.04 -2.19 0.33 -4.25 0.61 -4.13 0.58 -11.66 1.81 -17.30 2.83 -2.02 0.36 -4.02 0.70 -4.45 0.76 l-0.78 0.10 -1.53 2.11 c-2.80 3.88 -5.83 8.22 -8.36 12.02 -7.30 10.95 -11.13 18.13 -15.25 28.51 -0.04 0.09 -0.04 0.18 -0.01 0.18 0.04 0 2.40 -0.81 5.23 -1.78z"/>
          </g>
        </svg>
      </div>
    );
  };
  
  // savedData was hoisted above the wizard check (B9). State initializers below
  // re-use the same snapshot — one localStorage read per mount, not two.
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
  
  // Scenario comparison state. Scenarios ARE persisted by the auto-save effect,
  // so they must be restored here — initializing to [] meant every page load
  // wiped saved scenarios on the next debounced save (data loss).
  const [scenarios, setScenarios] = useState(() => savedData?.scenarios || []);
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
      setPersonalInfo({ ...DEFAULT_PERSONAL_INFO, ...scenario.personalInfo });
      // Always overwrite list fields — defaulting to [] so loading an older
      // scenario that predates a field (or that explicitly cleared it) wipes
      // the current values instead of leaving stale entries in place (B6).
      setAccounts(scenario.accounts || []);
      setIncomeStreams(scenario.incomeStreams || []);
      setAssets(scenario.assets || []);
      setOneTimeEvents(scenario.oneTimeEvents || []);
      setRecurringExpenses(scenario.recurringExpenses || []);
      setActiveScenarioId(id);
    }
  };
  
  // Auto-save to localStorage with debouncing to prevent excessive saves
  useEffect(() => {
    const saveTimer = setTimeout(() => {
      const data = { personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses, dashboardVisibility, scenarios, lastSaved: new Date().toISOString() };
      const result = saveToStorage(data);
      if (result.ok) {
        setSaveStatus('Saved');
      } else if (result.reason === 'quota') {
        // Surface the failure rather than letting users keep editing under the
        // impression their work is being persisted (B7).
        setSaveStatus('Save failed: browser storage full. Export your data.');
      } else {
        setSaveStatus('Save failed — see console for details.');
      }
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
      recurringExpenses,
      dashboardVisibility,
      scenarios,
      exportDate: new Date().toISOString(),
      version: '2.1'  // v37 - Removed milestones/phases/cashflow tabs (will return later)
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
        // Merge imported personalInfo with defaults to ensure new fields are present
        // This handles imports from older versions that may be missing newer fields
        if (data.personalInfo) {
          const currentYear = new Date().getFullYear();
          const merged = { ...DEFAULT_PERSONAL_INFO, ...data.personalInfo };
          if (!merged.myBirthYear) merged.myBirthYear = currentYear - merged.myAge;
          if (!merged.spouseBirthYear) merged.spouseBirthYear = currentYear - merged.spouseAge;
          setPersonalInfo(merged);
        }
        if (data.accounts) setAccounts(data.accounts);
        if (data.incomeStreams) setIncomeStreams(data.incomeStreams);
        if (data.assets) setAssets(data.assets);
        if (data.oneTimeEvents) setOneTimeEvents(data.oneTimeEvents);
        if (data.recurringExpenses) setRecurringExpenses(data.recurringExpenses);
        // Older exports may contain data.milestones, data.phases, or data.priorityRules.
        // Those tabs were removed in v37 and may return later. We silently ignore the
        // fields here so re-import doesn't fail and the data isn't lost (it's still in
        // the JSON file the user has on disk).
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
  
  // ASSET_TYPES / ACCOUNT_TYPES / CONTRIBUTOR_TYPES / INCOME_TYPES are at module scope
  // (above this function) so they aren't recreated on every render.


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
    if (account.id) setAccounts(prev => prev.map(a => a.id === account.id ? account : a));
    else setAccounts(prev => [...prev, { ...account, id: Date.now() + Math.random() }]);
    setShowAccountModal(false);
    setEditingAccount(null);
  };

  const handleSaveIncome = (income) => {
    const error = validateIncome(income);
    if (error) {
      alert(error);
      return;
    }
    if (income.id) setIncomeStreams(prev => prev.map(i => i.id === income.id ? income : i));
    else setIncomeStreams(prev => [...prev, { ...income, id: Date.now() + Math.random() }]);
    setShowIncomeModal(false);
    setEditingIncome(null);
  };

  // Dark mode styles — defined at module scope above (cardStyle, inputStyle, etc.)
  // so child components can be lifted out of RetirementPlanner without re-mounting
  // on every parent render.
  
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
        // Deep analysis tools
        { id: 'socialsecurity', label: 'Social Security', icon: '🎯' },
        { id: 'taxplanning', label: 'Tax Planning', icon: '📋' },
        { id: 'withdrawal', label: 'Withdrawals', icon: '📤' },
        { id: 'montecarlo', label: 'Monte Carlo', icon: '🎲' },
        { id: 'stresstest', label: 'Stress Test', icon: '⚡' },
        { id: 'sensitivity', label: 'Sensitivity', icon: '🔬' }
      ]
    },
    {
      label: 'TOOLS',
      icon: '🔧',
      items: [
        { id: 'scenarios', label: 'Scenarios', icon: '🔀' },
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
  
  const handleSaveAsset = (asset) => {
    if (asset.id) setAssets(prev => prev.map(a => a.id === asset.id ? asset : a));
    else setAssets(prev => [...prev, { ...asset, id: Date.now() + Math.random() }]);
    setShowAssetModal(false);
    setEditingAsset(null);
  };

  // The four modal components (AccountModal, IncomeModal, AssetModal, ImportExportModal)
  // are declared at module scope above so React keeps stable component identities across
  // parent re-renders — previously they were redefined each render and React unmount/remounted
  // them, blowing away their useState formData while the user was typing.
  
  
  // Coast FIRE Section Component with Test Scenarios
  
  // Lifestyle vs Legacy Component
  
  
  
  // Income Streams Tab with integrated detailed projections table
  
  // DetailedTableTab removed — content now embedded in IncomeStreamsTab above
  
  
  
  



  // ============================================
  // Sequence-of-Returns Risk / Stress Test Tab
  // ============================================
  // Tests how your plan performs when bad market years happen early in retirement.
  // Uses historical bear market sequences and user-defined scenarios to show the
  // impact of poor returns in the critical first 5-10 years after retirement.


  // ============================================
  // SOCIAL SECURITY OPTIMIZER TAB
  // ============================================

  // ============================================
  // SCENARIO COMPARISON TAB
  // ============================================

  // ============================================
  // Sensitivity Analysis Tab
  // ============================================
  // Shows how the plan changes when you vary one input at a time.
  // More intuitive than Monte Carlo — answers "what if returns are 1% lower?"
  // or "what if I spend $10K more?" with a single clear comparison.



  // ============================================
  // Guided Setup Wizard — Conversational Approach
  // Feels like talking to a financial advisor, not filling out forms.
  // Each step asks one clear question with smart defaults.
  // ============================================
  const SetupWizard = ({ onComplete, onExplore, existingData }) => {
    const [step, setStep] = useState(0);
    const yr = new Date().getFullYear();
    const hasExisting = existingData && existingData.personalInfo;

    // ── Wizard state — simple, human-readable fields ──
    const [w, setW] = useState({
      myAge: '', spouseAge: '', hasSpouse: true, state: 'Alabama',
      mySalary: '', spouseSalary: '', mySalaryGrowth: '3', spouseSalaryGrowth: '3',
      myRetirementAge: 65, spouseRetirementAge: 65,
      has401k: false, balance401k: '', contrib401k: '', contrib401kMode: 'fixed', contrib401kPercent: '',
      hasRoth401k: false, balanceRoth401k: '', contribRoth401k: '',
      match401k: '', match401kMode: 'fixed', match401kPercent: '',
      hasRothIRA: false, balanceRothIRA: '', contribRothIRA: '',
      hasTraditionalIRA: false, balanceTraditionalIRA: '', contribTraditionalIRA: '',
      hasBrokerage: false, balanceBrokerage: '', contribBrokerage: '',
      hasHSA: false, balanceHSA: '', contribHSA: '',
      spouseHas401k: false, spouseBalance401k: '', spouseContrib401k: '', spouseContrib401kMode: 'fixed', spouseContrib401kPercent: '',
      spouseHasRoth401k: false, spouseBalanceRoth401k: '', spouseContribRoth401k: '',
      spouseMatch401k: '', spouseMatch401kMode: 'fixed', spouseMatch401kPercent: '',
      spouseHasRothIRA: false, spouseBalanceRothIRA: '', spouseContribRothIRA: '',
      expectSS: true, ssMonthly: '', ssClaimAge: '67',
      spouseExpectSS: true, spouseSSMonthly: '', spouseSSClaimAge: '67',
      hasPension: false, pensionAmount: '', pensionStartAge: '65', pensionOwner: 'me',
      hasPension2: false, pension2Amount: '', pension2StartAge: '65', pension2Owner: 'spouse',
      // Other income sources (rental, business, side work, etc.)
      otherIncomes: [],
      desiredSpending: '',
      ownsHome: false, homeValue: '', mortgageBalance: '', mortgagePayoffAge: '',
      // Original account types for workplace plans loaded into the 401(k) slots, so a
      // 403(b)/457(b) round-trips back to its true type instead of being saved as a 401k.
      my401Type: '401k', myRoth401Type: 'roth_401k', spouse401Type: '401k', spouseRoth401Type: 'roth_401k',
      // IDs of existing accounts the wizard consumed into its fields; everything else is
      // preserved verbatim on finish so untouched account types are never dropped.
      consumedAccountIds: [],
      // True only when the user chose "Update My Plan" (loadExisting ran). On "Start Fresh"
      // this stays false so we DON'T carry old accounts/assets forward.
      editingExisting: false,
    });

    // On the "Update My Plan" path we show EVERY account/asset as an editable list
    // (full app-editor parity) instead of the fixed slot cards. These hold the live
    // working copies; they're committed to the plan only on finish.
    const [wizAccounts, setWizAccounts] = useState([]);
    const [wizAssets, setWizAssets] = useState([]);
    const [editingWizAccount, setEditingWizAccount] = useState(null);
    const [showWizAccountModal, setShowWizAccountModal] = useState(false);
    const [editingWizAsset, setEditingWizAsset] = useState(null);
    const [showWizAssetModal, setShowWizAssetModal] = useState(false);
    const [wizIncomes, setWizIncomes] = useState([]);
    const [editingWizIncome, setEditingWizIncome] = useState(null);
    const [showWizIncomeModal, setShowWizIncomeModal] = useState(false);

    const update = (field, value) => setW(prev => ({ ...prev, [field]: value }));
    const num = (v) => Number(String(v).replace(/[^0-9.-]/g, '')) || 0;

    const mySalary = num(w.mySalary);
    const spouseSalary = num(w.spouseSalary);
    const householdIncome = mySalary + (w.hasSpouse ? spouseSalary : 0);
    const yearsToRetire = Math.max(0, num(w.myRetirementAge) - num(w.myAge));
    const salaryAtRetire = mySalary * Math.pow(1 + num(w.mySalaryGrowth) / 100, yearsToRetire);
    const suggestedSpending = Math.round(householdIncome * 0.75 / 1000) * 1000;

    const estimateSSMonthly = (salary) => {
      if (salary <= 0) return 0;
      return Math.round(Math.min(salary * 0.40, 45600) / 12 / 50) * 50;
    };

    const loadExisting = () => {
      const pi = existingData.personalInfo;
      const accts = existingData.accounts || [];
      const incomes = existingData.incomeStreams || [];
      const assets = existingData.assets || [];
      const mySS = incomes.find(i => i.type === 'social_security' && i.owner === 'me');
      const spSS = incomes.find(i => i.type === 'social_security' && i.owner === 'spouse');
      const pension = incomes.find(i => i.type === 'pension');
      const pension2 = incomes.filter(i => i.type === 'pension')[1] || null; // second pension
      const myHSA = accts.find(a => a.type === 'hsa');
      const otherIncs = incomes.filter(i => ['rental','business','annuity','other'].includes(i.type));
      const mySal = incomes.find(i => i.type === 'earned_income' && i.owner === 'me');
      const spSal = incomes.find(i => i.type === 'earned_income' && i.owner === 'spouse');
      // Workplace pre-tax plans (401k/403b/457b) and their Roth variants all map into the
      // wizard's single "401(k)" slot per owner. We remember each loaded account's real type
      // so finishWizard writes it back as a 403(b)/457(b) instead of forcing it to 401k.
      const PRETAX_WORKPLACE = ['401k','403b','457b'];
      const ROTH_WORKPLACE = ['roth_401k','roth_403b','roth_457b'];
      // The employee plan is the non-employer row; the employer match is a separate
      // contributor==='employer' row OR is folded into the employee account as employerMatchPercent.
      // When someone holds more than one workplace plan of an owner (e.g. a contributory
      // 401(k) PLUS a balance-only ESOP also typed 401k), load the actively-contributed one
      // into the wizard slot and leave the rest to be preserved verbatim — so the ESOP keeps
      // its name/balance/growth instead of being rebuilt with generic defaults.
      const contributes = a => (a.contribution > 0) || (a.employeePercent > 0);
      const pickWorkplace = (types, owner) => {
        const rows = accts.filter(a => types.includes(a.type) && a.owner === owner && a.contributor !== 'employer');
        return rows.find(contributes) || rows[0];
      };
      const my401 = pickWorkplace(PRETAX_WORKPLACE, 'me');
      const myRoth401 = pickWorkplace(ROTH_WORKPLACE, 'me');
      const myRoth = accts.find(a => a.type === 'roth_ira' && a.owner === 'me');
      const myIRA = accts.find(a => a.type === 'traditional_ira' && a.owner === 'me');
      const myBrok = accts.find(a => a.type === 'brokerage');
      const sp401 = pickWorkplace(PRETAX_WORKPLACE, 'spouse');
      const spRoth401 = pickWorkplace(ROTH_WORKPLACE, 'spouse');
      const spRoth = accts.find(a => a.type === 'roth_ira' && a.owner === 'spouse');
      const matchAcct = accts.find(a => a.contributor === 'employer' && a.owner === 'me');
      const spMatch = accts.find(a => a.contributor === 'employer' && a.owner === 'spouse');
      const my401Pct = my401?.contributionMode === 'percent';
      const sp401Pct = sp401?.contributionMode === 'percent';
      const myFoldedMatch = my401Pct ? (my401.employerMatchPercent || 0) : 0;   // % match merged into the employee row
      const spFoldedMatch = sp401Pct ? (sp401.employerMatchPercent || 0) : 0;
      const home = assets.find(a => a.type === 'real_estate');
      const isMarried = pi.filingStatus === 'married_joint' || pi.filingStatus === 'married_separate';
      setW({
        myAge: String(pi.myAge||''), spouseAge: String(pi.spouseAge||''), hasSpouse: isMarried, state: pi.state||'Alabama',
        mySalary: mySal ? String(mySal.amount) : '', spouseSalary: spSal ? String(spSal.amount) : '',
        mySalaryGrowth: mySal ? String((mySal.cola*100).toFixed(0)) : '3',
        spouseSalaryGrowth: spSal ? String((spSal.cola*100).toFixed(0)) : (mySal ? String((mySal.cola*100).toFixed(0)) : '3'),
        myRetirementAge: pi.myRetirementAge||65, spouseRetirementAge: pi.spouseRetirementAge||65,
        has401k: !!my401, balance401k: my401?String(my401.balance):'',
        contrib401k: (my401&&!my401Pct)?String(my401.contribution):'',
        contrib401kMode: my401Pct?'percent':'fixed',
        contrib401kPercent: my401Pct?String(((my401.employeePercent||0)*100).toFixed(1)):'',
        hasRoth401k: !!myRoth401, balanceRoth401k: myRoth401?String(myRoth401.balance):'', contribRoth401k: myRoth401?String(myRoth401.contribution):'',
        match401k: myFoldedMatch>0?'':(matchAcct?String(matchAcct.contribution):''),
        match401kMode: (myFoldedMatch>0||matchAcct?.contributionMode==='percent')?'percent':'fixed',
        match401kPercent: myFoldedMatch>0?String((myFoldedMatch*100).toFixed(1)):(matchAcct?.contributionMode==='percent'?String(((matchAcct.employerMatchPercent||0)*100).toFixed(1)):''),
        hasRothIRA: !!myRoth, balanceRothIRA: myRoth?String(myRoth.balance):'', contribRothIRA: myRoth?String(myRoth.contribution):'',
        hasTraditionalIRA: !!myIRA, balanceTraditionalIRA: myIRA?String(myIRA.balance):'', contribTraditionalIRA: myIRA?String(myIRA.contribution):'',
        hasBrokerage: !!myBrok, balanceBrokerage: myBrok?String(myBrok.balance):'', contribBrokerage: myBrok?String(myBrok.contribution):'',
        spouseHas401k: !!sp401, spouseBalance401k: sp401?String(sp401.balance):'',
        spouseContrib401k: (sp401&&!sp401Pct)?String(sp401.contribution):'',
        spouseContrib401kMode: sp401Pct?'percent':'fixed',
        spouseContrib401kPercent: sp401Pct?String(((sp401.employeePercent||0)*100).toFixed(1)):'',
        spouseHasRoth401k: !!spRoth401, spouseBalanceRoth401k: spRoth401?String(spRoth401.balance):'', spouseContribRoth401k: spRoth401?String(spRoth401.contribution):'',
        spouseMatch401k: spFoldedMatch>0?'':(spMatch?String(spMatch.contribution):''),
        spouseMatch401kMode: (spFoldedMatch>0||spMatch?.contributionMode==='percent')?'percent':'fixed',
        spouseMatch401kPercent: spFoldedMatch>0?String((spFoldedMatch*100).toFixed(1)):(spMatch?.contributionMode==='percent'?String(((spMatch.employerMatchPercent||0)*100).toFixed(1)):''),
        spouseHasRothIRA: !!spRoth, spouseBalanceRothIRA: spRoth?String(spRoth.balance):'', spouseContribRothIRA: spRoth?String(spRoth.contribution):'',
        expectSS: !!mySS, ssMonthly: mySS?String(Math.round(mySS.amount/12)):'', ssClaimAge: mySS?String(mySS.startAge):'67',
        spouseExpectSS: !!spSS||isMarried, spouseSSMonthly: spSS?String(Math.round(spSS.amount/12)):'', spouseSSClaimAge: spSS?String(spSS.startAge):'67',
        hasPension: !!pension, pensionAmount: pension?String(pension.amount):'', pensionStartAge: pension?String(pension.startAge):'65', pensionOwner: pension?pension.owner:'me',
        hasPension2: !!pension2, pension2Amount: pension2?String(pension2.amount):'', pension2StartAge: pension2?String(pension2.startAge):'65', pension2Owner: pension2?pension2.owner:'spouse',
        hasHSA: !!myHSA, balanceHSA: myHSA?String(myHSA.balance):'', contribHSA: myHSA?String(myHSA.contribution):'',
        otherIncomes: otherIncs.map(i => ({id:i.id,name:i.name,type:i.type,amount:String(i.amount),startAge:String(i.startAge),endAge:String(i.endAge),cola:String(((i.cola||0)*100).toFixed(0)),owner:i.owner||'me'})),
        desiredSpending: pi.desiredRetirementIncome?String(pi.desiredRetirementIncome):'',
        ownsHome: !!home, homeValue: home?String(home.value):'', mortgageBalance: home?String(home.mortgage||0):'', mortgagePayoffAge: home?.mortgagePayoffAge?String(home.mortgagePayoffAge):'',
        my401Type: my401?.type || '401k', myRoth401Type: myRoth401?.type || 'roth_401k',
        spouse401Type: sp401?.type || '401k', spouseRoth401Type: spRoth401?.type || 'roth_401k',
        consumedAccountIds: [my401,myRoth401,myRoth,myIRA,myBrok,myHSA,matchAcct,sp401,spRoth401,spRoth,spMatch]
          .filter(Boolean).map(a => a.id),
        editingExisting: true,
      });
      // Seed the full editable lists with working copies of every account/asset/income.
      setWizAccounts((existingData.accounts || []).map(a => ({ ...a })));
      setWizAssets((existingData.assets || []).map(a => ({ ...a })));
      setWizIncomes((existingData.incomeStreams || []).map(i => ({ ...i })));
    };

    const finishWizard = () => {
      const myAge = num(w.myAge)||45; const spouseAge = num(w.spouseAge)||43;
      const retAge = num(w.myRetirementAge)||65; const spRetAge = num(w.spouseRetirementAge)||65;
      const filingStatus = w.hasSpouse ? 'married_joint' : 'single';
      // In edit mode, base the new personalInfo on the SAVED plan so Personal-tab
      // settings the wizard never asks about (withdrawal priority overrides, Roth
      // conversion window, healthcare model, COLA assumptions, etc.) are preserved.
      const basePI = (w.editingExisting && existingData && existingData.personalInfo)
        ? existingData.personalInfo : DEFAULT_PERSONAL_INFO;
      const newPI = { ...basePI, myAge, spouseAge: w.hasSpouse?spouseAge:myAge,
        myRetirementAge: retAge, spouseRetirementAge: w.hasSpouse?spRetAge:retAge,
        myBirthYear: yr-myAge, spouseBirthYear: yr-(w.hasSpouse?spouseAge:myAge),
        filingStatus, state: w.state, desiredRetirementIncome: num(w.desiredSpending)||suggestedSpending||60000,
        inflationRate: basePI.inflationRate || 0.03,
        withdrawalPriority: basePI.withdrawalPriority || ['pretax','brokerage','roth'] };
      const accts = []; let aid = 1;
      // Workplace plans keep their real type (401k/403b/457b) captured at load time so a
      // 403(b)/457(b) round-trips instead of being rewritten as a 401k.
      const my401Type = w.my401Type || '401k', myRoth401Type = w.myRoth401Type || 'roth_401k';
      const sp401Type = w.spouse401Type || '401k', spRoth401Type = w.spouseRoth401Type || 'roth_401k';
      const planLabel = { '401k':'401(k)','403b':'403(b)','457b':'457(b)','roth_401k':'Roth 401(k)','roth_403b':'Roth 403(b)','roth_457b':'Roth 457(b)' };
      // Traditional 401(k): when BOTH the employee deferral and the employer match are
      // entered as %, fold them into ONE percent account (employee% + match%, only the
      // employee slice is tax-deductible per engine). Otherwise emit the employee account
      // in its own mode plus a separate employer-match row.
      const my401Pct = w.contrib401kMode==='percent';
      const myMatchPct = w.match401kMode==='percent';
      const myMatchFolded = w.has401k && my401Pct && myMatchPct && num(w.match401kPercent)>0;
      if (w.has401k) {
        if (my401Pct) { accts.push({id:aid++,name:'My '+planLabel[my401Type],type:my401Type,balance:num(w.balance401k),contribution:0,contributionMode:'percent',employeePercent:num(w.contrib401kPercent)/100,employerMatchPercent:myMatchFolded?num(w.match401kPercent)/100:0,contributionGrowth:0,cagr:0.07,startAge:myAge,stopAge:retAge,owner:'me',contributor:myMatchFolded?'both':'me'}); }
        else { accts.push({id:aid++,name:'My '+planLabel[my401Type],type:my401Type,balance:num(w.balance401k),contribution:num(w.contrib401k),contributionGrowth:0.03,cagr:0.07,startAge:myAge,stopAge:retAge,owner:'me',contributor:'me'}); }
      }
      if (w.hasRoth401k) { accts.push({id:aid++,name:'My '+planLabel[myRoth401Type],type:myRoth401Type,balance:num(w.balanceRoth401k),contribution:num(w.contribRoth401k),contributionGrowth:0.03,cagr:0.07,startAge:myAge,stopAge:retAge,owner:'me',contributor:'me'}); }
      if ((w.has401k||w.hasRoth401k) && !myMatchFolded) {
        if (myMatchPct&&num(w.match401kPercent)>0) { accts.push({id:aid++,name:'Employer Match',type:my401Type,balance:0,contribution:0,contributionMode:'percent',employeePercent:0,employerMatchPercent:num(w.match401kPercent)/100,contributionGrowth:0,cagr:0.07,startAge:myAge,stopAge:retAge,owner:'me',contributor:'employer'}); }
        else if (!myMatchPct&&num(w.match401k)>0) { accts.push({id:aid++,name:'Employer Match',type:my401Type,balance:0,contribution:num(w.match401k),contributionGrowth:0.03,cagr:0.07,startAge:myAge,stopAge:retAge,owner:'me',contributor:'employer'}); }
      }
      if (w.hasRothIRA) accts.push({id:aid++,name:'My Roth IRA',type:'roth_ira',balance:num(w.balanceRothIRA),contribution:num(w.contribRothIRA),contributionGrowth:0.03,cagr:0.07,startAge:myAge,stopAge:retAge,owner:'me',contributor:'me'});
      if (w.hasTraditionalIRA) accts.push({id:aid++,name:'My Traditional IRA',type:'traditional_ira',balance:num(w.balanceTraditionalIRA),contribution:num(w.contribTraditionalIRA),contributionGrowth:0.03,cagr:0.07,startAge:myAge,stopAge:retAge,owner:'me',contributor:'me'});
      if (w.hasBrokerage) accts.push({id:aid++,name:'Brokerage',type:'brokerage',balance:num(w.balanceBrokerage),contribution:num(w.contribBrokerage),contributionGrowth:0.03,cagr:0.06,startAge:myAge,stopAge:retAge,owner:'me',contributor:'me'});
      if (w.hasHSA) accts.push({id:aid++,name:'HSA',type:'hsa',balance:num(w.balanceHSA),contribution:num(w.contribHSA),contributionGrowth:0.03,cagr:0.06,startAge:myAge,stopAge:retAge,owner:'me',contributor:'me'});
      const sp401Pct = w.spouseContrib401kMode==='percent';
      const spMatchPct = w.spouseMatch401kMode==='percent';
      const spMatchFolded = w.hasSpouse && w.spouseHas401k && sp401Pct && spMatchPct && num(w.spouseMatch401kPercent)>0;
      if (w.hasSpouse&&w.spouseHas401k) {
        if (sp401Pct) { accts.push({id:aid++,name:'Spouse '+planLabel[sp401Type],type:sp401Type,balance:num(w.spouseBalance401k),contribution:0,contributionMode:'percent',employeePercent:num(w.spouseContrib401kPercent)/100,employerMatchPercent:spMatchFolded?num(w.spouseMatch401kPercent)/100:0,contributionGrowth:0,cagr:0.07,startAge:spouseAge,stopAge:spRetAge,owner:'spouse',contributor:spMatchFolded?'both':'spouse'}); }
        else { accts.push({id:aid++,name:'Spouse '+planLabel[sp401Type],type:sp401Type,balance:num(w.spouseBalance401k),contribution:num(w.spouseContrib401k),contributionGrowth:0.03,cagr:0.07,startAge:spouseAge,stopAge:spRetAge,owner:'spouse',contributor:'spouse'}); }
      }
      if (w.hasSpouse&&w.spouseHasRoth401k) { accts.push({id:aid++,name:'Spouse '+planLabel[spRoth401Type],type:spRoth401Type,balance:num(w.spouseBalanceRoth401k),contribution:num(w.spouseContribRoth401k),contributionGrowth:0.03,cagr:0.07,startAge:spouseAge,stopAge:spRetAge,owner:'spouse',contributor:'spouse'}); }
      if (w.hasSpouse&&(w.spouseHas401k||w.spouseHasRoth401k)&&!spMatchFolded) {
        if (spMatchPct&&num(w.spouseMatch401kPercent)>0) { accts.push({id:aid++,name:'Spouse Match',type:sp401Type,balance:0,contribution:0,contributionMode:'percent',employeePercent:0,employerMatchPercent:num(w.spouseMatch401kPercent)/100,contributionGrowth:0,cagr:0.07,startAge:spouseAge,stopAge:spRetAge,owner:'spouse',contributor:'employer'}); }
        else if (!spMatchPct&&num(w.spouseMatch401k)>0) { accts.push({id:aid++,name:'Spouse Match',type:sp401Type,balance:0,contribution:num(w.spouseMatch401k),contributionGrowth:0.03,cagr:0.07,startAge:spouseAge,stopAge:spRetAge,owner:'spouse',contributor:'employer'}); }
      }
      if (w.hasSpouse&&w.spouseHasRothIRA) accts.push({id:aid++,name:'Spouse Roth IRA',type:'roth_ira',balance:num(w.spouseBalanceRothIRA),contribution:num(w.spouseContribRothIRA),contributionGrowth:0.03,cagr:0.07,startAge:spouseAge,stopAge:spRetAge,owner:'spouse',contributor:'spouse'});
      const incs = []; let iid = 1;
      if (mySalary>0) incs.push({id:iid++,name:'My Salary',type:'earned_income',amount:mySalary,startAge:myAge,endAge:retAge-1,cola:num(w.mySalaryGrowth)/100,owner:'me'});
      if (w.hasSpouse&&spouseSalary>0) incs.push({id:iid++,name:'Spouse Salary',type:'earned_income',amount:spouseSalary,startAge:spouseAge,endAge:spRetAge-1,cola:num(w.spouseSalaryGrowth||w.mySalaryGrowth)/100,owner:'spouse'});
      if (w.expectSS) { const mo=num(w.ssMonthly)||estimateSSMonthly(mySalary); const age=num(w.ssClaimAge)||67; const adj=calculateSSBenefit(mo,age,yr-myAge); incs.push({id:iid++,name:'My Social Security',type:'social_security',amount:adj*12,startAge:age,endAge:95,cola:0.02,owner:'me',pia:mo}); }
      if (w.hasSpouse&&w.spouseExpectSS) { const mo=num(w.spouseSSMonthly)||estimateSSMonthly(spouseSalary); const age=num(w.spouseSSClaimAge)||67; const adj=calculateSSBenefit(mo,age,yr-spouseAge); incs.push({id:iid++,name:'Spouse Social Security',type:'social_security',amount:adj*12,startAge:age,endAge:95,cola:0.02,owner:'spouse',pia:mo}); }
      if (w.hasPension) incs.push({id:iid++,name:'Pension',type:'pension',amount:num(w.pensionAmount),startAge:num(w.pensionStartAge)||retAge,endAge:95,cola:0.01,owner:w.pensionOwner||'me'});
      if (w.hasPension2) incs.push({id:iid++,name:'Pension 2',type:'pension',amount:num(w.pension2Amount),startAge:num(w.pension2StartAge)||retAge,endAge:95,cola:0.01,owner:w.pension2Owner||'spouse'});
      // Other income sources (rental, business, side work, etc.)
      w.otherIncomes.forEach(oi => {
        if (num(oi.amount) > 0) {
          incs.push({id:iid++, name:oi.name||'Other Income', type:oi.type||'other', amount:num(oi.amount),
            startAge:num(oi.startAge)||myAge, endAge:num(oi.endAge)||95, cola:(num(oi.cola)||2)/100, owner:oi.owner||'me'});
        }
      });
      const assets = []; let asid = 1;
      if (w.ownsHome&&num(w.homeValue)>0) assets.push({id:asid++,name:'Home',type:'real_estate',value:num(w.homeValue),appreciationRate:0.03,mortgage:num(w.mortgageBalance),mortgagePayoffAge:num(w.mortgagePayoffAge)||null});
      // Edit mode shows every account/asset as an editable list, so the wiz lists ARE
      // the complete plan — use them wholesale. Start Fresh / new users build from the
      // guided slot fields (accts/assets) as before.
      const finalAccts = w.editingExisting ? wizAccounts : accts;
      const finalAssets = w.editingExisting ? wizAssets : assets;
      const finalIncs = w.editingExisting ? wizIncomes : incs;
      onComplete(newPI, finalAccts.length>0?finalAccts:DEFAULT_ACCOUNTS, finalIncs.length>0?finalIncs:DEFAULT_INCOME_STREAMS, finalAssets.length>0?finalAssets:DEFAULT_ASSETS);
    };

    const getQuickPreview = () => {
      try {
        let totalSaved = num(w.balance401k)+num(w.balanceRoth401k)+num(w.balanceRothIRA)+num(w.balanceTraditionalIRA)+num(w.balanceBrokerage)+num(w.balanceHSA)+num(w.spouseBalance401k)+num(w.spouseBalanceRoth401k)+num(w.spouseBalanceRothIRA);
        const my401Est = w.contrib401kMode==='percent' ? mySalary*(num(w.contrib401kPercent)/100) : num(w.contrib401k);
        const sp401Est = w.spouseContrib401kMode==='percent' ? spouseSalary*(num(w.spouseContrib401kPercent)/100) : num(w.spouseContrib401k);
        const myMatch = w.match401kMode==='percent' ? mySalary*(num(w.match401kPercent)/100) : num(w.match401k);
        const spMatchEst = w.spouseMatch401kMode==='percent' ? spouseSalary*(num(w.spouseMatch401kPercent)/100) : num(w.spouseMatch401k);
        let totalContrib = my401Est+num(w.contribRoth401k)+myMatch+num(w.contribRothIRA)+num(w.contribTraditionalIRA)+num(w.contribBrokerage)+num(w.contribHSA)+sp401Est+num(w.spouseContribRoth401k)+spMatchEst+num(w.spouseContribRothIRA);
        // Edit mode: totals come from the full account list, not the slot fields.
        if (w.editingExisting) {
          totalSaved = wizAccounts.reduce((s,a)=>s+(Number(a.balance)||0),0);
          totalContrib = wizAccounts.reduce((s,a)=>{
            if (a.contributionMode==='percent') {
              const sal = a.owner==='spouse'?spouseSalary:mySalary;
              return s + sal*((Number(a.employeePercent)||0)+(Number(a.employerMatchPercent)||0));
            }
            return s + (Number(a.contribution)||0);
          },0);
        }
        const years = yearsToRetire; const cagr = 0.07;
        const fvLump = totalSaved * Math.pow(1+cagr, years);
        const fvAnnuity = years>0 ? totalContrib*((Math.pow(1+cagr,years)-1)/cagr)*(1+cagr) : 0;
        const proj = Math.round(fvLump+fvAnnuity);
        const spending = num(w.desiredSpending)||suggestedSpending||60000;
        const retA = num(w.myRetirementAge)||65;
        let guaranteed;
        if (w.editingExisting) {
          // Edit mode: guaranteed income from the full income list (non-salary streams
          // still active at retirement).
          guaranteed = wizIncomes.reduce((s,i)=> s + (i.type!=='earned_income' && (Number(i.endAge)||95) >= retA ? (Number(i.amount)||0) : 0), 0);
        } else {
          const ssAnn = (num(w.ssMonthly)||estimateSSMonthly(mySalary))*12;
          const spSSAnn = w.hasSpouse ? (num(w.spouseSSMonthly)||estimateSSMonthly(spouseSalary))*12 : 0;
          const pensionAnn = w.hasPension ? num(w.pensionAmount) : 0;
          const pension2Ann = w.hasPension2 ? num(w.pension2Amount) : 0;
          const otherIncAnn = w.otherIncomes.reduce((sum, oi) => sum + (num(oi.endAge) >= retA ? num(oi.amount) : 0), 0);
          guaranteed = ssAnn+spSSAnn+pensionAnn+pension2Ann+otherIncAnn;
        }
        const gap = Math.max(0, spending-guaranteed);
        const wr = proj>0 ? gap/proj*100 : 0;
        return { proj, spending, guaranteed, gap, wr, totalSaved, totalContrib };
      } catch(e) { return null; }
    };

    const inputStyle = "w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all";
    const cardBtn = (active) => `p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${active ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'}`;
    const dollarInput = (value, onChange, placeholder) => (<div className="relative"><span className="absolute left-3 top-2.5 text-slate-500">$</span><input type="text" inputMode="numeric" value={num(value)>0?num(value).toLocaleString():''} onChange={e=>onChange(e.target.value.replace(/[^0-9]/g,''))} placeholder={placeholder} className={`${inputStyle} pl-7`} /></div>);

    // Keyboard-accessible selectable account card (Enter/Space toggles).
    const AccountCard = ({active, onToggle, title, desc}) => (
      <div role="button" tabIndex={0} aria-pressed={active}
        onClick={onToggle}
        onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onToggle();}}}
        className={`${cardBtn(active)} focus:outline-none focus:ring-2 focus:ring-amber-500/50`}>
        <div className="flex items-center gap-3">
          <input type="checkbox" checked={active} readOnly tabIndex={-1} className="w-4 h-4 rounded border-slate-600 text-amber-500 pointer-events-none" />
          <div><div className="text-sm font-medium text-slate-200">{title}</div>{desc&&<div className="text-xs text-slate-500">{desc}</div>}</div>
        </div>
      </div>
    );

    // Employer-match input with a $ / % of-salary toggle. In % mode the match
    // becomes a percent-of-salary account (scales with the owner's salary COLA).
    const matchInput = ({label, modeKey, dollarKey, pctKey, dollarPlaceholder, pctPlaceholder='4',
        pctHint='Most employers match 3–6% of salary; it grows with your pay.',
        dollarHint='Total dollar amount your employer contributes per year.', border='border-sky-500/30'}) => {
      const isPct = w[modeKey] === 'percent';
      return (
        <div className={`pl-4 border-l-2 ${border}`}>
          <label className="text-xs text-slate-400 mb-1 block">{label}</label>
          <div className="flex gap-2 mb-2">
            <button type="button" onClick={()=>update(modeKey,'fixed')} className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition ${!isPct?'bg-amber-500/20 text-amber-300 border-amber-500/40':'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:text-slate-200'}`}>$ per year</button>
            <button type="button" onClick={()=>update(modeKey,'percent')} className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition ${isPct?'bg-amber-500/20 text-amber-300 border-amber-500/40':'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:text-slate-200'}`}>% of salary</button>
          </div>
          {isPct
            ? <div className="relative"><input type="number" step="0.5" value={w[pctKey]} onChange={e=>update(pctKey,e.target.value)} placeholder={pctPlaceholder} className={`${inputStyle} pr-8`} /><span className="absolute right-3 top-2.5 text-slate-500">%</span></div>
            : dollarInput(w[dollarKey],v=>update(dollarKey,v),dollarPlaceholder)}
          <p className="text-xs text-slate-500 mt-0.5">{isPct?pctHint:dollarHint}</p>
        </div>
      );
    };

    // Gate the Continue button: require age on step 1 (and spouse age if married).
    const canContinue = (s) => {
      if (s === 1) {
        if (!(num(w.myAge) > 0)) return false;
        if (w.hasSpouse && !(num(w.spouseAge) > 0)) return false;
      }
      return true;
    };

    // IRS 401(k)/403(b) limits (2025/2026). 402(g) = employee elective deferral;
    // 415(c) = combined employee + employer "annual additions". Age-50 catch-up and
    // the SECURE 2.0 ages-60–63 super catch-up raise both ceilings.
    const irs401kLimits = (age) => {
      // 2026 IRS limits (Notice 2025-67 / IR-2025-111): 402(g) elective deferral
      // $24,500; 415(c) annual additions $72,000; age-50 catch-up $8,000; ages
      // 60–63 SECURE 2.0 super catch-up $11,250. Catch-ups sit ON TOP of the
      // 415(c) limit (they don't reduce it), so the combined personal cap is
      // base + catch-up.
      const a = num(age);
      let catchUp = 0;
      if (a >= 50) catchUp = (a >= 60 && a <= 63) ? 11250 : 8000;
      const note = catchUp > 0 ? ` (includes the $${catchUp.toLocaleString()} age-${a >= 60 && a <= 63 ? '60–63 super' : '50'} catch-up)` : '';
      return { deferral: 24500 + catchUp, additions: 72000 + catchUp, note };
    };

    // Year-1 contribution check for one person's 401(k)/403(b) plan. Trad + Roth
    // share the employee-deferral limit; the employer match counts only toward the
    // combined annual-additions limit. Percent-mode amounts are estimated from the
    // current salary. Returns an array of warning strings (empty = within limits).
    const check401kLimits = ({age, salary, has401k, c401Mode, c401Pct, c401Fixed,
        hasRoth401k, rothFixed, matchMode, matchPct, matchFixed}) => {
      const warns = [];
      if (!has401k && !hasRoth401k) return warns;
      const usingPct = (has401k && c401Mode === 'percent') || ((has401k||hasRoth401k) && matchMode === 'percent');
      if (usingPct && salary <= 0) return warns; // can't size a % without salary
      const empTrad = has401k ? (c401Mode === 'percent' ? salary * (num(c401Pct)/100) : num(c401Fixed)) : 0;
      const empRoth = hasRoth401k ? num(rothFixed) : 0;
      const employee = empTrad + empRoth;
      const employer = (matchMode === 'percent' ? salary * (num(matchPct)/100) : num(matchFixed));
      const combined = employee + employer;
      const { deferral, additions, note } = irs401kLimits(age);
      if (employee > deferral + 1) warns.push(`Employee 401(k)/403(b) contributions (≈$${Math.round(employee).toLocaleString()}/yr) exceed the IRS elective-deferral limit of $${deferral.toLocaleString()}${note} for this age.`);
      if (combined > additions + 1) warns.push(`Combined employee + employer contributions (≈$${Math.round(combined).toLocaleString()}/yr) exceed the IRS combined limit of $${additions.toLocaleString()}${note} for this age.`);
      return warns;
    };

    // Render a non-blocking red warning panel for a list of limit messages.
    const limitWarning = (warns) => warns.length > 0 ? (
      <div className="pl-4 border-l-2 border-red-500/50 bg-red-500/5 rounded-r-lg py-2 pr-3 space-y-1">
        {warns.map((m, i) => <p key={i} className="text-xs text-red-300">⚠️ {m}</p>)}
        <p className="text-[10px] text-red-400/60">Estimated from current salary — you can still continue, but the IRS won't allow contributions above these limits.</p>
      </div>
    ) : null;

    const stepTitles = [
      {title:'Welcome',icon:'👋'},{title:'About You',icon:'👤'},{title:'What Do You Earn?',icon:'💼'},
      {title:'When to Retire?',icon:'🏖️'},{title:'What Have You Saved?',icon:'💰'},
      {title:'Social Security & Pensions',icon:'🏛️'},{title:'Retirement Spending',icon:'🎯'},
      {title:'Do You Own a Home?',icon:'🏠'},{title:'Your Plan Preview',icon:'📊'},
    ];
    const totalSteps = stepTitles.length;

    return (
      <div style={{position:'fixed',inset:0,zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem',backgroundColor:'rgba(0,0,0,0.85)',backdropFilter:'blur(4px)',overflow:'hidden'}}>
        <div style={{backgroundColor:'#0f172a',border:'1px solid #334155',borderRadius:'1rem',boxShadow:'0 25px 50px -12px rgba(0,0,0,.5)',width:'100%',maxWidth:'36rem',maxHeight:'92vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
          <div style={{padding:'1rem 1.5rem',borderBottom:'1px solid rgba(51,65,85,0.5)',flexShrink:0}}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-slate-100">{stepTitles[step].icon} {stepTitles[step].title}</h2>
              {step > 0 && <button onClick={onExplore} className="text-xs text-slate-500 hover:text-slate-300">Skip →</button>}
            </div>
            {step > 0 && (<div className="flex gap-1">{stepTitles.slice(1).map((s,idx) => (<div key={idx} className={`flex-1 h-1.5 rounded-full transition-colors ${idx+1<=step?'bg-amber-500':'bg-slate-700'}`} />))}</div>)}
          </div>

          <div style={{flex:'1 1 0%',minHeight:0,overflowY:'auto',padding:'1.25rem 1.5rem'}}>
            {step===0 && (<div className="text-center py-4 space-y-5"><div className="text-5xl">📊</div><h3 className="text-2xl font-bold text-slate-100">{hasExisting?'Update Your Plan':'Plan Your Retirement'}</h3><p className="text-slate-400 max-w-sm mx-auto text-sm">{hasExisting?'Walk through your plan to make changes, or start fresh.':'Answer a few simple questions and get a personalized retirement projection in about 3 minutes.'}</p>
              <div className="grid grid-cols-1 gap-3 max-w-sm mx-auto pt-2">
                {hasExisting && <button onClick={()=>{loadExisting();setStep(1);}} className="px-5 py-4 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl transition-colors"><div className="text-lg">✏️ Update My Plan</div><div className="text-sm text-amber-200/80 font-normal">Walk through with current data</div></button>}
                <button onClick={()=>setStep(1)} className={`px-5 py-4 ${hasExisting?'bg-slate-700 hover:bg-slate-600 text-slate-200':'bg-amber-600 hover:bg-amber-500 text-white'} font-semibold rounded-xl transition-colors`}><div className="text-lg">{hasExisting?'🆕 Start Fresh':'🚀 Get Started'}</div><div className={`text-sm ${hasExisting?'text-slate-400':'text-amber-200/80'} font-normal`}>~3 minutes</div></button>
                <button onClick={onExplore} className="px-5 py-3 text-slate-400 hover:text-slate-200 transition-colors text-sm">{hasExisting?'← Keep current plan':'🔍 Explore with sample data first'}</button>
              </div></div>)}

            {step===1 && (<div className="space-y-5">
              <p className="text-sm text-slate-400">Let's start with the basics.</p>
              <div><label className="text-sm font-medium text-slate-300 mb-1 block">How old are you?</label><input type="number" value={w.myAge} onChange={e=>update('myAge',e.target.value)} placeholder="45" className={inputStyle} /></div>
              <label className="flex items-center gap-3 cursor-pointer py-2"><input type="checkbox" checked={w.hasSpouse} onChange={e=>update('hasSpouse',e.target.checked)} className="w-5 h-5 rounded border-slate-600 text-amber-500 focus:ring-amber-500/50" /><span className="text-slate-200">I'm planning with a spouse or partner</span></label>
              {w.hasSpouse && <div className="pl-4 border-l-2 border-amber-500/30"><label className="text-sm font-medium text-slate-300 mb-1 block">Spouse's age?</label><input type="number" value={w.spouseAge} onChange={e=>update('spouseAge',e.target.value)} placeholder="43" className={inputStyle} /></div>}
              <div><label className="text-sm font-medium text-slate-300 mb-1 block">What state do you live in?</label><select value={w.state} onChange={e=>update('state',e.target.value)} className={inputStyle}>{Object.keys(STATE_TAX_RATES).map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            </div>)}

            {step===2 && (<div className="space-y-5">
              <p className="text-sm text-slate-400">What's your current annual income before taxes?</p>
              <div><label className="text-sm font-medium text-slate-300 mb-1 block">My annual salary</label>{dollarInput(w.mySalary,v=>update('mySalary',v),'85,000')}</div>
              {w.hasSpouse && <div><label className="text-sm font-medium text-slate-300 mb-1 block">Spouse's annual salary</label>{dollarInput(w.spouseSalary,v=>update('spouseSalary',v),'60,000')}</div>}
              <div><label className="text-sm font-medium text-slate-300 mb-1 block">My expected annual raises (%)</label><input type="number" step="0.5" value={w.mySalaryGrowth} onChange={e=>update('mySalaryGrowth',e.target.value)} className={`${inputStyle} w-24`} /><p className="text-xs text-slate-500 mt-1">Most people get 2–4% annual raises.</p></div>
              {w.hasSpouse && <div><label className="text-sm font-medium text-slate-300 mb-1 block">Spouse's expected annual raises (%)</label><input type="number" step="0.5" value={w.spouseSalaryGrowth} onChange={e=>update('spouseSalaryGrowth',e.target.value)} className={`${inputStyle} w-24`} /></div>}
              {householdIncome>0 && <div className="p-3 bg-slate-800/60 rounded-lg border border-slate-700/50"><div className="text-xs text-slate-500">Household income</div><div className="text-xl font-bold text-emerald-400">${householdIncome.toLocaleString()}/year</div></div>}
            </div>)}

            {step===3 && (<div className="space-y-5">
              <p className="text-sm text-slate-400">When do you want to stop working?</p>
              <div><input type="range" min="50" max="75" value={w.myRetirementAge} onChange={e=>update('myRetirementAge',Number(e.target.value))} className="w-full accent-amber-500" /><div className="flex justify-between text-sm mt-1"><span className="text-slate-500">50</span><span className="text-2xl font-bold text-amber-400">Age {w.myRetirementAge}</span><span className="text-slate-500">75</span></div></div>
              {num(w.myAge)>0 && <div className="grid grid-cols-2 gap-3"><div className="p-3 bg-slate-800/60 rounded-lg text-center"><div className="text-xs text-slate-500">Years to go</div><div className="text-xl font-bold text-slate-200">{yearsToRetire}</div></div>{mySalary>0&&<div className="p-3 bg-slate-800/60 rounded-lg text-center"><div className="text-xs text-slate-500">Salary at retirement</div><div className="text-lg font-bold text-slate-200">${Math.round(salaryAtRetire).toLocaleString()}</div></div>}</div>}
              {num(w.myAge)>0 && num(w.myRetirementAge)<=num(w.myAge) && <div className="p-3 bg-amber-500/10 border border-amber-500/40 rounded-lg text-sm text-amber-300">⚠️ Your retirement age is at or below your current age ({num(w.myAge)}). Slide it higher unless you're already retired.</div>}
              {w.hasSpouse && <div className="pl-4 border-l-2 border-amber-500/30 space-y-2"><label className="text-sm font-medium text-slate-300 mb-1 block">Spouse's retirement age</label><input type="range" min="50" max="75" value={w.spouseRetirementAge} onChange={e=>update('spouseRetirementAge',Number(e.target.value))} className="w-full accent-amber-500" /><div className="flex justify-between text-sm"><span className="text-slate-500">50</span><span className="text-xl font-bold text-amber-400">Age {w.spouseRetirementAge}</span><span className="text-slate-500">75</span></div>{num(w.spouseAge)>0&&<div className="p-2 bg-slate-800/40 rounded text-center"><span className="text-xs text-slate-500">{Math.max(0,num(w.spouseRetirementAge)-num(w.spouseAge))} years away</span></div>}</div>}
            </div>)}

            {step===4 && (<div className="space-y-4">
              {w.editingExisting && (<div className="space-y-2">
                <p className="text-sm text-slate-400">Every account from your plan. Edit, remove, or add — same as the Accounts tab.</p>
                {wizAccounts.map(a => (
                  <div key={a.id} className="flex items-center justify-between p-3 bg-slate-800/40 rounded-lg border border-slate-700/30">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-100 truncate">{a.name}</div>
                      <div className="text-xs text-slate-500">{(ACCOUNT_TYPES.find(t=>t.value===a.type)?.label)||a.type}{' · '}{a.owner==='spouse'?'Spouse':a.owner==='joint'?'Joint':'Me'}{' · $'+Math.round(Number(a.balance)||0).toLocaleString()}</div>
                    </div>
                    <div className="flex gap-3 shrink-0 ml-3">
                      <button onClick={()=>{setEditingWizAccount(a);setShowWizAccountModal(true);}} className="text-xs text-amber-400 hover:text-amber-300">Edit</button>
                      <button onClick={()=>setWizAccounts(prev=>prev.filter(x=>x.id!==a.id))} className="text-xs text-red-400/70 hover:text-red-400">Remove</button>
                    </div>
                  </div>
                ))}
                {wizAccounts.length===0&&<p className="text-sm text-slate-500 italic">No accounts yet — add one below.</p>}
                <button onClick={()=>{setEditingWizAccount(null);setShowWizAccountModal(true);}} className="mt-2 px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors">+ Add Account</button>
              </div>)}
              {!w.editingExisting && (<>
              <p className="text-sm text-slate-400">Check each account type you have. Estimates are fine to start.</p>
              <AccountCard active={w.has401k} onToggle={()=>update('has401k',!w.has401k)} title="Traditional 401(k) / 403(b)" desc="Pre-tax contributions, taxed on withdrawal" />
              {w.has401k && <div className="space-y-3">
                <div className="pl-4 border-l-2 border-amber-500/30"><label className="text-xs text-slate-400 mb-0.5 block">Current balance</label>{dollarInput(w.balance401k,v=>update('balance401k',v),'100,000')}</div>
                {matchInput({label:'My annual contribution',modeKey:'contrib401kMode',dollarKey:'contrib401k',pctKey:'contrib401kPercent',dollarPlaceholder:'10,000',pctPlaceholder:'10',pctHint:'Percent of your salary you defer each year; grows with your pay.',dollarHint:'Fixed dollar amount you contribute per year.',border:'border-amber-500/30'})}
                {matchInput({label:'Employer match (covers both Traditional & Roth)',modeKey:'match401kMode',dollarKey:'match401k',pctKey:'match401kPercent',dollarPlaceholder:'5,000'})}
              </div>}
              <AccountCard active={w.hasRoth401k} onToggle={()=>update('hasRoth401k',!w.hasRoth401k)} title="Roth 401(k) / Roth 403(b)" desc="After-tax contributions, tax-free in retirement" />
              {w.hasRoth401k && <div className="pl-4 border-l-2 border-emerald-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Current balance</label>{dollarInput(w.balanceRoth401k,v=>update('balanceRoth401k',v),'50,000')}</div><div><label className="text-xs text-slate-400 mb-0.5 block">My annual contribution</label>{dollarInput(w.contribRoth401k,v=>update('contribRoth401k',v),'10,000')}</div></div>}
              {/* Roth-only savers still get a match (it lands in a pre-tax bucket); shown here only when there's no Traditional 401(k) block to host it above. */}
              {w.hasRoth401k && !w.has401k && matchInput({label:'Employer match',modeKey:'match401kMode',dollarKey:'match401k',pctKey:'match401kPercent',dollarPlaceholder:'5,000'})}
              {limitWarning(check401kLimits({age:w.myAge,salary:mySalary,has401k:w.has401k,c401Mode:w.contrib401kMode,c401Pct:w.contrib401kPercent,c401Fixed:w.contrib401k,hasRoth401k:w.hasRoth401k,rothFixed:w.contribRoth401k,matchMode:w.match401kMode,matchPct:w.match401kPercent,matchFixed:w.match401k}))}
              <AccountCard active={w.hasRothIRA} onToggle={()=>update('hasRothIRA',!w.hasRothIRA)} title="Roth IRA" desc="Tax-free withdrawals in retirement" />
              {w.hasRothIRA && <div className="pl-4 border-l-2 border-amber-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.balanceRothIRA,v=>update('balanceRothIRA',v),'25,000')}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Annual contribution</label>{dollarInput(w.contribRothIRA,v=>update('contribRothIRA',v),'7,000')}</div></div>}
              <AccountCard active={w.hasTraditionalIRA} onToggle={()=>update('hasTraditionalIRA',!w.hasTraditionalIRA)} title="Traditional IRA" desc="Tax-deductible now, taxed on withdrawal" />
              {w.hasTraditionalIRA && <div className="pl-4 border-l-2 border-amber-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.balanceTraditionalIRA,v=>update('balanceTraditionalIRA',v),'50,000')}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Annual contribution</label>{dollarInput(w.contribTraditionalIRA,v=>update('contribTraditionalIRA',v),'7,000')}</div></div>}
              <AccountCard active={w.hasBrokerage} onToggle={()=>update('hasBrokerage',!w.hasBrokerage)} title="Brokerage / Taxable Savings" desc="Regular investment account" />
              {w.hasBrokerage && <div className="pl-4 border-l-2 border-amber-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.balanceBrokerage,v=>update('balanceBrokerage',v),'30,000')}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Annual contribution</label>{dollarInput(w.contribBrokerage,v=>update('contribBrokerage',v),'5,000')}</div></div>}
              {w.hasSpouse && <><div className="border-t border-slate-700/50 pt-3 mt-3"><p className="text-xs text-amber-400 font-semibold mb-3">SPOUSE'S ACCOUNTS</p></div>
                <AccountCard active={w.spouseHas401k} onToggle={()=>update('spouseHas401k',!w.spouseHas401k)} title="Spouse's Traditional 401(k)" />
                {w.spouseHas401k && <div className="space-y-3">
                  <div className="pl-4 border-l-2 border-amber-500/30"><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.spouseBalance401k,v=>update('spouseBalance401k',v),'50,000')}</div>
                  {matchInput({label:'Spouse annual contribution',modeKey:'spouseContrib401kMode',dollarKey:'spouseContrib401k',pctKey:'spouseContrib401kPercent',dollarPlaceholder:'8,000',pctPlaceholder:'10',pctHint:'Percent of salary deferred each year; grows with pay.',dollarHint:'Fixed dollar amount contributed per year.',border:'border-amber-500/30'})}
                  {matchInput({label:'Spouse employer match (covers both Traditional & Roth)',modeKey:'spouseMatch401kMode',dollarKey:'spouseMatch401k',pctKey:'spouseMatch401kPercent',dollarPlaceholder:'3,000'})}
                </div>}
                <AccountCard active={w.spouseHasRoth401k} onToggle={()=>update('spouseHasRoth401k',!w.spouseHasRoth401k)} title="Spouse's Roth 401(k)" />
                {w.spouseHasRoth401k && <div className="pl-4 border-l-2 border-emerald-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.spouseBalanceRoth401k,v=>update('spouseBalanceRoth401k',v),'25,000')}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Contribution</label>{dollarInput(w.spouseContribRoth401k,v=>update('spouseContribRoth401k',v),'5,000')}</div></div>}
                {w.spouseHasRoth401k && !w.spouseHas401k && matchInput({label:'Spouse employer match',modeKey:'spouseMatch401kMode',dollarKey:'spouseMatch401k',pctKey:'spouseMatch401kPercent',dollarPlaceholder:'3,000'})}
                {limitWarning(check401kLimits({age:w.spouseAge,salary:spouseSalary,has401k:w.spouseHas401k,c401Mode:w.spouseContrib401kMode,c401Pct:w.spouseContrib401kPercent,c401Fixed:w.spouseContrib401k,hasRoth401k:w.spouseHasRoth401k,rothFixed:w.spouseContribRoth401k,matchMode:w.spouseMatch401kMode,matchPct:w.spouseMatch401kPercent,matchFixed:w.spouseMatch401k}))}
                <AccountCard active={w.spouseHasRothIRA} onToggle={()=>update('spouseHasRothIRA',!w.spouseHasRothIRA)} title="Spouse's Roth IRA" />
                {w.spouseHasRothIRA && <div className="pl-4 border-l-2 border-amber-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.spouseBalanceRothIRA,v=>update('spouseBalanceRothIRA',v),'15,000')}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Contribution</label>{dollarInput(w.spouseContribRothIRA,v=>update('spouseContribRothIRA',v),'7,000')}</div></div>}
              </>}
              <AccountCard active={w.hasHSA} onToggle={()=>update('hasHSA',!w.hasHSA)} title="Health Savings Account (HSA)" desc="Triple tax advantage — tax-free for medical expenses in retirement" />
              {w.hasHSA && <div className="pl-4 border-l-2 border-teal-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.balanceHSA,v=>update('balanceHSA',v),'10,000')}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Annual contribution</label>{dollarInput(w.contribHSA,v=>update('contribHSA',v),'4,150')}</div></div>}
              <p className="text-xs text-slate-500">You can add 457(b) and other account types later from the Accounts tab.</p>
              </>)}
            </div>)}

            {step===5 && (<div className="space-y-5">
              {w.editingExisting && (<div className="space-y-2">
                <p className="text-sm text-slate-400">Every income stream from your plan — Social Security, pensions, salary, rental, etc. Edit, remove, or add, same as the Income tab.</p>
                {wizIncomes.map(i => (
                  <div key={i.id} className="flex items-center justify-between p-3 bg-slate-800/40 rounded-lg border border-slate-700/30">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-100 truncate">{i.name}</div>
                      <div className="text-xs text-slate-500">{(INCOME_TYPES.find(t=>t.value===i.type)?.label)||i.type}{' · '}{i.owner==='spouse'?'Spouse':'Me'}{' · $'+Math.round(Number(i.amount)||0).toLocaleString()+'/yr · ages '+i.startAge+'–'+i.endAge}</div>
                    </div>
                    <div className="flex gap-3 shrink-0 ml-3">
                      <button onClick={()=>{setEditingWizIncome(i);setShowWizIncomeModal(true);}} className="text-xs text-amber-400 hover:text-amber-300">Edit</button>
                      <button onClick={()=>setWizIncomes(prev=>prev.filter(x=>x.id!==i.id))} className="text-xs text-red-400/70 hover:text-red-400">Remove</button>
                    </div>
                  </div>
                ))}
                {wizIncomes.length===0&&<p className="text-sm text-slate-500 italic">No income streams yet — add one below.</p>}
                <button onClick={()=>{setEditingWizIncome(null);setShowWizIncomeModal(true);}} className="mt-2 px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors">+ Add Income Stream</button>
              </div>)}
              {!w.editingExisting && (<>
              <p className="text-sm text-slate-400">Social Security is the foundation of most retirement plans. Check your estimate at <span className="text-amber-400">ssa.gov/myaccount</span>.</p>
              <label className="flex items-center gap-3 cursor-pointer py-1"><input type="checkbox" checked={w.expectSS} onChange={e=>update('expectSS',e.target.checked)} className="w-5 h-5 rounded border-slate-600 text-amber-500 focus:ring-amber-500/50" /><span className="text-slate-200">I expect Social Security</span></label>
              {w.expectSS && <div className="pl-4 border-l-2 border-amber-500/30 space-y-2"><div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">My monthly benefit at Full Retirement Age (67)</label>{dollarInput(w.ssMonthly,v=>update('ssMonthly',v),estimateSSMonthly(mySalary)>0?estimateSSMonthly(mySalary).toLocaleString():'2,500')}{mySalary>0&&!num(w.ssMonthly)&&<button onClick={()=>update('ssMonthly',String(estimateSSMonthly(mySalary)))} className="text-xs text-emerald-400/70 hover:text-emerald-400 mt-0.5 underline cursor-pointer">Don't know? Use estimate: ~${estimateSSMonthly(mySalary).toLocaleString()}/mo</button>}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Claiming age</label><select value={w.ssClaimAge} onChange={e=>update('ssClaimAge',e.target.value)} className={inputStyle}>{[62,63,64,65,66,67,68,69,70].map(a=><option key={a} value={a}>{a}{a===62?' (earliest)':a===67?' (FRA)':a===70?' (max)':''}</option>)}</select></div></div><p className="text-xs text-slate-500">For your actual estimate, log in to <a href="https://www.ssa.gov/myaccount/" target="_blank" rel="noopener noreferrer" className="text-amber-400 underline">ssa.gov/myaccount</a> — look for "Estimated monthly benefit at age 67."</p></div>}
              {w.hasSpouse && <><div className="border-t border-slate-700/30 pt-3"><label className="flex items-center gap-3 cursor-pointer py-1"><input type="checkbox" checked={w.spouseExpectSS} onChange={e=>update('spouseExpectSS',e.target.checked)} className="w-5 h-5 rounded border-slate-600 text-amber-500 focus:ring-amber-500/50" /><span className="text-slate-200">Spouse expects Social Security</span></label></div>
                {w.spouseExpectSS && <div className="pl-4 border-l-2 border-amber-500/30 space-y-2"><div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Spouse monthly benefit at Full Retirement Age (67)</label>{dollarInput(w.spouseSSMonthly,v=>update('spouseSSMonthly',v),estimateSSMonthly(spouseSalary)>0?estimateSSMonthly(spouseSalary).toLocaleString():'1,800')}{spouseSalary>0&&!num(w.spouseSSMonthly)&&<button onClick={()=>update('spouseSSMonthly',String(estimateSSMonthly(spouseSalary)))} className="text-xs text-emerald-400/70 hover:text-emerald-400 mt-0.5 underline cursor-pointer">Don't know? Use estimate: ~${estimateSSMonthly(spouseSalary).toLocaleString()}/mo</button>}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Claiming age</label><select value={w.spouseSSClaimAge} onChange={e=>update('spouseSSClaimAge',e.target.value)} className={inputStyle}>{[62,63,64,65,66,67,68,69,70].map(a=><option key={a} value={a}>{a}</option>)}</select></div></div></div>}
              </>}
              <div className="border-t border-slate-700/30 pt-3"><label className="flex items-center gap-3 cursor-pointer py-1"><input type="checkbox" checked={w.hasPension} onChange={e=>update('hasPension',e.target.checked)} className="w-5 h-5 rounded border-slate-600 text-amber-500 focus:ring-amber-500/50" /><span className="text-slate-200">I or my spouse have a pension</span></label></div>
              {w.hasPension && <div className="pl-4 border-l-2 border-amber-500/30 grid grid-cols-3 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Annual amount</label>{dollarInput(w.pensionAmount,v=>update('pensionAmount',v),'24,000')}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Starts at age</label><input type="number" value={w.pensionStartAge} onChange={e=>update('pensionStartAge',e.target.value)} className={inputStyle} /></div>{w.hasSpouse&&<div><label className="text-xs text-slate-400 mb-0.5 block">Whose?</label><select value={w.pensionOwner} onChange={e=>update('pensionOwner',e.target.value)} className={inputStyle}><option value="me">Mine</option><option value="spouse">Spouse</option></select></div>}</div>}
              {w.hasPension && <div className="pl-4 mt-2"><label className="flex items-center gap-3 cursor-pointer py-1"><input type="checkbox" checked={w.hasPension2} onChange={e=>update('hasPension2',e.target.checked)} className="w-4 h-4 rounded border-slate-600 text-amber-500 focus:ring-amber-500/50" /><span className="text-sm text-slate-300">There's a second pension</span></label></div>}
              {w.hasPension&&w.hasPension2 && <div className="pl-4 border-l-2 border-amber-500/30 grid grid-cols-3 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Annual amount</label>{dollarInput(w.pension2Amount,v=>update('pension2Amount',v),'18,000')}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Starts at age</label><input type="number" value={w.pension2StartAge} onChange={e=>update('pension2StartAge',e.target.value)} className={inputStyle} /></div>{w.hasSpouse&&<div><label className="text-xs text-slate-400 mb-0.5 block">Whose?</label><select value={w.pension2Owner} onChange={e=>update('pension2Owner',e.target.value)} className={inputStyle}><option value="me">Mine</option><option value="spouse">Spouse</option></select></div>}</div>}

              {/* Other income sources */}
              <div className="border-t border-slate-700/30 pt-3">
                <p className="text-sm font-medium text-slate-300 mb-2">Other Income Sources</p>
                <p className="text-xs text-slate-500 mb-3">Rental properties, side business, consulting, part-time work, annuities — anything that provides ongoing income, including income that may continue into retirement.</p>
                {w.otherIncomes.map(oi => (
                  <div key={oi.id} className="mb-3 p-3 bg-slate-800/40 rounded-lg border border-slate-700/30">
                    <div className="flex items-center justify-between mb-2">
                      <input type="text" value={oi.name} onChange={e=>{const v=e.target.value;setW(prev=>({...prev,otherIncomes:prev.otherIncomes.map(o=>o.id===oi.id?{...o,name:v}:o)}))}} className="bg-transparent border-none text-slate-100 font-medium focus:outline-none text-sm flex-1" placeholder="Income name" />
                      <button onClick={()=>setW(prev=>({...prev,otherIncomes:prev.otherIncomes.filter(o=>o.id!==oi.id)}))} className="text-red-400/70 hover:text-red-400 text-xs ml-2">Remove</button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div><label className="text-[10px] text-slate-500 block mb-0.5">Type</label><select value={oi.type} onChange={e=>{const v=e.target.value;setW(prev=>({...prev,otherIncomes:prev.otherIncomes.map(o=>o.id===oi.id?{...o,type:v}:o)}))}} className={`${inputStyle} text-xs py-1.5`}><option value="rental">Rental</option><option value="business">Business/Consulting</option><option value="annuity">Annuity</option><option value="other">Other</option></select></div>
                      <div><label className="text-[10px] text-slate-500 block mb-0.5">Annual $</label>{dollarInput(oi.amount, v=>setW(prev=>({...prev,otherIncomes:prev.otherIncomes.map(o=>o.id===oi.id?{...o,amount:v}:o)})), '12,000')}</div>
                      <div><label className="text-[10px] text-slate-500 block mb-0.5">Ages</label><div className="flex items-center gap-1"><input type="number" value={oi.startAge} onChange={e=>{const v=e.target.value;setW(prev=>({...prev,otherIncomes:prev.otherIncomes.map(o=>o.id===oi.id?{...o,startAge:v}:o)}))}} className={`${inputStyle} text-xs py-1.5 w-14`} /><span className="text-slate-600">–</span><input type="number" value={oi.endAge} onChange={e=>{const v=e.target.value;setW(prev=>({...prev,otherIncomes:prev.otherIncomes.map(o=>o.id===oi.id?{...o,endAge:v}:o)}))}} className={`${inputStyle} text-xs py-1.5 w-14`} /></div></div>
                      <div><label className="text-[10px] text-slate-500 block mb-0.5">Annual growth (%)</label><input type="number" step="0.5" value={oi.cola} onChange={e=>{const v=e.target.value;setW(prev=>({...prev,otherIncomes:prev.otherIncomes.map(o=>o.id===oi.id?{...o,cola:v}:o)}))}} className={`${inputStyle} text-xs py-1.5`} placeholder="2" /></div>
                      {w.hasSpouse&&<div><label className="text-[10px] text-slate-500 block mb-0.5">Owner</label><select value={oi.owner} onChange={e=>{const v=e.target.value;setW(prev=>({...prev,otherIncomes:prev.otherIncomes.map(o=>o.id===oi.id?{...o,owner:v}:o)}))}} className={`${inputStyle} text-xs py-1.5`}><option value="me">Me</option><option value="spouse">Spouse</option></select></div>}
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  {[['rental','🏘️ Rental Income'],['business','💼 Business/Consulting'],['annuity','📄 Annuity'],['other','➕ Other']].map(([t,l])=>(
                    <button key={t} onClick={()=>setW(prev=>({...prev,otherIncomes:[...prev.otherIncomes,{id:Date.now()+Math.random(),name:t==='rental'?'Rental Income':t==='business'?'Business Income':t==='annuity'?'Annuity':'Other Income',type:t,amount:'',startAge:String(num(w.myAge)||45),endAge:'95',cola:'2',owner:'me'}]}))} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors">{l}</button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2">Set the end age past retirement if this income continues after you stop working (e.g., rental income through age 95).</p>
              </div>
              </>)}
            </div>)}

            {step===6 && (<div className="space-y-5">
              <p className="text-sm text-slate-400">How much annual income do you want in retirement? (Today's dollars — inflation is automatic.)</p>
              <div><label className="text-sm font-medium text-slate-300 mb-1 block">Desired annual retirement income</label>{dollarInput(w.desiredSpending,v=>update('desiredSpending',v),suggestedSpending>0?suggestedSpending.toLocaleString():'60,000')}</div>
              {householdIncome>0 && <div className="p-4 bg-slate-800/60 rounded-lg border border-slate-700/50 space-y-2">
                <p className="text-xs text-slate-500 font-semibold">RULE OF THUMB</p>
                <p className="text-sm text-slate-300">Most planners suggest <strong className="text-amber-400">70–80%</strong> of pre-retirement income.</p>
                <div className="grid grid-cols-3 gap-3 mt-2">{[70,75,80].map(pct=>{const val=Math.round(householdIncome*pct/100/1000)*1000;return(<button key={pct} onClick={()=>update('desiredSpending',String(val))} className={`p-2 rounded-lg border text-center transition-all ${num(w.desiredSpending)===val?'border-amber-500 bg-amber-500/10':'border-slate-600 hover:border-slate-500'}`}><div className="text-xs text-slate-500">{pct}%</div><div className="text-sm font-bold text-slate-200">${val.toLocaleString()}</div></button>);})}</div>
                <p className="text-xs text-slate-500 mt-2">That's ${Math.round((num(w.desiredSpending)||suggestedSpending)/12).toLocaleString()}/month.</p>
              </div>}
            </div>)}

            {step===7 && (<div className="space-y-5">
              {w.editingExisting && (<div className="space-y-2">
                <p className="text-sm text-slate-400">Every asset from your plan. Edit, remove, or add — same as the Assets tab.</p>
                {wizAssets.map(a => (
                  <div key={a.id} className="flex items-center justify-between p-3 bg-slate-800/40 rounded-lg border border-slate-700/30">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-100 truncate">{a.name}</div>
                      <div className="text-xs text-slate-500">{(ASSET_TYPES.find(t=>t.value===a.type)?.label)||a.type}{' · $'+Math.round(Number(a.value)||0).toLocaleString()}</div>
                    </div>
                    <div className="flex gap-3 shrink-0 ml-3">
                      <button onClick={()=>{setEditingWizAsset(a);setShowWizAssetModal(true);}} className="text-xs text-amber-400 hover:text-amber-300">Edit</button>
                      <button onClick={()=>setWizAssets(prev=>prev.filter(x=>x.id!==a.id))} className="text-xs text-red-400/70 hover:text-red-400">Remove</button>
                    </div>
                  </div>
                ))}
                {wizAssets.length===0&&<p className="text-sm text-slate-500 italic">No assets yet — add one below.</p>}
                <button onClick={()=>{setEditingWizAsset(null);setShowWizAssetModal(true);}} className="mt-2 px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors">+ Add Asset</button>
              </div>)}
              {!w.editingExisting && (<>
              <p className="text-sm text-slate-400">Home equity is tracked for net worth but doesn't fund spending directly.</p>
              <label className="flex items-center gap-3 cursor-pointer py-1"><input type="checkbox" checked={w.ownsHome} onChange={e=>update('ownsHome',e.target.checked)} className="w-5 h-5 rounded border-slate-600 text-amber-500 focus:ring-amber-500/50" /><span className="text-slate-200">I own a home</span></label>
              {w.ownsHome && <div className="pl-4 border-l-2 border-amber-500/30 space-y-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Estimated value</label>{dollarInput(w.homeValue,v=>update('homeValue',v),'350,000')}</div><div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Remaining mortgage</label>{dollarInput(w.mortgageBalance,v=>update('mortgageBalance',v),'150,000')}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Payoff age</label><input type="number" value={w.mortgagePayoffAge} onChange={e=>update('mortgagePayoffAge',e.target.value)} placeholder="70" className={inputStyle} /></div></div></div>}
              {!w.ownsHome && <p className="text-sm text-slate-500 italic">You can add any assets later from the Assets tab.</p>}
              </>)}
            </div>)}

            {step===8 && (()=>{const pv=getQuickPreview();return(<div className="space-y-4">
              <p className="text-sm text-slate-400">Here's your plan at a glance. You can refine everything from the tabs after launch.</p>
              {pv&&pv.proj>0 && <div className="p-4 bg-gradient-to-br from-emerald-900/30 to-slate-800/60 rounded-xl border border-emerald-700/30">
                <div className="text-xs text-emerald-400 font-semibold mb-3">📊 QUICK PROJECTION (7% avg return)</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><div className="text-xs text-slate-500">Portfolio at retirement</div><div className="text-xl font-bold text-emerald-400">${pv.proj.toLocaleString()}</div></div>
                  <div><div className="text-xs text-slate-500">Spending goal</div><div className="text-xl font-bold text-amber-400">${(num(w.desiredSpending)||suggestedSpending).toLocaleString()}/yr</div></div>
                  <div><div className="text-xs text-slate-500">Guaranteed income (SS+pension)</div><div className="text-lg font-bold text-sky-400">${pv.guaranteed.toLocaleString()}/yr</div></div>
                  <div><div className="text-xs text-slate-500">Gap from portfolio</div><div className="text-lg font-bold text-slate-200">${pv.gap.toLocaleString()}/yr</div></div>
                </div>
                {pv.wr>0&&<div className="mt-3 pt-3 border-t border-emerald-700/30"><span className={`text-sm font-semibold ${pv.wr<=4?'text-emerald-400':pv.wr<=5?'text-amber-400':'text-red-400'}`}>{pv.wr.toFixed(1)}% withdrawal rate</span><span className="text-xs text-slate-500 ml-2">{pv.wr<=4?'— Safe range':pv.wr<=5?'— Monitor closely':'— Consider adjustments'}</span></div>}
              </div>}
              <div className="p-3 bg-slate-800/60 rounded-lg"><div className="text-xs font-semibold text-amber-400 mb-2">ABOUT YOU</div><div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm"><span className="text-slate-500">Age:</span><span className="text-slate-200">{w.myAge||'—'}, retire at {w.myRetirementAge}</span>{w.hasSpouse&&<><span className="text-slate-500">Spouse:</span><span className="text-slate-200">{w.spouseAge||'—'}, retire at {w.spouseRetirementAge}</span></>}<span className="text-slate-500">State:</span><span className="text-slate-200">{w.state}</span></div></div>
              <div className="p-3 bg-slate-800/60 rounded-lg"><div className="text-xs font-semibold text-amber-400 mb-2">INCOME</div><div className="space-y-1 text-sm">
                {w.editingExisting ? (<>
                  {wizIncomes.map(i=><div key={i.id} className="flex justify-between"><span className="text-slate-400 truncate mr-2">{i.name} ({i.owner})</span><span className="text-emerald-400 shrink-0">${Math.round(Number(i.amount)||0).toLocaleString()}/yr ages {i.startAge}–{i.endAge}</span></div>)}
                  {wizIncomes.length===0&&<p className="text-slate-500 italic">No income streams</p>}
                </>) : (<>
                  {mySalary>0&&<div className="flex justify-between"><span className="text-slate-400">My salary</span><span className="text-emerald-400">${mySalary.toLocaleString()}/yr</span></div>}
                  {w.hasSpouse&&spouseSalary>0&&<div className="flex justify-between"><span className="text-slate-400">Spouse salary</span><span className="text-emerald-400">${spouseSalary.toLocaleString()}/yr</span></div>}
                  {w.expectSS&&<div className="flex justify-between"><span className="text-slate-400">My SS at {w.ssClaimAge}</span><span className="text-emerald-400">${(num(w.ssMonthly)||estimateSSMonthly(mySalary)).toLocaleString()}/mo</span></div>}
                  {w.hasSpouse&&w.spouseExpectSS&&<div className="flex justify-between"><span className="text-slate-400">Spouse SS</span><span className="text-emerald-400">${(num(w.spouseSSMonthly)||estimateSSMonthly(spouseSalary)).toLocaleString()}/mo</span></div>}
                  {w.hasPension&&<div className="flex justify-between"><span className="text-slate-400">Pension ({w.pensionOwner})</span><span className="text-emerald-400">${num(w.pensionAmount).toLocaleString()}/yr</span></div>}
                  {w.hasPension2&&<div className="flex justify-between"><span className="text-slate-400">Pension 2 ({w.pension2Owner})</span><span className="text-emerald-400">${num(w.pension2Amount).toLocaleString()}/yr</span></div>}
                  {w.otherIncomes.filter(oi=>num(oi.amount)>0).map(oi=><div key={oi.id} className="flex justify-between"><span className="text-slate-400">{oi.name} ({oi.owner})</span><span className="text-emerald-400">${num(oi.amount).toLocaleString()}/yr ages {oi.startAge}–{oi.endAge}</span></div>)}
                </>)}
              </div></div>
              <div className="p-3 bg-slate-800/60 rounded-lg"><div className="text-xs font-semibold text-amber-400 mb-2">SAVINGS</div><div className="space-y-1 text-sm">
                {w.editingExisting ? (<>
                  {wizAccounts.map(a=><div key={a.id} className="flex justify-between"><span className="text-slate-400 truncate mr-2">{a.name}</span><span className="text-emerald-400 shrink-0">${Math.round(Number(a.balance)||0).toLocaleString()}{a.contributionMode==='percent'?((Number(a.employeePercent)||0)+(Number(a.employerMatchPercent)||0)>0?` + ${(((Number(a.employeePercent)||0)+(Number(a.employerMatchPercent)||0))*100).toFixed(1)}% of salary`:''):(num(a.contribution)>0?` + $${num(a.contribution).toLocaleString()}/yr`:'')}</span></div>)}
                  {wizAccounts.length===0&&<p className="text-slate-500 italic">No accounts</p>}
                </>) : (<>
                  {w.has401k&&<div className="flex justify-between"><span className="text-slate-400">401(k)</span><span className="text-emerald-400">${num(w.balance401k).toLocaleString()}{w.contrib401kMode==='percent'?(num(w.contrib401kPercent)>0?` + ${num(w.contrib401kPercent)}% of salary`:''):(num(w.contrib401k)>0?` + $${num(w.contrib401k).toLocaleString()}/yr`:'')}</span></div>}
                  {w.hasRoth401k&&<div className="flex justify-between"><span className="text-slate-400">Roth 401(k)</span><span className="text-emerald-400">${num(w.balanceRoth401k).toLocaleString()}{num(w.contribRoth401k)>0?` + $${num(w.contribRoth401k).toLocaleString()}/yr`:''}</span></div>}
                  {(w.has401k||w.hasRoth401k)&&((w.match401kMode==='percent'&&num(w.match401kPercent)>0)||(w.match401kMode!=='percent'&&num(w.match401k)>0))&&<div className="flex justify-between"><span className="text-slate-400">Employer match</span><span className="text-emerald-400">{w.match401kMode==='percent'?`${num(w.match401kPercent)}% of salary`:`$${num(w.match401k).toLocaleString()}/yr`}</span></div>}
                  {w.hasRothIRA&&<div className="flex justify-between"><span className="text-slate-400">Roth IRA</span><span className="text-emerald-400">${num(w.balanceRothIRA).toLocaleString()}</span></div>}
                  {w.hasTraditionalIRA&&<div className="flex justify-between"><span className="text-slate-400">Traditional IRA</span><span className="text-emerald-400">${num(w.balanceTraditionalIRA).toLocaleString()}</span></div>}
                  {w.hasBrokerage&&<div className="flex justify-between"><span className="text-slate-400">Brokerage</span><span className="text-emerald-400">${num(w.balanceBrokerage).toLocaleString()}</span></div>}
                  {w.hasHSA&&<div className="flex justify-between"><span className="text-slate-400">HSA</span><span className="text-emerald-400">${num(w.balanceHSA).toLocaleString()}{num(w.contribHSA)>0?` + $${num(w.contribHSA).toLocaleString()}/yr`:''}</span></div>}
                  {!(w.has401k||w.hasRoth401k||w.hasRothIRA||w.hasTraditionalIRA||w.hasBrokerage||w.hasHSA)&&<p className="text-slate-500 italic">Sample defaults will be used</p>}
                </>)}
              </div></div>
            </div>);})()}
          </div>

          <div style={{padding:'1rem 1.5rem',borderTop:'1px solid rgba(51,65,85,0.5)',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>{step>0&&<button onClick={()=>setStep(step-1)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">← Back</button>}</div>
            <div className="flex gap-3">
              {step>0&&step<totalSteps-1&&<button onClick={()=>setStep(step+1)} disabled={!canContinue(step)} className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-colors ${canContinue(step)?'bg-amber-600 hover:bg-amber-500 text-white':'bg-slate-700 text-slate-500 cursor-not-allowed'}`}>Continue →</button>}
              {step===totalSteps-1&&<button onClick={finishWizard} className="px-6 py-2.5 text-sm bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors">✓ Launch My Plan</button>}
            </div>
          </div>
          {/* Full app editors reused inside the wizard's edit-existing path. */}
          {showWizAccountModal && (
            <AccountModal
              editingAccount={editingWizAccount}
              personalInfo={(existingData && existingData.personalInfo) || DEFAULT_PERSONAL_INFO}
              incomeStreams={(existingData && existingData.incomeStreams) || []}
              onClose={()=>{setShowWizAccountModal(false);setEditingWizAccount(null);}}
              onSave={(data)=>{
                setWizAccounts(prev => editingWizAccount
                  ? prev.map(a => a.id===editingWizAccount.id ? { ...data, id: editingWizAccount.id } : a)
                  : [...prev, { ...data, id: Math.max(0,...prev.map(a=>a.id||0))+1 }]);
                setShowWizAccountModal(false); setEditingWizAccount(null);
              }} />
          )}
          {showWizAssetModal && (
            <AssetModal
              editingAsset={editingWizAsset}
              onClose={()=>{setShowWizAssetModal(false);setEditingWizAsset(null);}}
              onSave={(data)=>{
                setWizAssets(prev => editingWizAsset
                  ? prev.map(a => a.id===editingWizAsset.id ? { ...data, id: editingWizAsset.id } : a)
                  : [...prev, { ...data, id: Math.max(0,...prev.map(a=>a.id||0))+1 }]);
                setShowWizAssetModal(false); setEditingWizAsset(null);
              }} />
          )}
          {showWizIncomeModal && (
            <IncomeModal
              editingIncome={editingWizIncome}
              personalInfo={(existingData && existingData.personalInfo) || DEFAULT_PERSONAL_INFO}
              onClose={()=>{setShowWizIncomeModal(false);setEditingWizIncome(null);}}
              onSave={(data)=>{
                setWizIncomes(prev => editingWizIncome
                  ? prev.map(i => i.id===editingWizIncome.id ? { ...data, id: editingWizIncome.id } : i)
                  : [...prev, { ...data, id: Math.max(0,...prev.map(i=>i.id||0))+1 }]);
                setShowWizIncomeModal(false); setEditingWizIncome(null);
              }} />
          )}
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
              <p className="text-xs text-slate-500 mt-1">v{typeof window !== 'undefined' && window.APP_VERSION ? window.APP_VERSION : 'dev'}</p>
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
              onClick={() => setShowReport(true)}
              className="w-full flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-all"
            >
              <span className="text-base">📄</span>
              {!sidebarCollapsed && <span className="text-sm font-medium">Reports</span>}
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
            {activeTab === 'dashboard' && <DashboardTab accounts={accounts} assets={assets} computeProjections={computeProjections} dashboardVisibility={dashboardVisibility} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} projections={projections} recurringExpenses={recurringExpenses} setDashboardVisibility={setDashboardVisibility} setShowDashboardSettings={setShowDashboardSettings} showDashboardSettings={showDashboardSettings} />}
            {activeTab === 'personal' && <PersonalInfoTab accounts={accounts} dataWarnings={dataWarnings} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} recurringExpenses={recurringExpenses} setDataWarnings={setDataWarnings} setOneTimeEvents={setOneTimeEvents} setPersonalInfo={setPersonalInfo} setRecurringExpenses={setRecurringExpenses} />}
            {activeTab === 'accounts' && <AccountsTab accountTypes={ACCOUNT_TYPES} accounts={accounts} contributorTypes={CONTRIBUTOR_TYPES} personalInfo={personalInfo} projections={projections} setAccounts={setAccounts} setEditingAccount={setEditingAccount} setShowAccountModal={setShowAccountModal} />}
            {activeTab === 'assets' && <AssetsTab assetTypes={ASSET_TYPES} assets={assets} setAssets={setAssets} setEditingAsset={setEditingAsset} setShowAssetModal={setShowAssetModal} />}
            {activeTab === 'income' && <IncomeStreamsTab incomeStreams={incomeStreams} incomeTypes={INCOME_TYPES} personalInfo={personalInfo} projections={projections} setEditingIncome={setEditingIncome} setIncomeStreams={setIncomeStreams} setShowIncomeModal={setShowIncomeModal} />}
            {activeTab === 'socialsecurity' && <SocialSecurityTab accounts={accounts} assets={assets} computeProjections={computeProjections} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} recurringExpenses={recurringExpenses} setIncomeStreams={setIncomeStreams} />}
            {activeTab === 'scenarios' && <ScenarioComparisonTab activeScenarioId={activeScenarioId} assets={assets} computeProjections={computeProjections} createScenario={createScenario} deleteScenario={deleteScenario} loadScenario={loadScenario} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} projections={projections} recurringExpenses={recurringExpenses} scenarios={scenarios} />}
            {activeTab === 'taxplanning' && <TaxPlanningTab accounts={accounts} assets={assets} computeProjections={computeProjections} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} projections={projections} recurringExpenses={recurringExpenses} setPersonalInfo={setPersonalInfo} />}
            {activeTab === 'withdrawal' && <WithdrawalStrategiesTab accounts={accounts} incomeStreams={incomeStreams} personalInfo={personalInfo} projections={projections} />}
            {activeTab === 'montecarlo' && <MonteCarloTab accounts={accounts} assets={assets} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} projections={projections} recurringExpenses={recurringExpenses} />}
            {activeTab === 'stresstest' && <StressTestTab accounts={accounts} currentYear={currentYear} incomeStreams={incomeStreams} personalInfo={personalInfo} projections={projections} recurringExpenses={recurringExpenses} />}
            {activeTab === 'sensitivity' && <SensitivityTab accounts={accounts} assets={assets} computeProjections={computeProjections} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} projections={projections} recurringExpenses={recurringExpenses} />}
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
      
      {/* Modals — hoisted to module scope; pass all needed state and handlers as props */}
      {showAccountModal && (
        <AccountModal
          editingAccount={editingAccount}
          personalInfo={personalInfo}
          incomeStreams={incomeStreams}
          onClose={() => { setShowAccountModal(false); setEditingAccount(null); }}
          onSave={handleSaveAccount}
        />
      )}
      {showIncomeModal && (
        <IncomeModal
          editingIncome={editingIncome}
          personalInfo={personalInfo}
          onClose={() => { setShowIncomeModal(false); setEditingIncome(null); }}
          onSave={handleSaveIncome}
        />
      )}
      {showAssetModal && (
        <AssetModal
          editingAsset={editingAsset}
          onClose={() => { setShowAssetModal(false); setEditingAsset(null); }}
          onSave={handleSaveAsset}
        />
      )}
      {showImportExport && (
        <ImportExportModal
          showResetConfirm={showResetConfirm}
          setShowResetConfirm={setShowResetConfirm}
          onClose={() => setShowImportExport(false)}
          handleExport={handleExport}
          handleImport={handleImport}
          handleReset={handleReset}
        />
      )}
      {showReport && (
        <NextYearReport
          projections={projections}
          personalInfo={personalInfo}
          accounts={accounts}
          incomeStreams={incomeStreams}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}

