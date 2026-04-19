import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Select, Stack, Switch, TextField, Typography } from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";

import { PageShell } from "../../components/shared/PageLayout";
import { SectionCard } from "../../components/shared/UiBits";
import SmartDataGrid from "../../components/shared/SmartDataGrid";
import type { GridColDef } from "@mui/x-data-grid";
import {
  fetchAdminModules, fetchAdminModule,
  createAdminModule, updateAdminModule, deleteAdminModule,
  createAdminPage, updateAdminPage, deleteAdminPage,
  type AdminModuleRecord, type AdminPageRecord,
} from "../../services/moduleAdminApi";

const PAGE_TYPE_OPTIONS = ["overview", "analytics", "workbench", "module_configurator", "custom"];

export default function ModuleConfigPage() {
  const [modules, setModules] = useState<AdminModuleRecord[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [moduleDetail, setModuleDetail] = useState<AdminModuleRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createModuleOpen, setCreateModuleOpen] = useState(false);
  const [editModule, setEditModule] = useState<AdminModuleRecord | null>(null);
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const [editPage, setEditPage] = useState<AdminPageRecord | null>(null);

  async function reloadList() {
    setError(null);
    try {
      const list = await fetchAdminModules();
      setModules(list);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function reloadDetail(slug: string) {
    setError(null);
    try {
      const d = await fetchAdminModule(slug);
      setModuleDetail(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => { void reloadList(); }, []);
  useEffect(() => {
    if (selectedSlug) void reloadDetail(selectedSlug);
    else setModuleDetail(null);
  }, [selectedSlug]);

  const moduleColumns: GridColDef<AdminModuleRecord>[] = useMemo(() => [
    { field: "module_slug", headerName: "Slug", flex: 1, minWidth: 160 },
    { field: "label", headerName: "Label", flex: 1, minWidth: 160 },
    { field: "description", headerName: "Description", flex: 2, minWidth: 200 },
    {
      field: "is_active", headerName: "Active", width: 90,
      renderCell: (p) => p.value ? <Chip size="small" label="Active" color="success" /> : <Chip size="small" label="Inactive" />,
    },
    { field: "sort_order", headerName: "Sort", width: 70 },
    {
      field: "actions", headerName: "Actions", width: 200, sortable: false, filterable: false,
      renderCell: (p) => (
        <Stack direction="row" spacing={0.25}>
          <Button size="small" onClick={() => setSelectedSlug(p.row.module_slug)}>Open →</Button>
          <IconButton size="small" onClick={() => setEditModule(p.row)}><EditOutlinedIcon fontSize="small" /></IconButton>
          <IconButton size="small" onClick={async () => {
            if (!confirm(`Delete module '${p.row.module_slug}' and all its pages?`)) return;
            try { await deleteAdminModule(p.row.module_slug); await reloadList(); }
            catch (e) { setError((e as Error).message); }
          }}><DeleteOutlineOutlinedIcon fontSize="small" /></IconButton>
        </Stack>
      ),
    },
  ], []);

  const pageColumns: GridColDef<AdminPageRecord>[] = useMemo(() => [
    { field: "page_slug", headerName: "Slug", flex: 1, minWidth: 140 },
    { field: "label", headerName: "Label", flex: 1, minWidth: 140 },
    { field: "page_type", headerName: "Type", width: 130 },
    { field: "icon", headerName: "Icon", width: 200 },
    { field: "sort_order", headerName: "Sort", width: 70 },
    {
      field: "is_active", headerName: "Active", width: 90,
      renderCell: (p) => p.value ? <Chip size="small" label="Active" color="success" /> : <Chip size="small" label="Inactive" />,
    },
    {
      field: "actions", headerName: "Actions", width: 100, sortable: false, filterable: false,
      renderCell: (p) => (
        <Stack direction="row" spacing={0.25}>
          <IconButton size="small" onClick={() => setEditPage(p.row)}><EditOutlinedIcon fontSize="small" /></IconButton>
          <IconButton size="small" onClick={async () => {
            if (!moduleDetail) return;
            if (!confirm(`Delete page '${p.row.page_slug}'?`)) return;
            try {
              await deleteAdminPage(moduleDetail.module_slug, p.row.page_slug);
              await reloadDetail(moduleDetail.module_slug);
            } catch (e) { setError((e as Error).message); }
          }}><DeleteOutlineOutlinedIcon fontSize="small" /></IconButton>
        </Stack>
      ),
    },
  ], [moduleDetail]);

  return (
    <PageShell
      title="Modules & Pages"
      subtitle={selectedSlug ? `Editing module: ${selectedSlug}` : "Manage navigation modules and their pages"}
      breadcrumbs={selectedSlug
        ? [{ label: "Administration" }, { label: "Modules", to: "#" }, { label: selectedSlug }]
        : [{ label: "Administration" }, { label: "Modules & Pages" }]}
    >
      {error ? <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert> : null}

      {!selectedSlug ? (
        <SectionCard title="Modules" subtitle={`${modules.length} modules`}>
          <Stack direction="row" sx={{ mb: 1 }}>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" size="small" startIcon={<AddOutlinedIcon />} onClick={() => setCreateModuleOpen(true)}>
              Create Module
            </Button>
          </Stack>
          <Box sx={{ height: 480 }}>
            <SmartDataGrid rows={modules} columns={moduleColumns} getRowId={(r) => r.id} />
          </Box>
        </SectionCard>
      ) : moduleDetail ? (
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Button size="small" startIcon={<ArrowBackOutlinedIcon />} onClick={() => setSelectedSlug(null)}>
              Back to modules
            </Button>
            <Typography sx={{ fontWeight: 700 }}>{moduleDetail.label}</Typography>
            <Chip size="small" label={moduleDetail.module_slug} sx={{ fontFamily: "monospace" }} />
          </Stack>
          <SectionCard title="Pages" subtitle={`${(moduleDetail.pages || []).length} pages in module`}>
            <Stack direction="row" sx={{ mb: 1 }}>
              <Box sx={{ flex: 1 }} />
              <Button variant="contained" size="small" startIcon={<AddOutlinedIcon />} onClick={() => setCreatePageOpen(true)}>
                Add Page
              </Button>
            </Stack>
            <Box sx={{ height: 420 }}>
              <SmartDataGrid rows={moduleDetail.pages || []} columns={pageColumns} getRowId={(r) => r.id} />
            </Box>
          </SectionCard>
        </Stack>
      ) : (
        <Typography>Loading...</Typography>
      )}

      <ModuleFormDialog
        open={createModuleOpen}
        onClose={() => setCreateModuleOpen(false)}
        onSubmit={async (payload) => {
          try { await createAdminModule(payload); setCreateModuleOpen(false); await reloadList(); }
          catch (e) { setError((e as Error).message); }
        }}
      />
      <ModuleFormDialog
        open={!!editModule}
        initial={editModule || undefined}
        onClose={() => setEditModule(null)}
        onSubmit={async (payload) => {
          if (!editModule) return;
          try { await updateAdminModule(editModule.module_slug, payload); setEditModule(null); await reloadList(); if (selectedSlug === editModule.module_slug) await reloadDetail(selectedSlug); }
          catch (e) { setError((e as Error).message); }
        }}
      />
      <PageFormDialog
        open={createPageOpen}
        onClose={() => setCreatePageOpen(false)}
        onSubmit={async (payload) => {
          if (!moduleDetail) return;
          try { await createAdminPage(moduleDetail.module_slug, payload); setCreatePageOpen(false); await reloadDetail(moduleDetail.module_slug); }
          catch (e) { setError((e as Error).message); }
        }}
      />
      <PageFormDialog
        open={!!editPage}
        initial={editPage || undefined}
        onClose={() => setEditPage(null)}
        onSubmit={async (payload) => {
          if (!moduleDetail || !editPage) return;
          try { await updateAdminPage(moduleDetail.module_slug, editPage.page_slug, payload); setEditPage(null); await reloadDetail(moduleDetail.module_slug); }
          catch (e) { setError((e as Error).message); }
        }}
      />
    </PageShell>
  );
}

function ModuleFormDialog({ open, initial, onClose, onSubmit }: {
  open: boolean;
  initial?: AdminModuleRecord;
  onClose: () => void;
  onSubmit: (payload: Partial<AdminModuleRecord>) => Promise<void>;
}) {
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (open) {
      setSlug(initial?.module_slug ?? "");
      setLabel(initial?.label ?? "");
      setDescription(initial?.description ?? "");
      setIcon(initial?.icon ?? "");
      setSortOrder(initial?.sort_order ?? 0);
      setActive(initial?.is_active ?? true);
    }
  }, [open, initial]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{initial ? `Edit module: ${initial.module_slug}` : "Create Module"}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <TextField label="Module slug" value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!!initial} fullWidth />
          <TextField label="Label" value={label} onChange={(e) => setLabel(e.target.value)} fullWidth />
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} multiline rows={2} fullWidth />
          <TextField label="Icon (MUI icon name, e.g. DashboardOutlinedIcon)" value={icon} onChange={(e) => setIcon(e.target.value)} fullWidth />
          <TextField label="Sort order" type="number" value={sortOrder} onChange={(e) => setSortOrder(parseInt(e.target.value || "0", 10))} fullWidth />
          <FormControlLabel control={<Switch checked={active} onChange={(_, v) => setActive(v)} />} label="Active" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onSubmit({
          module_slug: slug || undefined,
          label,
          description,
          icon: icon || null,
          sort_order: sortOrder,
          is_active: active,
        })}>{initial ? "Save" : "Create"}</Button>
      </DialogActions>
    </Dialog>
  );
}

