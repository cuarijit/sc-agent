import RestoreOutlinedIcon from "@mui/icons-material/RestoreOutlined";
import {
  Box,
  Chip,
  FormControlLabel,
  IconButton,
  Slider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import TagInput from "./TagInput";

export type BehaviorFieldType =
  | "text"
  | "number"
  | "slider"
  | "toggle"
  | "tags"
  | "textarea";

export interface BehaviorOverrideFieldProps {
  label: string;
  templateValue: unknown;
  overrideValue: unknown;
  fieldType: BehaviorFieldType;
  onChange: (value: unknown) => void;
  onReset: () => void;
  /** Slider config — only used when fieldType is "slider" */
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
}

/**
 * Single behavior field with override toggle.
 * Shows the template default as dimmed text, with a switch to enable editing.
 * When overridden, the field is editable and highlighted.
 */
export default function BehaviorOverrideField({
  label,
  templateValue,
  overrideValue,
  fieldType,
  onChange,
  onReset,
  sliderMin = 0,
  sliderMax = 1,
  sliderStep = 0.05,
}: BehaviorOverrideFieldProps) {
  const isOverridden = overrideValue !== undefined && overrideValue !== null;

  const displayTemplate = () => {
    if (templateValue === undefined || templateValue === null) return "Not set";
    if (Array.isArray(templateValue)) return templateValue.join(", ");
    if (typeof templateValue === "boolean") return templateValue ? "Enabled" : "Disabled";
    return String(templateValue);
  };

  const handleToggle = () => {
    if (isOverridden) {
      onReset();
    } else {
      // Initialize override with template value
      onChange(templateValue ?? getDefaultForType());
    }
  };

  const getDefaultForType = () => {
    switch (fieldType) {
      case "text":
      case "textarea":
        return "";
      case "number":
      case "slider":
        return 0;
      case "toggle":
        return false;
      case "tags":
        return [];
      default:
        return "";
    }
  };

  const renderEditor = () => {
    const val = overrideValue;

    switch (fieldType) {
      case "text":
        return (
          <TextField
            value={(val as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            size="small"
            fullWidth
          />
        );

      case "textarea":
        return (
          <TextField
            value={(val as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={2}
            maxRows={6}
          />
        );

      case "number":
        return (
          <TextField
            type="number"
            value={val ?? ""}
            onChange={(e) => {
              const n = e.target.value === "" ? "" : Number(e.target.value);
              onChange(n);
            }}
            size="small"
            sx={{ width: 160 }}
          />
        );

      case "slider":
        return (
          <Stack direction="row" spacing={2} alignItems="center" sx={{ flex: 1 }}>
            <Slider
              value={(val as number) ?? sliderMin}
              onChange={(_e, v) => onChange(v as number)}
              min={sliderMin}
              max={sliderMax}
              step={sliderStep}
              valueLabelDisplay="auto"
              sx={{ flex: 1 }}
            />
            <TextField
              type="number"
              size="small"
              value={val ?? ""}
              onChange={(e) => {
                const parsed = parseFloat(e.target.value);
                if (!isNaN(parsed)) onChange(parsed);
              }}
              slotProps={{
                htmlInput: { min: sliderMin, max: sliderMax, step: sliderStep },
              }}
              sx={{ width: 90 }}
            />
          </Stack>
        );

      case "toggle":
        return (
          <FormControlLabel
            control={
              <Switch
                checked={Boolean(val)}
                onChange={(e) => onChange(e.target.checked)}
                size="small"
              />
            }
            label={Boolean(val) ? "Enabled" : "Disabled"}
          />
        );

      case "tags":
        return (
          <TagInput
            label=""
            value={Array.isArray(val) ? (val as string[]) : []}
            onChange={(v) => onChange(v)}
          />
        );

      default:
        return (
          <TextField
            value={String(val ?? "")}
            onChange={(e) => onChange(e.target.value)}
            size="small"
            fullWidth
          />
        );
    }
  };

  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 1,
        border: "1px solid",
        borderColor: isOverridden ? "primary.main" : "divider",
        bgcolor: isOverridden ? "primary.50" : "transparent",
        transition: "all 0.2s",
      }}
    >
      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
            {label}
          </Typography>
          {isOverridden && (
            <Chip label="Overridden" size="small" color="primary" variant="outlined" />
          )}
          <Tooltip title={isOverridden ? "Reset to template default" : "Override this value"}>
            <IconButton size="small" onClick={isOverridden ? onReset : handleToggle}>
              {isOverridden ? (
                <RestoreOutlinedIcon fontSize="small" />
              ) : null}
            </IconButton>
          </Tooltip>
          <FormControlLabel
            control={
              <Switch
                checked={isOverridden}
                onChange={handleToggle}
                size="small"
              />
            }
            label={
              <Typography variant="caption" color="text.secondary">
                Override
              </Typography>
            }
            sx={{ mr: 0 }}
          />
        </Stack>

        {/* Template default */}
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            opacity: isOverridden ? 0.5 : 0.8,
            fontStyle: "italic",
          }}
        >
          Template default: {displayTemplate()}
        </Typography>

        {/* Editable field when overridden */}
        {isOverridden && renderEditor()}
      </Stack>
    </Box>
  );
}
