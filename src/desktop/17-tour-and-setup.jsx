// ============================================
// GUIDED TOUR — post-setup orientation
//
// The SetupWizard gets the user's DATA in. This gets the user oriented in the
// app that data lands in: 13 tabs of analysis with no explanation of which one
// answers which question. Runs once automatically after setup, then stays
// available from the sidebar.
//
// Deliberately shell-only: every step points at the sidebar or a utility
// button, never at content inside a tab. That keeps the tour from breaking
// whenever a tab's internals get rearranged, and means it never has to switch
// tabs — so no projection recompute is triggered mid-tour.
//
// Seen-state lives under its OWN localStorage key rather than in the plan blob,
// so it can't collide with SCHEMA_VERSION migrations, isn't carried between
// machines by an import/export, and isn't reset by "Clear My Data" — having
// taken the tour is a property of this browser, not of the plan.
// ============================================
const TOUR_STORAGE_KEY = 'retirement_planner_tour_v1';

function hasSeenTour() {
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY) === 'seen';
  } catch (e) {
    // Private mode / blocked storage. Report "seen" so we don't re-offer the
    // tour on every single load in a browser that can never remember the answer.
    return true;
  }
}

function markTourSeen() {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, 'seen');
  } catch (e) {
    // Non-fatal — the tour simply offers itself again next visit.
  }
}

// Each step highlights one [data-tour] element in the shell. `target: null`
// renders a centered card with the screen dimmed instead.
// ── WHAT SIMPLE MODE KEEPS ─────────────────────────────────────────────────
// Module scope, not inside RetirementPlanner: the tour below needs them too, and
// inside the component they were rebuilt on every render roughly 480 lines
// below an effect that read them — a temporal-dead-zone crash waiting for the
// first edit that moved that read into render code.
//
// Chosen by what a plan cannot be made without, not by what is cheap to cut.
//   Dashboard    where the plan stands, with the what-if levers on it — the
//                question most people actually arrive with (the separate
//                "What if" screen merged into it in v2.47.0)
//   About you    ages, filing, spending target, healthcare, long-term care
//   Accounts     balances and contributions
//   Property     the house and anything else that is not a portfolio
//   Income       Social Security and pensions
//   Taxes & Roth the conversion strategy and what it does, without the optimiser
//   Claiming     when to take Social Security — a top-two decision, kept
//   Will it last Monte Carlo — "it works on average" is not a plan
//
// Cut: Current Year (a paystub and K-1 ledger), Stress Test (Monte Carlo covers the same ground
// for this reader), Sensitivity (an analyst's tornado chart), AI Assistant
// (wants an API key), Assumptions (reference tables for checking the engine's
// arithmetic), Plan history. Nothing is deleted — every one of them is one
// click away in the full app, working on the same plan.
const SIMPLE_TABS = ['dashboard', 'personal', 'accounts', 'assets',
                     'income', 'taxplanning', 'socialsecurity', 'montecarlo'];
// Plainer names for the same tabs. "Monte Carlo" names a technique; "Will it
// last?" names the question the reader came with.
const SIMPLE_LABELS = {
  personal: 'About you', assets: 'Property',
  income: 'Income',
  socialsecurity: 'Claiming',
};

// ── THE TOUR ────────────────────────────────────────────────────────────────
// Two tours, one per mode, built from shared steps. A single tour described the
// full app's four nav groups and six analysis tabs to simple-mode readers —
// who start there by default — so four steps lost their spotlight and the rest
// named tabs the reader could not see, under names that no longer matched.
const TOUR_WELCOME = {
  target: null,
  title: 'Welcome to your plan',
  // Worded for someone who may be taking this at any time, not only straight
  // out of the wizard — the tour is offered now rather than auto-launched.
  body: "This quick tour explains what each part of the app answers — about a minute. Leave whenever you like; you can restart it from the sidebar.",
};
const TOUR_SHARED_TAIL = [
  {
    target: 'tour-guided-setup',
    title: 'Guided Setup, anytime',
    body: "The setup wizard lives here for good. Re-run it to walk your whole plan again — it loads your current numbers, so it's a fast way to review everything without hunting tab to tab. It also explains why each figure matters, and can fill in anything you don't have to hand from typical numbers for your age and income.",
  },
  {
    target: 'tour-reports',
    title: 'Reports',
    // It said "two printable summaries" long after there were seven.
    body: "Printable reports, each answering one question: a full plan summary, your next 12 months, a Roth conversion roadmap, what breaks first, your saved scenarios side by side, the claiming decision, and the survivor's tax bill. All print to PDF from your browser.",
  },
  {
    target: 'tour-import-export',
    title: 'Your data stays on this device',
    body: "Nothing is uploaded anywhere — the whole plan lives in this browser's local storage. That also means clearing site data erases it. Export a backup file here, especially before switching browsers or machines.",
  },
];

const TOUR_STEPS = [
  TOUR_WELCOME,
  {
    target: 'nav-overview',
    title: 'Dashboard — start here',
    body: "The Dashboard is your plan at a glance. The top line says whether it is on track — at average returns and across simulated markets — and lists the next steps worth taking. Below it: portfolio balance year by year, whether the money lasts, and the point where it gets tight. After you change any input, this is where you check what it did. Open “What if…” at the top to move retirement age, spending, claiming or conversion strategy and watch the whole page re-run — your saved plan is untouched until you choose otherwise. “Panels” picks what the page shows.",
  },
  {
    target: 'nav-plan-setup',
    title: 'Plan Setup — the inputs',
    body: "Everything the projection is built from. Change a number here and every chart in the app updates from it.",
    bullets: [
      ['Personal Info', 'ages, retirement dates, spending, recurring expenses'],
      ['Accounts', 'balances, contributions, employer match, growth rates'],
      ['Assets', 'home equity and other property'],
      ['Income Streams', 'salary, Social Security, pensions, rental income'],
    ],
  },
  {
    target: 'nav-analysis',
    title: 'Analysis — four different questions',
    body: "Each one answers something distinct:",
    bullets: [
      ['Current Year', 'what will this year’s return look like, from your paystubs and K-1s?'],
      ['Social Security', 'what claiming age is worth most to you?'],
      ['Taxes & Roth', 'your Roth conversion strategy — set it, see what it saves, find a better one'],
      ['Will it last?', 'three ways to ask it: 1,000 markets, specific crashes right at retirement, and which single assumption changes the outcome most'],
    ],
  },
  {
    target: 'nav-tools',
    title: 'Tools — ask and verify',
    // It described a Scenarios tab that has not existed since saved scenarios
    // moved into the Sandbox.
    body: "The AI Assistant answers questions about your plan in plain language, using your own numbers (it needs an Anthropic API key, kept in this browser only). Assumptions lists every bracket, limit and rate the engine uses, so you can check the math rather than trust it — worth a look for what it applies on your behalf: the 10% penalty on pre-tax withdrawals before 59½, the extra deductions that start at 65, and the tax on dividends a taxable account throws off each year. Saved scenarios live on the Dashboard, under “What if…”.",
  },
  {
    target: 'tour-mode-switch',
    title: 'Too much? Simplify',
    body: "This switch trims the app to the eight screens a plan is built from and hides the diagnostics. It hides screens, never settings — your plan and every number in it stay exactly the same, and one click brings everything back.",
  },
  ...TOUR_SHARED_TAIL,
  {
    target: null,
    title: "That's the tour",
    body: "If a number ever looks wrong, the Assumptions tab shows exactly what the engine used to produce it. Start on the Dashboard and change one input to see how it flows through.",
  },
];

