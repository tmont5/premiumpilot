"use client";
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { EnrichedPosition } from "@/lib/types";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/status";
import { fmtCurrency0 } from "@/lib/format";

const TONE_COLOR: Record<string, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  secondary: "var(--muted-foreground)",
};

interface Point {
  x: number;
  y: number;
  z: number;
  ticker: string;
  status: EnrichedPosition["metrics"]["status"];
  fill: string;
}

export function HeatmapChart({ positions }: { positions: EnrichedPosition[] }) {
  const data: Point[] = positions.map((p) => ({
    x: p.metrics.dte,
    y: Math.round(p.metrics.profitCapturePct),
    z: p.capital_requirement,
    ticker: p.ticker,
    status: p.metrics.status,
    fill: TONE_COLOR[STATUS_TONE[p.metrics.status]],
  }));

  return (
    <ResponsiveContainer width="100%" height={360}>
      <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
        <CartesianGrid strokeOpacity={0.15} />
        <XAxis
          type="number"
          dataKey="x"
          name="DTE"
          tick={{ fontSize: 12 }}
          label={{ value: "Days To Expiration", position: "insideBottom", offset: -12, fontSize: 12 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Profit Capture"
          unit="%"
          tick={{ fontSize: 12 }}
          label={{ value: "Profit Capture %", angle: -90, position: "insideLeft", fontSize: 12 }}
        />
        <ZAxis type="number" dataKey="z" range={[80, 600]} name="Capital" />
        <Tooltip cursor={{ strokeOpacity: 0.2 }} content={<HeatmapTooltip />} />
        <Scatter data={data} fillOpacity={0.75}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function HeatmapTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-semibold">{d.ticker}</p>
      <p className="text-muted-foreground">{STATUS_LABEL[d.status]}</p>
      <p>{d.x} DTE · {d.y}% captured</p>
      <p>Capital at risk: {fmtCurrency0(d.z)}</p>
    </div>
  );
}
