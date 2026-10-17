// MIT. Check/emit the small app-local navigation recovery module in memory.
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const config = ts.readConfigFile(
  resolve(root, "tsconfig.browser.json"),
  ts.sys.readFile,
);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const output = [];
const emitted = program.emit(undefined, (name, bytes) => {
  if (name.endsWith("/navigation-draft.js")) output.push(bytes);
});
const errors = [
  ...parsed.errors,
  ...ts.getPreEmitDiagnostics(program),
  ...emitted.diagnostics,
];
if (errors.length)
  throw Error(
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (x) => x,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  );
if (output.length !== 1) throw Error("Expected one browser output.");
const path = resolve(root, "public/navigation-draft.js");
const bytes =
  "// Generated from src/browser/navigation-draft.ts. MIT.\n" + output[0];
if (process.argv[2] === "--write") writeFileSync(path, bytes);
else if (readFileSync(path, "utf8") !== bytes)
  throw Error(
    "Stale browser output; run node scripts/browser-assets.mjs --write.",
  );
console.log("Checked navigation draft output matches.");
