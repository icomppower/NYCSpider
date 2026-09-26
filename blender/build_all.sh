#!/usr/bin/env bash
# Regenerates every glTF asset from the Blender python sources.
# Uses Blender's `bpy` module (pip install bpy==4.5.4) or a blender binary.
set -euo pipefail
cd "$(dirname "$0")"
PY="${BLENDER_PY:-}"
if [ -z "$PY" ]; then
  if python3 -c "import bpy" 2>/dev/null; then PY=python3;
  elif [ -x "$HOME/.bpyenv/bin/python" ]; then PY="$HOME/.bpyenv/bin/python";
  elif command -v blender >/dev/null; then PY="blender -b --python-exit-code 1 --python";
  else echo "Need bpy (pip install bpy==4.5.4) or blender on PATH" >&2; exit 1; fi
fi
$PY build_characters.py
$PY build_props.py
