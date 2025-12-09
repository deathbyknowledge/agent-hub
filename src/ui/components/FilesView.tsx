import { useState, useEffect } from "react";
import { cn } from "../lib/utils";
import {
  Folder,
  File,
  CaretRight,
  CaretDown,
  Clock,
  Download,
  Spinner
} from "./Icons";
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
          "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors text-left group",
          isSelected
            ? "bg-orange-50 dark:bg-orange-900/20"
            : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Expand/collapse for directories */}
        <span className="w-4 shrink-0">
          {hasChildren &&
            (expanded ? (
              <CaretDown size={12} className="text-neutral-400" />
            ) : (
              <CaretRight size={12} className="text-neutral-400" />
            ))}
        </span>

        {/* Icon */}
        {isDir ? (
          <Folder size={16} className="text-orange-400 shrink-0" />
        ) : (
          <File size={16} className="text-neutral-400 shrink-0" />
        )}

        {/* Name */}
        <span className="flex-1 truncate text-neutral-800 dark:text-neutral-200">
          {node.name}
        </span>

        {/* Size (files only) */}
        {!isDir && node.size && (
          <span className="text-xs text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity">
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

  const handleSelect = (node: FileNode) => {
    setSelectedFile(node);
    setFileContent(null);
    setError(null);
    onFileSelect?.(node);
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
    <div className="flex h-full">
      {/* File tree */}
      <div className="w-64 border-r border-neutral-200 dark:border-neutral-800 overflow-y-auto p-2">
        {files.length === 0 ? (
          <div className="h-full flex items-center justify-center text-neutral-400 text-sm">
            No files available
          </div>
        ) : (
          <div className="space-y-0.5">
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
            <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedFile.type === "directory" ? (
                    <Folder size={18} className="text-orange-400" />
                  ) : (
                    <File size={18} className="text-neutral-400" />
                  )}
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                    {selectedFile.name}
                  </span>
                  {ext && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
                      {ext.toUpperCase()}
                    </span>
                  )}
                </div>
                {selectedFile.type === "file" && loadFileContent && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={
                      loading ? (
                        <Spinner size={14} className="animate-spin" />
                      ) : (
                        <Download size={14} />
                      )
                    }
                    onClick={handleDownload}
                    disabled={loading}
                  >
                    Download
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-neutral-500">
                {selectedFile.size && (
                  <span>{formatSize(selectedFile.size)}</span>
                )}
                {selectedFile.modifiedAt && (
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    {formatDate(selectedFile.modifiedAt)}
                  </span>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4 bg-neutral-50 dark:bg-neutral-950">
              {selectedFile.type === "directory" ? (
                <div className="text-neutral-500 text-sm">
                  Directory with {selectedFile.children?.length || 0} items
                </div>
              ) : loading ? (
                <div className="flex items-center gap-2 text-neutral-400 text-sm">
                  <Spinner size={16} className="animate-spin" />
                  Loading file...
                </div>
              ) : error ? (
                <div className="text-red-500 text-sm">{error}</div>
              ) : fileContent !== null ? (
                <pre className="text-sm text-neutral-800 dark:text-neutral-200 font-mono whitespace-pre-wrap break-words">
                  {fileContent}
                </pre>
              ) : canPreview ? (
                <div className="text-neutral-400 text-sm">
                  Click to load preview
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-400">
                  <File
                    size={48}
                    className="text-neutral-300 dark:text-neutral-600"
                  />
                  <p className="text-sm">
                    No preview available for this file type
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Download size={14} />}
                    onClick={handleDownload}
                  >
                    Download to view
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">
            Select a file to preview
          </div>
        )}
      </div>
    </div>
  );
}

export type { FileNode };
