import { PageHeader } from "@/components/page-header";
import { AdvisorView } from "@/components/advisor-view";
import { Disclaimer } from "@/components/disclaimer";

export default function AdvisorPage() {
  return (
    <>
      <PageHeader
        title="Advisor"
        description="AI-assisted analysis of your portfolio — considerations and tradeoffs, not directives."
      />
      <AdvisorView />
      <Disclaimer className="mt-4 text-xs leading-relaxed text-muted-foreground" />
    </>
  );
}
