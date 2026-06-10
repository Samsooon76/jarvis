# Feature 4 — Forecast vs réalité (accuracy tracking)

## Objectif
Mesurer la fiabilité des prévisions passées : par sales et pour l'IA. "Marie sous-commit de 20% en moyenne", "les deals classés Commit closent à 78%". Rend le forecast crédible pour le reporting direction.

## Principe d'efficience LLM (clé)
**Feature quasi 100% déterministe — quasi aucun appel LLM.**
- Le cœur = snapshots + comparaison à la réalité : pur SQL/TS.
- Seul appel LLM optionnel : un commentaire de synthèse trimestriel (1 appel/org/trimestre), pattern `forecast-synthesis`. Phase 2.
- Matière première déjà présente : verdicts `dealVerdicts` (commit/bestCase/atRisk/slipping) persistés via `deal_ai_analyses` + table forecast synthesis, historique de probabilité, `close_probability` CRM.

## Backend

### 1. Snapshots — migration `<ts>_add_forecast_snapshots.sql`
```sql
create table forecast_snapshots (
  id uuid pk, org_id uuid,
  snapshot_date date,
  hubspot_deal_id text, owner_user_id uuid,
  deal_stage text, amount numeric, close_date date,
  crm_probability numeric,           -- proba CRM au moment T
  ai_probability numeric,            -- close_won_probability du cache IA si dispo
  ai_category text,                  -- commit|bestCase|atRisk|slipping|null
  forecast_period text               -- ex '2026-06' (mois ciblé par la close date)
);
-- unique (org_id, hubspot_deal_id, snapshot_date); RLS manager/admin + owner self
```
**Capture** : job BullMQ repeatable quotidien (queue `maintenance` mutualisée avec feature 2) photographiant les deals ouverts. Lit `ai_probability`/`ai_category` depuis le **cache existant** — ne déclenche jamais d'analyse.

### 2. Résolution
À la clôture d'un deal (won/lost — détectée par le webhook `deal.stage` déjà traité dans le processor realtime) : marquer les snapshots du deal comme résolus (`outcome won|lost`, `final_amount`, `closed_at`) — colonne sur snapshots ou table `forecast_outcomes`.

### 3. Calculs — `services/forecast-accuracy.service.ts` (0 LLM)
- **Par sales** : commit accuracy (montant commit J-30 vs signé réel), biais moyen (sur/sous-commit %), slippage rate (deals dont la close date a glissé ≥1 fois)
- **Par source** : calibration CRM vs IA (les deals à proba 70% closent-ils à ~70% ? courbe de calibration par buckets de 10%)
- **Par catégorie IA** : taux de close réel des verdicts commit/bestCase/atRisk
- Fonctions : `getAccuracyOverview(orgId, period)`, `getRepAccuracy(orgId, userId)`, `getCalibrationCurve(orgId, source)`

### 4. Routes `routes/forecast-accuracy.ts`
- `GET /api/forecast-accuracy/overview?period=`
- `GET /api/forecast-accuracy/rep/:userId`
- `GET /api/forecast-accuracy/calibration?source=crm|ai`
- Guard `assertManagerOrAdmin()` (vue rep accessible au sales lui-même : `assertOwnerScope`).

## Frontend
- Onglet dans `ForecastView` existant (même contexte mental) :
  - Jauge accuracy globale du trimestre
  - Tableau par sales : commit vs réel, biais %, slippage (alimente le 1:1, lien avec feature 3)
  - Courbe calibration CRM vs IA (Chart.js, scatter + diagonale idéale)
- API : `fetchForecastAccuracy()`, `fetchRepAccuracy(userId)`.

## Synergies
- Le biais par sales devient un input du prompt `forecast-synthesis` existant ("Marie sous-commit historiquement de 20%") → améliore le forecast IA **sans appel supplémentaire** (juste +1 ligne dans `dealsSummary`).
- Idem pour `rep-coaching` (feature 3) : le biais est une stat de plus dans `computeRepStats`.

## Étapes
1. Migration snapshots + job quotidien (1 j)
2. Résolution via webhook close (0,5 j)
3. Service calculs + routes (1 j)
4. UI onglet Forecast (1 j)
⚠️ La valeur n'apparaît qu'après ~1 mois de snapshots → **shipper la capture en premier**, l'UI peut suivre. Backfill partiel possible depuis l'historique de probabilité existant.

## Risques
- Volume snapshots : partitionner par mois ou purger >18 mois (`CRM_ACTIVITY_RETENTION_DAYS` pattern).
- Petites équipes → afficher intervalles larges, pas de % trompeurs sous 10 deals résolus.
