// MIT. Compatibility entry for existing source-maintenance commands.
import { execFileSync } from "node:child_process";
execFileSync(
  process.execPath,
  ["scripts/build-source.mjs", process.argv[2] ?? "--check"],
  { stdio: "inherit" },
);
