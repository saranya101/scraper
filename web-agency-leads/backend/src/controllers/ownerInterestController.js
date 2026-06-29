import * as ownerInterestService from "../services/ownerInterestService.js";

export async function build(req, res) {
  res.json(ownerInterestService.filterOwnerInterest(req.body));
}
