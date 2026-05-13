# Dashboard UI

Ce dossier contient l'interface pipeline/manager affichee dans l'extension Jarvis.

## Structure

```text
components/dashboard/
├── charts/          # Graphiques SVG sans logique de fetch
├── queue/           # Table, filtres, bulk actions, fiche prospect
├── config.ts        # Libelles, onglets, filtres et constantes UI
├── types.ts         # Types propres au dashboard
├── HubSpotHeader.tsx
├── OverviewView.tsx
├── Sidebar.tsx
├── StatsView.tsx
└── TasksView.tsx

hooks/dashboard/
└── useQueueDashboard.ts  # Etat UI et donnees derivees du dashboard

utils/dashboard/
├── charts.ts       # Helpers de construction de chemins SVG
├── formatters.ts   # Formatage dates / montants
└── prospects.ts    # Statuts, buckets, filtres et helpers prospects
```

## Regles

- `QueueView.tsx` reste l'orchestrateur: il assemble le hook et les composants.
- Les composants ne font pas d'appel API direct.
- Les calculs metier UI vivent dans `utils/dashboard` ou `useQueueDashboard`.
- Les textes, filtres et constantes partagees vivent dans `config.ts`.
- Les types reutilises par plusieurs composants vivent dans `types.ts`.

## Flux de donnees

1. `ExtensionApp` charge les donnees via `useQueue`.
2. `QueueView` passe les prospects et callbacks HubSpot a `useQueueDashboard`.
3. `useQueueDashboard` derive les filtres, stats, charts et selections.
4. Les composants affichent uniquement les donnees recues en props.

Cette separation evite de remettre la logique de filtrage, de charting ou de synchronisation dans un gros composant React.
