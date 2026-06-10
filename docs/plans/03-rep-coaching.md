# Feature 3 — Coaching IA par commercial

## Objectif
Panneau manager "profil de chaque sales" : forces/faiblesses, stage où il perd, objections récurrentes, recommandations de coaching. Ex : "Paul convertit bien en démo mais perd en négociation, souvent sur le prix."

## Principe d'efficience LLM (clé)
**2 niveaux, le 1er sans LLM :**
1. **Stats déterministes (SQL, coût 0)** : conversion et durée par stage, win rate, activité (`daily_kpis`), répartition `lossReasonCategory` — extraite des analyses close-lost **déjà en cache**. On ne ré-analyse aucun deal.
2. **Synthèse LLM : 1 appel par sales par semaine max.** Input = stats pré-agrégées + extraits des analyses existantes. Cache long (TTL 7 jours — les patterns bougent lentement) avec `input_hash` : si rien n'a changé, 0 appel.

## Backend

### Migration `supabase/migrations/<ts>_add_rep_coaching.sql`
```sql
create table rep_coaching_analyses (
  id uuid pk, org_id uuid, target_user_id uuid,  -- le sales analysé
  date_from date, date_to date,
  stats jsonb,            -- partie déterministe (toujours fraîche)
  analysis jsonb,         -- sortie LLM
  provider text, model text, input_hash text,
  expires_at timestamptz, created_at timestamptz
);
-- unique (org_id, target_user_id, provider, model, input_hash)
-- RLS : is_current_org_manager() uniquement (le sales ne voit pas son profil en v1)
```

### Stats — `services/rep-coaching.service.ts`
`computeRepStats(orgId, userId, dateFrom, dateTo)` :
- Funnel par stage (tracking probability/stage history existant), win rate, panier moyen, vélocité
- Agrégat `lossReasonCategory` + `riskSignals` depuis les analyses close-lost cachées (scope owner)
- KPIs `daily_kpis` vs médiane équipe (benchmark anonyme)
- Si `calls.ai_objections` peuplé : top objections

### LLM — `services/llm/rep-coaching.ts`
- `buildRepCoachingPrompt(input)` / `parseRepCoaching(response)` ; méthode `analyzeRepCoaching()` dans `LlmProvider` (3 providers), via `runWithLlmConcurrencyLimit`.
- Input compact : `{ repName, statsSummary, lossPatternsSummary, forecastVerdictsSummary, teamBenchmarkSummary, dateFrom, dateTo }` (chaînes pré-formatées, ~1-2k tokens).
- Output `RepCoachingAnalysis` :
```ts
{ headline: string;
  strengths: {title; evidence}[];          // max 3
  weaknesses: {title; evidence; stage?}[]; // max 3
  lossPatterns: {pattern; frequency:'rare'|'recurrent'|'systematic'}[];
  coachingActions: {action; priority:'high'|'medium'; expectedImpact}[];
  trend:'improving'|'stable'|'declining'; confidence:'low'|'medium'|'high' }
```

### Orchestration
- `getRepCoaching(orgId, targetUserId, {refresh})` : stats SQL toujours recalculées ; LLM via cache `input_hash` (hash des stats arrondies → hash stable) ; pattern `loadCachedAnalysis`/`persistAnalysis` adapté à la nouvelle table.
- Analyse d'équipe : boucle sur les sales via le rate-limiter (max 5 concurrent), exposée en job long via `job-store.ts` comme le close-lost run.

### Routes `routes/rep-coaching.ts`
- `GET /api/coaching/team` (vignettes : headline + trend par sales — sans déclencher de LLM si cache absent : statut `pending`)
- `GET /api/coaching/rep/:userId` (+ `?refresh=true`)
- `POST /api/coaching/team/run` → job (réutilise polling `/api/.../job/:jobId` pattern forecast)
- Guard `assertManagerOrAdmin()`.

## Frontend
- `components/dashboard/CoachingView.tsx` : grille équipe (carte par sales : trend, headline, win rate) → détail rep (funnel Chart.js, forces/faiblesses, actions copiables pour le 1:1).
- Entrée `dashboard/config.ts`, API `fetchTeamCoaching()`, `fetchRepCoaching(userId)`.

## Étapes
1. Migration + computeRepStats (1,5 j)
2. Prompt/parse + service + cache 7j (1 j)
3. Routes + job équipe (0,5 j)
4. CoachingView (1,5 j)

## Risques
- Petits volumes (<10 deals fermés) → afficher stats seules, masquer la synthèse LLM (`confidence: low` forcé, message "données insuffisantes").
- Sensibilité RH : ton du prompt orienté coaching constructif, jamais de classement public entre sales.
