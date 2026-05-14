#!/usr/bin/env bash
# Run the hello-browser benchmark for one region's providers, then commit and
# push the new results to main. Designed to be invoked from cron on each EC2.
#
# Usage:
#   scripts/run-and-publish.sh --region us-east|us-west [--runs N] [--dry-run] [--no-reset]
#
# Cron does git pull/reset + npm ci + bench + git commit/push. The two regions
# write to disjoint provider directories, so simultaneous runs only race on
# `git push` itself; the retry loop handles that.

set -euo pipefail

REGION=""
RUNS=100
DRY_RUN=0
NO_RESET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region)    REGION="${2:-}"; shift 2 ;;
    --region=*)  REGION="${1#*=}"; shift ;;
    --runs)      RUNS="${2:-}"; shift 2 ;;
    --runs=*)    RUNS="${1#*=}"; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --no-reset)  NO_RESET=1; shift ;;
    -h|--help)
      sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "[ERROR] unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$REGION" in
  us-east) PROVIDERS="steel,kernel,kernel-headful,hyperbrowser,anchorbrowser,browser-use" ;;
  us-west) PROVIDERS="notte,browserbase" ;;
  "")      echo "[ERROR] --region us-east|us-west required" >&2; exit 2 ;;
  *)       echo "[ERROR] invalid --region: $REGION (want us-east or us-west)" >&2; exit 2 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

mkdir -p logs
LOG_FILE="logs/cron-$(date -u +%Y-%m-%dT%H-%M-%SZ)-${REGION}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[INFO] start region=$REGION runs=$RUNS dry_run=$DRY_RUN no_reset=$NO_RESET repo=$REPO_ROOT"

if [[ $NO_RESET -eq 0 ]]; then
  echo "[INFO] resetting working tree to origin/main"
  git fetch origin
  git checkout main
  git reset --hard origin/main
else
  echo "[INFO] --no-reset: skipping fetch/reset"
fi

echo "[INFO] npm ci"
npm ci

if [[ -f .env ]]; then
  echo "[INFO] sourcing .env"
  set -a; . ./.env; set +a
else
  echo "[WARN] no .env found; provider env vars must already be exported"
fi

# Sanity: at least one provider in this region has its env var set. Mirrors
# the env-var map in src/providers/index.ts.
have_any=0
IFS=',' read -ra PROV_LIST <<< "$PROVIDERS"
for p in "${PROV_LIST[@]}"; do
  case "$p" in
    steel)           v="${STEEL_API_KEY:-}" ;;
    kernel|kernel-headful) v="${KERNEL_API_KEY:-}" ;;
    hyperbrowser)    v="${HYPERBROWSER_API_KEY:-}" ;;
    anchorbrowser)   v="${ANCHORBROWSER_API_KEY:-}" ;;
    browser-use)     v="${BROWSER_USE_API_KEY:-}" ;;
    notte)           v="${NOTTE_API_KEY:-}" ;;
    browserbase)     v="${BROWSERBASE_API_KEY:-}" ;;
    *) echo "[ERROR] unknown provider in region map: $p" >&2; exit 2 ;;
  esac
  [[ -n "$v" ]] && have_any=1
done
if [[ $have_any -eq 0 ]]; then
  echo "[ERROR] no provider in region $REGION has its API key set; aborting" >&2
  exit 1
fi

DATE="$(date -u +%Y-%m-%d)"
echo "[INFO] running benchmark date=$DATE providers=$PROVIDERS"
npm run bench -- \
  --benchmark=hello-browser \
  --provider="$PROVIDERS" \
  --concurrency=1,10 \
  --runs="$RUNS"

# Pull just before staging/commit so the commit is based on any results the
# other region pushed while this benchmark was running.
if [[ $DRY_RUN -eq 0 ]]; then
  git pull --rebase origin main
fi

echo "[INFO] staging results for $REGION"
staged_any=0
for p in "${PROV_LIST[@]}"; do
  dir="results/hello-browser/$p/$DATE"
  if [[ -d "$dir" ]]; then
    git add -- "$dir"
    staged_any=1
    echo "[INFO] staged $dir"
  else
    echo "[WARN] no results dir for $p at $dir (skipped or failed)"
  fi
done

if [[ $staged_any -eq 0 ]]; then
  echo "[WARN] nothing to commit for region $REGION on $DATE; exiting clean"
  exit 0
fi

if git diff --cached --quiet; then
  echo "[WARN] staged paths contain no changes vs HEAD; exiting clean"
  exit 0
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[INFO] --dry-run: skipping commit/push. Staged diff:"
  git diff --cached --stat
  exit 0
fi

# Use a region-tagged identity so commits are attributable per box. Falls back
# to whatever git config is already set if these aren't overridden.
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-browserarena-bot ($REGION)}"
GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-bot@browserarena.ai}"
GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

git commit -m "results: $REGION $DATE"

# Push with retry. Disjoint dirs across regions mean rebase always auto-applies.
attempts=5
delay=10
for i in $(seq 1 $attempts); do
  if git push origin main; then
    echo "[INFO] push ok on attempt $i"
    exit 0
  fi
  echo "[WARN] push failed on attempt $i; rebasing and retrying in ${delay}s"
  sleep "$delay"
  git pull --rebase origin main
  delay=$(( delay * 2 ))
done

echo "[ERROR] push failed after $attempts attempts" >&2
exit 1
