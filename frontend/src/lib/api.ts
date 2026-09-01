const API_URL = import.meta.env.VITE_API_URL;
export const ORIGIN_URL = API_URL.replace(/\/api\/?$/, "");

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("token");
  const isFormData = options.body instanceof FormData;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));

    // Sessão expirada/token inválido em qualquer chamada (menos o próprio login,
    // onde 401 é só "senha errada") — sem isso a pessoa ficava presa numa tela morta
    // vendo o erro sem entender que precisa entrar de novo.
    if (res.status === 401 && path !== "/auth/login") {
      localStorage.removeItem("token");
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }

    throw new ApiError(res.status, body.error ?? "Erro inesperado");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
