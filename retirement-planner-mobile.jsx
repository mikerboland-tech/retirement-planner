// ── shared calc engine (loaded via <script src="engine.js"> in mobile.html) ──
const PlannerEngine = (typeof window !== 'undefined' && window.PlannerEngine) || {};
const {
  MAX_AGE, BROKERAGE_COST_BASIS_ESTIMATE, MAX_ITERATIONS_FOR_TAX_CALC, MONTE_CARLO_TAX_ESTIMATE, SAVE_DEBOUNCE_MS, PRE_TAX_TYPES, ROTH_TYPES, BROKERAGE_TYPES, HSA_TYPES, isPreTaxAccount, isRothAccount, isBrokerageAccount, isHSAAccount, FEDERAL_TAX_BRACKETS_2026, STANDARD_DEDUCTION_2026, STATE_TAX_RATES, STATES_EXEMPT_RETIREMENT_INCOME, STATES_EXEMPT_ALL_RETIREMENT_DISTRIBUTIONS, STATES_THAT_TAX_SS, ALABAMA_TAX_BRACKETS, ALABAMA_PERSONAL_EXEMPTION, ALABAMA_OVER_65_RETIREMENT_EXCLUSION, getAlabamaStandardDeduction, calculateAlabamaTax, FICA_SS_RATE, FICA_SS_WAGE_BASE_2025, FICA_MEDICARE_RATE, FICA_ADDITIONAL_MEDICARE_RATE, FICA_ADDITIONAL_MEDICARE_THRESHOLD, calculateFICA, RMD_FACTORS, IRMAA_THRESHOLDS_2025, SS_FULL_RETIREMENT_AGE, ACA_FPL_2025, QCD_ANNUAL_LIMIT, QCD_START_AGE, SS_EARNINGS_TEST_LIMIT_2025, SS_EARNINGS_TEST_FRA_LIMIT_2025, MEDICARE_PART_B_STANDARD_2025, calculateIRMAA, calculateIRMAASurcharge, calculateSSEarningsTestReduction, calculateSSBenefit, getRmdStartAge, getDefaultRothConversionWindow, calculateACASubsidy, calculateHealthcareExpenses, calculateRecurringExpenses, MEDICARE_PART_B_PREMIUM_2025, MEDICARE_PART_D_PREMIUM_2025, MEDICARE_SUPPLEMENT_PREMIUM_2025, MEDICARE_OOP_ANNUAL_2025, PRE_65_HEALTHCARE_ANNUAL_2025, MEDICAL_INFLATION_RATE, LTC_MONTHLY_ASSISTED_LIVING_2025, LTC_DEFAULT_DURATION_MONTHS, calculateFederalTax, calculateStateTax, calculateRMD, calculateSocialSecurityTaxableAmount, CAPITAL_GAINS_THRESHOLDS_2025, calculateCapitalGainsTax, calculateNIIT, computeProjections
} = PlannerEngine;

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

// ── LOCAL PERSISTENCE ───────────────────────────────────────────────────────
// The mobile app auto-saves your inputs to localStorage and restores them on the next visit,
// so you don't have to re-enter parameters every time. Stored under a mobile-specific key
// (separate from the desktop planner's data). Best-effort: silently no-ops if storage is
// unavailable (e.g. Safari Private Mode) or the data can't be parsed.
const MOBILE_STORAGE_KEY = 'retirementWhatIf_mobile_v1';

// Schema version for the persisted mobile state. Bump and add a migration
// entry whenever the saved shape changes incompatibly.
const MOBILE_SCHEMA_VERSION = 1;
const mobileMigrations = {
  // Example: 2: (data) => ({ ...data, newField: defaultValue }),
};

const isQuotaError = (e) => !!e && (
  e.name === 'QuotaExceededError' ||
  e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
  e.code === 22 || e.code === 1014
);

const loadMobileState = () => {
  try {
    const raw = localStorage.getItem(MOBILE_STORAGE_KEY);
    if (!raw) return {};
    let data = JSON.parse(raw);
    let version = (data && typeof data.schemaVersion === 'number') ? data.schemaVersion : 0;
    while (version < MOBILE_SCHEMA_VERSION) {
      const next = version + 1;
      const migrate = mobileMigrations[next];
      if (!migrate) break;
      data = migrate(data);
      version = next;
    }
    if (data && typeof data === 'object') data.schemaVersion = MOBILE_SCHEMA_VERSION;
    return data || {};
  } catch (e) {
    return {};
  }
};

