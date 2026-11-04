#!/usr/bin/env bash
# Run one CAPTCHA campaign from the US West box, export it and push the result
# to main. Designed to be invoked from cron once a day.
#
# Usage:
#   scripts/run-captcha-and-publish.sh [--runs N] [--timeout SECONDS] [--date YYYY-MM-DD]
#       [--dry-run] [--no-reset] [--no-install]
#
# --runs is attempts per provider per CAPTCHA type (default 5: 75 paid sessions,
# about 30 minutes). The five providers are always passed explicitly, so a
# PROVIDER, RUNS or CONCURRENCY in the runner's environment cannot shrink the
# campaign. Only a complete campaign is published.
#
# .captcha-runs/needs-review is written before the campaign starts and removed
# only once it has exited cleanly. A campaign that fails, halts, is incomplete,
# or whose publisher is killed mid-run therefore leaves it behind, and later
# runs refuse to start until someone has reconciled the provider sessions and
# removed it, as docs/captcha.md requires. A result already published for the
# date is never run again, and a result committed but not pushed is pushed
# before anything else, so a failed push does not cost a second paid campaign.
# --no-reset keeps the checkout as it is and refuses tracked changes.

set -euo pipefail

RUNS=5
CONCURRENCY=3
TIMEOUT=7200
DATE=""
DRY_RUN=0
NO_RESET=0
NO_INSTALL=0
REGION=us-west
PROTOCOL=3
# Keep in sync with PROVIDERS in src/benchmarks/captcha/protocol.mjs (a test checks it).
CAPTCHA_PROVIDERS="kernel,browserbase,browser-use,steel,notte"
PUSH_RETRY_DELAY="${CAPTCHA_PUSH_RETRY_DELAY:-10}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runs)      RUNS="${2:-}"; shift 2 ;;
    --runs=*)    RUNS="${1#*=}"; shift ;;
    --timeout)   TIMEOUT="${2:-}"; shift 2 ;;
    --timeout=*) TIMEOUT="${1#*=}"; shift ;;
    --date)      DATE="${2:-}"; shift 2 ;;
    --date=*)    DATE="${1#*=}"; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --no-reset)  NO_RESET=1; shift ;;
    --no-install) NO_INSTALL=1; shift ;;
    -h|--help)
      sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "[ERROR] unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ ! "$RUNS" =~ ^([1-9]|1[0-9]|20)$ ]]; then
  echo "[ERROR] --runs must be an integer from 1 to 20" >&2
  exit 2
