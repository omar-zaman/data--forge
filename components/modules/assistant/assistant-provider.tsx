"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  AssistantRequestContext,
  AssistantUIMessage,
  SchemaProposal,
} from "@/lib/ai/assistant-tools";
import AssistantSheet from "./assistant-sheet";

// ============================================
// Context
// ============================================

/** Registered by the mounted Schema Designer so the assistant can read and replace its draft. */
export interface SchemaTarget {
  getSnapshot: () => AssistantRequestContext["schema"];
  apply: (proposal: SchemaProposal) => void;
}

interface OpenAssistantOptions {
  /** Prefills the input box (user still presses Send). */
  draft?: string;
  /** Sends this message immediately. */
  send?: string;
}

interface AssistantContextValue {
  openAssistant: (options?: OpenAssistantOptions) => void;
  /** Returns an unregister function — call it from an effect cleanup. */
  registerSchemaTarget: (target: SchemaTarget) => () => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) throw new Error("useAssistant must be used inside <AssistantProvider>");
  return value;
}

// ============================================
// Prompt helper for "Explain Errors"
// ============================================

const MAX_ERRORS = 25;
const MAX_ERROR_CHARS = 6_000;

/** Builds the user message that asks the assistant to explain a list of errors. */
export function explainErrorsPrompt(title: string, errors: unknown[]): string {
  let json = JSON.stringify(errors.slice(0, MAX_ERRORS), null, 2);
  if (json.length > MAX_ERROR_CHARS) json = `${json.slice(0, MAX_ERROR_CHARS)}\n…(truncated)`;
  const more =
    errors.length > MAX_ERRORS ? `\n\n(${errors.length - MAX_ERRORS} more not shown)` : "";
  return `Explain these ${title} and tell me how to fix them in the Schema Designer:\n\n\`\`\`json\n${json}\n\`\`\`${more}`;
}

// ============================================
// Provider — owns the ephemeral chat and the global drawer
// ============================================

export default function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const schemaTargetRef = useRef<SchemaTarget | null>(null);
  const [hasSchemaTarget, setHasSchemaTarget] = useState(false);

  const [transport] = useState(
    () => new DefaultChatTransport<AssistantUIMessage>({ api: "/api/chat" })
  );
  const chat = useChat<AssistantUIMessage>({ transport });
  const { status, stop, sendMessage, regenerate, clearError } = chat;
  const isBusy = status === "submitted" || status === "streaming";

  // The current designer draft rides along with every request (read at send time)
  const requestOptions = useCallback(() => {
    const context: AssistantRequestContext = {
      schema: schemaTargetRef.current?.getSnapshot() ?? null,
    };
    return { body: { context } };
  }, []);

  const registerSchemaTarget = useCallback((target: SchemaTarget) => {
    schemaTargetRef.current = target;
    setHasSchemaTarget(true);
    return () => {
      if (schemaTargetRef.current === target) {
        schemaTargetRef.current = null;
        setHasSchemaTarget(false);
      }
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (isBusy) await stop();
      clearError();
      void sendMessage({ text: trimmed }, requestOptions());
    },
    [isBusy, stop, clearError, sendMessage, requestOptions]
  );

  const openAssistant = useCallback(
    (options: OpenAssistantOptions = {}) => {
      setOpen(true);
      if (options.send) {
        void send(options.send);
        return;
      }
      if (options.draft !== undefined) setInput(options.draft);
      // Wait for the drawer to mount before focusing
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    },
    [send]
  );

  const applyProposal = useCallback((proposal: SchemaProposal) => {
    schemaTargetRef.current?.apply(proposal);
  }, []);

  const value = useMemo(
    () => ({ openAssistant, registerSchemaTarget }),
    [openAssistant, registerSchemaTarget]
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}

      {!open && (
        <Button
          onClick={() => openAssistant()}
          className="fixed bottom-6 right-6 z-40 rounded-full shadow-lg"
          aria-label="Open AI assistant"
        >
          <Sparkles />
          AI Assistant
        </Button>
      )}

      <AssistantSheet
        open={open}
        onOpenChange={setOpen}
        messages={chat.messages}
        status={status}
        error={chat.error}
        input={input}
        onInputChange={setInput}
        inputRef={inputRef}
        onSend={(text) => {
          setInput("");
          void send(text);
        }}
        onStop={() => void stop()}
        onRetry={() => {
          clearError();
          void regenerate(requestOptions());
        }}
        onClear={() => {
          void stop();
          chat.setMessages([]);
          clearError();
        }}
        canApplySchema={hasSchemaTarget}
        onApplySchema={applyProposal}
      />
    </AssistantContext.Provider>
  );
}
