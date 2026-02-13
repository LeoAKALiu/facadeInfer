import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { analyzeDemo, fetchCases } from "./lib/api";
import { ComputationOverlay } from "./components/ComputationOverlay";
import { BIMStructuralView } from "./components/BIMStructuralView";
import { ScannerOverlay } from "./components/ScannerOverlay";
import type { AnalyzeDemoResponse, BuildingCase, FacadeCase } from "./lib/types";

type Step = "appearance" | "semantic" | "geometry" | "floorplan" | "risk";

type LogLine = { ts: string; msg: string };

function nowTs(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function pathFromPoints(points: number[][]): string {
  if (!points.length) return "";
  const [x0, y0] = points[0];
  let d = `M ${x0} ${y0}`;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    d += ` L ${x} ${y}`;
  }
  return `${d} Z`;
}

type BBox = {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
};

function masksToBBoxes(masks: AnalyzeDemoResponse["masks"]): BBox[] {
  const out: BBox[] = [];
  for (const m of masks || []) {
    const pts = m.points || [];
    if (!pts.length) continue;
    let xMin = Infinity;
    let yMin = Infinity;
    let xMax = -Infinity;
    let yMax = -Infinity;
    for (const [x, y] of pts) {
      xMin = Math.min(xMin, x);
      yMin = Math.min(yMin, y);
      xMax = Math.max(xMax, x);
      yMax = Math.max(yMax, y);
    }
    out.push({
      label: m.label || "unknown",
      x: xMin,
      y: yMin,
      w: xMax - xMin,
      h: yMax - yMin,
      cx: (xMin + xMax) / 2,
      cy: (yMin + yMax) / 2,
    });
  }
  return out;
}

function geometryAxesFromAnalysis(analysis: AnalyzeDemoResponse): Array<{ x: number; y1: number; y2: number }> {
  const dims = analysis?.debug?.image_dims;
  if (!dims) return [];
  const bboxes = masksToBBoxes(analysis.masks || []);
  if (!bboxes.length) return [];

  const imgH = dims[1];
  const windows = bboxes.filter((b) => String(b.label).includes("window")).sort((a, b) => a.cx - b.cx);
  const clusters: Array<{ meanX: number; items: BBox[] }> = [];
  const tol = 60; // px in ortho coordinate system

  for (const w of windows) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(last.meanX - w.cx) > tol) {
      clusters.push({ meanX: w.cx, items: [w] });
    } else {
      last.items.push(w);
      last.meanX = last.items.reduce((s, it) => s + it.cx, 0) / last.items.length;
    }
  }

  return clusters
    .filter((c) => c.items.length >= 2)
    .map((c) => {
      const ys = c.items.map((it) => it.cy).sort((a, b) => a - b);
      const yMin = Math.max(0, ys[0] - 250);
      const yMax = Math.min(imgH, ys[ys.length - 1] + 250);
      return { x: c.meanX, y1: yMin, y2: yMax };
    });
}

