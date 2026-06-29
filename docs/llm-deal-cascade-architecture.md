# Architecture LLM Deal Cascade

Objectif: produire une analyse de deal fiable une premiere fois avec un modele fort, puis laisser des modeles moins couteux enrichir le contexte sans reinterpreter tout le CRM.

## Principe

Jarvis doit separer deux operations:

1. `canonical_deal_analysis`
   - Lancee sur un snapshot CRM complet: deal, contacts, company, activites, notes, appels, tasks, historique de stage.
   - Utilise le meilleur modele disponible.
   - Produit un JSON strict conforme a `deal-analysis-v1.schema.json`.
   - Devient la source IA canonique jusqu'au prochain changement significatif.

2. `deal_context_delta`
   - Lancee sur un evenement recent: email, call, note, task, changement de stage, nouvelle objection.
   - Utilise un modele plus petit.
   - Ne refait pas l'analyse.
   - Produit uniquement un patch structure ou une recommandation de reanalyse.

Le petit modele n'a pas le droit d'inventer une nouvelle strategie complete. Il doit dire: "ce nouvel evenement modifie tel champ", "ce champ reste stable", ou "il faut relancer l'analyse canonique".

## Pipeline recommande

```text
HubSpot snapshot complet
  -> normalisation backend deterministe
  -> modele fort: canonical_deal_analysis
  -> validation JSON Schema
  -> parser/normalizer TypeScript
  -> cache deal_ai_analyses
  -> UI + forecast + coaching + playbook

Nouvel evenement HubSpot
  -> normalisation backend deterministe
  -> modele leger: deal_context_delta
  -> validation patch
  -> application du patch si faible risque
  -> sinon reanalyse canonique
```

## Regles anti-divagation

- Le prompt doit interdire toute information hors CRM.
- Le schema doit forcer les enumerations, les longueurs, les bornes numeriques et les champs requis.
- Chaque affirmation importante doit porter une `evidence` avec `activityId` quand disponible.
- Les petits modeles ne doivent pas recalculer MEDDICC, forecast ou lifecycle complet.
- Un patch ne peut pas supprimer une evidence existante.
- Un patch ne peut pas augmenter la probabilite de plus de 15 points ni la baisser de plus de 20 points sans `requiresCanonicalRerun: true`.
- Si le nouvel evenement contredit l'analyse canonique, le petit modele doit demander une reanalyse.

## Determinisme attendu

Pour rendre les runs plus stables:

- temperature 0 ou minimale
- meme ordre de blocs dans le prompt et dans le schema
- JSON Schema strict, `additionalProperties: false`
- listes bornees avec `maxItems`
- textes bornes avec `maxLength`
- dates ISO uniquement
- evidence obligatoire pour les signaux, forecast reasons et actions critiques
- validation backend avec rejet + retry correctif court si le JSON est invalide
- hash d'input stable pour eviter de relancer une analyse identique

## Strategie de retry

1. Appel principal avec le schema strict.
2. Si JSON invalide: retry unique avec le message d'erreur de validation et le JSON brut.
3. Si schema invalide mais recuperable: parser backend normalise les valeurs non critiques.
4. Si champ critique absent: echec explicite, pas de fallback invente.
5. Si deux runs divergent fortement sur un meme input: garder le cache existant et ouvrir un signal de review.

## Fichiers associes

- `apps/backend/src/services/llm/prompts/deal-analysis-v1.system.md`
- `apps/backend/src/services/llm/prompts/deal-analysis-v1.user.md`
- `apps/backend/src/services/llm/prompts/deal-context-delta.system.md`
- `apps/backend/src/services/llm/prompts/deal-context-delta.user.md`
- `apps/backend/src/services/llm/schemas/deal-analysis-v1.schema.json`

## Integration avec le code actuel

Le repo a deja:

- `packages/shared/src/deal-analysis-v1.ts`
- `apps/backend/src/services/llm/deal-analysis-v1.ts`
- `apps/backend/src/services/llm/deal-analysis-v1.parse.ts`
- `apps/backend/src/services/deal-intelligence/v1.ts`

La prochaine etape technique est de remplacer le pseudo-schema texte dans `buildDealAnalysisV1Instructions` par une reference au JSON Schema, puis de faire passer ce schema au provider quand il supporte une sortie structuree native.
