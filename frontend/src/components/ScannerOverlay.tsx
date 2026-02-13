export type ScannerOverlayProps = {
  active: boolean;
};

export function ScannerOverlay(props: ScannerOverlayProps): JSX.Element | null {
  if (!props.active) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[30]">
      {/* subtle haze */}
      <div className="absolute inset-0 bg-cyan-500/0" />

      {/* scanning line */}
      <div className="scannerLine absolute left-0 right-0 h-px bg-cyan-200 shadow-[0_0_10px_#00ffff]" />

      {/* faint scan noise */}
      <div className="absolute inset-0 opacity-[0.06] mix-blend-screen [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:6px_6px]" />
    </div>
  );
}

