export type FacadeCase = {
  id: string;
  label: string;
  thumbnail: string;
  ortho_image: string;
  original_image: string;
  /** Viewport-sized (e.g. max 1920px) URL for main view; prefer over original_image for display. */
  viewport_original_url?: string;
  /** Viewport-sized (e.g. max 1920px) URL for main view; prefer over ortho_image for display. */
  viewport_ortho_url?: string;
  ortho_dims?: [number, number];
  original_dims?: [number, number];
};

export type BuildingCase = {
  id: string;
  name: string;
  facades: FacadeCase[];
  step1_info?: {
    structure: string;
    year: string;
    use: string;
    area_est?: string;
  };
  step3_info?: {
    bays: number;
    symmetry: string;
    kitchen_est: string;
    bedroom_est: string;
  };
};

export type AnalyzeDemoResponse = {
  status: "success";
  risk_report: Record<string, unknown>;
  counts: { window: number; ac: number; door: number; other: number };
  masks: Array<{ label: string; points: number[][]; shape_type: string }>;
  images: { original: string; processed: string };
  debug: {
    boxes_count: number;
    image_dims: [number, number];
    raw_boxes: Array<[string, number, number, number, number]>;
  };
};

