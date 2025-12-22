import { useEffect, useState, type ChangeEvent } from "react";
import { cn } from "../lib/utils";
import { Button } from "./Button";

export interface FSEntry {
  path: string;
  type: "file" | "dir";
  size?: number;
  modified?: string;
}

interface FSNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  modified?: string;
  children?: FSNode[];
  loaded?: boolean;
}

interface FilesViewProps {
  listDirectory?: (path: string) => Promise<{ entries: FSEntry[] }>;
  readFile?: (path: string) => Promise<{ content: string }>;
  writeFile?: (path: string, content: string) => Promise<unknown>;
  initialPath?: string;
  allowUpload?: boolean;
  showPathInput?: boolean;
  headerLabel?: string;
}

// Text file extensions that can be previewed
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "js",
  "ts",
  "tsx",
  "jsx",
  "css",
  "scss",
  "html",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "sh",
  "bash",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "sql",
  "graphql",
  "env",
  "gitignore",
  "dockerignore",
  "dockerfile",
  "makefile",
  "log",
]);

function isTextFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const name = filename.toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(name);
}

function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

const formatSize = (bytes?: number): string => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
};

const formatDate = (dateStr?: string): string => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const normalizeFolderPath = (path: string, fallback = "/shared"): string => {
  const trimmed = path.trim();
  if (!trimmed) return fallback;
  if (trimmed === "~") return "~";
  if (trimmed === "~/") return "~/";
  if (trimmed.startsWith("~/")) {
    return `~/${trimmed.slice(2).replace(/^\/+/, "")}`.replace(/\/+/g, "/");
  }
  if (trimmed.startsWith("/")) {
    return `/${trimmed.slice(1).replace(/\/+/g, "/")}` || "/";
  }
  return `/${trimmed.replace(/\/+/g, "/")}`;
};

const parentFolder = (path: string): string => {
  const normalized = normalizeFolderPath(path, "/");
  if (normalized === "/" || normalized === "~" || normalized === "~/") {
    return normalized;
  }
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  const parent = parts.join("/");
  if (!parent) return "/";
  if (parent === "~") return "~";
  return `/${parent}`;
};

const uploadTargetLabel = (path: string): string => {
  const normalized = normalizeFolderPath(path);
  if (normalized === "~" || normalized === "~/") return "~";
  if (normalized === "/") return "/";
  const parts = normalized.split("/").filter(Boolean);
  return parts.pop() || "shared";
};

function FileTreeNode({
  node,
  depth = 0,
  onSelect,
  expanded,
  loading,
  selectedPath,
}: {
  node: FSNode;
  depth?: number;
  onSelect: (node: FSNode) => void;
  expanded: Set<string>;
  loading: Set<string>;
  selectedPath?: string;
}) {
  const isExpanded = expanded.has(node.path);
  const isLoading = loading.has(node.path);
  const isSelected = selectedPath === node.path;
  const expanderClass = isSelected ? "text-black/50" : "text-white/50";
  const labelClass =
    node.type === "dir"
      ? isSelected
        ? "text-black"
        : "text-[#ffaa00]"
      : isSelected
        ? "text-black"
        : "text-white";

  return (
    <div key={node.path}>
      <button
        onClick={() => onSelect(node)}
        className={cn(
          "w-full text-left px-2 py-1 flex items-center gap-2 text-xs font-mono",
          isSelected ? "bg-white text-black" : "hover:bg-white/10"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span className={cn("w-6", expanderClass)}>
          {node.type === "dir"
            ? isLoading
              ? "[~]"
              : isExpanded
                ? "[-]"
                : "[+]"
            : ""}
        </span>
        <span className={labelClass}>
          {node.type === "dir" ? `${node.name}/` : node.name}
        </span>
        {node.size !== undefined && (
          <span className={cn("ml-auto", isSelected ? "text-black/40" : "text-white/30")}>
            {formatSize(node.size)}
          </span>
        )}
      </button>
      {isExpanded &&
        node.children &&
        node.children.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            onSelect={onSelect}
            expanded={expanded}
            loading={loading}
            selectedPath={selectedPath}
          />
        ))}
    </div>
  );
}

