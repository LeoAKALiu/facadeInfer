import type { AnalyzeDemoResponse, BuildingCase } from "./types";

export async function fetchCases(signal?: AbortSignal): Promise<BuildingCase[]> {
  const res = await fetch("/api/cases", { signal });
  if (!res.ok) {
    throw new Error(`Failed to load cases: HTTP ${res.status}`);
  }
  return (await res.json()) as BuildingCase[];
}

export async function analyzeDemo(caseId: string, signal?: AbortSignal): Promise<AnalyzeDemoResponse> {
  const form = new FormData();
  form.append("case_id", caseId);
  const res = await fetch("/api/analyze_demo", { method: "POST", body: form, signal });
  const payload = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const detail =
      payload && typeof payload === "object" && "detail" in payload ? String((payload as any).detail) : `HTTP ${res.status}`;
    throw new Error(`Analyze failed: ${detail}`);
  }
  return payload as AnalyzeDemoResponse;
}

