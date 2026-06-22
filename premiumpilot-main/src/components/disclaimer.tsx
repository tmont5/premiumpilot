// Compliance disclaimer (PRD §15): informational only, not investment advice.
export function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-xs leading-relaxed text-muted-foreground"}>
      PremiumPilot surfaces informational analytics and recommendations only. It does not place
      trades and does not provide personalized investment advice. Options involve risk and are not
      suitable for all investors. Verify all figures with your brokerage before acting.
    </p>
  );
}
