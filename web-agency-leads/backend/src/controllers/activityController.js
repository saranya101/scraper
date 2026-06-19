import * as activityService from "../services/activityService.js";

export async function list(_req, res) {
  res.json(await activityService.listActivity());
}
