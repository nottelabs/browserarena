WITH data AS (
  SELECT *
  FROM read_json_auto('results/hello-browser/**/*.jsonl', format='newline_delimited')
),
pre AS (
  SELECT
    provider,
    success,
    try_cast(session_creation_ms AS DOUBLE) AS session_creation_ms,
    try_cast(session_connect_ms  AS DOUBLE) AS session_connect_ms,
    try_cast(page_goto_ms        AS DOUBLE) AS page_goto_ms,
    try_cast(session_release_ms  AS DOUBLE) AS session_release_ms
  FROM data
),
pre_success AS (
  SELECT *,
    (session_creation_ms + session_connect_ms + page_goto_ms + session_release_ms) AS total_ms
  FROM pre
  WHERE success = true
),
metric_long AS (
  SELECT provider, 'create'  AS stage, session_creation_ms AS value FROM pre_success
  UNION ALL
  SELECT provider, 'connect' AS stage, session_connect_ms  AS value FROM pre_success
  UNION ALL
  SELECT provider, 'goto'    AS stage, page_goto_ms        AS value FROM pre_success
  UNION ALL
  SELECT provider, 'release' AS stage, session_release_ms  AS value FROM pre_success
  UNION ALL
  SELECT provider, 'total'   AS stage, total_ms            AS value FROM pre_success
),
success_rate AS (
  SELECT
    provider,
    COUNT(*) AS runs,
    100.0 * AVG(CASE WHEN success THEN 1 ELSE 0 END)::DOUBLE AS success_pct
  FROM pre
  GROUP BY provider
),
metric_stats AS (
  SELECT
    provider,
    stage,
    ROUND(MEDIAN(value))              AS median,
    ROUND(quantile_cont(value, 0.90)) AS p90,
    ROUND(quantile_cont(value, 0.95)) AS p95,
    ROUND(MIN(value))                 AS min,
    ROUND(MAX(value))                 AS max
  FROM metric_long
  GROUP BY provider, stage
)
SELECT
  ms.provider,
  sr.runs,
  ROUND(sr.success_pct, 1) AS "success%",
  ms.stage,
  ms.median,
  ms.p90,
  ms.p95,
  ms.min,
  ms.max
FROM metric_stats ms
LEFT JOIN success_rate sr USING (provider)
ORDER BY
  ms.provider,
  CASE ms.stage
    WHEN 'create'  THEN 1
    WHEN 'connect' THEN 2
    WHEN 'goto'    THEN 3
    WHEN 'release' THEN 4
    WHEN 'total'   THEN 5
  END;