function PageFormDialog({ open, initial, onClose, onSubmit }: {
  open: boolean;
  initial?: AdminPageRecord;
  onClose: () => void;
  onSubmit: (payload: Partial<AdminPageRecord>) => Promise<void>;
}) {
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState("custom");
  const [icon, setIcon] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (open) {
      setSlug(initial?.page_slug ?? "");
      setLabel(initial?.label ?? "");
      setType(initial?.page_type ?? "custom");
      setIcon(initial?.icon ?? "");
      setSortOrder(initial?.sort_order ?? 0);
      setActive(initial?.is_active ?? true);
    }
  }, [open, initial]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{initial ? `Edit page: ${initial.page_slug}` : "Add Page"}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <TextField label="Page slug" value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!!initial} fullWidth />
          <TextField label="Label" value={label} onChange={(e) => setLabel(e.target.value)} fullWidth />
          <FormControl fullWidth>
            <InputLabel>Page type</InputLabel>
            <Select value={type} label="Page type" onChange={(e) => setType(e.target.value)}>
              {PAGE_TYPE_OPTIONS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Icon (MUI icon name)" value={icon} onChange={(e) => setIcon(e.target.value)} fullWidth />
          <TextField label="Sort order" type="number" value={sortOrder} onChange={(e) => setSortOrder(parseInt(e.target.value || "0", 10))} fullWidth />
          <FormControlLabel control={<Switch checked={active} onChange={(_, v) => setActive(v)} />} label="Active" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onSubmit({
          page_slug: slug || undefined,
          label,
          page_type: type,
          icon: icon || null,
          sort_order: sortOrder,
          is_active: active,
        })}>{initial ? "Save" : "Create"}</Button>
      </DialogActions>
    </Dialog>
  );
}
