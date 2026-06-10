# Feature 5 — Boucle "Win Analysis"

## Objectif
Miroir du close-lost : analyser les deals **gagnés** pour extraire les patterns de victoire et les réinjecter dans le scoring de la Morning Queue + recommandations concrètes ("les deals gagnés ont ~2 calls en découverte, celui-ci en a 0").

## Principe d'efficience LLM (clé)
**Miroir exact du close-lost existant** (mêmes caches, coût maîtrisé) **+ un benchmark déterministe sans LLM** :
1. **Benchmark quantitatif (SQL, 0 LLM)** : stats des deals gagnés (calls/emails par stage, durée par stage, délai 1er contact→close) depuis `activity_events` + historique stage. Alimente le scoring queue et les comparaisons — recalcul hebdo, coût 0.
2. **Analyse qualitative LLM** : 1 appel par deal gagné, caché dans `deal_ai_analyses` (`analysis_type='close_won'`, TTL 30j — un deal gagné ne change plus, cache permanent de fait). Portfolio : 1 appel par run.
3. **Comparaison deal ouvert vs benchmark : 0 LLM** — diff numérique en TS, injectée en 1-2 lignes dans les prompts existants.

## Backend

### Migrations
1. `<ts>_extend_analysis_type_close_won.sql` : ajouter `'close_won'` à la contrainte `deal_ai_analyses.analysis_type`.
2. `<ts>_add_win_analysis.sql` :
```sql
create table win_pattern_benchmarks (
  id uuid pk, org_id uuid, segment text,  -- 'all' | pipeline | tranche montant
  date_from date, date_to date, sample_size int,
  benchmark jsonb,   -- {byStage:{stage:{avgCalls,avgEmails,avgDays}}, avgCycleDays, avgTouchpoints, medianAmount}
  computed_at timestamptz );
create table close_won_analysis_runs ( ... ); -- copie du schéma close_lost_analysis_runs
```

### LLM — `services/llm/close-won.ts` (calqué sur `close-lost.ts`)
- `buildCloseWonDealPrompt()` / `parseCloseWonDeal()` — input identique au close-lost. Output `CloseWonDealAnalysis` :
```ts
{ primaryWinFactor: string;
  winFactorCategory:'champion'|'timing'|'product_fit'|'pricing'|'process'|'relationship'|'other';
  keyMoments:{moment; stage; impact}[];
  replicablePlays:{play; when}[];     // tactiques réutilisables
  confidence:'low'|'medium'|'high' }
```
- `buildCloseWonPortfolioPrompt()` : `winningPatterns`, `idealSequence`, `recommendations`. Méthodes `analyzeCloseWonDeal/Portfolio` dans `LlmProvider` (3 providers).

### Services
- `services/win-analysis.service.ts` : `executeCloseWonAnalysisRun()` — **copie de l'orchestration `executeCloseLostAnalysisRun`** (job-store, dédup, réuse cache, `runWithLlmConcurrencyLimit`). Borne : 30 derniers deals gagnés max par run.
- `computeWinBenchmarks(orgId)` : agrégation SQL activités×stages des wins (12 mois), upsert `win_pattern_benchmarks`. Job repeatable hebdo (queue `maintenance`, mutualisée features 2/4).
- `compareDealToBenchmark(orgId, dealId)` (0 LLM) : gaps `[{stage:'discovery', metric:'calls', actual:0, benchmark:2}]`.

### Réinjection (la boucle)
1. **Queue scoring** : bonus/malus au `priority_score` selon gaps benchmark (deal en retard d'activité vs pattern gagnant → remonte).
2. **Prompts enrichis** : `winBenchmarkSummary` (2-3 lignes) ajouté aux inputs de `buildForecastSynthesisPrompt` et `buildTaskAnalysisPrompt` (change l'`input_hash` → invalidation de cache naturelle).

### Routes `routes/win-analysis.ts`
`GET /overview`, `POST /run`, `GET /deal/:dealId`, `GET /benchmark`, `GET /gaps/:dealId` (préfixe `/api/win-analysis` ; gaps accessible sales — c'est sa reco actionnable).

## Frontend
- `components/dashboard/WinAnalysisView.tsx` : miroir de `CloseLostAnalysisView` (réutiliser ses sous-composants) + section benchmark.
- Dans `DealAnalysisView` et la queue : encart "vs deals gagnés" listant les gaps (0 LLM).

## Étapes
1. Migrations + prompts close-won (1 j, copie du close-lost)
2. Run service + benchmarks SQL + job hebdo (1,5 j)
3. Réinjection scoring + prompts (1 j)
4. WinAnalysisView + encarts gaps (1,5 j)

## Risques
- Biais de survivant : afficher `sample_size`, exiger ≥10 wins avant d'activer le scoring.
- Segments hétérogènes : benchmark par pipeline.
