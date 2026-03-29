import { randomUUID } from "node:crypto";

import cors from "cors";
import express from "express";

import { getEnv } from "./lib/env.js";
import { parseCookies } from "./lib/http.js";
import { appRouter } from "./routes/app.js";
import { store } from "./services/store.js";

const env = getEnv();
const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.webOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  }),
);
app.use(express.json());

app.use((req, res, next) => {
  const cookies = parseCookies(req);
  const existingSessionId = cookies.actually_learn_session;
  const sessionId = existingSessionId ?? randomUUID();
  req.sessionId = sessionId;

  if (!existingSessionId) {
    store.createSession(sessionId);
    res.setHeader(
      "Set-Cookie",
      `actually_learn_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`,
    );
  }

  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, paradigmEnabled: env.paradigmEnabled });
});

app.use("/api", appRouter);

app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);
});

declare global {
  namespace Express {
    interface Request {
      sessionId?: string;
    }
  }
}
