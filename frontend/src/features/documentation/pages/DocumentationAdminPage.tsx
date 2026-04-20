/**
 * Documentation Management — admin page for authoring + uploading help
 * markdown content. Layout: left sidebar tree, right pane with three tabs
 * (Preview / Edit Markdown / Metadata). Upload-first: the Edit tab has a
 * prominent "Upload .md" button that replaces the body in one click.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import ChevronRightOutlinedIcon from "@mui/icons-material/ChevronRightOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";

import {
  createHelpEntry,
  deleteHelpEntry,
  fetchHelpContent,
  fetchHelpManifest,
  updateHelpContent,
  updateHelpManifest,
  uploadHelpMarkdown,
  type HelpManifestEntry,
  type HelpManifestResponse,
} from "../../../services/helpAdminApi";
import MarkdownView from "../../../components/help/MarkdownView";
import { PageShell } from "../../../components/shared/PageLayout";

type EntryType = HelpManifestEntry["type"];

const ENTRY_TYPES: EntryType[] = ["module", "page", "tab", "reference"];

interface TreeNode {
  entry: HelpManifestEntry;
  children: TreeNode[];
}

function buildTree(entries: HelpManifestEntry[]): TreeNode[] {
  const sorted = [...entries].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const byParent = new Map<string | null, HelpManifestEntry[]>();
  for (const e of sorted) {
    const k = e.parent_id ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(e);
  }
  const make = (parent: string | null): TreeNode[] =>
    (byParent.get(parent) ?? []).map((entry) => ({ entry, children: make(entry.id) }));
  return make(null);
}

export default function DocumentationAdminPage() {
  const [manifest, setManifest] = useState<HelpManifestResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  const [meta, setMeta] = useState<HelpManifestEntry | null>(null);
  const [tab, setTab] = useState<"preview" | "edit" | "meta">("preview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => (manifest ? buildTree(manifest.entries) : []), [manifest]);

  async function reloadManifest() {
    setError(null);
    try {
      const m = await fetchHelpManifest();
      setManifest(m);
      if (!selectedId && m.entries.length > 0) {
        const first = m.entries.find((e) => e.type === "page") ?? m.entries[0];
        setSelectedId(first.id);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => { void reloadManifest(); }, []);

  useEffect(() => {
    if (!selectedId || !manifest) return;
    const entry = manifest.entries.find((e) => e.id === selectedId) ?? null;
    setMeta(entry);
    setLoading(true);
    setError(null);
    fetchHelpContent(selectedId)
      .then((r) => {
        setContent(r.content);
        setDraft(r.content);
      })
      .catch((e) => {
        setContent("");
        setDraft("");
        setError((e as Error).message);
      })
      .finally(() => setLoading(false));
  }, [selectedId, manifest]);

  async function saveContent() {
    if (!selectedId) return;
    setError(null); setSuccess(null);
    try {
      await updateHelpContent(selectedId, draft);
      setContent(draft);
      setSuccess("Content saved.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveMetadata() {
    if (!manifest || !meta) return;
    setError(null); setSuccess(null);
    const next: HelpManifestResponse = {
      ...manifest,
      entries: manifest.entries.map((e) => (e.id === meta.id ? meta : e)),
    };
    try {
      const saved = await updateHelpManifest(next);
      setManifest(saved);
      setSuccess("Metadata saved.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onFilePicked(file: File) {
    if (!selectedId) return;
    setError(null); setSuccess(null);
    try {
      await uploadHelpMarkdown(selectedId, file);
      const r = await fetchHelpContent(selectedId);
      setContent(r.content);
      setDraft(r.content);
      setSuccess(`Uploaded ${file.name}.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteCurrent() {
    if (!selectedId) return;
    setError(null); setSuccess(null);
    try {
      await deleteHelpEntry(selectedId);
      setSelectedId(null);
      await reloadManifest();
      setSuccess("Entry deleted.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleteOpen(false);
    }
  }

  return (
    <PageShell
      title="Documentation Management"
      subtitle="Author and upload markdown help content for every page"
      breadcrumbs={[{ label: "Administration" }, { label: "Documentation" }]}
    >
      {error ? <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert> : null}
      {success ? <Alert severity="success" sx={{ mb: 1 }} onClose={() => setSuccess(null)}>{success}</Alert> : null}

      <Box sx={{ display: "flex", gap: 1.5, height: "calc(100vh - 220px)", minHeight: 500 }}>
        {/* Sidebar tree */}
        <Box
          sx={{
            width: 320,
            flexShrink: 0,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.5}
            sx={{ p: 1, borderBottom: "1px solid", borderColor: "divider", bgcolor: "rgba(38,121,168,0.04)" }}
          >
            <Typography sx={{ fontSize: 12, fontWeight: 700, flex: 1 }}>
              Entries ({manifest?.entries.length ?? 0})
            </Typography>
            <IconButton size="small" onClick={() => void reloadManifest()} title="Refresh">
              <RefreshOutlinedIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => setCreateOpen(true)} title="New entry">
              <AddOutlinedIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Box sx={{ flex: 1, overflowY: "auto", p: 0.5 }}>
            <TreeView nodes={tree} selectedId={selectedId} onSelect={setSelectedId} />
          </Box>
        </Box>

        {/* Right pane */}
        <Box
          sx={{
            flex: 1,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {meta ? (
            <>
              <Stack
                direction="row"
                alignItems="center"
                sx={{ px: 1.5, py: 0.75, borderBottom: "1px solid", borderColor: "divider", bgcolor: "rgba(38,121,168,0.04)" }}
              >
                <Stack sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: "text.primary" }}>
                    {meta.title}
                  </Typography>
                  <Typography sx={{ fontSize: 10.5, color: "text.secondary", fontFamily: "monospace" }}>
                    {meta.id} · {meta.type} · {meta.route_path || "(no route)"}
                  </Typography>
                </Stack>
                <IconButton size="small" color="error" title="Delete entry" onClick={() => setDeleteOpen(true)}>
                  <DeleteOutlineOutlinedIcon fontSize="small" />
                </IconButton>
              </Stack>
              <Tabs
                value={tab}
                onChange={(_e, v) => setTab(v)}
                sx={{ minHeight: 32, borderBottom: "1px solid", borderColor: "divider", "& .MuiTab-root": { minHeight: 32, fontSize: 11, py: 0.25 } }}
              >
                <Tab value="preview" label="Preview" />
                <Tab value="edit" label="Edit Markdown" />
                <Tab value="meta" label="Metadata" />
              </Tabs>
              <Box sx={{ flex: 1, overflowY: "auto", p: 2, minHeight: 0 }}>
                {loading ? (
                  <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : tab === "preview" ? (
                  <MarkdownView content={content} density="comfortable" />
                ) : tab === "edit" ? (
                  <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<UploadFileOutlinedIcon />}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Upload .md
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".md,.markdown,.txt,text/markdown,text/plain"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void onFilePicked(f);
                          e.target.value = "";
                        }}
                      />
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<SaveOutlinedIcon />}
                        disabled={draft === content}
                        onClick={() => void saveContent()}
                      >
                        Save
                      </Button>
                      {draft !== content ? (
                        <Chip size="small" label="Unsaved" color="warning" variant="outlined" sx={{ fontSize: 10 }} />
                      ) : null}
                    </Stack>
                    <TextField
                      multiline
                      minRows={20}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      fullWidth
                      sx={{ "& .MuiInputBase-input": { fontFamily: "monospace", fontSize: 12, lineHeight: 1.5 } }}
                    />
                  </Stack>
                ) : (
                  <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
                    <TextField label="ID" value={meta.id} disabled fullWidth size="small" />
                    <TextField
                      select
                      label="Type"
                      value={meta.type}
                      onChange={(e) => setMeta({ ...meta, type: e.target.value as EntryType })}
                      size="small"
                      fullWidth
                    >
                      {ENTRY_TYPES.map((t) => (
                        <MenuItem key={t} value={t}>{t}</MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      label="Title"
                      value={meta.title}
                      onChange={(e) => setMeta({ ...meta, title: e.target.value })}
                      size="small"
                      fullWidth
                    />
                    <TextField
                      label="Description"
                      value={meta.description}
                      onChange={(e) => setMeta({ ...meta, description: e.target.value })}
                      size="small"
                      fullWidth
                    />
                    <TextField
                      label="Icon (MUI name, e.g. DashboardOutlined)"
                      value={meta.icon ?? ""}
                      onChange={(e) => setMeta({ ...meta, icon: e.target.value || null })}
                      size="small"
                      fullWidth
                    />
                    <TextField
                      label="Route path (e.g. /demand/forecasting)"
                      value={meta.route_path}
                      onChange={(e) => setMeta({ ...meta, route_path: e.target.value })}
                      size="small"
                      fullWidth
                      helperText="Drives in-app help auto-resolution. Longest prefix wins."
                    />
                    <TextField
                      label="Parent ID"
                      value={meta.parent_id ?? ""}
                      onChange={(e) => setMeta({ ...meta, parent_id: e.target.value || null })}
                      size="small"
                      fullWidth
                    />
                    <TextField
                      label="Order"
                      type="number"
                      value={meta.order}
                      onChange={(e) => setMeta({ ...meta, order: Number(e.target.value) || 0 })}
                      size="small"
                      fullWidth
                    />
                    <Box>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<SaveOutlinedIcon />}
                        onClick={() => void saveMetadata()}
                      >
                        Save Metadata
                      </Button>
                    </Box>
                  </Stack>
                )}
              </Box>
            </>
          ) : (
            <Box sx={{ p: 4, color: "text.secondary", fontSize: 13 }}>
              Select an entry from the left to view or edit it, or create a new one.
            </Box>
          )}
        </Box>
      </Box>

      <CreateEntryDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (id) => {
          await reloadManifest();
          setSelectedId(id);
          setCreateOpen(false);
        }}
      />
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogTitle>Delete entry?</DialogTitle>
        <DialogContent>
          <Typography>Permanently deletes <code>{meta?.id}</code> and its markdown file.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={() => void deleteCurrent()}>Delete</Button>
        </DialogActions>
      </Dialog>
    </PageShell>
  );
}

