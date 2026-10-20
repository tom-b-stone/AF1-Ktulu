import { NextRequest, NextResponse } from "next/server";
import { resolveConnectorToken } from "@/lib/connectorTokens";
import { TOOLS, findTool } from "@/lib/mcpTools";
import { accessFor } from "@/lib/auth";
import { canUseMcpTool } from "@/lib/toolAccess";

// The "AF1 Tools" connector: a minimal MCP server over Streamable HTTP
// (JSON-RPC 2.0 over POST), stateless, authenticated by the per-user token
// in the path (minted on /connector). Hand-rolled on purpose — it only needs
// initialize / tools/list / tools/call, and keeping it dependency-free
// means nothing to keep in step with SDK releases.
//
// claude.ai: Settings → Connectors → Add custom connector → paste the URL.

export const dynamic = "force-dynamic";

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

function rpcResult(id: RpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id: RpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handle(req: RpcRequest, actor: string): Promise<unknown | undefined> {
  const { method, params = {} } = req;

  // Notifications carry no id and get no response body.
  if (method.startsWith("notifications/")) return undefined;

  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = SUPPORTED_VERSIONS.includes(asked) ? asked : "2025-03-26";
      return rpcResult(req.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "af1-tools", version: "1.0.0" },
        instructions:
          "Tools for audif1.com internal work. seo_publish writes SEO meta for a news article or page and publishes it with the publication date preserved; validate-first, never force unless the user says so.",
      });
    }
    case "ping":
      return rpcResult(req.id, {});
    case "tools/list": {
      const acc = await accessFor(actor);
      return rpcResult(req.id, {
        tools: TOOLS.filter((t) => canUseMcpTool(acc.role, t.name, acc.tools)).map(({ name, description, inputSchema, annotations }) => ({
          name,
          description,
          inputSchema,
          ...(annotations ? { annotations } : {}),
        })),
      });
    }
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = findTool(name);
      if (!tool) return rpcError(req.id, -32602, `Unknown tool: ${name}`);
      const acc = await accessFor(actor);
      if (!canUseMcpTool(acc.role, name, acc.tools)) return rpcError(req.id, -32602, `${name} is part of a tool that is still in development.`);
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        return rpcResult(req.id, await tool.run(args, actor));
      } catch (err) {
        return rpcResult(req.id, {
          content: [{ type: "text", text: err instanceof Error ? err.message : "Tool failed" }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(req.id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const record = await resolveConnectorToken(params.token);
  if (!record) return NextResponse.json({ error: "invalid connector token" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  // Batches were allowed up to protocol 2025-03-26; answer them too.
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((r) => handle(r as RpcRequest, record.email)))).filter(Boolean);
    return out.length ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
  }
  const res = await handle(body as RpcRequest, record.email);
  return res ? NextResponse.json(res) : new NextResponse(null, { status: 202 });
}

// Stateless server: no SSE stream to open, nothing to tear down.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
export async function DELETE() {
  return new NextResponse(null, { status: 200 });
}