const SIMPLE_TOUR_STEPS = [
  TOUR_WELCOME,
  {
    target: 'nav-simple',
    title: 'Eight screens, in the order you build a plan',
    body: "Start at the top and work down. Change a number on any screen and every other one updates from it.",
    bullets: [
      ['Dashboard', 'does the money last? — and “What if…” tries a change without touching your plan'],
      [SIMPLE_LABELS.personal, 'ages, spending, healthcare and long-term care'],
      ['Accounts · ' + SIMPLE_LABELS.assets + ' · ' + SIMPLE_LABELS.income, 'what you have and what comes in'],
      ['Taxes & Roth', 'should you convert to Roth, and how much?'],
      [SIMPLE_LABELS.socialsecurity, 'when to start Social Security'],
      ['Will it last?', 'does the plan survive bad markets, not just average ones?'],
    ],
  },
  {
    target: 'tour-mode-switch',
    title: 'This is the simple view',
    body: "It hides the diagnostic and specialist screens — nothing about your plan changes, and every setting still counts even where its control is tucked away. If one of those hidden settings is switched on, the screen it belongs to says so. Show everything brings the full planner back.",
  },
  ...TOUR_SHARED_TAIL,
  {
    target: null,
    title: "That's the tour",
    body: "Start on the Dashboard, then open “What if…” and move one slider to see how the plan responds.",
  },
];

// Spotlight ring thickness around the highlighted element, tooltip width, and
// the gap between the two / the viewport edge.
const SPOT_PAD = 8;
const CARD_W = 380;
const GAP = 16;

