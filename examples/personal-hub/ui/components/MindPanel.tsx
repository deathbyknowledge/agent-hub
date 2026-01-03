import { useState, useEffect, useMemo } from "react";
import { cn } from "../lib/utils";
import { ChatView } from "./ChatView";
import type { Message } from "./ChatView";
import type {
  ChatMessage,
  AgentState,
  RunState,
  ToolCall as APIToolCall,
} from "agent-hub/client";

interface MindPanelProps {
  isOpen: boolean;
  onClose: () => void;
  agencyId: string;
  agencyName?: string;
  // Mind agent state (from useAgent hook)
  mindState: AgentState | null;
  runState: RunState | null;
  connected: boolean;
  loading: boolean;
  onSendMessage: (content: string) => Promise<void>;
  onStop: () => Promise<void>;
  // Variant: "agency" (green) or "hub" (magenta)
  variant?: "agency" | "hub";
}

// Convert ChatMessage[] from API to Message[] for ChatView
function convertChatMessages(apiMessages: ChatMessage[]): Message[] {
  const messages: Message[] = [];
  const toolResults = new Map<
    string,
    { content: string; status: "done" | "error" }
  >();

  // First pass: collect tool results
  for (const msg of apiMessages) {
    if (msg.role === "tool") {
      const toolMsg = msg as {
        role: "tool";
        content: string;
        toolCallId: string;
      };
      toolResults.set(toolMsg.toolCallId, {
        content: toolMsg.content,
        status: "done",
      });
    }
  }

  // Second pass: build messages with tool calls
  for (let i = 0; i < apiMessages.length; i++) {
    const msg = apiMessages[i];
    const timestamp = msg.ts || "";

    if (msg.role === "tool") continue;

    if (msg.role === "assistant") {
      const assistantMsg = msg as
        | { role: "assistant"; content: string; reasoning?: string; ts?: string }
        | { role: "assistant"; toolCalls?: APIToolCall[]; reasoning?: string; ts?: string };

      const reasoning = "reasoning" in assistantMsg ? assistantMsg.reasoning : undefined;

      if ("toolCalls" in assistantMsg && assistantMsg.toolCalls?.length) {
        const toolCalls = assistantMsg.toolCalls.map((tc) => {
          const result = toolResults.get(tc.id);
          return {
            id: tc.id,
            name: tc.name,
            args: tc.args as Record<string, unknown>,
            result: result?.content,
            status: result ? result.status : ("running" as const),
          };
        });

        const content =
          "content" in assistantMsg
            ? (assistantMsg as { content?: string }).content || ""
            : "";

        messages.push({
          id: `msg-${i}`,
          role: "assistant",
          content,
          timestamp,
          toolCalls,
          reasoning,
        });
      } else if ("content" in assistantMsg && assistantMsg.content) {
        messages.push({
          id: `msg-${i}`,
          role: "assistant",
          content: assistantMsg.content,
          timestamp,
          reasoning,
        });
      }
    } else {
      const contentMsg = msg as { role: "user" | "system"; content: string };
      messages.push({
        id: `msg-${i}`,
        role: contentMsg.role,
        content: contentMsg.content || "",
        timestamp,
      });
    }
  }

  return messages;
}

