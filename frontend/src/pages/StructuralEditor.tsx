import { useCallback, useEffect, useRef, useState } from "react";
import { EditorCanvas } from "../components/EditorCanvas";
import type { ColumnElement, BeamElement, ShearWallElement, StructuralElements } from "../components/EditorCanvas";
import { EditorToolbar } from "../components/EditorToolbar";
import type { EditorTool } from "../components/EditorToolbar";

const EMPTY_ELEMENTS: StructuralElements = { columns: [], beams: [], shearWalls: [] };

function normalizeStructuralElements(se: Record<string, unknown> | undefined): StructuralElements {
  if (!se || typeof se !== "object") return EMPTY_ELEMENTS;
  const cols = Array.isArray(se.columns) ? se.columns : [];
  const beams = Array.isArray(se.beams) ? se.beams : [];
  const walls = Array.isArray(se.shearWalls) ? se.shearWalls : Array.isArray(se.slabs) ? se.slabs : [];
  return { columns: cols, beams, shearWalls: walls };
}

let _nextId = Date.now();
function uid(prefix: string): string {
  return `${prefix}_${++_nextId}`;
}

const FLOORPLAN_BASE = { w: 1122.5, h: 1266.5 };

// ---------- 修改弹窗 ----------
const styleOverlay: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0,0,0,0.3)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10000,
};
const styleBox: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 24,
  minWidth: 320,
  maxWidth: 420,
  boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
};
const styleRow: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", marginBottom: 10 };
const styleLabel: React.CSSProperties = { width: 72, fontSize: 13, fontWeight: 600, color: "#475569" };
const styleInput: React.CSSProperties = { flex: 1, padding: "8px 10px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 };

function EditColumnModal({
  elements,
  col,
  onSave,
  onClose,
}: {
  elements: StructuralElements;
  col: ColumnElement;
  onSave: (next: StructuralElements) => void;
  onClose: () => void;
}): JSX.Element {
  const [x, setX] = useState(String(col.x));
  const [y, setY] = useState(String(col.y));
  const [width, setWidth] = useState(String(col.width));
  const [depth, setDepth] = useState(String(col.depth));
  const [label, setLabel] = useState(col.label);
  return (
    <div style={styleOverlay} onClick={onClose}>
      <div style={styleBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: "#1e293b" }}>修改柱</div>
        <div style={styleRow}><span style={styleLabel}>X</span><input style={styleInput} value={x} onChange={(e) => setX(e.target.value)} type="number" /></div>
        <div style={styleRow}><span style={styleLabel}>Y</span><input style={styleInput} value={y} onChange={(e) => setY(e.target.value)} type="number" /></div>
        <div style={styleRow}><span style={styleLabel}>宽</span><input style={styleInput} value={width} onChange={(e) => setWidth(e.target.value)} type="number" /></div>
        <div style={styleRow}><span style={styleLabel}>深</span><input style={styleInput} value={depth} onChange={(e) => setDepth(e.target.value)} type="number" /></div>
        <div style={styleRow}><span style={styleLabel}>标签</span><input style={styleInput} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer" }}>取消</button>
          <button
            onClick={() => {
              const cols = elements?.columns ?? [];
              const next = cols.map((c) =>
                c.id === col.id ? { ...c, x: Number(x), y: Number(y), width: Number(width), depth: Number(depth), label } : c
              );
              onSave({ columns: next, beams: elements?.beams ?? [], shearWalls: elements?.shearWalls ?? [] });
            }}
            style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer", fontWeight: 600 }}
          >确定</button>
        </div>
      </div>
    </div>
  );
}

