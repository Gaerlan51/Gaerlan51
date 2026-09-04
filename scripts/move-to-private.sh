#!/bin/sh
# Move this business system into a private repo.
#
# Why: Gaerlan51/Gaerlan51 is the public GitHub profile repo. The prompt, the
# spec, and the toolkit are fine in public — they contain no client data and no
# real prices. Your tracker will not be. Move before the first real client.
#
# Usage, from the repo root, on the branch carrying the work:
#     gh auth login          # once, if you haven't
#     sh scripts/move-to-private.sh [repo-name]
#
# This script creates and pushes. It deletes nothing — cleanup steps are printed
# at the end for you to do by hand.

set -eu

NEW_REPO="${1:-stats-consulting-ops}"
DESC="Ops system for a virtual statistics and research consulting practice."

if ! command -v gh >/dev/null 2>&1; then
    echo "error: the GitHub CLI (gh) is not installed."
    echo "Install it from https://cli.github.com, or create the repo in the web UI"
    echo "and follow the manual steps in prompts/operator-notes.md."
    exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
    echo "error: gh is not authenticated. Run: gh auth login"
    exit 1
fi

OWNER="$(gh api user --jq .login)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "Creating private repo ${OWNER}/${NEW_REPO} and pushing ${BRANCH} as main."
printf 'Continue? [y/N] '
read -r reply
case "$reply" in
    [yY]*) ;;
    *) echo "aborted"; exit 0 ;;
esac

gh repo create "${OWNER}/${NEW_REPO}" --private --description "$DESC"

git remote remove private 2>/dev/null || true
git remote add private "https://github.com/${OWNER}/${NEW_REPO}.git"
git push private "HEAD:refs/heads/main"

cat <<EOF

Done — https://github.com/${OWNER}/${NEW_REPO} (private)

Three things left, by hand:

  1. In the new repo, delete README.md — it is the GitHub profile README and
     came along with the history. Replace it with a line about this project.

  2. Work from the new repo from now on:
         git clone https://github.com/${OWNER}/${NEW_REPO}.git
     Your tracker (data/) is gitignored and stays local either way, so nothing
     to migrate but the clone.

  3. Once you have confirmed the new repo has everything, remove the work from
     the public one:
         git push origin --delete ${BRANCH}
     Check https://github.com/${OWNER}/${NEW_REPO} first. This is the only
     destructive step here, so do it last and do it deliberately.
EOF
