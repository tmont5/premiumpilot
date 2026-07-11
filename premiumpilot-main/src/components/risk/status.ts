import type { RiskStatus } from "@/lib/risk/types";

// Shared color + label mapping for the risk status scale (PRD §12.2). Full class
// strings so Tailwind's scanner keeps them. healthy→green, watch→yellow,
// elevated→orange, critical→red, leverage→purple.
export const STATUS_META: Record<
  RiskStatus,
  { label: string; text: string; bg: string; border: string; dot: string }
> = {
  healthy: { label: "Healthy", text: "text-success", bg: "bg-success/10", border: "border-success/30", dot: "bg-success" },
  watch: { label: "Watch", text: "text-warning", bg: "bg-warning/10", border: "border-warning/30", dot: "bg-warning" },
  elevated: { label: "Elevated", text: "text-caution", bg: "bg-caution/10", border: "border-caution/30", dot: "bg-caution" },
  critical: { label: "Critical", text: "text-danger", bg: "bg-danger/10", border: "border-danger/30", dot: "bg-danger" },
  leverage: { label: "Leverage", text: "text-leverage", bg: "bg-leverage/10", border: "border-leverage/30", dot: "bg-leverage" },
};

const STRESS_META = {
  normal: STATUS_META.healthy,
  warning: STATUS_META.elevated,
  critical: STATUS_META.critical,
} as const;

export function stressMeta(severity: "normal" | "warning" | "critical") {
  return STRESS_META[severity];
}
