import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import {
  Box,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

import TagInput from "./TagInput";
import KeyColumnEditor, { type KeyColumn } from "./KeyColumnEditor";

interface SchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  "x-field"?: string;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
}

interface ConfigSchema {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

interface UiSection {
  title: string;
  fields: string[];
}

interface UiHints {
  sections?: UiSection[];
}

export interface TypeSpecificConfigEditorProps {
  schema: Record<string, unknown>;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  uiHints?: UiHints | Record<string, unknown>;
}

/**
 * Recursive JSON Schema form renderer.
 * Dispatches on property type + x-field to render the appropriate editor widget.
 */
export default function TypeSpecificConfigEditor({
  schema: rawSchema,
  value,
  onChange,
  uiHints: rawUiHints,
}: TypeSpecificConfigEditorProps) {
  // Cast the broad Record<string, unknown> types to our internal types
  const schema = rawSchema as ConfigSchema;
  const uiHints = rawUiHints as UiHints | undefined;
  const properties = schema.properties ?? {};
  const propertyKeys = Object.keys(properties);

  if (propertyKeys.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
        No configurable fields for this agent type.
      </Typography>
    );
  }

  const handleFieldChange = (key: string, fieldValue: unknown) => {
    onChange({ ...value, [key]: fieldValue });
  };

  // Group fields into sections if ui_hints.sections is provided
  const sections = uiHints?.sections;
  if (sections && sections.length > 0) {
    // Collect fields that appear in sections
    const sectionedFields = new Set(sections.flatMap((s) => s.fields));
    // Any field NOT in a section goes into an "Other" section
    const unsectioned = propertyKeys.filter((k) => !sectionedFields.has(k));

    return (
      <Stack spacing={2}>
        {sections.map((section, idx) => (
          <Box key={section.title}>
            {idx > 0 && <Divider sx={{ mb: 1.5 }} />}
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              {section.title}
            </Typography>
            <Stack spacing={1.5}>
              {section.fields
                .filter((f) => f in properties)
                .map((fieldKey) => (
                  <FieldRenderer
                    key={fieldKey}
                    fieldKey={fieldKey}
                    schema={properties[fieldKey]}
                    value={value[fieldKey]}
                    onChange={(v) => handleFieldChange(fieldKey, v)}
                  />
                ))}
            </Stack>
          </Box>
        ))}
        {unsectioned.length > 0 && (
          <Box>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              Other
            </Typography>
            <Stack spacing={1.5}>
              {unsectioned.map((fieldKey) => (
                <FieldRenderer
                  key={fieldKey}
                  fieldKey={fieldKey}
                  schema={properties[fieldKey]}
                  value={value[fieldKey]}
                  onChange={(v) => handleFieldChange(fieldKey, v)}
                />
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
    );
  }

  // No sections — render all fields flat
  return (
    <Stack spacing={1.5}>
      {propertyKeys.map((fieldKey) => (
        <FieldRenderer
          key={fieldKey}
          fieldKey={fieldKey}
          schema={properties[fieldKey]}
          value={value[fieldKey]}
          onChange={(v) => handleFieldChange(fieldKey, v)}
        />
      ))}
    </Stack>
  );
}

// ── Individual field renderer ────────────────────────────────────────────

interface FieldRendererProps {
  fieldKey: string;
  schema: SchemaProperty;
  value: unknown;
  onChange: (value: unknown) => void;
}

function FieldRenderer({ fieldKey, schema, value, onChange }: FieldRendererProps) {
  const label = schema.title ?? fieldKey;
  const helperText = schema.description;
  const xField = schema["x-field"];
  const fieldType = schema.type ?? "string";

  // ── Boolean ───────────────────────────────────────────────────────────
  if (fieldType === "boolean") {
    return (
      <FormControlLabel
        control={
          <Switch
            checked={Boolean(value ?? schema.default ?? false)}
            onChange={(e) => onChange(e.target.checked)}
            size="small"
          />
        }
        label={
          <Stack>
            <Typography variant="body2">{label}</Typography>
            {helperText && (
              <Typography variant="caption" color="text.secondary">{helperText}</Typography>
            )}
          </Stack>
        }
      />
    );
  }

  // ── Number ────────────────────────────────────────────────────────────
  if (fieldType === "number" || fieldType === "integer") {
    return (
      <TextField
        label={label}
        type="number"
        value={value ?? schema.default ?? ""}
        onChange={(e) => {
          const num = e.target.value === "" ? "" : Number(e.target.value);
          onChange(num);
        }}
        size="small"
        fullWidth
        helperText={helperText}
      />
    );
  }

  // ── Array ─────────────────────────────────────────────────────────────
  if (fieldType === "array") {
    const items = schema.items;

    // Array of strings → TagInput
    if (!items || items.type === "string") {
      const arrValue = Array.isArray(value) ? (value as string[]) : [];
      return (
        <TagInput
          label={label}
          value={arrValue}
          onChange={onChange}
          helperText={helperText}
        />
      );
    }

    // Array of objects with x-field="key_column_editor" → KeyColumnEditor
    if (items.type === "object" && xField === "key_column_editor") {
      const arrValue = Array.isArray(value) ? (value as KeyColumn[]) : [];
      return (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{label}</Typography>
          {helperText && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              {helperText}
            </Typography>
          )}
          <KeyColumnEditor value={arrValue} onChange={onChange} />
        </Box>
      );
    }

    // Array of objects (generic) — fallback to JSON textarea
    if (items.type === "object") {
      const jsonStr = typeof value === "string" ? value : JSON.stringify(value ?? [], null, 2);
      return (
        <TextField
          label={label}
          value={jsonStr}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value));
            } catch {
              // Keep raw string until it becomes valid JSON
              onChange(e.target.value);
            }
          }}
          size="small"
          fullWidth
          multiline
          rows={4}
          helperText={helperText ?? "JSON array of objects"}
        />
      );
    }
  }

  // ── Nested object → recursive ─────────────────────────────────────────
  if (fieldType === "object" && schema.properties) {
    const objValue = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
    return (
      <Box sx={{ pl: 2, borderLeft: "2px solid", borderColor: "divider" }}>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{label}</Typography>
        {helperText && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            {helperText}
          </Typography>
        )}
        <TypeSpecificConfigEditor
          schema={{ type: "object", properties: schema.properties }}
          value={objValue}
          onChange={(v) => onChange(v)}
        />
      </Box>
    );
  }

  // ── Unknown x-field → TextField with warning ──────────────────────────
  if (xField) {
    return (
      <TextField
        label={label}
        value={typeof value === "string" ? value : JSON.stringify(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        size="small"
        fullWidth
        helperText={
          <Stack direction="row" spacing={0.5} alignItems="center" component="span">
            <WarningAmberOutlinedIcon sx={{ fontSize: 14, color: "warning.main" }} />
            <span>Unknown field type: {xField}. Editing as text.</span>
          </Stack>
        }
      />
    );
  }

  // ── Default: string TextField ─────────────────────────────────────────
  return (
    <TextField
      label={label}
      value={(value as string) ?? schema.default ?? ""}
      onChange={(e) => onChange(e.target.value)}
      size="small"
      fullWidth
      helperText={helperText}
    />
  );
}
