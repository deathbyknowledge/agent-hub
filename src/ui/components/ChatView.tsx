import { useState, useRef, useEffect } from "react";
import { cn } from "../lib/utils";
import { Button } from "./Button";
import { PaperPlaneRight, User, Robot, Stop, Wrench } from "./Icons";

// Types
interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "running" | "done" | "error";
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
}

interface ChatViewProps {
  messages: Message[];
  onSendMessage: (content: string) => void;
  onStop?: () => void;
  isLoading?: boolean;
  placeholder?: string;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const hasContent = message.content && message.content.trim().length > 0;
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-3 mb-4", isUser ? "flex-row-reverse" : "")}>
      {/* Avatar */}
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
          isUser
            ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400"
            : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
        )}
      >
        {isUser ? <User size={16} /> : <Robot size={16} />}
      </div>

      {/* Content */}
      <div
        className={cn("flex flex-col max-w-[75%]", isUser ? "items-end" : "")}
      >
        {/* Only show text bubble if there's actual content */}
        {hasContent && (
          <div
            className={cn(
              "px-4 py-2.5 rounded-2xl text-sm",
              isUser
                ? "bg-orange-500 text-white rounded-br-md"
                : "bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 border border-neutral-200 dark:border-neutral-700 rounded-bl-md"
            )}
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        )}

        {/* Tool calls */}
        {hasToolCalls && (
          <div className={cn("space-y-2 w-full min-w-0", hasContent && "mt-2")}>
            {message.toolCalls!.map((tool) => (
              <ToolCallCard key={tool.id} toolCall={tool} />
            ))}
          </div>
        )}

        <span className="text-xs text-neutral-400 mt-1">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const statusColors = {
    pending: "text-neutral-400",
    running: "text-blue-500",
    done: "text-green-500",
    error: "text-red-500"
  };

  return (
    <div className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
      >
        <Wrench size={14} className={statusColors[toolCall.status]} />
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {toolCall.name}
        </span>
        <span className={cn("text-xs ml-auto", statusColors[toolCall.status])}>
          {toolCall.status}
        </span>
      </button>

      {expanded && (
        <div className="px-3 py-2 border-t border-neutral-200 dark:border-neutral-700 text-xs overflow-hidden">
          <div className="mb-2 min-w-0">
            <span className="text-neutral-500">Args:</span>
            <pre className="mt-1 p-2 bg-neutral-100 dark:bg-neutral-800 rounded text-neutral-700 dark:text-neutral-300 overflow-x-auto whitespace-pre-wrap break-words max-w-full">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          {toolCall.result !== undefined && (
            <div className="min-w-0">
              <span className="text-neutral-500">Result:</span>
              <pre className="mt-1 p-2 bg-neutral-100 dark:bg-neutral-800 rounded text-neutral-700 dark:text-neutral-300 overflow-x-auto whitespace-pre-wrap break-words max-w-full">
                {typeof toolCall.result === "string"
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatView({
  messages,
  onSendMessage,
  onStop,
  isLoading = false,
  placeholder = "Type a message..."
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-neutral-400">
              <Robot size={48} className="mx-auto mb-3 opacity-50" />
              <p>Start a conversation</p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={isLoading}
              rows={1}
              className={cn(
                "w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700",
                "bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100",
                "placeholder:text-neutral-400 resize-none",
                "focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500",
                "disabled:opacity-50"
              )}
            />
          </div>

          {isLoading && onStop ? (
            <Button variant="danger" onClick={onStop} icon={<Stop size={18} />}>
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              icon={<PaperPlaneRight size={18} />}
            >
              Send
            </Button>
          )}
        </div>

        <p className="text-xs text-neutral-400 mt-2 text-center">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

export type { Message, ToolCall };
