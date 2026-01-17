import type { SqlStorage } from "@cloudflare/workers-types";
import type { ChatMessage } from "../types";
import type { AgentEvent } from "../events";
import type { AgentProjection, ProjectionSnapshot } from "./projections";

export type ContextCheckpoint = {
  id: number;
  summary: string;
  messagesStartSeq: number;
  messagesEndSeq: number;
  archivedPath?: string;
  createdAt: number;
};

export class Store {
  constructor(private sql: SqlStorage) {}

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
      
      CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);

      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data JSON NOT NULL,
        ts TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS context_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary TEXT NOT NULL,
        messages_start_seq INTEGER NOT NULL,
        messages_end_seq INTEGER NOT NULL,
        archived_path TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projection_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        last_event_seq INTEGER NOT NULL,
        state JSON NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_last_event_seq 
        ON projection_snapshots(last_event_seq DESC);
    `);
  }

  add(input: ChatMessage | ChatMessage[]): void {
    const msgs = Array.isArray(input) ? input : [input];
    if (!msgs.length) return;

    const now = Date.now();
    const PARAMS_PER_ROW = 6;
    const MAX_PARAMS = 100;
    const CHUNK_SIZE = Math.floor(MAX_PARAMS / PARAMS_PER_ROW);

    const toJSON = (v: unknown) =>
      v === undefined || v === null ? null : JSON.stringify(v);

    for (let i = 0; i < msgs.length; i += CHUNK_SIZE) {
      const chunk = msgs.slice(i, i + CHUNK_SIZE);
      const placeholders: string[] = [];
      const bindings: unknown[] = [];

      for (const m of chunk) {
        placeholders.push(`(?, ?, ?, ?, ?, ?)`);
        bindings.push(m.role);
        bindings.push(toJSON("content" in m ? m.content : undefined));
        bindings.push(toJSON("toolCalls" in m ? m.toolCalls : undefined));
        bindings.push("toolCallId" in m ? m.toolCallId : null);
        bindings.push("reasoning" in m ? m.reasoning : null);
        bindings.push(now);
      }

      const query = `
        INSERT INTO messages (
          role, content, tool_calls, tool_call_id, reasoning_content, created_at
        ) VALUES ${placeholders.join(", ")}
      `;

      this.sql.exec(query, ...bindings);
    }
  }

  getContext(limit = 100): ChatMessage[] {
    const cursor = this.sql.exec(`
      SELECT * FROM (
        SELECT seq, role, content, tool_calls, tool_call_id, reasoning_content, created_at
        FROM messages 
        ORDER BY seq DESC 
        LIMIT ?
      ) ORDER BY seq ASC
    `, limit);

    return this._mapRows(cursor);
  }

  lastAssistant(): ChatMessage | null {
    const cursor = this.sql.exec(`
      SELECT role, content, tool_calls, tool_call_id, reasoning_content, created_at
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
      ts: row.created_at ? new Date(row.created_at as number).toISOString() : undefined,
    };
  }

  addEvent(e: AgentEvent): number {
    this.sql.exec(
      "INSERT INTO events (type, data, ts) VALUES (?, ?, ?)",
      e.type,
      JSON.stringify(e.data),
      e.ts
    );

    const result = this.sql.exec("SELECT last_insert_rowid() as id").toArray()[0];
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
         ts: r.created_at ? new Date(r.created_at as number).toISOString() : undefined,
       });
    }
    return out;
  }

  getMessageCount(): number {
    const result = this.sql.exec("SELECT COUNT(*) as count FROM messages").toArray()[0];
    return result ? (result.count as number) : 0;
  }

  getMessagesAfter(afterSeq: number, limit = 1000): ChatMessage[] {
    const cursor = this.sql.exec(
      `SELECT seq, role, content, tool_calls, tool_call_id, reasoning_content, created_at
       FROM messages 
       WHERE seq > ?
       ORDER BY seq ASC
       LIMIT ?`,
      afterSeq,
      limit
    );
    return this._mapRows(cursor);
  }

  getMessagesInRange(startSeq: number, endSeq: number): ChatMessage[] {
    const cursor = this.sql.exec(
      `SELECT seq, role, content, tool_calls, tool_call_id, reasoning_content, created_at
       FROM messages 
       WHERE seq >= ? AND seq <= ?
       ORDER BY seq ASC`,
      startSeq,
      endSeq
    );
    return this._mapRows(cursor);
  }

  getLatestCheckpoint(): ContextCheckpoint | null {
    const result = this.sql.exec(
      `SELECT id, summary, messages_start_seq, messages_end_seq, archived_path, created_at
       FROM context_checkpoints
       ORDER BY id DESC
       LIMIT 1`
    ).toArray()[0];

    if (!result) return null;

    return {
      id: result.id as number,
      summary: result.summary as string,
      messagesStartSeq: result.messages_start_seq as number,
      messagesEndSeq: result.messages_end_seq as number,
      archivedPath: result.archived_path as string | undefined,
      createdAt: result.created_at as number,
    };
  }

  addCheckpoint(
    summary: string,
    messagesStartSeq: number,
    messagesEndSeq: number,
    archivedPath?: string
  ): number {
    this.sql.exec(
      `INSERT INTO context_checkpoints 
       (summary, messages_start_seq, messages_end_seq, archived_path, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      summary,
      messagesStartSeq,
      messagesEndSeq,
      archivedPath ?? null,
      Date.now()
    );

    const result = this.sql.exec("SELECT last_insert_rowid() as id").toArray()[0];
    return result ? (result.id as number) : 0;
  }

  deleteMessagesBefore(beforeSeq: number): number {
    this.sql.exec("DELETE FROM messages WHERE seq <= ?", beforeSeq);
    const result = this.sql.exec("SELECT changes() as deleted").toArray()[0];
    return result ? (result.deleted as number) : 0;
  }

  getMaxMessageSeq(): number {
    const result = this.sql.exec("SELECT MAX(seq) as max_seq FROM messages").toArray()[0];
    return result?.max_seq ? (result.max_seq as number) : 0;
  }

  getCheckpointCount(): number {
    const result = this.sql.exec("SELECT COUNT(*) as count FROM context_checkpoints").toArray()[0];
    return result ? (result.count as number) : 0;
  }

  // ==========================================================================
  // Projection Snapshots (for event sourcing)
  // ==========================================================================

  /**
   * Add a projection snapshot.
   * Snapshots capture the projected state at a point in time for fast replay.
   */
  addSnapshot(snapshot: ProjectionSnapshot): number {
    this.sql.exec(
      `INSERT INTO projection_snapshots (last_event_seq, state, created_at)
       VALUES (?, ?, ?)`,
      snapshot.lastEventSeq,
      JSON.stringify(snapshot.state),
      snapshot.createdAt
    );

    const result = this.sql.exec("SELECT last_insert_rowid() as id").toArray()[0];
    return result ? (result.id as number) : 0;
  }

  /**
   * Get the latest projection snapshot.
   */
  getLatestSnapshot(): ProjectionSnapshot | null {
    const result = this.sql.exec(
      `SELECT id, last_event_seq, state, created_at
       FROM projection_snapshots
       ORDER BY last_event_seq DESC
       LIMIT 1`
    ).toArray()[0];

    if (!result) return null;

    return {
      lastEventSeq: result.last_event_seq as number,
      state: JSON.parse(result.state as string) as AgentProjection,
      createdAt: result.created_at as string,
    };
  }

  /**
   * Get a snapshot at or before a specific event sequence.
   * Useful for time-travel to a specific point.
   */
  getSnapshotAt(beforeSeq: number): ProjectionSnapshot | null {
    const result = this.sql.exec(
      `SELECT id, last_event_seq, state, created_at
       FROM projection_snapshots
       WHERE last_event_seq <= ?
       ORDER BY last_event_seq DESC
       LIMIT 1`,
      beforeSeq
    ).toArray()[0];

    if (!result) return null;

    return {
      lastEventSeq: result.last_event_seq as number,
      state: JSON.parse(result.state as string) as AgentProjection,
      createdAt: result.created_at as string,
    };
  }

  /**
   * Get events after a specific sequence number.
   * Used with snapshots to replay only recent events.
   */
  getEventsAfter(afterSeq: number): AgentEvent[] {
    const cursor = this.sql.exec(
      `SELECT seq, type, data, ts FROM events WHERE seq > ? ORDER BY seq ASC`,
      afterSeq
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

  /**
   * Get the maximum event sequence number.
   */
  getMaxEventSeq(): number {
    const result = this.sql.exec("SELECT MAX(seq) as max_seq FROM events").toArray()[0];
    return result?.max_seq ? (result.max_seq as number) : 0;
  }

  /**
   * Get the total number of events.
   * More efficient than listEvents().length.
   */
  getEventCount(): number {
    const result = this.sql.exec("SELECT COUNT(*) as count FROM events").toArray()[0];
    return result ? (result.count as number) : 0;
  }

  /**
   * Get the number of events since the last snapshot.
   */
  getEventsSinceLastSnapshot(): number {
    const snapshot = this.getLatestSnapshot();
    const lastSnapshotSeq = snapshot?.lastEventSeq ?? 0;
    const maxEventSeq = this.getMaxEventSeq();
    return maxEventSeq - lastSnapshotSeq;
  }

  /**
   * Delete old snapshots, keeping only the most recent N.
   */
  pruneSnapshots(keepCount = 3): number {
    this.sql.exec(
      `DELETE FROM projection_snapshots
       WHERE id NOT IN (
         SELECT id FROM projection_snapshots
         ORDER BY last_event_seq DESC
         LIMIT ?
       )`,
      keepCount
    );
    const result = this.sql.exec("SELECT changes() as deleted").toArray()[0];
    return result ? (result.deleted as number) : 0;
  }
}
