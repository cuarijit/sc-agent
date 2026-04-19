import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, IconButton, InputLabel, List, ListItem, ListItemText, MenuItem, Select, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import LockResetOutlinedIcon from "@mui/icons-material/LockResetOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";

import { PageShell, TabPanel } from "../../components/shared/PageLayout";
import { SectionCard } from "../../components/shared/UiBits";
import SmartDataGrid from "../../components/shared/SmartDataGrid";
import type { GridColDef } from "@mui/x-data-grid";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (typeof window !== "undefined" && window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "");

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json() as { detail?: string };
      detail = j?.detail ?? "";
    } catch {}
    throw new Error(detail || `Request failed: ${res.status}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    throw new Error(
      `Server returned non-JSON for ${path} — is the Vite proxy correct? Try a hard refresh.`,
    );
  }
  return res.json() as Promise<T>;
}

interface UserRow {
  id: number; username: string; name: string; email: string;
  is_active: boolean; roles: string[]; data_access_groups: string[];
}
interface RoleRow {
  id: number; name: string; is_system: boolean; entitlements: string[];
}
interface DAGRow {
  id: number; name: string; description: string;
}
interface EntitlementRow {
  key: string; resource_type: string; resource_key: string; description: string;
}

export default function UserAdminPage() {
  const [tab, setTab] = useState(0);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [dags, setDags] = useState<DAGRow[]>([]);
  const [entitlements, setEntitlements] = useState<EntitlementRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [resetPwUser, setResetPwUser] = useState<UserRow | null>(null);
  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [createDagOpen, setCreateDagOpen] = useState(false);
  const [editRoleEnts, setEditRoleEnts] = useState<RoleRow | null>(null);
  const [assignDagsUser, setAssignDagsUser] = useState<UserRow | null>(null);

  async function loadAll() {
    setError(null);
    try {
      const [u, r, d, e] = await Promise.all([
        adminFetch<UserRow[]>("/admin/users"),
        adminFetch<{ roles: RoleRow[] }>("/admin/roles"),
        adminFetch<DAGRow[]>("/admin/data-access-groups"),
        adminFetch<EntitlementRow[]>("/admin/entitlements"),
      ]);
      setUsers(u); setRoles(r.roles ?? []); setDags(d); setEntitlements(e);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  const userColumns: GridColDef<UserRow>[] = useMemo(() => [
    { field: "username", headerName: "Username", flex: 1, minWidth: 140 },
    { field: "name", headerName: "Name", flex: 1, minWidth: 140 },
    { field: "email", headerName: "Email", flex: 1, minWidth: 180 },
    {
      field: "roles", headerName: "Roles", flex: 1, minWidth: 160,
      renderCell: (p) => (
        <Stack direction="row" spacing={0.5}>
          {(p.value as string[]).map((r) => <Chip key={r} label={r} size="small" />)}
        </Stack>
      ),
    },
    {
      field: "is_active", headerName: "Active", width: 90,
      renderCell: (p) => (p.value ? <Chip label="Active" size="small" color="success" /> : <Chip label="Inactive" size="small" />),
    },
    {
      field: "actions", headerName: "Actions", width: 140, sortable: false, filterable: false,
      renderCell: (p) => (
        <Stack direction="row" spacing={0.25}>
          <IconButton size="small" onClick={() => setEditUser(p.row)}><EditOutlinedIcon fontSize="small" /></IconButton>
          <IconButton size="small" onClick={() => setAssignDagsUser(p.row)}><GroupsOutlinedIcon fontSize="small" /></IconButton>
          <IconButton size="small" onClick={() => setResetPwUser(p.row)}><LockResetOutlinedIcon fontSize="small" /></IconButton>
          <IconButton size="small" onClick={async () => {
            if (!confirm(`Delete user '${p.row.username}'?`)) return;
            try {
              await adminFetch(`/admin/users/${p.row.id}`, { method: "DELETE" });
              await loadAll();
            } catch (e) { setError((e as Error).message); }
          }}>
            <DeleteOutlineOutlinedIcon fontSize="small" />
          </IconButton>
        </Stack>
      ),
    },
  ], []);

  const roleColumns: GridColDef<RoleRow>[] = useMemo(() => [
    { field: "name", headerName: "Name", flex: 1, minWidth: 140 },
    {
      field: "is_system", headerName: "System", width: 100,
      renderCell: (p) => (p.value ? <Chip size="small" label="System" color="primary" /> : <Chip size="small" label="Custom" />),
    },
    {
      field: "entitlements", headerName: "# Entitlements", width: 130,
      valueGetter: (_v, row) => row.entitlements.length,
    },
    {
      field: "actions", headerName: "Actions", width: 130, sortable: false, filterable: false,
      renderCell: (p) => (
        <Stack direction="row" spacing={0.25}>
          <IconButton size="small" onClick={() => setEditRoleEnts(p.row)} title="Edit entitlements">
            <KeyOutlinedIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" disabled={p.row.is_system} onClick={async () => {
            if (!confirm(`Delete role '${p.row.name}'?`)) return;
            try { await adminFetch(`/admin/roles/${p.row.id}`, { method: "DELETE" }); await loadAll(); }
            catch (e) { setError((e as Error).message); }
          }}>
            <DeleteOutlineOutlinedIcon fontSize="small" />
          </IconButton>
        </Stack>
      ),
    },
  ], []);

  const dagColumns: GridColDef<DAGRow>[] = useMemo(() => [
    { field: "name", headerName: "Name", flex: 1, minWidth: 160 },
    { field: "description", headerName: "Description", flex: 2, minWidth: 240 },
    {
      field: "actions", headerName: "Actions", width: 100, sortable: false, filterable: false,
      renderCell: (p) => (
        <IconButton size="small" onClick={async () => {
          if (!confirm(`Delete group '${p.row.name}'?`)) return;
          try { await adminFetch(`/admin/data-access-groups/${p.row.id}`, { method: "DELETE" }); await loadAll(); }
          catch (e) { setError((e as Error).message); }
        }}>
          <DeleteOutlineOutlinedIcon fontSize="small" />
        </IconButton>
      ),
    },
  ], []);

  return (
    <PageShell
      title="User Administration"
      subtitle="Manage users, roles, and data access groups"
      breadcrumbs={[{ label: "Administration" }, { label: "Users" }]}
    >
      {error ? <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>{error}</Alert> : null}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1 }}>
        <Tab label="Users" />
        <Tab label="Roles" />
        <Tab label="Data Access Groups" />
      </Tabs>

      <TabPanel value={0} current={tab}>
        <SectionCard title="Users" subtitle={`${users.length} users`}>
          <Stack direction="row" sx={{ mb: 1 }}>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" size="small" onClick={() => setCreateUserOpen(true)}>+ Create User</Button>
          </Stack>
          <Box sx={{ height: 480 }}>
            <SmartDataGrid rows={users} columns={userColumns} getRowId={(r) => r.id} />
          </Box>
        </SectionCard>
      </TabPanel>

      <TabPanel value={1} current={tab}>
        <SectionCard title="Roles" subtitle={`${roles.length} roles`}>
          <Stack direction="row" sx={{ mb: 1 }}>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" size="small" onClick={() => setCreateRoleOpen(true)}>+ Create Role</Button>
          </Stack>
          <Box sx={{ height: 480 }}>
            <SmartDataGrid rows={roles} columns={roleColumns} getRowId={(r) => r.id} />
          </Box>
        </SectionCard>
      </TabPanel>

      <TabPanel value={2} current={tab}>
        <SectionCard title="Data Access Groups" subtitle={`${dags.length} groups`}>
          <Stack direction="row" sx={{ mb: 1 }}>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" size="small" onClick={() => setCreateDagOpen(true)}>+ Create Group</Button>
          </Stack>
          <Box sx={{ height: 480 }}>
            <SmartDataGrid rows={dags} columns={dagColumns} getRowId={(r) => r.id} />
          </Box>
        </SectionCard>
      </TabPanel>

      <CreateUserDialog
        open={createUserOpen}
        roles={roles}
        onClose={() => setCreateUserOpen(false)}
        onCreated={async () => { setCreateUserOpen(false); await loadAll(); }}
        onError={(m) => setError(m)}
      />
      <EditUserDialog
        user={editUser}
        roles={roles}
        onClose={() => setEditUser(null)}
        onSaved={async () => { setEditUser(null); await loadAll(); }}
        onError={(m) => setError(m)}
      />
      <ResetPasswordDialog
        user={resetPwUser}
        onClose={() => setResetPwUser(null)}
        onReset={() => setResetPwUser(null)}
        onError={(m) => setError(m)}
      />
      <CreateRoleDialog
        open={createRoleOpen}
        onClose={() => setCreateRoleOpen(false)}
        onCreated={async () => { setCreateRoleOpen(false); await loadAll(); }}
        onError={(m) => setError(m)}
      />
      <CreateDAGDialog
        open={createDagOpen}
        onClose={() => setCreateDagOpen(false)}
        onCreated={async () => { setCreateDagOpen(false); await loadAll(); }}
        onError={(m) => setError(m)}
      />
      <RoleEntitlementHierarchyDialog
        role={editRoleEnts}
        entitlements={entitlements}
        onClose={() => setEditRoleEnts(null)}
        onSaved={async () => { setEditRoleEnts(null); await loadAll(); }}
        onError={(m) => setError(m)}
      />
      <UserAccessAssignmentDialog
        user={assignDagsUser}
        dags={dags}
        onClose={() => setAssignDagsUser(null)}
        onSaved={async () => { setAssignDagsUser(null); await loadAll(); }}
        onError={(m) => setError(m)}
      />
    </PageShell>
  );
}

// Group entitlements by resource_type for the hierarchy view
function groupEntitlements(ents: EntitlementRow[]): Record<string, EntitlementRow[]> {
  const groups: Record<string, EntitlementRow[]> = {};
  for (const e of ents) {
    if (!groups[e.resource_type]) groups[e.resource_type] = [];
    groups[e.resource_type].push(e);
  }
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => a.key.localeCompare(b.key));
  }
  return groups;
}

function RoleEntitlementHierarchyDialog({ role, entitlements, onClose, onSaved, onError }: {
  role: RoleRow | null;
  entitlements: EntitlementRow[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (role) setSelected(new Set(role.entitlements));
  }, [role]);
  const grouped = useMemo(() => groupEntitlements(entitlements), [entitlements]);
  if (!role) return null;
  const isAdminSystem = role.is_system && role.name === "admin";
  return (
    <Dialog open={!!role} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Edit Entitlements: {role.name}{role.is_system ? " (system)" : ""}</DialogTitle>
      <DialogContent dividers>
        {isAdminSystem ? (
          <Alert severity="info" sx={{ mb: 1 }}>
            The admin role always has every entitlement. Editing is allowed but admin role bypasses entitlement checks anyway.
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <Button size="small" onClick={() => setSelected(new Set(entitlements.map((e) => e.key)))}>Select all</Button>
          <Button size="small" onClick={() => setSelected(new Set())}>Clear all</Button>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 11, color: "text.secondary", alignSelf: "center" }}>
            {selected.size} of {entitlements.length} selected
          </Typography>
        </Stack>
        <Stack spacing={1.5} sx={{ maxHeight: "60vh", overflowY: "auto" }}>
          {Object.entries(grouped).map(([resourceType, items]) => (
            <Box key={resourceType}>
              <Typography sx={{
                fontFamily: '"Montserrat", sans-serif', fontWeight: 700, fontSize: 12,
                color: "var(--text-primary)", mb: 0.5, textTransform: "capitalize",
              }}>
                {resourceType} ({items.length})
              </Typography>
              <Stack sx={{ pl: 1 }}>
                {items.map((e) => (
                  <FormControlLabel
                    key={e.key}
                    control={
                      <Checkbox
                        size="small"
                        checked={selected.has(e.key)}
                        onChange={(_, on) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (on) next.add(e.key); else next.delete(e.key);
                            return next;
                          });
                        }}
                      />
                    }
                    label={
                      <Box sx={{ display: "flex", flexDirection: "column" }}>
                        <Typography sx={{ fontSize: 11, fontFamily: "monospace" }}>{e.key}</Typography>
                        {e.description ? (
                          <Typography sx={{ fontSize: 10, color: "text.secondary" }}>{e.description}</Typography>
                        ) : null}
                      </Box>
                    }
                    sx={{ mr: 0, alignItems: "flex-start" }}
                  />
                ))}
              </Stack>
              <Divider sx={{ mt: 0.5 }} />
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={async () => {
          try {
            await adminFetch(`/admin/roles/${role.id}`, {
              method: "PUT",
              body: JSON.stringify({ entitlements: Array.from(selected) }),
            });
            await onSaved();
          } catch (e) { onError((e as Error).message); }
        }}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function UserAccessAssignmentDialog({ user, dags, onClose, onSaved, onError }: {
  user: UserRow | null;
  dags: DAGRow[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (user) setSelected(new Set(user.data_access_groups));
  }, [user]);
  if (!user) return null;
  return (
    <Dialog open={!!user} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Data Access Groups: {user.username}</DialogTitle>
      <DialogContent dividers>
        {dags.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
            No groups defined yet. Create one in the Data Access Groups tab first.
          </Typography>
        ) : (
          <List dense disablePadding>
            {dags.map((g) => (
              <ListItem key={g.id} disablePadding>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={selected.has(g.name)}
                      onChange={(_, on) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (on) next.add(g.name); else next.delete(g.name);
                          return next;
                        });
                      }}
                    />
                  }
                  label={
                    <ListItemText
                      primary={g.name}
                      secondary={g.description || undefined}
                      primaryTypographyProps={{ fontSize: 12, fontWeight: 600 }}
                      secondaryTypographyProps={{ fontSize: 10 }}
                    />
                  }
                  sx={{ ml: 0 }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={dags.length === 0} onClick={async () => {
          try {
            await adminFetch(`/admin/users/${user.id}/data-access-groups`, {
              method: "POST",
              body: JSON.stringify({ groups: Array.from(selected) }),
            });
            await onSaved();
          } catch (e) { onError((e as Error).message); }
        }}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function CreateUserDialog({ open, roles, onClose, onCreated, onError }: {
  open: boolean; roles: RoleRow[]; onClose: () => void; onCreated: () => Promise<void>; onError: (m: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  useEffect(() => { if (open) { setUsername(""); setName(""); setEmail(""); setPassword(""); setRole("user"); } }, [open]);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Create User</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} fullWidth />
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth />
          <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} fullWidth />
          <FormControl fullWidth>
            <InputLabel>Role</InputLabel>
            <Select value={role} label="Role" onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => <MenuItem key={r.id} value={r.name}>{r.name}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={async () => {
          try {
            await adminFetch("/admin/users", {
              method: "POST",
              body: JSON.stringify({ username, name, email, password, roles: [role] }),
            });
            await onCreated();
          } catch (e) { onError((e as Error).message); }
        }}>Create</Button>
      </DialogActions>
    </Dialog>
  );
}

function EditUserDialog({ user, roles, onClose, onSaved, onError }: {
  user: UserRow | null; roles: RoleRow[]; onClose: () => void; onSaved: () => Promise<void>; onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  useEffect(() => {
    if (user) { setName(user.name); setEmail(user.email); setRole(user.roles[0] || "user"); }
  }, [user]);
  if (!user) return null;
  return (
    <Dialog open={!!user} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Edit User: {user.username}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth />
          <FormControl fullWidth>
            <InputLabel>Role</InputLabel>
            <Select value={role} label="Role" onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => <MenuItem key={r.id} value={r.name}>{r.name}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={async () => {
          try {
            await adminFetch(`/admin/users/${user.id}/profile`, {
              method: "POST", body: JSON.stringify({ name, email }),
            });
            await adminFetch(`/admin/users/${user.id}/role`, {
              method: "POST", body: JSON.stringify({ role }),
            });
            await onSaved();
          } catch (e) { onError((e as Error).message); }
        }}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onReset, onError }: {
  user: UserRow | null; onClose: () => void; onReset: () => void; onError: (m: string) => void;
}) {
  const [pw, setPw] = useState("");
  useEffect(() => { if (user) setPw(""); }, [user]);
  if (!user) return null;
  return (
    <Dialog open={!!user} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Reset Password: {user.username}</DialogTitle>
      <DialogContent>
        <TextField sx={{ mt: 1 }} label="New Password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} fullWidth />
        <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 1 }}>Minimum 6 characters.</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={async () => {
          try {
            await adminFetch(`/admin/users/${user.id}/reset-password`, {
              method: "POST", body: JSON.stringify({ new_password: pw }),
            });
            onReset();
          } catch (e) { onError((e as Error).message); }
        }}>Reset</Button>
      </DialogActions>
    </Dialog>
  );
}

function CreateRoleDialog({ open, onClose, onCreated, onError }: {
  open: boolean; onClose: () => void; onCreated: () => Promise<void>; onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(""); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Create Role</DialogTitle>
      <DialogContent>
        <TextField sx={{ mt: 1 }} label="Role Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={async () => {
          try {
            await adminFetch("/admin/roles", { method: "POST", body: JSON.stringify({ name }) });
            await onCreated();
          } catch (e) { onError((e as Error).message); }
        }}>Create</Button>
      </DialogActions>
    </Dialog>
  );
}

function CreateDAGDialog({ open, onClose, onCreated, onError }: {
  open: boolean; onClose: () => void; onCreated: () => Promise<void>; onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => { if (open) { setName(""); setDescription(""); } }, [open]);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Create Data Access Group</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth multiline rows={3} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={async () => {
          try {
            await adminFetch("/admin/data-access-groups", { method: "POST", body: JSON.stringify({ name, description }) });
            await onCreated();
          } catch (e) { onError((e as Error).message); }
        }}>Create</Button>
      </DialogActions>
    </Dialog>
  );
}
