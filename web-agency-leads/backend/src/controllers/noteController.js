import * as leadService from "../services/leadService.js";

export async function create(req, res) {
  const note = await leadService.addNote({
    leadId: req.body.leadId,
    userId: req.user.id,
    note: req.body.note
  });
  res.status(201).json(note);
}

export async function list(req, res) {
  res.json(await leadService.listNotes(req.params.leadId));
}
