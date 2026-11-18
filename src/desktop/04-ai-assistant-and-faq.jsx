// ============================================
// FAQTab — Lifted to module scope (no longer recreated on every parent render)
// ============================================
// ── AI ASSISTANT (bring-your-own-key) ────────────────────────────────────────
// The key lives in its own localStorage entry, NOT in the plan. handleExport
// writes the plan to the browser's download folder and the README tells people
// to serve this repo locally — a key inside that file would be one `git add .`
// from a public repository. Separate key, never exported, never in a scenario.
const AI_KEY_STORAGE = 'retirement_planner_ai_key';
const AI_MODEL = 'claude-opus-5-5';
const AI_API_URL = 'https://api.anthropic.com/v1/messages';

const loadAiKey = () => {
  try { return localStorage.getItem(AI_KEY_STORAGE) || ''; } catch { return ''; }
};
const saveAiKey = (key) => {
  try {
    if (key) localStorage.setItem(AI_KEY_STORAGE, key);
    else localStorage.removeItem(AI_KEY_STORAGE);
  } catch { /* private browsing — the key just won't persist */ }
};

// The one tool the model gets. It does not apply anything: it proposes, and the
// engine's validatePlanPatch decides whether the proposal is even expressible.
const AI_PATCH_TOOL = {
  name: 'propose_plan_changes',
  description:
    'Propose changes to the retirement plan. This does NOT apply anything — the changes are '
    + 'shown to the user as a before/after diff alongside the projected effect, and they choose '
    + 'whether to accept. Call this whenever the user asks for a change to their plan. Do not '
    + 'call it to answer a question that changes nothing.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One sentence describing the change as a whole.' },
      ops: {
        type: 'array',
        description: 'The individual edits, in the order they should be read.',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['set', 'add', 'update', 'remove'] },
            target: { type: 'string', description: "'personalInfo' for set; otherwise the collection name." },
            field: { type: 'string', description: 'set only: the personalInfo field.' },
            value: { description: 'set only: the new value.' },
            id: { type: 'number', description: 'update/remove only: the id of the existing row.' },
            values: { type: 'object', description: 'add/update only: the fields to write.' },
            reason: { type: 'string', description: 'Why this specific edit, in one short sentence.' },
          },
          required: ['op', 'target'],
        },
      },
    },
    required: ['summary', 'ops'],
  },
};

// Every tool_use in the last reply needs its tool_result before the next turn —
// the API rejects the request otherwise. The proposal on screen gets the user's
// answer; any other call (a second one in the same reply, or one whose input
// could not be read because the reply was cut off) is told it was never shown,
// so the model does not assume it landed.
const answerToolUses = (history, proposal, answer) => {
  const last = history[history.length - 1];
  const calls = last && last.role === 'assistant' && Array.isArray(last.content)
    ? last.content.filter(b => b.type === 'tool_use') : [];
  if (!calls.length) return history;
  return history.concat([{
    role: 'user',
    content: calls.map(b => ({
      type: 'tool_result', tool_use_id: b.id,
      content: proposal && b.id === proposal.toolUseId ? answer
        : 'This proposal was not shown to the user because it could not be read. Nothing was changed.',
    })),
  }]);
};

// What the model is told about the plan. Deliberately the whole plan plus a
// projection summary: an assistant reasoning about a retirement plan from a
// partial view gives confidently wrong answers, and this is the data the user
// has already agreed to send.
const buildAiContext = (plan, projections) => {
  const last = projections && projections.length ? projections[projections.length - 1] : null;
  const firstBroke = (projections || []).find(r => (r.totalPortfolio || 0) <= 0);
  return {
    schema: planPatchSchema(plan),
    projection: {
      years: projections ? projections.length : 0,
      endingPortfolio: last ? Math.round(last.totalPortfolio || 0) : null,
      endingNetWorth: last ? Math.round(last.totalNetWorth || 0) : null,
      lifetimeTax: Math.round((projections || []).reduce((s, r) => s + (r.totalTax || 0), 0)),
      moneyRunsOutAtAge: firstBroke ? firstBroke.myAge : null,
    },
  };
};

const AI_SYSTEM_PROMPT = `You are a retirement-planning assistant embedded in a planning tool the user already owns. You have two jobs: answer questions about their plan, and propose changes to it.

You do not have the ability to change anything yourself. When the user asks for a change, call propose_plan_changes. The tool returns nothing — the app shows your proposal to the user as a before/after diff with the projected effect, and they accept or reject it. Say what you are proposing and why, briefly, alongside the call.

The <plan> block below is the user's complete plan, with every field you may change, its current value, and its units. Read it before proposing anything:

- Every rate is a DECIMAL FRACTION. 0.03 means 3%. The single exception is charitableGivingPercent, which is whole percent. Getting this wrong by a factor of 100 is the most damaging mistake available to you.
- You may only write fields listed in the schema. There is no way to add a new one, and a field you invent will be rejected.
- Ids are assigned by the app. Never choose one; use 'add' and the app assigns it.
- An account's stopAge is exclusive; an income stream's endAge is inclusive.

On judgment: this is the user's money and their decision. Make the routine calls yourself rather than asking — if they say "bump my savings rate to 12%", change it, don't ask which account. Ask only when two readings of the request would produce materially different plans. If you think the request is a mistake, say so in a sentence and propose it anyway; they can decline.

Do not give tax or investment advice as though you were their advisor, and do not claim certainty the projection does not have. The numbers in the plan came from the user; the projected consequences come from the app's engine, not from you — never state a projected outcome you have not been given.`;

