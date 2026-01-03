/**
 * Dashboard - ASCII metrics display
 * 
 * Old-school CRT-style graphs and stats.
 */
import { cn } from "../../lib/utils";

export interface DashboardMetrics {
  agents: { total: number; active: number; idle: number; error: number };
  runs: { today: number; week: number; successRate: number; hourlyData: number[] };
  schedules: { total: number; active: number; paused: number; nextRun?: string };
  tokens?: { today: number; week: number; dailyData: number[] };
  responseTime?: { avg: number; p95: number; recentData: number[] };
  memory?: { disks: number; totalEntries: number };
}

interface DashboardProps {
  metrics: DashboardMetrics;
}

// ASCII bar using block characters
function AsciiBar({ value, max, width = 10 }: { value: number; max: number; width?: number }) {
  const filled = Math.round((value / Math.max(max, 1)) * width);
  const empty = width - filled;
  return (
    <span className="font-mono">
      <span className="text-white/70">{"█".repeat(Math.max(0, filled))}</span>
      <span className="text-white/20">{"░".repeat(Math.max(0, empty))}</span>
    </span>
  );
}

// ASCII sparkline using block characters of varying heights
// Characters: ▁▂▃▄▅▆▇█ (8 levels)
function AsciiSparkline({ data }: { data: number[] }) {
  if (data.length === 0) return <span className="text-white/20">—</span>;
  
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const max = Math.max(...data, 1);
  
  return (
    <span className="font-mono text-white/50">
      {data.slice(-12).map((value, i) => {
        const level = Math.floor((value / max) * 7);
        return <span key={i}>{blocks[Math.min(level, 7)]}</span>;
      })}
    </span>
  );
}

// Percentage display with color
function Percentage({ value }: { value: number }) {
  const color = value >= 90 ? "text-emerald-400/70" : value >= 70 ? "text-amber-400/70" : "text-red-400/70";
  return <span className={cn("font-mono", color)}>{value}%</span>;
}

// Duration display
function Duration({ ms }: { ms: number }) {
  if (ms < 1000) return <span className="font-mono">{ms}ms</span>;
  return <span className="font-mono">{(ms / 1000).toFixed(1)}s</span>;
}

// Stat box component - compact version
function StatBox({
  label,
  value,
  subValue,
  children,
  compact = false,
}: {
  label: string;
  value: React.ReactNode;
  subValue?: string;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      "border border-white/20",
      compact ? "p-2 min-w-[110px]" : "p-3 min-w-[140px]"
    )}>
      <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">
        {label}
      </div>
      <div className={cn("font-mono text-white/90", compact ? "text-base" : "text-lg")}>
        {value}
      </div>
      {subValue && (
        <div className="text-[10px] text-white/40 mt-0.5">{subValue}</div>
      )}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function Dashboard({ metrics }: DashboardProps) {
  const { agents, runs, schedules, tokens, responseTime, memory } = metrics;
  
  // Calculate agent breakdown
  const agentBreakdown = agents.total > 0
    ? `${agents.active}↑ ${agents.idle}○ ${agents.error}✕`
    : "—";

  return (
    <div className="p-4 border-b border-white/10">
      {/* Section header */}
      <div className="text-[9px] uppercase tracking-widest text-white/30 mb-3">
        DASHBOARD
      </div>

      {/* Metrics grid - responsive */}
      <div className="flex flex-wrap gap-2">
        {/* Agents */}
        <StatBox
          label="AGENTS"
          value={agents.total}
          subValue={agentBreakdown}
        >
          <AsciiBar value={agents.active} max={agents.total || 1} width={8} />
          <span className="text-[9px] text-white/30 ml-2">active</span>
        </StatBox>

        {/* Runs today */}
        <StatBox
          label="RUNS"
          value={runs.today}
          subValue={`${runs.week}/wk`}
        >
          <AsciiSparkline data={runs.hourlyData} />
        </StatBox>

        {/* Success rate */}
        <StatBox
          label="SUCCESS"
          value={<Percentage value={runs.successRate} />}
          compact
        >
          <AsciiBar value={runs.successRate} max={100} width={8} />
        </StatBox>

        {/* Schedules */}
        <StatBox
          label="SCHEDULES"
          value={schedules.total}
          subValue={schedules.nextRun ? `next: ${schedules.nextRun}` : undefined}
          compact
        >
          <span className="text-[10px] font-mono">
            <span className="text-emerald-400/60">●</span>{schedules.active}
            <span className="text-white/20 mx-1">|</span>
            <span className="text-amber-400/60">◐</span>{schedules.paused}
          </span>
        </StatBox>

        {/* Response time (if available) */}
        {responseTime && (
          <StatBox
            label="RESP TIME"
            value={<Duration ms={responseTime.avg} />}
            subValue={`p95: ${responseTime.p95}ms`}
            compact
          >
            <AsciiSparkline data={responseTime.recentData} />
          </StatBox>
        )}

        {/* Tokens (if available) */}
        {tokens && (
          <StatBox
            label="TOKENS"
            value={formatNumber(tokens.today)}
            subValue={`${formatNumber(tokens.week)}/wk`}
            compact
          >
            <AsciiSparkline data={tokens.dailyData} />
          </StatBox>
        )}

        {/* Memory disks (if available) */}
        {memory && (
          <StatBox
            label="MEMORY"
            value={memory.disks}
            subValue={`${memory.totalEntries} entries`}
            compact
          />
        )}
      </div>
    </div>
  );
}

// Format large numbers with K/M suffix
function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default Dashboard;
