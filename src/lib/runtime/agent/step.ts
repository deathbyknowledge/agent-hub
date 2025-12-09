import type { AgentPlugin, PluginContext } from "../types";
import { ModelPlanBuilder } from "../plan";

export async function step(
  plugins: AgentPlugin[],
  ctx: PluginContext
): Promise<void> {
  for (const p of plugins) await p.onTick?.(ctx);

  const plan = new ModelPlanBuilder(ctx.agent);
  for (const p of plugins) await p.beforeModel?.(ctx, plan);

  if (ctx.agent.isPaused) return;

  const req = plan.build();
  const res = await ctx.provider.invoke(req, {});

  for (const p of plugins) await p.onModelResult?.(ctx, res);

  ctx.agent.store.appendMessages([res.message]);

  const newToolCalls =
    res.message && "toolCalls" in res.message && res.message.toolCalls
      ? res.message.toolCalls
      : [];
  ctx.agent.info.pendingToolCalls = newToolCalls;
}
