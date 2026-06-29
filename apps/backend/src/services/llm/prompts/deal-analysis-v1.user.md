# Mission

Produis l'analyse canonique du deal HubSpot ci-dessous.

Cette analyse sera consommee par le backend, l'extension Chrome, le forecast, le coaching manager et les futurs petits modeles de mise a jour. Elle doit donc etre stable, structuree et non speculative.

# Regles d'analyse

- Analyse la trajectoire chronologique du deal avant de conclure.
- Donne plus de poids aux evenements recents, mais ne supprime pas un risque ancien s'il n'a jamais ete resolu.
- Compare toutes les dates a `today`.
- Un evenement avant `today` est passe: ne le presente jamais comme prochaine echeance.
- `signals` doit regrouper pains, risques, objections et opportunites. Ne cree pas de sections paralleles.
- MEDDICC doit contenir exactement les 8 criteres attendus.
- `forecast.probability` doit refleter le deal reel, pas seulement la probabilite HubSpot.
- Si les preuves se contredisent, renseigne l'arbitrage dans `forecast.reasoningSummary` et `dataQuality.uncertainAssumptions`.
- Si le lifecycle est `open`, renvoie uniquement `{ "kind": "open" }` dans `lifecycle`.
- Si le lifecycle est `won`, remplis uniquement les champs de victoire.
- Si le lifecycle est `lost`, remplis uniquement les champs de perte.

# Donnees runtime

```json
{
  "today": "{{today}}",
  "lifecycleStatus": "{{lifecycleStatus}}",
  "objective": "{{objective}}",
  "deal": {
    "hubspotDealId": "{{hubspotDealId}}",
    "name": "{{dealName}}",
    "stage": "{{dealStage}}",
    "pipeline": "{{pipeline}}",
    "amount": "{{dealAmount}}",
    "currency": "EUR",
    "hubspotProbability": "{{currentCloseProbability}}",
    "closeDate": "{{closeDate}}",
    "ownerName": "{{ownerName}}"
  },
  "company": {
    "name": "{{companyName}}",
    "industry": "{{companyIndustry}}",
    "context": "{{companyContext}}"
  },
  "contacts": "{{contactNames}}",
  "currentState": {
    "lastContactAt": "{{lastContactAt}}",
    "nextAction": "{{nextAction}}"
  },
  "crmSummaries": {
    "activity": "{{crmActivitySummary}}",
    "pendingActions": "{{pendingActionsSummary}}",
    "channelEngagement": "{{channelEngagementSummary}}",
    "activitySignals": "{{activitySignalsSummary}}",
    "winBenchmark": "{{winBenchmarkSummary}}"
  },
  "dealContext": "{{dealContext}}",
  "historyChronological": "{{history}}"
}
```

# Sortie

Renvoie uniquement le JSON de l'analyse, sans `identifiers`, sans `metadata`, sans markdown.
