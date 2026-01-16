/**
 * Shared type definitions for the UI components
 */
import type { AgentBlueprint, AgentEvent, AgentSchedule, ChatMessage, ToolCall as APIToolCall } from "agents-hub/client";

// Re-export client types for convenience
export type { AgentBlueprint, AgentEvent, AgentSchedule, ChatMessage, APIToolCall };

// Agency metadata
export interface AgencyMeta {
  id: string;
  name: string;
  createdAt: string;
}

// Agent summary for listings
export interface AgentSummary {
  id: string;
  agentType: string;
  createdAt: string;
}

// Schedule summary for sidebar
export interface ScheduleSummary {
  id: string;
  name?: string;
  agentType: string;
  status: "active" | "paused";
  type: "once" | "cron" | "interval";
}

// Agent status types
export type AgentStatus = "running" | "paused" | "done" | "error" | "idle";

// Tab IDs for agent views
export type TabId = "chat" | "trace" | "files" | "todos";

// Tool call display type
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "running" | "done" | "error";
}

// Message type for ChatView
export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
  reasoning?: string;
}

// Todo item type
export type TodoStatus = "pending" | "in_progress" | "done" | "blocked";
export type TodoPriority = "low" | "medium" | "high";

export interface Todo {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  priority: TodoPriority;
  createdAt: string;
  completedAt?: string;
}

// Dashboard metrics
export interface DashboardMetrics {
  agents: { total: number; active: number; idle: number; error: number };
  runs: { today: number; week: number; successRate: number; hourlyData: number[] };
  schedules: { total: number; active: number; paused: number; nextRun?: string };
  tokens?: { today: number; week: number; dailyData: number[] };
  responseTime?: { avg: number; p95: number; recentData: number[] };
  memory?: { disks: number; totalEntries: number };
}

// Memory disk type
export interface MemoryDisk {
  name: string;
  description?: string;
  size?: number;
}
