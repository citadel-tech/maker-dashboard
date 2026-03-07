import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
      "@components": path.resolve(__dirname, "./app/components"),
      "@routes": path.resolve(__dirname, "./app/routes"),
    },
  },
  build: {
    outDir: "build/client",
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
