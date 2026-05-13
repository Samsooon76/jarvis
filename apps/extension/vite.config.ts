import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "jarvis-extension-manifest",
      closeBundle() {
        const manifestPath = resolve(__dirname, "manifest.json");
        const distDir = resolve(__dirname, "dist");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
          background?: { service_worker?: string; type?: string };
          content_scripts?: Array<{ js?: string[] }>;
        };

        if (manifest.background) {
          manifest.background.service_worker = "background.js";
        }

        manifest.host_permissions = [
          "https://*.hubspot.com/*",
          "https://jarvisapi-production-10cd.up.railway.app/*",
          "http://localhost:4000/*",
        ];

        if (manifest.content_scripts) {
          manifest.content_scripts = manifest.content_scripts.map((contentScript) => ({
            ...contentScript,
            matches: ["https://*.hubspot.com/*"],
            js: ["content-script.js"],
          }));
        }

        mkdirSync(distDir, { recursive: true });
        writeFileSync(resolve(distDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      },
    },
  ],
  server: {
    port: 4174,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "index.html"),
        background: resolve(__dirname, "src/background.ts"),
        "content-script": resolve(__dirname, "src/content-script.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background" || chunkInfo.name === "content-script") {
            return "[name].js";
          }

          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
