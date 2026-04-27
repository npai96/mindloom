import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import type { MediaAsset } from "@actually-learn/shared";

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
