import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { normalizeDealPromptInput } from "./prompt-normalizer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SAMPLE = `Contexte deal:
- Entreprise: Doers EmLab
- Owner: Hugo Samson
- Aujourd'hui: 2026-06-16T09:55:22.957Z
- Dernier contact connu: 2026-06-11T12:56:50.931+00:00

Resume activite CRM:
2026-05-21T14:09:44.000Z | [note] | Note 493291018478 | owner: Hugo Samson | Le prospect a annoncé qu'il avait signé et qu'il attendait un virement du centre de formation, prévu autour du 4 juin.
2026-05-21T14:09:44.000Z | [call] | Appel avec Alexandre Francois | owner: Hugo Samson | Would like to go deeper into the call: Ask anything to Modjo AI
2026-05-21T14:07:38.000Z | [call] | Appel avec Alexandre Francois | owner: Hugo Samson | Appel sortant répondu | Durée: 02:06 | Notes: (ajoutez vos notes ici)
2026-02-03T15:01:42.235Z | [note] | Note 442476766407 | owner: Hugo Samson | Alexandre exprime une forte insatisfaction avec Ringover, qualifiant le service de 'pourri'

Engagement par canal:
Emails: 11 | Appels: 29 | Reunions: 5

Benchmark win:
Sur 136 deals gagnes: cycle moyen 22.8 jours
Jours dans le cycle: actuel=132, benchmark=22.8 (cycleDays)
Activite moyenne d'un deal gagnant: 5.1 appels, 1 emails (12.4 touchpoints au total).

Contexte entreprise:
Entreprise: Doers EmLab
Domaine: getdoers.app

Historique HubSpot chronologique (ancien -> recent):
2026-05-21T14:09:44Z | [note] | Note 493291018478 | Le prospect a annoncé qu'il avait signé et qu'il attendait un virement du centre de formation, prévu autour du 4 juin. Il prévoit de monter à Paris dès qu'il recevra les fonds pour prendre les licences nécessaires.
2026-05-07T08:09:27Z | [note] | Note 490424187072 | Résumé identique pour test dedup contenu.
2026-05-07T08:09:27Z | [note] | Note 490433914070 | Résumé identique pour test dedup contenu.
`;

test("normalizeDealPromptInput deduplicates activities and removes modjo noise", () => {
  const result = normalizeDealPromptInput(SAMPLE);

  assert.ok(result.stats.inputActivityLines > 3);
  assert.ok(result.stats.removedNoise > 0);
  assert.ok(result.stats.outputChars < result.stats.inputChars);
  assert.ok(result.keptActivities.some((activity) => activity.activityId === "493291018478"));
  assert.ok(result.keptActivities.some((activity) => activity.activityId === "442476766407"));
  assert.match(result.lightPrompt, /Activites source/);
  assert.equal(result.dealContext.Entreprise, "Doers EmLab");
  assert.equal(result.channelEngagement.Appels, 29);
  assert.equal(result.companyContext.Domaine, "getdoers.app");
  assert.equal(result.precomputedSignals.stageAgeDays, 132);
  assert.ok(result.benchmarkGaps.some((gap) => gap.metric === "days_in_stage" && gap.actual === 132));
  assert.ok(result.keptActivities.some((activity) => activity.body.includes("monter à Paris")));
  assert.equal(
    result.keptActivities.filter((activity) => activity.activityId === "490424187072" || activity.activityId === "490433914070")
      .length,
    1,
  );
  assert.equal(result.dealContext["Nom du deal"], undefined);
  assert.doesNotMatch(result.lightPrompt, /Message d'origine/);
  assert.match(result.lightPrompt, /\| 493291018478 \| Note \|/);
  assert.doesNotMatch(result.lightPrompt, /Note 493291018478/);
});

test("normalizeDealPromptInput preserves pinned early milestones on full Doers dump", () => {
  const dumpPath = join(__dirname, "../../../../../tmp/llm-prompts/doers-emlab-nouvel-l-ment-deal-459948180673.user-prompt.txt");
  const raw = readFileSync(dumpPath, "utf8");
  const result = normalizeDealPromptInput(raw);

  assert.ok(result.stats.keptActivities >= 20);
  assert.ok(result.stats.pinnedActivities >= 5);
  assert.ok(
    result.keptActivities.some(
      (activity) => activity.activityId === "442168416501" || /ringover/i.test(activity.body),
    ),
  );
  assert.ok(result.keptActivities.some((activity) => activity.activityId === "442476766407"));
  assert.ok(
    result.keptActivities.some(
      (activity) =>
        activity.activityId === "493291018478" && activity.body.includes("monter à Paris"),
    ),
  );
  assert.match(result.lightPrompt, /Contexte entreprise/);
  assert.match(result.lightPrompt, /benchmarkGaps:/);
  assert.match(result.lightPrompt, /Ringover/i);
  assert.ok(result.stats.outputChars < result.stats.inputChars * 0.35);
});

test("normalizeDealPromptInput cleans Medicis SMS noise and test junk", () => {
  const dumpPath = join(
    __dirname,
    "../../../../../tmp/llm-prompts/medicis-immobilier-neuf-fr-nouvel-l-ment-deal-189722215651.user-prompt.txt",
  );
  const result = normalizeDealPromptInput(readFileSync(dumpPath, "utf8"));

  assert.ok(result.keptActivities.filter((activity) => activity.type === "sms").length <= 6);
  assert.ok(result.keptActivities.some((activity) => activity.body.includes("cahier des charges")));
  assert.ok(result.keptActivities.some((activity) => /30 licences/i.test(activity.body)));
  assert.doesNotMatch(result.lightPrompt, /test webhook jarvis/i);
  assert.doesNotMatch(result.lightPrompt, /\| "test2"/i);
  assert.doesNotMatch(result.lightPrompt, /Corps du message:/);
  assert.match(result.lightPrompt, /30 licences/i);
});

test("normalizeDealPromptInput keeps full note and email bodies without truncation", () => {
  const longResume = `Résumé de la conversation Participants Hugo (OnOff Business) Marie (Vitalys) Caroline (Vitalys) Contexte La réunion a été organisée pour discuter du support technique et des tests de l'application OnOff au sein de Vitalys Immobilier avec un déploiement pilote sur 30 licences, Salesforce CTI et configuration réseau pour les agences Lille et Lyon.`;
  const longEmail =
    "Hello, Merci pour votre temps aujourd'hui :) Vous trouverez en PJ de ce mail : 1. Le guide de la première manipulation OnOff 2. Un PDF pour la configuration réseau 3. Un PDF sur le déploiement pilote et la procédure Salesforce CTI.";
  const result = normalizeDealPromptInput(`Contexte deal:
- Entreprise: Vitalys

Resume activite CRM:
2025-10-27T15:03:22.263Z | [note] | Note 328207254742 | owner: Hugo Samson | ${longResume}
2025-10-27T16:29:40.976Z | [email] | Recommandations techniques OnOff | owner: Hugo Samson | ${longEmail}
`);

  assert.match(result.lightPrompt, /Vitalys Immobilier avec un déploiement pilote/);
  assert.match(result.lightPrompt, /procédure Salesforce CTI/);
  assert.doesNotMatch(result.lightPrompt, /Vital…/);
  assert.doesNotMatch(result.lightPrompt, /dé…/);
});