export function App(): JSX.Element {
  const [step, setStep] = useState<Step>("appearance");
  const [loadingCases, setLoadingCases] = useState<boolean>(false);
  const [cases, setCases] = useState<BuildingCase[]>([]);
  const [casesError, setCasesError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(true);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingCase | null>(null);
  const [selectedFacade, setSelectedFacade] = useState<FacadeCase | null>(null);

  const [analysisByFacade, setAnalysisByFacade] = useState<Record<string, AnalyzeDemoResponse>>({});
  const [analysisErrorByFacade, setAnalysisErrorByFacade] = useState<Record<string, string>>({});
  const [semanticMasksVisible, setSemanticMasksVisible] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const semanticDelayRef = useRef<number | null>(null);

  const [logs, setLogs] = useState<LogLine[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const [typedLast, setTypedLast] = useState<string>("");
  const [typedCursorOn, setTypedCursorOn] = useState<boolean>(true);

  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const step1Ref = useRef<HTMLButtonElement | null>(null);
  const step2Ref = useRef<HTMLButtonElement | null>(null);
  const step3Ref = useRef<HTMLButtonElement | null>(null);
  const step4Ref = useRef<HTMLButtonElement | null>(null);
  const step5Ref = useRef<HTMLButtonElement | null>(null);

  const [step1Done, setStep1Done] = useState<boolean>(false);
  const [step2Done, setStep2Done] = useState<boolean>(false);
  const [step3Done, setStep3Done] = useState<boolean>(false);
  const [step4Done, setStep4Done] = useState<boolean>(false);
  const [step5Done, setStep5Done] = useState<boolean>(false);

  const [step2Enabled, setStep2Enabled] = useState<boolean>(false);
  const [step3Enabled, setStep3Enabled] = useState<boolean>(false);
  const [step4Enabled, setStep4Enabled] = useState<boolean>(false);
  const [step5Enabled, setStep5Enabled] = useState<boolean>(false);

  const [dotAnim, setDotAnim] = useState<{ from: 1 | 2 | 3 | 4; dy: number } | null>(null);
  const [computeOpen, setComputeOpen] = useState<boolean>(false);

  const originalSrc = useMemo<string | null>(() => {
    if (!selectedFacade) return null;
    return (
      selectedFacade.viewport_original_url ||
      selectedFacade.original_image ||
      selectedFacade.thumbnail ||
      null
    );
  }, [selectedFacade]);

  const orthoSrc = useMemo<string | null>(() => {
    if (!selectedFacade) return null;
    return selectedFacade.viewport_ortho_url || selectedFacade.ortho_image || null;
  }, [selectedFacade]);

  const [baseSrc, setBaseSrc] = useState<string | null>(null);
  const [baseReady, setBaseReady] = useState<boolean>(false);
  const [overlaySrc, setOverlaySrc] = useState<string | null>(null);
  const [overlayReady, setOverlayReady] = useState<boolean>(false);
  const [overlayVisible, setOverlayVisible] = useState<boolean>(false);
  const [overlayTransformFrom, setOverlayTransformFrom] = useState<string>("none");
  const [overlayTransform, setOverlayTransform] = useState<string>("none");

  const viewportBodyRef = useRef<HTMLDivElement | null>(null);
  const originalDimsRef = useRef<{ w: number; h: number } | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const terminalOutputRef = useRef<HTMLDivElement | null>(null);

  const floorplanRooms = useMemo<string[]>(() => {
    return ["livingroom", "balcony", "kitchen", "bathroom", "bedroom1", "bedroom2", "bedroom3"];
  }, []);
  const [floorplanSvgs, setFloorplanSvgs] = useState<Record<string, string>>({});
  const [floorplanLoading, setFloorplanLoading] = useState<boolean>(false);
  const [floorplanError, setFloorplanError] = useState<string | null>(null);
  const [orthoDims, setOrthoDims] = useState<[number, number] | null>(null);
  const floorplanViewportRef = useRef<HTMLDivElement | null>(null);
  const FLOORPLAN_BASE = useMemo<{ w: number; h: number }>(() => ({ w: 1122.5, h: 1266.5 }), []);
  const [floorplanZoom, setFloorplanZoom] = useState<number>(1);
  const [floorplanPan, setFloorplanPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [floorplanFitZoom, setFloorplanFitZoom] = useState<number>(1);
  const [floorplanTab, setFloorplanTab] = useState<"2d" | "bim">("2d");
  const panDragRef = useRef<{ active: boolean; x0: number; y0: number; pan0x: number; pan0y: number } | null>(null);

  const floorplanLabels = useMemo<Record<string, string>>(
    () => ({
      livingroom: "客厅",
      balcony: "阳台",
      kitchen: "厨房",
      bathroom: "卫生间",
      bedroom2: "卧室A",
      bedroom1: "卧室B",
      bedroom3: "卧室C",
    }),
    []
  );

  const activeAnalysis = useMemo<AnalyzeDemoResponse | null>(() => {
    if (!selectedFacade) return null;
    return analysisByFacade[selectedFacade.id] || null;
  }, [analysisByFacade, selectedFacade]);

  const activeAnalysisError = useMemo<string | null>(() => {
    if (!selectedFacade) return null;
    return analysisErrorByFacade[selectedFacade.id] || null;
  }, [analysisErrorByFacade, selectedFacade]);

  const guideTarget = useMemo<"openSelector" | "pickGroup" | "step1" | "step2" | "step3" | "step4" | "step5" | "none">(() => {
    if (!selectedBuilding) {
      return isModalOpen ? "pickGroup" : "openSelector";
    }
    if (!step1Done) return "step1";
    if (!step2Done) return "step2";
    if (!step3Done) return "step3";
    if (!step4Done) return "step4";
    if (!step5Done) return "step5";
    return "none";
  }, [isModalOpen, selectedBuilding, step1Done, step2Done, step3Done, step4Done, step5Done]);

  const viewBox = useMemo<string>(() => {
    const dims = activeAnalysis?.debug?.image_dims;
    if (!dims) return "0 0 100 100";
    return `0 0 ${dims[0]} ${dims[1]}`;
  }, [activeAnalysis]);

  const overlayViewBox = useMemo<string>(() => {
    if (orthoDims) return `0 0 ${orthoDims[0]} ${orthoDims[1]}`;
    return viewBox;
  }, [orthoDims, viewBox]);

  function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
  }

  function centerFloorplan(zoom: number): void {
    const vp = floorplanViewportRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const x = (r.width - FLOORPLAN_BASE.w * zoom) / 2;
    const y = (r.height - FLOORPLAN_BASE.h * zoom) / 2;
    setFloorplanPan({ x, y });
  }

  function setZoomAtPoint(nextZoom: number, cx: number, cy: number): void {
    setFloorplanZoom((prevZoom) => {
      const z0 = prevZoom || 1;
      const z1 = nextZoom;
      setFloorplanPan((p) => {
        const wx = (cx - p.x) / z0;
        const wy = (cy - p.y) / z0;
        return { x: cx - wx * z1, y: cy - wy * z1 };
      });
      return z1;
    });
  }

  const bboxes = useMemo<BBox[]>(() => {
    if (!activeAnalysis?.masks?.length) return [];
    return masksToBBoxes(activeAnalysis.masks);
  }, [activeAnalysis]);

  const geometryAxes = useMemo<Array<{ x: number; y1: number; y2: number }>>(() => {
    const dims = activeAnalysis?.debug?.image_dims;
    if (!dims || !bboxes.length) return [];
    const imgH = dims[1];
    const windows = bboxes.filter((b) => String(b.label).includes("window")).sort((a, b) => a.cx - b.cx);

    const clusters: Array<{ meanX: number; items: BBox[] }> = [];
    const tol = 60; // px in ortho coordinate system
    for (const w of windows) {
      const last = clusters[clusters.length - 1];
      if (!last || Math.abs(last.meanX - w.cx) > tol) {
        clusters.push({ meanX: w.cx, items: [w] });
      } else {
        last.items.push(w);
        last.meanX = last.items.reduce((s, it) => s + it.cx, 0) / last.items.length;
      }
    }

    return clusters
      .filter((c) => c.items.length >= 2)
      .map((c) => {
        const ys = c.items.map((it) => it.cy).sort((a, b) => a - b);
        const yMin = Math.max(0, ys[0] - 250);
        const yMax = Math.min(imgH, ys[ys.length - 1] + 250);
        return { x: c.meanX, y1: yMin, y2: yMax };
      });
  }, [activeAnalysis, bboxes]);

  function log(msg: string): void {
    setLogs((prev) => [...prev, { ts: nowTs(), msg }].slice(-120));
  }

  const terminalLines = useMemo<string[]>(() => {
    return logs.map((l) => `${l.ts}  ${l.msg}`);
  }, [logs]);

  useEffect(() => {
    if (!terminalLines.length) {
      setTypedLast("");
      return;
    }
    const last = terminalLines[terminalLines.length - 1];
    setTypedLast("");
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTypedLast(last.slice(0, i));
      if (i >= last.length) {
        window.clearInterval(id);
      }
    }, 10);
    return () => window.clearInterval(id);
  }, [terminalLines]);

  useEffect(() => {
    const id = window.setInterval(() => setTypedCursorOn((v) => !v), 450);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    // Keep the right panel focused on the newest info when the user changes steps.
    const el = rightPanelRef.current;
    if (el) el.scrollTop = 0;
  }, [step]);

  useEffect(() => {
    // Always keep right panel showing the newest card (top).
    const el = rightPanelRef.current;
    if (el) el.scrollTop = 0;
  }, [step1Done, step2Done, step3Done, step4Done, step5Done, activeAnalysis, activeAnalysisError]);

  useEffect(() => {
    // Always keep terminal scrolled to latest.
    const el = terminalOutputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [terminalLines, typedLast]);

  async function withComputation<T>(title: string, action: () => Promise<T>): Promise<T> {
    setComputeOpen(true);
    // Simulate non-trivial computational ritual.
    await new Promise((r) => setTimeout(r, 1200));
    try {
      return await action();
    } finally {
      setComputeOpen(false);
    }
  }

  function resetSteps(): void {
    setStep("appearance");
    setStep1Done(false);
    setStep2Done(false);
    setStep3Done(false);
    setStep4Done(false);
    setStep5Done(false);
    setStep2Enabled(false);
    setStep3Enabled(false);
    setStep4Enabled(false);
    setStep5Enabled(false);
  }

  useEffect(() => {
    // On selection change, always show the original (un-ortho) first.
    setBaseSrc(originalSrc);
    setBaseReady(false);
    setOverlaySrc(null);
    setOverlayReady(false);
    setOverlayVisible(false);
    setOrthoDims(null);
  }, [originalSrc]);

  function currentFacadeIndex(): number {
    if (!selectedBuilding || !selectedFacade) return 0;
    const idx = (selectedBuilding.facades || []).findIndex((f) => f.id === selectedFacade.id);
    return idx >= 0 ? idx : 0;
  }

  function facadeViewLabel(idx: number): string {
    // Demo ordering: 北 / 西 / 南
    return idx === 0 ? "北立面" : idx === 1 ? "西立面" : "南立面";
  }

  function switchFacade(delta: -1 | 1): void {
    if (!selectedBuilding || !(selectedBuilding.facades || []).length) return;
    const n = selectedBuilding.facades.length;
    const idx = currentFacadeIndex();
    const next = (idx + delta + n) % n;
    const f = selectedBuilding.facades[next];
    setSelectedFacade(f);
    log(`View switched → ${facadeViewLabel(next)} (${f.label || f.id})`);
  }

  function preloadImage(url: string | null | undefined): void {
    if (!url) return;
    const img = new Image();
    img.decoding = "async";
    img.src = url;
  }

  useEffect(() => {
    // Preload only the currently selected facade to avoid bandwidth competition on first load.
    if (!selectedFacade) return;
    preloadImage(
      selectedFacade.viewport_original_url ||
        selectedFacade.original_image ||
        selectedFacade.thumbnail
    );
    preloadImage(selectedFacade.viewport_ortho_url || selectedFacade.ortho_image);
  }, [selectedFacade]);

  function stableRand01(seed: string): number {
    // Deterministic pseudo-random for demo values (0..1).
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
  }

  const floorplanConfidence = useMemo<Record<string, number>>(() => {
    const base: Record<string, number> = {
      // Complex/inner shapes lower.
      livingroom: 0.66,
      bathroom: 0.63,
      // Outer rooms higher.
      kitchen: 0.76,
      balcony: 0.83,
      bedroom1: 0.81,
      bedroom2: 0.80,
      bedroom3: 0.79,
    };
    const out: Record<string, number> = {};
    for (const name of floorplanRooms) {
      const b = base[name] ?? 0.72;
      const jitter = (stableRand01(`conf:${name}`) - 0.5) * 0.04; // +/- 0.02
      const v = Math.max(0.6, Math.min(0.85, b + jitter));
      out[name] = Math.round(v * 100) / 100;
    }
    return out;
  }, [floorplanRooms]);

  useLayoutEffect(() => {
    if (step !== "floorplan") return;
    const vp = floorplanViewportRef.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    const fit = Math.min((r.width * 0.96) / FLOORPLAN_BASE.w, (r.height * 0.92) / FLOORPLAN_BASE.h);
    const fitZoom = clamp(fit, 0.2, 3);
    setFloorplanFitZoom(fitZoom);
    setFloorplanZoom(fitZoom);
    centerFloorplan(fitZoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, FLOORPLAN_BASE.w, FLOORPLAN_BASE.h]);

  useEffect(() => {
    const ac = new AbortController();
    setLoadingCases(true);
    setCasesError(null);

    fetchCases(ac.signal)
      .then((data) => {
        setCases(data);
        setIsModalOpen(true);
        log(`Loaded ${data.length} building case(s).`);
      })
      .catch((e: unknown) => {
        setCasesError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoadingCases(false));

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCaseSelector(): void {
    setIsModalOpen(true);
    log("Open case selector.");
  }

  type TransformJson = {
    output_size?: [number, number] | number[];
    rectified_size?: { width?: number; height?: number } | null;
    inverse_matrix?: number[][];
    transform_matrix?: number[][];
    matrix?: number[][];
  };

  function mul3(a: number[][], b: number[][]): number[][] {
    const out: number[][] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        out[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
      }
    }
    return out;
  }

  function homographyToCssMatrix3d(h: number[][]): string {
    // Normalize so h[2][2] = 1
    const s = h[2][2] || 1;
    const H = [
      [h[0][0] / s, h[0][1] / s, h[0][2] / s],
      [h[1][0] / s, h[1][1] / s, h[1][2] / s],
      [h[2][0] / s, h[2][1] / s, h[2][2] / s],
    ];

    // 3x3 homography embedded into 4x4.
    const m11 = H[0][0];
    const m12 = H[0][1];
    const m14 = H[0][2];
    const m21 = H[1][0];
    const m22 = H[1][1];
    const m24 = H[1][2];
    const m41 = H[2][0];
    const m42 = H[2][1];
    const m44 = H[2][2];

    // CSS matrix3d is column-major.
    const values = [
      m11,
      m21,
      0,
      m41,
      m12,
      m22,
      0,
      m42,
      0,
      0,
      1,
      0,
      m14,
      m24,
      0,
      m44,
    ].map((v) => (Number.isFinite(v) ? v : 0));

    return `matrix3d(${values.join(",")})`;
  }

  async function loadTransformCss(caseId: string): Promise<string> {
    const viewport = viewportBodyRef.current;
    const origDims = originalDimsRef.current;
    if (!viewport || !origDims) return "none";

    try {
      const res = await fetch(`/demo_data/${caseId}_transform.json`, { cache: "no-cache" });
      if (!res.ok) return "none";
      const j = (await res.json()) as TransformJson;
      const inv = j.inverse_matrix;
      const outSize = j.output_size || (j.rectified_size ? [j.rectified_size.width || 0, j.rectified_size.height || 0] : undefined);
      if (!inv || !outSize || inv.length !== 3) return "none";

      const Wr = Number(outSize[0]);
      const Hr = Number(outSize[1]);
      if (!Number.isFinite(Wr) || !Number.isFinite(Hr) || Wr <= 0 || Hr <= 0) return "none";

      const W = origDims.w;
      const H = origDims.h;
      const rect = viewport.getBoundingClientRect();
      const Vw = Math.max(1, rect.width);
      const Vh = Math.max(1, rect.height);

      // Build H_view = S_view * (S_src^-1 * H * S_dst) * S_view^-1
      const S_src_inv = [
        [1 / W, 0, 0],
        [0, 1 / H, 0],
        [0, 0, 1],
      ];
      const S_dst = [
        [Wr, 0, 0],
        [0, Hr, 0],
        [0, 0, 1],
      ];
      const S_view = [
        [Vw, 0, 0],
        [0, Vh, 0],
        [0, 0, 1],
      ];
      const S_view_inv = [
        [1 / Vw, 0, 0],
        [0, 1 / Vh, 0],
        [0, 0, 1],
      ];

      const H_norm = mul3(mul3(S_src_inv, inv), S_dst);
      const H_view = mul3(mul3(S_view, H_norm), S_view_inv);
      return homographyToCssMatrix3d(H_view);
    } catch (e: unknown) {
      log(`[STEP2] transform load failed: ${e instanceof Error ? e.message : String(e)}`);
      return "none";
    }
  }

  function startOrthoTransition(): void {
    if (!orthoSrc) {
      log("Missing ortho image URL.");
      return;
    }
    if (baseSrc === orthoSrc) return;
    // Load ortho into overlay, then fade in. Once base loads ortho, remove overlay.
    setOverlaySrc(orthoSrc);
    setOverlayReady(false);
    setOverlayVisible(false);
    setOverlayTransform("none");
    setOverlayTransformFrom("none");
    if (selectedFacade?.id) {
      loadTransformCss(selectedFacade.id).then((css) => {
        setOverlayTransformFrom(css);
      });
    }
  }

  function getIndicatorCenter(btn: HTMLButtonElement, container: HTMLDivElement): { x: number; y: number } | null {
    const cRect = container.getBoundingClientRect();
    const ind = btn.querySelector<HTMLDivElement>(".stepIndicator");
    if (!ind) return null;
    const r = ind.getBoundingClientRect();
    return { x: (r.left + r.right) / 2 - cRect.left, y: (r.top + r.bottom) / 2 - cRect.top };
  }

  const [connectorGeometry, setConnectorGeometry] = useState<Array<{ id: "12" | "23" | "34" | "45"; x: number; y: number; h: number }>>([]);

  function layoutConnectors(): void {
    const sidebar = sidebarRef.current;
    const b1 = step1Ref.current;
    const b2 = step2Ref.current;
    const b3 = step3Ref.current;
    const b4 = step4Ref.current;
    const b5 = step5Ref.current;
    if (!sidebar || !b1 || !b2 || !b3 || !b4 || !b5) return;

    const c12 = getIndicatorCenter(b1, sidebar);
    const c23 = getIndicatorCenter(b2, sidebar);
    const c34 = getIndicatorCenter(b3, sidebar);
    const c45 = getIndicatorCenter(b4, sidebar);
    const c56 = getIndicatorCenter(b5, sidebar);
    if (!c12 || !c23 || !c34 || !c45 || !c56) return;

    const make = (id: "12" | "23" | "34" | "45", a: { x: number; y: number }, b: { x: number; y: number }) => {
      const x = (a.x + b.x) / 2;
      const y = a.y;
      const h = Math.max(0, b.y - a.y);
      return { id, x, y, h };
    };

    setConnectorGeometry([make("12", c12, c23), make("23", c23, c34), make("34", c34, c45), make("45", c45, c56)]);
  }

  useLayoutEffect(() => {
    layoutConnectors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step1Done, step2Done, step3Done, step4Done, isModalOpen]);

  useEffect(() => {
    const onResize = () => layoutConnectors();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function animateProgress(from: 1 | 2 | 3 | 4): Promise<void> {
    const sidebar = sidebarRef.current;
    const fromBtn =
      from === 1 ? step1Ref.current : from === 2 ? step2Ref.current : from === 3 ? step3Ref.current : step4Ref.current;
    const toBtn = from === 1 ? step2Ref.current : from === 2 ? step3Ref.current : from === 3 ? step4Ref.current : step5Ref.current;
    if (!sidebar || !fromBtn || !toBtn) return;

    const a = getIndicatorCenter(fromBtn, sidebar);
    const b = getIndicatorCenter(toBtn, sidebar);
    if (!a || !b) return;
    setDotAnim({ from, dy: Math.max(0, b.y - a.y) });
    await new Promise((r) => setTimeout(r, 720));
    setDotAnim(null);
  }

  async function runStep1Appearance(): Promise<void> {
    if (!selectedBuilding || !selectedFacade) {
      openCaseSelector();
      log("请选择一个 case 后再运行 L1。");
      return;
    }
    setStep("appearance");
    log("[STEP1] initializing appearance recognition…");
    log("[STEP1] extracting structural priors…");
    log("[STEP1] retrieving similar templates…");
    log("[STEP1] composing step1 report…");
    setStep1Done(true);
    log("[STEP1] DONE");
    await animateProgress(1);
    setStep2Enabled(true);
  }

  async function runStep2Semantic(): Promise<void> {
    if (!selectedBuilding || !(selectedBuilding.facades || []).length) {
      openCaseSelector();
      return;
    }
    if (!step2Enabled) {
      log("请先完成 L1（多维图景感知）。");
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setAnalysisByFacade({});
    setAnalysisErrorByFacade({});
    setIsAnalyzing(true);
    setStep("semantic");
    log("[STEP2] analyzing 3 facade views…");
    setSemanticMasksVisible(false);
    if (semanticDelayRef.current) window.clearTimeout(semanticDelayRef.current);
    semanticDelayRef.current = window.setTimeout(() => setSemanticMasksVisible(true), 500);

    try {
      const facades = (selectedBuilding.facades || []).slice(0, 3);
      const results = await Promise.allSettled(
        facades.map(async (f) => {
          const data = await analyzeDemo(f.id, ac.signal);
          setAnalysisByFacade((prev) => ({ ...prev, [f.id]: data }));
          return { id: f.id, boxes: data.debug.boxes_count };
        })
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const bad = results.length - ok;
      for (const r of results) {
        if (r.status === "rejected") {
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          log(`[STEP2] ERROR: ${msg}`);
        }
      }
      log(`[STEP2] Analyze completed: ok=${ok}, failed=${bad}`);
      setStep2Done(true);
      log("[STEP2] DONE");
      await animateProgress(2);
      setStep3Enabled(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (selectedFacade) setAnalysisErrorByFacade((prev) => ({ ...prev, [selectedFacade.id]: msg }));
      log(`[STEP2] ERROR: ${msg}`);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function runStep3Geometry(): Promise<void> {
    if (!step3Enabled || !activeAnalysis) {
      log("请先完成 L2（构件语义解析）。");
      return;
    }
    // Ensure the viewport is on ORTHO before drawing geometry overlays.
    startOrthoTransition();
    setStep("geometry");
    log("[STEP3] computing bay axes from window masks…");
    log(`[STEP3] axes=${geometryAxes.length}, boxes=${bboxes.length}`);
    setStep3Done(true);
    log("[STEP3] DONE");
    await animateProgress(3);
    setStep4Enabled(true);
  }

  async function runStep4Floorplan(): Promise<void> {
    if (!step4Enabled) {
      log("请先完成 L2（拓扑规则重构）。");
      return;
    }
    setStep("floorplan");
    log("[STEP4] loading floorplan SVG layers…");
    setFloorplanLoading(true);
    setFloorplanError(null);
    try {
      const normalizeSvg = (txt: string): string => {
        // Ensure SVG scales to the room layer's width/height exactly (like <img>).
        // This helps match the Figma-derived per-layer bounding boxes.
        if (txt.includes("preserveAspectRatio=")) return txt;
        return txt.replace("<svg ", '<svg preserveAspectRatio="none" ');
      };
      const pairs = await Promise.all(
        floorplanRooms.map(async (name) => {
          const res = await fetch(`/floorplan_svg/${name}.svg`, { cache: "no-cache" });
          if (!res.ok) {
            throw new Error(`Missing ${name}.svg (HTTP ${res.status})`);
          }
          const txt = await res.text();
          return [name, normalizeSvg(txt)] as const;
        })
      );
      const m: Record<string, string> = {};
      for (const [k, v] of pairs) m[k] = v;
      setFloorplanSvgs(m);
      log(`[STEP4] Loaded ${pairs.length} SVG layer(s).`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setFloorplanError(msg);
      log(`[STEP4] ERROR: ${msg}`);
    } finally {
      setFloorplanLoading(false);
    }
    setStep4Done(true);
    log("[STEP4] DONE");
    await animateProgress(4);
    setStep5Enabled(true);
  }

  const [toast, setToast] = useState<string | null>(null);

  async function runStep5Risk(): Promise<void> {
    if (!step5Enabled) {
      log("请先完成 L3（结构基因反演）。");
      return;
    }
    setStep("risk");
    log("[STEP5] synthesizing automated risk assessment report…");
    setStep5Done(true);
    log("[STEP5] DONE");
  }

  const viewportStatusText = useMemo<string>(() => {
    if (!selectedFacade) return "NO CASE";
    if (activeAnalysisError) return "ERROR";
    if (step === "semantic" && isAnalyzing) return "ANALYZING";
    if (baseSrc && !baseReady && !(overlayVisible && overlayReady)) return "LOADING";
    if (activeAnalysis && (step === "semantic" || step === "geometry")) return "READY";
    return "IDLE";
  }, [activeAnalysis, activeAnalysisError, baseReady, baseSrc, isAnalyzing, overlayReady, overlayVisible, selectedFacade, step]);

  const stepTitle = useMemo<string>(() => {
    if (step === "appearance") return "L1 多维图景感知";
    if (step === "semantic") return "L2 构件语义解析";
    if (step === "geometry") return "L2 拓扑规则重构";
    if (step === "floorplan") return "L3 结构基因反演";
    return "L4 风险量化评估";
  }, [step]);

  const orthoVisible = useMemo<boolean>(() => {
    if (overlayVisible && overlayReady) return true;
    if (!orthoSrc || !baseSrc) return false;
    return baseSrc === orthoSrc;
  }, [baseSrc, orthoSrc, overlayReady, overlayVisible]);

  const orthoStable = useMemo<boolean>(() => {
    if (!orthoSrc || !baseSrc) return false;
    return baseSrc === orthoSrc && baseReady;
  }, [baseReady, baseSrc, orthoSrc]);

  const scannerActive = useMemo<boolean>(() => {
    // Only show scanner when analyzing on image viewport.
    if (!selectedFacade) return false;
    if (step === "semantic" || step === "geometry") return true;
    return false;
  }, [selectedFacade, step]);

  return (
    <div className="app">
      <ComputationOverlay open={computeOpen} title={stepTitle} />
      <div className="topbar">
        <div className="flex min-w-0 flex-col">
          <div className="truncate font-mono text-[14px] font-bold tracking-wide text-white">
            SGS · 城市既有建筑结构基因解算系统
          </div>
          <div className="truncate font-mono text-[11px] text-gray-400">Tongji Intelligent Construction Lab | Ver 2.0</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="badge font-mono">{stepTitle}</span>
        </div>
      </div>

      <div className="layout hasTerminal">
        <div className="sidebar" ref={sidebarRef}>
          {connectorGeometry.map((g) => (
            <div
              key={g.id}
              className={`stepConnector ${g.id === "12" && step1Done ? "active" : ""} ${g.id === "23" && step2Done ? "active" : ""} ${
                g.id === "34" && step3Done ? "active" : ""
              } ${g.id === "45" && step4Done ? "active" : ""}`}
              style={{ left: g.x, top: g.y, height: g.h }}
            />
          ))}

          {dotAnim ? (
            <div
              className={`stepDot from${dotAnim.from}`}
              style={{
                left: connectorGeometry.find((g) =>
                  dotAnim.from === 1 ? g.id === "12" : dotAnim.from === 2 ? g.id === "23" : dotAnim.from === 3 ? g.id === "34" : g.id === "45"
                )?.x
                  ? `${connectorGeometry.find((g) =>
                      dotAnim.from === 1 ? g.id === "12" : dotAnim.from === 2 ? g.id === "23" : dotAnim.from === 3 ? g.id === "34" : g.id === "45"
                    )!.x - 7}px`
                  : "20px",
                top: connectorGeometry.find((g) =>
                  dotAnim.from === 1 ? g.id === "12" : dotAnim.from === 2 ? g.id === "23" : dotAnim.from === 3 ? g.id === "34" : g.id === "45"
                )?.y
                  ? `${connectorGeometry.find((g) =>
                      dotAnim.from === 1 ? g.id === "12" : dotAnim.from === 2 ? g.id === "23" : dotAnim.from === 3 ? g.id === "34" : g.id === "45"
                    )!.y - 7}px`
                  : "20px",
                transform: `translateY(${dotAnim.dy}px)`,
                opacity: 1,
              }}
            />
          ) : null}

          <button
            ref={step1Ref}
            className={`step ${step === "appearance" ? "stepActive" : ""} ${step1Done ? "stepCompleted" : ""} ${guideTarget === "step1" ? "guidePulse" : ""}`}
            onClick={() => withComputation("L1 多维图景感知", runStep1Appearance)}
            disabled={!selectedFacade}
          >
            <div className={`stepIndicator ${step === "appearance" ? "animate-pulse" : ""}`}>1</div>
            <div className="stepContent">
              <div className="stepTitle font-mono font-bold">L1 多维图景感知</div>
              <div className="stepDesc font-mono text-xs text-gray-400">Multi-dimensional Perception</div>
            </div>
          </button>

          <button
            ref={step2Ref}
            className={`step ${step === "semantic" ? "stepActive" : ""} ${step2Done ? "stepCompleted" : ""} ${guideTarget === "step2" ? "guidePulse" : ""}`}
            onClick={() => withComputation("L2 构件语义解析", runStep2Semantic)}
            disabled={!step1Done || isAnalyzing}
          >
            <div className={`stepIndicator ${step === "semantic" ? "animate-pulse" : ""}`}>2</div>
            <div className="stepContent">
              <div className="stepTitle font-mono font-bold">L2 构件语义解析</div>
              <div className="stepDesc font-mono text-xs text-gray-400">Semantic Parsing &amp; Segmentation</div>
            </div>
          </button>

          <button
            ref={step3Ref}
            className={`step ${step === "geometry" ? "stepActive" : ""} ${step3Done ? "stepCompleted" : ""} ${guideTarget === "step3" ? "guidePulse" : ""}`}
            onClick={() => withComputation("L2 拓扑规则重构", runStep3Geometry)}
            disabled={!step2Done}
          >
            <div className={`stepIndicator ${step === "geometry" ? "animate-pulse" : ""}`}>3</div>
            <div className="stepContent">
              <div className="stepTitle font-mono font-bold">L2 拓扑规则重构</div>
              <div className="stepDesc font-mono text-xs text-gray-400">Topological Regularization</div>
            </div>
          </button>

          <button
            ref={step4Ref}
            className={`step ${step === "floorplan" ? "stepActive" : ""} ${step4Done ? "stepCompleted" : ""} ${guideTarget === "step4" ? "guidePulse" : ""}`}
            onClick={() => withComputation("L3 结构基因反演", runStep4Floorplan)}
            disabled={!step3Done}
          >
            <div className={`stepIndicator ${step === "floorplan" ? "animate-pulse" : ""}`}>4</div>
            <div className="stepContent">
              <div className="stepTitle font-mono font-bold">L3 结构基因反演</div>
              <div className="stepDesc font-mono text-xs text-gray-400">Structural Inverse Modeling</div>
            </div>
          </button>

          <button
            ref={step5Ref}
            className={`step ${step === "risk" ? "stepActive" : ""} ${step5Done ? "stepCompleted" : ""} ${guideTarget === "step5" ? "guidePulse" : ""}`}
            onClick={() => withComputation("L4 风险量化评估", runStep5Risk)}
            disabled={!step4Done || !step5Enabled}
          >
            <div className={`stepIndicator ${step === "risk" ? "animate-pulse" : ""}`}>5</div>
            <div className="stepContent">
              <div className="stepTitle font-mono font-bold">L4 风险量化评估</div>
              <div className="stepDesc font-mono text-xs text-gray-400">风险报告（自动化评估）</div>
            </div>
          </button>

          <div style={{ marginTop: 12, color: "rgba(255,255,255,0.68)", fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
              <div style={{ fontWeight: 800 }}>当前选择</div>
              <button
                className={`btn ${guideTarget === "openSelector" ? "guidePulse" : ""}`}
                style={{ height: 28, padding: "0 10px", fontSize: 12 }}
                onClick={openCaseSelector}
              >
                重新选择
              </button>
            </div>
            <div>建筑：{selectedBuilding?.name ?? "-"}</div>
            <div>立面：{selectedFacade?.label ?? selectedFacade?.id ?? "-"}</div>
          </div>
        </div>

        <div className="viewport">
          <div className="viewportInner">
            <div className="viewportHeader">
              <div className="viewportHeaderTitle">VIEWPORT · ORTHO / ORIGINAL</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}>{viewportStatusText}</div>
            </div>
            <div className="viewportBody" ref={viewportBodyRef}>
              {!selectedFacade ? (
                <div className="standbyGrid">
                  <div className="standbyCenter">
                    <div className="standbyLine">
                      SYSTEM ONLINE · WAITING FOR DATA STREAM<span className="blinkCursor">_</span>
                    </div>
                    <div className="standbySub">SGS Kernel Ready · Subscribe: /api/cases · Ingest: /api/analyze_demo</div>
                  </div>
                </div>
              ) : step === "risk" ? (
                <div className="absolute inset-0 bg-[#1a1a1a]">
                  <div className="h-full w-full p-4">
                    <div className="grid h-full grid-cols-2 gap-4">
                      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/30">
                        <img
                          src={orthoSrc || baseSrc || undefined}
                          alt="risk-view"
                          className="absolute inset-0 h-full w-full object-cover opacity-90"
                        />
                        <div className="absolute left-3 top-3 rounded-lg border border-white/10 bg-black/50 px-3 py-2 font-mono text-xs text-gray-200">
                          风险视图 · 输入图像
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                        <div className="font-mono text-xs text-gray-400">自动化风险量化评估报告</div>
                        <div className="mt-2 font-mono text-3xl font-bold text-orange-300">BSu（中等风险）</div>

                        <div className="mt-6 space-y-3 font-mono text-sm text-gray-200">
                          <div className="flex items-center justify-between border-b border-white/10 pb-2">
                            <span className="text-gray-400">轴压比</span>
                            <span>0.65</span>
                          </div>
                          <div className="flex items-center justify-between border-b border-white/10 pb-2">
                            <span className="text-gray-400">层间位移角</span>
                            <span>
                              1/450 <span className="text-yellow-300">⚠️</span>
                            </span>
                          </div>
                          <div className="rounded-lg border border-orange-300/20 bg-orange-300/10 p-3 text-orange-100">
                            建议：建议在 3 个月内进行超声复测（演示）。
                          </div>
                        </div>

                        <button
                          className="mt-5 inline-flex h-10 items-center justify-center rounded-lg border border-white/10 bg-white/10 px-4 font-mono text-sm text-white hover:bg-white/15"
                          onClick={() => {
                            setToast("导出 PDF 报告 · 已生成（演示）");
                            window.setTimeout(() => setToast(null), 1800);
                            window.alert("导出 PDF 报告（演示）：已生成。");
                          }}
                        >
                          导出 PDF 报告
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : step === "floorplan" ? (
                <div className="floorplanStage">
                  <div className="floorplanToolbar">
                    <div className="floorplanTabs">
                      <button
                        type="button"
                        className={`fpTab ${floorplanTab === "2d" ? "active" : ""}`}
                        onClick={() => setFloorplanTab("2d")}
                      >
                        平面布局图
                      </button>
                      <button
                        type="button"
                        className={`fpTab ${floorplanTab === "bim" ? "active" : ""}`}
                        onClick={() => setFloorplanTab("bim")}
                      >
                        BIM 视图
                      </button>
                    </div>
                    {floorplanTab === "2d" ? (
                      <>
                        <div className="floorplanToolbarTitle">平面图 · 拖拽/缩放</div>
                        <div className="floorplanToolbarBtns">
                          <button
                            className="fpBtn"
                            onClick={() => {
                              const vp = floorplanViewportRef.current;
                              if (!vp) return;
                              const r = vp.getBoundingClientRect();
                              const cx = r.width / 2;
                              const cy = r.height / 2;
                              setZoomAtPoint(clamp(floorplanZoom * 1.15, 0.2, 6), cx, cy);
                            }}
                          >
                            +
                          </button>
                          <button
                            className="fpBtn"
                            onClick={() => {
                              const vp = floorplanViewportRef.current;
                              if (!vp) return;
                              const r = vp.getBoundingClientRect();
                              const cx = r.width / 2;
                              const cy = r.height / 2;
                              setZoomAtPoint(clamp(floorplanZoom / 1.15, 0.2, 6), cx, cy);
                            }}
                          >
                            −
                          </button>
                          <button
                            className="fpBtn"
                            onClick={() => {
                              setFloorplanZoom(floorplanFitZoom);
                              centerFloorplan(floorplanFitZoom);
                            }}
                          >
                            Fit
                          </button>
                          <div className="fpZoom">{Math.round(floorplanZoom * 100)}%</div>
                        </div>
                      </>
                    ) : null}
                  </div>

                  {floorplanTab === "bim" ? (
                    <div className="floorplanViewport" style={{ display: "flex", flexDirection: "column" }}>
                      <BIMStructuralView className="floorplan3DView" />
                    </div>
                  ) : (
                    <div
                      className="floorplanViewport"
                      ref={floorplanViewportRef}
                      onWheel={(e) => {
                        e.preventDefault();
                        const vp = floorplanViewportRef.current;
                        if (!vp) return;
                        const r = vp.getBoundingClientRect();
                        const cx = e.clientX - r.left;
                        const cy = e.clientY - r.top;
                        const dir = e.deltaY < 0 ? 1 : -1;
                        const factor = dir > 0 ? 1.08 : 1 / 1.08;
                        setZoomAtPoint(clamp(floorplanZoom * factor, 0.2, 6), cx, cy);
                      }}
                      onPointerDown={(e) => {
                        const vp = floorplanViewportRef.current;
                        if (!vp) return;
                        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                        panDragRef.current = { active: true, x0: e.clientX, y0: e.clientY, pan0x: floorplanPan.x, pan0y: floorplanPan.y };
                      }}
                      onPointerMove={(e) => {
                        const st = panDragRef.current;
                        if (!st?.active) return;
                        const dx = e.clientX - st.x0;
                        const dy = e.clientY - st.y0;
                        setFloorplanPan({ x: st.pan0x + dx, y: st.pan0y + dy });
                      }}
                      onPointerUp={() => {
                        if (panDragRef.current) panDragRef.current.active = false;
                      }}
                      onPointerCancel={() => {
                        if (panDragRef.current) panDragRef.current.active = false;
                      }}
                    >
                      <div
                        className="floorplanCanvas"
                        style={{
                          width: `${FLOORPLAN_BASE.w}px`,
                          height: `${FLOORPLAN_BASE.h}px`,
                          transform: `translate(${floorplanPan.x}px, ${floorplanPan.y}px) scale(${floorplanZoom})`,
                        }}
                      >
                        {floorplanRooms.map((name) => (
                          <div key={name} className={`room-svg ${name}`}>
                            <div
                              className="roomSvgInner"
                              // SVGs are trusted local assets in this demo environment.
                              dangerouslySetInnerHTML={{
                                __html:
                                  floorplanSvgs[name] ||
                                  `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="96" height="96" fill="none" stroke="#fbbf24" stroke-width="2" stroke-dasharray="4 3"/><text x="50" y="55" text-anchor="middle" font-size="10" fill="#f59e0b">${name}</text></svg>`,
                              }}
                            />
                            <div className="roomLabel">
                              <div className="roomName">{floorplanLabels[name] || name}</div>
                              <div className="roomConf">置信度 {floorplanConfidence[name]?.toFixed(2) ?? "0.75"}</div>
                            </div>
                          </div>
                        ))}
                        {floorplanLoading ? <div className="viewportLoading">正在加载平面图…</div> : null}
                        {floorplanError ? <div className="viewportLoading">{floorplanError}</div> : null}
                      </div>
                    </div>
                  )}
                </div>
              ) : step === "appearance" ? (
                <div className="multiViewGrid">
                  {(selectedBuilding?.facades || []).slice(0, 3).map((f, idx) => {
                    return (
                      <div
                        key={f.id}
                        className={`multiViewCell ${selectedFacade?.id === f.id ? "active" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedFacade(f)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") setSelectedFacade(f);
                        }}
                      >
                        <img className="multiViewImg" src={f.original_image || f.thumbnail} alt={f.label || f.id} decoding="async" />
                        <div className="multiViewTag">
                          {facadeViewLabel(idx)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : step === "semantic" ? (
                <div className="multiViewGrid">
                  {(selectedBuilding?.facades || []).slice(0, 3).map((f, idx) => {
                    const a = analysisByFacade[f.id] || null;
                    const vb = a?.debug?.image_dims
                      ? `0 0 ${a.debug.image_dims[0]} ${a.debug.image_dims[1]}`
                      : f.ortho_dims
                        ? `0 0 ${f.ortho_dims[0]} ${f.ortho_dims[1]}`
                        : "0 0 100 100";
                    return (
                      <div
                        key={f.id}
                        className={`multiViewCell ${selectedFacade?.id === f.id ? "active" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedFacade(f)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") setSelectedFacade(f);
                        }}
                      >
                        <img className="multiViewImg" src={f.ortho_image} alt={f.label || f.id} decoding="async" />
                        <div className="multiViewTag">
                          {facadeViewLabel(idx)} · {f.label || f.id}
                        </div>
                        {a?.masks?.length ? (
                          <svg
                            className="multiViewOverlay"
                            viewBox={vb}
                            preserveAspectRatio="xMidYMid meet"
                            width="100%"
                            height="100%"
                            style={{ opacity: semanticMasksVisible ? 1 : 0 }}
                          >
                            {(a?.masks || []).map((m, midx) => {
                              const label = String(m.label || "unknown");
                              const isWindow = label.includes("window");
                              const isAc = label.includes("ac");
                              const stroke = isWindow ? "#f472b6" : isAc ? "#60a5fa" : "#fbbf24";
                              const fill = isWindow ? "rgba(244,114,182,0.22)" : isAc ? "rgba(96,165,250,0.18)" : "rgba(251,191,36,0.16)";
                              return (
                                <path
                                  key={`${label}-${midx}`}
                                  d={pathFromPoints(m.points || [])}
                                  fill={fill}
                                  stroke={stroke}
                                  strokeWidth={2}
                                  vectorEffect="non-scaling-stroke"
                                  style={{ filter: "drop-shadow(0 0 8px rgba(34,211,238,0.10))" }}
                                />
                              );
                            })}
                          </svg>
                        ) : null}
                        {!a?.masks?.length && isAnalyzing ? <div className="multiViewHint">waiting masks…</div> : null}
                      </div>
                    );
                  })}
                  <ScannerOverlay active={scannerActive} />
                </div>
              ) : step === "geometry" ? (
                <div className="multiViewGrid">
                  {(selectedBuilding?.facades || []).slice(0, 3).map((f, idx) => {
                    const a = analysisByFacade[f.id] || null;
                    const vb = a?.debug?.image_dims
                      ? `0 0 ${a.debug.image_dims[0]} ${a.debug.image_dims[1]}`
                      : f.ortho_dims
                        ? `0 0 ${f.ortho_dims[0]} ${f.ortho_dims[1]}`
                        : "0 0 100 100";
                    const boxes = a ? masksToBBoxes(a.masks || []) : [];
                    const axes = a ? geometryAxesFromAnalysis(a) : [];
                    return (
                      <div
                        key={f.id}
                        className={`multiViewCell ${selectedFacade?.id === f.id ? "active" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedFacade(f)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") setSelectedFacade(f);
                        }}
                      >
                        <img className="multiViewImg" src={f.ortho_image} alt={f.label || f.id} decoding="async" />
                        <div className="multiViewTag">
                          {facadeViewLabel(idx)} · {f.label || f.id}
                        </div>

                        {a ? (
                          <svg className="multiViewOverlay" viewBox={vb} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ opacity: 1 }}>
                            {boxes.map((b, bidx) => {
                              const isWindow = String(b.label).includes("window");
                              const stroke = isWindow ? "#f472b6" : "#fbbf24";
                              const fill = isWindow ? "rgba(244,114,182,0.10)" : "rgba(251,191,36,0.08)";
                              return (
                                <rect
                                  key={`${b.label}-${bidx}`}
                                  x={b.x}
                                  y={b.y}
                                  width={b.w}
                                  height={b.h}
                                  fill={fill}
                                  stroke={stroke}
                                  strokeWidth={1.5}
                                  vectorEffect="non-scaling-stroke"
                                />
                              );
                            })}
                            {axes.map((l, aidx) => (
                              <line
                                key={`axis-${aidx}`}
                                x1={l.x}
                                x2={l.x}
                                y1={l.y1}
                                y2={l.y2}
                                stroke="rgba(34,211,238,0.95)"
                                strokeWidth={2.2}
                                strokeDasharray="10 6"
                                vectorEffect="non-scaling-stroke"
                                style={{ filter: "drop-shadow(0 0 6px rgba(34,211,238,0.45))" }}
                              />
                            ))}
                          </svg>
                        ) : null}

                        {!a ? <div className="multiViewHint">no analysis</div> : null}
                      </div>
                    );
                  })}
                  <ScannerOverlay active={scannerActive} />
                </div>
              ) : (
                <>
                  {baseSrc ? (
                    <img
                      className="viewportImg viewportImgBase"
                      src={baseSrc}
                      alt="viewport"
                      decoding="async"
                      fetchPriority="high"
                      onLoad={(e) => {
                        setBaseReady(true);
                        if (baseSrc === originalSrc) {
                          const imgEl = e.currentTarget;
                          if (imgEl.naturalWidth && imgEl.naturalHeight) {
                            originalDimsRef.current = { w: imgEl.naturalWidth, h: imgEl.naturalHeight };
                          }
                        }
                        if (orthoSrc && baseSrc === orthoSrc) {
                          const imgEl = e.currentTarget;
                          if (imgEl.naturalWidth && imgEl.naturalHeight) {
                            setOrthoDims([imgEl.naturalWidth, imgEl.naturalHeight]);
                          }
                        }
                        // If we were transitioning and base has loaded ortho, fade out overlay.
                        if (overlaySrc && baseSrc === overlaySrc && overlayReady) {
                          setOverlayVisible(false);
                          setTimeout(() => setOverlaySrc(null), 420);
                        }
                      }}
                      onError={() => {
                        log(`Image failed to load: ${baseSrc}`);
                      }}
                      style={{ opacity: baseReady ? 1 : 0 }}
                    />
                  ) : (
                    <div className="viewportEmpty">Waiting…</div>
                  )}

                  {overlaySrc ? (
                    <img
                      className="viewportImg viewportImgOverlay"
                      src={overlaySrc}
                      alt="ortho"
                      decoding="async"
                      onLoad={() => {
                        setOverlayReady(true);
                        setOverlayVisible(true);
                        // Apply a transform-from (based on *_transform.json inverse matrix),
                        // then animate to identity as the ortho fades in.
                        setOverlayTransform(overlayTransformFrom || "none");
                        requestAnimationFrame(() => {
                          requestAnimationFrame(() => {
                            setOverlayTransform("none");
                          });
                        });
                        // Trigger base swap to ortho; keep overlay visible until base load completes.
                        setBaseSrc(overlaySrc);
                        setBaseReady(false);
                      }}
                      onError={() => {
                        log(`Ortho failed to load: ${overlaySrc}`);
                        setOverlayVisible(false);
                        setOverlaySrc(null);
                        setOverlayReady(false);
                      }}
                      style={{
                        opacity: overlayVisible && overlayReady ? 1 : 0,
                        transform: overlayVisible && overlayReady ? overlayTransform : "none",
                      }}
                    />
                  ) : null}

                  {baseSrc && !baseReady && !(overlayVisible && overlayReady) ? <div className="viewportLoading">Loading image…</div> : null}

                  {step === "appearance" && step1Done && selectedBuilding && (selectedBuilding.facades || []).length > 1 ? (
                    <>
                      <button className="viewArrow viewArrowLeft" onClick={() => switchFacade(-1)} aria-label="Previous facade view">
                        ‹
                      </button>
                      <button className="viewArrow viewArrowRight" onClick={() => switchFacade(1)} aria-label="Next facade view">
                        ›
                      </button>
                      <div className="viewTag">
                        {facadeViewLabel(currentFacadeIndex())} · {selectedFacade?.label || selectedFacade?.id}
                      </div>
                    </>
                  ) : null}

                  <ScannerOverlay active={scannerActive} />
                </>
              )}
            </div>
          </div>
        </div>

        <div className="right" ref={rightPanelRef}>
          <div className="card">
            <div className="cardTitle">运行状态</div>
            <div className="row">
              <div className="label">建筑</div>
              <div className="val">{selectedBuilding?.name ?? "-"}</div>
            </div>
            <div className="row">
              <div className="label">立面</div>
              <div className="val">{selectedFacade?.label ?? selectedFacade?.id ?? "-"}</div>
            </div>
            <div className="row">
              <div className="label">视图</div>
              <div className="val">{orthoVisible ? "正射" : "原图"}</div>
            </div>
          </div>

          {/* Current step output (always on top) */}
          {step === "appearance" && !step1Done ? (
            <div className="card">
              <div className="cardTitle font-mono">L1 多维图景感知 · 提示</div>
              <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 12 }}>
                当前并列展示北/西/南三张原图；点击任意一张可选中该立面。点击左侧 L1 后将生成并显示输出结果。
              </div>
            </div>
          ) : null}

          {step === "appearance" && step1Done ? (
            <div className="card cardJumpIn" key={`l1-out-${selectedBuilding?.id ?? "na"}`}>
              <div className="cardTitle font-mono">L1 多维图景感知 · 输出</div>
              <div className="row">
                <div className="label">结构形式</div>
                <div className="val">{selectedBuilding?.step1_info?.structure ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">建成年代</div>
                <div className="val">{selectedBuilding?.step1_info?.year ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">建筑用途</div>
                <div className="val">民用住宅</div>
              </div>
              <div className="row">
                <div className="label">面积估计</div>
                <div className="val">{selectedBuilding?.step1_info?.area_est ?? "-"}</div>
              </div>
            </div>
          ) : null}

          {step === "semantic" ? (
            <div className="card">
              <div className="cardTitle font-mono">L2 构件语义解析 · {step2Done ? "输出" : "运行中"}</div>
              {!step2Done ? (
                <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 12 }}>先展示并列 3 张 ORTHO，延迟 0.5s 后叠加 mask（半透明）。</div>
              ) : null}
              <div className="row">
                <div className="label">窗户（粉）</div>
                <div className="val">{activeAnalysis?.counts?.window ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">空调（蓝）</div>
                <div className="val">{activeAnalysis?.counts?.ac ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">其他（黄）</div>
                <div className="val">{activeAnalysis ? `${activeAnalysis.counts.door + activeAnalysis.counts.other}` : "-"}</div>
              </div>
              {activeAnalysisError ? (
                <div style={{ marginTop: 10, color: "var(--bad)", fontSize: 12, fontWeight: 700 }}>{activeAnalysisError}</div>
              ) : null}
            </div>
          ) : null}

          {step === "geometry" ? (
            <div className="card">
              <div className="cardTitle font-mono">L2 拓扑规则重构 · 输出</div>
              <div className="row">
                <div className="label">识别开间数</div>
                <div className="val">{selectedBuilding?.step3_info?.bays ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">户型对称性</div>
                <div className="val">{selectedBuilding?.step3_info?.symmetry ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">推测厨房</div>
                <div className="val">{selectedBuilding?.step3_info?.kitchen_est ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">推测卧室</div>
                <div className="val">{selectedBuilding?.step3_info?.bedroom_est ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">轴线数量</div>
                <div className="val">{activeAnalysis ? `${geometryAxes.length}` : "-"}</div>
              </div>
            </div>
          ) : null}

          {step === "floorplan" ? (
            <div className="card">
              <div className="cardTitle font-mono">L3 结构基因反演 · 输出</div>
              <div className="row">
                <div className="label">来源</div>
                <div className="val">/floorplan_svg/*.svg</div>
              </div>
              <div style={{ marginTop: 10, color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
                该步骤目前为静态示例页面（后续可替换为真实生成结果）。
              </div>
            </div>
          ) : null}

          {step === "risk" ? (
            <div className="card">
              <div className="cardTitle font-mono">L4 风险量化评估 · 输出</div>
              <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 12 }}>详见主视图风险报告面板（支持导出 PDF · 演示）。</div>
            </div>
          ) : null}

          {/* History (completed steps) */}
          {step !== "appearance" && step1Done ? (
            <div className="card">
              <div className="cardTitle font-mono">L1 多维图景感知 · 输出</div>
              <div className="row">
                <div className="label">结构形式</div>
                <div className="val">{selectedBuilding?.step1_info?.structure ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">建成年代</div>
                <div className="val">{selectedBuilding?.step1_info?.year ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">建筑用途</div>
                <div className="val">民用住宅</div>
              </div>
              <div className="row">
                <div className="label">面积估计</div>
                <div className="val">{selectedBuilding?.step1_info?.area_est ?? "-"}</div>
              </div>
            </div>
          ) : null}

          {step !== "semantic" && step2Done ? (
            <div className="card">
              <div className="cardTitle font-mono">L2 构件语义解析 · 输出</div>
              <div className="row">
                <div className="label">窗户（粉）</div>
                <div className="val">{activeAnalysis?.counts?.window ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">空调（蓝）</div>
                <div className="val">{activeAnalysis?.counts?.ac ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">其他（黄）</div>
                <div className="val">{activeAnalysis ? `${activeAnalysis.counts.door + activeAnalysis.counts.other}` : "-"}</div>
              </div>
            </div>
          ) : null}

          {step !== "geometry" && step3Done ? (
            <div className="card">
              <div className="cardTitle font-mono">L2 拓扑规则重构 · 输出</div>
              <div className="row">
                <div className="label">识别开间数</div>
                <div className="val">{selectedBuilding?.step3_info?.bays ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">户型对称性</div>
                <div className="val">{selectedBuilding?.step3_info?.symmetry ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">推测厨房</div>
                <div className="val">{selectedBuilding?.step3_info?.kitchen_est ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">推测卧室</div>
                <div className="val">{selectedBuilding?.step3_info?.bedroom_est ?? "-"}</div>
              </div>
              <div className="row">
                <div className="label">轴线数量</div>
                <div className="val">{activeAnalysis ? `${geometryAxes.length}` : "-"}</div>
              </div>
            </div>
          ) : null}

          {step !== "floorplan" && step4Done ? (
            <div className="card">
              <div className="cardTitle font-mono">L3 结构基因反演 · Output</div>
              <div className="row">
                <div className="label">来源</div>
                <div className="val">/floorplan_svg/*.svg</div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="terminalPanel">
        <div className="terminalHeader">
          <div className="terminalTitle">
            <span>Solver Kernel Log (解算日志)</span>
            <span className="terminalDim">newdemo-facade</span>
          </div>
          <div className="terminalDim">UTF-8 • LF</div>
        </div>
        <div className="terminalOutput" ref={terminalOutputRef}>
          {terminalLines.length ? (
            <>
              <pre className="m-0 whitespace-pre-wrap">
                {terminalLines.slice(0, -1).join("\n")}
                {terminalLines.length > 1 ? "\n" : ""}
                {typedLast}
                {typedCursorOn ? "▌" : " "}
              </pre>
            </>
          ) : (
            "暂无日志。"
          )}
        </div>
      </div>

      {toast ? (
        <div className="fixed right-4 top-4 z-[6000] rounded-xl border border-white/10 bg-black/70 px-4 py-3 font-mono text-xs text-white shadow-[0_0_40px_rgba(34,211,238,0.12)]">
          {toast}
        </div>
      ) : null}

      {isModalOpen ? (
        <div className="modalBackdrop" onClick={() => setIsModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 900, fontSize: 14 }}>Select Building</div>
              <button className="btn" onClick={() => setIsModalOpen(false)}>
                Close
              </button>
            </div>

            {loadingCases ? <div style={{ color: "rgba(255,255,255,0.7)" }}>Loading…</div> : null}
            {casesError ? <div style={{ color: "var(--bad)", fontWeight: 800 }}>{casesError}</div> : null}

            {cases.map((b) => (
              <div key={b.id} style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>{b.name}</div>
                <div style={{ position: "relative" }}>
                  <div className="grid">
                    {(b.facades || []).map((f) => (
                      <div key={f.id} className="thumb" aria-label={`${f.label || f.id}`}>
                        <img className="thumbImg" src={f.thumbnail} alt={f.label || f.id} loading="lazy" decoding="async" />
                        <div className="thumbLabel">{f.label || f.id}</div>
                      </div>
                    ))}
                  </div>
                  <button
                    className={`thumbGroupButton ${guideTarget === "pickGroup" ? "guidePulse" : ""}`}
                    onClick={() => {
                      const f0 = (b.facades || [])[0];
                      if (!f0) return;
                      setSelectedBuilding(b);
                      setSelectedFacade(f0);
                      setAnalysisByFacade({});
                      setAnalysisErrorByFacade({});
                      resetSteps();
                      setIsModalOpen(false);
                      log(`Selected: ${b.name} · views=${(b.facades || []).length}`);
                    }}
                    aria-label={`Select ${b.name} (north/west/south facades)`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

