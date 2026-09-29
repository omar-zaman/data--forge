"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import type { ChatStatus } from "ai";
import {
  CheckCircle2,
  KeyRound,
  Link2,
  Loader2,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { AssistantUIMessage, SchemaProposal } from "@/lib/ai/assistant-tools";

// ============================================
// Markdown — compact styles for chat bubbles
// ============================================

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
  h1: ({ children }) => <p className="mb-2 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="mb-2 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="mb-1 font-semibold">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 max-h-48 overflow-auto rounded-md bg-black/5 p-2 text-xs last:mb-0 dark:bg-white/10">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.85em] dark:bg-white/10">
      {children}
    </code>
  ),
};

function Markdown({ text }: { text: string }) {
  return <ReactMarkdown components={MARKDOWN_COMPONENTS}>{text}</ReactMarkdown>;
}

// ============================================
// Schema proposal card (proposeSchema tool output)
// ============================================

function ProposalCard({
  proposal,
  canApply,
  applied,
  onApply,
}: {
  proposal: SchemaProposal;
  canApply: boolean;
  applied: boolean;
  onApply: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-sm text-[var(--color-card-foreground)]">
      <div className="flex flex-wrap items-center gap-2">
        <Wand2 className="size-4 text-[var(--color-primary)]" />
        <span className="font-mono font-medium">{proposal.schemaName}</span>
        <Badge variant="outline">{proposal.dataType === "RELATIONAL" ? "Relational" : "Tabular"}</Badge>
      </div>
      {proposal.summary && (
        <p className="text-xs text-[var(--color-muted-foreground)]">{proposal.summary}</p>
      )}

      <div className="flex flex-col gap-2">
        {proposal.tables.map((table) => (
          <div key={table.name} className="rounded-md border border-[var(--color-border)]">
            {proposal.dataType === "RELATIONAL" && (
              <div className="border-b border-[var(--color-border)] px-2 py-1 font-mono text-xs font-medium">
                {table.name}
              </div>
            )}
            <ul className="divide-y divide-[var(--color-border)]">
              {table.columns.map((col) => (
                <li key={col.name} className="flex items-center gap-2 px-2 py-1 text-xs">
                  <span className="min-w-0 flex-1 truncate font-mono">{col.name}</span>
                  {col.primaryKey && (
                    <KeyRound className="size-3 text-amber-600" aria-label="Primary key" />
                  )}
                  {col.references && (
                    <span
                      className="flex items-center gap-0.5 text-[var(--color-muted-foreground)]"
                      title={`References ${col.references.table}.${col.references.column}`}
                    >
                      <Link2 className="size-3" />
                      {col.references.table}
                    </span>
                  )}
                  {col.unique && !col.primaryKey && (
                    <span className="text-[var(--color-muted-foreground)]">unique</span>
                  )}
                  {col.nullRate > 0 && (
                    <span className="tabular-nums text-[var(--color-muted-foreground)]">
                      {col.nullRate}% null
                    </span>
                  )}
                  <span className="w-20 shrink-0 text-right text-[var(--color-muted-foreground)]">
                    {col.type}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {proposal.fixes.length > 0 && (
        <details className="text-xs text-[var(--color-muted-foreground)]">
          <summary className="cursor-pointer">
            {proposal.fixes.length} automatic fix{proposal.fixes.length === 1 ? "" : "es"}
          </summary>
          <ul className="ml-4 mt-1 list-disc">
            {proposal.fixes.map((fix, i) => (
              <li key={i}>{fix}</li>
            ))}
          </ul>
        </details>
      )}

      <Button size="sm" onClick={onApply} disabled={!canApply || applied} className="self-start">
        {applied ? <CheckCircle2 /> : <Wand2 />}
        {applied ? "Applied to designer" : "Apply to designer"}
      </Button>
      {!canApply && !applied && (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Open a workspace&apos;s Schema Designer to apply this schema.
        </p>
      )}
    </div>
  );
}

// ============================================
// Messages
// ============================================

function MessageView({
  message,
  canApplySchema,
  appliedIds,
  onApply,
}: {
  message: AssistantUIMessage;
  canApplySchema: boolean;
  appliedIds: Set<string>;
  onApply: (toolCallId: string, proposal: SchemaProposal) => void;
}) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
      {message.parts.map((part, i) => {
        switch (part.type) {
          case "text":
            if (!part.text.trim()) return null;
            return (
              <div
                key={i}
                className={cn(
                  "max-w-[90%] break-words rounded-lg px-3 py-2 text-sm",
                  isUser
                    ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                    : "bg-[var(--color-muted)] text-[var(--color-foreground)]"
                )}
              >
                <Markdown text={part.text} />
              </div>
            );

          case "tool-proposeSchema":
            switch (part.state) {
              case "input-streaming":
              case "input-available":
                return (
                  <div
                    key={part.toolCallId}
                    className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]"
                  >
                    <Loader2 className="size-4 animate-spin" />
                    Designing schema…
                  </div>
                );
              case "output-available":
                return (
                  <div key={part.toolCallId} className="w-full">
                    <ProposalCard
                      proposal={part.output}
                      canApply={canApplySchema}
                      applied={appliedIds.has(part.toolCallId)}
                      onApply={() => onApply(part.toolCallId, part.output)}
                    />
                  </div>
                );
              case "output-error":
                return (
                  <p key={part.toolCallId} className="text-sm text-[var(--color-destructive)]">
                    Could not build the schema: {part.errorText}
                  </p>
                );
              default:
                return null;
            }

          default:
            return null;
        }
      })}
    </div>
  );
}

const SUGGESTIONS = [
  "Design a relational schema for an online store: customers, products, orders and order items.",
  "Create a single employee directory table with name, email, department, salary and hire date.",
  "Review my current schema and suggest improvements.",
];

// ============================================
// AssistantSheet
// ============================================

interface AssistantSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: AssistantUIMessage[];
  status: ChatStatus;
  error: Error | undefined;
  input: string;
  onInputChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onClear: () => void;
  canApplySchema: boolean;
  onApplySchema: (proposal: SchemaProposal) => void;
}

export default function AssistantSheet({
  open,
  onOpenChange,
  messages,
  status,
  error,
  input,
  onInputChange,
  inputRef,
  onSend,
  onStop,
  onRetry,
  onClear,
  canApplySchema,
  onApplySchema,
}: AssistantSheetProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(() => new Set());
  const isBusy = status === "submitted" || status === "streaming";

  // Keep the newest message in view while streaming
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status, error]);

  function handleApply(toolCallId: string, proposal: SchemaProposal) {
    onApplySchema(proposal);
    setAppliedIds((prev) => new Set(prev).add(toolCallId));
  }

  function submit() {
    if (!input.trim() || isBusy) return;
    onSend(input);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="gap-0 p-0 sm:max-w-md"
        // Persistent: stays open while the user works in the designer
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <SheetHeader className="border-b border-[var(--color-border)] p-4">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-[var(--color-primary)]" />
            AI Assistant
          </SheetTitle>
          <SheetDescription>
            Describe a schema to generate it, or ask about validation errors.
          </SheetDescription>
        </SheetHeader>

        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-[var(--color-muted-foreground)]">Try one of these:</p>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSend(s)}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--color-accent)]"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : (
            messages.map((message) => (
              <MessageView
                key={message.id}
                message={message}
                canApplySchema={canApplySchema}
                appliedIds={appliedIds}
                onApply={handleApply}
              />
            ))
          )}

          {status === "submitted" && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
              <Loader2 className="size-4 animate-spin" />
              Thinking…
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-[var(--color-destructive)] bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]"
            >
              <span className="break-words">{error.message || "Something went wrong."}</span>
              <Button variant="outline" size="sm" onClick={onRetry} className="self-start">
                <RotateCcw />
                Retry
              </Button>
            </div>
          )}
        </div>

        <form
          className="flex flex-col gap-2 border-t border-[var(--color-border)] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            placeholder="e.g. A hospital schema with patients, doctors and appointments"
            aria-label="Message the AI assistant"
            className="w-full resize-none rounded-md border border-[var(--color-input)] bg-transparent px-3 py-2 text-sm placeholder:text-[var(--color-muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          />
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onClear();
                setAppliedIds(new Set());
              }}
              disabled={messages.length === 0 && !error}
            >
              <Trash2 />
              Clear chat
            </Button>
            {isBusy ? (
              <Button type="button" variant="outline" size="sm" onClick={onStop}>
                <Square />
                Stop
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!input.trim()}>
                <SendHorizontal />
                Send
              </Button>
            )}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
