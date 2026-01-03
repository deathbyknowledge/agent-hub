/**
 * CommandCenter - Dashboard-first layout
 * 
 * Industrial retro-computing aesthetic with ASCII metrics.
 * Main view is a dashboard, activity feed is secondary.
 * Settings shown inline when CFG is clicked.
 */
import { useState, useCallback } from "react";
import { Header } from "./Header";
import { AgentPanel } from "./AgentPanel";
import { Dashboard } from "./Dashboard";
import { ActivityFeed, type ActivityItem } from "./ActivityFeed";
import { CommandInput } from "./CommandInput";
import { TraceModal } from "./TraceModal";
import { SettingsView } from "../SettingsView";
import type { AgentBlueprint, AgentEvent, AgentSchedule, ScheduleRun, CreateScheduleRequest, PluginInfo, ToolInfo } from "agent-hub/client";

// Types
export interface AgentSummary {
  id: string;
  agentType: string;
  createdAt: string;
}

export interface AgencyMeta {
  id: string;
  name: string;
  createdAt: string;
}

export interface ScheduleSummary {
  id: string;
  name?: string;
  agentType: string;
  status: "active" | "paused";
  type: "once" | "cron" | "interval";
}

export interface DashboardMetrics {
  agents: { total: number; active: number; idle: number; error: number };
  runs: { today: number; week: number; successRate: number; hourlyData: number[] };
  schedules: { total: number; active: number; paused: number };
  tokens?: { today: number; week: number; dailyData: number[] };
  responseTime?: { avg: number; p95: number; recentData: number[] };
  memory?: { disks: number; totalEntries: number };
}

export interface MemoryDisk {
  name: string;
  description?: string;
  size?: number;
}

type ViewMode = "dashboard" | "settings";

interface CommandCenterProps {
  // Data
  agencies: AgencyMeta[];
  selectedAgencyId: string | null;
  agents: AgentSummary[];
  blueprints: AgentBlueprint[];
  schedules: AgentSchedule[];
  agentStatus: Record<string, "running" | "paused" | "done" | "error" | "idle">;
  activityItems: ActivityItem[];
  metrics: DashboardMetrics;
  vars: Record<string, unknown>;
  memoryDisks: MemoryDisk[];
  plugins: PluginInfo[];
  tools: ToolInfo[];
  
  // For trace modal
  getAgentEvents: (agentId: string) => Promise<AgentEvent[]>;
  
  // Actions
  onSelectAgency: (id: string) => void;
  onCreateAgency: (name?: string) => void;
  onSendMessage: (target: string, message: string) => Promise<void>;
  onCreateAgent: (blueprintName: string) => Promise<void>;
  
  // Settings actions
  onCreateSchedule: (request: CreateScheduleRequest) => Promise<AgentSchedule>;
  onDeleteSchedule: (id: string) => Promise<unknown>;
  onPauseSchedule: (id: string) => Promise<unknown>;
  onResumeSchedule: (id: string) => Promise<unknown>;
  onTriggerSchedule: (id: string) => Promise<ScheduleRun>;
  onGetScheduleRuns: (id: string) => Promise<ScheduleRun[]>;
  onRefreshSchedules: () => Promise<unknown>;
  onSetVar: (key: string, value: unknown) => Promise<unknown>;
  onDeleteVar: (key: string) => Promise<unknown>;
  onCreateMemoryDisk: (name: string, description?: string, entries?: string[]) => Promise<unknown>;
  onImportMemoryDisk: (file: File) => Promise<unknown>;
  onDeleteMemoryDisk: (name: string) => Promise<unknown>;
  onRefreshMemoryDisks: () => Promise<unknown>;
  onCreateBlueprint: (blueprint: Omit<AgentBlueprint, "createdAt" | "updatedAt">) => Promise<unknown>;
  onUpdateBlueprint: (blueprint: AgentBlueprint) => Promise<unknown>;
  onDeleteBlueprint: (name: string) => Promise<unknown>;
  onTestBlueprint: (name: string) => Promise<unknown>;
  listDirectory: (path: string) => Promise<{ entries: { path: string; type: "file" | "dir"; size?: number; modified?: string }[] }>;
  readFile: (path: string) => Promise<{ content: string }>;
  writeFile: (path: string, content: string) => Promise<unknown>;
  deleteFile: (path: string) => Promise<unknown>;
  onDeleteAgency: () => void;
  
  // State
  isLoading?: boolean;
  
  // Layout toggle
  onToggleLayout?: () => void;
}

