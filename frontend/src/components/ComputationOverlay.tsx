import { useEffect, useMemo, useState } from "react";

export type ComputationOverlayProps = {
  open: boolean;
  title?: string;
};

const DEFAULT_MESSAGES: string[] = [
  "Loading Priors (GB50096-2011)...",
  "Initializing YOLOv8-GhostNet Inference...",
  "Applying Manifold Constraint Optimization...",
  "Solving Inverse Geometric Equations (Loss < 1e-4)...",
  "Generating Structural Topology Graph...",
];

function pickNextMessage(messages: string[], last: string | null): string {
  if (!messages.length) return "";
  if (messages.length === 1) return messages[0];
  for (let i = 0; i < 4; i++) {
    const m = messages[Math.floor(Math.random() * messages.length)];
    if (m !== last) return m;
  }
  return messages[0];
}

export function ComputationOverlay(props: ComputationOverlayProps): JSX.Element | null {
  const { open, title } = props;

  const messages = useMemo(() => DEFAULT_MESSAGES, []);
  const [lines, setLines] = useState<string[]>([]);
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setLines([]);
      setLast(null);
      return;
    }

    // Prime some lines instantly so it doesn't feel empty.
    const first = pickNextMessage(messages, null);
    setLines([`[SGS] ${first}`]);
    setLast(first);

    const id = window.setInterval(() => {
      setLines((prev) => {
        const next = pickNextMessage(messages, last);
        const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
        const line = `${ts}  ${next}`;
        const out = [...prev, line];
        return out.slice(-10);
      });
      setLast((prevLast) => pickNextMessage(messages, prevLast));
    }, 200);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-gray-900/95 backdrop-blur-sm">
      <div className="w-[min(760px,92vw)] rounded-2xl border border-white/10 bg-black/40 p-6 shadow-[0_0_80px_rgba(34,211,238,0.15)]">
        <div className="flex items-center gap-4">
          <div className="relative h-14 w-14">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-400/20" />
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-cyan-400/20 border-t-cyan-300 shadow-[0_0_24px_rgba(34,211,238,0.35)]" />
            <div className="absolute inset-[10px] rounded-full border border-emerald-400/20" />
          </div>
          <div className="min-w-0">
            <div className="font-mono text-sm font-bold text-white">{title || "Computing…"}</div>
            <div className="mt-0.5 font-mono text-xs text-gray-400">Kernel warm-up · constraint assembly · solver iteration</div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/50 p-3">
          <div className="font-mono text-[12px] leading-5 text-emerald-300">
            {lines.length ? lines.join("\n") : "…"}
          </div>
        </div>
      </div>
    </div>
  );
}

