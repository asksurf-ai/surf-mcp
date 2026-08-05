import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";

const SPEC_URL = "https://api.asksurf.ai/gateway/openapi.json";
const CACHE_DIR =
  process.env.SURF_MCP_CACHE_DIR ??
  (process.env.VERCEL ? join(tmpdir(), "surf-mcp") : join(homedir(), ".cache", "surf-mcp"));
const CACHE_PATH = join(CACHE_DIR, "openapi.json");
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface OpenAPIParameter {
  name: string;
  in: "query" | "path" | "header";
  required?: boolean;
  description?: string;
  schema?: {
    type?: string;
    enum?: string[];
    default?: unknown;
    format?: string;
  };
}

export interface OpenAPIOperation {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: { $ref?: string; properties?: Record<string, any>; required?: string[] } }>;
  };
}

export interface OpenAPISpec {
  info: { title: string; version: string };
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: { schemas?: Record<string, any> };
}

function isCacheFresh(): boolean {
  if (!existsSync(CACHE_PATH)) return false;
  const age = Date.now() - statSync(CACHE_PATH).mtimeMs;
  return age < TTL_MS;
}

async function fetchSpec(): Promise<OpenAPISpec> {
  const res = await fetch(SPEC_URL);
  if (!res.ok) throw new Error(`Failed to fetch spec: ${res.status}`);
  return res.json() as Promise<OpenAPISpec>;
}

export async function loadSpec(): Promise<OpenAPISpec> {
  if (isCacheFresh()) {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  }

  try {
    const spec = await fetchSpec();
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(CACHE_PATH, JSON.stringify(spec));
    } catch (cacheErr) {
      console.error(`[surf-mcp] Could not write spec cache: ${(cacheErr as Error).message}`);
    }
    return spec;
  } catch (err) {
    if (existsSync(CACHE_PATH)) {
      console.error(`[surf-mcp] Using stale cached spec: ${(err as Error).message}`);
      return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
    }
    throw err;
  }
}
