import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import { Box, Button, IconButton, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";

export interface KeyValuePairEditorProps {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  inputLabel?: string;
  outputLabel?: string;
}

/**
 * Repeatable card editor for key-value mappings.
 * Each card shows `input_name` -> `mapped_name` with two TextFields and an arrow.
 */
export default function KeyValuePairEditor({
  value,
  onChange,
  inputLabel = "Input",
  outputLabel = "Mapped To",
}: KeyValuePairEditorProps) {
  const entries = Object.entries(value);

  const handleAdd = () => {
    onChange({ ...value, "": "" });
  };

  const handleRemove = (keyToRemove: string) => {
    const next = { ...value };
    delete next[keyToRemove];
    onChange(next);
  };

  const handleKeyChange = (oldKey: string, newKey: string, index: number) => {
    // Rebuild to preserve order
    const next: Record<string, string> = {};
    entries.forEach(([k, v], i) => {
      next[i === index ? newKey : k] = v;
    });
    onChange(next);
  };

  const handleValueChange = (key: string, newValue: string) => {
    onChange({ ...value, [key]: newValue });
  };

  return (
    <Stack spacing={1}>
      {entries.map(([key, val], index) => (
        <Paper
          key={`${index}-${key}`}
          variant="outlined"
          sx={{ px: 1.5, py: 1 }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              label={inputLabel}
              value={key}
              onChange={(e) => handleKeyChange(key, e.target.value, index)}
              size="small"
              sx={{ flex: 1 }}
            />
            <ArrowForwardIcon fontSize="small" color="action" />
            <TextField
              label={outputLabel}
              value={val}
              onChange={(e) => handleValueChange(key, e.target.value)}
              size="small"
              sx={{ flex: 1 }}
            />
            <Tooltip title="Remove">
              <IconButton size="small" color="error" onClick={() => handleRemove(key)}>
                <DeleteOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Paper>
      ))}
      {entries.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
          No mappings defined.
        </Typography>
      )}
      <Box>
        <Button
          startIcon={<AddOutlinedIcon />}
          variant="outlined"
          size="small"
          onClick={handleAdd}
        >
          Add Mapping
        </Button>
      </Box>
    </Stack>
  );
}
