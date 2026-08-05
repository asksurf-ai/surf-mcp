import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenAPISpec, OpenAPIOperation, OpenAPIParameter } from "./spec.js";

const DATA_API_BASE_URL =
  process.env.SURF_API_BASE_URL ?? "https://api.asksurf.ai/gateway/v1";

interface ParamInfo {
  name: string;
  type: string;
  required: boolean;
  description: string;
  enumValues?: string[];
}

interface OperationInfo {
  command: string;
  method: string;
  path: string; // stripped path, e.g. "market/price"
  summary: string;
  params: ParamInfo[];
  hasPathParams: boolean;
}

interface TagGroup {
  name: string;
  description: string;
  toolName: string;
  operations: OperationInfo[];
}

function slugify(tag: string): string {
  return tag.toLowerCase().replace(/ /g, "-");
}

function toolName(tag: string): string {
  return `surf_${tag.toLowerCase().replace(/ /g, "_")}`;
}

function deriveCommand(operationId: string, tagSlug: string): string {
  if (operationId.startsWith(tagSlug + "-")) {
    return operationId.slice(tagSlug.length + 1);
  }
  return operationId;
}

function resolveRef(ref: string, spec: OpenAPISpec): any {
  // "#/components/schemas/Foo" → spec.components.schemas.Foo
  const parts = ref.replace("#/", "").split("/");
  let current: any = spec;
  for (const part of parts) {
    current = current?.[part];
  }
  return current;
}

function extractBodyParams(op: OpenAPIOperation, spec: OpenAPISpec): ParamInfo[] {
  const content = op.requestBody?.content?.["application/json"];
  if (!content?.schema) return [];

  let schema = content.schema;
  if (schema.$ref) {
    schema = resolveRef(schema.$ref, spec);
  }
  if (!schema?.properties) return [];

  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties).map(([name, prop]: [string, any]) => ({
    name,
    type: prop.type ?? "string",
    required: required.has(name),
    description: prop.description ?? "",
    enumValues: prop.enum,
  }));
}

function extractParams(parameters: OpenAPIParameter[]): ParamInfo[] {
  return parameters
    .filter((p) => p.in === "query" || p.in === "path")
    .map((p) => ({
      name: p.name,
      type: p.schema?.type ?? "string",
      required: p.required ?? p.in === "path",
      description: p.description ?? "",
      enumValues: p.schema?.enum,
    }));
}

function buildDescription(group: TagGroup): string {
  const lines: string[] = [
    `Use this when the user needs ${group.name.toLowerCase()} data from Surf.`,
    group.description,
    "",
    "Commands:",
  ];

  for (const op of group.operations) {
    lines.push(`  ${op.command} - ${op.summary}`);
    if (op.params.length > 0) {
      const paramStrs = op.params.map((p) => {
        let s = p.required ? `${p.name}*` : p.name;
        s += ` (${p.type})`;
        if (p.enumValues && p.enumValues.length <= 6) {
          s += ` [${p.enumValues.join(", ")}]`;
        }
        return s;
      });
      lines.push(`    params: ${paramStrs.join(", ")}`);
    }
  }

  return lines.join("\n");
}

function isReadOnlyGroup(group: TagGroup): boolean {
  // Submitting an async SQL job creates server-side state. OpenAI's plugin
  // review guidance requires any tool that can enqueue a job to be marked as
  // non-read-only, even when the job itself only computes a query result.
  return !group.operations.some((operation) => operation.command === "sql-job-create");
}