// ─── Tree view (simple hierarchical list) ────────────────────────────
function TreeView({
  nodes, selectedId, onSelect, depth = 0,
}: {
  nodes: TreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((n) => (
        <TreeRow key={n.entry.id} node={n} selectedId={selectedId} onSelect={onSelect} depth={depth} />
      ))}
    </>
  );
}

function TreeRow({
  node, selectedId, onSelect, depth,
}: {
  node: TreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = node.entry.id === selectedId;
  return (
    <>
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.25}
        onClick={() => onSelect(node.entry.id)}
        sx={{
          pl: depth * 1.25,
          py: 0.4,
          pr: 0.5,
          cursor: "pointer",
          borderRadius: 0.5,
          bgcolor: isSelected ? "rgba(38,121,168,0.12)" : "transparent",
          "&:hover": { bgcolor: isSelected ? "rgba(38,121,168,0.16)" : "rgba(38,121,168,0.06)" },
        }}
      >
        {hasChildren ? (
          <IconButton
            size="small"
            sx={{ p: 0.25 }}
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          >
            {expanded ? <ExpandMoreOutlinedIcon sx={{ fontSize: 14 }} /> : <ChevronRightOutlinedIcon sx={{ fontSize: 14 }} />}
          </IconButton>
        ) : (
          <Box sx={{ width: 22 }} />
        )}
        <Typography
          sx={{
            fontSize: 11.5,
            fontWeight: node.entry.type === "module" ? 700 : 500,
            color: "text.primary",
            flex: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {node.entry.title}
        </Typography>
        <Typography sx={{ fontSize: 9, color: "text.disabled", textTransform: "uppercase" }}>
          {node.entry.type[0]}
        </Typography>
      </Stack>
      {expanded && hasChildren ? (
        <TreeView nodes={node.children} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
      ) : null}
    </>
  );
}

// ─── Create entry dialog ────────────────────────────────────────────
function CreateEntryDialog({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void | Promise<void>;
}) {
  const [id, setId] = useState("");
  const [type, setType] = useState<EntryType>("page");
  const [title, setTitle] = useState("");
  const [routePath, setRoutePath] = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setId(""); setType("page"); setTitle(""); setRoutePath(""); setParentId(""); setError(null);
    }
  }, [open]);

  async function submit() {
    setError(null);
    if (!id.trim()) { setError("ID required."); return; }
    setSubmitting(true);
    try {
      await createHelpEntry({
        id: id.trim(),
        type,
        title: title.trim() || id.trim(),
        route_path: routePath.trim(),
        parent_id: parentId.trim() || null,
      });
      await onCreated(id.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New help entry</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField label="ID (e.g. page__my_page)" value={id} onChange={(e) => setId(e.target.value)} size="small" fullWidth />
          <TextField select label="Type" value={type} onChange={(e) => setType(e.target.value as EntryType)} size="small" fullWidth>
            {ENTRY_TYPES.map((t) => (<MenuItem key={t} value={t}>{t}</MenuItem>))}
          </TextField>
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} size="small" fullWidth />
          <TextField label="Route path" value={routePath} onChange={(e) => setRoutePath(e.target.value)} size="small" fullWidth />
          <TextField label="Parent ID (optional)" value={parentId} onChange={(e) => setParentId(e.target.value)} size="small" fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => void submit()} disabled={submitting}>Create</Button>
      </DialogActions>
    </Dialog>
  );
}
