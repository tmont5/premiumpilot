import { PageHeader } from "@/components/page-header";
import { HeatmapChart } from "@/components/heatmap-chart";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getPortfolio } from "@/lib/data";

export default async function HeatmapPage() {
  const pf = await getPortfolio();
  return (
    <>
      <PageHeader title="Portfolio Heat Map" description="DTE vs. profit capture, sized by capital at risk.">
        <div className="flex items-center gap-2">
          <Badge variant="success">Close Candidate</Badge>
          <Badge variant="warning">Monitor</Badge>
          <Badge variant="danger">Risk</Badge>
        </div>
      </PageHeader>
      <Card>
        <CardContent className="pt-6">
          <HeatmapChart positions={pf.positions} />
        </CardContent>
      </Card>
    </>
  );
}
