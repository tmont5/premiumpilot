import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { getPortfolio } from "@/lib/data";

export default async function SettingsPage() {
  const pf = await getPortfolio();
  return (
    <>
      <PageHeader title="Settings" description="Notification channels and income goal." />
      <SettingsForm profile={pf.profile} />
    </>
  );
}
