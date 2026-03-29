import type { Request, Response } from "express";

export function readJson<T>(req: Request): T {
  return req.body as T;
}

export function sendError(
  res: Response,
  status: number,
  message: string,
  details?: Record<string, unknown>,
) {
  res.status(status).json({
    error: {
      message,
      ...details,
    },
  });
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header.split(";").map((item) => {
      const [key, ...rest] = item.trim().split("=");
      return [key, decodeURIComponent(rest.join("="))];
    }),
  );
}
