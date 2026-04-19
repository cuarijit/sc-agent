import { Box, Slider, Stack, TextField, Typography } from "@mui/material";

export interface SliderWithLabelProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min: number;
  max: number;
  step: number;
  helperText?: string;
}

/**
 * MUI Slider with adjacent numeric display/edit field.
 * Label above, slider + number input side by side.
 */
export default function SliderWithLabel({
  value,
  onChange,
  label,
  min,
  max,
  step,
  helperText,
}: SliderWithLabelProps) {
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={2} alignItems="center">
        <Slider
          value={value}
          onChange={(_e, v) => onChange(v as number)}
          min={min}
          max={max}
          step={step}
          valueLabelDisplay="auto"
          sx={{ flex: 1 }}
        />
        <TextField
          type="number"
          size="small"
          value={value}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            if (!isNaN(parsed) && parsed >= min && parsed <= max) {
              onChange(parsed);
            }
          }}
          slotProps={{
            htmlInput: { min, max, step },
            input: { sx: { width: 80, textAlign: "center" } },
          }}
          sx={{ width: 100 }}
        />
      </Stack>
      {helperText && (
        <Typography variant="caption" color="text.secondary">
          {helperText}
        </Typography>
      )}
    </Box>
  );
}
