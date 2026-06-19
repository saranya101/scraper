import { prisma } from "../repositories/prisma.js";
import { HttpError } from "../utils/httpError.js";
import { verifyToken } from "../utils/tokens.js";

export async function requireAuth(req, _res, next) {
  try {
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;
    const token = bearer || req.cookies?.lead_token;

    if (!token) throw new HttpError(401, "Authentication required");

    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true, createdAt: true }
    });

    if (!user || user.role !== "ADMIN") {
      throw new HttpError(403, "Admin access required");
    }

    req.user = user;
    next();
  } catch (error) {
    next(error.statusCode ? error : new HttpError(401, "Invalid or expired session"));
  }
}
