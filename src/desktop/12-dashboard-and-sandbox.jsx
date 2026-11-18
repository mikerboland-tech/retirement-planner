// ============================================
// DashboardTab — Lifted to module scope
// ============================================
// ============================================
// SANDBOX — the reader's own dashboard, with the levers attached
//
// The default Dashboard answers "am I on track" and is deliberately opinionated
// about what it shows. This tab answers a different question: "what happens if".
// It does not replace the Dashboard and does not write to the plan — every
// control here is a what-if until the reader says otherwise.
//
// Two halves. A row of controls, each of which follows the plan until it is
// touched, and a set of panels the reader chooses from a catalogue. One
// scenario feeds every panel on the page, because a page where the chart and
// the tiles answer the same question differently is worse than no page.
//
// The engine composes the controls (sandboxScenario) so the ORDER they apply in
// is one rule in one place rather than an accident of which handler ran last.
// ============================================
// The Sandbox's catalogue IS the app's panel registry, plus a couple of things
// that only make sense here. Adding a panel anywhere in the app now makes it
// selectable here without touching this file.
const SANDBOX_EXTRA_PANELS = [
  { id: 'kpis',        label: 'What the controls changed (numbers)' },
  { id: 'balances',    label: 'Balances by tax treatment' },
  { id: 'changes',     label: 'What the controls changed (dates)' },
  { id: 'scenarios',   label: 'Saved scenarios & comparison' },
];
// What the old Dashboard showed at its default detail level, plus the what-if
// tiles — which draw nothing until a lever moves, so a reader who never
// touches one sees the Dashboard they always had.
const DEFAULT_DASHBOARD_PANELS = ['kpis', 'summaryCards', 'yearByYear', 'netWorth', 'retirementIncome',
  'withdrawalRate', 'taxSummary', 'healthcare', 'safeSpending', 'cashFlow'];

// v2.47.0 folded the Sandbox into the Dashboard. A saved plan arrives with
// two opinions about what the page should show: the Dashboard's section
// choices (a detail level plus per-section overrides) and the Sandbox's own
// panel list. The merged page shows the UNION, so nothing either page was
// showing disappears on upgrade; a reader who wants less now has one picker
// to do it with. Pure, and idempotent via the `layout` marker, so it can run
// on every load and import without ever re-adding a panel someone removed.
const mergedDashboardConfig = (cfg, sectionVisibility, detailLevel) => {
  if (cfg && cfg.layout === 3) return cfg;
  // Layout 3 (v2.57.0) adds the Year by year timeline, once, to a page that was
  // already merged; a reader who hides it afterwards keeps it hidden.
  if (cfg && cfg.layout === 2) {
    const list = Array.isArray(cfg.panels) ? cfg.panels : DEFAULT_DASHBOARD_PANELS;
    return { ...cfg, panels: list.includes('yearByYear') ? list : [...list, 'yearByYear'], layout: 3 };
  }
  const dashVis = (sectionVisibility && sectionVisibility.dashboard) || {};
  const shows = LEVEL_SHOWS[detailLevel || 'standard'] ?? 1;
  const fromDashboard = LEGACY_DASHBOARD_SECTIONS
    .filter(([id, level]) => (typeof dashVis[id] === 'boolean' ? dashVis[id] : LEVEL_RANK[level] <= shows))
    .map(([id]) => id);
  // The healthcare card was never hideable, so it was always there.
  const union = ['kpis', ...fromDashboard, 'healthcare'];
  const fromSandbox = cfg && Array.isArray(cfg.panels) ? cfg.panels : [];
  fromSandbox.forEach(id => { if (!union.includes(id)) union.push(id); });
  if (!union.includes('yearByYear')) union.push('yearByYear');
  return { ...(cfg || {}), controls: (cfg && cfg.controls) || {}, panels: union, layout: 3 };
};
const freshDashboardConfig = () => ({ panels: [...DEFAULT_DASHBOARD_PANELS], controls: {}, layout: 3 });

// These two live at module scope, and that is the whole reason the sliders drag
// smoothly. Defined inside SandboxTab they were a NEW component type on every
// render, so React unmounted and remounted the <input type="range"> the instant
// its value changed — the browser dropped the thumb's pointer capture with it,
// and a drag moved exactly one step before dying. You had to release and grab
// the dot again for each year. The savings-rate slider it was compared against
// never had the problem, because that component sat at module scope — which is
// also the fix three earlier comments in this file already record for remount
// bugs. (That component is gone as of v2.15.0; the diagnosis stands.)
// A slider AND a number field for the same value. A slider is good for sweeping
// and bad for landing on a figure someone already has in mind — "retire at 67",
// "spend exactly $118,000" — so both drive the same control. The box clamps to
// the slider's own range, because a value outside it would move the thumb off
// the end and leave the two disagreeing about what the control says.
const SandboxSlider = ({ label, value, onChange, min, max, step = 1, planValue, format, suffix, disabled, note }) => {
  const commit = (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(Math.min(max, Math.max(min, n)));
  };
  return (
    <div className="min-w-[230px] flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs text-slate-400">{label}</label>
        <div className="flex items-center gap-1.5">
          <input
            type="number" min={min} max={max} step={step} value={value} disabled={disabled}
            onChange={e => commit(e.target.value)}
            aria-label={`${label} (value)`}
            className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-sm
                       text-amber-400 font-semibold text-right focus:border-amber-500 focus:outline-none"
          />
          {suffix && <span className="text-sm font-semibold text-amber-400">{suffix}</span>}
        </div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
             onChange={e => onChange(Number(e.target.value))}
             aria-label={label} className={`w-full accent-amber-500 ${disabled ? 'opacity-40' : ''}`} />
      <div className="text-[11px] text-slate-500">
        plan: {format ? format(planValue) : planValue}{suffix || ''}
        {value !== planValue && <span className="text-amber-500/80"> · changed</span>}
        {note && <span className="text-amber-500/80"> · {note}</span>}
      </div>
    </div>
  );
};

// One switch, used five times. Each says what the plan itself is set to, and
// when a switch cannot bite — survivor modelling on a single filer, QCDs with
// no charitable giving set — it says so instead of sitting there inert.
const SandboxSwitch = ({ label, on, onChange, planLabel, note, disabled }) => (
  <div className="min-w-[170px]">
    <label className="text-xs text-slate-400 block mb-1.5">{label}</label>
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
        disabled ? 'bg-slate-800/40 border-slate-700 text-slate-600 cursor-not-allowed'
          : on ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
               : 'bg-slate-700/50 border-slate-600 text-slate-400'}`}
    >
      {on ? 'On' : 'Off'}
    </button>
    <div className="text-[11px] text-slate-500 mt-1">
      {planLabel}
      {note && <span className="text-amber-500/80"> · {note}</span>}
    </div>
  </div>
);

// A row of mutually exclusive options, for the levers that are a CHOICE rather
// than a number or a switch — which bracket to fill, which account to spend
// first. Every one of them offers "Plan" as its first option and starts there,
// because a Sandbox that silently substitutes its own default for the reader's
// plan is answering a question nobody asked. Disabled options still render, with
// the reason, rather than vanishing.
const SandboxChoice = ({ label, value, options, onChange, planLabel, note, disabled, wide }) => (
  <div className={wide ? 'min-w-[420px] flex-1' : 'min-w-[230px]'}>
    <label className="text-xs text-slate-400 block mb-1.5">{label}</label>
    <div className="flex flex-wrap gap-1 items-center">
      {options.map(o => {
        // A divider is a caption on its own line — basis-full forces the wrap —
        // used where one control offers two KINDS of target that are measured
        // differently and must not read as one undifferentiated row.
        if (o.divider) return (
          <div key={o.label} className="basis-full text-[10px] uppercase tracking-wide text-slate-500 mt-1.5 mb-0.5">
            {o.label}
          </div>
        );
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => !disabled && onChange(o.value)}
            disabled={disabled}
            title={o.title || ''}
            className={`px-2.5 py-1 rounded-lg border text-xs transition-colors ${
              disabled ? 'bg-slate-800/40 border-slate-700 text-slate-600 cursor-not-allowed'
                : active ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                         : 'bg-slate-700/50 border-slate-600 text-slate-400 hover:text-slate-200'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
    <div className="text-[11px] text-slate-500 mt-1">
      {planLabel}
      {note && <span className="text-amber-500/80"> · {note}</span>}
    </div>
  </div>
);

// ── PLAN HEALTH ──────────────────────────────────────────────────────────────
// The answer a reader came to the Dashboard for, in one line: is this plan on
// track? Then what to do about it. Everything here is the engine's:
//   • pass/fail is read off the projection the page is already showing, so the
//     verdict cannot disagree with the charts beneath it;
//   • "how much could I spend" and "when could I retire" are the engine's own
//     searches (survivableEdge, earliestSurvivingRetirementAge);
//   • the odds are a Monte Carlo with the Will it last? tab's default settings.
// The last two run on a worker of their own, restarted whenever the plan
// changes, so a slider drag never waits on them.
//
// The simulation is 250 markets, not the tab's 1,000 — seconds rather than
// twenty. At 250 the figure is good to a couple of points, so it is shown
// rounded to 5 and called "about"; the seed is fixed per plan, so the same
// plan says the same thing on every visit. The full run is one click away.
const HEALTH_SIMS = 250;
const HEALTH_ON_TRACK = 0.85;   // at or above, with the average case funded
const HEALTH_AT_RISK = 0.70;    // below this the odds alone make it at risk
const HEALTH_DEBOUNCE_MS = 800;
const healthSeed = (str) => {   // FNV-1a — a stable seed per plan
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
};
const roundDownTo = (v, step) => Math.floor(v / step) * step;
// Pure, so the tiers are testable without a worker.
// `through` says whose age the plan ends at, when it is not simply yours: a
// couple's plan follows the survivor, so "through age 97" would be read against
// a planning age of 95 that is the spouse's.
const planHealthVerdict = ({ fails, shortAge, lastAge, mc, through }) => {
  const pct = Number.isFinite(mc) ? Math.round(mc * 20) * 5 : null;    // nearest 5
  const until = through || `age ${lastAge}`;
  const odds = pct === null ? null : `in about ${pct}% of ${HEALTH_SIMS} simulated markets`;
  if (fails) return { tone: 'risk', label: 'At risk',
    text: `At average returns your money runs short at age ${shortAge}` + (odds ? `, and it lasts ${odds}.` : '.') };
  if (pct === null) return { tone: 'pending', label: 'Checking',
    text: `Your money lasts through ${until} at average returns. Testing it against ${HEALTH_SIMS} simulated markets…` };
  if (mc < HEALTH_AT_RISK) return { tone: 'risk', label: 'At risk',
    text: `It lasts through ${until} at average returns, but only ${odds} — a poor run of markets early in retirement would leave it short.` };
  if (mc < HEALTH_ON_TRACK) return { tone: 'warn', label: 'Worth a look',
    text: `Your money lasts through ${until} at average returns, and ${odds}. A margin would make it sturdier.` };
  return { tone: 'good', label: 'On track',
    text: `Your money lasts through ${until} at average returns, and ${odds}.` };
};

