import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const outfile = "vendor/wa-store-migrate.bundle.js";

await build({
  entryPoints: ["vendor/wa-store-migrate-entry.mjs"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "WAStoreMigrate",
  inject: ["vendor/buffer-shim.mjs"],
  alias: {
    "node:crypto": "./vendor/node-crypto-browser-shim.mjs",
    "node:util": "./vendor/node-util-browser-shim.mjs"
  },
  minify: true,
  outfile
});

// The upstream bundle may keep a dynamic require fallback that is not valid in MV3.
let source = await readFile(outfile, "utf8");
source = source
  .replace('eval("quire".replace(/^/, "re"))(moduleName)', "null")
  .replace('eval("quire".replace(/^/,"re"))(moduleName)', "null");
await writeFile(outfile, source);
