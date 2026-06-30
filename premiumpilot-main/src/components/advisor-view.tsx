"use client";
import { useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdvisorConsideration, AdvisorResult } from "@/lib/advisor";

const PRIORITY: Record<AdvisorConsideration["priority"], { label: string; variant: BadgeProps["variant"] }> = {
  high: { label: "High", variant: "danger" },
  medium: { label: "Medium", variant: "warning" },
  low: { label: "Low", variant: "secondary" },
};

const CATEGORY_LABEL: Record<AdvisorConsideration["category"], string> = {
  assignment_risk: "Assignment risk",
  profit_taking: "Profit taking",
  cash_capital: "Cash & capital",
  assigned_stock: "Assigned stock",
  income_goal: "Income goal",
  other: "Other",
};

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export function AdvisorView() {
  const [result, setResult] = useState<AdvisorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/advisor", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "The advisor request failed.");
      setResult(data.result as AdvisorResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const sorted = result
    ? [...result.considerations].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={generate} disabled={loading}>
          {result ? (
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          ) : (
            <Sparkles className={loading ? "size-4 animate-spin" : "size-4"} />
          )}
          {loading ? "Analyzing…" : result ? "Regenerate" : "Generate analysis"}
        </Button>
        {!result && !loading && !error && (
          <span className="text-sm text-muted-foreground">
            Reviews your dashboard, positions, heat map, and cash to surface what needs attention.
          </span>
        )}
      </div>

      {error && (
        <Card>
          <CardContent className="p-5 text-sm text-danger">{error}</CardContent>
        </Card>
      )}

      {loading && !result && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Reviewing your positions, assignment risk, profit capture, and cash deployment…
          </CardContent>
        </Card>
      )}

      {result && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Portfolio read</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm leading-relaxed">{result.summary}</CardContent>
          </Card>

          {sorted.map((c, i) => (
            <Card key={i}>
              <CardHeader className="gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={PRIORITY[c.priority].variant}>{PRIORITY[c.priority].label}</Badge>
                  <span className="text-xs text-muted-foreground">{CATEGORY_LABEL[c.category]}</span>
                  {c.tickers.map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                </div>
                <CardTitle className="text-base">{c.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0 text-sm leading-relaxed">
                <p>{c.observation}</p>
                {c.options.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {c.options.map((o, j) => (
                      <li key={j}>{o}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
