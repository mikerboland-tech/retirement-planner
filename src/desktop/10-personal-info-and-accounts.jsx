// ============================================
// PersonalInfoTab — Lifted to module scope
// ============================================
// How long Personal Info waits after the last keystroke before writing to the
// plan. Long enough that typing "65" is one projection, not two.
const PERSONAL_INFO_WRITE_DELAY_MS = 400;

function PersonalInfoTab({ onShowEverything, onOpenTaxPlanning, accounts, dataWarnings, detailLevel, incomeStreams, oneTimeEvents, personalInfo, recurringExpenses, sectionVisibility, setDataWarnings, setOneTimeEvents, setPersonalInfo, setRecurringExpenses, setSectionVisibility }) {
  // The form keeps its own copy so typing stays instant, and every edit reaches
  // the plan by itself shortly after — like every other tab. Until v2.52.0 edits
  // waited for a "Save Changes" button, and leaving the tab without pressing it
  // threw them away without a word: change the planning age, click Accounts,
  // come back, and it was the old number again.
  //
  // Batched rather than written per keystroke because each write re-runs the
  // whole projection. Only the fields edited here are sent, merged onto the
  // plan as it is NOW, so a change made elsewhere meanwhile (the basis switch
  // in the top bar) is never overwritten by this tab's older copy.
  const [localInfo, setLocalInfo] = useState(personalInfo);
  const pendingEdits = useRef({});
  const flushTimer = useRef(null);
  const flushEdits = useCallback(() => {
    clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const patch = pendingEdits.current;
    pendingEdits.current = {};
    if (!Object.keys(patch).length) return;
    // Birth years follow the ages, as they did on Save — the RMD age is read
    // from the birth year.
    const year = new Date().getFullYear();
    if ('myAge' in patch) patch.myBirthYear = year - patch.myAge;
    if ('spouseAge' in patch && patch.spouseAge) patch.spouseBirthYear = year - patch.spouseAge;
    setPersonalInfo(prev => ({ ...prev, ...patch }));
  }, [setPersonalInfo]);
  // Leaving the tab mid-edit sends what is waiting instead of dropping it.
  useEffect(() => () => flushEdits(), [flushEdits]);

  const handleChange = (field, value) => {
    setLocalInfo(prev => ({ ...prev, [field]: value }));
    pendingEdits.current[field] = value;
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flushEdits, PERSONAL_INFO_WRITE_DELAY_MS);
  };
  
  // Check for data inconsistencies that need user attention
  const getDataWarnings = (info) => {
    const warnings = [];
    const isMarried = info.hasSpouse || info.filingStatus === 'married_joint' || info.filingStatus === 'married_separate';

    // ── Ages that cannot be in that order ───────────────────────────────────
    // The engine survives every one of these — it was fuzzed against them and
    // returned rows for all — but a plan that retires before today, or plans to
    // an age already passed, describes nothing, and it used to say nothing.
    // The worst is a life expectancy below the current age: with survivor
    // modelling on, that produces a ONE-ROW projection that looks like a plan.
    const ageWarn = (type, message, action) => warnings.push({ type, severity: 'warning', message, action });
    if (Number.isFinite(info.myRetirementAge) && info.myRetirementAge < info.myAge) {
      ageWarn('retirement_before_now',
        `Retirement age ${info.myRetirementAge} is earlier than your current age ${info.myAge}.`,
        'If you are already retired, set retirement age equal to your current age so the plan starts drawing now.');
    }
    if (isMarried && Number.isFinite(info.spouseRetirementAge) && Number.isFinite(info.spouseAge)
        && info.spouseRetirementAge < info.spouseAge) {
      ageWarn('spouse_retirement_before_now',
        `Your spouse's retirement age ${info.spouseRetirementAge} is earlier than their current age ${info.spouseAge}.`,
        'Set it to their current age if they have already retired.');
    }
    if (Number.isFinite(info.legacyAge) && info.legacyAge <= (info.myRetirementAge ?? 0)) {
      ageWarn('horizon_before_retirement',
        `Planning age ${info.legacyAge} is not after your retirement age ${info.myRetirementAge}, so the plan has no retirement years to project.`,
        'Raise Planning / Legacy Age — 95 is the usual default.');
    }
    const lifeTooShort = [
      ['myLifeExpectancy', info.myAge, 'your'],
      ...(isMarried ? [['spouseLifeExpectancy', info.spouseAge, "your spouse's"]] : []),
    ].filter(([k, age]) => Number.isFinite(info[k]) && Number.isFinite(age) && info[k] < age);
    lifeTooShort.forEach(([k, age, whose]) => ageWarn('life_expectancy_passed',
      `Life expectancy for ${whose} is set to ${info[k]}, which is below the current age of ${age}.`,
      'With survivor modelling on this ends the plan immediately. Raise it — the field sets when each spouse dies in the projection.'));
    // Social Security cannot be claimed before 62 or usefully after 70; the
    // repricing helper extrapolates outside that range rather than refusing.
    [['mySSClaimAge', 'your'], ...(isMarried ? [['spouseSSClaimAge', "your spouse's"]] : [])]
      .filter(([k]) => Number.isFinite(info[k]) && (info[k] < 62 || info[k] > 70))
      .forEach(([k, whose]) => ageWarn('ss_claim_out_of_range',
        `Social Security claiming age for ${whose} benefit is ${info[k]}; benefits can only start between 62 and 70.`,
        'Set it inside that range — 70 is the latest that increases the benefit.'));
    if (Number.isFinite(info.desiredRetirementIncome) && info.desiredRetirementIncome <= 0) {
      ageWarn('no_spending_target',
        'Desired retirement spending is zero, so the plan never withdraws and every tax and legacy figure describes a plan nobody would live.',
        "Enter what you expect to spend per year in retirement, in today's dollars.");
    }
    // Cost basis is a SHARE of the balance. The engine now clamps it, but the
    // user should know a value was corrected rather than find a different
    // capital-gains figure than the one they entered implies.
    const badBasis = accounts.filter(a => typeof a.costBasisPercent === 'number'
      && (a.costBasisPercent > 1 || a.costBasisPercent < 0));
    if (badBasis.length) {
      warnings.push({
        type: 'cost_basis_out_of_range', severity: 'warning',
        message: `${badBasis.length} account(s) have a cost basis outside 0–100% of the balance:`,
        details: badBasis.map(a => `"${a.name}" is set to ${Math.round(a.costBasisPercent * 100)}%`),
        action: 'Cost basis is the share of the balance that was contributed (not gains). The engine treats anything outside the range as 0% or 100%.',
      });
    }

    // Check accounts with stopAge that don't match retirement age.
    // IRA-type accounts (Traditional/Roth IRA) allow a spousal contribution: as long as
    // EITHER spouse has earned income, both spouses' IRAs stay eligible — so a stop age
    // matching EITHER retirement age is legitimate, not just the account owner's own.
    // (We can't safely convert between the two ages when spouses aren't the same age, so
    // we treat both retirement ages as valid rather than guessing a single "expected" one.)
    // Employer plans (401k/403b/457b) require the owner's own employment, so those stay
    // tied strictly to the owner's own retirement age.
    const isIraType = (type) => type === 'traditional_ira' || type === 'roth_ira';
    const isStopAgeExpected = (a) => {
      if (isIraType(a.type) && isMarried) {
        return a.stopAge === info.myRetirementAge || a.stopAge === info.spouseRetirementAge;
      }
      return a.stopAge === (a.owner === 'spouse' ? info.spouseRetirementAge : info.myRetirementAge);
    };
    const accountsWithOldStopAge = accounts.filter(a => {
      return a.contribution > 0 && !isStopAgeExpected(a) && a.stopAge > info.myAge;
    });
    if (accountsWithOldStopAge.length > 0) {
      warnings.push({
        type: 'retirement_age_accounts',
        severity: 'warning',
        message: `${accountsWithOldStopAge.length} account(s) have contribution stop ages that don't match either retirement age:`,
        details: accountsWithOldStopAge.map(a => `"${a.name}" stops contributions at age ${a.stopAge}`),
        action: 'Update stop ages on the Accounts tab, or this may be intentional (e.g., employer match ending early, or a spousal IRA contribution funded by the other spouse\'s earned income).'
      });
    }

    // Check accounts whose contribution start age is still in the future — the engine
    // skips contributions until the owner reaches startAge, so these accounts silently
    // contribute nothing for the first year(s). Common after lowering your current age
    // in Personal Info (account start ages don't shift automatically).
    const ownerCurrentAge = (a) => a.owner === 'spouse' ? info.spouseAge
      : a.owner === 'joint' ? Math.max(info.myAge, info.spouseAge || info.myAge)
      : info.myAge;
    const hasActiveContribution = (a) => a.contribution > 0 ||
      (a.contributionMode === 'percent' && ((a.employeePercent || 0) + (a.employerMatchPercent || 0)) > 0);
    const accountsStartingLater = accounts.filter(a =>
      hasActiveContribution(a) && a.startAge > ownerCurrentAge(a) && a.startAge < a.stopAge);
    if (accountsStartingLater.length > 0) {
      warnings.push({
        type: 'contribution_start_in_future',
        severity: 'info',
        message: `${accountsStartingLater.length} account(s) have contribution start ages in the future, so they won't contribute for the first year(s):`,
        details: accountsStartingLater.map(a => {
          const gap = a.startAge - ownerCurrentAge(a);
          return `"${a.name}" starts contributions at age ${a.startAge} — ${gap} year${gap === 1 ? '' : 's'} from now`;
        }),
        action: 'If contributions should begin immediately, lower the start age on the Accounts tab to the owner\'s current age. If the account opens later by design, no action needed.'
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
    if (conversionIsActive(info) && info.rothConversionStartAge < info.myRetirementAge) {
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
      // 'joint' counts here too: a jointly-owned salary running past the
      // primary's retirement age is exactly the situation this warns about.
      const activeEarned = incomeStreams.filter(s => s.type === 'earned_income' && s.endAge > info.myAge
        && (s.owner === 'me' || s.owner === 'joint'));
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
      
      // Warn if spouse has no earned income streams at all but has a retirement age set.
      // Skip IRA-type accounts (Traditional/Roth IRA) when the OTHER spouse still has
      // earned income — a spousal IRA contribution is funded from the working spouse's
      // income and doesn't require the account owner to have their own earned income.
      if (spouseEarned.length === 0 && info.spouseAge && info.spouseAge < spouseRetAge) {
        const myEarned = incomeStreams.filter(s => s.type === 'earned_income' && s.owner === 'me' && s.endAge > info.myAge);
        const spousalContributionCovered = myEarned.length > 0;
        const spouseAcctsWithContributions = accounts.filter(a => a.owner === 'spouse' && a.contribution > 0
          && !(spousalContributionCovered && isIraType(a.type)));
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
    

    // ── Retiring before Medicare with healthcare modelling switched off ────────
    // The single largest silent omission a plan can have. Someone retiring at 60
    // has five years to cover before Medicare, and for a couple that is six
    // figures. 'none' zeroes it out, and the pre-65 amount the user already typed
    // sits there doing nothing — so this points at their OWN number.
    {
      const earliestRet = Math.min(info.myRetirementAge || 65,
        (info.filingStatus === 'married_joint' && info.spouseRetirementAge) ? info.spouseRetirementAge : 999);
      if (info.healthcareModel === 'none' && earliestRet < 65) {
        const gapYears = 65 - earliestRet;
        const people = info.filingStatus === 'married_joint' ? 2 : 1;
        const perYear = (info.pre65HealthcareAnnual || 0) * people;
        warnings.push({
          type: 'no_healthcare_before_medicare',
          severity: 'warning',
          message: `You retire at ${earliestRet}, which is ${gapYears} year${gapYears === 1 ? '' : 's'} before Medicare starts at 65 — but healthcare modelling is set to "Not Modeled", so the projection charges $0 for it.`,
          details: [
            perYear > 0
              ? `Your own pre-65 figure is ${formatCurrency(info.pre65HealthcareAnnual)}/person, which for ${people === 2 ? 'two people' : 'one person'} would be about ${formatCurrency(perYear)}/year before medical inflation — currently ignored.`
              : 'No pre-65 amount is set either, so there is nothing for the projection to use.',
            'Medicare Part B and Part D premiums ARE still charged from 65 onward, so only the pre-65 gap is missing.',
          ],
          action: 'If your Desired Retirement Income already covers these premiums — retiree coverage through a spouse’s employer or pension system, for instance — set Healthcare Modeling to "Already In My Spending" and this warning will stop. Otherwise switch it to Basic/Moderate/Comprehensive so the gap is costed. Leaving it on "Not Modeled" overstates what the portfolio can support.'
        });
      }
    }

    // ── Planning horizon shorter than a life expectancy ───────────────────────
    // legacyAge ends the projection. If someone is expected to outlive it, the
    // plan simply stops modelling their last years.
    {
      const legacy = info.legacyAge || 95;
      const overshoot = [];
      if ((info.myLifeExpectancy || 0) > legacy) overshoot.push(`yours (${info.myLifeExpectancy})`);
      if (info.filingStatus === 'married_joint' && (info.spouseLifeExpectancy || 0) > legacy) {
        overshoot.push(`your spouse's (${info.spouseLifeExpectancy})`);
      }
      if (overshoot.length) {
        // With survivor modelling on, the horizon now stretches by itself to cover
        // whoever lives longest, so nothing is missing — the two inputs merely
        // disagree, and the ending balance is being read at a later age than the
        // Planning / Legacy Age field claims. That is worth saying, but it is not
        // the same defect as silently dropping years, so it is only info.
        const autoExtends = !!info.survivorModelEnabled && info.filingStatus === 'married_joint';
        const longest = Math.max(info.myLifeExpectancy || 0, info.spouseLifeExpectancy || 0);
        warnings.push({
          type: 'horizon_shorter_than_life_expectancy',
          severity: autoExtends ? 'info' : 'warning',
          message: `Your planning horizon ends at age ${legacy}, but a life expectancy you entered is higher: ${overshoot.join(' and ')}.`,
          details: [
            autoExtends
              ? `Survivor modelling is on, so the projection already runs to age ${longest} rather than stopping at ${legacy} and leaving someone alive with unfunded years. Your ending balance is therefore measured at ${longest}, not ${legacy}.`
              : 'The projection stops at the planning age, so any years beyond it are not modelled at all — including the spending they would need.',
          ],
          action: autoExtends
            ? `Set Planning / Legacy Age to ${longest} so the field matches the age the plan actually reports.`
            : `Raise Planning / Legacy Age to at least ${longest} so the plan covers the whole time you expect to need it.`
        });
      }
    }

    // ── An HSA with no qualified medical expenses to spend it on ──────────────
    // The engine no longer treats an HSA as an unlimited tax-free bucket, so a
    // plan that models no healthcare AND states no medical spending will have
    // every HSA dollar taxed as ordinary income — with a 20% penalty before 65.
    // That is the correct reading of what was entered, but it is almost never
    // what the household means, so it is worth saying out loud.
    {
      const hsaBalance = accounts
        .filter(a => a.type === 'hsa')
        .reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
      const statedQME = info.hsaQualifiedExpenses || 0;
      if (hsaBalance > 0 && statedQME === 0 && !healthcareCostsModeled(info)) {
        warnings.push({
          type: 'hsa_without_qualified_expenses',
          severity: 'warning',
          message: `You have ${formatCurrency(hsaBalance)} in an HSA, but the plan models no medical spending for it to cover — so every withdrawal is taxed as ordinary income.`,
          details: [
            'HSA withdrawals are tax-free only up to qualified medical expenses. Beyond that they are ordinary income, plus a 20% additional tax before age 65.',
            'With healthcare left unmodelled and no medical expenses entered, the projection has no qualified expenses to apply — which understates the value of your HSA, probably substantially.',
          ],
          action: 'Enter your Annual Qualified Medical Expenses on the Personal tab, or switch Healthcare Modeling to Basic or better so the projection knows what the HSA is paying for.'
        });
      }
    }

    // ── RMDs computed from the wrong IRS table ────────────────────────────────
    // Table II (Joint and Last Survivor) governs when the spouse is sole
    // beneficiary and more than 10 years younger; this engine applies Table III
    // (Uniform Lifetime) to everyone. Stated plainly, with the direction of the
    // error, rather than left for someone to trip over.
    if (rmdUsesJointTable(info)) {
      const gap = info.myAge - info.spouseAge;
      warnings.push({
        type: 'rmd_joint_table_assumption',
        severity: 'info',
        message: `Your spouse is ${gap} years younger, so this plan uses the IRS joint life expectancy table for your RMDs — giving smaller required distributions than the standard table.`,
        details: [
          'IRS Pub 590-B Table II (Joint and Last Survivor) applies when a spouse is the sole designated beneficiary and more than 10 years younger. It uses a larger divisor, so less is forced out of your pre-tax accounts each year.',
          'This app does not ask who your beneficiaries are, so it assumes your spouse is the sole beneficiary of your pre-tax accounts.',
        ],
        action: 'If someone other than your spouse is named as a beneficiary on those accounts — a trust or your children, for instance — the standard Uniform Lifetime table applies instead and your real RMDs will be larger than shown.'
      });
    }

    // ── A spouse with no Social Security stream at all ────────────────────────
    // The engine tops a spouse up to 50% of the higher earner's PIA, but it can
    // only do that for a stream that exists. Someone whose partner never worked
    // will naturally leave Social Security off for them entirely — and silently
    // forfeit what is often the second-largest income line in the plan. The
    // engine deliberately does not invent the stream: a spousal benefit requires
    // a year of marriage and eligibility this app cannot verify. So it says so.
    if (info.filingStatus === 'married_joint') {
      const ssOf = (o) => incomeStreams.find(s => s.type === 'social_security' && s.owner === o);
      const mine = ssOf('me'), theirs = ssOf('spouse');
      const missing = (mine && mine.pia > 0 && !theirs) ? 'spouse'
                    : (theirs && theirs.pia > 0 && !mine) ? 'me' : null;
      if (missing) {
        const worker = missing === 'spouse' ? mine : theirs;
        const half = Math.round((worker.pia || 0) * 0.5);
        warnings.push({
          type: 'missing_spousal_social_security',
          severity: 'warning',
          message: `${missing === 'spouse' ? 'Your spouse has' : 'You have'} no Social Security income stream, but a spouse can claim on the other's record — worth up to ${formatCurrency(half)}/month here.`,
          details: [
            `A spouse receives the greater of their own benefit or 50% of the higher earner's PIA (${formatCurrency(worker.pia)}/month), even with no earnings record of their own.`,
            'Claimed before their own full retirement age it is reduced — 35% at 62 — and unlike a worker benefit it earns nothing by waiting past FRA.',
            'Generally requires at least one year of marriage, so this is not added automatically.',
          ],
          action: `Add a Social Security stream on the Income tab for ${missing === 'spouse' ? 'your spouse' : 'yourself'}. Enter their own PIA if they have one — the projection pays whichever is larger.`
        });
      }
    }

    // ── Annuity purchases the rules or the balances will not allow ───────────
    (incomeStreams || []).forEach(st => {
      if (!st || st.type !== 'annuity' || !(st.premium > 0) || !st.fundedFrom || st.fundedFrom === 'none') return;
      const purchaseAge = st.purchaseAge ?? st.startAge;
      if (annuityIsQLAC(st)) {
        if (st.premium > QLAC_PREMIUM_LIMIT_2026) warnings.push({
          type: 'qlac_over_limit', severity: 'warning',
          message: `${st.name || 'Your QLAC'} has a ${formatCurrency(st.premium)} premium, above the ${formatCurrency(QLAC_PREMIUM_LIMIT_2026)} limit on qualifying longevity annuity contracts.`,
          details: ['Only premiums up to the limit are excluded from the RMD base; the projection removes the whole premium.'],
          action: 'Lower the premium to the limit, or split the purchase across years.'
        });
        if (st.startAge > QLAC_MAX_START_AGE) warnings.push({
          type: 'qlac_late_start', severity: 'warning',
          message: `${st.name || 'Your QLAC'} starts paying at ${st.startAge}, but a QLAC must begin by ${QLAC_MAX_START_AGE}.`,
          details: ['Payments deferred past 85 fall outside the QLAC rules.'],
          action: `Set the start age to ${QLAC_MAX_START_AGE} or earlier.`
        });
      }
      const typeOk = st.fundedFrom === 'pretax' ? (a) => ['401k', '403b', '457b', 'traditional_ira', 'sep_ira', 'simple_ira'].includes(a.type)
        : st.fundedFrom === 'roth' ? (a) => String(a.type).startsWith('roth')
        : (a) => a.type === 'brokerage';
      const available = (accounts || []).filter(typeOk).reduce((t, a) => t + (a.balance || 0), 0);
      if (available <= 0) warnings.push({
        type: 'annuity_no_source', severity: 'warning',
        message: `${st.name || 'An annuity'} is to be bought from ${st.fundedFrom === 'pretax' ? 'pre-tax' : st.fundedFrom} money at ${purchaseAge}, but the plan has no such account.`,
        details: ['The purchase will fund nothing and the payout will be scaled to zero.'],
        action: 'Choose the account type that will pay the premium, or mark the annuity as already owned.'
      });
      if (st.startAge < purchaseAge) warnings.push({
        type: 'annuity_starts_before_purchase', severity: 'warning',
        message: `${st.name || 'An annuity'} starts paying at ${st.startAge} but is bought at ${purchaseAge}.`,
        details: ['Payments before the purchase are not paid.'],
        action: 'Set the start age at or after the purchase age.'
      });
    });

    // ── A bracket-fill order that leaves the conversion nothing to fill ───────
    // Withdrawals run before the conversion and the conversion prices its room
    // from what they already booked, so a fill bracket at or above the
    // conversion bracket means the conversion converts nothing in any year
    // spending reaches the bracket top.
    {
      const fill = info.withdrawalBracketFill || '';
      const conv = info.rothConversionBracket || '';
      const rank = { '10%': 0, '12%': 1, '22%': 2, '24%': 3, '32%': 4, '35%': 5, '37%': 6 };
      if (fill && conv && rank[fill] !== undefined && rank[conv] !== undefined && rank[fill] >= rank[conv]) {
        warnings.push({
          type: 'bracket_fill_vs_conversion',
          severity: 'info',
          message: `Spending fills the ${fill} bracket from pre-tax, but the Roth conversion is set to fill only the ${conv} bracket.`,
          details: ['Withdrawals come first and the conversion fills whatever bracket room they leave, so in any year spending reaches the top of the ' + fill + ' bracket the conversion has nothing left to fill and converts $0.'],
          action: 'Set the conversion to a higher bracket than the withdrawal fill, or lower the withdrawal fill, so each has its own room.'
        });
      }
    }

    // ── Healthcare handled yourself, but long-term care still billed ─────
    // These are two independent controls, and deliberately so: long-term care
    // is not the kind of cost anyone budgets inside an ordinary spending target.
    // But a reader who set healthcare to 'none' or 'already in my spending'
    // reasonably reads that as "I handle my own medical costs", and will not
    // expect a separate six-figure care bill in the final years on top of the
    // target. Until v2.23.0 the engine silently ignored the care setting for
    // exactly these healthcare models, so a plan saved before then had it on in
    // the control and off in the arithmetic; the fix made the control true and
    // changed those plans' numbers without anyone touching them. Said out loud
    // here, with the figure, so the interaction is a choice rather than a
    // surprise.
    {
      const ltc = info.ltcModel || 'none';
      if (ltc !== 'none' && !healthcareCostsModeled(info)) {
        const months = ltc === 'custom' ? (info.ltcDurationMonths || LTC_DEFAULT_DURATION_MONTHS)
          : ltc === 'stress' ? LTC_STRESS_MONTHS : LTC_DEFAULT_DURATION_MONTHS;
        const monthly = ltc === 'custom' ? (info.ltcMonthlyAmount || LTC_MONTHLY_ASSISTED_LIVING_2025)
          : ltc === 'stress' ? LTC_MONTHLY_NURSING_HOME_2025 : LTC_MONTHLY_ASSISTED_LIVING_2025;
        const people = info.filingStatus === 'married_joint' && ltc !== 'stress' ? 2 : 1;
        warnings.push({
          type: 'ltc_on_with_unpriced_healthcare',
          severity: 'info',
          message: `Healthcare is set to "${info.healthcareModel === 'in_spending' ? 'already in my spending' : 'none'}", but long-term care is still billed separately.`,
          details: [
            `${months} months of care at ${formatCurrency(monthly)}/month in today's dollars`
              + `${people > 1 ? ', for each of you' : ''} — about ${formatCurrency(months * monthly * people)} in today's dollars, `
              + `charged on top of your spending target in the final years before each life expectancy.`,
            `It compounds at the medical inflation rate (${Math.round((info.medicalInflation || 0.05) * 100)}%/yr), so the figure shown in the projection table is much larger in future dollars.`,
          ],
          action: 'If your spending target already covers care, set Long-Term Care to None on this tab. If it does not, this is the cost to plan for.',
        });
      }
    }

    // ── A pre-tax floor that spending will fight ──────────────────────────────
    // The floor now holds spending back, but if pre-tax is FIRST in the priority
    // order the two settings are working against each other every single year.
    {
      const floor = info.rothConversionPreTaxFloor || 0;
      const priority = info.withdrawalPriority || ['pretax', 'brokerage', 'roth'];
      if (floor > 0 && priority[0] === 'pretax') {
        warnings.push({
          type: 'pretax_floor_vs_priority',
          severity: 'info',
          message: `You asked to preserve ${formatCurrency(floor)} of pre-tax balance, but your withdrawal order spends pre-tax accounts FIRST.`,
          details: ['The floor is honoured — spending stops at it and moves on to brokerage or Roth — so the two settings do not conflict outright.'],
          action: 'If the floor exists to keep QCD capacity at 70+, consider moving pre-tax later in the withdrawal order so the balance grows rather than sitting at the floor.'
        });
      }
    }


    // ── Conversions configured with nowhere to put them ───────────────────────
    // The engine needs a Roth account to receive a conversion. Without one it
    // silently converts nothing, so a user can configure a whole strategy, see it
    // reflected nowhere, and have no idea why.
    {
      const wantsConversions = conversionIsActive(info);
      const hasRoth = accounts.some(a => ROTH_TYPES.includes(a.type));
      if (wantsConversions && !hasRoth) {
        warnings.push({
          type: 'roth_conversion_no_destination',
          severity: 'warning',
          message: 'You have Roth conversions configured, but there is no Roth account for the money to go into — so no conversion is happening.',
          details: ['The projection moves money from your largest pre-tax account into your largest Roth account. With no Roth account it converts $0 every year, silently.'],
          action: 'Add a Roth IRA or Roth 401(k) on the Accounts tab (a $0 balance is fine) and the conversions will start running.'
        });
      }
    }
    return warnings;
  };
  
  // dataWarnings state is in parent RetirementPlanner scope (survives re-renders)

  // Run the checks when the tab opens and whenever the plan materially changes —
  // not only on Save. Warnings used to be produced solely inside savePersonalInfo,
  // so a plan that was imported, restored from storage, or built by the wizard
  // never showed them: the user had to happen to re-save this tab to learn their
  // plan had a problem. Keyed on a signature of the fields the checks read, so
  // dismissing a warning sticks until something relevant actually changes.
  const warningSig = JSON.stringify([
    personalInfo.myAge, personalInfo.spouseAge, personalInfo.myRetirementAge,
    personalInfo.spouseRetirementAge, personalInfo.filingStatus, personalInfo.legacyAge,
    personalInfo.myLifeExpectancy, personalInfo.spouseLifeExpectancy,
    personalInfo.healthcareModel, personalInfo.pre65HealthcareAnnual,
    personalInfo.ltcModel, personalInfo.ltcMonthlyAmount, personalInfo.ltcDurationMonths,
    personalInfo.rothConversionPreTaxFloor, personalInfo.withdrawalPriority, personalInfo.withdrawalBracketFill,
    accounts.map(a => [a.id, a.type, a.owner, a.stopAge, a.contribution]),
    incomeStreams.map(s => [s.id, s.type, s.owner, s.endAge, s.amount]),
  ]);
  useEffect(() => {
    setDataWarnings(getDataWarnings(personalInfo));
  }, [warningSig]);


  const compactInputStyle = "w-full bg-slate-900/80 border border-slate-600/50 rounded px-3 py-1.5 text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50 transition-all text-sm";
  const compactLabelStyle = "text-xs font-medium text-slate-400";
  
  return (
    <div className="space-y-4">
      
      {/* Data consistency warnings — re-checked whenever the plan changes */}
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
      {onShowEverything && <HiddenSettingsNotice pi={personalInfo} onShowEverything={onShowEverything} />}
      <SectionControls tab="personal" vis={sectionVisibility} setVis={setSectionVisibility}
                       level={detailLevel} />
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
                <label className={compactLabelStyle}>My Retirement Month</label>
                <GridSelect
                  value={localInfo.myRetirementMonth || 1}
                  onChange={e => handleChange('myRetirementMonth', Number(e.target.value) || 1)}
                  options={RETIREMENT_MONTHS}
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
                <label className={compactLabelStyle}>Spouse Retirement Month</label>
                <GridSelect
                  value={localInfo.spouseRetirementMonth || 1}
                  onChange={e => handleChange('spouseRetirementMonth', Number(e.target.value) || 1)}
                  options={RETIREMENT_MONTHS}
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
                {/* How likely the plan's last age is, so it can be chosen on
                    purpose. Population averages, from the engine's table. */}
                {(() => {
                  const married = localInfo.filingStatus === 'married_joint';
                  const to = localInfo.legacyAge || 95;
                  const pct = (age) => Math.round(PlannerEngine.householdChanceAliveAt(localInfo, age) * 100);
                  if (!Number.isFinite(localInfo.myAge)) return null;
                  return (
                    <p className="text-[11px] text-slate-500 mt-1" data-longevity-odds>
                      Chance {married ? 'at least one of you is' : 'you are'} alive at {to}: <strong className="text-slate-300">{pct(to)}%</strong>
                      {to !== 90 && <> · at 90: {pct(90)}%</>}
                    </p>
                  );
                })()}
              </div>
              {/* This rate already existed on the plan and already drove the Roth
                  optimizer's ranking — it was just only editable from inside that
                  one panel, so a plan-wide assumption looked like a setting that
                  belonged to a single tool. It is now here, where the rest of the
                  plan-wide assumptions live, and every after-tax legacy figure in
                  the app reads this one number. */}
              <div>
                <label className={compactLabelStyle}>Heirs' tax rate (%)</label>
                <PercentCell
                  value={localInfo.heirTaxRate ?? 0.25}
                  onValueChange={v => handleChange('heirTaxRate', Math.min(0.6, Math.max(0, v || 0)))}
                  className={compactInputStyle}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">Retirement age determines when portfolio withdrawals begin. Birth year determines RMD start age per SECURE 2.0 Act. Planning/Legacy Age sets the end of all projections (default 95): the age the money has to last to. The odds under it are US population averages (CDC life tables); a family history of long lives is a reason to plan further.</p>
            <p className="text-xs text-slate-500 mt-1">
              The <strong>Future $ / Today's $</strong> switch at the top of every page chooses the yardstick, not the plan. <em>Future dollars</em> is
              what the engine computes — the actual number of dollars in the account in that year, inflation
              included. <em>Today's dollars</em> restates the same plan in current purchasing power, so
              $3M forty years out reads as what it would buy now. Nothing about the projection changes:
              contributions, taxes, RMDs and IRMAA are all computed on nominal figures because that is how the
              law indexes them, and only the displayed amounts are converted, at your inflation rate of{' '}
              {(((localInfo.inflationRate ?? 0.03) * 100)).toFixed(1)}%. Taxes &amp; Roth, Current Year and Monte
              Carlo keep their own basis, and say so on the page.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              <strong>Heirs' tax rate</strong> is the ordinary rate whoever inherits your pre-tax accounts is
              assumed to pay. Under the SECURE Act a non-spouse beneficiary has ten years to drain an
              inherited traditional IRA, at their own rates — so a pre-tax dollar is not worth a Roth dollar
              to them. Every "after-tax legacy" figure in the app discounts pre-tax balances by this rate;
              Roth and brokerage pass at face value (brokerage basis steps up at death). It does not change
              any tax you pay while alive.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              The retirement <strong>month</strong> is the month the paycheck stops. Choose July and the
              retirement year carries six months of salary — with the FICA and 401(k) deferrals that come with
              it — plus six months of any pension that starts that year, and the portfolio only has to cover
              what is left. That is usually the year with the least predictable tax bill, and the month is what
              makes it predictable. January means fully retired for the whole year, which is what the plan
              assumed before this field existed.
            </p>
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
                className={swapClass(compactInputStyle, 'text-slate-100', 'text-emerald-400') + ' font-medium'}
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
          {strategyLeadsSpending(localInfo) ? (
            <p className="text-xs text-slate-400 mt-2">
              Not used while your withdrawal strategy, <strong>{strategyLabelOf(localInfo)}</strong>, sets your spending
              (see Withdrawal strategy below). It is kept for when you switch back, and Coast FIRE still reads it as the
              spending you are aiming for.
            </p>
          ) : (
            <p className="text-xs text-slate-500 mt-2">This is your target annual spending in retirement (in today's dollars). It will be adjusted for inflation each year.</p>
          )}
        </div>
        
        <HideableBlock tab="personal" id="charitable" level={detailLevel}
                       vis={sectionVisibility} setVis={setSectionVisibility}>
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
              {(localInfo.charitableGivingPercent || 0) > 0 && (strategyLeadsSpending(localInfo) ? (
                <div className="text-sm text-slate-400">of the spending your withdrawal strategy sets each year</div>
              ) : (
                <div className="text-sm text-slate-400">
                  <span className="text-emerald-400 font-medium">
                    {formatCurrency(localInfo.desiredRetirementIncome * (localInfo.charitableGivingPercent / 100))}
                  </span>
                  {' '}per year in today's dollars
                </div>
              ))}
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
        </HideableBlock>
        
        {/* The conversion strategy used to be edited here AND in the Tax
            Planning simulator — two editors for the same twelve fields, one
            saving on this tab's button and one on its own. v2.48.0 left one:
            on Taxes & Roth, beside what the strategy actually does. */}
        <div className="border-t border-slate-700/50 mt-5 pt-5">
          <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Roth Conversions</h4>
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-800/50 border border-slate-700/50 rounded-lg">
            <p className="text-sm text-slate-300">
              {rothConversionIsPlanned(personalInfo) ? conversionModeLabel(personalInfo) : 'No conversions planned.'}
              <span className="block text-xs text-slate-500 mt-0.5">
                Set, compare and save your conversion strategy on the Taxes &amp; Roth tab.
              </span>
            </p>
            {onOpenTaxPlanning && (
              <button onClick={onOpenTaxPlanning}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-purple-500/40 text-purple-300 hover:bg-purple-500/10 transition-colors">
                Open Taxes &amp; Roth →
              </button>
            )}
          </div>
        </div>

        <HideableBlock tab="personal" id="withdrawalPriority" level={detailLevel}
                       vis={sectionVisibility} setVis={setSectionVisibility}>
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
              // Colours come from treatmentChip so these chips agree with every
              // chart and table that draws the same three buckets.
              const priority = localInfo.withdrawalPriority || ['pretax', 'brokerage', 'roth'];
              
              const moveUp = () => {
                if (idx === 0) return;
                const newPriority = [...priority];
                [newPriority[idx - 1], newPriority[idx]] = [newPriority[idx], newPriority[idx - 1]];
                handleChange('withdrawalPriority', newPriority);
              };

              const moveDown = () => {
                if (idx === priority.length - 1) return;
                const newPriority = [...priority];
                [newPriority[idx], newPriority[idx + 1]] = [newPriority[idx + 1], newPriority[idx]];
                handleChange('withdrawalPriority', newPriority);
              };
              
              return (
                <div key={item} className="flex items-center gap-3 px-4 py-2 rounded-lg border"
                     style={treatmentChip(item)}>
                  <span className="text-slate-500 font-bold text-lg w-6">{idx + 1}.</span>
                  <span className="flex-1 font-medium">{labels[item]}</span>
                  <div className="flex gap-1">
                    <button 
                      onClick={moveUp}
                      disabled={idx === 0}
                      className={`px-2 py-1 rounded text-sm ${idx === 0 ? 'text-slate-500 cursor-not-allowed' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                    >
                      &#9650;
                    </button>
                    <button 
                      onClick={moveDown}
                      disabled={idx === priority.length - 1}
                      className={`px-2 py-1 rounded text-sm ${idx === priority.length - 1 ? 'text-slate-500 cursor-not-allowed' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                    >
                      &#9660;
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 mt-3">
            <strong className="text-slate-400">Current strategy:</strong> After mandatory RMDs, {
              localInfo.withdrawalBracketFill ? `fill the ${localInfo.withdrawalBracketFill} bracket from Pre-Tax, then withdraw from ` : 'withdraw from '
            }{
              (localInfo.withdrawalPriority || ['pretax', 'brokerage', 'roth']).map((item, idx, arr) => {
                const labels = { pretax: 'Pre-Tax', brokerage: 'Brokerage', roth: 'Roth' };
                if (idx === arr.length - 1) return labels[item];
                if (idx === arr.length - 2) return labels[item] + ', then ';
                return labels[item] + ', ';
              }).join('')
            } last.
          </p>

          {/* Bracket-fill withdrawal order */}
          <div className="mt-4 p-3 bg-slate-800/40 border border-slate-700/50 rounded-lg">
            <label className="block text-sm text-slate-300 mb-1">
              Fill a tax bracket with pre-tax money first
            </label>
            <select
              value={localInfo.withdrawalBracketFill || ''}
              onChange={e => handleChange('withdrawalBracketFill', e.target.value)}
              className={inputStyle}
            >
              <option value="">Off — follow the order above only</option>
              <option value="10%">Up to the top of the 10% bracket</option>
              <option value="12%">Up to the top of the 12% bracket</option>
              <option value="22%">Up to the top of the 22% bracket</option>
              <option value="24%">Up to the top of the 24% bracket</option>
            </select>
            <p className="text-xs text-slate-500 mt-2">
              Bracket management: each retirement year, spending comes from pre-tax accounts until
              ordinary taxable income reaches the top of the chosen bracket, and only then from the
              order above. Pre-tax is drawn past the bracket only if the other accounts cannot cover
              the year. Turn this on when Roth or brokerage sits ahead of pre-tax in the order — it
              stops cheap bracket room going unused while tax-free money is spent. A Roth conversion
              set to fill a higher bracket picks up from where these withdrawals leave off.
            </p>
          </div>

          {/* §72(t) early withdrawal penalty — only relevant if you retire before 59½ */}
          {(localInfo.myRetirementAge < 60 || localInfo.spouseRetirementAge < 60) && (
            <div className="mt-4 p-3 bg-slate-800/40 border border-slate-700/50 rounded-lg">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localInfo.sepp72tEnabled || false}
                  onChange={e => handleChange('sepp72tEnabled', e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/50"
                />
                <span className="text-sm text-slate-300">
                  I'm using a 72(t) SEPP plan (no 10% early withdrawal penalty)
                  <span className="block text-xs text-slate-500 mt-1">
                    You're retiring before 59½, so pre-tax withdrawals normally carry a 10% IRS
                    penalty. The projection already waives it for 457(b) accounts, and for a
                    401(k)/403(b) when you separate at 55 or later (the "rule of 55"). Check this
                    box only if you've committed to substantially equal periodic payments — they
                    must continue until 59½ or 5 years, whichever is longer.
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>
        </HideableBlock>

        <HideableBlock tab="personal" id="spendingPhases" level={detailLevel}
                       vis={sectionVisibility} setVis={setSectionVisibility}>
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
        </HideableBlock>

        <HideableBlock tab="personal" id="guardrails" level={detailLevel}
                       vis={sectionVisibility} setVis={setSectionVisibility}>
        {/* How retirement spending is decided each year. The strategies and the
            research behind each are documented at WITHDRAWAL STRATEGIES in
            engine.js; Guyton-Klinger's rules at GUARDRAILS. */}
        <div className="border-t border-slate-700/50 mt-5 pt-5">
          <h4 className="text-sm font-semibold text-slate-300 mb-1 uppercase tracking-wide">Withdrawal Strategy</h4>
          <p className="text-xs text-slate-500 mb-3">
            How much you take each year in retirement. Every screen uses the one you pick — the Dashboard, reports,
            the plan-health check and the Will it last? simulations — and the What if… box can try the others.
          </p>
          {(() => {
            const strategy = PlannerEngine.withdrawalStrategyOf(localInfo);
            const setStrategy = (v) => {
              handleChange('withdrawalStrategy', v);
              handleChange('spendingGuardrailsEnabled', v === 'guardrails');
            };
            const pct = (k, d) => Math.round(((localInfo[k] ?? d) * 100) * 10) / 10;
            const setPct = (k, lo, hi) => (e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) handleChange(k, Math.min(hi, Math.max(lo, v)) / 100);
            };
            const withdrawalLed = PlannerEngine.WITHDRAWAL_LED.has(strategy);
            return (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className={compactLabelStyle}>Strategy</label>
                    <select value={strategy} onChange={e => setStrategy(e.target.value)} className={compactInputStyle}
                      aria-label="Withdrawal strategy">
                      {WITHDRAWAL_STRATEGY_CHOICES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div className="text-xs text-slate-400 self-end pb-1">
                    {(WITHDRAWAL_STRATEGY_CHOICES.find(c => c.id === strategy) || {}).what}
                  </div>
                </div>

                {['constant', 'percent', 'vanguard'].includes(strategy) && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className={compactLabelStyle}>{strategy === 'constant' ? 'First-year withdrawal (% of portfolio)' : 'Withdrawal (% of portfolio each year)'}</label>
                      <input type="number" min="0.5" max="20" step="0.1" value={pct('strategyRatePct', 0.04)}
                        onChange={setPct('strategyRatePct', 0.5, 20)} className={compactInputStyle}
                        aria-label="Withdrawal rate, percent" />
                      <span className="text-xs text-slate-500">{strategy === 'constant' ? 'Bengen: 4%' : 'Research: 4–5%'}</span>
                    </div>
                    {strategy === 'vanguard' && (
                      <>
                        <div>
                          <label className={compactLabelStyle}>Largest rise in a year (% after inflation)</label>
                          <input type="number" min="0" max="50" step="0.5" value={pct('vanguardCeilingPct', 0.05)}
                            onChange={setPct('vanguardCeilingPct', 0, 50)} className={compactInputStyle}
                            aria-label="Largest real rise in a year, percent" />
                          <span className="text-xs text-slate-500">Vanguard: 5%</span>
                        </div>
                        <div>
                          <label className={compactLabelStyle}>Largest fall in a year (% after inflation)</label>
                          <input type="number" min="0" max="50" step="0.5" value={pct('vanguardFloorPct', 0.025)}
                            onChange={setPct('vanguardFloorPct', 0, 50)} className={compactInputStyle}
                            aria-label="Largest real fall in a year, percent" />
                          <span className="text-xs text-slate-500">Vanguard: 2.5%</span>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {strategy === 'vpw' && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className={compactLabelStyle}>Expected real return (%, blank = your plan’s)</label>
                      <input type="number" min="-2" max="10" step="0.1"
                        value={Number.isFinite(localInfo.vpwRealReturn) ? Math.round(localInfo.vpwRealReturn * 1000) / 10 : ''}
                        placeholder="plan"
                        onChange={e => handleChange('vpwRealReturn', e.target.value === '' ? null : Math.min(10, Math.max(-2, Number(e.target.value))) / 100)}
                        className={compactInputStyle} aria-label="VPW expected real return, percent" />
                      <span className="text-xs text-slate-500">Your accounts’ growth minus inflation, if blank</span>
                    </div>
                  </div>
                )}

                {strategy === 'guardrails' && (
                  <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className={compactLabelStyle}>Guardrail band (± % of target rate)</label>
                    <input type="number" min="5" max="50" step="1" value={pct('guardrailBandPct', 0.20)}
                      onChange={setPct('guardrailBandPct', 5, 50)} className={compactInputStyle}
                      aria-label="Guardrail band, percent" />
                    <span className="text-xs text-slate-500">Research: 20%</span>
                  </div>
                  <div>
                    <label className={compactLabelStyle}>Adjustment (% of the withdrawal)</label>
                    <input type="number" min="1" max="50" step="1" value={pct('guardrailAdjustPct', 0.10)}
                      onChange={setPct('guardrailAdjustPct', 1, 50)} className={compactInputStyle}
                      aria-label="Guardrail adjustment, percent of the withdrawal" />
                    <span className="text-xs text-slate-500">Research: 10%</span>
                  </div>
                  <div>
                    <label className={compactLabelStyle}>Target withdrawal rate</label>
                    <select value={localInfo.guardrailTarget === 'classic' ? 'classic' : 'schedule'}
                      onChange={e => handleChange('guardrailTarget', e.target.value)} className={compactInputStyle}
                      aria-label="Target withdrawal rate">
                      <option value="schedule">Follow my plan’s path (recommended)</option>
                      <option value="classic">Classic: my first-year rate</option>
                    </select>
                    <span className="text-xs text-slate-500">
                      {localInfo.guardrailTarget === 'classic'
                        ? 'One target for life, as in the original paper'
                        : 'Social Security or a pension starting is not mistaken for a windfall'}
                    </span>
                  </div>
                  <div>
                    <label className={compactLabelStyle}>No cuts in the plan’s last (years)</label>
                    <input type="number" min="0" max="40" step="1" value={localInfo.guardrailSunsetYears ?? 15}
                      onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) handleChange('guardrailSunsetYears', Math.min(40, Math.max(0, v))); }}
                      className={compactInputStyle} aria-label="No cuts in the plan's last years" />
                    <span className="text-xs text-slate-500">Research: 15 years</span>
                  </div>
                  <div>
                    <label className={compactLabelStyle}>Largest inflation raise (%/yr, 0 = none)</label>
                    <input type="number" min="0" max="50" step="0.5" value={pct('guardrailInflationCapPct', 0.06)}
                      onChange={setPct('guardrailInflationCapPct', 0, 50)} className={compactInputStyle}
                      aria-label="Largest inflation raise, percent" />
                    <span className="text-xs text-slate-500">Research: 6%</span>
                  </div>
                  <div>
                    <label className={compactLabelStyle}>Never spend below (% of plan, 0 = no floor)</label>
                    <input type="number" min="0" max="100" step="1" value={pct('guardrailFloorPct', 0)}
                      onChange={setPct('guardrailFloorPct', 0, 100)} className={compactInputStyle}
                      aria-label="Spending floor, percent of plan" />
                    <span className="text-xs text-slate-500">Not in the research; a safety net for essentials</span>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input type="checkbox" checked={localInfo.guardrailInflationRule !== false}
                    onChange={e => handleChange('guardrailInflationRule', e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/50" />
                  <span className="text-sm text-slate-300">Skip the inflation raise after a losing year, while over target</span>
                </label>
                <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-lg space-y-2 text-xs text-slate-400">
                  <p>
                    <strong className="text-slate-300">The rules</strong> (Guyton &amp; Klinger, <em>Journal of Financial
                    Planning</em>, 2006). Each year the withdrawal rises with inflation — except after a year the
                    portfolio lost money while the withdrawal rate is above target, when the raise is skipped and never made
                    up. If the rate climbs more than {pct('guardrailBandPct', 0.20)}% above target the withdrawal is cut
                    {' '}{pct('guardrailAdjustPct', 0.10)}% (not in the plan’s last {localInfo.guardrailSunsetYears ?? 15} years);
                    more than {pct('guardrailBandPct', 0.20)}% below, it is raised {pct('guardrailAdjustPct', 0.10)}%.
                  </p>
                  <p>
                    <strong className="text-slate-300">How this planner applies them.</strong> Cuts and raises are a share of
                    what you draw from the portfolio, not of your whole budget — with Social Security paying half, a 10% cut
                    to total spending would be a 20% cut to the withdrawal, twice what the research tested.
                    {localInfo.guardrailTarget === 'classic'
                      ? ' The target is your first retirement year’s rate. If Social Security or a pension starts later, that drop in withdrawals will read as a good market and trigger raises.'
                      : ' The target follows your plan’s own expected rate each year, so a bridge before Social Security, or a pension starting, never trips a guardrail on its own. At your plan’s expected returns nothing trips — the Dashboard shows your plan as set — and the guardrails act in the simulations on Will it last? and in the plan-health check, where markets differ.'}
                    {' '}The research’s fourth rule, which asset class to sell, is left to your withdrawal order.
                  </p>
                </div>

                  </>
                )}

                {withdrawalLed && (
                  <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-lg text-xs text-slate-400 space-y-2">
                    <p>
                      <strong className="text-slate-300">What this changes.</strong> The strategy sets how much you
                      withdraw, and your spending is what that withdrawal and your other income buy after tax — so your
                      <strong className="text-amber-400"> spending target above is not used in retirement</strong>.
                      Healthcare and recurring expenses come out of that budget; dated one-time expenses are paid on top of it.
                    </p>
                    <p>
                      {strategy === 'constant'
                        ? 'The 4% rule never cuts spending, so it can run out: after an early fall in markets the same dollars are a bigger share of a smaller portfolio. Will it last? shows how often.'
                        : strategy === 'vanguard'
                          ? 'The floor limits how fast spending can fall, so in a long slump it keeps withdrawing above its target percentage and can run the portfolio down. Will it last? shows how often, and how far spending falls first.'
                          : 'A percentage of whatever is left never runs out, so the risk shows up differently: as a year your budget shrinks. Will it last? shows how far spending falls in bad markets.'}
                    </p>
                  </div>
                )}
              </>
            );
          })()}
        </div>
        </HideableBlock>

        {/* Survivor Modeling Section */}
        {localInfo.filingStatus === 'married_joint' && (
          <HideableBlock tab="personal" id="survivor" level={detailLevel}
                         vis={sectionVisibility} setVis={setSectionVisibility}>
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
                    Filing status stays Married Joint for the year of the death, then becomes Single, which narrows tax brackets significantly.
                    Pensions marked with "survivor benefit" continue at 50% (configurable in Income tab).
                    Spending drops to the <strong className="text-amber-400">survivor spending %</strong> of the couple's target.
                  </p>
                  {(() => {
                    const planned = PlannerEngine.plannedLifespans(localInfo);
                    const survivorIsMe = PlannerEngine.survivorOf(localInfo) === 'me';
                    const theirLE = survivorIsMe ? localInfo.myLifeExpectancy : localInfo.spouseLifeExpectancy;
                    const extended = planned !== localInfo;
                    return (
                      <p className="text-xs text-slate-400 mt-2" data-survivor-rule>
                        <strong className="text-slate-300">How long the plan runs:</strong> the life expectancies decide who is
                        likely to die first, and when. {survivorIsMe ? 'You are expected to outlive your spouse' : 'Your spouse is expected to outlive you'},
                        {extended
                          ? <> so instead of stopping at {theirLE}, the plan follows {survivorIsMe ? 'you' : 'them'} to
                              your planning age of <strong className="text-slate-300">{localInfo.legacyAge || 95}</strong>. A life expectancy is an
                              average: about half of people outlive theirs, and the money has to last for the one who does.</>
                          : <> to {theirLE}, which is at or past your planning age, so the plan runs that long.</>}
                      </p>
                    );
                  })()}
                </div>
              </>
            )}
          </div>
          </HideableBlock>
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

          {/* Qualified medical expenses — the line that makes an HSA tax-free.
              Only worth asking about when there is an HSA to withdraw from. */}
          {accounts.some(a => a.type === 'hsa') && (
            <div className="mb-3">
              <label className={compactLabelStyle}>Annual Qualified Medical Expenses (today's $)</label>
              <input
                type="number" min="0" step="500"
                value={localInfo.hsaQualifiedExpenses || 0}
                onChange={e => handleChange('hsaQualifiedExpenses', Number(e.target.value))}
                className={compactInputStyle}
              />
              <p className="text-xs text-slate-500 mt-1">
                HSA withdrawals are tax-free only up to your qualified medical costs; beyond that they are ordinary income,
                plus 20% before age 65. Any healthcare modelled above already counts — this is for spending it misses, such as
                dental, vision, hearing, and long-term care premiums. Indexed at the medical inflation rate.
              </p>
            </div>
          )}

          {healthcareCostsModeled(localInfo) && (
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
                <option value="stress">Stress: 5 years of nursing home for the survivor</option>
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
              {localInfo.ltcModel === 'stress'
                ? `Stress case: ${LTC_STRESS_MONTHS / 12} years of nursing-home care at $${LTC_MONTHLY_NURSING_HOME_2025.toLocaleString()}/mo (Genworth 2024 private-room median) for whichever of you is planned to live longer, and none for the other — the case with no spouse left to give informal care and the estate at its lowest. Roughly 1 in 7 people who need care need it this long.`
                : `Default models $${LTC_MONTHLY_ASSISTED_LIVING_2025.toLocaleString()}/mo assisted living for ${LTC_DEFAULT_DURATION_MONTHS} months before death (Genworth 2024 median) — about the average across everyone, including the 30% who never need paid care. Cost compounds at the medical inflation rate and appears as a spike in the final years before each spouse's life expectancy.`}
              {' '}Long-term care is billed whichever healthcare model is chosen above. Will it last? (thousands of markets) can draw a different episode for every run instead.
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
                  {strategyLeadsSpending(personalInfo)
                    ? 'These are paid on top of what your withdrawal strategy draws.'
                    : `These add to your base retirement spending (${formatCurrency(personalInfo.desiredRetirementIncome)}/yr).`} Dated before retirement? Paid by pausing saving, then drawing.
                </span>
              </div>
            </div>
          )}
          
          {recurringExpenses.length === 0 && (
            <p className="text-xs text-slate-500 italic">
              No recurring expenses defined. {strategyLeadsSpending(personalInfo)
                ? 'Your retirement spending is set by your withdrawal strategy.'
                : `Your retirement spending is based solely on the Desired Retirement Income (${formatCurrency(personalInfo.desiredRetirementIncome)}/yr) above.`}{' '}
              Add expenses here for things like car payments (ages 55-60), college tuition (ages 54-58), or travel budgets (ages 65-80). Expenses dated BEFORE you retire are paid by pausing that year's saving first, then by drawing from the portfolio (with tax, and the 10% penalty if you're under 59½) — so an expense in your working years now reduces the plan, as it should.
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

// Split a contribution into the employee's own money vs. the employer's.
// A percent-mode account folds a deferral and a match into one row; split it by the
// two percentages — the match was never the saver's income. Fixed-mode rows fall
// back to the contributor field, which is now only ever 'me' or 'employer'.
// The employee's own share of an account's contribution. The savings rate divides
// this by the HOUSEHOLD's earned income, so the numerator has to be household-wide
// too: percent mode used to return 0 for a spouse-owned account while fixed mode
// counted any row whose contributor was the employee, which understated every
// dual-income plan by the whole of the spouse's deferral.
function myContribShare(account, amount) {
  if (!amount) return 0;
  if (account.contributionMode === 'percent') {
    const ee = account.employeePercent || 0, er = account.employerMatchPercent || 0;
    return ee + er > 0 ? amount * (ee / (ee + er)) : 0;
  }
  return (account.contributor || 'me') === 'employer' ? 0 : amount;
}
function employerContribShare(account, amount) {
  if (!amount) return 0;
  if (account.contributionMode === 'percent') {
    const ee = account.employeePercent || 0, er = account.employerMatchPercent || 0;
    return ee + er > 0 ? amount * (er / (ee + er)) : 0;
  }
  return (account.contributor || 'me') === 'employer' ? amount : 0;
}
// SavingsRateExplorer, its tooltip and its colour helpers lived here and were
// removed in v2.15.0. The Sandbox's own "Savings rate while working" slider asks
// the same question against the same engine, alongside every other lever — two
// savings sliders on one page compete rather than add. The engine side
// (savingsTargetPlan, SAVINGS_FILL_ORDER) is untouched and still tested: it is
// the rule for which bucket the next saved dollar fills, and sandboxScenario
// calls it, so the Sandbox slider fills accounts in priority order and stops at
// the IRS limits exactly as the removed panel did. The .jsx no longer imports
// those three — the engine reaches them itself.

function AccountsTab({ detailLevel, sectionVisibility, setSectionVisibility, accountTypes, accounts, assets, computeProjections, contributorTypes, incomeStreams, oneTimeEvents, personalInfo, projections, recurringExpenses, setAccounts, setEditingAccount, setShowAccountModal }) {
  // Data-driven, like the charts: the HSA column appears when the plan has HSA
  // money, so a plan without one sees exactly the table it always did.
  const planHasHSA = (projections || []).some(p => (p.hsaBalance || 0) > 0);
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
  
  // IRS limits, checked across EVERY account at once. Per-account or per-wizard-slot
  // checks miss the common case: a deferral split over a traditional 401(k), a Roth
  // 401(k) and a percent-mode plan, each reasonable alone but together over 402(g).
  // Runs on the LIVE edited list so it appears as you type, not only after saving.
  const salariesForLimits = { me: 0, spouse: 0 };
  (incomeStreams || []).forEach(st => {
    if (st.type === 'earned_income') {
      if (st.owner === 'joint') { salariesForLimits.me += (st.amount || 0) / 2; salariesForLimits.spouse += (st.amount || 0) / 2; }
      else salariesForLimits[st.owner === 'spouse' ? 'spouse' : 'me'] += (st.amount || 0);
    }
  });
  const limitBreaches = checkContributionLimits(localAccounts, personalInfo, salariesForLimits);

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
      <BasisLabel pi={personalInfo} />
      {limitBreaches.length > 0 && (
        <div className="p-4 bg-red-500/5 border border-red-500/40 rounded-xl space-y-2">
          <div className="text-sm font-semibold text-red-300">
            {limitBreaches.length === 1 ? 'A contribution is over the IRS limit' : 'Some contributions are over IRS limits'}
          </div>
          {limitBreaches.map((b, i) => (
            <p key={i} className="text-xs text-slate-300 leading-relaxed">{b.message}</p>
          ))}
          <p className="text-xs text-slate-500 leading-relaxed">
            The projection uses these numbers exactly as entered — it does not silently cap them —
            so until this is corrected the plan assumes contributions the IRS would not allow, and
            every balance downstream is optimistic. Percent-of-salary rows are sized from current salary.
          </p>
        </div>
      )}
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-semibold text-slate-100">Investment Accounts</h3>
        <div className="flex items-center gap-2">
          {dirty && <button onClick={saveChanges} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold transition-colors">💾 Save Changes</button>}
          <button onClick={() => { setEditingAccount(null); setShowAccountModal(true); }} className={buttonPrimary}>+ Add Account</button>
        </div>
      </div>
      {dirty && (
        <div className="p-2.5 bg-amber-500/10 border border-amber-500/40 rounded-lg text-sm text-amber-300">
          ⚠️ You have unsaved edits (including any deletions) — click <strong>💾 Save Changes</strong> to apply them. Leaving this tab without saving discards them.
        </div>
      )}
      
      <SectionControls tab="accounts" vis={sectionVisibility} setVis={setSectionVisibility}
                       level={detailLevel} />
      {/* Quick Edit Table */}
      <HideableBlock tab="accounts" id="quickEdit" level={detailLevel}
                     vis={sectionVisibility} setVis={setSectionVisibility}>
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
            <table className="w-full min-w-max">
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
                        <button tabIndex={-1} onClick={() => { setLocalAccounts(prev => prev.filter(a => a.id !== account.id)); setDirty(true); }} className="text-slate-400 hover:text-red-400 text-sm px-1 py-1" title="Delete (applies on Save)">🗑️</button>
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
      </HideableBlock>
      
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
              <div className="text-xl font-bold" style={{ color: SERIES.earnedIncome }}>{formatCurrency(currentEarnedIncome)}</div>
            </div>
            {savingsRate !== null && (
              <>
                <div className="w-px h-10 bg-slate-700"></div>
                <div>
                  <div className="text-slate-500 text-xs mb-0.5">Savings Rate (Gross)</div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-slate-100">{savingsRate.toFixed(1)}%</span>
                    <div className="w-24 h-2.5 bg-slate-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(savingsRate, 100)}%`, background: THEME.status[savingsRateStatus(savingsRate)] }}
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
                    <span className="text-xl font-bold text-slate-100">{afterTaxSavingsRate.toFixed(1)}%</span>
                    <div className="w-24 h-2.5 bg-slate-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(afterTaxSavingsRate, 100)}%`, background: THEME.status[savingsRateStatus(afterTaxSavingsRate)] }}
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
      
      {/* The savings-rate explorer moved to the Sandbox in v2.13.0, where it sits
          beside the retirement-age, claiming-age and spending levers instead of
          being the only what-if on a data-entry tab. Same component, same
          registry entry: turn on "What if you saved more?" from the picker. */}

      {/* Year-by-Year Account Balances Table */}
      <HideableBlock tab="accounts" id="balancesTable" level={detailLevel}
                     vis={sectionVisibility} setVis={setSectionVisibility}>
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
                      { color: THEME.inkPrimary, label: 'Total', desc: `Sum of all three account types — your total liquid investment portfolio. This is the number that needs to stay above zero through age ${personalInfo.legacyAge || 95}.` }
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
            // One validated categorical cycle instead of a per-table hand-picked list.
            const acctColors = THEME.categorical;
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
                          <tr key={p.year} className={`border-b border-slate-700/50 ${hasRMD ? 'bg-orange-900/10' : idx % 2 === 0 ? 'bg-slate-800/30' : ''}`}>
                            <td className="py-1.5 px-2 text-slate-300">{p.year}</td>
                            <td className="py-1.5 px-2 text-center text-slate-400">{p.myAge}</td>
                            {accounts.map((acct, i) => {
                              const bal = (p.perAccountBalances || {})[acct.id] || 0;
                              return (
                                <td key={acct.id} className="py-1.5 px-2 text-right font-mono" style={{ color: bal > 0 ? colorFor(i) : THEME.inkMuted }}>
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
                      <th className="text-right py-2 px-2 font-medium" style={{ color: SERIES.preTax }}>Pre-Tax</th>
                      <th className="text-right py-2 px-2 font-medium" style={{ color: SERIES.roth }}>Roth</th>
                      <th className="text-right py-2 px-2 font-medium" style={{ color: SERIES.brokerage }}>Brokerage</th>
                      {/* HSA is its own bucket now. Without this column the three
                          before it stop adding up to Total for any plan with one. */}
                      {planHasHSA && <th className="text-right py-2 px-2 font-medium" style={{ color: SERIES.hsa }}>HSA</th>}
                      <th className="text-right py-2 px-2 text-amber-400 font-medium">Total</th>
                      <th className="text-right py-2 px-2 font-medium" style={{ color: SERIES.rmd }}>RMD</th>
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
                          className={`border-b border-slate-700/50 ${hasRMD ? 'bg-orange-900/10' : idx % 2 === 0 ? 'bg-slate-800/30' : ''}`}
                        >
                          <td className="py-1.5 px-2 text-slate-300">{p.year}</td>
                          <td className="py-1.5 px-2 text-center text-slate-400">{p.myAge}</td>
                          <td className="py-1.5 px-2 text-right font-mono" style={{ color: SERIES.preTax }}>{formatCurrency(p.preTaxBalance)}</td>
                          <td className="py-1.5 px-2 text-right font-mono" style={{ color: SERIES.roth }}>{formatCurrency(p.rothBalance)}</td>
                          <td className="py-1.5 px-2 text-right font-mono" style={{ color: SERIES.brokerage }}>{formatCurrency(p.brokerageBalance)}</td>
                          {planHasHSA && <td className="py-1.5 px-2 text-right font-mono" style={{ color: SERIES.hsa }}>{formatCurrency(p.hsaBalance)}</td>}
                          <td className="py-1.5 px-2 text-right text-amber-400 font-mono font-semibold">{formatCurrency(p.totalPortfolio)}</td>
                          <td className="py-1.5 px-2 text-right font-mono"
                              style={{ color: hasRMD ? SERIES.rmd : THEME.inkMuted }}>
                            {hasRMD ? formatCurrency(p.rmd) : '—'}
                          </td>
                          <td className={`py-1.5 px-2 text-right font-mono ${p.portfolioWithdrawal > 0 ? 'text-orange-400' : 'text-slate-500'}`}>
                            {p.portfolioWithdrawal > 0 ? formatCurrency(p.portfolioWithdrawal) : '—'}
                          </td>
                          <td className={`py-1.5 px-2 text-right font-mono ${hasExcess ? 'text-cyan-400' : 'text-slate-500'}`}>
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
                  <div className="w-3 h-3 rounded" style={{ background: SERIES.preTax }}></div>
                  <span className="text-slate-400">Pre-Tax (401k, Trad IRA, 457b)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded" style={{ background: SERIES.roth }}></div>
                  <span className="text-slate-400">Roth Accounts</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded" style={{ background: SERIES.brokerage }}></div>
                  <span className="text-slate-400">Brokerage</span>
                </div>
                {planHasHSA && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded" style={{ background: SERIES.hsa }}></div>
                    <span className="text-slate-400">HSA</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded" style={{ background: SERIES.rmd }}></div>
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
      </HideableBlock>
      
      {/* Year-by-Year Contributions Table */}
      <HideableBlock tab="accounts" id="contributionsTable" level={detailLevel}
                     vis={sectionVisibility} setVis={setSectionVisibility}>
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
                      { color: THEME.inkPrimary, label: 'Total', desc: 'Sum of all contributions for the year across all account types.' }
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
            // One validated categorical cycle instead of a per-table hand-picked list.
            const acctColors = THEME.categorical;
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
                              <td key={acct.id} className="py-1.5 px-2 text-right font-mono" style={{ color: c > 0 ? colorFor(i) : THEME.inkMuted }}>
                                {c > 0 ? formatCurrency(c) : '—'}
                              </td>
                            );
                          })}
                          <td className="py-1.5 px-2 text-right text-amber-400 font-mono font-semibold">
                            {total > 0 ? formatCurrency(total) : '—'}
                          </td>
                          <td className={`py-1.5 px-2 text-right font-mono ${grossRate !== null && grossRate > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                            {grossRate !== null && grossRate > 0 ? `${grossRate.toFixed(1)}%` : '—'}
                          </td>
                          <td className={`py-1.5 px-2 text-right font-mono ${netRate !== null && netRate > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
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
                          <th className="text-right py-2 px-2 font-medium" style={{ color: SERIES.preTax }}>Pre-Tax</th>
                          <th className="text-right py-2 px-2 font-medium" style={{ color: SERIES.roth }}>Roth</th>
                          <th className="text-right py-2 px-2 font-medium" style={{ color: SERIES.brokerage }}>Brokerage/HSA</th>
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
                              <td className="py-1.5 px-2 text-right font-mono"
                                  style={{ color: preTaxC > 0 ? SERIES.preTax : THEME.inkMuted }}>
                                {preTaxC > 0 ? formatCurrency(preTaxC) : '—'}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono"
                                  style={{ color: rothC > 0 ? SERIES.roth : THEME.inkMuted }}>
                                {rothC > 0 ? formatCurrency(rothC) : '—'}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono"
                                  style={{ color: brokerageC > 0 ? SERIES.brokerage : THEME.inkMuted }}>
                                {brokerageC > 0 ? formatCurrency(brokerageC) : '—'}
                              </td>
                              <td className="py-1.5 px-2 text-right text-amber-400 font-mono font-semibold">
                                {total > 0 ? formatCurrency(total) : '—'}
                              </td>
                              <td className={`py-1.5 px-2 text-right font-mono ${grossRate !== null && grossRate > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                                {grossRate !== null && grossRate > 0 ? `${grossRate.toFixed(1)}%` : '—'}
                              </td>
                              <td className={`py-1.5 px-2 text-right font-mono ${netRate !== null && netRate > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
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
      </HideableBlock>
    </div>
  );
}

