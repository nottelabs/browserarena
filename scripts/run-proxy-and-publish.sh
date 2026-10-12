#!/usr/bin/env bash
# Daily proxy GET batches: --batch 1..5 targets 10,20,30,40,50 attempts/country.
# Run from a DEDICATED checkout so lifecycle cron cannot reset this workspace.
# --check builds and verifies credentials/target without sessions or publication.
set -euo pipefail

BATCH=5
CHECK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --batch) BATCH="${2:-}"; shift 2 ;;
    --check) CHECK=1; shift ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) echo "[ERROR] unknown arg: $1" >&2; exit 2 ;;
  esac
done
[[ "$BATCH" =~ ^[1-5]$ ]] || { echo "[ERROR] --batch must be 1..5" >&2; exit 2; }

cd "$(dirname "$0")/.."
mkdir -p logs
exec 9>logs/proxy-publish.lock
flock -n 9 || { echo "[ERROR] another proxy batch is still running" >&2; exit 1; }
DATE="$(date -u +%Y-%m-%d)"
exec > >(tee -a "logs/proxy-cron-${DATE}-batch-${BATCH}.log") 2>&1
echo "[INFO] proxy date=$DATE batch=$BATCH check=$CHECK"

if [[ $CHECK -eq 0 ]]; then
  [[ "$(git branch --show-current)" == main ]] || { echo "[ERROR] publisher requires the main branch"; exit 1; }
  git diff --cached --quiet || { echo "[ERROR] unrelated staged changes; refusing publication"; exit 1; }
  [[ -z "$(git diff --name-only -- . ':!results/proxy-get')" ]] || {
    echo "[ERROR] tracked code changes; refusing to run or publish"; exit 1;
  }
  while IFS= read -r file; do
    [[ -z "$file" || "$file" == results/proxy-get/index.json
      || "$file" =~ ^results/proxy-get/[a-z0-9-]+/[0-9]{4}-[0-9]{2}-[0-9]{2}/(results\.jsonl|_meta\.json)$ ]] || {
      echo "[ERROR] unrelated tracked proxy changes: $file"; exit 1;
    }
  done < <(git diff --name-only -- results/proxy-get)
  # Preserve partial results after an interrupted batch; never reset them away.
  if git diff --quiet; then
    git pull --rebase origin main
  else
    echo "[INFO] preserving uncommitted results for suite resume; skipping pull"
  fi
  npm ci
fi
npm run build
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
PROVIDERS="steel,kernel,hyperbrowser,anchorbrowser,browser-use,browserbase,notte,tilion,lightpanda,browserless,cloudflare,aws-agentcore"
TARGET="${PROXY_GET_PAYLOAD_URL:-https://www.browserarena.ai/api/proxy-get/payload}"
BOOTSTRAP="${PROXY_BOOTSTRAP_URL:-${TARGET%/api/proxy-get/payload}/api/proxy-get/bootstrap}"
# Explicit arguments isolate proxy scheduling from lifecycle defaults in .env.
ARGS=(--benchmark=proxy-get --provider="$PROVIDERS" "--countries=US,FR,BR,IN,JP"
  --runs="$((BATCH * 10))" --run-id="daily-proxy-${DATE}" --rate=10 --concurrency=1
  --url="$TARGET" --bootstrap-url="$BOOTSTRAP")
# Do not silently publish a partial provider comparison when a key is missing.
env -u OUTPUT node dist/cli.js "${ARGS[@]}" --preflight
[[ $CHECK -eq 0 ]] || exit 0
env -u OUTPUT node dist/cli.js "${ARGS[@]}"

PATHS=(results/proxy-get/index.json)
# The index includes saved history: publish its files too, including old-day
# partial batches. Stage only sample/metadata files, never arbitrary artifacts.
for dir in results/proxy-get/*/????-??-??; do
  [[ -d "$dir" ]] || continue
  provider="$(basename "$(dirname "$dir")")"
  [[ "$provider" =~ ^[a-z0-9-]+$ && "$(basename "$dir")" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
  [[ ! -f "$dir/results.jsonl" ]] || PATHS+=("$dir/results.jsonl")
  [[ ! -f "$dir/_meta.json" ]] || PATHS+=("$dir/_meta.json")
done
while IFS= read -r -d '' file; do
  [[ "$file" =~ ^results/proxy-get/[a-z0-9-]+/[0-9]{4}-[0-9]{2}-[0-9]{2}/(results\.jsonl|_meta\.json)$ ]] || continue
  PATHS+=("$file")
done < <(git ls-files --deleted -z -- results/proxy-get)
[[ ${#PATHS[@]} -gt 1 ]] || { echo "[ERROR] no results written"; exit 1; }
git add -- "${PATHS[@]}"
git diff --cached --quiet && { echo "[INFO] daily target already published"; exit 0; }
export GIT_AUTHOR_NAME="browserarena-bot (proxy)" GIT_AUTHOR_EMAIL="bot@browserarena.ai"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
git commit -m "results: proxy-get $DATE batch $BATCH"
for attempt in 1 2 3 4 5; do
  git pull --rebase origin main
  if git push origin main; then echo "[INFO] published batch $BATCH (push attempt $attempt)"; exit 0; fi
  sleep 10
done
echo "[ERROR] could not publish; results remain committed locally" >&2
exit 1