function EditBeamModal({
  elements,
  beam,
  onSave,
  onClose,
}: {
  elements: StructuralElements;
  beam: BeamElement;
  onSave: (next: StructuralElements) => void;
  onClose: () => void;
}): JSX.Element {
  const [x1, setX1] = useState(String(beam.x1));
  const [y1, setY1] = useState(String(beam.y1));
  const [x2, setX2] = useState(String(beam.x2));
  const [y2, setY2] = useState(String(beam.y2));
  const [width, setW] = useState(String(beam.width));
  const [height, setH] = useState(String(beam.height));
  const [label, setLabel] = useState(beam.label);
  return (
    <div style={styleOverlay} onClick={onClose}>
      <div style={styleBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: "#1e293b" }}>修改梁</div>
        <div style={styleRow}><span style={styleLabel}>X1</span><input style={styleInput} value={x1} onChange={(e) => setX1(e.target.value)} type="number" /></div>
        <div style={styleRow}><span style={styleLabel}>Y1</span><input style={styleInput} value={y1} onChange={(e) => setY1(e.target.value)} type="number" /></div>
        <div style={styleRow}><span style={styleLabel}>X2</span><input style={styleInput} value={x2} onChange={(e) => setX2(e.target.value)} type="number" /></div>
        <div style={styleRow}><span style={styleLabel}>Y2</span><input style={styleInput} value={y2} onChange={(e) => setY2(e.target.value)} type="number" /></div>
        <div style={styleRow}><span style={styleLabel}>宽</span><input style={styleInput} value={width} onChange={(e) => setW(e.target.value)} type="number" /></div>
        <div style={styleRow}><span style={styleLabel}>高</span><input style={styleInput} value={height} onChange={(e) => setH(e.target.value)} type="number" /></div>
        <div style={styleRow}><span style={styleLabel}>标签</span><input style={styleInput} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer" }}>取消</button>
          <button
            onClick={() => {
              const bms = elements?.beams ?? [];
              const next = bms.map((b) =>
                b.id === beam.id ? { ...b, x1: Number(x1), y1: Number(y1), x2: Number(x2), y2: Number(y2), width: Number(width), height: Number(height), label } : b
              );
              onSave({ columns: elements?.columns ?? [], beams: next, shearWalls: elements?.shearWalls ?? [] });
            }}
            style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer", fontWeight: 600 }}
          >确定</button>
        </div>
      </div>
    </div>
  );
}

function EditShearWallModal({
  elements,
  wall,
  onSave,
  onClose,
}: {
  elements: StructuralElements;
  wall: ShearWallElement;
  onSave: (next: StructuralElements) => void;
  onClose: () => void;
}): JSX.Element {
  const [thickness, setThickness] = useState(String(wall.thickness));
  const [label, setLabel] = useState(wall.label);
  const [pointsText, setPointsText] = useState(wall.points.map((p) => `${p[0]},${p[1]}`).join("\n"));
  return (
    <div style={styleOverlay} onClick={onClose}>
      <div style={styleBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: "#1e293b" }}>修改剪力墙</div>
        <div style={styleRow}><span style={styleLabel}>厚度(mm)</span><input style={styleInput} value={thickness} onChange={(e) => setThickness(e.target.value)} type="number" /></div>
        <div style={styleRow}><span style={styleLabel}>标签</span><input style={styleInput} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        <div style={{ marginBottom: 10 }}>
          <div style={styleLabel}>顶点 (每行 x,y)</div>
          <textarea
            value={pointsText}
            onChange={(e) => setPointsText(e.target.value)}
            rows={4}
            style={{ width: "100%", padding: 8, fontSize: 12, border: "1px solid #cbd5e1", borderRadius: 6, marginTop: 4 }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer" }}>取消</button>
          <button
            onClick={() => {
              const points: number[][] = [];
              pointsText.trim().split("\n").forEach((line) => {
                const part = line.trim().split(/[,，\s]+/);
                if (part.length >= 2) points.push([Number(part[0]), Number(part[1])]);
              });
                if (points.length >= 3) {
                  const walls = elements?.shearWalls ?? [];
                  const next = walls.map((s) =>
                    s.id === wall.id ? { ...s, points, thickness: Number(thickness), label } : s
                  );
                  onSave({ columns: elements?.columns ?? [], beams: elements?.beams ?? [], shearWalls: next });
                }
            }}
            style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer", fontWeight: 600 }}
          >确定</button>
        </div>
      </div>
    </div>
  );
}

