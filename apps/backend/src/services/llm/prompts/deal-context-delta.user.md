# Mission

Lis l'analyse canonique et le nouvel evenement CRM. Retourne un patch minimal.

# Schema de sortie

```json
{
  "requiresCanonicalRerun": true,
  "rerunReason": "raison courte ou null",
  "patches": [
    {
      "op": "replace",
      "path": "/forecast/dealMomentum",
      "value": "increasing",
      "rationale": "raison factuelle courte",
      "evidence": {
        "activityId": "id ou null",
        "activityType": "call|email|note|meeting|sms|communication|task|deal|crm_field|transcript",
        "occurredAt": "date ISO ou null",
        "title": "titre ou null",
        "quote": "preuve courte",
        "confidence": "low|medium|high"
      }
    }
  ],
  "confidence": "low|medium|high"
}
```

# Regles de patch

- `op` vaut uniquement `add` ou `replace`.
- `path` doit pointer vers un champ existant de `DealAnalysisV1`, hors `/identifiers` et `/metadata`.
- Pour ajouter un signal, utilise `/signals/-`.
- Pour ajouter une action, utilise `/actionPlan/nextSteps/-`.
- Pour ajouter une info manquante, utilise `/dataQuality/missingInformation/-`.
- Si tu veux modifier `forecast.probability` de plus de 15 points vers le haut ou 20 points vers le bas, demande une reanalyse canonique.
- Si l'evenement indique un changement de lifecycle, demande une reanalyse canonique.
- Si l'evenement contient une objection majeure nouvelle, tu peux ajouter un signal et demander une reanalyse canonique.

# Analyse canonique

```json
{{canonicalDealAnalysis}}
```

# Nouvel evenement CRM

```json
{{crmEvent}}
```

# Sortie

Renvoie uniquement le JSON du patch.
