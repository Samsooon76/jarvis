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
          host_permissions?: string[];
        };

        if (manifest.background) {
          manifest.background.service_worker = "background.js";
        }

        const sourceHostPermissions = Array.isArray(manifest.host_permissions)
          ? manifest.host_permissions
          : [];
        const requiredHostPermissions = [
          "https://jarvisapi-production-10cd.up.railway.app/*",
          "http://localhost:4000/*",
        ];

        manifest.host_permissions = [...new Set([...sourceHostPermissions, ...requiredHostPermissions])];

        mkdirSync(distDir, { recursive: true });
        writeFileSync(resolve(distDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 4174,
    allowedHosts: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "index.html"),
        background: resolve(__dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background") {
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
