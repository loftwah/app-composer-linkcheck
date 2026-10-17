import {verifySharing} from './verify-sharing.mjs';
import { execFileSync } from "node:child_process";
const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const sha = git(["rev-parse", "HEAD"]);
if (
  git(["status", "--porcelain"]) ||
  git(["branch", "--show-current"]) !== "main" ||
  git(["rev-parse", "origin/main"]) !== sha
)
  throw new Error("Deploy only clean reviewed pushed main.");
for (const args of [
  ["check"],
  ["test"],
  ["build"],
  ["wrangler", "deploy", "--message", "Link Check " + sha],
])
  execFileSync("pnpm", args, { stdio: "inherit" });
for (let attempt = 0; attempt < 12; attempt++) {
  const response = await fetch("https://share.loftwah.com/build.json", {
    cache: "no-store",
  }).catch(() => null);
  const data = response?.ok ? await response.json() : null;
  if (data?.sha === sha) {
    console.log("Verified exact live Link Check source " + sha);
    // Assets can briefly 404 while a new deployment propagates to the edge, so
    // retry the sharing probe instead of failing on a cold edge.
    let sharingVerified = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await verifySharing("https://share.loftwah.com");
        sharingVerified = true;
        break;
      } catch (error) {
        if (attempt === 7) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    if (!sharingVerified) throw new Error("Live sharing card did not converge");
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
throw new Error("Deployed identity did not become visible.");