function AiAssistantTab({ computeProjections, plan, projections, onApply }) {
  const [apiKey, setApiKey] = useState(loadAiKey);
  const [keyDraft, setKeyDraft] = useState('');
  const [messages, setMessages] = useState([]);      // API-shaped conversation
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [proposal, setProposal] = useState(null);    // { toolUseId, summary, ops, diff, preview }
  const [usage, setUsage] = useState(null);
  const [showPayload, setShowPayload] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy, proposal]);

  const context = useMemo(() => buildAiContext(plan, projections), [plan, projections]);

  // Price the proposal with the engine, not with the model. This is the whole
  // point of the review step: the reader sees what the change does to THEIR
  // plan, computed the same way every other number in the app is computed.
  const priceProposal = (ops) => {
    const diff = describePlanPatch(plan, ops);
    const { state: next, ok } = applyPlanPatch(plan, ops);
    let preview = null;
    try {
      const after = computeProjections(next.personalInfo, next.accounts, next.incomeStreams,
        next.assets, next.oneTimeEvents, next.recurringExpenses, new Date().getFullYear());
      const lastA = after[after.length - 1];
      const lastB = projections && projections.length ? projections[projections.length - 1] : null;
      const brokeA = after.find(r => (r.totalPortfolio || 0) <= 0);
      const brokeB = (projections || []).find(r => (r.totalPortfolio || 0) <= 0);
      preview = {
        endingBefore: lastB ? lastB.totalPortfolio || 0 : 0,
        endingAfter: lastA ? lastA.totalPortfolio || 0 : 0,
        taxBefore: (projections || []).reduce((s, r) => s + (r.totalTax || 0), 0),
        taxAfter: after.reduce((s, r) => s + (r.totalTax || 0), 0),
        breaksBefore: brokeB ? brokeB.myAge : null,
        breaksAfter: brokeA ? brokeA.myAge : null,
      };
    } catch (e) {
      preview = { failed: e.message };
    }
    return { diff, next, ok, preview };
  };

  // One request. Returns the assistant message so the caller can decide what to
  // do with a tool call. Errors are surfaced verbatim — a 401 from a mistyped
  // key and a 429 from a spent quota need different fixes, and paraphrasing
  // them into "something went wrong" hides which one it is.
  const callClaude = async (history) => {
    const res = await fetch(AI_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Required for browser-origin calls. Named "dangerous" because it means
        // the key is in the page — which is exactly the bring-your-own-key
        // bargain this feature makes, and why the key is never sent anywhere
        // but api.anthropic.com.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        system: `${AI_SYSTEM_PROMPT}\n\n<plan>\n${JSON.stringify(context, null, 1)}\n</plan>`,
        tools: [AI_PATCH_TOOL],
        messages: history,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body && body.error ? `${body.error.type}: ${body.error.message}` : `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return body;
  };

  const send = async (text) => {
    if (!text.trim() || busy) return;
    setError(null);

    // Typing instead of deciding is a decline, and the model is told so rather
    // than left to guess.
    const history = answerToolUses(messages, proposal,
      'The user did not apply these changes; they replied instead.')
      .concat([{ role: 'user', content: text }]);
    setProposal(null);
    setMessages(history);
    setInput('');
    setBusy(true);
    try {
      const reply = await callClaude(history);
      setUsage(reply.usage || null);
      const next = history.concat([{ role: 'assistant', content: reply.content }]);
      setMessages(next);
      const toolUse = (reply.content || []).find(b => b.type === 'tool_use');
      // A reply cut off at max_tokens can carry a half-written proposal; it is
      // not shown, and the next turn tells the model so (answerToolUses).
      if (reply.stop_reason === 'max_tokens') {
        setError('Claude’s reply ran out of room before it finished. Try asking for less at once.');
      } else if (toolUse && Array.isArray(toolUse.input && toolUse.input.ops)) {
        const priced = priceProposal(toolUse.input.ops);
        setProposal({ toolUseId: toolUse.id, summary: toolUse.input.summary, ops: toolUse.input.ops, ...priced });
      }
      if (reply.stop_reason === 'refusal') {
        setError('Claude declined to answer that. Try rephrasing.');
      }
    } catch (e) {
      setError(e.message);
      setMessages(messages);   // roll back the optimistic user turn
      setProposal(proposal);   // and the proposal it would have declined
    } finally {
      setBusy(false);
    }
  };

  const resolveProposal = (accepted) => {
    if (!proposal) return;
    if (accepted) onApply(proposal.next);
    setMessages(prev => answerToolUses(prev, proposal,
      accepted ? 'The user applied these changes.' : 'The user declined these changes.'));
    setProposal(null);
  };

  // ── Key setup ────────────────────────────────────────────────────────────
  if (!apiKey) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">AI Assistant</h2>
          <p className="text-slate-400 mt-1">Ask about your plan, or describe a change and review it before it lands.</p>
        </div>
        <div className={cardStyle}>
          <h3 className="text-lg font-semibold text-slate-100 mb-3">Connect your Anthropic API key</h3>
          <p className="text-sm text-slate-400 mb-4">
            This app is a static site with no server, so there is nowhere for it to keep an API key on your
            behalf — you bring your own. It is stored in this browser only, under its own key, and is
            <strong className="text-slate-200"> never included in a plan export or a scenario</strong>. Requests go
            straight from this page to <code className="text-amber-400">api.anthropic.com</code> and nowhere else.
          </p>
          <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-4 mb-4 text-sm text-amber-200/90">
            <strong>What leaves your browser.</strong> Turning this on is the first time this tool sends anything
            anywhere. Each message sends your plan — ages, balances, contribution rates, income, and the
            projection summary — to Anthropic's API so the assistant can reason about it. It does not send your
            name, your account numbers, or anything from the Current Year tab. Nothing is sent until you type a
            message, and you can disconnect at any time.
          </div>
          <label className={labelStyle}>API key</label>
          <input
            type="password" value={keyDraft} onChange={e => setKeyDraft(e.target.value)}
            placeholder="sk-ant-..." className={inputStyle} autoComplete="off" spellCheck={false}
          />
          <div className="flex items-center gap-3 mt-4">
            <button
              className={buttonPrimary}
              disabled={!keyDraft.trim()}
              onClick={() => { saveAiKey(keyDraft.trim()); setApiKey(keyDraft.trim()); setKeyDraft(''); }}
            >
              Connect
            </button>
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer"
               className="text-sm text-amber-400 hover:text-amber-300">Get a key →</a>
          </div>
          <p className="text-xs text-slate-500 mt-4">
            Usage is billed to your own Anthropic account. A typical question costs a fraction of a cent;
            the plan is re-sent with every message, so a long conversation costs more than a short one.
          </p>
        </div>
      </div>
    );
  }

  // ── Conversation ─────────────────────────────────────────────────────────
  const shown = messages.filter(m =>
    typeof m.content === 'string' || (Array.isArray(m.content) && m.content.some(b => b.type === 'text')));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">AI Assistant</h2>
          <p className="text-slate-400 mt-1">Every proposed change is shown as a diff, priced by the engine, and applied only when you say so.</p>
        </div>
        <button
          className="text-xs text-slate-400 hover:text-slate-200 border border-slate-600 rounded-lg px-3 py-1.5"
          onClick={() => { saveAiKey(''); setApiKey(''); setMessages([]); setProposal(null); setUsage(null); }}
        >
          Disconnect key
        </button>
      </div>

      <div className={cardStyle}>
        <div ref={scrollRef} className="max-h-[420px] overflow-y-auto space-y-4 pr-1">
          {shown.length === 0 && (
            <div className="text-sm text-slate-500 space-y-2">
              <p>Try:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>“Why does my plan run out of money at 88?”</li>
                <li>“Raise my 401(k) deferral to 12% and show me what it does.”</li>
                <li>“Add a $40,000 one-time expense at 62 for a new roof.”</li>
                <li>“What happens if I retire two years earlier?”</li>
              </ul>
            </div>
          )}
          {shown.map((m, i) => {
            const text = typeof m.content === 'string'
              ? m.content
              : m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
            const mine = m.role === 'user';
            return (
              <div key={i} className={mine ? 'text-right' : ''}>
                <div className={`inline-block text-left max-w-[85%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  mine ? 'bg-amber-600/20 border border-amber-500/30 text-amber-100'
                       : 'bg-slate-900/60 border border-slate-700/50 text-slate-200'}`}>
                  {text}
                </div>
              </div>
            );
          })}
          {busy && <div className="text-sm text-slate-500">Thinking…</div>}
        </div>

        {error && (
          <div className="mt-4 bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <input
            type="text" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ask about your plan, or describe a change…"
            className={inputStyle} disabled={busy}
          />
          <button className={buttonPrimary} disabled={busy || !input.trim()} onClick={() => send(input)}>Send</button>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <button className="hover:text-slate-300 underline decoration-dotted"
                  onClick={() => setShowPayload(v => !v)}>
            {showPayload ? 'Hide' : 'Show'} exactly what gets sent
          </button>
          {usage && (
            <span>
              last turn: {usage.input_tokens?.toLocaleString()} in / {usage.output_tokens?.toLocaleString()} out
            </span>
          )}
        </div>
        {showPayload && (
          <pre className="mt-3 max-h-64 overflow-auto text-[11px] text-slate-400 bg-slate-950/60 border border-slate-700/50 rounded-lg p-3">
{JSON.stringify(context, null, 1)}
          </pre>
        )}
      </div>

      {proposal && (
        <div className="bg-gradient-to-br from-emerald-900/20 to-slate-900/80 border border-emerald-500/30 rounded-xl p-6 shadow-xl">
          <h3 className="text-lg font-semibold text-slate-100">Proposed change</h3>
          <p className="text-sm text-slate-300 mt-1">{proposal.summary}</p>

          <div className="mt-4 space-y-2">
            {proposal.diff.map((d, i) => (
              <div key={i} className={`rounded-lg border px-3 py-2 text-sm ${
                d.valid ? 'bg-slate-900/60 border-slate-700/50' : 'bg-red-900/20 border-red-500/30'}`}>
                <div className={d.valid ? 'text-slate-200' : 'text-red-300'}>{d.summary}</div>
                {d.reason && <div className="text-xs text-slate-500 mt-0.5">{d.reason}</div>}
                {d.warnings && d.warnings.map((w, j) => (
                  <div key={j} className="text-xs text-amber-400 mt-1">⚠ {w}</div>
                ))}
              </div>
            ))}
          </div>

          {/* The consequence, from the engine. The model's account of what its
              own change does is not evidence; this is. */}
          {proposal.preview && !proposal.preview.failed && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-3">
                <div className="text-xs text-slate-500">Ending portfolio</div>
                <div className="text-sm text-slate-300">{formatCurrency(proposal.preview.endingBefore)} → <span className={
                  proposal.preview.endingAfter >= proposal.preview.endingBefore ? 'text-emerald-400' : 'text-red-400'
                }>{formatCurrency(proposal.preview.endingAfter)}</span></div>
              </div>
              <div className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-3">
                <div className="text-xs text-slate-500">Lifetime tax</div>
                <div className="text-sm text-slate-300">{formatCurrency(proposal.preview.taxBefore)} → <span className={
                  proposal.preview.taxAfter <= proposal.preview.taxBefore ? 'text-emerald-400' : 'text-red-400'
                }>{formatCurrency(proposal.preview.taxAfter)}</span></div>
              </div>
              <div className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-3">
                <div className="text-xs text-slate-500">Money runs out</div>
                <div className="text-sm text-slate-300">
                  {proposal.preview.breaksBefore ? `age ${proposal.preview.breaksBefore}` : 'never'}
                  {' → '}
                  <span className={proposal.preview.breaksAfter ? 'text-red-400' : 'text-emerald-400'}>
                    {proposal.preview.breaksAfter ? `age ${proposal.preview.breaksAfter}` : 'never'}
                  </span>
                </div>
              </div>
            </div>
          )}
          {proposal.preview && proposal.preview.failed && (
            <div className="mt-4 text-sm text-red-300">
              The proposed plan could not be projected ({proposal.preview.failed}) — don't apply it.
            </div>
          )}

          <div className="flex items-center gap-3 mt-5">
            <button
              className={buttonPrimary}
              disabled={!proposal.diff.some(d => d.valid) || (proposal.preview && proposal.preview.failed)}
              onClick={() => resolveProposal(true)}
            >
              Apply {proposal.diff.filter(d => d.valid).length} change{proposal.diff.filter(d => d.valid).length === 1 ? '' : 's'}
            </button>
            <button className={buttonSecondary} onClick={() => resolveProposal(false)}>Discard</button>
            {!proposal.ok && (
              <span className="text-xs text-amber-400">
                Some operations were rejected and will be skipped.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
          a: "Social Security is modeled as an income stream starting at your specified claiming age. The annual amount grows by the COLA % each year (default 2-3%). IMPORTANT: SSA statements quote your benefit in today's dollars — check the stream's \"Today's $\" box so the amount is indexed by COLA between now and your claiming age (a $48,000 benefit claimed in 14 years becomes ~$63,000 nominal). Leave it unchecked only if you entered the future nominal amount yourself. The PIA (Primary Insurance Amount) field is used by the Social Security analysis tab to model different claiming ages. Social Security benefits are taxed progressively using IRS combined income thresholds — 0%, up to 50%, or up to 85% may be taxable depending on your total income (see the Taxes & Roth tab for details)."
        },
        {
          q: "How are pension and other income streams handled?",
          a: "All income streams (pension, rental, business, annuity, other) work the same way: they pay the specified annual amount, adjusted by COLA each year, between the start and end ages. By default the amount is what you'll receive in the FIRST year of the stream (COLA compounds from the start age). For a stream that starts years from now and was quoted in today's dollars — like today's market rent on a future rental — check \"Today's $\" so COLA compounds from today and the amount is indexed up to the start age. All non-Social Security income is treated as 100% taxable."
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
          a: "Pre-Tax accounts (401k, Traditional IRA, 403b, 457b): employee contributions are deducted from taxable income as an above-the-line deduction, withdrawals are fully taxable as ordinary income, and Required Minimum Distributions begin at age 73 or 75 depending on your birth year (SECURE 2.0: born 1951-1959 start at 73, born 1960 or later at 75). Withdrawals before age 59.5 also carry the 10% early withdrawal penalty unless an exception applies — see the early retirement question below. Roth accounts (Roth 401k, Roth IRA, Roth 457b): withdrawals are tax-free and no RMDs are required. Brokerage accounts: each account carries its own cost basis percentage, so only the gain portion of a withdrawal is taxed, at long-term capital gains rates (0%/15%/20%) rather than ordinary rates. Brokerage accounts also generate taxable dividends each year (2% of the balance by default) whether or not you sell anything. HSA withdrawals are treated as tax-free qualified medical spending."
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
          q: "What happens if I retire before 59½?",
          a: "Pre-tax withdrawals (401k, Traditional IRA, 403b) taken before age 59½ normally carry a 10% federal penalty on top of ordinary income tax — IRC §72(t). The projection applies it, and the withdrawal solver grosses up for it, so your spending target is still met (you just deplete the portfolio faster). Three exceptions are modeled: (1) Governmental 457(b) plans are exempt at any age, so 457(b) withdrawals are never penalized. (2) The 'rule of 55' — if you separate from your employer in or after the year you turn 55, distributions from THAT employer's 401(k)/403(b) are exempt; the projection applies this automatically when your retirement age is 55+ and the account type is 401k or 403b. Note it does NOT apply to IRAs, so if you rolled the money to an IRA, enter it as a Traditional IRA and the penalty will correctly apply. (3) A 72(t) SEPP plan — check the box under Withdrawal Priority. Because ages are whole years while the threshold falls mid-year, the year you are 59 is treated as half penalized. The Roth 5-year conversion clock is modeled too: converted dollars drawn within five tax years of the conversion, before 59½, carry the same 10% additional tax. Not modeled: exceptions for disability, death, large medical expenses, health insurance while unemployed, first home, education, or birth/adoption; and state-level early-distribution penalties such as California's extra 2.5%."
        },
        {
          q: "What is the standard deduction?",
          a: "The standard deduction is subtracted from your gross income before calculating taxes. 2026 base amounts: Single $16,100, Married Filing Jointly $32,200, Married Filing Separately $16,100, Head of Household $24,150. These amounts are adjusted upward each year by the inflation rate you specify. Two extra deductions apply once you turn 65, and the projection applies both automatically. (1) The additional standard deduction for age 65+ (IRC §63(f)): $2,050 per person for Single/Head of Household, $1,650 per person if married — permanent, and inflation-adjusted like the base amount. (2) The 'senior deduction' created by the 2025 OBBBA tax law: $6,000 per person age 65+, on top of the standard deduction. It is NOT inflation-adjusted, it phases out at 6% of MAGI above $75,000 (Single) / $150,000 (Married Filing Jointly) — disappearing entirely at $175,000 / $250,000 — and under current law it applies only to tax years 2025 through 2028. The projection models that expiry, so you will see the deduction drop starting in 2029 unless Congress extends it. The Tax Year Snapshot shows the exact deduction used for any year."
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
          q: "How do the withdrawal strategies decide what I spend?",
          a: "Two of the seven start from spending: the spending target (the default) and Guyton-Klinger guardrails, which move that target by rule. The plan finds the withdrawal that pays for it. The other five start from the withdrawal: the 4% rule, a fixed percentage, the RMD method, Vanguard dynamic spending and VPW each set a year's gross withdrawal from the portfolio, and your spending is what that withdrawal delivers after its tax, plus your Social Security, pensions and other income after theirs. Healthcare, care, recurring and one-time expenses are paid on top, the same as under a target. A salary still being earned (a spouse who works on after you retire, or the last paychecks of a mid-year retirement) is treated as it is under a target: it pays toward that spending first, and the portfolio draws only the rest. So those years spend what the strategy would let you spend with no salary at all, and the portfolio is left to grow while the paychecks last."
        },
        {
          q: "How long does the plan assume we live?",
          a: "As long as your Planning / Legacy Age on About you (95 unless you change it). That is the age the money has to last to, and under the field the app shows the odds of anyone reaching it, from US population life tables (CDC, 2022): for a couple both 65, about a 64% chance at least one of you is alive at 87, 47% at 90 and 19% at 95. For a couple, survivor modelling uses your two life expectancies to decide who is likely to die first, and when: that death ends their income and changes the household's Social Security and taxes. Whoever outlives the other is then planned through the planning age, not only to their own life expectancy, because a life expectancy is an average and about half of people outlive theirs. (Until v2.65 the plan stopped at the second life expectancy, which for the default couple meant age 87.) The Will it last? simulations can instead draw a lifespan for each person in each simulated life, around your life expectancies, and judge the money to the end of each one."
        },
        {
          q: "Will Social Security pay what it promises?",
          a: "Not in full, unless Congress acts. The 2026 Trustees Report projects that the retirement and survivors trust fund (OASI) runs out in late 2032. From then on, by law, benefits can only be paid from Social Security's incoming taxes, which would cover about 78% of what is scheduled. If the retirement and disability funds were combined, the money would last into 2034 and then cover about 83%. The share would shrink slowly after that, to roughly 62–65% by 2100. Congress has always acted before a fund ran out, which is why the plan assumes full benefits unless you choose otherwise under About you → Social Security's Trust Fund (or try it in the What if… box under Strategy). Choosing a cut lowers every Social Security payment in the plan from that year on, survivor benefits included, and the portfolio makes up the difference. A flat cut is a planning simplification of the Trustees' slowly shrinking share."
        },
        {
          q: "Which accounts are withdrawals taken from?",
          a: "Withdrawals follow the priority order you set in Personal Info (under Withdrawal Priority). The default is: Pre-Tax first, then Brokerage & HSA, then Roth. Pre-tax withdrawals are fully taxable, brokerage withdrawals use a 50% cost basis estimate taxed at capital gains rates, and Roth withdrawals are tax-free. You can drag to reorder the priority — for example, drawing from Roth first to keep taxable income low in early retirement. The 'Fill a tax bracket' setting under the same heading layers bracket management on top of the order: each retirement year, spending comes from pre-tax first until ordinary taxable income reaches the top of the bracket you chose, then from the rest of the order, and pre-tax is drawn past the bracket only if the other accounts run out. A Roth conversion set to fill a higher bracket picks up from where those withdrawals stop."
        },
        {
          q: "How are expenses dated before I retire handled?",
          a: "An expense with a date range that starts before your retirement age is on top of your ordinary living costs, which your salary is assumed to cover. So it is funded the way most households actually fund one: first by pausing that year's retirement saving, and then — if the expense is larger than what you were contributing — by withdrawing from the portfolio, grossed up for income tax and for the 10% early withdrawal penalty if you are under 59½. The year-by-year table shows how much saving was paused. Healthcare is deliberately excluded from this: before 65 while you are still working, coverage is normally through your employer and paid from salary, so it is not treated as a portfolio cost. Note the projection does not model your CURRENT spending, so it cannot tell whether you would really cut saving or cut spending — pausing contributions is the assumption, and it is the conservative one for your retirement balance."
        },
        {
          q: "What if my portfolio runs out?",
          a: "The projection stops withdrawing once the accounts are empty: the year-by-year table shows the portfolio at $0, the withdrawal drops to what was actually available, and the shortfall — the spending your portfolio could not fund — appears in red under the Portfolio Draw column. Net income falls to whatever guaranteed income (Social Security, pension) still provides. That is a signal to reduce spending, work longer, save more, delay Social Security, or adjust the plan."
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
          a: "The 'bridge years' — the gap between retirement and RMDs — are the textbook window for Roth conversions, and the tool uses these as smart defaults. Start age defaults to your retirement age (the year your earned income ends and bracket room opens up). End age defaults to the year before RMDs start (age 71 if born ≤1950, age 72 if born 1951-1959, age 74 if born 1960+ — per SECURE 2.0). The strategy editor on the Taxes & Roth tab shows the calculated default below each age input and offers a one-click reset button if your saved values differ. The SS Claim Analysis tab also warns when your window is narrower than the standard bridge years, since missed bridge years are missed cheap conversion opportunities."
        },
        {
          q: "Where do the taxes on Roth conversions come from?",
          a: "You can choose the tax payment source in your Roth conversion strategy on the Taxes & Roth tab. The default ('Normal Withdrawal Priority') pays conversion taxes the same way as any other withdrawal — from your accounts in priority order. The 'Pay from Brokerage' option estimates the marginal tax on the conversion amount and withdraws that amount from your largest brokerage account, leaving your pre-tax and Roth accounts untouched for the conversion itself. Paying from brokerage is often the more efficient strategy — it maximizes the dollars moved to Roth without also depleting a pre-tax account for taxes."
        },
        {
          q: "When should I consider Roth conversions?",
          a: "The gap years between retirement and RMDs (or SS) are often ideal — your taxable income is low, so conversions are taxed at lower brackets. Converting reduces future RMDs and grows tax-free in Roth. The Taxes & Roth tab models this year-by-year — set a strategy there and it shows what it saves against converting nothing. The tradeoff is paying taxes now vs. later. The Social Security Claim Analysis tab additionally shows how SS timing affects how much room you have for cheap conversions — claiming SS earlier fills your brackets faster and reduces conversion opportunities."
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
          a: "Net Lifetime Wealth is your portfolio value at your legacy age. Social Security is already reflected in it: every benefit dollar received reduced a portfolio withdrawal dollar for dollar, so it shows up as a higher remaining balance. Adding Lifetime SS on top would count those dollars twice and bias the ranking toward late claiming — Lifetime SS is shown as its own column for reference, not folded into this number."
        },
        {
          q: "What does the CAGR sensitivity slider do?",
          a: "The slider (±3% in 0.5% increments) adjusts every account's CAGR by the chosen delta and re-runs the full claiming-age grid. This addresses a critical insight: the optimal SS claim age depends heavily on assumed portfolio growth. Higher growth makes claiming early more attractive (keeping more money invested), while lower growth favors delaying (capturing SS's guaranteed 8%/year delayed-retirement credits). Move the slider to see how the winner shifts. The flip-point is often somewhere between 6% and 10% nominal returns, and finding yours is more valuable than relying on a single deterministic baseline."
        },
        {
          q: "What does the Monte Carlo stress test toggle do?",
          a: "When enabled, each claiming scenario is run through N simulations (50-500 selectable) and ranked by success rate — the percentage of simulations where the portfolio survives — instead of a single deterministic outcome. Three things vary per simulation: returns (each year draws its own Normal(mean, σ), so sequence-of-returns risk is captured), lifespan (drawn from a CDC mortality table centered on your life-expectancy inputs, and the dominant variable in this decision), and inflation (with Social Security re-indexed to each run's drawn inflation, since it is the only CPI-indexed asset in the plan — this is what prices delayed claiming as an inflation hedge). New columns appear: Success Rate, p10 Portfolio (the unlucky case) and p50 (median). Every scenario replays the identical draws (common random numbers), so differences between cells reflect the claiming age rather than sampling luck. Limitations: all accounts share each year's return draw, so asset-class diversification is not modeled; lifespans are drawn independently per spouse, ignoring the real correlation between them; and SS re-indexation matches the level of a run's inflation, not its year-by-year path."
        },
        {
          q: "How does Roth conversion strategy affect SS claim timing?",
          a: "If you have Roth conversions enabled (Taxes & Roth → Your Roth conversion strategy), the analysis automatically reflects them in every claiming scenario. Earlier SS claims push more income into your tax brackets during the conversion years, leaving less room for cheap bracket-fill conversions. Later claims open a wider bridge-year window for conversions at lower marginal rates. The Full Plan Impact banner shows the actual range of lifetime conversions across all scenarios, and the ranking table includes a 'Roth Conv.' column when conversions are active. The standard 'bridge years' conversion window is retirement age through the year before RMDs start — the tool uses your retirement age and SECURE 2.0 RMD age to suggest these defaults."
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
          a: "If you claim SS before Full Retirement Age (FRA) and are still earning above the annual limit ($24,480 in 2026, inflation-adjusted), $1 of SS benefits is withheld for every $2 earned above the limit. In the year you reach FRA, the limit is higher ($65,160 in 2026) and only $1 per $3 is withheld. After FRA there is no limit. The model automatically applies this reduction to any year where you are collecting SS, earning income, and below FRA. Note: SSA recalculates your benefit upward at FRA to credit the withheld months, but the cash flow impact during those years is real and affects portfolio withdrawals."
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
          q: "Can I model an annuity, a SPIA or a QLAC?",
          a: "Yes — add an income stream of type Annuity. For one you already own, enter the annual payout and its start and end ages. For one the plan should buy, also enter the premium, the purchase age and where the money comes from: pre-tax money moves as an untaxed rollover and every payment is ordinary income (a deferred start makes it a QLAC, so the premium leaves the RMD base until payments begin and the QLAC premium limit and the age-85 start rule are checked); brokerage money is sold at the account's cost basis with the gain taxed in the purchase year, and each payment then excludes a return-of-premium share until the premium is recovered (the Pub 939 exclusion ratio); Roth money moves tax-free. The modal quotes a representative payout rate for the shape you entered — single or joint life, immediate or deferred, level or escalating — priced from the app's own life table; use it as a starting point and replace it with your insurer's figure. A joint-and-survivor election continues the payout for the surviving spouse at the rate you choose."
        },
        {
          q: "How is long-term care modeled?",
          a: "Two ways. The plan itself uses a fixed window: under Personal Info → Long-Term Care, 'Default' bills 28 months of assisted living at the Genworth 2024 median for each of you in the final months before your life expectancy, 'Custom' lets you set the months and monthly cost, and 'Stress' gives whichever of you is planned to live longer five years of nursing-home care and the other none — the worst realistic case. Long-term care is billed whichever healthcare model you chose. Will it last? (thousands of markets) can instead draw a different episode for every run ('Vary long-term care too'): about 70% of people need some paid care after 65, a typical episode is two years, one in five runs past five years, and the setting is drawn between home care, assisted living and a nursing home. The results then show how often care was drawn, what it cost, and the plan's success rate with care against without — the number that says whether long-term care insurance is worth its premium for you."
        },
        {
          q: "What are the limitations of Monte Carlo?",
          a: "The simulation assumes returns follow a normal (bell curve) distribution, but real markets have 'fat tails' - extreme events happen more often than the model predicts. It also assumes returns are independent year-to-year (no momentum or mean reversion). Sequence of returns risk may be underestimated. By default each account is simulated around its own CAGR with the volatility that rate implies on a stock/bond line (7% reads as all stock, 3.5% as all bond), and one market shock a year moves every account together — accounts get no diversification credit against each other, which is the conservative reading. Switch to 'One return for every account' to test a single return assumption instead. Use results as a guide, not a guarantee."
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
          q: "Does the stress test use the same tax calculations as the rest of the plan?",
          a: "Yes. Each scenario is your whole plan run through the same projection engine as every other screen, with that scenario's historical returns put in place of your expected ones for the early retirement years — the same tax brackets, IRMAA, Social Security taxation, RMDs, conversions and withdrawal solver. (An early version estimated tax with a simplified marginal rate; that was replaced, so a stress-test year and the same year on the Dashboard differ only by the returns.)"
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
      category: "Current Year Tax Detail",
      items: [
        {
          q: "What is the Current Year tab for?",
          a: "Decisions with a December 31 deadline. The rest of this app projects decades; that horizon cannot tell you whether to send your next paycheck's deferral to traditional or Roth, whether to raise withholding, or whether you are about to cross a threshold that costs more than your tax bracket suggests. This tab builds a projected Form 1040 for the year in progress, at real line-number granularity, so you can act on it and later reconcile it against the return you actually file."
        },
        {
          q: "Why does it ask for a paystub instead of my salary?",
          a: "A paystub carries year-to-date totals in its own columns, so one recent stub per employer pins everything you have earned, deferred and withheld so far. Only the remaining pay periods have to be projected — and those are the only part you can still change. It also separates W-2 Box 1 from Box 3/5, which a single salary figure cannot."
        },
        {
          q: "Why does Box 1 matter so much?",
          a: "Traditional 401(k) deferrals reduce Box 1 (federal taxable wages) but NOT Box 3/5 (Social Security and Medicare wages). Section 125 health premiums and payroll HSA contributions reduce both. Roth deferrals reduce neither. That asymmetry is the whole traditional-versus-Roth question: deferring saves income tax and never saves FICA, so the comparison is against your future income-tax rate alone."
        },
        {
          q: "Why is my marginal rate higher than my tax bracket?",
          a: "Because a bracket is only part of what the next dollar costs. The tool measures your marginal rate by computing the entire return twice and taking the difference, so it picks up the 3.8% net investment income tax, the SALT deduction phasing out at 30 cents per dollar of income, the Section 199A deduction shrinking through its phase-in range, the 0.5%-of-AGI charitable floor rising, and the 0.9% additional Medicare tax. In some income bands these stack to a marginal rate ten points or more above the bracket — and then fall back once the phase-outs finish. None of that is visible in a bracket table."
        },
        {
          q: "Why does my K-1 income not increase how much I can defer?",
          a: "Retirement plan contributions require EARNED income. A passive partnership interest produces investment income, not compensation, so it opens no 401(k), SEP or solo-401(k) capacity however large it is. The Section 402(g) limit is also per person per year, not per account: traditional and Roth share one limit, and a second employer's plan shares it too."
        },
        {
          q: "What does 'passive' mean on a K-1, and why does the tool ask?",
          a: "Material participation is a specific test under IRC Section 469. If you do not materially participate, the income is passive: it carries the 3.8% net investment income tax under Section 1411, and any loss can only offset other passive income rather than your wages. If you do materially participate, the income escapes that surtax. The tool defaults to passive because that is both the common case for an interest held as an investment and the conservative assumption — but it is worth confirming with your preparer, because it is worth 3.8%."
        },
        {
          q: "Why does it show income I never received?",
          a: "A partner is taxed on their distributive share of partnership income whether or not cash was distributed. When the taxable share exceeds the cash, the difference is often called phantom income, and the tax on it has to be funded from somewhere else. The tool reports both figures and the gap between them."
        },
        {
          q: "It says I should itemize, but I always take the standard deduction.",
          a: "The SALT cap rose from $10,000 to $40,400 for 2026 under the One Big Beautiful Bill Act. For anyone paying meaningful state income and property tax, that alone can move the answer. The tool computes both figures every time and tells you which is larger, rather than assuming."
        },
        {
          q: "What is the safe harbor, and why does it want last year's return?",
          a: "Under IRC Section 6654 you avoid an underpayment penalty by paying the LESSER of 90% of this year's tax or 100% of last year's (110% if last year's AGI topped $150,000). The prior-year test is usually the cheaper one and is the only one you can compute with certainty before the year ends — which is why two lines off last year's Form 1040, AGI and total tax, are worth entering. Note that withholding counts as paid evenly across the year no matter when it is withheld, so raising withholding in December can cure a shortfall that a Q4 estimated payment cannot."
        },
        {
          q: "What does 'Use these figures in the 40-year plan' do?",
          a: "Year one of the long-range projection is normally a synthetic year built from a single salary figure — it cannot see a K-1, an itemized deduction, or what you have actually withheld. Switching this on replaces that first year's income taxes with the return on this tab, and gives the Medicare IRMAA lookback a real MAGI two years out instead of a reconstructed one. Only the first year changes; every later year is still a forecast and is untouched. Social Security and Medicare tax stay on the plan's own calculation, because the withdrawal engine reads that figure while it works. The tool shows you both numbers and the difference between them rather than quietly swapping one for the other."
        },
        {
          q: "Why did it say the detailed figures were not applied?",
          a: "The override stands down when the year includes a portfolio withdrawal or a Roth conversion. The return on this tab is built from paystubs and K-1s, so it does not know about a draw the withdrawal engine decided on, and its tax would be short by exactly the tax on that draw. Rather than patch a partial figure, the tool declines and tells you why. In practice this means the feature applies to working years and steps aside once you are drawing from the portfolio."
        },
        {
          q: "What is NOT modeled here?",
          a: "The alternative minimum tax; the child tax credit and other dependent credits; RSU and ESPP vest timing; multi-state K-1 sourcing, nonresident filings and composite returns; the at-risk limitation of Section 465; the annualized income installment method for Section 6654 (which can matter when income lands unevenly across the year); state-level estimated payment penalties; and the Roth 5-year clocks. Amounts shown are projections from the figures you enter, not tax advice — check anything consequential with your preparer."
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
          a: "Use the Import/Export button in the header to download a JSON backup file. This file contains all your personal info, accounts, income streams, recurring expenses, one-time events, assets, and visibility settings — and, if you have filled in the Current Year tab, your year-to-date wages, deferrals, withholding and K-1 figures. Treat an exported file with that in mind: it is ordinary financial detail, not encrypted, and it sits wherever your browser puts downloads. You can import it later to restore your data, or move it to another device."
        },
        {
          q: "How do I clear my data for sharing?",
          a: "Use Import/Export → 'Clear My Data' to reset everything to sample defaults. This removes your personal data from the browser. Export a backup first if you want to restore your data later."
        },
        {
          q: "Does the AI Assistant send my plan anywhere?",
          a: "Yes — and it is the only part of this tool that sends anything anywhere. With the assistant disconnected (the default), nothing leaves your browser. Connect an Anthropic API key and each message you send transmits your plan — ages, balances, contribution rates, income streams, expenses, and a summary of the projection — to Anthropic's API so the assistant can reason about it. It does not send your name, account numbers, or anything from the Current Year tab. The 'Show exactly what gets sent' link on that tab displays the payload verbatim before you send anything. Nothing is transmitted until you type a message, and 'Disconnect key' ends it."
        },
        {
          q: "Where does the AI Assistant keep my API key?",
          a: "In this browser's localStorage, under its own separate entry — deliberately NOT in the plan. It is never written into a plan export, never copied into a scenario, and never sent anywhere except api.anthropic.com as the authentication header on your own requests. Because this app is a static site with no server, there is nowhere for it to hold a key on your behalf; bringing your own is the only architecture that does not put a shared key in a public repository. Usage bills to your own Anthropic account."
        },
        {
          q: "Can the AI Assistant change my plan on its own?",
          a: "No. The assistant can only propose changes; it cannot write to your plan, cannot run the projection engine, and cannot touch storage. What it emits is a patch, which the engine validates against the plan's real field list — a field that does not exist is rejected rather than silently created, and ids are assigned by the app, not chosen by the model. Valid changes are shown to you as a before/after diff, with the effect on ending portfolio, lifetime tax and whether the plan runs out of money computed by the same engine that produces every other number here. Nothing is applied until you press Apply."
        }
      ]
    },
    {
      category: "Limitations & Disclaimers",
      items: [
        {
          q: "What are the main limitations of this tool?",
          a: "What it leaves out or simplifies: The year-by-year projection takes the standard deduction every year (plus the age-65 addition and the 2025–2028 senior deduction); itemizing — mortgage interest, state and local tax, charity under the 2026 rules (the 0.5%-of-AGI floor and the 35% benefit cap) — is modeled only for this year, on the Current Year tab's tax return. QCDs are modeled separately as an exclusion from income. Each account grows at the single rate you give it: there is no separate asset allocation, rebalancing or fee drag, so net any fees out of that rate. Brokerage cost basis defaults to 50% of each account's balance unless you set it on the account. Contributions above the 2026 IRS limits are flagged with a warning, not trimmed. There is no tax-loss harvesting, no estate or gift tax, and no state-level early-distribution penalty (such as California's extra 2.5%). What it models: federal income tax on 2026 brackets indexed forward; state income tax for every state — progressive brackets for 25 states and DC, a flat rate where the state's tax is flat, nothing where there is none — including each state's treatment of Social Security and retirement income; FICA; long-term capital gains at 0/15/20%, qualified dividends and the 3.8% NIIT; Medicare IRMAA (Part B and D) on the two-year lookback; ACA premium subsidies before 65; Social Security taxation, the earnings test and survivor benefits; RMDs under SECURE 2.0; the 10% early-withdrawal penalty with the 457(b), rule-of-55 and 72(t) exceptions; Roth accounts tracked in layers so the 5-year clock and ordering rules apply; Roth conversions by fixed amount, bracket fill, IRMAA tier or a staged schedule, with a pre-tax floor and an optional pause after bad years; withdrawal order with an optional bracket fill; QCDs and charitable giving; pensions, annuities and QLACs; HSAs; healthcare and long-term care; one-time events and recurring expenses; and Monte Carlo (sampled or replayed from history), specific-crash stress tests and sensitivity analysis — all through the same projection engine. Results are estimates for planning, not tax or investment advice."
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

