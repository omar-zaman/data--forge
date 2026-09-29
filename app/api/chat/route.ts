/**
 * POST /api/chat – streaming workspace assistant (Google Gemini via the AI SDK)
 *
 * Body: { messages: AssistantUIMessage[], context?: AssistantRequestContext }
 * Features: "Talk to Schema" (proposeSchema tool) and "Explain Errors".
 * Chat history is client-side only; nothing is persisted.
 */

import { createGoogle } from "@ai-sdk/google";
import {
  APICallError,
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { auth } from "@/auth";
import {
  assistantTools,
  type AssistantRequestContext,
  type AssistantUIMessage,
} from "@/lib/ai/assistant-tools";
import { SUPPORTED_TYPES } from "@/lib/engine/tabular-engine";

export const maxDuration = 30;

// Free-tier friendly default; override with GEMINI_MODEL (e.g. "gemini-2.5-flash")
const MODEL_ID = process.env.GEMINI_MODEL || "gemini-flash-latest";

// Only the most recent turns are sent, to stay well inside free-tier token limits
const MAX_MESSAGES = 20;
const MAX_SCHEMA_CONTEXT_CHARS = 12_000;

const BASE_INSTRUCTIONS = `You are the DataForge workspace assistant. DataForge generates synthetic data from user-defined schemas.

You help with two things:
1. Talk to Schema — turn a plain-language description into a schema.
   - ALWAYS call the proposeSchema tool to deliver a schema; never write the schema as text, JSON or a table.
   - Column types must be one of: ${SUPPORTED_TYPES.join(", ")}.
   - Every table has exactly one primary key (usually "id" of type UUID or Integer).
   - Use TABULAR for a single table. Use RELATIONAL when the user describes several related entities; link child tables to parents with "references" pointing at the parent's primary key.
   - Pick realistic null rates (0 for required fields, 5-30 for optional ones) and mark naturally unique fields (email, username, sku) as unique.
   - If the user asks to change the current schema, send the full updated schema.
   - After the tool call, reply with 1-3 short sentences and tell the user to press "Apply to designer" and then "Save Schema".
2. Explain Errors — when given validation, health-check or job errors, explain in plain language what each error means, the most likely cause in the schema, and a concrete fix in the Schema Designer (which setting to change and to what). Group repeated errors. If a fixed schema would help, offer it and call proposeSchema only if the user agrees or asks.

Style: concise Markdown with short bullet lists. Do not invent features DataForge does not have. If a request is unrelated to DataForge, answer briefly.`;

function buildInstructions(context: AssistantRequestContext | undefined): string {
  const schema = context?.schema;
  if (!schema || schema.tables.length === 0) {
    return `${BASE_INSTRUCTIONS}\n\nNo schema is currently open in the Schema Designer.`;
  }
  let json = JSON.stringify(schema);
  if (json.length > MAX_SCHEMA_CONTEXT_CHARS) {
    json = `${json.slice(0, MAX_SCHEMA_CONTEXT_CHARS)}…(truncated)`;
  }
  return `${BASE_INSTRUCTIONS}\n\nThe schema currently open in the Schema Designer (may be unsaved):\n${json}`;
}

/** Turns provider failures into messages a demo user can act on. */
function toFriendlyError(error: unknown): string {
  console.error("[api/chat]", error);
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 429) {
      return "Gemini free-tier rate limit reached. Wait about a minute, then try again.";
    }
    if (error.statusCode === 400 && /api key/i.test(error.message)) {
      return "Gemini rejected GEMINI_API_KEY. Check the key in .env.local and restart the dev server.";
    }
    if (error.statusCode === 401 || error.statusCode === 403) {
      return "Gemini rejected GEMINI_API_KEY. Check the key in .env.local and restart the dev server.";
    }
    if (error.statusCode === 404) {
      return `Gemini model "${MODEL_ID}" was not found. Set GEMINI_MODEL in .env.local to an available model.`;
    }
    if (error.statusCode !== undefined && error.statusCode >= 500) {
      return "Gemini is temporarily unavailable. Please try again shortly.";
    }
  }
  return "The assistant ran into an error. Please try again.";
}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return textResponse("Please sign in to use the assistant.", 401);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return textResponse(
      "The AI assistant is not configured: add GEMINI_API_KEY to .env.local and restart the dev server.",
      503
    );
  }

  let messages: AssistantUIMessage[];
  let context: AssistantRequestContext | undefined;
  try {
    const body = (await req.json()) as {
      messages?: unknown;
      context?: AssistantRequestContext;
    };
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return textResponse("Request must include at least one message.", 400);
    }
    messages = (body.messages as AssistantUIMessage[]).slice(-MAX_MESSAGES);
    // Gemini expects the conversation to open with a user turn
    const firstUser = messages.findIndex((m) => m.role === "user");
    if (firstUser < 0) return textResponse("Request must include a user message.", 400);
    messages = messages.slice(firstUser);
    context = body.context;
  } catch {
    return textResponse("Invalid JSON body.", 400);
  }

  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(messages, {
      tools: assistantTools,
      ignoreIncompleteToolCalls: true,
    });
  } catch {
    return textResponse("Invalid chat messages.", 400);
  }

  const google = createGoogle({ apiKey });

  const result = streamText({
    model: google(MODEL_ID),
    instructions: buildInstructions(context),
    messages: modelMessages,
    tools: assistantTools,
    // Step 1: tool call, step 2: short reply about it
    stopWhen: isStepCount(3),
    abortSignal: req.signal,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools: assistantTools,
      onError: toFriendlyError,
    }),
  });
}
