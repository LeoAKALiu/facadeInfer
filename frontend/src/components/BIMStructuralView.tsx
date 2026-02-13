import { useCallback, useEffect, useRef, useState } from "react";
// xeokit-sdk TypeScript definitions are stricter than the actual runtime API,
// so we import via `any` wrappers and call methods with `as any` where needed.
import {
  Viewer,
  SceneModel,
  NavCubePlugin,
  SectionPlanesPlugin,
  DistanceMeasurementsPlugin,
  DistanceMeasurementsMouseControl,
  buildBoxGeometry,
} from "@xeokit/xeokit-sdk";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Types – keep in sync with EditorCanvas types & floorplan_3d_config.json
// ---------------------------------------------------------------------------

type ColumnElement = {
  id: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  label: string;
};

type BeamElement = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
  label: string;
};

type ShearWallElement = {
  id: string;
  points: number[][];
  thickness: number;
  label: string;
};

type Config = {
  wallHeight: number;
  floorHeight: number;
  structuralElements?: {
    columns?: ColumnElement[];
    beams?: BeamElement[];
    shearWalls?: ShearWallElement[];
  };
};

// ---------------------------------------------------------------------------
// Room layout (same as 2D / Floorplan3DView)
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

const ROOM_COLORS: Record<string, number[]> = {
  livingroom: [0.98, 0.80, 0.08],
  balcony: [0.58, 0.64, 0.72],
  kitchen: [0.13, 0.77, 0.37],
  bathroom: [0.22, 0.74, 0.97],
  bedroom1: [0.66, 0.33, 0.97],
  bedroom2: [0.66, 0.33, 0.97],
  bedroom3: [0.66, 0.33, 0.97],
};

const ROOM_NAMES = Object.keys(ROOM_LAYOUT);

/** Scale factor: floorplan px → metres (approx 1px ≈ 10mm). */
const PX_TO_M = 0.01;

