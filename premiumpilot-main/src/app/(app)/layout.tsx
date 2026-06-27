import Link from "next/link";
import { Compass, LogOut } from "lucide-react";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { RefreshButton } from "@/components/refresh-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isDemoMode } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const demo = isDemoMode();
  const supabase = await createClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  if (!demo && !user) redirect("/login");

  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card/40 md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-5">
          <Compass className="size-5 text-primary" />
          <span className="font-semibold tracking-tight">PremiumPilot</span>
        </div>
        <Sidebar />
        <div className="mt-auto p-4 text-[11px] leading-relaxed text-muted-foreground">
          Informational analytics only. Not investment advice.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b bg-card/40 px-5">
          <Link href="/dashboard" className="flex items-center gap-2 md:hidden">
            <Compass className="size-5 text-primary" />
            <span className="font-semibold">PremiumPilot</span>
          </Link>
          <div className="ml-auto flex items-center gap-3">
            {demo && <Badge variant="warning">Demo data</Badge>}
            <RefreshButton />
            {user?.email && <span className="text-sm text-muted-foreground">{user.email}</span>}
            {!demo && (
              <form action="/auth/logout" method="post">
                <Button type="submit" variant="outline" size="sm">
                  <LogOut className="size-4" />
                  Sign out
                </Button>
              </form>
            )}
          </div>
        </header>
        <main className="flex-1 p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}
