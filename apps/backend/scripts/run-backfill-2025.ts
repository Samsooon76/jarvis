import { readFileSync } from "node:fs";

for (const line of readFileSync("/Users/hugo/Downloads/jarvis/.env", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const main = async () => {
  const orgId = process.env.VITE_DEFAULT_ORG_ID!;
  const { backfillClosedDealActivities } = await import("../src/services/hubspot-activity.service.js");
  console.log("Backfill activites 2025 demarre pour org", orgId);
  const result = await backfillClosedDealActivities(orgId, {
    closedFrom: "2025-01-01",
    closedTo: "2025-12-31",
  });
  console.log("TERMINE:", JSON.stringify(result));
};

main().then(() => process.exit(0)).catch((e) => { console.error("ECHEC", e); process.exit(1); });
