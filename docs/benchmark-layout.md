# Shared benchmark layout

Browser lifecycle (`/`) and proxy GET (`/proxy-get`) use the same section header,
table panel, column sizing, and chart grid. The table frame reserves nine provider
slots; missing providers leave empty space rather than fabricated result rows.
Headers are 40px and provider rows are 56px. Both tables use the same monospace,
tabular number styling; GET and first-byte values use rounded milliseconds.
Costs retain their relevant precision and units (hourly rates versus per-run usage).

History and Results have equally sized headers. The lifecycle provider selector
is a dropdown so changing the number of providers cannot wrap the controls and
move the chart borders. Both chart panels reserve the same height, including
when stacked on smaller screens. Narrow tables scroll horizontally inside their
frames, retaining all metrics on both benchmarks.

## Browser verification

Verified with rendered `getBoundingClientRect()` measurements on 2026-10-11 at
320, 390, 640, 768, 900, 1024, 1440, and 1920 CSS-pixel widths. At every width,
the table frame and both chart frames had identical x, y, width, and height on
both routes, with no horizontal document overflow. Sequential and concurrent
lifecycle views, and US/France proxy results with cost sorting, were exercised.

At 1440px, both routes measured:

| Frame | Left | Top | Width | Height |
| --- | ---: | ---: | ---: | ---: |
| Provider table | 123.1953125 | 295.7421875 | 1193.609375 | 547 |
| History chart | 123.1953125 | 991.8515625 | 635.21875 | 460 |
| Results chart | 775.6875 | 991.8515625 | 541.1171875 | 460 |

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
