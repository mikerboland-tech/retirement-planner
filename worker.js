// ============================================================================
// PlannerWorker — heavy projection runner for the desktop app.
//
// Loads the shared calc engine via importScripts and exposes these job types
// to the main thread via postMessage:
//   - monteCarlo:        MonteCarloTab's full simulation loop (1k-5k sims)
//   - ssGrid:            SocialSecurityTab's 6x6 deterministic claiming grid
//   - ssMonteCarlo:      ssGrid + per-cell MC volatility shocks (3,600 calls worst case)
//   - rothOptimizer:     bracket x window strategy sweep, scored by the engine
//   - marginalRateCurve: per-year probe conversions for the lifetime rate chart
//
// Message protocol:
//   main -> worker:  { jobId, type, payload }
//   worker -> main:  { jobId, type: 'progress', percent }
//                    { jobId, type: 'result',   data }
//                    { jobId, type: 'error',    error, stack? }
//
// Cancellation: handled on the main side by terminate() + respawn — the worker
// itself runs each job to completion. See window.PlannerWorker.cancel() in
// index.html for the cancel path.
// ============================================================================
// Pull APP_VERSION off our own Worker URL (the main thread constructs us as
// `new Worker('worker.js?v=' + APP_VERSION)`) so the engine import is cache-busted
// to the same version as everything else, without a second source of truth.
const _appVersion = new URLSearchParams(self.location.search).get('v') || '';
importScripts('engine.js' + (_appVersion ? '?v=' + _appVersion : ''));

const E = self.PlannerEngine;
const {
  computeProjections,
  getHistoricalSequence,
  getValidStartYears,
  HISTORICAL_RETURNS,
  calculateSSBenefit,
  rowAtOrLast,
  reindexSSForInflation,
  conversionCostComponents,
  topMarginalBracket,
  BASE_TAX_YEAR,
} = E;

self.onmessage = (e) => {
  const { jobId, type, payload } = e.data;
  try {
    switch (type) {
      case 'monteCarlo':         runMonteCarlo(jobId, payload); break;
      case 'ssGrid':             runSocialSecurityGrid(jobId, payload, false); break;
      case 'ssMonteCarlo':       runSocialSecurityGrid(jobId, payload, true);  break;
      case 'rothOptimizer':      runRothOptimizer(jobId, payload); break;
      case 'marginalRateCurve':  runMarginalRateCurve(jobId, payload); break;
      default:
        postMessage({ jobId, type: 'error', error: 'Unknown job type: ' + type });
    }
  } catch (err) {
    postMessage({ jobId, type: 'error', error: err.message, stack: err.stack });
  }
};

// Box-Muller transform for normal distribution. The zero guards matter:
// Math.random() can return exactly 0, and Math.log(0) is -Infinity, which makes
// z -Infinity and turns every balance in the simulation into NaN. A NaN
// portfolio then compares false against every survival test, silently counting
// as a failure. Same guard as randomNormalSS below.
function randomNormalMC(mean, stdDev) {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z;
}

