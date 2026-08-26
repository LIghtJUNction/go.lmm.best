import type { Language } from "./i18n";
import type { Theme } from "./session";

export function initialLanguage(): Language {
  const saved = localStorage.getItem("go-lmm-language");
  return saved === "zh" || saved === "en" ? saved : "en";
}

export function initialTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
