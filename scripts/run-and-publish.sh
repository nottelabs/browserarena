#!/usr/bin/env bash
# Run one benchmark for one region's providers, then commit and push the new
# results to main. Designed to be invoked from cron on each EC2.
#
# Usage:
#   scripts/run-and-publish.sh --region us-east|us-west [--benchmark hello-browser|browser-throughput]
#       [--concurrency 1,10] [--runs N] [--loops N] [--provider-timeout SECONDS]
#       [--dry-run] [--no-reset]
#
# c25/c50 are valid --concurrency levels; check the provider plan's concurrent
# session cap first, or the run reports plan limits as reliability. TinyFish
# uses TINYFISH_CONCURRENCY separately (default 1, account default limit 5).
#
# Cron does git pull/reset + npm ci + bench + git commit/push. The two regions
# write to disjoint provider directories, so simultaneous runs only race on
# `git push` itself; the retry loop handles that.

set -euo pipefail

REGION=""
BENCHMARK="hello-browser"
CONCURRENCY="1,10"
RUNS=100
LOOPS=1
PROVIDER_TIMEOUT=""
DRY_RUN=0
NO_RESET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region)    REGION="${2:-}"; shift 2 ;;
    --region=*)  REGION="${1#*=}"; shift ;;
    --benchmark)   BENCHMARK="${2:-}"; shift 2 ;;
    --benchmark=*) BENCHMARK="${1#*=}"; shift ;;
    --concurrency)   CONCURRENCY="${2:-}"; shift 2 ;;
    --concurrency=*) CONCURRENCY="${1#*=}"; shift ;;
    --runs)      RUNS="${2:-}"; shift 2 ;;
    --runs=*)    RUNS="${1#*=}"; shift ;;
    --loops)     LOOPS="${2:-}"; shift 2 ;;
    --loops=*)   LOOPS="${1#*=}"; shift ;;
    --provider-timeout)   PROVIDER_TIMEOUT="${2:-}"; shift 2 ;;
    --provider-timeout=*) PROVIDER_TIMEOUT="${1#*=}"; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --no-reset)  NO_RESET=1; shift ;;
    -h|--help)
      sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "[ERROR] unknown arg: $1" >&2; exit 2 ;;
  esac
done

case "$REGION" in
  us-east) PROVIDERS="steel,kernel,kernel-headful,hyperbrowser,anchorbrowser,browser-use,browserbase,tilion,cloudflare,aws-agentcore" ;;
  us-west) PROVIDERS="notte,lightpanda,browserless,tinyfish" ;;
  "")      echo "[ERROR] --region us-east|us-west required" >&2; exit 2 ;;
  *)       echo "[ERROR] invalid --region: $REGION (want us-east or us-west)" >&2; exit 2 ;;
esac

case "$BENCHMARK" in
  hello-browser|browser-throughput) ;;
  *) echo "[ERROR] invalid --benchmark: $BENCHMARK (want hello-browser or browser-throughput)" >&2; exit 2 ;;
esac

if [[ -z "$PROVIDER_TIMEOUT" ]]; then
  if [[ "$BENCHMARK" == "browser-throughput" ]]; then
    PROVIDER_TIMEOUT=3600
  else
    PROVIDER_TIMEOUT=1800
  fi
fi
if [[ ! "$PROVIDER_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
  echo "[ERROR] --provider-timeout must be a positive integer number of seconds" >&2
  exit 2
fi
command -v timeout >/dev/null || { echo "[ERROR] GNU timeout is required" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# One job at a time per checkout. The hello-browser and browser-throughput cron lines
# share this working tree; without a lock, a long first run and the second
# run would both reset the tree and fight over the index.
exec 9>"$REPO_ROOT/.run-and-publish.lock"
if ! flock -w 7200 9; then
  echo "[ERROR] another run-and-publish.sh held the lock for 2h; giving up" >&2
  exit 1
fi

mkdir -p logs
LOG_FILE="logs/cron-$(date -u +%Y-%m-%dT%H-%M-%SZ)-${REGION}-${BENCHMARK}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[INFO] start region=$REGION benchmark=$BENCHMARK concurrency=$CONCURRENCY runs=$RUNS loops=$LOOPS dry_run=$DRY_RUN no_reset=$NO_RESET repo=$REPO_ROOT"

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

if [[ -f .env.tinyfish ]]; then
  echo "[INFO] sourcing .env.tinyfish"
  set -a; . ./.env.tinyfish; set +a
fi
tinyfish_concurrency="${TINYFISH_CONCURRENCY:-1}"
if [[ ! "$tinyfish_concurrency" =~ ^[1-9][0-9]*(,[1-9][0-9]*)*$ ]]; then
  echo "[ERROR] TINYFISH_CONCURRENCY must be a comma-separated list of positive integers" >&2
  exit 2
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
    tilion)          v="${TILION_API_KEY:-}" ;;
    lightpanda)      v="${LIGHTPANDA_API_KEY:-}" ;;
    browserless)     v="${BROWSERLESS_API_KEY:-}" ;;
    tinyfish)        v="${TINYFISH_API_KEY:-}" ;;
    cloudflare)      v="${CLOUDFLARE_API_TOKEN:-}" ;;
    aws-agentcore)   v="${AWS_REGION:-}" ;;
    *) echo "[ERROR] unknown provider in region map: $p" >&2; exit 2 ;;
  esac
  [[ -n "$v" ]] && have_any=1
