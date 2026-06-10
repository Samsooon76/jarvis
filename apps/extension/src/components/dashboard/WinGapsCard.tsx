import { useEffect, useState } from "react";
import { fetchWinBenchmarkGaps, type WinBenchmarkComparison } from "../../services/api";

type WinGapsCardProps = {
  orgId: string;
  hubspotDealId: string;
};

// Encart "vs deals gagnes": diff numerique deal ouvert vs benchmark des wins.
// 100% deterministe (0 LLM); masque quand le benchmark n'est pas significatif.
export const WinGapsCard = ({ orgId, hubspotDealId }: WinGapsCardProps) => {
  const [comparison, setComparison] = useState<WinBenchmarkComparison | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    setComparison(null);
    fetchWinBenchmarkGaps(orgId, hubspotDealId, { signal: abortController.signal })
      .then(setComparison)
      .catch(() => setComparison(null));

    return () => abortController.abort();
  }, [hubspotDealId, orgId]);

  if (!comparison || !comparison.reliable || comparison.gaps.length === 0) {
    return null;
  }

  return (
    <article className="ae-forecast-panel ae-win-gaps-card">
      <div className="ae-panel-heading">
        <h4>Vs deals gagnes</h4>
        <small>Benchmark sur {comparison.sampleSize} wins</small>
      </div>
      <div className="ae-forecast-list">
        {comparison.gaps.map((gap) => (
          <div key={gap.metric}>
            <strong>{gap.label}</strong>
            <p>
              {gap.metric === "cycleDays"
                ? `Ce deal est dans le cycle depuis ${gap.actual} jours; les deals gagnes closent en ~${gap.benchmark} jours.`
                : `Les deals gagnes ont ~${gap.benchmark} ${gap.label.toLowerCase()}, celui-ci en a ${gap.actual}.`}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
};
