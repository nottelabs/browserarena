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
BASELAYER_SELFHOST_METAL_JSON=""

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
  us-east) PROVIDERS="steel,kernel,kernel-headful,hyperbrowser,anchorbrowser,browser-use,baselayer" ;;
  us-west) PROVIDERS="notte,browserbase" ;;
  "")      echo "[ERROR] --region us-east|us-west required" >&2; exit 2 ;;
  *)       echo "[ERROR] invalid --region: $REGION (want us-east or us-west)" >&2; exit 2 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

cleanup_baselayer_selfhost() {
  if [[ -z "${BASELAYER_SELFHOST_METAL_JSON:-}" || ! -f "$BASELAYER_SELFHOST_METAL_JSON" ]]; then
    return
  fi
  node - "$BASELAYER_SELFHOST_METAL_JSON" <<'NODE'
const fs = require("fs");
const meta = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!meta.instanceId || !meta.region) process.exit(0);
console.log(`[INFO] terminating BaseLayer self-host metal ${meta.instanceId} in ${meta.region}`);
const { spawnSync } = require("child_process");
spawnSync("aws", [
  "ec2",
  "terminate-instances",
  "--profile",
  process.env.BASELAYER_AWS_PROFILE || "baselayer",
  "--region",
  meta.region,
  "--instance-ids",
  meta.instanceId,
], { stdio: "inherit" });
NODE
}
trap cleanup_baselayer_selfhost EXIT

provider_enabled() {
  local needle="$1"
  IFS=',' read -ra enabled <<< "$PROVIDERS"
  for p in "${enabled[@]}"; do
    [[ "$p" == "$needle" ]] && return 0
  done
  return 1
}

setup_baselayer_selfhost() {
  if ! provider_enabled "baselayer"; then
    return
  fi
  if [[ -n "${BASELAYER_API_URL:-}" ]]; then
    echo "[INFO] BASELAYER_API_URL already set; using existing BaseLayer endpoint"
    return
  fi
  if [[ "${BASELAYER_AUTO_SELFHOST:-1}" != "1" ]]; then
    echo "[ERROR] baselayer provider is enabled but BASELAYER_API_URL is unset." >&2
    echo "[ERROR] Set BASELAYER_API_URL or set BASELAYER_AUTO_SELFHOST=1 to provision from the BaseLayer repo." >&2
    exit 1
  fi
  if [[ $DRY_RUN -eq 1 && "${BASELAYER_DRY_RUN_SELFHOST:-0}" != "1" ]]; then
    echo "[INFO] --dry-run: skipping BaseLayer auto-selfhost provisioning."
    echo "[INFO] Set BASELAYER_DRY_RUN_SELFHOST=1 to allow dry-run provisioning."
    return
  fi

  local ps
  ps="$(command -v pwsh || command -v powershell || true)"
  if [[ -z "$ps" ]]; then
    echo "[ERROR] BaseLayer auto-selfhost requires PowerShell 7+ (pwsh) because the BaseLayer AWS wrapper is PowerShell." >&2
    exit 1
  fi
  if ! command -v aws >/dev/null 2>&1; then
    echo "[ERROR] BaseLayer auto-selfhost requires AWS CLI v2 on the BrowserArena runner." >&2
    exit 1
  fi

  local base_repo="${BASELAYER_REPO:-https://github.com/Lasdw6/BaseLayer.git}"
  local base_ref="${BASELAYER_REF:-main}"
  local base_dir="${BASELAYER_SELFHOST_REPO_DIR:-$REPO_ROOT/.tmp/baselayer-selfhost-repo}"
  local out_dir="${BASELAYER_SELFHOST_OUT_DIR:-$REPO_ROOT/.tmp/baselayer-selfhost}"
  local aws_region="${BASELAYER_AWS_REGION:-us-east-2}"
  local smoke_runs="${BASELAYER_SELFHOST_SMOKE_RUNS:-1}"
  local smoke_concurrency="${BASELAYER_SELFHOST_SMOKE_CONCURRENCY:-1}"
  local runtime_profile="${BASELAYER_RUNTIME_PROFILE:-baselayer-firecracker-headless-shell}"

  echo "[INFO] provisioning BaseLayer self-host from $base_repo ref=$base_ref region=$aws_region"
  rm -rf "$base_dir"
  git clone --depth 1 --branch "$base_ref" "$base_repo" "$base_dir"

  "$ps" -NoProfile -ExecutionPolicy Bypass -File "$base_dir/scripts/bench/run-browserarena-selfhosted.ps1" \
    -Mode local \
    -AwsProfile "${BASELAYER_AWS_PROFILE:-baselayer}" \
    -Region "$aws_region" \
    -BaseLayerRepo "$base_repo" \
    -BaseLayerRef "$base_ref" \
    -BrowserArenaPath "$REPO_ROOT" \
    -Target "${BASELAYER_SELFHOST_TARGET:-https://example.com}" \
    -RuntimeProfile "$runtime_profile" \
    -Concurrency "$smoke_concurrency" \
    -Runs "$smoke_runs" \
    -Repeats 1 \
    -KeepMetal \
    -OutDir "$out_dir"

  BASELAYER_SELFHOST_METAL_JSON="$(find "$out_dir" -path '*/repeat-1/metal.json' -type f | sort | tail -n 1)"
  if [[ -z "$BASELAYER_SELFHOST_METAL_JSON" || ! -f "$BASELAYER_SELFHOST_METAL_JSON" ]]; then
    echo "[ERROR] BaseLayer self-host setup did not produce metal.json under $out_dir" >&2
    exit 1
  fi
  export BASELAYER_API_URL
  BASELAYER_API_URL="$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(`http://${m.publicIp}:3000`);' "$BASELAYER_SELFHOST_METAL_JSON")"
  export BASELAYER_RUNTIME_PROFILE="$runtime_profile"
  rm -rf "results/hello-browser/baselayer/$(date -u +%F)"
  echo "[INFO] BaseLayer self-host ready at $BASELAYER_API_URL"
}

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

setup_baselayer_selfhost

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
    baselayer)        v="${BASELAYER_API_URL:-}" ;;
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
