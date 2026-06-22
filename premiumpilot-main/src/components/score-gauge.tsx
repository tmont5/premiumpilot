import { scoreBand } from "@/lib/config";
import type { ScoreBreakdown } from "@/lib/types";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const BAND_COLOR = {
  green: "var(--success)",
  yellow: "var(--warning)",
  red: "var(--danger)",
} as const;

const BAND_TEXT = {
  green: "text-success",
  yellow: "text-warning",
  red: "text-danger",
} as const;

const BAND_LABEL = { green: "Healthy", yellow: "Caution", red: "At Risk" } as const;

export function ScoreGauge({ score }: { score: number }) {
  const band = scoreBand(score);
  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(100, Math.max(0, score)) / 100);
  return (
    <div className="flex items-center gap-5">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--secondary)" strokeWidth="12" />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={BAND_COLOR[band]}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("text-3xl font-bold tabular-nums", BAND_TEXT[band])}>{score}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">/ 100</span>
        </div>
      </div>
      <div>
        <p className={cn("text-lg font-semibold", BAND_TEXT[band])}>{BAND_LABEL[band]}</p>
        <p className="text-sm text-muted-foreground">Portfolio Health Score</p>
      </div>
    </div>
  );
}

const COMPONENTS: { key: keyof Omit<ScoreBreakdown, "total">; label: string; weight: string }[] = [
  { key: "profitability", label: "Profitability", weight: "30%" },
  { key: "capitalEfficiency", label: "Capital Efficiency", weight: "25%" },
  { key: "diversification", label: "Diversification", weight: "15%" },
  { key: "timeRisk", label: "Time Risk", weight: "15%" },
  { key: "assignmentRisk", label: "Assignment Risk", weight: "15%" },
];

export function ScoreBreakdownBars({ score }: { score: ScoreBreakdown }) {
  return (
    <div className="space-y-3">
      {COMPONENTS.map((c) => {
        const v = Math.round(score[c.key]);
        return (
          <div key={c.key}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {c.label} <span className="text-xs opacity-60">· {c.weight}</span>
              </span>
              <span className="font-medium tabular-nums">{v}</span>
            </div>
            <Progress
              value={v}
              indicatorClassName={v >= 80 ? "bg-success" : v >= 60 ? "bg-warning" : "bg-danger"}
            />
          </div>
        );
      })}
    </div>
  );
}
