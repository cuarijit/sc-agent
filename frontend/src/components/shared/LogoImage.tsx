import type { CSSProperties } from "react";
import { Box } from "@mui/material";

interface LogoImageProps {
  path?: string | null;
  fallback?: string | null;
  alt: string;
  height?: number;
  width?: number | "auto";
  style?: CSSProperties;
  className?: string;
}

export default function LogoImage({ path, fallback, alt, height, width, style, className }: LogoImageProps) {
  const src = path || fallback || "";
  if (!src) return null;
  return (
    <Box
      component="img"
      src={src}
      alt={alt}
      onError={(event) => {
        const target = event.currentTarget as HTMLImageElement;
        if (target.dataset.fallbackApplied === "true") return;
        target.dataset.fallbackApplied = "true";
        if (fallback && fallback !== src) {
          target.src = fallback;
        } else {
          target.style.display = "none";
        }
      }}
      className={className}
      sx={{
        height: height ?? "auto",
        width: width ?? "auto",
        maxHeight: "100%",
        objectFit: "contain",
        ...(style ?? {}),
      }}
    />
  );
}
