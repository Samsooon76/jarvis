# JARVIS — Sales Copilot Chrome Extension

## Statut reel du projet

Etat audite et mis a jour le 26 mars 2026 dans `/Users/hugo/Downloads/jarvis`.

### Ce qui existe deja

- Monorepo `npm` avec workspaces:
  - `apps/backend`
  - `apps/extension`
  - `packages/shared`
- Backend `Fastify + TypeScript` demarrable
- Extension Chrome `Manifest V3 + React + TypeScript`
- Dashboard manager web en React, integre dans `apps/extension`
- Schema Supabase initial pose avec migrations SQL
- RLS activee sur les tables principales
- Seed de demo present dans Supabase
- Endpoint `GET /api/queue/:userId` branche sur Supabase avec fallback demo
- UI extension qui affiche la morning queue

### Ce qui est maintenant branche pour de vrai

- OAuth2 HubSpot cote backend
- Bouton `Connecter HubSpot` dans le dashboard manager
- Flow OAuth ouvre la popup HubSpot classique, puis revient sur Jarvis
- Callback OAuth stocke les tokens HubSpot dans Supabase via RPC securise
- Sync HubSpot initiale lancee en arriere-plan apres connexion
- Sync `contacts + deals associes` vers `public.prospects`
- Endpoint de statut `GET /api/hubspot/status`
- Dashboard qui affiche:
  - `HubSpot Portal`
  - `Prospects sync`
  - `Deals HubSpot` en live via API HubSpot
  - derniere sync visible

### Ce qui n'existe pas encore

- Auth applicative utilisateur exploitable de bout en bout
- Webhooks HubSpot
- Refresh token HubSpot exploite en rotation automatique
- Fiche prospect detaillee
- Actions `snooze` / `skip`
- Ingestion telephonie
- Analyse post-call
- Integration LLM reelle
- Dashboard manager KPI complet
- Jobs async `BullMQ + Redis`
- Logs structures, erreurs custom homogenes, tests

### Conclusion produit

Le projet n'est plus au stade "queue demo uniquement".

Jarvis est maintenant capable de:

1. connecter un vrai compte HubSpot via OAuth
2. stocker cette connexion
3. lancer une sync initiale vers Supabase
4. exposer un statut manager visible dans le dashboard

En revanche, on n'a pas encore un produit sales complet:

- la sync reste partielle
- la queue n'est pas encore entierement industrialisee
- l'IA n'est pas branchee
- le dashboard n'est pas encore un vrai dashboard KPI

---

## Decision produit: HubSpot d'abord, LLM ensuite

### Ce qu'il faut comprendre

- Sans HubSpot connecte, Jarvis ne peut pas devenir un vrai copilote.
- Sans LLM, on peut deja livrer une version utile du Module 1:
  - OAuth HubSpot
  - sync CRM
  - scoring deterministe
  - queue priorisee
  - fiche prospect basique sans resume IA
- Le LLM devient indispensable pour:
  - resume pre-call
  - talking points
  - battlecards
  - analyse post-call
  - coaching manager

### Decision recommandee

1. Stabiliser totalement la spine HubSpot.
2. Mettre la queue en prod avec de la vraie data.
3. Ajouter ensuite la couche `LLM provider`.

### Implication technique

Il ne faut pas coder Jarvis autour d'un seul provider LLM.

Il faut garder une abstraction:

- `llm.provider.ts`
- `providers/openai.provider.ts`
- `providers/anthropic.provider.ts`

---

## Stack cible mise a jour

