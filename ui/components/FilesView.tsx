import { useState, useEffect, useMemo } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-css";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import { cn } from "../lib/utils";
import {
  Folder,
  File,
  CaretRight,
  CaretDown,
  Clock,
  Download,
  CircleNotch
} from "@phosphor-icons/react";
import { Button } from "./Button";

// Types
interface FileNode {
  id: string;
  name: string;
  type: "file" | "directory";
  path?: string; // Full path for API calls
  size?: number;
  modifiedAt?: string;
  children?: FileNode[];
  content?: string;
}

interface FilesViewProps {
  files: FileNode[];
  onFileSelect?: (file: FileNode) => void;
  loadFileContent?: (path: string) => Promise<{ content: string }>;
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
  "log"
]);

function isTextFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const name = filename.toLowerCase();
  // Check extension or common filenames without extension
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(name);
}

function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

// Map file extensions to Prism language names
const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  json: "json",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "css",
  sql: "sql",
  go: "go",
  rs: "rust",
  html: "markup",
  xml: "markup"
};

function getLanguage(ext: string): string {
  return LANG_MAP[ext] || "";
}

// Folder descriptions for tooltips
const FOLDER_TIPS: Record<string, string> = {
  "~": "Agent's home directory - private to this agent",
  "shared": "Shared directory - accessible by all agents in this agency"
};

