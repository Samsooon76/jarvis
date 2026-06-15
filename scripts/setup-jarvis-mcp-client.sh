#!/usr/bin/env bash
set -euo pipefail

read -r -p "URL API Jarvis (ex: https://jarvisapi-production-10cd.up.railway.app): " API_URL
read -r -p "Token MCP client: " MCP_TOKEN
read -r -p "Org ID (optionnel si deja lie au token serveur): " ORG_ID

API_URL="${API_URL%/}"

echo ""
echo "=== Claude Desktop (HTTP - recommande) ==="
echo "Fichier: ~/Library/Application Support/Claude/claude_desktop_config.json"
cat <<EOF
{
  "mcpServers": {
    "jarvis": {
      "url": "${API_URL}/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_TOKEN}"
      }
    }
  }
}
EOF

echo ""
echo "=== Cursor (HTTP) ==="
echo "Fichier: ~/.cursor/mcp.json"
cat <<EOF
{
  "mcpServers": {
    "jarvis": {
      "url": "${API_URL}/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_TOKEN}"
      }
    }
  }
}
EOF

echo ""
echo "=== Grok CLI ==="
echo "grok mcp add jarvis --transport http ${API_URL}/mcp --header \"Authorization: Bearer ${MCP_TOKEN}\""

if [[ -n "${ORG_ID}" ]]; then
  echo ""
  echo "=== stdio (devs) - variables d'env ==="
  cat <<EOF
export JARVIS_API_URL="${API_URL}"
export JARVIS_AUTH_TOKEN="${MCP_TOKEN}"
export JARVIS_ORG_ID="${ORG_ID}"
EOF
fi

echo ""
echo "Test rapide API:"
echo "curl -s -X POST ${API_URL}/api/llm/ask \\"
echo "  -H \"Authorization: Bearer ${MCP_TOKEN}\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"orgId\":\"${ORG_ID:-<org-uuid>}\",\"question\":\"Resume le pipeline\"}'"