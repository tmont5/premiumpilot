"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PremiumHistoryEntry } from "@/lib/types";
import { fmtCurrency0 } from "@/lib/format";

// Aggregates realized income into the trailing 12 calendar months.
export function IncomeChart({ history }: { history: PremiumHistoryEntry[] }) {
  const now = new Date();
  const buckets: { label: string; key: string; total: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
    buckets.push({
      label: d.toLocaleDateString("en-US", { month: "short" }),
      key: `${d.getFullYear()}-${d.getMonth()}`,
      total: 0,
    });
  }
  const index = new Map(buckets.map((b) => [b.key, b]));
  for (const e of history) {
    const d = new Date(e.realized_at);
    const b = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (b) b.total += e.premium_amount;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={buckets} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeOpacity={0.15} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          cursor={{ fillOpacity: 0.08 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                <p className="font-semibold">{label}</p>
                <p>{fmtCurrency0(Number(payload[0].value))}</p>
              </div>
            ) : null
          }
        />
        <Bar dataKey="total" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
