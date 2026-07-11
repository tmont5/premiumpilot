import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { getPortfolio } from "@/lib/data";

export default async function SettingsPage() {
  const pf = await getPortfolio();
  return (
    <>
      <PageHeader title="Settings" description="Risk profile, income goal, and notification channels." />
      <SettingsForm profile={pf.profile} />
    </>
  );
}
