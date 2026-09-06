#!/bin/sh
# Put DTR on a temporary public HTTPS address, so a phone can actually scan the
# poster — without deploying anything.
#
#   ./scripts/share.sh
#
# Uses a Cloudflare quick tunnel: no account, no signup, no config. It prints a
# https://<random>.trycloudflare.com address, points DTR at it, and starts the
# server there so the generated QR codes are scannable from any phone.
#
# TWO THINGS TO KNOW:
#   * The address is random and dies when you stop this script. Fine for trying
#     it out; useless on a printed poster, which needs a permanent address —
#     use ./scripts/deploy-fly.sh for that.
#   * While it runs, your machine is reachable from the public internet.
set -e

cd "$(dirname "$0")/.."

if ! command -v cloudflared >/dev/null 2>&1; then
    cat >&2 <<'MSG'
cloudflared is not installed. It is a single binary and needs no account:

  macOS          brew install cloudflared
  Linux (deb)    curl -L --output /tmp/cf.deb \
                   https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
                   && sudo dpkg -i /tmp/cf.deb
  Windows        winget install --id Cloudflare.cloudflared

Or skip the tunnel and deploy properly: ./scripts/deploy-fly.sh <name>
MSG
    exit 1
fi

PORT="${PORT:-8000}"
LOG="$(mktemp)"
trap 'kill "$TUNNEL_PID" 2>/dev/null || true; rm -f "$LOG"' EXIT INT TERM

echo "==> opening a tunnel to port $PORT"
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate > "$LOG" 2>&1 &
TUNNEL_PID=$!

# The address appears in cloudflared's output a second or two after it starts.
URL=""
i=0
while [ "$i" -lt 40 ]; do
    URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1 || true)"
    [ -n "$URL" ] && break
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
        echo "the tunnel exited before giving an address:" >&2
        cat "$LOG" >&2
        exit 1
    fi
    sleep 0.5
    i=$((i + 1))
done

if [ -z "$URL" ]; then
    echo "the tunnel did not report an address in time:" >&2
    tail -20 "$LOG" >&2
    exit 1
fi

echo "==> public address $URL"
echo

DTR_BASE_URL="$URL" ./dtr.sh --port "$PORT" &
APP_PID=$!
trap 'kill "$APP_PID" "$TUNNEL_PID" 2>/dev/null || true; rm -f "$LOG"' EXIT INT TERM

sleep 4
cat <<MSG

  Employee app   $URL/app/
  Dashboard      $URL/admin/
  Poster         $URL/admin/poster

  The QR on that poster now points at a public https address, so scanning it
  with a phone works. Open the poster on screen and scan it straight off the
  monitor to try it.

  This address dies when you press Ctrl-C. For a poster that stays on a wall,
  deploy instead:  ./scripts/deploy-fly.sh <name>

MSG
wait "$APP_PID"
