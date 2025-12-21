import { useState, useRef, useEffect, memo, useMemo } from "react";
import Markdown from "react-markdown";
import { cn } from "../lib/utils";
import { Button } from "./Button";
import { Wrench, Copy, Check } from "@phosphor-icons/react";

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
    <div className="relative group my-2 border border-white/30">
      <div className="flex items-center justify-between px-2 py-1 border-b border-white/30 bg-white/5">
        <span className="text-[10px] uppercase tracking-wider text-white/50">
          {language || "CODE"}
        </span>
        <button
          onClick={copyCode}
          className="p-1 text-white/30 hover:text-white transition-colors"
          title="Copy code"
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
        </button>
      </div>
      <pre className="bg-black text-[#00ff00] p-3 overflow-x-auto text-xs">
        <code>{children}</code>
      </pre>
    </div>
  );
}

// Markdown renderer with custom components
const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-0 prose-pre:p-0 prose-pre:bg-transparent prose-headings:text-white prose-headings:uppercase prose-headings:tracking-wider prose-headings:text-xs prose-strong:text-white prose-p:text-white/80">
      <Markdown
        components={{
          code({ className, children, ...props }) {
            const isInline = !className;
            const codeContent = String(children).replace(/\n$/, "");
            
            if (isInline) {
              return (
                <code
                  className="bg-white/10 border border-white/20 px-1 py-0.5 text-[#00ff00] text-xs"
                  {...props}
                >
                  {codeContent}
                </code>
              );
            }
            
            return <CodeBlock className={className}>{codeContent}</CodeBlock>;
          },
          pre({ children }) {
            return <>{children}</>;
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#00aaff] hover:text-white underline"
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
      <div className="flex justify-center my-3">
        <span className="text-[10px] uppercase tracking-widest text-white/30 border border-white/20 px-3 py-1">
          // {message.content}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-3 mb-4", isUser ? "flex-row-reverse" : "")}>
      {/* Terminal prompt indicator */}
      <div
        className={cn(
          "w-6 h-6 flex items-center justify-center shrink-0 border text-[10px] font-bold",
          isUser
            ? "border-white bg-white text-black"
            : "border-[#00ff00] text-[#00ff00]"
        )}
      >
        {isUser ? ">" : "<"}
      </div>

      {/* Content */}
      <div
        className={cn("flex flex-col max-w-[85%] sm:max-w-[80%]", isUser ? "items-end" : "")}
      >
        {/* Only show text bubble if there's actual content */}
        {hasContent && (
          <div
            className={cn(
              "px-3 py-2 text-xs border",
              isUser
                ? "bg-white text-black border-white"
                : "bg-black text-white/90 border-white/30"
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
          <div className={cn("space-y-1 w-full min-w-0", hasContent && "mt-2")}>
            {message.toolCalls!.map((tool) => (
              <ToolCallCard key={tool.id} toolCall={tool} />
            ))}
          </div>
        )}

        <span className="text-[10px] text-white/30 mt-1 font-mono">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig = {
    pending: { color: "text-white/40", borderColor: "border-white/20", label: "PENDING" },
    running: { color: "text-[#00aaff]", borderColor: "border-[#00aaff]", label: "EXEC..." },
    done: { color: "text-[#00ff00]", borderColor: "border-[#00ff00]/50", label: "OK" },
    error: { color: "text-[#ff0000]", borderColor: "border-[#ff0000]", label: "FAIL" }
  };
  
  const config = statusConfig[toolCall.status];
  const isRunning = toolCall.status === "running";

  return (
    <div className={cn(
      "border overflow-hidden bg-black",
      config.borderColor
    )}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-white/5 transition-colors"
      >
        <Wrench size={12} className={cn(config.color, isRunning && "animate-spin")} />
        <span className="text-[11px] uppercase tracking-wider text-white/70 truncate">
          {toolCall.name}
        </span>
        <span className={cn("text-[10px] ml-auto flex items-center gap-1 uppercase tracking-wider", config.color)}>
          {isRunning && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full bg-[#00aaff] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 bg-[#00aaff]" />
            </span>
          )}
          [{config.label}]
        </span>
      </button>

      {expanded && (
        <div className="px-2 py-2 border-t border-white/20 text-xs overflow-hidden">
          <div className="mb-2 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-white/40">INPUT:</span>
            <pre className="mt-1 p-2 bg-white/5 border border-white/10 text-[#ffaa00] overflow-x-auto whitespace-pre-wrap break-words max-w-full text-[11px]">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          {toolCall.result !== undefined && (
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-white/40">OUTPUT:</span>
              <pre className="mt-1 p-2 bg-white/5 border border-white/10 text-[#00ff00] overflow-x-auto whitespace-pre-wrap break-words max-w-full text-[11px]">
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
  placeholder = "ENTER COMMAND..."
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
    <div className="flex flex-col h-full bg-black">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-sm border border-white/20 p-6">
              <div className="text-[#00ff00] text-2xl mb-4 font-mono">_</div>
              <h3 className="text-xs uppercase tracking-widest text-white mb-2">
                TERMINAL READY
              </h3>
              <p className="text-[10px] uppercase tracking-wider text-white/40">
                AWAITING INPUT. AGENT WILL PROCESS COMMANDS AND EXECUTE TOOL CALLS AS REQUIRED.
              </p>
              <div className="mt-4 text-[10px] text-white/20 font-mono">
                SYS.STATUS: IDLE | MEM: OK | TOOLS: LOADED
              </div>
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
      <div className="border-t-2 border-white bg-black p-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-stretch border border-white/50 focus-within:border-[#00ff00] focus-within:bg-black transition-colors">
            {/* Line carets - one > per line */}
            <div className="flex flex-col py-2 pl-2 pr-1 text-[#00ff00] text-xs font-mono select-none">
              {Array.from({ length: Math.max(1, input.split('\n').length) }).map((_, i) => (
                <span key={i} className="leading-[1.5] h-[18px]">&gt;</span>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={isLoading}
              rows={1}
              style={{ caretColor: '#00ff00' }}
              className={cn(
                "w-full px-1 py-2 bg-transparent text-[#00ff00] text-xs font-mono leading-[1.5]",
                "placeholder:text-white/30 placeholder:uppercase placeholder:tracking-wider resize-none",
                "focus:outline-none",
                "disabled:opacity-30"
              )}
            />
          </div>

          {isLoading && onStop ? (
            <Button variant="danger" onClick={onStop} icon={<span className="blink-hard">■</span>} size="sm">
              <span className="hidden sm:inline">ABORT</span>
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              size="sm"
            >
              [EXEC]
            </Button>
          )}
        </div>
        {isLoading && (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-[#00aaff] uppercase tracking-wider">
            <span className="inline-block w-1.5 h-1.5 bg-[#00aaff] animate-pulse" />
            PROCESSING...
          </div>
        )}
      </div>
    </div>
  );
}

export type { Message, ToolCall };
