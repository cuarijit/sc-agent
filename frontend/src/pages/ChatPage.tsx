import { Button, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useOutletContext, useSearchParams } from "react-router-dom";

import type { ChatResponse } from "../types";
import { explain } from "../services/api";
import { SectionCard } from "../components/shared/UiBits";
import type { ShellContextValue } from "../components/layout/AppShellLayout";
import { firstFilterValue } from "../types/filters";

export default function ChatPage() {
  const { config, filters } = useOutletContext<ShellContextValue>();
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get("mode") === "parameter" ? "parameter" : "recommendation";
  const [question, setQuestion] = useState("Why is transfer better than alternate supplier for BAR-002?");
  const [mode, setMode] = useState<"recommendation" | "parameter">(initialMode);
  const selectedSku = firstFilterValue(filters.sku) || "BAR-002";
  const selectedLocation = firstFilterValue(filters.location) || "DC-CHI";
  const mutation = useMutation<ChatResponse>({
    mutationFn: () =>
      explain(
        {
          question,
          sku: selectedSku,
          location: selectedLocation,
          llm_provider: config.llmProvider,
          llm_model: config.llmModel,
        },
        mode === "parameter",
      ),
  });

  return (
    <div className="page-scroll">
      <SectionCard title="Planner Chat" subtitle="LLM explanation over deterministic recommendations and policy evidence">
        <Stack spacing={1}>
          <Stack direction="row" spacing={1}>
            <button className={`mode-pill ${mode === "recommendation" ? "mode-pill-active" : ""}`} onClick={() => setMode("recommendation")}>
              Recommendation
            </button>
            <button className={`mode-pill ${mode === "parameter" ? "mode-pill-active" : ""}`} onClick={() => setMode("parameter")}>
              Parameter
            </button>
          </Stack>
          <TextField multiline minRows={3} value={question} onChange={(event) => setQuestion(event.target.value)} />
          <Button variant="contained" onClick={() => mutation.mutate()}>Ask</Button>
          {mutation.data ? (
            <div className="chat-response">
              <Typography variant="body1">{mutation.data.answer}</Typography>
              <Typography variant="caption" color="text.secondary">
                Provider: {mutation.data.selected_llm_provider} · Model: {mutation.data.selected_llm_model} · Invoked: {String(mutation.data.llm_invoked)}
              </Typography>
              {mutation.data.citations.map((citation) => (
                <div key={citation.title} className="evidence-card">
                  <Typography variant="subtitle2">{citation.title}</Typography>
                  <Typography variant="body2">{citation.excerpt}</Typography>
                </div>
              ))}
            </div>
          ) : null}
        </Stack>
      </SectionCard>
    </div>
  );
}
