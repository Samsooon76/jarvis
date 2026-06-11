# Jarvis — Comment le SaaS fonctionne

Jarvis est un **copilote de vente propulsé par IA**, livré sous forme d'extension Chrome (side panel) connectée à HubSpot. Il aide les commerciaux à prioriser leurs prospects au quotidien, et donne aux managers une vue intelligente du pipeline : forecast, coaching, analyses de deals gagnés/perdus et alertes temps réel.

---

## 1. Vue d'ensemble de l'architecture

```
┌─────────────────────────┐        HTTP/REST         ┌──────────────────────────┐
│  Extension Chrome (MV3) │ ───────────────────────▶ │   API Backend (Fastify)  │
│  React + Vite           │                          │   Node.js / TypeScript   │
│  apps/extension         │ ◀─────────────────────── │   apps/backend           │
└─────────────────────────┘                          └─────────┬────────────────┘
        │ auth (JWT Supabase)                                  │
        ▼                                          ┌───────────┼───────────┐
┌─────────────────────────┐                        ▼           ▼           ▼
│  Supabase (Auth + RLS)  │              ┌──────────────┐ ┌─────────┐ ┌─────────────┐
│  PostgreSQL             │◀────────────▶│ HubSpot API  │ │  Redis  │ │ Fournisseurs│
│  supabase/migrations    │   OAuth +    │ (OAuth +     │ │ BullMQ  │ │ LLM (OpenAI,│
└─────────────────────────┘   webhooks   │  webhooks)   │ │(optionn)│ │ DeepSeek,   │
                                         └──────────────┘ └─────────┘ │ Gemini)     │
                                                                      └─────────────┘
```

C'est un **monorepo npm workspaces** :

| Dossier | Rôle |
|---|---|
| `apps/backend` | API Fastify : routes, services métier, intégration HubSpot, couche LLM |
| `apps/extension` | Extension Chrome (Manifest V3) : side panel React, service worker de polling |
| `packages/shared` | Types et contrats d'API partagés entre backend et extension |
| `supabase/migrations` | Schéma PostgreSQL versionné (tables, RLS, RPC) |
| `docs/` | Documentation (webhooks HubSpot, prompts LLM, ce fichier) |

### Flux de communication

1. **Extension → Backend** : appels REST `/api/*` avec un JWT Supabase en Bearer token. Le client HTTP ([client.ts](../apps/extension/src/services/api/client.ts)) ajoute une couche de cache côté extension (TTL par domaine, définis dans `services/api/cache.ts`).
2. **Backend → Supabase** : client admin (`service_role`) dans `db/client.ts`. Les données sensibles (tokens HubSpot) vivent dans le schéma `private`, accessible uniquement via des fonctions RPC.
3. **Backend → HubSpot** : OAuth2 (tokens stockés chiffrés en base, refresh automatique) + ingestion de webhooks temps réel.
4. **Backend → LLM** : abstraction multi-fournisseurs (OpenAI / DeepSeek / Vertex Gemini), aucune clé IA côté client.
5. **Redis/BullMQ** : optionnel — l'API démarre sans Redis ; un job-store en mémoire (`services/job-store.ts`) sert de fallback pour suivre les jobs asynchrones.

---

## 2. Rôles et permissions

| Rôle | Accès |
|---|---|
| **Sales (commercial)** | Sa queue de prospects, le détail de ses deals, ses tâches, son forecast personnel |
| **Manager** | Tout ce qu'a un sales **+** dashboard équipe : forecast équipe (filtre par commercial), digest, coaching par rep, analyses win/loss, notifications Pulse |
| **Admin** | Tout ce qu'a un manager **+** connexion/déconnexion HubSpot, gestion des rôles, paramètres d'organisation |

L'isolation multi-tenant est garantie à deux niveaux :
- **RLS PostgreSQL** : toutes les tables publiques filtrent par `org_id`.
- **Hooks d'auth Fastify** ([server.ts](../apps/backend/src/server.ts) + `services/app-auth.service.ts`) : chaque requête vérifie le JWT, charge le contexte utilisateur (org, rôle) et applique `assertOrgAccess` / `assertManagerOrAdmin` sur les routes sensibles.