/** Safely get positions/normals/indices from buildBoxGeometry; skip createGeometry if missing (avoids .length on undefined). */
function safeBoxGeometry(boxData: any): { positions: number[]; normals: number[]; indices: number[] } | null {
  const positions = Array.isArray(boxData?.positions) ? boxData.positions : null;
  const normals = Array.isArray(boxData?.normals) ? boxData.normals : null;
  const indices = Array.isArray(boxData?.indices) ? boxData.indices : null;
  if (!positions?.length || !normals?.length || !indices?.length) return null;
  return { positions, normals, indices };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type BIMStructuralViewProps = {
  className?: string;
  /** Increment to force a config reload from server. */
  reloadKey?: number;
};

/**
 * BIM-style 3D structural view using xeokit-sdk.
 *
 * Programmatically builds rooms (from ROOM_LAYOUT) and structural elements
 * (columns, beams, shearWalls from server config) as xeokit SceneModel geometry.
 * Supports section planes, distance measurements, and NavCube.
 */
export function BIMStructuralView({ className = "", reloadKey = 0 }: BIMStructuralViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const navCubeRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [xrayMode, setXrayMode] = useState<boolean>(false);
  const [measuringActive, setMeasuringActive] = useState<boolean>(false);
  const measureControlRef = useRef<DistanceMeasurementsMouseControl | null>(null);

  // ---------- Build model ----------
  const buildModel = useCallback(
    (viewer: Viewer, config: Config) => {
      // Remove previous model
      const old = viewer.scene.models["structural"];
      if (old) old.destroy();

      const sceneModel = new SceneModel(viewer.scene, {
        id: "structural",
        isModel: true,
        edges: true,
      });

      const wallH = (config.wallHeight ?? 2.8);
      const se = config.structuralElements;

      // ---- Rooms (translucent boxes) ----
      let geomIdx = 0;
      for (const name of ROOM_NAMES) {
        const r = ROOM_LAYOUT[name];
        const x = (r.left / 100) * FLOORPLAN_BASE.w * PX_TO_M;
        const z = (r.top / 100) * FLOORPLAN_BASE.h * PX_TO_M;
        const w = (r.width / 100) * FLOORPLAN_BASE.w * PX_TO_M;
        const d = (r.height / 100) * FLOORPLAN_BASE.h * PX_TO_M;

        const gid = `room_geom_${geomIdx++}`;
        const boxData: any = buildBoxGeometry({ xSize: w / 2, ySize: wallH / 2, zSize: d / 2 });
        const roomGeom = safeBoxGeometry(boxData);
        if (!roomGeom) continue;
        (sceneModel as any).createGeometry({ id: gid, primitive: "triangles", positions: roomGeom.positions, normals: roomGeom.normals, indices: roomGeom.indices });

        const color = ROOM_COLORS[name] ?? [0.6, 0.6, 0.6];
        (sceneModel as any).createMesh({ id: `room_mesh_${name}`, geometryId: gid, position: [x + w / 2, wallH / 2, z + d / 2], color, opacity: 0.25 });
        (sceneModel as any).createEntity({ id: `room_${name}`, meshIds: [`room_mesh_${name}`], isObject: true });
      }

      // ---- Columns ----
      for (const col of se?.columns ?? []) {
        const gid = `col_geom_${geomIdx++}`;
        const cw = (col.width ?? 40) * PX_TO_M;
        const cd = (col.depth ?? 40) * PX_TO_M;
        const ch = col.height ?? wallH;
        const colBox: any = buildBoxGeometry({ xSize: cw / 2, ySize: ch / 2, zSize: cd / 2 });
        const colGeom = safeBoxGeometry(colBox);
        if (!colGeom) continue;
        (sceneModel as any).createGeometry({ id: gid, primitive: "triangles", positions: colGeom.positions, normals: colGeom.normals, indices: colGeom.indices });
        (sceneModel as any).createMesh({ id: `col_mesh_${col.id}`, geometryId: gid, position: [col.x * PX_TO_M, ch / 2, col.y * PX_TO_M], color: [0.50, 0.50, 0.50], opacity: 1.0 });
        (sceneModel as any).createEntity({ id: `col_${col.id}`, meshIds: [`col_mesh_${col.id}`], isObject: true });
      }

      // ---- Beams ----
      for (const beam of se?.beams ?? []) {
        const gid = `beam_geom_${geomIdx++}`;
        const bx1 = beam.x1 * PX_TO_M;
        const bz1 = beam.y1 * PX_TO_M;
        const bx2 = beam.x2 * PX_TO_M;
        const bz2 = beam.y2 * PX_TO_M;
        const dx = bx2 - bx1;
        const dz = bz2 - bz1;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.001) continue;
        const bw = (beam.width ?? 25) * PX_TO_M;
        const bh = (beam.height ?? 50) * PX_TO_M;
        const angle = Math.atan2(dz, dx);

        const beamBox: any = buildBoxGeometry({ xSize: len / 2, ySize: bh / 2, zSize: bw / 2 });
        const beamGeom = safeBoxGeometry(beamBox);
        if (!beamGeom) continue;
        (sceneModel as any).createGeometry({ id: gid, primitive: "triangles", positions: beamGeom.positions, normals: beamGeom.normals, indices: beamGeom.indices });
        (sceneModel as any).createMesh({ id: `beam_mesh_${beam.id}`, geometryId: gid, position: [(bx1 + bx2) / 2, wallH - bh / 2, (bz1 + bz2) / 2], rotation: [0, -(angle * 180) / Math.PI, 0], color: [0.27, 0.51, 0.71], opacity: 1.0 });
        (sceneModel as any).createEntity({ id: `beam_${beam.id}`, meshIds: [`beam_mesh_${beam.id}`], isObject: true });
      }

      // ---- Shear walls ----
      for (const wall of se?.shearWalls ?? []) {
        if (!wall.points || wall.points.length < 3) continue;
        const gid = `shearWall_geom_${geomIdx++}`;
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const [px, py] of wall.points) {
          const sx = px * PX_TO_M;
          const sz = py * PX_TO_M;
          if (sx < minX) minX = sx;
          if (sz < minZ) minZ = sz;
          if (sx > maxX) maxX = sx;
          if (sz > maxZ) maxZ = sz;
        }
        const sw = maxX - minX;
        const sd = maxZ - minZ;
        const sh = (wall.thickness ?? 200) / 1000;
        const wallBox: any = buildBoxGeometry({ xSize: sw / 2, ySize: sh / 2, zSize: sd / 2 });
        const wallGeom = safeBoxGeometry(wallBox);
        if (!wallGeom) continue;
        (sceneModel as any).createGeometry({ id: gid, primitive: "triangles", positions: wallGeom.positions, normals: wallGeom.normals, indices: wallGeom.indices });
        (sceneModel as any).createMesh({ id: `shearWall_mesh_${wall.id}`, geometryId: gid, position: [(minX + maxX) / 2, wallH / 2, (minZ + maxZ) / 2], color: [0.55, 0.45, 0.35], opacity: 0.9 });
        (sceneModel as any).createEntity({ id: `shearWall_${wall.id}`, meshIds: [`shearWall_mesh_${wall.id}`], isObject: true });
      }

      // ---- Floor slab (ground) ----
      const floorGid = `floor_geom_${geomIdx++}`;
      const floorW = FLOORPLAN_BASE.w * PX_TO_M;
      const floorD = FLOORPLAN_BASE.h * PX_TO_M;
      const floorTh = 0.15;
      const floorBox: any = buildBoxGeometry({ xSize: floorW / 2, ySize: floorTh / 2, zSize: floorD / 2 });
      const floorGeom = safeBoxGeometry(floorBox);
      if (floorGeom) {
        (sceneModel as any).createGeometry({ id: floorGid, primitive: "triangles", positions: floorGeom.positions, normals: floorGeom.normals, indices: floorGeom.indices });
        (sceneModel as any).createMesh({ id: "floor_mesh", geometryId: floorGid, position: [floorW / 2, -floorTh / 2, floorD / 2], color: [0.92, 0.93, 0.95], opacity: 1.0 });
        (sceneModel as any).createEntity({ id: "floor_entity", meshIds: ["floor_mesh"], isObject: true });
      }

      sceneModel.finalize();
    },
    []
  );

  // ---------- Init viewer ----------
  useEffect(() => {
    if (!canvasRef.current || !navCubeRef.current) return;

    const viewer = new Viewer({
      canvasElement: canvasRef.current,
      transparent: false,
    });
    viewerRef.current = viewer;

    viewer.scene.camera.eye = [
      (FLOORPLAN_BASE.w * PX_TO_M) / 2 + 5,
      8,
      (FLOORPLAN_BASE.h * PX_TO_M) / 2 + 10,
    ];
    viewer.scene.camera.look = [
      (FLOORPLAN_BASE.w * PX_TO_M) / 2,
      1,
      (FLOORPLAN_BASE.h * PX_TO_M) / 2,
    ];
    viewer.scene.camera.up = [0, 1, 0];

    // Plugins
    new NavCubePlugin(viewer, {
      canvasElement: navCubeRef.current,
      visible: true,
    });

    new SectionPlanesPlugin(viewer, {
      overviewVisible: false,
    });

    const distPlugin = new DistanceMeasurementsPlugin(viewer);
    const distControl = new DistanceMeasurementsMouseControl(distPlugin);
    measureControlRef.current = distControl;

    // Load config and build
    fetch("/api/structural_config")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Config) => {
        buildModel(viewer, data);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Reload when reloadKey changes ----------
  useEffect(() => {
    if (reloadKey === 0) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    fetch("/api/structural_config")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Config) => {
        buildModel(viewer, data);
      })
      .catch(() => {});
  }, [reloadKey, buildModel]);

  // ---------- X-ray toggle ----------
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const model = viewer.scene.models["structural"];
    if (!model) return;
    // Set rooms to xray, structural elements stay opaque
    for (const name of ROOM_NAMES) {
      const entity = viewer.scene.objects[`room_${name}`];
      if (entity) {
        entity.xrayed = xrayMode;
      }
    }
    const floor = viewer.scene.objects["floor_entity"];
    if (floor) floor.xrayed = xrayMode;
  }, [xrayMode]);

  // ---------- Measuring toggle ----------
  useEffect(() => {
    const ctrl = measureControlRef.current;
    if (!ctrl) return;
    if (measuringActive) ctrl.activate();
    else ctrl.deactivate();
  }, [measuringActive]);

  if (error) {
    return (
      <div className={className} style={{ padding: 16, color: "#ef4444" }}>
        BIM 视图加载失败: {error}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className} style={{ position: "relative", width: "100%", height: "100%", minHeight: 400 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
      <canvas
        ref={navCubeRef}
        style={{
          position: "absolute",
          right: 8,
          bottom: 8,
          width: 120,
          height: 120,
          border: "1px solid rgba(100,116,139,0.2)",
          borderRadius: 6,
          background: "rgba(255,255,255,0.9)",
        }}
      />
      {/* Control buttons */}
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
        <button
          onClick={() => setXrayMode((v) => !v)}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            background: xrayMode ? "#2563eb" : "rgba(255,255,255,0.9)",
            color: xrayMode ? "#fff" : "#1e293b",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
          }}
        >
          X-Ray
        </button>
        <button
          onClick={() => setMeasuringActive((v) => !v)}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            background: measuringActive ? "#2563eb" : "rgba(255,255,255,0.9)",
            color: measuringActive ? "#fff" : "#1e293b",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
          }}
        >
          测距
        </button>
      </div>
    </div>
  );
}
