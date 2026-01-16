// Core UI components
export { Button } from "./Button";
export { Select } from "./Select";
export { LayerCard, LayerCardContent, LayerCardFooter } from "./LayerCard";

// Layout components
export { ContentHeader } from "./ContentHeader";
export { TopHeader } from "./TopHeader";
export { TabBar, type OpenTab } from "./TabBar";
export { CommandPalette } from "./CommandPalette";
export { AgentPanel } from "./AgentPanel";
export { BottomPanel } from "./BottomPanel";

// View components
export { ChatView } from "./ChatView";
export { TraceView } from "./TraceView";
export { FilesView } from "./FilesView";
export { TodosView } from "./TodosView";
export { SettingsView } from "./SettingsView";

// Modal components
export { ConfirmModal } from "./ConfirmModal";
export { BlueprintEditor } from "./BlueprintEditor";
export { VarEditor } from "./VarEditor";

// Error handling
export { ErrorBoundary } from "./ErrorBoundary";

// Toast notifications
export { ToastProvider, useToast } from "./Toast";

// Re-export types from shared
export type {
  AgencyMeta,
  AgentSummary,
  ScheduleSummary,
  AgentStatus,
  TabId,
  Message,
  ToolCall,
  Todo,
  DashboardMetrics,
  MemoryDisk,
} from "./shared";

// Re-export TraceView types
export type { AgentEvent, ThreadMeta, TraceViewProps } from "./TraceView";
