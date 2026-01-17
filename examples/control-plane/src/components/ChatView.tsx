import { useState, useRef, useEffect } from "react";
import { cn } from "../lib/utils";
import { Button } from "./Button";
import { formatTime, type Message, type ToolCall } from "./shared";

// ASCII spinner frames
const SPINNER_FRAMES = ["|", "/", "—", "\\"];

function useAsciiSpinner(interval = 100) {
  const [frame, setFrame] = useState(0);
  
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, interval);
    return () => clearInterval(timer);
  }, [interval]);
  
  return SPINNER_FRAMES[frame];
}

// Thinking indicator shown while agent is processing
function ThinkingIndicator() {
  const spinner = useAsciiSpinner(120);
  
  return (
    <div className="flex gap-3 mb-4">
      <span className="shrink-0 text-[10px] font-mono pt-2 text-white">[AI]</span>
      <div className="flex items-center gap-2 px-3 py-2 border border-[#00aaff]/50 text-[#00aaff]">
        <span className="font-mono text-sm w-3">{spinner}</span>
        <span className="text-[11px] uppercase tracking-wider">THINKING</span>
      </div>
    </div>
  );
}

interface ChatViewProps {
  messages: Message[];
  onSendMessage: (content: string) => void;
  onStop?: () => void;
  isLoading?: boolean;
  placeholder?: string;
  /** Unique ID for scroll position memory (e.g., agentId) */
  scrollKey?: string;
}

