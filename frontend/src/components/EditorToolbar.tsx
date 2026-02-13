import type { CSSProperties } from "react";

export type EditorTool = "select" | "column" | "beam" | "shearWall";

export type EditorToolbarProps = {
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  selectedId: string | null;
  onAdd: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onSave: () => void;
  onLoad: () => void;
  onExport: () => void;
  onImport: () => void;
  saving?: boolean;
};

const BTN: CSSProperties = {
  padding: "8px 14px",
  border: "1px solid rgba(100,116,139,0.3)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  background: "rgba(30,41,59,0.06)",
  color: "#1e293b",
  transition: "background 0.15s, color 0.15s",
};

const BTN_ACTIVE: CSSProperties = {
  ...BTN,
  background: "#2563eb",
  color: "#fff",
  borderColor: "#2563eb",
};

const DIVIDER: CSSProperties = {
  width: 1,
  height: 28,
  background: "rgba(100,116,139,0.2)",
  margin: "0 6px",
};

/**
 * Toolbar for the structural element editor.
 * Contains tool selection buttons (select/column/beam/shearWall) and file actions.
 */
export function EditorToolbar({
  activeTool,
  onToolChange,
  selectedId,
  onAdd,
  onDelete,
  onEdit,
  onSave,
  onLoad,
  onExport,
  onImport,
  saving,
}: EditorToolbarProps): JSX.Element {
  const tools: Array<{ id: EditorTool; label: string }> = [
    { id: "select", label: "选择 / 移动" },
    { id: "column", label: "柱" },
    { id: "beam", label: "梁" },
    { id: "shearWall", label: "剪力墙" },
  ];

  const canAdd = activeTool === "column" || activeTool === "beam" || activeTool === "shearWall";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "10px 16px",
        background: "#f8fafc",
        borderBottom: "1px solid rgba(100,116,139,0.15)",
        flexWrap: "wrap",
      }}
    >
      {tools.map((t) => (
        <button
          key={t.id}
          style={activeTool === t.id ? BTN_ACTIVE : BTN}
          onClick={() => onToolChange(t.id)}
        >
          {t.label}
        </button>
      ))}

      <div style={DIVIDER} />

      <button style={BTN} onClick={onAdd} disabled={!canAdd} title={canAdd ? "新增当前类型构件" : "请先选择柱/梁/剪力墙工具"}>
        新增
      </button>
      <button style={BTN} onClick={onDelete} disabled={!selectedId} title={selectedId ? "删除选中构件" : "请先选中一个构件"}>
        删除
      </button>
      <button style={BTN} onClick={onEdit} disabled={!selectedId} title={selectedId ? "修改选中构件" : "请先选中一个构件"}>
        修改
      </button>

      <div style={DIVIDER} />

      <button style={BTN} onClick={onSave} disabled={saving}>
        {saving ? "保存中…" : "保存到服务器"}
      </button>
      <button style={BTN} onClick={onLoad}>
        从服务器加载
      </button>

      <div style={DIVIDER} />

      <button style={BTN} onClick={onExport}>
        导出 JSON
      </button>
      <button style={BTN} onClick={onImport}>
        导入 JSON
      </button>
    </div>
  );
}
