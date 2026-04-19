import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import PublishOutlinedIcon from "@mui/icons-material/PublishOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import SyncOutlinedIcon from "@mui/icons-material/SyncOutlined";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
} from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useState } from "react";

import type { AgentTemplate } from "../../../services/agentConfigApi";

interface AgentTemplateListProps {
  templates: AgentTemplate[];
  loading: boolean;
  onEdit: (template: AgentTemplate) => void;
  onSync: (typeKey: string) => void;
  onPublish?: (typeKey: string) => void | Promise<void>;
  onRefresh: () => void;
}

const STATUS_COLOR_MAP: Record<string, "success" | "warning" | "default"> = {
  active: "success",
  draft: "warning",
  deprecated: "default",
};

export default function AgentTemplateList({
  templates,
  loading,
  onEdit,
  onSync,
  onPublish,
  onRefresh,
}: AgentTemplateListProps) {
  const [confirmSync, setConfirmSync] = useState<AgentTemplate | null>(null);

  const columns: GridColDef[] = [
    { field: "type_key", headerName: "Type Key", flex: 1 },
    { field: "display_name", headerName: "Display Name", flex: 1.2 },
    { field: "description", headerName: "Description", flex: 1.5 },
    {
      field: "status",
      headerName: "Status",
      width: 110,
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          color={STATUS_COLOR_MAP[params.value as string] ?? "default"}
        />
      ),
    },
    { field: "handler_hint", headerName: "Handler", width: 130 },
    {
      field: "template_version",
      headerName: "Version",
      width: 80,
      align: "center",
      headerAlign: "center",
    },
    {
      field: "actions",
      headerName: "",
      width: 120,
      sortable: false,
      renderCell: (params) => {
        const tpl = params.row as AgentTemplate;
        return (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Edit template defaults">
              <IconButton size="small" onClick={() => onEdit(tpl)}>
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {tpl.status === "draft" && onPublish ? (
              <Tooltip title="Promote draft to active">
                <IconButton
                  size="small"
                  color="success"
                  onClick={() => { void onPublish(tpl.type_key); }}
                >
                  <PublishOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title="Sync all instances">
              <IconButton
                size="small"
                onClick={() => setConfirmSync(tpl)}
                disabled={tpl.status === "draft"}
              >
                <SyncOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        );
      },
    },
  ];

  return (
    <>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Tooltip title="Reload templates from filesystem">
            <Button
              startIcon={<RefreshOutlinedIcon />}
              variant="outlined"
              size="small"
              onClick={onRefresh}
            >
              Reload Templates
            </Button>
          </Tooltip>
        </Stack>
        <Box sx={{ height: 480 }}>
          <DataGrid
            rows={templates}
            columns={columns}
            getRowId={(row: AgentTemplate) => row.type_key}
            loading={loading}
            density="compact"
            disableRowSelectionOnClick
            pageSizeOptions={[10, 25]}
            initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          />
        </Box>
      </Stack>

      {/* Sync confirmation dialog */}
      <Dialog open={confirmSync !== null} onClose={() => setConfirmSync(null)}>
        <DialogTitle>Sync Instances</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will update all instances of type "{confirmSync?.display_name}" to
            include any new default config fields from the template. Existing field
            values will not be overwritten.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmSync(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (confirmSync) onSync(confirmSync.type_key);
              setConfirmSync(null);
            }}
          >
            Sync
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
