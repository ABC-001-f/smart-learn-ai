#!/usr/bin/env sh
# LearnBond: one-command start on macOS/Linux. Creates the virtual environment on first run.
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "Creating virtual environment in .venv ..."
  python3 -m venv .venv
  .venv/bin/python -m pip install -q -r requirements.txt
fi
[ -f .env ] || cp .env.example .env
echo "LearnBond on http://localhost:${PORT:-3000}"
exec .venv/bin/python server.py
