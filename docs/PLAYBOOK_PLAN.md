# Plan de construction — Feature Playbook

> Objectif : permettre à un manager de construire un **playbook de vente vivant**, alimenté par
> les analyses d'appels et de deals (win/loss), et challengé en continu par Jarvis Pulse qui
> suggère des modifications quand les données du terrain divergent du playbook.
>
> Principe directeur : chaque phase livre quelque chose d'utilisable seul. On peut s'arrêter
> (ou pivoter) à la fin de n'importe quelle phase sans avoir travaillé pour rien.

## État des lieux (ce qui existe déjà et qu'on réutilise)

| Brique existante | Où | Ce qu'on en fait |
|---|---|---|
| `calls.transcript`, `ai_summary`, `ai_sentiment`, `ai_objections`, `ai_next_steps` | `20260326113000_initial_schema.sql` | Carburant de la Call Intelligence — les colonnes existent, il faut les remplir et les exploiter |
| `CloseWonDealAnalysis.replicablePlays` (`{ play, when }`) | `services/win-analysis/` + `llm/close-won.ts` | Matière première directe des suggestions de plays |
| `CloseLostDealAnalysis` (facteurs de perte, objections) | `services/close-lost-analysis/` | Alimente les plays "gestion d'objections / pièges" |
| Pattern run asynchrone (`status/progress/logs/result`, cache `input_hash`) | `close-lost-analysis/runs.ts`, `win-analysis/runs.ts` | À répliquer pour l'analyse d'appels et la génération de playbook |
| Pulse (`pulse_notifications.event_type`, `pulse_preferences.notify_*`) | `pulse.service.ts`, `20260612100000_add_jarvis_pulse.sql` | Nouveau type d'événement `playbook_suggestion` |
| Routing dashboard lazy + gating `canViewTeamForecast` | `QueueView.tsx`, `ExtensionApp.tsx` | Nouvelles vues Appels et Playbook |
| Contrats API | `packages/shared/src/index.ts` | Tous les nouveaux types y passent |

---

## Phase 0 — Cadrage et fondations (½ journée) — ✅ faite (2026-06-12)

- [x] **0.1 Décider de la source des transcripts.** Trois options :
  - (a) Les calls HubSpot contiennent des notes/body exploitables → on commence avec ça (zéro intégration nouvelle).
  - (b) Intégration d'un provider d'enregistrement (Modjo, Gong, recall.ai…) → reporter en phase 5, ne pas bloquer le reste.
  - (c) Pas de transcript du tout pour l'instant → la Call Intelligence travaille sur les métadonnées (durée, fréquence, notes) et les analyses deal existantes. Le playbook reste faisable.
  > Décision (2026-06-12) : **option (a)** — on se base sur la data HubSpot existante (notes/body
  > des calls, métadonnées, analyses deal). Pas de provider d'enregistrement pour l'instant ;
  > une extension/intégration de recording audio sera étudiée plus tard (phase 5).
- [x] **0.2 Définir la taxonomie des plays** (enum partagée) : `qualification`, `discovery`, `demo`, `objection_handling`, `negotiation`, `closing`, `follow_up`. C'est structurant pour la base, les prompts et l'UI — à figer avant de coder.
- [x] **0.3 Esquisser le contrat de données d'un play** dans `packages/shared` (sans backend) :
  trigger (« quand le prospect dit/fait X »), réponse recommandée, catégorie, statut
  (`draft` | `active` | `archived`), source (`manual` | `ai_suggested`), evidence (liens calls/deals).

**Livrable : décisions écrites + types partagés. Aucun risque, tout le reste s'appuie dessus.**

---

## Phase 1 — Playbook statique (CRUD + UI manager) — le socle — ✅ faite (2026-06-12)

> Implémentée : migration `20260620100000_add_playbook.sql`, service `services/playbook/`
> (+ tests `shared.test.ts`), routes `routes/playbook.ts`, client `services/api/playbook.ts`,
> vue `components/dashboard/playbook/PlaybookView.tsx` (lecture tous rôles, édition manager/admin).
> Reste à faire : appliquer la migration via le CLI Supabase, puis tester en conditions réelles.

*Valeur : le manager peut déjà rédiger et publier sa doctrine de vente, les sales la consultent. Aucun LLM, aucun risque technique.*

