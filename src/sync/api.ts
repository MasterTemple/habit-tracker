// Calls to the sync server. Errors carry the server's human-readable message.

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export interface User {
  id: string
  username: string
  displayName: string
  timeZone: string
  createdAt: string
}

export interface SessionResponse {
  token: string
  user: User
}

/**
 * Where the server is, by default: VITE_SERVER_URL if the build sets it; in development,
 * "/api" on this site (the dev server proxies that to a local server); otherwise none yet.
 */
export function defaultServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined
  if (configured) return configured
  return import.meta.env.DEV ? `${location.origin}${import.meta.env.BASE_URL}api` : ""
}

export async function call<T>(serverUrl: string, path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${serverUrl.replace(/\/+$/, "")}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError(0, "offline", "Can't reach the server")
  }
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, body?.error ?? "error", body?.message ?? `Server error (${res.status})`)
  return body as T
}

export const register = (serverUrl: string, body: { username: string; password: string; displayName?: string; timeZone?: string; signupCode?: string }) =>
  call<SessionResponse>(serverUrl, "/auth/register", { body })

export const login = (serverUrl: string, username: string, password: string) =>
  call<SessionResponse>(serverUrl, "/auth/login", { body: { username, password } })

export const logout = (serverUrl: string, token: string) => call<void>(serverUrl, "/auth/logout", { method: "POST", token })

export const changePassword = (serverUrl: string, token: string, currentPassword: string, newPassword: string) =>
  call<void>(serverUrl, "/me/password", { token, body: { currentPassword, newPassword } })

/** A friendly message for a failed password check (change password, delete account). */
export function passwordError(e: unknown): string {
  if (e instanceof ApiError && e.code === "bad_credentials") return "That password isn't right."
  return (e as Error).message
}

/** The signed-in user's progress report as a PDF (rendered by the server). */
export async function reportPdf(serverUrl: string, token: string, period: "week" | "month", categoryIds: string[]): Promise<Blob> {
  const query = new URLSearchParams({ period, categories: categoryIds.join(",") })
  let res: Response
  try {
    res = await fetch(`${serverUrl.replace(/\/+$/, "")}/reports/pdf?${query}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  } catch {
    throw new ApiError(0, "offline", "Can't reach the server")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, body?.error ?? "error", body?.message ?? `Server error (${res.status})`)
  }
  return res.blob()
}