---

## 3. Les modules fonctionnels

### 3.1 Queue du matin (commerciaux)

Liste quotidienne de prospects priorisés, affichée à l'ouverture du side panel.

- **Source** : contacts + deals HubSpot synchronisés dans la table `prospects`.
- **Scoring** : déterministe (`services/scoring.service.ts`) — récence du dernier contact, âge et montant du deal, probabilité, urgence de la prochaine action → `ai_priority_score`.
- **Actions** : *snooze* (reporter), *skip* (écarter), ouvrir le détail. Les ajustements manuels sont tracés dans `sales_queue_operating` (pas de suppression de données).
- Routes : `routes/queue.ts`, service `queue.service.ts`, UI `components/QueueView.tsx`.

### 3.2 Analyse de deal (Deal Intelligence)

Fiche d'analyse approfondie d'un deal, générée par IA et mise en cache.

- **Contenu** : identité contact/société, infos deal, comité d'achat (influence, sentiment, rôle de chaque contact), qualification type MEDDICC (budget, autorité, besoin, timing), signaux de risque, historique d'activité, points de discussion pré-call, plan d'action suggéré.
- **Moteur** : `services/deal-intelligence.service.ts` agrège les données HubSpot, le LLM synthétise (prompts dans `services/llm/prompts/`), résultat caché dans `deal_ai_analyses` (TTL ~6 h) pour maîtriser les coûts.
- UI : `components/dashboard/DealAnalysisView.tsx` + sous-composants dans `dashboard/deal/`.

### 3.3 Forecast

Pipeline avec probabilité de closing assistée par IA.

- **Classification IA** par deal : *Commit* (haute confiance), *Best Case*, *At Risk*, *Slipping* — calculée par `services/forecast.service.ts`, synthèse narrative LLM via le prompt `forecast-synthesis`.
- **Snapshots** : capture quotidienne du pipeline (`forecast_snapshots`) pour mesurer ensuite la **précision du forecast** (`forecast-accuracy.service.ts`) : biais, slippage, commit vs réel.
- **Filtre équipe** : les managers peuvent filtrer le forecast par commercial (gating : `role !== "sales"`).
- UI : `ForecastView.tsx`, `ForecastAccuracyPanel.tsx`, graphiques Chart.js dans `dashboard/charts/`.

### 3.4 Dashboard manager

- **Digest quotidien/hebdo** (`manager-digest.service.ts`) : synthèse LLM de l'activité équipe — victoires, risques, mouvements de deals, recommandations.
- **Coaching par rep** (`rep-coaching.service.ts`) : analyse par commercial (win rate, volume d'activité, cycle de vente, patterns d'objection) avec forces/faiblesses et actions de coaching. Lancé en job asynchrone, l'UI poll le statut.
- **Analyse close-lost** (`close-lost-analysis.service.ts`) : facteurs de perte récurrents et leçons.
- **Analyse close-won** (`win-analysis.service.ts`) : facteurs de victoire (champion, timing, fit produit, pricing…) et plays réplicables.
- **Stats d'activité** (`sales-activity-stats.service.ts`) : volumes calls/emails/meetings croisés avec les résultats.
- **Objectifs** (`sales-targets.service.ts`) : cibles par commercial.

### 3.5 Jarvis Pulse (notifications temps réel)