function PlanHealthCard({ plan, opts, currentYearReturn, live, isWhatIf, actions,
                          onTrySpending, onTryRetireAge, onOpenWillItLast }) {
  const [solve, setSolve] = useState(null);
  const [mc, setMc] = useState(null);
  const [spendStats, setSpendStats] = useState(null);
  const planKey = useMemo(() => JSON.stringify([plan, opts || null]), [plan, opts]);

  useEffect(() => {
    setSolve(null); setMc(null); setSpendStats(null);
    const W = window.PlannerHealthWorker;
    if (!W) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        W.cancel();
        const payload = { personalInfo: plan.pi, accounts: plan.accts, incomeStreams: plan.streams,
          assets: plan.assets, oneTimeEvents: plan.events, recurringExpenses: plan.recurring,
          currentYearReturn, opts };
        const s = await W.run({ type: 'planSolve', payload }).promise;
        if (!alive) return;
        setSolve(s);
        const r = await W.run({ type: 'monteCarlo', payload: { ...payload, seed: healthSeed(planKey),
          simSettings: { numSimulations: HEALTH_SIMS, startAge: plan.pi.myRetirementAge,
            returnModel: 'perAccount', meanReturn: 0.07, stdDev: 0.15, inflationMean: 0.03, inflationStdDev: 0.01,
            method: 'random', assetMix: 0.7, historicalStartYear: 'all',
            guardrails: { enabled: false, bandPct: 0.20, adjustPct: 0.10 },
            longevity: { enabled: false }, ltc: { enabled: false } } } }).promise;
        if (alive && r && Number.isFinite(r.successRate)) setMc(r.successRate);
        if (alive && r && r.spendingStats) setSpendStats(r.spendingStats);
      } catch (e) { /* cancelled by a newer edit, or the worker is unavailable */ }
    }, HEALTH_DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(timer); };
    // planKey is the plan; the rest are read through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, currentYearReturn]);

  const retireAge = plan.pi.myRetirementAge;
  const short = useMemo(() => planShortfall(live, { retirementAge: retireAge }), [live, retireAge]);
  if (!short || !live || !live.length) return null;
  const firstShort = short.firstShortYear || short.depletedYear;
  const lastRow = live[live.length - 1];
  const lastAge = lastRow.myAge;
  const spouseOutlives = live.some(r => r.primaryAlive === false && r.spouseAlive !== false);
  const through = spouseOutlives && Number.isFinite(lastRow.spouseAge) ? `your spouse’s age ${lastRow.spouseAge}` : null;
  const v = planHealthVerdict({ fails: short.fails, shortAge: firstShort ? firstShort.myAge : null, lastAge, mc, through });

  // What to do about it, most useful first. The plan-level levers come first
  // when there is a gap to close; this year's to-dos fill the rest.
  const spend = plan.pi.desiredRetirementIncome || 0;
  // Under a withdrawal-led strategy the spending target is not what the plan
  // spends, so "spend $X less" and "you could spend up to $Y" would be advice
  // about a number that does nothing. The strategy's own spending is shown
  // instead, from the same simulations.
  const strategyId = PlannerEngine.withdrawalStrategyOf(plan.pi);
  const leadsWithdrawal = PlannerEngine.WITHDRAWAL_LED.has(strategyId);
  const steps = [];
  if (!leadsWithdrawal && solve && short.fails && Number.isFinite(solve.spendingEdge) && solve.spendingEdge < spend) {
    const target = roundDownTo(solve.spendingEdge, 500);
    steps.push({ key: 'spend', title: `Spend about ${formatCurrency(spend - target)} less a year`,
      detail: `${formatCurrency(target)} a year in today's dollars funds every year at average returns.`,
      action: { label: 'Try it', run: () => onTrySpending(target) } });
  }
  if (solve && short.fails && Number.isFinite(solve.retireAge) && solve.retireAge > retireAge) {
    steps.push({ key: 'retire', title: `Or retire at ${solve.retireAge} instead of ${retireAge}`,
      detail: 'The earliest age that funds every year at average returns, with nothing else changed.',
      action: { label: 'Try it', run: () => onTryRetireAge(solve.retireAge) } });
  }
  if (!short.fails && mc !== null && mc < HEALTH_ON_TRACK) {
    steps.push({ key: 'markets', title: 'See the markets it does not survive',
      detail: 'Will it last? shows when and how the failing runs go wrong.',
      action: { label: 'Open', run: onOpenWillItLast } });
  }
  // The estimated-tax reminder stays in the report and off this card: it is a
  // calendar note that applies to every plan with a tax bill, not a decision
  // about this one, and on the card it pushed real steps out of the top three.
  const SEV = { high: 0, warn: 1, info: 2 };
  (actions || []).filter(a => a.id !== 'quarterly')
    .sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3))
    .forEach(a => { if (steps.length < 3) steps.push({ key: a.id, title: a.title, amount: a.amount, detail: a.detail }); });

  const tone = {
    good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    warn: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    risk: 'bg-red-500/15 text-red-300 border-red-500/40',
    pending: 'bg-slate-700/40 text-slate-300 border-slate-600',
  }[v.tone];
  const cushion = !leadsWithdrawal && solve && !short.fails && Number.isFinite(solve.spendingEdge) ? roundDownTo(solve.spendingEdge, 1000) : null;

  return (
    <div className={cardStyle} data-tour="plan-health">
      <div className="flex flex-wrap items-start gap-3">
        <span className={`shrink-0 text-sm font-semibold px-3 py-1 rounded-full border ${tone}`}>{v.label}</span>
        <div className="flex-1 min-w-[260px]">
          <p className="text-slate-100">
            {isWhatIf && <span className="text-amber-400">This what-if: </span>}
            {v.text}
          </p>
          {cushion !== null && cushion > spend && (
            <p className="text-sm text-slate-400 mt-1">
              At average returns you could spend up to about {formatCurrency(cushion)} a year in today's dollars
              — {formatCurrency(cushion - spend)} more than you plan — and still fund every year.
            </p>
          )}
          {leadsWithdrawal && spendStats && spendStats.strategy === strategyId && (
            <p className="text-sm text-slate-400 mt-1">
              With your withdrawal strategy — {(WITHDRAWAL_STRATEGY_CHOICES.find(c => c.id === strategyId) || {}).label} — you
              would spend about {formatCurrency(roundDownTo(spendStats.medianFirst, 500))} in your first retirement year, in
              today’s dollars. In the worst 10% of markets, the leanest year falls to about {formatCurrency(roundDownTo(spendStats.p10Min, 500))}.
            </p>
          )}
          {!leadsWithdrawal && solve && solve.spendingSurvivesRange && !short.fails && (
            <p className="text-sm text-slate-400 mt-1">At average returns it would fund even five times your planned spending.</p>
          )}
        </div>
      </div>
      {steps.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-700/50">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Next steps</div>
          <ol className="space-y-2">
            {steps.map((st, i) => (
              <li key={st.key} className="flex flex-wrap items-start gap-3">
                <span className="shrink-0 w-5 h-5 rounded-full bg-slate-700 text-slate-300 text-xs flex items-center justify-center mt-0.5">{i + 1}</span>
                <div className="flex-1 min-w-[220px]">
                  <div className="text-sm text-slate-200">
                    {st.title}{st.amount && <span className="text-slate-400"> · {st.amount}</span>}
                  </div>
                  {st.detail && <div className="text-xs text-slate-500 line-clamp-2">{st.detail}</div>}
                </div>
                {st.action && (
                  <button onClick={st.action.run}
                    className="shrink-0 px-3 py-1 rounded-lg border border-amber-500/50 bg-amber-500/10 text-amber-300 text-xs hover:bg-amber-500/20 transition-colors">
                    {st.action.label}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// The Dashboard and the Sandbox were one page drawn twice: the Sandbox already
// rendered every Dashboard panel through the registry, from the same engine,
// with levers on top. v2.47.0 made that the only page. With the levers left
// alone it IS the old Dashboard — the plan as saved, the same panels — and
// "what happens if I change it" is one click away on the page that answers
// "where do I stand", rather than a separate tab to discover.
function DashboardTab({ accounts, activeScenarioId, applyPlanAsBaseline, assets, computeProjections,
                      createScenarioFrom, deleteScenario, incomeStreams, loadScenario, oneTimeEvents,
                      personalInfo, projections, recurringExpenses, sandboxConfig, scenarios,
                      setSandboxConfig, onShowEverything, onDismissTour, onTakeTour, setActiveTab,
                      setPersonalInfo, showTourOffer, currentYearReturn }) {
  const R = window.Recharts || {};
  const { ComposedChart, LineChart, BarChart, Line, Bar, Area, XAxis, YAxis,
          CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } = R;

  const cfg = sandboxConfig || {};
  const controls = cfg.controls || {};
  const panels = Array.isArray(cfg.panels) ? cfg.panels : DEFAULT_DASHBOARD_PANELS;
  const setControl = (k, v) => setSandboxConfig(prev => ({
    ...(prev || {}), controls: { ...((prev || {}).controls || {}), [k]: v },
    panels: Array.isArray((prev || {}).panels) ? prev.panels : DEFAULT_DASHBOARD_PANELS }));
  // Writes a top-level config key (not a control) while preserving the rest —
  // setControl and togglePanel each rebuild the object, and a third one that
  // forgot a key would silently reset the reader's panels or levers.
  const setCfg = (patch) => setSandboxConfig(prev => ({
    ...(prev || {}),
    controls: (prev || {}).controls || {},
    panels: Array.isArray((prev || {}).panels) ? prev.panels : DEFAULT_DASHBOARD_PANELS,
    ...patch,
  }));
  const togglePanel = (id) => setSandboxConfig(prev => {
    const cur = Array.isArray((prev || {}).panels) ? prev.panels : DEFAULT_DASHBOARD_PANELS;
    return { ...(prev || {}), controls: (prev || {}).controls || {},
             panels: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] };
  });

  const married = personalInfo.filingStatus === 'married_joint'
                || personalInfo.filingStatus === 'married_separate';

  // What the plan says, so every control can show what it is departing from.
  const planMyRet = personalInfo.myRetirementAge || 65;
  const planSpRet = personalInfo.spouseRetirementAge || 65;
  const ssStream = (owner) => (incomeStreams || []).find(
    s => s.type === 'social_security' && (owner === 'spouse' ? s.owner === 'spouse' : s.owner !== 'spouse'));
  const planClaimMe = (ssStream('me') || {}).startAge || 67;
  const planClaimSp = (ssStream('spouse') || {}).startAge || 67;
  const planSpend = personalInfo.desiredRetirementIncome || 0;

  // The plan's own savings rate, measured the way the Accounts tab measures it:
  // the employee's share of this year's contributions over household earned
  // income, both read from the projection so contribution growth is included.
  const baseRow = (projections || []).find(p => p.myAge === personalInfo.myAge) || (projections || [])[0];
  const baseEarned = (baseRow && baseRow.earnedIncome) || 0;
  const basePersonal = useMemo(() => {
    const per = (baseRow && baseRow.perAccountContributions) || {};
    return (accounts || []).reduce((sum, a) => sum + myContribShare(a, per[a.id] || 0), 0);
  }, [accounts, baseRow]);
  const planSavingsRate = baseEarned > 0 ? (basePersonal / baseEarned) * 100 : 0;

  const val = (k, fallback) => (controls[k] === undefined || controls[k] === null) ? fallback : controls[k];
  const myRet = val('myRetirementAge', planMyRet);
  const spRet = val('spouseRetirementAge', planSpRet);
  const claimMe = val('claimMe', planClaimMe);
  const claimSp = val('claimSpouse', planClaimSp);
  const savingsRate = val('savingsRate', planSavingsRate);
  const spend = val('spending', planSpend);
  const rothOn = controls.rothOn === undefined || controls.rothOn === null
    ? rothConversionIsPlanned(personalInfo) : controls.rothOn;
  const planSurvivor = !!personalInfo.survivorModelEnabled;
  const survivorOn = controls.survivorOn === undefined || controls.survivorOn === null
    ? planSurvivor : controls.survivorOn;
  // The withdrawal strategy (About you → Withdrawal strategy): the picker
  // starts from the plan and choosing another is a what-if like any other.
  // `guardrailsOn` is the on/off switch this replaced (v2.59.0); a scenario
  // saved with it still reads the same.
  const planStrategy = PlannerEngine.withdrawalStrategyOf(personalInfo);
  const legacyGuard = controls.guardrailsOn;
  const strategyPick = (controls.withdrawalStrategy && PlannerEngine.WITHDRAWAL_STRATEGIES.includes(controls.withdrawalStrategy))
    ? controls.withdrawalStrategy
    : typeof legacyGuard === 'boolean'
      ? (legacyGuard ? 'guardrails' : (planStrategy === 'guardrails' ? 'target' : planStrategy))
      : planStrategy;
  const strategyMoved = strategyPick !== planStrategy;
  const strategyLabel = (id) => (WITHDRAWAL_STRATEGY_CHOICES.find(c => c.id === id) || {}).label || id;
  const pickLeadsWithdrawal = PlannerEngine.WITHDRAWAL_LED.has(strategyPick);
  const givingPct = personalInfo.charitableGivingPercent || 0;
  const qcdOn = controls.qcdOn === undefined || controls.qcdOn === null ? true : controls.qcdOn;

  // ── The strategy levers ───────────────────────────────────────────────────
  // Each is 'plan' until the reader picks something, and 'plan' means the
  // control sends nothing at all to the scenario engine.
  // The conversion strategy is a MODE plus its parameters, not one flat list:
  // three targets that take different arguments do not belong in a single row,
  // and the two-stage schedule needs both a bracket and a tier at once.
  //   'plan'    follow the plan, send nothing
  //   'bracket' fill one bracket for the whole window
  //   'irmaa'   hold one IRMAA tier for the whole window
  //   'staged'  fill a bracket while Medicare cannot see the income, then hold
  //             a tier once it can — the engine has always run this; nothing
  //             could ask for it.
  // The older single-value keys are read on the way in so a Sandbox saved
  // before this still restores what it was set to.
  const savedTarget = val('rothConversionTarget', val('rothConversionBracket', 'plan'));
  const convMode = val('convMode', savedTarget === 'plan' ? 'plan'
    : /^irmaa\d+$/.test(savedTarget) ? 'irmaa' : 'bracket');
  const convBracketPick = val('convBracket', /%$/.test(savedTarget) ? savedTarget : '24%');
  const convTierPick = val('convTier',
    /^irmaa(\d+)$/.test(savedTarget) ? Number(savedTarget.slice(5)) : 1);
  // The last age whose income never reaches an IRMAA calculation. Derived by
  // the engine from the Medicare age and the lookback, so the caption cannot
  // drift from the schedule the engine actually builds.
  const hingeAge = irmaaLastFreeAge();
  // Priced per household, the way the Tax Planning picker prices them, so the
  // choice is a quantified one rather than a tier number.
  const irmaaChoices = useMemo(() => irmaaTierOptions(
      personalInfo.filingStatus, personalInfo.filingStatus === 'married_joint' ? 2 : 1)
    .filter(o => !o.isTop)
    .map(o => ({
      value: o.index,
      // The ceiling in short form: it is the number the reader is steering by,
      // and the full figure plus the price of crossing it is in the tooltip.
      label: o.ceiling >= 1000000
        ? '$' + (o.ceiling / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M'
        : '$' + Math.round(o.ceiling / 1000) + 'k',
      title: `Hold MAGI under ${formatCurrency(o.ceiling)} — the tier below costs `
           + `${formatCurrency(o.annualSurchargePerHousehold)}/yr per household once on Medicare`,
    })), [personalInfo.filingStatus]);
  const wdFill = val('withdrawalBracketFill', 'plan');
  const wdOrder = val('withdrawalOrder', 'plan');
  const ltcChoice = val('ltcModel', 'plan');

  // The plan's own settings, so every control can say what it is departing from.
  const planConvLabel = rothConversionIsPlanned(personalInfo)
    ? `plan: ${conversionModeLabel(personalInfo)}` : 'plan: no conversions';
  const planFill = personalInfo.withdrawalBracketFill || '';
  const WD_ORDERS = {
    pretax:    ['pretax', 'brokerage', 'roth'],
    brokerage: ['brokerage', 'pretax', 'roth'],
    roth:      ['roth', 'brokerage', 'pretax'],
  };
  const planOrderArr = personalInfo.withdrawalPriority || WD_ORDERS.pretax;
  const planOrderKey = Object.keys(WD_ORDERS).find(
    k => WD_ORDERS[k].join() === planOrderArr.join()) || null;
  const orderWords = { pretax: 'Pre-tax', brokerage: 'Brokerage', roth: 'Roth' };
  const planOrderLabel = 'plan: ' + planOrderArr.map(k => orderWords[k] || k).join(' → ');
  const planLtc = personalInfo.ltcModel || 'none';
  const LTC_WORDS = { none: 'none', default: '28 months', custom: 'custom', stress: '5-year stress' };

  // ── The strategy drawer ───────────────────────────────────────────────────
  // The controls card is sticky, so everything in it follows the reader down
  // the page. The sliders are what people move constantly and they stay; the
  // strategy levers are set once and then read, so they fold away. Closed is
  // the default because the clutter is the complaint being answered.
  //
  // Nothing hides SILENTLY: while the drawer is shut, every lever that is off
  // its plan value is named on the toggle. A control that is doing something
  // to the numbers and cannot be seen is worse than a crowded panel.
  const strategyOpen = !!cfg.strategyOpen;
  // The whole lever card folds too, closed by default: on the page people land
  // on, the plan comes first. Same rule as the drawers — while it is shut,
  // every lever that is moved is named on its header, and the page says it is
  // showing a what-if.
  const leversOpen = !!cfg.leversOpen;

  // ── Income streams ────────────────────────────────────────────────────────
  // Business and rental income, a pension that might be cut, Social Security
  // after a trust-fund shortfall: income the reader does not control. Each
  // stream can be switched off, scaled, or ended earlier, and the scenario that
  // results is the one "Save as scenario" keeps.
  //
  // Stored as { [streamId]: { off, scale, endAge } } holding only what departs
  // from the plan, like every other lever here — an entry put back to its plan
  // value is deleted, so "following your plan" is literally an empty object.
  // Ids no longer in the plan are dropped on read, so deleting a stream on the
  // Income tab cannot leave a lever behind acting on nothing.
  const streamsOpen = !!cfg.streamsOpen;
  const rawStreamAdj = (controls.streamAdj && typeof controls.streamAdj === 'object') ? controls.streamAdj : {};
  const streamAdj = useMemo(() => {
    const out = {};
    (incomeStreams || []).forEach(st => {
      const a = rawStreamAdj[st.id];
      if (a && typeof a === 'object' && Object.keys(a).length) out[st.id] = a;
    });
    return out;
  }, [rawStreamAdj, incomeStreams]);
  const streamAdjCount = Object.keys(streamAdj).length;
  const setStreamAdj = (st, patch) => {
    const merged = { ...(rawStreamAdj[st.id] || {}), ...patch };
    if (!merged.off) delete merged.off;
    if (!Number.isFinite(merged.scale) || Math.abs(merged.scale - 1) < 1e-9) delete merged.scale;
    if (!Number.isFinite(merged.endAge) || merged.endAge === st.endAge
        || st.type === 'social_security' || st.type === 'earned_income') delete merged.endAge;
    const next = { ...rawStreamAdj };
    if (Object.keys(merged).length) next[st.id] = merged; else delete next[st.id];
    setControl('streamAdj', next);
  };
  const streamSummary = (incomeStreams || []).map(st => {
    const a = streamAdj[st.id];
    if (!a) return null;
    if (a.off) return `${st.name} off`;
    const bits = [];
    if (Number.isFinite(a.scale)) bits.push(`${Math.round(a.scale * 100)}%`);
    if (Number.isFinite(a.endAge)) bits.push(`to ${a.endAge}`);
    return `${st.name} ${bits.join(', ')}`;
  }).filter(Boolean);
  // ── Accounts ──────────────────────────────────────────────────────────────
  // Where the saving goes, account by account: what the saver puts into each
  // one and the age it stops. The question it is built for is the early
  // retiree's — put less into the 401(k), more into the brokerage account, and
  // see whether the plan can bridge the years before 59½ without penalties.
  //
  // Stored as { [accountId]: { employee, stopAge } } holding only departures
  // from the plan, like the streams; ids no longer in the plan are dropped on
  // read. `employee` is the saver's own dollars this year — the employer's
  // match is not theirs to move and stays as the plan has it.
  //
  // It and the savings-rate slider both set contributions, so they take turns:
  // with any account edited the slider shows the rate the edits add up to, and
  // with the slider moved the accounts wait for it to go back to plan.
  const accountsOpen = !!cfg.accountsOpen;
  const salariesNow = useMemo(() => earnedIncomeByOwner(incomeStreams), [incomeStreams]);
  const editableAccounts = useMemo(() => (accounts || []).filter(a => a && (a.contributor || 'me') !== 'employer'),
    [accounts]);
  const planEmployee = (a) => employeeDollarsOf(a, salariesNow);
  // The stop age an account has once the retirement sliders have had their say
  // — they move it — so "Stops at age" shows the what-if's age, and an edit is
  // measured against that rather than against the saved plan.
  const shiftedStop = useMemo(() => {
    const target = {};
    if (myRet !== planMyRet) target.myRetirementAge = myRet;
    if (married && spRet !== planSpRet) target.spouseRetirementAge = spRet;
    const list = Object.keys(target).length
      ? planAtRetirementAge(personalInfo, accounts, incomeStreams, target).accts : accounts;
    const out = {};
    (list || []).forEach(a => { if (a) out[a.id] = a.stopAge; });
    return out;
  }, [myRet, spRet, planMyRet, planSpRet, married, personalInfo, accounts, incomeStreams]);
  const baseStop = (a) => (shiftedStop[a.id] !== undefined ? shiftedStop[a.id] : a.stopAge);
  const rawAcctAdj = (controls.acctAdj && typeof controls.acctAdj === 'object') ? controls.acctAdj : {};
  const acctAdj = useMemo(() => {
    const out = {};
    editableAccounts.forEach(a => {
      const x = rawAcctAdj[a.id];
      if (x && typeof x === 'object' && Object.keys(x).length) out[a.id] = x;
    });
    return out;
  }, [rawAcctAdj, editableAccounts]);
  const acctAdjCount = Object.keys(acctAdj).length;
  const setAcctAdj = (a, patch) => {
    const merged = { ...(rawAcctAdj[a.id] || {}), ...patch };
    if (!Number.isFinite(merged.employee) || Math.abs(merged.employee - planEmployee(a)) < 0.5) delete merged.employee;
    if (!Number.isFinite(merged.stopAge) || merged.stopAge === baseStop(a)) delete merged.stopAge;
    const next = { ...rawAcctAdj };
    if (Object.keys(merged).length) next[a.id] = merged; else delete next[a.id];
    setControl('acctAdj', next);
  };
  const acctSummary = editableAccounts.map(a => {
    const x = acctAdj[a.id];
    if (!x) return null;
    const bits = [];
    // formatCurrency, not the page's money(): that is declared further down,
    // and this runs during render before it is initialised.
    if (Number.isFinite(x.employee)) bits.push(`${formatCurrency(x.employee)}/yr`);
    if (Number.isFinite(x.stopAge)) bits.push(`to ${x.stopAge}`);
    return `${a.name} ${bits.join(', ')}`;
  }).filter(Boolean);
  const tierWord = (i) => (irmaaChoices.find(o => o.value === i) || {}).label || `tier ${i}`;
  const strategySummary = [
    rothOn !== rothConversionIsPlanned(personalInfo) && (rothOn ? 'conversions on' : 'conversions off'),
    rothOn && convMode === 'bracket' && `convert to ${convBracketPick}`,
    rothOn && convMode === 'irmaa' && `convert under ${tierWord(convTierPick)}`,
    rothOn && convMode === 'staged' && `convert ${convBracketPick} → ${tierWord(convTierPick)}`,
    wdFill !== 'plan' && (wdFill === 'off' ? 'no pre-tax fill' : `spend pre-tax to ${wdFill}`),
    wdOrder !== 'plan' && `${({ pretax: 'pre-tax', brokerage: 'brokerage', roth: 'Roth' })[wdOrder]} first`,
    ltcChoice !== 'plan' && `care: ${({ none: 'none', default: '28 months', stress: '5-yr stress' })[ltcChoice] || ltcChoice}`,
    married && survivorOn !== planSurvivor && `survivor ${survivorOn ? 'on' : 'off'}`,
    strategyMoved && `${strategyLabel(strategyPick)}`,
    givingPct > 0 && !qcdOn && 'no QCD',
  ].filter(Boolean);

  // Account edits outrank the slider when both are somehow set (an older saved
  // scenario, say), matching the engine, which applies them after it.
  const savingsMoved = acctAdjCount === 0 && Math.abs(savingsRate - planSavingsRate) > 0.05;
  const touched = myRet !== planMyRet || spRet !== planSpRet
    || claimMe !== planClaimMe || claimSp !== planClaimSp
    || savingsMoved || acctAdjCount > 0 || spend !== planSpend
    || rothOn !== rothConversionIsPlanned(personalInfo)
    || survivorOn !== planSurvivor || strategyMoved || !qcdOn
    || convMode !== 'plan' || wdFill !== 'plan' || wdOrder !== 'plan' || ltcChoice !== 'plan'
    || streamAdjCount > 0;

  const scenario = useMemo(() => {
    if (!touched) return null;
    try {
      const sc = sandboxScenario({ pi: personalInfo, accts: accounts, streams: incomeStreams }, {
        myRetirementAge: myRet !== planMyRet ? myRet : undefined,
        spouseRetirementAge: married && spRet !== planSpRet ? spRet : undefined,
        claimAges: { me: claimMe !== planClaimMe ? claimMe : undefined,
                     spouse: married && claimSp !== planClaimSp ? claimSp : undefined },
        savings: savingsMoved && baseEarned > 0
          ? { targetDollars: (savingsRate / 100) * baseEarned, currentPersonal: basePersonal }
          : undefined,
        accountAdjustments: acctAdjCount ? acctAdj : undefined,
        desiredRetirementIncome: spend !== planSpend ? spend : undefined,
        rothConversions: rothOn === rothConversionIsPlanned(personalInfo) ? undefined : rothOn,
        // A bracket only means anything while conversions are on; switching them
        // off and naming a bracket in the same breath is a contradiction, and
        // the switch is the blunter instrument, so it wins.
        rothConversionBracket: (rothOn && convMode === 'bracket') ? convBracketPick : undefined,
        rothConversionIrmaaTier: (rothOn && convMode === 'irmaa') ? convTierPick : undefined,
        rothConversionStaged: (rothOn && convMode === 'staged')
          ? { freeBracket: convBracketPick, chargedTier: convTierPick } : undefined,
        withdrawalBracketFill: wdFill === 'plan' ? undefined : (wdFill === 'off' ? '' : wdFill),
        withdrawalPriority: wdOrder === 'plan' ? undefined : WD_ORDERS[wdOrder],
        ltcModel: ltcChoice === 'plan' ? undefined : ltcChoice,
        survivorModel: married && survivorOn !== planSurvivor ? survivorOn : undefined,
        withdrawalStrategy: strategyMoved ? strategyPick : undefined,
        qcd: qcdOn ? undefined : false,
        streamAdjustments: streamAdjCount ? streamAdj : undefined,
      });
      // sc.opts carries the guardrail rule and the QCD switch: those are
      // projection options, not plan facts, and the engine keeps them apart so
      // neither looks like something the plan was edited to say.
      const proj = computeProjections(sc.pi, sc.accts, sc.streams, assets, oneTimeEvents,
        recurringExpenses, undefined, sc.opts);
      return { ...sc, proj };
    } catch (e) { return { error: e.message }; }
  }, [touched, myRet, spRet, claimMe, claimSp, savingsRate, spend, rothOn, married,
      survivorOn, strategyPick, strategyMoved, qcdOn, planSurvivor,
      convMode, convBracketPick, convTierPick, wdFill, wdOrder, ltcChoice, streamAdj, streamAdjCount,
      acctAdj, acctAdjCount, savingsMoved,
      personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses,
      planMyRet, planSpRet, planClaimMe, planClaimSp, planSpend, planSavingsRate,
      baseEarned, basePersonal]);

  const live = (scenario && !scenario.error) ? scenario.proj : projections;
  const liveRetAge = (scenario && !scenario.error) ? (scenario.pi.myRetirementAge || planMyRet) : planMyRet;
  const previewing = live !== projections;

  // What the account edits add up to, measured exactly as planSavingsRate is,
  // so the (locked) slider shows the rate the edits produce.
  const editedSavingsRate = useMemo(() => {
    if (!acctAdjCount || !scenario || scenario.error || !(baseEarned > 0)) return null;
    const row = scenario.proj.find(p => p.myAge === personalInfo.myAge) || scenario.proj[0];
    const per = (row && row.perAccountContributions) || {};
    const mine = (scenario.accts || []).reduce((sum, a) => sum + myContribShare(a, per[a.id] || 0), 0);
    return (mine / baseEarned) * 100;
  }, [acctAdjCount, scenario, baseEarned, personalInfo.myAge]);
  // The bridge, plan against what-if: the saver's own dollars this year, the
  // taxable money waiting at retirement, and the early-withdrawal penalties
  // paid over the whole plan — the figure a working bridge drives to zero.
  const bridge = useMemo(() => {
    const brokAt = (proj, age) => ((proj || []).find(p => p.myAge === age) || {}).brokerageBalance || 0;
    const penalties = (proj) => (proj || []).reduce((sum, p) => sum + (p.earlyWithdrawalPenalty || 0), 0);
    const saved = (accts) => (accts || []).reduce((sum, a) => sum + employeeDollarsOf(a, salariesNow), 0);
    const sc = (scenario && !scenario.error) ? scenario : null;
    return {
      planSaved: saved(accounts), nowSaved: saved(sc ? sc.accts : accounts),
      planBrok: brokAt(projections, planMyRet), nowBrok: brokAt(live, liveRetAge),
      planPen: penalties(projections), nowPen: penalties(live),
    };
  }, [accounts, scenario, projections, live, planMyRet, liveRetAge, salariesNow]);

  const resetAll = () => setSandboxConfig(prev => ({ ...(prev || {}), controls: {} }));

  // ── From experiment to decision ──────────────────────────────────────────
  // The Scenarios tab could only ever save the plan as it already was, which
  // meant you had to APPLY a change before you could save it as an alternative
  // to the change. Here the plan being saved is the one the controls compose,
  // so an experiment can be kept without touching the baseline first.
  const composedPlan = () => {
    const sc = (scenario && !scenario.error) ? scenario : null;
    return {
      personalInfo: sc ? sc.pi : personalInfo,
      accounts: sc ? sc.accts : accounts,
      incomeStreams: sc ? sc.streams : incomeStreams,
      assets, oneTimeEvents, recurringExpenses,
    };
  };
  const [scenarioName, setScenarioName] = useState('');
  const saveAsScenario = () => {
    const name = scenarioName.trim();
    if (!name) return;
    createScenarioFrom(name, composedPlan());
    setScenarioName('');
    // Show the list, or the scenario just saved vanishes into a panel that is
    // not on screen and the click reads as having done nothing.
    setSandboxConfig(prev => {
      const list = Array.isArray(prev?.panels) ? prev.panels : DEFAULT_DASHBOARD_PANELS;
      return list.includes('scenarios') ? prev : { ...(prev || {}), panels: [...list, 'scenarios'] };
    });
  };
  const [confirmBaseline, setConfirmBaseline] = useState(false);
  // Session-only: the banner should stop nagging once acknowledged, but must come
  // back next visit while real numbers are still missing.
  const [estimatesDismissed, setEstimatesDismissed] = useState(false);
  // Which panel's explainer is open. The registry used to hand its panels a
  // no-op here, so the ⓘ buttons on Coast FIRE and Lifestyle vs Legacy did
  // nothing anywhere but the old Dashboard.
  const [openInfoCard, setOpenInfoCard] = useState(null);
  const toggleInfoCard = useCallback((id) => setOpenInfoCard(prev => prev === id ? null : id), []);
  // The year the Year by year timeline has selected, in a store the timeline
  // and the two charts subscribe to (see makeFocusStore). Null until the reader
  // picks one, which they read as the retirement year. With the timeline hidden
  // the charts get no store, so neither the cursor nor the click.
  const focusStore = useMemo(makeFocusStore, []);

  // Built from whatever the levers compose — the plan itself while none is
  // moved — so a panel never needs to know whether it is drawing a what-if.
  const sandboxCtx = useMemo(() => ({
    ...buildPanelCtx({
      projections: live,
      personalInfo: (scenario && !scenario.error) ? scenario.pi : personalInfo,
      accounts: (scenario && !scenario.error) ? scenario.accts : accounts,
      incomeStreams: (scenario && !scenario.error) ? scenario.streams : incomeStreams,
      assets, oneTimeEvents, recurringExpenses, computeProjections,
      retirementAge: liveRetAge,
    }),
    openInfoCard, toggleInfoCard,
    focus: panels.includes('yearByYear') ? focusStore : null,
  }), [live, scenario, personalInfo, accounts, incomeStreams, assets, oneTimeEvents,
       recurringExpenses, liveRetAge, openInfoCard, toggleInfoCard, focusStore, panels]);

  // The plan the health card judges: whatever the page is showing.
  const healthPlan = useMemo(() => {
    const sc = (scenario && !scenario.error) ? scenario : null;
    return { pi: sc ? sc.pi : personalInfo, accts: sc ? sc.accts : accounts,
             streams: sc ? sc.streams : incomeStreams, assets, events: oneTimeEvents, recurring: recurringExpenses };
  }, [scenario, personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses]);
  // This year's to-dos, from the same builder as the Next 12 Months report.
  const nextActions = useMemo(
    () => buildNextYearActions(live, healthPlan.pi, healthPlan.accts, healthPlan.streams),
    [live, healthPlan]);

  // The shared charts take a badge node; it marks every panel drawing a
  // what-if, so no chart on the page can be mistaken for the saved plan.
  const whatIfBadge = (
    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/40 whitespace-nowrap">
      what-if
    </span>
  );

  // ── measurements, taken the same way on both plans so a delta means something
  const measure = (proj, retAge) => {
    if (!proj || !proj.length) return null;
    const last = proj[proj.length - 1];
    const short = planShortfall(proj, { retirementAge: retAge });
    return {
      atRetirement: (proj.find(p => p.myAge === retAge) || {}).totalPortfolio || 0,
      // The LAST row, which is not the planning age: the projection runs to
      // cover a younger spouse, so this can sit years past it. The Dashboard's
      // Legacy tile reads the planning age instead, and the two were showing
      // millions apart with neither saying which year it meant.
      ending: last.totalPortfolio || 0,
      endingAge: last.myAge,
      lifetimeTax: proj.reduce((s, p) => s + (p.totalTax || 0), 0),
      conversions: proj.reduce((s, p) => s + (p.rothConversion || 0), 0),
      fails: !!short.fails, depletedYear: short.depletedYear || null,
    };
  };
  const nowM = measure(projections, planMyRet);
  const thenM = previewing ? measure(live, liveRetAge) : null;

  const chartData = useMemo(() => live.map(p => ({
    age: p.myAge,
    portfolio: Math.round(p.totalPortfolio || 0),
    netWorth: Math.round(p.totalNetWorth || p.totalPortfolio || 0),
    preTax: Math.round(p.preTaxBalance || 0),
    roth: Math.round(p.rothBalance || 0),
    brokerage: Math.round(p.brokerageBalance || 0),
    hsa: Math.round(p.hsaBalance || 0),
    spending: Math.round(p.desiredIncome || 0),
    guaranteed: Math.round(p.totalGuaranteedIncome || 0),
    earned: Math.round(p.earnedIncome || 0),
    withdrawal: Math.round(p.portfolioWithdrawal || 0),
    federal: Math.round(p.federalTax || 0),
    state: Math.round(p.stateTax || 0),
    fica: Math.round(p.ficaTax || 0),
    conversion: Math.round(p.rothConversion || 0),
    wdRate: (p.totalPortfolio > 0 && p.myAge >= liveRetAge)
      ? +(((p.portfolioWithdrawal || 0) / p.totalPortfolio) * 100).toFixed(2) : null,
  })), [live, liveRetAge]);

  const money = (v) => formatCurrency(v);
  const axisMoney = (v) => `$${Math.round(v / 1000)}K`;
  const tip = { contentStyle: { background: THEME.surface, border: `1px solid ${THEME.grid}`,
                                borderRadius: 8, fontSize: 12, color: THEME.inkPrimary } };

  const panelOn = (id) => panels.includes(id);
  // A panel hidden from its own header leaves a one-line note in its place for
  // the rest of the visit, with a button that brings it straight back. Before
  // this the way back was the Panels picker at the top of the page, named only
  // in the Hide button's tooltip — a panel hidden by accident looked gone.
  const [justHidden, setJustHidden] = useState([]);
  const hidePanel = (id) => {
    if (panelOn(id)) togglePanel(id);
    setJustHidden(prev => (prev.includes(id) ? prev : [...prev, id]));
  };
  const showPanelAgain = (id) => {
    if (!panelOn(id)) togglePanel(id);
    setJustHidden(prev => prev.filter(x => x !== id));
  };
  const hiddenNote = (id) => (justHidden.includes(id) && !panelOn(id)
    ? <HiddenPanelNote key={'hidden-' + id} label={panelLabel(id)} onShow={() => showPanelAgain(id)}
        onDismiss={() => setJustHidden(prev => prev.filter(x => x !== id))} />
    : null);

  // Everything moved, in words, for the header while the card is folded.
  const leverSummary = [
    myRet !== planMyRet && `${married ? 'I retire' : 'retire'} at ${myRet}`,
    married && spRet !== planSpRet && `spouse retires at ${spRet}`,
    claimMe !== planClaimMe && `${married ? 'I claim' : 'claim'} SS at ${claimMe}`,
    married && claimSp !== planClaimSp && `spouse claims at ${claimSp}`,
    Math.abs(savingsRate - planSavingsRate) > 0.05 && `save ${savingsRate.toFixed(1)}%`,
    spend !== planSpend && `spend ${money(spend)}/yr`,
    ...strategySummary, ...streamSummary, ...acctSummary,
  ].filter(Boolean);
  const pickerOpen = !!cfg.pickerOpen;
  // Values the Guided Setup filled from a benchmark rather than from the user.
  // Surfaced here because this is where someone judges their plan — the moment
  // to know which numbers are still ours. Dismissing hides the banner for the
  // session; entering a real number is what removes it for good.
  const estimated = (personalInfo.estimatedFields || []).filter(f => ESTIMATE_LABELS[f]);

  // ── Views: named panel arrangements ──────────────────────────────────────
  // Stored alongside the panels in sandboxConfig, so they travel with the plan
  // and with an export. A view is a LAYOUT, not a scenario: it says which panels
  // to draw, and deliberately says nothing about the control positions, so
  // switching to "Tax view" while a retirement age is dragged keeps the drag.
  const allPanelIds = useMemo(
    () => [...PANEL_REGISTRY.map(e => e.id), ...SANDBOX_EXTRA_PANELS.map(e => e.id)], []);
  const views = Array.isArray(cfg.views) ? cfg.views : [];
  const [viewName, setViewName] = useState('');

  // ── The pinned strip ────────────────────────────────────────────────────
  // The card used to stay pinned whole while open or while a what-if was on:
  // 494 px of it, three times that with its drawers open, covering the page it
  // was there to steer. Now it scrolls away like anything else, and once it
  // has, a one-line strip takes its place at the top of the screen: what has
  // changed, the way back to the plan, and the sliders on demand, for moving
  // one while watching a chart.
  const leversRef = useRef(null);
  const [leversPassed, setLeversPassed] = useState(false);
  const [stripSliders, setStripSliders] = useState(false);
  useEffect(() => {
    const el = leversRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setLeversPassed(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const showAllPanels = () => setSandboxConfig(prev => ({ ...(prev || {}), panels: allPanelIds }));
  const applyView = (v) => setSandboxConfig(prev => ({ ...(prev || {}), panels: [...v.panels] }));
  const saveView = () => {
    const name = viewName.trim();
    if (!name || !panels.length) return;
    setSandboxConfig(prev => {
      const list = Array.isArray(prev?.views) ? prev.views : [];
      // Same name replaces rather than duplicating — "save" on a name you already
      // used means update it, which is what every other tool means by it.
      const next = list.filter(v => v.name !== name).concat([{ name, panels: [...panels] }]);
      return { ...(prev || {}), views: next };
    });
    setViewName('');
  };
  const deleteView = (name) => setSandboxConfig(prev => ({
    ...(prev || {}), views: (prev?.views || []).filter(v => v.name !== name) }));

  // The five sliders, built once: the card shows them, and so does the pinned
  // strip when its reader asks for them.
  const sliderRow = (
    <div className="flex flex-wrap gap-x-6 gap-y-4">
      <SandboxSlider label={married ? 'My retirement age' : 'Retirement age'} value={myRet}
              onChange={v => setControl('myRetirementAge', v)}
              min={Math.max(45, (personalInfo.myAge || 0) + 1)} max={80} planValue={planMyRet} />
      {married && (
        <SandboxSlider label="Spouse retirement age" value={spRet}
                onChange={v => setControl('spouseRetirementAge', v)}
                min={Math.max(45, (personalInfo.spouseAge || 0) + 1)} max={80} planValue={planSpRet} />
      )}
      <SandboxSlider label={married ? 'My SS claim age' : 'SS claim age'} value={claimMe}
              onChange={v => setControl('claimMe', v)} min={62} max={70} planValue={planClaimMe} />
      {married && (
        <SandboxSlider label="Spouse SS claim age" value={claimSp}
                onChange={v => setControl('claimSpouse', v)} min={62} max={70} planValue={planClaimSp} />
      )}
      <SandboxSlider label="Savings rate while working"
              value={+(acctAdjCount && editedSavingsRate !== null ? editedSavingsRate : acctAdjCount ? planSavingsRate : savingsRate).toFixed(1)}
              onChange={v => setControl('savingsRate', v)} min={0} max={60} step={0.5}
              planValue={+planSavingsRate.toFixed(1)} suffix="%"
              disabled={acctAdjCount > 0}
              note={acctAdjCount > 0 ? 'set by your account edits below' : null} />
      <SandboxSlider label="Spending in retirement (after tax)" value={spend}
              onChange={v => setControl('spending', v)} min={0}
              max={Math.max(300000, Math.round((planSpend || 100000) * 2))} step={2500}
              planValue={planSpend} format={money}
              disabled={pickLeadsWithdrawal}
              note={pickLeadsWithdrawal ? `set by the ${strategyLabel(strategyPick)} strategy` : null} />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Offer the tour rather than launching it. Kept to a single slim line so
          that a first-time user who also has estimates outstanding gets a nudge,
          not a wall of banners. */}
      {showTourOffer && (
        <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 bg-sky-500/5 border border-sky-500/25 rounded-lg">
          <span className="text-sm text-slate-300 flex-1 min-w-[14rem]">
            New here? A one-minute tour explains what each tab answers.
          </span>
          <button onClick={onTakeTour}
            className="px-3 py-1.5 text-xs font-medium bg-sky-700 hover:bg-sky-600 text-white rounded-lg transition-colors">
            Take the tour
          </button>
          <button onClick={onDismissTour}
            className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            title="You can still start it any time from the sidebar">
            No thanks
          </button>
        </div>
      )}

      {estimated.length > 0 && !estimatesDismissed && (
        <div className="p-4 bg-amber-500/5 border border-amber-500/30 rounded-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="text-sm font-semibold text-amber-300">
                {estimated.length} {estimated.length === 1 ? 'number is' : 'numbers are'} still our estimate
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
                Setup filled these from typical figures for your age and income so you could see a plan straight away.
                They're reasonable, but they aren't yours — swap in real numbers and everything below sharpens up.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {estimated.map(f => (
                  <button key={f} onClick={() => setActiveTab && setActiveTab(ESTIMATE_TAB(f))}
                    className="px-2 py-1 rounded text-[11px] bg-slate-800 text-slate-300 border border-slate-700 hover:border-amber-500/50 hover:text-amber-300 transition-colors"
                    title={`Fix this on the ${ESTIMATE_TAB(f)} tab`}>
                    {ESTIMATE_LABELS[f]} →
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => setEstimatesDismissed(true)}
              className="shrink-0 text-xs text-slate-500 hover:text-slate-300 px-2 py-1"
              title="Hide until next visit">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {onShowEverything && <HiddenSettingsNotice pi={personalInfo} onShowEverything={onShowEverything} />}

      {/* ── Is it on track, and what to do ─────────────────────────────── */}
      <PlanHealthCard
        plan={healthPlan}
        opts={(scenario && !scenario.error) ? scenario.opts : undefined}
        currentYearReturn={currentYearReturn}
        live={live}
        isWhatIf={previewing}
        actions={nextActions}
        onTrySpending={(v) => { setCfg({ leversOpen: true }); setControl('spending', v); }}
        onTryRetireAge={(a) => { setCfg({ leversOpen: true }); setControl('myRetirementAge', a); }}
        onOpenWillItLast={() => setActiveTab && setActiveTab('montecarlo')}
      />

      {/* ── The what-if levers ─────────────────────────────────────────── */}
      {/* Scrolls with the page. While it is doing something — open, or folded
          with a lever moved — the strip below stands in for it once it is out
          of sight, so no chart can be mistaken for the plan. */}
      <div data-tour="whatif-levers" ref={leversRef}
           className={previewing
             ? swapClass(swapClass(cardStyle, 'border-slate-700/50', 'border-amber-500/40'), 'backdrop-blur-sm', 'backdrop-blur-md') + ' bg-slate-900/45'
             : cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => setCfg({ leversOpen: !leversOpen })} aria-expanded={leversOpen}
            className="flex items-center gap-2 text-left min-w-0 flex-1">
            <span className="text-xs text-slate-500">{leversOpen ? '▾' : '▸'}</span>
            <span className="text-lg font-semibold text-slate-100 whitespace-nowrap">What if…</span>
            {!leversOpen && (leverSummary.length > 0
              ? <span className="text-sm text-amber-400/90 truncate">{leverSummary.join(' · ')}</span>
              : <span className="text-sm text-slate-500 truncate">
                  retire earlier, spend more, claim later, change strategy — try it without touching your plan
                </span>)}
          </button>
          <div className="flex items-center gap-2">
            {previewing && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/40 whitespace-nowrap">
                showing a what-if, not your plan
              </span>
            )}
            {touched && <button className={buttonSecondary} onClick={resetAll}>Back to my plan</button>}
          </div>
        </div>
        {leversOpen && (<>
        <p className="text-xs text-slate-500 mt-2 mb-3">
          Nothing here changes your saved plan. Every control follows the plan until you move it, and
          everything on this page then describes the same what-if. Save it as a scenario to keep it, or make it
          the plan.
        </p>
        {sliderRow}

        {/* ── Strategy drawer ─────────────────────────────────────────── */}
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <button
            onClick={() => setCfg({ strategyOpen: !strategyOpen })}
            aria-expanded={strategyOpen}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <span className="text-[10px] text-slate-500">{strategyOpen ? '▾' : '▸'}</span>
            <span className="uppercase tracking-wide">Strategy</span>
            {!strategyOpen && strategySummary.length > 0 && (
              <span className="text-amber-400/90 normal-case">{strategySummary.join(' · ')}</span>
            )}
            {!strategyOpen && strategySummary.length === 0 && (
              <span className="text-slate-600 normal-case">following your plan</span>
            )}
          </button>
        </div>

        {strategyOpen && (
        <div className="flex flex-wrap gap-x-6 gap-y-4 mt-3">
          <SandboxSwitch
            label="Roth conversions" on={rothOn} onChange={v => setControl('rothOn', v)}
            planLabel={`plan: ${rothConversionIsPlanned(personalInfo) ? 'on' : 'off'}`}
            note={!rothConversionIsPlanned(personalInfo) && rothOn
              ? 'set a strategy on Taxes & Roth first' : null} />

          {/* The conversion strategy: a mode, then the arguments that mode
              takes. Three targets that need different arguments do not belong
              in one flat row, and the two-stage schedule needs a bracket AND a
              tier at once, which no single row can express. A bracket top is
              TAXABLE income and an IRMAA edge is MAGI — different bases, which
              is exactly why filling a bracket can sail past an edge and buy a
              surcharge for nothing, and why the staged option exists. */}
          <div className="min-w-[420px] flex-1 space-y-2">
            <SandboxChoice
              label="Roth conversion strategy"
              value={convMode}
              disabled={!rothOn}
              onChange={v => setControl('convMode', v)}
              options={[
                { value: 'plan', label: 'Plan' },
                { value: 'bracket', label: 'Fill a bracket', title: 'Fill to the top of one tax bracket every year of the conversion window' },
                { value: 'irmaa', label: 'Hold an IRMAA tier', title: 'Keep MAGI under one IRMAA ceiling every year' },
                { value: 'staged', label: 'Bracket → IRMAA', title: `Fill a bracket while Medicare cannot see the income (through age ${hingeAge}), then hold a tier` },
              ]}
              planLabel={planConvLabel}
              note={!rothOn ? 'conversions are off'
                : convMode !== 'plan' ? 'replaces the plan’s conversion strategy' : null} />

            {rothOn && (convMode === 'bracket' || convMode === 'staged') && (
              <SandboxChoice
                label={convMode === 'staged'
                  ? `1 · Through age ${hingeAge}, fill to the top of`
                  : 'Fill to the top of'}
                value={convBracketPick}
                onChange={v => setControl('convBracket', v)}
                options={['12%', '22%', '24%', '32%'].map(b => ({ value: b, label: b }))}
                planLabel={convMode === 'staged'
                  ? 'these years never reach an IRMAA calculation, so the ceiling is a bracket'
                  : 'every year of the conversion window'} />
            )}

            {rothOn && (convMode === 'irmaa' || convMode === 'staged') && (
              <SandboxChoice
                label={convMode === 'staged'
                  ? `2 · From age ${hingeAge + 1} on, hold MAGI under`
                  : 'Hold MAGI under'}
                value={convTierPick}
                onChange={v => setControl('convTier', v)}
                options={irmaaChoices}
                planLabel={convMode === 'staged'
                  ? `from here a year’s MAGI sets the premium at ${hingeAge + 1 + IRMAA_TIER_LOOKBACK_YEARS}, so the ceiling is a tier`
                  : 'every year of the conversion window'} />
            )}
          </div>

          <SandboxChoice
            label="Spend pre-tax up to"
            value={wdFill}
            onChange={v => setControl('withdrawalBracketFill', v)}
            options={[
              { value: 'plan', label: 'Plan' },
              { value: 'off', label: 'Off' },
              { value: '12%', label: '12%', title: 'Draw pre-tax until taxable income reaches the top of the 12% bracket, then follow the order below' },
              { value: '22%', label: '22%' },
              { value: '24%', label: '24%' },
            ]}
            planLabel={planFill ? `plan: fill ${planFill}` : 'plan: off'}
            note={wdFill !== 'plan' && wdFill !== 'off' && convMode === 'bracket'
              && ['12%', '22%', '24%', '32%'].indexOf(wdFill) >= ['12%', '22%', '24%', '32%'].indexOf(convBracketPick)
              ? 'at or above the conversion bracket — spending will leave it nothing to fill' : null} />

          <SandboxChoice
            label="Spend accounts in this order"
            value={wdOrder}
            onChange={v => setControl('withdrawalOrder', v)}
            options={[
              { value: 'plan', label: 'Plan' },
              { value: 'pretax', label: 'Pre-tax first', title: 'Pre-tax → brokerage → Roth' },
              { value: 'brokerage', label: 'Brokerage first', title: 'Brokerage → pre-tax → Roth' },
              { value: 'roth', label: 'Roth first', title: 'Roth → brokerage → pre-tax' },
            ]}
            planLabel={planOrderLabel}
            note={wdOrder !== 'plan' && wdOrder === planOrderKey ? 'same as your plan' : null} />

          <SandboxChoice
            label="Long-term care"
            value={ltcChoice}
            onChange={v => setControl('ltcModel', v)}
            options={[
              { value: 'plan', label: 'Plan' },
              { value: 'none', label: 'None' },
              { value: 'default', label: '28 months', title: 'The average: 28 months of assisted living for each of you' },
              { value: 'stress', label: '5-yr stress', title: 'Five years of nursing-home care for whichever of you lives longer, and none for the other' },
            ]}
            planLabel={`plan: ${LTC_WORDS[planLtc] || planLtc}`}
            note={ltcChoice === 'stress' ? 'the tail long-term care insurance exists for' : null} />

          <SandboxSwitch
            label="Survivor modelling" on={married && survivorOn}
            onChange={v => setControl('survivorOn', v)} disabled={!married}
            planLabel={married ? `plan: ${planSurvivor ? 'on' : 'off'}` : 'single filer'}
            note={married ? null : 'nothing to model'} />

          <div className="min-w-[220px]">
            <label className="text-xs text-slate-400 block mb-1.5">Withdrawal strategy</label>
            <select value={strategyPick}
              onChange={e => { setControl('withdrawalStrategy', e.target.value); setControl('guardrailsOn', undefined); }}
              aria-label="Withdrawal strategy"
              className={`px-2 py-1.5 rounded-lg border text-sm bg-slate-800 ${strategyMoved ? 'border-amber-500/50 text-amber-300' : 'border-slate-600 text-slate-200'}`}>
              {WITHDRAWAL_STRATEGY_CHOICES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <div className="text-[11px] text-slate-500 mt-1">
              plan: {strategyLabel(planStrategy)}
              {strategyPick === 'guardrails' && <span> · acts when markets differ from the plan — see the plan-health check</span>}
              {pickLeadsWithdrawal && <span> · sets your spending; the slider above steps aside</span>}
            </div>
          </div>

          <SandboxSwitch
            label="Qualified charitable distributions" on={givingPct > 0 && qcdOn}
            onChange={v => setControl('qcdOn', v)} disabled={!(givingPct > 0)}
            planLabel={givingPct > 0 ? `giving ${givingPct}% of spending` : 'no charitable giving set'}
            note={givingPct > 0 ? null : 'set a % on Personal Info'} />
        </div>
        )}

        {/* ── Accounts drawer ───────────────────────────────────────────── */}
        {editableAccounts.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-700/50">
            <button
              onClick={() => setCfg({ accountsOpen: !accountsOpen })}
              aria-expanded={accountsOpen}
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              <span className="text-[10px] text-slate-500">{accountsOpen ? '▾' : '▸'}</span>
              <span className="uppercase tracking-wide">Accounts</span>
              {!accountsOpen && acctSummary.length > 0 && (
                <span className="text-amber-400/90 normal-case">{acctSummary.join(' · ')}</span>
              )}
              {!accountsOpen && acctSummary.length === 0 && (
                <span className="text-slate-600 normal-case">following your plan</span>
              )}
            </button>

            {accountsOpen && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-slate-500">
                  Change what you put into each account and when it stops — for example, less into a 401(k) and more
                  into brokerage to build a bridge to an early retirement. Your employer’s match stays as your plan has
                  it. Nothing changes in your plan until you save a scenario or make this the plan.
                </p>
                {/* The three numbers the bridge question turns on, plan → what-if. */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  {[['You save each year', bridge.planSaved, bridge.nowSaved, null],
                    [`Brokerage at retirement (age ${liveRetAge})`, bridge.planBrok, bridge.nowBrok, true],
                    ['Early-withdrawal penalties, whole plan', bridge.planPen, bridge.nowPen, false]].map(([label, was, now, upIsGood]) => {
                    const d = now - was;
                    const cls = Math.abs(d) < 1 || upIsGood === null ? 'text-slate-200'
                      : ((d > 0) === upIsGood ? 'text-emerald-400' : 'text-red-400');
                    return (
                      <div key={label} className="rounded-lg border border-slate-700/60 bg-slate-800/30 px-3 py-2">
                        <div className="text-slate-500">{label}</div>
                        <div className={`text-sm font-semibold tabular-nums ${cls}`}>{money(now)}</div>
                        <div className="text-[11px] text-slate-500 tabular-nums">
                          {Math.abs(d) < 1 ? 'same as your plan' : `plan ${money(was)}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* A bridge only works if it is drawn first. The engine follows the
                    withdrawal order literally, before 59½ as after, so with
                    pre-tax first it pays the 10% penalty on 401(k) money while the
                    brokerage account sits untouched — measured on a plan retiring
                    at 52, switching the order roughly halved the penalties. Said
                    here, with the fix one click away, because it is exactly the
                    trap this drawer is for. */}
                {bridge.nowPen > 0 && bridge.nowBrok > 0
                  && ((wdOrder === 'plan' ? planOrderArr : WD_ORDERS[wdOrder]) || [])[0] === 'pretax' && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
                    <span className="flex-1 min-w-[240px]">
                      Your withdrawal order spends pre-tax money first, even before 59½ — so the plan pays the 10%
                      penalty while the brokerage bridge waits. Drawing brokerage first is what makes a bridge work.
                    </span>
                    <button onClick={() => setControl('withdrawalOrder', 'brokerage')}
                      className="px-2.5 py-1 rounded border border-amber-500/50 text-amber-200 hover:bg-amber-500/15 transition-colors">
                      Draw brokerage first
                    </button>
                  </div>
                )}
                {savingsMoved && (
                  <p className="text-[11px] text-amber-400/90">
                    The savings-rate slider is moved. Put it back to your plan’s rate to set accounts one by one —
                    the two would otherwise both be deciding where your saving goes.
                  </p>
                )}
                {editableAccounts.map(a => {
                  const x = acctAdj[a.id] || {};
                  const plan = planEmployee(a);
                  const shown = Number.isFinite(x.employee) ? x.employee : plan;
                  const typeLabel = (ACCOUNT_TYPES.find(t => t.value === a.type) || {}).label || a.type;
                  const owner = a.owner === 'spouse' ? 'spouse' : a.owner === 'joint' ? 'joint' : 'me';
                  const isPercent = a.contributionMode === 'percent';
                  const salary = owner === 'spouse' ? salariesNow.spouse : owner === 'me' ? salariesNow.me : 0;
                  // A percent-of-salary row needs a salary to be a percent of.
                  const cannot = isPercent && !(salary > 0);
                  const locked = savingsMoved || cannot;
                  const stopShown = Number.isFinite(x.stopAge) ? x.stopAge : baseStop(a);
                  const changed = !!acctAdj[a.id];
                  const max = Math.max(60000, Math.ceil(plan * 2 / 1000) * 1000);
                  const matchPct = isPercent ? (a.employerMatchPercent || 0) : 0;
                  return (
                    <div key={a.id}
                         className={`rounded-lg border px-3 py-2 ${changed ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-700/60 bg-slate-800/30'}`}>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="min-w-[180px] flex-1">
                          <div className="text-sm font-medium text-slate-200">{a.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {typeLabel} · plan {money(plan)}/yr{isPercent && salary > 0 ? ` (${((a.employeePercent || 0) * 100).toFixed(1)}% of pay)` : ''}
                            {matchPct > 0 ? ` + ${(matchPct * 100).toFixed(1)}% match` : ''}, contributing to age {a.stopAge}
                          </div>
                        </div>
                        <label className={`flex items-center gap-2 text-xs ${locked ? 'opacity-40' : ''}`}>
                          <span className="text-slate-400">You put in</span>
                          <input type="range" min={0} max={max} step={500} value={Math.min(max, shown)} disabled={locked}
                                 aria-label={`${a.name}: your contribution per year`}
                                 onChange={e => setAcctAdj(a, { employee: Number(e.target.value) })}
                                 className="w-28 accent-amber-500" />
                          <input type="number" min={0} step={500} value={Math.round(shown)} disabled={locked}
                                 aria-label={`${a.name}: your contribution per year, dollars`}
                                 onChange={e => {
                                   const v = Number(e.target.value);
                                   if (Number.isFinite(v) && v >= 0) setAcctAdj(a, { employee: v });
                                 }}
                                 className={`w-24 bg-slate-800 border rounded px-2 py-0.5 text-right tabular-nums ${Number.isFinite(x.employee) ? 'border-amber-500/50 text-amber-300' : 'border-slate-600 text-slate-200'}`} />
                          <span className="text-slate-500">/yr</span>
                        </label>
                        <label className={`flex items-center gap-2 text-xs ${savingsMoved ? 'opacity-40' : ''}`}>
                          <span className="text-slate-400">Stops at age</span>
                          <input type="number" min={1} max={100} value={stopShown} disabled={savingsMoved}
                                 aria-label={`${a.name}: age contributions stop`}
                                 onChange={e => {
                                   const v = Number(e.target.value);
                                   if (Number.isFinite(v) && v > 0) setAcctAdj(a, { stopAge: v });
                                 }}
                                 className={`w-16 bg-slate-800 border rounded px-2 py-0.5 text-center ${Number.isFinite(x.stopAge) ? 'border-amber-500/50 text-amber-300' : 'border-slate-600 text-slate-200'}`} />
                        </label>
                        {cannot && (
                          <span className="text-[11px] text-slate-500">a percent of pay, with no salary in the plan to take it from</span>
                        )}
                        {changed && (
                          <button onClick={() => setAcctAdj(a, { employee: plan, stopAge: baseStop(a) })}
                                  className="text-[11px] text-slate-500 hover:text-slate-300 underline decoration-dotted">
                            back to plan
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Income streams drawer ─────────────────────────────────────── */}
        {(incomeStreams || []).length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-700/50">
            <button
              onClick={() => setCfg({ streamsOpen: !streamsOpen })}
              aria-expanded={streamsOpen}
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              <span className="text-[10px] text-slate-500">{streamsOpen ? '▾' : '▸'}</span>
              <span className="uppercase tracking-wide">Income streams</span>
              {/* Named while shut, like Strategy: a lever changing the numbers
                  must never be one the reader cannot see. */}
              {!streamsOpen && streamSummary.length > 0 && (
                <span className="text-amber-400/90 normal-case">{streamSummary.join(' · ')}</span>
              )}
              {!streamsOpen && streamSummary.length === 0 && (
                <span className="text-slate-600 normal-case">following your plan</span>
              )}
            </button>

            {streamsOpen && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-slate-500">
                  Test the plan without income you do not control. Switch a stream off, scale it, or end it
                  early — your plan is not changed until you save a scenario or make this the plan.
                </p>
                {(incomeStreams || []).map(st => {
                  const a = streamAdj[st.id] || {};
                  const off = !!a.off;
                  const scalePct = Math.round((Number.isFinite(a.scale) ? a.scale : 1) * 100);
                  const isSS = st.type === 'social_security';
                  // Salary's last year is the retirement-age slider's to move;
                  // a second control for the same date could contradict it.
                  const isSalary = st.type === 'earned_income';
                  const typeLabel = (INCOME_TYPES.find(t => t.value === st.type) || {}).label || st.type;
                  const endShown = Number.isFinite(a.endAge) ? a.endAge : st.endAge;
                  const changed = !!streamAdj[st.id];
                  return (
                    <div key={st.id}
                         className={`rounded-lg border px-3 py-2 ${changed ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-700/60 bg-slate-800/30'}`}>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="min-w-[180px] flex-1">
                          <div className={`text-sm font-medium ${off ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{st.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {typeLabel} · plan {money(st.amount || 0)}/yr, ages {st.startAge}–{isSS ? 'life' : st.endAge}
                          </div>
                        </div>
                        <button
                          onClick={() => setStreamAdj(st, { off: !off })}
                          aria-pressed={!off}
                          aria-label={`${st.name}: ${off ? 'excluded' : 'included'}`}
                          className={`px-3 py-1 rounded-lg border text-xs transition-colors ${off
                            ? 'bg-slate-700/50 border-slate-600 text-slate-400'
                            : 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'}`}>
                          {off ? 'Off' : 'Included'}
                        </button>
                        <label className={`flex items-center gap-2 text-xs ${off ? 'opacity-40' : ''}`}>
                          <span className="text-slate-400">Amount</span>
                          <input type="range" min={0} max={200} step={5} value={scalePct} disabled={off}
                                 aria-label={`${st.name} amount, percent of plan`}
                                 onChange={e => setStreamAdj(st, { scale: Number(e.target.value) / 100 })}
                                 className="w-28 accent-amber-500" />
                          <span className={`w-28 tabular-nums ${scalePct !== 100 ? 'text-amber-300' : 'text-slate-400'}`}>
                            {scalePct}% · {money((st.amount || 0) * scalePct / 100)}
                          </span>
                        </label>
                        {/* Social Security runs for life; its timing is the
                            claim-age slider above. Salary ends at retirement,
                            which the retirement-age sliders set. */}
                        {isSalary && (
                          <span className="text-[11px] text-slate-500">ends at retirement — use the slider above</span>
                        )}
                        {!isSS && !isSalary && (
                          <label className={`flex items-center gap-2 text-xs ${off ? 'opacity-40' : ''}`}>
                            <span className="text-slate-400">Ends at</span>
                            <input type="number" min={st.startAge} max={110} value={endShown} disabled={off}
                                   aria-label={`${st.name} last year of income, age`}
                                   onChange={e => {
                                     const v = Number(e.target.value);
                                     if (Number.isFinite(v) && v >= st.startAge) setStreamAdj(st, { endAge: v });
                                   }}
                                   className={`w-16 bg-slate-800 border rounded px-2 py-0.5 text-center ${Number.isFinite(a.endAge) ? 'border-amber-500/50 text-amber-300' : 'border-slate-600 text-slate-200'}`} />
                          </label>
                        )}
                        {changed && (
                          <button onClick={() => setStreamAdj(st, { off: false, scale: 1, endAge: st.endAge })}
                                  className="text-[11px] text-slate-500 hover:text-slate-300 underline decoration-dotted">
                            back to plan
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {scenario && scenario.error && (
          <p className="text-sm text-red-400 mt-3">Could not run that scenario: {scenario.error}</p>
        )}

        {/* ── Keep it, or commit to it ──────────────────────────────────── */}
        <div className="mt-4 pt-4 border-t border-slate-700/50 flex flex-wrap items-center gap-2">
          <input
            value={scenarioName}
            onChange={e => setScenarioName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveAsScenario(); }}
            placeholder={previewing ? 'Name this scenario' : 'Name this scenario (nothing changed yet)'}
            className="flex-1 min-w-[200px] bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100"
          />
          <button onClick={saveAsScenario} disabled={!scenarioName.trim()}
            className={`px-4 py-1.5 rounded-lg border text-sm transition-colors ${
              scenarioName.trim()
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/25'
                : 'bg-slate-800/40 border-slate-700 text-slate-600 cursor-not-allowed'}`}>
            Save as scenario
          </button>
          <span className="text-slate-700">|</span>
          {!confirmBaseline ? (
            <button onClick={() => setConfirmBaseline(true)} disabled={!previewing}
              className={`px-4 py-1.5 rounded-lg border text-sm transition-colors ${
                previewing
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 hover:bg-amber-500/25'
                  : 'bg-slate-800/40 border-slate-700 text-slate-600 cursor-not-allowed'}`}
              title={previewing ? 'Replace your saved plan with this one'
                                : 'Move a control first — this would replace your plan with itself'}>
              Make this the plan
            </button>
          ) : (
            <span className="inline-flex items-center gap-2">
              <span className="text-xs text-amber-300">Replace your saved plan?</span>
              <button onClick={() => { applyPlanAsBaseline(composedPlan()); setConfirmBaseline(false); resetAll(); }}
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-900 text-sm font-semibold hover:bg-amber-400">
                Yes, replace it
              </button>
              <button onClick={() => setConfirmBaseline(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-400 text-sm hover:text-slate-200">
                Cancel
              </button>
            </span>
          )}
          <span className="w-full text-[11px] text-slate-500">
            A scenario keeps this experiment alongside your plan without changing it.{' '}
            <strong className="text-slate-400">Make this the plan</strong> replaces the baseline every other
            tab describes — a copy is kept in Plan history first.
          </span>
        </div>
        </>)}
      </div>

      {/* The strip rides a zero-height sticky rail, so it takes no room in the
          page; the rail's own top margin is cancelled so the gap below the
          card is unchanged. */}
      {(leversOpen || touched) && (
        <div className="sticky top-2 z-30 h-0" style={{ marginTop: 0 }}>
          {leversPassed && (
            <div data-whatif-strip
              className={`absolute inset-x-0 top-0 rounded-xl border px-4 py-2 shadow-lg backdrop-blur-md bg-slate-900/90 ${
                previewing ? 'border-amber-500/40' : 'border-slate-700/60'}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-slate-100 whitespace-nowrap">What if…</span>
                <span className={`text-sm truncate min-w-0 flex-1 ${leverSummary.length ? 'text-amber-400/90' : 'text-slate-500'}`}>
                  {leverSummary.length ? leverSummary.join(' · ') : 'following your plan'}
                </span>
                <button onClick={() => setStripSliders(o => !o)} aria-expanded={stripSliders}
                  className="text-xs px-2.5 py-1 rounded border border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-700/60 whitespace-nowrap">
                  {stripSliders ? 'Hide sliders ▴' : 'Sliders ▾'}
                </button>
                <button onClick={() => { setCfg({ leversOpen: true }); leversRef.current && leversRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  className="text-xs px-2.5 py-1 rounded border border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-700/60 whitespace-nowrap"
                  title="Back up to the what-if card, with its strategy, accounts and income streams">
                  All controls ↑
                </button>
                {touched && (
                  <button onClick={resetAll}
                    className="text-xs px-2.5 py-1 rounded border border-amber-500/50 text-amber-300 hover:bg-amber-500/15 whitespace-nowrap">
                    Back to my plan
                  </button>
                )}
              </div>
              {stripSliders && <div className="mt-3 pb-1">{sliderRow}</div>}
            </div>
          )}
        </div>
      )}

      {/* ── Panel picker ───────────────────────────────────────────────── */}
      {/* Folded to one row by default: choosing panels is something done once
          in a while, and the Dashboard's own Sections strip it replaces was a
          single line too. (The basis toggle sat on this row until v2.51.0; it is
          in the top bar now, on every page.) */}
      <div className={cardStyle}>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => setCfg({ pickerOpen: !pickerOpen })} aria-expanded={pickerOpen}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
            <span className="text-xs text-slate-500">{pickerOpen ? '▾' : '▸'}</span>
            <span>Panels</span>
            <span className="text-xs text-slate-500">{panels.length} of {allPanelIds.length} shown · choose</span>
          </button>
          {!pickerOpen && views.map(v => (
            <button key={v.name} onClick={() => applyView(v)}
              className={`px-2.5 py-0.5 rounded-lg border text-xs transition-colors ${
                sameSet(v.panels, panels) ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                                          : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>
              {v.name}
            </button>
          ))}
        </div>
        {pickerOpen && (<div className="mt-3 pt-3 border-t border-slate-700/50">
        {/* Views. The panel selection already persists with the plan, so this is
            not about remembering — it is about having MORE THAN ONE arrangement.
            "Everything on" is how you find what is available; a four-panel
            layout is how you actually read a decision. Switching between them
            should not mean twenty clicks either way. */}
        <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-slate-700/50">
          <span className="text-sm text-slate-400 mr-1">Views:</span>
          {views.length === 0 && <span className="text-xs text-slate-600">none saved yet</span>}
          {views.map(v => (
            <span key={v.name} className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-800/60 overflow-hidden">
              <button onClick={() => applyView(v)}
                className={`px-3 py-1 text-xs transition-colors ${
                  sameSet(v.panels, panels) ? 'bg-amber-500/15 text-amber-300' : 'text-slate-300 hover:text-slate-100'}`}
                title={`${v.panels.length} panel${v.panels.length === 1 ? '' : 's'}`}>
                {v.name}
              </button>
              <button onClick={() => deleteView(v.name)}
                className="px-2 py-1 text-xs text-slate-600 hover:text-red-400 transition-colors"
                title={`Delete the "${v.name}" view`}>×</button>
            </span>
          ))}
          <div className="flex items-center gap-1 ml-auto">
            <input
              value={viewName}
              onChange={e => setViewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveView(); }}
              placeholder="Name this view"
              className="w-40 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100"
            />
            <button onClick={saveView} disabled={!viewName.trim() || panels.length === 0}
              className={`px-3 py-1 rounded-lg border text-xs transition-colors ${
                viewName.trim() && panels.length
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/25'
                  : 'bg-slate-800/40 border-slate-700 text-slate-600 cursor-not-allowed'}`}>
              Save view
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400 mr-1">Show:</span>
          <button onClick={showAllPanels}
            className="px-3 py-1 rounded-lg border border-slate-600 bg-slate-800/60 text-xs text-slate-300 hover:text-slate-100 transition-colors">
            All ({allPanelIds.length})
          </button>
          <button onClick={() => setSandboxConfig(prev => ({ ...(prev || {}), panels: [] }))}
            className="px-3 py-1 rounded-lg border border-slate-600 bg-slate-800/60 text-xs text-slate-300 hover:text-slate-100 transition-colors">
            None
          </button>
          <span className="text-slate-700 mx-1">|</span>
          {/* This row is also where a panel comes BACK. Hiding one from its own
              header unticks it here rather than losing it. */}
          {[...PANEL_REGISTRY.map(e => ({ id: e.id, label: e.label })), ...SANDBOX_EXTRA_PANELS].map(p => (
            <button key={p.id} onClick={() => togglePanel(p.id)}
              className={`px-3 py-1 rounded-lg border text-xs transition-colors ${
                panelOn(p.id) ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                              : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-slate-200'}`}>
              {p.label}
            </button>
          ))}
        </div>
        </div>)}
      </div>

      {/* ── Panels ─────────────────────────────────────────────────────── */}
      {/* Drawn only while a lever is moved. With nothing moved they were the
          plan's own figures, a second copy of the summary cards beside them. */}
      {panelOn('kpis') && thenM && (
        <div>
          <div className="flex justify-end mb-1">
            <button onClick={() => hidePanel('kpis')}
              className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
              title="Hide these — a note stays here to bring them back, and so does the Panels picker above">
              Hide
            </button>
          </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[['Portfolio at retirement', nowM.atRetirement, thenM && thenM.atRetirement, true],
            [`Ending portfolio (age ${nowM.endingAge})`, nowM.ending, thenM && thenM.ending, true],
            ['Lifetime tax, all years', nowM.lifetimeTax, thenM && thenM.lifetimeTax, false],
            ['Converted to Roth', nowM.conversions, thenM && thenM.conversions, null]].map(([label, a, b, up]) => {
            const d = (b === null || b === undefined) ? null : b - a;
            const cls = d === null || Math.abs(d) < 1 || up === null ? 'text-slate-500'
              : ((d > 0) === up ? 'text-emerald-400' : 'text-red-400');
            return (
              <div key={label} className={cardStyle}>
                <div className="text-xs text-slate-500">{label}</div>
                <div className="text-slate-100 font-bold text-lg">{money(b === null || b === undefined ? a : b)}</div>
                {/* A delta of nothing is not information — an unchanged figure
                    should look unchanged, not carry a "$0" that reads at a
                    glance like a real result. */}
                {d !== null && Math.abs(d) >= 1 && (
                  <div className={`text-xs ${cls}`}>{d > 0 ? '+' : '−'}{money(Math.abs(d))}</div>
                )}
              </div>
            );
          })}
          <div className={cardStyle}>
            <div className="text-xs text-slate-500">Money lasts</div>
            <div className={`font-bold text-lg ${(thenM || nowM).fails ? 'text-red-400' : 'text-emerald-400'}`}>
              {/* depletedYear is a projection ROW, not a number — every other
                  reader of it takes .myAge, and this one interpolated the row
                  itself, which rendered as "[object Object]" in the one tile a
                  reader looks at to find out whether the plan survives. */}
              {(thenM || nowM).fails
                ? `Runs out at ${((thenM || nowM).depletedYear || {}).myAge != null
                    ? 'age ' + (thenM || nowM).depletedYear.myAge : 'some point'}`
                : 'Through the plan'}
            </div>
            {thenM && thenM.fails !== nowM.fails && (
              <div className={`text-xs ${thenM.fails ? 'text-red-400' : 'text-emerald-400'}`}>
                {thenM.fails ? 'was fine before' : 'fixes the shortfall'}
              </div>
            )}
          </div>
        </div>
        </div>
      )}

      {/* Everything the app can draw, drawn by the app's own components. A
          change to any of these lands on the Dashboard and here at once, which
          is the entire reason they were extracted. */}
      {hiddenNote('kpis')}
      {PANEL_REGISTRY.filter(e => panelOn(e.id) || justHidden.includes(e.id)).map(e => (
        <React.Fragment key={e.id}>
          {panelOn(e.id)
            ? e.render(sandboxCtx, previewing ? whatIfBadge : null, () => hidePanel(e.id))
            : hiddenNote(e.id)}
        </React.Fragment>
      ))}

      {hiddenNote('balances')}
      {panelOn('balances') && ResponsiveContainer && (
        <PanelCard title="Balances by tax treatment" badge={previewing ? whatIfBadge : null} onHide={() => hidePanel('balances')}>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={THEME.grid} />
              <XAxis dataKey="age" stroke={THEME.axis} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={axisMoney} stroke={THEME.axis} tick={{ fontSize: 11 }} />
              <Tooltip {...tip} formatter={(v) => money(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="preTax" name="Pre-tax" stackId="b" fill={SERIES.preTax} />
              <Bar dataKey="roth" name="Roth" stackId="b" fill={SERIES.roth} />
              <Bar dataKey="brokerage" name="Brokerage" stackId="b" fill={SERIES.brokerage} />
              {chartData.some(d => d.hsa > 0) && <Bar dataKey="hsa" name="HSA" stackId="b" fill={SERIES.hsa} />}
            </ComposedChart>
          </ResponsiveContainer>
        </PanelCard>
      )}

      {/* A "Roth conversions by year" bar chart used to sit here. It plotted
          rothConversion per year and nothing else — which the income-vs-spending
          chart above already stacks, as a translucent outlined segment in the
          same SERIES.rothConversion colour, in the context of the income it is
          competing with. A second chart of one series is a legend, not a view. */}

      {hiddenNote('changes')}
      {panelOn('changes') && (
        <PanelCard title="What the controls changed" onHide={() => hidePanel('changes')}>
          {!previewing ? (
            <p className="text-sm text-slate-400">Nothing yet — every control is following your plan.</p>
          ) : scenario.moved.length === 0 ? (
            <p className="text-sm text-slate-400">
              The controls you moved change the plan's numbers without moving any dates.
            </p>
          ) : (
            <p className="text-xs text-slate-400 leading-relaxed">
              {/* The savings slider's placements carry no from/to (they are
                  shares of one total), so they stay out; an account edit has
                  both and is shown like any other change. */}
              {scenario.moved.filter(m => m.field !== 'contribution' || (m.from != null && m.to != null)).map((m, i) => (
                <span key={i} className="whitespace-nowrap">
                  {i > 0 && <span className="text-slate-600"> · </span>}
                  <span className="text-slate-300">{m.name}</span>
                  <span className="text-slate-500">{' '}{m.field === 'endAge' ? 'last yr'
                    : m.field === 'startAge' ? 'starts' : m.field === 'stopAge' ? 'stop'
                    : m.field === 'contribution' ? 'you put in' : m.field}{' '}</span>
                  <span className="text-slate-400">{m.from}→{m.to}</span>
                </span>
              ))}
            </p>
          )}
          <p className="text-[11px] text-slate-500 mt-2">
            Social Security claim ages move only when you move them — retiring at one age and claiming at
            another is a real and often good choice, so the two are never chained together here.
          </p>
        </PanelCard>
      )}

      {/* The Scenarios tab, folded in. It compares against the SAVED plan rather
          than the composed one, which is deliberate: a scenario is an
          alternative to the baseline, and the baseline is what it has to be
          measured against. */}
      {hiddenNote('scenarios')}
      {panelOn('scenarios') && (
        <ScenarioComparisonPanel
          activeScenarioId={activeScenarioId}
          assets={assets}
          computeProjections={computeProjections}
          deleteScenario={deleteScenario}
          loadScenario={loadScenario}
          oneTimeEvents={oneTimeEvents}
          personalInfo={personalInfo}
          projections={projections}
          recurringExpenses={recurringExpenses}
          scenarios={scenarios}
          onHide={() => hidePanel('scenarios')}
        />
      )}
    </div>
  );
}

