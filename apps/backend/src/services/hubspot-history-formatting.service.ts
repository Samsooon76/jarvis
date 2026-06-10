import type { HubSpotDealHistoryItem } from "./hubspot.service.js";

const MAX_PROMPT_TIMELINE_CHARS = 10_000;

export const sanitizeHubSpotHtml = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const stripped = value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  return stripped || null;
};

const sortByTimestamp = (left: HubSpotDealHistoryItem, right: HubSpotDealHistoryItem): number => {
  const leftTime = left.timestamp ? new Date(left.timestamp).getTime() : Number.POSITIVE_INFINITY;
  const rightTime = right.timestamp ? new Date(right.timestamp).getTime() : Number.POSITIVE_INFINITY;

  return (Number.isNaN(leftTime) ? Number.POSITIVE_INFINITY : leftTime) -
    (Number.isNaN(rightTime) ? Number.POSITIVE_INFINITY : rightTime);
};

export const formatHubSpotTimelineForPrompt = (timeline: HubSpotDealHistoryItem[]): string => {
  const formattedTimeline = timeline
    .slice()
    .sort(sortByTimestamp)
    .map((item) => {
      const metadataSummary = Object.entries(item.metadata)
        .filter(([, value]) => Boolean(value))
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");

      return [
        item.timestamp ?? "date inconnue",
        `[${item.type}]`,
        item.title,
        sanitizeHubSpotHtml(item.body) ?? "",
        metadataSummary,
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .join("\n");

  if (formattedTimeline.length <= MAX_PROMPT_TIMELINE_CHARS) {
    return formattedTimeline;
  }

  return formattedTimeline.slice(-MAX_PROMPT_TIMELINE_CHARS);
};
