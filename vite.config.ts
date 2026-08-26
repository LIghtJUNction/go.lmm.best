import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The host flag keeps the room reachable from a local WebMCP browser session.

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
