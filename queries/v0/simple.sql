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
    try_cast(session_creation_ms AS DOUBLE) AS session_creation_ms,
    try_cast(session_connect_ms  AS DOUBLE) AS session_connect_ms,
    try_cast(page_goto_ms        AS DOUBLE) AS page_goto_ms,
    COALESCE(try_cast(page_script_ms AS DOUBLE), 0) AS page_script_ms,
    try_cast(session_release_ms  AS DOUBLE) AS session_release_ms
  FROM data
),
pre_success AS (
  SELECT
    provider,
    concurrency,
    session_creation_ms,
    session_connect_ms,
    page_goto_ms,
    session_release_ms,
    (session_creation_ms + session_connect_ms + page_goto_ms + page_script_ms + session_release_ms) AS total_ms
  FROM pre
  WHERE success = true
)
SELECT
  provider,
  concurrency,
  ROUND(AVG(total_ms), 2) AS avg_total_ms
FROM pre_success
GROUP BY provider, concurrency
ORDER BY provider, concurrency;