function parseSpec(spec: OpenAPISpec): TagGroup[] {
  const tagDescriptions = new Map<string, string>();
  for (const tag of spec.tags ?? []) {
    tagDescriptions.set(tag.name, tag.description ?? "");
  }

  const groups = new Map<string, TagGroup>();

  for (const [path, methods] of Object.entries(spec.paths)) {
    // Skip v2 endpoints
    if (path.startsWith("/gateway/v2")) continue;

    for (const [method, op] of Object.entries(methods)) {
      if (!["get", "post"].includes(method)) continue;

      const tag = op.tags?.[0];
      if (!tag) continue;

      const tagSlug = slugify(tag);
      const command = deriveCommand(op.operationId, tagSlug);
      const strippedPath = path.replace(/^\/gateway\/v1\//, "");

      const params = [
        ...extractParams(op.parameters ?? []),
        ...extractBodyParams(op, spec),
      ];

      const operation: OperationInfo = {
        command,
        method: method.toUpperCase(),
        path: strippedPath,
        summary: op.summary ?? op.description ?? op.operationId,
        params,
        hasPathParams: path.includes("{"),
      };

      if (!groups.has(tag)) {
        groups.set(tag, {
          name: tag,
          description: tagDescriptions.get(tag) ?? "",
          toolName: toolName(tag),
          operations: [],
        });
      }
      groups.get(tag)!.operations.push(operation);
    }
  }

  return Array.from(groups.values());
}

function resolvePath(
  pathTemplate: string,
  params: Record<string, unknown>
): { path: string; remainingParams: Record<string, unknown> } {
  const remaining = { ...params };
  const path = pathTemplate.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = remaining[key];
    delete remaining[key];
    return encodeURIComponent(String(value ?? ""));
  });
  return { path, remainingParams: remaining };
}

function appendQueryParam(url: URL, name: string, value: unknown): void {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    for (const item of value) appendQueryParam(url, name, item);
    return;
  }

  url.searchParams.append(
    name,
    typeof value === "object" ? JSON.stringify(value) : String(value)
  );
}

async function callDataApi(
  method: string,
  path: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const baseUrl = DATA_API_BASE_URL.endsWith("/")
    ? DATA_API_BASE_URL
    : `${DATA_API_BASE_URL}/`;
  const url = new URL(path.replace(/^\//, ""), baseUrl);
  const headers: Record<string, string> = { accept: "application/json" };
  const apiKey = process.env.SURF_API_KEY;

  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const init: RequestInit = { method, headers };
  if (method === "POST") {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(params);
  } else {
    for (const [name, value] of Object.entries(params)) {
      appendQueryParam(url, name, value);
    }
  }

  const response = await fetch(url, init);
  const raw = await response.text();
  let result: unknown = raw;

  try {
    result = JSON.parse(raw);
  } catch {
    // Preserve non-JSON upstream responses for a useful error message.
  }

  if (!response.ok) {
    const apiMessage =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "object" &&
      result.error !== null &&
      "message" in result.error
        ? String(result.error.message)
        : raw;
    throw new Error(`Surf API ${response.status}: ${apiMessage}`);
  }

  return result;
}

export function registerTools(server: McpServer, spec: OpenAPISpec): void {
  const groups = parseSpec(spec);

  for (const group of groups) {
    const commandNames = group.operations.map((o) => o.command);
    const description = buildDescription(group);

    server.registerTool(
      group.toolName,
      {
        title: `Surf ${group.name}`,
        description,
        inputSchema: {
          command: z.enum(commandNames as [string, ...string[]]),
          params: z.record(z.string(), z.any()).optional(),
        },
        annotations: {
          readOnlyHint: isReadOnlyGroup(group),
          openWorldHint: false,
          destructiveHint: false,
        },
      },
      async ({ command, params }) => {
        const op = group.operations.find((o) => o.command === command);
        if (!op) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Unknown command: ${command}. Valid: ${commandNames.join(", ")}`,
              },
            ],
            isError: true,
          };
        }

        try {
          const inputParams = params ?? {};
          const { path, remainingParams } = op.hasPathParams
            ? resolvePath(op.path, inputParams)
            : { path: op.path, remainingParams: inputParams };

          const result = await callDataApi(op.method, path, remainingParams);

          return {
            structuredContent:
              result !== null && typeof result === "object" && !Array.isArray(result)
                ? (result as Record<string, unknown>)
                : { data: result },
            content: [
              { type: "text" as const, text: JSON.stringify(result, null, 2) },
            ],
          };
        } catch (err) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${(err as Error).message}` },
            ],
            isError: true,
          };
        }
      }
    );
  }

  const message =
    `[surf-mcp] Registered ${groups.length} tools: ${groups.map((g) => g.toolName).join(", ")}`;

  // stdout is reserved for the MCP protocol in stdio mode. Hosted HTTP
  // runtimes can use stdout so routine startup messages are not reported as
  // production errors.
  if (process.env.VERCEL || process.env.SURF_MCP_TRANSPORT === "http") {
    console.info(message);
  } else {
    console.error(message);
  }
}
