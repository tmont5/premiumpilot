import { PageHeader } from "@/components/page-header";
import { BotView } from "@/components/bot-view";
import { Disclaimer } from "@/components/disclaimer";
import { getBotState } from "@/lib/bot/data";

export default async function BotPage() {
  const state = await getBotState();

  return (
    <>
      <PageHeader
        title="Auto Trader"
        description="A rules-based bot proposes up to 5 options trades per trading day for your review."
      />
      <BotView state={state} />
      <Disclaimer className="mt-6 text-xs leading-relaxed text-muted-foreground" />
    </>
  );
}
