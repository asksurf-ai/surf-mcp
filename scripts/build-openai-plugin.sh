#!/usr/bin/env bash
# Package plugins/surf as the ZIP uploaded to the OpenAI plugin portal
# (platform.openai.com/plugins). Output: dist/openai/surf-<version>.zip
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/plugins/surf"
out="$root/dist/openai"

for f in "$src/.codex-plugin/plugin.json" "$src/.mcp.json"; do
  python3 -I -m json.tool "$f" >/dev/null || { echo "invalid JSON: $f" >&2; exit 1; }
done

version="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$src/.codex-plugin/plugin.json")"
zip_path="$out/surf-$version.zip"

mkdir -p "$out"
rm -f "$zip_path"
(cd "$src" && zip -qrX "$zip_path" .codex-plugin .mcp.json assets -x '*.DS_Store')

unzip -l "$zip_path"
echo "Built $zip_path"
