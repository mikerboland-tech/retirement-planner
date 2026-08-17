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

  // Reserved. Never used for "series 5", and never carrying meaning alone — a
  // status colour always ships next to a word or an icon.
  const STATUS = {
    good:     { dark: '#22c07a', light: '#0f8f52' },
    warning:  { dark: '#e0a832', light: '#a86a06' },
    serious:  { dark: '#e8834a', light: '#c04f11' },
    critical: { dark: '#f0736f', light: '#c62b28' },
  };

  // Chart furniture. Grid and axis are deliberately recessive; the tooltip sits
  // one step above the chart surface so it reads as floating.
  const CHROME = {
    surface:      { dark: '#0f172a', light: '#f8fafc' },
    surfaceRaised:{ dark: '#1e293b', light: '#ffffff' },
    grid:         { dark: '#2b3a52', light: '#e6e6e2' },
    axis:         { dark: '#7c8ba1', light: '#6b6b66' },
    inkPrimary:   { dark: '#f1f5f9', light: '#14140f' },
    inkSecondary: { dark: '#b6c2d2', light: '#52514e' },
    inkMuted:     { dark: '#7c8ba1', light: '#78776f' },
    reference:    { dark: '#e0a832', light: '#a86a06' },  // "you retire here" markers
    // "Everything else" bars: the context an overlay sits on, as in the
    // conversion chart where base income is backdrop and the conversion is the
    // subject. Deliberately NOT a series colour — the previous version drew base
    // income in the Social Security blue, which both claimed it was Social
    // Security and, next to the conversion violet, was ΔE 1.9 under deuteranopia.
    baseline:     { dark: '#5b6b82', light: '#7c8ba1' },
  };

  // Resolve every token for one mode. Charts take plain strings rather than CSS
  // variables because Recharts computes legend swatches and tooltip colours in
  // JS, where a var() reference is an opaque string.
  const resolve = (mode = 'dark') => {
    const pick = (o) => o[mode] !== undefined ? o[mode] : o.dark;
    const out = { mode, series: {}, status: {}, lines: {}, bracket: pick(BRACKET_RAMP), distribution: pick(DISTRIBUTION_RAMP) };
    Object.entries(SERIES).forEach(([k, v]) => { out.series[k] = pick(v); });
    Object.entries(STATUS).forEach(([k, v]) => { out.status[k] = pick(v); });
    Object.entries(LINES).forEach(([k, v]) => { out.lines[k] = pick(v); });
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

  return { SLOTS, SERIES, BRACKET_RAMP, DISTRIBUTION_RAMP, LINES, STATUS, CHROME, STACKS, resolve, MODES: ['dark', 'light'] };
});
