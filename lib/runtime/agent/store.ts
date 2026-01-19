import type { SqlStorage } from "@cloudflare/workers-types";
import type { AgentEvent } from "../events";
import type { AgentProjection, ProjectionSnapshot } from "./projections";

export class Store {
  constructor(private sql: SqlStorage) {}

  init() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data JSON NOT NULL,
        ts TEXT NOT NULL
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

  // ==========================================================================
  // Events (source of truth)
  // ==========================================================================

  /**
   * Add a single event.
   * Returns the assigned sequence number.
   */
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

  /**
   * Add multiple events in a batch.
   * Events are assigned new sequence numbers (original seq is ignored).
   */
  addEvents(events: AgentEvent[]): number {
    if (!events.length) return 0;

    const PARAMS_PER_ROW = 3;
    const MAX_PARAMS = 100;
    const CHUNK_SIZE = Math.floor(MAX_PARAMS / PARAMS_PER_ROW);

    let totalInserted = 0;

    for (let i = 0; i < events.length; i += CHUNK_SIZE) {
      const chunk = events.slice(i, i + CHUNK_SIZE);
      const placeholders: string[] = [];
      const bindings: unknown[] = [];

      for (const e of chunk) {
        placeholders.push(`(?, ?, ?)`);
        bindings.push(e.type);
        bindings.push(JSON.stringify(e.data));
        bindings.push(e.ts);
      }

      const query = `INSERT INTO events (type, data, ts) VALUES ${placeholders.join(", ")}`;
      this.sql.exec(query, ...bindings);
      totalInserted += chunk.length;
    }

    return totalInserted;
  }

  /**
   * List all events in sequence order.
   */
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
   */
  getEventCount(): number {
    const result = this.sql.exec("SELECT COUNT(*) as count FROM events").toArray()[0];
    return result ? (result.count as number) : 0;
  }

  // ==========================================================================
  // Projection Snapshots (for efficient event replay)
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
