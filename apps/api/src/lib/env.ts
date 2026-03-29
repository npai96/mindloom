import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const envFilePath = resolve(currentDir, "../../.env");

if (existsSync(envFilePath)) {
  const file = readFileSync(envFilePath, "utf8");
  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const requiredForParadigm = [
  "PARADIGM_API_KEY",
  "PARADIGM_CLIENT_ID",
  "PARADIGM_BASE_URL",
  "PARADIGM_APP_URL",
  "APP_CALLBACK_URL",
] as const;

export type AppEnv = {
  port: number;
  webOrigins: string[];
  paradigmEnabled: boolean;
  paradigmApiKey?: string;
  paradigmClientId?: string;
  paradigmBaseUrl?: string;
  paradigmAppUrl?: string;
  appCallbackUrl?: string;
};

export function getEnv(): AppEnv {
  const port = Number(process.env.PORT ?? 4000);
  const webOrigins = (process.env.WEB_ORIGIN ??
    "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const missingParadigm = requiredForParadigm.some((key) => !process.env[key]);

  return {
    port,
    webOrigins,
    paradigmEnabled: !missingParadigm,
    paradigmApiKey: process.env.PARADIGM_API_KEY,
    paradigmClientId: process.env.PARADIGM_CLIENT_ID,
    paradigmBaseUrl: process.env.PARADIGM_BASE_URL,
    paradigmAppUrl: process.env.PARADIGM_APP_URL,
    appCallbackUrl: process.env.APP_CALLBACK_URL,
  };
}