export function FilesView({
  listDirectory,
  readFile,
  writeFile,
  initialPath = "/shared",
  allowUpload,
  showPathInput,
  headerLabel = "Files",
}: FilesViewProps) {
  const canUpload = !!writeFile && (allowUpload ?? true);
  const showPath = showPathInput ?? canUpload;
  const [tree, setTree] = useState<FSNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<FSNode | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>(
    normalizeFolderPath(initialPath)
  );
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(false);

  useEffect(() => {
    if (!listDirectory) return;
    loadDirectory("/").then((entries) => setTree(entries));
  }, [listDirectory]);

  const loadDirectory = async (path: string): Promise<FSNode[]> => {
    if (!listDirectory) return [];
    const normalized =
      path.startsWith("/") || path.startsWith("~") ? path : `/${path}`;
    try {
      const { entries } = await listDirectory(normalized);
      return entries.map((e) => ({
        name: e.path.split("/").filter(Boolean).pop() || e.path,
        path: e.path.startsWith("/") ? e.path : `/${e.path}`,
        type: e.type === "dir" ? "dir" : "file",
        size: e.size,
        modified: e.modified,
        loaded: e.type !== "dir",
      }));
    } catch {
      return [];
    }
  };

  const toggleExpand = async (node: FSNode) => {
    if (node.type !== "dir") return;
    setSelectedFolder(normalizeFolderPath(node.path, selectedFolder));
    const newExpanded = new Set(expanded);
    if (expanded.has(node.path)) {
      newExpanded.delete(node.path);
      setExpanded(newExpanded);
      return;
    }

    if (!node.loaded) {
      setLoadingDirs((prev) => new Set(prev).add(node.path));
      const children = await loadDirectory(node.path);
      const updateNode = (nodes: FSNode[]): FSNode[] =>
        nodes.map((n) => {
          if (n.path === node.path) {
            return { ...n, children, loaded: true };
          }
          if (n.children) {
            return { ...n, children: updateNode(n.children) };
          }
          return n;
        });
      setTree((prev) => updateNode(prev));
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.delete(node.path);
        return next;
      });
    }

    newExpanded.add(node.path);
    setExpanded(newExpanded);
  };

  const selectFile = async (node: FSNode) => {
    if (node.type !== "file") return;
    setSelectedFile(node);
    setFileContent(null);
    setError(null);
    setSelectedFolder(parentFolder(node.path));
    if (!readFile) return;
    setLoadingContent(true);
    try {
      const { content } = await readFile(node.path);
      setFileContent(content);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load file"
      );
      setFileContent(null);
    }
    setLoadingContent(false);
  };

  const refreshFolders = async (folders: Set<string>) => {
    const refreshNode = (nodes: FSNode[]): FSNode[] =>
      nodes.map((n) => {
        if (folders.has(n.path)) return { ...n, loaded: false };
        if (n.children) return { ...n, children: refreshNode(n.children) };
        return n;
      });
    setTree((prev) => refreshNode(prev));

    for (const folderPath of folders) {
      if (expanded.has(folderPath)) {
        const children = await loadDirectory(folderPath);
        const updateNode = (nodes: FSNode[]): FSNode[] =>
          nodes.map((n) => {
            if (n.path === folderPath) return { ...n, children, loaded: true };
            if (n.children) return { ...n, children: updateNode(n.children) };
            return n;
          });
        setTree((prev) => updateNode(prev));
      }
    }
  };

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !writeFile || !canUpload) return;

    setUploading(true);
    try {
      const content = await file.text();
      const targetFolder = normalizeFolderPath(selectedFolder);
      const uploadPath = `${targetFolder}/${file.name}`.replace(/\/\//g, "/");
      if (uploadPath.replace(/\/+/g, "/") === "/.agency.json") {
        throw new Error("`.agency.json` is read-only");
      }
      await writeFile(uploadPath, content);
      const parents = new Set<string>([
        targetFolder,
        parentFolder(targetFolder),
      ]);
      await refreshFolders(parents);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
      alert(message);
    }
    setUploading(false);
    e.target.value = "";
  };

  const handleDownload = async () => {
    if (!selectedFile || selectedFile.type !== "file" || !readFile) return;
    try {
      setLoadingContent(true);
      const { content } = await readFile(selectedFile.path);
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = selectedFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download file");
    } finally {
      setLoadingContent(false);
    }
  };

  const handleRefresh = async () => {
    if (!listDirectory) return;
    const root = await loadDirectory("/");
    setTree(root);
    setExpanded(new Set());
    setSelectedFile(null);
    setFileContent(null);
    setError(null);
  };

  const headerPath =
    selectedFile?.path || (selectedFolder ? `${selectedFolder}/` : "Select");
  const ext =
    selectedFile && selectedFile.type === "file"
      ? getFileExtension(selectedFile.name)
      : "";
  const canPreview =
    selectedFile &&
    selectedFile.type === "file" &&
    isTextFile(selectedFile.name);

  if (!listDirectory) {
    return (
      <div className="text-center py-8 text-white/50">
        <div className="text-xl mb-2 font-mono">[!]</div>
        <p className="text-sm">Filesystem not available</p>
      </div>
    );
  }

  return (
    <div className="flex h-full relative bg-black min-h-[400px]">
      {showTree && (
        <div
          className="md:hidden fixed inset-0 bg-black/80 z-10"
          onClick={() => setShowTree(false)}
        />
      )}
      <button
        onClick={() => setShowTree(!showTree)}
        className="md:hidden fixed bottom-4 left-4 z-20 p-3 bg-white text-black border border-white"
        aria-label="Toggle file tree"
      >
        <span className="text-xs">[/]</span>
      </button>

      <div
        className={cn(
          "w-72 md:w-1/3 border border-white/20 bg-black overflow-hidden flex flex-col",
          "md:relative md:translate-x-0",
          "absolute inset-y-0 left-0 z-10 md:z-0",
          "transform transition-transform duration-200",
          showTree
            ? "translate-x-0 opacity-100"
            : "-translate-x-full opacity-0 pointer-events-none md:opacity-100 md:pointer-events-auto md:translate-x-0"
        )}
      >
        <div className="px-3 py-2 border-b border-white/20 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-white/50">
              {headerLabel}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<span className="text-xs">[↻]</span>}
                onClick={handleRefresh}
              >
                <span className="hidden sm:inline">Refresh</span>
                <span className="sm:hidden">Ref</span>
              </Button>
              {canUpload && (
                <label
                  className={cn(
                    "text-[10px] px-2 py-1 border border-white/30 text-white/70 hover:bg-white hover:text-black transition-colors cursor-pointer",
                    uploading && "opacity-50 cursor-wait"
                  )}
                >
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleUpload}
                    disabled={uploading}
                  />
                  {uploading
                    ? "[...]"
                    : `[↑] ${uploadTargetLabel(selectedFolder)}`}
                </label>
              )}
            </div>
          </div>
          {showPath && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-white/50">
                Upload to
              </span>
              <input
                type="text"
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                onBlur={() =>
                  setSelectedFolder((prev) => normalizeFolderPath(prev))
                }
                placeholder="/shared/new-folder or ~/notes"
                className="flex-1 bg-white/5 border border-white/20 rounded px-2 py-1 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/40"
              />
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {tree.length === 0 ? (
            <div className="text-center py-4 text-white/30 text-xs">
              Loading...
            </div>
          ) : (
            tree.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                onSelect={(n) => {
                  if (n.type === "dir") {
                    toggleExpand(n);
                  } else {
                    selectFile(n);
                  }
                  if (window.innerWidth < 768) {
                    setShowTree(false);
                  }
                }}
                expanded={expanded}
                loading={loadingDirs}
                selectedPath={selectedFile?.path}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex-1 border border-white/20 md:border-l-2 md:border-l-white/40 bg-black overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-white/20">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-white/50">
              {headerPath || "Select a file"}
            </span>
            {selectedFile?.type === "file" && readFile && (
              <Button
                variant="secondary"
                size="sm"
                icon={
                  <span className="text-[10px]">
                    {loadingContent ? "[~]" : "[↓]"}
                  </span>
                }
                onClick={handleDownload}
                disabled={loadingContent}
              >
                GET
              </Button>
            )}
          </div>
          {selectedFile && (
            <div className="flex items-center gap-4 mt-1 text-[10px] text-white/40 font-mono">
              <span>{selectedFile.type === "dir" ? "DIR" : "FILE"}</span>
              {selectedFile.size !== undefined && (
                <span>{formatSize(selectedFile.size)}</span>
              )}
              {selectedFile.modified && <span>{formatDate(selectedFile.modified)}</span>}
              {ext && (
                <span className="text-[10px] px-1 py-0.5 border border-white/20 text-white/50 uppercase">
                  {ext}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto p-3">
          {selectedFile ? (
            selectedFile.type === "dir" ? (
              <div className="text-white/40 text-xs font-mono">
                DIRECTORY // {selectedFile.children?.length || 0} ITEMS
              </div>
            ) : loadingContent ? (
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[#00aaff]">
                <span className="blink-hard">[~]</span>
                Loading...
              </div>
            ) : error ? (
              <div className="text-[#ff0000] text-[10px] uppercase tracking-wider border border-[#ff0000] p-2">
                ERROR: {error}
              </div>
            ) : fileContent !== null ? (
              <pre className="text-xs text-white/80 whitespace-pre-wrap font-mono">
                {fileContent}
              </pre>
            ) : canPreview ? (
              <div className="text-white/30 text-xs text-center py-8">
                Click GET to preview
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-white/30 border border-dashed border-white/20 p-6">
                <span className="text-2xl">□</span>
                <p className="text-[10px] uppercase tracking-wider">
                  NO PREVIEW AVAILABLE
                </p>
                {readFile && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<span className="text-[10px]">[↓]</span>}
                    onClick={handleDownload}
                  >
                    DOWNLOAD
                  </Button>
                )}
              </div>
            )
          ) : (
            <div className="text-white/30 text-xs text-center py-8">
              Select a file to preview
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export type { FilesViewProps };
