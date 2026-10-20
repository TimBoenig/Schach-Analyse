import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png", "pieces/*.svg", "badges/*.svg"],
      manifest: {
        name: "Schach Analyse",
        short_name: "Schach",
        description: "Partien analysieren, Stärken und Schwächen erkennen, gezielt trainieren – offline auf dem Gerät.",
        lang: "de",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#121418",
        theme_color: "#121418",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Engine (~7 MB) and opening book must be available offline.
        globPatterns: ["**/*.{js,css,html,svg,png,json,wasm,txt}"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: "/index.html",
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