- Un webhook HubSpot signale un changement de deal (probabilité, montant, stage, owner, date de close) → `hubspot-webhook.service.ts` détecte le delta → insertion dans `jarvis_pulse_notifications`.
- Le **service worker** de l'extension ([background.ts](../apps/extension/src/background.ts)) poll régulièrement et affiche un badge ; centre de notifications dans le dashboard.
- Préférences par utilisateur (types d'événements activables) dans `jarvis_pulse_preferences`.

### 3.6 Tâches et follow-ups automatiques

- **Analyse de tâches** (`task-analyzer.service.ts` + `task-planning.service.ts`) : classification par type (cold call, relance deal, post-meeting, admin, obsolète), suggestion de prochaine action avec priorité, normalisation sur les heures ouvrées (`business-days.ts`).
- **Follow-ups automatiques** (`follow-up-task.service.ts`) : création déterministe de tâches de relance après un événement (message sortant sans réponse, changement de stage…) ; une réponse client entrante annule la relance et crée une tâche urgente. Anti-doublons via `follow_up_cache`.
- Synchronisation bidirectionnelle des tâches avec HubSpot (lecture, création, priorité, complétion) via `routes/hubspot/tasks.routes.ts`.

### 3.7 Leads

- Sync des leads HubSpot (`hubspot_leads_sync`) et **scoring des contacts de lead** par LLM (`lead-contact-scoring.service.ts`, prompt `lead-contact-ranking`) : classement des contacts par potentiel d'engagement pour prioriser l'outbound.

---

## 4. Intégration HubSpot en détail

### Connexion (OAuth2)

1. Un admin clique « Connecter HubSpot » → `/api/auth/hubspot/start` génère l'URL OAuth.
2. HubSpot redirige vers `/api/auth/hubspot/callback` → les tokens (access + refresh) sont stockés dans `private.organization_integrations` via RPC (jamais exposés au client).
3. La sync initiale est déclenchée en job asynchrone.

Routes dans `apps/backend/src/routes/hubspot/` (un module par domaine : `oauth`, `sync`, `tasks`, `owners`, `deals`, `status`, `disconnect`), refresh de token dans `hubspot-auth.service.ts`.

Le wrapper de l'API HubSpot est découpé par domaine dans `apps/backend/src/services/hubspot/` :

| Module | Rôle |
|---|---|
| `types.ts` | Types partagés (tokens, objets CRM, snapshots, historiques, tâches, activités) |
| `client.ts` | Plomberie HTTP : fetch avec retry sur 429, pagination, lectures batch, constantes et listes de propriétés |
| `shared.ts` | Helpers purs (lecture de propriétés, parsing, noms de contact/société) |
| `oauth.ts` | URL d'autorisation, state signé HMAC, échange et refresh de tokens |
| `pipelines.ts` | Stages de deal, résolution du statut de cycle de vie (won/lost/pending) |
| `contacts.ts` / `companies.ts` / `owners.ts` | Lecture et mapping des contacts, sociétés et owners |
| `deals.ts` | Recherche de deals par owner, détail, historique et timeline |
| `leads.ts` | Recherche des leads (objet custom HubSpot) |
| `activities.ts` | Mapping des engagements (calls, emails, meetings…) en items d'historique |
| `tasks.ts` | CRUD des tâches HubSpot |
| `prospects.ts` | Orchestration des snapshots CRM et construction des résumés prospects (scoring de priorité) |

Le fichier historique `services/hubspot.service.ts` reste un point d'entrée (barrel) qui réexporte les types et l'objet `hubSpotService` — les imports existants restent valides.

### Synchronisation

- **Initiale** : fetch complet contacts + deals + owners → upsert dans `prospects` et tables `hubspot_*`. Suivi de progression via job (`/api/sync/hubspot/jobs/:jobId`), statut visible dans le dashboard.
- **Incrémentale** : webhooks HubSpot (`routes/webhooks.ts`) mis en file dans `hubspot-realtime-queue` puis traités ; fallback par polling si un webhook est manqué.
- **Historique** : trajectoires des deals (`hubspot_deal_history`) et probabilités (`deal_probability_history`) conservées pour les timelines et l'accuracy.
- **Déconnexion** : `/api/hubspot/disconnect` révoque et purge les données liées.

Voir aussi [docs/hubspot-webhooks.md](hubspot-webhooks.md).

---

## 5. Couche LLM

Abstraction multi-fournisseurs dans `apps/backend/src/services/llm/` :

- **Interface commune** (`llm.provider.ts`) + **factory** (`provider.factory.ts`). Fournisseurs implémentés : OpenAI (défaut), DeepSeek, Vertex Gemini.
- **Préférence par organisation** stockée en base (`provider-preference.service.ts`), fallback sur la config env.
- **Rate limiting** par org et fournisseur (`llm-rate-limiter.ts`).
- **Prompts versionnés** dans `llm/prompts/` : qualification, plan d'activité, close-lost, close-won, synthèse forecast, digest manager, coaching rep, analyse de tâches, ranking de contacts. Export lisible dans [docs/llm-prompts-export.md](llm-prompts-export.md).
- **Réponses validées** contre un schéma JSON et **mises en cache** par org/fournisseur/modèle/type d'analyse pour limiter les coûts.

Principe clé : **aucun appel IA côté client** — l'extension reste légère, tout passe par le backend.

---

## 6. Modèle de données (Supabase)

Tables principales (cf. `supabase/migrations/`) :

| Domaine | Tables |
|---|---|
| Tenancy | `organizations`, `users` (avec rôle) |
| CRM | `prospects`, `hubspot_crm_sync_snapshot`, `hubspot_deal_history`, `hubspot_contact_history`, `hubspot_leads_sync`, `hubspot_lead_contact_scores` |
| IA (caches) | `deal_ai_analyses`, `task_ai_analyses`, `close_lost_analyses`, `win_analyses`, `manager_digests`, `rep_coaching` |
| Forecast | `forecast_snapshots`, `deal_probability_history`, synthèse forecast |
| Opérationnel | `sales_queue_operating` (snooze/skip), `follow_up_cache`, `prospect_access_logs`, `calls` |
| Notifications | `jarvis_pulse_notifications`, `jarvis_pulse_preferences` |
| Secrets | `private.organization_integrations` (tokens HubSpot — RLS + RPC uniquement) |

---

## 7. Organisation du code

### Backend (`apps/backend/src`)

```
index.ts / server.ts      # Bootstrap Fastify, CORS, hooks d'auth, enregistrement des routes
config/env.ts             # Chargement env (dotenv), validation
db/                       # Client Supabase + types générés
lib/                      # errors, sentry, format (utilitaires partagés)
routes/                   # 1 module par domaine (queue, forecast, tasks, pulse, …)
routes/hubspot/           # Routes HubSpot découpées par sous-domaine
services/                 # Logique métier (1 service par domaine)
services/hubspot/         # Wrapper API HubSpot découpé par domaine (cf. section 4)
services/llm/             # Abstraction LLM + providers + prompts
```

### Extension (`apps/extension/src`)

```
main.tsx / ExtensionApp.tsx   # Montage React, routing entre vues
background.ts                 # Service worker : polling Pulse, badge
services/api.ts               # Barrel — réexporte services/api/* (1 module par domaine + cache.ts + client.ts)
components/dashboard/         # Vues du dashboard (1 fichier par vue) + deal/ + queue/ + charts/
hooks/                        # useQueue, usePulseNotifications, useQueueDashboard
utils/dashboard/              # Formatters, view models, helpers d'analyse de deal
```

### Conventions

- TypeScript strict partout (`noUnusedLocals`, `noUnusedParameters`).
- Les contrats d'API vivent dans `packages/shared` — toute nouvelle réponse d'API doit y être typée.
- Analyses lourdes = jobs asynchrones (l'UI poll), résultats LLM systématiquement cachés en base.
- Tests backend : `npm test -w @jarvis/api` (node test runner, fichiers `*.test.ts` à côté des services).

---

## 8. Développement et déploiement

```bash
npm install          # racine (workspaces)
npm run dev          # lance tout (scripts/dev-all.sh) : API + extension en watch
npm run build        # shared → api → extension
npm test --workspaces --if-present
```

- **Env** : variables documentées dans `.env.example` (racine + par app). Le backend charge `.env` via dotenv sans écraser les variables déjà présentes dans l'environnement.
- **Extension** : `npm run build -w @jarvis/extension` produit `dist/` à charger en mode développeur dans Chrome (side panel + service worker, Manifest V3).
- **Déploiement API** : Railway (`railway.json`) ; l'API démarre avec ou sans Redis. Alternative décrite dans `deploy/hostinger/`.
- **Migrations** : appliquées via le CLI Supabase depuis `supabase/migrations/`.
- **Monitoring** : Sentry côté backend et extension.
