// Starts the web app. Needs two secrets (Replit: Tools > Secrets):
//   SESSION_SECRET   at least 32 random characters
//   GEARTRAIN_USERS  JSON array of invited users; hash passwords with
//                    `pnpm --filter @geartrain/web hash-password`
import { serve } from "@hono/node-server";
import { createApp } from "./app.tsx";
import { UserDirectory } from "./auth.ts";
import { createDemoState } from "./state.ts";

function fail(message: string): never {
  console.error(`Geartrain cannot start: ${message}\nSee apps/web/README.md for how to set the sign-in secrets.`);
  process.exit(1);
}

const sessionSecret = process.env.SESSION_SECRET ?? "";
if (sessionSecret.length < 32) fail("SESSION_SECRET must be set to at least 32 random characters.");
let users: UserDirectory;
try {
  users = UserDirectory.fromEnv(process.env.GEARTRAIN_USERS);
} catch (e) {
  fail((e as Error).message);
}
if (users.size === 0) fail("GEARTRAIN_USERS has no users.");

const today = process.env.DEMO_DATE ?? new Date().toISOString().slice(0, 10);
const state = await createDemoState(today);
const port = Number(process.env.PORT ?? 3000);
// Cookies are HTTPS-only unless explicitly running on plain http locally.
const secureCookies = process.env.INSECURE_LOCAL_COOKIES !== "1";
serve({ fetch: createApp(state, { users, sessionSecret, secureCookies }).fetch, port, hostname: "0.0.0.0" }, () =>
  console.log(`Geartrain demo on port ${port} (as of ${today}), ${users.size} invited user(s)`),
);