// Syntax highlighted code component
function SyntaxHighlightedCode({ content, language }: { content: string; language: string }) {
  const highlighted = useMemo(() => {
    if (!language || !Prism.languages[language]) {
      return null;
    }
    try {
      return Prism.highlight(content, Prism.languages[language], language);
    } catch {
      return null;
    }
  }, [content, language]);

  if (highlighted) {
    return (
      <pre className="text-sm font-mono whitespace-pre-wrap break-words">
        <code
          className={`language-${language}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
          style={{
            color: "#e5e7eb",
            background: "transparent"
          }}
        />
      </pre>
    );
  }

  // Fallback to plain text
  return (
    <pre className="text-sm text-neutral-800 dark:text-neutral-200 font-mono whitespace-pre-wrap break-words">
      {content}
    </pre>
  );
}

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function FileTreeNode({
  node,
  depth = 0,
  onSelect,
  selectedId
}: {
  node: FileNode;
  depth?: number;
  onSelect?: (node: FileNode) => void;
  selectedId?: string;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isDir = node.type === "directory";
  const hasChildren = isDir && node.children && node.children.length > 0;
  const isSelected = node.id === selectedId;

  return (
    <div>
      <button
        onClick={() => {
          if (isDir && hasChildren) setExpanded(!expanded);
          onSelect?.(node);
        }}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1 text-[11px] transition-colors text-left group border-l-2",
          isSelected
            ? "bg-white text-black border-l-white"
            : "text-white/70 border-l-transparent hover:text-white hover:bg-white/5 hover:border-l-white/50"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {/* Expand/collapse for directories */}
        <span className="w-3 shrink-0">
          {hasChildren &&
            (expanded ? (
              <CaretDown size={10} className="text-current opacity-50" />
            ) : (
              <CaretRight size={10} className="text-current opacity-50" />
            ))}
        </span>

        {/* Icon - ASCII style */}
        {isDir ? (
          <span className="text-[#ffaa00] text-[10px] font-bold">[DIR]</span>
        ) : (
          <span className="text-white/30 text-[10px]">DOC_</span>
        )}

        {/* Name with tooltip for special folders */}
        <span 
          className="flex-1 truncate uppercase tracking-wider"
          title={FOLDER_TIPS[node.name] || undefined}>
          {node.name}
        </span>

        {/* Size (files only) */}
        {!isDir && node.size && (
          <span className="text-[10px] text-current opacity-30 group-hover:opacity-60 transition-opacity font-mono">
            {formatSize(node.size)}
          </span>
        )}
      </button>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {node.children!.map((child) => (
            <FileTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FilesView({
  files,
  onFileSelect,
  loadFileContent
}: FilesViewProps) {
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(false);

  const handleSelect = (node: FileNode) => {
    setSelectedFile(node);
    setFileContent(null);
    setError(null);
    onFileSelect?.(node);
    if (window.innerWidth < 768) {
      setShowTree(false);
    }
  };

  // Load file content when a file is selected
  useEffect(() => {
    if (!selectedFile || selectedFile.type === "directory") return;
    if (!loadFileContent) return;

    // Extract path from id (format: "file-path/to/file")
    const path = selectedFile.id.replace(/^file-/, "");
    if (!path) return;

    // Only auto-load text files
    if (!isTextFile(selectedFile.name)) return;

    setLoading(true);
    setError(null);

    loadFileContent(path)
      .then(({ content }) => {
        setFileContent(content);
      })
      .catch((e) => {
        setError(e.message || "Failed to load file");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedFile, loadFileContent]);

  const handleDownload = async () => {
    if (!selectedFile || selectedFile.type === "directory") return;
    if (!loadFileContent) return;

    const path = selectedFile.id.replace(/^file-/, "");
    if (!path) return;

    try {
      setLoading(true);
      const { content } = await loadFileContent(path);

      // Create blob and download
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
      setError((e as Error).message || "Failed to download file");
    } finally {
      setLoading(false);
    }
  };

  const ext = selectedFile ? getFileExtension(selectedFile.name) : "";
  const canPreview = selectedFile && isTextFile(selectedFile.name);

  return (
    <div className="flex h-full relative bg-black">
      {/* Mobile overlay */}
      {showTree && (
        <div
          className="md:hidden fixed inset-0 bg-black/80 z-10"
          onClick={() => setShowTree(false)}
        />
      )}

      {/* Mobile file tree toggle */}
      <button
        onClick={() => setShowTree(!showTree)}
        className="md:hidden fixed bottom-4 left-4 z-10 p-3 bg-white text-black border border-white"
        aria-label="Toggle file tree"
      >
        <Folder size={16} />
      </button>

      {/* File tree */}
      <div className={cn(
        "w-56 border-r-2 border-white overflow-y-auto p-2 bg-black",
        "md:relative md:translate-x-0",
        "absolute inset-y-0 left-0 z-20",
        "transform transition-transform duration-200",
        showTree ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
        {files.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[10px] uppercase tracking-wider text-white/30">
            // NO FILES
          </div>
        ) : (
          <div className="space-y-px">
            {files.map((node) => (
              <FileTreeNode
                key={node.id}
                node={node}
                onSelect={handleSelect}
                selectedId={selectedFile?.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* File preview */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedFile ? (
          <>
            {/* Header */}
            <div className="px-3 py-2 border-b-2 border-white bg-black">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedFile.type === "directory" ? (
                    <span className="text-[#ffaa00] text-[10px] font-bold">[DIR]</span>
                  ) : (
                    <span className="text-white/30 text-[10px]">DOC_</span>
                  )}
                  <span className="text-[11px] uppercase tracking-wider text-white">
                    {selectedFile.name}
                  </span>
                  {ext && (
                    <span className="text-[10px] px-1 py-0.5 border border-white/30 text-white/50 uppercase">
                      {ext}
                    </span>
                  )}
                </div>
                {selectedFile.type === "file" && loadFileContent && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={
                      loading ? (
                        <CircleNotch size={12} className="animate-spin" />
                      ) : (
                        <Download size={12} />
                      )
                    }
                    onClick={handleDownload}
                    disabled={loading}
                  >
                    GET
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1 text-[10px] text-white/40 font-mono">
                {selectedFile.size && (
                  <span>SIZE: {formatSize(selectedFile.size)}</span>
                )}
                {selectedFile.modifiedAt && (
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    {formatDate(selectedFile.modifiedAt)}
                  </span>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-3 bg-black">
              {selectedFile.type === "directory" ? (
                <div className="text-[10px] uppercase tracking-wider text-white/40">
                  DIRECTORY // {selectedFile.children?.length || 0} ITEMS
                </div>
              ) : loading ? (
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[#00aaff]">
                  <CircleNotch size={12} className="animate-spin" />
                  LOADING...
                </div>
              ) : error ? (
                <div className="text-[#ff0000] text-[10px] uppercase tracking-wider border border-[#ff0000] p-2">
                  ERROR: {error}
                </div>
              ) : fileContent !== null ? (
                <pre className="text-xs text-[#00ff00] font-mono whitespace-pre-wrap break-words">
                  {fileContent}
                </pre>
              ) : canPreview ? (
                <div className="text-[10px] uppercase tracking-wider text-white/30">
                  // CLICK TO LOAD PREVIEW
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-white/30 border border-dashed border-white/20 p-6">
                  <span className="text-2xl">□</span>
                  <p className="text-[10px] uppercase tracking-wider">
                    NO PREVIEW AVAILABLE
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Download size={12} />}
                    onClick={handleDownload}
                  >
                    DOWNLOAD
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[10px] uppercase tracking-wider text-white/30">
            // SELECT FILE TO VIEW
          </div>
        )}
      </div>
    </div>
  );
}

export type { FileNode };