function ReasoningBlock({ reasoning }: { reasoning: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-l border-white/20 pl-2 py-0.5 font-mono mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 text-left hover:bg-white/5 transition-colors py-0.5 group"
      >
        <span className="text-[10px] text-white/30 shrink-0 whitespace-nowrap">
          {expanded ? "[-]" : "[+]"}
        </span>
        <span className="text-[10px] text-white/40 shrink-0">[REASON]</span>
        <span className="text-[10px] text-white/30 truncate flex-1 italic">
          {expanded ? "" : reasoning.slice(0, 60) + (reasoning.length > 60 ? "..." : "")}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 ml-4 text-[11px] text-white/50 whitespace-pre-wrap">
          {reasoning}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const hasContent = message.content && message.content.trim().length > 0;
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
  const hasReasoning = message.reasoning && message.reasoning.trim().length > 0;

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
      <span className="shrink-0 text-[10px] font-mono pt-2 text-white">
        {isUser ? "[USR]" : "[AI]"}
      </span>

      {/* Content */}
      <div
        className={cn("flex flex-col max-w-[85%] sm:max-w-[80%]", isUser ? "items-end" : "")}
      >
        {/* Reasoning block - collapsible, shown before content */}
        {hasReasoning && <ReasoningBlock reasoning={message.reasoning!} />}

        {/* Only show text bubble if there's actual content */}
        {hasContent && (
          <div
            className="px-3 py-2 text-xs border bg-white text-black border-white"
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
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

        {message.timestamp && (
          <span className="text-[10px] text-white/30 mt-1 font-mono">
            {formatTime(message.timestamp)}
          </span>
        )}
      </div>
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig = {
    pending: { label: "WAIT", border: "border-white/30", text: "text-white/40" },
    running: { label: "EXEC", border: "border-[#00aaff]", text: "text-[#00aaff]" },
    done: { label: "OK", border: "border-[#00ff00]/50", text: "text-[#00ff00]" },
    error: { label: "ERR", border: "border-[#ff0000]", text: "text-[#ff0000]" }
  };
  
  const config = statusConfig[toolCall.status];
  const isRunning = toolCall.status === "running";
  const isError = toolCall.status === "error";

  return (
    <div className="border-l border-white/30 pl-2 py-0.5 font-mono">
      {/* Main tool call line - log style */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 text-left hover:bg-white/5 transition-colors py-0.5 group"
      >
        {/* Expand indicator */}
        <span className="text-[10px] text-white/30 shrink-0 whitespace-nowrap">
          {expanded ? "[-]" : "[+]"}
        </span>
        
        {/* Type tag */}
        <span className="text-[10px] text-white/50 shrink-0">[TOOL]</span>
        
        {/* Tool name - UPPERCASE */}
        <span className="text-[11px] text-white/80 truncate flex-1 uppercase">
          {toolCall.name}
        </span>
        
        {/* Status badge - colored */}
        <span className={cn(
          "text-[10px] px-1 border",
          config.border,
          config.text,
          isRunning && "blink-hard"
        )}>
          {config.label}
        </span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-1 ml-4 text-[11px] space-y-2 text-white/60">
          {/* Args - pretty printed */}
          <div>
            <span className="text-white/30">ARGS:</span>
            <pre className="mt-1 overflow-x-auto whitespace-pre">
{JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          
          {/* Result */}
          {toolCall.result !== undefined && (
            <div>
              <span className={isError ? "text-[#ff0000]" : "text-white/30"}>
                {isError ? "ERR:" : "OUT:"}
              </span>
              <pre className={cn(
                "mt-1 overflow-x-auto whitespace-pre",
                isError && "text-[#ff0000]"
              )}>
{typeof toolCall.result === "string"
  ? toolCall.result.slice(0, 500) + (toolCall.result.length > 500 ? "..." : "")
  : JSON.stringify(toolCall.result, null, 2).slice(0, 500)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Store scroll positions per scrollKey
const scrollPositions = new Map<string, number>();

export function ChatView({
  messages,
  onSendMessage,
  onStop,
  isLoading = false,
  placeholder = "ENTER COMMAND...",
  scrollKey,
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Track which scrollKey we last processed
  const processedScrollKeyRef = useRef<string | undefined>(undefined);
  const prevMessagesLengthRef = useRef(messages.length);
  const prevIsLoadingRef = useRef(isLoading);
  // Ignore initial data load after tab switch
  const ignoreNextChangeRef = useRef(true);

  // Save scroll position on scroll
  const handleScroll = () => {
    if (!scrollKey || !messagesContainerRef.current) return;
    scrollPositions.set(scrollKey, messagesContainerRef.current.scrollTop);
  };

  // Single combined effect for scroll management
  useEffect(() => {
    const isNewTab = processedScrollKeyRef.current !== scrollKey;
    
    if (isNewTab) {
      // New tab - restore scroll, ignore next data load
      processedScrollKeyRef.current = scrollKey;
      prevMessagesLengthRef.current = messages.length;
      prevIsLoadingRef.current = isLoading;
      ignoreNextChangeRef.current = true;
      
      if (scrollKey) {
        const savedPosition = scrollPositions.get(scrollKey);
        if (savedPosition !== undefined) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (messagesContainerRef.current) {
                messagesContainerRef.current.scrollTop = savedPosition;
              }
            });
          });
        }
      }
      return;
    }
    
    // Same tab - check if this is initial data load to ignore
    const messagesChanged = messages.length !== prevMessagesLengthRef.current;
    const loadingChanged = isLoading !== prevIsLoadingRef.current;
    
    if (ignoreNextChangeRef.current && (messagesChanged || loadingChanged)) {
      // Initial data load after tab switch - ignore and clear flag
      ignoreNextChangeRef.current = false;
      prevMessagesLengthRef.current = messages.length;
      prevIsLoadingRef.current = isLoading;
      return;
    }
    
    // Real new messages or loading start
    const hasNewMessages = messages.length > prevMessagesLengthRef.current;
    const loadingJustStarted = isLoading && !prevIsLoadingRef.current;
    
    prevMessagesLengthRef.current = messages.length;
    prevIsLoadingRef.current = isLoading;
    
    if (hasNewMessages || loadingJustStarted) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [scrollKey, messages.length, isLoading]);

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
      <div 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 sm:p-4"
      >
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
            {isLoading && <ThinkingIndicator />}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="border-t-2 border-white bg-black p-2 sm:p-3">
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
              ABORT
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
      </div>
    </div>
  );
}
