import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * API base: dev uses the `/api` proxy (no CORS friction); builds can point at
 * any deployed backend via VITE_API_BASE.
 */
const API_PROXY_TARGET = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Celengan — Detect. Simulate. Execute.",
        short_name: "Celengan",
        description:
          "Agentic personal CFO that detects money leaks, simulates their future impact and executes bounded actions on your behalf.",
        theme_color: "#15563B",
        background_color: "#FAF8F1",
        display: "standalone",
        start_url: "/",
        lang: "en",
        categories: ["finance"],
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2}"],
        navigateFallback: "/index.html",
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