// Returns {ok, quota} so callers can surface failures (e.g. quota exhaustion)
// instead of silently losing writes.
const saveMobileState = (state) => {
  try {
    const payload = (state && typeof state === 'object') ? { ...state, schemaVersion: MOBILE_SCHEMA_VERSION } : state;
    localStorage.setItem(MOBILE_STORAGE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (e) {
    return { ok: false, quota: isQuotaError(e) };
  }
};



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
  // Restore saved inputs once (synchronous localStorage read) and use each as the initial
  // value, falling back to the default when a field isn't present in saved data.
  const saved = useMemo(() => loadMobileState(), []);
  const [currentAge, setCurrentAge] = useState(saved.currentAge ?? 45);
  const [retirementAge, setRetirementAge] = useState(saved.retirementAge ?? 65);
  const [legacyAge, setLegacyAge] = useState(saved.legacyAge ?? 90);
  const [portfolio, setPortfolio] = useState(saved.portfolio ?? 250000);
  const [annualContribution, setAnnualContribution] = useState(saved.annualContribution ?? 20000);
  // Percent-of-salary contribution mode. Missing in saved → 'fixed' for backwards-compat.
  // In 'percent' mode, the engine reads myEarnedIncome from the salary stream we inject below
  // and computes contribution = salary × (contributionPercent / 100) each year, so the
  // contribution automatically tracks salary COLA instead of silently shrinking in real terms.
  const [contributionMode, setContributionMode] = useState(saved.contributionMode ?? 'fixed');
  const [currentSalary, setCurrentSalary] = useState(saved.currentSalary ?? 80000);
  const [contributionPercent, setContributionPercent] = useState(saved.contributionPercent ?? 10);
  const [desiredSpending, setDesiredSpending] = useState(saved.desiredSpending ?? 60000);
  const [cagr, setCagr] = useState(saved.cagr ?? 7);
  const [inflationRate, setInflationRate] = useState(saved.inflationRate ?? 3);
  
  // Three income streams: Social Security, Pension, Other.
  // Each has: enabled flag (so user can zero one out cleanly), amount, start age, and inflation toggle.
  // - SS uses PIA (monthly benefit at FRA) since that's what ssa.gov gives you.
  // - Pension and Other use direct annual amounts.
  // - Defaults reflect typical real-world behavior:
  //     SS: COLA on (Social Security has annual COLA)
  //     Pension: COLA off (most private pensions are not inflation-adjusted)
  //     Other: COLA on (rentals, royalties, part-time work roughly track inflation)
  const [ssEnabled, setSsEnabled] = useState(saved.ssEnabled ?? true);
  const [ssMonthly, setSsMonthly] = useState(saved.ssMonthly ?? 2500);
  const [ssClaimAge, setSsClaimAge] = useState(saved.ssClaimAge ?? 67);
  const [ssCola, setSsCola] = useState(saved.ssCola ?? true);
  
  const [pensionEnabled, setPensionEnabled] = useState(saved.pensionEnabled ?? false);
  const [pensionAnnual, setPensionAnnual] = useState(saved.pensionAnnual ?? 0);
  const [pensionStartAge, setPensionStartAge] = useState(saved.pensionStartAge ?? 65);
  const [pensionCola, setPensionCola] = useState(saved.pensionCola ?? false);
  
  const [otherEnabled, setOtherEnabled] = useState(saved.otherEnabled ?? false);
  const [otherAnnual, setOtherAnnual] = useState(saved.otherAnnual ?? 0);
  const [otherStartAge, setOtherStartAge] = useState(saved.otherStartAge ?? 65);
  const [otherEndAge, setOtherEndAge] = useState(saved.otherEndAge ?? 90);
  const [otherCola, setOtherCola] = useState(saved.otherCola ?? true);
  
  const [showDetails, setShowDetails] = useState(false);

  // Auto-save all inputs to localStorage (debounced) whenever any of them change, so the app
  // remembers your parameters between visits. showDetails is a view toggle, not a parameter,
  // so it's intentionally excluded.
  useEffect(() => {
    const t = setTimeout(() => saveMobileState({
      currentAge, retirementAge, legacyAge, portfolio, annualContribution, desiredSpending,
      contributionMode, currentSalary, contributionPercent,
      cagr, inflationRate, ssEnabled, ssMonthly, ssClaimAge, ssCola,
      pensionEnabled, pensionAnnual, pensionStartAge, pensionCola,
      otherEnabled, otherAnnual, otherStartAge, otherEndAge, otherCola,
    }), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [currentAge, retirementAge, legacyAge, portfolio, annualContribution, desiredSpending,
      contributionMode, currentSalary, contributionPercent,
      cagr, inflationRate, ssEnabled, ssMonthly, ssClaimAge, ssCola,
      pensionEnabled, pensionAnnual, pensionStartAge, pensionCola,
      otherEnabled, otherAnnual, otherStartAge, otherEndAge, otherCola]);
  
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
      state: 'Alabama', // Engine keys on full state names; 'CA' silently fell through to 0% tax
      currentExpenses: desiredSpending,
      desiredRetirementIncome: desiredSpending,
      inflationRate: inflationRate / 100,
      survivorModelEnabled: false,
      survivorSpendingFactor: 0.75,
      rothConversionAmount: 0,
      rothConversionBracket: '',
      rothConversionStartAge: 0,
      rothConversionEndAge: 0,
      charitableGivingPercent: 0,
      healthcareModel: 'none', // Engine reads pi.healthcareModel (enum). The old healthcareModelEnabled key was ignored, so healthcare costs were billed by default on mobile (B11).
    };
    // In percent mode the engine reads owner salary from the earned_income stream we inject
    // below and computes contribution = salary × employeePercent each year (with salary COLA).
    // In fixed mode we pass the $ amount and let it stay flat in nominal $.
    const isPercent = contributionMode === 'percent';
    const accounts = [isPercent ? {
      id: 1,
      name: 'Portfolio',
      type: '401k',
      balance: portfolio,
      contributionMode: 'percent',
      employeePercent: contributionPercent / 100,
      employerMatchPercent: 0,
      cagr: cagr / 100,
      startAge: currentAge,
      stopAge: retirementAge,
      owner: 'me',
    } : {
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

    // In percent mode the engine needs an earned_income stream to read myEarnedIncome from.
    // Salary grows at the user's inflation rate (close enough to typical wage COLA for this
    // mobile what-if). endAge = retirementAge - 1 so the stream ends the year before retirement,
    // matching the account's stopAge (which is exclusive in the engine's contribution loop).
    if (isPercent && currentSalary > 0) {
      streams.push({
        id: 9,
        type: 'earned_income',
        owner: 'me',
        amount: currentSalary,
        cola: inflationFraction,
        startAge: currentAge,
        endAge: Math.max(currentAge, retirementAge - 1),
      });
    }

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
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-lg font-bold text-slate-100">Retirement What-If</h1>
          <span className="text-[10px] text-slate-600 tabular-nums">v{typeof window !== 'undefined' && window.APP_VERSION ? window.APP_VERSION : 'dev'}</span>
        </div>
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

        {/* Contribution mode: $ fixed vs % of salary. Percent mode tracks salary COLA so a young
            saver's contribution doesn't silently shrink in real terms over a 40-year horizon. */}
        <div className="py-2">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-sm text-slate-300 font-medium">Contribution mode</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setContributionMode('fixed')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${contributionMode !== 'percent' ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/60' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'}`}
            >$ Fixed</button>
            <button
              type="button"
              onClick={() => setContributionMode('percent')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${contributionMode === 'percent' ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/60' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'}`}
            >% of salary</button>
          </div>
        </div>

        {contributionMode === 'percent' ? (
          <>
            <MoneyInput label="Current annual salary" value={currentSalary} onChange={setCurrentSalary} hint="Gross annual pay. Used to compute your $ contribution each year." />
            <SliderRow
              label="Contribution % (you + employer)"
              value={contributionPercent}
              onChange={setContributionPercent}
              min={0}
              max={25}
              step={0.5}
              format={(v) => `${v}%`}
            />
            <p className="text-[11px] text-emerald-400/80 -mt-1 mb-2 px-1 tabular-nums">
              Year 1: ${Math.round(currentSalary * contributionPercent / 100).toLocaleString()}/yr
              {' → '}
              Year {Math.max(1, retirementAge - currentAge)}: ${Math.round(currentSalary * Math.pow(1 + inflationRate / 100, Math.max(0, retirementAge - currentAge - 1)) * contributionPercent / 100).toLocaleString()}/yr
            </p>
          </>
        ) : (
          <MoneyInput label="Annual contributions" value={annualContribution} onChange={setAnnualContribution} hint="What you save each year (yours + employer match)" />
        )}

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
            <div className="flex justify-between"><span className="text-slate-400">Total contributions</span><span className="text-slate-200 tabular-nums">{fmtFull(
              contributionMode === 'percent'
                ? projections.filter(p => p.myAge < retirementAge).reduce((s, p) => s + ((p.perAccountContributions && p.perAccountContributions[1]) || 0), 0)
                : annualContribution * yearsToRetirement
            )}</span></div>
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
        {/* Escape hatch back to desktop. The ?desktop=1 query param tells index.html
            to skip its mobile redirect, so the user lands on the full desktop app
            even when on a phone. */}
        <p className="text-center mt-3 mb-2">
          <a
            href="index.html?desktop=1"
            className="text-xs text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-300"
          >
            Switch to full desktop version →
          </a>
        </p>
      </section>
    </div>
  );
}

