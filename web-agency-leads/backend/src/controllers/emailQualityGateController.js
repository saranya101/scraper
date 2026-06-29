import * as emailQualityGateService from "../services/emailQualityGateService.js";

export async function build(req, res) {
  res.json(emailQualityGateService.evaluateEmailQuality(req.body));
}
