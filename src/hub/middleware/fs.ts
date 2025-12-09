import {tool, type AgentPlugin} from "@runtime";
import z from 'zod';

/**
 * Filesystem plugin.
 *
 * Registers file tools that use the agent's built-in `fs` (AgentFileSystem).
 * The filesystem provides:
 * - Per-agent home directories: `/{agencyId}/agents/{agentId}/`
 * - Shared space: `/{agencyId}/shared/`
 * - Cross-agent read access (collaborative)
 *
 * Requires `FS: R2Bucket` binding in wrangler config.
 */
export const filesystem: AgentPlugin = {
  name: "filesystem",

  async beforeModel(ctx, plan) {
    plan.addSystemPrompt(FILESYSTEM_SYSTEM_PROMPT);

    const agentFs = ctx.agent.fs;
    if (!agentFs) {
      console.warn(
        `R2 filesystem not available (missing FS binding or agent not registered). Filesystem tools disabled.`
      );
      return;
    }

    // Track read paths in KV for edit safety
    const getReadPaths = () =>
      new Set(ctx.agent.store.kv.get<string[]>("fsReadPaths") ?? []);
    const markRead = (path: string) => {
      const paths = getReadPaths();
      paths.add(path);
      ctx.agent.store.kv.put("fsReadPaths", Array.from(paths));
    };

    // ls - list directory
    const ls = tool({
      name: "ls",
      description: LIST_FILES_TOOL_DESCRIPTION,
      inputSchema: ListFilesParams,
      execute: async (p) => {
        try {
          const entries = await agentFs.readDir(p.path ?? ".");
          if (entries.length === 0) return "Directory is empty";
          return entries
            .map((e) => `${e.type === "dir" ? "d" : "-"} ${e.path}`)
            .join("\n");
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    });

    // read_file
    const read_file = tool({
      name: "read_file",
      description: READ_FILE_TOOL_DESCRIPTION,
      inputSchema: ReadFileParams,
      execute: async (p) => {
        const path = String(p.path ?? "");
        try {
          const raw = await agentFs.readFile(path, false);
          if (raw === null) return `Error: File '${path}' not found`;

          markRead(path);

          if (raw.trim() === "")
            return "System reminder: File exists but has empty contents";

          const lines = raw.split(/\r?\n/);
          const offset = Math.max(0, Number(p.offset ?? 0));
          const limit = Math.max(1, Number(p.limit ?? 2000));
          if (offset >= lines.length) {
            return `Error: Line offset ${offset} exceeds file length (${lines.length} lines)`;
          }
          const end = Math.min(lines.length, offset + limit);
          const out = [];
          for (let i = offset; i < end; i++) {
            let content = lines[i];
            if (content.length > 2000) content = content.slice(0, 2000);
            const lineNum = (i + 1).toString().padStart(6, " ");
            out.push(`${lineNum}\t${content}`);
          }
          return out.join("\n");
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    });

    // write_file
    const write_file = tool({
      name: "write_file",
      description: WRITE_FILE_TOOL_DESCRIPTION,
      inputSchema: WriteFileParams,
      execute: async (p) => {
        const path = String(p.path ?? "");
        const content = String(p.content ?? "");
        try {
          await agentFs.writeFile(path, content);
          return `Updated file ${path}`;
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    });

    // edit_file
    const edit_file = tool({
      name: "edit_file",
      description: EDIT_FILE_TOOL_DESCRIPTION,
      inputSchema: EditFileParams,
      execute: async (p) => {
        const path = String(p.path ?? "");

        // Must read first
        const readPaths = getReadPaths();
        if (!readPaths.has(path)) {
          return `Error: You must read '${path}' before editing it`;
        }

        try {
          const { replaced } = await agentFs.editFile(
            path,
            p.oldString,
            p.newString,
            p.replaceAll
          );

          if (replaced === 0)
            return `Error: String not found in file: '${p.oldString}'`;
          if (replaced < 0) {
            return `Error: String '${p.oldString}' appears ${Math.abs(replaced)} times. Use replaceAll=true or provide a more specific oldString.`;
          }
          if (!p.replaceAll && replaced > 1) {
            return `Error: String '${p.oldString}' appears ${replaced} times. Use replaceAll=true or provide a more specific oldString.`;
          }

          return p.replaceAll
            ? `Successfully replaced ${replaced} instance(s) in '${path}'`
            : `Successfully replaced string in '${path}'`;
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    });

    ctx.registerTool(ls);
    ctx.registerTool(read_file);
    ctx.registerTool(write_file);
    ctx.registerTool(edit_file);
  },

  tags: ["fs", "default"]
};


export const LIST_FILES_TOOL_DESCRIPTION = `Lists all files in the local filesystem.

Usage:
- The list_files tool will return a list of all files in the local filesystem.
- This is very useful for exploring the file system and finding the right file to read or edit.
- You should almost ALWAYS use this tool before using the Read or Edit tools.`;

export const READ_FILE_TOOL_DESCRIPTION = `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful. 
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.
- You should ALWAYS make sure a file has been read before editing it.`;

export const EDIT_FILE_TOOL_DESCRIPTION = `Performs exact string replacements in files. 

Usage:
- You must use your \`Read\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the oldString or newString.
- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if \`oldString\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replaceAll\` to change every instance of \`oldString\`. 
- Use \`replaceAll\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`;

export const WRITE_FILE_TOOL_DESCRIPTION = `Writes to a file in the local filesystem.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- The content parameter must be a string
- The write_file tool will create the a new file.
- Prefer to edit existing files over creating new ones when possible.`;


export const FILESYSTEM_SYSTEM_PROMPT = `## Filesystem Tools \`ls\`, \`read_file\`, \`write_file\`, \`edit_file\`

You have access to a shared filesystem which you can interact with using these tools.

### Path Resolution
- Relative paths (e.g., \`foo.txt\`, \`subdir/file.js\`) resolve to your home directory
- \`~\` or \`~/...\` explicitly refers to your home directory  
- \`/shared/...\` is agency-wide shared space (all agents can read/write)
- \`/agents/{id}/...\` is another agent's home directory (read-only)

### Tools
- ls: List directory contents (default: home directory)
- read_file: Read a file from the filesystem
- write_file: Create or overwrite a file (home or /shared only)
- edit_file: Edit a file with find-replace (home or /shared only)

### Tips
- Use \`/shared/\` to collaborate with other agents or persist data across sessions
- Files in your home directory are private by default but readable by other agents
- You cannot write to another agent's home directory`;




export const ListFilesParams = z.object({
  path: z
    .string()
    .optional()
    .describe(
      "Directory to list. Relative paths resolve to home. Use /shared for shared files, /agents/{id} for other agents. Default: home directory"
    )
});

export const ReadFileParams = z.object({
  path: z
    .string()
    .describe(
      "File path. Relative paths resolve to home. Use /shared/... for shared files, /agents/{id}/... for other agents"
    ),
  offset: z.number().int().min(0).optional().describe("Line offset (0-based)"),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Max number of lines to read")
});

export const WriteFileParams = z.object({
  path: z
    .string()
    .describe(
      "File path. Relative paths write to home. Use /shared/... for shared files. Cannot write to other agents' homes."
    ),
  content: z.string().describe("File contents")
});

export const EditFileParams = z.object({
  path: z
    .string()
    .describe(
      "File path. Relative paths edit in home. Use /shared/... for shared files. Cannot edit other agents' files."
    ),
  oldString: z
    .string()
    .describe("Exact string to match (must be unique unless replaceAll=true)"),
  newString: z.string().describe("Replacement string (can be empty)"),
  replaceAll: z
    .boolean()
    .optional()
    .describe("Replace every occurrence instead of enforcing uniqueness")
});
