import { useEffect, useState } from "react";
import { fetchWinBenchmarkGaps, type WinBenchmarkComparison } from "../../services/api";

type WinGapsCardProps = {
  orgId: string;
  hubspotDealId: string;
};

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
    <section aria-label="Benchmark deals gagnés" className="jv-win-gaps">
      <div className="jv-win-gaps-head">
        <strong>Vs deals gagnés</strong>
        <small>Benchmark sur {comparison.sampleSize} wins</small>
      </div>
      <ul className="jv-win-gaps-list">
        {comparison.gaps.map((gap) => (
          <li key={gap.metric}>
            <strong>{gap.label}</strong>
            <p>
              {gap.metric === "cycleDays"
                ? `Ce deal est dans le cycle depuis ${gap.actual} jours ; les deals gagnés closent en ~${gap.benchmark} jours.`
                : `Les deals gagnés ont ~${gap.benchmark} ${gap.label.toLowerCase()}, celui-ci en a ${gap.actual}.`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
};