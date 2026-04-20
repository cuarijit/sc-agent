/**
 * Admin API for the Documentation Management feature. Reads + writes the
 * help manifest and per-entry markdown content. Goes through the shared
 * `request()` helper so cookies + 401 handling come for free.
 */
import { request } from "./api";

export interface HelpManifestEntry {
  id: string;
  type: "module" | "page" | "tab" | "reference";
  title: string;
  description: string;
  icon: string | null;
  content_file: string;
  route_path: string;
  parent_id: string | null;
  order: number;
}

export interface HelpManifestResponse {
  version: number;
  entries: HelpManifestEntry[];
}

export interface HelpContentResponse {
  entry_id: string;
  content: string;
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (typeof window !== "undefined" && window.location.protocol === "file:"
    ? "http://127.0.0.1:8000"
    : "");

export const fetchHelpManifest = (): Promise<HelpManifestResponse> =>
  request("/admin/help/manifest");

export const fetchHelpContent = (entryId: string): Promise<HelpContentResponse> =>
  request(`/admin/help/content/${encodeURIComponent(entryId)}`);

export const updateHelpContent = (
  entryId: string,
  content: string,
): Promise<HelpContentResponse> =>
  request(`/admin/help/content/${encodeURIComponent(entryId)}`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });

export const updateHelpManifest = (
  manifest: HelpManifestResponse,
): Promise<HelpManifestResponse> =>
  request("/admin/help/manifest", {
    method: "PUT",
    body: JSON.stringify(manifest),
  });

export const createHelpEntry = (
  entry: Partial<HelpManifestEntry> & { id: string; content?: string },
): Promise<HelpManifestEntry> =>
  request("/admin/help/entry", {
    method: "POST",
    body: JSON.stringify(entry),
  });

export const deleteHelpEntry = (
  entryId: string,
): Promise<{ status: string; entry_id: string }> =>
  request(`/admin/help/entry/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
  });

export async function uploadHelpMarkdown(
  entryId: string,
  file: File,
): Promise<{ entry_id: string; size_bytes: number }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(
    `${API_BASE_URL}/admin/help/upload/${encodeURIComponent(entryId)}`,
    { method: "POST", credentials: "include", body: fd },
  );
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { detail?: string };
      detail = j?.detail ?? "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `Upload failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Longest-prefix `route_path` resolver. Given the current pathname (and
 * optional search), pick the manifest entry whose route_path is the longest
 * prefix match. Used by the in-app help drawer to auto-pick the right doc.
 */
export function resolveEntryForPath(
  entries: HelpManifestEntry[],
  pathname: string,
  search: string,
): HelpManifestEntry | null {
  const fullPath = search ? `${pathname}${search}` : pathname;
  let best: HelpManifestEntry | null = null;
  let bestLen = 0;
  for (const entry of entries) {
    const rp = entry.route_path;
    if (!rp) continue;
    const matchesFull = fullPath.startsWith(rp);
    const matchesPath = pathname.startsWith(rp) || pathname === rp;
    if (matchesFull || matchesPath) {
      if (rp.length > bestLen) {
        bestLen = rp.length;
        best = entry;
      }
    }
  }
  return best;
}
