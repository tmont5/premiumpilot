const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const fmtCurrency = (n: number) => usd.format(n);
export const fmtCurrency0 = (n: number) => usd0.format(n);

export const fmtPct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;
// For ratios stored as fractions (e.g. 0.42 -> 42.0%).
export const fmtPctFromFraction = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

export const fmtSignedPctFromFraction = (n: number, digits = 1) =>
  `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;

export const fmtNumber = (n: number) => new Intl.NumberFormat("en-US").format(n);

export function fmtDate(iso: string) {
  return new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function fmtRelativeTime(iso: string | null) {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
