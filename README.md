# Jarvis

Extension Chrome de sales copilot branchee sur une API Fastify, Supabase, HubSpot OAuth/sync et une couche optionnelle de providers LLM.

## Structure

```text
jarvis/
├── apps/
│   ├── backend/      # API Fastify, HubSpot, Supabase, services LLM
│   └── extension/    # Side panel Manifest V3, dashboard React et queue
├── packages/
│   └── shared/       # Types partages backend / extension
├── supabase/
│   └── migrations/   # Schema base, RLS, RPCs
└── deploy/
```

Il n'y a plus de workspace separe `apps/dashboard`. Le dashboard manager vit maintenant dans l'extension, sous `apps/extension/src/components/dashboard`.

## Commandes

```sh
npm install
npm run dev
npm run dev:api
npm run dev:extension
npm run lint
npm run build
```

## Spine Produit Actuelle

- L'OAuth HubSpot est gere par le backend.
- Les tokens HubSpot sont stockes via des RPC Supabase securisees.
- La sync HubSpot initiale/manuelle ecrit les contacts et deals dans Supabase.
- Le side panel de l'extension affiche la queue et les vues manager basees sur HubSpot.
- Les appels LLM restent cote backend derriere une abstraction provider.

## Regles D'engineering

- TypeScript strict est active, y compris la detection des locals/parametres inutilises.
- Les reponses API suivent `{ success: boolean, data?: T, error?: string }`.
- Les secrets et tokens provider restent uniquement dans l'environnement/config backend.
- Les donnees Supabase privees doivent passer par des RPC securisees plutot qu'un acces client direct.