export function CommandCenter({
  agencies,
  selectedAgencyId,
  agents,
  blueprints,
  schedules,
  agentStatus,
  activityItems,
  metrics,
  vars,
  memoryDisks,
  plugins,
  tools,
  getAgentEvents,
  onSelectAgency,
  onCreateAgency,
  onSendMessage,
  onCreateAgent,
  onCreateSchedule,
  onDeleteSchedule,
  onPauseSchedule,
  onResumeSchedule,
  onTriggerSchedule,
  onGetScheduleRuns,
  onRefreshSchedules,
  onSetVar,
  onDeleteVar,
  onCreateMemoryDisk,
  onImportMemoryDisk,
  onDeleteMemoryDisk,
  onRefreshMemoryDisks,
  onCreateBlueprint,
  onUpdateBlueprint,
  onDeleteBlueprint,
  onTestBlueprint,
  listDirectory,
  readFile,
  writeFile,
  deleteFile,
  onDeleteAgency,
  isLoading = false,
  onToggleLayout,
}: CommandCenterProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [lastTarget, setLastTarget] = useState<string>("_agency-mind");
  
  // Modal state for trace view
  const [traceModal, setTraceModal] = useState<{
    agentId: string;
    agentType: string;
  } | null>(null);

  // Build mention targets for autocomplete
  // Order: Mind, NEW blueprints, then existing agents
  const mentionTargets = [
    { id: "_agency-mind", label: "agency-mind", type: "mind" as const },
    // NEW blueprints first (spawn new agents)
    ...blueprints
      .filter((b) => !b.name.startsWith("_"))
      .map((b) => ({
        id: `new:${b.name}`,
        label: `new ${b.name}`,
        type: "blueprint" as const,
      })),
    // Then existing agents
    ...agents
      .filter((a) => !a.agentType.startsWith("_"))
      .map((a) => ({
        id: a.id,
        label: a.agentType,
        type: "agent" as const,
      })),
  ];

  // Convert schedules to summary format for AgentPanel
  const scheduleSummaries = schedules.map((s) => ({
    id: s.id,
    name: s.name,
    agentType: s.agentType,
    status: (s.status === "paused" ? "paused" : "active") as "active" | "paused",
    type: s.type as "once" | "cron" | "interval",
  }));

  // Handle command submission
  const handleCommand = useCallback(
    async (target: string, message: string) => {
      setLastTarget(target);
      
      if (target.startsWith("new:")) {
        const blueprintName = target.slice(4);
        await onCreateAgent(blueprintName);
        return;
      }
      
      await onSendMessage(target, message);
    },
    [onSendMessage, onCreateAgent]
  );

  // Handle agent click - open trace modal
  const handleAgentClick = useCallback((agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (agent) {
      setTraceModal({ agentId, agentType: agent.agentType });
    }
  }, [agents]);

  // Handle activity item click - open trace modal
  const handleActivityClick = useCallback((item: ActivityItem) => {
    if (item.agentId) {
      setTraceModal({
        agentId: item.agentId,
        agentType: item.agentType || "agent",
      });
    }
  }, []);

  // Toggle settings view
  const handleToggleSettings = useCallback(() => {
    setViewMode((prev) => prev === "settings" ? "dashboard" : "settings");
  }, []);

  const selectedAgency = agencies.find((a) => a.id === selectedAgencyId);

  return (
    <div className="h-screen flex flex-col bg-black text-white font-mono">
      {/* Header */}
      <Header
        agencies={agencies}
        selectedAgencyId={selectedAgencyId}
        onSelectAgency={onSelectAgency}
        onCreateAgency={onCreateAgency}
        onOpenSettings={handleToggleSettings}
        isSettingsActive={viewMode === "settings"}
        onToggleLayout={onToggleLayout}
      />

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Left Panel - Agents & Schedules */}
        <AgentPanel
          agents={agents}
          schedules={scheduleSummaries}
          agentStatus={agentStatus}
          onAgentClick={handleAgentClick}
          onCreateAgent={() => {
            const bp = blueprints.find((b) => !b.name.startsWith("_"));
            if (bp) onCreateAgent(bp.name);
          }}
          onScheduleClick={() => {}}
          onCreateSchedule={() => {}}
          isLoading={isLoading}
        />

        {/* Main Area */}
        <div className="flex-1 flex flex-col min-w-0 border-l border-white/20">
          {viewMode === "settings" ? (
            /* Settings View */
            <div className="flex-1 overflow-hidden">
              <SettingsView
                agencyId={selectedAgencyId}
                agencyName={selectedAgency?.name}
                blueprints={blueprints}
                schedules={schedules}
                vars={vars}
                memoryDisks={memoryDisks}
                onCreateSchedule={onCreateSchedule}
                onDeleteSchedule={onDeleteSchedule}
                onPauseSchedule={onPauseSchedule}
                onResumeSchedule={onResumeSchedule}
                onTriggerSchedule={onTriggerSchedule}
                onGetScheduleRuns={onGetScheduleRuns}
                onRefreshSchedules={onRefreshSchedules}
                onSetVar={onSetVar}
                onDeleteVar={onDeleteVar}
                onCreateMemoryDisk={onCreateMemoryDisk}
                onImportMemoryDisk={onImportMemoryDisk}
                onDeleteMemoryDisk={onDeleteMemoryDisk}
                onRefreshMemoryDisks={onRefreshMemoryDisks}
                onCreateBlueprint={onCreateBlueprint}
                onUpdateBlueprint={onUpdateBlueprint}
                onDeleteBlueprint={onDeleteBlueprint}
                onTestBlueprint={onTestBlueprint}
                plugins={plugins}
                tools={tools}
                listDirectory={listDirectory}
                readFile={readFile}
                writeFile={writeFile}
                deleteFile={deleteFile}
                onDeleteAgency={onDeleteAgency}
              />
            </div>
          ) : (
            /* Dashboard + Activity View */
            <>
              {/* Dashboard metrics */}
              <Dashboard metrics={metrics} />
              
              {/* Activity Feed */}
              <div className="flex-1 min-h-0 border-t border-white/10">
                <ActivityFeed
                  items={activityItems}
                  onItemClick={handleActivityClick}
                />
              </div>
              
              {/* Command Input */}
              <CommandInput
                targets={mentionTargets}
                defaultTarget={lastTarget}
                onSubmit={handleCommand}
                disabled={!selectedAgencyId}
                placeholder={
                  selectedAgencyId
                    ? "Type a message... (@ to mention)"
                    : "Select an agency to start"
                }
              />
            </>
          )}
        </div>
      </div>

      {/* Trace Modal */}
      {traceModal && selectedAgencyId && (
        <TraceModal
          agencyId={selectedAgencyId}
          agentId={traceModal.agentId}
          agentType={traceModal.agentType}
          getEvents={getAgentEvents}
          onClose={() => setTraceModal(null)}
        />
      )}
    </div>
  );
}

export default CommandCenter;
