#!/usr/bin/env sh
set -eu

if [ ! -x ".venv/bin/python" ]; then
  python3 -m venv .venv
fi

.venv/bin/python -m pip install --quiet --upgrade -r requirements.txt
.venv/bin/python scripts/build_dges_data.py
