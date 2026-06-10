# Feature 1 — Digest quotidien/hebdo manager

## Objectif
Un résumé agrégé "ce qui a bougé" (jour ou semaine) pour managers/admins : mouvements clés, top 3 deals à risque, 2 deals à pousser, livré in-app (et plus tard email/Slack). Réduit le bruit de Pulse.

## Principe d'efficience LLM (clé)
**Zéro nouvel appel par deal.** Le digest est une synthèse de données déjà calculées :
- `pulse_notifications` (mouvements bruts de la période)
- `deal_ai_analyses` (verdicts forecast déjà en cache, TTL 6h)
- `daily_kpis` (activité équipe)
→ **1 seul appel LLM par digest** (par org/manager/période), sur un résumé textuel pré-agrégé en SQL/TS. Pattern identique à `buildForecastSynthesisPrompt` (appel par scope, pas par deal).

## Backend

### Migration `supabase/migrations/<ts>_add_manager_digests.sql`
```sql
create table manager_digests (
  id uuid pk, org_id uuid, user_id uuid,        -- destinataire manager
  period text check (period in ('daily','weekly')),
  date_from date, date_to date,
  input_hash text,                               -- dédup/cache
  digest jsonb,                                  -- sortie LLM
  provider text, model text,
  created_at timestamptz
);
-- unique (org_id, user_id, period, date_from, input_hash)
-- RLS : is_current_org_manager() + user_id = self
```

### LLM
- `services/llm/manager-digest.ts` : `buildManagerDigestPrompt(input)` + `parseManagerDigest(response)`
- Input : `{ movementsSummary, atRiskSummary, kpisSummary, period, dateFrom, dateTo, teamScopeLabel }` — chaînes pré-formatées compactes (1 ligne/deal, montants arrondis)
- Output `ManagerDigestAnalysis` :
```ts
{ headline: string;
  highlights: {type:'win'|'risk'|'movement'; dealId?; text}[];
  atRiskDeals: {dealId; dealName; reason; suggestedAction}[];   // max 3
  assistDeals:  {dealId; dealName; whyHelp; coachingHint}[];    // max 2
  teamPulse: string; confidence:'low'|'medium'|'high' }
```
- Ajouter `analyzeManagerDigest()` à l'interface `LlmProvider` + implémenter dans les 3 providers (openai/deepseek/vertex-gemini), wrappé `runWithLlmConcurrencyLimit`.

### Service `services/manager-digest.service.ts`
1. `buildDigestInput(orgId, userId, period)` : agrège en SQL — notifications Pulse de la période (groupées par deal, dédupliquées), verdicts `atRisk`/`slipping` depuis le cache forecast (réutiliser `loadReusableCachedAnalysis`, **ne pas relancer** d'analyse), KPIs `daily_kpis`.
2. `getOrCreateDigest(orgId, userId, period)` : hash input → si row existante avec même `input_hash`, retour cache (coût 0). Sinon 1 appel LLM, persist.
3. Respect du scope : manager = ses deals assignés, admin = org (même logique que Pulse).

### Routes `routes/manager-digest.ts` (+ enregistrer dans `routes/index.ts`)
- `GET /api/digest?period=daily|weekly` → digest du jour/semaine (génère si absent)
- `GET /api/digest/history?limit=`
- Guard `assertManagerOrAdmin()`.

## Frontend (extension)
- `components/dashboard/DigestView.tsx` (convention `*View`) + entrée dans `dashboard/config.ts`
- `services/api.ts` : `fetchManagerDigest(period)`, cache front 60s (pattern `analyticsGetCache`)
- UI : headline, cartes "À risque" (3) / "Coup de main" (2) cliquables vers `DealAnalysisView`, section mouvements repliable.

## Livraison externe (phase 2)
- Pas d'email/Slack dans le code aujourd'hui → ajouter `services/notifier.service.ts` (Resend pour email, webhook Slack entrant). Déclenchement : job BullMQ repeatable (`enqueueRealtimeJob` étendu ou nouvelle queue `digest` avec `repeat: {pattern:'0 8 * * *'}`).

## Étapes
1. Migration + types LLM + prompt/parse (1 j)
2. Service agrégation + cache input_hash (1 j)
3. Routes + DigestView (1 j)
4. Job planifié + Slack/email (1-2 j, phase 2)

## Risques
- Période sans mouvement → court-circuit : pas d'appel LLM, digest statique "rien à signaler".
- Cache forecast expiré (>6h) → utiliser le dernier verdict connu plutôt que relancer (champ `stale: true` dans l'UI).
