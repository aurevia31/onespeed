import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marketplaceDirectory = path.resolve(appDirectory, "..");
const publicDirectory = path.join(appDirectory, "public");
loadEnvConfig(appDirectory, process.argv.includes("--development"));
const rootFiles = await readdir(marketplaceDirectory, { withFileTypes: true });

await mkdir(publicDirectory, { recursive: true });
await rm(path.join(publicDirectory, "admin"), { recursive: true, force: true });

for (const entry of rootFiles) {
  if (entry.isFile() && entry.name.endsWith(".html")) {
    await cp(path.join(marketplaceDirectory, entry.name), path.join(publicDirectory, entry.name));
  }
}

for (const directory of ["assets", "css", "js"]) {
  const source = path.join(marketplaceDirectory, directory);
  const target = path.join(publicDirectory, directory);
  await rm(target, { recursive: true, force: true });
  await cp(source, target, {
    recursive: true,
    filter: (sourcePath) => !/(^|\/)(?:\.env(?:\..*)?|node_modules|tests|\.git)(?:\/|$)/.test(sourcePath),
  });
}

const supabaseUrl = process.env.ONESPEED_SUPABASE_URL
  || process.env.SUPABASE_URL
  || process.env.NEXT_PUBLIC_SUPABASE_URL
  || "";
const supabaseKey = process.env.ONESPEED_SUPABASE_ANON_KEY
  || process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || "";

if (Boolean(supabaseUrl) !== Boolean(supabaseKey)) {
  throw new Error("Set both the Supabase project URL and public anon/publishable key.");
}

if (supabaseUrl) {
  const parsedUrl = new URL(supabaseUrl);
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
    throw new Error("The Supabase URL must be HTTPS and must not contain credentials.");
  }
  if (supabaseKey.startsWith("sb_secret_")) {
    throw new Error("A Supabase secret key cannot be used in browser configuration.");
  }
  const jwtParts = supabaseKey.split(".");
  if (jwtParts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(jwtParts[1], "base64url").toString("utf8"));
      if (payload.role === "service_role") {
        throw new Error("A Supabase service-role key cannot be used in browser configuration.");
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("The Supabase public key is malformed.");
      }
      throw error;
    }
  }
}

await writeFile(
  path.join(publicDirectory, "js", "supabase-config.js"),
  `/* Public browser configuration generated for the existing Supabase bridge. */\nwindow.ONESPEED_SUPABASE_CONFIG = ${JSON.stringify({ url: supabaseUrl, anonKey: supabaseKey })};\n`,
  { mode: 0o644 },
);

console.log("OneSpeed legacy HTML routes and public assets synced to Next.js public/.");
