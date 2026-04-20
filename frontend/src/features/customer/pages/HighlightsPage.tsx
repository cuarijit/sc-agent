/**
 * Customer Highlights — renders the markdown body uploaded against the
 * "customer-highlights" help entry. Falls back to an empty-state CTA
 * when no content is available.
 */
import { useEffect, useState } from "react";
import { Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { Link } from "react-router-dom";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";

import MarkdownView from "../../../components/help/MarkdownView";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (typeof window !== "undefined" && window.location.protocol === "file:"
    ? "http://127.0.0.1:8000"
    : "");

const ENTRY_ID = "customer-highlights";

function CustomerMarkdownPage({ entryId, emptyTitle }: { entryId: string; emptyTitle: string }) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/api/help/${encodeURIComponent(entryId)}`, { credentials: "include" })
      .then(async (res) => {
        if (res.status === 404) {
          setContent("");
          return;
        }
        if (!res.ok) throw new Error(`Failed to load content (HTTP ${res.status}).`);
        const data = (await res.json()) as { content: string };
        setContent(data.content);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [entryId]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (error) {
    return <Typography sx={{ color: "error.main", fontSize: 13 }}>{error}</Typography>;
  }
  if (!content.trim()) {
    return (
      <Stack spacing={2} sx={{ py: 4, alignItems: "flex-start" }}>
        <MenuBookOutlinedIcon sx={{ fontSize: 36, color: "text.disabled" }} />
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{emptyTitle}</Typography>
        <Typography sx={{ fontSize: 12, color: "text.secondary", maxWidth: 540 }}>
          No content uploaded yet. An admin can upload a Markdown file from{" "}
          <strong>Administration → Documentation Management</strong> against the entry id{" "}
          <code>{entryId}</code>. Once saved, this page picks up the new content automatically.
        </Typography>
        <Button
          component={Link}
          to="/agentic-ai/admin/documentation"
          variant="contained"
          size="small"
          startIcon={<MenuBookOutlinedIcon />}
        >
          Open Documentation Management
        </Button>
      </Stack>
    );
  }
  return <MarkdownView content={content} density="comfortable" />;
}

export default function HighlightsPage() {
  return <CustomerMarkdownPage entryId={ENTRY_ID} emptyTitle="No highlights uploaded yet" />;
}
