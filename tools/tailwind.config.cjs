// Tailwind configuration for the prebuilt stylesheet (app.css), used by
// tools/build.cjs. The colours come from theme.js — the same channel-triplet
// tokens the pages declare as CSS variables — so light and dark mode keep
// working exactly as they did with the in-browser compiler. 3.4.17 is the
// version the vendored in-browser build (vendor/tailwind.js) is, so a page that
// falls back to it renders the same.
const path = require('path');
const theme = require(path.join(__dirname, '..', 'theme.js'));
const ROOT = path.join(__dirname, '..');
module.exports = {
  content: [
    path.join(ROOT, 'retirement-planner.jsx'),
    path.join(ROOT, 'retirement-planner-mobile.jsx'),
  ],
  theme: { extend: { colors: theme.tailwindColors() } },
};
