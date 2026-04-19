import { Box, Button, Chip, IconButton, Stack, Tooltip } from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { resolveIcon } from "../../../app/navigation/iconRegistry";
import type { AgentInstance, AgentTemplate, AgentTypeDefinition } from "../../../services/agentConfigApi";

interface AgentInstanceListEditorProps {
  instances: AgentInstance[];
  agentTypes: AgentTypeDefinition[];
  templates: AgentTemplate[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (instance: AgentInstance) => void;
  onDelete: (instanceId: string) => void;
  onRefresh: () => void;
}

const SYNC_STATUS_COLOR: Record<string, "success" | "warning" | "default"> = {
  synced: "success",
  outdated: "warning",
  unknown: "default",
};

export default function AgentInstanceListEditor({
  instances,
  agentTypes,
  templates,
  loading,
  onAdd,
  onEdit,
  onDelete,
  onRefresh,
}: AgentInstanceListEditorProps) {
  const typeMap = new Map(agentTypes.map((t) => [t.type_key, t.display_name]));
  const templateMap = new Map(templates.map((t) => [t.type_key, t]));

  const columns: GridColDef[] = [
    { field: "instance_id", headerName: "Instance ID", flex: 1 },
    { field: "display_name", headerName: "Display Name", flex: 1.2 },
    {
      field: "agent_type",
      headerName: "Agent Type",
      width: 160,
      renderCell: (params) => (
        <Chip label={typeMap.get(params.value) ?? params.value} size="small" variant="outlined" />
      ),
    },
    {
      field: "handler_hint_display",
      headerName: "Handler",
      width: 120,
      valueGetter: (_value, row) => {
        const tpl = templateMap.get((row as AgentInstance).agent_type);
        return tpl?.handler_hint ?? "chat_only";
      },
      renderCell: (params) => (
        <Chip label={params.value} size="small" variant="outlined" sx={{ fontSize: 11 }} />
      ),
    },
    { field: "module_slug", headerName: "Module", width: 140 },
    {
      field: "icon",
      headerName: "Icon",
      width: 60,
      renderCell: (params) => {
        if (!params.value) return null;
        const Icon = resolveIcon(params.value);
        return <Icon fontSize="small" />;
      },
    },
    { field: "button_text", headerName: "Button Text", width: 130 },
    {
      field: "template_sync_status",
      headerName: "Sync",
      width: 90,
      renderCell: (params) => {
        const status = (params.value as string) || "unknown";
        return (
          <Chip
            label={status}
            size="small"
            color={SYNC_STATUS_COLOR[status] ?? "default"}
          />
        );
      },
    },
    {
      field: "is_active",
      headerName: "Active",
      width: 80,
      renderCell: (params) => (
        <Chip
          label={params.value ? "Yes" : "No"}
          size="small"
          color={params.value ? "success" : "default"}
        />
      ),
    },
    {
      field: "actions",
      headerName: "",
      width: 80,
      sortable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => onEdit(params.row as AgentInstance)}>
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton
              size="small"
              color="error"
              onClick={() => onDelete((params.row as AgentInstance).instance_id)}
            >
              <DeleteOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          startIcon={<AddOutlinedIcon />}
          variant="contained"
          size="small"
          onClick={onAdd}
        >
          Add Agent Instance
        </Button>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={onRefresh}>
            <RefreshOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ height: 480 }}>
        <DataGrid
          rows={instances}
          columns={columns}
          getRowId={(row: AgentInstance) => row.instance_id}
          loading={loading}
          density="compact"
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25]}
          initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
        />
      </Box>
    </Stack>
  );
}
