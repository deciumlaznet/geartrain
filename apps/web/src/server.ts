// Starts the demo web app. On Replit, PORT is set for you.
import { serve } from "@hono/node-server";
import { createApp } from "./app.tsx";
import { createDemoState } from "./state.ts";

const today = process.env.DEMO_DATE ?? new Date().toISOString().slice(0, 10);
const state = await createDemoState(today);
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: createApp(state).fetch, port, hostname: "0.0.0.0" }, () => console.log(`Geartrain demo on http://localhost:${port} (as of ${today})`));
