import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";

import type { LlmOptionsResponse, UiConfig } from "../../types";
import { testLlmConnection } from "../../services/api";

export default function ConfigDialog({
  open,
  config,
  llmOptions,
  llmApiKeys,
  onLlmApiKeyChange,
  onClose,
  onSave,
}: {
  open: boolean;
  config: UiConfig;
  llmOptions: LlmOptionsResponse | null;
  llmApiKeys: Record<string, string>;
  onLlmApiKeyChange: (provider: string, value: string) => void;
  onClose: () => void;
  onSave: (config: UiConfig) => void;
}) {
  const [draft, setDraft] = useState(config);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    if (open) {
      setDraft(config);
      setTestResult(null);
      setTestingConnection(false);
    }
  }, [config, open]);
  const providerOptions = llmOptions?.providers ?? [];
  const selectedProvider = providerOptions.find((item) => item.id === draft.llmProvider) ?? providerOptions[0];
  const modelOptions = selectedProvider?.models ?? [];
  const selectedProviderKey = draft.llmProvider || selectedProvider?.id || "openai";
  const selectedProviderLabel = selectedProvider?.label ?? "LLM";
  const selectedProviderApiKey = llmApiKeys[selectedProviderKey] ?? "";
  const providerKeyLabel = selectedProviderKey === "aws-bedrock-anthropic"
    ? "Anthropic API Key (Session Only)"
    : `${selectedProviderLabel} API Key (Session Only)`;
  const providerKeyPlaceholder = selectedProviderKey === "aws-bedrock-anthropic" ? "sk-ant-..." : "sk-...";

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Agent Settings</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="LLM Provider"
            value={draft.llmProvider}
            onChange={(event) => {
              const nextProvider = providerOptions.find((item) => item.id === event.target.value);
              setDraft({
                llmProvider: event.target.value,
                llmModel: nextProvider?.models[0]?.id ?? draft.llmModel,
              });
            }}
          >
            {providerOptions.map((provider) => (
              <MenuItem key={provider.id} value={provider.id}>{provider.label}</MenuItem>
            ))}
          </TextField>
          <TextField select label="LLM Model" value={draft.llmModel} onChange={(event) => setDraft((prev) => ({ ...prev, llmModel: event.target.value }))}>
            {modelOptions.map((model) => (
              <MenuItem key={model.id} value={model.id}>{model.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            label={providerKeyLabel}
            type="password"
            value={selectedProviderApiKey}
            onChange={(event) => onLlmApiKeyChange(selectedProviderKey, event.target.value)}
            placeholder={providerKeyPlaceholder}
          />
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="outlined"
              disabled={testingConnection || !selectedProviderApiKey.trim()}
              onClick={async () => {
                setTestingConnection(true);
                setTestResult(null);
                try {
                  const response = await testLlmConnection({
                    provider: selectedProviderKey,
                    model: draft.llmModel,
                    api_key: selectedProviderApiKey,
                  });
                  setTestResult({ ok: response.ok, message: response.message });
                } catch (error) {
                  setTestResult({
                    ok: false,
                    message: error instanceof Error ? error.message : "Connection test failed.",
                  });
                } finally {
                  setTestingConnection(false);
                }
              }}
            >
              {testingConnection ? "Testing..." : "Test Connection"}
            </Button>
            <Typography variant="caption" color="text.secondary">
              Validates provider, model, and API key.
            </Typography>
          </Stack>
          {testResult ? (
            <Alert severity={testResult.ok ? "success" : "error"}>
              {testResult.message}
            </Alert>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            This provider key is kept in memory only and is cleared after refresh/restart.
          </Typography>
          {selectedProviderKey === "aws-bedrock-anthropic" ? (
            <Alert severity="info">
              Use an Anthropic API key for this provider path. AWS IAM/Bedrock access keys are not accepted in this field.
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => { onSave(draft); onClose(); }}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