function GuidedTour({ onFinish, steps = TOUR_STEPS }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  const finish = useCallback(() => {
    markTourSeen();
    onFinish();
  }, [onFinish]);

  // Bring the target into view before it's measured. The sidebar is as tall as
  // the whole page (its nav never scrolls independently), so on a short viewport
  // the utility buttons at the bottom start below the fold — without this they'd
  // be spotlit off-screen and the step would look like it highlighted nothing.
  //
  // Only scroll when the target isn't already comfortably visible, so steps near
  // the top of the sidebar don't yank the page for no reason. The margin leaves
  // room for the spotlight ring drawn around the element — aligning the element
  // itself flush to the edge would push the ring off-screen. The scroll listener
  // below re-measures as this animates, so the spotlight tracks it on the way in.
  useEffect(() => {
    if (!step.target) return;
    const el = document.querySelector('[data-tour="' + step.target + '"]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = SPOT_PAD + 8;
    if (r.top < margin || r.bottom > window.innerHeight - margin) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [stepIndex, step.target]);

  // Measure the highlighted element in viewport coordinates. Re-measured on
  // resize and on scroll in the capture phase, so the sidebar's own overflow-y
  // scrolling moves the spotlight too (it wouldn't bubble to window otherwise).
  useEffect(() => {
    const measure = () => {
      if (!step.target) { setRect(null); return; }
      const el = document.querySelector('[data-tour="' + step.target + '"]');
      // Missing target (e.g. collapsed sidebar) degrades to the centered card
      // rather than pointing at nothing.
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [stepIndex, step.target]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setStepIndex(i => Math.min(i + 1, steps.length - 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setStepIndex(i => Math.max(i - 1, 0)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  // The card's own height decides how far down it can sit, and it varies a lot
  // by step (the Analysis step's six bullets are roughly double the shortest
  // card). Measuring it beats assuming a fixed height — guessing too small
  // pushes the footer buttons off-screen on the tall steps.
  const cardRef = useRef(null);
  const [cardH, setCardH] = useState(0);
  React.useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [stepIndex]);

  // Card sits to the right of the spotlight (all targets are in the left
  // sidebar); flips to the left side if that would overflow, and falls back to
  // dead center when there's no target to point at.
  let cardPos;
  if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.left + rect.width + GAP;
    if (left + CARD_W > vw - GAP) left = Math.max(GAP, rect.left - CARD_W - GAP);
    // Prefer aligning with the highlighted element, but never let the card
    // hang below the fold. On the first paint of a step cardH is still the
    // previous step's height; the layout effect corrects it before the browser
    // paints, so there's no visible jump.
    const maxTop = Math.max(GAP, vh - cardH - GAP);
    cardPos = {
      position: 'fixed',
      left,
      top: Math.max(GAP, Math.min(rect.top, maxTop)),
      width: CARD_W,
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 32px)',
      overflowY: 'auto',
      zIndex: 61,
    };
  } else {
    cardPos = {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: CARD_W,
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 32px)',
      overflowY: 'auto',
      zIndex: 61,
    };
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* With a target, the dark layer is painted by the spotlight's own
          9999px box-shadow spread, which leaves a clean hole around the
          element. Without one, a plain dimmer covers the screen. */}
      {!rect && <div className="fixed inset-0 bg-black/75" style={{ zIndex: 60 }} />}
      {rect && (
        <div
          className="fixed rounded-lg pointer-events-none transition-all duration-200"
          style={{
            top: rect.top - SPOT_PAD,
            left: rect.left - SPOT_PAD,
            width: rect.width + SPOT_PAD * 2,
            height: rect.height + SPOT_PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.75)',
            border: '2px solid rgb(245 158 11)',
            zIndex: 60,
          }}
        />
      )}

      <div
        ref={cardRef}
        style={cardPos}
        className="bg-gradient-to-br from-slate-800 to-slate-900 border border-amber-500/40 rounded-xl p-5 shadow-2xl"
      >
        <div className="text-xs font-semibold text-amber-400 mb-1.5">
          STEP {stepIndex + 1} OF {steps.length}
        </div>
        <h3 className="text-lg font-bold text-slate-100 mb-2">{step.title}</h3>
        <p className="text-sm text-slate-300 leading-relaxed">{step.body}</p>

        {step.bullets && (
          <ul className="mt-3 space-y-1.5">
            {step.bullets.map(([label, text]) => (
              <li key={label} className="text-sm text-slate-400 leading-snug">
                <span className="text-slate-200 font-medium">{label}</span> — {text}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-700/50">
          <div className="flex gap-1.5">
            {steps.map((s, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === stepIndex ? 'bg-amber-400' : 'bg-slate-600'}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isLast && (
              <button onClick={finish} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-300 transition-colors">
                Skip
              </button>
            )}
            {stepIndex > 0 && (
              <button
                onClick={() => setStepIndex(i => i - 1)}
                className="px-3 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                ← Back
              </button>
            )}
            <button
              onClick={() => (isLast ? finish() : setStepIndex(i => i + 1))}
              className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg transition-colors"
            >
              {isLast ? '✓ Done' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// At module scope, NOT nested in RetirementPlanner: a component redefined on
// every parent render gets a new identity each time, so React unmounts and
// remounts it — which reset the wizard to step 0 whenever anything re-rendered
// the app while it was open. It captures nothing from the parent; everything
// it needs already arrives as props.
const cardBtn = (active) => `p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${active ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'}`;

// Keyboard-accessible selectable account card (Enter/Space toggles). At module
// scope for the same reason as the Sandbox controls: defined inside the wizard
// it was a fresh component type per render, so every keystroke anywhere in the
// step remounted these cards and a keyboard user lost focus the moment they
// pressed Space on one.
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

function SetupWizard({ onComplete, onExplore, existingData, hasSavedPlan }) {
  const [step, setStep] = useState(0);
  const yr = new Date().getFullYear();
  // Gated on hasSavedPlan so the sample defaults present on a fresh install
  // don't read as an existing plan; existingData is still what loadExisting()
  // pulls from once we know there IS one.
  const hasExisting = hasSavedPlan && existingData && existingData.personalInfo;

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
    // Field names this wizard filled from a published benchmark rather than from
    // the user's own knowledge. Drives the [ESTIMATE] tags, the preview-step
    // summary, and the review banner in the app after launch. A field drops off
    // this list the moment the user types over it.
    estimatedFields: [],
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
  // Live personalInfo for modals opened inside the wizard: overlay the ages the user
  // has already entered on earlier steps onto the saved/default plan, so a new
  // account defaults to THEIR ages instead of the stale saved (or 35/33 default) ages.
  const wizPersonalInfo = {
    ...((existingData && existingData.personalInfo) || DEFAULT_PERSONAL_INFO),
    ...(num(w.myAge) > 0 ? { myAge: num(w.myAge) } : {}),
    ...(num(w.spouseAge) > 0 ? { spouseAge: num(w.spouseAge) } : {}),
    ...(num(w.myRetirementAge) > 0 ? { myRetirementAge: num(w.myRetirementAge) } : {}),
    ...(num(w.spouseRetirementAge) > 0 ? { spouseRetirementAge: num(w.spouseRetirementAge) } : {}),
  };
  const householdIncome = mySalary + (w.hasSpouse ? spouseSalary : 0);
  const yearsToRetire = Math.max(0, num(w.myRetirementAge) - num(w.myAge));
  const salaryAtRetire = mySalary * Math.pow(1 + num(w.mySalaryGrowth) / 100, yearsToRetire);
  const suggestedSpending = Math.round(householdIncome * 0.75 / 1000) * 1000;

  // Monthly figure derived from the engine's cited annual replacement-rate
  // estimate, so the wizard and the engine can't drift on what "typical" means.
  const estimateSSMonthly = (salary) => Math.round(estimateAnnualSocialSecurity(salary) / 12 / 50) * 50;

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
      // loadExisting() replaces the whole wizard state object, so every field the
      // initial state declares has to be re-declared here or it becomes undefined.
      // Re-entering the wizard on an existing plan carries forward whatever was
      // still an estimate, so the flags survive a review pass instead of being
      // silently dropped (which would have hidden the review banner for good).
      estimatedFields: (pi.estimatedFields || []).slice(),
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
      withdrawalPriority: basePI.withdrawalPriority || ['pretax','brokerage','roth'],
      // Fields the Guided Setup filled from a benchmark. Persisted so the review
      // banner survives a reload and travels with an export; cleared as the user
      // replaces each one. An empty array means every number is the user's own.
      estimatedFields: (w.estimatedFields||[]).slice() };
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
      if (my401Pct) { accts.push({id:aid++,name:'My '+planLabel[my401Type],type:my401Type,balance:num(w.balance401k),contribution:0,contributionMode:'percent',employeePercent:num(w.contrib401kPercent)/100,employerMatchPercent:myMatchFolded?num(w.match401kPercent)/100:0,contributionGrowth:0,cagr:0.07,startAge:myAge,stopAge:retAge,owner:'me',contributor:'me'}); }
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
      if (sp401Pct) { accts.push({id:aid++,name:'Spouse '+planLabel[sp401Type],type:sp401Type,balance:num(w.spouseBalance401k),contribution:0,contributionMode:'percent',employeePercent:num(w.spouseContrib401kPercent)/100,employerMatchPercent:spMatchFolded?num(w.spouseMatch401kPercent)/100:0,contributionGrowth:0,cagr:0.07,startAge:spouseAge,stopAge:spRetAge,owner:'spouse',contributor:'me'}); }
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
    // todaysDollars: the wizard asks for the monthly figure off an SSA statement,
    // which SSA states in today's dollars, and estimateSSMonthly derives from
    // today's salary. Without the flag the engine read it as the nominal benefit
    // in the claim year, so every wizard-built plan understated Social Security
    // by the whole inflation factor between now and claiming — 61% for someone
    // aged 35 claiming at 67.
    // COLA matches the plan's inflation rate rather than a flat 2%: Social
    // Security tracks CPI, and 2% against 3% inflation quietly shaves a quarter
    // off its real value by 95 (the same reasoning already written above
    // DEFAULT_INCOME_STREAMS, which the wizard was contradicting).
    const ssCola = newPI.inflationRate || 0.03;
    if (w.expectSS) { const mo=num(w.ssMonthly)||estimateSSMonthly(mySalary); const age=num(w.ssClaimAge)||67; const adj=calculateSSBenefit(mo,age,yr-myAge); incs.push({id:iid++,name:'My Social Security',type:'social_security',amount:adj*12,startAge:age,endAge:95,cola:ssCola,owner:'me',pia:mo,todaysDollars:true}); }
    if (w.hasSpouse&&w.spouseExpectSS) { const mo=num(w.spouseSSMonthly)||estimateSSMonthly(spouseSalary); const age=num(w.spouseSSClaimAge)||67; const adj=calculateSSBenefit(mo,age,yr-spouseAge); incs.push({id:iid++,name:'Spouse Social Security',type:'social_security',amount:adj*12,startAge:age,endAge:95,cola:ssCola,owner:'spouse',pia:mo,todaysDollars:true}); }
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
      // The withdrawal rate has to compare like with like. `proj` is a FUTURE
      // balance while `spending` and `guaranteed` are in today's dollars, so
      // dividing one by the other understated the rate by the whole inflation
      // factor — a plan drawing 6% showed as 1.6%, which made the preview look
      // safe for someone who is not. Inflate the gap to the retirement year.
      const inflToRet = Math.pow(1.03, years);
      const gapAtRet = gap * inflToRet;
      const wr = proj>0 ? gapAtRet/proj*100 : 0;
      return { proj, spending, guaranteed, gap, gapAtRet, wr, totalSaved, totalContrib };
    } catch(e) { return null; }
  };

  const inputStyle = "w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-all";
  const dollarInput = (value, onChange, placeholder) => (<div className="relative"><span className="absolute left-3 top-2.5 text-slate-500">$</span><input type="text" inputMode="numeric" value={num(value)>0?num(value).toLocaleString():''} onChange={e=>onChange(e.target.value.replace(/[^0-9]/g,''))} placeholder={placeholder} className={`${inputStyle} pl-7`} /></div>);

  // ── "WHY WE ASK" ──────────────────────────────────────────────────────────
  // One line per step explaining what the projection does with the answer.
  // People abandon a form when it feels like an interrogation; knowing WHY a
  // field matters is what turns it back into a conversation. `more` holds the
  // detail for anyone who wants it, behind a disclosure so it never adds noise.
  const whyBox = (why, more) => (
    <details className="group bg-sky-500/5 border border-sky-500/20 rounded-lg">
      <summary className="flex items-start gap-2 p-3 cursor-pointer list-none">
        <span className="text-sky-400 text-sm mt-px shrink-0">💡</span>
        <span className="text-xs text-sky-200/90 leading-relaxed flex-1">{why}</span>
        {more && <span className="text-[10px] text-sky-400/70 shrink-0 mt-0.5 group-open:hidden">more</span>}
      </summary>
      {more && <div className="px-3 pb-3 pl-9 text-xs text-slate-400 leading-relaxed">{more}</div>}
    </details>
  );

  // ── ESTIMATE-THIS-FOR-ME ──────────────────────────────────────────────────
  // A user who knows they HAVE a 401(k) but not what's in it should not be
  // stuck. These buttons fill a published benchmark (see engine.js) and record
  // the field in `estimatedFields`, which drives the [estimate] tag here, the
  // summary on the preview step, and a review banner in the app afterwards.
  // Typing over a field clears its flag — the moment a real number arrives, it
  // stops being an estimate.
  // Typical annual amounts for an owner earning `salary`, rounded to $100.
  // Workplace deferral and employer match come from the engine's cited rates;
  // an IRA estimate is the same deferral rate but can't exceed the annual limit.
  const deferralEstimate = (salary) => Math.round(salary * TYPICAL_DEFERRAL_RATE / 100) * 100;
  const matchEstimate = (salary) => Math.round(salary * TYPICAL_MATCH_RATE / 100) * 100;
  const iraEstimate = (salary) => Math.min(deferralEstimate(salary), 7000);

  const isEstimated = (key) => (w.estimatedFields||[]).includes(key);
  // Write a value and mark it as ours.
  const applyEstimate = (field, value, key) => {
    setW(prev => ({
      ...prev,
      [field]: String(value),
      estimatedFields: (prev.estimatedFields||[]).includes(key || field)
        ? prev.estimatedFields : [...(prev.estimatedFields||[]), key || field],
    }));
  };
  // Wrap update() so any hand-edit drops the estimate flag for that field.
  const updateOwned = (field, value) => {
    setW(prev => ({
      ...prev,
      [field]: value,
      estimatedFields: (prev.estimatedFields||[]).filter(k => k !== field),
    }));
  };

  // Retirement-savings benchmark for this household, less whatever balances the
  // user has already filled in — so clicking "estimate" on a second account
  // splits the benchmark rather than double-counting it.
  const BALANCE_FIELDS = ['balance401k','balanceRoth401k','balanceRothIRA','balanceTraditionalIRA','balanceHSA',
    'spouseBalance401k','spouseBalanceRoth401k','spouseBalanceRothIRA'];
  const savingsBenchmark = estimateRetirementSavings(num(w.myAge), householdIncome);
  const balancesEnteredExcept = (field) => BALANCE_FIELDS
    .filter(f => f !== field)
    .reduce((s, f) => s + num(w[f]), 0);
  const remainingBenchmark = (field) =>
    Math.max(0, Math.round((savingsBenchmark - balancesEnteredExcept(field)) / 1000) * 1000);

  // The button + tag + rationale that sits under an estimable money field.
  // `amount` is what clicking will fill; null/0 hides the offer (we never
  // invent a number we can't justify — home value, for instance, has no
  // defensible benchmark and is made skippable instead).
  const estimateRow = (field, amount, rationale) => {
    if (isEstimated(field)) {
      return (
        <div className="flex items-start gap-2 mt-1.5">
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">ESTIMATE</span>
          <span className="text-xs text-slate-500 leading-relaxed">
            {rationale} Replace it with your real number whenever you have it — we'll remind you.
          </span>
        </div>
      );
    }
    if (!(amount > 0)) return null;
    return (
      <button type="button" onClick={() => applyEstimate(field, amount, field)}
        className="mt-1.5 text-xs text-sky-400 hover:text-sky-300 underline decoration-dotted transition-colors">
        Not sure? Estimate it (${amount.toLocaleString()})
      </button>
    );
  };

  // Employer-match input with a $ / % of-salary toggle. In % mode the match
  // becomes a percent-of-salary account (scales with the owner's salary COLA).
  // `estimate` (optional): dollar amount to offer under the $ field when the
  // user doesn't know it. Percent mode needs no offer — the hint already names
  // the typical range and a percent is easier to guess than a dollar figure.
  const matchInput = ({label, modeKey, dollarKey, pctKey, dollarPlaceholder, estimate=0, pctPlaceholder='4',
      pctHint='Most employers match 3–6% of salary; it grows with your pay.',
      dollarHint='Total dollar amount your employer contributes per year.',
      estimateRationale='A typical figure for your salary.', border='border-sky-500/30'}) => {
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
          : <>{dollarInput(w[dollarKey],v=>updateOwned(dollarKey,v),dollarPlaceholder)}{estimateRow(dollarKey,estimate,estimateRationale)}</>}
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

  // This year's IRS 401(k)/403(b) limits, from the engine (contributionLimitsFor).
  // 402(g) = employee elective deferral; 415(c) = combined employee + employer
  // "annual additions". Age-50 catch-up and the SECURE 2.0 ages-60–63 super
  // catch-up raise both ceilings: catch-ups sit ON TOP of the 415(c) limit
  // (they don't reduce it), so the combined personal cap is base + catch-up.
  const irs401kLimits = (age) => {
    const L = PlannerEngine.contributionLimitsFor();
    const a = num(age);
    const catchUp = PlannerEngine.workplaceCatchUp(a, L);
    const note = catchUp > 0 ? ` (includes the $${catchUp.toLocaleString()} age-${a >= 60 && a <= 63 ? '60–63 super' : '50'} catch-up)` : '';
    return { deferral: L.deferral + catchUp, additions: L.additions + catchUp, note };
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
          {/* ── STEP 0: WELCOME + PREFLIGHT ──────────────────────────────────
              A blank first question is where people bail. Showing the whole
              route up front — how many topics, roughly how long, and that
              nothing has to be exact or final — turns "how much of my life do
              I have to reconstruct?" into a known, finite task. */}
          {step===0 && (<div className="py-2 space-y-5">
            <div className="text-center space-y-3">
              <div className="text-5xl">📊</div>
              <h3 className="text-2xl font-bold text-slate-100">{hasExisting?'Update Your Plan':'Plan Your Retirement'}</h3>
              <p className="text-slate-400 max-w-md mx-auto text-sm">{hasExisting?'Walk through your plan to make changes, or start fresh.':'Seven short topics and you\'ll have a real projection. Here\'s the whole route, so you know what\'s coming.'}</p>
            </div>

            {!hasExisting && (
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-2.5">
                {[
                  ['👤','About you','Your age and state'],
                  ['💼','Income','What you earn now'],
                  ['🏖️','Retirement date','When you want to stop working'],
                  ['💰','Savings','Which accounts you have, and roughly what\'s in them'],
                  ['🏛️','Social Security','Your estimated benefit, or ours'],
                  ['🎯','Spending','What you want retirement to cost'],
                  ['🏠','Home','Optional — only affects your net worth'],
                ].map(([icon,name,detail],i)=>(
                  <div key={name} className="flex items-start gap-3">
                    <span className="text-slate-500 text-xs font-mono w-3 shrink-0 pt-0.5">{i+1}</span>
                    <span className="shrink-0">{icon}</span>
                    <div className="min-w-0">
                      <span className="text-sm text-slate-200">{name}</span>
                      <span className="text-xs text-slate-500"> — {detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!hasExisting && (
              <div className="bg-emerald-500/5 border border-emerald-500/25 rounded-xl p-4 space-y-2">
                <div className="text-sm font-semibold text-emerald-300">You don't need your statements</div>
                <ul className="text-xs text-slate-400 space-y-1.5 leading-relaxed">
                  <li><span className="text-slate-300">Don't know a balance or contribution?</span> Tell us the account exists and hit “Estimate it” — we'll fill in a typical figure for your age and income and mark it so you can fix it later.</li>
                  <li><span className="text-slate-300">Nothing here is final.</span> Every number is editable afterwards, and this wizard is always in the sidebar to walk through again.</li>
                  <li><span className="text-slate-300">Nothing leaves your device.</span> The plan is saved in this browser only.</li>
                </ul>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 max-w-sm mx-auto pt-1">
              {hasExisting && <button onClick={()=>{loadExisting();setStep(1);}} className="px-5 py-4 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl transition-colors"><div className="text-lg">✏️ Update My Plan</div><div className="text-sm text-amber-200/80 font-normal">Walk through with current data</div></button>}
              <button onClick={()=>setStep(1)} className={`px-5 py-4 ${hasExisting?'bg-slate-700 hover:bg-slate-600 text-slate-200':'bg-amber-600 hover:bg-amber-500 text-white'} font-semibold rounded-xl transition-colors`}><div className="text-lg">{hasExisting?'🆕 Start Fresh':'🚀 Let\'s go'}</div><div className={`text-sm ${hasExisting?'text-slate-400':'text-amber-200/80'} font-normal`}>about 3 minutes</div></button>
              <button onClick={onExplore} className="px-5 py-3 text-slate-400 hover:text-slate-200 transition-colors text-sm">{hasExisting?'← Keep current plan':'🔍 Explore with sample data first'}</button>
            </div></div>)}

          {step===1 && (<div className="space-y-5">
            {whyBox(
              'Your age sets the length of the projection, and your state sets the income tax it pays in retirement.',
              'Age also drives Required Minimum Distributions — the IRS forces withdrawals from pre-tax accounts starting at 73 or 75 depending on your birth year — and when Medicare and its income surcharges begin at 65. State matters more than people expect: nine states tax no income at all, and most of the rest exempt some or all retirement income.'
            )}
            <div><label className="text-sm font-medium text-slate-300 mb-1 block">How old are you?</label><input type="number" value={w.myAge} onChange={e=>update('myAge',e.target.value)} placeholder="45" className={inputStyle} /></div>
            <label className="flex items-center gap-3 cursor-pointer py-2"><input type="checkbox" checked={w.hasSpouse} onChange={e=>update('hasSpouse',e.target.checked)} className="w-5 h-5 rounded border-slate-600 text-amber-500 focus:ring-amber-500/50" /><span className="text-slate-200">I'm planning with a spouse or partner</span></label>
            {w.hasSpouse && <div className="pl-4 border-l-2 border-amber-500/30"><label className="text-sm font-medium text-slate-300 mb-1 block">Spouse's age?</label><input type="number" value={w.spouseAge} onChange={e=>update('spouseAge',e.target.value)} placeholder="43" className={inputStyle} /></div>}
            <div><label className="text-sm font-medium text-slate-300 mb-1 block">What state do you live in?</label><select value={w.state} onChange={e=>update('state',e.target.value)} className={inputStyle}>{Object.keys(STATE_TAX_RATES).map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          </div>)}

          {step===2 && (<div className="space-y-5">
            {whyBox(
              'Your salary is what your savings grow out of between now and retirement, and it anchors the Social Security estimate.',
              "It also sets the payroll tax you pay while working, and it's the base your raise percentage compounds on. If your income swings a lot, use a normal year rather than your best or worst one."
            )}
            <p className="text-sm text-slate-400">Your current annual income, before taxes.</p>
            <div><label className="text-sm font-medium text-slate-300 mb-1 block">My annual salary</label>{dollarInput(w.mySalary,v=>update('mySalary',v),'85,000')}</div>
            {w.hasSpouse && <div><label className="text-sm font-medium text-slate-300 mb-1 block">Spouse's annual salary</label>{dollarInput(w.spouseSalary,v=>update('spouseSalary',v),'60,000')}</div>}
            <div><label className="text-sm font-medium text-slate-300 mb-1 block">My expected annual raises (%)</label><input type="number" step="0.5" value={w.mySalaryGrowth} onChange={e=>update('mySalaryGrowth',e.target.value)} className={`${inputSkin} px-4 py-2.5 w-24`} /><p className="text-xs text-slate-500 mt-1">Most people get 2–4% annual raises.</p></div>
            {w.hasSpouse && <div><label className="text-sm font-medium text-slate-300 mb-1 block">Spouse's expected annual raises (%)</label><input type="number" step="0.5" value={w.spouseSalaryGrowth} onChange={e=>update('spouseSalaryGrowth',e.target.value)} className={`${inputSkin} px-4 py-2.5 w-24`} /></div>}
            {householdIncome>0 && <div className="p-3 bg-slate-800/60 rounded-lg border border-slate-700/50"><div className="text-xs text-slate-500">Household income</div><div className="text-xl font-bold text-emerald-400">${householdIncome.toLocaleString()}/year</div></div>}
          </div>)}

          {step===3 && (<div className="space-y-5">
            {whyBox(
              'This is the switch from saving to spending — the single input that moves the outcome most.',
              "On this date contributions stop and withdrawals start, so moving it later adds earning years AND removes spending years from the same pot. It also decides whether you'd face the 10% penalty for tapping pre-tax accounts before 59½, and whether you need to buy your own health insurance before Medicare starts at 65. Put your honest target here — you can compare alternatives side by side later in Scenarios."
            )}
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
            {whyBox(
              'Account TYPE matters as much as the balance — each one is taxed differently in retirement, and that changes what order to spend them in.',
              "Pre-tax accounts (401(k), Traditional IRA) are taxed as income when withdrawn and are forced out by RMDs later. Roth accounts come out tax-free with no RMDs. Brokerage accounts pay lower capital-gains rates on their growth. That's why the same total, split differently, produces a different after-tax retirement — and it's what the withdrawal order on Personal Info and the Taxes & Roth tab are for. So getting the types right is the important part; the balances you can refine any time."
            )}
            <p className="text-sm text-slate-400">Check off the accounts you have. If you don't know a balance or contribution, use <span className="text-sky-400">Estimate it</span> — a rough plan today beats a perfect one you never finish.</p>
            <AccountCard active={w.has401k} onToggle={()=>update('has401k',!w.has401k)} title="Traditional 401(k) / 403(b)" desc="Pre-tax contributions, taxed on withdrawal" />
            {w.has401k && <div className="space-y-3">
              <div className="pl-4 border-l-2 border-amber-500/30"><label className="text-xs text-slate-400 mb-0.5 block">Current balance</label>{dollarInput(w.balance401k,v=>updateOwned('balance401k',v),'100,000')}{estimateRow('balance401k',remainingBenchmark('balance401k'),"Typical total retirement savings for your age and income, per Fidelity's savings-milestone guideline, minus anything you've already entered.")}</div>
              {matchInput({label:'My annual contribution',modeKey:'contrib401kMode',dollarKey:'contrib401k',pctKey:'contrib401kPercent',dollarPlaceholder:'10,000',estimate:deferralEstimate(mySalary),estimateRationale:"About 8% of salary — roughly what the average participant defers (Vanguard, How America Saves).",pctPlaceholder:'10',pctHint:'Percent of your salary you defer each year; grows with your pay.',dollarHint:'Fixed dollar amount you contribute per year.',border:'border-amber-500/30'})}
              {matchInput({label:'Employer match (covers both Traditional & Roth)',modeKey:'match401kMode',dollarKey:'match401k',pctKey:'match401kPercent',dollarPlaceholder:'5,000',estimate:matchEstimate(mySalary),estimateRationale:"3% of salary — the most common formula is 50% of what you put in, up to 6% of pay."})}
            </div>}
            <AccountCard active={w.hasRoth401k} onToggle={()=>update('hasRoth401k',!w.hasRoth401k)} title="Roth 401(k) / Roth 403(b)" desc="After-tax contributions, tax-free in retirement" />
            {w.hasRoth401k && <div className="pl-4 border-l-2 border-emerald-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Current balance</label>{dollarInput(w.balanceRoth401k,v=>updateOwned('balanceRoth401k',v),'50,000')}{estimateRow('balanceRoth401k',remainingBenchmark('balanceRoth401k'),"Typical total retirement savings for your age and income, per Fidelity's savings-milestone guideline, minus anything you've already entered.")}</div><div><label className="text-xs text-slate-400 mb-0.5 block">My annual contribution</label>{dollarInput(w.contribRoth401k,v=>updateOwned('contribRoth401k',v),'10,000')}{estimateRow('contribRoth401k',deferralEstimate(mySalary),"About 8% of salary — roughly what the average participant defers (Vanguard, How America Saves).")}</div></div>}
            {/* Roth-only savers still get a match (it lands in a pre-tax bucket); shown here only when there's no Traditional 401(k) block to host it above. */}
            {w.hasRoth401k && !w.has401k && matchInput({label:'Employer match',modeKey:'match401kMode',dollarKey:'match401k',pctKey:'match401kPercent',dollarPlaceholder:'5,000',estimate:matchEstimate(mySalary),estimateRationale:"3% of salary — the most common formula is 50% of what you put in, up to 6% of pay."})}
            {limitWarning(check401kLimits({age:w.myAge,salary:mySalary,has401k:w.has401k,c401Mode:w.contrib401kMode,c401Pct:w.contrib401kPercent,c401Fixed:w.contrib401k,hasRoth401k:w.hasRoth401k,rothFixed:w.contribRoth401k,matchMode:w.match401kMode,matchPct:w.match401kPercent,matchFixed:w.match401k}))}
            <AccountCard active={w.hasRothIRA} onToggle={()=>update('hasRothIRA',!w.hasRothIRA)} title="Roth IRA" desc="Tax-free withdrawals in retirement" />
            {w.hasRothIRA && <div className="pl-4 border-l-2 border-amber-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.balanceRothIRA,v=>updateOwned('balanceRothIRA',v),'25,000')}{estimateRow('balanceRothIRA',remainingBenchmark('balanceRothIRA'),"Typical total retirement savings for your age and income, per Fidelity's savings-milestone guideline, minus anything you've already entered.")}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Annual contribution</label>{dollarInput(w.contribRothIRA,v=>updateOwned('contribRothIRA',v),'7,000')}{estimateRow('contribRothIRA',iraEstimate(mySalary),"About 8% of salary, capped at the annual IRA limit.")}</div></div>}
            <AccountCard active={w.hasTraditionalIRA} onToggle={()=>update('hasTraditionalIRA',!w.hasTraditionalIRA)} title="Traditional IRA" desc="Tax-deductible now, taxed on withdrawal" />
            {w.hasTraditionalIRA && <div className="pl-4 border-l-2 border-amber-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.balanceTraditionalIRA,v=>updateOwned('balanceTraditionalIRA',v),'50,000')}{estimateRow('balanceTraditionalIRA',remainingBenchmark('balanceTraditionalIRA'),"Typical total retirement savings for your age and income, per Fidelity's savings-milestone guideline, minus anything you've already entered.")}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Annual contribution</label>{dollarInput(w.contribTraditionalIRA,v=>updateOwned('contribTraditionalIRA',v),'7,000')}{estimateRow('contribTraditionalIRA',iraEstimate(mySalary),"About 8% of salary, capped at the annual IRA limit.")}</div></div>}
            <AccountCard active={w.hasBrokerage} onToggle={()=>update('hasBrokerage',!w.hasBrokerage)} title="Brokerage / Taxable Savings" desc="Regular investment account" />
            {w.hasBrokerage && <div className="pl-4 border-l-2 border-amber-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.balanceBrokerage,v=>update('balanceBrokerage',v),'30,000')}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Annual contribution</label>{dollarInput(w.contribBrokerage,v=>update('contribBrokerage',v),'5,000')}</div></div>}
            {w.hasSpouse && <><div className="border-t border-slate-700/50 pt-3 mt-3"><p className="text-xs text-amber-400 font-semibold mb-3">SPOUSE'S ACCOUNTS</p></div>
              <AccountCard active={w.spouseHas401k} onToggle={()=>update('spouseHas401k',!w.spouseHas401k)} title="Spouse's Traditional 401(k)" />
              {w.spouseHas401k && <div className="space-y-3">
                <div className="pl-4 border-l-2 border-amber-500/30"><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.spouseBalance401k,v=>updateOwned('spouseBalance401k',v),'50,000')}{estimateRow('spouseBalance401k',remainingBenchmark('spouseBalance401k'),"Typical total retirement savings for your age and income, per Fidelity's savings-milestone guideline, minus anything you've already entered.")}</div>
                {matchInput({label:'Spouse annual contribution',modeKey:'spouseContrib401kMode',dollarKey:'spouseContrib401k',pctKey:'spouseContrib401kPercent',dollarPlaceholder:'8,000',estimate:deferralEstimate(spouseSalary),estimateRationale:"About 8% of salary — roughly what the average participant defers (Vanguard, How America Saves).",pctPlaceholder:'10',pctHint:'Percent of salary deferred each year; grows with pay.',dollarHint:'Fixed dollar amount contributed per year.',border:'border-amber-500/30'})}
                {matchInput({label:'Spouse employer match (covers both Traditional & Roth)',modeKey:'spouseMatch401kMode',dollarKey:'spouseMatch401k',pctKey:'spouseMatch401kPercent',dollarPlaceholder:'3,000',estimate:matchEstimate(spouseSalary),estimateRationale:"3% of salary — the most common formula is 50% of what you put in, up to 6% of pay."})}
              </div>}
              <AccountCard active={w.spouseHasRoth401k} onToggle={()=>update('spouseHasRoth401k',!w.spouseHasRoth401k)} title="Spouse's Roth 401(k)" />
              {w.spouseHasRoth401k && <div className="pl-4 border-l-2 border-emerald-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.spouseBalanceRoth401k,v=>updateOwned('spouseBalanceRoth401k',v),'25,000')}{estimateRow('spouseBalanceRoth401k',remainingBenchmark('spouseBalanceRoth401k'),"Typical total retirement savings for your age and income, per Fidelity's savings-milestone guideline, minus anything you've already entered.")}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Contribution</label>{dollarInput(w.spouseContribRoth401k,v=>updateOwned('spouseContribRoth401k',v),'5,000')}{estimateRow('spouseContribRoth401k',deferralEstimate(spouseSalary),"About 8% of salary — roughly what the average participant defers (Vanguard, How America Saves).")}</div></div>}
              {w.spouseHasRoth401k && !w.spouseHas401k && matchInput({label:'Spouse employer match',modeKey:'spouseMatch401kMode',dollarKey:'spouseMatch401k',pctKey:'spouseMatch401kPercent',dollarPlaceholder:'3,000',estimate:matchEstimate(spouseSalary),estimateRationale:"3% of salary — the most common formula is 50% of what you put in, up to 6% of pay."})}
              {limitWarning(check401kLimits({age:w.spouseAge,salary:spouseSalary,has401k:w.spouseHas401k,c401Mode:w.spouseContrib401kMode,c401Pct:w.spouseContrib401kPercent,c401Fixed:w.spouseContrib401k,hasRoth401k:w.spouseHasRoth401k,rothFixed:w.spouseContribRoth401k,matchMode:w.spouseMatch401kMode,matchPct:w.spouseMatch401kPercent,matchFixed:w.spouseMatch401k}))}
              <AccountCard active={w.spouseHasRothIRA} onToggle={()=>update('spouseHasRothIRA',!w.spouseHasRothIRA)} title="Spouse's Roth IRA" />
              {w.spouseHasRothIRA && <div className="pl-4 border-l-2 border-amber-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.spouseBalanceRothIRA,v=>updateOwned('spouseBalanceRothIRA',v),'15,000')}{estimateRow('spouseBalanceRothIRA',remainingBenchmark('spouseBalanceRothIRA'),"Typical total retirement savings for your age and income, per Fidelity's savings-milestone guideline, minus anything you've already entered.")}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Contribution</label>{dollarInput(w.spouseContribRothIRA,v=>updateOwned('spouseContribRothIRA',v),'7,000')}{estimateRow('spouseContribRothIRA',iraEstimate(spouseSalary),"About 8% of salary, capped at the annual IRA limit.")}</div></div>}
            </>}
            <AccountCard active={w.hasHSA} onToggle={()=>update('hasHSA',!w.hasHSA)} title="Health Savings Account (HSA)" desc="Triple tax advantage — tax-free for medical expenses in retirement" />
            {w.hasHSA && <div className="pl-4 border-l-2 border-teal-500/30 grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Balance</label>{dollarInput(w.balanceHSA,v=>updateOwned('balanceHSA',v),'10,000')}{estimateRow('balanceHSA',remainingBenchmark('balanceHSA'),"Typical total retirement savings for your age and income, per Fidelity's savings-milestone guideline, minus anything you've already entered.")}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Annual contribution</label>{dollarInput(w.contribHSA,v=>update('contribHSA',v),'4,150')}</div></div>}
            <p className="text-xs text-slate-500">You can add 457(b) and other account types later from the Accounts tab.</p>
            </>)}
          </div>)}

          {step===5 && (<div className="space-y-5">
            {whyBox(
              "Guaranteed income covers part of your spending for life, which decides how much has to come out of your portfolio.",
              "Every dollar of Social Security or pension is a dollar you don't have to withdraw — that's why the claiming age is worth real money, and why there's a whole tab for comparing every age from 62 to 70. Don't have your figure handy? Use our estimate now and replace it later from your ssa.gov statement, which is the accurate source."
            )}
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
            {w.expectSS && <div className="pl-4 border-l-2 border-amber-500/30 space-y-2"><div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">My monthly benefit at Full Retirement Age (67)</label>{dollarInput(w.ssMonthly,v=>updateOwned('ssMonthly',v),estimateSSMonthly(mySalary)>0?estimateSSMonthly(mySalary).toLocaleString():'2,500')}{estimateRow('ssMonthly',estimateSSMonthly(mySalary),"About 40% of your salary, which is roughly what Social Security replaces for a median earner claiming at Full Retirement Age. Your ssa.gov statement is the accurate figure.")}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Claiming age</label><select value={w.ssClaimAge} onChange={e=>update('ssClaimAge',e.target.value)} className={inputStyle}>{[62,63,64,65,66,67,68,69,70].map(a=><option key={a} value={a}>{a}{a===62?' (earliest)':a===67?' (FRA)':a===70?' (max)':''}</option>)}</select></div></div><p className="text-xs text-slate-500">For your actual estimate, log in to <a href="https://www.ssa.gov/myaccount/" target="_blank" rel="noopener noreferrer" className="text-amber-400 underline">ssa.gov/myaccount</a> — look for "Estimated monthly benefit at age 67."</p></div>}
            {w.hasSpouse && <><div className="border-t border-slate-700/30 pt-3"><label className="flex items-center gap-3 cursor-pointer py-1"><input type="checkbox" checked={w.spouseExpectSS} onChange={e=>update('spouseExpectSS',e.target.checked)} className="w-5 h-5 rounded border-slate-600 text-amber-500 focus:ring-amber-500/50" /><span className="text-slate-200">Spouse expects Social Security</span></label></div>
              {w.spouseExpectSS && <div className="pl-4 border-l-2 border-amber-500/30 space-y-2"><div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-slate-400 mb-0.5 block">Spouse monthly benefit at Full Retirement Age (67)</label>{dollarInput(w.spouseSSMonthly,v=>updateOwned('spouseSSMonthly',v),estimateSSMonthly(spouseSalary)>0?estimateSSMonthly(spouseSalary).toLocaleString():'1,800')}{estimateRow('spouseSSMonthly',estimateSSMonthly(spouseSalary),"About 40% of your salary, which is roughly what Social Security replaces for a median earner claiming at Full Retirement Age. Your ssa.gov statement is the accurate figure.")}</div><div><label className="text-xs text-slate-400 mb-0.5 block">Claiming age</label><select value={w.spouseSSClaimAge} onChange={e=>update('spouseSSClaimAge',e.target.value)} className={inputStyle}>{[62,63,64,65,66,67,68,69,70].map(a=><option key={a} value={a}>{a}</option>)}</select></div></div></div>}
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
                    <div><label className="text-[10px] text-slate-500 block mb-0.5">Type</label><select value={oi.type} onChange={e=>{const v=e.target.value;setW(prev=>({...prev,otherIncomes:prev.otherIncomes.map(o=>o.id===oi.id?{...o,type:v}:o)}))}} className={`${inputSkin} w-full px-4 text-xs py-1.5`}><option value="rental">Rental</option><option value="business">Business/Consulting</option><option value="annuity">Annuity</option><option value="other">Other</option></select></div>
                    <div><label className="text-[10px] text-slate-500 block mb-0.5">Annual $</label>{dollarInput(oi.amount, v=>setW(prev=>({...prev,otherIncomes:prev.otherIncomes.map(o=>o.id===oi.id?{...o,amount:v}:o)})), '12,000')}</div>
                    <div><label className="text-[10px] text-slate-500 block mb-0.5">Ages</label><div className="flex items-center gap-1"><input type="number" value={oi.startAge} onChange={e=>{const v=e.target.value;setW(prev=>({...prev,otherIncomes:prev.otherIncomes.map(o=>o.id===oi.id?{...o,startAge:v}:o)}))}} className={`${inputSkin} px-2 text-xs py-1.5 w-14`} /><span className="text-slate-500">–</span><input type="number" value={oi.endAge} onChange={e=>{const v=e.target.value;setW(prev=>({...prev,otherIncomes:prev.otherIncomes.map(o=>o.id===oi.id?{...o,endAge:v}:o)}))}} className={`${inputSkin} px-2 text-xs py-1.5 w-14`} /></div></div>
                    <div><label className="text-[10px] text-slate-500 block mb-0.5">Annual growth (%)</label><input type="number" step="0.5" value={oi.cola} onChange={e=>{const v=e.target.value;setW(prev=>({...prev,otherIncomes:prev.otherIncomes.map(o=>o.id===oi.id?{...o,cola:v}:o)}))}} className={`${inputSkin} w-full px-4 text-xs py-1.5`} placeholder="2" /></div>
                    {w.hasSpouse&&<div><label className="text-[10px] text-slate-500 block mb-0.5">Owner</label><select value={oi.owner} onChange={e=>{const v=e.target.value;setW(prev=>({...prev,otherIncomes:prev.otherIncomes.map(o=>o.id===oi.id?{...o,owner:v}:o)}))}} className={`${inputSkin} w-full px-4 text-xs py-1.5`}><option value="me">Me</option><option value="spouse">Spouse</option><option value="joint">Joint</option></select></div>}
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
            {whyBox(
              "This is the target the whole projection is measured against: can your money cover this, every year, for life?",
              "Enter it in today's dollars — the engine inflates it for you each year. It's what you want to SPEND after tax, not withdraw: the solver works backwards to find the gross withdrawal that leaves you this much once taxes are paid. Most people land near 70–80% of their current income, since payroll taxes and retirement saving both stop."
            )}
            <p className="text-sm text-slate-400">How much annual income do you want in retirement? (Today's dollars — inflation is automatic.)</p>
            <div><label className="text-sm font-medium text-slate-300 mb-1 block">Desired annual retirement income</label>{dollarInput(w.desiredSpending,v=>updateOwned('desiredSpending',v),suggestedSpending>0?suggestedSpending.toLocaleString():'60,000')}{estimateRow('desiredSpending',suggestedSpending,"75% of your current household income — the usual starting point, since payroll taxes and retirement saving both stop when you retire.")}</div>
            {householdIncome>0 && <div className="p-4 bg-slate-800/60 rounded-lg border border-slate-700/50 space-y-2">
              <p className="text-xs text-slate-500 font-semibold">RULE OF THUMB</p>
              <p className="text-sm text-slate-300">Most planners suggest <strong className="text-amber-400">70–80%</strong> of pre-retirement income.</p>
              <div className="grid grid-cols-3 gap-3 mt-2">{[70,75,80].map(pct=>{const val=Math.round(householdIncome*pct/100/1000)*1000;return(<button key={pct} onClick={()=>update('desiredSpending',String(val))} className={`p-2 rounded-lg border text-center transition-all ${num(w.desiredSpending)===val?'border-amber-500 bg-amber-500/10':'border-slate-600 hover:border-slate-500'}`}><div className="text-xs text-slate-500">{pct}%</div><div className="text-sm font-bold text-slate-200">${val.toLocaleString()}</div></button>);})}</div>
              <p className="text-xs text-slate-500 mt-2">That's ${Math.round((num(w.desiredSpending)||suggestedSpending)/12).toLocaleString()}/month.</p>
            </div>}
          </div>)}

          {step===7 && (<div className="space-y-5">
            {whyBox(
              "Optional. A home changes your net worth and what you leave behind, but not the income your plan has to produce.",
              "The projection never sells your house to fund retirement, so skipping this won't distort whether your money lasts. It's here so the net-worth chart and legacy figure are complete, and so a mortgage shows up as the debt it is until it's paid off. Skip it and add it from the Assets tab later if you'd rather."
            )}
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
            {/* Close the loop on anything we filled in. Telling the user exactly
                which numbers are ours is what makes the estimates safe to offer:
                they know what to trust and what to come back to. */}
            {(w.estimatedFields||[]).length>0 && (
              <div className="p-3 bg-amber-500/5 border border-amber-500/30 rounded-lg space-y-2">
                <div className="text-xs font-semibold text-amber-400">
                  {(w.estimatedFields||[]).length} {(w.estimatedFields||[]).length===1?'value is':'values are'} our estimate, not yours
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(w.estimatedFields||[]).map(f=>(
                    <span key={f} className="px-2 py-0.5 rounded text-[11px] bg-slate-800 text-slate-300 border border-slate-700">
                      {ESTIMATE_LABELS[f]||f}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Good enough to see the shape of your plan. They'll stay flagged on the Dashboard so you can
                  swap in real figures as you find them — that's when the projection becomes yours.
                </p>
              </div>
            )}
            {pv&&pv.proj>0 && <div className="p-4 bg-gradient-to-br from-emerald-900/30 to-slate-800/60 rounded-xl border border-emerald-700/30">
              <div className="text-xs text-emerald-400 font-semibold mb-3">📊 QUICK PROJECTION (7% avg return)</div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-slate-500">Portfolio at retirement</div><div className="text-xl font-bold text-emerald-400">${pv.proj.toLocaleString()}</div></div>
                <div><div className="text-xs text-slate-500">Spending goal</div><div className="text-xl font-bold text-amber-400">${(num(w.desiredSpending)||suggestedSpending).toLocaleString()}/yr</div></div>
                <div><div className="text-xs text-slate-500">Guaranteed income (SS+pension)</div><div className="text-lg font-bold text-sky-400">${pv.guaranteed.toLocaleString()}/yr</div></div>
                <div><div className="text-xs text-slate-500">Gap from portfolio</div><div className="text-lg font-bold text-slate-200">${Math.round(pv.gapAtRet).toLocaleString()}/yr</div><div className="text-[10px] text-slate-500">in age-{num(w.myRetirementAge)||65} dollars</div></div>
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
            personalInfo={wizPersonalInfo}
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
            defaultSaleAge={Number(w.myRetirementAge)||65}
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
            personalInfo={wizPersonalInfo}
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
}

