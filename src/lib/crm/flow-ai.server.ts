import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";

export const FLOW_AI_MODEL = "anthropic/claude-sonnet-5";

function runIdFetch() {
  let runId: string | undefined;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (runId && !headers.has("X-Lovable-AIG-Run-ID")) headers.set("X-Lovable-AIG-Run-ID", runId);
    const res = await fetch(input, { ...init, headers });
    runId ??= res.headers.get("X-Lovable-AIG-Run-ID")?.trim() || undefined;
    return res;
  };
}

export async function draftFlowWithClaude(system: string, prompt: string) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw Object.assign(new Error("La IA no está configurada"), { statusCode: 401 });
  const anthropic = createAnthropic({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch(),
  });
  const result = streamText({
    model: anthropic(FLOW_AI_MODEL),
    system,
    messages: [{ role: "user", content: prompt }],
    maxOutputTokens: 16000,
    maxRetries: 0,
  });
  const text = await result.text;
  const finish = await result.finishReason;
  const usage = await result.totalUsage;
  return { text, finish, usage: { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0, total: usage.totalTokens ?? 0 } };
}
