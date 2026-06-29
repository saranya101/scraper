import * as conversationQualityService from "../services/conversationQualityService.js";

export async function build(req, res) {
  res.json(conversationQualityService.filterConversationQuality(req.body));
}