| Composant | Technologie | Statut |
|---|---|---|
| Extension Chrome | Manifest V3, TypeScript, React | En place |
| Backend API | Node.js, TypeScript, Fastify | En place |
| Base de donnees | Supabase PostgreSQL + Auth + RLS | En place |
| HubSpot | OAuth2 + API + sync initiale | Branche partiellement |
| Moteur IA | Abstraction LLM (`OpenAI` d'abord, `Anthropic` ensuite) | A faire |
| Queue async | BullMQ + Redis | A faire |
| Dashboard manager | React webapp | Branche partiellement |
| Hosting | Railway / Render / Fly.io | A faire |

---

## Architecture cible

```text
[Chrome Extension]
        ↕ REST
[Backend Fastify]
    ├── [Supabase]
    ├── [HubSpot OAuth + API + RPC + future webhooks]
    ├── [LLM Provider Layer]
    │     ├── OpenAI
    │     └── Anthropic
    ├── [Telephony Provider]
    └── [BullMQ / Redis]
```

---

## Etat reel par module

### Module 1 — Morning Queue

#### Fait

- Schema `prospects` present
- Seed de demo present
- Endpoint `GET /api/queue/:userId` present
- Tri par `ai_priority_score` dans Supabase
- UI extension de queue presente
- Sync HubSpot initiale remplit `public.prospects`
- Score deterministe calcule lors de la sync HubSpot

#### Manquant

- Auth utilisateur reelle
- Refresh automatique des donnees HubSpot
- Actions `snooze` et `skip`
- Affectation robuste des prospects a un owner HubSpot reel
- Scoring centralise dans un vrai `scoring.service.ts`

#### Blocage principal

La data HubSpot remonte maintenant, mais il manque encore les endpoints produit pour manipuler la queue et la rendre vraiment operationnelle.

### Module 2 — Prospect Detail / Pre-call Intel

#### Fait

- Rien de produit-ready

#### Manquant

- Endpoint prospect detail
- Timeline interactions
- Recuperation notes / engagements
- Resume pre-call
- Talking points
- Battlecard

### Module 3 — Post-call Automation

#### Fait

- Tables `calls` et `actions` presentes

#### Manquant

- Route `calls`
- Ingestion telephonie
- Webhook call ended
- Transcription
- Analyse LLM
- Validation d'actions
- Push HubSpot

### Module 4 — Manager Dashboard

#### Fait

- Table `daily_kpis` presente
- Dashboard web manager visible
- Connexion HubSpot declenchable depuis l'interface admin
- Statut HubSpot lisible dans le dashboard
- Nombre de prospects synchronises visible
- Nombre de deals HubSpot live visible

#### Manquant

- KPIs equipe reels
- KPIs individuels
- Graphiques
- Alertes
- Coaching LLM
- Bouton de relance de sync
- Historique de sync et etat d'erreur persistant

---

## Priorites de dev mises a jour

### Phase 1 — HubSpot spine complete

Objectif: rendre la connexion HubSpot robuste et exploitable.

- [x] Ajouter la config env HubSpot cote backend
- [x] Implementer OAuth2 HubSpot
- [x] Stocker les tokens HubSpot dans Supabase
- [x] Creer `hubspot.service.ts`
- [x] Exposer `POST /api/sync/hubspot`
- [x] Exposer `GET /api/hubspot/status`
- [x] Afficher le statut HubSpot dans le dashboard
- [ ] Gerer le refresh token HubSpot automatiquement
- [ ] Ajouter les webhooks HubSpot pour sync incremental
- [ ] Ajouter une relance manuelle de sync dans le dashboard
- [ ] Mapper proprement les owners HubSpot vers `users.hubspot_owner_id`

### Phase 2 — MVP queue exploitable sans IA

Objectif: sortir une premiere valeur produit avec vraie data.

- [ ] Centraliser le scoring v1 dans `scoring.service.ts`
- [ ] Ajouter `POST /api/prospects/:id/snooze`
- [ ] Ajouter `POST /api/prospects/:id/skip`
- [ ] Ajouter une fiche prospect basique:
  - identite
  - deal
  - dernieres interactions
  - prochaine action
- [ ] Brancher l'extension sur ces endpoints

### Phase 3 — Couche LLM

Objectif: ajouter l'intelligence produit sans couplage fort.

- [ ] Creer `services/llm/llm.provider.ts`
- [ ] Creer `services/llm/providers/openai.provider.ts`
- [ ] Prevoir `services/llm/providers/anthropic.provider.ts`
- [ ] Definir les contrats de sortie JSON stricts
- [ ] Ajouter validation de schema des reponses LLM
- [ ] Ajouter prompts:
  - pre-call summary
  - post-call analysis
  - coaching insights

### Phase 4 — Post-call et dashboard complet

- [ ] Ingestion Aircall/Ringover
- [ ] Jobs async
- [ ] Actions suggerees
- [ ] Sync HubSpot en ecriture
- [ ] Dashboard manager KPI complet

---

## Ce qu'on doit faire maintenant

### Ordre recommande

1. Fiabiliser la sync HubSpot et son cycle de vie.
2. Finir la vraie queue produit.
3. Ensuite seulement brancher le LLM.

### Pourquoi

- L'OAuth est maintenant en place, donc la prochaine valeur vient de la qualite de sync et de la queue.
- Tant que la queue n'est pas exploitable, ajouter une IA ne regle pas le coeur du produit.
- Le dashboard manager doit d'abord confirmer la data avant d'afficher du coaching.

---

## Choix LLM recommande

### Recommandation immediate

Si le provider le plus accessible aujourd'hui est OpenAI:

- implenter OpenAI d'abord
- garder Anthropic prevu mais optionnel

### Regle produit

Le LLM ne "gere pas tout".

Le LLM sert a:

- resumer
- scorer qualitativement
- suggerer
- structurer

Le systeme source de verite reste:

- HubSpot
- Supabase
- les regles metier backend

---

## Structure backend cible

```text
apps/backend/src/
├── index.ts
├── config/
│   └── env.ts
├── db/
│   ├── client.ts
│   └── database.types.ts
├── routes/
│   ├── health.ts
│   ├── auth.ts
│   ├── hubspot.ts
│   ├── queue.ts
│   ├── prospects.ts
│   ├── calls.ts
│   └── dashboard.ts
├── services/
│   ├── hubspot.service.ts
│   ├── scoring.service.ts
│   └── llm/
│       ├── llm.provider.ts
│       └── providers/
│           ├── openai.provider.ts
│           └── anthropic.provider.ts
├── jobs/
│   ├── sync-hubspot.job.ts
│   └── analyze-call.job.ts
└── lib/
    ├── errors.ts
    └── logger.ts
```

---

## Endpoints prioritaires

### Deja branches

```text
GET  /health
GET  /api/auth/hubspot/start
GET  /api/auth/hubspot/callback
GET  /api/hubspot/status
POST /api/sync/hubspot
GET  /api/queue/:userId
```

### A faire ensuite

```text
GET  /api/prospects/:id
POST /api/prospects/:id/snooze
POST /api/prospects/:id/skip
POST /api/calls
POST /api/calls/:id/analyze
GET  /api/calls/:id/analysis
POST /api/calls/:id/actions/approve
POST /api/calls/:id/actions/reject
POST /api/calls/:id/sync-hubspot
GET  /api/dashboard/team/:orgId
GET  /api/dashboard/user/:userId
```

---

## Conventions importantes

- TypeScript strict obligatoire
- Pas de `any`
- Toutes les reponses API au format:

```ts
{ success: boolean, data?: T, error?: string }
```

- Pas de logique LLM dans l'extension
- Pas de token provider loggue
- Tous les prompts LLM vivent cote backend
- Toutes les sorties LLM doivent etre parsees et validees
- Les donnees sensibles d'integration vont dans `private.organization_integrations`
- Si un schema `private` doit etre lu/ecrit par le backend via Supabase HTTP, passer par des fonctions RPC securisees

---

## RGPD et securite

### Deja reflechi

- Multi-tenant
- RLS
- separation schema `public` / `private`
- secrets d'integration stockes cote backend / DB privee

### A ne pas oublier

- rotation des secrets et tokens si exposition accidentelle
- pas de logs de tokens
- consentement si transcription d'appels
- politique de retention des transcripts
- endpoint de purge client
- journal d'acces aux fiches prospect

---

## Definition of done du prochain milestone

Le prochain milestone acceptable n'est plus "connecter HubSpot".

Ce milestone est atteint.

Le prochain milestone acceptable est:

1. HubSpot est connecte.
2. La sync prospects/deals peut etre relancee et observee.
3. La queue de l'extension utilise de la vraie data HubSpot.
4. Le sales peut `snooze` et `skip`.
5. Le manager voit un statut de sync fiable.

Une fois ca fait, on branche le LLM.

---

## Instruction de travail pour le LLM

Quand je te demande de coder:

1. Respecte la stack actuelle.
2. Priorise les dependances reelles avant l'IA.
3. Si une feature peut marcher sans LLM, livre-la sans LLM.
4. Si une feature demande un LLM, implemente une abstraction provider et pas un couplage direct.
5. Place les secrets d'integration cote backend uniquement.
6. Garde un scope petit, testable et deployable.
7. Si une fonctionnalite touche des donnees perso, mentionne l'impact RGPD.
8. Si une integration Supabase privee est necessaire, privilegie une RPC securisee plutot qu'un acces direct au schema `private`.
