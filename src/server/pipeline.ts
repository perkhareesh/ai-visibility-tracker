import { classifyCitations } from "@/lib/analysis/citations";
import { DETECTION_VERSION, detectAll, type EntityInput } from "@/lib/analysis/detect";
import { analyzeSentiment } from "@/lib/analysis/sentiment";
import type { ProviderResult } from "@/lib/providers/types";

export interface AnalysisOutput {
  version: string;
  tracked: ReturnType<typeof detectAll>[number];
  competitors: ReturnType<typeof detectAll>;
  citations: ReturnType<typeof classifyCitations>;
  sentiment: ReturnType<typeof analyzeSentiment>;
}

/** Pure analysis step: detection -> citations -> sentiment. No I/O. */
export function analyzeResponse(result: Pick<ProviderResult, "text" | "citations" | "citationsAvailable">, tracked: EntityInput, competitors: EntityInput[]): AnalysisOutput {
  const [t, ...comps] = detectAll(result.text, [tracked, ...competitors]);
  const citations = result.citationsAvailable ? classifyCitations(result.citations, { tracked, competitors, responseText: result.text }) : [];
  const sentiment = analyzeSentiment(t, comps);
  return { version: `${DETECTION_VERSION}+${sentiment.analysisVersion}`, tracked: t, competitors: comps, citations, sentiment };
}
