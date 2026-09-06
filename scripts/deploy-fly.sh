#!/bin/sh
# Deploy DTR to Fly.io. Idempotent: safe to re-run to ship a change.
#
#   ./scripts/deploy-fly.sh                 # app name from fly.toml
#   ./scripts/deploy-fly.sh my-company-dtr  # or pick one
#
# Needs flyctl and a Fly account: https://fly.io/docs/flyctl/install/
set -e

cd "$(dirname "$0")/.."

# Read fly.toml with a real TOML parser rather than sed, which happily leaves a
# trailing comment attached to the value.
APP="${1:-$(python3 -c 'import tomllib;print(tomllib.load(open("fly.toml","rb"))["app"])')}"
REGION="$(python3 -c 'import tomllib;print(tomllib.load(open("fly.toml","rb"))["primary_region"])')"
VOLUME="$(python3 -c 'import tomllib;print(tomllib.load(open("fly.toml","rb"))["mounts"][0]["source"])')"

if ! command -v flyctl >/dev/null 2>&1 && ! command -v fly >/dev/null 2>&1; then
    echo "flyctl is not installed: https://fly.io/docs/flyctl/install/" >&2
    exit 1
fi
FLY="$(command -v flyctl || command -v fly)"

"$FLY" auth whoami >/dev/null 2>&1 || {
    echo "not signed in to Fly. Run: $FLY auth login" >&2
    exit 1
}

echo "==> app $APP in $REGION"
if ! "$FLY" apps list 2>/dev/null | grep -qw "$APP"; then
    "$FLY" apps create "$APP"
fi

# One volume, and only ever one. SQLite is a file: a second machine would get a
# second volume, and each would hold half the time records.
echo "==> volume"
if ! "$FLY" volumes list --app "$APP" 2>/dev/null | grep -qw "$VOLUME"; then
    "$FLY" volumes create "$VOLUME" --app "$APP" --region "$REGION" --size 1 --yes
fi

# The key that validates every printed poster. Set once; changing it invalidates
# every poster already on a wall, so this never overwrites an existing one.
echo "==> secrets"
if ! "$FLY" secrets list --app "$APP" 2>/dev/null | grep -qw DTR_SECRET_KEY; then
    "$FLY" secrets set --app "$APP" --stage \
        DTR_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
fi

# Baked into every poster, and what makes session cookies Secure. Must be set
# before the first poster is printed, so it goes in with the first deploy.
BASE_URL="https://$APP.fly.dev"
"$FLY" secrets set --app "$APP" --stage DTR_BASE_URL="$BASE_URL"

echo "==> deploy"
"$FLY" deploy --app "$APP" --ha=false

echo
echo "Live at $BASE_URL/admin/"
echo
echo "Create your first admin — you will be prompted for a password:"
echo "  $FLY ssh console --app $APP -C \"python -m dtr admin 1001 'Your Name'\""
echo
echo "Then, before anyone clocks in:"
echo "  * open /admin/ -> Locations, and add one while standing at the entrance"
echo "  * print its poster"
echo "  * back up the volume: $FLY ssh console --app $APP -C 'tar cz /data' > dtr-backup.tgz"
