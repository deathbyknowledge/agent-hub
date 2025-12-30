import type { SqlStorage } from "@cloudflare/workers-types";
import type { ChatMessage } from "../types";
import type { AgentEvent } from "../events";

export class Store {
  constructor(private sql: SqlStorage) {}

  /**
   * Initialize the schema.
   * Uses JSON columns for complex structures and FTS-ready design.
   */
  init() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content JSON,            -- Strictly stores JSON-serialized content ("text" or [{"type":...}])
        tool_calls JSON,         -- JSON Array of tool calls
        tool_call_id TEXT,       -- ID being responded to
        reasoning_content TEXT,  -- DeepSeek thinking blocks
        created_at INTEGER NOT NULL
      );
      
      -- Index for frequent access patterns
      CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
      
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data JSON NOT NULL,
        ts TEXT NOT NULL
      );
    `);
  }

  /**
   * Appends messages in batches to respect the 100-parameter limit.
   */
  add(input: ChatMessage | ChatMessage[]): void {
    const msgs = Array.isArray(input) ? input : [input];
    if (!msgs.length) return;

    const now = Date.now();

    // Define columns relative to the parameters we bind
    // 1: role, 2: content, 3: tool_calls, 4: tool_call_id, 5: reasoning_content, 6: created_at
    const PARAMS_PER_ROW = 6;
    const MAX_PARAMS = 100; // DO Limit
    const CHUNK_SIZE = Math.floor(MAX_PARAMS / PARAMS_PER_ROW); // ~16 rows

    // Helper to serialize cleanly
    const toJSON = (v: unknown) =>
      v === undefined || v === null ? null : JSON.stringify(v);

    // Chunk the messages
    for (let i = 0; i < msgs.length; i += CHUNK_SIZE) {
      const chunk = msgs.slice(i, i + CHUNK_SIZE);
      const placeholders: string[] = [];
      const bindings: unknown[] = [];

      for (const m of chunk) {
        placeholders.push(`(?, ?, ?, ?, ?, ?)`);

        // 1. Role
        bindings.push(m.role);

        // 2. Content (Strictly JSON serialized)
        // If it's a string, we stringify it ("hello" -> "\"hello\"")
        // If it's an object/array, we stringify it ([part] -> "[part]")
        bindings.push(toJSON("content" in m ? m.content : undefined));

        // 3. Tool Calls (JSON)
        bindings.push(toJSON("toolCalls" in m ? m.toolCalls : undefined));

        // 4. Tool Call ID
        bindings.push("toolCallId" in m ? m.toolCallId : null);

        // 5. Reasoning Content
        bindings.push("reasoning" in m ? m.reasoning : null);

        // 6. Created At
        bindings.push(now);
      }

      // Execute this batch
      const query = `
        INSERT INTO messages (
          role, content, tool_calls, tool_call_id, reasoning_content, created_at
        ) VALUES ${placeholders.join(", ")}
      `;

      this.sql.exec(query, ...bindings);
    }
  }

  getContext(limit = 100): ChatMessage[] {
    // Get the last N conversation turns
    const cursor = this.sql.exec(`
      SELECT * FROM (
        SELECT seq, role, content, tool_calls, tool_call_id, reasoning_content
        FROM messages 
        ORDER BY seq DESC 
        LIMIT ?
      ) ORDER BY seq ASC
    `, limit);

    return this._mapRows(cursor);
  }

  /** * Efficiently gets the last assistant message (useful for continuation logic).
   */
  lastAssistant(): ChatMessage | null {
    const cursor = this.sql.exec(`
      SELECT role, content, tool_calls, tool_call_id, reasoning_content, meta
      FROM messages 
      WHERE role = 'assistant'
      ORDER BY seq DESC
      LIMIT 1
    `);

    const row = cursor.toArray()[0];
    if (!row) return null;

    return {
      role: "assistant",
      content: row.content ? JSON.parse(row.content as string) : null,
      toolCalls: row.tool_calls
        ? JSON.parse(row.tool_calls as string)
        : undefined,
      reasoning: row.reasoning_content as string | undefined,
    };
  }

  // --------------------------
  // Events Logic
  // --------------------------

  addEvent(e: AgentEvent): number {
    // Events usually come one by one, so simple insert is fine.
    // Check param limit: 3 params << 100.
    this.sql.exec(
      "INSERT INTO events (type, data, ts) VALUES (?, ?, ?)",
      e.type,
      JSON.stringify(e.data),
      e.ts
    );

    // Get the sequence number of the inserted row
    // Note: 'last_insert_rowid()' is standard SQLite
    const result = this.sql.exec("SELECT last_insert_rowid() as id").one();
    return result ? (result.id as number) : 0;
  }

  listEvents(): AgentEvent[] {
    const cursor = this.sql.exec(
      `SELECT seq, type, data, ts FROM events ORDER BY seq ASC`
    );
    const out: AgentEvent[] = [];
    for (const r of cursor) {
      out.push({
        seq: r.seq as number,
        type: r.type as string,
        ts: r.ts as string,
        data: r.data ? JSON.parse(r.data as string) : {},
      });
    }
    return out;
  }

  private _mapRows(cursor: Iterable<any>): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const r of cursor) {
       out.push({
         role: r.role,
         content: r.content ? JSON.parse(r.content as string) : null,
         toolCalls: r.tool_calls ? JSON.parse(r.tool_calls as string) : undefined,
         toolCallId: r.tool_call_id || undefined,
         reasoning: r.reasoning_content || undefined,
       });
    }
    return out;
  }
}
