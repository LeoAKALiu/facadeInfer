import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorTool } from "./EditorToolbar";

// ---------------------------------------------------------------------------
// Data types – match the JSON schema in floorplan_3d_config.json
// ---------------------------------------------------------------------------

export type ColumnElement = {
  id: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  label: string;
};

export type BeamElement = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
  label: string;
};

export type ShearWallElement = {
  id: string;
  points: number[][];
  thickness: number;
  label: string;
};

export type StructuralElements = {
  columns: ColumnElement[];
  beams: BeamElement[];
  shearWalls: ShearWallElement[];
};

// ---------------------------------------------------------------------------
// Room layout (same as Floorplan3DView / styles.css)
// ---------------------------------------------------------------------------

const FLOORPLAN_BASE = { w: 1122.5, h: 1266.5 };

const ROOM_LAYOUT: Record<string, { left: number; top: number; width: number; height: number }> = {
  livingroom: { left: 0, top: 14.8, width: 67.5, height: 72.5 },
  balcony: { left: 4.5, top: 87.1, width: 28.0, height: 11.9 },
  kitchen: { left: 15.4, top: 0, width: 22.3, height: 25.3 },
  bathroom: { left: 37.5, top: 21.5, width: 17.8, height: 28.8 },
  bedroom1: { left: 67.3, top: 50.1, width: 32.7, height: 37.2 },
  bedroom2: { left: 55.1, top: 21.5, width: 31.9, height: 28.0 },
  bedroom3: { left: 37.5, top: 60.3, width: 30.0, height: 27.0 },
};

const ROOM_COLORS: Record<string, string> = {
  livingroom: "rgba(250,204,21,0.12)",
  balcony: "rgba(148,163,184,0.12)",
  kitchen: "rgba(34,197,94,0.12)",
  bathroom: "rgba(56,189,248,0.12)",
  bedroom1: "rgba(168,85,247,0.12)",
  bedroom2: "rgba(168,85,247,0.12)",
  bedroom3: "rgba(168,85,247,0.12)",
};

