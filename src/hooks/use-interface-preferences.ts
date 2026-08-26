import { useEffect } from "react";

import type { Language } from "@/lib/i18n";
import type { Theme } from "@/lib/session";

export function useInterfacePreferences(
  language: Language,
  theme: Theme,
  title?: string,
): void {
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    localStorage.setItem("go-lmm-language", language);
  }, [language]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    localStorage.setItem("go-lmm-theme", theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#171a17" : "#f4f1e8");
  }, [theme]);

  useEffect(() => {
    if (!title) return;
    const previousTitle = document.title;
    document.title = title;
    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
