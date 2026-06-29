import * as emailWriterService from "../services/emailWriterService.js";

export async function build(req, res) {
  res.json(await emailWriterService.writeEmail(req.body));
}