// Standard-normal sample for SS-tab MC shocks (matches SocialSecurityTab usage)
function randomNormalSS() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ============================================================================
// runMonteCarlo — delegates each sim to computeProjections via the new
// opts.yearOverrides hook. One source of truth for retirement math: survivor
// modeling, NIIT/IRMAA, half-year convention, Roth bracket tracking, and the
// full withdrawal solver all come for free from the engine.
//
// Walk-up years (myAge → simSettings.startAge - 1) leave their override slot
// null so the engine uses each account's deterministic cagr + pi.inflationRate.
// Sim years receive { marketReturn, inflation } drawn from Gaussian or replayed
// from a historical sequence.
// ============================================================================
function runMonteCarlo(jobId, payload) {
  const {
    simSettings, personalInfo, accounts, incomeStreams,
    assets, oneTimeEvents, recurringExpenses,
  } = payload;

  const piWithLifeExp = { ...personalInfo, legacyAge: personalInfo.legacyAge || 95 };

  // ── LONGEVITY SAMPLING ──────────────────────────────────────────────────────
  // Without this every simulation dies on the same birthday, so a thousand runs
  // explore a thousand market paths against exactly one lifespan. That flatters
  // plans in both directions at once: it hides the household that lives to 98,
  // and it counts a "failure" at 94 against a household that was never going to
  // see 94. Running out of money after you are dead is not a failure.
  //
  // Deaths only take effect when survivor modelling is on -- that is the switch
  // the engine reads -- so enabling longevity implies it.
  const longevity = !!(simSettings.longevity && simSettings.longevity.enabled);
  const isMarried = piWithLifeExp.filingStatus === 'married_joint';
  // Slide the sampled distribution so the plan's own life-expectancy input keeps
  // setting the central tendency; only the SHAPE comes from population data.
  const myShift = longevity
    ? (piWithLifeExp.myLifeExpectancy || 85) - (piWithLifeExp.myAge + E.lifeExpectancyAt(piWithLifeExp.myAge))
    : 0;
  const spouseShift = longevity && isMarried
    ? (piWithLifeExp.spouseLifeExpectancy || 87) - (piWithLifeExp.spouseAge + E.lifeExpectancyAt(piWithLifeExp.spouseAge))
    : 0;
  // Must match the engine's horizon exactly. It covers a younger spouse, so a
  // myAge-only count would leave the tail years without overrides — and the
  // engine would quietly run those on deterministic returns, understating risk
  // in precisely the late years the simulation exists to stress.
  // With longevity on, each sim has its own horizon, so overrides and the fan
  // chart must be sized for the LONGEST life anyone can draw rather than for
  // legacyAge. MORTALITY_MAX_PLAN_AGE is the terminal age of the mortality
  // table; a sim cannot outlive it, and the engine stops the year both spouses
  // have died, so oversizing costs nothing but empty tail slots.
  const MORTALITY_MAX_PLAN_AGE = 116;
  const deterministicYears = E.getPlanningHorizonYears(piWithLifeExp) + 1;
  const yearsFromCurrent = longevity
    ? Math.max(deterministicYears,
               MORTALITY_MAX_PLAN_AGE + Math.ceil(Math.max(myShift, spouseShift, 0)) - piWithLifeExp.myAge)
    : deterministicYears;
  const walkUpYears = Math.max(0, simSettings.startAge - piWithLifeExp.myAge);
  const stochasticYears = yearsFromCurrent - walkUpYears;

  // Optional Guyton-Klinger-style dynamic spending (engine opts.spendingRule).
  const guardrails = (simSettings.guardrails && simSettings.guardrails.enabled)
    ? { bandPct: simSettings.guardrails.bandPct ?? 0.20, adjustPct: simSettings.guardrails.adjustPct ?? 0.10 }
    : null;
  const gCutYears = [], gMinMult = [], gEndMult = [];

  const isHistorical = simSettings.method === 'historical';
  let historicalStartYears = null;
  if (isHistorical) {
    if (simSettings.historicalStartYear === 'all') {
      historicalStartYears = getValidStartYears(stochasticYears);
      if (!historicalStartYears || historicalStartYears.length === 0) {
        historicalStartYears = HISTORICAL_RETURNS.map(r => r.year);
      }
    } else {
      historicalStartYears = [Number(simSettings.historicalStartYear)];
    }
  }

  // Historical replays are fully deterministic: replaying the same start year N
  // times produces N identical projections. So in historical mode we run each
  // start year exactly once instead of cycling numSimulations times over the
  // same ~70 sequences (which burned ~15x the compute for identical results).
  const totalSims = isHistorical ? historicalStartYears.length : simSettings.numSimulations;

  const BATCH = 50;
  const numPathsToStore = 100;
  const results = [];
  const portfolioPathsToStore = [];
  // Per-year portfolio samples across ALL sims, for the percentile fan chart.
  // (Previously the bands were computed from only the first `numPathsToStore`
  // stored paths while the headline stats used every sim.)
  // One entry per reported path year — derived from the same horizon so the fan
  // chart spans the whole projection rather than stopping at the primary's age.
  const yearsToReport = Math.max(1, yearsFromCurrent - walkUpYears);
  const bandData = Array.from({ length: yearsToReport }, () => []);
  // Same samples deflated to today's dollars (see the path build below).
  const bandDataReal = Array.from({ length: yearsToReport }, () => []);

  for (let sim = 0; sim < totalSims; sim++) {
    const histStartYear = isHistorical
      ? historicalStartYears[sim % historicalStartYears.length]
      : null;
    const histSeq = isHistorical
      ? getHistoricalSequence(histStartYear, stochasticYears, simSettings.assetMix)
      : null;

    // Build per-year overrides. Walk-up slots stay undefined → engine uses
    // each account's own cagr and pi.inflationRate for those years.
    const overrides = new Array(yearsFromCurrent);
    for (let y = walkUpYears; y < yearsFromCurrent; y++) {
      const idx = y - walkUpYears;
      if (isHistorical) {
        overrides[y] = { marketReturn: histSeq[idx].blendedReturn, inflation: histSeq[idx].cpi };
      } else {
        overrides[y] = {
          marketReturn: randomNormalMC(simSettings.meanReturn, simSettings.stdDev),
          inflation:    randomNormalMC(simSettings.inflationMean, simSettings.inflationStdDev),
        };
      }
    }

    // Draw this simulation's lifespans. Sampling independently per person is the
    // right default: joint mortality is correlated in reality (shared habits,
    // environment, the "widowhood effect"), but modelling that needs a copula
    // this app has no data to calibrate, and independence is the conventional
    // and conservative choice for a couple.
    let piForSim = piWithLifeExp;
    if (longevity) {
      const myDeath = E.sampleAgeAtDeath(piWithLifeExp.myAge, Math.random, myShift);
      piForSim = {
        ...piWithLifeExp,
        myLifeExpectancy: myDeath,
        survivorModelEnabled: true,   // deaths are inert without it
      };
      if (isMarried) {
        piForSim.spouseLifeExpectancy =
          E.sampleAgeAtDeath(piWithLifeExp.spouseAge, Math.random, spouseShift);
      }
    }

    const proj = computeProjections(
      piForSim, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses,
      undefined, { yearOverrides: overrides, spendingRule: guardrails || undefined }
    );

    // Build per-sim portfolio path from simSettings.startAge onward.
    // Each sim draws its OWN inflation sequence, so nominal balances from
    // different sims are denominated in different currencies — pooling them
    // produces percentile bands whose p10 and p90 are not comparable. Deflate by
    // this sim's own cumulative inflation to get today's dollars, which is the
    // figure a user can actually reason about.
    const path = [];
    let cumInflation = 1;
    for (let y = 0; y < proj.length; y++) {
      const p = proj[y];
      if (y > 0) {
        const prev = overrides[y - 1];
        cumInflation *= (1 + (prev ? prev.inflation : piWithLifeExp.inflationRate));
      }
      if (p.myAge >= simSettings.startAge) {
        path.push({ age: p.myAge, portfolio: p.totalPortfolio, real: p.totalPortfolio / cumInflation });
      }
    }

    // Guardrail spending-path stats for this sim (cuts, trough, ending level).
    if (guardrails) {
      let cuts = 0, minMult = 1, endMult = 1;
      for (const p of proj) {
        if (p.myAge < simSettings.startAge) continue;
        if (p.guardrailEvent === 'cut') cuts++;
        if (p.guardrailMultiplier !== undefined) {
          endMult = p.guardrailMultiplier;
          if (p.guardrailMultiplier < minMult) minMult = p.guardrailMultiplier;
        }
      }
      gCutYears.push(cuts); gMinMult.push(minMult); gEndMult.push(endMult);
    }

    let portfolioSurvived = true;
    let failureAge = null;
    for (const pt of path) {
      if (pt.portfolio <= 0) { portfolioSurvived = false; failureAge = pt.age; break; }
    }

    results.push({
      finalPortfolio: path.length > 0 ? path[path.length - 1].portfolio : 0,
      finalPortfolioReal: path.length > 0 ? path[path.length - 1].real : 0,
      survived: portfolioSurvived,
      failureAge,
      portfolioAt75: path.find(p => p.age === 75)?.portfolio || 0,
      portfolioAt85: path.find(p => p.age === 85)?.portfolio || 0,
      historicalStartYear: histStartYear,
      // The lifespan this sim actually drew, so the UI can report the spread and
      // the user can see WHY success moved rather than just that it did.
      lastAge: longevity ? (path.length ? path[path.length - 1].age : piForSim.myAge) : undefined,
      myDeathAge: longevity ? piForSim.myLifeExpectancy : undefined,
      spouseDeathAge: longevity && isMarried ? piForSim.spouseLifeExpectancy : undefined,
    });
    if (sim < numPathsToStore) portfolioPathsToStore.push(path);
    for (let y = 0; y < yearsToReport; y++) {
      // A sim whose household has died contributes NOTHING to later years —
      // pushing a zero would drag the percentile bands toward the floor and read
      // as "broke" when it means "no longer alive". The bands are therefore a
      // distribution over households still living at that age, which is the only
      // reading that stays honest once lifespans vary.
      if (!path[y]) { if (longevity) continue; }
      bandData[y].push(path[y]?.portfolio || 0);
      bandDataReal[y].push(path[y]?.real || 0);
    }

    if ((sim + 1) % BATCH === 0 || sim + 1 === totalSims) {
      postMessage({
        jobId, type: 'progress',
        percent: Math.round(((sim + 1) / totalSims) * 100),
      });
    }
  }

  // Starting portfolio: sum of initial account balances. Cheap and matches the
  // pre-R1 reported value (the old code summed initialBalances after walk-up;
  // we report raw initial balances here since the walk-up is now opaque inside
  // the engine. Users see the same number on screen — their current balance.)
  const startingPortfolio = accounts.reduce((s, a) => s + (a.balance || 0), 0);

  const successCount = results.filter(r => r.survived).length;
  const successRate = successCount / totalSims;
  const finalPortfolios = results.map(r => r.finalPortfolio).sort((a, b) => a - b);
  const finalPortfoliosReal = results.map(r => r.finalPortfolioReal).sort((a, b) => a - b);
  const percentile = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  const failureAges = results.filter(r => !r.survived).map(r => r.failureAge);
  const avgFailureAge = failureAges.length > 0
    ? failureAges.reduce((a, b) => a + b, 0) / failureAges.length
    : null;

  // Spread of lifespans actually drawn. Reported so the user can see the range
  // the success rate is now averaging over -- a number that moved because the
  // household sometimes lives to 100 is a different claim from one that moved
  // because the markets were unkind, and the two should not look alike.
  let longevityStats = null;
  if (longevity) {
    const lastAges = results.map(r => r.lastAge).filter(a => typeof a === 'number').sort((a, b) => a - b);
    if (lastAges.length) {
      const q = (p) => lastAges[Math.min(lastAges.length - 1, Math.floor(lastAges.length * p))];
      longevityStats = {
        p10: q(0.10), p25: q(0.25), p50: q(0.50), p75: q(0.75), p90: q(0.90), p99: q(0.99),
        mean: lastAges.reduce((a, b) => a + b, 0) / lastAges.length,
        min: lastAges[0], max: lastAges[lastAges.length - 1],
        // How often the household outlived the plan's own fixed assumption --
        // the years the deterministic projection never models at all.
        beyondPlanned: lastAges.filter(a => a > (deterministicYears - 1 + piWithLifeExp.myAge)).length / lastAges.length,
      };
    }
  }

  // Percentile fan chart from ALL sims (bandData), not just the stored sample paths.
  const percentileBands = [];
  const percentileBandsReal = [];
  for (let year = 0; year < yearsToReport; year++) {
    const age = simSettings.startAge + year;
    const portfoliosAtYear = bandData[year].sort((a, b) => a - b);
    const realAtYear = bandDataReal[year].sort((a, b) => a - b);
    percentileBands.push({
      age,
      p10: percentile(portfoliosAtYear, 0.10),
      p25: percentile(portfoliosAtYear, 0.25),
      p50: percentile(portfoliosAtYear, 0.50),
      p75: percentile(portfoliosAtYear, 0.75),
      p90: percentile(portfoliosAtYear, 0.90),
    });
    percentileBandsReal.push({
      age,
      p10: percentile(realAtYear, 0.10),
      p25: percentile(realAtYear, 0.25),
      p50: percentile(realAtYear, 0.50),
      p75: percentile(realAtYear, 0.75),
      p90: percentile(realAtYear, 0.90),
    });
  }

  // Aggregate guardrail stats across sims.
  let guardrailStats = null;
  if (guardrails && gCutYears.length > 0) {
    const sorted = (a) => [...a].sort((x, y) => x - y);
    const median = (a) => { const s = sorted(a); return s[Math.floor(s.length / 2)]; };
    guardrailStats = {
      simsWithCutPct: gCutYears.filter(c => c > 0).length / gCutYears.length,
      avgCutYears: gCutYears.reduce((s, c) => s + c, 0) / gCutYears.length,
      medianEndMultiplier: median(gEndMult),
      p10MinMultiplier: sorted(gMinMult)[Math.floor(gMinMult.length * 0.10)],
    };
  }

  let historicalSummary = null;
  if (isHistorical && simSettings.historicalStartYear === 'all') {
    const byYear = new Map();
    results.forEach(r => {
      if (r.historicalStartYear == null) return;
      if (!byYear.has(r.historicalStartYear)) byYear.set(r.historicalStartYear, []);
      byYear.get(r.historicalStartYear).push(r);
    });
    historicalSummary = [];
    byYear.forEach((runs, year) => {
      const survived = runs.filter(r => r.survived).length;
      const avgFinal = runs.reduce((s, r) => s + r.finalPortfolio, 0) / runs.length;
      const failures = runs.filter(r => !r.survived).map(r => r.failureAge);
      const minFailureAge = failures.length > 0 ? Math.min(...failures) : null;
      historicalSummary.push({
        startYear: year, runs: runs.length, survived,
        successRate: survived / runs.length, avgFinalPortfolio: avgFinal,
        earliestFailureAge: minFailureAge,
      });
    });
    historicalSummary.sort((a, b) => {
      if (a.successRate !== b.successRate) return a.successRate - b.successRate;
      return a.avgFinalPortfolio - b.avgFinalPortfolio;
    });
  }

  postMessage({
    jobId,
    type: 'result',
    data: {
      successRate,
      successCount,
      totalSimulations: totalSims,
      startAge: simSettings.startAge,
      startingPortfolio,
      longevityEnabled: longevity,
      longevityStats,
      percentile5: percentile(finalPortfolios, 0.05),
      percentile25: percentile(finalPortfolios, 0.25),
      percentile50: percentile(finalPortfolios, 0.50),
      percentile75: percentile(finalPortfolios, 0.75),
      percentile95: percentile(finalPortfolios, 0.95),
      // Same statistics in today's dollars — each sim deflated by its OWN
      // inflation path before pooling, so these are directly comparable across
      // sims in a way the nominal figures above are not.
      real: {
        percentile5:  percentile(finalPortfoliosReal, 0.05),
        percentile25: percentile(finalPortfoliosReal, 0.25),
        percentile50: percentile(finalPortfoliosReal, 0.50),
        percentile75: percentile(finalPortfoliosReal, 0.75),
        percentile95: percentile(finalPortfoliosReal, 0.95),
      },
      percentileBandsReal,
      avgFailureAge,
      percentileBands,
      portfolioPaths: portfolioPathsToStore.slice(0, 50),
      method: simSettings.method,
      historicalSummary,
      historicalStartYearSetting: simSettings.historicalStartYear,
      guardrailsEnabled: !!guardrails,
      guardrailStats,
    },
  });
}

