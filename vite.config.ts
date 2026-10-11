import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Tauri expects a fixed dev port and must show Rust errors in the terminal.
// Rust sources and build output are not watched: files locked by the running app
// (e.g. target/debug/*.pdb) break the watcher and leave stale modules in the browser.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/core/**",
        "**/target/**",
        "**/docs/**",
        "**/.superpowers/**",
      ],
    },
  },
  build: { target: "es2022" },
  test: { environment: "node" },
});
