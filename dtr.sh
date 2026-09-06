#!/bin/sh
# The whole launch story. Run `./dtr.sh` from the repo root, then open
# http://localhost:8000/admin/ — the same convention as ./ops.sh.
#
# First run creates a virtualenv, installs the four dependencies, builds the
# database and adds demo data. Later runs just start the server. Anything you
# pass through goes to `python -m dtr serve`, so `./dtr.sh --port 9000` works.
set -e

cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3}"
VENV=".venv"
DB="${DTR_DATA_DIR:-data/dtr}/dtr.db"

if [ ! -d "$VENV" ]; then
    echo "creating $VENV"
    "$PYTHON" -m venv "$VENV"
fi

# Cheap check: if FastAPI imports, the rest is there too.
if ! "$VENV/bin/python" -c "import fastapi" 2>/dev/null; then
    echo "installing dependencies"
    "$VENV/bin/pip" install --quiet --upgrade pip
    "$VENV/bin/pip" install --quiet -r dtr/requirements.txt
fi

# Seed only on a genuinely first run. Never add demo people to a live database.
FIRST_RUN=no
[ -f "$DB" ] || FIRST_RUN=yes

"$VENV/bin/python" -m dtr init

if [ "$FIRST_RUN" = yes ]; then
    "$VENV/bin/python" -m dtr seed
    echo
    echo "That is demo data. For a real setup, delete $DB, run ./dtr.sh again,"
    echo "and create your own admin with: $VENV/bin/python -m dtr admin 1001 'Your Name'"
fi

echo
exec "$VENV/bin/python" -m dtr serve "$@"
