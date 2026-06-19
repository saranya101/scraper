import { ZodError } from "zod";

export function notFoundHandler(req, _res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

export function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(422).json({
      message: "Validation failed",
      details: error.flatten()
    });
  }

  const statusCode = error.statusCode || 500;
  const message = statusCode === 500 ? "Something went wrong" : error.message;

  if (statusCode === 500) {
    console.error(error);
  }

  return res.status(statusCode).json({
    message,
    details: error.details
  });
}
