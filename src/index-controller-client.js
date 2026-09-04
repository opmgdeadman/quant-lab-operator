import baseWorker from "./index.js";

const MCP_PATH = "/api/operator/mcp";

function rewriteControllerMcpRequest(request, env) {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== MCP_PATH) return null;

  const controllerToken = String(env?.MCP_CONTROLLER_BEARER_TOKEN || "");
  const authorization = request.headers.get("authorization") || "";
  if (!controllerToken || authorization !== `Bearer ${controllerToken}`) return null;

  const internalToken = String(env?.INTERNAL_API_TOKEN || "");
  if (!internalToken) throw new Error("INTERNAL_API_TOKEN missing for Controller bridge");

  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${internalToken}`);
  headers.set("x-mcp-controller-bridge", "quant-lab-v1");
  return new Request(request, { headers });
}

export default {
  async fetch(request, env, ctx) {
    const rewritten = rewriteControllerMcpRequest(request, env);
    return baseWorker.fetch(rewritten || request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === "function") return baseWorker.scheduled(controller, env, ctx);
  },
};

export const MCP_CONTROLLER_CLIENT_BRIDGE = "quant-lab-v1";
