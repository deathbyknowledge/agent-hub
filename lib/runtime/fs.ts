export type FSEntry = {
  type: "file" | "dir";
  /** Path relative to the agent's view (e.g., "foo.txt" or "/shared/config.json") */
  path: string;
  size?: number;
  ts?: Date;
  owner?: string;
};

export type AgentFSContext = {
  agencyId: string;
  agentId: string;
};

export class AgentFileSystem {
  constructor(
    private bucket: R2Bucket,
    private ctx: AgentFSContext
  ) {}

  private get homePrefix(): string {
    return `${this.ctx.agencyId}/agents/${this.ctx.agentId}/`;
  }

  private get sharedPrefix(): string {
    return `${this.ctx.agencyId}/shared/`;
  }

  private get agencyPrefix(): string {
    return `${this.ctx.agencyId}/`;
  }

  resolvePath(userPath: string): string {
    const p = userPath.trim();

    if (p === "~" || p === "~/") return this.homePrefix;
    if (p.startsWith("~/")) return this.homePrefix + p.slice(2);

    if (p.startsWith("/")) {
      const withoutSlash = p.slice(1);
      if (withoutSlash === "shared" || withoutSlash.startsWith("shared/")) {
        return this.agencyPrefix + withoutSlash;
      }
      if (withoutSlash.startsWith("agents/")) {
        return this.agencyPrefix + withoutSlash;
      }
      return this.homePrefix + withoutSlash;
    }

    return this.homePrefix + p;
  }

  toUserPath(r2Key: string): string {
    if (!r2Key.startsWith(this.agencyPrefix)) return r2Key;
    const agencyRelative = r2Key.slice(this.agencyPrefix.length);

    const homeRel = `agents/${this.ctx.agentId}/`;
    if (agencyRelative.startsWith(homeRel)) {
      const rel = agencyRelative.slice(homeRel.length);
      return rel || ".";
    }

    return "/" + agencyRelative;
  }

  private objToEntry(obj: R2Object): FSEntry {
    return {
      type: "file" as const,
      path: this.toUserPath(obj.key),
      size: obj.size,
      ts: obj.uploaded
    };
  }

  checkAccess(
    r2Key: string,
    mode: "read" | "write"
  ): { allowed: boolean; reason?: string } {
    if (!r2Key.startsWith(this.agencyPrefix)) {
      return { allowed: false, reason: "Path outside agency" };
    }

    const rel = r2Key.slice(this.agencyPrefix.length);

    if (rel.startsWith("shared/") || rel === "shared") {
      return { allowed: true };
    }

    const ownHome = `agents/${this.ctx.agentId}/`;
    if (rel.startsWith(ownHome) || rel === `agents/${this.ctx.agentId}`) {
      return { allowed: true };
    }

    if (rel.startsWith("agents/")) {
      if (mode === "read") {
        return { allowed: true };
      }
      return { allowed: false, reason: "Cannot write to another agent's home" };
    }

    return { allowed: false, reason: "Invalid path" };
  }

  async readDir(path = "."): Promise<FSEntry[]> {
    let r2Prefix = this.resolvePath(path);
    if (!r2Prefix.endsWith("/")) r2Prefix += "/";

    const access = this.checkAccess(r2Prefix, "read");
    if (!access.allowed) {
      throw new Error(`Access denied: ${access.reason}`);
    }

    const list = await this.bucket.list({
      prefix: r2Prefix,
      delimiter: "/"
    });

    const entries: FSEntry[] = [
      ...list.objects.map((obj) => this.objToEntry(obj)),
      ...list.delimitedPrefixes.map((pref) => ({
        type: "dir" as const,
        path: this.toUserPath(pref)
      }))
    ];

    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  async delete(paths: string[]): Promise<void> {
    const r2Keys: string[] = [];
    for (const p of paths) {
      const key = this.resolvePath(p);
      const access = this.checkAccess(key, "write");
      if (!access.allowed) {
        throw new Error(`Cannot delete '${p}': ${access.reason}`);
      }
      r2Keys.push(key);
    }
    await this.bucket.delete(r2Keys);
  }

  async stat(path: string): Promise<FSEntry | null> {
    const r2Key = this.resolvePath(path);
    const access = this.checkAccess(r2Key, "read");
    if (!access.allowed) {
      throw new Error(`Access denied: ${access.reason}`);
    }

    const obj = await this.bucket.head(r2Key);
    if (!obj) return null;
    return this.objToEntry(obj);
  }

  async writeFile(
    path: string,
    data: string | ArrayBuffer | Uint8Array
  ): Promise<void> {
    const r2Key = this.resolvePath(path);
    const access = this.checkAccess(r2Key, "write");
    if (!access.allowed) {
      throw new Error(`Cannot write '${path}': ${access.reason}`);
    }
    await this.bucket.put(r2Key, data);
  }

  async readFile(path: string, stream: true): Promise<ReadableStream | null>;
  async readFile(path: string, stream?: false): Promise<string | null>;
  async readFile(
    path: string,
    stream = false
  ): Promise<ReadableStream | string | null> {
    const r2Key = this.resolvePath(path);
    const access = this.checkAccess(r2Key, "read");
    if (!access.allowed) {
      throw new Error(`Cannot read '${path}': ${access.reason}`);
    }

    const obj = await this.bucket.get(r2Key);
    if (!obj || !obj.body) return null;
    return stream ? obj.body : obj.text();
  }

  async editFile(
    path: string,
    oldStr: string,
    newStr: string,
    replaceAll = false
  ): Promise<{ replaced: number; content: string }> {
    const current = await this.readFile(path, false);
    if (current === null) {
      return { replaced: 0, content: "" };
    }

    const count = (current.match(new RegExp(escapeRegExp(oldStr), "g")) || [])
      .length;
    if (count === 0) {
      return { replaced: 0, content: current };
    }
    if (!replaceAll && count > 1) {
      return { replaced: -count, content: current };
    }

    const content = replaceAll
      ? current.split(oldStr).join(newStr)
      : current.replace(oldStr, newStr);

    await this.writeFile(path, content);
    return { replaced: replaceAll ? count : 1, content };
  }

  async exists(path: string): Promise<boolean> {
    const entry = await this.stat(path);
    return entry !== null;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
