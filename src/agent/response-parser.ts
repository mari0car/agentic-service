// ─── Parse the agent's final text output into an HTTP response ───────────────

export type AgentResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

/**
 * Parse agent text output → HTTP response.
 *
 * The agent is instructed to end its output with a JSON object like:
 *   {"status": 200, "headers": {}, "body": {...}}
 *
 * We search for the last valid JSON object in the text that has a "status" field.
 */
export function parseAgentResponse(text: string): AgentResponse {
  if (!text || text.trim().length === 0) {
    return { status: 500, headers: {}, body: { error: { code: "empty_response", message: "Agent produced no response" } } };
  }

  // Strategy 1: find a fenced JSON block at the end
  const fencedMatch = text.match(/```(?:json)?\s*\n(\{[\s\S]*?\})\s*\n```\s*$/);
  if (fencedMatch) {
    const parsed = tryParseResponse(fencedMatch[1]!);
    if (parsed) return parsed;
  }

  // Strategy 2: find the last { ... } block in the text
  const jsonMatches = [...text.matchAll(/\{[\s\S]*?\}/g)];
  for (let i = jsonMatches.length - 1; i >= 0; i--) {
    const match = jsonMatches[i]!;
    const parsed = tryParseResponse(match[0]);
    if (parsed) return parsed;
  }

  // Strategy 3: the entire text might be JSON
  const parsed = tryParseResponse(text.trim());
  if (parsed) return parsed;

  // Fallback: wrap as a 500
  return {
    status: 500,
    headers: {},
    body: {
      error: {
        code: "agent_parse_error",
        message: "Agent response could not be parsed",
      },
    },
  };
}

function tryParseResponse(text: string): AgentResponse | null {
  try {
    const obj = JSON.parse(text);
    if (typeof obj !== "object" || obj === null) return null;
    if (!("status" in obj)) return null;

    const status = typeof obj.status === "number" ? obj.status : 200;
    const headers: Record<string, string> =
      obj.headers && typeof obj.headers === "object" ? obj.headers : {};
    const body = "body" in obj ? obj.body : obj;

    return { status, headers, body };
  } catch {
    return null;
  }
}
