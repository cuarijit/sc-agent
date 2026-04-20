import { useEffect, useState } from "react";
import { Alert, Box, Button, Card, CardContent, CardMedia, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Typography } from "@mui/material";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";

import { PageShell } from "../../components/shared/PageLayout";
import { SectionCard } from "../../components/shared/UiBits";
import {
  fetchAdminBranding, fetchBrandingAssets, resolveBrandingAssetUrl,
  updateAdminBranding, uploadBrandingAsset,
  type BrandingSettings, type LibraryAsset,
} from "../../services/brandingAdminApi";

export default function BrandingPage() {
  const [settings, setSettings] = useState<BrandingSettings>({ company_logo: null, customer_logo: null, tenant_logo: null });
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<"company_logo" | "customer_logo" | "tenant_logo" | null>(null);
  const [uploading, setUploading] = useState(false);

  async function reloadAll() {
    setError(null);
    try {
      const [s, a] = await Promise.all([fetchAdminBranding(), fetchBrandingAssets()]);
      setSettings(s);
      setAssets(a.library);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => { void reloadAll(); }, []);

  async function save() {
    setError(null); setSuccess(null);
    try {
      const saved = await updateAdminBranding(settings);
      setSettings(saved);
      // Notify the TopHeader to refetch /api/branding so the header logos
      // update in place — no hard refresh required.
      window.dispatchEvent(new CustomEvent("branding:changed"));
      setSuccess("Branding saved — header updated.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const r = await uploadBrandingAsset(file);
      // Refresh asset list so the upload appears
      const a = await fetchBrandingAssets();
      setAssets(a.library);
      // Auto-select the uploaded asset for the slot we opened the picker from
      if (pickerFor) {
        setSettings((prev) => ({ ...prev, [pickerFor]: r.path }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <PageShell
      title="Branding & Logos"
      subtitle="Manage company / customer logos shown in the header and login page"
      breadcrumbs={[{ label: "Administration" }, { label: "Branding & Logos" }]}
    >
      {error ? <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert> : null}
      {success ? <Alert severity="success" sx={{ mb: 1 }} onClose={() => setSuccess(null)}>{success}</Alert> : null}

      <SectionCard title="Active logos" subtitle="What appears in the brand strip + login page">
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <LogoSlot
            label="Company logo — brand strip LEFT"
            token={settings.company_logo}
            onPick={() => setPickerFor("company_logo")}
            onClear={() => setSettings((p) => ({ ...p, company_logo: null }))}
          />
          <LogoSlot
            label="Module / product logo — brand strip LEFT (after divider)"
            token={settings.customer_logo}
            onPick={() => setPickerFor("customer_logo")}
            onClear={() => setSettings((p) => ({ ...p, customer_logo: null }))}
          />
          <LogoSlot
            label="Customer logo — brand strip RIGHT (uploadable per tenant)"
            token={settings.tenant_logo}
            onPick={() => setPickerFor("tenant_logo")}
            onClear={() => setSettings((p) => ({ ...p, tenant_logo: null }))}
          />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={save}>Save Branding</Button>
          <Button variant="outlined" startIcon={<RefreshOutlinedIcon />} onClick={reloadAll}>Refresh</Button>
        </Stack>
      </SectionCard>

      <AssetPickerDialog
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        assets={assets}
        uploading={uploading}
        onPick={(token) => {
          if (pickerFor) setSettings((p) => ({ ...p, [pickerFor]: token }));
          setPickerFor(null);
        }}
        onUpload={onUpload}
      />
    </PageShell>
  );
}

function LogoSlot({
  label, token, onPick, onClear,
}: {
  label: string;
  token: string | null;
  onPick: () => void;
  onClear: () => void;
}) {
  const url = resolveBrandingAssetUrl(token);
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 280 }}>
      <Box sx={{ height: 120, bgcolor: "grey.100", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {url ? (
          <CardMedia component="img" image={url} alt={label} sx={{ maxHeight: 100, maxWidth: "90%", width: "auto" }} />
        ) : (
          <Typography variant="caption" color="text.secondary">No logo selected</Typography>
        )}
      </Box>
      <CardContent sx={{ py: 1 }}>
        <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>{label}</Typography>
        <Typography variant="caption" sx={{ display: "block", fontFamily: "monospace", mt: 0.5 }}>{token || "(none)"}</Typography>
        <Stack direction="row" spacing={0.5} sx={{ mt: 1 }}>
          <Button size="small" variant="outlined" onClick={onPick}>Pick from library / upload</Button>
          {token ? <Button size="small" onClick={onClear}>Clear</Button> : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function AssetPickerDialog({ open, onClose, assets, uploading, onPick, onUpload }: {
  open: boolean;
  onClose: () => void;
  assets: LibraryAsset[];
  uploading: boolean;
  onPick: (token: string) => void;
  onUpload: (file: File) => Promise<void>;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Choose logo</DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <Button
            component="label"
            variant="outlined"
            startIcon={<CloudUploadOutlinedIcon />}
            disabled={uploading}
          >
            {uploading ? "Uploading..." : "Upload PNG / JPG / SVG (max 2 MB)"}
            <input
              type="file"
              hidden
              accept=".png,.jpg,.jpeg,.svg,.webp"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await onUpload(f);
                e.target.value = "";
              }}
            />
          </Button>
          <Typography variant="caption" color="text.secondary">
            {assets.length} assets in library
          </Typography>
        </Stack>
        <Box sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 1.5,
        }}>
          {assets.map((a) => {
            const url = resolveBrandingAssetUrl(a.path);
            return (
              <Card key={a.path} variant="outlined" sx={{ cursor: "pointer", "&:hover": { borderColor: "primary.main" } }} onClick={() => onPick(a.path)}>
                <Box sx={{ height: 80, bgcolor: "grey.100", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                  {url ? <Box component="img" src={url} alt={a.name} sx={{ maxHeight: 70, maxWidth: "90%", objectFit: "contain" }} /> : null}
                </Box>
                <CardContent sx={{ py: 0.5, px: 1 }}>
                  <Typography variant="caption" sx={{ display: "block", fontSize: 10, wordBreak: "break-all" }}>{a.name}</Typography>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
