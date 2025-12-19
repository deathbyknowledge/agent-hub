import { useState, useRef, useEffect, memo } from "react";
import Markdown from "react-markdown";
import { cn } from "../lib/utils";
import { Button } from "./Button";
import { PaperPlaneTiltIcon, User, Robot, Stop, Wrench, Copy, Check } from "@phosphor-icons/react";

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
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  
  if (isToday) return time;
  if (isYesterday) return `Yesterday ${time}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
}

// Code block with copy button
function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const language = className?.replace("language-", "") || "";
  
  const copyCode = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <div className="relative group my-2">
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={copyCode}
          className="p-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 text-xs"
          title="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      {language && (
        <div className="absolute left-3 top-2 text-xs text-neutral-500 font-mono">
          {language}
        </div>
      )}
      <pre className="bg-neutral-900 dark:bg-neutral-950 text-neutral-100 p-3 pt-8 rounded-lg overflow-x-auto text-xs font-mono">
        <code>{children}</code>
      </pre>
    </div>
  );
}

// Markdown renderer with custom components
const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-0 prose-pre:p-0 prose-pre:bg-transparent">
      <Markdown
        components={{
          code({ className, children, ...props }) {
            const isInline = !className;
            const codeContent = String(children).replace(/\n$/, "");
            
            if (isInline) {
              return (
                <code
                  className="bg-neutral-100 dark:bg-neutral-700 px-1.5 py-0.5 rounded text-xs font-mono"
                  {...props}
                >
                  {codeContent}
                </code>
              );
            }
            
            return <CodeBlock className={className}>{codeContent}</CodeBlock>;
          },
          pre({ children }) {
            // Pass through to let code handle it
            return <>{children}</>;
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-500 hover:text-orange-600 underline"
              >
                {children}
              </a>
            );
          }
        }}
      >
        {content}
      </Markdown>
    </div>
  );
});

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
    <div className={cn("flex gap-2 sm:gap-3 mb-4", isUser ? "flex-row-reverse" : "")}>
      {/* Avatar */}
      <div
        className={cn(
          "w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shrink-0",
          isUser
            ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400"
            : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
        )}
      >
        {isUser ? <User size={14} className="sm:w-4 sm:h-4" /> : <Robot size={14} className="sm:w-4 sm:h-4" />}
      </div>

      {/* Content */}
      <div
        className={cn("flex flex-col max-w-[85%] sm:max-w-[75%]", isUser ? "items-end" : "")}
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
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <MarkdownContent content={message.content} />
            )}
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

  const statusConfig = {
    pending: { color: "text-neutral-400", bg: "bg-neutral-100 dark:bg-neutral-800", label: "pending" },
    running: { color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-900/30", label: "running..." },
    done: { color: "text-green-500", bg: "bg-green-50 dark:bg-green-900/30", label: "done" },
    error: { color: "text-red-500", bg: "bg-red-50 dark:bg-red-900/30", label: "error" }
  };
  
  const config = statusConfig[toolCall.status];
  const isRunning = toolCall.status === "running";

  return (
    <div className={cn(
      "border rounded-lg overflow-hidden",
      toolCall.status === "error" 
        ? "border-red-200 dark:border-red-800" 
        : "border-neutral-200 dark:border-neutral-700",
      config.bg
    )}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <Wrench size={14} className={cn(config.color, isRunning && "animate-spin")} />
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300 truncate">
          {toolCall.name}
        </span>
        <span className={cn("text-xs ml-auto flex items-center gap-1", config.color)}>
          {isRunning && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
          )}
          {config.label}
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
            <div className="text-center max-w-sm">
              <Robot size={48} className="mx-auto mb-4 text-neutral-300 dark:text-neutral-600" />
              <h3 className="text-lg font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                Ready to chat
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Send a message to start the conversation. The agent will respond and may use tools to help accomplish your task.
              </p>
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
      <div className="border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 sm:p-4">
        <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={isLoading}
              rows={1}
              className={cn(
                "w-full px-3 py-3 sm:px-4 sm:py-4 rounded-xl border border-neutral-200 dark:border-neutral-700",
                "bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100",
                "placeholder:text-neutral-400 resize-none text-sm sm:text-base",
                "focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500",
                "disabled:opacity-50"
              )}
            />

          {isLoading && onStop ? (
            <Button variant="danger" onClick={onStop} icon={<Stop size={16} className="sm:w-[18px] sm:h-[18px]" />} size="sm" className="sm:text-sm sm:px-3 sm:py-2">
              <span className="hidden sm:inline">Stop</span>
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              icon={<PaperPlaneTiltIcon size={16} className="sm:w-[18px] sm:h-[18px]" />}
              size="sm"
              className="sm:text-sm sm:px-3 sm:py-2"
            >
              <span className="hidden sm:inline">Send</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export type { Message, ToolCall };
