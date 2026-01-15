import { getAgentByName } from "agents";
import { tool, z } from "../tools";
import { AgentEventType } from "../events";
import type { AgentPlugin } from "../types";

const SubagentEventType = {
  SPAWNED: "subagent.spawned",
  COMPLETED: "subagent.completed",
  MESSAGED: "subagent.messaged",
} as const;

const TaskParams = z.object({
  description: z.string().describe("Task description for the subagent"),
  subagentType: z.string().describe("Type of subagent to spawn"),
});

const MessageAgentParams = z.object({
  agentId: z.string().describe("The agentId from a previous task result"),
  message: z.string().describe("Follow-up message to send to the agent"),
});

type SubagentRef = {
  name: string;
  description: string;
};

function renderOtherAgents(subagents: SubagentRef[]) {
  return subagents.map((a) => `- ${a.name}: ${a.description}`).join("\n");
}

export const subagents: AgentPlugin = {
  name: "subagents",

  async onInit(ctx) {
    // Create our own tables for tracking subagents
    ctx.agent.sqlite`
      CREATE TABLE IF NOT EXISTS mw_waiting_subagents (
        token TEXT PRIMARY KEY,
        child_thread_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mw_subagent_links (
        child_thread_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        agent_type TEXT,
        status TEXT NOT NULL CHECK(status IN ('waiting','completed','canceled')),
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        report TEXT,
        tool_call_id TEXT
      );
    `;
  },

  actions: {
    async subagent_result(ctx, payload: unknown) {
      const { token, childThreadId, report } = payload as {
        token: string;
        childThreadId: string;
        report?: string;
      };

      const sql = ctx.agent.sqlite;

      // Pop waiter
      const rows = sql`SELECT tool_call_id FROM mw_waiting_subagents WHERE token = ${token} AND child_thread_id = ${childThreadId}`;
      if (!rows.length) {
        throw new Error("unknown token");
      }

      const toolCallId = String(rows[0].tool_call_id);
      sql`DELETE FROM mw_waiting_subagents WHERE token = ${token}`;

      // Update link status
      sql`UPDATE mw_subagent_links SET status='completed', completed_at=${Date.now()}, report=${report ?? null} WHERE child_thread_id = ${childThreadId}`;

      // Append tool result with agentId for follow-up capability
      const result = JSON.stringify({
        agentId: childThreadId,
        result: report ?? "",
      });
      ctx.agent.store.add({ role: "tool", toolCallId, content: result });

      ctx.agent.emit(SubagentEventType.COMPLETED, {
        childThreadId,
        result: report,
      });

      // Check if all done
      const remaining = sql`SELECT COUNT(*) as c FROM mw_waiting_subagents`;

      if (Number(remaining[0]?.c ?? 0) === 0) {
        ctx.agent.runState.status = "running";
        ctx.agent.runState.reason = undefined;
        ctx.agent.emit(AgentEventType.AGENT_RESUMED, {});
        await ctx.agent.ensureScheduled();
      }

      return { ok: true };
    },

    async cancel_subagents(ctx) {
      const sql = ctx.agent.sqlite;
      const waiters = sql`SELECT token, child_thread_id FROM mw_waiting_subagents`;

      for (const w of waiters) {
        try {
          const childAgent = await getAgentByName(
            ctx.agent.exports.HubAgent,
            String(w.child_thread_id)
          );
          // Send cancel action to child
          await childAgent.fetch(
            new Request("http://do/action", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ type: "cancel" }),
            })
          );
        } catch (e) {
          console.error(`Failed to cancel subagent ${w.child_thread_id}:`, e);
        }

        // Mark as canceled
        sql`UPDATE mw_subagent_links SET status='canceled', completed_at=${Date.now()} WHERE child_thread_id = ${w.child_thread_id}`;
      }

      // Clear all waiters
      sql`DELETE FROM mw_waiting_subagents`;

      return { ok: true };
    },
  },

  state(ctx) {
    // Expose subagent links in agent state
    const sql = ctx.agent.sqlite;
    const rows = sql`SELECT child_thread_id, token, agent_type, status, created_at, completed_at, report, tool_call_id
         FROM mw_subagent_links ORDER BY created_at ASC`;

    const subagents = rows.map((r) => ({
      childThreadId: String(r.child_thread_id),
      token: String(r.token ?? ""),
      agentType: r.agent_type ? String(r.agent_type) : undefined,
      status: String(r.status),
      createdAt: Number(r.created_at ?? Date.now()),
      completedAt: r.completed_at ? Number(r.completed_at) : undefined,
      report: r.report ? String(r.report) : undefined,
      toolCallId: r.tool_call_id ? String(r.tool_call_id) : undefined,
    }));

    return { subagents };
  },

  async beforeModel(ctx, plan) {
    plan.addSystemPrompt(TASK_SYSTEM_PROMPT);
    const subagentsConfig = ctx.agent.vars.SUBAGENTS as
      | SubagentRef[]
      | undefined;
    const otherAgents = renderOtherAgents(subagentsConfig ?? []);
    const taskDesc = TASK_TOOL_DESCRIPTION.replace(
      "{other_agents}",
      otherAgents
    );

    const taskTool = tool({
      name: "task",
      description: taskDesc,
      inputSchema: TaskParams,
      execute: async (p, toolCtx) => {
        const { description, subagentType } = p;
        const token = crypto.randomUUID();
        const sql = ctx.agent.sqlite;
        const parentAgentId = ctx.agent.info.threadId;
        const vars = toolCtx.agent.vars;

        // Spawn child through Agency (creates parent-child relationship)
        const agency = await getAgentByName(
          toolCtx.agent.exports.Agency,
          ctx.agent.info.agencyId
        );

        const spawnRes = await agency.fetch(
          new Request("http://do/agents", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              agentType: subagentType,
              requestContext: ctx.agent.info.request,
              relatedAgentId: parentAgentId,
            }),
          })
        );

        if (!spawnRes.ok) {
          return "Error: Failed to spawn subagent";
        }

        const spawnData = (await spawnRes.json()) as { id: string };
        const childId = spawnData.id;

        // Get stub for the newly spawned child to invoke it
        const subagent = await getAgentByName(
          toolCtx.agent.exports.HubAgent,
          childId
        );

        // Invoke with parent info in vars
        const invokeRes = await subagent.fetch(
          new Request("http://do/invoke", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messages: [{ role: "user", content: String(description ?? "") }],
              vars: {
                ...vars,
                parent: {
                  threadId: parentAgentId,
                  token,
                },
              },
            }),
          })
        );

        if (!invokeRes.ok) {
          return "Error: Failed to invoke subagent";
        }

        // Fire event
        ctx.agent.emit(SubagentEventType.SPAWNED, {
          childThreadId: childId,
          agentType: subagentType,
          toolCallId: toolCtx.callId,
        });

        // Record in our tables
        sql`INSERT INTO mw_waiting_subagents (token, child_thread_id, tool_call_id, created_at)
           VALUES (${token}, ${childId}, ${toolCtx.callId}, ${Date.now()})`;

        sql`INSERT INTO mw_subagent_links (child_thread_id, token, agent_type, status, created_at, tool_call_id)
           VALUES (${childId}, ${token}, ${subagentType}, 'waiting', ${Date.now()}, ${toolCtx.callId})`;

        // Pause the parent
        const runState = ctx.agent.runState;
        if (runState && runState.status === "running") {
          runState.status = "paused";
          runState.reason = "subagent";
          ctx.agent.emit(AgentEventType.AGENT_PAUSED, {
            reason: "subagent",
          });
        }

        return null; // Don't add tool result yet - will come from subagent_result action
      },
    });

    ctx.registerTool(taskTool);

    // message_agent tool - send follow-up to existing subagent
    const messageAgentTool = tool({
      name: "message_agent",
      description: `Send a follow-up message to a subagent you previously spawned via the task tool.
Use this when you need to continue a conversation with a specific agent that already has context from prior interactions.
The agentId is returned in the result object of the task tool (e.g., {"agentId": "...", "result": "..."}).`,
      inputSchema: MessageAgentParams,
      execute: async ({ agentId, message }, toolCtx) => {
        const sql = ctx.agent.sqlite;

        // Verify this is our child
        const link = sql`SELECT status, agent_type FROM mw_subagent_links WHERE child_thread_id = ${agentId}`;

        if (!link.length) {
          return "Error: Unknown agent ID. Make sure this is an agentId from a previous task result.";
        }

        const token = crypto.randomUUID();

        // Update tracking - reuse the link but new token
        sql`INSERT INTO mw_waiting_subagents (token, child_thread_id, tool_call_id, created_at)
           VALUES (${token}, ${agentId}, ${toolCtx.callId}, ${Date.now()})`;

        sql`UPDATE mw_subagent_links 
           SET status = 'waiting', token = ${token}, tool_call_id = ${toolCtx.callId}
           WHERE child_thread_id = ${agentId}`;
        const agent = await getAgentByName(
          toolCtx.agent.exports.HubAgent,
          agentId
        );

        ctx.agent.emit(SubagentEventType.MESSAGED, {
          childThreadId: agentId,
          message,
        });

        const res = await agent.fetch(
          new Request("http://do/invoke", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messages: [{ role: "user", content: message }],
              vars: {
                parent: {
                  threadId: ctx.agent.info.threadId,
                  token,
                },
              },
            }),
          })
        );

        if (!res.ok) {
          return "Error: Failed to message agent";
        }

        // Pause parent
        const runState = ctx.agent.runState;
        if (runState && runState.status === "running") {
          runState.status = "paused";
          runState.reason = "subagent";
          ctx.agent.emit(AgentEventType.AGENT_PAUSED, { reason: "subagent" });
        }

        return null; // Result comes via subagent_result action
      },
    });

    ctx.registerTool(messageAgentTool);
  },

  tags: ["subagents", "default"],
};

