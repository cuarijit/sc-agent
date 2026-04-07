import { Typography } from "@mui/material";
import { SectionCard } from "../components/shared/UiBits";

interface DemandAnalysisPlaceholderPageProps {
  title?: string;
}

/** Placeholder for Demand Planning pages; shows "Already developed" as per requirement. */
export default function DemandAnalysisPlaceholderPage({ title = "Demand Planning" }: DemandAnalysisPlaceholderPageProps) {
  return (
    <div className="page-scroll">
      <SectionCard title={title} subtitle="Demand Planning workspace">
        <Typography variant="body1" color="text.secondary" sx={{ py: 2 }}>
          Already developed
        </Typography>
      </SectionCard>
    </div>
  );
}
