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

export async function update(req, res) {
  res.json(await leadService.updateNote(req.params.id, req.user.id, req.body.note));
}

export async function remove(req, res) {
  await leadService.deleteNote(req.params.id);
  res.status(204).send();
}