const TASK_SYSTEM_PROMPT = `## \`task\` (subagent spawner)

You have access to a \`task\` tool to launch short-lived subagents that handle isolated tasks. These agents are ephemeral — they live only for the duration of the task and return a single result.

When to use the task tool:
- When a task is complex and multi-step, and can be fully delegated in isolation
- When a task is independent of other tasks and can run in parallel
- When a task requires focused reasoning or heavy token/context usage that would bloat the orchestrator thread
- When sandboxing improves reliability (e.g. code execution, structured searches, data formatting)
- When you only care about the output of the subagent, and not the intermediate steps (ex. performing a lot of research and then returned a synthesized report, performing a series of computations or lookups to achieve a concise, relevant answer.)

Subagent lifecycle:
1. **Spawn** → Provide clear role, instructions, and expected output
2. **Run** → The subagent completes the task autonomously
3. **Return** → The subagent provides a single structured result
4. **Reconcile** → Incorporate or synthesize the result into the main thread

When NOT to use the task tool:
- If you need to see the intermediate reasoning or steps after the subagent has completed (the task tool hides them)
- If the task is trivial (a few tool calls or simple lookup)
- If delegating does not reduce token usage, complexity, or context switching
- If splitting would add latency without benefit

## Important Task Tool Usage Notes to Remember
- Whenever possible, parallelize the work that you do. This is true for both tool calls, and for tasks. Whenever you have independent steps to complete - make tool calls, or kick off tasks (subagents) in parallel to accomplish them faster. This saves time for the user, which is incredibly important.
- Remember to use the \`task\` tool to silo independent tasks within a multi-part objective.
- You should use the \`task\` tool whenever you have a complex task that will take multiple steps, and is independent from other tasks that the agent needs to complete. These agents are highly competent and efficient.`;

