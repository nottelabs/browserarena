-- Rows are read as raw JSON objects so fields that older files lack (such as
-- `warmup`, recorded since the warm-up sessions started being written) read
-- as NULL instead of failing the query.
WITH data AS (
  SELECT json
  FROM read_ndjson_objects('results/hello-browser/**/*.jsonl')
),
pre AS (
  SELECT
    json->>'provider'                                 AS provider,
    try_cast(json->>'success' AS BOOLEAN)             AS success,
    try_cast(json->>'session_creation_ms' AS DOUBLE)  AS session_creation_ms,
    try_cast(json->>'session_connect_ms'  AS DOUBLE)  AS session_connect_ms,
    try_cast(json->>'page_goto_ms'        AS DOUBLE)  AS page_goto_ms,
    try_cast(json->>'session_release_ms'  AS DOUBLE)  AS session_release_ms
  FROM data
  -- Warm-up sessions are recorded with warmup=true and never counted.
  WHERE NOT COALESCE(try_cast(json->>'warmup' AS BOOLEAN), false)
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