function EditElementModal({
  elements,
  selectedId,
  onSave,
  onClose,
}: {
  elements: StructuralElements;
  selectedId: string;
  onSave: (next: StructuralElements) => void;
  onClose: () => void;
}): JSX.Element | null {
  const col = (elements?.columns ?? []).find((c) => c.id === selectedId);
  const beam = (elements?.beams ?? []).find((b) => b.id === selectedId);
  const wall = (elements?.shearWalls ?? []).find((s) => s.id === selectedId);
  if (col) return <EditColumnModal elements={elements} col={col} onSave={onSave} onClose={onClose} />;
  if (beam) return <EditBeamModal elements={elements} beam={beam} onSave={onSave} onClose={onClose} />;
  if (wall) return <EditShearWallModal elements={elements} wall={wall} onSave={onSave} onClose={onClose} />;
  return null;
}

/**
 * Hidden structural-element editor page.
 * Accessible via `?page=editor` query parameter (not shown in the main navigation).
 *
 * Allows visual placement of columns, beams and shear walls on top of the 2D
 * floorplan and persists the result to the server-side
 * `floorplan_3d_config.json` via REST API.
 */
export function StructuralEditor(): JSX.Element {
  const [tool, setTool] = useState<EditorTool>("select");
  const [elements, setElements] = useState<StructuralElements>(EMPTY_ELEMENTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState<boolean>(false);
  const [wallHeight, setWallHeight] = useState<number>(2.8);
  const [floorHeight, setFloorHeight] = useState<number>(3.0);
  const [saving, setSaving] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---------- Load from server on mount ----------
  useEffect(() => {
    loadFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFromServer = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/structural_config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWallHeight(data.wallHeight ?? 2.8);
      setFloorHeight(data.floorHeight ?? 3.0);
      setElements(normalizeStructuralElements(data.structuralElements));
      setStatusMsg("已从服务器加载配置");
    } catch (e: unknown) {
      setStatusMsg(`加载失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  // ---------- Save to server ----------
  const saveToServer = useCallback(async (): Promise<void> => {
    setSaving(true);
    try {
      const body = { wallHeight, floorHeight, structuralElements: elements };
      const res = await fetch("/api/structural_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatusMsg("已保存到服务器 ✓");
    } catch (e: unknown) {
      setStatusMsg(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [wallHeight, floorHeight, elements]);

  // ---------- Export JSON ----------
  const exportJson = useCallback((): void => {
    const body = { wallHeight, floorHeight, structuralElements: elements };
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "floorplan_3d_config.json";
    a.click();
    URL.revokeObjectURL(url);
    setStatusMsg("JSON 已导出");
  }, [wallHeight, floorHeight, elements]);

  // ---------- Import JSON ----------
  const importJson = useCallback((): void => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (): void => {
      try {
        const data = JSON.parse(reader.result as string);
        setWallHeight(data.wallHeight ?? 2.8);
        setFloorHeight(data.floorHeight ?? 3.0);
        setElements(normalizeStructuralElements(data.structuralElements));
        setStatusMsg("JSON 已导入");
      } catch {
        setStatusMsg("导入失败: 无效的 JSON 文件");
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-imported
    e.target.value = "";
  }, []);

  // ---------- 增：新增当前类型构件 ----------
  const handleAdd = useCallback((): void => {
    const cx = FLOORPLAN_BASE.w / 2;
    const cy = FLOORPLAN_BASE.h / 2;
    if (tool === "column") {
      const cols = elements?.columns ?? [];
      const col: ColumnElement = {
        id: uid("col"),
        x: Math.round(cx / 10) * 10,
        y: Math.round(cy / 10) * 10,
        width: 40,
        depth: 40,
        height: 2.8,
        label: `KZ-${cols.length + 1}`,
      };
      setElements({ ...elements, columns: [...cols, col], beams: elements?.beams ?? [], shearWalls: elements?.shearWalls ?? [] });
      setSelectedId(col.id);
      setTool("select");
    } else if (tool === "beam") {
      const beams = elements?.beams ?? [];
      const beam: BeamElement = {
        id: uid("beam"),
        x1: cx - 80,
        y1: cy,
        x2: cx + 80,
        y2: cy,
        width: 25,
        height: 50,
        label: `KL-${beams.length + 1}`,
      };
      setElements({ ...elements, columns: elements?.columns ?? [], beams: [...beams, beam], shearWalls: elements?.shearWalls ?? [] });
      setSelectedId(beam.id);
      setTool("select");
    } else if (tool === "shearWall") {
      const walls = elements?.shearWalls ?? [];
      const w: ShearWallElement = {
        id: uid("qw"),
        points: [[cx - 100, cy - 80], [cx + 100, cy - 80], [cx + 100, cy + 80], [cx - 100, cy + 80]],
        thickness: 200,
        label: `QW-${walls.length + 1}`,
      };
      setElements({ ...elements, columns: elements?.columns ?? [], beams: elements?.beams ?? [], shearWalls: [...walls, w] });
      setSelectedId(w.id);
      setTool("select");
    }
  }, [tool, elements]);

  // ---------- 删：删除选中构件 ----------
  const handleDelete = useCallback((): void => {
    if (!selectedId) return;
    setElements({
      columns: (elements?.columns ?? []).filter((c) => c.id !== selectedId),
      beams: (elements?.beams ?? []).filter((b) => b.id !== selectedId),
      shearWalls: (elements?.shearWalls ?? []).filter((s) => s.id !== selectedId),
    });
    setSelectedId(null);
  }, [selectedId, elements]);

  // ---------- 改：打开修改弹窗 ----------
  const handleEdit = useCallback((): void => {
    if (selectedId) setEditModalOpen(true);
  }, [selectedId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: "12px 20px", background: "#1e293b", color: "#f1f5f9", display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 0.5 }}>结构构件编辑器</span>
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          柱: {(elements?.columns ?? []).length} | 梁: {(elements?.beams ?? []).length} | 剪力墙: {(elements?.shearWalls ?? []).length}
        </span>
        {statusMsg && <span style={{ fontSize: 12, marginLeft: "auto", opacity: 0.8 }}>{statusMsg}</span>}
      </div>

      {/* Toolbar */}
      <EditorToolbar
        activeTool={tool}
        onToolChange={setTool}
        selectedId={selectedId}
        onAdd={handleAdd}
        onDelete={handleDelete}
        onEdit={handleEdit}
        onSave={saveToServer}
        onLoad={loadFromServer}
        onExport={exportJson}
        onImport={importJson}
        saving={saving}
      />

      {/* Help hint */}
      <div style={{ padding: "6px 16px", background: "#fffbeb", borderBottom: "1px solid #fde68a", fontSize: 12, color: "#92400e" }}>
        {tool === "column" && "点击画布放置柱（40×40 默认尺寸）"}
        {tool === "beam" && "点击两次画布确定梁的两个端点"}
        {tool === "shearWall" && "依次点击画布添加剪力墙的顶点，双击闭合多边形"}
        {tool === "select" && "点击选中构件 → 拖拽移动 | 双击标签编辑 | 右键删除 | Delete 键删除选中"}
      </div>

      {/* Canvas */}
      <EditorCanvas
        activeTool={tool}
        elements={elements}
        onChange={setElements}
        selectedId={selectedId}
        onSelectedChange={setSelectedId}
      />

      {/* 修改弹窗 */}
      {editModalOpen && selectedId && (
        <EditElementModal
          elements={elements}
          selectedId={selectedId}
          onSave={(next) => {
            setElements(next);
            setEditModalOpen(false);
          }}
          onClose={() => setEditModalOpen(false)}
        />
      )}

      {/* Hidden file input for import */}
      <input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleFileChange} />
    </div>
  );
}
