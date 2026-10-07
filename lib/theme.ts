export const themeCookie = "theme";

export const themes = ["system", "light", "dark"] as const;

export type Theme = (typeof themes)[number];

// Reads the theme cookie value. Missing or unknown values fall back to system.
export function parseTheme(value: string | undefined): Theme {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

// Turns a theme into the class to put on <html>.
// `light` and `dark` are classes on <html>. System leaves both off so the
// media query can supply the tokens, and an explicit class beats that query.
export function themeClassName(theme: Theme): string {
  if (theme === "system") return "";
  return theme;
}
