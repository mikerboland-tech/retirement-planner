// ── PALETTE ──────────────────────────────────────────────────────────────────
// One place where a thing gets its colour, so the same entity looks the same on
// every chart, table and tile. Before this file the app carried 60 hardcoded hex
// values across 15 Tailwind colour families, and the same hue meant different
// things in different places: pre-tax money was gold in one chart and
// amber-orange in another, and three DIFFERENT oranges sat next to each other in
// the tax chart meaning "voluntary withdrawal", "RMD" and "conversion tax".
//
// The governing rule is that COLOUR FOLLOWS THE ENTITY, NOT THE SLOT. A series
// keeps its hue when other series are filtered away, and a reader can learn what
// blue means because blue always means the same thing.
//
// Every categorical set below was checked with a contrast/colour-vision
// validator against its own surface rather than by eye, on the pair list the
// chart actually renders — for a stack or a bar group that is the ADJACENT
// pairs, since those are the ones that touch. The measured worst cases are
// recorded next to each set; tests/run-tests.cjs re-derives them so a future
// edit that breaks one fails the suite instead of shipping.
//
// The failure this replaces, measured on the old palette: "RMD (mandatory)" and
// "Portfolio Withdrawal (voluntary)" — two adjacent segments of the same stacked
// bar, and the single most important distinction on that chart — sat at a
// normal-vision ΔE of 4.2. Not a colour-blindness problem. Nobody could tell
// them apart.

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.PlannerTheme = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {

  // The eight categorical hues, stepped once for each surface. The dark column
  // is the same eight hues re-stepped for a dark ground, NOT an automatic
  // lightening: a colour that reads correctly on white glows on near-black.
  const SLOTS = {
    blue:    { dark: '#3987e5', light: '#2a78d6' },
    orange:  { dark: '#d95926', light: '#eb6834' },
    aqua:    { dark: '#199e70', light: '#1baf7a' },
    yellow:  { dark: '#c98500', light: '#eda100' },
    magenta: { dark: '#d55181', light: '#e87ba4' },
    green:   { dark: '#008300', light: '#008300' },
    violet:  { dark: '#9085e9', light: '#4a3aa7' },
    red:     { dark: '#e66767', light: '#e34948' },
  };

  // Entities, mapped to slots. TWO constraints, in this order:
  //
  //   1. What the colour MEANS to someone thinking about money. Earned income is
  //      green because earnings are green. Social Security is blue. Roth is
  //      green because it is the most prized dollar in the plan. Money leaving
  //      for the IRS is red. A conversion — a transfer, not income — is violet.
  //      A palette that ignores this is learnable only by memorising a legend.
  //
  //   2. Measured separation on the pairs that actually touch. Semantics choose
  //      the hue; the validator decides whether that choice is legal, and where
  //      it is not, the FREE slots move rather than the meaningful ones.
  //
  // The first pass of this file honoured only constraint 2 and produced blue
  // earned income and orange Social Security — separable, and meaningless.
  //
  //   Balance sheet   preTax / roth / brokerage / nonLiquid
  //     worst adjacent pair: yellow↔aqua, CVD ΔE 8.4 dark / 9.1 light,
  //     normal-vision 19.8 dark / 22.9 light.
  //
  //   Income and flows  earned → socialSecurity → pension → otherIncome →
  //     withdrawalVoluntary → rmd → rothConversion → conversionTaxDraw
  //     worst adjacent pair: yellow↔aqua, CVD ΔE 8.4 dark / 9.1 light,
  //     normal-vision 19.3 dark / 19.6 light.
  const SERIES = {
    // ── Balance sheet ──────────────────────────────────────────────────────
    preTax:    SLOTS.blue,    // taxed on the way out
    roth:      SLOTS.aqua,    // green — the most prized dollar in the plan
    brokerage: SLOTS.yellow,  // gold, the flexible middle bucket
    nonLiquid: SLOTS.violet,  // not spendable

    // ── Income and flows, in the order they stack ──────────────────────────
    earnedIncome:        SLOTS.green,    // earnings are green
    socialSecurity:      SLOTS.blue,     // the government cheque
    pension:             SLOTS.orange,
    otherIncome:         SLOTS.aqua,
    withdrawalVoluntary: SLOTS.yellow,   // gold, same as the brokerage it mostly comes from
    rmd:                 SLOTS.magenta,  // stands apart: this one is not your choice
    rothConversion:      SLOTS.violet,   // a transfer, not income
    conversionTaxDraw:   SLOTS.red,      // money leaving for the IRS
  };

  // Tax-bracket thresholds are a MAGNITUDE, not an identity — 12% then 22% then
  // 24% then 32% is a ramp, and a ramp gets one hue light-to-dark. They used
  // four saturated hues from the categorical space (green, yellow, orange, red),
  // which both read as a traffic light nobody intended and stole four hues that
  // the bars underneath were also using. As reference lines they should also sit
  // BEHIND the data, so the ramp is deliberately lower in chroma than the series
  // above.
  const BRACKET_RAMP = {
    dark:  ['#5b6b82', '#8496b0', '#aebfd6', '#e2eaf5'],
    light: ['#a9b4c2', '#7c8ba1', '#4f5f78', '#22304a'],
  };

  // A distribution is a magnitude, not a set of categories. The percentile bands
  // used five saturated hues running green→red, which said two wrong things at
  // once: that the five bands are unrelated things, and that the 10th percentile
  // is a failure rather than simply the low end of a range. One hue, stepped by
  // distance from the median, says the true thing — these are the same quantity
  // seen at different confidence.
  //
  // Ordered p10, p25, p50, p75, p90, so the median is the most prominent step
  // and the tails recede symmetrically on both sides.
  const DISTRIBUTION_RAMP = {
    dark:  ['#2b4a68', '#356e9e', '#4a90d9', '#356e9e', '#2b4a68'],
    light: ['#c3d7ec', '#7ba7d4', '#2a78d6', '#7ba7d4', '#c3d7ec'],
  };

  // Lines drawn ON TOP of a stacked bar chart cannot compete on hue. Measured on
  // the income-vs-spending chart, the eight stacked bars occupy a tight
  // lightness band (OKLab L 0.53–0.67 in dark mode), and every hue the palette
  // owns is already spoken for inside it — the old red spending line sat at
  // ΔE 2.4 from the pension bar it crossed, and the red spending line and the
  // dark-red tax line were ΔE 6.1 from EACH OTHER. Three lines, effectively one
  // colour, over bars they disappeared into.
  //
  // So the lines get their own tier: they live ABOVE the whole bar band in dark
  // mode and BELOW it in light mode, separating from the bars on lightness,
  // which is the one channel the bars leave free. Hue then only has to carry
  // meaning, not separation — and each line still ships a distinct dash pattern,
  // because a light green and a light amber are close under deuteranopia no
  // matter how they are chosen.
  //
  // target      — the threshold to clear. Deliberately neutral: desired spending
  //               is a reference, not a failure, and red said otherwise.
  // netAfterTax — what actually reaches your pocket. Green, per the house rule
  //               that money that is yours is green.
  // taxBurden   — money leaving. Amber rather than red so it does not collide
  //               with the conversion-tax-draw bar, which is itself a red.
  const LINES = {
    target:      { dark: '#f1f5f9', light: '#0b1b2b' },
    netAfterTax: { dark: '#7fe3b0', light: '#14523a' },
    taxBurden:   { dark: '#f6c177', light: '#722a00' },
  };

  // The same hue has to do three different jobs, and they do not have the same
  // bar. As a bar fill or a chart stroke a series colour needs 3:1 against the
  // chart surface, which every slot above clears. As TEXT — a bold figure tinted
  // to say "this number belongs to that line" — it needs 4.5:1, and measured
  // against the card it sits on, ELEVEN of the sixteen slot values fail. Painting
  // a series colour as a label is a category error, not a one-off mistake, so the
  // fix is a text-safe stepping rather than a patched call site.
  //
  // Each ink is its own slot moved toward the ground's opposite until it clears
  // the bar — the hue is preserved, so the tinted number still visibly belongs to
  // its line, it is simply legible now. Several are unchanged because they already
  // passed.
  const SLOT_INK = {
    blue:    { dark: '#4d93e8', light: '#2872cb' },
    orange:  { dark: '#df7247', light: '#ba5229' },
    aqua:    { dark: '#27a479', light: '#148059' },
    yellow:  { dark: '#c98500', light: '#986700' },
    magenta: { dark: '#dc6d95', light: '#a75976' },
    green:   { dark: '#45a445', light: '#008300' },
    violet:  { dark: '#9085e9', light: '#4a3aa7' },
    red:     { dark: '#e76a6a', light: '#ca4140' },
  };

  // The categorical cycle: N things with no inherent order and no shared
  // magnitude — accounts in a balance table, historical crash scenarios, a
  // handful of compared plans. The UI grew four separate hand-picked arrays for
  // this, none of them checked against anything. They are all this list now.
  //
  // Slot order is cycle order, and the wrap from the last back to the first is a
  // real adjacency once a table has more entries than slots, so the validator
  // checks it too.
  const CATEGORICAL = Object.keys(SLOTS);

  // Reserved. Never used for "series 5", and never carrying meaning alone — a
  // status colour always ships next to a word or an icon.
  // A status colour is read as often as it is drawn — it tints a savings rate, a
  // verdict, a warning line — so it is held to the TEXT bar, 4.5:1, measured
  // against the tightest ground it lands on (a raised slate-950 panel in light
  // mode, not plain white). The dark column already cleared it; three of the four
  // light values did not, which is what put a 3.68:1 figure on the dashboard.
  const STATUS = {
    good:     { dark: '#22c07a', light: '#0d7c47' },
    warning:  { dark: '#e0a832', light: '#996005' },
    serious:  { dark: '#e8834a', light: '#b64b10' },
    critical: { dark: '#f0736f', light: '#c62b28' },
  };

  // Chart furniture. Grid and axis are deliberately recessive; the tooltip sits
  // one step above the chart surface so it reads as floating.
  const CHROME = {
    surface:      { dark: '#0f172a', light: '#f8fafc' },
    surfaceRaised:{ dark: '#1e293b', light: '#ffffff' },
    grid:         { dark: '#2b3a52', light: '#e6e6e2' },
    axis:         { dark: '#8492a7', light: '#6b6b66' },
    inkPrimary:   { dark: '#f1f5f9', light: '#14140f' },
    inkSecondary: { dark: '#b6c2d2', light: '#52514e' },
    inkMuted:     { dark: '#8492a7', light: '#73726b' },
    reference:    { dark: '#e0a832', light: '#a86a06' },  // "you retire here" markers
    // "Everything else" bars: the context an overlay sits on, as in the
    // conversion chart where base income is backdrop and the conversion is the
    // subject. Deliberately NOT a series colour — the previous version drew base
    // income in the Social Security blue, which both claimed it was Social
    // Security and, next to the conversion violet, was ΔE 1.9 under deuteranopia.
    baseline:     { dark: '#5b6b82', light: '#7c8ba1' },
  };

  // ---------------------------------------------------------------------------
  // THE TOKEN LAYER
  //
  // The UI is ~4,000 Tailwind colour classes, written dark-first: bg-slate-800
  // is a card, text-slate-100 is a heading, text-slate-500 is a muted label. A
  // light mode built by editing those classes would be 4,000 edits and a
  // permanent second thing to keep in sync.
  //
  // Instead every Tailwind colour is redefined as rgb(var(--c-<family>-<step>) /
  // <alpha-value>), so a class name stops naming a colour and starts naming a
  // ROLE. Flipping data-theme on <html> re-resolves all of them at once, with no
  // re-render and no React state involved. The <alpha-value> placeholder is what
  // keeps the ~200 opacity modifiers in the source (bg-slate-800/60,
  // border-slate-700/50) working — a plain var() would break every one of them.
  //
  // slate INVERTS. That is the whole trick: light mode is not a second set of
  // class names, it is the same ramp read from the other end. bg-slate-900 (page)
  // becomes the lightest value, text-slate-100 (heading) becomes the darkest, and
  // every one of the 2,479 slate classes lands somewhere sensible for free.
  //
  // Accent families FOLD instead of inverting. In this UI the 300/400 steps are
  // text on a dark ground and the 900 step is a tinted panel background, while
  // 500/600 are solid fills that work on either ground. So the ends swap and the
  // middle holds: 300/400 darken to stay readable on white, 900 becomes a pale
  // wash, 500 barely moves.
  //
  // The one place this must NOT reach is the printed reports, which are
  // deliberately dark-on-white in both themes and use text-slate-900 as ink. They
  // are scoped out in cssVariables() below.
  const TW = {
    slate: {
       50: { dark: '#f8fafc', light: '#0f172a' },
      100: { dark: '#f1f5f9', light: '#0f172a' },
      200: { dark: '#e2e8f0', light: '#1e293b' },
      300: { dark: '#cbd5e1', light: '#334155' },
      400: { dark: '#94a3b8', light: '#475569' },
      // 500 is the muted-label workhorse — 437 uses, almost all of them text-xs.
      // Stock slate-500 measures 3.07:1 on a slate-800 card, which is below AA for
      // anything that is not large text, and it has been that way in dark mode all
      // along; writing the contrast check found it. Lifted until it clears 4.5:1 on
      // the card, the tighter of the two grounds it sits on.
      500: { dark: '#8794a7', light: '#5d6b7f' },
      // 600 is 148 borders and 35 ghost-text uses. Tuned as a border first; as
      // text it stays deliberately faint, exactly as it is in dark mode.
      600: { dark: '#475569', light: '#b9c2ce' },
      700: { dark: '#334155', light: '#e2e8f0' },
      800: { dark: '#1e293b', light: '#ffffff' },
      900: { dark: '#0f172a', light: '#f8fafc' },
      950: { dark: '#020617', light: '#eef2f7' },
    },
    amber: {
      100: { dark: '#fef3c7', light: '#7c4a03' }, 200: { dark: '#fde68a', light: '#8a5206' },
      300: { dark: '#fcd34d', light: '#8c5216' }, 400: { dark: '#fbbf24', light: '#96590a' },
      500: { dark: '#f59e0b', light: '#b45309' }, 600: { dark: '#d97706', light: '#b45309' },
      700: { dark: '#b45309', light: '#92400e' }, 800: { dark: '#92400e', light: '#fde9c8' },
      900: { dark: '#78350f', light: '#fdf4e3' },
    },
    emerald: {
      100: { dark: '#d1fae5', light: '#065f46' }, 200: { dark: '#a7f3d0', light: '#046c4e' },
      300: { dark: '#6ee7b7', light: '#047857' }, 400: { dark: '#34d399', light: '#047857' },
      500: { dark: '#10b981', light: '#059669' }, 600: { dark: '#059669', light: '#047857' },
      700: { dark: '#047857', light: '#065f46' }, 800: { dark: '#065f46', light: '#c8f0dd' },
      900: { dark: '#064e3b', light: '#e6f7ef' },
    },
    red: {
      100: { dark: '#fee2e2', light: '#991b1b' }, 200: { dark: '#fecaca', light: '#a51d1d' },
      300: { dark: '#fca5a5', light: '#b91c1c' }, 400: { dark: '#f87171', light: '#c2201f' },
      500: { dark: '#ef4444', light: '#dc2626' }, 600: { dark: '#dc2626', light: '#b91c1c' },
      700: { dark: '#b91c1c', light: '#991b1b' }, 800: { dark: '#991b1b', light: '#f8d7d7' },
      900: { dark: '#7f1d1d', light: '#fdeaea' },
    },
    sky: {
      100: { dark: '#e0f2fe', light: '#075985' }, 200: { dark: '#bae6fd', light: '#0369a1' },
      300: { dark: '#7dd3fc', light: '#0369a1' }, 400: { dark: '#38bdf8', light: '#0272ab' },
      500: { dark: '#0ea5e9', light: '#0284c7' }, 600: { dark: '#0284c7', light: '#0369a1' },
      700: { dark: '#0369a1', light: '#075985' }, 800: { dark: '#075985', light: '#cfe8f7' },
      900: { dark: '#0c4a6e', light: '#e6f3fb' },
    },
    purple: {
      100: { dark: '#f3e8ff', light: '#6b21a8' }, 200: { dark: '#e9d5ff', light: '#6d28d9' },
      300: { dark: '#d8b4fe', light: '#7e22ce' }, 400: { dark: '#c084fc', light: '#8028cc' },
      500: { dark: '#a855f7', light: '#9333ea' }, 600: { dark: '#9333ea', light: '#7e22ce' },
      700: { dark: '#7e22ce', light: '#6b21a8' }, 800: { dark: '#6b21a8', light: '#ead9f8' },
      900: { dark: '#581c87', light: '#f4ecfc' },
    },
    orange: {
      100: { dark: '#ffedd5', light: '#9a3412' }, 200: { dark: '#fed7aa', light: '#9a3412' },
      300: { dark: '#fdba74', light: '#a8420f' }, 400: { dark: '#fb923c', light: '#b4460c' },
      500: { dark: '#f97316', light: '#ea580c' }, 600: { dark: '#ea580c', light: '#c2410c' },
      700: { dark: '#c2410c', light: '#9a3412' }, 800: { dark: '#9a3412', light: '#fbe0cd' },
      900: { dark: '#7c2d12', light: '#fdf0e6' },
    },
    pink: {
      100: { dark: '#fce7f3', light: '#9d174d' }, 200: { dark: '#fbcfe8', light: '#9d174d' },
      300: { dark: '#f9a8d4', light: '#a81a55' }, 400: { dark: '#f472b6', light: '#be185d' },
      500: { dark: '#ec4899', light: '#db2777' }, 600: { dark: '#db2777', light: '#be185d' },
      700: { dark: '#be185d', light: '#9d174d' }, 800: { dark: '#9d174d', light: '#f9d8e6' },
      900: { dark: '#831843', light: '#fceaf2' },
    },
    cyan: {
      100: { dark: '#cffafe', light: '#155e75' }, 200: { dark: '#a5f3fc', light: '#155e75' },
      300: { dark: '#67e8f9', light: '#0e7490' }, 400: { dark: '#22d3ee', light: '#0d7a91' },
      500: { dark: '#06b6d4', light: '#0891b2' }, 600: { dark: '#0891b2', light: '#0e7490' },
      700: { dark: '#0e7490', light: '#155e75' }, 800: { dark: '#155e75', light: '#cdebf2' },
      900: { dark: '#164e63', light: '#e5f5f9' },
    },
    blue: {
      100: { dark: '#dbeafe', light: '#1e40af' }, 200: { dark: '#bfdbfe', light: '#1e40af' },
      300: { dark: '#93c5fd', light: '#1d4ed8' }, 400: { dark: '#60a5fa', light: '#1f5fd6' },
      500: { dark: '#3b82f6', light: '#2563eb' }, 600: { dark: '#2563eb', light: '#1d4ed8' },
      700: { dark: '#1d4ed8', light: '#1e40af' }, 800: { dark: '#1e40af', light: '#d5e2fb' },
      900: { dark: '#1e3a8a', light: '#e8effd' },
    },
    yellow: {
      100: { dark: '#fef9c3', light: '#854d0e' }, 200: { dark: '#fef08a', light: '#854d0e' },
      300: { dark: '#fde047', light: '#8f5407' }, 400: { dark: '#facc15', light: '#a16207' },
      500: { dark: '#eab308', light: '#ca8a04' }, 600: { dark: '#ca8a04', light: '#a16207' },
      700: { dark: '#a16207', light: '#854d0e' }, 800: { dark: '#854d0e', light: '#fbeecb' },
      900: { dark: '#713f12', light: '#fdf6e5' },
    },
    green: {
      100: { dark: '#dcfce7', light: '#166534' }, 200: { dark: '#bbf7d0', light: '#166534' },
      300: { dark: '#86efac', light: '#15803d' }, 400: { dark: '#4ade80', light: '#15803d' },
      500: { dark: '#22c55e', light: '#16a34a' }, 600: { dark: '#16a34a', light: '#15803d' },
      700: { dark: '#15803d', light: '#166534' }, 800: { dark: '#166534', light: '#cdf0d9' },
      900: { dark: '#14532d', light: '#e7f8ed' },
    },
    teal: {
      100: { dark: '#ccfbf1', light: '#115e59' }, 200: { dark: '#99f6e4', light: '#115e59' },
      300: { dark: '#5eead4', light: '#0f766e' }, 400: { dark: '#2dd4bf', light: '#0f766e' },
      500: { dark: '#14b8a6', light: '#0d9488' }, 600: { dark: '#0d9488', light: '#0f766e' },
      700: { dark: '#0f766e', light: '#115e59' }, 800: { dark: '#115e59', light: '#cceeea' },
      900: { dark: '#134e4a', light: '#e5f5f3' },
    },
    indigo: {
      100: { dark: '#e0e7ff', light: '#3730a3' }, 200: { dark: '#c7d2fe', light: '#3730a3' },
      300: { dark: '#a5b4fc', light: '#4338ca' }, 400: { dark: '#818cf8', light: '#4640cf' },
      500: { dark: '#6366f1', light: '#4f46e5' }, 600: { dark: '#4f46e5', light: '#4338ca' },
      700: { dark: '#4338ca', light: '#3730a3' }, 800: { dark: '#3730a3', light: '#dcdefb' },
      900: { dark: '#312e81', light: '#ebecfd' },
    },
    rose: {
      100: { dark: '#ffe4e6', light: '#9f1239' }, 200: { dark: '#fecdd3', light: '#9f1239' },
      300: { dark: '#fda4af', light: '#be123c' }, 400: { dark: '#fb7185', light: '#c2183f' },
      500: { dark: '#f43f5e', light: '#e11d48' }, 600: { dark: '#e11d48', light: '#be123c' },
      700: { dark: '#be123c', light: '#9f1239' }, 800: { dark: '#9f1239', light: '#fbd9e0' },
      900: { dark: '#881337', light: '#fdeaee' },
    },
  };

  // Tailwind needs the channel TRIPLET, not a hex, or the /50 opacity modifiers
  // have nothing to multiply into.
  const triplet = (hex) => {
    const v = hex.trim().replace(/^#/, '');
    return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16)).join(' ');
  };

  // The static config object index.html hands to Tailwind. Generated here rather
  // than hand-written in the HTML so a family added above cannot be forgotten
  // there — a test asserts the two agree.
  // extend.colors.<family> REPLACES that family's whole scale, so any step not
  // listed here would stop existing — a later `text-amber-50` would silently
  // render as nothing. The accent tables above carry 100–900 because that is what
  // the UI uses; the two ends are filled from their nearest defined neighbour so
  // the full standard scale is always present.
  const ALL_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const stepsOf = (family) => {
    const defined = TW[family];
    const out = {};
    ALL_STEPS.forEach(step => {
      out[step] = defined[step] || (step === 50 ? defined[100] : step === 950 ? defined[900] : defined[500]);
    });
    return out;
  };

  const tailwindColors = () => {
    const out = {};
    Object.keys(TW).forEach(family => {
      out[family] = {};
      ALL_STEPS.forEach(step => {
        out[family][step] = `rgb(var(--c-${family}-${step}) / <alpha-value>)`;
      });
    });
    return out;
  };

  // The <style> block that carries the actual values. Emitted into the document
  // head at build time so there is no flash of the wrong theme on load.
  const cssVariables = () => {
    // One line per family keeps a 165-variable block skimmable in view-source.
    const decls = (mode) => Object.keys(TW).map(family => {
      const steps = stepsOf(family);
      return ALL_STEPS.map(step =>
        `--c-${family}-${step}:${triplet(steps[step][mode] !== undefined ? steps[step][mode] : steps[step].dark)};`).join(' ');
    }).join('\n    ');
    return [
      // Dark is the default and needs no attribute, so a document that never
      // loads the toggle still looks right.
      `  :root {\n    ${decls('dark')}\n  }`,
      `  :root[data-theme="light"] {\n    ${decls('light')}\n  }`,
      // The printed reports are dark-on-white in BOTH themes by design — they use
      // text-slate-900 as ink and bg-white as paper. Inverting the ramp under them
      // would print white text on white paper, so they are pinned to the dark
      // (i.e. stock Tailwind) column wherever they appear.
      `  #report-print {\n    ${decls('dark')}\n  }`,
    ].join('\n');
  };

  // The exact markup tools/build.cjs stamps between the markers in index.html
  // and mobile.html. Generated here, next to the values, so a test can rebuild it
  // and assert the HTML still matches without re-running the build.
  const HEAD_MARKERS = {
    open:  '  <!-- BEGIN GENERATED THEME TOKENS (tools/build.cjs from theme.js) -->',
    close: '  <!-- END GENERATED THEME TOKENS -->',
  };
  const headBlock = () => {
    const colors = tailwindColors();
    const cfg = Object.keys(colors)
      .map(f => '      ' + JSON.stringify(f) + ': ' + JSON.stringify(colors[f]) + ',')
      .join('\n');
    return [
      HEAD_MARKERS.open,
      '  <script>tailwind.config = { theme: { extend: { colors: {\n' + cfg + '\n    } } } };</script>',
      '  <style>',
      cssVariables(),
      '  </style>',
      HEAD_MARKERS.close,
    ].join('\n');
  };

  // Resolve every token for one mode. Charts take plain strings rather than CSS
  // variables because Recharts computes legend swatches and tooltip colours in
  // JS, where a var() reference is an opaque string.
  const resolve = (mode = 'dark') => {
    const pick = (o) => o[mode] !== undefined ? o[mode] : o.dark;
    const out = { mode, series: {}, status: {}, lines: {}, ink: {}, categorical: CATEGORICAL.map(k => pick(SLOTS[k])), bracket: pick(BRACKET_RAMP), distribution: pick(DISTRIBUTION_RAMP) };
    Object.entries(SERIES).forEach(([k, v]) => { out.series[k] = pick(v); });
    Object.entries(STATUS).forEach(([k, v]) => { out.status[k] = pick(v); });
    Object.entries(LINES).forEach(([k, v]) => { out.lines[k] = pick(v); });
    // Text-safe inks, keyed by the SERIES name so a call site that draws a series
    // as a label can ask for it without knowing which slot it lives in.
    Object.entries(SERIES).forEach(([k, v]) => {
      const slot = Object.keys(SLOTS).find(sl => SLOTS[sl] === v);
      out.ink[k] = slot ? pick(SLOT_INK[slot]) : pick(v);
    });
    Object.entries(CHROME).forEach(([k, v]) => { out[k] = pick(v); });
    return out;
  };

  // The order each chart stacks in. Exported so the chart and the validator
  // cannot drift apart: a test asserts the separation of exactly these pairs.
  const STACKS = {
    balanceSheet: ['preTax', 'roth', 'brokerage', 'nonLiquid'],
    incomeFlows: ['earnedIncome', 'socialSecurity', 'pension', 'otherIncome',
                  'withdrawalVoluntary', 'rmd', 'rothConversion', 'conversionTaxDraw'],
  };

  return { SLOTS, SERIES, BRACKET_RAMP, DISTRIBUTION_RAMP, LINES, STATUS, CHROME, STACKS, CATEGORICAL, SLOT_INK, TW,
           triplet, tailwindColors, cssVariables, headBlock, HEAD_MARKERS, resolve, MODES: ['dark', 'light'] };
});
