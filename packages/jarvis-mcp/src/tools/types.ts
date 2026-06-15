import type { z } from "zod";
import type { JarvisApiClient } from "../client/jarvis-api.js";

export type JarvisToolContext = {
  client: JarvisApiClient;
};

export type JarvisToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

export type JarvisToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (input: Record<string, unknown>, context: JarvisToolContext) => Promise<JarvisToolResult>;
};