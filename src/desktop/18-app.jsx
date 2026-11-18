function RetirementPlanner() {
  const [activeTab, setActiveTab] = useState('dashboard');
  // Which of the three "Will it last?" questions is open. Held here rather than
  // in the tab so leaving and coming back returns to the same one.
  const [lastingView, setLastingView] = useState('montecarlo');
  // The palette switch is done by applyThemeMode BEFORE setState, so the single
  // re-render this triggers already reads the new values. Doing it in an effect
  // would paint one frame of the old chart colours against the new surface.
  const [themeMode, setThemeMode] = useState(initialThemeMode);
  const [themeOpen, setThemeOpen] = useState(false);
  const chooseTheme = (next) => {
    applyThemeMode(next);
    setThemeMode(PlannerTheme.normalizeChoice(next));
  };
  const themeChoice = PlannerTheme.CHOICES.find(c => c.id === themeMode) || PlannerTheme.CHOICES[0];
  const [contentWidth, setContentWidth] = useState(initialContentWidth);
  const [widthOpen, setWidthOpen] = useState(false);
  // Mirrors applyThemeMode: mutate the module object FIRST so the single
  // re-render this triggers already draws at the new height, then record it in
  // state so React knows something changed.
  const [chartScale, setChartScaleState] = useState(CHART.scale);
  const changeChartScale = (v) => {
    const n = Math.min(CHART_SCALE_MAX, Math.max(CHART_SCALE_MIN, Number(v) || 1));
    CHART.scale = n;
    setChartScaleState(n);
    try { localStorage.setItem(CHART_SCALE_KEY, String(n)); } catch (e) { /* storage off */ }
  };
  const changeContentWidth = (px) => {
    const v = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(px) || WIDTH_MIN));
    setContentWidth(v);
    try { localStorage.setItem(WIDTH_STORAGE_KEY, String(v)); } catch (e) { /* storage off — the choice still holds for this session */ }
  };
  const [currentYear] = useState(new Date().getFullYear());
  const [saveStatus, setSaveStatus] = useState('');
  const [showImportExport, setShowImportExport] = useState(false);
  const [showReport, setShowReport] = useState(null); // 'menu' | 'summary' | 'next12' | 'roadmap' | 'breaks' | 'survivor' | 'claiming' | 'scenarios'
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [dataWarnings, setDataWarnings] = useState([]);
  // Single localStorage read for the whole component — savedData feeds both
  // the wizard check below and every state slice's initializer further down (B9).
  const [savedData] = useState(() => loadFromStorage());

  const [showSetupWizard, setShowSetupWizard] = useState(() => !savedData);

  // The v3 → v4 migration split any contributor:'both' account into an employee
  // row and an employer row at an assumed 8:3. That is an edit to the user's own
  // data based on information the app never captured, so it is announced rather
  // than performed quietly — with the exact figures, so anyone whose real match
  // differed knows precisely what to correct. Dismissal is not persisted on
  // purpose: it lives only in this session, and the migration itself has already
  // been written, so it cannot fire twice.
  const [splitNotice, setSplitNotice] = useState(() => (savedData && savedData.contributorSplitNotice) || null);
  const [survivorNotice, setSurvivorNotice] = useState(() => (savedData && savedData.survivorModelNotice) || null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [snapshots, setSnapshots] = useState([]);

  // The tour never launches itself. Finishing a nine-step wizard and then being
  // handed a nine-step tour is eighteen screens before you ever see your own
  // plan — the reward for setting up should be your numbers, not another modal.
  // So it is OFFERED once per browser by a dismissible prompt on the Dashboard,
  // and stays in the sidebar for whenever someone actually wants it.
  const [showTour, setShowTour] = useState(false);
  // Whether that offer is still outstanding. Shares the tour's per-browser
  // seen-state, so taking it OR declining it both stop the asking.
  const [tourPromptOpen, setTourPromptOpen] = useState(() => !hasSeenTour());

  // Whether this browser holds a plan the user actually entered. The wizard's
  // opening screen keys off this to decide between its first-run copy and its
  // "update what you have" copy. It deliberately does NOT come from current
  // component state: accounts/personalInfo are seeded with sample defaults on a
  // fresh install, so testing those made hasExisting true for everyone and a
  // brand-new user was greeted with "Update Your Plan — walk through with
  // current data", offering to revise a plan they had never made.
  const [hasSavedPlan, setHasSavedPlan] = useState(() => !!savedData);

  // The snapshot ring covers a bad edit. It does not cover a cleared browser or a
  // new laptop, and nothing in the app had ever asked for the one thing that
  // does. Shown once per session, dismissible, and never on a plan that is still
  // the sample data — nagging someone to back up a plan they have not written yet
  // teaches them to ignore the banner.
  const [exportNudge, setExportNudge] = useState(false);
  useEffect(() => {
    if (!hasSavedPlan) return;
    let last = 0;
    try {
      last = Number(localStorage.getItem(LAST_EXPORT_KEY)) || 0;
      if (!last) {
        // No clock yet. Start it now rather than treating "never exported" as
        // "overdue" — otherwise the banner appears the moment someone finishes
        // the wizard, which is the fastest way to teach them to ignore it. The
        // ask comes thirty days into actually using the thing.
        localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()));
        return;
      }
    } catch (e) { return; }
    if ((Date.now() - last) / 86400000 >= EXPORT_NUDGE_DAYS) setExportNudge(true);
  }, [hasSavedPlan]);

  // Logo Component - MB makers mark on blue circle
  // Logo, NavItem and NavGroup were moved to module scope (above RetirementPlanner).
  // Defined inline they got a new component identity on every render, so React
  // unmounted and remounted those subtrees each time any state changed — the same
  // problem the modals were lifted out for.
  
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

  // Per-tab section visibility. Only EXPLICIT choices live here; everything
  // else follows the mode's default, so a user who has never touched a toggle
  // keeps getting sensible defaults as sections are added rather than a frozen
  // snapshot of an old manifest. The Essentials/Standard/Everything level that
  // sat on top of this until v2.50.0 is folded in on load (pinDetailLevel).
  const [sectionVisibility, setSectionVisibility] = useState(() =>
    pinDetailLevel(savedData?.sectionVisibility || {}, savedData?.detailLevel));
  // ── SIMPLE MODE ────────────────────────────────────────────────────────────
  // The full app is fifteen tabs, four nav groups and about four hundred
  // controls. That is the right shape for someone running conversion ladders
  // against IRMAA tiers, and the wrong shape for someone who wants to know
  // whether they can retire at 63.
  //
  // Simple mode is PRESENTATIONAL AND NOTHING ELSE. It hides tabs and sections;
  // it never changes a setting, and the engine never sees it. A plan projects
  // identically in both modes, including through settings whose control is
  // hidden — long-term care billed from a Personal Info section you cannot
  // currently see is still billed. A test pins that, because the alternative —
  // a mode that quietly plans differently — would be far worse than a busy nav.
  //
  // An existing plan opens in the mode it was saved in, defaulting to the full
  // app so nobody's tabs disappear on upgrade. A plan that does not exist yet
  // starts simple, because that is the one case where nothing is being taken
  // away.
  const [uiMode, setUiMode] = useState(() => savedData?.uiMode || (savedData ? 'advanced' : 'simple'));
  const simpleMode = uiMode === 'simple';
  // The mode IS the level now: simple shows each tab's essentials, the full app
  // its standard set, and anything beyond that is one click away per section.
  // A separate Essentials/Standard/Everything strip on every tab duplicated the
  // mode switch (Simple ≈ Essentials) and was retired in v2.50.0.
  const effectiveDetailLevel = simpleMode ? 'essentials' : 'standard';
  // Per-section overrides are a power-user control saved against the full app.
  // Honouring them in simple mode would let a tab the reader once un-hid come
  // back, which is exactly the surprise this mode exists to avoid.
  const effectiveSectionVisibility = simpleMode ? EMPTY_SECTION_VISIBILITY : sectionVisibility;
  // Passing no setter is how a tab is told "the level is not yours to change
  // here" — it drops the Sections strip AND the per-section Hide buttons that
  // strip is the only way back from.
  const effectiveSetSectionVisibility = simpleMode ? null : setSectionVisibility;
  // Present only in simple mode, which is also what tells a tab to show the
  // hidden-settings notice at all.
  const showEverything = simpleMode ? () => setUiMode('advanced') : null;

  // Switching to simple mode while standing on a tab it does not show would
  // leave the reader looking at a page with no way back to it in the nav.
  useEffect(() => {
    if (simpleMode && !SIMPLE_TABS.includes(activeTab)) setActiveTab('dashboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simpleMode, activeTab]);

  // The Sandbox's own configuration: which panels the reader picked and where
  // they left the controls. Persisted like any other plan preference so a page
  // someone built for themselves is still there next visit.
  const [sandboxConfig, setSandboxConfig] = useState(() => savedData
    ? mergedDashboardConfig(savedData.sandboxConfig, savedData.sectionVisibility, savedData.detailLevel)
    : freshDashboardConfig());

  const [dashboardVisibility, setDashboardVisibility] = useState(() => {
    return savedData?.dashboardVisibility || DEFAULT_DASHBOARD_VISIBILITY;
  });

  // Default-merged like personalInfo (not `|| DEFAULT`, which the list slices
  // use) because this is a settings-shaped object: a plan saved before a field
  // existed must gain it, not lose the rest of the object.
  const [currentYearData, setCurrentYearData] = useState(() => ({
    ...DEFAULT_CURRENT_YEAR,
    ...(savedData?.currentYear || {}),
  }));

  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [editingIncome, setEditingIncome] = useState(null);
  const [editingAsset, setEditingAsset] = useState(null);
  
  // Scenario comparison state. Scenarios ARE persisted by the auto-save effect,
  // so they must be restored here — initializing to [] meant every page load
  // wiped saved scenarios on the next debounced save (data loss).
  const [scenarios, setScenarios] = useState(() => savedData?.scenarios || []);
  const [activeScenarioId, setActiveScenarioId] = useState(null);
  
  // Create a scenario from current settings
  // Save ANY plan as a scenario. The Sandbox composes a plan out of its
  // controls and needs to save that, not the live one — so the shape a scenario
  // has is defined once, here, and createScenario becomes the special case that
  // passes the plan currently on screen.
  const createScenarioFrom = (name, plan) => {
    const newScenario = {
      id: Date.now(),
      name,
      personalInfo: { ...plan.personalInfo },
      accounts: (plan.accounts || []).map(a => ({ ...a })),
      incomeStreams: (plan.incomeStreams || []).map(i => ({ ...i })),
      assets: (plan.assets || []).map(a => ({ ...a })),
      oneTimeEvents: (plan.oneTimeEvents || []).map(e => ({ ...e })),
      recurringExpenses: (plan.recurringExpenses || []).map(e => ({ ...e })),
      // Snapshotted with the rest of the plan: a scenario that changes the
      // deferral election has to carry the payroll it changed, or comparing two
      // scenarios silently compares them against the same current-year data.
      currentYear: JSON.parse(JSON.stringify(plan.currentYear || currentYearData)),
      createdAt: new Date().toISOString()
    };
    setScenarios(prev => [...prev, newScenario]);
    return newScenario.id;
  };

  const createScenario = (name) => createScenarioFrom(name, {
    personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses,
    currentYear: currentYearData,
  });

  // Promote a plan to the baseline — the plan every other tab describes. Used by
  // the Sandbox's "Make this the plan", which is the step that turns an
  // experiment into a decision. Takes a snapshot first: this overwrites the
  // whole plan, and it is exactly the kind of click people want back.
  const applyPlanAsBaseline = (plan) => {
    snapshotNow('before making a scenario the plan');
    setPersonalInfo({ ...DEFAULT_PERSONAL_INFO, ...(plan.personalInfo || {}) });
    setAccounts((plan.accounts || []).map(a => ({ ...a })));
    setIncomeStreams((plan.incomeStreams || []).map(i => ({ ...i })));
    if (plan.assets) setAssets(plan.assets.map(a => ({ ...a })));
    if (plan.oneTimeEvents) setOneTimeEvents(plan.oneTimeEvents.map(e => ({ ...e })));
    if (plan.recurringExpenses) setRecurringExpenses(plan.recurringExpenses.map(e => ({ ...e })));
    if (plan.currentYear) setCurrentYearData({ ...DEFAULT_CURRENT_YEAR, ...plan.currentYear });
    setSaveStatus('This is your plan now');
    setTimeout(() => setSaveStatus(''), 4000);
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
      // Loading a scenario replaces the working plan. If the edits on screen were
      // never saved to a scenario of their own, this is where they go.
      snapshotNow('before loading a scenario');
      setPersonalInfo({ ...DEFAULT_PERSONAL_INFO, ...scenario.personalInfo });
      // Always overwrite list fields — defaulting to [] so loading an older
      // scenario that predates a field (or that explicitly cleared it) wipes
      // the current values instead of leaving stale entries in place (B6).
      setAccounts(scenario.accounts || []);
      setIncomeStreams(scenario.incomeStreams || []);
      setAssets(scenario.assets || []);
      setOneTimeEvents(scenario.oneTimeEvents || []);
      setRecurringExpenses(scenario.recurringExpenses || []);
      // Default-merged rather than `|| DEFAULT`: unlike the list fields above,
      // dropping a key here would lose unrelated current-year data rather than
      // clear a stale list.
      setCurrentYearData({ ...DEFAULT_CURRENT_YEAR, ...(scenario.currentYear || {}) });
      setActiveScenarioId(id);
    }
  };
  
  // The snapshot ring copies whatever the autosave last wrote, so a restore can
  // never bring back a shape the save path would not produce. Held in a ref
  // rather than recomputed, so the "before something destructive" copies below
  // capture the plan as it stood a moment ago rather than reassembling it.
  const lastSavedPlan = useRef(null);
  const snapshotNow = (reason) => {
    if (lastSavedPlan.current) writeSnapshot(lastSavedPlan.current, reason);
  };

  // Auto-save to localStorage with debouncing to prevent excessive saves
  useEffect(() => {
    const saveTimer = setTimeout(() => {
      const data = { personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses, dashboardVisibility, sectionVisibility, uiMode, scenarios, currentYear: currentYearData, sandboxConfig, lastSaved: new Date().toISOString() };
      const result = saveToStorage(data);
      if (result.ok) {
        // Order matters: the plan is safely written before anything is spent on
        // history, so a snapshot that hits quota can never cost the user the
        // save it was meant to protect.
        lastSavedPlan.current = data;
        writeSnapshot(data, 'auto');
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
  }, [personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses, dashboardVisibility, sectionVisibility, uiMode, scenarios, currentYearData, sandboxConfig]);
  
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
      sandboxConfig,
      sectionVisibility,
      uiMode,
      scenarios,
      currentYear: currentYearData,
      exportDate: new Date().toISOString(),
      // schemaVersion is what handleImport and loadFromStorage actually gate on.
      // `version` is a legacy display string that nothing reads; kept so older
      // builds see the field they expect, but it is not the migration signal.
      schemaVersion: SCHEMA_VERSION,
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
    try { localStorage.setItem(LAST_EXPORT_KEY, String(Date.now())); } catch (e) { /* storage off */ }
    setExportNudge(false);
    setSaveStatus('Exported!');
    setTimeout(() => setSaveStatus(''), 2000);
  };
  
  // Import data from JSON file
  const handleImport = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    // Taken before the file is even read: an import replaces everything, and the
    // moment to keep a copy is before, not after a shape check that might pass
    // on a file the user did not mean to pick.
    snapshotNow('before import');
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result);
        // Shape check before anything is applied. JSON.parse succeeds on any valid
        // JSON, so without this an unrelated (or hand-edited) file could put a
        // string where the app expects an array and crash a tab past the point
        // where the try/catch can help — with the bad data already in state and
        // auto-saved over the user's real plan.
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('not a retirement plan file');
        }
        const listFields = ['accounts', 'incomeStreams', 'assets', 'oneTimeEvents', 'recurringExpenses', 'scenarios'];
        for (const f of listFields) {
          if (data[f] !== undefined && !Array.isArray(data[f])) {
            throw new Error(`"${f}" should be a list but is ${typeof data[f]}`);
          }
        }
        if (data.personalInfo !== undefined
            && (typeof data.personalInfo !== 'object' || data.personalInfo === null || Array.isArray(data.personalInfo))) {
          throw new Error('"personalInfo" should be an object');
        }
        if (data.currentYear !== undefined
            && (typeof data.currentYear !== 'object' || data.currentYear === null || Array.isArray(data.currentYear))) {
          throw new Error('"currentYear" should be an object');
        }
        for (const f of ['payroll', 'k1s']) {
          if (data.currentYear && data.currentYear[f] !== undefined && !Array.isArray(data.currentYear[f])) {
            throw new Error(`"currentYear.${f}" should be a list but is ${typeof data.currentYear[f]}`);
          }
        }
        if (!data.personalInfo && !listFields.some(f => data[f])) {
          throw new Error('no plan data found in this file');
        }
        // Merge imported personalInfo with defaults to ensure new fields are present
        // This handles imports from older versions that may be missing newer fields
        if (data.personalInfo) {
          const currentYear = new Date().getFullYear();
          const merged = { ...DEFAULT_PERSONAL_INFO, ...data.personalInfo };
          if (!merged.myBirthYear) merged.myBirthYear = currentYear - merged.myAge;
          if (!merged.spouseBirthYear) merged.spouseBirthYear = currentYear - merged.spouseAge;
          setPersonalInfo(merged);
        }
        if (data.accounts) {
          // An export written before v4 can still carry contributor:'both'. The
          // localStorage migration never sees it, so the same split runs here —
          // otherwise an imported plan silently keeps the unattributable rows,
          // draws no pre-tax deduction, and reports a savings rate that ignores
          // its largest account.
          const { accounts: migrated, split } = splitBothContributors(data.accounts);
          setAccounts(migrated);
          if (split.length) setSplitNotice(split);
        }
        if (data.incomeStreams) setIncomeStreams(data.incomeStreams);
        if (data.assets) setAssets(data.assets);
        if (data.oneTimeEvents) setOneTimeEvents(data.oneTimeEvents);
        if (data.recurringExpenses) setRecurringExpenses(data.recurringExpenses);
        // Older exports may contain data.milestones, data.phases, or data.priorityRules.
        // Those tabs were removed in v37 and may return later. We silently ignore the
        // fields here so re-import doesn't fail and the data isn't lost (it's still in
        // the JSON file the user has on disk).
        setDashboardVisibility(data.dashboardVisibility || DEFAULT_DASHBOARD_VISIBILITY);
        setSandboxConfig(mergedDashboardConfig(data.sandboxConfig, data.sectionVisibility, data.detailLevel));
        setSectionVisibility(pinDetailLevel(data.sectionVisibility || {}, data.detailLevel));
        // Only when the file says so. An export written before the mode existed
        // has no opinion, and defaulting it would switch the reader's view out
        // from under them because of the age of a file they opened.
        if (data.uiMode === 'simple' || data.uiMode === 'advanced') setUiMode(data.uiMode);
        if (data.scenarios) setScenarios(data.scenarios);
        // Default-merged, not assigned: an export written before a currentYear
        // field existed must gain it rather than arrive missing it.
        setCurrentYearData({ ...DEFAULT_CURRENT_YEAR, ...(data.currentYear || {}) });
        setSaveStatus('Imported!');
        setTimeout(() => setSaveStatus(''), 2000);
      } catch (err) {
        alert('Could not import this file: ' + ((err && err.message) || 'unreadable')
          + '.\n\nPick a JSON file exported from this planner. Your current plan has not been changed.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };
  
  // Reset to defaults
  const handleReset = () => {
    // The plan is about to go. Keep a copy first — Reset is the single most
    // regretted button in the app and there was no way back from it.
    snapshotNow('before reset');
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
    setSandboxConfig(freshDashboardConfig());
    setScenarios([]);
    setCurrentYearData(DEFAULT_CURRENT_YEAR);
    setActiveScenarioId(null); // scenarios are gone; don't keep pointing at one
    // uiMode is deliberately NOT reset, and neither are the detail level, the
    // section choices or the theme: Reset clears the plan, not how the reader
    // likes to look at one. "A new plan starts simple" exists because a plan
    // that does not exist yet has no tabs to take away — someone who pressed
    // Reset from the full app was just using those tabs.

    setShowResetConfirm(false);
    setShowImportExport(false);
    setSaveStatus('Data Cleared!');
    setTimeout(() => setSaveStatus(''), 2000);
  };
  
  // ASSET_TYPES / ACCOUNT_TYPES / CONTRIBUTOR_TYPES / INCOME_TYPES are at module scope
  // (above this function) so they aren't recreated on every render.


  // The current-year return, derived from the Current Year tab. Depends only on
  // that slice and personalInfo — never on `projections` — so feeding it into the
  // projection below is a straight line and not a cycle. Guarded because a
  // half-filled slice is the normal state while the year is in progress.
  const currentYearReturn = useMemo(() => {
    try { return computeTaxReturn(buildTaxSituation(currentYearData, personalInfo)); }
    catch (e) { return null; }
  }, [currentYearData, personalInfo]);

  const projections = useMemo(() => {
    // Year 0 uses the detailed return when the user has opted in and it applies.
    // The engine decides whether it applies and records why if it does not; see
    // detailedCurrentYearDecision. With the flag off this argument is inert.
    return computeProjections(personalInfo, accounts, incomeStreams, assets, oneTimeEvents,
      recurringExpenses, undefined, { currentYearReturn });
  }, [accounts, incomeStreams, assets, personalInfo, oneTimeEvents, recurringExpenses, currentYear, currentYearReturn]);

  // ── Today's dollars ──────────────────────────────────────────────────────
  // The engine computes in nominal dollars and must: brackets, IRMAA tiers and
  // contribution limits are all nominal figures indexed year by year. So the
  // basis is a display transform applied once, here, over finished rows — and
  // the tabs that show plain money figures are handed the restated copy while
  // the engine, the solver and every threshold comparison keep the real thing.
  //
  // Tax Planning and Current Year deliberately keep the nominal rows. A bracket
  // table compares income against inflation-indexed thresholds; restating one
  // side and not the other would be wrong, and restating both would relabel the
  // 22% bracket as something it is not. A 1040 is a nominal document for one
  // year. Both say so on the page rather than silently opting out.
  const realBasis = personalInfo.displayBasis === 'real';
  const displayProjections = useMemo(() => (
    realBasis
      ? deflateProjections(projections, {
          inflationRate: personalInfo.inflationRate,
          baseYear: projections[0] ? projections[0].year : currentYear,
        })
      : projections
  ), [realBasis, projections, personalInfo.inflationRate, currentYear]);

  // Panels that re-run the engine themselves (the savings-rate explorer, the
  // lifestyle/legacy comparison, the retirement-age preview) must land on the
  // same basis as the page around them, or one card on the Dashboard would be
  // quoting future dollars next to five quoting today's. Wrapping the function
  // they are handed does that once instead of at every call site.
  const displayComputeProjections = useMemo(() => {
    if (!realBasis) return computeProjections;
    return (...args) => {
      const out = computeProjections(...args);
      return deflateProjections(out, {
        inflationRate: personalInfo.inflationRate,
        baseYear: out && out[0] ? out[0].year : currentYear,
      });
    };
  }, [realBasis, personalInfo.inflationRate, currentYear]);

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

  const handleSaveIncome = (income, extraStream = null) => {
    const error = validateIncome(income);
    if (error) {
      alert(error);
      return;
    }
    if (income.id) setIncomeStreams(prev => prev.map(i => i.id === income.id ? income : i));
    else setIncomeStreams(prev => [...prev, { ...income, id: Date.now() + Math.random() }]);
    // The pension estimator can emit a companion stream (e.g. the FERS Special
    // Retirement Supplement that bridges an early retirement to age 62).
    if (extraStream) {
      const err2 = validateIncome(extraStream);
      if (!err2) setIncomeStreams(prev => [...prev, { ...extraStream, id: Date.now() + Math.random() + 1 }]);
    }
    setShowIncomeModal(false);
    setEditingIncome(null);
  };

  // Dark mode styles — defined at module scope above (cardStyle, inputStyle, etc.)
  // so child components can be lifted out of RetirementPlanner without re-mounting
  // on every parent render.
  
  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Every tour step points at the sidebar, so expand it first — a collapsed
  // sidebar still has the target elements but hides their labels, which makes
  // the highlighted item meaningless.
  const startTour = () => {
    setSidebarCollapsed(false);
    setShowSetupWizard(false); // the two overlays must never be live together
    setTourPromptOpen(false);  // taking it up answers the offer
    setShowTour(true);
  };

  // Accepting or declining the Dashboard offer both count as asked-and-answered,
  // so the prompt does not return on the next visit. The sidebar entry remains.
  const acceptTourOffer = () => { markTourSeen(); startTour(); };
  const declineTourOffer = () => { markTourSeen(); setTourPromptOpen(false); };
  
  // Navigation structure with groups
  // The assistant reads and writes the plan through one object rather than nine
  // setters. Keeping the shape identical to what the engine's patch layer
  // expects means the same object is what gets validated, what gets projected
  // for the preview, and what gets written back — there is no second place
  // where a slice could be dropped on the way through.
  const livePlan = useMemo(() => ({
    personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses,
  }), [personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses]);

  const applyAiPlan = (next) => {
    snapshotNow('before applying an assistant suggestion');
    setPersonalInfo(next.personalInfo);
    setAccounts(next.accounts);
    setIncomeStreams(next.incomeStreams);
    setAssets(next.assets);
    setOneTimeEvents(next.oneTimeEvents);
    setRecurringExpenses(next.recurringExpenses);
    setSaveStatus('Applied');
    setTimeout(() => setSaveStatus(''), 2000);
  };

  // SIMPLE_TABS and SIMPLE_LABELS live at module scope, beside the tour that
  // also reads them.
  const fullNavGroups = [
    {
      label: 'OVERVIEW',
      icon: '📊',
      items: [
        // The Sandbox sat here as a second entry until v2.47.0, when it
        // became the Dashboard's own "What if…" card — "where does my plan
        // stand" and "what if I change it" are one page now.
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
        { id: 'currentyear', label: 'Current Year', icon: '🧾' },
        { id: 'socialsecurity', label: 'Social Security', icon: '🎯' },
        { id: 'taxplanning', label: 'Taxes & Roth', icon: '📋' },
        // Monte Carlo, Stress Test and Sensitivity were three entries until
        // v2.49.0. They answer one question three ways, and simple mode had
        // already been calling the first of them "Will it last?".
        { id: 'montecarlo', label: 'Will it last?', icon: '🎲' }
      ]
    },
    {
      label: 'TOOLS',
      icon: '🔧',
      items: [
        { id: 'assistant', label: 'AI Assistant', icon: '💬' },
        { id: 'faq', label: 'Assumptions', icon: '❓' }
      ]
    }
  ];

  // One flat list, in the order someone works through a plan. Four group headers
  // over nine items is filing-cabinet furniture: it implies there is more behind
  // each heading than there is.
  const simpleNavGroups = [{
    label: null,
    tourId: 'nav-simple',
    items: SIMPLE_TABS.map(id => {
      const item = fullNavGroups.flatMap(g => g.items).find(it => it.id === id);
      return item ? { ...item, label: SIMPLE_LABELS[id] || item.label } : null;
    }).filter(Boolean),
  }];
  const navGroups = simpleMode ? simpleNavGroups : fullNavGroups;
  
  // NavItem / NavGroup live at module scope (above RetirementPlanner) so they
  // keep stable component identities across renders. They take the sidebar state
  // as props rather than closing over it.
  
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
  // SetupWizard lives at module scope (above RetirementPlanner) so React keeps
  // one component identity and it never remounts mid-entry.

  return (
    <div className="app-shell min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex">
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
          hasSavedPlan={hasSavedPlan}
          onComplete={(pi, accts, incomes, assetList) => {
            snapshotNow('before the setup wizard');
            setPersonalInfo(pi);
            setAccounts(accts);
            setIncomeStreams(incomes);
            setAssets(assetList);
            setShowSetupWizard(false);
            // From here on this browser has a real plan, so re-opening the
            // wizard offers "Update My Plan" rather than first-run copy.
            setHasSavedPlan(true);
            setSaveStatus('Plan updated!');
            setTimeout(() => setSaveStatus(''), 3000);
            // Deliberately does NOT launch the tour — land them on their own
            // plan. The Dashboard offers the tour, to take or dismiss.
          }}
          onExplore={() => setShowSetupWizard(false)}
        />
      )}

      {/* Never render the tour over the wizard: the tour keeps a capture-phase
          scroll listener and smooth-scrolls its target, which fights the wizard's
          own scrolling panel and locks up the main thread. */}
      {showTour && !showSetupWizard && <GuidedTour steps={simpleMode ? SIMPLE_TOUR_STEPS : TOUR_STEPS} onFinish={() => setShowTour(false)} />}

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
          {/* The mode switch sits above everything else in the sidebar because a
              reader who feels lost needs to find it without reading the nav
              they are lost in. It says what it will do, not what mode you are
              in — "Simple view" on a button is ambiguous about which state it
              names, and this is the one control where guessing wrong means
              your tabs vanish. */}
          <button
            data-tour="tour-mode-switch"
            onClick={() => setUiMode(simpleMode ? 'advanced' : 'simple')}
            className={`mt-2 w-full flex items-center justify-center gap-1.5 text-xs py-1.5 rounded transition-colors border ${
              simpleMode
                ? 'text-amber-300 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20'
                : 'text-slate-400 border-slate-700/60 hover:text-slate-200 hover:bg-slate-700/50'}`}
            title={simpleMode
              ? 'Show every tab and every section — the full planner. Nothing about your plan changes either way.'
              : 'Hide the advanced tabs and diagnostics, leaving the eight screens a plan is actually built from. Your plan and its numbers are untouched.'}
          >
            <span>{simpleMode ? '◇' : '◆'}</span>
            {!sidebarCollapsed && <span>{simpleMode ? 'Show everything' : 'Simplify'}</span>}
          </button>
          {/* The look. Six choices: the classic dark and light themes and the
              four dark looks. Collapsed, the button steps to the next one, since
              there is no room for the list. */}
          <button
            onClick={() => {
              if (sidebarCollapsed) {
                const ids = PlannerTheme.CHOICES.map(c => c.id);
                chooseTheme(ids[(ids.indexOf(themeMode) + 1) % ids.length]);
              } else setThemeOpen(o => !o);
            }}
            aria-expanded={sidebarCollapsed ? undefined : themeOpen}
            className={`mt-1 w-full flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 py-1.5 rounded hover:bg-slate-700/50 transition-colors`}
            title={sidebarCollapsed ? `Look: ${themeChoice.label} — click for the next one` : 'Choose how the planner looks. Saved for this browser only; your plan is not affected.'}
          >
            <ThemeSwatch colors={themeChoice.swatch} />
            {!sidebarCollapsed && <span>{themeChoice.label}</span>}
          </button>
          {themeOpen && !sidebarCollapsed && (
            <div className="mt-1 space-y-0.5" role="radiogroup" aria-label="Look">
              {PlannerTheme.CHOICES.map(c => (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={c.id === themeMode}
                  onClick={() => chooseTheme(c.id)}
                  title={c.blurb || ''}
                  className={`w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-left transition-colors ${
                    c.id === themeMode ? 'bg-slate-700/60 text-slate-100' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'}`}
                >
                  <ThemeSwatch colors={c.swatch} />
                  <span className="flex-1">{c.label}</span>
                  {c.id === themeMode && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setWidthOpen(o => !o)}
            className="mt-1 w-full flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 py-1.5 rounded hover:bg-slate-700/50 transition-colors"
            title="How wide the content column may get. Saved for this browser only — it depends on the screen, not on the plan."
          >
            <span>↔</span>
            {!sidebarCollapsed && <span>{contentWidthLabel(contentWidth)}</span>}
          </button>
          {widthOpen && !sidebarCollapsed && (
            <div className="mt-1 px-1 pb-1">
              <input
                type="range" min={WIDTH_MIN} max={WIDTH_MAX} step={16}
                value={contentWidth}
                onChange={e => changeContentWidth(Number(e.target.value))}
                className="w-full accent-amber-500"
                aria-label="Content width"
              />
              <div className="flex items-center justify-between gap-1 mt-1">
                <span className="text-[10px] text-slate-600">{WIDTH_MIN}</span>
                <input
                  type="number" min={WIDTH_MIN} max={WIDTH_MAX} step={16}
                  value={contentWidth}
                  onChange={e => changeContentWidth(Number(e.target.value))}
                  aria-label="Content width (pixels)"
                  className="w-16 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-[11px] text-slate-200 text-center"
                />
                <span className="text-[10px] text-slate-600">full</span>
              </div>
              <button
                onClick={() => changeContentWidth(typeof window !== 'undefined' ? window.innerWidth : WIDTH_MAX)}
                className="mt-1 w-full text-[10px] text-slate-500 hover:text-slate-300 underline decoration-dotted"
                title="Set the cap to this window's current width"
              >
                fit this window
              </button>
              <div className="mt-2 pt-2 border-t border-slate-700/50">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Chart height</span>
                  <span className="text-[10px] text-slate-400">{Math.round(chartScale * 100)}%</span>
                </div>
                <input
                  type="range" min={CHART_SCALE_MIN} max={CHART_SCALE_MAX} step={0.05}
                  value={chartScale}
                  onChange={e => changeChartScale(e.target.value)}
                  className="w-full accent-amber-500"
                  aria-label="Chart height"
                />
                <div className="text-[10px] text-slate-600 leading-tight">
                  Taller charts spread the same range over more pixels, so small
                  differences stop collapsing into one bar.
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto">
          {navGroups.map((group, idx) => (
            <NavGroup key={idx} group={group} activeTab={activeTab} setActiveTab={setActiveTab} sidebarCollapsed={sidebarCollapsed} />
          ))}
          
          {/* Utility buttons - right after nav groups */}
          <div className="mt-4 pt-4 border-t border-slate-700/50">
            <button
              onClick={() => { setShowTour(false); setShowSetupWizard(true); }}
              data-tour="tour-guided-setup"
              className="w-full flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-all"
            >
              <span className="text-base">🚀</span>
              {!sidebarCollapsed && <span className="text-sm font-medium">Guided Setup</span>}
            </button>
            <button
              onClick={startTour}
              className="w-full flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-all"
            >
              <span className="text-base">🧭</span>
              {!sidebarCollapsed && <span className="text-sm font-medium">Take a Tour</span>}
            </button>
            <button
              onClick={() => setShowReport('menu')}
              data-tour="tour-reports"
              className="w-full flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-all"
            >
              <span className="text-base">📄</span>
              {!sidebarCollapsed && <span className="text-sm font-medium">Reports</span>}
            </button>
            <button
              onClick={() => setShowImportExport(true)}
              data-tour="tour-import-export"
              className="w-full flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-all"
            >
              <span className="text-base">💾</span>
              {!sidebarCollapsed && <span className="text-sm font-medium">Import/Export</span>}
            </button>
            {/* Plan history is a recovery tool for someone who has been editing
                hard enough to want an undo across sessions. Reports, Import and
                Guided Setup all stay — they are how a plan gets built, backed
                up and shown to someone else, which simple mode needs more than
                the full app does, not less. */}
            {!simpleMode && (
              <button
                onClick={() => { setSnapshots(readSnapshots()); setShowSnapshots(true); }}
                className="w-full flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-all"
                title="Recent copies of this plan, kept in this browser"
              >
                <span className="text-base">🕘</span>
                {!sidebarCollapsed && <span className="text-sm font-medium">Plan history</span>}
              </button>
            )}
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
          <div className="flex items-center gap-5">
            {/* The one basis switch. It was on the Dashboard AND a field on
                Personal Info — the second behind that tab's Save button, so the
                two could disagree until you pressed it. Up here it is on every
                page, next to the figures it changes. */}
            <BasisToggle pi={personalInfo} setPersonalInfo={setPersonalInfo} />
            <div className="text-right">
              <div className="text-xs text-slate-500">Current Year</div>
              <div className="text-sm font-semibold text-slate-300">{currentYear}</div>
            </div>
          </div>
        </header>
        
        {/* Main Content */}
        {/* No overflow-y-auto here. It was inert — the shell is min-h-screen, so
            main is content-sized and its scrollHeight always equals its
            clientHeight, meaning it never scrolled and the DOCUMENT did. But an
            ancestor with overflow set still becomes the scrollport that
            `position: sticky` resolves against, so every sticky descendant
            silently anchored itself to a container that never moves and simply
            scrolled away. Removing a property that did nothing is what makes
            sticky work. */}
        <main className="flex-1 p-6">
          <div className="mx-auto w-full" style={{ maxWidth: contentWidthCss(contentWidth) }}>
            {activeTab === 'personal' && <PersonalInfoTab onShowEverything={showEverything} onOpenTaxPlanning={() => setActiveTab('taxplanning')} accounts={accounts} dataWarnings={dataWarnings} detailLevel={effectiveDetailLevel} sectionVisibility={effectiveSectionVisibility} setSectionVisibility={effectiveSetSectionVisibility} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} recurringExpenses={recurringExpenses} setDataWarnings={setDataWarnings} setOneTimeEvents={setOneTimeEvents} setPersonalInfo={setPersonalInfo} setRecurringExpenses={setRecurringExpenses} />}
            {activeTab === 'accounts' && <AccountsTab detailLevel={effectiveDetailLevel} sectionVisibility={effectiveSectionVisibility} setSectionVisibility={effectiveSetSectionVisibility} accountTypes={ACCOUNT_TYPES} accounts={accounts} assets={assets} computeProjections={displayComputeProjections} contributorTypes={CONTRIBUTOR_TYPES} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} projections={displayProjections} recurringExpenses={recurringExpenses} setAccounts={setAccounts} setEditingAccount={setEditingAccount} setShowAccountModal={setShowAccountModal} />}
            {activeTab === 'assets' && <AssetsTab assetTypes={ASSET_TYPES} assets={assets} setAssets={setAssets} setEditingAsset={setEditingAsset} setShowAssetModal={setShowAssetModal} />}
            {activeTab === 'income' && <IncomeStreamsTab detailLevel={effectiveDetailLevel} sectionVisibility={effectiveSectionVisibility} setSectionVisibility={effectiveSetSectionVisibility} incomeStreams={incomeStreams} incomeTypes={INCOME_TYPES} personalInfo={personalInfo} projections={displayProjections} setEditingIncome={setEditingIncome} setIncomeStreams={setIncomeStreams} setShowIncomeModal={setShowIncomeModal} />}
            {activeTab === 'socialsecurity' && <SocialSecurityTab currentYearReturn={currentYearReturn} detailLevel={effectiveDetailLevel} sectionVisibility={effectiveSectionVisibility} setSectionVisibility={effectiveSetSectionVisibility} accounts={accounts} assets={assets} computeProjections={displayComputeProjections} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} recurringExpenses={recurringExpenses} setIncomeStreams={setIncomeStreams} />}
            {activeTab === 'dashboard' && <DashboardTab currentYearReturn={currentYearReturn} onShowEverything={showEverything} onDismissTour={declineTourOffer} onTakeTour={acceptTourOffer} setActiveTab={setActiveTab} setPersonalInfo={setPersonalInfo} showTourOffer={tourPromptOpen && !showSetupWizard && !showTour} accounts={accounts} activeScenarioId={activeScenarioId} applyPlanAsBaseline={applyPlanAsBaseline} createScenarioFrom={createScenarioFrom} deleteScenario={deleteScenario} loadScenario={loadScenario} scenarios={scenarios} assets={assets} computeProjections={displayComputeProjections} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} projections={displayProjections} recurringExpenses={recurringExpenses} sandboxConfig={sandboxConfig} setSandboxConfig={setSandboxConfig} />}
            {activeTab === 'taxplanning' && <TaxPlanningTab detailLevel={effectiveDetailLevel} sectionVisibility={effectiveSectionVisibility} setSectionVisibility={effectiveSetSectionVisibility} accounts={accounts} assets={assets} computeProjections={computeProjections} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} projections={projections} recurringExpenses={recurringExpenses} setPersonalInfo={setPersonalInfo} />}
            {activeTab === 'currentyear' && <CurrentYearTab detailLevel={effectiveDetailLevel} sectionVisibility={effectiveSectionVisibility} setSectionVisibility={effectiveSetSectionVisibility} currentYearData={currentYearData} personalInfo={personalInfo} projections={projections} setCurrentYearData={setCurrentYearData} setPersonalInfo={setPersonalInfo} />}
            {activeTab === 'montecarlo' && (
              <WillItLastTab view={lastingView} setView={setLastingView}>
                {lastingView === 'montecarlo' && <MonteCarloTab currentYearReturn={currentYearReturn} detailLevel={effectiveDetailLevel} sectionVisibility={effectiveSectionVisibility} setSectionVisibility={effectiveSetSectionVisibility} accounts={accounts} assets={assets} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} projections={projections} recurringExpenses={recurringExpenses} />}
                {lastingView === 'stresstest' && <StressTestTab detailLevel={effectiveDetailLevel} sectionVisibility={effectiveSectionVisibility} setSectionVisibility={effectiveSetSectionVisibility} accounts={accounts} assets={assets} currentYear={currentYear} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} computeProjections={displayComputeProjections} personalInfo={personalInfo} projections={displayProjections} recurringExpenses={recurringExpenses} />}
                {lastingView === 'sensitivity' && <SensitivityTab detailLevel={effectiveDetailLevel} sectionVisibility={effectiveSectionVisibility} setSectionVisibility={effectiveSetSectionVisibility} accounts={accounts} assets={assets} computeProjections={displayComputeProjections} incomeStreams={incomeStreams} oneTimeEvents={oneTimeEvents} personalInfo={personalInfo} projections={displayProjections} recurringExpenses={recurringExpenses} />}
              </WillItLastTab>
            )}
            {activeTab === 'assistant' && <AiAssistantTab computeProjections={displayComputeProjections} onApply={applyAiPlan} plan={livePlan} projections={displayProjections} />}
            {activeTab === 'faq' && <FAQTab personalInfo={personalInfo} accounts={accounts} />}
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
          incomeStreams={incomeStreams}
          onClose={() => { setShowIncomeModal(false); setEditingIncome(null); }}
          onSave={handleSaveIncome}
        />
      )}
      {showAssetModal && (
        <AssetModal
          defaultSaleAge={personalInfo.myRetirementAge||65}
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
      {exportNudge && (
        <div className="fixed bottom-4 right-4 z-40 max-w-sm">
          <div className={swapClass(cardStyle, 'border-slate-700/50', 'border-amber-500/40')}>
            <div className="text-sm font-semibold text-slate-100 mb-1">Keep a copy somewhere else</div>
            <p className="text-xs text-slate-400 leading-relaxed mb-3">
              This plan lives in this browser. Plan history protects you from a bad edit, but clearing site
              data — or a new machine — takes it and the history together. An export is a single file you can
              put anywhere.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setExportNudge(false)}
                className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1">Not now</button>
              <button onClick={handleExport} className={buttonPrimary}>Export</button>
            </div>
          </div>
        </div>
      )}

      {showSnapshots && (() => {
        // Enough of each copy to tell them apart WITHOUT restoring one to look:
        // when it was taken, why, and the two or three figures a reader would
        // use to recognise their own plan. A list of timestamps alone makes the
        // choice a guess.
        const describe = (snap) => {
          try {
            const d = JSON.parse(snap.body);
            const pi = d.personalInfo || {};
            const bal = (d.accounts || []).reduce((t, a) => t + (a.balance || 0), 0);
            return {
              accounts: (d.accounts || []).length,
              streams: (d.incomeStreams || []).length,
              balance: bal,
              retireAt: pi.myRetirementAge,
              spend: pi.desiredIncome ?? pi.desiredRetirementIncome,
            };
          } catch (e) { return null; }
        };
        const when = (ms) => {
          const mins = Math.round((Date.now() - ms) / 60000);
          if (mins < 1) return 'just now';
          if (mins < 60) return `${mins} min ago`;
          const hrs = Math.round(mins / 60);
          if (hrs < 24) return `${hrs} hr ago`;
          return `${Math.round(hrs / 24)} days ago`;
        };
        const restore = (snap) => {
          let d;
          try { d = JSON.parse(snap.body); } catch (e) { return; }
          // The copy about to be replaced is itself worth keeping — restoring the
          // wrong one should not be the mistake you cannot undo.
          snapshotNow('before restoring a copy');
          setPersonalInfo({ ...DEFAULT_PERSONAL_INFO, ...(d.personalInfo || {}) });
          setAccounts(d.accounts || []);
          setIncomeStreams(d.incomeStreams || []);
          setAssets(d.assets || []);
          setOneTimeEvents(d.oneTimeEvents || []);
          setRecurringExpenses(d.recurringExpenses || []);
          setCurrentYearData({ ...DEFAULT_CURRENT_YEAR, ...(d.currentYear || {}) });
          if (d.scenarios) setScenarios(d.scenarios);
          setShowSnapshots(false);
          setSaveStatus('Restored an earlier copy');
          setTimeout(() => setSaveStatus(''), 4000);
        };
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`${cardStyle} max-w-2xl w-full max-h-[85vh] overflow-y-auto`}>
              <h3 className="text-xl font-bold text-slate-100 mb-1">Plan history</h3>
              <p className="text-xs text-slate-500 mb-4">
                Recent copies of this plan, kept in this browser — one every half hour while you work, plus
                one taken before anything that replaces the whole plan. This is for undoing a bad edit;
                alternatives you want to compare belong in Saved Scenarios, under What if… on the Dashboard.{' '}
                <strong className="text-amber-400/90">These live in this browser only.</strong> Clearing site
                data or moving to another machine takes them with the plan, so an export is still the backup
                that survives.
              </p>
              {snapshots.length === 0 ? (
                <p className="text-sm text-slate-400 mb-4">
                  No copies yet. The first is taken shortly after you start editing.
                </p>
              ) : (
                <div className="space-y-2 mb-4">
                  {snapshots.map((snap, i) => {
                    const d = describe(snap);
                    return (
                      <div key={snap.at + '-' + i}
                           className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-800/50 border border-slate-700/50 rounded-lg">
                        <div className="min-w-[220px]">
                          <div className="text-sm text-slate-200">
                            {when(snap.at)}
                            {snap.reason !== 'auto' && (
                              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/40">
                                {snap.reason}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {new Date(snap.at).toLocaleString()}
                          </div>
                        </div>
                        <div className="text-xs text-slate-400 flex-1 min-w-[200px]">
                          {d ? (
                            <>{d.accounts} accounts · {formatCurrency(d.balance)} · retire at {d.retireAt}
                               {d.spend ? <> · {formatCurrency(d.spend)}/yr</> : null}</>
                          ) : 'unreadable copy'}
                        </div>
                        <button onClick={() => restore(snap)} className={buttonSecondary}>Restore</button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowSnapshots(false)} className={buttonPrimary}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {survivorNotice && (() => {
        // Say what moved in THIS plan, not what the feature does in general. The
        // horizon comes from the engine's own rule rather than a second copy of
        // it, so the figure quoted here is the figure the projection will use.
        const n = survivorNotice;
        // Where a plan ENDS is decided by two different rules, and only one of
        // them is getPlanningHorizonYears — that helper is a floor and can only
        // extend. The shortening comes from computeProjections stopping the year
        // both spouses have died. Quoting the helper here would have promised a
        // horizon change the projection does not make (and, in the shortening
        // case, stayed silent about the one it does), so the figures below are
        // measured from the projection itself. Two extra engine runs, once, only
        // while this notice is on screen.
        const endOf = (on) => {
          try {
            const p = computeProjections({ ...personalInfo, survivorModelEnabled: on },
              accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses);
            return p.length ? p[p.length - 1].myAge : null;
          } catch (e) { return null; }
        };
        const was = endOf(false), now = endOf(true);
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className={`${cardStyle} max-w-xl w-full`}>
              <h3 className="text-xl font-bold text-slate-100 mb-3">Your plan now models the first death</h3>
              <p className="text-sm text-slate-300 leading-relaxed mb-3">
                Survivor modelling used to be off by default, so this plan ran both of you to age{' '}
                {n.legacyAge} with two Social Security cheques and joint tax brackets the whole way —
                including years after one of you would have died. It is on now. Three things change, and
                they do not all point the same way:
              </p>
              <ul className="text-sm text-slate-300 space-y-1.5 mb-3 list-disc pl-5">
                <li>The survivor files <strong>single</strong> — narrower brackets and one standard
                    deduction on much the same income. This is the widow&rsquo;s-year trap, and it raises tax.</li>
                <li>Spending drops to <strong>{Math.round((n.spendingFactor || 0.75) * 100)}%</strong> and the
                    smaller Social Security benefit stops, which pulls taxable withdrawals down.</li>
                <li>The plan now ends when <em>both</em> of you have died rather than at your
                    planning age
                    {Number.isFinite(was) && Number.isFinite(now) && was !== now ? (
                      <> — it runs to <strong className="text-amber-400">age {now}</strong> now instead of
                        age {was}, {now < was ? `${was - now} years shorter` : `${now - was} years longer`}</>
                    ) : ' — which for your ages leaves the last year where it was'}.</li>
              </ul>
              <p className="text-xs text-slate-500 leading-relaxed mb-4">
                Nothing about your accounts, contributions or balances was edited. If you would rather see
                the simpler view, <strong className="text-slate-400">Personal Info → Survivor Modeling</strong>{' '}
                turns it back off — and the life-expectancy fields next to it are what set the horizon above,
                so they are worth a look either way.
              </p>
              <div className="flex justify-end">
                <button onClick={() => setSurvivorNotice(null)} className={buttonPrimary}>Got it</button>
              </div>
            </div>
          </div>
        );
      })()}

      {splitNotice && splitNotice.length > 0 && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className={`${cardStyle} max-w-xl w-full`}>
            <h3 className="text-xl font-bold text-slate-100 mb-3">Your 401(k) contributions were split</h3>
            <p className="text-sm text-slate-300 leading-relaxed mb-3">
              This plan had {splitNotice.length === 1 ? 'an account' : 'accounts'} whose contributor was set
              to <strong>&ldquo;Both&rdquo;</strong> — one figure covering your deferral and your employer&rsquo;s
              match together. Nothing could tell the two apart, so that money counted toward neither your
              savings rate nor your employer&rsquo;s, and none of it was deducted from your taxable income.
              It has been split so it finally counts:
            </p>
            <table className="w-full text-sm mb-3">
              <thead>
                <tr className="text-slate-500 text-xs uppercase tracking-wide">
                  <th className="text-left font-semibold pb-1">Account</th>
                  <th className="text-right font-semibold pb-1">Was</th>
                  <th className="text-right font-semibold pb-1">You</th>
                  <th className="text-right font-semibold pb-1">Employer</th>
                </tr>
              </thead>
              <tbody>
                {splitNotice.map((r, i) => (
                  <tr key={i} className="border-t border-slate-700/50">
                    <td className="py-1.5 text-slate-200">{r.name}</td>
                    <td className="py-1.5 text-right text-slate-400">{formatCurrency(r.total)}</td>
                    <td className="py-1.5 text-right text-sky-400 font-semibold">{formatCurrency(r.employee)}</td>
                    <td className="py-1.5 text-right text-indigo-400 font-semibold">{formatCurrency(r.employer)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              The totals and your balances are unchanged — only the attribution. The 8:3 ratio is an
              assumption, because the split was never recorded: it is a typical 8% deferral against the
              most common employer formula. <strong className="text-slate-400">If your real numbers differ,
              correct them on the Accounts tab</strong> — your deferral and the employer row are now
              separate lines you can edit.
            </p>
            <div className="flex justify-end">
              <button onClick={() => setSplitNotice(null)} className={buttonPrimary}>Got it</button>
            </div>
          </div>
        </div>
      )}
      {showReport === 'menu' && (
        <ReportMenu onPick={(v) => setShowReport(v)} onClose={() => setShowReport(null)} />
      )}
      {showReport === 'next12' && (
        <NextYearReport
          projections={displayProjections}
          personalInfo={personalInfo}
          accounts={accounts}
          incomeStreams={incomeStreams}
          onClose={() => setShowReport(null)}
        />
      )}
      {showReport === 'breaks' && (
        <BreakingPointReport
          projections={displayProjections}
          personalInfo={personalInfo}
          accounts={accounts}
          incomeStreams={incomeStreams}
          assets={assets}
          oneTimeEvents={oneTimeEvents}
          recurringExpenses={recurringExpenses}
          onClose={() => setShowReport(null)}
        />
      )}
      {showReport === 'roadmap' && (
        <RothRoadmapReport
          computeProjections={computeProjections}
          projections={projections}
          personalInfo={personalInfo}
          accounts={accounts}
          incomeStreams={incomeStreams}
          assets={assets}
          oneTimeEvents={oneTimeEvents}
          recurringExpenses={recurringExpenses}
          onClose={() => setShowReport(null)}
        />
      )}
      {showReport === 'scenarios' && (
        <ScenarioComparisonReport
          computeProjections={displayComputeProjections}
          projections={displayProjections}
          personalInfo={personalInfo}
          accounts={accounts}
          incomeStreams={incomeStreams}
          assets={assets}
          oneTimeEvents={oneTimeEvents}
          recurringExpenses={recurringExpenses}
          scenarios={scenarios}
          onClose={() => setShowReport(null)}
        />
      )}
      {showReport === 'claiming' && (
        <ClaimingDecisionReport
          projections={projections}
          personalInfo={personalInfo}
          accounts={accounts}
          incomeStreams={incomeStreams}
          assets={assets}
          oneTimeEvents={oneTimeEvents}
          recurringExpenses={recurringExpenses}
          onClose={() => setShowReport(null)}
        />
      )}
      {showReport === 'survivor' && (
        <SurvivorTaxReport
          projections={projections}
          personalInfo={personalInfo}
          incomeStreams={incomeStreams}
          onClose={() => setShowReport(null)}
        />
      )}
      {showReport === 'summary' && (
        <PlanSummaryReport
          projections={displayProjections}
          personalInfo={personalInfo}
          accounts={accounts}
          incomeStreams={incomeStreams}
          assets={assets}
          onClose={() => setShowReport(null)}
        />
      )}
    </div>
  );
}

