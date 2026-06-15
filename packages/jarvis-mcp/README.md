# Jarvis MCP — Guide client

Connecte Claude Desktop, Cursor ou Grok a ton copilote sales Jarvis en **2 minutes**.

## Ce dont tu as besoin (2 valeurs)

Dans Jarvis : **Parametres → MCP → Generer une cle**.

Tu recuperes :

| Valeur | Exemple |
|--------|---------|
| **URL MCP** | `https://ton-api.up.railway.app/mcp` |
| **Cle MCP** | `jrv_a1b2c3...` (liee automatiquement a ton org) |

Aucun UUID organisation a saisir : la cle `jrv_...` embarque le lien vers ton compte.

---

## Option A — HTTP (recommandee, zero installation)

Fonctionne avec Claude Desktop recent, Cursor, et la plupart des clients MCP HTTP.

### Claude Desktop

Fichier : `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jarvis": {
      "url": "https://TON-API.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer jrv_TON_CLE_MCP"
      }
    }
  }
}
```

Redemarre Claude Desktop.

### Cursor

Fichier : `~/.cursor/mcp.json` (ou `.cursor/mcp.json` dans le projet)

```json
{
  "mcpServers": {
    "jarvis": {
      "url": "https://TON-API.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer jrv_TON_CLE_MCP"
      }
    }
  }
}
```

### Grok

```bash
grok mcp add jarvis --transport http https://TON-API.up.railway.app/mcp \
  --header "Authorization: Bearer TON_TOKEN_MCP"
```

---

## Option B — stdio (developpeurs)

Pour dev local ou si ton client MCP ne supporte pas HTTP.

Prerequis : Node.js 20+, repo Jarvis clone.

```bash
cd jarvis
npm install
npm run build -w @jarvis/mcp

export JARVIS_API_URL="https://TON-API.up.railway.app"
export JARVIS_AUTH_TOKEN="TON_TOKEN_MCP"
export JARVIS_ORG_ID="TON_ORG_UUID"
```

Claude Desktop (`claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "jarvis": {
      "command": "node",
      "args": ["/chemin/vers/jarvis/packages/jarvis-mcp/dist/index.js"],
      "env": {
        "JARVIS_API_URL": "https://TON-API.up.railway.app",
        "JARVIS_AUTH_TOKEN": "TON_TOKEN_MCP",
        "JARVIS_ORG_ID": "TON_ORG_UUID"
      }
    }
  }
}
```

---

## Script d'aide

```bash
./scripts/setup-jarvis-mcp-client.sh
```

Le script genere les blocs JSON prets a copier-coller.

---

## Tools disponibles

| Tool | Usage |
|------|-------|
| `ask_jarvis` | Question libre avec contexte CRM + forecast |
| `get_forecast` | Vue pipeline complete |
| `get_manager_digest` | Digest manager daily/weekly |
| `get_queue` | Morning queue d'un commercial |
| `get_prospect` | Fiche prospect |
| `analyze_deal` | Analyse deal intelligence IA |

---

## Exemples de prompts

```
"Via Jarvis, quel est l'etat du pipeline ce mois-ci ?"
"Montre-moi le digest manager du jour"
"Analyse le deal du prospect <uuid>"
"Qui dois-je appeler en priorite ce matin ?"
```

---

## Troubleshooting

| Erreur | Solution |
|--------|----------|
| `Token applicatif invalide` | Verifier le token, redeploy Railway apres ajout de `JARVIS_MCP_SERVICE_TOKEN` |
| `orgId est obligatoire` | Admin doit set `JARVIS_MCP_SERVICE_ORG_ID` sur Railway |
| Reponse generique / faible | Normal si HubSpot pas connecte ou pipeline vide — tester `get_forecast` |
| MCP HTTP 404 | Verifier `JARVIS_MCP_HTTP_ENABLED=true` sur Railway |

---

## Configuration admin (par organisation)

1. Deployer la migration `20260621120000_add_organization_mcp_keys.sql`
2. Verifier `JARVIS_MCP_HTTP_ENABLED=true` sur Railway
3. Le manager genere les cles depuis **Parametres → MCP**

Legacy (optionnel) : `JARVIS_MCP_SERVICE_TOKEN` + `JARVIS_MCP_SERVICE_ORG_ID` restent supportes pour scripts internes.