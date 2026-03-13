import { Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import type { EffectiveParameterValue, ParameterException } from "../types";
import { fetchEffectiveParameters, fetchParameterExceptions } from "../services/api";
import { EffectiveValueTable, ParameterExceptionTable, SectionCard } from "../components/shared/UiBits";

export default function ParameterDetailPage() {
  const { sku = "", location = "" } = useParams();
  const { data: values } = useQuery<EffectiveParameterValue[]>({
    queryKey: ["parameter-values", sku, location],
    queryFn: () => fetchEffectiveParameters(sku, location),
  });
  const { data: exceptions } = useQuery<ParameterException[]>({
    queryKey: ["parameter-detail-exceptions", sku, location],
    queryFn: () => fetchParameterExceptions(new URLSearchParams({ sku, location })),
  });

  return (
    <div className="page-scroll">
      <div className="page-grid page-grid-two">
        <div>
          <SectionCard title={`${sku} at ${location}`} subtitle="Effective parameter trace">
            <EffectiveValueTable rows={values ?? []} />
          </SectionCard>
        </div>
        <div>
          <SectionCard title="Open Recommendations" subtitle="Current exception queue for this product-location">
            <ParameterExceptionTable rows={exceptions ?? []} />
            <Typography variant="body2" sx={{ mt: 1 }}>
              Apply actions from the Parameters workbench to keep audit updates centralized.
            </Typography>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
