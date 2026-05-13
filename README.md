# Jarvis

Bootstrap initial du projet Jarvis, cree comme nouveau dossier isole dans le depot pour ne pas impacter l'application existante `wellcom/wellcom`.

## Perimetre de cette premiere livraison

- monorepo `npm` avec workspaces
- extension Chrome `Manifest V3` en React/TypeScript
- API `Fastify` en TypeScript
- dashboard web `React + Vite`
- package partage pour les types communs
- dossier `supabase/` reserve aux migrations et a la configuration base de donnees

## Structure

```text
jarvis/
├── apps/
│   ├── api/
│   ├── dashboard/
│   └── extension/
├── packages/
│   └── shared/
└── supabase/
    └── migrations/
```

## Commandes prevues

```sh
npm install
npm run dev
npm run dev:dashboard
npm run dev:api
npm run build
```

## Suite logique

1. brancher Supabase et poser la premiere migration
2. implementer l'auth et le contexte multi-tenant cote API
3. construire le module MVP "Morning Queue" dans l'extension
