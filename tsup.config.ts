import { defineConfig } from "tsup";

export default defineConfig([
  // CLI entry point — gets the shebang banner
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "node22",
    outDir: "dist",
    clean: true,
    dts: false,
    sourcemap: true,
    splitting: false,
    bundle: true,
    external: ["better-sqlite3", "postgres"],
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  // Library entry point — no shebang, types emitted
  {
    entry: ["src/lib.ts"],
    format: ["esm"],
    target: "node22",
    outDir: "dist",
    clean: false,
    dts: true,
    sourcemap: true,
    splitting: false,
    bundle: true,
    external: ["better-sqlite3", "postgres"],
  },
]);
