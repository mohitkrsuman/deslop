"use client";

import { useState } from "react";
import { setTheme } from "@/app/actions/theme";
import { themeClassName, themes, type Theme } from "@/lib/theme";

const labels: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function ThemeControl({ theme }: { theme: Theme }) {
  const [current, setCurrent] = useState(theme);

  async function choose(next: Theme) {
    setCurrent(next);
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    const className = themeClassName(next);
    if (className) root.classList.add(className);
    await setTheme(next);
  }

  return (
    <div className="flex items-center border border-border">
      {themes.map((option) => {
        const selected = option === current;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => choose(option)}
            className={
              selected
                ? "h-7 px-2 text-xs text-accent"
                : "h-7 px-2 text-xs text-muted"
            }
          >
            {labels[option]}
          </button>
        );
      })}
    </div>
  );
}
