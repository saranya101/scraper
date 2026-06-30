import * as outreachPipelineService from "../services/outreachPipelineService.js";

export async function run(req, res) {
  res.json(await outreachPipelineService.runOutreachPipeline(req.body, { userId: req.user?.id }));
}

export async function analyzeServices(req, res) {
  res.json(await outreachPipelineService.analyzeLeadServices(req.body.leadId, { force: req.body.force === true }));
}

export async function updateSelectedServices(req, res) {
  res.json(await outreachPipelineService.updateLeadSelectedServices(req.params.leadId, req.body.selectedReportServices, { source: "manual" }));
}

export async function reset(req, res) {
  res.json(await outreachPipelineService.resetPipeline(req.body.leadIds || [], { all: req.body.all === true }));
}

export async function decide(req, res) {
  res.json(await outreachPipelineService.decidePipeline(req.body.leadId, req.body.decision));
}

export async function saveDraft(req, res) {
  res.json(await outreachPipelineService.savePipelineDraft(req.body.leadId, {
    ...(req.body.draft || {}),
    emailSelectedServices: req.body.emailSelectedServices || []
  }));
}
