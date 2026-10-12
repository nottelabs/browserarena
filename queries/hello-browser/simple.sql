-- Rows are read as raw JSON objects so fields that older files lack (such as
-- `warmup`, recorded since the warm-up sessions started being written) read
-- as NULL instead of failing the query.
WITH rows AS (
  SELECT
    json->>'provider'                                      AS provider,
    try_cast(json->>'success' AS BOOLEAN)                  AS success,
    COALESCE(try_cast(json->>'warmup' AS BOOLEAN), false)  AS warmup,
    try_cast(json->>'session_creation_ms' AS DOUBLE)       AS session_creation_ms,
    try_cast(json->>'session_connect_ms'  AS DOUBLE)       AS session_connect_ms,
    try_cast(json->>'page_goto_ms'        AS DOUBLE)       AS page_goto_ms,
    try_cast(json->>'session_release_ms'  AS DOUBLE)       AS session_release_ms
  FROM read_ndjson_objects('results/hello-browser/**/*.jsonl')
)
SELECT
  provider,
  COUNT(*) AS runs,
  ROUND(100.0 * AVG(CASE WHEN success THEN 1 ELSE 0 END), 1) AS "success%",
  ROUND(MEDIAN(session_creation_ms + session_connect_ms + page_goto_ms + session_release_ms)) AS median_total,
  ROUND(MEDIAN(session_creation_ms)) AS create,
  ROUND(MEDIAN(session_connect_ms))  AS connect,
  ROUND(MEDIAN(page_goto_ms))        AS goto,
  ROUND(MEDIAN(session_release_ms))  AS release
FROM rows
WHERE success = true AND NOT warmup
GROUP BY provider
ORDER BY median_total;
