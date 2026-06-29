import * as websiteBlueprintService from "../services/websiteBlueprintService.js";

export async function build(req, res) {
  res.json(await websiteBlueprintService.buildWebsiteBlueprint(req.body));
}
