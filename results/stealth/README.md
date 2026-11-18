# Weekly access scores

This directory accepts aggregate result JSON only. No website list, target URL,
journey definition, individual visit, screenshot or recording belongs here.

One file per UTC week: `YYYY-MM-DD.json`, named for its Monday `weekOf`.
`date` records the actual measurement date. The page validates every file and
retains previous weeks. Until the first verified result arrives it shows an
explicit empty state. Illustrative scores must never be committed here.

Allowed fields are `schemaVersion`, `protocol`, `date`, `weekOf`, `siteCount`,
`rounds`, `proxyCountry`, and `providers`. Provider rows contain only `provider`,
`accessible`, `blocked`, and `errors`. See `web/lib/stealth.ts` for validation.
