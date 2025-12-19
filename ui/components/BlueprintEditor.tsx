import { useState } from "react";
import { cn } from "../lib/utils";
import { Button } from "./Button";
import { Select } from "./Select";
import { ConfirmModal } from "./ConfirmModal";
import {
  Plus,
  Trash,
  Pencil,
  Check,
  X,
  Copy,
  Play,
  CaretDown,
  CaretRight,
} from "@phosphor-icons/react";
import type { AgentBlueprint, PluginInfo, ToolInfo } from "@client";

interface BlueprintEditorProps {
  blueprints: AgentBlueprint[];
  plugins: PluginInfo[];
  tools: ToolInfo[];
  onCreateBlueprint: (blueprint: Omit<AgentBlueprint, "createdAt" | "updatedAt">) => Promise<void>;
  onUpdateBlueprint: (blueprint: AgentBlueprint) => Promise<void>;
  onDeleteBlueprint: (name: string) => Promise<void>;
  onTestBlueprint?: (name: string) => Promise<void>;
}

function isStaticBlueprint(blueprint: AgentBlueprint): boolean {
  return !blueprint.createdAt && !blueprint.updatedAt;
}

type BlueprintFormData = {
  name: string;
  description: string;
  prompt: string;
  capabilities: string[];
  model: string;
  status: "active" | "draft" | "disabled";
  config: string;
};

function BlueprintForm({
  initialData,
  plugins,
  tools,
  onSubmit,
  onCancel,
  isEdit = false,
}: {
  initialData?: Partial<BlueprintFormData>;
  plugins: PluginInfo[];
  tools: ToolInfo[];
  onSubmit: (data: BlueprintFormData) => void;
  onCancel: () => void;
  isEdit?: boolean;
}) {
  const [formData, setFormData] = useState<BlueprintFormData>({
    name: initialData?.name || "",
    description: initialData?.description || "",
    prompt: initialData?.prompt || "",
    capabilities: initialData?.capabilities || [],
    model: initialData?.model || "",
    status: initialData?.status || "active",
    config: initialData?.config || "",
  });

  const [capabilityInput, setCapabilityInput] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);

  const allCapabilities = [
    ...plugins.map((p) => ({ type: "plugin", name: p.name, tags: p.tags })),
    ...tools.map((t) => ({ type: "tool", name: t.name, tags: t.tags || [] })),
  ];

  const availableTags = Array.from(
    new Set(allCapabilities.flatMap((c) => c.tags))
  ).sort();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.config.trim()) {
      try {
        JSON.parse(formData.config);
        setConfigError(null);
      } catch (err) {
        setConfigError("Invalid JSON format");
        return;
      }
    }
    
    onSubmit(formData);
  };

  const addCapability = (cap: string) => {
    if (cap && !formData.capabilities.includes(cap)) {
      setFormData({
        ...formData,
        capabilities: [...formData.capabilities, cap],
      });
      setCapabilityInput("");
    }
  };

  const removeCapability = (cap: string) => {
    setFormData({
      ...formData,
      capabilities: formData.capabilities.filter((c) => c !== cap),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
            placeholder="my-agent"
            required
            disabled={isEdit}
            pattern="[a-zA-Z0-9_-]+"
            title="Only alphanumeric characters, hyphens, and underscores"
          />
          <p className="text-xs text-neutral-500 mt-1">
            Alphanumeric with - or _ only
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
            Status
          </label>
          <Select
            value={formData.status}
            onChange={(val) =>
              setFormData({ ...formData, status: val as BlueprintFormData["status"] })
            }
            options={[
              { label: "Active", value: "active" },
              { label: "Draft", value: "draft" },
              { label: "Disabled", value: "disabled" },
            ]}
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
          Description
        </label>
        <input
          type="text"
          value={formData.description}
          onChange={(e) =>
            setFormData({ ...formData, description: e.target.value })
          }
          className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
          placeholder="A helpful agent that..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
          Model
        </label>
        <input
          type="text"
          value={formData.model}
          onChange={(e) => setFormData({ ...formData, model: e.target.value })}
          className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
          placeholder="gpt-4o (leave empty for default)"
        />
        <p className="text-xs text-neutral-500 mt-1">
          Leave empty to use agency default
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
          System Prompt <span className="text-red-500">*</span>
        </label>
        <textarea
          value={formData.prompt}
          onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
          className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-mono text-sm resize-none"
          placeholder="You are a helpful assistant that..."
          rows={8}
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
          Configuration (JSON)
        </label>
        <textarea
          value={formData.config}
          onChange={(e) => {
            setFormData({ ...formData, config: e.target.value });
            if (e.target.value.trim()) {
              try {
                JSON.parse(e.target.value);
                setConfigError(null);
              } catch (err) {
                setConfigError("Invalid JSON format");
              }
            } else {
              setConfigError(null);
            }
          }}
          className={cn(
            "w-full px-3 py-2 border rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-mono text-sm resize-none",
            configError
              ? "border-red-500 dark:border-red-500"
              : "border-neutral-300 dark:border-neutral-600"
          )}
          placeholder='{\n  "subagents": {\n    "subagents": [...]\n  }\n}'
          rows={6}
        />
        {configError && (
          <p className="text-xs text-red-500 mt-1">{configError}</p>
        )}
        <p className="text-xs text-neutral-500 mt-1">
          Optional plugin configuration (e.g., subagent definitions)
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-2">
          Capabilities
        </label>

        {formData.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {formData.capabilities.map((cap) => (
              <span
                key={cap}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium",
                  cap.startsWith("@")
                    ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                    : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                )}
              >
                {cap}
                <button
                  type="button"
                  onClick={() => removeCapability(cap)}
                  className="hover:text-red-600 dark:hover:text-red-400"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={capabilityInput}
              onChange={(e) => setCapabilityInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCapability(capabilityInput);
                }
              }}
              className="flex-1 px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-sm"
              placeholder="@tag or tool-name"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => addCapability(capabilityInput)}
              disabled={!capabilityInput.trim()}
            >
              Add
            </Button>
          </div>

          <div className="text-xs text-neutral-500 space-y-1">
            <p>
              <strong>Tags:</strong> {availableTags.map((t) => `@${t}`).join(", ") || "None"}
            </p>
            <p>
              <strong>Tools:</strong> {tools.map((t) => t.name).slice(0, 5).join(", ")}
              {tools.length > 5 && ` +${tools.length - 5} more`}
            </p>
            <p>
              <strong>Plugins:</strong> {plugins.map((p) => p.name).slice(0, 5).join(", ")}
              {plugins.length > 5 && ` +${plugins.length - 5} more`}
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-neutral-200 dark:border-neutral-700">
        <Button variant="secondary" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit">
          {isEdit ? "Update Blueprint" : "Create Blueprint"}
        </Button>
      </div>
    </form>
  );
}