fi
if [[ ! "$TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
  echo "[ERROR] --timeout must be a positive integer number of seconds" >&2
  exit 2
fi
if [[ ! "$PUSH_RETRY_DELAY" =~ ^[0-9]+$ ]]; then
  echo "[ERROR] CAPTCHA_PUSH_RETRY_DELAY must be a non-negative integer" >&2
  exit 2
fi
[[ -n "$DATE" ]] || DATE="$(date -u +%Y-%m-%d)"
if [[ ! "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "[ERROR] --date must look like YYYY-MM-DD" >&2
  exit 2
fi

# Ubuntu 26.04 ships uutils timeout, whose --kill-after leaves children running.
# GNU coreutils stays installed there as gnutimeout.
TIMEOUT_BIN=""
for candidate in timeout gnutimeout; do
  if [[ "$("$candidate" --version 2>/dev/null)" == *"GNU coreutils"* ]]; then
    TIMEOUT_BIN="$candidate"
    break
  fi
done
[[ -n "$TIMEOUT_BIN" ]] || { echo "[ERROR] GNU timeout is required (timeout or gnutimeout)" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# One job at a time per checkout, and none beside a comparison run on the box.
exec 9>"$REPO_ROOT/.run-and-publish.lock"
if ! flock -w 7200 9; then
  echo "[ERROR] another job held the checkout lock for 2h; giving up" >&2
  exit 1
fi
exec 8>"${BROWSERARENA_COMPARISON_LOCK:-$HOME/.browserarena-comparison.lock}"
if ! flock -w 7200 8; then
  echo "[ERROR] a comparison run held its lock for 2h; giving up" >&2
  exit 1
fi

mkdir -p logs .captcha-runs
LOG_FILE="logs/cron-$(date -u +%Y-%m-%dT%H-%M-%SZ)-${REGION}-captcha.log"
exec > >(tee -a "$LOG_FILE") 2>&1

REVIEW_MARKER=".captcha-runs/needs-review"
if [[ -e "$REVIEW_MARKER" ]]; then
  echo "[ERROR] $REVIEW_MARKER exists; reconcile the provider sessions of the run it names, then remove it:" >&2
  cat "$REVIEW_MARKER" >&2
  exit 1
fi

echo "[INFO] start region=$REGION date=$DATE runs=$RUNS concurrency=$CONCURRENCY timeout=${TIMEOUT}s dry_run=$DRY_RUN no_reset=$NO_RESET repo=$REPO_ROOT"

# A region-tagged identity so commits are attributable per box. Set before any
# rebase, which also creates commits.
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-browserarena-bot ($REGION)}"
GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-bot@browserarena.ai}"
GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

push_main() {
  local attempts=5 delay="$PUSH_RETRY_DELAY" i
  for i in $(seq 1 $attempts); do
    if git pull --rebase origin main && git push origin main; then
      echo "[INFO] push ok on attempt $i"
      return 0
    fi
    echo "[WARN] push failed on attempt $i; retrying in ${delay}s"
    sleep "$delay"
    delay=$(( delay * 2 ))
  done
  return 1
}

hold_for_review() {
  printf '%s date=%s evidence=%s reason=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DATE" "${OUT:-none}" "$1" > "$REVIEW_MARKER"
  echo "[ERROR] $1; evidence kept at ${OUT:-none}; wrote $REVIEW_MARKER" >&2
  exit 1
}

git fetch origin
if [[ $NO_RESET -eq 0 ]]; then
  git checkout main
elif [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "[ERROR] --no-reset needs a clean index and tracked files; found changes:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

# A result committed on an earlier day whose push failed is still unpublished.
# Push it before the reset below would discard it.
pending="$(git rev-list --count origin/main..HEAD)"
if [[ "$pending" -gt 0 ]]; then
  unrelated="$(git diff --name-only origin/main..HEAD | grep -v '^results/captcha/' || true)"
  if [[ -n "$unrelated" ]]; then
    echo "[ERROR] local commits ahead of origin/main touch files other than CAPTCHA results; resolve them by hand:" >&2
    echo "$unrelated" >&2
    exit 1
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[INFO] --dry-run: $pending commit(s) from an earlier failed push are waiting to be pushed; stopping without pushing, resetting or running a campaign"
    exit 0
  fi
  echo "[INFO] pushing $pending commit(s) left by an earlier failed push"
  push_main || { echo "[ERROR] could not push the pending results; leaving them in place" >&2; exit 1; }
fi

if [[ $NO_RESET -eq 0 ]]; then
  echo "[INFO] resetting working tree to origin/main"
  git reset --hard origin/main
else
  echo "[INFO] --no-reset: leaving the working tree as it is"
fi

ID="${DATE}-west-v${PROTOCOL}"
RESULT="results/captcha/${ID}.json"
if [[ -e "$RESULT" ]]; then
  echo "[INFO] $RESULT is already published; nothing to run"
  exit 0
fi

if [[ $NO_INSTALL -eq 0 ]]; then
  echo "[INFO] npm ci"
  npm ci
  npm run build
fi

if [[ -f .env ]]; then
  echo "[INFO] sourcing .env"
  set -a; . ./.env; set +a
else
  echo "[WARN] no .env found; provider env vars must already be exported"
fi

OUT=".captcha-runs/daily-${DATE}-$(date -u +%H%M%S)"
echo "[INFO] running campaign id=$ID out=$OUT"
# Written before the first session starts. If this script or the box dies during
# the campaign, nothing below runs and the marker keeps the next run from
# starting on top of sessions nobody has checked.
printf '%s date=%s evidence=%s reason=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DATE" "$OUT" "campaign started and did not finish" > "$REVIEW_MARKER"
# SIGTERM lets active attempts finish cleanup, so the kill comes much later than
# in the lifecycle publisher. Never skip straight to SIGKILL.
campaign_status=0
"$TIMEOUT_BIN" --signal=TERM --kill-after=600s "${TIMEOUT}s" node dist/cli.js \
  --benchmark=captcha \
  --provider="$CAPTCHA_PROVIDERS" \
  --runs="$RUNS" \
  --concurrency="$CONCURRENCY" \
  --out="$OUT" || campaign_status=$?

if [[ $campaign_status -ne 0 ]]; then
  hold_for_review "campaign exited with status $campaign_status"
fi
rm -f -- "$REVIEW_MARKER"

echo "[INFO] exporting $ID"
if ! npm run captcha:export -- "$OUT" "$ID"; then
  echo "[ERROR] export failed; evidence kept at $OUT" >&2
  exit 1
fi

# Only a complete campaign is published automatically.
if ! node --input-type=module - "$RESULT" <<'NODE'
import fs from "node:fs";
const campaign = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.exit(campaign.complete === true && !campaign.halted && !campaign.interrupted ? 0 : 1);
NODE
then
  rm -f -- "$RESULT"
  hold_for_review "campaign was not complete"
fi

git add -- "$RESULT"
if git diff --cached --quiet -- "$RESULT"; then
  echo "[WARN] nothing staged for $RESULT"
  exit 1
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[INFO] --dry-run: skipping commit/push. Staged diff:"
  git diff --cached --stat -- "$RESULT"
  exit 0
fi

# Only the result: nothing else in the index goes into this commit.
git commit -m "results: captcha $REGION $DATE" -- "$RESULT"

if push_main; then
  # Private evidence is large (screenshots); keep two weeks of it.
  find .captcha-runs -maxdepth 1 -type d -name 'daily-*' -mtime +14 -exec rm -rf -- {} +
  exit 0
fi

# The commit stays; the next run pushes it before resetting.
echo "[ERROR] push failed after 5 attempts; $RESULT is committed locally and the next run will retry it. Evidence kept at $OUT" >&2
exit 1