// ============================================================================
// runSocialSecurityGrid — handles both 'ssGrid' (deterministic only) and
// 'ssMonteCarlo' (deterministic + N MC shocks per cell).
//
// Returned shape per cell — must stay in sync with what SocialSecurityTab JSX
// consumes (the `allScenarios` array). The per-cell `projections` is SLIMMED
// to the 6 year-level fields the UI actually reads, not full computeProjections
// output. This keeps the postMessage payload small (~80 KB for a 6x6 grid).
//
// Cell shape:
//   { myClaimAge, spClaimAge, label, myAnnualSS, spAnnualSS,
//     portfolioAt75, portfolioAt80, portfolioAt85, portfolioAtLegacy,
//     afterTaxAtLegacy, depletionAge, measuredAtAge,
//     lifetimeTax, lifetimeWithdrawals, lifetimeSS, lifetimeRothConversions,
//     netLifetimeWealth,
//     projections: [{ myAge, totalPortfolio, totalTax, portfolioWithdrawal,
//                     socialSecurity, rothConversion }, ...],
//     mcResults: null | { runs, survived, successRate, p10, p50, p90, avgFailureAge,
//                         longevity?: { p10, p50, p90, min, max } } }
// ============================================================================
function runSocialSecurityGrid(jobId, payload, withMC) {
  const {
    personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses,
    legacyAge, cagrDelta, myPIA, spousePIA, myBirthYear, spouseBirthYear,
    isMarried,
    myLifeExpectancy, spouseLifeExpectancy,
    mcRunsPerScenario, mcVolatility,
    mcLongevity, mcInflationVol,
  } = payload;

  // The tab's life-expectancy inputs must drive MORTALITY, not just the horizon.
  // Setting legacyAge alone left the engine killing people off at
  // personalInfo.myLifeExpectancy (default 85) while the tab measured terminal
  // wealth at its own default of 90 — a row the projection had already stopped
  // producing. "How does longevity change the optimal claim age" is the question
  // this tab exists to answer, so the slider has to move the death age too.
  const piWithLifeExp = {
    ...personalInfo,
    legacyAge,
    myLifeExpectancy: myLifeExpectancy ?? personalInfo.myLifeExpectancy,
    spouseLifeExpectancy: spouseLifeExpectancy ?? personalInfo.spouseLifeExpectancy,
  };
  // Clamp at -1 (a total-loss floor), NOT at 0: flooring at 0% silently converted
  // downside scenarios into flat-return scenarios, biasing results optimistic.
  const adjustedAccounts = cagrDelta === 0
    ? accounts
    : accounts.map(a => ({ ...a, cagr: Math.max(-1, (a.cagr || 0) + cagrDelta) }));

  const myAges = [62, 64, 66, 67, 68, 70];
  const spouseAges = isMarried ? [62, 64, 66, 67, 68, 70] : [null];

  const buildStreams = (myClaimAge, spClaimAge) => incomeStreams.map(s => {
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

  const slimProj = (proj) => proj.map(p => ({
    myAge: p.myAge,
    totalPortfolio: p.totalPortfolio,
    totalTax: p.totalTax,
    portfolioWithdrawal: p.portfolioWithdrawal,
    socialSecurity: p.socialSecurity,
    rothConversion: p.rothConversion || 0,
  }));

  // Balance-weighted expected return, used as the mean of the per-year draws.
  const totalBal = adjustedAccounts.reduce((s, a) => s + (a.balance || 0), 0);
  const meanReturn = totalBal > 0
    ? adjustedAccounts.reduce((s, a) => s + (a.balance || 0) * (a.cagr || 0), 0) / totalBal
    : 0.06;
  const horizonYears = E.getPlanningHorizonYears(piWithLifeExp) + 1;

  // ── COMMON RANDOM NUMBERS ──────────────────────────────────────────────────
  // One set of market sequences, drawn ONCE and replayed identically for every
  // cell in the grid. That is the whole point of this tab: the user is comparing
  // claiming ages, so the claiming age should be the ONLY thing that differs
  // between cells. Previously each cell drew its own sequences, and at a few
  // dozen runs the sampling error (±8 points at 40 runs) swamped the signal — the
  // same claim age came back anywhere from 43% to 73% across repeated runs, and
  // which age looked "best" changed every time. Sharing the draws removes that
  // noise at no cost: a difference between two cells is now attributable to the
  // decision rather than to the dice.
  //
  // Each YEAR still gets an independent return, so sequence-of-returns risk is
  // preserved within a run.
  //
  // LIFESPANS AND INFLATION ARE DRAWN THE SAME WAY, for the same reason. Both
  // were previously held fixed, and both are first-order for THIS decision:
  //   - Longevity is the dominant variable in a claiming choice. Holding it
  //     constant made the one tab that most needs it the only one without it.
  //   - Social Security is the household's only CPI-indexed asset, so delaying
  //     buys inflation insurance that a fixed-inflation model cannot price.
  // Sharing the draws across cells is what keeps the comparison honest: cell A
  // and cell B face the same markets, the same lifespans and the same prices, so
  // a gap between them is the claiming decision and nothing else.
  const baseInflation = piWithLifeExp.inflationRate ?? 0.03;
  const inflationVol = mcInflationVol ?? 0;

  // Centre the sampled lifespan distribution on the user's own life-expectancy
  // input, so only the SHAPE comes from the mortality table. Same approach as
  // the Monte Carlo tab.
  const myLifeExp = piWithLifeExp.myLifeExpectancy ?? 85;
  const spouseLifeExp = piWithLifeExp.spouseLifeExpectancy ?? 87;
  const myShift = mcLongevity
    ? myLifeExp - (personalInfo.myAge + E.lifeExpectancyAt(personalInfo.myAge))
    : 0;
  const spouseShift = mcLongevity && isMarried && typeof personalInfo.spouseAge === 'number'
    ? spouseLifeExp - (personalInfo.spouseAge + E.lifeExpectancyAt(personalInfo.spouseAge))
    : 0;

  // With sampled lifespans a run can outlive the deterministic horizon, and any
  // year past the override array runs on deterministic returns — understating
  // risk in exactly the late years the simulation exists to stress. Size for the
  // longest life anyone can draw. MORTALITY_MAX_PLAN_AGE is the terminal age of
  // the mortality table, so a sim cannot exceed it.
  const MORTALITY_MAX_PLAN_AGE = 116;
  const seqYears = mcLongevity
    ? Math.max(horizonYears,
               MORTALITY_MAX_PLAN_AGE + Math.ceil(Math.max(myShift, spouseShift, 0)) - personalInfo.myAge + 1)
    : horizonYears;

  const sharedSequences = [];
  for (let run = 0; run < (mcRunsPerScenario || 0); run++) {
    const years = new Array(seqYears);
    // Geometric mean of this run's inflation path, used below to re-index SS.
    let inflationProduct = 1;
    for (let y = 0; y < seqYears; y++) {
      // Floor at -90% deflation: the draw is Normal and an unbounded left tail
      // would produce negative price levels.
      const inf = inflationVol > 0
        ? Math.max(-0.9, randomNormalSS() * inflationVol + baseInflation)
        : baseInflation;
      inflationProduct *= (1 + inf);
      years[y] = {
        marketReturn: Math.max(-1, randomNormalSS() * mcVolatility + meanReturn),
        inflation: inf,
      };
    }
    const geoMeanInflation = seqYears > 0
      ? Math.pow(inflationProduct, 1 / seqYears) - 1
      : baseInflation;

    const seq = { years, geoMeanInflation, myDeathAge: null, spouseDeathAge: null };
    if (mcLongevity) {
      // Independent draws per person. Real joint mortality is correlated (shared
      // habits and environment, the widowhood effect), but modelling that needs a
      // copula this app has no data to calibrate; independence is the conventional
      // and conservative choice.
      seq.myDeathAge = E.sampleAgeAtDeath(personalInfo.myAge, Math.random, myShift);
      if (isMarried && typeof personalInfo.spouseAge === 'number') {
        seq.spouseDeathAge = E.sampleAgeAtDeath(personalInfo.spouseAge, Math.random, spouseShift);
      }
    }
    sharedSequences.push(seq);
  }

  // Re-index SS to each run's own drawn inflation (engine helper — see the long
  // rationale there). Approximation, stated plainly: this matches the LEVEL of
  // inflation over the run, not its PATH. A run that front-loads inflation is
  // not distinguished from one that back-loads it. Getting the level right is
  // what the hedge turns on.
  const reindexSS = (streams, geoMeanInflation) =>
    inflationVol > 0 ? reindexSSForInflation(streams, baseInflation, geoMeanInflation) : streams;

  const runMcSimulation = (modifiedStreams, seq) => {
    // A sampled death only bites when survivor modelling is on, and the engine
    // gates that on married status. For a single filer the lifespan therefore has
    // to act on the horizon instead — the plan simply ends at death. Either way
    // the run is measured at the end of the life it drew, so "ran out of money
    // after you died" never counts as a failure.
    let pi = piWithLifeExp;
    let measureAge = legacyAge;
    if (mcLongevity) {
      const myDeath = seq.myDeathAge;
      const spDeath = seq.spouseDeathAge;
      measureAge = isMarried && spDeath != null ? Math.max(myDeath, spDeath) : myDeath;
      pi = {
        ...piWithLifeExp,
        myLifeExpectancy: myDeath,
        legacyAge: measureAge,
        ...(isMarried ? { survivorModelEnabled: true, spouseLifeExpectancy: spDeath } : {}),
      };
    }
    const proj = computeProjections(pi, adjustedAccounts,
      reindexSS(modifiedStreams, seq.geoMeanInflation), assets,
      oneTimeEvents, recurringExpenses, undefined, { yearOverrides: seq.years });
    // rowAtOrLast, not find(): a survivor-modelled plan ends the year both
    // spouses die, so the measurement age can legitimately have no row. Treating
    // that miss as a zero portfolio scored every scenario as a total failure.
    const atLegacy = rowAtOrLast(proj, measureAge);
    const survived = !!atLegacy && atLegacy.totalPortfolio > 0;
    let failureAge = null;
    for (const p of proj) {
      if (p.myAge >= personalInfo.myRetirementAge && p.totalPortfolio <= 0) { failureAge = p.myAge; break; }
    }
    return {
      survived, failureAge,
      portfolioAtLegacy: atLegacy?.totalPortfolio || 0,
      lastAge: atLegacy?.myAge ?? measureAge,
    };
  };

  const allScenarios = [];
  const totalCells = myAges.length * spouseAges.length;
  let cellIdx = 0;

  for (const myClaimAge of myAges) {
    for (const spClaimAge of spouseAges) {
      const modifiedStreams = buildStreams(myClaimAge, spClaimAge);
      const proj = computeProjections(piWithLifeExp, adjustedAccounts, modifiedStreams, assets, oneTimeEvents, recurringExpenses);

      const retirementYears = proj.filter(p => p.myAge >= personalInfo.myRetirementAge);
      const lifetimeTax = retirementYears.reduce((sum, p) => sum + p.totalTax, 0);
      const lifetimeWithdrawals = retirementYears.reduce((sum, p) => sum + p.portfolioWithdrawal, 0);
      const lifetimeSS = retirementYears.reduce((sum, p) => sum + p.socialSecurity, 0);
      const lifetimeRothConversions = retirementYears.reduce((sum, p) => sum + (p.rothConversion || 0), 0);
      const atLegacy = rowAtOrLast(proj, legacyAge);
      const at75 = proj.find(p => p.myAge === 75);
      const at80 = proj.find(p => p.myAge === 80);
      const at85 = proj.find(p => p.myAge === 85);

      // Age the portfolio first hits zero, or null if it never does. Terminal
      // wealth alone cannot separate a plan that ran dry at 78 from one that ran
      // dry at 88 — both report $0 and tie in the ranking.
      let depletionAge = null;
      for (const p of retirementYears) {
        if (p.totalPortfolio <= 0) { depletionAge = p.myAge; break; }
      }

      // Terminal wealth in AFTER-TAX dollars. Claiming ages differ in how hard
      // they drain pre-tax accounts during the bridge years, so two scenarios
      // with equal raw balances can leave materially unequal spendable wealth.
      // Same discount the Roth optimizer uses (engine scoreRothStrategy).
      const HEIR_TAX_RATE = 0.25;
      const afterTaxAtLegacy = atLegacy
        ? Math.round((atLegacy.rothBalance || 0) + (atLegacy.brokerageBalance || 0)
            + (atLegacy.preTaxBalance || 0) * (1 - HEIR_TAX_RATE))
        : 0;

      let mcResults = null;
      if (withMC) {
        let survivedCount = 0;
        const finalPortfolios = [];
        const failureAges = [];
        const lastAges = [];
        for (let sim = 0; sim < mcRunsPerScenario; sim++) {
          // Same sequence index -> identical market path, lifespans and price
          // level in every cell. Only the claiming age differs.
          const r = runMcSimulation(modifiedStreams, sharedSequences[sim]);
          if (r.survived) survivedCount++;
          else if (r.failureAge !== null) failureAges.push(r.failureAge);
          finalPortfolios.push(r.portfolioAtLegacy);
          lastAges.push(r.lastAge);
        }
        finalPortfolios.sort((a, b) => a - b);
        const p10 = finalPortfolios[Math.floor(finalPortfolios.length * 0.1)] || 0;
        const p50 = finalPortfolios[Math.floor(finalPortfolios.length * 0.5)] || 0;
        const p90 = finalPortfolios[Math.floor(finalPortfolios.length * 0.9)] || 0;
        const avgFailureAge = failureAges.length > 0 ? failureAges.reduce((s, a) => s + a, 0) / failureAges.length : null;
        mcResults = { runs: mcRunsPerScenario, survived: survivedCount, successRate: survivedCount / mcRunsPerScenario, p10, p50, p90, avgFailureAge };
        if (mcLongevity && lastAges.length) {
          // The spread of lifespans this cell was actually judged over. Reported
          // so a success rate that moved because the household sometimes lives to
          // 100 does not look identical to one that moved because of markets.
          const sorted = [...lastAges].sort((a, b) => a - b);
          const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
          mcResults.longevity = { p10: q(0.10), p50: q(0.50), p90: q(0.90), min: sorted[0], max: sorted[sorted.length - 1] };
        }
      }

      allScenarios.push({
        myClaimAge, spClaimAge,
        label: isMarried ? `Me ${myClaimAge} / Spouse ${spClaimAge}` : `Claim at ${myClaimAge}`,
        myAnnualSS: calculateSSBenefit(myPIA, myClaimAge, myBirthYear) * 12,
        spAnnualSS: spClaimAge !== null ? calculateSSBenefit(spousePIA, spClaimAge, spouseBirthYear) * 12 : 0,
        portfolioAt75: at75?.totalPortfolio || 0,
        portfolioAt80: at80?.totalPortfolio || 0,
        portfolioAt85: at85?.totalPortfolio || 0,
        portfolioAtLegacy: atLegacy?.totalPortfolio || 0,
        afterTaxAtLegacy,
        depletionAge,
        // The age terminal wealth was actually measured at. Equals legacyAge in
        // the normal case; with survivor modelling it can be the year the last
        // spouse died. Surfaced so the UI never labels a column with an age the
        // projection never reached.
        measuredAtAge: atLegacy?.myAge ?? legacyAge,
        lifetimeTax, lifetimeWithdrawals, lifetimeSS, lifetimeRothConversions,
        // Terminal wealth at the planning age. This ALREADY reflects the claiming
        // decision: benefits received reduced portfolio withdrawals dollar for
        // dollar, so they are embedded in the balance. Adding lifetimeSS on top
        // (as this once did) counted every benefit dollar twice and tilted the
        // ranking toward late claiming. lifetimeSS is reported separately for
        // breakeven analysis, where the gross total is the right figure.
        netLifetimeWealth: (atLegacy?.totalPortfolio || 0),
        projections: slimProj(proj),
        mcResults,
      });

      cellIdx++;
      postMessage({ jobId, type: 'progress', percent: Math.round((cellIdx / totalCells) * 100) });
    }
  }

  postMessage({ jobId, type: 'result', data: { allScenarios } });
}

// ============================================================================
// runRothOptimizer — goal-based Roth conversion strategy sweep.
//
// Builds candidate strategies (bracket-fill targets × conversion windows),
// runs a full projection for each, and scores them via the engine's
// scoreRothStrategy. The UI ranks by the user's chosen goal and can Apply a
// winner back into personalInfo. Payload:
//   { personalInfo, accounts, incomeStreams, assets, oneTimeEvents,
//     recurringExpenses, heirTaxRate }
// Result: { baseline, results: [{ label, bracket, startAge, endAge, ...scores }] }
// ============================================================================
function runRothOptimizer(jobId, payload) {
  const {
    personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses,
    heirTaxRate,
  } = payload;

  const legacyAge = personalInfo.legacyAge || 95;
  const retirementAge = personalInfo.myRetirementAge;
  const defWin = E.getDefaultRothConversionWindow(personalInfo);

  // Candidate windows: the smart-default window (retirement → RMDs-1), an
  // ACA-aware variant starting at 65 (skips the pre-65 subsidy years), and an
  // IRMAA-aware variant ending at 70 (before most Medicare/IRMAA exposure).
  const starts = [...new Set([defWin.startAge, Math.max(65, defWin.startAge)])];
  const ends = [...new Set([defWin.endAge, Math.min(70, defWin.endAge)])];
  const windows = [];
  starts.forEach(s => ends.forEach(e => { if (e >= s) windows.push({ startAge: s, endAge: e }); }));

  const brackets = ['10%', '12%', '22%', '24%', '32%'];
  const noConversionPI = { ...personalInfo, rothConversionAmount: 0, rothConversionBracket: '', rothConversionStartAge: 0, rothConversionEndAge: 0 };
  const strategies = [{ label: 'No conversions (baseline)', bracket: '', window: null, pi: noConversionPI }];

  // Score the strategy the user ACTUALLY has configured, alongside the
  // alternatives. Without it they get twenty options ranked against "do nothing"
  // and no way to see where their own plan sits — which is the single comparison
  // they opened this tab for. It matters most for a fixed-amount strategy, which
  // the bracket sweep below can never reproduce.
  const hasCurrent = (personalInfo.rothConversionAmount > 0) || !!personalInfo.rothConversionBracket;
  if (hasCurrent) {
    const amt = personalInfo.rothConversionAmount > 0
      ? '$' + Math.round(personalInfo.rothConversionAmount).toLocaleString() + '/yr'
      : 'fill to ' + personalInfo.rothConversionBracket;
    const w = E.getDefaultRothConversionWindow(personalInfo);
    const sAge = personalInfo.rothConversionStartAge > 0 ? personalInfo.rothConversionStartAge : w.startAge;
    const eAge = personalInfo.rothConversionEndAge > 0 ? personalInfo.rothConversionEndAge : w.endAge;
    strategies.push({
      label: `Your current plan (${amt}, ages ${sAge}–${eAge})`,
      bracket: personalInfo.rothConversionBracket || '',
      window: { startAge: sAge, endAge: eAge },
      pi: personalInfo,
      isCurrent: true,
    });
  }

  windows.forEach(w => brackets.forEach(b => strategies.push({
    label: `Fill to ${b} bracket, ages ${w.startAge}–${w.endAge}`,
    bracket: b, window: w,
    pi: { ...personalInfo, rothConversionAmount: 0, rothConversionBracket: b, rothConversionStartAge: w.startAge, rothConversionEndAge: w.endAge },
  })));

  const scored = [];
  strategies.forEach((s, i) => {
    const proj = computeProjections(s.pi, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses);
    const score = E.scoreRothStrategy(proj, { legacyAge, retirementAge, heirTaxRate });
    scored.push({
      label: s.label, bracket: s.bracket,
      startAge: s.window ? s.window.startAge : null,
      endAge: s.window ? s.window.endAge : null,
      isCurrent: !!s.isCurrent,
      ...score,
    });
    postMessage({ jobId, type: 'progress', percent: Math.round(((i + 1) / strategies.length) * 100) });
  });

  // Strip rows that are not real alternatives. Two kinds show up routinely:
  //   • a bracket target already below the household's income converts $0, so the
  //     row IS the baseline wearing a different label
  //   • widening the window changes nothing once a pre-tax floor (or an empty
  //     pre-tax balance) has already stopped the conversions
  // Listing eight identical rows buries the handful of genuine choices. The
  // baseline and the user's own plan are always kept, even if they coincide.
  const results = [];
  const seen = new Set();
  scored.forEach((r, idx) => {
    const keepAlways = idx === 0 || r.isCurrent;
    if (!keepAlways && r.lifetimeConversions === 0) return;
    const sig = r.afterTaxLegacy + '|' + r.lifetimeTax + '|' + r.lifetimeConversions;
    if (!keepAlways && seen.has(sig)) return;
    seen.add(sig);
    results.push(r);
  });

  postMessage({ jobId, type: 'result', data: { baseline: results[0], results } });
}

// ============================================================================
// runMarginalRateCurve — the lifetime tax-rate chart behind the Roth simulator.
//
// Answers "in which years of my plan is converting cheap?" across the WHOLE
// horizon, working years included. Three series per year:
//
//   effectiveRate — total tax / gross income. The average rate, i.e. what most
//                   people mean by "my tax rate".
//   marginalRate  — all-in cost of the next `probeAmount` converted THIS year:
//                   income tax + the IRMAA it triggers two years later + any ACA
//                   premium subsidy it costs. The decision-relevant number.
//   bracket       — the statutory bracket the year already reaches. The gap
//                   between this and marginalRate is the whole point of the
//                   chart: it is why the simulator's per-year cost reads higher
//                   than the bracket suggests.
//
// METHOD. Every year is probed INDEPENDENTLY: one projection carrying a
// conversion confined to that single year, differenced against a single
// no-conversion baseline. A probe left running across all years would compound
// into a different portfolio and contaminate every later year's answer — the
// measurement would drift into a scenario rather than a derivative.
//
// Conversions are gated only by the age window, available pre-tax balance and
// the existence of a Roth account — NOT by retirement — so this works in working
// years, which is exactly what makes the chart worth drawing.
//
// Cost is one projection per plan year plus the baseline (~35 total), the same
// order as runRothOptimizer.
//
// Payload: { personalInfo, accounts, incomeStreams, assets, oneTimeEvents,
//            recurringExpenses, probeAmount }
// Result:  { probeAmount, curve: [{ age, year, effectiveRate, marginalRate,
//            taxOnlyRate, bracket, converted, irmaaDelta, acaSubsidyLost,
//            cliffHeadroom, filingStatus, magi, components }] }
// ============================================================================
function runMarginalRateCurve(jobId, payload) {
  const {
    personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses,
    probeAmount,
  } = payload;

  const probe = probeAmount > 0 ? probeAmount : 10000;

  // One baseline, conversions off. Every series is measured against it so the
  // chart answers a single coherent question instead of mixing yardsticks.
  const basePI = {
    ...personalInfo,
    rothConversionAmount: 0,
    rothConversionBracket: '',
    rothConversionStartAge: 0,
    rothConversionEndAge: 0,
    rothConversionPreTaxFloor: 0,
  };
  const baseline = computeProjections(basePI, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses);

  const curve = [];
  const total = baseline.length;

  baseline.forEach((baseRow, idx) => {
    const age = baseRow.myAge;

    // Probe confined to this one year.
    const probePI = {
      ...basePI,
      rothConversionAmount: probe,
      rothConversionStartAge: age,
      rothConversionEndAge: age,
      // Fixed nominal, NOT inflation-indexed. This is a derivative, so every
      // year must be probed with an identical nudge — indexing it would grow the
      // probe from $10k to $28k across the horizon and quietly measure a bigger
      // slice of the bracket in later years than in earlier ones.
      rothConversionInflationAdjust: false,
    };
    const probeProj = computeProjections(probePI, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses);
    const probeRow = probeProj.find(p => p.myAge === age);
    const converted = probeRow ? (probeRow.rothConversion || 0) : 0;

    // Nothing convertible (pre-tax exhausted, or no Roth account to receive it).
    // Report null rather than 0% — "cannot" and "free" must not look alike.
    const components = conversionCostComponents(probeProj, baseline, age, converted);

    // Average rate. totalIncome is spendable gross (earned + guaranteed +
    // withdrawals); the baseline has no conversion, so nothing phantom is in it.
    const grossIncome = baseRow.totalIncome || 0;
    const effectiveRate = grossIncome > 0 ? (baseRow.totalTax || 0) / grossIncome : null;

    // Headroom in THIS year's MAGI before the surcharge two years out crosses a
    // tier. The engine already computes it per row (irmaaInfo.distToNextTier);
    // read it rather than recomputing, so the chart and the Tax Year Snapshot
    // can never disagree. Undefined means the top tier — no cliff left to hit.
    const cliffHeadroom = baseRow.irmaaInfo && baseRow.irmaaInfo.distToNextTier !== undefined
      ? baseRow.irmaaInfo.distToNextTier
      : null;

    curve.push({
      age,
      year: baseRow.year,
      effectiveRate,
      // Why a year is expensive is usually "you were close to a cliff". Carrying
      // the headroom lets the UI say that without a second projection.
      cliffHeadroom,
      filingStatus: baseRow.filingStatus,
      magi: baseRow.magi,
      marginalRate: components ? components.rate : null,
      taxOnlyRate: components ? components.taxOnlyRate : null,
      // `idx` is the row's offset from the start of the projection, which is only
      // the right bracket-indexing offset when the projection starts in
      // BASE_TAX_YEAR. Derive it from the row's own calendar year instead, so the
      // curve keeps agreeing with the engine's brackets in later years.
      bracket: topMarginalBracket(
        baseRow.taxableIncome, baseRow.filingStatus || personalInfo.filingStatus,
        baseRow.year - BASE_TAX_YEAR, personalInfo.inflationRate
      ),
      converted,
      irmaaDelta: components ? components.irmaaDelta : 0,
      acaSubsidyLost: components ? components.acaSubsidyLost : 0,
      components,
    });

    if ((idx + 1) % 5 === 0 || idx + 1 === total) {
      postMessage({ jobId, type: 'progress', percent: Math.round(((idx + 1) / total) * 100) });
    }
  });

  postMessage({ jobId, type: 'result', data: { probeAmount: probe, curve } });
}
