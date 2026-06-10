# Feature 2 — Détection des deals "silencieux"

## Objectif
Alerter quand un deal ouvert n'a **aucune activité depuis X jours** alors que sa close date approche (ou que son montant est significatif). Alerte via Pulse (infra existante) + badge dans Forecast/Queue.

## Principe d'efficience LLM (clé)
**Aucun appel LLM pour la détection** : c'est un croisement SQL pur entre `activity_events` (dernière activité par deal) et `hubspot_deals` (stage ouvert, close_date, amount). Le LLM n'intervient que si le sales/manager ouvre le deal — et là on **réutilise le pipeline existant** (`analyzeFollowUpTask` / `deal_ai_analyses` déjà cachés 6h). Coût marginal ≈ 0.

## Backend

### Détection — `services/silent-deals.service.ts`
```ts
detectSilentDeals(orgId): Promise<SilentDeal[]>
// SQL : deals ouverts × max(activity_events.created_at) par hubspot_deal_id
// silencieux si: last_activity < now() - silence_days
//   ET (close_date < now() + horizon_days OU amount >= amount_floor)
```
- Seuils configurables : nouvelle table `silent_deal_settings` (org_id, silence_days default 7, horizon_days default 30, amount_floor default 0) ou colonnes dans `pulse_preferences`.
- Sévérité calculée en TS (pas de LLM) : `critical` (close_date dépassée ou <7j), `warning` (<30j), `info`.

### Migration `supabase/migrations/<ts>_add_silent_deal_alerts.sql`
1. Étendre `pulse_notifications.event_type` : ajouter `'deal_silent'` à la contrainte.
2. Table `silent_deal_alerts` (org_id, hubspot_deal_id, detected_at, resolved_at, last_activity_at, severity, unique actif par deal) — évite de re-notifier chaque scan tant que le deal reste silencieux ; `resolved_at` posé dès qu'une nouvelle activité arrive.
3. Préférence : colonne `notify_deal_silent boolean default true` dans `pulse_preferences`.

### Scan périodique
- Pas de cron existant → pattern BullMQ de `hubspot-realtime-queue.service.ts` : job `{type:'scan-silent-deals', orgId}` en **repeatable** (1×/jour, 7h), queue `maintenance`. Fallback dev : timer in-memory (déjà présent dans ce service).
- Le processor : `detectSilentDeals` → upsert `silent_deal_alerts` → créer `pulse_notifications` (scope owner pour le sales du deal, scope org/équipe pour manager — même logique de visibilité que Pulse actuel).

### Résolution automatique
- Hook dans le processor webhook existant (`process-webhook-event` / rehydrate-activity) : à toute nouvelle `activity_event` sur un deal, `update silent_deal_alerts set resolved_at = now()` si alerte active. Coût quasi nul, temps réel.

### Routes `routes/silent-deals.ts`
- `GET /api/silent-deals` (liste active, filtre owner/severity ; sales = ses deals, manager = équipe via `assertOwnerScope`)
- `POST /api/silent-deals/:id/dismiss`
- `GET/PUT /api/silent-deals/settings` (manager/admin)

## Frontend
- **Pulse** : nouveau type rendu dans `PulseNotificationCenter` (icône 🔇, lien deal) + toggle dans `PulseSettingsView`.
- **Forecast** : badge "Silencieux Nj" sur les lignes deal de `ForecastView` (le service forecast joint `silent_deal_alerts` actifs — 1 left join).
- **Sales** : dans `TasksView`/queue, les deals silencieux du sales remontent en tête (bonus au `priority_score` existant, pas de nouveau composant).
- `services/api.ts` : `fetchSilentDeals()`, `dismissSilentDealAlert()`.

## Lien avec les tâches existantes
Pour chaque alerte `critical`, déclencher `analyzeFollowUpTask` (déjà caché, TTL 6h) → crée une `sales_task` "relancer X" avec draft email. Limiter aux 10 plus gros deals par scan pour borner le coût LLM.

## Étapes
1. Migration + service de détection SQL + tests sur données réelles (1 j)
2. Job repeatable + résolution auto via webhook (1 j)
3. Routes + intégration Pulse/Forecast UI (1 j)
4. Option follow-up task auto (0,5 j)

## Risques
- Orgs sans sync activité complète → faux positifs : exiger qu'au moins 1 activité historique existe sur le deal avant de le déclarer silencieux.
- Volume : index `(org_id, hubspot_deal_id, created_at desc)` sur `activity_events`.
