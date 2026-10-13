import {
  access,
  mkdir,
  readFile,
  writeFile,
  appendFile,
  rm,
} from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import path from "node:path";
const root = process.cwd();
const data = path.join(root, ".cache", "pgdata");
const bin =
  process.env.POSTGRES_BIN ?? "C:\\Program Files\\PostgreSQL\\18\\bin";
const run = (command, args, env = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(path.join(bin, command + ".exe"), args, {
      windowsHide: true,
      env: { ...process.env, ...env },
      stdio: command === "pg_ctl" ? "ignore" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${command} failed (${code}): ${stderr}`)),
    );
  });
await mkdir(path.join(root, ".cache"), { recursive: true });
let envText = await readFile(path.join(root, ".env.local"), "utf8").catch(
  () => "",
);
let dbURL = /^DATABASE_URL=(.+)$/m.exec(envText)?.[1]?.trim();
const initialized = await access(path.join(data, "PG_VERSION"))
  .then(() => true)
  .catch(() => false);
if (!initialized) {
  const password = randomBytes(24).toString("hex");
  const pwfile = path.join(root, ".cache", "pgpassword");
  await writeFile(pwfile, password);
  try {
    await run("initdb", [
      "-D",
      data,
      "-U",
      "powerforge",
      "-A",
      "scram-sha-256",
      "--encoding=UTF8",
      `--pwfile=${pwfile}`,
    ]);
  } finally {
    await rm(pwfile, { force: true });
  }
  dbURL = `postgresql://powerforge:${password}@127.0.0.1:55432/mp_optimizer`;
  await appendFile(path.join(root, ".env.local"), `\nDATABASE_URL=${dbURL}\n`);
}
if (!dbURL)
  throw new Error(
    "Existing local cluster has no DATABASE_URL in .env.local. Restore its connection configuration.",
  );
const url = new URL(dbURL);
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55432" ||
  url.username !== "powerforge"
)
  throw new Error(
    "Local helper is restricted to the workspace cluster on 127.0.0.1:55432.",
  );
const running = await run("pg_ctl", ["status", "-D", data])
  .then(() => true)
  .catch(() => false);
if (process.argv.includes("--stop")) {
  if (running) await run("pg_ctl", ["stop", "-D", data, "-m", "fast"]);
  console.log("Workspace PostgreSQL stopped.");
  process.exit(0);
}
if (!running)
  await run("pg_ctl", [
    "start",
    "-D",
    data,
    "-l",
    path.join(root, ".cache", "postgres.log"),
    "-o",
    "-h 127.0.0.1 -p 55432",
  ]);
const auth = { PGPASSWORD: decodeURIComponent(url.password) };
const exists = await run(
  "psql",
  [
    "-h",
    "127.0.0.1",
    "-p",
    "55432",
    "-U",
    "powerforge",
    "-d",
    "postgres",
    "-tAc",
    "SELECT 1 FROM pg_database WHERE datname = 'mp_optimizer'",
  ],
  auth,
);
if (exists.stdout.trim() !== "1")
  await run(
    "createdb",
    ["-h", "127.0.0.1", "-p", "55432", "-U", "powerforge", "mp_optimizer"],
    auth,
  );
await promisify(execFile)(
  process.execPath,
  [
    path.join(root, "node_modules", "prisma", "build", "index.js"),
    "db",
    "push",
  ],
  { windowsHide: true, env: { ...process.env, DATABASE_URL: dbURL } },
);
console.log(
  "Workspace PostgreSQL ready on 127.0.0.1:55432; Prisma schema applied. Credentials remain in ignored .env.local.",
);
