import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import { Box, Button, IconButton, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";

const MONO_FONT = '"IBM Plex Mono", "Fira Code", monospace';

export interface MetricFormulaEditorProps {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

/**
 * Repeatable card editor for metric formulas.
 * Each card has a `name` (TextField) and `formula` (monospace TextField).
 */
export default function MetricFormulaEditor({
  value,
  onChange,
}: MetricFormulaEditorProps) {
  const entries = Object.entries(value);

  const handleAdd = () => {
    const key = `metric_${entries.length + 1}`;
    onChange({ ...value, [key]: "" });
  };

  const handleRemove = (keyToRemove: string) => {
    const next = { ...value };
    delete next[keyToRemove];
    onChange(next);
  };

  const handleRename = (oldKey: string, newKey: string) => {
    if (newKey === oldKey) return;
    // Preserve insertion order by rebuilding the object
    const next: Record<string, string> = {};
    for (const [k, v] of entries) {
      next[k === oldKey ? newKey : k] = v;
    }
    onChange(next);
  };

  const handleFormulaChange = (key: string, formula: string) => {
    onChange({ ...value, [key]: formula });
  };

  return (
    <Stack spacing={1.5}>
      {entries.map(([key, formula]) => (
        <Paper
          key={key}
          variant="outlined"
          sx={{ p: 1.5, position: "relative" }}
        >
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                Metric
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Tooltip title="Remove formula">
                <IconButton size="small" color="error" onClick={() => handleRemove(key)}>
                  <DeleteOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <TextField
              label="Name"
              value={key}
              onChange={(e) => handleRename(key, e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="Formula"
              value={formula}
              onChange={(e) => handleFormulaChange(key, e.target.value)}
              size="small"
              fullWidth
              multiline
              minRows={2}
              slotProps={{
                input: {
                  sx: {
                    fontFamily: MONO_FONT,
                    fontSize: 13,
                    "& textarea": {
                      fontFamily: MONO_FONT,
                      fontSize: 13,
                    },
                  },
                },
              }}
            />
          </Stack>
        </Paper>
      ))}
      <Button
        startIcon={<AddOutlinedIcon />}
        variant="outlined"
        size="small"
        onClick={handleAdd}
        sx={{ alignSelf: "flex-start" }}
      >
        Add Formula
      </Button>
    </Stack>
  );
}
