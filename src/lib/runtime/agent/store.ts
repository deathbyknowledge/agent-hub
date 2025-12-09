import type { ChatMessage, ToolCall } from "../types";
import type { AgentEvent } from "../events";

function toJson(v: unknown) {
  return JSON.stringify(v ?? null);
}

function fromJson<T>(v: unknown): T | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      // if it's already a simple string value, just cast
      return v as unknown as T;
    }
  }
  return v as T;
}

export class Store {
  private _messages?: ChatMessage[];
  private _events?: AgentEvent[];

  constructor(
    // Public so middlewares can access it
    public sql: SqlStorage,
    public kv: SyncKvStorage
  ) {}

  /** Create tables if absent */
  init() {
    this.sql.exec(
      `
CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
  content TEXT,
  tool_call_id TEXT,
  tool_calls_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL,
  ts TEXT NOT NULL
);
`
    );
  }

  // --------------------------
  // Messages
  // --------------------------
  appendMessages(msgs: ChatMessage[]): void {
    if (!msgs.length) return;
    const t = Date.now();

    // Store in SQL first
    for (const m of msgs) {
      if (m.role === "assistant" && "toolCalls" in m && m.toolCalls) {
        this.sql.exec(
          `INSERT INTO messages (role, content, tool_call_id, tool_calls_json, created_at)
             VALUES ('assistant', NULL, NULL, ?, ?)`,
          toJson(m.toolCalls),
          t
        );
      } else if (m.role === "tool") {
        this.sql.exec(
          `INSERT INTO messages (role, content, tool_call_id, tool_calls_json, created_at)
             VALUES ('tool', ?, ?, NULL, ?)`,
          String(m.content ?? ""),
          String(m.toolCallId ?? ""),
          t
        );
      } else {
        // user or assistant with textual content
        const content =
          "content" in m ? String(m.content ?? "") : ("" as string);
        this.sql.exec(
          `INSERT INTO messages (role, content, tool_call_id, tool_calls_json, created_at)
             VALUES (?, ?, NULL, NULL, ?)`,
          m.role,
          content,
          t
        );
      }
    }

    // Invalidate cache to ensure consistency with DB
    // This forces a reload from SQL on next listMessages() call
    this._messages = undefined;
  }

  listMessages(): ChatMessage[] {
    if (this._messages) return [...this._messages];
    const rows = this.sql.exec(
      `SELECT role, content, tool_call_id, tool_calls_json
       FROM messages ORDER BY seq ASC`
    );
    const out: ChatMessage[] = [];
    for (const r of rows ?? []) {
      const role = String(r.role);
      if (role === "assistant" && r.tool_calls_json) {
        out.push({
          role: "assistant",
          toolCalls: fromJson<ToolCall[]>(r.tool_calls_json) ?? [],
        });
      } else if (role === "tool") {
        out.push({
          role: "tool",
          content: String(r.content ?? ""),
          toolCallId: String(r.tool_call_id ?? ""),
        });
      } else {
        out.push({
          role: role as "user" | "assistant",
          content: String(r.content ?? ""),
        });
      }
    }
    this._messages = [...out];
    return out;
  }

  /** Insert one tool result message */
  appendToolResult(toolCallId: string, content: string): void {
    this.sql.exec(
      `INSERT INTO messages (role, content, tool_call_id, tool_calls_json, created_at)
       VALUES ('tool', ?, ?, NULL, ?)`,
      content,
      toolCallId,
      Date.now()
    );
    // Invalidate cache to ensure consistency with DB
    this._messages = undefined;
  }

  /** Get the last assistant message */
  lastAssistant(): ChatMessage | null {
    const rows = this.sql
      .exec(
        `SELECT role, content, tool_call_id, tool_calls_json
         FROM messages 
         WHERE role = 'assistant'
         ORDER BY seq DESC
         LIMIT 1`
      )
      .toArray();

    if (!rows || rows.length === 0) return null;

    const r = rows[0];
    if (r.tool_calls_json) {
      return {
        role: "assistant",
        toolCalls: fromJson<ToolCall[]>(r.tool_calls_json) ?? [],
      };
    }

    return {
      role: "assistant",
      content: String(r.content ?? ""),
    };
  }

  // --------------------------
  // Events
  // --------------------------
  addEvent(e: AgentEvent): number {
    this.sql.exec(
      "INSERT INTO events (type, data_json, ts) VALUES (?, ?, ?)",
      e.type,
      toJson({ ...e.data }),
      e.ts
    );
    // Let's get the highest seq now
    const rows = this.sql
      .exec<{ seq: number }>("SELECT seq FROM events ORDER BY seq DESC LIMIT 1")
      .toArray();

    const seq = rows[0].seq;
    if (this._events) {
      this._events = [...this._events, { ...e, seq }];
    }

    return seq;
  }

  listEvents(): AgentEvent[] {
    if (this._events) return [...this._events];
    const rows = this.sql.exec(
      `SELECT seq, type, data_json, ts FROM events
       ORDER BY seq ASC`
    );
    const out: AgentEvent[] = [];
    for (const r of rows) {
      const data = fromJson(r.data_json) ?? {};
      out.push({
        threadId: "", // TODO: check what to do with this
        ts: String(r.ts),
        seq: Number(r.seq),
        type: String(r.type),
        data,
      } as AgentEvent);
    }
    this._events = [...out];
    return out;
  }
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
