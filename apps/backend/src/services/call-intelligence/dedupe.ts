// Dedoublonnage des calls: Onoff et Modjo loggent chacun le meme appel dans
// HubSpot (Modjo seulement au-dela d'~1 min, avec un resume plus riche). On
// regroupe les entrees qui decrivent le meme appel reel et on choisit un call
// canonique (le plus riche en contenu) par groupe.

export type DedupeCall = {
  id: string;
  startedAt: string | null;
  durationSeconds: number | null;
  prospectId: string | null;
  userId: string | null;
  // Score de richesse du contenu (transcript/body/resume) pour choisir le canonique.
  richness: number;
};

export type CallGroup = {
  canonicalId: string;
  memberIds: string[];
  // Metadonnees fusionnees du groupe.
  startedAt: string | null;
  durationSeconds: number | null;
};

// Les deux outils n'horodatent pas pareil (debut d'appel vs fin de traitement):
// fenetre courte par defaut, elargie quand les durees confirment le meme appel.
const START_WINDOW_BASE_MS = 120_000;
const START_WINDOW_MATCHING_DURATION_MS = 360_000;
const DURATION_TOLERANCE_SECONDS = 20;

const parseTime = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();

  return Number.isFinite(time) ? time : null;
};

const durationsCompatible = (left: number | null, right: number | null): boolean => {
  if (left === null || right === null || left <= 0 || right <= 0) {
    // Duree inconnue d'un cote: on ne s'oppose pas au regroupement,
    // la fenetre temporelle courte fera le tri.
    return true;
  }

  return Math.abs(left - right) <= DURATION_TOLERANCE_SECONDS;
};

const durationsNearlyEqual = (left: number | null, right: number | null): boolean => {
  if (left === null || right === null || left <= 0 || right <= 0) {
    return false;
  }

  return Math.abs(left - right) <= DURATION_TOLERANCE_SECONDS;
};

const bothDurationsKnown = (left: number | null, right: number | null): boolean =>
  left !== null && left > 0 && right !== null && right > 0;

// Onoff logge au debut de l'appel, Modjo a la fin: l'ecart entre les deux logs
// HubSpot est proche de la duree de l'appel (pas de la fenetre courte habituelle).
const isStartEndLogPair = (
  leftTime: number,
  rightTime: number,
  leftDuration: number | null,
  rightDuration: number | null,
): boolean => {
  if (!durationsNearlyEqual(leftDuration, rightDuration)) {
    return false;
  }

  const durationSeconds = Math.max(leftDuration ?? 0, rightDuration ?? 0);
  const durationMs = durationSeconds * 1000;
  const timeDiffMs = Math.abs(leftTime - rightTime);

  return Math.abs(timeDiffMs - durationMs) <= START_WINDOW_BASE_MS;
};

// Deux entrees decrivent-elles le meme appel reel ?
export const canMergeCalls = (left: DedupeCall, right: DedupeCall): boolean => {
  const leftTime = parseTime(left.startedAt);
  const rightTime = parseTime(right.startedAt);

  // Sans horodatage fiable des deux cotes, on ne fusionne jamais.
  if (leftTime === null || rightTime === null) {
    return false;
  }

  // Owners differents = appels differents (deux reps peuvent appeler le meme compte).
  if (left.userId && right.userId && left.userId !== right.userId) {
    return false;
  }

  // Prospects differents = appels differents (null reste compatible: Modjo
  // n'associe pas toujours le contact).
  if (left.prospectId && right.prospectId && left.prospectId !== right.prospectId) {
    return false;
  }

  if (!durationsCompatible(left.durationSeconds, right.durationSeconds)) {
    return false;
  }

  const window = bothDurationsKnown(left.durationSeconds, right.durationSeconds)
    ? START_WINDOW_MATCHING_DURATION_MS
    : START_WINDOW_BASE_MS;

  if (Math.abs(leftTime - rightTime) <= window) {
    return true;
  }

  return isStartEndLogPair(leftTime, rightTime, left.durationSeconds, right.durationSeconds);
};

const pickCanonical = (members: DedupeCall[]): DedupeCall =>
  [...members].sort(
    (left, right) =>
      right.richness - left.richness ||
      (right.durationSeconds ?? 0) - (left.durationSeconds ?? 0) ||
      left.id.localeCompare(right.id),
  )[0];

// Regroupe les calls dupliques. Entree dans n'importe quel ordre; sortie triee
// par date de debut decroissante (groupes les plus recents d'abord).
export const groupDuplicateCalls = (calls: DedupeCall[]): CallGroup[] => {
  const sorted = [...calls].sort((left, right) => (parseTime(right.startedAt) ?? 0) - (parseTime(left.startedAt) ?? 0));
  const clusters: DedupeCall[][] = [];

  for (const call of sorted) {
    const cluster = clusters.find((members) => members.some((member) => canMergeCalls(member, call)));

    if (cluster) {
      cluster.push(call);
    } else {
      clusters.push([call]);
    }
  }

  return clusters.map((members) => {
    const canonical = pickCanonical(members);
    const startTimes = members
      .map((member) => parseTime(member.startedAt))
      .filter((time): time is number => time !== null);
    const durations = members
      .map((member) => member.durationSeconds)
      .filter((duration): duration is number => duration !== null && duration > 0);

    return {
      canonicalId: canonical.id,
      memberIds: members.map((member) => member.id),
      startedAt: startTimes.length > 0 ? new Date(Math.min(...startTimes)).toISOString() : canonical.startedAt,
      durationSeconds: durations.length > 0 ? Math.max(...durations) : canonical.durationSeconds,
    };
  });
};
