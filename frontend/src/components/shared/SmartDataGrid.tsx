import ArrowDownwardOutlinedIcon from "@mui/icons-material/ArrowDownwardOutlined";
import ArrowUpwardOutlinedIcon from "@mui/icons-material/ArrowUpwardOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  DataGrid,
  GridToolbarContainer,
  GridToolbarFilterButton,
  gridFilteredSortedRowIdsSelector,
  gridVisibleColumnFieldsSelector,
  useGridApiContext,
  useGridSelector,
  type DataGridProps,
} from "@mui/x-data-grid";
import { useMemo, useState } from "react";
import { utils, writeFile } from "xlsx";

type SmartToolbarSlotProps = {
  exportFileName?: string;
};

function SmartToolbar({ exportFileName = "grid-data" }: SmartToolbarSlotProps) {
  const apiRef = useGridApiContext();
  const rowIds = useGridSelector(apiRef, gridFilteredSortedRowIdsSelector);
  const visibleFields = useGridSelector(apiRef, gridVisibleColumnFieldsSelector);
  const [columnsDialogOpen, setColumnsDialogOpen] = useState(false);
  const [columnsVersion, setColumnsVersion] = useState(0);

  const customizableColumns = useMemo(
    () => apiRef.current.getAllColumns().filter((column) => !column.field.startsWith("__")),
    [apiRef, columnsVersion, columnsDialogOpen],
  );
  const visibleColumns = useMemo(
    () => new Set(apiRef.current.getVisibleColumns().map((column) => column.field)),
    [apiRef, columnsVersion, columnsDialogOpen],
  );

  const refreshColumns = () => setColumnsVersion((prev) => prev + 1);

  const downloadExcel = () => {
    const rows = rowIds.map((id) => apiRef.current.getRow(id) as Record<string, unknown>);
    const data = rows.map((row) => {
      const next: Record<string, unknown> = {};
      visibleFields.forEach((field) => {
        next[field] = row?.[field] ?? "";
      });
      return next;
    });
    const sheet = utils.json_to_sheet(data);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, sheet, "Data");
    writeFile(workbook, `${exportFileName}.xlsx`);
  };

  const toggleColumnVisibility = (field: string, nextVisible: boolean) => {
    apiRef.current.setColumnVisibility(field, nextVisible);
    refreshColumns();
  };

  const moveColumn = (field: string, direction: -1 | 1) => {
    const currentIndex = customizableColumns.findIndex((column) => column.field === field);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= customizableColumns.length) return;
    const targetField = customizableColumns[nextIndex].field;
    const targetIndexInAllColumns = apiRef.current.getColumnIndex(targetField, false);
    const reorderApi = apiRef.current as unknown as { setColumnIndex?: (columnField: string, index: number) => void };
    if (!reorderApi.setColumnIndex) return;
    reorderApi.setColumnIndex(field, targetIndexInAllColumns);
    refreshColumns();
  };

  return (
    <GridToolbarContainer sx={{ display: "flex", alignItems: "center", px: 0.5, py: 0.25 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Tooltip title="Customize Columns">
          <Button
            size="small"
            variant="outlined"
            startIcon={<TuneOutlinedIcon fontSize="small" />}
            onClick={() => {
              refreshColumns();
              setColumnsDialogOpen(true);
            }}
          >
            Columns
          </Button>
        </Tooltip>
        <Tooltip title="Complex Filter">
          <Box>
            <GridToolbarFilterButton />
          </Box>
        </Tooltip>
        <Tooltip title="Download Excel">
          <IconButton color="primary" onClick={downloadExcel} aria-label="Download Excel">
            <DownloadOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Dialog open={columnsDialogOpen} onClose={() => setColumnsDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Customize Columns</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            {customizableColumns.map((column, index) => {
              const isVisible = visibleColumns.has(column.field);
              const label = column.headerName || column.field;
              return (
                <Box
                  key={column.field}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    backgroundColor: "background.paper",
                    borderRadius: "6px",
                    px: 1,
                    py: 0.5,
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Checkbox
                      size="small"
                      checked={isVisible}
                      disabled={column.hideable === false}
                      onChange={(event) => toggleColumnVisibility(column.field, event.target.checked)}
                    />
                    <Typography variant="body2">{label}</Typography>
                  </Box>
                  <Stack direction="row" spacing={0.5}>
                    <IconButton size="small" disabled={index === 0} onClick={() => moveColumn(column.field, -1)}>
                      <ArrowUpwardOutlinedIcon fontSize="inherit" />
                    </IconButton>
                    <IconButton size="small" disabled={index === customizableColumns.length - 1} onClick={() => moveColumn(column.field, 1)}>
                      <ArrowDownwardOutlinedIcon fontSize="inherit" />
                    </IconButton>
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setColumnsDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </GridToolbarContainer>
  );
}

export type SmartDataGridProps = DataGridProps & {
  exportFileName?: string;
};

export default function SmartDataGrid({
  slots,
  slotProps,
  exportFileName,
  showToolbar,
  ...rest
}: SmartDataGridProps) {
  const ToolbarComponent = slots?.toolbar
    ? slots.toolbar
    : function ToolbarComponentInjected() {
      return <SmartToolbar exportFileName={exportFileName} />;
    };

  return (
    <DataGrid
      {...rest}
      showToolbar={showToolbar ?? true}
      slots={{ ...slots, toolbar: ToolbarComponent }}
      slotProps={slotProps}
    />
  );
}
