# Dashboard UI

Ce dossier contient l'interface pipeline/manager affichee dans l'extension Jarvis.

## Structure

```text
components/dashboard/
├── charts/          # Graphiques SVG sans logique de fetch (ForecastChart, StageFunnelChart)
├── deal/            # Sous-composants de l'analyse deal (loading panel, icones, sections overview/qualification/activite)
├── forecast/        # Sous-composants du forecast (filtres, KPI cards, projection Chart.js, tables deals, synthese IA, progression de job)
├── queue/           # Table, filtres et fiche prospect (ProspectTable, QueueFilters, ProspectDetail)
├── tasks/           # Sous-composants des taches (barre de filtres, metriques/onglets, liste par sections, digest lateral)
├── config.ts        # Libelles, onglets, filtres et constantes UI
├── types.ts         # Types propres au dashboard
├── AdminFeedback.tsx
├── CloseLostAnalysisView.tsx
├── CoachingView.tsx
├── DealAnalysisView.tsx
├── DealProbabilityHistoryPanel.tsx
├── DigestView.tsx
├── FirstRunOnboarding.tsx
├── ForecastAccuracyPanel.tsx
├── ForecastView.tsx
├── HubSpotHeader.tsx
├── HubSpotIntegrationView.tsx
├── LeadsView.tsx
├── MetricIcon.tsx
├── OverviewView.tsx
├── ProbabilityTimelinePanel.tsx
├── PulseNotificationCenter.tsx
├── PulseSettingsView.tsx
├── SalesActivityStatsPanel.tsx
├── SettingsView.tsx
├── Sidebar.tsx
├── StatsView.tsx
├── TasksView.tsx
├── WinAnalysisView.tsx
└── WinGapsCard.tsx

hooks/dashboard/
└── useQueueDashboard.ts  # Etat UI et donnees derivees du dashboard

utils/dashboard/
├── charts.ts        # Helpers de construction de chemins SVG
├── dealAnalysis.ts  # Labels, tons et formatage purs de l'analyse deal
├── forecast.ts      # Helpers purs du forecast (periodes, projection, tris, labels, deltas)
├── formatters.ts    # Formatage dates / montants
├── prospects.ts     # Statuts, buckets, filtres et helpers prospects
└── tasks.ts         # Labels, buckets d'echeance, cache local et helpers purs des taches
```

## Regles

- `QueueView.tsx` reste l'orchestrateur: il assemble le hook et les composants.
- Les appels API passent par `services/api` (barrel re-exportant `services/api/*`).
- Les calculs metier UI vivent dans `utils/dashboard` ou `useQueueDashboard`.
- Les textes, filtres et constantes partagees vivent dans `config.ts`.
- Les types reutilises par plusieurs composants vivent dans `types.ts`.

## Flux de donnees

1. `ExtensionApp` charge les donnees via `useQueue`.
2. `QueueView` passe les prospects et callbacks HubSpot a `useQueueDashboard`.
3. `useQueueDashboard` derive les filtres, stats, charts et selections.
4. Les composants affichent uniquement les donnees recues en props.

Cette separation evite de remettre la logique de filtrage, de charting ou de synchronisation dans un gros composant React.