done
if [[ $have_any -eq 0 ]]; then
  echo "[ERROR] no provider in region $REGION has its API key set; aborting" >&2
  exit 1
fi

DATE="$(date -u +%Y-%m-%d)"
echo "[INFO] running benchmark=$BENCHMARK date=$DATE providers=$PROVIDERS provider_timeout=${PROVIDER_TIMEOUT}s"
npm run build

result_status=0
for p in "${PROV_LIST[@]}"; do
  provider_concurrency="$CONCURRENCY"
  if [[ "$p" == "tinyfish" ]]; then provider_concurrency="$tinyfish_concurrency"; fi
  echo "[INFO] starting provider=$p concurrency=$provider_concurrency timeout=${PROVIDER_TIMEOUT}s"
  provider_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # A process boundary also bounds SDK retries, cleanup, and a blocked event
  # loop. GNU timeout signals the whole process group, then forces termination
  # after 30s if SIGTERM is ignored. Do not use --foreground: it leaves children
  # outside the timeout's process group.
  provider_status=0
  timeout --kill-after=30s "${PROVIDER_TIMEOUT}s" node dist/cli.js \
    --benchmark="$BENCHMARK" \
    --provider="$p" \
    --run-date="$DATE" \
    --articles=fixed \
    --concurrency="$provider_concurrency" \
    --runs="$RUNS" \
    --loops="$LOOPS" || provider_status=$?

  if [[ $provider_status -ne 0 ]]; then
    result_status=1
    case "$provider_status" in
      124) outcome=timed_out ;;
      137) outcome=killed ;;
      *)   outcome=failed ;;
    esac
    echo "[ERROR] provider=$p outcome=$outcome exit=$provider_status limit=${PROVIDER_TIMEOUT}s; continuing with remaining providers"
    meta="results/$BENCHMARK/$p/$DATE/_meta.json"
    # Record even failures during startup/VM discovery, before the CLI has
    # created a result directory. Do not manufacture any measured samples.
    node --input-type=module - "$meta" "$outcome" "$provider_status" "$provider_started_at" <<'NODE'
import fs from "node:fs";
import path from "node:path";
const [file, status, exitCode, startedAt] = process.argv.slice(2);
let meta;
try {
  meta = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (error) {
  // The worker may not have written metadata, or SIGKILL interrupted a write.
  if (!(error instanceof SyntaxError) && error.code !== "ENOENT") throw error;
  meta = {};
}
meta.started_at ||= startedAt;
meta.finished_at = new Date().toISOString();
meta.run_status = status;
meta.process_exit_code = Number(exitCode);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(meta, null, 2) + "\n");
NODE
  fi
done

echo "[INFO] staging results for $REGION"
staged_any=0
for p in "${PROV_LIST[@]}"; do
  dir="results/$BENCHMARK/$p/$DATE"
  if [[ -d "$dir" ]]; then
    git add -- "$dir"
    staged_any=1
    echo "[INFO] staged $dir"
  else
    echo "[WARN] no results dir for $p at $dir (skipped or failed)"
  fi
done

if [[ $staged_any -eq 0 ]]; then
  echo "[WARN] nothing to commit for region $REGION on $DATE"
  exit "$result_status"
fi

if git diff --cached --quiet; then
  echo "[WARN] staged paths contain no changes vs HEAD"
  exit "$result_status"
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[INFO] --dry-run: skipping commit/push. Staged diff:"
  git diff --cached --stat
  exit "$result_status"
fi

# Use a region-tagged identity so commits are attributable per box. Falls back
# to whatever git config is already set if these aren't overridden.
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-browserarena-bot ($REGION)}"
GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-bot@browserarena.ai}"
GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

if [[ "$BENCHMARK" == "hello-browser" ]]; then
  git commit -m "results: $REGION $DATE"
else
  git commit -m "results: $BENCHMARK $REGION $DATE"
fi

# Commit before rebasing: a rerun can append to already tracked result files.
# Publish completed providers even if another timed out, then report failure
# to cron instead of making an incomplete campaign look healthy.
attempts=5
delay=10
for i in $(seq 1 $attempts); do
  git pull --rebase origin main
  if git push origin main; then
    echo "[INFO] push ok on attempt $i"
    exit "$result_status"
  fi
  echo "[WARN] push failed on attempt $i; rebasing and retrying in ${delay}s"
  sleep "$delay"
  delay=$(( delay * 2 ))
done

echo "[ERROR] push failed after $attempts attempts" >&2
exit 1
