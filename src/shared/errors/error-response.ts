// The single error shape every failed request returns (AGENTS.md §6).
export interface ErrorBody {
  code: string;
  message: string;
}

export interface ErrorResponseBody {
  error: ErrorBody;
}

export function errorResponse(
  code: string,
  message: string,
): ErrorResponseBody {
  return { error: { code, message } };
}
