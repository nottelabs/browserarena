#!/usr/bin/env bash
# Vercel's ignored build step: exit 0 skips the build, exit 1 builds, and any
# other exit code fails the deployment. So every path that is not a clean
# "nothing changed" must end in exit 1.
#
# Compare with the last commit Vercel built for this branch, so a rebase whose
# last commit does not touch web/ or results/ still builds. That commit can be
# missing from the clone (a force-pushed branch, or older than the shallow
# clone); then build rather than fail.
base="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "Last built commit ${base} is not in this clone; building."
  exit 1
fi
if git diff --quiet "$base" HEAD -- ../web ../results; then
  echo "No changes under web/ or results/ since ${base}; skipping the build."
  exit 0
fi
echo "Changes under web/ or results/ since ${base}; building."
exit 1
