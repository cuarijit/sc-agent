import { Chip, Stack, TextField } from "@mui/material";
import { useState, type KeyboardEvent } from "react";

export interface TagInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  label: string;
  helperText?: string;
  size?: "small" | "medium";
}

/**
 * Chip-based string array editor.
 * Each value is shown as a deletable Chip. New tags are added by typing
 * into the text field and pressing Enter or comma.
 */
export default function TagInput({
  value,
  onChange,
  label,
  helperText,
  size = "small",
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("");

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (tag && !value.includes(tag)) {
      onChange([...value, tag]);
    }
    setInputValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    }
    // Allow backspace to remove last tag when input is empty
    if (e.key === "Backspace" && inputValue === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const handleDelete = (tagToRemove: string) => {
    onChange(value.filter((t) => t !== tagToRemove));
  };

  return (
    <Stack spacing={0.5}>
      {value.length > 0 && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {value.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              size="small"
              onDelete={() => handleDelete(tag)}
              sx={{ maxWidth: 260 }}
            />
          ))}
        </Stack>
      )}
      <TextField
        label={label}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (inputValue.trim()) addTag(inputValue);
        }}
        size={size}
        fullWidth
        helperText={helperText ?? "Press Enter or comma to add"}
        slotProps={{
          htmlInput: { autoComplete: "off" },
        }}
      />
    </Stack>
  );
}
