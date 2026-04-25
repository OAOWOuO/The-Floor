export class AppError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function toPublicError(error) {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }

  return {
    code: "internal_error",
    message: "Something went wrong while building the debate."
  };
}

