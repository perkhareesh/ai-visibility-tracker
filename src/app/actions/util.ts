import { ZodError } from "zod";

export function errorMessage(e: unknown): string {
  if (e instanceof ZodError) {
    const i = e.issues[0];
    const field = i.path.length ? `${i.path.join(".")}: ` : "";
    return `${field}${i.message}`;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

export function withParam(path: string, key: string, value: string) {
  const [base, qs] = path.split("?");
  const p = new URLSearchParams(qs ?? "");
  p.delete("error");
  p.delete("notice");
  p.set(key, value.slice(0, 300));
  return `${base}?${p.toString()}`;
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

/** Accept only same-site relative paths for post-action redirects. */
export function safeBack(v: string, fallback: string) {
  return v.startsWith("/") && !v.startsWith("//") ? v : fallback;
}