### Backend
- [ ] **1.1 Migration** `supabase/migrations/<ts>_add_playbook.sql` :
  - `playbooks` : `id`, `org_id`, `name`, `description`, `status`, `created_by`, timestamps. RLS par `org_id` (copier le pattern des tables existantes).
  - `playbook_plays` : `id`, `org_id`, `playbook_id`, `category` (taxonomie 0.2), `title`, `trigger_description`, `recommended_response` (text/markdown), `status`, `source` (`manual`/`ai_suggested`), `position` (ordre), `version` (int), timestamps.
  - `playbook_play_evidence` : `id`, `play_id`, `kind` (`call`/`deal`/`analysis`), `ref_id`, `note`.
- [ ] **1.2 Service** `services/playbook/` (suivre le découpage maison : `data-access.ts`, `types.ts`, point d'entrée `playbook.service.ts`) : CRUD playbook + plays, réordonnancement, archivage (jamais de delete dur — cohérent avec la philosophie `sales_queue_operating`).
- [ ] **1.3 Routes** `routes/playbook.ts` : GET liste/détail (tous rôles), POST/PATCH/archive (gated `assertManagerOrAdmin`). Enregistrer dans `server.ts`.
- [ ] **1.4 Types de réponse API** dans `packages/shared/src/index.ts`.
- [ ] **1.5 Tests** `playbook.service.test.ts` à côté du service (node test runner, `npm test -w @jarvis/api`).

### Extension
- [ ] **1.6 Client API** : nouveau module `services/api/playbook.ts` + réexport dans le barrel `services/api.ts`, TTL de cache dans `cache.ts`.
- [ ] **1.7 Vue** `components/dashboard/playbook/PlaybookView.tsx` (lazy, comme `CoachingView`) : liste des plays groupés par catégorie, lecture pour tous, boutons créer/éditer/archiver si manager. CSS dans `components/styles/`.
- [ ] **1.8 Routing** : ajouter l'entrée workspace dans `QueueView.tsx` (`workspaceCopy` + lazy import). Lecture ouverte à tous les rôles ; édition gatée par `canViewTeamForecast`.

**Livrable : un playbook éditable et consultable dans l'extension. Démontrable à un client.**

---

## Phase 2 — Génération de plays depuis l'existant (quick win IA)

*Valeur : le bouton « Générer des plays depuis les 90 derniers jours ». On exploite les `replicablePlays` win-analysis et les patterns close-lost — données déjà calculées et cachées, coût LLM quasi nul.*

- [ ] **2.1 Agrégateur** `services/playbook/suggestions.ts` : lire les `close_won` analyses (champ `replicablePlays: { play, when }`) et les `close_lost_deal_analyses` (objections/facteurs récurrents) de l'org sur N jours ; dédupliquer/regrouper par similarité (un appel LLM léger de clustering, prompt versionné dans `llm/prompts/`).
- [ ] **2.2 Table** `playbook_suggestions` : `id`, `org_id`, `playbook_id`, `kind` (`new_play` / `update_play` / `retire_play`), `payload` (jsonb : le play proposé), `rationale`, `evidence` (jsonb), `status` (`pending`/`accepted`/`rejected`), `created_at`, `resolved_at`, `resolved_by`.
- [ ] **2.3 Endpoint** POST `/api/playbook/:id/suggestions/generate` (manager) — job synchrone simple au début (les données sont déjà en cache, c'est rapide) ; passer en run asynchrone si trop lent.
- [ ] **2.4 UI** : onglet « Suggestions » dans PlaybookView — carte par suggestion avec rationale + preuves (deals sources cliquables), boutons Accepter (crée/modifie le play, `source: ai_suggested`) / Modifier puis accepter / Rejeter.
- [ ] **2.5 Boucle d'apprentissage minimale** : les suggestions rejetées restent en base et sont passées au prompt des générations suivantes (« ne plus proposer ça »).

**Livrable : le playbook se remplit en un clic à partir des analyses win/loss. Premier moment "wow".**

---

## Phase 3 — Call Intelligence (catégorie Appels)

*Valeur : vue dédiée d'analyse des appels + agrégats cross-appels. C'est le carburant de la boucle vivante. Dépend de la décision 0.1.*

- [ ] **3.1 Analyse LLM par appel** `services/call-intelligence/` (découpage `data-access` / `analysis` / `cache` / `types`, copier deal-intelligence) : à partir de `calls.transcript` (ou notes), produire type d'appel, objections, questions posées, moments clés, next steps — remplir les colonnes `ai_*` existantes de `calls` + une table de cache `call_ai_analyses` (pattern `input_hash` + TTL, copier `rep_coaching_analyses`).
- [ ] **3.2 Déclenchement** : à l'ingestion d'un call (`hubspot-activity/activity-ingestion.ts`, le hook de rehydrate LLM existe déjà) + backfill par run asynchrone (`call_analysis_runs`, copier `close-lost-analysis/runs.ts` : `queued/running/completed`, `progress`, `logs`).
- [ ] **3.3 Agrégats cross-appels** `services/call-intelligence/insights.ts` (déterministe, sans LLM, comme `benchmark.ts` de win-analysis) : fréquence des objections par catégorie/stage, durée moyenne par type d'appel, corrélation patterns ↔ outcome des deals liés.
- [ ] **3.4 Routes** `routes/calls.ts` : liste analysée, détail, agrégats, lancement/poll du run de backfill.
- [ ] **3.5 UI** `components/dashboard/calls/CallsView.tsx` : liste des appels analysés (filtres rep/type/période), fiche détail, panneau insights agrégés. Sales : ses appels ; manager : toute l'équipe.
- [ ] **3.6 Pont vers le playbook** : sur une fiche d'appel, action « créer un play depuis cet appel » (pré-remplit une suggestion avec l'appel en evidence).

**Livrable : catégorie Appels complète. Vendable seule, même sans la suite.**

---

## Phase 4 — La boucle vivante (drift detection + Pulse)

*Valeur : le différenciateur. Jarvis surveille l'écart entre le playbook et la réalité et notifie le manager.*

- [ ] **4.1 Job de drift** `services/playbook/drift.ts`, exécuté périodiquement (cron/queue BullMQ, fallback job-store mémoire comme le reste) : croise plays actifs × insights call-intelligence × analyses win/loss récentes. Détections v1 :
  - **Play contredit** : les deals/appels où le play est pertinent performent moins bien que l'alternative observée.
  - **Trou de couverture** : pattern récurrent (objection, étape) sans play correspondant.
  - **Play obsolète** : trigger plus jamais observé depuis N semaines.
- [ ] **4.2 Garde-fous statistiques** : seuils minimums d'effectif avant de suggérer (copier l'esprit de `MIN_CLOSED_DEALS_FOR_LLM = 10` du coaching) + cooldown anti-spam par play.
- [ ] **4.3 Sortie** : insertion dans `playbook_suggestions` (mêmes statuts/UX que phase 2 — la boucle d'approbation est déjà construite, c'est le gros bénéfice de l'ordre choisi).
- [ ] **4.4 Pulse** : étendre `PulseEventType` avec `playbook_suggestion` dans `packages/shared`, colonne de préférence `notify_playbook` dans `pulse_preferences` (migration `extend_*`), insertion via `recordPulseNotifications()` ciblée managers/admins. Le badge et le polling du service worker fonctionnent sans modification.
- [ ] **4.5 Versionnage** : à chaque acceptation, incrémenter `version` du play et historiser l'ancienne version (`playbook_play_versions`) — le manager voit l'évolution de sa doctrine dans le temps.

**Livrable : « 5 démos perdues sur le même pattern → Jarvis propose un play » en notification Pulse.**

---

## Phase 5 — Distribution et mesure (plus tard)

- [ ] **5.1 Injection pré-call** : plays pertinents dans les « points de discussion » de Deal Intelligence (selon stage + objections connues du deal).
- [ ] **5.2 Adhérence** : matcher transcripts ↔ plays pour mesurer si un rep suit le playbook ; alimenter le coaching par rep. *(C'est le problème dur — le garder pour la fin, quand il y a du volume.)*
- [ ] **5.3 Provider de transcription** dédié si l'option 0.1(a) montre ses limites.

---

## Ordre, dépendances, charge estimée

```
Phase 0 (½ j) ──▶ Phase 1 (2-3 j) ──▶ Phase 2 (2 j) ──▶ Phase 4 (3-4 j)
                                  └──▶ Phase 3 (3-4 j) ──┘
```

- Les phases 2 et 3 sont indépendantes l'une de l'autre ; la phase 4 a besoin des deux.
- Chaque phase suit le rituel : migration → service + tests → routes → types shared → client API extension → UI → démo.
