import { Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useOutletContext, useParams } from "react-router-dom";

import type { SkuDetailResponse } from "../types";
import { fetchSkuDetail } from "../services/api";
import type { ShellContextValue } from "../components/layout/AppShellLayout";
import { InventoryProjectionChart, OptionTable, SectionCard } from "../components/shared/UiBits";

export default function SkuDetailPage() {
  const { sku = "", location = "" } = useParams();
  const { filters } = useOutletContext<ShellContextValue>();
  const { data } = useQuery<SkuDetailResponse>({
    queryKey: ["sku-detail", sku, location, filters.runId],
    queryFn: () => fetchSkuDetail(sku, location, filters.runId),
  });

  return (
    <div className="page-scroll">
      <div className="page-grid page-grid-two">
        <div>
          <SectionCard title={data?.recommendation.product_name ?? sku} subtitle={data?.recommendation.action}>
            <Typography variant="body2">Location: {data?.recommendation.location}</Typography>
            <Typography variant="body2">Shortage: {data?.recommendation.shortage_qty}</Typography>
            <Typography variant="body2">ETA: {data?.recommendation.eta}</Typography>
            <Typography variant="body2">{data?.recommendation.rationale}</Typography>
          </SectionCard>
        </div>
        <div>
          <SectionCard title="Inventory Projection" subtitle="Ending inventory versus safety stock">
            <InventoryProjectionChart data={data?.projection ?? []} />
          </SectionCard>
        </div>
      </div>
      <div className="page-grid page-grid-two">
        <div>
          <SectionCard title="Ranked Options" subtitle="Feasible choices ordered by deterministic score">
            <OptionTable options={data?.ranked_options ?? []} />
          </SectionCard>
        </div>
        <div>
          <SectionCard title="Policy Evidence" subtitle="RAG snippets used for explanation">
            {(data?.policy_snippets ?? []).map((snippet) => (
              <div key={snippet.title} className="evidence-card">
                <Typography variant="subtitle2">{snippet.title}</Typography>
                <Typography variant="body2">{snippet.excerpt}</Typography>
              </div>
            ))}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
