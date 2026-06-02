// ============================================================================
// PlannerWorker — heavy projection runner for the desktop app.
//
// Loads the shared calc engine via importScripts and exposes three job types
// to the main thread via postMessage:
//   - monteCarlo:       MonteCarloTab's full simulation loop (1k-5k sims)
//   - ssGrid:           SocialSecurityTab's 6x6 deterministic claiming grid
//   - ssMonteCarlo:     ssGrid + per-cell MC volatility shocks (3,600 calls worst case)
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
} = E;

self.onmessage = (e) => {
  const { jobId, type, payload } = e.data;
  try {
    switch (type) {
      case 'monteCarlo':         runMonteCarlo(jobId, payload); break;
      case 'ssGrid':             runSocialSecurityGrid(jobId, payload, false); break;
      case 'ssMonteCarlo':       runSocialSecurityGrid(jobId, payload, true);  break;
      default:
        postMessage({ jobId, type: 'error', error: 'Unknown job type: ' + type });
    }
  } catch (err) {
    postMessage({ jobId, type: 'error', error: err.message, stack: err.stack });
  }
};

// Box-Muller transform for normal distribution
function randomNormalMC(mean, stdDev) {
  const u1 = Math.random();
  const u2 = Math.random();
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
  const yearsFromCurrent = piWithLifeExp.legacyAge - piWithLifeExp.myAge + 1;
  const walkUpYears = Math.max(0, simSettings.startAge - piWithLifeExp.myAge);
  const stochasticYears = yearsFromCurrent - walkUpYears;

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

  const BATCH = 50;
  const numPathsToStore = 100;
  const results = [];
  const portfolioPathsToStore = [];

  for (let sim = 0; sim < simSettings.numSimulations; sim++) {
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

    const proj = computeProjections(
      piWithLifeExp, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses,
      undefined, { yearOverrides: overrides }
    );

    // Build per-sim portfolio path from simSettings.startAge onward.
    const path = [];
    for (const p of proj) {
      if (p.myAge >= simSettings.startAge) {
        path.push({ age: p.myAge, portfolio: p.totalPortfolio });
      }
    }

    let portfolioSurvived = true;
    let failureAge = null;
    for (const pt of path) {
      if (pt.portfolio <= 0) { portfolioSurvived = false; failureAge = pt.age; break; }
    }

    results.push({
      finalPortfolio: path.length > 0 ? path[path.length - 1].portfolio : 0,
      survived: portfolioSurvived,
      failureAge,
      portfolioAt75: path.find(p => p.age === 75)?.portfolio || 0,
      portfolioAt85: path.find(p => p.age === 85)?.portfolio || 0,
      historicalStartYear: histStartYear,
    });
    if (sim < numPathsToStore) portfolioPathsToStore.push(path);

    if ((sim + 1) % BATCH === 0 || sim + 1 === simSettings.numSimulations) {
      postMessage({
        jobId, type: 'progress',
        percent: Math.round(((sim + 1) / simSettings.numSimulations) * 100),
      });
    }
  }

  // Starting portfolio: sum of initial account balances. Cheap and matches the
  // pre-R1 reported value (the old code summed initialBalances after walk-up;
  // we report raw initial balances here since the walk-up is now opaque inside
  // the engine. Users see the same number on screen — their current balance.)
  const startingPortfolio = accounts.reduce((s, a) => s + (a.balance || 0), 0);

  const successCount = results.filter(r => r.survived).length;
  const successRate = successCount / simSettings.numSimulations;
  const finalPortfolios = results.map(r => r.finalPortfolio).sort((a, b) => a - b);
  const percentile = (arr, p) => arr[Math.floor(arr.length * p)];
  const failureAges = results.filter(r => !r.survived).map(r => r.failureAge);
  const avgFailureAge = failureAges.length > 0
    ? failureAges.reduce((a, b) => a + b, 0) / failureAges.length
    : null;

  const yearsToReport = (piWithLifeExp.legacyAge - simSettings.startAge) + 1;
  const percentileBands = [];
  for (let year = 0; year < yearsToReport; year++) {
    const age = simSettings.startAge + year;
    const portfoliosAtYear = portfolioPathsToStore
      .map(path => path[year]?.portfolio || 0)
      .sort((a, b) => a - b);
    percentileBands.push({
      age,
      p10: percentile(portfoliosAtYear, 0.10),
      p25: percentile(portfoliosAtYear, 0.25),
      p50: percentile(portfoliosAtYear, 0.50),
      p75: percentile(portfoliosAtYear, 0.75),
      p90: percentile(portfoliosAtYear, 0.90),
    });
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
      totalSimulations: simSettings.numSimulations,
      startAge: simSettings.startAge,
      startingPortfolio,
      percentile5: percentile(finalPortfolios, 0.05),
      percentile25: percentile(finalPortfolios, 0.25),
      percentile50: percentile(finalPortfolios, 0.50),
      percentile75: percentile(finalPortfolios, 0.75),
      percentile95: percentile(finalPortfolios, 0.95),
      avgFailureAge,
      percentileBands,
      portfolioPaths: portfolioPathsToStore.slice(0, 50),
      method: simSettings.method,
      historicalSummary,
      historicalStartYearSetting: simSettings.historicalStartYear,
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
//     lifetimeTax, lifetimeWithdrawals, lifetimeSS, lifetimeRothConversions,
//     netLifetimeWealth,
//     projections: [{ myAge, totalPortfolio, totalTax, portfolioWithdrawal,
//                     socialSecurity, rothConversion }, ...],
//     mcResults: null | { runs, survived, successRate, p10, p50, p90, avgFailureAge } }
// ============================================================================
function runSocialSecurityGrid(jobId, payload, withMC) {
  const {
    personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses,
    legacyAge, cagrDelta, myPIA, spousePIA, myBirthYear, spouseBirthYear,
    isMarried,
    mcRunsPerScenario, mcVolatility,
  } = payload;

  const piWithLifeExp = { ...personalInfo, legacyAge };
  const adjustedAccounts = cagrDelta === 0
    ? accounts
    : accounts.map(a => ({ ...a, cagr: Math.max(0, (a.cagr || 0) + cagrDelta) }));

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

  const runMcSimulation = (modifiedStreams, sharedShock) => {
    const mcAccounts = adjustedAccounts.map(a => ({ ...a, cagr: Math.max(0, (a.cagr || 0) + sharedShock) }));
    const proj = computeProjections(piWithLifeExp, mcAccounts, modifiedStreams, assets, oneTimeEvents, recurringExpenses);
    const atLegacy = proj.find(p => p.myAge === legacyAge);
    const survived = atLegacy && atLegacy.totalPortfolio > 0;
    let failureAge = null;
    for (const p of proj) {
      if (p.myAge >= personalInfo.myRetirementAge && p.totalPortfolio <= 0) { failureAge = p.myAge; break; }
    }
    return { survived, failureAge, portfolioAtLegacy: atLegacy?.totalPortfolio || 0 };
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
      const atLegacy = proj.find(p => p.myAge === legacyAge);
      const at75 = proj.find(p => p.myAge === 75);
      const at80 = proj.find(p => p.myAge === 80);
      const at85 = proj.find(p => p.myAge === 85);

      let mcResults = null;
      if (withMC) {
        let survivedCount = 0;
        const finalPortfolios = [];
        const failureAges = [];
        for (let sim = 0; sim < mcRunsPerScenario; sim++) {
          const shock = randomNormalSS() * mcVolatility;
          const r = runMcSimulation(modifiedStreams, shock);
          if (r.survived) survivedCount++;
          else if (r.failureAge !== null) failureAges.push(r.failureAge);
          finalPortfolios.push(r.portfolioAtLegacy);
        }
        finalPortfolios.sort((a, b) => a - b);
        const p10 = finalPortfolios[Math.floor(finalPortfolios.length * 0.1)] || 0;
        const p50 = finalPortfolios[Math.floor(finalPortfolios.length * 0.5)] || 0;
        const p90 = finalPortfolios[Math.floor(finalPortfolios.length * 0.9)] || 0;
        const avgFailureAge = failureAges.length > 0 ? failureAges.reduce((s, a) => s + a, 0) / failureAges.length : null;
        mcResults = { runs: mcRunsPerScenario, survived: survivedCount, successRate: survivedCount / mcRunsPerScenario, p10, p50, p90, avgFailureAge };
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
        lifetimeTax, lifetimeWithdrawals, lifetimeSS, lifetimeRothConversions,
        netLifetimeWealth: (atLegacy?.totalPortfolio || 0) + lifetimeSS,
        projections: slimProj(proj),
        mcResults,
      });

      cellIdx++;
      postMessage({ jobId, type: 'progress', percent: Math.round((cellIdx / totalCells) * 100) });
    }
  }

  postMessage({ jobId, type: 'result', data: { allScenarios } });
}
