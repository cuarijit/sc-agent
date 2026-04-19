import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useMemo, useState } from "react";

const MONO_FONT = '"IBM Plex Mono", "Fira Code", monospace';

/** Regex to match template variables like {today}, {view_list}, {schema_context} */
const TEMPLATE_VAR_RE = /\{(\w+)\}/g;

export interface PromptPreviewDialogProps {
  open: boolean;
  onClose: () => void;
  promptText: string;
}

/**
 * Read-only dialog showing the assembled prompt.
 * Template variables are highlighted in the monospace text.
 * Includes a Copy to Clipboard button.
 */
export default function PromptPreviewDialog({
  open,
  onClose,
  promptText,
}: PromptPreviewDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(promptText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [promptText]);

  /** Render text with template variables highlighted */
  const rendered = useMemo(() => {
    if (!promptText) return null;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const regex = new RegExp(TEMPLATE_VAR_RE);
    let key = 0;
    while ((match = regex.exec(promptText)) !== null) {
      if (match.index > lastIndex) {
        parts.push(promptText.slice(lastIndex, match.index));
      }
      parts.push(
        <Box
          key={key++}
          component="span"
          sx={{
            bgcolor: "primary.main",
            color: "primary.contrastText",
            borderRadius: 0.5,
            px: 0.5,
            fontWeight: 600,
          }}
        >
          {match[0]}
        </Box>,
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < promptText.length) {
      parts.push(promptText.slice(lastIndex));
    }
    return parts;
  }, [promptText]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        Assembled Prompt Preview
        <Box sx={{ flex: 1 }} />
        <Tooltip title={copied ? "Copied!" : "Copy to clipboard"}>
          <IconButton size="small" onClick={handleCopy}>
            <ContentCopyOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent dividers>
        {promptText ? (
          <Typography
            component="pre"
            sx={{
              fontFamily: MONO_FONT,
              fontSize: 12.5,
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              m: 0,
              p: 1.5,
              bgcolor: "action.hover",
              borderRadius: 1,
              border: "1px solid",
              borderColor: "divider",
              maxHeight: "70vh",
              overflow: "auto",
            }}
          >
            {rendered}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
            No prompt text to preview.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