const TASK_TOOL_DESCRIPTION = `Launch an ephemeral subagent to handle complex, multi-step independent tasks with isolated context windows. 

Available agent types and the tools they have access to:
{other_agents}

When using the Task tool, you must specify a subagentType parameter to select which agent type to use.

## Usage notes:
1. Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
2. When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.
3. Each task result includes an agentId that you can use with message_agent to send follow-up messages to the same agent. Therefore, your prompt should contain a highly detailed task description for the agent to perform autonomously and you should specify exactly what information the agent should return back to you in its final and only message to you.
4. The agent's outputs should generally be trusted
5. Clearly tell the agent whether you expect it to create content, perform analysis, or just do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent
6. If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.
7. When only the general-purpose agent is provided, you should use it for all tasks. It is great for isolating context and token usage, and completing specific, complex tasks, as it has all the same capabilities as the main agent.

### Example usage of the general-purpose agent:

<example_agent_descriptions>
"general-purpose": use this agent for general purpose tasks, it has access to all tools as the main agent.
</example_agent_descriptions>

<example>
User: "I want to conduct research on the accomplishments of Lebron James, Michael Jordan, and Kobe Bryant, and then compare them."
Assistant: *Uses the task tool in parallel to conduct isolated research on each of the three players*
Assistant: *Synthesizes the results of the three isolated research tasks and responds to the User*
<commentary>
Research is a complex, multi-step task in it of itself.
The research of each individual player is not dependent on the research of the other players.
The assistant uses the task tool to break down the complex objective into three isolated tasks.
Each research task only needs to worry about context and tokens about one player, then returns synthesized information about each player as the Tool Result.
This means each research task can dive deep and spend tokens and context deeply researching each player, but the final result is synthesized information, and saves us tokens in the long run when comparing the players to each other.
</commentary>
</example>

<example>
User: "Analyze a single large code repository for security vulnerabilities and generate a report."
Assistant: *Launches a single \`task\` subagent for the repository analysis*
Assistant: *Receives report and integrates results into final summary*
<commentary>
Subagent is used to isolate a large, context-heavy task, even though there is only one. This prevents the main thread from being overloaded with details.
If the user then asks followup questions, we have a concise report to reference instead of the entire history of analysis and tool calls, which is good and saves us time and money.
</commentary>
</example>

<example>
User: "Schedule two meetings for me and prepare agendas for each."
Assistant: *Calls the task tool in parallel to launch two \`task\` subagents (one per meeting) to prepare agendas*
Assistant: *Returns final schedules and agendas*
<commentary>
Tasks are simple individually, but subagents help silo agenda preparation.
Each subagent only needs to worry about the agenda for one meeting.
</commentary>
</example>

<example>
User: "I want to order a pizza from Dominos, order a burger from McDonald's, and order a salad from Subway."
Assistant: *Calls tools directly in parallel to order a pizza from Dominos, a burger from McDonald's, and a salad from Subway*
<commentary>
The assistant did not use the task tool because the objective is super simple and clear and only requires a few trivial tool calls.
It is better to just complete the task directly and NOT use the \`task\`tool.
</commentary>
</example>

### Example usage with custom agents:

<example_agent_descriptions>
"content-reviewer": use this agent after you are done creating significant content or documents
"greeting-responder": use this agent when to respond to user greetings with a friendly joke
"research-analyst": use this agent to conduct thorough research on complex topics
</example_agent_description>

<example>
user: "Please write a function that checks if a number is prime"
assistant: Sure let me write a function that checks if a number is prime
assistant: First let me use the Write tool to write a function that checks if a number is prime
assistant: I'm going to use the Write tool to write the following code:
<code>
function isPrime(n) {{
  if (n <= 1) return false
  for (let i = 2; i * i <= n; i++) {{
    if (n % i === 0) return false
  }}
  return true
}}
</code>
<commentary>
Since significant content was created and the task was completed, now use the content-reviewer agent to review the work
</commentary>
assistant: Now let me use the content-reviewer agent to review the code
assistant: Uses the Task tool to launch with the content-reviewer agent 
</example>

<example>
user: "Can you help me research the environmental impact of different renewable energy sources and create a comprehensive report?"
<commentary>
This is a complex research task that would benefit from using the research-analyst agent to conduct thorough analysis
</commentary>
assistant: I'll help you research the environmental impact of renewable energy sources. Let me use the research-analyst agent to conduct comprehensive research on this topic.
assistant: Uses the Task tool to launch with the research-analyst agent, providing detailed instructions about what research to conduct and what format the report should take
</example>

<example>
user: "Hello"
<commentary>
Since the user is greeting, use the greeting-responder agent to respond with a friendly joke
</commentary>
assistant: "I'm going to use the Task tool to launch with the greeting-responder agent"
</example>`;
