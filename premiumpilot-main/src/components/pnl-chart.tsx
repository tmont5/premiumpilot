"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PnlSummary } from "@/lib/types";
import { fmtSignedCurrency0 } from "@/lib/format";

// Running cumulative of realized P/L across the trailing 12 months.
export function PnlChart({ series }: { series: PnlSummary["cumulative"] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeOpacity={0.15} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Tooltip
          cursor={{ strokeOpacity: 0.2 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                <p className="font-semibold">{label}</p>
                <p>Cumulative: {fmtSignedCurrency0(Number(payload[0].payload.cumulative))}</p>
                <p className="text-muted-foreground">
                  This month: {fmtSignedCurrency0(Number(payload[0].payload.realized))}
                </p>
              </div>
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey="cumulative"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#pnlFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
