import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  Divider,
  InputBase,
  List,
  ListItemButton,
  ListItemText,
  Box,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { NAV_MODULES } from "../../app/navigation";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const allItems = NAV_MODULES.flatMap((mod) =>
    mod.items.map((item) => ({ ...item, moduleLabel: mod.label })),
  );

  const filtered = query.trim()
    ? allItems.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.moduleLabel.toLowerCase().includes(query.toLowerCase()),
      )
    : allItems;

  // Group by module for display when no query
  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, item) => {
    (acc[item.moduleLabel] ??= []).push(item);
    return acc;
  }, {});

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSelect = (route: string) => {
    navigate(route);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{ backdrop: { sx: { backgroundColor: "rgba(0,0,0,0.55)" } } }}
      PaperProps={{
        sx: {
          borderRadius: 2,
          overflow: "hidden",
          mt: "14vh",
          mx: "auto",
          verticalAlign: "top",
        },
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        {/* Search bar */}
        <Box sx={{ display: "flex", alignItems: "center", px: 2, py: 1.5 }}>
          <SearchIcon sx={{ color: "text.secondary", mr: 1.5, fontSize: 20, flexShrink: 0 }} />
          <InputBase
            inputRef={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages…"
            fullWidth
            sx={{ fontSize: 13 }}
            inputProps={{ "aria-label": "command palette search" }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1, flexShrink: 0, opacity: 0.7 }}>
            ⌘K
          </Typography>
        </Box>
        <Divider />
        {/* Results */}
        <List dense disablePadding sx={{ maxHeight: 360, overflow: "auto" }}>
          {query.trim()
            ? filtered.map((item) => (
                <ListItemButton key={item.id} onClick={() => handleSelect(item.route)} sx={{ py: 0.9, px: 2 }}>
                  <ListItemText
                    primary={item.label}
                    secondary={item.moduleLabel}
                    slotProps={{
                      primary: { sx: { fontSize: 13, fontWeight: 500 } },
                      secondary: { sx: { fontSize: 11 } },
                    }}
                  />
                </ListItemButton>
              ))
            : Object.entries(grouped).map(([moduleLabel, items], i) => (
                <Box key={moduleLabel}>
                  {i > 0 && <Divider />}
                  <Box sx={{ px: 2, py: 0.6, bgcolor: "action.hover" }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {moduleLabel}
                    </Typography>
                  </Box>
                  {items.map((item) => (
                    <ListItemButton key={item.id} onClick={() => handleSelect(item.route)} sx={{ py: 0.8, px: 2 }}>
                      <ListItemText
                        primary={item.label}
                        slotProps={{ primary: { sx: { fontSize: 13 } } }}
                      />
                    </ListItemButton>
                  ))}
                </Box>
              ))}
          {filtered.length === 0 && (
            <Box sx={{ py: 4, textAlign: "center" }}>
              <Typography variant="caption" color="text.secondary">
                No results for "{query}"
              </Typography>
            </Box>
          )}
        </List>
      </DialogContent>
    </Dialog>
  );
}
