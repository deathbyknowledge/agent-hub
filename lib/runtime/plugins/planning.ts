import type { AgentPlugin } from "../types";
import { tool } from "../tools";
import { z } from "zod";

export type Todo = {
  content: string;
  status: "pending" | "in_progress" | "completed";
};

const WRITE_TODOS_TOOL_DESCRIPTION = `Use this tool to create and manage a structured task list for your current work session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.
Only use this tool if you think it will be helpful in staying organized. If the user's request is trivial and takes less than 3 steps, it is better to NOT use this tool and just do the task directly.

## When to Use This Tool
Use this tool in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. The plan may need future revisions or updates based on results from the first few steps

## How to Use This Tool
1. When you start working on a task - Mark it as in_progress BEFORE beginning work.
2. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation.
3. You can also update future tasks, such as deleting them if they are no longer necessary, or adding new tasks that are necessary.
4. You can make several updates to the todo list at once.

## When NOT to Use This Tool
Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

## Task States
- pending: Task not yet started
- in_progress: Currently working on
- completed: Task finished successfully

Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.
`;

const WRITE_TODOS_SYSTEM_PROMPT = `## \`write_todos\`

You have access to the \`write_todos\` tool to help you manage and plan complex objectives.
Use this tool for complex objectives to ensure that you are tracking each necessary step and giving the user visibility into your progress.

It is critical that you mark todos as completed as soon as you are done with a step. Do not batch up multiple steps before marking them as completed.
For simple objectives that only require a few steps, it is better to just complete the objective directly and NOT use this tool.

## Important Notes
- The \`write_todos\` tool should never be called multiple times in parallel.
- Don't be afraid to revise the list as you go. New information may reveal new tasks or make old tasks irrelevant.`;

const write_todos = tool({
  name: "write_todos",
  description: WRITE_TODOS_TOOL_DESCRIPTION,
  inputSchema: z.object({
    todos: z
      .array(
        z.object({
          content: z.string().describe("Task text"),
          status: z
            .enum(["pending", "in_progress", "completed"])
            .describe("Current task state"),
        })
      )
      .describe("Full replacement list of todos"),
  }),
  execute: async (p, ctx) => {
    const sql = ctx.agent.sqlite;
    const clean = (p.todos ?? []).map((t) => ({
      content: String(t.content ?? "").slice(0, 2000),
      status:
        t.status === "in_progress" || t.status === "completed"
          ? t.status
          : ("pending" as const),
    }));
    sql`DELETE FROM todos`;
    let pos = 0;
    for (const td of clean) {
      sql`INSERT INTO todos (content, status, pos, updated_at) VALUES (${td.content}, ${td.status}, ${pos++}, ${Date.now()})`;
    }
    return `Updated todo list (${clean.length} items).`;
  },
});

/**
 * Provides task planning and todo management for agents handling complex multi-step tasks.
 * Stores todos in SQLite and exposes them via agent state.
 */
export const planning: AgentPlugin = {
  name: "planning",

  async onInit(ctx) {
    ctx.agent.sqlite`
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','in_progress','completed')),
  pos INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`;
  },

  state: (ctx) => {
    const rows = ctx.agent.sqlite`
      SELECT content, status FROM todos ORDER BY pos ASC, id ASC
    `;
    const todos: Todo[] = [];
    for (const r of rows) {
      todos.push({
        content: String(r.content ?? ""),
        status: String(r.status) as Todo["status"],
      });
    }
    return { todos };
  },

  async beforeModel(ctx, plan) {
    plan.addSystemPrompt(WRITE_TODOS_SYSTEM_PROMPT);
    ctx.registerTool(write_todos);
  },

  tags: ["default"],
};
