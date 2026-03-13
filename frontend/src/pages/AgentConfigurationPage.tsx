import OpenInNewOutlinedIcon from "@mui/icons-material/OpenInNewOutlined";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { type GridColDef } from "@mui/x-data-grid";
import { useCallback, useState } from "react";

import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import InventoryDiagnosticAgent from "./InventoryDiagnosticAgent";
import ParameterDiagnosticAgent from "./ParameterDiagnosticAgent";

export type AgentId = "inventory" | "parameter" | "order";

export interface AgentConfigRow {
  id: AgentId;
  name: string;
  automated: boolean;
  startDate: string;
  endDate: string;
}

const INITIAL_AGENTS: AgentConfigRow[] = [
  { id: "inventory", name: "Inventory Diagnostic Agent", automated: false, startDate: "", endDate: "" },
  { id: "parameter", name: "Parameter Diagnostic Agent", automated: false, startDate: "", endDate: "" },
  { id: "order", name: "Order Diagnostic Agent", automated: false, startDate: "", endDate: "" },
];

export default function AgentConfigurationPage() {
  const [agents, setAgents] = useState<AgentConfigRow[]>(() => INITIAL_AGENTS.map((a) => ({ ...a })));
  const [openModal, setOpenModal] = useState<AgentId | null>(null);

  const updateAgent = useCallback((id: AgentId, patch: Partial<AgentConfigRow>) => {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const handleOpenAgent = useCallback((id: AgentId) => {
    setOpenModal(id);
  }, []);

  const handleCloseModal = useCallback(() => {
    setOpenModal(null);
  }, []);

  const openInventoryModal = useCallback(() => {
    setOpenModal(null);
    setTimeout(() => setOpenModal("inventory"), 100);
  }, []);

  const columns: GridColDef<AgentConfigRow>[] = [
    {
      field: "name",
      headerName: "Agent",
      minWidth: 220,
      flex: 1,
    },
    {
      field: "automated",
      headerName: "Automated",
      width: 110,
      renderCell: (params) => (
        <Switch
          size="small"
          checked={params.row.automated}
          onChange={(_, checked) => updateAgent(params.row.id, { automated: checked })}
          onClick={(e) => e.stopPropagation()}
          color="primary"
        />
      ),
    },
    {
      field: "startDate",
      headerName: "Start date",
      width: 160,
      renderCell: (params) => (
        <TextField
          size="small"
          type="date"
          value={params.row.startDate}
          onChange={(e) => updateAgent(params.row.id, { startDate: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          InputLabelProps={{ shrink: true }}
          inputProps={{ min: today, max: params.row.endDate || undefined }}
          sx={{ "& .MuiInputBase-input": { fontSize: "0.8rem", py: 0.5 } }}
        />
      ),
    },
    {
      field: "endDate",
      headerName: "End date",
      width: 160,
      renderCell: (params) => (
        <TextField
          size="small"
          type="date"
          value={params.row.endDate}
          onChange={(e) => updateAgent(params.row.id, { endDate: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          InputLabelProps={{ shrink: true }}
          inputProps={{ min: params.row.startDate || today }}
          sx={{ "& .MuiInputBase-input": { fontSize: "0.8rem", py: 0.5 } }}
        />
      ),
    },
    {
      field: "action",
      headerName: "Open",
      width: 100,
      sortable: false,
      renderCell: (params) => (
        <Button
          size="small"
          variant="outlined"
          startIcon={<OpenInNewOutlinedIcon />}
          onClick={(e) => {
            e.stopPropagation();
            handleOpenAgent(params.row.id);
          }}
        >
          Open
        </Button>
      ),
    },
  ];

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="page-scroll">
      <SectionCard title="Agent configuration" subtitle="Configure automation and open agent chat modals">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Turn on Automated and set Start/End dates for autonomous runs. Click Open or a row to open the agent chat.
        </Typography>
        <div className="maintenance-grid-shell" style={{ minHeight: 220 }}>
          <SmartDataGrid
            rows={agents}
            columns={columns}
            getRowId={(row) => row.id}
            onRowClick={(params) => handleOpenAgent(params.row.id)}
            sx={{ cursor: "pointer", border: 0 }}
            disableRowSelectionOnClick={false}
            hideFooter
            initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
          />
        </div>
      </SectionCard>

      {/* Inventory Diagnostic Agent modal */}
      <Dialog
        open={openModal === "inventory"}
        onClose={handleCloseModal}
        fullWidth
        maxWidth="xl"
        slotProps={{ paper: { sx: { minHeight: "80vh", maxHeight: "90vh" } } }}
      >
        <DialogTitle>Inventory Diagnostic Agent</DialogTitle>
        <DialogContent dividers sx={{ p: 0, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", p: 2 }}>
            <InventoryDiagnosticAgent />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseModal}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Parameter Diagnostic Agent modal */}
      <Dialog
        open={openModal === "parameter"}
        onClose={handleCloseModal}
        fullWidth
        maxWidth="xl"
        slotProps={{ paper: { sx: { minHeight: "80vh", maxHeight: "90vh" } } }}
      >
        <DialogTitle>Parameter Diagnostic Agent</DialogTitle>
        <DialogContent dividers sx={{ p: 0, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", p: 2 }}>
            <ParameterDiagnosticAgent onOpenInventoryAgent={openInventoryModal} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseModal}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Order Diagnostic Agent modal (placeholder until full chat exists) */}
      <Dialog
        open={openModal === "order"}
        onClose={handleCloseModal}
        fullWidth
        maxWidth="md"
        slotProps={{ paper: { sx: { minHeight: "40vh" } } }}
      >
        <DialogTitle>Order Diagnostic Agent</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body1" color="text.secondary">
            Order Diagnostic Agent chat experience will open here. Already developed.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseModal}>Close</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