export function MindPanel({
  isOpen,
  onClose,
  agencyId,
  agencyName,
  mindState,
  runState,
  connected,
  loading,
  onSendMessage,
  onStop,
  variant = "agency",
}: MindPanelProps) {
  // Color scheme based on variant
  const colors = variant === "hub"
    ? { accent: "#ff00ff", icon: "&#9671;" } // Magenta diamond outline for Hub
    : { accent: "#ffffff", icon: "&#9670;" }; // White diamond filled for Agency

  const title = variant === "hub" ? "HUB_MIND" : "AGENCY_MIND";
  const welcomeTitle = variant === "hub" ? "HUB MIND ONLINE" : "AGENCY MIND ONLINE";
  const welcomeText = variant === "hub"
    ? "I am the Hub Mind - the central intelligence of this Agent Hub. I can help you understand the overall structure, create agencies, and provide guidance."
    : "I am the mind of this agency. I can help you understand and manage your agents, blueprints, schedules, and configuration.";
  const suggestions = variant === "hub"
    ? ['"List all agencies"', '"Get hub stats"', '"Create a new agency"']
    : ['"What blueprints do I have?"', '"List my running agents"', '"Create a new blueprint for..."'];

  // Convert messages for ChatView
  const messages = useMemo(() => {
    return convertChatMessages(mindState?.messages || []);
  }, [mindState?.messages]);

  // Derive status from run state
  const isRunning = runState?.status === "running";

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full w-full max-w-lg bg-black border-l-2 z-50",
          "flex flex-col",
          "transform transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
        style={{ borderColor: colors.accent }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 bg-black flex items-center justify-between shrink-0"
          style={{ borderBottom: `1px solid ${colors.accent}` }}
        >
          <div className="flex items-center gap-3">
            <span
              className="text-lg"
              style={{ color: colors.accent }}
              dangerouslySetInnerHTML={{ __html: colors.icon }}
            />
            <div>
              <h2
                className="text-xs uppercase tracking-widest font-medium"
                style={{ color: colors.accent }}
              >
                {title}
              </h2>
              <p
                className="text-[10px] font-mono"
                style={{ color: `${colors.accent}80` }}
              >
                {agencyName || agencyId} // {connected ? "CONNECTED" : "OFFLINE"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <span className="text-[10px] uppercase tracking-wider text-[#00aaff] blink-hard">
                PROCESSING
              </span>
            )}
            <button
              onClick={onClose}
              className="text-xs transition-colors"
              style={{ color: `${colors.accent}80` }}
              onMouseEnter={(e) => (e.currentTarget.style.color = colors.accent)}
              onMouseLeave={(e) => (e.currentTarget.style.color = `${colors.accent}80`)}
            >
              [X]
            </button>
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {!mindState ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center px-4">
                <div
                  className="text-3xl mb-4 font-mono animate-pulse"
                  style={{ color: `${colors.accent}50` }}
                  dangerouslySetInnerHTML={{ __html: colors.icon }}
                />
                <p
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: `${colors.accent}60` }}
                >
                  {loading ? "INITIALIZING MIND..." : "LOADING STATE..."}
                </p>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex-1 flex flex-col">
              {/* Welcome message */}
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="text-center max-w-sm">
                  <div
                    className="text-4xl mb-4 font-mono"
                    style={{ color: colors.accent }}
                    dangerouslySetInnerHTML={{ __html: colors.icon }}
                  />
                  <h3
                    className="text-xs uppercase tracking-widest mb-3"
                    style={{ color: colors.accent }}
                  >
                    {welcomeTitle}
                  </h3>
                  <p
                    className="text-[10px] leading-relaxed mb-4"
                    style={{ color: `${colors.accent}80` }}
                  >
                    {welcomeText}
                  </p>
                  <div className="text-[10px] space-y-1" style={{ color: `${colors.accent}50` }}>
                    <p>TRY ASKING:</p>
                    {suggestions.map((s, i) => (
                      <p key={i} style={{ color: `${colors.accent}80` }}>{s}</p>
                    ))}
                  </div>
                </div>
              </div>
              {/* Input at bottom */}
              <div className="p-3" style={{ borderTop: `1px solid ${colors.accent}50` }}>
                <ChatInput onSend={onSendMessage} disabled={loading} accentColor={colors.accent} />
              </div>
            </div>
          ) : (
            <ChatView
              messages={messages}
              onSendMessage={onSendMessage}
              onStop={onStop}
              isLoading={loading}
            />
          )}
        </div>
      </div>
    </>
  );
}

// Simple chat input for the empty state
function ChatInput({
  onSend,
  disabled,
  accentColor = "#00ff00",
}: {
  onSend: (content: string) => void;
  disabled?: boolean;
  accentColor?: string;
}) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() && !disabled) {
      onSend(value.trim());
      setValue("");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask the Mind..."
        disabled={disabled}
        style={{
          borderColor: `${accentColor}80`,
          color: accentColor,
        }}
        className="flex-1 px-3 py-2 bg-black border text-xs placeholder:opacity-30 focus:outline-none"
        onFocus={(e) => (e.currentTarget.style.borderColor = accentColor)}
        onBlur={(e) => (e.currentTarget.style.borderColor = `${accentColor}80`)}
      />
      <button
        type="submit"
        disabled={!value.trim() || disabled}
        style={{
          backgroundColor: accentColor,
          borderColor: accentColor,
          color: "black",
        }}
        className="px-4 py-2 text-[11px] uppercase tracking-wider border disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        onMouseEnter={(e) => {
          if (!e.currentTarget.disabled) {
            e.currentTarget.style.backgroundColor = "black";
            e.currentTarget.style.color = accentColor;
          }
        }}
        onMouseLeave={(e) => {
          if (!e.currentTarget.disabled) {
            e.currentTarget.style.backgroundColor = accentColor;
            e.currentTarget.style.color = "black";
          }
        }}
      >
        SEND
      </button>
    </form>
  );
}

export default MindPanel;
