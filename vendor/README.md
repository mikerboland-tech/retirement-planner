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

`tailwind.js`, `react.min.js`, `react-dom.min.js`, `babel.min.js` are loaded by
both `index.html` and `mobile.html`. The others are desktop-only.

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
