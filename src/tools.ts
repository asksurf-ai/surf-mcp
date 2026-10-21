import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildSignInChallenge,
  oauthDiscoverable,
  resolveAuthorization,
  type RequestAuth,
} from "./auth.js";
import { DataApiError, signInRemedy } from "./errors.js";
import type { Profile } from "./profiles.js";
import type { OpenAPISpec, OpenAPIOperation, OpenAPIParameter } from "./spec.js";
import { SURF_OAUTH_SCOPES } from "./wellknown.js";

const DATA_API_BASE_URL =
  process.env.SURF_API_BASE_URL ?? "https://api.asksurf.ai/gateway/v1";

interface ParamInfo {
  name: string;
  type: string;
  required: boolean;
  description: string;
  enumValues?: string[];
  defaultValue?: unknown;
  minimum?: number;
  maximum?: number;
}

interface OperationInfo {
  command: string;
  method: string;
  path: string; // stripped path, e.g. "market/price"
  summary: string;
  /** The endpoint's full description from the spec. */
  description: string;
  params: ParamInfo[];
  hasPathParams: boolean;
  /** Which identifier to pass, when the endpoint documents a choice. */
  lookup?: string;
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
  return Object.entries(schema.properties)
    // Response-only members such as "$schema" are not inputs.
    .filter(([, prop]: [string, any]) => !prop.readOnly)
    .map(([name, prop]: [string, any]) => ({
      name,
      type: prop.type ?? "string",
      required: required.has(name),
      description: prop.description ?? "",
      enumValues: prop.enum,
      defaultValue: prop.default,
      minimum: prop.minimum,
      maximum: prop.maximum,
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
      defaultValue: p.schema?.default,
      minimum: p.schema?.minimum,
      maximum: p.schema?.maximum,
    }));
}

/**
 * Pulls the authored "**Lookup:**" section out of an endpoint description —
 * e.g. "by project UUID (`id`) or token `symbol`".
 *
 * These endpoints accept either of two identifiers, which OpenAPI cannot
 * express: marking either one `required` would be wrong, so both render as
 * optional. An agent then calls with neither and gets a 400. Carrying the
 * sentence through is what tells it which parameter to supply.
 */
