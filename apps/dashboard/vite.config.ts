import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// KeyVeil dashboard app -> keyveil-dashboard Pages project.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
});
