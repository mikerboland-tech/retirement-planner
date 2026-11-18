// ============================================
// StressTestTab — Lifted to module scope
// ============================================
function StressTestTab({ detailLevel, sectionVisibility, setSectionVisibility, accounts, assets, computeProjections, currentYear, incomeStreams, oneTimeEvents, personalInfo, projections, recurringExpenses }) {
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
      color: THEME.categorical[0]
    },
    {
      id: 'gfc_2008',
      name: '2007–2009 Financial Crisis',
      description: 'The Great Recession with a devastating 2008',
      returns: [5.5, -37.0, 26.5, 15.1, 2.1], // 2007-2011
      color: THEME.categorical[1]
    },
    {
      id: 'stagflation_1973',
      name: '1973–1974 Stagflation',
      description: 'Oil crisis + high inflation + recession',
      returns: [-14.7, -26.5, 37.2, 23.8, -7.2], // 1973-1977
      color: THEME.categorical[2]
    },
    {
      id: 'lost_decade_2000',
      name: '2000–2009 Lost Decade',
      description: 'Full decade of near-zero stock returns with two crashes',
      returns: [-9.1, -11.9, -22.1, 28.7, 10.9, 4.9, 15.8, 5.5, -37.0, 26.5],
      color: THEME.categorical[3]
    },
    {
      id: 'covid_2020',
      name: '2020 COVID Crash + Recovery',
      description: 'Sharp crash followed by rapid recovery',
      returns: [-34.0, 30.0, 18.4, 28.7, -18.1], // Approximate Q1 drawdown as annual, then recovery
      color: THEME.categorical[4]
    },
    {
      id: 'mild_bear',
      name: 'Mild Bear (–15%, –10%)',
      description: 'A moderate downturn in the first two years',
      returns: [-15.0, -10.0, 5.0, 8.0, 12.0],
      color: THEME.categorical[5]
    },
    {
      id: 'japan_1990',
      name: '1990s Japan-Style Stagnation',
      description: 'Prolonged low/negative returns (no quick recovery)',
      returns: [-3.0, -5.0, 2.0, -2.0, 1.0, -4.0, 3.0, 0.0, -1.0, 2.0],
      color: THEME.categorical[6]
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
          color: THEME.inkMuted
        });
      }
    }
    
    // Always include baseline (deterministic)
    const baselineCAGR = retirementProjection?.weightedCAGR || 0.07;
    
    const results = scenarios.map(scenario => {
      // Run the REAL engine with this scenario's returns injected per year via
      // opts.yearOverrides. This tab used to re-implement the whole projection
      // inline — income streams, RMDs, healthcare, withdrawal priority, and a
      // hand-rolled tax gross-up (gap divided by 1 − marginalRate × 0.7) — which meant
      // it silently disagreed with every other tab and modelled none of IRMAA,
      // ACA, NIIT, capital gains, Roth conversions, QCDs, the early-withdrawal
      // penalty, survivor rules, or one-time events. Everything now comes from
      // the one engine, and new engine features show up here automatically.
      //
      // Walk-up years (today to retirement) keep their slot empty so each
      // account grows at its own CAGR; the crash lands the year retirement
      // starts, which is the sequence-of-returns risk this tab exists to show.
      const walkUpYears = Math.max(0, retirementAge - personalInfo.myAge);
      const horizon = getPlanningHorizonYears(personalInfo) + 1;
      const overrides = new Array(horizon);
      for (let y = walkUpYears; y < horizon; y++) {
        const idx = y - walkUpYears;
        overrides[y] = {
          marketReturn: idx < scenario.returns.length ? scenario.returns[idx] / 100 : baselineCAGR,
          inflation: personalInfo.inflationRate,
        };
      }

      const proj = computeProjections(
        personalInfo, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses,
        undefined, { yearOverrides: overrides }
      );

      const yearData = proj
        .filter(p => p.myAge >= retirementAge)
        .map((p, idx) => ({
          age: p.myAge,
          year: p.year,
          portfolio: p.totalPortfolio,
          yearReturn: idx < scenario.returns.length ? scenario.returns[idx] / 100 : baselineCAGR,
          withdrawal: p.portfolioWithdrawal,
          shortfall: p.unfundedShortfall || 0,
          isScenarioYear: idx < scenario.returns.length,
        }));

      const failure = yearData.find(y => y.portfolio <= 0);
      const trough = yearData.length > 0 ? Math.min(...yearData.map(y => y.portfolio)) : 0;

      return {
        ...scenario,
        yearData,
        survived: !failure,
        failureAge: failure ? failure.age : null,
        finalPortfolio: yearData[yearData.length - 1]?.portfolio || 0,
        worstDrawdown: trough - retirementPortfolio,
        maxDrawdownPct: retirementPortfolio > 0 ? ((trough - retirementPortfolio) / retirementPortfolio * 100) : 0,
      };
    });
    
    // Baseline: the deterministic plan, straight off the shared projection.
    const baseYearData = projections
      .filter(p => p.myAge >= retirementAge)
      .map(p => ({
        age: p.myAge,
        year: p.year,
        portfolio: p.totalPortfolio,
        yearReturn: baselineCAGR,
        withdrawal: p.portfolioWithdrawal,
        shortfall: p.unfundedShortfall || 0,
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
      <BasisLabel pi={personalInfo} />
      <div>
        <h3 className="text-xl font-semibold text-slate-100 mb-2">Sequence-of-Returns Stress Test</h3>
        <p className="text-slate-400 text-sm">
          Test how your retirement plan holds up when bad market years happen early. 
          Two portfolios with identical average returns can produce dramatically different outcomes 
          depending on <em>when</em> the bad years hit — this is sequence-of-returns risk.
        </p>
      </div>
      
      <SectionControls tab="stresstest" vis={sectionVisibility} setVis={setSectionVisibility}
                       level={detailLevel} />
      <HideableBlock tab="stresstest" id="startingConditions" level={detailLevel}
                     vis={sectionVisibility} setVis={setSectionVisibility}>
        {/* Starting conditions */}
        <div className={cardStyle}>
          <h4 className="text-lg font-semibold text-slate-200 mb-3">Starting Conditions at Retirement (Age {retirementAge})</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-slate-500">Portfolio at Retirement</div>
              <div className="text-lg font-bold text-emerald-400">{formatCurrency(retirementPortfolio)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{strategyLeadsSpending(personalInfo) ? 'First-Year Spending' : 'Annual Spending Goal'}</div>
              {/* Both figures below are in the dollars of the retirement YEAR. Showing
                  today's desiredRetirementIncome against a future portfolio balance
                  mixed real and nominal dollars and understated the withdrawal rate
                  by the whole inflation factor — a plan drawing 6.7% displayed as
                  1.5%, which made stress-test failures look impossible. */}
              <div className="text-lg font-bold text-amber-400">{formatCurrency(retirementProjection?.desiredIncome || personalInfo.desiredRetirementIncome)}</div>
              <div className="text-[10px] text-slate-500">in age-{retirementAge} dollars{strategyLeadsSpending(personalInfo) ? ' · set by your strategy' : ''}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Withdrawal Rate</div>
              <div className="text-lg font-bold text-slate-200">{retirementPortfolio > 0 ? ((retirementProjection?.portfolioWithdrawal || 0) / retirementPortfolio * 100).toFixed(1) : '—'}%</div>
              <div className="text-[10px] text-slate-500">first-year draw ÷ portfolio</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Planning Horizon</div>
              <div className="text-lg font-bold text-slate-200">{endAge - retirementAge} years (to age {endAge})</div>
            </div>
          </div>
        </div>
      </HideableBlock>
      
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
                <p className="text-xs text-slate-500 mt-0.5 font-mono">
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
          
          <HideableBlock tab="stresstest" id="scenarioChart" level={detailLevel}
                         vis={sectionVisibility} setVis={setSectionVisibility}>
            {/* Portfolio chart */}
            {LineChart && (
              <div className={cardStyle}>
                <h4 className="text-lg font-semibold text-slate-200 mb-4">Portfolio Value Under Each Scenario</h4>
                <div style={{ height: 450 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={THEME.grid} />
                      <XAxis 
                        dataKey="age" 
                        type="number" 
                        domain={[retirementAge, endAge]}
                        tick={{ fill: THEME.inkMuted, fontSize: 12 }}
                        label={{ value: 'Age', position: 'insideBottom', offset: -5, fill: THEME.inkMuted }}
                        allowDuplicatedCategory={false}
                      />
                      <YAxis 
                        tick={{ fill: THEME.inkMuted, fontSize: 12 }}
                        tickFormatter={v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : `$${(v/1000).toFixed(0)}k`}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: THEME.surfaceRaised, border: '1px solid #334155', borderRadius: '8px' }}
                        labelStyle={{ color: THEME.inkPrimary }}
                        formatter={(value, name) => [formatCurrency(value), name]}
                        labelFormatter={label => `Age ${label}`}
                      />
                      <Legend formatter={legendInk} />
                      <ReferenceLine y={0} stroke={THEME.grid} strokeDasharray="3 3" />
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
          </HideableBlock>
          
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
// The Withdrawals tab was retired in v2.46.0.
// ============================================
// It compared seven spending rules (4% rule, fixed percentage, RMD-based,
// Guyton-Klinger, floor-and-upside, dynamic smoothing, go-go/slow-go) with a
// simulation of its own — never the engine — and that simulation modelled no
// tax at all: no income tax, no IRMAA, no conversions. Every rule it ranked was
// run on pre-tax dollars, so "this rule lasts to 95" described a plan more
// generous than the reader's, and could disagree with every other tab. Two of
// its rules had since become real engine features (spending guardrails in the
// Sandbox, spending phases on Personal Info); the rest would need building into
// the engine to be worth showing, rather than kept in a second model.

// ============================================
// SocialSecurityTab — Lifted to module scope
// ============================================
function SocialSecurityTab({ accounts, assets, computeProjections, currentYearReturn, detailLevel, incomeStreams, oneTimeEvents, personalInfo, recurringExpenses, sectionVisibility, setIncomeStreams, setSectionVisibility }) {
  const mySSStream = incomeStreams.find(s => s.type === 'social_security' && s.owner === 'me');
  const spouseSSStream = incomeStreams.find(s => s.type === 'social_security' && s.owner === 'spouse');
  
  // Seed from the stream's own PIA when it has one; otherwise infer it from the
  // entered benefit and that stream's claiming age, so the whole 62-70 grid is
  // built on the right base rather than on a benefit that already has a claiming
  // adjustment baked in.
  const [myPIA, setMyPIA] = useState(() => mySSStream?.pia
    || (mySSStream ? Math.round(inferPiaFromBenefit(mySSStream.amount / 12, mySSStream.startAge, personalInfo.myBirthYear || (new Date().getFullYear() - personalInfo.myAge))) : 2500));
  const [spousePIA, setSpousePIA] = useState(() => spouseSSStream?.pia
    || (spouseSSStream ? Math.round(inferPiaFromBenefit(spouseSSStream.amount / 12, spouseSSStream.startAge, personalInfo.spouseBirthYear || (new Date().getFullYear() - personalInfo.spouseAge))) : 1800));
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
  // Longevity defaults ON: it is the single largest driver of the claiming
  // decision, so a stress test that holds it fixed is stressing the wrong thing.
  const [mcLongevity, setMcLongevity] = useState(true);
  // Inflation volatility. 1.5% σ around the plan's own inflation assumption is
  // roughly the post-war US dispersion of 10-year average CPI. Zero disables the
  // draw and keeps SS at its entered COLA.
  const [mcInflationVol, setMcInflationVol] = useState(0.015);

  // R6: heavy SS-grid computation runs in a Web Worker. Status: 'idle' | 'running' | 'error'.
  // gridResult.allScenarios is read by the JSX below; null while a job is in flight.
  const [gridResult, setGridResult] = useState(null);
  const [gridStatus, setGridStatus] = useState('idle');
  const [gridProgress, setGridProgress] = useState(0);
  const [gridError, setGridError] = useState(null);
  const gridJobRef = useRef(null);

  // The claim ages SAVED in the plan — what every other tab is projecting from.
  const savedMyClaimAge = mySSStream?.startAge || 67;
  const savedSpouseClaimAge = spouseSSStream?.startAge || 67;

  // Staged (unsaved) claim ages. Changing a dropdown here used to write straight
  // through to incomeStreams, silently rewriting the plan on every tab with no
  // button pressed and no confirmation — so exploring "what if I claimed at 64"
  // was indistinguishable from deciding to. Edits now stage here until applied.
  const [pendingMyClaimAge, setPendingMyClaimAge] = useState(savedMyClaimAge);
  const [pendingSpouseClaimAge, setPendingSpouseClaimAge] = useState(savedSpouseClaimAge);
  const [applyConfirmation, setApplyConfirmation] = useState(null);

  // Follow the plan when it changes underneath us (another tab edits the stream,
  // or a saved plan loads). Only resyncs what the user has not staged, so an
  // in-progress edit is never silently discarded.
  useEffect(() => { setPendingMyClaimAge(savedMyClaimAge); }, [savedMyClaimAge]);
  useEffect(() => { setPendingSpouseClaimAge(savedSpouseClaimAge); }, [savedSpouseClaimAge]);

  const hasUnappliedClaimAges =
    pendingMyClaimAge !== savedMyClaimAge ||
    (!!spouseSSStream && pendingSpouseClaimAge !== savedSpouseClaimAge);

  // The analysis below reads the STAGED ages, so the grid previews what you are
  // considering. Only Apply writes to the plan.
  const myCurrentClaimAge = pendingMyClaimAge;
  const spouseCurrentClaimAge = pendingSpouseClaimAge;
  
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
  
  // Staging only — no write to the plan.
  const updateMyClaimAge = (newAge) => { setPendingMyClaimAge(newAge); setApplyConfirmation(null); };
  const updateSpouseClaimAge = (newAge) => { setPendingSpouseClaimAge(newAge); setApplyConfirmation(null); };

  const revertClaimAges = () => {
    setPendingMyClaimAge(savedMyClaimAge);
    setPendingSpouseClaimAge(savedSpouseClaimAge);
    setApplyConfirmation(null);
  };

  // The single write path into the plan. Updates both SS streams in one call so
  // a couple's change lands atomically rather than as two projection passes.
  const applyClaimAges = () => {
    if (!hasUnappliedClaimAges) return;
    const applied = [];
    const next = incomeStreams.map(s => {
      if (mySSStream && s.id === mySSStream.id && pendingMyClaimAge !== savedMyClaimAge) {
        applied.push(`yours to ${pendingMyClaimAge}`);
        return { ...s, startAge: pendingMyClaimAge, amount: calculateSSBenefit(myPIA, pendingMyClaimAge, myBirthYear) * 12, pia: myPIA };
      }
      if (spouseSSStream && s.id === spouseSSStream.id && pendingSpouseClaimAge !== savedSpouseClaimAge) {
        applied.push(`your spouse's to ${pendingSpouseClaimAge}`);
        return { ...s, startAge: pendingSpouseClaimAge, amount: calculateSSBenefit(spousePIA, pendingSpouseClaimAge, spouseBirthYear) * 12, pia: spousePIA };
      }
      return s;
    });
    setIncomeStreams(next);
    setApplyConfirmation(applied.join(' and '));
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
          currentYearReturn,
          legacyAge: lifeExpectancy, cagrDelta,
          // Both life-expectancy inputs drive the engine's mortality, not just
          // the measurement horizon — otherwise survivor-modelled plans die at
          // personalInfo's ages while this tab measures at its own, and the
          // spouse input below is inert. Only has an effect when survivor
          // modeling is on; the engine ignores these otherwise.
          myLifeExpectancy: lifeExpectancy,
          spouseLifeExpectancy,
          myPIA, spousePIA, myBirthYear, spouseBirthYear,
          isMarried: ssIsMarried,
          mcRunsPerScenario, mcVolatility, mcLongevity, mcInflationVol,
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
    lifeExpectancy, spouseLifeExpectancy, cagrDelta, myPIA, spousePIA, myBirthYear, spouseBirthYear,
    ssIsMarried, useMcStressTest,
    // MC knobs are only consumed when the stress test is on. Going inert when it's
    // off prevents adjusting the slider from re-firing the deterministic grid for
    // no reason (R4).
    useMcStressTest ? mcRunsPerScenario : null,
    useMcStressTest ? mcVolatility : null,
    useMcStressTest ? mcLongevity : null,
    useMcStressTest ? mcInflationVol : null,
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
      <BasisLabel pi={personalInfo} />
      <div>
        <h3 className="text-xl font-semibold text-slate-100 mb-2">Social Security Claiming Strategy Optimizer</h3>
        <p className="text-slate-400 text-sm">Compare benefits at different claiming ages and find your optimal strategy based on life expectancy.</p>
      </div>

      <SectionControls tab="socialsecurity" vis={sectionVisibility} setVis={setSectionVisibility} level={detailLevel} />
      
      {/* Current Plan Summary — staged edits, explicit Apply. */}
      <div className={`${cardStyle} border-l-4 ${hasUnappliedClaimAges ? 'border-l-sky-500' : 'border-l-amber-500'}`}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <h4 className="text-lg font-semibold text-amber-400">Your Current Plan</h4>
          {hasUnappliedClaimAges
            ? <span className="text-xs px-2 py-1 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40 whitespace-nowrap">● Unsaved changes</span>
            : <span className="text-xs px-2 py-1 rounded bg-slate-700/50 text-slate-400 border border-slate-600 whitespace-nowrap">✓ Saved to plan</span>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { key: 'me', label: 'My Claiming Age', pending: pendingMyClaimAge, saved: savedMyClaimAge, pia: myPIA, birthYear: myBirthYear, onChange: updateMyClaimAge, show: true },
            { key: 'spouse', label: 'Spouse Claiming Age', pending: pendingSpouseClaimAge, saved: savedSpouseClaimAge, pia: spousePIA, birthYear: spouseBirthYear, onChange: updateSpouseClaimAge, show: personalInfo.filingStatus === 'married_joint' && !!spouseSSStream },
          ].filter(f => f.show).map(f => {
            const dirty = f.pending !== f.saved;
            return (
              <div key={f.key} className={`flex items-center justify-between p-3 rounded-lg ${dirty ? 'bg-sky-900/20 border border-sky-700/40' : 'bg-slate-800/50'}`}>
                <div>
                  <p className="text-slate-400 text-sm">{f.label}</p>
                  <p className="text-2xl font-bold text-slate-100">{f.pending}</p>
                  <p className="text-slate-500 text-xs">{formatCurrency(calculateSSBenefit(f.pia, f.pending, f.birthYear) * 12)}/year</p>
                  {dirty && <p className="text-sky-400 text-xs mt-1">Plan currently has {f.saved} — not applied yet</p>}
                </div>
                <select value={f.pending} onChange={e => f.onChange(Number(e.target.value))} className={`${inputSkin} px-4 py-2.5 w-24`}>
                  {claimingAges.map(age => <option key={age} value={age}>{age}</option>)}
                </select>
              </div>
            );
          })}
        </div>

        {hasUnappliedClaimAges ? (
          <div className="mt-4 p-3 bg-sky-900/30 border border-sky-700/50 rounded-lg">
            <p className="text-sky-300 text-sm font-medium mb-1">These ages are being previewed, not saved</p>
            <p className="text-slate-400 text-xs mb-3">
              The analysis on this tab already reflects them. Your saved plan — and every other tab — still uses{' '}
              {savedMyClaimAge}{spouseSSStream ? ` / ${savedSpouseClaimAge}` : ''}. Apply to write the new claiming age
              into your Social Security income stream.
            </p>
            <div className="flex gap-2">
              <button onClick={applyClaimAges} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-medium">
                Apply to Plan
              </button>
              <button onClick={revertClaimAges} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-sm font-medium">
                Discard
              </button>
            </div>
          </div>
        ) : applyConfirmation ? (
          <p className="mt-4 text-sm text-emerald-400">
            ✓ Saved to your plan — changed {applyConfirmation}. Your Social Security income stream is updated and every tab now reflects it.
          </p>
        ) : (
          <p className="mt-4 text-xs text-slate-500">
            Changing an age here previews it in the analysis below. Nothing is written to your plan until you press Apply.
          </p>
        )}
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
              <p className="text-xs text-slate-500 mt-1">Used by the Full Plan Impact Analysis below as the planning horizon, and as your age at death when survivor modeling is on. The longer you expect to live, the more delayed claiming tends to win.</p>
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
                <p className="text-xs text-slate-500 mt-1">Used by the Full Plan Impact Analysis below as your spouse's age at death when survivor modeling is on — which determines who inherits the higher benefit, and for how long.</p>
              </div>
            </div>
          </div>
        )}
      </div>
      
      <Section tab="socialsecurity" id="byClaimAge" title={"Monthly Benefits by Claiming Age"} vis={sectionVisibility} level={detailLevel} setVis={setSectionVisibility}>
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
                      {isCurrent && (
                        <span className={`ml-2 text-xs ${row.age === savedMyClaimAge ? 'text-amber-400' : 'text-sky-400'}`}>
                          {row.age === savedMyClaimAge ? '◆ In your plan' : '◆ Previewing (not saved)'}
                        </span>
                      )}
                    </td>
                    <td className="text-right py-2 px-3 text-slate-300">{row.percentOfFRA}%</td>
                    <td className="text-right py-2 px-3 text-slate-200">{formatCurrency(row.monthlyBenefit)}</td>
                    <td className="text-right py-2 px-3 text-slate-200">{formatCurrency(row.annualBenefit)}</td>
                    <td className="text-center py-2 px-3">
                      {!isCurrent && (
                        <button onClick={() => updateMyClaimAge(row.age)} className="text-xs text-amber-400 hover:text-amber-300">
                          Preview
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
      
      {/* ═══════════════════════════════════════════════════════════════════
          ANALYSIS CONTROLS — Affect the Full Plan Impact Analysis below
          ═══════════════════════════════════════════════════════════════════ */}
      <Section tab="socialsecurity" id="controls" title={<>⚙️ Analysis Sensitivity Controls</>} vis={sectionVisibility} level={detailLevel} setVis={setSectionVisibility} className={`${cardStyle} border-l-4 border-l-sky-500`}>
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
                    : 'bg-slate-700 text-slate-300 border border-slate-600 hover:bg-slate-600'
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
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className="text-xs text-slate-400">Vary lifespan</label>
                    <button
                      onClick={() => setMcLongevity(!mcLongevity)}
                      className={`w-full mt-1 text-xs px-2 py-1 rounded font-medium border transition-all ${
                        mcLongevity
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-slate-700 text-slate-300 border-slate-600 hover:bg-slate-600'
                      }`}
                    >
                      {mcLongevity ? '✓ Sampled' : '○ Fixed'}
                    </button>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">Inflation volatility (σ)</label>
                    <select
                      value={mcInflationVol}
                      onChange={e => setMcInflationVol(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 mt-1"
                    >
                      <option value={0}>0% (fixed)</option>
                      <option value={0.01}>1.0% (calm)</option>
                      <option value={0.015}>1.5% (historical)</option>
                      <option value={0.025}>2.5% (turbulent)</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  {mcLongevity
                    ? <><strong className="text-slate-200">Lifespans are drawn per simulation</strong> from a CDC mortality table centered on your life-expectancy inputs above — the single biggest driver of this decision. A plan is judged over the life it actually drew, so running out of money after you have died is not counted as a failure.</>
                    : <><strong className="text-amber-300">Lifespan is fixed</strong> at your life-expectancy inputs, so every simulation dies on the same birthday. Markets vary; longevity — the dominant variable here — does not. Turn this on for a real stress test.</>}
                </p>
                {mcInflationVol > 0 && (
                  <p className="text-xs text-slate-400 mt-2">
                    <strong className="text-slate-200">Inflation is drawn too</strong>, and Social Security is re-indexed to each run's inflation (it is the only CPI-indexed asset in your plan, by law). This is what lets the analysis price delayed claiming as the inflation hedge it actually is — pensions and other streams keep their own COLA and correctly lose real value.
                  </p>
                )}
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
                Methodology note: each year draws its own Normal(mean, σ) return, so sequence-of-returns risk is modeled within a run. All accounts share that year's draw, so asset-class diversification is not modeled — treat σ as the volatility of your portfolio as a whole. Every scenario in the grid replays the identical set of draws (common random numbers), which is what makes cell-to-cell differences attributable to the claiming age rather than to sampling luck.
              </p>
            )}
          </div>
        </div>
      </Section>

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

        // Ranking is the engine's compareClaimingScenarios (survival first, then
        // after-tax wealth) so the table order, the winner tiles and the Δ column
        // cannot disagree about what "best" means. Sort comparator: best first.
        const betterOf = (a, b) => compareClaimingScenarios(b, a) < 0 ? b : a;

        // Find winners
        const bestOverall = allScenarios.reduce(betterOf);
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
              return betterOf(b, c);
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
          return compareClaimingScenarios(a, b);
        });
        
        // Portfolio chart data for top scenarios
        const chartScenarios = [
          allScenarios.find(s => s.myClaimAge === 62 && (s.spClaimAge === 62 || s.spClaimAge === null)),
          allScenarios.find(s => s.myClaimAge === 67 && (s.spClaimAge === 67 || s.spClaimAge === null)),
          allScenarios.find(s => s.myClaimAge === 70 && (s.spClaimAge === 70 || s.spClaimAge === null)),
          // Plot the recommended scenario, not a differently-ranked one — the
          // chart should show the strategy the tab is actually pointing at.
          bestOverall.myClaimAge !== 62 && bestOverall.myClaimAge !== 67 && bestOverall.myClaimAge !== 70 ? bestOverall : null,
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
        
        const chartColors = THEME.categorical;
        
        // Whether the user has Roth conversions enabled. Affects banner display
        // and whether the ranking table shows a "Roth Conv." column.
        const rothConversionActive = conversionIsActive(personalInfo);
        
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
            <Section tab="socialsecurity" id="fullPlan" title={"📊 Full Plan Impact Analysis"} vis={sectionVisibility} level={detailLevel} setVis={setSectionVisibility} className={`${cardStyle} border-l-4 border-l-emerald-500`}>
              <p className="text-slate-400 text-sm mb-2">
                {isMarried 
                  ? `Runs your complete retirement plan for ${myAges.length * spouseAges.length} combinations of your and your spouse's claiming ages — including taxes, withdrawals, RMDs, growth, survivor benefits, and Roth conversions — to show the true financial impact.`
                  : 'Runs your complete retirement plan for each claiming age — including taxes, portfolio withdrawals, RMDs, growth, and Roth conversions — to show the true financial impact beyond simple breakeven math.'}
              </p>
              <p className="text-slate-500 text-xs mb-4">
                Using life expectancy of {legacyAge} from the controls above — it sets both the planning horizon and, when survivor modeling is on, when each spouse dies. Adjust it to see how longevity affects the optimal strategy: it is the single biggest driver of this decision.
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
                const conversionActive = conversionIsActive(personalInfo);
                if (!conversionActive) {
                  return (
                    <div className="mb-4 p-3 bg-slate-800/50 border border-slate-700 rounded-lg text-sm">
                      <p className="text-slate-300 font-medium">🔄 Roth conversions are OFF in this plan</p>
                      <p className="text-slate-500 text-xs mt-1">If you enable Roth conversions in <strong className="text-slate-300">Taxes &amp; Roth → Your Roth conversion strategy</strong>, the analysis below will model them in each scenario. Conversion amounts depend on SS timing (earlier SS = less bracket room for cheap conversions), which can shift the optimal claim age.</p>
                    </div>
                  );
                }
                // Build the config description
                const mode = conversionIsActive(personalInfo)
                  ? conversionModeLabel(personalInfo)
                  : `${formatCurrency(personalInfo.rothConversionAmount || 0)}/yr ${personalInfo.rothConversionInflationAdjust === false ? '(fixed nominal)' : "(today's $, indexed)"}`;
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
                        ⚠ Your conversion window is {userYears} year{userYears !== 1 ? 's' : ''}, but the standard "bridge years" approach uses {smartYears} years (retirement age {ssDefaultWindow.startAge} through {ssDefaultWindow.endAge}, the year before RMDs at {getRmdStartAge(personalInfo.myBirthYear)}). Adjust in <strong className="text-amber-200">Taxes &amp; Roth → Your Roth conversion strategy</strong> for a more complete analysis.
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
              {/* ── IS THE WINNER REAL, OR IS IT THE DICE? ─────────────────────
                  Common random numbers shrink the sampling error between cells
                  but do not remove it. When the top scenarios sit within roughly
                  one standard error of each other, the argmax flips from run to
                  run — presenting it as "the best strategy" would be dressing up
                  noise as a recommendation. Say so instead. */}
              {useMcStressTest && bestBySuccessRate?.mcResults && (() => {
                const rates = allScenarios.filter(s => s.mcResults).map(s => s.mcResults.successRate);
                if (rates.length < 2) return null;
                const top = Math.max(...rates);
                const n = mcRunsPerScenario;
                const stdErr = Math.sqrt(Math.max(top * (1 - top), 0.0001) / n);
                const within = rates.filter(r => top - r <= stdErr).length;
                if (within < 2) return null;
                return (
                  <div className="mb-4 p-3 bg-amber-900/30 border border-amber-700/50 rounded-lg text-sm">
                    <p className="text-amber-300 font-medium">
                      ⚠ {within} of {rates.length} scenarios are statistically tied
                    </p>
                    <p className="text-amber-400/80 text-xs mt-1">
                      Their success rates fall within one standard error (±{(stdErr * 100).toFixed(1)} points at {n} runs)
                      of the best. Which one comes out on top will change if you re-run this. Raise the runs per
                      scenario to separate them, or use the deterministic ranking below — and treat any claiming age
                      in that band as an equally defensible choice rather than reading the #1 row as the answer.
                    </p>
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
                    <p className="text-slate-500 text-xs uppercase tracking-wide">Best Overall</p>
                    <p className="text-xl font-bold text-emerald-400">{bestOverall.label}</p>
                    <p className="text-slate-400 text-xs mt-1">
                      {formatCurrency(bestOverall.afterTaxAtLegacy)} after tax
                      {bestOverall.depletionAge
                        ? <span className="text-red-400"> · runs dry at {bestOverall.depletionAge}</span>
                        : <span className="text-emerald-400"> · never runs dry</span>}
                    </p>
                  </div>
                )}
                {useMcStressTest ? (
                  <div className="p-3 bg-slate-800/50 rounded-lg">
                    <p className="text-slate-500 text-xs uppercase tracking-wide">Best Overall</p>
                    <p className="text-xl font-bold text-emerald-400">{bestOverall.label}</p>
                    <p className="text-slate-400 text-xs mt-1">
                      {formatCurrency(bestOverall.afterTaxAtLegacy)} after tax
                      {bestOverall.depletionAge
                        ? <span className="text-red-400"> · runs dry at {bestOverall.depletionAge}</span>
                        : <span className="text-emerald-400"> · never runs dry</span>}
                    </p>
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
            </Section>

            {/* Ranked Comparison Table */}
            <div className={cardStyle}>
              <h4 className="text-lg font-semibold text-amber-400 mb-2">
                All Scenarios Ranked by {useMcStressTest ? 'Success Rate' : 'Survival, then After-Tax Wealth'}
              </h4>
              <p className="text-xs text-slate-500 mb-3">
                {useMcStressTest 
                  ? `Each scenario was stress-tested with ${mcRunsPerScenario} Monte Carlo simulations. Success rate = % of sims where portfolio survived to age ${legacyAge}. Median (p50) is the typical outcome; p10 is the bad-luck scenario (90% of sims did better).`
                  : `Ranked first on whether the plan runs dry (and if so, how late), then on after-tax wealth at age ${legacyAge} — pre-tax balances discounted 25% for the taxes an heir would owe, since claiming ages differ in how hard they drain pre-tax accounts. Net Wealth is the raw portfolio at ${legacyAge}: benefits received already reduced withdrawals dollar for dollar, so they are embedded in that balance rather than added on top. Lifetime taxes and withdrawals are summed from retirement through ${legacyAge}.`
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
                      <th className="text-right py-2 px-2 text-slate-400">After Tax</th>
                      <th className="text-right py-2 px-2 text-slate-400">Runs Dry</th>
                      <th className="text-right py-2 px-2 text-slate-400">Lifetime SS</th>
                      <th className="text-right py-2 px-2 text-slate-400">Lifetime Taxes</th>
                      <th className="text-right py-2 px-2 text-slate-400">Withdrawals</th>
                      {rothConversionActive && <th className="text-right py-2 px-2 text-slate-400">Roth Conv.</th>}
                      <th className="text-right py-2 px-2 text-slate-400">Net Wealth</th>
                      <th className="text-right py-2 px-2 text-slate-400">Δ vs Current</th>
                      <th className="text-center py-2 px-2 text-slate-400"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((s, i) => {
                      const isCurrent = s === currentScenario;
                      const isBest = i === 0;
                      // Delta on the same basis the ranking uses, so the column
                      // cannot disagree with the order it sits in.
                      const delta = (s.afterTaxAtLegacy || 0) - (currentScenario.afterTaxAtLegacy || 0);
                      const mc = s.mcResults;
                      const successColor = mc ? (mc.successRate >= 0.9 ? 'text-emerald-400' : mc.successRate >= 0.75 ? 'text-amber-400' : 'text-red-400') : '';
                      return (
                        <tr key={s.label} className={`border-b border-slate-700/50 ${isCurrent ? 'bg-amber-900/20' : isBest ? 'bg-emerald-900/20' : ''}`}>
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
                          <td className="text-right py-2 px-2 text-teal-300">{formatCurrency(s.afterTaxAtLegacy)}</td>
                          {/* Terminal wealth alone cannot separate a plan that ran
                              dry at 78 from one that ran dry at 88 — both end at $0
                              and tie. The age is the decision-relevant part. */}
                          <td className={`text-right py-2 px-2 ${s.depletionAge ? 'text-red-400 font-semibold' : 'text-slate-500'}`}>
                            {s.depletionAge ? `age ${s.depletionAge}` : '—'}
                          </td>
                          <td className="text-right py-2 px-2 text-sky-400">{formatCurrency(s.lifetimeSS)}</td>
                          <td className="text-right py-2 px-2 text-purple-400">{formatCurrency(s.lifetimeTax)}</td>
                          <td className="text-right py-2 px-2 text-orange-400">{formatCurrency(s.lifetimeWithdrawals)}</td>
                          {rothConversionActive && (
                            <td className="text-right py-2 px-2" style={{ color: SERIES.rothConversion }}>{formatCurrency(s.lifetimeRothConversions)}</td>
                          )}
                          <td className="text-right py-2 px-2 text-emerald-400 font-semibold">{formatCurrency(s.netLifetimeWealth)}</td>
                          <td className={`text-right py-2 px-2 font-medium ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                            {isCurrent ? '—' : `${delta >= 0 ? '+' : ''}${formatCurrency(delta)}`}
                          </td>
                          {/* Stages the scenario rather than writing it. Applying
                              still goes through the one Apply button up top, so
                              there is exactly one way the plan gets modified. */}
                          <td className="text-center py-2 px-2">
                            {!isCurrent && (
                              <button
                                onClick={() => {
                                  updateMyClaimAge(s.myClaimAge);
                                  if (s.spClaimAge !== null) updateSpouseClaimAge(s.spClaimAge);
                                  if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className="text-xs text-amber-400 hover:text-amber-300 whitespace-nowrap"
                              >
                                Preview
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

            {isMarried && (
              <Section tab="socialsecurity" id="heatMap" title={<>Portfolio at Age {legacyAge} — Heat Map</>} vis={sectionVisibility} level={detailLevel} setVis={setSectionVisibility}>
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
              </Section>
            )}

            {/* Portfolio Chart */}
            <Section tab="socialsecurity" id="overTime" title={<>Portfolio Value Over Time — Key Scenarios</>} vis={sectionVisibility} level={detailLevel} setVis={setSectionVisibility}>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={portfolioChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={THEME.grid} />
                  <XAxis dataKey="age" stroke={THEME.axis} label={{ value: 'Your Age', position: 'insideBottom', offset: -5, fill: THEME.inkMuted }} />
                  <YAxis stroke={THEME.axis} tickFormatter={v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: THEME.surfaceRaised, border: `1px solid ${THEME.grid}` }} 
                    formatter={(value, name) => [formatCurrency(value), name]} 
                  />
                  <Legend formatter={legendInk} />
                  <ReferenceLine x={personalInfo.myRetirementAge} stroke={THEME.reference} strokeDasharray="5 5" label={{ value: 'Retire', fill: THEME.inkSecondary, fontSize: 11 }} />
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
            </Section>

            {/* Planning Notes */}
            <Section tab="socialsecurity" id="considerations" title={"📝 What to Consider"} vis={sectionVisibility} level={detailLevel} setVis={setSectionVisibility} className={`${cardStyle} bg-slate-800/30`}>
              <div className="space-y-2 text-sm text-slate-400">
                <p>These projections use your actual plan data — tax brackets, withdrawal priority, RMD schedules, Roth conversions, and state taxes are all calculated for each scenario. A few things to keep in mind:</p>
                <p><span className="text-slate-300 font-medium">Taxes are complex:</span> More SS income means more SS is taxable (up to 85%), but it also means fewer withdrawals from tax-deferred accounts, which reduces taxable income from that source. These effects partially offset, which is why the tax differences between scenarios are often smaller than expected.</p>
                <p><span className="text-slate-300 font-medium">Portfolio preservation:</span> Claiming later means drawing down your portfolio faster in the gap years before SS starts. But once the higher benefit kicks in, withdrawals drop and the portfolio recovers — sometimes significantly. The portfolio trajectory chart above shows these crossover dynamics clearly.</p>
                <p><span className="text-slate-300 font-medium">Don't trust a single deterministic answer:</span> The "Analysis Sensitivity Controls" above let you test how the optimal claim age responds to different return assumptions (the CAGR slider) and to sequence-of-returns risk (the Monte Carlo toggle). The optimal age can flip between early and late depending on these. Try ±2% on the CAGR slider before committing to a strategy.</p>
                {isMarried && <p><span className="text-slate-300 font-medium">Survivor benefits matter:</span> {personalInfo.survivorModelEnabled ? 'Your survivor modeling is ON — when the first spouse passes, the survivor inherits the higher SS benefit. This significantly favors the higher earner claiming later.' : '⚠️ Your survivor modeling is currently OFF. Enable it in Personal Info → Survivor Modeling to see how the surviving spouse inheriting the higher SS benefit affects these results — it often changes the optimal strategy.'}</p>}
                {conversionIsActive(personalInfo) && (
                  <p><span className="text-slate-300 font-medium">Roth conversion interaction:</span> Your active Roth conversion strategy is reflected in every scenario. The 'Roth Conv.' column in the ranking table shows lifetime conversion amounts — SS claim age changes how much bracket room you have for cheap conversions. See the conversion total range in the banner above the analysis.</p>
                )}
                <p><span className="text-slate-300 font-medium">Life expectancy uncertainty:</span> These projections assume you live to age {legacyAge}. If longevity is shorter, earlier claiming may win; if longer, delayed claiming becomes increasingly valuable. Adjust the life expectancy slider at the top of the tab to test different assumptions.</p>
              </div>
            </Section>
          </>
        );
      })()}
    </div>
  );
}

// ============================================
// SensitivityTab — Lifted to module scope
// ============================================
function SensitivityTab({ detailLevel, sectionVisibility, setSectionVisibility, accounts, assets, computeProjections, incomeStreams, oneTimeEvents, personalInfo, projections, recurringExpenses }) {
  const retirementAge = personalInfo.myRetirementAge;
  // The plan's last year: the legacy age, or sooner when both life expectancies
  // fall before it, since the projection stops at the last death. Reading a row
  // at an age the projection never reaches put $0 in every figure on this tab.
  const lastRowAge = projections.length ? projections[projections.length - 1].myAge : null;
  const endAge = lastRowAge != null ? Math.min(personalInfo.legacyAge || 95, lastRowAge) : (personalInfo.legacyAge || 95);

  // This year's dollar contribution to an account, in either entry mode. Percent
  // mode stores rates, not dollars, so reading `contribution` alone reports $0 for
  // a percentage saver. Mirrors what computeProjections does with the same fields:
  // employee deferral plus employer match, off the owner's current salary.
  // Reads the engine's own rule rather than re-deriving it. The local version
  // tested `s.owner === owner`, which silently dropped every joint earned-income
  // stream — so a household whose salary is entered as joint saw $0 of
  // contribution on a percent-of-salary account that the projection was funding
  // perfectly well.
  const salaryOf = (owner) => earnedIncomeByOwner(incomeStreams)[owner === 'spouse' ? 'spouse' : 'me'];
  const annualContributionOf = (a) => {
    if (a.contributionMode === 'percent') {
      const salary = a.owner === 'spouse' ? salaryOf('spouse') : salaryOf('me');
      return salary * ((a.employeePercent || 0) + (a.employerMatchPercent || 0));
    }
    return a.contribution || 0;
  };
  const baseRetirementProj = projections.find(p => p.myAge === retirementAge);
  const baseEndProj = projections.find(p => p.myAge === endAge);
  
  const [results, setResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  // Nominal vs today's dollars, mirroring the Monte Carlo tab's control. Real is
  // the default because it is the only valid basis for the inflation lever — each
  // of those scenarios ends in a different currency — but the dashboard reports
  // nominal, so the two tabs disagreed by the deflator with nothing on screen
  // saying so.
  const [showRealDollars, setShowRealDollars] = useState(true);
  const money = (step, key) => showRealDollars ? step[key] : step[key + 'Nominal'];
  const dollarBasis = showRealDollars ? "today's $" : 'future $';

  // Under a withdrawal-led strategy the spending target does nothing, so its
  // lever would draw a flat line. The strategies set by a rate vary that rate
  // instead; the RMD method and VPW have no such knob, so the lever goes.
  const strategyRate = personalInfo.strategyRatePct ?? 0.04;
  const strategyRateLever = ['constant', 'percent', 'vanguard'].includes(PlannerEngine.withdrawalStrategyOf(personalInfo)) ? [{
    id: 'spending',
    label: 'Withdrawal Rate',
    baseLabel: 'Current rate',
    baseValue: strategyRate,
    steps: [-0.01, -0.005, 0, 0.005, 0.01].filter(d => strategyRate + d >= 0.005),
    formatStep: (base, delta) => `${((base + delta) * 100).toFixed(1)}%`,
    formatDelta: (delta) => `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`,
    apply: (delta) => computeProjections({ ...personalInfo, strategyRatePct: strategyRate + delta },
      accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses),
  }] : [];

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
        // One rule for what moves with a retirement age, shared with the
        // dashboard's slider. This used to be open-coded here with a ±1 year
        // tolerance, which quietly caught streams the user had placed two years
        // early and moved them anyway.
        const shifted = planAtRetirementAge(personalInfo, accounts, incomeStreams,
          { myRetirementAge: personalInfo.myRetirementAge + delta });
        return computeProjections(shifted.pi, shifted.accts, shifted.streams,
          assets, oneTimeEvents, recurringExpenses);
      }
    },
    ...(strategyLeadsSpending(personalInfo) ? strategyRateLever : [{
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
    }]),
    {
      id: 'inflation',
      label: 'Inflation Rate',
      baseLabel: 'Current rate',
      baseValue: personalInfo.inflationRate,
      steps: [-0.01, -0.005, 0, 0.005, 0.01],
      formatStep: (base, delta) => `${((base + delta) * 100).toFixed(1)}%`,
      formatDelta: (delta) => `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`,
      // This is the one lever that moves the deflator itself, so each scenario has
      // to be discounted at its OWN rate. Reporting these rows in nominal dollars
      // understated this lever by 2.4x: +1% inflation showed as -19% of ending
      // portfolio when the real purchasing-power loss is -44%, and the tornado
      // chart ranked inflation well below where it belongs as a result.
      scenarioInflation: (delta) => Math.max(0, personalInfo.inflationRate + delta),
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
            // Back the PIA out of the entered benefit rather than assuming the
            // benefit IS the PIA. A stream entered for age 62 is already ~30%
            // reduced; treating it as the FRA figure understated every alternative
            // claiming age this lever tests, always in the same direction.
            const pia = s.pia || inferPiaFromBenefit(s.amount / 12, s.startAge, personalInfo.myBirthYear || (new Date().getFullYear() - personalInfo.myAge));
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
      // Percent-mode accounts keep their rate in employeePercent, so their dollar
      // contribution has to be derived from the owner's salary — otherwise a saver
      // who deferred by percentage showed a $0 base and this whole lever did nothing.
      baseValue: accounts.reduce((sum, a) => sum + annualContributionOf(a), 0),
      steps: [-80000, -60000, -40000, -20000, 0, 20000, 40000, 60000, 80000],
      formatStep: (base, delta) => formatCurrency(base + delta),
      formatDelta: (delta) => `${delta > 0 ? '+' : ''}${formatCurrency(delta)}`,
      apply: (delta) => {
        // This year's IRS limits, from the engine (contributionLimitsFor), so a
        // new year's limits arrive in one place. These are EMPLOYEE limits —
        // employer match is separate and not capped here. Accounts with
        // contributor='employer' or 'both' may exceed them because the combined
        // amount includes employer match. We only cap 'me' contributions.
        const L = PlannerEngine.contributionLimitsFor();
        const plan = { base: L.deferral, catchUp50: L.catchUp50, superCatchUp60: L.catchUp60to63 };
        const plan457 = { base: L.deferral, catchUp50: L.catchUp50, superCatchUp60: 0 };
        const ira = { base: L.ira, catchUp50: L.iraCatchUp, superCatchUp60: 0 };
        const CONTRIBUTION_LIMITS = {
          '401k': plan, 'roth_401k': plan, '403b': plan, 'roth_403b': plan,
          '457b': plan457, 'roth_457b': plan457,
          'traditional_ira': ira, 'roth_ira': ira,
          'hsa':            { base: L.hsaSelf, catchUp55: L.hsaCatchUp55 },  // self-only; family below
          'brokerage':      { base: Infinity } // No limit
        };
        
        const getLimit = (accountType, ownerAge, filingStatus) => {
          const limits = CONTRIBUTION_LIMITS[accountType];
          if (!limits) return Infinity;
          if (accountType === 'hsa') {
            let limit = filingStatus === 'married_joint' ? L.hsaFamily : limits.base;
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
        const totalContrib = accounts.reduce((sum, a) => sum + annualContributionOf(a), 0);
        const modifiedAccounts = accounts.map(a => {
          const current = annualContributionOf(a);
          if (current > 0 && totalContrib > 0) {
            const share = current / totalContrib;
            let newContrib = Math.max(0, current + delta * share);
            
            // Only enforce limits on employee contributions (contributor = 'me')
            // 'employer' and 'both' include match which has its own 415(c) total limit
            if ((a.contributor || 'me') === 'me') {
              const ownerAge = a.owner === 'spouse' ? personalInfo.spouseAge : personalInfo.myAge;
              const limit = getLimit(a.type, ownerAge, personalInfo.filingStatus);
              newContrib = Math.min(newContrib, limit);
            }
            
            // Also pin the account to fixed mode: left in percent mode the engine
            // would recompute from employeePercent and ignore the value we just set.
            return { ...a, contribution: newContrib, contributionMode: 'fixed' };
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
          const atEnd = proj.find(p => p.myAge === endAge) || proj[proj.length - 1];
          const failureAge = proj.find(p => p.myAge >= scenarioRetAge && p.totalPortfolio <= 0);
          
          // Every figure below is reported in TODAY's dollars. The engine returns
          // nominal amounts, and comparing nominal balances across scenarios is
          // only valid while the deflator is held constant — which is exactly
          // what the inflation lever breaks. Each scenario is therefore discounted
          // at its own rate (scenarioInflation), falling back to the plan's rate.
          const scenInflation = variable.scenarioInflation
            ? variable.scenarioInflation(step)
            : (personalInfo.inflationRate || 0);
          const toToday = (amt, atAge) =>
            deflateToToday(amt, personalInfo.myAge, atAge, scenInflation);

          // Lifetime totals discount each year before summing. Adding nominal
          // dollars from age 47 and age 85 together is not a meaningful quantity,
          // and it inflated the later (larger, more-discounted) years the most.
          const lifetimeTax = proj.reduce((sum, p) => sum + toToday(p.totalTax || 0, p.myAge), 0);
          const lifetimeWithdrawals = proj.filter(p => p.myAge >= scenarioRetAge)
            .reduce((sum, p) => sum + toToday(p.portfolioWithdrawal || 0, p.myAge), 0);

          return {
            delta,
            step,
            label: variable.formatStep(variable.baseValue, step),
            deltaLabel: variable.formatDelta(step),
            isBase,
            scenarioInflation: scenInflation,
            portfolioAtRetirement: toToday(atRetirement?.totalPortfolio || 0, scenarioRetAge),
            portfolioAtEnd: toToday(atEnd?.totalPortfolio || 0, atEnd ? atEnd.myAge : endAge),
            // Both currencies are carried so the toggle never re-runs the sweep —
            // and so the nominal figures can be reconciled against the dashboard,
            // which reports nominal. A user comparing the two tabs sees a ~3x gap
            // at a 39-year horizon and has no way to tell it is the deflator.
            portfolioAtRetirementNominal: atRetirement?.totalPortfolio || 0,
            portfolioAtEndNominal: atEnd?.totalPortfolio || 0,
            lifetimeTaxNominal: proj.reduce((sum, p) => sum + (p.totalTax || 0), 0),
            survives: !failureAge,
            failureAge: failureAge?.myAge || null,
            lifetimeTax,
            lifetimeWithdrawals,
            netIncomeAtRetirement: toToday(atRetirement?.netIncome || 0, scenarioRetAge)
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
      <BasisLabel pi={personalInfo} />
      <SectionControls tab="sensitivity" vis={sectionVisibility} setVis={setSectionVisibility}
                       level={detailLevel} />
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
          {strategyLeadsSpending(personalInfo) ? (
          <div>
            <div className="text-xs text-slate-500">Spending</div>
            <div className="text-sm font-bold text-slate-200">Set by {strategyLabelOf(personalInfo)}</div>
          </div>
          ) : (
          <div>
            <div className="text-xs text-slate-500">Spending Goal (today&rsquo;s $)</div>
            <div className="text-lg font-bold text-slate-200">{formatCurrency(personalInfo.desiredRetirementIncome)}/yr</div>
          </div>
          )}
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
          {/* Which currency every figure below is quoted in. This was previously a
              caption in the smallest muted type on the page, above a table whose
              whole content is dollar amounts — so the tab silently disagreed with
              the dashboard by the deflator (a factor of ~3 over a 39-year horizon)
              and the explanation was the easiest thing on screen to miss. */}
          <div className={cardStyle}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={showRealDollars}
                  onChange={e => setShowRealDollars(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/50"
                />
                <span title="The inflation scenarios each end in a different currency, so their raw future-dollar balances are not comparable with one another. Deflating every scenario by its own rate makes them comparable and puts them in money you can judge today.">
                  Show in today's dollars
                </span>
              </label>
              <p className="text-xs text-slate-500 max-w-xl">
                {showRealDollars
                  ? <>Every figure on this tab is in <span className="text-slate-300">today's dollars</span>. The Dashboard quotes the same balances in <span className="text-slate-300">future (nominal) dollars</span>, so it will read higher — by {(() => {
                      const yrs = Math.max(0, endAge - personalInfo.myAge);
                      const f = Math.pow(1 + (personalInfo.inflationRate || 0), yrs);
                      return `${f.toFixed(1)}\u00d7 at age ${endAge}`;
                    })()}. Untick to compare the two directly.</>
                  : <>Every figure on this tab is in <span className="text-slate-300">future (nominal) dollars</span>, matching the Dashboard. Inflation scenarios are not comparable with each other on this basis — tick the box to put them in one currency.</>}
              </p>
            </div>
          </div>

          <HideableBlock tab="sensitivity" id="ranking" level={detailLevel}
                         vis={sectionVisibility} setVis={setSectionVisibility}>
            {/* Tornado chart: which variables matter most */}
            <div className={cardStyle}>
              <h4 className="text-lg font-semibold text-slate-200 mb-2">Impact Ranking: Which Variables Matter Most?</h4>
              <p className="text-xs text-slate-500 mb-4">Shows the range of ending portfolio values, in {dollarBasis === "today's $" ? "today's dollars" : 'future (nominal) dollars'}, when each variable is adjusted to its minimum and maximum test values. Wider bars = your plan is more sensitive to that variable.</p>
            
              {(() => {
                // Build tornado data: for each variable, get the min and max portfolio-at-end
                const basePortfolio = money(results[0]?.stepResults.find(s => s.isBase) || {}, 'portfolioAtEnd') || 0;
                const tornadoData = results.map(variable => {
                  const portfolios = variable.stepResults.map(s => money(s, 'portfolioAtEnd'));
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
                      <div className="flex-1 flex text-[10px] text-slate-500">
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
          </HideableBlock>
          
          <HideableBlock tab="sensitivity" id="perVariable" level={detailLevel}
                         vis={sectionVisibility} setVis={setSectionVisibility}>
            {/* Detailed results per variable */}
            {results.map((variable, varIdx) => (
              <div key={variable.id} className={cardStyle}>
                <h4 className="text-lg font-semibold text-slate-200 mb-1">{variable.label}</h4>
                <p className="text-xs text-slate-500 mb-3">
                  Base: {variable.formatStep(variable.baseValue, 0)} · all dollar figures in {showRealDollars ? "today's dollars" : 'future (nominal) dollars'}
                  {!showRealDollars && variable.scenarioInflation && (
                    <span className="text-amber-400"> · these scenarios each end in a DIFFERENT currency, so compare them in today's dollars instead</span>
                  )}
                </p>
              
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700/50">
                        <th className="text-left py-2 px-3 text-slate-400 font-medium">Scenario</th>
                        <th className="text-right py-2 px-3 text-slate-400 font-medium">Portfolio at {retirementAge}<span className="block text-[10px] font-normal text-slate-500">{dollarBasis}</span></th>
                        <th className="text-right py-2 px-3 text-slate-400 font-medium">Portfolio at {endAge}<span className="block text-[10px] font-normal text-slate-500">{dollarBasis}</span></th>
                        <th className="text-right py-2 px-3 text-slate-400 font-medium">vs Base</th>
                        <th className="text-center py-2 px-3 text-slate-400 font-medium">Survives?</th>
                        <th className="text-right py-2 px-3 text-slate-400 font-medium">Lifetime Tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variable.stepResults.map((step, stepIdx) => {
                        const baseStep = variable.stepResults.find(s => s.isBase);
                        const baseEnd = (baseStep ? money(baseStep, 'portfolioAtEnd') : 0) || 0;
                        const stepEnd = money(step, 'portfolioAtEnd');
                        const diff = stepEnd - baseEnd;
                      
                        return (
                          <tr key={stepIdx} className={`border-b border-slate-800/50 ${step.isBase ? 'bg-amber-500/10' : ''} ${getImpactBg(stepEnd, baseEnd)}`}>
                            <td className="py-2 px-3">
                              <span className={`font-medium ${step.isBase ? 'text-amber-400' : 'text-slate-200'}`}>
                                {step.label}
                              </span>
                              {step.isBase && <span className="text-amber-500 text-xs ml-2">◆ Current</span>}
                              {!step.isBase && <span className="text-slate-500 text-xs ml-2">({step.deltaLabel})</span>}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-300">{formatCurrency(money(step, 'portfolioAtRetirement'))}</td>
                            <td className={`py-2 px-3 text-right font-medium ${getImpactColor(stepEnd, baseEnd)}`}>
                              {formatCurrency(stepEnd)}
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
                            <td className="py-2 px-3 text-right text-slate-400">{formatCurrency(money(step, 'lifetimeTax'))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </HideableBlock>
          
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

