import { request } from "./api";

export interface BrandingSettings {
  company_logo: string | null;
  customer_logo: string | null;
}

export interface LibraryAsset {
  name: string;
  path: string;
  size_bytes: number;
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (typeof window !== "undefined" && window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "");

export const fetchAdminBranding = (): Promise<BrandingSettings> =>
  request("/admin/branding");

export const updateAdminBranding = (payload: BrandingSettings): Promise<BrandingSettings> =>
  request("/admin/branding", { method: "PUT", body: JSON.stringify(payload) });

export const fetchBrandingAssets = (): Promise<{ library: LibraryAsset[] }> =>
  request("/admin/branding/assets");

export async function uploadBrandingAsset(file: File): Promise<{ path: string; size_bytes: number }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_BASE_URL}/admin/branding/upload`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) {
    let detail = "";
    try { const j = await res.json() as { detail?: string }; detail = j?.detail || ""; } catch {}
    throw new Error(detail || `Upload failed: ${res.status}`);
  }
  return res.json();
}

/** Resolve a token like "library:foo.png" or "upload:abc.png" to a static URL. */
export function resolveBrandingAssetUrl(token: string | null | undefined): string | null {
  if (!token) return null;
  if (token.startsWith("library:")) return `/static/branding/library/${token.slice("library:".length)}`;
  if (token.startsWith("upload:")) return `/static/branding/uploads/${token.slice("upload:".length)}`;
  if (token.startsWith("http") || token.startsWith("/")) return token;
  return null;
}
