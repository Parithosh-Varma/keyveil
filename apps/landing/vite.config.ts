import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// KeyVeil landing site -> keyveil Pages project.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
});
