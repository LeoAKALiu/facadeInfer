import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** Backend config (served from public/floorplan_3d_config.json). */
export type Floorplan3DConfig = {
  wallHeight: number;
  floorHeight: number;
};

/** Per-room layout in % of FLOORPLAN_BASE (matches styles.css).
 *  Edges snapped so adjacent rooms share exact boundaries,
 *  plus ~0.2% inflation on width/height to mask sub-pixel gaps.
 */
const ROOM_LAYOUT: Record<
  string,
  { left: number; top: number; width: number; height: number }
> = {
  livingroom: { left: 0, top: 14.8, width: 67.5, height: 72.5 },
  balcony: { left: 4.5, top: 87.1, width: 28.0, height: 11.9 },
  kitchen: { left: 15.4, top: 0, width: 22.3, height: 25.3 },
  bathroom: { left: 37.5, top: 21.5, width: 17.8, height: 28.8 },
  bedroom1: { left: 67.3, top: 50.1, width: 32.7, height: 37.2 },
  bedroom2: { left: 55.1, top: 21.5, width: 31.9, height: 28.0 },
  bedroom3: { left: 37.5, top: 60.3, width: 30.0, height: 27.0 },
};

const FLOORPLAN_BASE = { w: 1122.5, h: 1266.5 };

/** Parse SVG path d into an array of [x, y] points (absolute M/L/H/V/Z only). */
function parsePathToPoints(d: string): number[][] {
  const points: number[][] = [];
  const tokens = d.trim().replace(/([MLHVCSQTAZ])/gi, " $1 ").split(/\s+/).filter(Boolean);
  let i = 0;
  let x = 0;
  let y = 0;

  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (!cmd) break;
    const upper = cmd.toUpperCase();
    if (upper === "M") {
      const nx = parseFloat(tokens[i++]);
      const ny = parseFloat(tokens[i++]);
      if (Number.isFinite(nx) && Number.isFinite(ny)) {
        x = nx;
        y = ny;
        points.push([x, y]);
      }
    } else if (upper === "L") {
      const nx = parseFloat(tokens[i++]);
      const ny = parseFloat(tokens[i++]);
      if (Number.isFinite(nx) && Number.isFinite(ny)) {
        x = nx;
        y = ny;
        points.push([x, y]);
      }
    } else if (upper === "H") {
      const nx = parseFloat(tokens[i++]);
      if (Number.isFinite(nx)) {
        x = nx;
        points.push([x, y]);
      }
    } else if (upper === "V") {
      const ny = parseFloat(tokens[i++]);
      if (Number.isFinite(ny)) {
        y = ny;
        points.push([x, y]);
      }
    } else if (upper === "Z") {
      if (points.length > 1) {
        const [x0, y0] = points[0];
        points.push([x0, y0]);
        x = x0;
        y = y0;
      }
    } else {
      break;
    }
  }
  return points;
}

