/**
 * PageHelpDrawer — right-side drawer that auto-resolves the help entry
 * for the current route via the manifest's longest-prefix `route_path`
 * matching. Renders the markdown via the shared MarkdownView component.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Box, CircularProgress, Drawer, IconButton, Stack, Typography } from "@mui/material";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";

import MarkdownView from "./MarkdownView";
import {
  fetchHelpManifest,
  resolveEntryForPath,
  type HelpManifestEntry,
} from "../../services/helpAdminApi";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (typeof window !== "undefined" && window.location.protocol === "file:"
    ? "http://127.0.0.1:8000"
    : "");

interface PageHelpDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Force a specific manifest entry id; otherwise auto-resolved from route. */
  slugOverride?: string | null;
}

// Cached manifest so the drawer doesn't fetch it on every open. Refreshed on
// window focus + every 5 minutes; admin edits become visible promptly.
let _manifestCache: HelpManifestEntry[] | null = null;
let _manifestFetchedAt = 0;
const MANIFEST_TTL_MS = 5 * 60 * 1000;

async function loadManifest(force = false): Promise<HelpManifestEntry[]> {
  const now = Date.now();
  if (!force && _manifestCache && now - _manifestFetchedAt < MANIFEST_TTL_MS) {
    return _manifestCache;
  }
  try {
    const m = await fetchHelpManifest();
    _manifestCache = m.entries;
    _manifestFetchedAt = now;
    return m.entries;
  } catch {
    return _manifestCache ?? [];
  }
}

export default function PageHelpDrawer({ open, onClose, slugOverride }: PageHelpDrawerProps) {
  const location = useLocation();
  const [entries, setEntries] = useState<HelpManifestEntry[]>(_manifestCache ?? []);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh manifest each time the drawer opens (cheap & keeps content current).
  useEffect(() => {
    if (!open) return;
    void loadManifest().then(setEntries);
  }, [open]);

  const resolvedEntry = useMemo(() => {
    if (slugOverride) {
      return entries.find((e) => e.id === slugOverride) ?? null;
    }
    return resolveEntryForPath(entries, location.pathname, location.search);
  }, [entries, slugOverride, location.pathname, location.search]);

  const slug = slugOverride || resolvedEntry?.id || null;

  useEffect(() => {
    if (!open) return;
    if (!slug) {
      setContent("");
      setError("No documentation registered for this page yet — an admin can author it at /agentic-ai/admin/documentation.");
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/api/help/${encodeURIComponent(slug)}`, { credentials: "include" })
      .then(async (res) => {
        if (res.status === 404) {
          setContent("");
          setError(`No help content available (slug: ${slug}).`);
          return;
        }
        if (!res.ok) {
          throw new Error(`Failed to load help (HTTP ${res.status}).`);
        }
        const data = (await res.json()) as { content: string };
        setContent(data.content);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, slug]);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "92vw", sm: 480 } } }}
    >
      <Stack sx={{ height: "100%" }}>
        <Stack
          direction="row"
          alignItems="center"
          sx={{ p: 1, borderBottom: "1px solid var(--divider, #cdd8e4)" }}
        >
          <Typography
            sx={{
              fontFamily: '"Montserrat", sans-serif',
              fontWeight: 700,
              fontSize: 13,
              color: "var(--text-primary)",
              flex: 1,
            }}
          >
            {resolvedEntry?.title ?? "Help"}
          </Typography>
          <IconButton size="small" onClick={onClose} aria-label="Close help drawer">
            <CloseOutlinedIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Box sx={{ p: 2, overflowY: "auto", flex: 1 }}>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : error ? (
            <Typography sx={{ fontSize: 12, color: "var(--text-subtle)" }}>{error}</Typography>
          ) : (
            <MarkdownView content={content} density="compact" />
          )}
        </Box>
      </Stack>
    </Drawer>
  );
}
