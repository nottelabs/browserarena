# Shared benchmark layout

Browser Lifecycle (`/`) and Proxy Performance (`/proxies`) use the same section header,
table panel, column sizing, and chart grid. The table frame reserves nine provider
slots; missing providers leave empty space rather than fabricated result rows.
Headers are 40px and provider rows are 56px. Both tables use the same monospace,
tabular number styling; GET and first-byte values use rounded milliseconds.
Costs retain their relevant precision and units (hourly rates versus per-run usage).

History and Results have equally sized headers. The lifecycle provider selector
is a dropdown so changing the number of providers cannot wrap the controls and
move the chart borders. Both chart panels reserve the same height, including
when stacked on smaller screens (460px on desktop, 480px on mobile, and 510px
below 360px to accommodate wrapping controls and provider legends). Narrow tables scroll horizontally inside their
frames, retaining all metrics on both benchmarks.

## Browser verification

Verified with rendered `getBoundingClientRect()` measurements on 2026-10-11 at
320, 390, 640, 768, 900, 1024, 1440, and 1920 CSS-pixel widths. At every width,
the table frame and both chart frames had identical x, y, width, and height on
both routes, with no horizontal document overflow. Sequential and concurrent
lifecycle views, and US/France proxy results with cost sorting, were exercised.

After the October 12 laptop-sidebar adjustment, at 1440px both routes measure:

| Frame | Left | Top | Width | Height |
| --- | ---: | ---: | ---: | ---: |
| Provider table | 251.1953125 | 295.7421875 | 1145.609375 | 547 |
| History chart | 251.1953125 | 991.8515625 | 609.296875 | 460 |
| Results chart | 877.765625 | 991.8515625 | 519.0390625 | 460 |

Coordinates depend on viewport width and font scaling; equality between routes
is the layout contract. Recheck both routes after changing header text, controls,
row content, or provider counts. More than nine provider rows require increasing
the shared reservation on both benchmarks.
# Latest-provider overview check — October 11

The proxy table now displays all nine providers' latest available runs through
the selected day, with the recorded date under each provider name. The provider
date uses a 12px line height inside the existing 56px row, preserving the shared
table height. Rechecked at 390px, 1440px, and 1920px: table, history, and results
panel borders match lifecycle coordinates and dimensions exactly at each width.
The overview export, raw details, and distribution match the table's provider
suites. The distribution omits providers with no attempts and displays run
dates; attempted but unsuccessful runs retain an empty-sample row. History
retains its recorded-day and workload boundaries. TypeScript and all 57 web tests pass.

## Laptop sidebar — October 12

The permanent sidebar now appears from 1280 CSS pixels, including common Mac
viewport widths of 1280, 1440, and 1512. Between 1280 and 1799px it is 184px wide
and the main container shifts right, using available width up to its existing
1280px maximum. From 1800px the original centered main container and 208px
floating sidebar remain unchanged. Below 1280px the visible menu opens a drawer;
resizing an open drawer into desktop mode restores scrolling and removes its
focus trap. Sidebar and main Benchmark headings align vertically.

Rechecked both public routes in development at 320, 390, 1024, 1279, 1280, 1366,
1440, 1512, 1728, and 1920px. All three panel borders match exactly between routes,
with no horizontal document overflow. At desktop widths the provider tables fit
without horizontal scrolling. Repeated production checks at 390, 1280, 1440,
1512, and 1920px with identical results. The production build passes.

## Proxy value score — October 12

Lifecycle and proxy GET now share the value-score preset controls, with a mobile
preset dropdown. The proxy table's primary columns are provider, runs, reliability,
latency, cost per success, and value score; its GET details toggle reveals first
byte, throughput, and suite cost without moving the panel borders. The scoring
formula and fixed normalization anchors are documented in `proxy-get-value-score.md`.

Rechecked development layouts at 320, 390, 640, 1024, 1280, 1440, 1512, and 1920px,
and production layouts at 390, 1280, 1440, and 1920px. All table/history/results
frames still match exactly across routes with no document overflow. Exercised
each preset, the details toggle, and the mobile preset dropdown. The production
build and all 72 web tests pass, including seven proxy scoring/ranking tests.
