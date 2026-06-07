import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

function resolve(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

// Theme toggle: light / dark / follow-system. Persisted in localStorage and
// applied as data-theme on <html> so the CSS variables flip.
export function useTheme(): { theme: Theme; cycle: () => void } {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("rd-theme") as Theme) ?? "system",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolve(theme));
    localStorage.setItem("rd-theme", theme);
  }, [theme]);

  // Re-apply when the OS theme changes while on "system".
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () =>
      document.documentElement.setAttribute("data-theme", resolve("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const cycle = () =>
    setTheme((t) =>
      t === "light" ? "dark" : t === "dark" ? "system" : "light",
    );

  return { theme, cycle };
}
