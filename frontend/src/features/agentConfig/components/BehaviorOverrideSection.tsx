import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RestoreOutlinedIcon from "@mui/icons-material/RestoreOutlined";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";

import BehaviorOverrideField, { type BehaviorFieldType } from "./BehaviorOverrideField";

export interface BehaviorFieldDefinition {
  key: string;
  label: string;
  fieldType: BehaviorFieldType;
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
}

export interface BehaviorOverrideSectionProps {
  title: string;
  icon?: SvgIconComponent;
  fields: BehaviorFieldDefinition[];
  templateBehavior: Record<string, unknown>;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

/**
 * Accordion wrapping multiple BehaviorOverrideField items.
 * Header shows category name + override count badge.
 * Footer has a "Reset All" button.
 */
export default function BehaviorOverrideSection({
  title,
  icon: IconComp,
  fields,
  templateBehavior,
  overrides,
  onChange,
}: BehaviorOverrideSectionProps) {
  const overrideCount = fields.filter(
    (f) => overrides[f.key] !== undefined && overrides[f.key] !== null,
  ).length;

  const handleFieldChange = (key: string, value: unknown) => {
    onChange({ ...overrides, [key]: value });
  };

  const handleFieldReset = (key: string) => {
    const next = { ...overrides };
    delete next[key];
    onChange(next);
  };

  const handleResetAll = () => {
    onChange({});
  };

  return (
    <Accordion
      variant="outlined"
      disableGutters
      sx={{
        "&:before": { display: "none" },
        borderRadius: 1,
        overflow: "hidden",
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
          {IconComp && <IconComp fontSize="small" color="action" />}
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {overrideCount > 0 && (
            <Chip
              label={`${overrideCount} override${overrideCount > 1 ? "s" : ""}`}
              size="small"
              color="primary"
              variant="outlined"
            />
          )}
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          {fields.map((field) => (
            <BehaviorOverrideField
              key={field.key}
              label={field.label}
              templateValue={templateBehavior[field.key]}
              overrideValue={overrides[field.key]}
              fieldType={field.fieldType}
              onChange={(v) => handleFieldChange(field.key, v)}
              onReset={() => handleFieldReset(field.key)}
              sliderMin={field.sliderMin}
              sliderMax={field.sliderMax}
              sliderStep={field.sliderStep}
            />
          ))}

          {overrideCount > 0 && (
            <Box sx={{ pt: 1, display: "flex", justifyContent: "flex-end" }}>
              <Button
                startIcon={<RestoreOutlinedIcon />}
                size="small"
                color="warning"
                onClick={handleResetAll}
              >
                Reset All to Template Defaults
              </Button>
            </Box>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
