import { PageHeader } from "@/components/page-header";
import { PositionsTable } from "@/components/positions-table";
import { AssignedHoldingsTable } from "@/components/assigned-holdings-table";
import { Disclaimer } from "@/components/disclaimer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPortfolio } from "@/lib/data";

export default async function PositionsPage() {
  const pf = await getPortfolio();
  return (
    <>
      <PageHeader
        title="Positions"
        description="Every open option position with computed metrics and status."
      />
      <Card>
        <CardContent className="p-0">
          <PositionsTable positions={pf.positions} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Assigned Holdings</CardTitle>
          <p className="text-sm text-muted-foreground">
            Stock acquired through assignment — the capital tied up beyond your open options.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <AssignedHoldingsTable holdings={pf.assignedHoldings} />
        </CardContent>
      </Card>

      <Disclaimer className="mt-4 text-xs leading-relaxed text-muted-foreground" />
    </>
  );
}
