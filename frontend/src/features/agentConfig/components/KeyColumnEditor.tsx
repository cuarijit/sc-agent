import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import { Box, Button, IconButton, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";

import TagInput from "./TagInput";

export interface KeyColumn {
  column_name: string;
  match_patterns: string[];
  default_value: string;
}

export interface KeyColumnEditorProps {
  value: KeyColumn[];
  onChange: (value: KeyColumn[]) => void;
}

/**
 * Card-based editor for key_columns arrays.
 * Each card has a column name, match patterns (as chips), default value, and a delete button.
 */
export default function KeyColumnEditor({ value, onChange }: KeyColumnEditorProps) {
  const handleAdd = () => {
    onChange([...value, { column_name: "", match_patterns: [], default_value: "_ALL_" }]);
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleUpdate = (index: number, patch: Partial<KeyColumn>) => {
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  return (
    <Stack spacing={1.5}>
      {value.map((col, index) => (
        <Paper
          key={index}
          variant="outlined"
          sx={{ p: 1.5, position: "relative" }}
        >
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                Column {index + 1}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Tooltip title="Remove column">
                <IconButton size="small" color="error" onClick={() => handleRemove(index)}>
                  <DeleteOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <TextField
              label="Column Name"
              value={col.column_name}
              onChange={(e) => handleUpdate(index, { column_name: e.target.value })}
              size="small"
              fullWidth
            />
            <TagInput
              label="Match Patterns"
              value={col.match_patterns}
              onChange={(patterns) => handleUpdate(index, { match_patterns: patterns })}
              helperText="Glob patterns for matching (e.g. product*, material*)"
            />
            <TextField
              label="Default Value"
              value={col.default_value}
              onChange={(e) => handleUpdate(index, { default_value: e.target.value })}
              size="small"
              fullWidth
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
        Add Column
      </Button>
    </Stack>
  );
}
