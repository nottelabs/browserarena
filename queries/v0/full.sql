WITH data AS (
  SELECT *
  FROM read_json_auto('results/v0/**/*.jsonl', format='newline_delimited', union_by_name=true)
  WHERE provider != ''
),
pre AS (
  SELECT
    provider,
    success,
    COALESCE(try_cast(concurrency AS INTEGER), 1) AS concurrency,
    try_cast(session_creation_ms        AS DOUBLE) AS session_creation_ms,
    try_cast(session_connect_ms         AS DOUBLE) AS session_connect_ms,
    try_cast(page_goto_ms               AS DOUBLE) AS page_goto_ms,
    try_cast(page_ttfb_ms               AS DOUBLE) AS page_ttfb_ms,
    try_cast(page_dom_content_loaded_ms AS DOUBLE) AS page_dom_content_loaded_ms,
    try_cast(page_load_ms               AS DOUBLE) AS page_load_ms,
    try_cast(session_release_ms         AS DOUBLE) AS session_release_ms,
    try_cast(cost_usd                   AS DOUBLE) AS cost_usd
  FROM data
),
pre_success AS (
  SELECT
    provider,
    concurrency,
    success,
    session_creation_ms,
    session_connect_ms,
    page_goto_ms,
    page_ttfb_ms,
    page_dom_content_loaded_ms,
    page_load_ms,
    session_release_ms,
    cost_usd,
    (session_creation_ms + session_connect_ms + page_goto_ms + session_release_ms) AS total_ms
  FROM pre
  WHERE success = true
),
metric_long AS (
  SELECT provider, concurrency, 'session_creation_ms'        AS metric, session_creation_ms        AS value FROM pre_success
  UNION ALL
  SELECT provider, concurrency, 'session_connect_ms'         AS metric, session_connect_ms         AS value FROM pre_success
  UNION ALL
  SELECT provider, concurrency, 'page_goto_ms'               AS metric, page_goto_ms               AS value FROM pre_success
  UNION ALL
  SELECT provider, concurrency, 'page_ttfb_ms'               AS metric, page_ttfb_ms               AS value FROM pre_success WHERE page_ttfb_ms IS NOT NULL
  UNION ALL
  SELECT provider, concurrency, 'page_dom_content_loaded_ms' AS metric, page_dom_content_loaded_ms AS value FROM pre_success WHERE page_dom_content_loaded_ms IS NOT NULL
  UNION ALL
  SELECT provider, concurrency, 'page_load_ms'               AS metric, page_load_ms               AS value FROM pre_success WHERE page_load_ms IS NOT NULL
  UNION ALL
  SELECT provider, concurrency, 'session_release_ms'         AS metric, session_release_ms         AS value FROM pre_success
  UNION ALL
  SELECT provider, concurrency, 'cost_usd'                   AS metric, cost_usd                   AS value FROM pre_success WHERE cost_usd IS NOT NULL
  UNION ALL
  SELECT provider, concurrency, 'total_ms'                   AS metric, total_ms                   AS value FROM pre_success
),
success_rate AS (
  SELECT
    provider,
    concurrency,
    100.0 * AVG(CASE WHEN success THEN 1 ELSE 0 END)::DOUBLE AS success_rate,
    COUNT(*) AS row_count
  FROM pre
  GROUP BY provider, concurrency
),
metric_stats AS (
  SELECT
    provider,
    concurrency,
    metric,
    AVG(value)                 AS avg_ms,
    MEDIAN(value)              AS median_ms,
    quantile_cont(value, 0.95) AS p95_ms,
    quantile_cont(value, 0.99) AS p99_ms,
    STDDEV(value)              AS stddev_ms
  FROM metric_long
  GROUP BY provider, concurrency, metric
)
SELECT
  ms.provider,
  ms.concurrency,
  sr.row_count,
  ROUND(sr.success_rate, 2) AS success_rate,
  ms.metric,
  ROUND(ms.avg_ms,    2) AS avg_ms,
  ROUND(ms.median_ms, 2) AS median_ms,
  ROUND(ms.p95_ms,    2) AS p95_ms,
  ROUND(ms.p99_ms,    2) AS p99_ms,
  ROUND(ms.stddev_ms, 2) AS stddev_ms
FROM metric_stats ms
LEFT JOIN success_rate sr USING (provider, concurrency)
ORDER BY
  ms.provider,
  ms.concurrency,
  CASE ms.metric
    WHEN 'session_creation_ms'        THEN 1
    WHEN 'session_connect_ms'         THEN 2
    WHEN 'page_goto_ms'               THEN 3
    WHEN 'page_ttfb_ms'               THEN 4
    WHEN 'page_dom_content_loaded_ms' THEN 5
    WHEN 'page_load_ms'               THEN 6
    WHEN 'session_release_ms'         THEN 7
    WHEN 'cost_usd'                   THEN 8
    WHEN 'total_ms'                   THEN 9
    ELSE 99
  END;
