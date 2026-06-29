import * as gapAnalysisService from "../services/gapAnalysisService.js";

export async function build(req, res) {
  res.json(gapAnalysisService.buildGapAnalysis(req.body));
}