function BlueprintCard({
  blueprint,
  onEdit,
  onDelete,
  onDuplicate,
  onTest,
}: {
  blueprint: AgentBlueprint;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onTest?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isStatic = isStaticBlueprint(blueprint);

  const statusColors = {
    active: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
    draft: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
    disabled: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  };

  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 bg-neutral-50 dark:bg-neutral-900 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <CaretDown size={14} className="text-neutral-400 shrink-0" />
        ) : (
          <CaretRight size={14} className="text-neutral-400 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              {blueprint.name}
            </span>
            {isStatic && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                Static
              </span>
            )}
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-xs font-medium",
                statusColors[blueprint.status || "active"]
              )}
            >
              {blueprint.status || "active"}
            </span>
          </div>
          {blueprint.description && (
            <p className="text-sm text-neutral-500 mt-0.5 truncate">
              {blueprint.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {onTest && (
            <button
              onClick={onTest}
              className="p-1.5 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-neutral-400 hover:text-green-600 transition-colors"
              title="Test blueprint"
            >
              <Play size={16} />
            </button>
          )}
          <button
            onClick={onDuplicate}
            className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 text-neutral-400 hover:text-blue-600 transition-colors"
            title={isStatic ? "Duplicate to edit" : "Duplicate"}
          >
            <Copy size={16} />
          </button>
          {!isStatic && (
            <>
              <button
                onClick={onEdit}
                className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
                title="Edit"
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-neutral-400 hover:text-red-600 transition-colors"
                title="Delete"
              >
                <Trash size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 space-y-3">
          <div>
            <div className="text-xs font-medium text-neutral-500 mb-1">Model</div>
            <div className="text-sm text-neutral-900 dark:text-neutral-100">
              {blueprint.model || "Default"}
            </div>
          </div>

          {blueprint.config && Object.keys(blueprint.config).length > 0 && (
            <div>
              <div className="text-xs font-medium text-neutral-500 mb-1">
                Configuration
              </div>
              <pre className="text-xs bg-neutral-100 dark:bg-neutral-900 p-3 rounded-lg overflow-auto max-h-48 text-neutral-800 dark:text-neutral-200">
                {JSON.stringify(blueprint.config, null, 2)}
              </pre>
            </div>
          )}

          <div>
            <div className="text-xs font-medium text-neutral-500 mb-1">
              Capabilities ({blueprint.capabilities.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {blueprint.capabilities.map((cap) => (
                <span
                  key={cap}
                  className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium",
                    cap.startsWith("@")
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                      : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                  )}
                >
                  {cap}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-neutral-500 mb-1">
              System Prompt
            </div>
            <pre className="text-xs bg-neutral-100 dark:bg-neutral-900 p-3 rounded-lg overflow-auto max-h-48 text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap">
              {blueprint.prompt}
            </pre>
          </div>

          {(blueprint.createdAt || blueprint.updatedAt) && (
            <div className="flex gap-4 text-xs text-neutral-500 pt-2 border-t border-neutral-200 dark:border-neutral-700">
              {blueprint.createdAt && (
                <span>Created: {new Date(blueprint.createdAt).toLocaleString()}</span>
              )}
              {blueprint.updatedAt && (
                <span>Updated: {new Date(blueprint.updatedAt).toLocaleString()}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BlueprintEditor({
  blueprints,
  plugins,
  tools,
  onCreateBlueprint,
  onUpdateBlueprint,
  onDeleteBlueprint,
  onTestBlueprint,
}: BlueprintEditorProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingBlueprint, setEditingBlueprint] = useState<AgentBlueprint | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleCreate = async (data: BlueprintFormData) => {
    const blueprint: Omit<AgentBlueprint, "createdAt" | "updatedAt"> = {
      name: data.name,
      description: data.description,
      prompt: data.prompt,
      capabilities: data.capabilities,
      model: data.model || undefined,
      status: data.status,
      config: data.config.trim() ? JSON.parse(data.config) : undefined,
    };
    await onCreateBlueprint(blueprint);
    setShowCreateForm(false);
  };

  const handleUpdate = async (data: BlueprintFormData) => {
    if (!editingBlueprint) return;
    const blueprint: AgentBlueprint = {
      ...editingBlueprint,
      name: data.name,
      description: data.description,
      prompt: data.prompt,
      capabilities: data.capabilities,
      model: data.model || undefined,
      status: data.status,
      config: data.config.trim() ? JSON.parse(data.config) : undefined,
    };
    await onUpdateBlueprint(blueprint);
    setEditingBlueprint(null);
  };

  const handleDuplicate = (blueprint: AgentBlueprint) => {
    setShowCreateForm(true);
    setEditingBlueprint({
      ...blueprint,
      name: `${blueprint.name}-copy`,
      status: "draft",
    } as AgentBlueprint);
  };

  const blueprintToFormData = (bp: AgentBlueprint | null): Partial<BlueprintFormData> | undefined => {
    if (!bp) return undefined;
    return {
      name: bp.name,
      description: bp.description,
      prompt: bp.prompt,
      capabilities: bp.capabilities,
      model: bp.model || "",
      status: bp.status || "active",
      config: bp.config ? JSON.stringify(bp.config, null, 2) : "",
    };
  };

  return (
    <div className="space-y-3">
      {showCreateForm || editingBlueprint ? (
        <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
            {editingBlueprint && !showCreateForm ? "Edit Blueprint" : "Create Blueprint"}
          </h3>
          <BlueprintForm
            initialData={blueprintToFormData(editingBlueprint)}
            plugins={plugins}
            tools={tools}
            onSubmit={editingBlueprint && !showCreateForm ? handleUpdate : handleCreate}
            onCancel={() => {
              setShowCreateForm(false);
              setEditingBlueprint(null);
            }}
            isEdit={!!editingBlueprint && !showCreateForm}
          />
        </div>
      ) : (
        <>
          {blueprints.length === 0 ? (
            <div className="text-center py-8 text-neutral-500">
              <p className="text-sm">No blueprints yet</p>
              <p className="text-xs mt-1">Create your first agent blueprint</p>
            </div>
          ) : (
            <div className="space-y-2">
              {blueprints.map((bp) => (
                <BlueprintCard
                  key={bp.name}
                  blueprint={bp}
                  onEdit={() => setEditingBlueprint(bp)}
                  onDelete={() => setDeleteConfirm(bp.name)}
                  onDuplicate={() => handleDuplicate(bp)}
                  onTest={onTestBlueprint ? () => onTestBlueprint(bp.name) : undefined}
                />
              ))}
            </div>
          )}

          <div className="flex justify-end pt-2 border-t border-neutral-200 dark:border-neutral-700">
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setShowCreateForm(true)}
            >
              New Blueprint
            </Button>
          </div>
        </>
      )}

      {deleteConfirm && (
        <ConfirmModal
          title="Delete Blueprint"
          message={`Are you sure you want to delete "${deleteConfirm}"? This will not affect existing agents using this blueprint.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => {
            onDeleteBlueprint(deleteConfirm);
            setDeleteConfirm(null);
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
