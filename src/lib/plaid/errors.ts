export function getPlaidErrorCode(error: unknown): string | null {
  if (!isObject(error)) {
    return null;
  }

  const response = error.response;
  if (!isObject(response)) {
    return null;
  }

  const data = response.data;
  if (!isObject(data)) {
    return null;
  }

  return typeof data.error_code === "string" ? data.error_code : null;
}

export function isPlaidLoginRequiredError(error: unknown): boolean {
  return getPlaidErrorCode(error) === "ITEM_LOGIN_REQUIRED";
}

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null;
}
