import type { GeneratedAlert } from "@/lib/alerts";
import type { AlertType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ArrowRightLeft, CircleDollarSign, ShieldAlert, TrendingUp } from "lucide-react";

const META: Record<AlertType, { label: string; icon: typeof TrendingUp; tone: string }> = {
  assignment_risk: { label: "Assignment Risk", icon: ShieldAlert, tone: "text-danger" },
  close: { label: "Close", icon: TrendingUp, tone: "text-success" },
  roll: { label: "Roll", icon: ArrowRightLeft, tone: "text-warning" },
  cash_deployment: { label: "Cash", icon: CircleDollarSign, tone: "text-chart-4" },
};

export function AlertsPanel({ alerts }: { alerts: GeneratedAlert[] }) {
  if (alerts.length === 0) {
    return <p className="text-sm text-muted-foreground">No active alerts — everything looks calm.</p>;
  }
  return (
    <ul className="divide-y">
      {alerts.map((a, i) => {
        const meta = META[a.type];
        const Icon = meta.icon;
        return (
          <li key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <Icon className={cn("mt-0.5 size-4 shrink-0", meta.tone)} />
            <div className="min-w-0">
              <p className="text-sm font-medium">{a.message}</p>
              <p className="text-xs text-muted-foreground">
                <span className={cn("font-medium", meta.tone)}>{meta.label}</span> · {a.recommendation}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