/** Extract viewBox or width/height from SVG string. */
function getSvgSize(svgString: string): { w: number; h: number } {
  const vb = svgString.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  if (vb) {
    const parts = vb[1].trim().split(/\s+/);
    if (parts.length >= 4) return { w: parseFloat(parts[2]) || 100, h: parseFloat(parts[3]) || 100 };
  }
  const w = svgString.match(/\bwidth\s*=\s*["']?([\d.]+)/i)?.[1];
  const h = svgString.match(/\bheight\s*=\s*["']?([\d.]+)/i)?.[1];
  return { w: w ? parseFloat(w) : 100, h: h ? parseFloat(h) : 100 };
}

/** Extract first path d from SVG string. */
function getFirstPathD(svgString: string): string | null {
  const m = svgString.match(/<path[^>]*\sd\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : null;
}

/** Transform room-local SVG points to global floorplan coordinates (same as 2D canvas). */
function localToGlobal(
  points: number[][],
  svgW: number,
  svgH: number,
  layout: { left: number; top: number; width: number; height: number }
): number[][] {
  const base = FLOORPLAN_BASE;
  const leftPx = (layout.left / 100) * base.w;
  const topPx = (layout.top / 100) * base.h;
  const widthPx = (layout.width / 100) * base.w;
  const heightPx = (layout.height / 100) * base.h;
  return points.map(([lx, ly]) => {
    const gx = leftPx + (lx / svgW) * widthPx;
    const gy = topPx + (ly / svgH) * heightPx;
    return [gx, gy];
  });
}

/** Room fill color for 3D (slightly transparent). */
const ROOM_COLORS: Record<string, number> = {
  livingroom: 0xfacc15,
  balcony: 0x94a3b8,
  kitchen: 0x22c55e,
  bathroom: 0x38bdf8,
  bedroom1: 0xa855f7,
  bedroom2: 0xa855f7,
  bedroom3: 0xa855f7,
};

export type Floorplan3DViewProps = {
  floorplanSvgs: Record<string, string>;
  roomNames: string[];
  className?: string;
};

/**
 * Renders the floor plan as an extruded 3D view using Three.js.
 * Loads wallHeight/floorHeight from /floorplan_3d_config.json.
 */
export function Floorplan3DView({
  floorplanSvgs,
  roomNames,
  className = "",
}: Floorplan3DViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [config, setConfig] = useState<Floorplan3DConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/floorplan_3d_config.json", { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Floorplan3DConfig) => {
        if (!cancelled) setConfig(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const buildScene = useCallback(
    (wallHeight: number) => {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf1f5f9);

      const globalPointsByRoom: Array<{ name: string; points: number[][] }> = [];
      for (const name of roomNames) {
        const svg = floorplanSvgs[name];
        const layout = ROOM_LAYOUT[name];
        if (!svg || !layout) continue;
        const pathD = getFirstPathD(svg);
        if (!pathD) continue;
        const pts = parsePathToPoints(pathD);
        if (pts.length < 3) continue;
        const size = getSvgSize(svg);
        const globalPts = localToGlobal(pts, size.w, size.h, layout);
        globalPointsByRoom.push({ name, points: globalPts });
      }

      // Three.js: Y-up. Floor in XZ. Shape is in XY, we extrude along Z then rotate -90 around X.
      for (const { name, points } of globalPointsByRoom) {
        const shape = new THREE.Shape();
        for (let i = 0; i < points.length; i++) {
          const [gx, gy] = points[i];
          const x = gx;
          const y = -gy;
          if (i === 0) shape.moveTo(x, y);
          else shape.lineTo(x, y);
        }
        const depth = wallHeight;
        const extrudeSettings: THREE.ExtrudeGeometryOptions = {
          depth,
          bevelEnabled: false,
        };
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        const color = ROOM_COLORS[name] ?? 0x94a3b8;
        const material = new THREE.MeshStandardMaterial({
          color,
          transparent: true,
          opacity: 0.85,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0;
        scene.add(mesh);
      }

      const light = new THREE.DirectionalLight(0xffffff, 1);
      light.position.set(FLOORPLAN_BASE.w / 2, wallHeight * 2, FLOORPLAN_BASE.h / 2);
      scene.add(light);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));

      return scene;
    },
    [floorplanSvgs, roomNames]
  );

  useEffect(() => {
    if (!config || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const camera = new THREE.PerspectiveCamera(50, width / height, 1, 50000);
    camera.position.set(FLOORPLAN_BASE.w * 0.5, config.wallHeight * 3, FLOORPLAN_BASE.h * 0.8);
    camera.lookAt(FLOORPLAN_BASE.w / 2, 0, FLOORPLAN_BASE.h / 2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = buildScene(config.wallHeight);
    sceneRef.current = scene;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(FLOORPLAN_BASE.w / 2, 0, FLOORPLAN_BASE.h / 2);
    controlsRef.current = controls;

    const animate = (): void => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = (): void => {
      if (!containerRef.current || !camera || !renderer) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      controls.dispose();
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, [config, buildScene]);

  if (error) {
    return (
      <div className={className} style={{ padding: 16, color: "var(--text)" }}>
        无法加载 3D 配置: {error}
      </div>
    );
  }
  if (!config) {
    return (
      <div className={className} style={{ padding: 16, color: "var(--text)" }}>
        加载 3D 配置中…
      </div>
    );
  }
  return <div ref={containerRef} className={className} style={{ width: "100%", height: "100%", minHeight: 400 }} />;
}
