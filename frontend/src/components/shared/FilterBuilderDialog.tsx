import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import ClearAllOutlinedIcon from "@mui/icons-material/ClearAllOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";

import type { FilterCondition, FilterFieldOption, FilterOperator, FilterState } from "../../filtering";
import { createFilterCondition, defaultOperatorForType, isConditionComplete, isMultiValueOperator, operatorOptionsForType, requiresSecondaryValue } from "../../filtering";

export default function FilterBuilderDialog({
  open,
  title,
  fields,
  initialState,
  onClose,
  onApply,
  onClear,
}: {
  open: boolean;
  title: string;
  fields: FilterFieldOption[];
  initialState: FilterState;
  onClose: () => void;
  onApply: (state: FilterState) => void;
  onClear: () => void;
}) {
  const [draftJoinMode, setDraftJoinMode] = useState<FilterState["joinMode"]>("and");
  const [draftConditions, setDraftConditions] = useState<FilterCondition[]>([]);
  const fieldsByKey = useMemo(() => new Map(fields.map((field) => [field.key, field])), [fields]);

  useEffect(() => {
    if (!open) return;
    const nextConditions = initialState.conditions.length
      ? initialState.conditions
      : fields[0]
        ? [createFilterCondition(fields[0].key, fields[0].type)]
        : [];
    setDraftJoinMode(initialState.joinMode);
    setDraftConditions(nextConditions);
  }, [fields, initialState, open]);

  const update = (id: string, updates: Partial<FilterCondition>) =>
    setDraftConditions((prev) => prev.map((condition) => (condition.id === id ? { ...condition, ...updates } : condition)));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <TextField select size="small" label="Combine filters with" value={draftJoinMode} onChange={(event) => setDraftJoinMode(event.target.value as FilterState["joinMode"])} sx={{ maxWidth: 220 }}>
            <MenuItem value="and">AND</MenuItem>
            <MenuItem value="or">OR</MenuItem>
          </TextField>
          {draftConditions.map((condition, index) => {
            const field = fieldsByKey.get(condition.column) ?? fields[0];
            if (!field) return null;
            const operators = field.operators ?? operatorOptionsForType(field.type).map((item) => item.value);
            const needsSecond = requiresSecondaryValue(condition.operator);
            return (
              <Paper key={condition.id} variant="outlined" sx={{ p: 1.2 }}>
                <Stack spacing={1}>
                  <Typography variant="caption" color="text.secondary">Condition {index + 1}</Typography>
                  <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems="flex-start">
                    <TextField select size="small" label="Column" value={condition.column} onChange={(event) => {
                      const nextField = fieldsByKey.get(event.target.value);
                      if (!nextField) return;
                      const nextOperator = defaultOperatorForType(nextField.type);
                      update(condition.id, { column: nextField.key, operator: nextOperator, value: "", secondaryValue: "", values: nextOperator === "in" ? [] : undefined });
                    }} sx={{ minWidth: 190 }}>
                      {fields.map((item) => <MenuItem key={item.key} value={item.key}>{item.label}</MenuItem>)}
                    </TextField>
                    <TextField select size="small" label="Operator" value={condition.operator} onChange={(event) => {
                      const nextOperator = event.target.value as FilterOperator;
                      update(condition.id, { operator: nextOperator, value: "", secondaryValue: "", values: isMultiValueOperator(nextOperator) ? [] : undefined });
                    }} sx={{ minWidth: 170 }}>
                      {operatorOptionsForType(field.type).filter((item) => operators.includes(item.value)).map((option) => (
                        <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                      ))}
                    </TextField>
                    {field.type === "text" && isMultiValueOperator(condition.operator) ? (
                      <Box sx={{ flex: 1, minWidth: 220 }}>
                        <Autocomplete
                          multiple
                          freeSolo
                          options={field.suggestions ?? []}
                          value={condition.values ?? []}
                          onChange={(_event, newValues) => update(condition.id, { values: newValues.map(String).filter(Boolean) })}
                          renderInput={(params) => <TextField {...params} size="small" label="Values" />}
                        />
                      </Box>
                    ) : (
                      <TextField
                        size="small"
                        label={field.type === "date" ? "Date" : "Value"}
                        type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                        value={condition.value}
                        onChange={(event) => update(condition.id, { value: event.target.value })}
                        sx={{ flex: 1, minWidth: 220 }}
                        InputLabelProps={field.type === "date" ? { shrink: true } : undefined}
                      />
                    )}
                    {needsSecond ? (
                      <TextField
                        size="small"
                        label={field.type === "date" ? "To Date" : "To"}
                        type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                        value={condition.secondaryValue}
                        onChange={(event) => update(condition.id, { secondaryValue: event.target.value })}
                        sx={{ minWidth: 160 }}
                        InputLabelProps={field.type === "date" ? { shrink: true } : undefined}
                      />
                    ) : null}
                    <Tooltip title="Remove condition">
                      <IconButton color="error" onClick={() => setDraftConditions((prev) => prev.filter((item) => item.id !== condition.id))}>
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
          <Button startIcon={<AddCircleOutlineIcon />} variant="outlined" onClick={() => fields[0] && setDraftConditions((prev) => [...prev, createFilterCondition(fields[0].key, fields[0].type)])}>
            Add filter
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button startIcon={<ClearAllOutlinedIcon />} onClick={() => { onClear(); onClose(); }}>Clear filters</Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => { onApply({ joinMode: draftJoinMode, conditions: draftConditions.filter(isConditionComplete) }); onClose(); }} disabled={!draftConditions.length || !draftConditions.every(isConditionComplete)}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
