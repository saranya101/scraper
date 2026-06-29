import * as observationScoringService from "../services/observationScoringService.js";

export async function build(req, res) {
  res.json(observationScoringService.scoreObservations(req.body));
}
