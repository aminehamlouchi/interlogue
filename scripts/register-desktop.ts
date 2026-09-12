/**
 * Register (or refresh) the interlogue entry in Claude Desktop's config on macOS.
 *
 * Claude Desktop rewrites claude_desktop_config.json from memory while it is
 * running, which can drop an entry added by hand. Quit Claude Desktop fully,
 * run `npm run register-desktop`, then relaunch it. Only the "interlogue" key
 * is touched; every other entry is preserved. A timestamped backup is written
 * next to the config first. Nothing here reads the env file; it only points
 * Claude Desktop at its path so the server loads it with --env-file.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");
const SERVER = path.join(PACKAGE_ROOT, "dist", "src", "index.js");
const ENV_FILE = path.join(PACKAGE_ROOT, ".env");
const CONFIG =
  process.env.CLAUDE_DESKTOP_CONFIG ?? path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");

interface Config {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

function main(): void {
  if (!existsSync(SERVER)) {
    console.log(`Build first: ${SERVER} does not exist (run npm run build).`);
    process.exit(1);
  }
  let config: Config = {};
  if (existsSync(CONFIG)) {
    config = JSON.parse(readFileSync(CONFIG, "utf8")) as Config;
    const backup = `${CONFIG}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(CONFIG, backup);
    console.log(`Backup: ${backup}`);
  } else {
    mkdirSync(path.dirname(CONFIG), { recursive: true });
  }
  const args = existsSync(ENV_FILE) ? [`--env-file=${ENV_FILE}`, SERVER] : [SERVER];
  config.mcpServers = { ...(config.mcpServers ?? {}), interlogue: { command: process.execPath, args } };
  writeFileSync(CONFIG, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.log(`Registered "interlogue" in ${CONFIG}`);
  console.log(`  command: ${process.execPath}`);
  console.log(`  args: ${JSON.stringify(args)}`);
  console.log(existsSync(ENV_FILE) ? "  phone path: enabled (env file found, loaded by Node, never read here)" : "  phone path: text-only (no env file)");
  console.log("Other entries preserved:", Object.keys(config.mcpServers).filter((k) => k !== "interlogue").join(", ") || "(none)");
  console.log("Now launch Claude Desktop; the interlogue tools appear under the tools menu.");
}

main();
