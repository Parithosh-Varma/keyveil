import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Multi-page build: / (landing) and /terminal.html (terminal app).
// The Google OAuth callback lands on /terminal.html?login=ok.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html",
        terminal: "terminal.html",
      },
    },
  },
});
