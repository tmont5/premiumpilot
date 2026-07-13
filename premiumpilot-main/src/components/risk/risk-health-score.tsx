import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { HealthScore } from "@/lib/risk/types";

// Health score (PRD §11). Color the number by the same red→green scale; premium
// return is deliberately absent here (§11.3) and shown separately.
function scoreColor(score: number): string {
  if (score >= 80) return "text-success";
  if (score >= 70) return "text-warning";
  if (score >= 60) return "text-caution";
  return "text-danger";
}

function barColor(score: number): string {
  if (score >= 80) return "bg-success";
  if (score >= 60) return "bg-warning";
  if (score >= 40) return "bg-caution";
  return "bg-danger";
}

export function RiskHealthScore({ health }: { health: HealthScore }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Health Score</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-baseline gap-3">
          <span className={cn("text-5xl font-bold tabular-nums", scoreColor(health.total))}>
            {health.total}
          </span>
          <span className="text-sm text-muted-foreground">/ 100</span>
          <span className={cn("ml-auto text-sm font-semibold", scoreColor(health.total))}>{health.label}</span>
        </div>
        <div className="space-y-3">
          {health.categories.map((c) => (
            <div key={c.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  {c.label} <span className="text-muted-foreground">· {Math.round(c.weight * 100)}%</span>
                </span>
                <span className="tabular-nums text-muted-foreground">{c.score}</span>
              </div>
              <Progress value={c.score} indicatorClassName={barColor(c.score)} />
              <p className="text-[11px] leading-snug text-muted-foreground">{c.note}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
