import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import type { MediaAsset, MediaAssetAnalysis } from "@actually-learn/shared";
import type { AppEnv } from "../lib/env.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
export const mediaAssetsDir = resolve(currentDir, "../../data/media-assets");

const mimeExtensions: Record<MediaAsset["mimeType"], string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const allowedMimeTypes = new Set<MediaAsset["mimeType"]>([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function persistImageAsset(input: {
  dataUrl: string;
  originalFilename?: string;
  altText?: string;
  apiOrigin: string;
}): MediaAsset {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([a-z0-9+/=]+)$/i.exec(
    input.dataUrl,
  );
  if (!match) {
    throw new Error("Unsupported image upload. Use JPEG, PNG, WebP, or GIF.");
  }

  const mimeType = match[1].toLowerCase() as MediaAsset["mimeType"];
  if (!allowedMimeTypes.has(mimeType)) {
    throw new Error("Unsupported image type.");
  }

  const bytes = Buffer.from(match[2], "base64");
  const maxBytes = 8 * 1024 * 1024;
  if (bytes.byteLength > maxBytes) {
    throw new Error("Image uploads are limited to 8MB for now.");
  }

  mkdirSync(mediaAssetsDir, { recursive: true });
  const id = randomUUID();
  const extension = mimeExtensions[mimeType];
  const safeStem =
    input.originalFilename
      ?.replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 48) || "image";
  const filename = `${id}-${safeStem}.${extension}`;
  writeFileSync(resolve(mediaAssetsDir, filename), bytes);

  return {
    id,
    kind: "image",
    filename,
    mimeType,
    byteSize: bytes.byteLength,
    url: `${input.apiOrigin}/media-assets/${filename}`,
    altText: input.altText?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
}

export async function analyzeImageAsset(
  asset: MediaAsset,
  context: {
    title?: string;
    notes?: string;
    reflection?: string;
  } = {},
  options: Pick<AppEnv, "openaiApiKey" | "openaiImageModel"> = {
    openaiImageModel: "gpt-4.1-mini",
  },
): Promise<MediaAssetAnalysis> {
  if (!options.openaiApiKey) {
    return {
      status: "failed",
      provider: "local",
      error:
        "Image understanding is not configured. Add OPENAI_API_KEY to enable real image recognition.",
      analyzedAt: new Date().toISOString(),
    };
  }

  try {
    return await analyzeImageAssetWithOpenAI(asset, context, {
      apiKey: options.openaiApiKey,
      model: options.openaiImageModel,
    });
  } catch (error) {
    return {
      status: "failed",
      provider: "openai",
      model: options.openaiImageModel,
      error: error instanceof Error ? error.message : "OpenAI image analysis failed.",
      analyzedAt: new Date().toISOString(),
    };
  }
}

async function analyzeImageAssetWithOpenAI(
  asset: MediaAsset,
  context: {
    title?: string;
    notes?: string;
    reflection?: string;
  },
  options: {
    apiKey: string;
    model: string;
  },
): Promise<MediaAssetAnalysis> {
  const imageBytes = readFileSync(resolve(mediaAssetsDir, asset.filename));
  const imageUrl = `data:${asset.mimeType};base64,${imageBytes.toString("base64")}`;
  const prompt = [
    "Analyze this saved image for a reflective learning app.",
    "Return only valid JSON with these keys:",
    "summary: one concise sentence describing the image and why it might matter.",
    "detectedText: text visible in the image, or an empty string.",
    "visualElements: 3-6 short concrete visual observations.",
    "suggestedConcepts: 3-6 durable themes that could connect this image to other saved entries.",
    "",
    `User title: ${context.title ?? ""}`,
    `User notes: ${context.notes ?? ""}`,
    `User reflection: ${context.reflection ?? ""}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },
            {
              type: "input_image",
              image_url: imageUrl,
              detail: "auto",
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(formatOpenAIImageAnalysisError(response.status, body));
  }

  const body = (await response.json()) as Record<string, unknown>;
  const text = extractResponseText(body);
  const parsed = parseAnalysisJson(text);

  return {
    status: "complete",
    provider: "openai",
    summary: parsed.summary,
    detectedText: parsed.detectedText,
    visualElements: parsed.visualElements,
    suggestedConcepts: parsed.suggestedConcepts,
    model: options.model,
    analyzedAt: new Date().toISOString(),
  };
}

function extractResponseText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }
  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }
      const text = (contentItem as { text?: unknown }).text;
      if (typeof text === "string") {
        chunks.push(text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function parseAnalysisJson(value: string) {
  const jsonText = value.trim().match(/\{[\s\S]*\}/)?.[0] ?? value.trim();
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  return {
    summary: asString(parsed.summary),
    detectedText: asString(parsed.detectedText),
    visualElements: asStringArray(parsed.visualElements),
    suggestedConcepts: asStringArray(parsed.suggestedConcepts),
  };
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 6)
    : undefined;
}

export function formatOpenAIImageAnalysisError(status: number, body = "") {
  if (status === 401 || status === 403) {
    return "OpenAI image understanding is not authorized. Check that OPENAI_API_KEY is valid for this project.";
  }
  if (status === 429) {
    return "OpenAI image understanding is unavailable because the current project has no remaining quota or billing. Uploading and saving still work.";
  }
  if (status >= 500) {
    return "OpenAI image understanding is temporarily unavailable. Try again later.";
  }
  if (status === 400) {
    return "OpenAI could not analyze this image request. Try a smaller JPEG, PNG, WebP, or GIF.";
  }
  return `OpenAI image understanding failed (${status}). ${summarizeOpenAIError(body)}`;
}

function summarizeOpenAIError(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") {
      return parsed.error.message.slice(0, 160);
    }
  } catch {
    // Fall through to plain text summary.
  }
  return body.slice(0, 160) || "No additional details were returned.";
}
