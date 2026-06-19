import * as workspaceService from "../services/workspaceService.js";

export async function list(req, res) {
  res.json(await workspaceService.listWorkspaces(req.user.id));
}

export async function get(req, res) {
  res.json(await workspaceService.getWorkspace(req.params.industrySlug, req.user.id));
}
