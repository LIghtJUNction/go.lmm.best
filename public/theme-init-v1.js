(() => {
  try {
    const storedTheme = localStorage.getItem("go-lmm-theme");
    let theme = storedTheme;
    if (theme !== "light" && theme !== "dark") {
      theme = matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    // The light palette remains the safe default when storage is blocked.
  }
})();
