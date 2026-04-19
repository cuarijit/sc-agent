/**
 * Claude-style instance picker for the Inventory Diagnostic Console composer.
 *
 * Renders as a compact pill inside the prompt area showing the current agent
 * instance (icon + display name). Clicking opens a polished popover with one
 * card per available instance — the selected instance gets a filled primary
 * background and a checkmark, the rest are neutral but hoverable.
 *
 * Kept as its own component so the composer stays readable.
 */
import { useRef, useState } from "react";
import {
  Box,
  ButtonBase,
  Chip,
  IconButton,
  Paper,
  Popover,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import {
  AddCircleOutlineOutlined as AddIcon,
  CheckCircleRounded as CheckedIcon,
  ExpandMoreRounded as ExpandIcon,
  SmartToyOutlined as DefaultAgentIcon,
} from "@mui/icons-material";

import { resolveIcon } from "../../app/navigation/iconRegistry";
import type { AgentInstance } from "../../services/agentConfigApi";

interface Props {
  instances: AgentInstance[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

export default function InstancePickerButton({
  instances,
  selectedId,
  onSelect,
  disabled,
}: Props) {
  const theme = useTheme();
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const selected = instances.find((i) => i.instance_id === selectedId) ?? null;

  const hasInstances = instances.length > 0;

  const buttonLabel = selected
    ? selected.display_name
    : hasInstances
      ? "Pick an agent instance"
      : "No instances available";

  const SelectedIcon = selected?.icon
    ? resolveIcon(selected.icon)
    : DefaultAgentIcon;

  return (
    <>
      <Box ref={anchorRef} sx={{ display: "inline-flex" }}>
        <Tooltip
          title={
            selected?.description
              ? selected.description
              : hasInstances
                ? "Switch the agent instance driving this chat"
                : "Seed demo data to create agent instances"
          }
          placement="top"
        >
          <ButtonBase
            onClick={() => hasInstances && setOpen(true)}
            disabled={disabled || !hasInstances}
            sx={{
              borderRadius: 999,
              px: 1,
              py: 0.5,
              pr: 1.25,
              display: "inline-flex",
              alignItems: "center",
              gap: 0.75,
              border: 1,
              borderColor: selected ? alpha(theme.palette.primary.main, 0.35) : "divider",
              bgcolor: selected
                ? alpha(theme.palette.primary.main, 0.08)
                : "background.paper",
              transition: "all 0.15s",
              "&:hover": hasInstances
                ? {
                    bgcolor: selected
                      ? alpha(theme.palette.primary.main, 0.12)
                      : alpha(theme.palette.primary.main, 0.04),
                    borderColor: "primary.main",
                  }
                : {},
              "&.Mui-disabled": { opacity: 0.55 },
            }}
          >
            {selected ? (
              <SelectedIcon sx={{ fontSize: 16, color: "primary.main" }} />
            ) : (
              <AddIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            )}
            <Typography
              variant="caption"
              sx={{
                fontWeight: 600,
                fontSize: 12,
                color: selected ? "primary.main" : "text.secondary",
                maxWidth: 220,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {buttonLabel}
            </Typography>
            <ExpandIcon
              sx={{
                fontSize: 14,
                color: "text.secondary",
                transition: "transform 0.15s",
                transform: open ? "rotate(180deg)" : "none",
              }}
            />
          </ButtonBase>
        </Tooltip>
      </Box>

      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              mt: -0.5,
              borderRadius: 2.5,
              overflow: "hidden",
              minWidth: 340,
              maxWidth: 420,
              boxShadow:
                "0 10px 30px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
            },
          },
        }}
      >
        <Box
          sx={{
            px: 2,
            py: 1.25,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: alpha(theme.palette.primary.main, 0.04),
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "text.secondary" }}>
            Inventory Diagnostic Agent Farm
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.25 }}>
            Choose an agent for the diagnosis
          </Typography>
        </Box>
        <Box sx={{ py: 0.75, maxHeight: 380, overflowY: "auto" }}>
          {instances.map((inst) => {
            const isSelected = inst.instance_id === selectedId;
            const Icon = inst.icon ? resolveIcon(inst.icon) : DefaultAgentIcon;
            return (
              <InstanceRow
                key={inst.instance_id}
                instance={inst}
                selected={isSelected}
                Icon={Icon}
                onPick={() => {
                  onSelect(inst.instance_id);
                  setOpen(false);
                }}
              />
            );
          })}
        </Box>
      </Popover>
    </>
  );
}

function InstanceRow({
  instance,
  selected,
  Icon,
  onPick,
}: {
  instance: AgentInstance;
  selected: boolean;
  Icon: React.ComponentType<{ sx?: object; fontSize?: "small" | "inherit" | "medium" | "large" }>;
  onPick: () => void;
}) {
  const theme = useTheme();
  return (
    <ButtonBase
      onClick={onPick}
      sx={{
        display: "flex",
        width: "100%",
        justifyContent: "flex-start",
        px: 1.5,
        py: 1.25,
        gap: 1.25,
        textAlign: "left",
        position: "relative",
        borderRadius: 0,
        transition: "background-color 0.12s",
        bgcolor: selected ? alpha(theme.palette.primary.main, 0.08) : "transparent",
        "&:hover": {
          bgcolor: selected
            ? alpha(theme.palette.primary.main, 0.12)
            : alpha(theme.palette.primary.main, 0.04),
        },
      }}
    >
      <Box
        sx={{
          width: 34,
          height: 34,
          flexShrink: 0,
          borderRadius: 1.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: selected ? "primary.main" : alpha(theme.palette.primary.main, 0.08),
          color: selected ? "primary.contrastText" : "primary.main",
        }}
      >
        <Icon sx={{ fontSize: 18 }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.25 }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              color: selected ? "primary.main" : "text.primary",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {instance.display_name}
          </Typography>
          {selected ? (
            <Chip
              size="small"
              label="Active"
              color="primary"
              sx={{ height: 16, fontSize: 9, fontWeight: 700, letterSpacing: 0.4 }}
            />
          ) : null}
        </Stack>
        {instance.description ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              lineHeight: 1.35,
            }}
          >
            {instance.description}
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "ui-monospace, monospace" }}>
            {instance.instance_id}
          </Typography>
        )}
      </Box>
      {selected ? (
        <CheckedIcon sx={{ fontSize: 20, color: "primary.main", flexShrink: 0 }} />
      ) : null}
    </ButtonBase>
  );
}
