# Vendored libraries

Local copies of the third-party JS libraries the app depends on. Vendored so
the app works offline and is immune to CDN cert/network issues (e.g. corporate
proxies that MITM HTTPS to unpkg.com).

## Source URLs

| File                 | Source                                                                       |
| -------------------- | ---------------------------------------------------------------------------- |
| `tailwind.js`        | https://cdn.tailwindcss.com                                                  |
| `react.min.js`       | https://unpkg.com/react@18/umd/react.production.min.js                       |
| `react-dom.min.js`   | https://unpkg.com/react-dom@18/umd/react-dom.production.min.js               |
| `react-is.min.js`    | https://unpkg.com/react-is@18/umd/react-is.production.min.js                 |
| `prop-types.min.js`  | https://unpkg.com/prop-types@15/prop-types.min.js                            |
| `recharts.js`        | https://unpkg.com/recharts@2.10.3/umd/Recharts.js                            |
| `babel.min.js`       | https://unpkg.com/@babel/standalone/babel.min.js                             |

`react.min.js` and `react-dom.min.js` are loaded by both `index.html` and
`mobile.html`; `react-is`, `prop-types` and `recharts` are desktop-only.

`babel.min.js` and `tailwind.js` are fallbacks, loaded only when a page finds its
source newer than its build (see `tools/build.cjs`). Normally the pages run the
precompiled `.compiled.js` files and the prebuilt `app.css` instead. The build
itself also uses `babel.min.js`, so the compiled output matches what the
browser would have produced.

## Refresh

To pull fresh versions, from `new code\`:

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$urls = @{
  'tailwind.js'       = 'https://cdn.tailwindcss.com'
  'react.min.js'      = 'https://unpkg.com/react@18/umd/react.production.min.js'
  'react-dom.min.js'  = 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js'
  'react-is.min.js'   = 'https://unpkg.com/react-is@18/umd/react-is.production.min.js'
  'prop-types.min.js' = 'https://unpkg.com/prop-types@15/prop-types.min.js'
  'recharts.js'       = 'https://unpkg.com/recharts@2.10.3/umd/Recharts.js'
  'babel.min.js'      = 'https://unpkg.com/@babel/standalone/babel.min.js'
}
foreach ($n in $urls.Keys) {
  Invoke-WebRequest -Uri $urls[$n] -OutFile (Join-Path 'vendor' $n) -UseBasicParsing
}
```

After refreshing, smoke-test desktop and mobile in a hard-reloaded browser.

## Fonts (`fonts/`)

The typefaces behind the four dark looks (Observatory, Aurora, Vault, Flight
Deck). Self-hosted rather than linked from Google Fonts because the page's
Content-Security-Policy allows fonts only from the site itself, and so choosing
a look never tells a third party that someone opened a retirement planner. Only
the Latin subset is kept; a browser downloads a file only when the active look
uses it, so the classic dark and light themes fetch none of them.

All are licensed under the SIL Open Font License 1.1, which permits bundling
and redistribution with software. Downloaded from fonts.gstatic.com via the
Google Fonts CSS2 API (`display=swap`, Latin subset).

| File                         | Family, weights                  | Used by      |
| ---------------------------- | -------------------------------- | ------------ |
| `ibm-plex-sans-var.woff2`    | IBM Plex Sans, variable 400–700  | Observatory  |
| `ibm-plex-mono-400/500.woff2`| IBM Plex Mono 400, 500           | Observatory  |
| `sora-var.woff2`             | Sora, variable 400–700           | Aurora       |
| `manrope-var.woff2`          | Manrope, variable 400–700        | Aurora       |
| `instrument-serif-400.woff2` | Instrument Serif 400             | Vault        |
| `instrument-sans-var.woff2`  | Instrument Sans, variable 400–700| Vault        |
| `chakra-petch-400…700.woff2` | Chakra Petch 400, 500, 600, 700  | Flight Deck  |
| `jetbrains-mono-var.woff2`   | JetBrains Mono, variable 400–600 | Flight Deck  |
