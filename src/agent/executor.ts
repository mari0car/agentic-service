import { generateText, type ToolSet, type LanguageModel, tool, stepCountIs } from "ai";
import type { Config } from "../config/schema.js";
import type { ToolRegistry, ResponseState, RouteHandler } from "../tools/registry.js";
import type { RequestContext } from "./prompt-assembler.js";
import { assemblePrompt } from "./prompt-assembler.js";
import { parseAgentResponse, type AgentResponse } from "./response-parser.js";
import type { SpecFile } from "../specs/store.js";
import type { Logger } from "pino";

// ─── LLM provider factory ─────────────────────────────────────────────────────

async function createModel(config: Config): Promise<LanguageModel> {
  const llm = config.llm;

  if (llm.provider === "bedrock") {
    const { createAmazonBedrock } = await import("@ai-sdk/amazon-bedrock");
    const bedrockOptions: Parameters<typeof createAmazonBedrock>[0] = {
      region: llm.bedrock.region,
    };
    if (llm.bedrock.profile) {
      const { fromIni } = await import("@aws-sdk/credential-providers");
      (bedrockOptions as Record<string, unknown>)["credentialProvider"] = fromIni({
        profile: llm.bedrock.profile,
      });
    }
    const bedrock = createAmazonBedrock(bedrockOptions);
    return bedrock(llm.model) as unknown as LanguageModel;
  }

  if (llm.provider === "openai") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const openai = createOpenAI({ apiKey: llm.api_key });
    return openai(llm.model) as unknown as LanguageModel;
  }

  if (llm.provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const anthropic = createAnthropic({ apiKey: llm.api_key });
    return anthropic(llm.model) as unknown as LanguageModel;
  }

  throw new Error(`Unsupported LLM provider: ${llm.provider}`);
}

// ─── Convert our tool registry to Vercel AI SDK v6 tools ─────────────────────

function toAiSdkTools(registry: ToolRegistry): ToolSet {
  const aiTools: ToolSet = {};
  for (const [name, def] of Object.entries(registry.tools)) {
    aiTools[name] = tool({
      description: def.description,
      inputSchema: def.parameters,
      execute: async (params: Record<string, unknown>) => {
        try {
          return await def.execute(params);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }
  return aiTools;
}

// ─── Agent executor ───────────────────────────────────────────────────────────

export type AgentExecutionResult = {
  response: AgentResponse;
  responseState: ResponseState;
  toolCallCount: number;
  tokenUsage: { input: number; output: number };
  durationMs: number;
};

// ─── Handler executor (tool-registry / hot-path bypass) ──────────────────────
//
// Runs a hand-authored (or JIT-compiled) RouteHandler instead of the LLM.
// Returns the same AgentExecutionResult shape so app.ts can treat both
// code-paths identically. toolCallCount is 0 because the handler calls tools
// directly without the LLM intermediary; tokenUsage is 0 for the same reason.

export async function executeHandler(
  handler: RouteHandler,
  requestContext: RequestContext,
  toolRegistry: ToolRegistry,
  responseState: ResponseState,
  logger: Logger
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  try {
    const response = await handler.execute(requestContext, toolRegistry);
    // Merge any headers set via response_set_header tool (in case handler used it)
    response.headers = { ...responseState.headers, ...response.headers };
    return {
      response,
      responseState,
      toolCallCount: 0,
      tokenUsage: { input: 0, output: 0 },
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, "Route handler threw an unexpected error");
    return {
      response: {
        status: 500,
        headers: {},
        body: { error: { code: "handler_error", message: "Internal server error" } },
      },
      responseState,
      toolCallCount: 0,
      tokenUsage: { input: 0, output: 0 },
      durationMs: Date.now() - startTime,
    };
  }
}

export async function executeAgent(
  config: Config,
  routeSpec: SpecFile,
  globalSpecs: SpecFile[],
  requestContext: RequestContext,
  toolRegistry: ToolRegistry,
  responseState: ResponseState,
  logger: Logger
): Promise<AgentExecutionResult> {
  const startTime = Date.now();

  const { system, user } = assemblePrompt(
    routeSpec,
    globalSpecs,
    requestContext,
    toolRegistry.tools
  );

  if (config.logging.log_agent_traces) {
    logger.debug({ system, user }, "Agent prompt assembled");
  }

  const model = await createModel(config);
  const aiTools = toAiSdkTools(toolRegistry);

  let tokenUsage = { input: 0, output: 0 };
  let toolCallCount = 0;

  const maxRetries = config.llm.retry.max_retries;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(
        config.llm.retry.initial_backoff_ms * Math.pow(2, attempt - 1),
        config.llm.retry.max_backoff_ms
      );
      logger.warn({ attempt, backoff }, "Retrying LLM request");
      await new Promise((r) => setTimeout(r, backoff));
    }

    try {
      const result = await generateText({
        model,
        system,
        messages: [{ role: "user", content: user }],
        tools: aiTools,
        stopWhen: stepCountIs(config.llm.max_tool_calls),
        temperature: config.llm.temperature,
        maxOutputTokens: config.llm.max_output_tokens,
      });

      // Count tool calls from steps
      for (const step of result.steps) {
        for (const tc of step.toolCalls ?? []) {
          toolCallCount++;
          if (config.logging.log_tool_calls) {
            logger.debug(
              { toolName: tc.toolName, args: tc.input },
              "Tool call"
            );
          }
        }
        for (const tr of step.toolResults ?? []) {
          if (config.logging.log_tool_calls) {
            logger.debug({ toolCallId: tr.toolCallId, result: tr.output }, "Tool result");
          }
        }
      }

      // Token usage (ai v6: inputTokens / outputTokens)
      if (result.usage) {
        tokenUsage = {
          input: result.usage.inputTokens ?? 0,
          output: result.usage.outputTokens ?? 0,
        };
      }

      // Parse the final text response
      const text = result.text ?? "";
      if (config.logging.log_agent_traces) {
        logger.debug({ text }, "Agent final text");
      }

      const response = parseAgentResponse(text);

      // Merge any headers set via response tools
      response.headers = { ...responseState.headers, ...response.headers };

      const durationMs = Date.now() - startTime;
      return { response, responseState, toolCallCount, tokenUsage, durationMs };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn({ attempt, err: lastError.message }, "LLM request failed");
    }
  }

  logger.error({ err: lastError }, "All LLM retry attempts exhausted");
  return {
    response: {
      status: 503,
      headers: {},
      body: {
        error: {
          code: "llm_unavailable",
          message: "LLM provider unavailable after retries",
        },
      },
    },
    responseState,
    toolCallCount,
    tokenUsage,
    durationMs: Date.now() - startTime,
  };
}
