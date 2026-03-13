import { Typography } from "@mui/material";
import { SectionCard } from "../components/shared/UiBits";

interface DemandAnalysisPlaceholderPageProps {
  title?: string;
}

/** Placeholder for Demand Analysis pages; shows "Already developed" as per requirement. */
export default function DemandAnalysisPlaceholderPage({ title = "Demand Analysis" }: DemandAnalysisPlaceholderPageProps) {
  return (
    <div className="page-scroll">
      <SectionCard title={title} subtitle="Demand Analysis workspace">
        <Typography variant="body1" color="text.secondary" sx={{ py: 2 }}>
          Already developed
        </Typography>
      </SectionCard>
    </div>
  );
}
