import { Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";

import type { ShellContextValue } from "../components/layout/AppShellLayout";
import type { DocumentSearchResult, MasterDataOptions } from "../types";
import { fetchMasterDataOptions, ingestDocuments, searchDocuments } from "../services/api";
import { SectionCard } from "../components/shared/UiBits";

export default function DocumentSearchPage() {
  const { filters } = useOutletContext<ShellContextValue>();
  const [query, setQuery] = useState("incoterm lead time expedite");
  const [vendor, setVendor] = useState(filters.supplier);
  useEffect(() => {
    setVendor(filters.supplier);
  }, [filters.supplier]);
  const searchMutation = useMutation<{ results: DocumentSearchResult[] }>({
    mutationFn: () => searchDocuments(query, vendor),
  });
  const ingestMutation = useMutation({ mutationFn: ingestDocuments });
  const { data: options } = useQuery<MasterDataOptions>({ queryKey: ["master-data-options"], queryFn: fetchMasterDataOptions });

  return (
    <div className="page-scroll">
      <SectionCard title="Vendor Document Search" subtitle="Elasticsearch-backed when available, SQLite fallback otherwise">
        <Stack spacing={1.2}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <TextField fullWidth label="Search query" value={query} onChange={(event) => setQuery(event.target.value)} />
            <TextField select label="Vendor" value={vendor} onChange={(event) => setVendor(event.target.value)} sx={{ minWidth: 240 }}>
              <MenuItem value="">All vendors</MenuItem>
              {(options?.supplier_records ?? []).map((item) => <MenuItem key={item.code} value={item.name}>{item.name}</MenuItem>)}
            </TextField>
            <Button variant="contained" onClick={() => searchMutation.mutate()}>Search</Button>
            <Button variant="outlined" onClick={() => ingestMutation.mutate()}>Reindex Docs</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Seeded vendor PDFs cover incoterm and lead-time examples for SweetSource, CaliSnacks, and HydraCo.
          </Typography>
          {(searchMutation.data?.results ?? []).map((result) => (
            <div key={`${result.title}-${result.source_path}`} className="evidence-card">
              <Typography variant="subtitle2">{result.title}</Typography>
              <Typography variant="caption" color="text.secondary">{result.vendor} · {result.topic} · {result.document_type}</Typography>
              <Typography variant="body2">{result.excerpt}</Typography>
              <Typography variant="caption" color="text.secondary">{result.source_path}</Typography>
            </div>
          ))}
        </Stack>
      </SectionCard>
    </div>
  );
}
