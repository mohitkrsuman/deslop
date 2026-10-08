import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { InviteForm } from "@/components/invite-form";
import { ThemeControl } from "@/components/theme-control";
import type { Theme } from "@/lib/theme";

export function Shell({
  children,
  theme,
  fillViewport = false,
}: {
  children: ReactNode;
  theme: Theme;
  fillViewport?: boolean;
}) {
  return (
    <div className={`flex flex-col bg-background text-sm ${fillViewport ? "h-dvh min-h-0 overflow-hidden" : "min-h-full flex-1"}`}>
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface px-3 py-2">
        <span className="text-xs font-medium tracking-tight">DeSlop</span>
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/"
          afterCreateOrganizationUrl="/"
        />
        <InviteForm />
        <div className="ml-auto flex items-center gap-3">
          <ThemeControl theme={theme} />
          <UserButton />
        </div>
      </header>
      <main className={fillViewport ? "min-h-0 flex-1 overflow-auto" : "flex-1"}>{children}</main>
    </div>
  );
}
