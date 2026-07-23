import "dotenv/config";
import { initializeDatabase } from "./storage/supabase.js";
import { getMcpManifest, MCP_HANDLERS } from "./mcp/server-v2.js";
import { handleMCPRequest, getManifest } from "./mcp/handler.js";

// Export everything for external use
export * from "./types/index.js";
export * from "./storage/supabase.js";
export * from "./mcp/server-v2.js";
export * from "./mcp/handler.js";

/**
 * Initialize the MCP server
 */
export async function initializeMCP() {
  try {
    await initializeDatabase();
    console.log("✅ MCP Server initialized");
    return {
      manifest: getMcpManifest(),
      handlers: Object.keys(MCP_HANDLERS),
    };
  } catch (err) {
    console.error("❌ Failed to initialize MCP:", err);
    throw err;
  }
}

console.log("🚀 dev-ron MCP server ready");