export function extractLookup(description?: string): string | undefined {
  if (!description) return undefined;
  const match = description.match(/\*\*Lookup:?\*\*([\s\S]*?)(?=\n\s*\n|\*\*|$)/);
  const captured = match?.[1];
  if (!captured) return undefined;
  const text = captured.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
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
    if (op.lookup) {
      lines.push(`    lookup: ${op.lookup}`);
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
        description: op.description ?? "",
        params,
        hasPathParams: path.includes("{"),
        lookup: extractLookup(op.description),
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

/**
 * Keeps only the commands a profile allows and drops tools left with none.
 * A trimmed tool also loses the spec's tag description, which describes the
 * whole tag (hidden commands included); its command list still describes it.
 */
function applyProfile(groups: TagGroup[], profile?: Profile): TagGroup[] {
  const allowed = profile?.allowedCommands;
  if (!allowed) return groups;

  return groups.flatMap((group) => {
    const commands = new Set(allowed[group.toolName] ?? []);
    const operations = group.operations.filter((op) => commands.has(op.command));
    if (operations.length === 0) return [];
    const trimmed = operations.length < group.operations.length;
    return [{ ...group, operations, description: trimmed ? "" : group.description }];
  });
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

export async function callDataApi(
  method: string,
  path: string,
  params: Record<string, unknown>,
  auth?: RequestAuth
): Promise<unknown> {
  const baseUrl = DATA_API_BASE_URL.endsWith("/")
    ? DATA_API_BASE_URL
    : `${DATA_API_BASE_URL}/`;
  const url = new URL(path.replace(/^\//, ""), baseUrl);
  const headers: Record<string, string> = { accept: "application/json" };
  const authorization = resolveAuthorization(auth?.authorization);

  if (authorization) headers.authorization = authorization;

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
    const apiError =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "object" &&
      result.error !== null
        ? (result.error as { message?: unknown; code?: unknown })
        : undefined;

    throw new DataApiError({
      status: response.status,
      code:
        typeof apiError?.code === "string" ? apiError.code : undefined,
      message:
        typeof apiError?.message === "string" ? apiError.message : raw,
      authenticated: Boolean(authorization),
      callerAuthenticated: Boolean(auth?.authorization?.trim()),
    });
  }

  return result;
}

/** Calls one operation and renders the result or failure as a tool result. */
async function runOperation(
  op: OperationInfo,
  inputParams: Record<string, unknown>,
  auth: RequestAuth | undefined,
  mixedAuth: boolean
) {
  try {
    const { path, remainingParams } = op.hasPathParams
      ? resolvePath(op.path, inputParams)
      : { path: op.path, remainingParams: inputParams };

    const result = await callDataApi(op.method, path, remainingParams, auth);

    return {
      structuredContent:
        result !== null && typeof result === "object" && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : { data: result },
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const remedy = mixedAuth && err instanceof DataApiError ? signInRemedy(err) : null;
    if (remedy) {
      return {
        content: [{ type: "text" as const, text: `Error: ${remedy.description}` }],
        isError: true,
        _meta: {
          "mcp/www_authenticate": [buildSignInChallenge(remedy.error, remedy.description)],
        },
      };
    }
    return {
      content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
      isError: true,
    };
  }
}

/** Zod schema for one spec parameter, carrying its constraints and docs. */
function paramSchema(param: ParamInfo): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  if (param.enumValues && param.enumValues.length > 0) {
    schema = z.enum(param.enumValues.map(String) as [string, ...string[]]);
  } else if (param.type === "integer" || param.type === "number") {
    let num = param.type === "integer" ? z.number().int() : z.number();
    if (typeof param.minimum === "number") num = num.min(param.minimum);
    if (typeof param.maximum === "number") num = num.max(param.maximum);
    schema = num;
  } else if (param.type === "boolean") {
    schema = z.boolean();
  } else if (param.type === "array") {
    schema = z.array(z.any());
  } else if (param.type === "object") {
    schema = z.record(z.string(), z.any());
  } else {
    schema = z.string();
  }

  const description =
    param.defaultValue !== undefined
      ? `${param.description} (default: ${JSON.stringify(param.defaultValue)})`.trim()
      : param.description;
  if (description) schema = schema.describe(description);
  return param.required ? schema : schema.optional();
}

const MAX_OPERATION_DESCRIPTION = 1500;

function buildOperationDescription(group: TagGroup, op: OperationInfo): string {
  const lines = [`${op.summary}. Use this when the user needs ${group.name.toLowerCase()} data from Surf.`];
  const body = op.description.trim();
  if (body && body !== op.summary) {
    lines.push(
      body.length > MAX_OPERATION_DESCRIPTION
        ? `${body.slice(0, MAX_OPERATION_DESCRIPTION - 3)}...`
        : body
    );
  }
  // The Lookup sentence lives in the description already; keep it when the
  // description was cut before it.
  if (op.lookup && !lines.join("\n").includes(op.lookup.slice(0, 40))) {
    lines.push(`Lookup: ${op.lookup}`);
  }
  return lines.join("\n\n");
}

function operationToolName(group: TagGroup, op: OperationInfo): string {
  return `${group.toolName}_${op.command.replace(/-/g, "_")}`;
}

export function registerTools(
  server: McpServer,
  spec: OpenAPISpec,
  auth?: RequestAuth,
  profile?: Profile
): void {
  const groups = applyProfile(parseSpec(spec), profile);
  const mixedAuth = Boolean(profile?.mixedAuth) && oauthDiscoverable();
  const securitySchemes = [
    { type: "noauth" },
    { type: "oauth2", scopes: [...SURF_OAUTH_SCOPES] },
  ];
  // ChatGPT reads the top-level field (added in withSecuritySchemes, since
  // the SDK drops it) and this _meta mirror.
  const authMeta = mixedAuth ? { _meta: { securitySchemes } } : {};
  const registered: string[] = [];

  if (profile?.perOperationTools) {
    for (const group of groups) {
      for (const op of group.operations) {
        const name = operationToolName(group, op);
        server.registerTool(
          name,
          {
            title: op.summary,
            description: buildOperationDescription(group, op),
            inputSchema: Object.fromEntries(op.params.map((p) => [p.name, paramSchema(p)])),
            annotations: {
              readOnlyHint: op.command !== "sql-job-create",
              openWorldHint: false,
              destructiveHint: false,
            },
            ...authMeta,
          },
          async (args: Record<string, unknown>) => runOperation(op, args ?? {}, auth, mixedAuth)
        );
        registered.push(name);
      }
    }
  } else {
    for (const group of groups) {
      const commandNames = group.operations.map((o) => o.command);

      server.registerTool(
        group.toolName,
        {
          title: `Surf ${group.name}`,
          description: buildDescription(group),
          inputSchema: {
            command: z.enum(commandNames as [string, ...string[]]),
            params: z.record(z.string(), z.any()).optional(),
          },
          annotations: {
            readOnlyHint: isReadOnlyGroup(group),
            openWorldHint: false,
            destructiveHint: false,
          },
          ...authMeta,
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
          return runOperation(op, params ?? {}, auth, mixedAuth);
        }
      );
      registered.push(group.toolName);
    }
  }

  if (mixedAuth) withSecuritySchemes(server, securitySchemes);

  const message = `[surf-mcp] Registered ${registered.length} tools: ${registered.join(", ")}`;

  // stdout is reserved for the MCP protocol in stdio mode. Hosted HTTP
  // runtimes can use stdout so routine startup messages are not reported as
  // production errors.
  if (process.env.VERCEL || process.env.SURF_MCP_TRANSPORT === "http") {
    console.info(message);
  } else {
    console.error(message);
  }
}

/**
 * Copies each tool's _meta.securitySchemes to the top-level `securitySchemes`
 * field of tools/list, where ChatGPT documents it. McpServer builds tool
 * descriptors from a fixed set of fields, so this wraps its tools/list handler.
 */
function withSecuritySchemes(server: McpServer, securitySchemes: unknown[]): void {
  const handlers = (server.server as unknown as {
    _requestHandlers?: Map<string, (...args: unknown[]) => unknown>;
  })._requestHandlers;
  const listTools = handlers?.get("tools/list");
  if (!handlers || !listTools) return;

  handlers.set("tools/list", async (...args: unknown[]) => {
    const result = (await listTools(...args)) as { tools: Record<string, unknown>[] };
    return {
      ...result,
      tools: result.tools.map((tool) => ({ ...tool, securitySchemes })),
    };
  });
}
