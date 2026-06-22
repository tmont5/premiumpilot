import { PageHeader } from "@/components/page-header";
import { PositionsTable } from "@/components/positions-table";
import { Disclaimer } from "@/components/disclaimer";
import { Card, CardContent } from "@/components/ui/card";
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
      <Disclaimer className="mt-4 text-xs leading-relaxed text-muted-foreground" />
    </>
  );
}
