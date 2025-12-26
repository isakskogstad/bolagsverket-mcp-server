# Bolagsverket MCP Server - Render Deploy

MCP-server för Bolagsverkets API "Värdefulla datamängder".

## Deploy till Render

### Alternativ 1: Blueprint (render.yaml)
1. Pusha till GitHub
2. Gå till https://dashboard.render.com/blueprints
3. Klicka "New Blueprint Instance"
4. Välj ditt repo

### Alternativ 2: Manuell deploy
1. Gå till https://dashboard.render.com
2. Klicka "New" → "Web Service"
3. Välj "Build and deploy from a Git repository" eller ladda upp direkt
4. Inställningar:
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `python bolagsverket_mcp_server.py --http --port $PORT`
   - **Plan:** Starter ($7/mån) eller Free (med begränsningar)

## MCP-endpoint

Efter deploy får du en URL som:
```
https://bolagsverket-mcp.onrender.com/sse
```

Använd denna i Claude Desktop eller andra MCP-klienter.

## Verktyg

Servern exponerar 10+ verktyg för företagsanalys:
- `bolagsverket_analyze_full` - Komplett årsredovisningsanalys
- `bolagsverket_koncern` - Koncernanalys
- `bolagsverket_risk_check` - Röda flaggor
- `bolagsverket_search` - Sök företag
- m.fl.
