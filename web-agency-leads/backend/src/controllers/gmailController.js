import * as gmailReplySyncService from "../services/gmailReplySync.service.js";

export async function syncReplies(req, res) {
  res.json(await gmailReplySyncService.syncGmailReplies({ initiatedByUserId: req.user.id, source: "manual" }));
}
