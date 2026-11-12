import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

import { BRAND } from "./src/brand";

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png", "icons/*.svg", "pieces/*.svg", "badges/*.svg"],
      manifest: {
        name: BRAND,
        short_name: BRAND,
        description: "Partien analysieren, Stärken und Schwächen erkennen, gezielt trainieren – offline auf dem Gerät.",
        lang: "de",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#0a0b0d",
        theme_color: "#0a0b0d",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Engine (~7 MB) and opening book must be available offline.
        globPatterns: ["**/*.{js,css,html,svg,png,json,wasm,txt,woff2}"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: "/index.html",
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely: separate chunks stay cached across app updates
        // and keep the main bundle small.
        manualChunks: {
          supabase: ["@supabase/supabase-js"],
          chess: ["chess.js", "@lichess-org/chessground"],
          preact: ["preact", "preact/hooks"],
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
