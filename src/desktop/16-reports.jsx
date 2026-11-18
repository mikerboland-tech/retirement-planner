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

  // Taxable income after the federal deduction — the basis the federal brackets
  // and the LTCG 0% threshold are measured against. Uses the engine's own
  // deduction (standard + any age-65 amounts) so the headroom advice below
  // matches the tax the plan actually computed.
  const brackets = (FEDERAL_TAX_BRACKETS_2026 && (FEDERAL_TAX_BRACKETS_2026[fs] || FEDERAL_TAX_BRACKETS_2026.married_joint)) || null;
  const stdDed = y.federalDeduction
    ?? ((STANDARD_DEDUCTION_2026 && (STANDARD_DEDUCTION_2026[fs] || STANDARD_DEDUCTION_2026.married_joint)) || 0);
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

  // 5b. IRMAA BEFORE Medicare age. irmaaInfo is only populated once someone is
  // actually paying a premium, so the warning above cannot fire for the years
  // that decide it. Because of the two-year lookback, the MAGI reported at 63
  // sets the surcharge paid at 65 — which makes 63 the first year a conversion
  // or a large withdrawal can cost IRMAA at all, and 62 the last year one is
  // free. Those are the years the decision is still open, and until now nothing
  // on the dashboard said so at any age below 65.
  else if (y.magi > 0) {
    const lookback = IRMAA_TIER_LOOKBACK_YEARS || 2;
    const age = y.myAge;
    const paysAt = irmaaChargedAtAge(age);
    const lastFree = irmaaLastFreeAge();
    // The window worth flagging: the first year that sets a surcharge through
    // the year before Medicare starts. Earlier than that and the income never
    // reaches a lookback at all. Both boundaries are derived from the engine's
    // constants rather than typed, so a change to either moves this with it.
    if (paysAt >= MEDICARE_ELIGIBILITY_AGE && age < MEDICARE_ELIGIBILITY_AGE) {
      // Thresholds are indexed to the year the surcharge is PAID, not the year
      // the income is earned — CMS applies the premium year's brackets to the
      // MAGI from two years prior. Same convention as irmaaTierCeiling.
      const edge = nextIRMAAThreshold(y.magi, fs, (y.year - BASE_TAX_YEAR) + lookback,
                                     (personalInfo && personalInfo.inflationRate) || 0.03);
      if (edge && isFinite(edge.distance) && edge.distance > 0) {
        actions.push({
          id: 'irmaa-lookback', severity: 'warn',
          title: `This year's income sets your Medicare premium at ${paysAt}`,
          amount: fmt(edge.distance),
          detail: `Medicare looks back ${lookback} years, so the MAGI you report at ${age} decides the IRMAA surcharge you pay at ${paysAt}. Your projected MAGI is ${fmt(y.magi)} — adding more than ${fmt(edge.distance)} would cross the next tier. See Marginal Tax Impact & IRMAA on the Taxes & Roth tab.`,
        });
      }
    } else if (age === lastFree) {
      // The last year entirely invisible to IRMAA. Worth saying out loud,
      // because it is the cheapest year in the plan to realise income and the
      // only signal that it is about to end.
      actions.push({
        id: 'irmaa-free-year', severity: 'info',
        title: 'The last year your income is invisible to IRMAA',
        detail: `Medicare's ${lookback}-year lookback means income realised this year (age ${age}) never reaches an IRMAA calculation. From next year on it does. If a Roth conversion is on the table, this is the cheapest year in the plan to do it.`,
      });
    }
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
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
            Figures come from your plan&rsquo;s projection for {currentYear}
            {personalInfo.useDetailedCurrentYear
              ? ', which uses the paycheck and K-1 figures from the Current Year tab.'
              : '. The Current Year tab can build this year from your actual paychecks and K-1s instead.'}
          </p>
          <ReportBasisLine pi={personalInfo} follows={true} />
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

        {/* The thresholds themselves, on the printed page. The action list says
            what to do; this says where the edges are, which is what makes a
            mid-year decision checkable against a statement without reopening
            the app. Print styling only — no chips, no toggles, no selector. */}
        <div style={{ marginTop: 28, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
          <TaxBreakpointsTable
            projections={projections}
            personalInfo={personalInfo}
            fixedAge={personalInfo.myAge}
            forPrint={true}
            title={`Income thresholds for ${currentYear}`}
          />
        </div>

        <p style={{ fontSize: 11, color: '#64748b', marginTop: 24, lineHeight: 1.5, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          This report is a directional planning tool generated from the assumptions in your plan, not tax or
          investment advice. Figures are estimates from the plan's projection, using the tax figures the IRS
          has published for the year (later years grown at the indexes the law uses). Confirm amounts and
          deadlines with a qualified professional before acting.
        </p>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}

// ============================================
// Plan Summary Report — full printable snapshot of the plan: profile,
// key outcomes, accounts, income, strategy, and the year-by-year projection.
// Uses the same portal + print CSS plumbing as NextYearReport (#report-print).
// ============================================
function PlanSummaryReport({ projections, personalInfo, accounts, incomeStreams, assets, onClose }) {
  const pi = personalInfo;
  const preparedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const isMarried = pi.hasSpouse || pi.filingStatus === 'married_joint' || pi.filingStatus === 'married_separate';

  const rows = projections || [];
  const retirementRow = rows.find(p => p.myAge === pi.myRetirementAge);
  const lastRow = rows[rows.length - 1];
  const depletionRow = rows.find(p => p.myAge >= pi.myRetirementAge && p.totalPortfolio <= 0);
  const lifetimeTax = rows.reduce((s, p) => s + (p.totalTax || 0), 0);
  const lifetimeIRMAA = rows.reduce((s, p) => s + (p.irmaaSurcharge || 0), 0);
  const lifetimeConversions = rows.reduce((s, p) => s + (p.rothConversion || 0), 0);

  const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
  const fmtK = (n) => (n >= 1000000 ? '$' + (n / 1000000).toFixed(2) + 'M' : '$' + Math.round((n || 0) / 1000) + 'K');
  const typeLabel = (list, v) => (list.find(t => t.value === v)?.label) || v;
  const ownerLabel = (o) => o === 'spouse' ? 'Spouse' : o === 'joint' ? 'Joint' : 'Me';
  const contribLabel = (a) => a.contributionMode === 'percent'
    ? `${(((a.employeePercent || 0) + (a.employerMatchPercent || 0)) * 100).toFixed(1)}% of salary`
    : fmt(a.contribution) + '/yr';

  const th = { textAlign: 'left', padding: '4px 8px', borderBottom: '2px solid #0f172a', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#334155' };
  const thR = { ...th, textAlign: 'right' };
  const td = { padding: '4px 8px', borderBottom: '1px solid #e2e8f0', fontSize: 12 };
  const tdR = { ...td, textAlign: 'right' };
  const h2 = { fontSize: 16, fontWeight: 700, margin: '22px 0 8px', paddingBottom: 4, borderBottom: '1px solid #cbd5e1', breakAfter: 'avoid' };
  const statBox = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px' };
  const statLabel = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', margin: 0 };
  const statValue = { fontSize: 17, fontWeight: 700, margin: '2px 0 0' };

  const priorityLabels = { pretax: 'Pre-Tax', brokerage: 'Brokerage & HSA', roth: 'Roth' };
  const priority = (pi.withdrawalBracketFill ? `Pre-Tax to the top of the ${pi.withdrawalBracketFill} bracket, then ` : '')
    + (pi.withdrawalPriority || ['pretax', 'brokerage', 'roth']).map(k => priorityLabels[k] || k).join(' → ');
  // Three modes to describe. Testing for a bracket and then an amount reported
  // "None planned" for an IRMAA-tier strategy — while the Key Outcomes section
  // of the same report correctly showed $1.3M converted, because that reads the
  // projection rather than re-deriving the mode. A report contradicting itself
  // on the same page is worse than either half being wrong alone.
  const rothStrategy = conversionIsActive(pi)
    ? conversionModeLabel(pi).replace(/^filling to the/, 'Fill the').replace(/^staying under/, 'Stay under')
    : 'None planned';
  // The same list the Assumptions tab shows (engine planAssumptions).
  const assumptions = PlannerEngine.planAssumptions(pi, accounts || []);

  const overlay = (
    <div className="report-overlay fixed inset-0 bg-black/60 flex items-start justify-center z-50 overflow-y-auto py-8 px-4">
      <div id="report-print" style={{ background: '#ffffff', color: '#0f172a' }} className="w-full max-w-4xl rounded-xl shadow-2xl p-8">
        <div className="print-hide flex justify-end gap-2 mb-6">
          <button onClick={() => window.print()} className={buttonPrimary}>Print / Save as PDF</button>
          <button onClick={onClose} className={buttonSecondary}>Close</button>
        </div>

        <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 12, marginBottom: 16 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Retirement Plan Summary</h1>
          <p style={{ fontSize: 14, color: '#475569', margin: '4px 0 0' }}>Prepared {preparedOn}</p>
          <ReportBasisLine pi={pi} follows={true} />
        </div>

        <h2 style={h2}>Plan Profile</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          <div style={statBox}><p style={statLabel}>My Age / Retire At</p><p style={statValue}>{pi.myAge} / {pi.myRetirementAge}</p></div>
          {isMarried && <div style={statBox}><p style={statLabel}>Spouse Age / Retire At</p><p style={statValue}>{pi.spouseAge} / {pi.spouseRetirementAge}</p></div>}
          <div style={statBox}><p style={statLabel}>Filing / State</p><p style={{ ...statValue, fontSize: 14 }}>{(pi.filingStatus || '').replace(/_/g, ' ')} · {pi.state}</p></div>
          {strategyLeadsSpending(pi)
            ? <div style={statBox}><p style={statLabel}>Withdrawal Strategy</p><p style={{ ...statValue, fontSize: 12 }}>{strategyLabelOf(pi)}</p></div>
            : <div style={statBox}><p style={statLabel}>{PlannerEngine.withdrawalStrategyOf(pi) === 'guardrails' ? 'Spending (with guardrails)' : 'Desired Spending'}</p><p style={statValue}>{fmt(pi.desiredRetirementIncome)}/yr</p></div>}
          <div style={statBox}><p style={statLabel}>Inflation Assumption</p><p style={statValue}>{((pi.inflationRate || 0) * 100).toFixed(1)}%</p></div>
          <div style={statBox}><p style={statLabel}>Planning Horizon</p><p style={statValue}>Age {pi.legacyAge || 95}</p></div>
          <div style={statBox}><p style={statLabel}>Withdrawal Order</p><p style={{ ...statValue, fontSize: 12 }}>{priority}</p></div>
          <div style={statBox}><p style={statLabel}>Roth Conversions</p><p style={{ ...statValue, fontSize: 12 }}>{rothStrategy}</p></div>
        </div>

        <h2 style={h2}>Key Outcomes</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {retirementRow && <div style={statBox}><p style={statLabel}>Portfolio at Retirement</p><p style={statValue}>{fmtK(retirementRow.totalPortfolio)}</p></div>}
          {lastRow && <div style={statBox}><p style={statLabel}>Portfolio at Age {lastRow.myAge}</p><p style={statValue}>{fmtK(lastRow.totalPortfolio)}</p></div>}
          <div style={statBox}><p style={statLabel}>Money Lasts</p><p style={{ ...statValue, color: depletionRow ? '#dc2626' : '#059669' }}>{depletionRow ? `Depletes at ${depletionRow.myAge}` : 'Full horizon ✓'}</p></div>
          <div style={statBox}><p style={statLabel}>Lifetime Taxes</p><p style={statValue}>{fmtK(lifetimeTax)}</p></div>
          <div style={statBox}><p style={statLabel}>Lifetime IRMAA</p><p style={statValue}>{fmtK(lifetimeIRMAA)}</p></div>
          {lifetimeConversions > 0 && <div style={statBox}><p style={statLabel}>Total Roth Converted</p><p style={statValue}>{fmtK(lifetimeConversions)}</p></div>}
        </div>

        <h2 style={h2}>What the Plan Assumes</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }} data-report-assumptions>
          <tbody>
            {assumptions.map((a, i) => (
              <React.Fragment key={a.group + a.label}>
                {(i === 0 || assumptions[i - 1].group !== a.group) && (
                  <tr><td colSpan={3} style={{ ...td, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#334155', paddingTop: 10 }}>{a.group}</td></tr>
                )}
                <tr style={{ breakInside: 'avoid' }}>
                  <td style={{ ...td, width: '20%', color: '#475569' }}>{a.label}</td>
                  <td style={{ ...td, width: '28%', fontWeight: 600 }}>{a.value}</td>
                  <td style={{ ...td, fontSize: 11, color: '#475569' }}>{a.note}{a.source ? <span style={{ color: '#94a3b8' }}> Source: {a.source}.</span> : null}</td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>

        <h2 style={h2}>Investment Accounts</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Account</th><th style={th}>Type</th><th style={th}>Owner</th><th style={thR}>Balance</th><th style={thR}>Contribution</th><th style={thR}>Growth</th></tr></thead>
          <tbody>
            {(accounts || []).map(a => (
              <tr key={a.id}>
                <td style={td}>{a.name}</td>
                <td style={td}>{typeLabel(ACCOUNT_TYPES, a.type)}</td>
                <td style={td}>{ownerLabel(a.owner)}</td>
                <td style={tdR}>{fmt(a.balance)}</td>
                <td style={tdR}>{contribLabel(a)}</td>
                <td style={tdR}>{((a.cagr || 0) * 100).toFixed(1)}%</td>
              </tr>
            ))}
            <tr><td style={{ ...td, fontWeight: 700 }} colSpan={3}>Total</td><td style={{ ...tdR, fontWeight: 700 }}>{fmt((accounts || []).reduce((s, a) => s + (a.balance || 0), 0))}</td><td style={td} colSpan={2}></td></tr>
          </tbody>
        </table>

        <h2 style={h2}>Income Streams</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Income</th><th style={th}>Type</th><th style={th}>Owner</th><th style={thR}>Annual Amount</th><th style={thR}>COLA</th><th style={thR}>Ages</th></tr></thead>
          <tbody>
            {(incomeStreams || []).map(s => (
              <tr key={s.id}>
                <td style={td}>{s.name}</td>
                <td style={td}>{typeLabel(INCOME_TYPES, s.type)}</td>
                <td style={td}>{ownerLabel(s.owner)}</td>
                <td style={tdR}>{fmt(s.amount)}</td>
                <td style={tdR}>{((s.cola || 0) * 100).toFixed(1)}%</td>
                <td style={tdR}>{s.startAge}–{s.endAge}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {(assets || []).length > 0 && (<>
          <h2 style={h2}>Non-Liquid Assets</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Asset</th><th style={thR}>Value</th><th style={thR}>Debt</th><th style={thR}>Equity</th></tr></thead>
            <tbody>
              {assets.map(a => (
                <tr key={a.id}>
                  <td style={td}>{a.name}</td>
                  <td style={tdR}>{fmt(a.value)}</td>
                  <td style={tdR}>{fmt(a.mortgage || 0)}</td>
                  <td style={tdR}>{fmt((a.value || 0) - (a.mortgage || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>)}

        <h2 style={h2}>Year-by-Year Projection</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Year</th><th style={th}>Age{isMarried ? 's' : ''}</th>
              <th style={thR}>Gross Income</th><th style={thR}>Taxes</th><th style={thR}>RMD</th>
              <th style={thR}>Roth Conv.</th><th style={thR}>Healthcare</th><th style={thR}>End Portfolio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.year} style={p.myAge === pi.myRetirementAge ? { background: '#fef3c7' } : undefined}>
                <td style={td}>{p.year}</td>
                <td style={td}>{p.myAge}{isMarried && p.spouseAge != null ? ` / ${p.spouseAge}` : ''}</td>
                <td style={tdR}>{fmt(p.totalIncome)}</td>
                <td style={tdR}>{fmt(p.totalTax)}</td>
                <td style={tdR}>{p.rmd > 0 ? fmt(p.rmd) : '—'}</td>
                <td style={tdR}>{p.rothConversion > 0 ? fmt(p.rothConversion) : '—'}</td>
                <td style={tdR}>{fmt(p.healthcareExpense)}</td>
                <td style={tdR}>{fmt(p.totalPortfolio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 10, color: '#94a3b8', margin: '6px 0 0' }}>Highlighted row = first retirement year. All figures are nominal (future) dollars.</p>

        <p style={{ fontSize: 11, color: '#64748b', marginTop: 24, lineHeight: 1.5, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          This report is a directional planning tool generated from the assumptions in your plan, not tax or
          investment advice. Projections use the official {PlannerEngine.LATEST_PUBLISHED_TAX_YEAR - 1} and {PlannerEngine.LATEST_PUBLISHED_TAX_YEAR} tax
          figures, grown after that at the indexes the law uses, and the assumptions listed above; actual results
          will differ. Confirm decisions with a qualified professional.
        </p>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}

// ============================================
// The Survivor's Tax Bill — what the widow(er) year costs.
//
// When the first spouse dies, the survivor files jointly for that year and as a
// SINGLE filer from the next one. Every threshold governing their tax roughly
// halves at once — bracket edges, the standard deduction, the IRMAA tiers, the
// NIIT floor — while income barely falls, because the survivor keeps the larger
// Social Security benefit and the entire portfolio. Two brackets and an IRMAA
// tier higher on a household whose SPENDING just went down.
//
// The engine has always switched filing status on death; nothing ever showed
// what the switch costs. Same portal + print plumbing as the other reports.
// ============================================
function SurvivorTaxReport({ projections, personalInfo, incomeStreams, onClose }) {
  const pi = personalInfo;
  const preparedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
  const fmtK = (n) => (Math.abs(n) >= 1000000 ? '$' + (n / 1000000).toFixed(2) + 'M' : '$' + Math.round((n || 0) / 1000) + 'K');
  const pct = (n) => (n * 100).toFixed(0) + '%';

  // One comparison per projection year. survivorTaxComparison returns null for a
  // year that is not married-filing-jointly, which quietly excludes both a single
  // filer's whole plan and — when survivor modeling is on — the years after the
  // modeled death, where the projection is ALREADY single and there is nothing
  // left to compare.
  const rows = useMemo(() => (projections || [])
    .map(r => survivorTaxComparison({ row: r, pi, streams: incomeStreams }))
    .filter(Boolean), [projections, pi, incomeStreams]);

  const th = { textAlign: 'left', padding: '4px 8px', borderBottom: '2px solid #0f172a', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#334155' };
  const thR = { ...th, textAlign: 'right' };
  const td = { padding: '4px 8px', borderBottom: '1px solid #e2e8f0', fontSize: 12 };
  const tdR = { ...td, textAlign: 'right' };
  const h2 = { fontSize: 16, fontWeight: 700, margin: '22px 0 8px', paddingBottom: 4, borderBottom: '1px solid #cbd5e1', breakAfter: 'avoid' };
  const statBox = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px' };
  const statLabel = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', margin: 0 };
  const statValue = { fontSize: 17, fontWeight: 700, margin: '2px 0 0' };
  const note = { fontSize: 11, color: '#64748b', margin: '6px 0 0', lineHeight: 1.5 };

  // The worst year is the report's anchor. Chosen on TODAY'S dollars, not
  // nominal ones: at 2.5% inflation a nominal comparison picks the last year of
  // the plan almost every time, which makes "worst year" a synonym for "age 94"
  // and tells the reader nothing. Deflating puts the anchor where the halved
  // thresholds actually bite hardest — usually a peak-RMD year, which is the
  // point, since the survivor inherits the RMD schedule with the portfolio.
  const infl = pi.inflationRate ?? 0.03;
  const thisYear = new Date().getFullYear();
  const real = (n, year) => (n || 0) / Math.pow(1 + infl, Math.max(0, year - thisYear));
  const worst = rows.reduce(
    (a, b) => (!a || real(b.filingPenalty, b.year) > real(a.filingPenalty, a.year) ? b : a), null);
  const firstJump = rows.find(r => r.bracketJumped);
  const firstIrmaaJump = rows.find(r => r.irmaaTierJumped);
  const lifetimePenalty = rows.reduce((s, r) => s + r.filingPenalty, 0);
  const lifetimePenaltyReal = rows.reduce((s, r) => s + real(r.filingPenalty, r.year), 0);
  const avgPenaltyReal = rows.length ? lifetimePenaltyReal / rows.length : 0;
  // Only the anchor year's caveat matters — a plan can know the split in the
  // years that count and not in the ones before either benefit started.
  const assumedSplit = !!(worst && worst.lostSSAssumed);
  // The projection row behind the anchor year, for the figures the comparison
  // does not carry (gross Social Security received).
  const worstRow = worst ? (projections || []).find(p => p.year === worst.year) || {} : {};

  // What the thresholds themselves do, priced in the anchor year's dollars.
  // Deduction comes from the engine so the 65+ and OBBBA senior pieces are the
  // real ones rather than a flat halving; the rest are genuinely halved.
  const thresholdRows = useMemo(() => {
    if (!worst) return [];
    const idx = worst.year - BASE_TAX_YEAR;
    const infl = pi.inflationRate ?? 0.03;
    const scale = indexTo(1, idx, infl);
    const bracket22 = (FEDERAL_TAX_BRACKETS_2026 || {});
    const edgeOf = (status, rate) => {
      const list = bracket22[status] || [];
      const b = list.find(x => x.rate === rate);
      return b && Number.isFinite(b.max) ? b.max * scale : null;
    };
    // The base tier's ceiling: the first MAGI figure that, once exceeded, starts
    // costing a surcharge. Halving THAT is what puts a survivor into IRMAA on
    // income the couple carried surcharge-free.
    const irmaaEdge = (status) => {
      const list = (IRMAA_THRESHOLDS_2025 || {})[status] || [];
      return list.length && Number.isFinite(list[0].maxIncome) ? list[0].maxIncome * scale : null;
    };
    const out = [
      { label: 'Standard deduction (incl. age 65+ add-on)', joint: worst.joint.deduction, single: worst.filingStatusOnly.deduction },
      { label: 'Top of the 22% bracket (taxable income)', joint: edgeOf('married_joint', 0.22), single: edgeOf('single', 0.22) },
      { label: 'Top of the 24% bracket (taxable income)', joint: edgeOf('married_joint', 0.24), single: edgeOf('single', 0.24) },
      { label: 'First IRMAA surcharge tier (MAGI)', joint: irmaaEdge('married_joint'), single: irmaaEdge('single') },
      { label: 'Net investment income tax floor (MAGI)', joint: (NIIT_THRESHOLDS || {}).married_joint, single: (NIIT_THRESHOLDS || {}).single },
    ];
    return out.filter(r => r.joint != null && r.single != null);
  }, [worst, pi.inflationRate]);

  const overlay = (
    <div className="report-overlay fixed inset-0 bg-black/60 flex items-start justify-center z-50 overflow-y-auto py-8 px-4">
      <div id="report-print" style={{ background: '#ffffff', color: '#0f172a' }} className="w-full max-w-4xl rounded-xl shadow-2xl p-8">
        <div className="print-hide flex justify-end gap-2 mb-6">
          <button onClick={() => window.print()} className={buttonPrimary}>Print / Save as PDF</button>
          <button onClick={onClose} className={buttonSecondary}>Close</button>
        </div>

        <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 12, marginBottom: 16 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>The Survivor's Tax Bill</h1>
          <p style={{ fontSize: 14, color: '#475569', margin: '4px 0 0' }}>
            What filing single costs the spouse left behind &nbsp;·&nbsp; Prepared {preparedOn}
          </p>
          <ReportBasisLine pi={pi} follows={false} />
        </div>

        {rows.length === 0 ? (
          <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6 }}>
            This report compares a married couple's tax bill with what the surviving spouse would pay
            filing as a single taxpayer. Your plan does not have any married-filing-jointly years to
            compare — either you file as a single taxpayer, or survivor modeling has already moved the
            projection to a single filer for its whole length.
          </p>
        ) : (<>

        <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, margin: '0 0 4px' }}>
          At the first death the survivor files jointly for that year, then as a <strong>single</strong> taxpayer
          for every year after. Almost every number that governs their tax roughly halves at once — the
          standard deduction, the bracket edges, the IRMAA tiers, the investment-income surtax floor.
          Income barely moves, because the survivor keeps the larger Social Security benefit and the entire
          portfolio, with the same required distributions. The result is a higher tax bill on a household
          that is now spending less.
        </p>

        <h2 style={h2}>The Cost, Year by Year</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          <div style={statBox}>
            <p style={statLabel}>Worst Year</p>
            <p style={{ ...statValue, color: '#dc2626' }}>{fmt(worst.filingPenalty)}</p>
            <p style={{ ...note, marginTop: 0 }}>
              extra tax in {worst.year}, at age {worst.myAge} &middot; {fmt(real(worst.filingPenalty, worst.year))} in today's dollars
            </p>
          </div>
          <div style={statBox}>
            <p style={statLabel}>Typical Year</p>
            <p style={statValue}>{fmt(avgPenaltyReal)}</p>
            <p style={{ ...note, marginTop: 0 }}>
              average across {rows.length} joint years, in today's dollars
            </p>
          </div>
          <div style={statBox}>
            <p style={statLabel}>First Bracket Jump</p>
            <p style={statValue}>{firstJump ? `${firstJump.year} (age ${firstJump.myAge})` : 'None'}</p>
            <p style={{ ...note, marginTop: 0 }}>
              {firstJump ? `${pct(firstJump.joint.bracket)} → ${pct(firstJump.filingStatusOnly.bracket)}` : 'same bracket throughout'}
            </p>
          </div>
          <div style={statBox}>
            <p style={statLabel}>First IRMAA Tier Jump</p>
            <p style={statValue}>{firstIrmaaJump ? `${firstIrmaaJump.year} (age ${firstIrmaaJump.myAge})` : 'None'}</p>
            <p style={{ ...note, marginTop: 0 }}>
              {firstIrmaaJump
                ? `tier ${firstIrmaaJump.joint.irmaaTier} → ${firstIrmaaJump.filingStatusOnly.irmaaTier}`
                : 'no Medicare surcharge change'}
            </p>
          </div>
        </div>

        <h2 style={h2}>Side by Side — {worst.year}, the Worst Year</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Same year, three ways</th>
              <th style={thR}>Married, both living</th>
              <th style={thR}>Survivor, same income</th>
              <th style={thR}>Survivor, realistic</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={td}>Social Security received</td>
              <td style={tdR}>{fmt(worstRow.socialSecurity)}</td>
              <td style={tdR}>{fmt(worstRow.socialSecurity)}</td>
              <td style={tdR}>{fmt(Math.max(0, (worstRow.socialSecurity || 0) - worst.lostSS))}</td>
            </tr>
            <tr>
              <td style={td}>Adjusted gross income</td>
              <td style={tdR}>{fmt(worst.joint.agi)}</td>
              <td style={tdR}>{fmt(worst.filingStatusOnly.agi)}</td>
              <td style={tdR}>{fmt(worst.survivorRealistic.agi)}</td>
            </tr>
            <tr>
              <td style={td}>Standard deduction</td>
              <td style={tdR}>{fmt(worst.joint.deduction)}</td>
              <td style={tdR}>{fmt(worst.filingStatusOnly.deduction)}</td>
              <td style={tdR}>{fmt(worst.survivorRealistic.deduction)}</td>
            </tr>
            <tr>
              <td style={td}>Top marginal bracket</td>
              <td style={tdR}>{pct(worst.joint.bracket)}</td>
              <td style={{ ...tdR, color: worst.bracketJumped ? '#dc2626' : undefined, fontWeight: worst.bracketJumped ? 700 : undefined }}>{pct(worst.filingStatusOnly.bracket)}</td>
              <td style={tdR}>{pct(worst.survivorRealistic.bracket)}</td>
            </tr>
            <tr>
              <td style={td}>Federal income tax</td>
              <td style={tdR}>{fmt(worst.joint.federal)}</td>
              <td style={tdR}>{fmt(worst.filingStatusOnly.federal)}</td>
              <td style={tdR}>{fmt(worst.survivorRealistic.federal)}</td>
            </tr>
            <tr>
              <td style={td}>State income tax</td>
              <td style={tdR}>{fmt(worst.joint.stateTax)}</td>
              <td style={tdR}>{fmt(worst.filingStatusOnly.stateTax)}</td>
              <td style={tdR}>{fmt(worst.survivorRealistic.stateTax)}</td>
            </tr>
            <tr>
              <td style={td}>Medicare IRMAA surcharge</td>
              <td style={tdR}>{fmt(worst.joint.irmaa)}</td>
              <td style={{ ...tdR, color: worst.irmaaTierJumped ? '#dc2626' : undefined, fontWeight: worst.irmaaTierJumped ? 700 : undefined }}>{fmt(worst.filingStatusOnly.irmaa)}</td>
              <td style={tdR}>{fmt(worst.survivorRealistic.irmaa)}</td>
            </tr>
            <tr style={{ background: '#f8fafc' }}>
              <td style={{ ...td, fontWeight: 700 }}>Total tax</td>
              <td style={{ ...tdR, fontWeight: 700 }}>{fmt(worst.joint.total)}</td>
              <td style={{ ...tdR, fontWeight: 700, color: '#dc2626' }}>{fmt(worst.filingStatusOnly.total)}</td>
              <td style={{ ...tdR, fontWeight: 700 }}>{fmt(worst.survivorRealistic.total)}</td>
            </tr>
            <tr>
              <td style={{ ...td, fontWeight: 700 }}>Difference vs. filing jointly</td>
              <td style={tdR}>—</td>
              <td style={{ ...tdR, fontWeight: 700, color: '#dc2626' }}>+{fmt(worst.filingPenalty)}</td>
              <td style={{ ...tdR, fontWeight: 700, color: '#dc2626' }}>+{fmt(worst.realisticDelta)}</td>
            </tr>
          </tbody>
        </table>
        <p style={note}>
          <strong>Survivor, same income</strong> holds income fixed and changes only the filing status. It
          isolates what the halved thresholds cost by themselves — the figure that surprises people.
          <strong> Survivor, realistic</strong> also drops the Social Security the household stops
          receiving: the survivor keeps the larger of the two checks and loses the other.
          {worst.lostSS > 0
            ? ` In ${worst.year} that is ${fmt(worst.lostSS)}${assumedSplit ? ', estimated as half the household benefit because your plan does not split Social Security by person' : ''}. The bill falls from the first case but stays well above what the couple paid together, because the thresholds fell faster than the income did.`
            : ` In ${worst.year} neither benefit has started, so nothing is lost and the two survivor columns are identical — the entire difference is the filing status.`}
        </p>

        <h2 style={h2}>Why It Happens — the Thresholds Themselves ({worst.year})</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Threshold</th>
              <th style={thR}>Married filing jointly</th>
              <th style={thR}>Single</th>
              <th style={thR}>Change</th>
            </tr>
          </thead>
          <tbody>
            {thresholdRows.map(t => (
              <tr key={t.label}>
                <td style={td}>{t.label}</td>
                <td style={tdR}>{fmt(t.joint)}</td>
                <td style={tdR}>{fmt(t.single)}</td>
                <td style={{ ...tdR, color: '#dc2626' }}>
                  {t.joint > 0 ? `−${Math.round((1 - t.single / t.joint) * 100)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={note}>
          Figures for {worst.year} in that year's dollars. The deduction rows come from your plan's own
          ages, so the age-65 add-on and the senior deduction are the real amounts rather than a flat
          halving. Note that the NIIT floor is not inflation-indexed by statute — it is the same dollar
          figure every year, so it binds harder as the plan runs.
        </p>

        <h2 style={h2}>What This Means for Roth Conversions</h2>
        <div style={{ borderLeft: '4px solid #d97706', background: '#fffbeb', borderRadius: 6, padding: '12px 16px', breakInside: 'avoid' }}>
          <p style={{ fontSize: 14, color: '#334155', margin: 0, lineHeight: 1.6 }}>
            The conversion window is usually described as closing at the first required distribution. It
            closes earlier than that: <strong>it closes at the first death</strong>. Every dollar converted
            while both spouses are living is taxed at joint rates against joint thresholds. The same dollar
            left in a pre-tax account and withdrawn by the survivor is taxed at single rates against
            thresholds roughly half the size
            {firstJump ? ` — in this plan, ${pct(firstJump.joint.bracket)} becomes ${pct(firstJump.filingStatusOnly.bracket)} from ${firstJump.year} on` : ''}
            {firstIrmaaJump ? `, with a Medicare surcharge tier crossed on top of it` : ''}.
          </p>
          <p style={{ fontSize: 14, color: '#334155', margin: '10px 0 0', lineHeight: 1.6 }}>
            Across the {rows.length} joint years in this plan, the filing-status change alone is worth{' '}
            <strong>{fmtK(lifetimePenaltyReal)}</strong> in today's dollars ({fmtK(lifetimePenalty)} nominal)
            if the survivor faced it in every one of them. That
            figure is not a prediction — nobody pays it in every year — but it is the size of the prize that
            filling the joint brackets now is competing for. It is a reason to convert <em>more</em> in the
            joint years than a bracket-only rule would suggest, and a reason not to leave the whole window
            to the last few years before required distributions begin.
          </p>
        </div>

        <h2 style={h2}>Every Joint Year</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Year</th><th style={th}>Age</th>
              <th style={thR}>AGI</th>
              <th style={thR}>Tax filing jointly</th>
              <th style={thR}>Tax as survivor</th>
              <th style={thR}>Extra</th>
              <th style={th}>Bracket</th>
              <th style={th}>IRMAA tier</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.year} style={worst && r.year === worst.year ? { background: '#fef3c7' } : undefined}>
                <td style={td}>{r.year}</td>
                <td style={td}>{r.myAge}</td>
                <td style={tdR}>{fmt(r.joint.agi)}</td>
                <td style={tdR}>{fmt(r.joint.total)}</td>
                <td style={tdR}>{fmt(r.filingStatusOnly.total)}</td>
                <td style={{ ...tdR, color: r.filingPenalty > 0 ? '#dc2626' : undefined, fontWeight: 600 }}>
                  {r.filingPenalty > 0 ? '+' + fmt(r.filingPenalty) : '—'}
                </td>
                <td style={{ ...td, color: r.bracketJumped ? '#dc2626' : undefined }}>
                  {pct(r.joint.bracket)} → {pct(r.filingStatusOnly.bracket)}
                </td>
                <td style={{ ...td, color: r.irmaaTierJumped ? '#dc2626' : undefined }}>
                  {r.joint.irmaaTier === null
                    ? '—'
                    : `${r.joint.irmaaTier} → ${r.filingStatusOnly.irmaaTier}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={note}>
          Highlighted row = the worst year. &quot;Tax as survivor&quot; holds that year's income fixed and
          changes only the filing status, so the columns are directly comparable. Red marks a year where
          the survivor lands in a higher bracket or a higher Medicare surcharge tier than the couple did.
          All figures are nominal (future) dollars.
        </p>

        </>)}

        <p style={{ fontSize: 11, color: '#64748b', marginTop: 24, lineHeight: 1.5, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          This report is a directional planning tool generated from the assumptions in your plan, not tax or
          investment advice. It prices each year twice under today's tax law (the published {PlannerEngine.LATEST_PUBLISHED_TAX_YEAR - 1} and{' '}
          {PlannerEngine.LATEST_PUBLISHED_TAX_YEAR} figures, grown after that at the indexes the law uses); it does not model
          estate tax, step-up in basis, beneficiary elections, or the year-of-death return itself (which is
          still filed jointly). Confirm decisions with a qualified professional.
        </p>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}

// ============================================
// Roth Conversion Roadmap — the plan's conversion strategy, year by year, with
// the one thing an amount column can never say: WHY each year is that size.
//
// A conversion of $0 can mean four different things — the window is shut, the
// income already cleared the ceiling, the pre-tax floor is protecting a balance,
// or the IRA is empty — and each has a different fix. The engine now reports the
// binding constraint on every row (rothConversionLimit), which is what turns a
// column of numbers into a plan someone can act on.
//
// Runs a second projection with conversions off so the "what it changes" section
// is a real difference rather than an assertion. That is expensive, but a report
// is opened deliberately, not re-rendered on a slider drag.
// ============================================
// See the bracket calculation in RothRoadmapReport: a conversion solved against
// a bracket top can finish a few hundred dollars past it, because the draw that
// pays its tax bill is sized afterwards and is itself ordinary income.
const BRACKET_FILL_EDGE_TOLERANCE = 1000;

const CONVERSION_LIMIT_COPY = {
  ceiling:  { label: 'Filled the target',   tone: 'good',    detail: 'Converted everything the target allows without crossing it.' },
  target:   { label: 'Hit the set amount',  tone: 'neutral', detail: 'Delivered the fixed amount in full — there may be room left above it.' },
  noRoom:   { label: 'No room left',        tone: 'warn',    detail: 'Income already reached the ceiling before any conversion.' },
  balance:  { label: 'Pre-tax exhausted',   tone: 'warn',    detail: 'The strategy still called for a conversion; the account had nothing left.' },
  floor:    { label: 'Preserve-floor',      tone: 'neutral', detail: 'Stopped by the pre-tax balance you asked the plan to keep.' },
  window:   { label: 'Outside the window',  tone: 'muted',   detail: 'This year falls outside the conversion start/end ages.' },
  none:     { label: 'No strategy',         tone: 'muted',   detail: 'No Roth conversion strategy is configured.' },
};

function RothRoadmapReport({ computeProjections, projections, personalInfo, accounts, incomeStreams, assets,
                             oneTimeEvents, recurringExpenses, onClose }) {
  const pi = personalInfo;
  const preparedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
  // Rounding to thousands turns anything under $500 into "$0K", which reads as a
  // formatting failure rather than as zero. Below a thousand, print the figure.
  const fmtK = (n) => (Math.abs(n) >= 1000000 ? '$' + (n / 1000000).toFixed(2) + 'M'
    : Math.abs(n) < 1000 ? fmt(n)
    : '$' + Math.round((n || 0) / 1000) + 'K');
  const pct1 = (n) => (n * 100).toFixed(1) + '%';

  const planned = conversionIsActive(pi);
  const strategy = conversionModeLabel(pi);
  const infl = pi.inflationRate ?? 0.03;
  const thisYear = new Date().getFullYear();
  const real = (n, year) => (n || 0) / Math.pow(1 + infl, Math.max(0, year - thisYear));

  // The baseline: the identical plan with every conversion mode cleared. Every
  // mode, not a subset — leaving one standing is what once made the simulator
  // compare a plan to itself.
  const baseline = useMemo(() => {
    if (!planned) return null;
    const withoutPI = { ...withoutRothConversions(pi), rothConversionPreTaxFloor: 0 };
    return computeProjections(withoutPI, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses);
  }, [planned, pi, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses]);

  const rows = useMemo(() => {
    const out = [];
    let cumulative = 0, cumulativeCost = 0;
    (projections || []).forEach(r => {
      const amount = r.rothConversion || 0;
      if (amount <= 0 && (r.rothConversionLimit === 'window' || r.rothConversionLimit === 'none')) return;
      const cost = baseline ? conversionCostComponents(projections, baseline, r.myAge, amount) : null;
      cumulative += amount;
      cumulativeCost += cost ? cost.totalCost : 0;
      out.push({
        year: r.year, myAge: r.myAge, amount,
        limit: r.rothConversionLimit || 'none',
        cost: cost ? cost.totalCost : null,
        rate: cost ? cost.rate : null,
        taxableIncome: r.taxableIncome, magi: r.magi,
        // The statutory bracket the year lands in, so the "per $" column can be
        // read against it. The gap between the two is the entire argument for
        // pricing a conversion properly instead of quoting a bracket.
        //
        // Measured with a $1,000 tolerance, and that is not cosmetic tidying.
        // A bracket-fill year genuinely lands a few hundred dollars over its
        // target: the engine solves the conversion against the ceiling, then
        // sizes the withdrawal that pays the conversion's tax bill, and that
        // withdrawal is ordinary income too. The estimate used during the solve
        // is settled to the dollar but the executed draw is not identical, so a
        // year filled to the top of 24% typically ends ~$150 inside 32%.
        // Reporting "32%" there would be true and useless. The residual is
        // called out in the footnote rather than hidden.
        bracket: topMarginalBracket(
          Math.max(0, (r.taxableIncome || 0) - (r.realizedCapitalGains || 0)
                      - (r.brokerageDividends || 0) - (r.federalDeduction || 0)
                      - BRACKET_FILL_EDGE_TOLERANCE),
          r.filingStatus || pi.filingStatus || 'married_joint',
          r.year - BASE_TAX_YEAR, infl),
        preTaxBalance: r.preTaxBalance, rothBalance: r.rothBalance,
        cumulative, cumulativeCost,
      });
    });
    return out;
  }, [projections, baseline]);

  const converting = rows.filter(r => r.amount > 0);
  const totalConverted = converting.reduce((s, r) => s + r.amount, 0);
  const totalCost = converting.reduce((s, r) => s + (r.cost || 0), 0);
  const blendedRate = totalConverted > 0 ? totalCost / totalConverted : 0;
  const firstConv = converting[0];
  const lastConv = converting[converting.length - 1];
  // Years the strategy asked for a conversion and got nothing. These are the
  // rows worth acting on — each has a different remedy.
  const stalled = rows.filter(r => r.amount <= 0 && (r.limit === 'noRoom' || r.limit === 'balance' || r.limit === 'floor'));

  // What it changes. Scored on the same terms the Roth optimizer ranks by, so
  // this report and that tool cannot tell different stories about one plan.
  const effect = useMemo(() => {
    if (!baseline) return null;
    const opts = { legacyAge: pi.legacyAge || 95, retirementAge: pi.myRetirementAge,
                   heirTaxRate: pi.heirTaxRate ?? 0.25 };
    const w = scoreRothStrategy(projections, opts);
    const o = scoreRothStrategy(baseline, opts);
    if (!w || !o) return null;
    const rmdSum = (proj) => (proj || []).reduce((s, p) => s + (p.rmd || 0), 0);
    const firstRmd = (proj) => (proj || []).find(p => (p.rmd || 0) > 0);
    // Lifetime tax discounted to today. A nominal 30-year sum is not a comparable
    // number: a strategy that pays MORE tax in raw dollars can be the cheaper one
    // once the timing is priced, and "pay now at a known rate versus later at an
    // unknown one" is precisely a question about timing.
    const pvOpts = { discountRate: pi.inflationRate ?? 0.03,
                     baseYear: (projections || [])[0] && projections[0].year };
    return {
      w, o,
      pvWith: presentValueOfTaxes(projections, pvOpts),
      pvWithout: presentValueOfTaxes(baseline, pvOpts),
      lifetimeRmdWith: rmdSum(projections), lifetimeRmdWithout: rmdSum(baseline),
      firstRmdWith: firstRmd(projections), firstRmdWithout: firstRmd(baseline),
    };
  }, [baseline, projections, pi]);

  // Where the conversion tax comes from, answered by running the plan rather
  // than by a formula. Three more projections; a report is opened deliberately.
  const funding = useMemo(() => {
    if (!planned) return null;
    return conversionFundingComparison({
      pi, accts: accounts, streams: incomeStreams, assetList: assets,
      events: oneTimeEvents, recurring: recurringExpenses,
      currentYear: new Date().getFullYear(),
    });
  }, [planned, pi, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses]);

  // The far bookend: what converting the ENTIRE pre-tax balance would do. Four
  // more projections plus a bisection; a report is opened deliberately.
  const bookend = useMemo(() => {
    if (!planned) return null;
    return convertEverythingAnalysis({
      pi, accts: accounts, streams: incomeStreams, assetList: assets,
      events: oneTimeEvents, recurring: recurringExpenses,
      currentYear: new Date().getFullYear(),
    });
  }, [planned, pi, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses]);

  // The break-even future tax rate, in the Vanguard BETR sense, built entirely
  // from this plan's own numbers. Horizon runs from the last converting year to
  // the planning horizon — the paper leaves "years to distribution" undefined,
  // and this is the one honest reading of it available here.
  const betr = useMemo(() => {
    if (!converting.length) return null;
    const last = converting[converting.length - 1];
    const brokerage = (accounts || []).filter(a => isBrokerageAccount(a.type));
    const basis = brokerage.length
      ? brokerage.reduce((s, a) => s + (a.costBasisPercent ?? BROKERAGE_COST_BASIS_ESTIMATE), 0) / brokerage.length
      : BROKERAGE_COST_BASIS_ESTIMATE;
    const growth = brokerage.length
      ? brokerage.reduce((s, a) => s + (a.cagr || 0), 0) / brokerage.length
      : 0.06;
    // Preferential rate the plan actually lands in, plus state — the drag is
    // paid at the household's rate, not at a textbook 15%.
    const stateRate = (STATE_TAX_RATES && STATE_TAX_RATES[pi.state]) || 0;
    const prefRate = 0.15 + (typeof stateRate === 'number' ? stateRate : 0);
    // Weight the schedule's own years so a long conversion window is not
    // represented by its last year alone.
    const weighted = converting.reduce((s, r) => s + r.amount * r.bracket, 0)
                   / Math.max(1, converting.reduce((s, r) => s + r.amount, 0));
    const allIn = converting.reduce((s, r) => s + r.amount * (r.rate || 0), 0)
                / Math.max(1, converting.reduce((s, r) => s + r.amount, 0));
    const years = Math.max(1, (pi.legacyAge || 95) - last.myAge);
    const core = breakEvenTaxRate({
      conversionRate: weighted, years, growthRate: growth,
      dividendYield: pi.brokerageDividendYield ?? 0.02,
      dividendTaxRate: prefRate, capGainsTaxRate: prefRate,
      costBasisFraction: basis,
      allInCostRate: allIn > 0 ? allIn : null,
    });
    if (!core) return null;
    // The net return this plan's own drag model implies, which is the number the
    // whole result turns on and the one the published case study sets by hand.
    const planNetReturn = Math.pow(core.taxableGrowth, 1 / years) - 1;
    // The rate the converted money would otherwise have come out at — measured on
    // the BASELINE, not on the converting plan. Reading it off the converting run
    // is self-fulfilling: convert the IRA away and the later years have little
    // ordinary income left, so the "future rate" collapses to 10% and every
    // aggressive plan concludes it should not have converted. The honest question
    // is what rate those dollars would have faced had they stayed put.
    const laterRows = (baseline || projections || []).filter(p => p.myAge > last.myAge && (p.taxableIncome || 0) > 0);
    const futureRate = laterRows.length
      ? laterRows.reduce((s, p) => s + topMarginalBracket(
          Math.max(0, (p.taxableIncome || 0) - (p.realizedCapitalGains || 0)
                      - (p.brokerageDividends || 0) - (p.federalDeduction || 0)),
          p.filingStatus || pi.filingStatus || 'married_joint', p.year - BASE_TAX_YEAR, infl), 0) / laterRows.length
      : null;
    return {
      ...core, planNetReturn, futureRate, growth,
      sensitivity: betrSensitivity({
        conversionRate: weighted, years, growthRate: growth,
        expectedFutureRate: futureRate, planNetReturn,
      }),
    };
  }, [converting, accounts, pi, projections, baseline, infl]);

  const th = { textAlign: 'left', padding: '4px 8px', borderBottom: '2px solid #0f172a', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#334155' };
  const thR = { ...th, textAlign: 'right' };
  const td = { padding: '4px 8px', borderBottom: '1px solid #e2e8f0', fontSize: 12 };
  const tdR = { ...td, textAlign: 'right' };
  const h2 = { fontSize: 16, fontWeight: 700, margin: '22px 0 8px', paddingBottom: 4, borderBottom: '1px solid #cbd5e1', breakAfter: 'avoid' };
  const statBox = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px' };
  const statLabel = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', margin: 0 };
  const statValue = { fontSize: 17, fontWeight: 700, margin: '2px 0 0' };
  const note = { fontSize: 11, color: '#64748b', margin: '6px 0 0', lineHeight: 1.5 };
  const TONE = { good: '#059669', neutral: '#334155', warn: '#b45309', muted: '#94a3b8' };

  const overlay = (
    <div className="report-overlay fixed inset-0 bg-black/60 flex items-start justify-center z-50 overflow-y-auto py-8 px-4">
      <div id="report-print" style={{ background: '#ffffff', color: '#0f172a' }} className="w-full max-w-4xl rounded-xl shadow-2xl p-8">
        <div className="print-hide flex justify-end gap-2 mb-6">
          <button onClick={() => window.print()} className={buttonPrimary}>Print / Save as PDF</button>
          <button onClick={onClose} className={buttonSecondary}>Close</button>
        </div>

        <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 12, marginBottom: 16 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Roth Conversion Roadmap</h1>
          <p style={{ fontSize: 14, color: '#475569', margin: '4px 0 0' }}>
            Year by year, what to convert and what stops it &nbsp;·&nbsp; Prepared {preparedOn}
          </p>
          <ReportBasisLine pi={pi} follows={false} />
        </div>

        {!planned ? (
          <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6 }}>
            No Roth conversion strategy is configured in this plan. Set one on the Taxes &amp; Roth tab —
            choose a target bracket, an IRMAA tier to stay under, or a fixed annual amount — and this
            report will lay out what gets converted in each year, what stops it, and what it costs.
          </p>
        ) : converting.length === 0 ? (
          <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6 }}>
            This plan is set to convert by {strategy}, but no year in the projection actually converts
            anything. {stalled.length > 0
              ? `The reason on every year is the same one: ${CONVERSION_LIMIT_COPY[stalled[0].limit].detail.toLowerCase()}`
              : 'Check that the conversion window overlaps the projection and that a pre-tax and a Roth account both exist.'}
          </p>
        ) : (<>

        <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, margin: '0 0 4px' }}>
          This plan converts by <strong>{strategy}</strong>, between ages{' '}
          <strong>{firstConv.myAge}</strong> and <strong>{lastConv.myAge}</strong>. Each dollar moved from a
          pre-tax account to a Roth is taxed as ordinary income now so that it — and everything it earns
          afterwards — is never taxed again, and never forced out by a required distribution. The question
          is never whether to convert; it is how much, in which years, and what stops the plan short.
        </p>

        <h2 style={h2}>The Strategy in Four Numbers</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          <div style={statBox}>
            <p style={statLabel}>Total Converted</p>
            <p style={statValue}>{fmtK(totalConverted)}</p>
            <p style={{ ...note, marginTop: 0 }}>across {converting.length} years</p>
          </div>
          <div style={statBox}>
            <p style={statLabel}>Tax Paid to Convert</p>
            <p style={statValue}>{fmtK(totalCost)}</p>
            <p style={{ ...note, marginTop: 0 }}>income tax, IRMAA and lost ACA subsidy</p>
          </div>
          <div style={statBox}>
            <p style={statLabel}>Blended Cost per Dollar</p>
            <p style={{ ...statValue, color: blendedRate > 0.30 ? '#b45309' : '#0f172a' }}>{pct1(blendedRate)}</p>
            <p style={{ ...note, marginTop: 0 }}>all-in, not just the bracket</p>
          </div>
          <div style={statBox}>
            <p style={statLabel}>Pre-Tax Left at {lastConv.myAge}</p>
            <p style={statValue}>{fmtK(lastConv.preTaxBalance)}</p>
            <p style={{ ...note, marginTop: 0 }}>
              {effect ? `vs ${fmtK((baseline.find(p => p.myAge === lastConv.myAge) || {}).preTaxBalance)} without converting` : 'at the last converting year'}
            </p>
          </div>
        </div>

        <h2 style={h2}>The Roadmap</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Year</th><th style={th}>Age</th>
              <th style={thR}>Convert</th>
              <th style={th}>What stopped it</th>
              <th style={thR}>Bracket</th>
              <th style={thR}>Cost</th>
              <th style={thR}>Per $</th>
              <th style={thR}>Pre-tax left</th>
              <th style={thR}>Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const c = CONVERSION_LIMIT_COPY[r.limit] || CONVERSION_LIMIT_COPY.none;
              return (
                <tr key={r.year} style={r.amount <= 0 ? { background: '#fffbeb' } : undefined}>
                  <td style={td}>{r.year}</td>
                  <td style={td}>{r.myAge}</td>
                  <td style={{ ...tdR, fontWeight: r.amount > 0 ? 600 : 400 }}>{r.amount > 0 ? fmt(r.amount) : '—'}</td>
                  <td style={{ ...td, color: TONE[c.tone] }}>{c.label}</td>
                  <td style={tdR}>{(r.bracket * 100).toFixed(0)}%</td>
                  <td style={tdR}>{r.cost != null ? fmt(r.cost) : '—'}</td>
                  <td style={{ ...tdR, fontWeight: 600, color: r.rate != null && r.rate > r.bracket * 1.25 ? '#b45309' : undefined }}>
                    {r.rate != null ? pct1(r.rate) : '—'}
                  </td>
                  <td style={tdR}>{fmt(r.preTaxBalance)}</td>
                  <td style={tdR}>{fmt(r.cumulative)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={note}>
          Shaded rows converted nothing. &quot;Bracket&quot; is the statutory rate the year reaches;
          &quot;per $&quot; is what the conversion actually costs — the extra income tax it causes, the
          Medicare surcharge it triggers <em>two years later</em>, and any ACA premium subsidy it burns,
          divided by the amount converted. The gap between the two columns is the point of this report.
          It comes from three places a bracket cannot show: the conversion drags Social Security into tax,
          it crosses surcharge and phaseout edges, and — unless you have set the tax to come from a taxable
          account — the withdrawal that pays the tax bill is itself taxable income, which is why filling to
          the top of a bracket costs more per dollar than the bracket says. That last effect also means a
          bracket-fill year usually ends a few hundred dollars <em>past</em> the bracket it was aiming at;
          the column reports the bracket filled, within $1,000. Nominal (future) dollars.
          {' '}{pi.rothConversionTaxSource === 'brokerage'
            ? 'This plan pays the conversion tax from a taxable account, so the bill does not add ordinary income of its own — the cheaper of the two options.'
            : 'This plan pays the conversion tax from pre-tax withdrawals, so every tax dollar is itself taxed. Paying it from a taxable account instead (Taxes & Roth → Your Roth conversion strategy → tax payment source) removes that layer and is usually the single largest reduction available to this column.'}
        </p>

        <h2 style={h2}>What Stopped It — and What to Do About It</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Reason</th><th style={th}>Years</th><th style={th}>What it means</th></tr></thead>
          <tbody>
            {Object.keys(CONVERSION_LIMIT_COPY)
              .filter(k => rows.some(r => r.limit === k))
              .map(k => {
                const hits = rows.filter(r => r.limit === k);
                const c = CONVERSION_LIMIT_COPY[k];
                return (
                  <tr key={k}>
                    <td style={{ ...td, color: TONE[c.tone], fontWeight: 600, whiteSpace: 'nowrap' }}>{c.label}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {hits.length === 1 ? hits[0].year : `${hits[0].year}–${hits[hits.length - 1].year} (${hits.length})`}
                    </td>
                    <td style={td}>{c.detail}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        {stalled.length > 0 && (
          <div style={{ borderLeft: '4px solid #d97706', background: '#fffbeb', borderRadius: 6, padding: '12px 16px', marginTop: 12, breakInside: 'avoid' }}>
            <p style={{ fontSize: 14, color: '#334155', margin: 0, lineHeight: 1.6 }}>
              <strong>{stalled.length} year{stalled.length === 1 ? '' : 's'} inside your window converted nothing.</strong>{' '}
              {stalled.some(r => r.limit === 'balance')
                ? 'Where the pre-tax account ran dry, the window is longer than the money — the strategy is finished and the remaining years are doing nothing. '
                : ''}
              {stalled.some(r => r.limit === 'noRoom')
                ? 'Where income had already cleared the ceiling, the target is set below what this plan’s own withdrawals produce — a higher bracket or tier would convert something rather than nothing. '
                : ''}
              {stalled.some(r => r.limit === 'floor')
                ? 'Where the preserve-pre-tax floor bound it, that floor is doing what you asked; the question is only whether you still want it that high. '
                : ''}
            </p>
          </div>
        )}

        {funding && (<>
          <h2 style={h2}>Where the Conversion Tax Comes From</h2>
          <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, margin: '0 0 10px' }}>
            The oldest rule about conversions — convert if your future tax rate will be higher than
            today's — is wrong whenever the tax is paid from <em>outside</em> the IRA. Paying from a
            taxable account shrinks a tax-dragged asset to grow a tax-free one, and that swap is worth
            something by itself, whatever future rates do. Vanguard's 2025 research calls the rate where
            it all nets out the <strong>break-even tax rate</strong>. Rather than take their formula's
            assumptions, this runs your plan three times and changes only one thing: who pays the tax.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Same conversion schedule, three ways</th>
                <th style={thR}>Converted</th>
                <th style={thR}>Lifetime tax</th>
                <th style={thR}>Pre-tax left</th>
                <th style={thR}>After-tax legacy</th>
              </tr>
            </thead>
            <tbody>
              {[
                { key: 'none', label: 'No conversions at all', s: funding.none },
                { key: 'withdrawal', label: 'Convert — tax from the portfolio', s: funding.fromPortfolio },
                { key: 'brokerage', label: 'Convert — tax from a taxable account', s: funding.fromTaxable },
              ].map(r => (
                <tr key={r.key} style={r.key === funding.best ? { background: '#f0fdf4' } : undefined}>
                  <td style={{ ...td, fontWeight: r.key === funding.best ? 700 : 400 }}>
                    {r.label}
                    {r.key === funding.current && r.key !== 'none' && (
                      <span style={{ fontSize: 10, color: '#2563eb', fontWeight: 600, marginLeft: 6 }}>YOUR SETTING</span>
                    )}
                    {r.key === funding.best && (
                      <span style={{ fontSize: 10, color: '#059669', fontWeight: 600, marginLeft: 6 }}>BEST HERE</span>
                    )}
                  </td>
                  <td style={tdR}>{r.key === 'none' ? '—' : fmt(r.s.lifetimeConversions)}</td>
                  <td style={tdR}>{fmt(r.s.lifetimeTax)}</td>
                  <td style={tdR}>{fmt(r.s.endPreTax)}</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{fmt(r.s.afterTaxLegacy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={note}>
            Paying the tax from a taxable account converts{' '}
            <strong>{fmt(Math.abs(funding.fromTaxable.lifetimeConversions - funding.fromPortfolio.lifetimeConversions))} {funding.fromTaxable.lifetimeConversions > funding.fromPortfolio.lifetimeConversions ? 'more' : 'less'}</strong>{' '}
            under the identical rule, because the withdrawal that funds the tax is not itself ordinary
            income eating the bracket room the conversion was aiming at. But converting more is not the
            same as ending up ahead: on after-tax legacy, paying from{' '}
            <strong>{funding.fundingDelta >= 0 ? 'a taxable account' : 'the portfolio'}</strong> wins here
            by <strong style={{ color: '#059669' }}>{fmt(Math.abs(funding.fundingDelta))}</strong>.
            {funding.fundingDelta < 0 && (
              <> That is the direction the break-even formula does <em>not</em> predict, and it is worth
              understanding: the taxable account was already doing useful work — funding early retirement,
              and passing to heirs with a stepped-up basis — so spending it down to convert more gives up
              something the formula never counts.</>
            )}
            {funding.fundingDelta >= 0 && (
              <> Which is the direction the published research points, for the reason it gives: the
              taxable dollars spent on tax were the ones carrying the drag.</>
            )}
            {!funding.conversionHelps && (
              <> <strong style={{ color: '#b45309' }}>Note that on this plan, not converting at all still
              wins</strong> — by {fmt(Math.abs(funding.conversionDelta))} of after-tax legacy. That is a
              real result, not a bug: with a large taxable account and a modest assumed heir rate, paying
              tax early to avoid a rate you may never face can cost more than it saves.</>
            )}
          </p>

          {betr && (
            <div style={{ borderLeft: '4px solid #2563eb', background: '#eff6ff', borderRadius: 6, padding: '12px 16px', marginTop: 12, breakInside: 'avoid' }}>
              <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: '#1e3a8a' }}>
                Your break-even future tax rate
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                <tbody>
                  <tr>
                    <td style={{ ...td, borderBottom: 'none' }}>If you pay the tax <strong>from the IRA itself</strong></td>
                    <td style={{ ...tdR, borderBottom: 'none', fontWeight: 700 }}>{pct1(betr.betrInternal)}</td>
                  </tr>
                  <tr>
                    <td style={{ ...td, borderBottom: 'none' }}>If you pay it <strong>from a taxable account</strong></td>
                    <td style={{ ...tdR, borderBottom: 'none', fontWeight: 700, color: '#059669' }}>{pct1(betr.betrExternal)}</td>
                  </tr>
                  {betr.betrAllIn !== null && (
                    <tr>
                      <td style={{ ...td, borderBottom: 'none' }}>
                        From taxable, priced at what the conversion <strong>actually costs you</strong>
                      </td>
                      <td style={{ ...tdR, borderBottom: 'none', fontWeight: 700, color: '#b45309' }}>{pct1(betr.betrAllIn)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p style={{ fontSize: 12, color: '#334155', margin: '10px 0 0', lineHeight: 1.6 }}>
                Read it as: convert if you expect your future marginal rate to be <em>above</em> these.
                Paying from the IRA moves nothing but the rate — only {pct1(1 - betr.betrInternal)} of
                each dollar reaches the Roth, so the break-even is the conversion rate itself. Paying from
                taxable drops the bar to {pct1(betr.betrExternal)} over {betr.years} years, and{' '}
                <strong>that {(betr.fundingAdvantage * 100).toFixed(1)}-point gap is the entire published finding</strong> —
                it comes from the funding choice, not from any forecast about future rates.
              </p>
              {/* The band. A single BETR next to a single guessed future rate can sit
                  0.7 points apart and be presented as an answer; showing the range
                  the load-bearing assumption can take is the honest reply. */}
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #bfdbfe' }}>
                <p style={{ fontSize: 12, fontWeight: 700, margin: 0, color: '#1e3a8a' }}>
                  How much rests on one assumption
                </p>
                <p style={{ fontSize: 12, color: '#334155', margin: '4px 0 8px', lineHeight: 1.6 }}>
                  Everything above turns on what your taxable account earns <em>after</em> its own tax
                  drag. Your plan implies <strong>{pct1(betr.planNetReturn)}</strong> net against{' '}
                  {pct1(betr.growth)} gross — {((betr.growth - betr.planNetReturn) * 100).toFixed(1)} points
                  of drag, or {Math.round((betr.growth - betr.planNetReturn) / Math.max(0.0001, betr.growth) * 100)}%
                  of the return. Vanguard's own case study assumes 41%, which is where most of its
                  headline comes from. Here is the whole range:
                </p>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Tax drag on the taxable account</th>
                      <th style={thR}>Net return</th>
                      <th style={thR}>Break-even rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {betr.sensitivity.band.map(r => {
                      const nearest = Math.abs(r.netReturn - betr.planNetReturn) < 0.0026;
                      return (
                        <tr key={r.dragPoints} style={nearest ? { background: '#dbeafe' } : undefined}>
                          <td style={td}>
                            {r.dragPoints.toFixed(2)} points ({Math.round(r.dragShare * 100)}% of the return)
                            {nearest && <span style={{ fontSize: 10, color: '#1d4ed8', fontWeight: 700, marginLeft: 6 }}>YOUR PLAN</span>}
                          </td>
                          <td style={tdR}>{pct1(r.netReturn)}</td>
                          <td style={{ ...tdR, fontWeight: 600 }}>{pct1(r.betr)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {betr.futureRate !== null && (
                  <p style={{ fontSize: 12, color: betr.sensitivity.flipsInsideBand ? '#b45309' : '#334155', margin: '8px 0 0', lineHeight: 1.6 }}>
                    Without these conversions, your plan projects an average marginal rate of{' '}
                    <strong>{pct1(betr.futureRate)}</strong> on the years those dollars would have come
                    out.{' '}
                    {betr.sensitivity.flipsInsideBand ? (
                      <>
                        <strong>The verdict reverses inside this band.</strong> Above a{' '}
                        {pct1(betr.sensitivity.flipNetReturn)} net return on your taxable account the
                        break-even rises past {pct1(betr.futureRate)} and the answer becomes
                        &ldquo;don&rsquo;t convert&rdquo;; below it, &ldquo;convert&rdquo;. Nobody can
                        forecast that return to the tenth of a point over {betr.years} years, so treat
                        this as a reason to look at the table further up — which runs your plan instead
                        of resolving an assumption — rather than as an answer.
                      </>
                    ) : (
                      <>Across the whole band the answer stays{' '}
                      <strong>{betr.futureRate > betr.sensitivity.high ? 'convert' : 'do not convert'}</strong> —
                      which is the case where a break-even rate is genuinely useful, because the
                      conclusion does not depend on the assumption doing the work.</>
                    )}
                  </p>
                )}
                <p style={{ fontSize: 11, color: '#475569', margin: '8px 0 0', lineHeight: 1.6 }}>
                  <strong>There is also a third option this framing leaves out.</strong> The worse your
                  taxable account is at growing after tax, the better a conversion looks — which is an
                  odd way to build a case, because the same willingness to sell those holdings to pay
                  conversion tax is a willingness to sell them and reinvest more efficiently. Fixing the
                  drag first raises the break-even rate and weakens the case for converting; that is the
                  honest order to do it in.
                </p>
              </div>

              <p style={{ fontSize: 11, color: '#475569', margin: '10px 0 0', lineHeight: 1.6 }}>
                <strong>Treat the first two as a floor, not a threshold.</strong> They price the bracket
                and nothing else. The same conversion in your plan also pushes Social Security into tax,
                crosses Medicare surcharge tiers, and can trigger the investment-income surtax — the third
                line is that real cost, and it is the bar a decision should actually clear. The horizon is
                taken as your last converting year to age {pi.legacyAge || 95}; the published method leaves
                &quot;years to distribution&quot; undefined, and stretching or shortening it moves these
                numbers by points. A single figure carrying that many estimates deserves to be read as a
                direction, not a verdict — which is why the table above, built by running your plan rather
                than a formula, is the part to act on.
              </p>
            </div>
          )}
        </>)}

        {bookend && (<>
          <h2 style={h2}>What If You Converted Everything?</h2>
          <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, margin: '0 0 10px' }}>
            Emptying the pre-tax account entirely is almost never the right answer, which is exactly why
            it is worth pricing: it brackets the decision from the far side, the way &ldquo;convert
            nothing&rdquo; brackets it from the near side. Draining {fmt(bookend.annualConversion)} a year
            from age {bookend.startAge} to {bookend.endAge} would do it. The arguments cut both ways, and
            each one is measurable on its own.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Measured to age {pi.legacyAge || 95}</th>
                <th style={thR}>Convert nothing</th>
                {bookend.current && <th style={thR}>Your plan</th>}
                <th style={thR}>Convert everything</th>
              </tr>
            </thead>
            <tbody>
              {[
                { k: 'Charitable gifts made straight from the IRA (QCD)', f: p => fmt(p.qcd), hint: 'needs an IRA balance to exist' },
                { k: 'Cheap 10%/12% bracket room left unused', f: p => fmt(p.unusedLowBrackets), hint: 'income you were entitled to take cheaply and did not' },
                { k: 'Lifetime required distributions', f: p => fmt(p.rmd) },
                { k: 'Share of Social Security that gets taxed', f: p => p.ssTaxedShare === null ? '—' : pct1(p.ssTaxedShare) },
                { k: "Worst widow's year, after the window (today's $)", f: p => fmt(p.widowExposure) },
                { k: "Lifetime tax, in today's dollars", f: p => fmt(p.pvTax) },
              ].map(r => (
                <tr key={r.k}>
                  <td style={td}>
                    {r.k}
                    {r.hint && <div style={{ fontSize: 10, color: '#94a3b8' }}>{r.hint}</div>}
                  </td>
                  <td style={tdR}>{r.f(bookend.none)}</td>
                  {bookend.current && <td style={tdR}>{r.f(bookend.current)}</td>}
                  <td style={tdR}>{r.f(bookend.all)}</td>
                </tr>
              ))}
              <tr style={{ background: '#f8fafc' }}>
                <td style={{ ...td, fontWeight: 700 }}>After-tax legacy</td>
                <td style={{ ...tdR, fontWeight: 700 }}>{fmt(bookend.none.afterTaxLegacy)}</td>
                {bookend.current && <td style={{ ...tdR, fontWeight: 700 }}>{fmt(bookend.current.afterTaxLegacy)}</td>}
                <td style={{ ...tdR, fontWeight: 700, color: bookend.verdict >= 0 ? '#059669' : '#dc2626' }}>
                  {fmt(bookend.all.afterTaxLegacy)}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
            <div style={{ borderLeft: '4px solid #dc2626', background: '#fef2f2', borderRadius: 6, padding: '10px 14px', breakInside: 'avoid' }}>
              <p style={{ fontSize: 12, fontWeight: 700, margin: 0, color: '#991b1b' }}>What it throws away</p>
              <ul style={{ fontSize: 12, color: '#334155', margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                <li><strong>{fmt(bookend.against.qcdLost)}</strong> of qualified charitable distributions.
                  A QCD is the only way to move money to charity without it ever appearing in income, and
                  it needs an IRA to come out of. Empty the account and that ends for life.</li>
                <li><strong>{fmt(bookend.against.lowBracketsLeftUnused)}</strong> of unused 10%/12% bracket
                  room. The standard deduction and the two lowest bands are cheap ordinary income you are
                  entitled to every year — with nothing pre-tax left, there is nothing to fill them with.</li>
                {bookend.against.taxPaidEarlier !== null && bookend.against.taxPaidEarlier > 0 && (
                  <li><strong>{fmt(bookend.against.taxPaidEarlier)}</strong> more lifetime tax in today's
                    dollars, because the bill is paid decades earlier.</li>
                )}
              </ul>
            </div>
            <div style={{ borderLeft: '4px solid #059669', background: '#f0fdf4', borderRadius: 6, padding: '10px 14px', breakInside: 'avoid' }}>
              <p style={{ fontSize: 12, fontWeight: 700, margin: 0, color: '#065f46' }}>What it buys</p>
              <ul style={{ fontSize: 12, color: '#334155', margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
                <li><strong>{fmt(bookend.forIt.rmdsRemoved)}</strong> of required distributions gone —
                  income forced out whether you want it or not.</li>
                {bookend.forIt.ssTorpedoRemoved !== null && (
                  <li>The Social Security torpedo shrinks by{' '}
                    <strong>{(bookend.forIt.ssTorpedoRemoved * 100).toFixed(1)} points</strong> of benefits
                    taxed{bookend.all.ssTaxedShare > 0.05 && <> — though it does not disappear, because your
                    taxable account still feeds provisional income</>}.</li>
                )}
                <li>The widow&rsquo;s-year penalty falls by{' '}
                  <strong>{fmt(bookend.forIt.widowPenaltyRemoved)}</strong> in the worst year, since there
                  is no ordinary income left to be re-taxed at single-filer brackets.</li>
              </ul>
            </div>
          </div>
          <p style={note}>
            On this plan, converting everything{' '}
            <strong style={{ color: bookend.verdict >= 0 ? '#059669' : '#dc2626' }}>
              {bookend.verdict >= 0 ? 'adds' : 'costs'} {fmt(Math.abs(bookend.verdict))}
            </strong>{' '}
            of after-tax legacy against converting nothing. One thing the columns can hide: every benefit
            in the right-hand panel only starts once the account is actually <em>empty</em>. A level
            schedule spread to age {bookend.endAge} is still generating ordinary income at {bookend.endAge},
            so a plan that finishes draining sooner banks the Social Security and widow&rsquo;s-year
            savings for more years — at a higher rate on the way. Read the two panels rather than the total:
            which side wins is a fact about <em>your</em> household — how much you give, how large the
            benefit split is, how long you both live — not a general result. The bookend is here to show
            you the shape of the trade, and the roadmap above is where the actual answer lives, somewhere
            between the two.
          </p>
        </>)}

        {effect && (<>
          <h2 style={h2}>What It Changes</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Measured to age {pi.legacyAge || 95}</th>
                <th style={thR}>With conversions</th>
                <th style={thR}>Without</th>
                <th style={thR}>Difference</th>
              </tr>
            </thead>
            <tbody>
              {[
                { k: 'Lifetime income tax + surcharges', a: effect.w.lifetimeTax, b: effect.o.lifetimeTax, lowerBetter: true },
                ...(effect.pvWith && effect.pvWithout
                  ? [{ k: '  the same, in today\'s dollars', a: effect.pvWith.present, b: effect.pvWithout.present, lowerBetter: true }]
                  : []),
                { k: 'Lifetime Medicare IRMAA', a: effect.w.lifetimeIRMAA, b: effect.o.lifetimeIRMAA, lowerBetter: true },
                { k: 'Lifetime required distributions', a: effect.lifetimeRmdWith, b: effect.lifetimeRmdWithout, lowerBetter: true },
                { k: 'Pre-tax balance at the end', a: effect.w.endPreTax, b: effect.o.endPreTax, lowerBetter: true },
                { k: 'Roth balance at the end', a: effect.w.endRoth, b: effect.o.endRoth, lowerBetter: false },
                { k: `After-tax legacy (heirs at ${Math.round((pi.heirTaxRate ?? 0.25) * 100)}%)`, a: effect.w.afterTaxLegacy, b: effect.o.afterTaxLegacy, lowerBetter: false },
              ].map(m => {
                const diff = m.a - m.b;
                const good = m.lowerBetter ? diff < 0 : diff > 0;
                return (
                  <tr key={m.k} style={m.k.startsWith('After-tax') ? { background: '#f8fafc' } : undefined}>
                    <td style={{ ...td, fontWeight: m.k.startsWith('After-tax') ? 700 : 400 }}>{m.k}</td>
                    <td style={tdR}>{fmt(m.a)}</td>
                    <td style={tdR}>{fmt(m.b)}</td>
                    <td style={{ ...tdR, fontWeight: 700, color: Math.abs(diff) < 1 ? '#64748b' : (good ? '#059669' : '#dc2626') }}>
                      {diff === 0 ? '—' : (diff > 0 ? '+' : '−') + fmt(Math.abs(diff))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={note}>
            Green is the direction that favours the plan: less lifetime tax, smaller forced distributions,
            more after-tax legacy. Lifetime income tax usually goes <em>up</em> with conversions — that is
            the bill being paid on purpose, early and at a chosen rate, instead of later at whatever rate
            the survivor or the heirs face. The line that decides whether it was worth it is the last one.
            {effect.pvWith && effect.pvWithout && (
              <> The second row discounts every year's tax back to today at your inflation rate, which is
              the only basis on which paying early and paying late are comparable at all: a conversion
              deliberately moves tax <em>forward</em> in time, and a raw 30-year sum prices that move at
              zero. Where the two rows disagree in direction, the discounted one is the honest ranking.</>
            )}
            {effect.firstRmdWithout && effect.firstRmdWith
              ? ` The first required distribution falls from ${fmt(effect.firstRmdWithout.rmd)} to ${fmt(effect.firstRmdWith.rmd)} in ${effect.firstRmdWith.year}.`
              : effect.firstRmdWithout
                ? ` Converting removes the required distributions entirely — without it the first would be ${fmt(effect.firstRmdWithout.rmd)} in ${effect.firstRmdWithout.year}.`
                : ''}
          </p>
        </>)}

        </>)}

        <p style={{ fontSize: 11, color: '#64748b', marginTop: 24, lineHeight: 1.5, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          This report is a directional planning tool generated from the assumptions in your plan, not tax or
          investment advice. The comparison runs your plan twice — once as configured, once with every
          conversion setting cleared — under today's tax law (the published {PlannerEngine.LATEST_PUBLISHED_TAX_YEAR - 1} and{' '}
          {PlannerEngine.LATEST_PUBLISHED_TAX_YEAR} figures, grown after that at the indexes the law uses). The five-year
          clock on converted dollars is applied. It does not model state-specific conversion treatment beyond your
          state's own schedule, or recharacterization (repealed for conversions).
          Confirm decisions with a qualified professional.
        </p>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}

// ============================================
// ScenarioComparisonReport
// ============================================
// The gap the Sandbox created. You can now compose an alternative plan from its
// controls, save it as a scenario and promote one to the baseline — but there
// was no way to put "retire at 62 vs 65 vs 67" in front of a spouse or an
// adviser. Everything needed already existed; only the document was missing.
//
// Deliberately measured on ONE basis for every column: each scenario is re-run
// through the same engine with its own saved plan, and the same five figures are
// taken from each. Comparing a saved scenario's stored summary against a freshly
// computed baseline is how two columns end up answering slightly different
// questions.
// The comparison chart, drawn for paper.
//
// Deliberately NOT the Recharts chart from the Sandbox. Three things differ on
// paper and all three matter:
//
//   • There is no hover, so the tooltip that carries identity on screen does not
//     exist. Every line is labelled at its right-hand end instead, which is also
//     where the scenarios have spread furthest apart and the labels have room.
//   • The page is white whatever theme the app is wearing, so the LIGHT palette
//     is used explicitly rather than whichever one the screen happens to be on.
//   • ResponsiveContainer measures its parent with a ResizeObserver, which has
//     no reliable answer during a print layout pass. A fixed viewBox scaled to
//     100% width prints at whatever size the page gives it.
//
// What does NOT differ is which line belongs to which scenario: both call
// scenarioLineStyle, so the green dashed one is the green dashed one in both
// places.
function ScenarioReportChart({ rows, retirementAge, palette, fmtK }) {
  const W = 720, H = 300;
  const padL = 58, padR = 132, padT = 12, padB = 30;   // right gutter holds the end labels
  const withData = rows.filter(r => r.series && r.series.length > 1);
  if (withData.length < 2) return null;

  const ages = withData.flatMap(r => r.series.map(p => p.age));
  const minAge = Math.min(...ages), maxAge = Math.max(...ages);
  const peak = Math.max(1, ...withData.flatMap(r => r.series.map(p => p.v)));

  // Round gridlines, not quarters of the peak. Slicing the maximum into four
  // gave an axis reading $8.62M / $17.25M / $25.87M — every label a number
  // nobody would ever choose, and no help at all for reading a value off the
  // line. Step up through 1/2/2.5/5 x a power of ten until four or five bands
  // cover the data, then let the top gridline sit above the peak.
  const niceStep = (span) => {
    const pow = Math.pow(10, Math.floor(Math.log10(span / 4)));
    return [1, 2, 2.5, 5, 10].map(m => m * pow).find(st => span / st <= 5) || pow * 10;
  };
  const step = niceStep(peak);
  const maxV = Math.ceil(peak / step) * step;
  const x = (age) => padL + ((age - minAge) / Math.max(1, maxAge - minAge)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / maxV) * (H - padT - padB);

  const ticks = [];
  for (let t = 0; t <= maxV + step / 2; t += step) ticks.push(t);
  // The report's own money formatter carries two decimals, which is right in a
  // table cell and noise on a gridline — an axis of $10.00M / $20.00M invites
  // the reader to look for a precision the gridline does not have.
  const axisTick = (v) => !v ? '$0'
    : v >= 1000000 ? '$' + (v / 1000000).toFixed(v % 1000000 ? 1 : 0) + 'M'
    : '$' + Math.round(v / 1000) + 'K';
  // End labels stack when two scenarios finish close together, so they are
  // nudged apart in draw order rather than allowed to overprint.
  const MIN_GAP = 11;
  const ends = withData
    .map((r, i) => ({ r, i, yEnd: y(r.series[r.series.length - 1].v) }))
    .sort((a, b) => a.yEnd - b.yEnd);
  let last = -Infinity;
  ends.forEach(e => { e.labelY = Math.max(e.yEnd, last + MIN_GAP); last = e.labelY; });

  const styleOf = (row, idx) => row.isBase
    ? { stroke: '#0f172a', strokeDasharray: undefined, width: 2.6 }
    : { ...scenarioLineStyle(idx - 1, palette), width: 1.6 };

  return (
    <div style={{ breakInside: 'avoid', margin: '4px 0 2px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', maxWidth: '100%' }}
           role="img" aria-label="Portfolio value by age, your plan against each saved scenario">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#64748b">{axisTick(t)}</text>
          </g>
        ))}
        {/* Retirement, marked as it is on screen. */}
        {retirementAge >= minAge && retirementAge <= maxAge && (
          <g>
            <line x1={x(retirementAge)} y1={padT} x2={x(retirementAge)} y2={H - padB}
                  stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" />
            <text x={x(retirementAge) + 3} y={padT + 9} fontSize="9" fill="#64748b">Retire {retirementAge}</text>
          </g>
        )}
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#cbd5e1" strokeWidth="1" />
        {[minAge, Math.round((minAge + maxAge) / 2), maxAge].map((a, i) => (
          <text key={i} x={x(a)} y={H - padB + 13} textAnchor="middle" fontSize="9" fill="#64748b">{a}</text>
        ))}
        <text x={(padL + W - padR) / 2} y={H - 2} textAnchor="middle" fontSize="9" fill="#64748b">Your age</text>

        {withData.map((row, idx) => {
          const st = styleOf(row, idx);
          const d = row.series.map((p, i) => `${i ? 'L' : 'M'} ${x(p.age).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
          return <path key={row.label + idx} d={d} fill="none" stroke={st.stroke}
                       strokeWidth={st.width} strokeDasharray={st.strokeDasharray}
                       strokeLinejoin="round" strokeLinecap="round" />;
        })}

        {/* Direct labels: on paper this is the only thing carrying identity, so
            it is not optional the way a legend beside a hoverable chart is. */}
        {ends.map(e => {
          const st = styleOf(e.r, e.i);
          const xEnd = x(e.r.series[e.r.series.length - 1].age);
          return (
            <g key={'lbl' + e.i}>
              <line x1={xEnd} y1={e.yEnd} x2={W - padR + 6} y2={e.labelY} stroke={st.stroke}
                    strokeWidth="0.75" opacity="0.5" />
              <text x={W - padR + 9} y={e.labelY + 3} fontSize="9.5"
                    fill={e.r.isBase ? '#0f172a' : '#334155'}
                    fontWeight={e.r.isBase ? 700 : 400}>
                {e.r.label.length > 20 ? e.r.label.slice(0, 19) + '…' : e.r.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ScenarioComparisonReport({ computeProjections, projections, personalInfo, accounts,
                                    incomeStreams, assets, oneTimeEvents, recurringExpenses,
                                    scenarios, onClose }) {
  const pi = personalInfo;
  const preparedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
  const fmtK = (n) => (Math.abs(n) >= 1000000 ? '$' + (n / 1000000).toFixed(2) + 'M'
    : Math.abs(n) < 1000 ? fmt(n) : '$' + Math.round((n || 0) / 1000) + 'K');
  const h2 = { fontSize: 16, fontWeight: 700, margin: '22px 0 8px', paddingBottom: 4, borderBottom: '1px solid #cbd5e1', breakAfter: 'avoid' };
  const th = { textAlign: 'right', fontSize: 11, color: '#475569', padding: '6px 8px', borderBottom: '1px solid #cbd5e1' };
  const thL = { ...th, textAlign: 'left' };
  const td = { textAlign: 'right', fontSize: 12, padding: '5px 8px', borderBottom: '1px solid #f1f5f9' };
  const tdL = { ...td, textAlign: 'left', fontWeight: 600 };

  const legacyAge = pi.legacyAge || 95;
  const rate = pi.heirTaxRate ?? 0.25;
  // This page prints on white whatever the app is wearing, so the chart takes
  // the light column rather than THEME, which follows the screen.
  const reportPalette = (PlannerTheme.resolve('light') || {}).categorical || THEME.categorical;

  // One measurement function, applied to the live plan and to every scenario, so
  // no column can be computed a different way from its neighbours.
  const measure = (label, p, a, s, ast, ev, rec, isBase) => {
    const proj = computeProjections(p, a, s, ast || assets, ev || oneTimeEvents, rec || recurringExpenses);
    const short = planShortfall(proj, { retirementAge: p.myRetirementAge });
    const legacy = afterTaxLegacyValue(proj, { legacyAge: p.legacyAge || legacyAge, heirTaxRate: rate });
    const retYears = proj.filter(r => r.myAge >= (p.myRetirementAge ?? 0));
    return {
      label, isBase,
      retireAt: p.myRetirementAge,
      atRetirement: Math.round((proj.find(r => r.myAge === p.myRetirementAge) || {}).totalPortfolio || 0),
      estate: legacy ? legacy.estate : 0,
      afterTax: legacy ? legacy.afterTax : 0,
      lifetimeTax: Math.round(retYears.reduce((t, r) => t + (r.totalTax || 0), 0)),
      conversions: Math.round(proj.reduce((t, r) => t + (r.rothConversion || 0), 0)),
      fails: !!short.fails,
      shortYears: short.shortYearCount || 0,
      depletedAt: short.depletedYear ? short.depletedYear.myAge : null,
      endsAt: proj.length ? proj[proj.length - 1].myAge : null,
      // The chart is drawn from the SAME projection run that produced this row's
      // figures. Re-running it separately for the picture is how a chart ends up
      // telling a different story from the table beneath it.
      series: proj.map(r => ({ age: r.myAge, v: r.totalPortfolio || 0 })),
    };
  };

  const rows = useMemo(() => {
    const base = measure('Your plan', pi, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses, true);
    const rest = (scenarios || []).map(sc => measure(
      sc.name,
      { ...DEFAULT_PERSONAL_INFO, ...sc.personalInfo },
      sc.accounts || accounts,
      sc.incomeStreams || incomeStreams,
      sc.assets || assets,
      sc.oneTimeEvents || oneTimeEvents,
      sc.recurringExpenses || recurringExpenses,
      false));
    return [base, ...rest];
  }, [pi, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses, scenarios]);

  const base = rows[0];
  const others = rows.slice(1);
  const delta = (v, b, goodWhenUp = true) => {
    const d = v - b;
    if (Math.abs(d) < 1) return <span style={{ color: '#94a3b8' }}>—</span>;
    const good = (d > 0) === goodWhenUp;
    return <span style={{ color: good ? '#047857' : '#b91c1c' }}>{d > 0 ? '+' : '−'}{fmtK(Math.abs(d))}</span>;
  };

  const overlay = (
    <div className="report-overlay fixed inset-0 bg-black/60 flex items-start justify-center z-50 overflow-y-auto py-8 px-4">
      <div id="report-print" style={{ background: '#ffffff', color: '#0f172a' }} className="w-full max-w-5xl rounded-xl shadow-2xl p-8">
        <div className="print-hide flex justify-end gap-2 mb-6">
          <button onClick={() => window.print()} className={buttonPrimary}>Print / Save as PDF</button>
          <button onClick={onClose} className={buttonSecondary}>Close</button>
        </div>

        <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 12, marginBottom: 16 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Scenarios, Side by Side</h1>
          <p style={{ fontSize: 14, color: '#475569', margin: '4px 0 0' }}>
            Your plan against {others.length} saved alternative{others.length === 1 ? '' : 's'}
            &nbsp;·&nbsp; Prepared {preparedOn}
          </p>
          <ReportBasisLine pi={pi} follows={true} />
        </div>

        {others.length === 0 ? (
          <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6 }}>
            No scenarios have been saved yet, so there is nothing to compare your plan against. Build one on
            the <strong>Dashboard</strong> under <strong>What if…</strong> — move the retirement age, claiming age, savings rate or spending
            until you have something worth keeping, then use <strong>Save as scenario</strong>. This report
            becomes useful the moment there are two plans to weigh.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, margin: '0 0 4px' }}>
              Every column below is the whole plan re-run through the same engine — not a stored summary from
              when the scenario was saved. If an assumption changed since, these figures reflect the change.
              Differences are shown against your current plan.
            </p>

            <h2 style={h2}>Every Plan, One Picture</h2>
            <p style={{ fontSize: 12, color: '#475569', margin: '0 0 6px', lineHeight: 1.5 }}>
              Portfolio value from today to the end of each plan. Your plan is the heavy dark line; each
              scenario is labelled at its right-hand end. Drawn from the same projection runs as the tables
              below, so the picture and the numbers cannot disagree.
            </p>
            <ScenarioReportChart rows={rows} retirementAge={pi.myRetirementAge}
                                 palette={reportPalette} fmtK={fmtK} />

            <h2 style={h2}>The Comparison</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thL}>Scenario</th>
                    <th style={th}>Retire at</th>
                    <th style={th}>Portfolio then</th>
                    <th style={th}>Estate at {legacyAge}</th>
                    <th style={th}>After tax</th>
                    <th style={th}>Lifetime tax</th>
                    <th style={th}>Converted</th>
                    <th style={th}>Funds every year</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.label + i} style={r.isBase ? { background: '#fef3c7' } : null}>
                      <td style={tdL}>
                        {r.label}
                        {r.isBase && <span style={{ fontSize: 10, color: '#92400e', marginLeft: 6, fontWeight: 400 }}>BASELINE</span>}
                      </td>
                      <td style={td}>{r.retireAt}</td>
                      <td style={td}>{fmtK(r.atRetirement)}</td>
                      <td style={td}>{fmtK(r.estate)}</td>
                      <td style={td}>{fmtK(r.afterTax)}</td>
                      <td style={td}>{fmtK(r.lifetimeTax)}</td>
                      <td style={td}>{r.conversions > 0 ? fmtK(r.conversions) : '—'}</td>
                      <td style={{ ...td, color: r.fails ? '#b91c1c' : '#047857' }}>
                        {r.fails ? `no — short in ${r.shortYears}` : 'yes'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 style={h2}>Against Your Plan</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thL}>Scenario</th>
                    <th style={th}>Portfolio at retirement</th>
                    <th style={th}>After-tax estate</th>
                    <th style={th}>Lifetime tax</th>
                    <th style={th}>Roth converted</th>
                  </tr>
                </thead>
                <tbody>
                  {others.map((r, i) => (
                    <tr key={r.label + i}>
                      <td style={tdL}>{r.label}</td>
                      <td style={td}>{delta(r.atRetirement, base.atRetirement, true)}</td>
                      <td style={td}>{delta(r.afterTax, base.afterTax, true)}</td>
                      {/* Lower tax is better, so the sign that reads as good is the
                          negative one — the one place in this table where a red
                          minus would be exactly backwards. */}
                      <td style={td}>{delta(r.lifetimeTax, base.lifetimeTax, false)}</td>
                      <td style={td}>{delta(r.conversions, base.conversions, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: '#64748b', margin: '6px 0 0', lineHeight: 1.5 }}>
              Green is the better direction for that column, which is not always "up": less lifetime tax is
              better, more estate is better. After-tax estate discounts remaining pre-tax balances at your
              heirs' rate of {Math.round(rate * 100)}% — a pre-tax dollar and a Roth dollar are not worth the
              same to whoever inherits them.
            </p>

            <h2 style={h2}>What Changes Between Them</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thL}>Scenario</th>
                    <th style={thL}>Retirement</th>
                    <th style={thL}>Spending target</th>
                    <th style={thL}>Claiming</th>
                    <th style={thL}>Conversions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const src = r.isBase ? null : (scenarios[i - 1] || {});
                    const p = r.isBase ? pi : { ...DEFAULT_PERSONAL_INFO, ...(src.personalInfo || {}) };
                    // A claim age can live on personalInfo OR on the Social
                    // Security stream itself, and in a plan built from the wizard
                    // it is usually only on the stream. Reading just the first
                    // printed "— / —" for every row of a plan that has perfectly
                    // good claim ages.
                    const strms = r.isBase ? incomeStreams : (src.incomeStreams || incomeStreams);
                    const claimOf = (owner, fallback) => {
                      if (Number.isFinite(fallback)) return fallback;
                      const ss = (strms || []).find(x => x && x.type === 'social_security'
                        && (x.owner === 'spouse' ? 'spouse' : 'me') === owner);
                      return ss && Number.isFinite(ss.startAge) ? ss.startAge : null;
                    };
                    const myClaim = claimOf('me', p.mySSClaimAge);
                    const spClaim = claimOf('spouse', p.spouseSSClaimAge);
                    return (
                      <tr key={'w' + i} style={r.isBase ? { background: '#fef3c7' } : null}>
                        <td style={tdL}>{r.label}</td>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 400 }}>age {p.myRetirementAge}</td>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 400 }}>{strategyLeadsSpending(p) ? strategyLabelOf(p) : `${fmt(p.desiredIncome ?? p.desiredRetirementIncome)}/yr`}</td>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 400 }}>
                          {myClaim || '—'}{pi.filingStatus === 'married_joint' ? ` / ${spClaim || '—'}` : ''}
                        </td>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 400 }}>{rothConversionModeLabel(p, fmt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <h2 style={h2}>Reading This</h2>
            <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.7, margin: 0 }}>
              A scenario that leaves more behind is not automatically the better plan. Retiring later almost
              always wins on every column here, because the columns measure money and not the years you get
              to spend it in. The figures worth arguing over are the last one — whether the plan funds every
              year — and the gap between the estate and its after-tax value, which is the part a Roth
              conversion strategy can still move. What none of these columns can price is the difference
              between retiring at 62 and retiring at 67.
            </p>
          </>
        )}
      </div>
    </div>
  );
  // Portalled to body like every other report, and not decoratively: the print
  // stylesheet hides #root, so a report left inside the app tree renders a blank
  // page when the reader hits Print / Save as PDF. Two of the seven reports were
  // returning the overlay directly and had never printed anything.
  return ReactDOM.createPortal(overlay, document.body);
}

// ============================================
// ClaimingDecisionReport
// ============================================
// When to claim Social Security is the largest mostly-irreversible choice in a
// retirement plan, and until now it had no document — 1,013 lines of analysis on
// the Social Security tab that could not be printed or handed to anyone.
//
// The thing that makes it worth a report rather than a print button: the two
// sensible objectives DISAGREE, and neither the tab nor the engine's ranking
// says so. Claiming early usually maximises the estate, because Social Security
// arriving sooner means fewer portfolio withdrawals and more left compounding.
// Delaying the HIGHER earner maximises what the surviving spouse lives on for
// the rest of their life, because the larger benefit is the one that continues.
// A document that printed only "best: 62/62" would be giving bad advice with a
// straight face. This one puts both answers at the top and says which question
// each one answers.
function ClaimingDecisionReport({ projections, personalInfo, accounts, incomeStreams, assets,
                                  oneTimeEvents, recurringExpenses, onClose }) {
  const pi = personalInfo;
  const preparedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
  const fmtK = (n) => (Math.abs(n) >= 1000000 ? '$' + (n / 1000000).toFixed(2) + 'M'
    : Math.abs(n) < 1000 ? fmt(n) : '$' + Math.round((n || 0) / 1000) + 'K');
  const h2 = { fontSize: 16, fontWeight: 700, margin: '22px 0 8px', paddingBottom: 4, borderBottom: '1px solid #cbd5e1', breakAfter: 'avoid' };
  const statBox = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px' };
  const statLabel = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', margin: 0 };
  const statValue = { fontSize: 17, fontWeight: 700, margin: '2px 0 0', color: '#0f172a' };
  const th = { textAlign: 'right', fontSize: 11, color: '#475569', padding: '6px 8px', borderBottom: '1px solid #cbd5e1' };
  const thL = { ...th, textAlign: 'left' };
  const td = { textAlign: 'right', fontSize: 12, padding: '5px 8px', borderBottom: '1px solid #f1f5f9' };
  const tdL = { ...td, textAlign: 'left' };

  // Nine projections for a couple, three for a single filer. Synchronous because
  // it is small: the worker-backed 296-cell grid on the tab is for exploring,
  // this is for answering.
  const cmp = useMemo(() => claimingComparison({
    pi, accts: accounts, streams: incomeStreams, assets,
    events: oneTimeEvents, recurring: recurringExpenses,
  }), [pi, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses]);

  if (!cmp) {
    return (
      <div className="report-overlay fixed inset-0 bg-black/60 flex items-start justify-center z-50 overflow-y-auto py-8 px-4">
        <div id="report-print" style={{ background: '#ffffff', color: '#0f172a' }} className="w-full max-w-4xl rounded-xl shadow-2xl p-8">
          <div className="print-hide flex justify-end gap-2 mb-6">
            <button onClick={onClose} className={buttonSecondary}>Close</button>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>The Claiming Decision</h1>
          <p style={{ fontSize: 14, color: '#475569', marginTop: 10 }}>
            This plan has no Social Security income stream, so there is no claiming decision to analyse.
            Add one on the Income Streams tab — the estimate on the Social Security tab will fill it in
            from your earnings if you do not have a figure from SSA.
          </p>
        </div>
      </div>
    );
  }

  // The two objectives, named separately because they do not agree.
  const byWealth = cmp.ranked[0];
  // Ties are the NORM here, not the exception: the survivor's income depends
  // only on the higher earner's claim age, so every scenario sharing that age
  // has the same survivor benefit to within a rounding dollar. Picking by a bare
  // max returned whichever tied row came first and then priced the difference
  // against it — reporting a $626K "cost" for a $1 gain. Ties break on the
  // wealth ranking, which means the survivor answer costs nothing it does not
  // have to.
  const bySurvivor = cmp.married
    ? [...cmp.scenarios].sort((a, b) => {
        const d = (b.survivorBenefit || 0) - (a.survivorBenefit || 0);
        if (Math.abs(d) > 1) return d;
        return compareClaimingScenarios(a, b);
      })[0]
    : null;
  const agree = !cmp.married || (bySurvivor && byWealth
    && byWealth.myClaimAge === bySurvivor.myClaimAge && byWealth.spClaimAge === bySurvivor.spClaimAge);
  const cur = cmp.current;

  // Which person carries the survivor benefit. It is whoever's is larger, and
  // that is the only claim age that moves the survivor's income at all — a fact
  // the grid makes obvious once you look for it and nearly invisible if you do not.
  const survivorSpread = cmp.married && bySurvivor && cur
    ? (bySurvivor.survivorBenefit || 0) - (cur.survivorBenefit || 0) : 0;

  const overlay = (
    <div className="report-overlay fixed inset-0 bg-black/60 flex items-start justify-center z-50 overflow-y-auto py-8 px-4">
      <div id="report-print" style={{ background: '#ffffff', color: '#0f172a' }} className="w-full max-w-4xl rounded-xl shadow-2xl p-8">
        <div className="print-hide flex justify-end gap-2 mb-6">
          <button onClick={() => window.print()} className={buttonPrimary}>Print / Save as PDF</button>
          <button onClick={onClose} className={buttonSecondary}>Close</button>
        </div>

        <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 12, marginBottom: 16 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>The Claiming Decision</h1>
          <p style={{ fontSize: 14, color: '#475569', margin: '4px 0 0' }}>
            When to start Social Security &nbsp;·&nbsp; Prepared {preparedOn}
          </p>
          <ReportBasisLine pi={pi} follows={false} />
        </div>

        <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, margin: '0 0 4px' }}>
          Claiming is close to irreversible — there is a twelve-month window to withdraw an application, once
          in a lifetime, and the benefit must be repaid. It is also the one decision here that cannot be
          fixed later by saving more or spending less. What follows is your plan run at{' '}
          {cmp.scenarios.length} combinations of claim age, changing nothing else.
        </p>

        <h2 style={h2}>{agree ? 'The Answer' : 'Two Answers, and They Disagree'}</h2>
        {agree ? (
          <div style={{ borderLeft: '4px solid #059669', background: '#f0fdf4', borderRadius: 6, padding: '12px 16px', margin: '10px 0 14px' }}>
            <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#065f46' }}>
              Claim at {byWealth.label}.
            </p>
            <p style={{ fontSize: 14, color: '#334155', margin: '8px 0 0', lineHeight: 1.6 }}>
              Unusually, the same choice both leaves the most behind and protects the survivor best, so there
              is no trade-off to weigh here.
            </p>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, margin: '0 0 10px' }}>
              There is no single best claim age, because the two things you might be optimising for point in
              opposite directions. Both are stated here rather than one being picked for you.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ borderLeft: '4px solid #2a78d6', background: '#eff6ff', borderRadius: 6, padding: '12px 16px' }}>
                <p style={{ ...statLabel, color: '#1e40af' }}>Most left at the end</p>
                <p style={{ fontSize: 18, fontWeight: 700, margin: '2px 0 6px' }}>{byWealth.label}</p>
                <p style={{ fontSize: 13, color: '#334155', margin: 0, lineHeight: 1.5 }}>
                  {fmtK(byWealth.afterTaxAtLegacy)} after tax at {pi.legacyAge || 95}
                  {cur && byWealth !== cur && <> — {fmtK(byWealth.afterTaxAtLegacy - cur.afterTaxAtLegacy)} more than your plan</>}.
                  {/* Which way this cuts is not fixed. Claiming EARLY usually wins on
                      the estate because benefits arriving sooner replace portfolio
                      withdrawals; claiming LATE can win instead when the larger
                      cheque outruns that, particularly with a long horizon. The
                      sentence has to follow the answer rather than assume one. */}
                  {cur && byWealth.myClaimAge < cur.myClaimAge
                    ? ' Benefits arriving sooner replace portfolio withdrawals, and what is not withdrawn keeps compounding.'
                    : cur && byWealth.myClaimAge > cur.myClaimAge
                      ? ' The larger delayed benefit more than repays the years of portfolio spending it costs to wait.'
                      : ' Your plan is already the choice that leaves the most behind.'}
                </p>
              </div>
              <div style={{ borderLeft: '4px solid #d97706', background: '#fffbeb', borderRadius: 6, padding: '12px 16px' }}>
                <p style={{ ...statLabel, color: '#92400e' }}>Most for the survivor</p>
                <p style={{ fontSize: 18, fontWeight: 700, margin: '2px 0 6px' }}>{bySurvivor.label}</p>
                <p style={{ fontSize: 13, color: '#334155', margin: 0, lineHeight: 1.5 }}>
                  {fmt(bySurvivor.survivorBenefit)}/yr for whoever outlives the other
                  {survivorSpread > 0 && <> — {fmt(survivorSpread)}/yr more than your plan</>}, for the rest
                  of their life.
                  {byWealth.afterTaxAtLegacy - bySurvivor.afterTaxAtLegacy > 1000
                    ? ` Costs ${fmtK(byWealth.afterTaxAtLegacy - bySurvivor.afterTaxAtLegacy)} of final estate.`
                    : ' And it costs nothing against the choice on the left.'}
                </p>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '10px 0 0' }}>
              Which one matters depends on something this plan cannot know: whether the risk you are managing
              is leaving too little behind, or one of you living a long time alone on a reduced income. The
              second is the harder one to recover from.
            </p>
          </>
        )}

        <h2 style={h2}>Every Combination</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thL}>{cmp.married ? 'You / Spouse' : 'Claim at'}</th>
              <th style={th}>After-tax at {pi.legacyAge || 95}</th>
              <th style={th}>Lifetime tax</th>
              <th style={th}>Lifetime SS</th>
              {cmp.married && <th style={th}>Survivor keeps</th>}
              <th style={th}>Runs dry</th>
            </tr>
          </thead>
          <tbody>
            {cmp.ranked.map((s, i) => (
              <tr key={s.label} style={s.isPlan ? { background: '#fef3c7' } : (i === 0 ? { background: '#f0fdf4' } : null)}>
                <td style={tdL}>
                  <strong>{s.label}</strong>
                  {s.isPlan && <span style={{ fontSize: 10, color: '#92400e', marginLeft: 6 }}>YOUR PLAN</span>}
                  {i === 0 && !s.isPlan && <span style={{ fontSize: 10, color: '#065f46', marginLeft: 6 }}>MOST LEFT</span>}
                </td>
                <td style={td}>{fmtK(s.afterTaxAtLegacy)}</td>
                <td style={td}>{fmtK(s.lifetimeTax)}</td>
                <td style={td}>{fmtK(s.lifetimeSS)}</td>
                {cmp.married && <td style={td}>{s.survivorBenefit === null ? '—' : fmt(s.survivorBenefit)}</td>}
                <td style={td}>{s.depletionAge ? `age ${s.depletionAge}` : 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: '#64748b', margin: '6px 0 0', lineHeight: 1.5 }}>
          Ranked by whether the plan survives first, then by what is left after tax — the same order the
          Social Security tab uses. Each row is your whole plan re-run with only the claim ages changed;
          benefits are recomputed from your primary insurance amount, not scaled.
        </p>

        {cmp.married && (
          <>
            <h2 style={h2}>Only One Claim Age Moves the Survivor</h2>
            <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, margin: '0 0 8px' }}>
              When one of you dies, the survivor keeps the <strong>larger</strong> of the two benefits and the
              smaller one stops. So the survivor's income for the rest of their life is set entirely by when
              the <strong>higher earner</strong> claims — look down the Survivor column and you will see it
              change with the first number and ignore the second completely.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[...new Set(cmp.scenarios.map(s => s.myClaimAge))].sort((a, b) => a - b).map(age => {
                const row = cmp.scenarios.find(s => s.myClaimAge === age);
                return (
                  <div key={age} style={statBox}>
                    <p style={statLabel}>You claim at {age}</p>
                    <p style={statValue}>{fmt(row.survivorBenefit)}<span style={{ fontSize: 12, fontWeight: 400, color: '#64748b' }}>/yr</span></p>
                    <p style={{ fontSize: 11, color: '#64748b', margin: '2px 0 0' }}>survivor's income for life</p>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '10px 0 0' }}>
              This is why "delay to 70" is advice aimed at the higher earner specifically. For the lower
              earner it buys a larger cheque only while both are alive, and nothing afterwards — which is
              usually the weaker half of the trade.
            </p>
          </>
        )}

        <h2 style={h2}>What It Does to Roth Conversions</h2>
        <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, margin: 0 }}>
          Claiming later does something the table above does not price directly: it keeps taxable income low
          for longer. The years between retiring at {pi.myRetirementAge} and starting benefits are the
          cheapest conversion years a plan ever gets — no salary, no Social Security, and required
          distributions still years away. Delaying from {cmp.planMy} to 70 lengthens that window by{' '}
          {Math.max(0, 70 - cmp.planMy)} year{Math.max(0, 70 - cmp.planMy) === 1 ? '' : 's'}. The Roth
          Conversion Roadmap prices that window with your actual bracket room; this report deliberately does
          not, because the two decisions are usually made in sequence rather than together.
        </p>

        <h2 style={h2}>What This Does Not Model</h2>
        <ul style={{ fontSize: 13, color: '#334155', lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
          <li>Spousal benefits, and the restricted-application rules that ended for anyone born after
              1 January 1954. Each person is modelled on their own record.</li>
          <li>The earnings test is applied by the engine, but only against earned income already in this
              plan — claiming early while still working can cost more than shown if that changes.</li>
          <li>Divorced-spouse and survivor benefits claimed on an ex-spouse's record.</li>
          <li>Any change to the programme itself. Benefits here are the ones currently legislated, indexed
              at your inflation assumption of {(((pi.inflationRate ?? 0.03) * 100)).toFixed(1)}%.</li>
          <li>Your health, and your family's longevity. That is the input that ought to move this decision
              most, and it is the one the plan is least able to guess.</li>
        </ul>
      </div>
    </div>
  );
  // Portalled to body like every other report, and not decoratively: the print
  // stylesheet hides #root, so a report left inside the app tree renders a blank
  // page when the reader hits Print / Save as PDF. Two of the seven reports were
  // returning the overlay directly and had never printed anything.
  return ReactDOM.createPortal(overlay, document.body);
}

// ============================================
// What Breaks First — failure forensics.
//
// Every other view of this plan answers "does it work". This one assumes it
// does not, and asks what gives way, in what order, and how much room there is
// before it does. Two things make that possible and neither was on screen:
//
//   unfundedShortfall  computed on every row since the withdrawal solver was
//                      written, displayed in one badge on one table. A plan can
//                      be short for six years in its sixties, recover when
//                      Social Security starts, and still print a healthy legacy.
//   the edges          bisection on each assumption until the plan just fails,
//                      which answers "how much is left" rather than the fixed
//                      ±10% sweeps the Sensitivity tab runs.
//
// Deliberately not a duplicate of Stress Test (historical return sequences) or
// Sensitivity (one-variable sweeps around the plan). This is the failure record.
// ============================================
function BreakingPointReport({ projections, personalInfo, accounts, incomeStreams, assets,
                               oneTimeEvents, recurringExpenses, onClose }) {
  const pi = personalInfo;
  const preparedOn = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
  const fmtK = (n) => (Math.abs(n) >= 1000000 ? '$' + (n / 1000000).toFixed(2) + 'M'
    : Math.abs(n) < 1000 ? fmt(n) : '$' + Math.round((n || 0) / 1000) + 'K');
  const pct1 = (n) => (n * 100).toFixed(1) + '%';
  const retirementAge = pi.myRetirementAge;

  const ledger = useMemo(
    () => planShortfall(projections, { retirementAge }),
    [projections, retirementAge]);

  // The edges. Three bisections, sixteen halvings each — about 50 projections,
  // which is 80ms. Cheap enough to do on open and far more useful than a fixed
  // sweep, because it reports the value at which the plan gives way rather than
  // a set of points that may all be on the same side of it.
  const edges = useMemo(() => {
    const ctx = { pi, accts: accounts, streams: incomeStreams, assetList: assets,
                  events: oneTimeEvents, recurring: recurringExpenses,
                  currentYear: new Date().getFullYear() };
    return {
      // No spending edge under a withdrawal-led strategy: the target it would
      // vary does nothing, so every value "survives".
      spending: strategyLeadsSpending(pi) ? null : breakingPoint(ctx, 'spending'),
      inflation: breakingPoint(ctx, 'inflation'),
      returnDrop: breakingPoint(ctx, 'returnDrop'),
    };
  }, [pi, accounts, incomeStreams, assets, oneTimeEvents, recurringExpenses]);

  // When each account type runs out. The order matters as much as the dates:
  // it is the withdrawal priority playing out, and a Roth that empties before a
  // pre-tax account means the priority is not doing what its owner thinks.
  const depletions = useMemo(() => {
    const kinds = [
      { key: 'brokerageBalance', label: 'Taxable / brokerage' },
      { key: 'preTaxBalance', label: 'Pre-tax (401k / IRA)' },
      { key: 'rothBalance', label: 'Roth' },
      { key: 'hsaBalance', label: 'HSA' },
    ];
    return kinds.map(k => {
      const started = (projections || []).find(p => (p[k.key] || 0) > 0);
      if (!started) return { ...k, everFunded: false };
      const gone = (projections || []).find(p => p.myAge >= started.myAge && (p[k.key] || 0) <= 0);
      const peak = (projections || []).reduce((a, p) => Math.max(a, p[k.key] || 0), 0);
      return { ...k, everFunded: true, peak, goneYear: gone || null };
    })
    // The three original kinds show a dash when never funded, as they always
    // have. HSA is dropped instead: most plans do not have one, and a new row of
    // dashes in every existing report would be noise, not information.
      .filter(d => d.everFunded || d.key !== 'hsaBalance');
  }, [projections]);

  const retired = (projections || []).filter(p => p.myAge >= retirementAge);
  // The plan's blended growth rate, balance-weighted, straight off the engine.
  const baseCagr = (retired[0] || (projections || [])[0] || {}).weightedCAGR || 0.06;
  const peakRate = retired.reduce((a, p) => {
    const r = (p.totalPortfolio || 0) > 0 ? (p.portfolioWithdrawal || 0) / p.totalPortfolio : null;
    return (r !== null && (!a || r > a.rate)) ? { rate: r, row: p } : a;
  }, null);

  const th = { textAlign: 'left', padding: '4px 8px', borderBottom: '2px solid #0f172a', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#334155' };
  const thR = { ...th, textAlign: 'right' };
  const td = { padding: '4px 8px', borderBottom: '1px solid #e2e8f0', fontSize: 12 };
  const tdR = { ...td, textAlign: 'right' };
  const h2 = { fontSize: 16, fontWeight: 700, margin: '22px 0 8px', paddingBottom: 4, borderBottom: '1px solid #cbd5e1', breakAfter: 'avoid' };
  const statBox = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px' };
  const statLabel = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', margin: 0 };
  const statValue = { fontSize: 17, fontWeight: 700, margin: '2px 0 0' };
  const note = { fontSize: 11, color: '#64748b', margin: '6px 0 0', lineHeight: 1.5 };

  // Each edge, expressed the way its owner would state it out loud.
  const edgeRows = [
    {
      key: 'spending',
      label: 'Spending',
      now: fmt(pi.desiredRetirementIncome) + '/yr',
      edge: edges.spending,
      atEdge: e => fmt(e.value) + '/yr',
      room: e => `+${fmt(e.value - pi.desiredRetirementIncome)}/yr (${((e.value / Math.max(1, pi.desiredRetirementIncome) - 1) * 100).toFixed(0)}%)`,
      // Ratio of cushion to the assumption, so the three are comparable.
      slack: e => (e.value - pi.desiredRetirementIncome) / Math.max(1, pi.desiredRetirementIncome),
      meaning: 'Today’s-dollar spending target the plan can absorb before some year goes unfunded.',
    },
    {
      key: 'inflation',
      label: 'Inflation',
      now: pct1(pi.inflationRate || 0),
      edge: edges.inflation,
      atEdge: e => pct1(e.value),
      room: e => `+${((e.value - (pi.inflationRate || 0)) * 100).toFixed(1)} points`,
      slack: e => (e.value - (pi.inflationRate || 0)) / Math.max(0.001, pi.inflationRate || 0.001),
      meaning: 'Sustained inflation rate the plan survives. It compounds against spending for the whole horizon, so the tolerance is usually narrow.',
    },
    {
      key: 'returnDrop',
      label: 'Investment returns',
      now: 'as entered per account',
      edge: edges.returnDrop,
      atEdge: e => `−${(e.value * 100).toFixed(1)} points on every account`,
      room: e => `${(e.value * 100).toFixed(1)} points of cushion`,
      // Against the plan's OWN blended growth rate, not a stand-in. Dividing by a
      // hard-coded 6% would rank this row differently for a conservative plan
      // than for an aggressive one holding identical dollars of cushion.
      slack: e => e.value / Math.max(0.005, baseCagr),
      meaning: 'How much can come off every account’s growth rate at once. Not a bad year — a permanently lower return for the whole plan.',
    },
  ].filter(r => r.key !== 'spending' || !strategyLeadsSpending(pi));
  const measurable = edgeRows.filter(r => r.edge && !r.edge.alreadyFails && !r.edge.survivesRange && r.edge.value != null);
  const tightest = measurable.reduce((a, b) => (!a || b.slack(b.edge) < a.slack(a.edge) ? b : a), null);

  const overlay = (
    <div className="report-overlay fixed inset-0 bg-black/60 flex items-start justify-center z-50 overflow-y-auto py-8 px-4">
      <div id="report-print" style={{ background: '#ffffff', color: '#0f172a' }} className="w-full max-w-4xl rounded-xl shadow-2xl p-8">
        <div className="print-hide flex justify-end gap-2 mb-6">
          <button onClick={() => window.print()} className={buttonPrimary}>Print / Save as PDF</button>
          <button onClick={onClose} className={buttonSecondary}>Close</button>
        </div>

        <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 12, marginBottom: 16 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>What Breaks First</h1>
          <p style={{ fontSize: 14, color: '#475569', margin: '4px 0 0' }}>
            Where this plan gives way, and how much room is left &nbsp;·&nbsp; Prepared {preparedOn}
          </p>
          <ReportBasisLine pi={pi} follows={true} />
        </div>

        <p style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, margin: '0 0 4px' }}>
          Every other view of this plan asks whether it works. This one assumes it does not, and asks what
          gives way first. A plan almost never fails all at once: it goes short in a handful of years,
          drains one account type ahead of the others, and runs out of margin in one assumption long before
          the rest. Those three things are what follow.
        </p>

        <h2 style={h2}>The Verdict</h2>
        {ledger && ledger.fails ? (
          <div style={{ borderLeft: '4px solid #dc2626', background: '#fef2f2', borderRadius: 6, padding: '12px 16px', breakInside: 'avoid' }}>
            <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#991b1b' }}>
              This plan cannot fund its spending target in {ledger.shortYearCount} of its years.
            </p>
            <p style={{ fontSize: 14, color: '#334155', margin: '8px 0 0', lineHeight: 1.6 }}>
              The first shortfall is in <strong>{ledger.firstShortYear.year}</strong>, at age{' '}
              <strong>{ledger.firstShortYear.myAge}</strong>: against a spending target of{' '}
              {fmt(ledger.firstShortYear.desiredIncome)}, guaranteed income and the portfolio together
              leave the plan <strong>{fmt(ledger.firstShortYear.unfundedShortfall)}</strong> short. The worst year is{' '}
              {ledger.worstYear.year}, short by {fmt(ledger.worstYear.unfundedShortfall)}. Across the whole
              projection the gap totals <strong>{fmtK(ledger.totalShortfall)}</strong> of spending the plan
              simply does not deliver.
              {ledger.recovers
                ? ` The shortfall ends after ${ledger.lastShortYear.year}: income arriving later — Social Security, a pension — covers the target from then on. That is the case a legacy figure hides completely, because the ending balance can look perfectly healthy while the years in between do not work.`
                : ledger.depletedYear
                  ? ` The portfolio itself is exhausted in ${ledger.depletedYear.year}, at age ${ledger.depletedYear.myAge}.`
                  : ''}
            </p>
          </div>
        ) : (
          <div style={{ borderLeft: '4px solid #059669', background: '#f0fdf4', borderRadius: 6, padding: '12px 16px', breakInside: 'avoid' }}>
            <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#065f46' }}>
              This plan funds its spending target in every year to age {pi.legacyAge || 95}.
            </p>
            <p style={{ fontSize: 14, color: '#334155', margin: '8px 0 0', lineHeight: 1.6 }}>
              No year comes up short.
              {ledger && ledger.thinnestYear
                ? ` The thinnest point is ${ledger.thinnestYear.row.year}, at age ${ledger.thinnestYear.row.myAge}, when the portfolio holds ${ledger.thinnestYear.ratio.toFixed(1)}× that year's spending — ${fmtK(ledger.thinnestYear.row.totalPortfolio)} against ${fmt(ledger.thinnestYear.row.desiredIncome)} of spending.`
                : ''}
              {peakRate
                ? ` The heaviest draw is ${pct1(peakRate.rate)} of the portfolio in ${peakRate.row.year}.`
                : ''}
              {' '}That is the answer under this plan's own assumptions. The rest of this report is about how
              wrong those assumptions can be.
            </p>
          </div>
        )}

        <h2 style={h2}>How Much Room Is Left</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Assumption</th>
              <th style={th}>Your plan</th>
              <th style={th}>Breaks at</th>
              <th style={th}>Room</th>
              <th style={th}>What it means</th>
            </tr>
          </thead>
          <tbody>
            {edgeRows.map(r => {
              const e = r.edge;
              const isTightest = tightest && tightest.key === r.key;
              return (
                <tr key={r.key} style={isTightest ? { background: '#fef3c7' } : undefined}>
                  <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.label}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.now}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {!e || e.alreadyFails ? '—' : e.survivesRange ? 'not within range' : r.atEdge(e)}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: '#059669', fontWeight: 600 }}>
                    {!e || e.alreadyFails ? '—' : e.survivesRange ? 'more than tested' : r.room(e)}
                  </td>
                  <td style={{ ...td, fontSize: 11, color: '#475569' }}>{r.meaning}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={note}>
          Each row moves <em>one</em> assumption and holds everything else fixed, then narrows in on the
          exact value at which some year first goes unfunded. Real trouble arrives as a combination — lower
          returns <em>and</em> higher inflation — so treat each figure as an upper bound on that one risk,
          not as a budget to spend.
          {ledger && ledger.fails
            ? ' This plan is already short, so there is no cushion to measure and the rows above show a dash.'
            : tightest
              ? ` The tightest of the ${edgeRows.length === 3 ? 'three' : 'two'} is ${tightest.label.toLowerCase()}: proportionally, that is where this plan runs out of room first.`
              : ''}
          {strategyLeadsSpending(pi)
            ? ` Spending has no row: your withdrawal strategy (${strategyLabelOf(pi)}) sets it from the portfolio each year, so there is no target to push.`
            : ''}
        </p>

        <h2 style={h2}>The Order of Depletion</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Account type</th>
              <th style={thR}>Peak balance</th>
              <th style={th}>Runs out</th>
              <th style={th}>Balance at age {pi.legacyAge || 95}</th>
            </tr>
          </thead>
          <tbody>
            {depletions.map(d => {
              const last = (projections || [])[(projections || []).length - 1] || {};
              return (
                <tr key={d.key}>
                  <td style={{ ...td, fontWeight: 600 }}>{d.label}</td>
                  <td style={tdR}>{d.everFunded ? fmt(d.peak) : '—'}</td>
                  <td style={{ ...td, color: d.goneYear ? '#dc2626' : '#059669' }}>
                    {!d.everFunded ? 'never funded'
                      : d.goneYear ? `${d.goneYear.year} (age ${d.goneYear.myAge})`
                      : 'lasts the horizon'}
                  </td>
                  <td style={td}>{fmt(last[d.key])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={note}>
          The order here is your withdrawal priority playing out —{' '}
          {pi.withdrawalBracketFill ? `pre-tax to the top of the ${pi.withdrawalBracketFill} bracket, then ` : ''}
          {(pi.withdrawalPriority || ['pretax', 'brokerage', 'roth'])
            .map(k => ({ pretax: 'pre-tax', brokerage: 'brokerage & HSA', roth: 'Roth' })[k] || k).join(' → ')}
          {' '}— against required distributions, which force pre-tax money out whether or not it is wanted.
          A Roth balance that empties before a pre-tax one is worth a second look: it usually means the
          priority is set to spend the tax-free money first, which is the most expensive order there is.
        </p>

        {ledger && ledger.fails && (<>
          <h2 style={h2}>Every Year That Comes Up Short</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Year</th><th style={th}>Age</th>
                <th style={thR}>Spending target</th>
                <th style={thR}>Guaranteed income</th>
                <th style={thR}>From portfolio</th>
                <th style={thR}>Short by</th>
                <th style={thR}>Portfolio left</th>
              </tr>
            </thead>
            <tbody>
              {(projections || []).filter(p => (p.unfundedShortfall || 0) > 0).map(p => (
                <tr key={p.year}>
                  <td style={td}>{p.year}</td>
                  <td style={td}>{p.myAge}</td>
                  <td style={tdR}>{fmt(p.desiredIncome)}</td>
                  <td style={tdR}>{fmt(p.totalGuaranteedIncome)}</td>
                  <td style={tdR}>{fmt(p.portfolioWithdrawal)}</td>
                  <td style={{ ...tdR, color: '#dc2626', fontWeight: 700 }}>{fmt(p.unfundedShortfall)}</td>
                  <td style={tdR}>{fmt(p.totalPortfolio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={note}>
            &quot;Short by&quot; is spending the plan wanted and could not fund. It will not equal the
            spending target minus the two income columns: the portfolio has to be drawn gross of the tax
            that draw itself creates, so the gap is measured against what the plan actually needed to
            withdraw, not against the after-tax figure. It is not borrowed, deferred or made up later. In reality a household absorbs it by spending less, which is worth saying
            plainly: these rows are the years that would require a cut, and their size is the size of it.
          </p>
        </>)}

        <p style={{ fontSize: 11, color: '#64748b', marginTop: 24, lineHeight: 1.5, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
          This report is a directional planning tool generated from the assumptions in your plan, not tax or
          investment advice. The edges are found by re-running your plan with one assumption moved at a time
          under steady returns; they say nothing about the ORDER returns arrive in, which matters enormously
          in the first decade of retirement — the Will it last? tab covers that. Confirm
          decisions with a qualified professional.
        </p>
      </div>
    </div>
  );

  return ReactDOM.createPortal(overlay, document.body);
}

// Small chooser shown by the sidebar "Reports" button.
function ReportMenu({ onPick, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`${cardStyle} max-w-md w-full`}>
        <h3 className="text-xl font-bold text-slate-100 mb-4">Reports</h3>
        <div className="space-y-3">
          <button onClick={() => onPick('summary')} className="w-full text-left p-4 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 hover:border-amber-500/40 rounded-lg transition-all">
            <div className="font-semibold text-slate-100">📊 Plan Summary Report</div>
            <div className="text-xs text-slate-400 mt-1">Complete snapshot: profile, key outcomes, accounts, income, and the full year-by-year projection. Print or save as PDF.</div>
          </button>
          <button onClick={() => onPick('next12')} className="w-full text-left p-4 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 hover:border-amber-500/40 rounded-lg transition-all">
            <div className="font-semibold text-slate-100">✅ Your Next 12 Months</div>
            <div className="text-xs text-slate-400 mt-1">Action checklist for this year: RMDs, conversion room, IRMAA watch, estimated taxes.</div>
          </button>
          <button onClick={() => onPick('roadmap')} className="w-full text-left p-4 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 hover:border-amber-500/40 rounded-lg transition-all">
            <div className="font-semibold text-slate-100">🗺️ Roth Conversion Roadmap</div>
            <div className="text-xs text-slate-400 mt-1">Year by year: what converts, what stops it, what each dollar costs all-in, and what the whole strategy changes.</div>
          </button>
          <button onClick={() => onPick('breaks')} className="w-full text-left p-4 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 hover:border-amber-500/40 rounded-lg transition-all">
            <div className="font-semibold text-slate-100">🧨 What Breaks First</div>
            <div className="text-xs text-slate-400 mt-1">Failure forensics: every year that comes up short, the order your accounts drain, and how far each assumption can move before the plan gives way.</div>
          </button>
          <button onClick={() => onPick('scenarios')} className="w-full text-left p-4 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 hover:border-amber-500/40 rounded-lg transition-all">
            <div className="font-semibold text-slate-100">⚖️ Scenarios, Side by Side</div>
            <div className="text-xs text-slate-400 mt-1">Your plan against every scenario you saved from the Dashboard’s What if… — re-run, not recalled, so the columns are comparable.</div>
          </button>
          <button onClick={() => onPick('claiming')} className="w-full text-left p-4 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 hover:border-amber-500/40 rounded-lg transition-all">
            <div className="font-semibold text-slate-100">🗓️ The Claiming Decision</div>
            <div className="text-xs text-slate-400 mt-1">When to start Social Security — and why the choice that leaves the most behind is usually not the one that protects the survivor.</div>
          </button>
          <button onClick={() => onPick('survivor')} className="w-full text-left p-4 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 hover:border-amber-500/40 rounded-lg transition-all">
            <div className="font-semibold text-slate-100">🕯️ The Survivor's Tax Bill</div>
            <div className="text-xs text-slate-400 mt-1">What filing single costs the surviving spouse: halved brackets, deduction, and IRMAA tiers — and why the conversion window closes at the first death.</div>
          </button>
        </div>
        <div className="flex justify-end mt-5">
          <button onClick={onClose} className={buttonSecondary}>Close</button>
        </div>
      </div>
    </div>
  );
}

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

// Sidebar navigation. At module scope so React keeps one component identity —
// defined inside RetirementPlanner these were re-created on every render, which
// remounted the whole sidebar subtree each time any state changed.
// The seven ways to decide retirement spending, in the order the About you
// picker lists them. Ids are the engine's WITHDRAWAL_STRATEGIES.
const WITHDRAWAL_STRATEGY_CHOICES = [
  { id: 'target', label: 'Spending target (plan default)',
    what: 'Spend the amount you set, rising with inflation. The plan finds the withdrawal that pays for it.' },
  { id: 'guardrails', label: 'Guyton-Klinger guardrails',
    what: 'Your spending target, cut or raised by rule when markets fall behind or run ahead (Guyton & Klinger, 2006).' },
  { id: 'constant', label: 'The 4% rule (constant dollars)',
    what: 'Take a set share of the portfolio in the first year, then the same dollars plus inflation every year after (Bengen, 1994).' },
  { id: 'percent', label: 'Fixed percentage',
    what: 'Take the same percentage of whatever the portfolio holds each year. Never runs out; spending moves with markets.' },
  { id: 'rmd', label: 'RMD method (life expectancy)',
    what: 'Divide the portfolio by the IRS life-expectancy divisor for your age — low at first, rising with age (Sun & Webb, 2012).' },
  { id: 'vanguard', label: 'Vanguard dynamic spending',
    what: 'A percentage of the portfolio, with each year’s change held between a ceiling and a floor (Vanguard, 2020).' },
  { id: 'vpw', label: 'Variable percentage withdrawal (VPW)',
    what: 'The payment that spends the portfolio evenly to age 100, recomputed on each year’s balance (Bogleheads).' },
];

// The five withdrawal-led strategies set spending themselves, and the plan's
// spending target sits unused while one is on. Screens that show or vary that
// target ask this, and say so rather than show a figure that does nothing.
const strategyLeadsSpending = (pi) => PlannerEngine.WITHDRAWAL_LED.has(PlannerEngine.withdrawalStrategyOf(pi || {}));
const strategyLabelOf = (pi) =>
  (WITHDRAWAL_STRATEGY_CHOICES.find(c => c.id === PlannerEngine.withdrawalStrategyOf(pi || {})) || {}).label || '';
const StrategySetsSpendingNote = ({ pi, children }) => strategyLeadsSpending(pi) ? (
  <div className="mb-4 p-3 bg-slate-800/40 border border-slate-700/50 rounded-lg text-sm text-slate-300">
    Your withdrawal strategy, <strong>{strategyLabelOf(pi)}</strong>, sets your spending each year, so there is no
    spending target to vary. {children}
    <span className="block text-xs text-slate-500 mt-1">Change it on About you → Withdrawal strategy.</span>
  </div>
) : null;

// Three stripes of a theme's own colours: its ground, its card and its accent.
// Painted with inline hex rather than classes, because the point is to show a
// theme OTHER than the one currently active.
const ThemeSwatch = ({ colors }) => (
  <span aria-hidden="true" className="inline-flex h-3.5 w-5 overflow-hidden rounded-sm border border-slate-600 flex-shrink-0">
    {colors.map((c, i) => <span key={i} className="flex-1" style={{ background: c }} />)}
  </span>
);

const NavItem = ({ id, label, icon, activeTab, setActiveTab, sidebarCollapsed }) => (
  <button
    onClick={() => setActiveTab(id)}
    data-tab={id}
    aria-current={activeTab === id ? 'page' : undefined}
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

const NavGroup = ({ group, activeTab, setActiveTab, sidebarCollapsed }) => (
  // data-tour is derived from the group label ('PLAN SETUP' -> 'nav-plan-setup')
  // and is what GuidedTour's spotlight anchors to. Simple mode's single list has
  // no label, and gets no header and no tour anchor rather than an empty one.
  <div className="mb-4" data-tour={group.tourId || (group.label ? `nav-${group.label.toLowerCase().replace(/\s+/g, '-')}` : undefined)}>
    {!sidebarCollapsed && group.label && (
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-700/50 mb-1">
        <span>{group.icon}</span>
        <span>{group.label}</span>
      </div>
    )}
    {sidebarCollapsed && group.label && (
      <div className="flex justify-center py-2 text-slate-500">
        <span className="text-lg">{group.icon}</span>
      </div>
    )}
    <div className="space-y-1">
      {group.items.map(item => (
        <NavItem key={item.id} {...item} activeTab={activeTab} setActiveTab={setActiveTab} sidebarCollapsed={sidebarCollapsed} />
      ))}
    </div>
  </div>
);
// Human-readable names for the wizard fields the Guided Setup can estimate.
// Used by the wizard's preview summary and by the Dashboard review banner, so a
// user is told "401(k) balance", never "balance401k". Also doubles as the
// authoritative list of which fields are estimable, and where to go to fix each.
const ESTIMATE_LABELS = {
  balance401k: '401(k) balance', contrib401k: '401(k) contribution', match401k: 'Employer match',
  balanceRoth401k: 'Roth 401(k) balance', contribRoth401k: 'Roth 401(k) contribution',
  balanceRothIRA: 'Roth IRA balance', contribRothIRA: 'Roth IRA contribution',
  balanceTraditionalIRA: 'Traditional IRA balance', contribTraditionalIRA: 'Traditional IRA contribution',
  balanceHSA: 'HSA balance', contribHSA: 'HSA contribution',
  balanceBrokerage: 'Brokerage balance', contribBrokerage: 'Brokerage contribution',
  spouseBalance401k: "Spouse's 401(k) balance", spouseContrib401k: "Spouse's 401(k) contribution",
  spouseMatch401k: "Spouse's employer match",
  spouseBalanceRoth401k: "Spouse's Roth 401(k) balance", spouseContribRoth401k: "Spouse's Roth 401(k) contribution",
  spouseBalanceRothIRA: "Spouse's Roth IRA balance", spouseContribRothIRA: "Spouse's Roth IRA contribution",
  ssMonthly: 'Your Social Security benefit', spouseSSMonthly: "Spouse's Social Security benefit",
  desiredSpending: 'Retirement spending goal',
};

// Which tab fixes each estimated field, for the Dashboard banner's deep link.
const ESTIMATE_TAB = (field) => {
  if (field === 'desiredSpending') return 'personal';
  if (field === 'ssMonthly' || field === 'spouseSSMonthly') return 'income';
  return 'accounts';
};

