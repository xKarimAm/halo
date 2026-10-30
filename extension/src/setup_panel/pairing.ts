/** Backend pairing endpoint (plain HTTP, before any meeting). */
export const PAIR_URL = "http://127.0.0.1:8765/pair";

/** Rejected pairing: malformed code, wrong code, unreachable backend, bad payload. */
export class PairingError extends Error {
  /** HTTP status for server rejections; 0 when no response arrived or the code never sent. */
  readonly status: number;

  constructor(message: string, status = 0, options?: ErrorOptions) {
    super(message, options);
    this.name = "PairingError";
    this.status = status;
  }
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Exchange the one-time 6-digit code for a backend token.
 * Throws PairingError on anything but a `{token}` JSON reply; stores nothing.
 */
export async function pairWithCode(code: string, fetchFn: FetchFn = fetch): Promise<string> {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    throw new PairingError("Enter the 6-digit code from the backend.");
  }
  let response: Response;
  try {
    response = await fetchFn(PAIR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: trimmed }),
    });
  } catch (error) {
    throw new PairingError("Backend unreachable at 127.0.0.1:8765.", 0, { cause: error });
  }
  if (!response.ok) {
    throw new PairingError("Wrong code. Check the code and try again.", response.status);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new PairingError("Bad pairing reply from the backend.", response.status, {
      cause: error,
    });
  }
  const token =
    typeof payload === "object" && payload !== null && "token" in payload
      ? (payload as { token: unknown }).token
      : undefined;
  if (typeof token !== "string" || token.length === 0) {
    throw new PairingError("Bad pairing reply from the backend.", response.status);
  }
  return token;
}
