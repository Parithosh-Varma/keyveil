import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Multi-page build: / (landing) and /dashboard.html (management app).
// The Google OAuth callback lands on /dashboard.html?login=ok.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html",
        dashboard: "dashboard.html",
      },
    },
  },
});
