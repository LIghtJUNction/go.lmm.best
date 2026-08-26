import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/newsreader/wght.css";
import "./index.css";
import { shareIdFromPath } from "./lib/share-route";

const App = lazy(() => import("./App"));
const SpectatorApp = lazy(() => import("./SpectatorApp"));

const watchRoute =
  window.location.pathname === "/watch" ||
  window.location.pathname.startsWith("/watch/");
const shareId = shareIdFromPath(window.location.pathname);

const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("Missing application root");

createRoot(root).render(
  <StrictMode>
    <Suspense fallback={<div className="min-h-svh bg-background" />}>
      {watchRoute ? <SpectatorApp shareId={shareId ?? "invalid"} /> : <App />}
    </Suspense>
  </StrictMode>,
);
