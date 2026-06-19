import bcrypt from "bcryptjs";
import { prisma } from "../repositories/prisma.js";
import { HttpError } from "../utils/httpError.js";
import { signToken } from "../utils/tokens.js";

export async function login(email, password) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() }
  });

  if (!user) throw new HttpError(401, "Invalid email or password");

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) throw new HttpError(401, "Invalid email or password");

  const token = signToken(user);
  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  };
}
