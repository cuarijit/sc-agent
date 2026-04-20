/**
 * MarkdownView — shared rendering for help / customer / documentation
 * markdown bodies. Uses react-markdown + remark-gfm so pipe tables, task
 * lists, strikethrough and autolinks render correctly. Tables are rendered
 * as MUI Table elements for proper borders, striping, and overflow handling.
 */
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownViewProps {
  content: string;
  /** Compact = drawer use; comfortable = full-page use. */
  density?: "compact" | "comfortable";
}

export default function MarkdownView({ content, density = "compact" }: MarkdownViewProps) {
  const isComfortable = density === "comfortable";
  const cellFontSize = isComfortable ? 12.5 : 11;
  const cellPadding = isComfortable ? "10px 14px" : "6px 10px";

  return (
    <Box
      className="help-markdown"
      sx={{
        fontSize: isComfortable ? 13 : 12,
        lineHeight: 1.65,
        color: "var(--text-primary)",
        "& h1": {
          fontFamily: '"Montserrat", sans-serif',
          fontSize: isComfortable ? 22 : 18,
          fontWeight: 700,
          color: "var(--text-primary)",
          mt: 0,
          mb: 1.5,
          borderBottom: "2px solid var(--accent)",
          pb: 0.75,
        },
        "& h2": {
          fontFamily: '"Montserrat", sans-serif',
          fontSize: isComfortable ? 17 : 15,
          fontWeight: 700,
          color: "var(--text-primary)",
          mt: 3,
          mb: 1,
        },
        "& h3": {
          fontFamily: '"Montserrat", sans-serif',
          fontSize: isComfortable ? 14 : 13,
          fontWeight: 700,
          color: "var(--accent)",
          mt: 2,
          mb: 0.75,
          textTransform: "uppercase",
          letterSpacing: "0.02em",
        },
        "& p": { mb: 1.25 },
        "& code": {
          fontFamily: "monospace",
          background: "rgba(38,121,168,0.10)",
          padding: "2px 6px",
          borderRadius: 3,
          fontSize: isComfortable ? 12 : 11,
        },
        "& pre": {
          background: "rgba(38,121,168,0.06)",
          padding: "10px 12px",
          borderRadius: 4,
          overflow: "auto",
          mb: 1,
          "& code": { background: "transparent", padding: 0 },
        },
        "& ul, & ol": { pl: 2.5, mb: 1.25 },
        "& li": { mb: 0.4 },
        "& a": { color: "var(--accent)", textDecoration: "none" },
        "& a:hover": { textDecoration: "underline" },
        "& blockquote": {
          borderLeft: "4px solid var(--accent)",
          margin: "0 0 16px 0",
          padding: "8px 16px",
          background: "rgba(38,121,168,0.06)",
          color: "var(--text-primary)",
          fontStyle: "italic",
          borderRadius: "0 4px 4px 0",
        },
        "& hr": {
          border: 0,
          borderTop: "1px solid var(--panel-border)",
          my: 3,
        },
        "& strong": { color: "var(--text-primary)", fontWeight: 700 },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Tables — render as MUI Table so they get proper borders, striping,
          // sticky header, and horizontal scrolling on narrow viewports.
          table: ({ children }) => (
            <TableContainer
              component={Paper}
              variant="outlined"
              sx={{
                my: 2,
                borderRadius: 1,
                borderColor: "var(--panel-border)",
                boxShadow: "none",
                overflowX: "auto",
              }}
            >
              <Table size="small" sx={{ tableLayout: "auto", minWidth: 0 }}>
                {children as ReactNode}
              </Table>
            </TableContainer>
          ),
          thead: ({ children }) => <TableHead>{children as ReactNode}</TableHead>,
          tbody: ({ children }) => (
            <TableBody
              sx={{
                "& tr:nth-of-type(even)": {
                  background: "rgba(38,121,168,0.04)",
                },
                "& tr:hover": {
                  background: "rgba(38,121,168,0.10)",
                },
              }}
            >
              {children as ReactNode}
            </TableBody>
          ),
          tr: ({ children }) => <TableRow>{children as ReactNode}</TableRow>,
          th: ({ children }) => (
            <TableCell
              sx={{
                fontWeight: 700,
                fontSize: cellFontSize,
                color: "var(--text-primary)",
                background: "linear-gradient(135deg, rgba(10,34,72,0.06), rgba(61,159,212,0.08))",
                borderBottom: "2px solid var(--accent)",
                padding: cellPadding,
                fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif',
                whiteSpace: "nowrap",
                verticalAlign: "top",
              }}
            >
              {children as ReactNode}
            </TableCell>
          ),
          td: ({ children }) => (
            <TableCell
              sx={{
                fontSize: cellFontSize,
                color: "var(--text-primary)",
                padding: cellPadding,
                borderBottom: "1px solid var(--panel-border)",
                verticalAlign: "top",
                lineHeight: 1.55,
                wordBreak: "break-word",
              }}
            >
              {children as ReactNode}
            </TableCell>
          ),
          // Headings carry IDs so deep-links work later.
          h1: ({ children }) => <Typography variant="h1" component="h1">{children as ReactNode}</Typography>,
          h2: ({ children }) => <Typography variant="h2" component="h2">{children as ReactNode}</Typography>,
          h3: ({ children }) => <Typography variant="h3" component="h3">{children as ReactNode}</Typography>,
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  );
}
