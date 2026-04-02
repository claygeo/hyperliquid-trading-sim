# Benchmark Report -- 2026-04-01

**Project:** hyperliquid-trading-sim (tradeterm.app)
**Build tool:** Vite 5.4.21
**Build time:** 3.88s
**Modules transformed:** 142

---

## Bundle Analysis

### Chunk Sizes (raw / gzip)

| Chunk | Raw | Gzip | Sourcemap |
|---|---|---|---|
| `supabase` | 171.15 KB | 44.24 KB | 768.39 KB |
| `charts` (lightweight-charts) | 162.45 KB | 51.83 KB | 409.46 KB |
| `react-vendor` (react, react-dom, react-router-dom) | 162.31 KB | 53.01 KB | 703.50 KB |
| `index` (app code) | 114.22 KB | 28.29 KB | 354.17 KB |
| `state` (zustand) | 3.64 KB | 1.62 KB | 14.51 KB |
| **CSS** (`index.css`) | 37.71 KB | 7.62 KB | -- |
| `index.html` | 1.60 KB | 0.72 KB | -- |

### Totals

| Metric | Value |
|---|---|
| **Total JS (raw)** | 613.77 KB |
| **Total JS (gzip)** | 178.99 KB |
| **Total CSS (raw)** | 37.71 KB |
| **Total CSS (gzip)** | 7.62 KB |
| **Total transfer (gzip, JS+CSS)** | 186.61 KB |

---

## Performance Budget Check

| Budget Rule | Threshold | Actual | Status |
|---|---|---|---|
| Total JS gzip < 200 KB | 200 KB | 178.99 KB | PASS |
| Largest chunk (raw) < 500 KB | 500 KB | 171.15 KB (supabase) | PASS |
| App code (index) gzip < 50 KB | 50 KB | 28.29 KB | PASS |
| CSS gzip < 20 KB | 20 KB | 7.62 KB | PASS |
| Build time < 10s | 10s | 3.88s | PASS |

**All budgets pass.**

---

## Server Type-Check

```
npx tsc --noEmit  -->  0 errors
```

Server compiles cleanly with no type errors.

---

## Build Warnings

None. Clean build with zero warnings.

---

## Page Timing Estimates (synthetic)

Live page timings were not measured in this run (no browse daemon). Based on bundle analysis:

- **First Contentful Paint (est.):** The total gzip transfer of ~187 KB is well within fast-load territory. On a 3G connection (~1.5 Mbps), transfer alone is ~1.0s. On broadband, sub-500ms.
- **Time to Interactive (est.):** With 614 KB raw JS to parse, modern devices should reach interactive in under 2s. The manual chunk splitting ensures the critical path (react-vendor + app code) loads first at ~81 KB gzip.
- **Largest Contentful Paint (est.):** Depends on chart rendering. The charts chunk (51.83 KB gzip) loads independently and won't block initial paint.

---

## Manual Chunk Strategy Review

The `vite.config.ts` splits into 4 manual chunks:

1. **react-vendor** (react, react-dom, react-router-dom) -- 162.31 KB raw. Stable, excellent cache hit rate.
2. **supabase** (@supabase/supabase-js) -- 171.15 KB raw. Largest chunk. Consider lazy-loading if auth is not needed on every page.
3. **charts** (lightweight-charts) -- 162.45 KB raw. Good candidate for lazy loading since charts are not above the fold.
4. **state** (zustand) -- 3.64 KB raw. Tiny, barely worth its own chunk but doesn't hurt.

---

## Recommendations

1. **Lazy-load the charts chunk.** `lightweight-charts` is 162 KB raw and only needed on chart views. Dynamic `import()` with React.lazy would defer this from the critical path.
2. **Evaluate supabase bundle.** At 171 KB raw it is the single largest chunk. Check if tree-shaking is effective -- the Supabase JS client bundles Realtime, Storage, and Auth even if unused. Consider `@supabase/supabase-js/dist/module` or selective imports if available.
3. **Enable gzip/brotli on CDN.** Netlify serves brotli by default, so the gzip numbers here are conservative -- actual transfer sizes will be ~15-20% smaller with brotli.
4. **Add a performance budget CI check.** A simple script that parses Vite build output and fails if any threshold is exceeded would prevent regressions.
5. **Consider dropping sourcemaps in production.** The 2.25 MB of sourcemaps add deploy time. Use `build.sourcemap: 'hidden'` to generate them for error tracking without serving them to browsers.