const ROOM_NAMES = Object.keys(ROOM_LAYOUT);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextId = Date.now();
function uid(prefix: string): string {
  return `${prefix}_${++_nextId}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type EditorCanvasProps = {
  activeTool: EditorTool;
  elements: StructuralElements;
  onChange: (next: StructuralElements) => void;
  selectedId: string | null;
  onSelectedChange: (id: string | null) => void;
};

/**
 * Interactive 2D SVG canvas for placing structural elements on top of the floorplan.
 */
export function EditorCanvas({ activeTool, elements, onChange, selectedId: selected, onSelectedChange: setSelected }: EditorCanvasProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [beamStart, setBeamStart] = useState<{ x: number; y: number } | null>(null);
  const [shearWallPoints, setShearWallPoints] = useState<number[][]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState<string>("");

  const columns = elements?.columns ?? [];
  const beams = elements?.beams ?? [];
  const shearWalls = elements?.shearWalls ?? [];
  const safeElements: StructuralElements = { columns, beams, shearWalls };

  // Convert mouse event to SVG coordinates
  const toSvg = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * FLOORPLAN_BASE.w;
    const y = ((e.clientY - rect.top) / rect.height) * FLOORPLAN_BASE.h;
    return { x: clamp(x, 0, FLOORPLAN_BASE.w), y: clamp(y, 0, FLOORPLAN_BASE.h) };
  }, []);

  // Snap to grid (10px)
  const snap = useCallback((v: number): number => Math.round(v / 10) * 10, []);

  // ----- Click handler -----
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const { x, y } = toSvg(e);

      if (activeTool === "column") {
        const col: ColumnElement = {
          id: uid("col"),
          x: snap(x),
          y: snap(y),
          width: 40,
          depth: 40,
          height: 2.8,
          label: `KZ-${columns.length + 1}`,
        };
        onChange({ ...safeElements, columns: [...columns, col] });
      } else if (activeTool === "beam") {
        if (!beamStart) {
          setBeamStart({ x: snap(x), y: snap(y) });
        } else {
          const beam: BeamElement = {
            id: uid("beam"),
            x1: beamStart.x,
            y1: beamStart.y,
            x2: snap(x),
            y2: snap(y),
            width: 25,
            height: 50,
            label: `KL-${beams.length + 1}`,
          };
          onChange({ ...safeElements, beams: [...beams, beam] });
          setBeamStart(null);
        }
      } else if (activeTool === "shearWall") {
        setShearWallPoints((prev) => [...prev, [snap(x), snap(y)]]);
      } else if (activeTool === "select") {
        setSelected(null);
      }
    },
    [activeTool, beamStart, columns, beams, shearWalls, safeElements, onChange, snap, toSvg, shearWallPoints]
  );

  // ----- Double-click to close shear wall polygon -----
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (activeTool === "shearWall" && shearWallPoints.length >= 3) {
        e.preventDefault();
        e.stopPropagation();
        const wall: ShearWallElement = {
          id: uid("qw"),
          points: [...shearWallPoints],
          thickness: 200,
          label: `QW-${shearWalls.length + 1}`,
        };
        onChange({ ...safeElements, shearWalls: [...shearWalls, wall] });
        setShearWallPoints([]);
      }
    },
    [activeTool, safeElements, shearWalls, onChange, shearWallPoints]
  );

  // ----- Drag (select tool) -----
  const handlePointerDown = useCallback(
    (id: string, e: React.PointerEvent) => {
      if (activeTool !== "select") return;
      e.stopPropagation();
      setSelected(id);
      const { x, y } = toSvg(e as unknown as React.MouseEvent);
      setDragging({ id, ox: x, oy: y });
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [activeTool, toSvg]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const { x, y } = toSvg(e as unknown as React.MouseEvent);
      const dx = snap(x - dragging.ox);
      const dy = snap(y - dragging.oy);
      if (dx === 0 && dy === 0) return;

      // Move column
      const col = columns.find((c) => c.id === dragging.id);
      if (col) {
        onChange({
          ...safeElements,
          columns: columns.map((c) =>
            c.id === dragging.id ? { ...c, x: c.x + dx, y: c.y + dy } : c
          ),
        });
        setDragging({ ...dragging, ox: dragging.ox + dx, oy: dragging.oy + dy });
        return;
      }

      // Move beam (both endpoints)
      const beam = beams.find((b) => b.id === dragging.id);
      if (beam) {
        onChange({
          ...safeElements,
          beams: beams.map((b) =>
            b.id === dragging.id
              ? { ...b, x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 + dx, y2: b.y2 + dy }
              : b
          ),
        });
        setDragging({ ...dragging, ox: dragging.ox + dx, oy: dragging.oy + dy });
        return;
      }

      // Move shear wall (all points)
      const wall = shearWalls.find((s) => s.id === dragging.id);
      if (wall && Array.isArray(wall.points)) {
        onChange({
          ...safeElements,
          shearWalls: shearWalls.map((s) =>
            s.id === dragging.id && Array.isArray(s.points)
              ? { ...s, points: s.points.map(([px, py]) => [px + dx, py + dy]) }
              : s
          ),
        });
        setDragging({ ...dragging, ox: dragging.ox + dx, oy: dragging.oy + dy });
      }
    },
    [dragging, columns, beams, shearWalls, safeElements, onChange, snap, toSvg]
  );

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  // ----- Right-click to delete -----
  const handleContextMenu = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onChange({
        columns: columns.filter((c) => c.id !== id),
        beams: beams.filter((b) => b.id !== id),
        shearWalls: shearWalls.filter((s) => s.id !== id),
      });
      if (selected === id) setSelected(null);
    },
    [columns, beams, shearWalls, onChange, selected]
  );

  // ----- Inline label editing -----
  const startEdit = useCallback(
    (id: string, currentLabel: string, e: React.MouseEvent) => {
      if (activeTool !== "select") return;
      e.stopPropagation();
      setEditingId(id);
      setEditLabel(currentLabel);
    },
    [activeTool]
  );

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    const label = editLabel.trim() || editingId;
    onChange({
      columns: columns.map((c) => (c.id === editingId ? { ...c, label } : c)),
      beams: beams.map((b) => (b.id === editingId ? { ...b, label } : b)),
      shearWalls: shearWalls.map((s) => (s.id === editingId ? { ...s, label } : s)),
    });
    setEditingId(null);
  }, [editingId, editLabel, columns, beams, shearWalls, onChange]);

  // Cancel pending drawing when tool changes
  useEffect(() => {
    setBeamStart(null);
    setShearWallPoints([]);
  }, [activeTool]);

  // Keyboard: Escape to cancel / Delete to remove selected
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setBeamStart(null);
        setShearWallPoints([]);
        setSelected(null);
        setEditingId(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !editingId) {
        onChange({
          columns: columns.filter((c) => c.id !== selected),
          beams: beams.filter((b) => b.id !== selected),
          shearWalls: shearWalls.filter((s) => s.id !== selected),
        });
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, editingId, columns, beams, shearWalls, onChange]);

  // ----- Render helpers -----
  const selStroke = (id: string): string => (id === selected ? "#f97316" : "transparent");

  return (
    <div style={{ flex: 1, overflow: "auto", background: "#f1f5f9", display: "flex", justifyContent: "center", padding: 24 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${FLOORPLAN_BASE.w} ${FLOORPLAN_BASE.h}`}
        style={{ width: "100%", maxWidth: 800, height: "auto", background: "#fff", borderRadius: 8, boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Room backgrounds */}
        {ROOM_NAMES.map((name) => {
          const r = ROOM_LAYOUT[name];
          const x = (r.left / 100) * FLOORPLAN_BASE.w;
          const y = (r.top / 100) * FLOORPLAN_BASE.h;
          const w = (r.width / 100) * FLOORPLAN_BASE.w;
          const h = (r.height / 100) * FLOORPLAN_BASE.h;
          return (
            <g key={name}>
              <rect x={x} y={y} width={w} height={h} fill={ROOM_COLORS[name]} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 2" />
              <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central" fontSize={18} fontWeight={700} fill="#475569" opacity={0.5}>
                {name}
              </text>
            </g>
          );
        })}

        {/* Grid lines (light) */}
        {Array.from({ length: Math.floor(FLOORPLAN_BASE.w / 100) }, (_, i) => (
          <line key={`gv${i}`} x1={(i + 1) * 100} y1={0} x2={(i + 1) * 100} y2={FLOORPLAN_BASE.h} stroke="#e2e8f0" strokeWidth={0.5} />
        ))}
        {Array.from({ length: Math.floor(FLOORPLAN_BASE.h / 100) }, (_, i) => (
          <line key={`gh${i}`} x1={0} y1={(i + 1) * 100} x2={FLOORPLAN_BASE.w} y2={(i + 1) * 100} stroke="#e2e8f0" strokeWidth={0.5} />
        ))}

        {/* Shear walls */}
        {shearWalls.map((s) => {
          const pts = Array.isArray(s?.points) ? s.points : [];
          if (pts.length < 2) return null;
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ") + " Z";
          const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
          const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
          return (
            <g key={s.id} onPointerDown={(e) => handlePointerDown(s.id, e)} onContextMenu={(e) => handleContextMenu(s.id, e)}>
              <path d={d} fill="rgba(180,140,80,0.25)" stroke="#94a3b8" strokeWidth={2} />
              <path d={d} fill="none" stroke={selStroke(s.id)} strokeWidth={3} />
              <text
                x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                fontSize={14} fontWeight={700} fill="#475569" style={{ cursor: "pointer" }}
                onDoubleClick={(e) => startEdit(s.id, s.label, e)}
              >
                {s.label}
              </text>
            </g>
          );
        })}

        {/* Beams */}
        {beams.map((b) => {
          const mx = (b.x1 + b.x2) / 2;
          const my = (b.y1 + b.y2) / 2;
          return (
            <g key={b.id} onPointerDown={(e) => handlePointerDown(b.id, e)} onContextMenu={(e) => handleContextMenu(b.id, e)}>
              <line x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} stroke="#4682B4" strokeWidth={b.width * 0.6} strokeLinecap="round" />
              <line x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} stroke={selStroke(b.id)} strokeWidth={b.width * 0.6 + 4} strokeLinecap="round" fill="none" />
              {/* Endpoints */}
              <circle cx={b.x1} cy={b.y1} r={6} fill="#4682B4" />
              <circle cx={b.x2} cy={b.y2} r={6} fill="#4682B4" />
              <text
                x={mx} y={my - 12} textAnchor="middle" fontSize={12} fontWeight={700} fill="#1e3a5f"
                style={{ cursor: "pointer" }}
                onDoubleClick={(e) => startEdit(b.id, b.label, e)}
              >
                {b.label}
              </text>
            </g>
          );
        })}

        {/* Columns */}
        {columns.map((c) => (
          <g key={c.id} onPointerDown={(e) => handlePointerDown(c.id, e)} onContextMenu={(e) => handleContextMenu(c.id, e)}>
            <rect
              x={c.x - c.width / 2} y={c.y - c.depth / 2}
              width={c.width} height={c.depth}
              fill="#808080" stroke={selected === c.id ? "#f97316" : "#333"} strokeWidth={selected === c.id ? 3 : 1.5} rx={3}
            />
            <text
              x={c.x} y={c.y - c.depth / 2 - 8} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1e293b"
              style={{ cursor: "pointer" }}
              onDoubleClick={(e) => startEdit(c.id, c.label, e)}
            >
              {c.label}
            </text>
          </g>
        ))}

        {/* In-progress beam line */}
        {beamStart && (
          <circle cx={beamStart.x} cy={beamStart.y} r={6} fill="#4682B4" opacity={0.6}>
            <animate attributeName="r" values="6;10;6" dur="1s" repeatCount="indefinite" />
          </circle>
        )}

        {/* In-progress shear wall polygon */}
        {shearWallPoints.length > 0 && (
          <polyline
            points={shearWallPoints.map((p) => `${p[0]},${p[1]}`).join(" ")}
            fill="none" stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 3"
          />
        )}
      </svg>

      {/* Inline label editor (overlay) */}
      {editingId && (
        <div
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
          }}
          onClick={commitEdit}
        >
          <div
            style={{ background: "#fff", borderRadius: 10, padding: 20, minWidth: 280, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#1e293b" }}>编辑标签</div>
            <input
              autoFocus
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingId(null); }}
              style={{ width: "100%", padding: "8px 12px", fontSize: 14, border: "1px solid #cbd5e1", borderRadius: 6, outline: "none" }}
            />
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setEditingId(null)} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer" }}>取消</button>
              <button onClick={commitEdit} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer", fontWeight: 600 }}>确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
