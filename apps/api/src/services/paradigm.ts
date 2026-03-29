import type {
  ParadigmNodePayload,
  ParadigmRelationshipPayload,
} from "@actually-learn/shared";

import type { AppEnv } from "../lib/env.js";

type RequestOptions = {
  method?: string;
  userId?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

export class ParadigmClient {
  constructor(private readonly env: AppEnv) {}

  get authorizeUrl() {
    if (!this.env.paradigmEnabled) {
      return undefined;
    }
    const url = new URL("/authorize", this.env.paradigmAppUrl);
    url.searchParams.set("client_id", this.env.paradigmClientId!);
    url.searchParams.set("redirect_uri", this.env.appCallbackUrl!);
    return url.toString();
  }

  async getMe(userId: string) {
    return this.request("/third-party/me", { userId });
  }

  async createNode(userId: string, payload: ParadigmNodePayload) {
    return this.request("/nodes", {
      method: "POST",
      userId,
      body: payload,
    });
  }

  async createRelationship(userId: string, payload: ParadigmRelationshipPayload) {
    return this.request("/relationships", {
      method: "POST",
      userId,
      body: payload,
    });
  }

  async sync(userId: string, cursor?: string) {
    return this.request("sync", {
      userId,
      query: {
        cursor,
      },
    });
  }

  async listNodes(
    userId: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ) {
    return this.request("nodes", {
      userId,
      query,
    });
  }

  async listRelationships(
    userId: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ) {
    return this.request("relationships", {
      userId,
      query,
    });
  }

  private async request(path: string, options: RequestOptions) {
    if (!this.env.paradigmEnabled) {
      throw new Error("Paradigm credentials are not configured.");
    }

    const baseUrl = this.env.paradigmBaseUrl!.endsWith("/")
      ? this.env.paradigmBaseUrl!
      : `${this.env.paradigmBaseUrl!}/`;
    const url = new URL(path.replace(/^\/+/, ""), baseUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined) {
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    }
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.env.paradigmApiKey!,
        ...(options.userId ? { "X-User-ID": options.userId } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Paradigm request failed (${response.status}): ${text}`);
    }

    return response.json();
  }
}
