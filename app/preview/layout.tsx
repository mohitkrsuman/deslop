import { cookies } from "next/headers";
import { Shell } from "@/components/shell";
import { parseTheme, themeCookie } from "@/lib/theme";

export default async function PreviewLayout({ children }: LayoutProps<"/preview">) {
  const store = await cookies();
  const theme = parseTheme(store.get(themeCookie)?.value);

  return <Shell theme={theme} fillViewport>{children}</Shell>;
}
