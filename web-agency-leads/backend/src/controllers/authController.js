import * as authService from "../services/authService.js";
import { authCookieOptions } from "../utils/tokens.js";

export async function login(req, res) {
  const result = await authService.login(req.body.email, req.body.password);
  res.cookie("lead_token", result.token, authCookieOptions());
  res.json(result);
}

export async function logout(_req, res) {
  res.clearCookie("lead_token", authCookieOptions());
  res.json({ message: "Logged out" });
}

export async function me(req, res) {
  res.json({ user: req.user });
}
