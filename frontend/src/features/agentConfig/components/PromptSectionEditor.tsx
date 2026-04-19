import { Box, Stack, TextField, Typography } from "@mui/material";

const MONO_FONT = '"IBM Plex Mono", "Fira Code", monospace';

export interface PromptSectionEditorProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  helperText?: string;
  minRows?: number;
}

/**
 * Multi-line monospace text editor for prompt sections.
 * Styled as a code-editor-like panel with line count and tinted background.
 */
export default function PromptSectionEditor({
  value,
  onChange,
  label,
  helperText,
  minRows = 6,
}: PromptSectionEditorProps) {
  const lineCount = (value || "").split("\n").length;

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {lineCount} {lineCount === 1 ? "line" : "lines"}
        </Typography>
      </Stack>
      <Box
        sx={{
          borderRadius: 1,
          bgcolor: "action.hover",
          border: "1px solid",
          borderColor: "divider",
          overflow: "hidden",
        }}
      >
        <TextField
          value={value}
          onChange={(e) => onChange(e.target.value)}
          multiline
          minRows={minRows}
          maxRows={30}
          fullWidth
          variant="standard"
          slotProps={{
            input: {
              disableUnderline: true,
              sx: {
                fontFamily: MONO_FONT,
                fontSize: 13,
                lineHeight: 1.6,
                p: 1.5,
                "& textarea": {
                  fontFamily: MONO_FONT,
                  fontSize: 13,
                  lineHeight: 1.6,
                },
              },
            },
          }}
        />
      </Box>
      {helperText && (
        <Typography variant="caption" color="text.secondary">
          {helperText}
        </Typography>
      )}
    </Stack>
  );
}
