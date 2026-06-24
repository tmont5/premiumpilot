import { PageHeader } from "@/components/page-header";
import { AccountsView } from "@/components/accounts-view";
import { getPortfolio } from "@/lib/data";

export default async function AccountsPage() {
  const pf = await getPortfolio();

  return (
    <>
      <PageHeader
        title="Connected Accounts"
        description="Manage your Schwab connections and combined-view settings."
      />
      <AccountsView accounts={pf.accounts} balances={pf.balances} connectUrl="/api/schwab/connect" />
    </>
  );
}
