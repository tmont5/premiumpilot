import { PageHeader } from "@/components/page-header";
import { AccountsView } from "@/components/accounts-view";
import { getPortfolio } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export default async function AccountsPage() {
  const supabase = await createClient();
  const { data: auth } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const connectUrl =
    supabaseUrl && auth.user
      ? `${supabaseUrl}/functions/v1/schwab-oauth?action=authorize&user_id=${auth.user.id}`
      : null;
  const pf = await getPortfolio();

  return (
    <>
      <PageHeader
        title="Connected Accounts"
        description="Manage your Schwab connections and combined-view settings."
      />
      <AccountsView accounts={pf.accounts} balances={pf.balances} connectUrl={connectUrl} />
    </>
  );
}
