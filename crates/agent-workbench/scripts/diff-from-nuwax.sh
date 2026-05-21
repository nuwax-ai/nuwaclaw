#!/usr/bin/env bash
set -u

NUWAX="${NUWAX_PATH:-/Users/louis/workspace/nuwax}"
WB="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "$NUWAX" ]; then
  echo "Error: nuwax repo not found at $NUWAX"
  echo "Set NUWAX_PATH env var to override."
  exit 1
fi

echo "=== nuwax HEAD ==="
(cd "$NUWAX" && git log --oneline -1)
echo

echo "=== diff: OpenApp/BaseTemplate ==="
diff -ru "$NUWAX/src/pages/OpenApp/BaseTemplate" "$WB/src/components/OpenApp/BaseTemplate" 2>&1 | head -200 || true
echo

echo "=== diff: OpenApp/AppDetails ==="
diff -ru "$NUWAX/src/pages/OpenApp/AppDetails" "$WB/src/components/OpenApp/AppDetails" 2>&1 | head -200 || true
echo

echo "=== diff: OpenApp/HistoryConversation ==="
diff -ru "$NUWAX/src/pages/OpenApp/HistoryConversation" "$WB/src/components/OpenApp/HistoryConversation" 2>&1 | head -200 || true
echo

echo "=== diff: ChatInputHome ==="
diff -ru "$NUWAX/src/components/ChatInputHome" "$WB/src/components/ChatInputHome" 2>&1 | head -200 || true
echo

echo "=== diff: MarkdownRenderer ==="
diff -ru "$NUWAX/src/components/MarkdownRenderer" "$WB/src/components/MarkdownRenderer" 2>&1 | head -200 || true
