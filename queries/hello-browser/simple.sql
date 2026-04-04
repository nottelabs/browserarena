SELECT
  provider,
  COUNT(*) AS runs,
  ROUND(100.0 * AVG(CASE WHEN success THEN 1 ELSE 0 END), 1) AS "success%",
  ROUND(MEDIAN(session_creation_ms + session_connect_ms + page_goto_ms + session_release_ms)) AS median_total,
  ROUND(MEDIAN(session_creation_ms)) AS create,
  ROUND(MEDIAN(session_connect_ms))  AS connect,
  ROUND(MEDIAN(page_goto_ms))        AS goto,
  ROUND(MEDIAN(session_release_ms))  AS release
FROM read_json_auto('results/hello-browser/**/*.jsonl', format='newline_delimited')
WHERE success = true
GROUP BY provider
ORDER BY median_total;
