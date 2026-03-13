# Horizontal Page Overflow Analysis Report
**Date**: March 13, 2026  
**Component**: On-Demand Analysis Agent (Analytics Page)  
**File**: `frontend/src/components/layout/GlobalFilterChatbotModal.tsx`

---

## Executive Summary

Horizontal page overflow occurs in the On-Demand Analysis tab when:
1. Multiple measure fields are selected (long concatenated text in Select renderValue)
2. Heatmap chart type is selected with many dimensions (grid exceeds container width)
3. Chart controls grid doesn't adapt properly to narrow containers

**Root Cause**: Multiple `overflowX: "hidden"` declarations throughout the component hierarchy hide overflow instead of preventing it or allowing proper scrolling.

---

## Detailed Findings

### 1. **PRIMARY ISSUE: Measure Fields Select - renderValue Overflow**
**Location**: Lines 1234-1248 in `GlobalFilterChatbotModal.tsx`

**Code**:
```tsx
<Select
  multiple
  label="Measure Fields"
  value={chartMeasures}
  onChange={(event) => {
    const value = event.target.value;
    setChartMeasures(typeof value === "string" ? value.split(",") : value);
  }}
  renderValue={(selected) => (selected as string[]).join(", ")}
>
```

**Problem**: 
- When 3+ measures are selected, `renderValue` creates unbounded text like "order_qty, safety_stock_qty, reorder_point_qty, lead_time_days, service_level_pct"
- MUI Select component renders this text in a fixed-width container
- Text overflows horizontally, pushing the entire form control beyond its container bounds
- Parent containers have `overflowX: "hidden"` which hides but doesn't fix the layout issue

**Impact**: HIGH - Occurs frequently when users explore multiple measures

---

### 2. **SECONDARY ISSUE: Heatmap Grid Overflow**
**Location**: Lines 540-600 in `GlobalFilterChatbotModal.tsx`

**Code**:
```tsx
<Box sx={{ 
  display: "flex", 
  flexDirection: "column", 
  gap: 0.5, 
  overflowX: "hidden",  // ← PROBLEM
  overflowY: "auto", 
  height: "100%" 
}}>
  {/* ... */}
  <Box sx={{ 
    display: "grid", 
    gridTemplateColumns: `110px repeat(${x.length}, minmax(0, 1fr))`,  // ← Can create 17 columns
    gap: 0.5, 
    width: "100%"  // ← Width is 100% of parent, but grid content can exceed
  }}>
```

**Problem**:
- Heatmap can have up to 16 x-dimension columns (line 436: `x.slice(0, 16)`)
- Plus 110px label column = 17 total columns
- Grid uses `minmax(0, 1fr)` which allows columns to shrink, but with 17 columns the total width can still exceed container
- Parent has `overflowX: "hidden"` instead of `overflowX: "auto"`
- Grid content gets clipped instead of scrolling

**Impact**: MEDIUM - Occurs when heatmap is selected with high-cardinality dimensions

---

### 3. **TERTIARY ISSUE: Chart Controls Grid Layout**
**Location**: Lines 1188-1249 in `GlobalFilterChatbotModal.tsx`

**Code**:
```tsx
<Box
  sx={{
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 0.8,
    width: "100%",
  }}
>
  <FormControl size="small" sx={{ minWidth: 0, width: "100%" }}>
    <InputLabel>Chart Type</InputLabel>
    <Select>...</Select>
  </FormControl>
  <FormControl size="small" sx={{ minWidth: 0, width: "100%" }}>
    <InputLabel>X Dimension</InputLabel>
    <Select>...</Select>
  </FormControl>
  {chartType === "heatmap" ? (
    <FormControl size="small" sx={{ minWidth: 0, width: "100%" }}>
      <InputLabel>Y Dimension</InputLabel>
      <Select>...</Select>
    </FormControl>
  ) : null}
  <FormControl size="small" sx={{ minWidth: 0, width: "100%" }}>
    <InputLabel>Measure Fields</InputLabel>
    <Select>...</Select>  {/* ← THIS IS THE OVERFLOW SOURCE */}
  </FormControl>
</Box>
```

**Problem**:
- `auto-fit` with `minmax(140px, 1fr)` creates responsive columns
- When heatmap is selected, 4 FormControls render
- In narrow containers (split pane at ~42% width), 4 × 140px = 560px minimum
- If container is < 560px, grid overflows
- Combined with Issue #1 (Measure Fields renderValue), overflow is exacerbated

**Impact**: MEDIUM - Occurs on narrow screens or when split pane is adjusted

---

### 4. **ARCHITECTURAL ISSUE: Nested overflowX: "hidden"**
**Locations**: Multiple lines in `GlobalFilterChatbotModal.tsx`

**Instances**:
1. Line 546: Heatmap container - `overflowX: "hidden"`
2. Line 712: DialogContent - `overflowX: embedded ? "hidden" : "hidden"`
3. Line 723: Split container - `overflowX: embedded ? "hidden" : "hidden"`
4. Line 1250: Chart rendering box - `overflowX: "hidden"`
5. Line 1368: Embedded container - `overflowX: "hidden"`

**Problem**:
- `overflow: hidden` clips content instead of allowing scroll
- Nested `overflow: hidden` at multiple levels compounds the issue
- Content that exceeds bounds is hidden, but layout is still affected
- Browser may add scrollbar to `body` or `.page-scroll` (line 266 in styles.css) as last resort

**Impact**: HIGH - Architectural issue affecting all overflow scenarios

---

## Reproduction Steps

### Test Case 1: Measure Fields Overflow (PRIMARY)
1. Open http://localhost:5173
2. Navigate to Analytics page (likely in main nav)
3. Click "On-Demand Analysis" tab
4. Enter query: `show all critical alert orders`
5. Wait for tabular data with numeric columns to load
6. In chart section:
   - Select Chart Type: "Bar"
   - Select X Dimension: any column (e.g., "location")
   - **Select 5+ measure fields** in "Measure Fields" dropdown
7. **OBSERVE**: 
   - Select component's rendered value shows long concatenated text
   - Text may overflow the Select's visual bounds
   - Check browser DevTools: Inspect `.MuiSelect-select` element
   - Check for horizontal scrollbar on page body or `.page-scroll`

### Test Case 2: Heatmap Grid Overflow (SECONDARY)
1. Continue from Test Case 1 or start fresh
2. Enter query: `show order counts by sku and location`
3. In chart section:
   - Select Chart Type: "Heatmap"
   - Select X Dimension: column with high cardinality (e.g., "sku")
   - Select Y Dimension: another column (e.g., "location")
   - Select Measure: any numeric column
4. **OBSERVE**:
   - Heatmap grid renders with many columns
   - Grid may extend beyond visible area
   - Check browser DevTools: Inspect the Box with `gridTemplateColumns`
   - Look for clipped content (no scrollbar due to `overflow: hidden`)

### Test Case 3: Narrow Container Overflow (TERTIARY)
1. Continue from any previous test
2. Resize browser window to 1024px width or narrower
3. Ensure split pane is visible (not collapsed)
4. Select Chart Type: "Heatmap" (adds 4th FormControl)
5. **OBSERVE**:
   - Chart controls may wrap or overflow
   - Check browser DevTools: Inspect grid container at line 1188
   - Measure computed width vs parent width

---

## DOM/Layout Root Cause

### Layout Flow
```
.page-scroll (overflow: auto)                    ← styles.css line 266
  └─ SectionCard
      └─ GlobalFilterChatbotModal (embedded)
          └─ Box (overflowX: "hidden")            ← line 1368
              └─ DialogContent (overflowX: "hidden")  ← line 712
                  └─ Split Container (overflowX: "hidden")  ← line 723
                      └─ Result Grid Pane
                          └─ Chart Section Box (minHeight: 0)  ← line 1186
                              └─ Chart Controls Grid (auto-fit)  ← line 1188
                                  └─ Measure Fields Select
                                      └─ renderValue: UNBOUNDED TEXT ← OVERFLOW SOURCE
                              └─ Chart Render Box (overflowX: "hidden")  ← line 1250
                                  └─ Heatmap Grid (17 columns) ← OVERFLOW SOURCE
```

### Why Overflow Occurs
1. **Measure Fields Select**: MUI Select renders selected values in a `<div>` with fixed width. When `renderValue` returns long text, the div's content overflows. The Select component itself has `width: "100%"` but the rendered text inside doesn't wrap.

2. **Heatmap Grid**: CSS Grid with 17 columns and `minmax(0, 1fr)` can still exceed parent width when columns can't shrink below content size. The grid's `width: "100%"` refers to parent width, but grid content width is determined by column count and content.

3. **Nested overflow: hidden**: Each parent with `overflow: hidden` clips content, but the layout engine still calculates the child's full width. This can cause the browser to add scrollbars at higher levels (body or .page-scroll).

---

## Recommended Fixes

### Fix 1: Measure Fields Select renderValue (HIGH PRIORITY)
**File**: `frontend/src/components/layout/GlobalFilterChatbotModal.tsx`  
**Line**: 1244

**Current**:
```tsx
renderValue={(selected) => (selected as string[]).join(", ")}
```

**Recommended**:
```tsx
renderValue={(selected) => {
  const items = selected as string[];
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return items.join(", ");
  return `${items.length} measures selected`;
}}
```

**Alternative** (show first 2 + count):
```tsx
renderValue={(selected) => {
  const items = selected as string[];
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return items.join(", ");
  return `${items.slice(0, 2).join(", ")} +${items.length - 2} more`;
}}
```

---

### Fix 2: Heatmap Container Overflow (MEDIUM PRIORITY)
**File**: `frontend/src/components/layout/GlobalFilterChatbotModal.tsx`  
**Line**: 546

**Current**:
```tsx
<Box sx={{ 
  display: "flex", 
  flexDirection: "column", 
  gap: 0.5, 
  overflowX: "hidden", 
  overflowY: "auto", 
  height: "100%" 
}}>
```

**Recommended**:
```tsx
<Box sx={{ 
  display: "flex", 
  flexDirection: "column", 
  gap: 0.5, 
  overflowX: "auto",  // Changed from "hidden"
  overflowY: "auto", 
  height: "100%",
  maxWidth: "100%"  // Added
}}>
```

---

### Fix 3: Chart Controls Grid Responsive Layout (MEDIUM PRIORITY)
**File**: `frontend/src/components/layout/GlobalFilterChatbotModal.tsx`  
**Line**: 1189-1194

**Current**:
```tsx
<Box
  sx={{
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 0.8,
    width: "100%",
  }}
>
```

**Recommended** (fixed breakpoints):
```tsx
<Box
  sx={{
    display: "grid",
    gridTemplateColumns: { 
      xs: "1fr",  // Mobile: 1 column
      sm: "repeat(2, 1fr)",  // Tablet: 2 columns
      md: "repeat(2, 1fr)",  // Medium: 2 columns
      lg: "repeat(4, 1fr)"   // Large: 4 columns (when space allows)
    },
    gap: 0.8,
    width: "100%",
  }}
>
```

**Alternative** (keep auto-fit but add max-width):
```tsx
<Box
  sx={{
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 0.8,
    width: "100%",
    maxWidth: "100%",  // Added
    overflowX: "auto"  // Added - allow horizontal scroll if needed
  }}
>
```

---

### Fix 4: Chart Rendering Container (LOW PRIORITY)
**File**: `frontend/src/components/layout/GlobalFilterChatbotModal.tsx`  
**Line**: 1250

**Current**:
```tsx
<Box sx={{ flex: 1, minHeight: 0, width: "100%", overflowX: "hidden" }}>
```

**Recommended**:
```tsx
<Box sx={{ 
  flex: 1, 
  minHeight: 0, 
  width: "100%", 
  maxWidth: "100%",  // Added
  overflowX: "auto"  // Changed from "hidden"
}}>
```

---

### Fix 5: Remove Redundant overflowX: "hidden" (OPTIONAL)
**File**: `frontend/src/components/layout/GlobalFilterChatbotModal.tsx`  
**Lines**: 712, 723, 1368

**Rationale**: If child components handle overflow properly (Fixes 1-4), parent containers don't need `overflowX: "hidden"`. Consider changing to `overflowX: "auto"` or removing entirely.

**Current** (line 712):
```tsx
<DialogContent
  dividers
  sx={{
    p: 0,
    minHeight: embedded ? 720 : 0,
    display: "flex",
    overflowX: embedded ? "hidden" : "hidden",
    overflowY: embedded ? "visible" : "hidden",
    bgcolor: "#f6faff",
  }}
>
```

**Recommended**:
```tsx
<DialogContent
  dividers
  sx={{
    p: 0,
    minHeight: embedded ? 720 : 0,
    display: "flex",
    overflowX: "clip",  // Modern alternative to "hidden", doesn't affect layout
    overflowY: embedded ? "visible" : "hidden",
    bgcolor: "#f6faff",
  }}
>
```

---

## Testing Checklist

After applying fixes, test:

- [ ] Select 5+ measures in Bar chart - renderValue should show count, not overflow
- [ ] Select 5+ measures in Line chart - same as above
- [ ] Select Heatmap with high-cardinality dimensions - grid should scroll horizontally
- [ ] Resize browser to 1024px width - chart controls should wrap or scroll
- [ ] Collapse/expand split pane - no horizontal page scrollbar
- [ ] Test on mobile viewport (< 960px) - responsive grid should show 1-2 columns
- [ ] Check browser DevTools: no elements with computed width > viewport width (except scrollable containers)

---

## Additional Notes

### MUI Select Behavior
MUI Select component uses a `<div>` with `overflow: hidden` and `text-overflow: ellipsis` by default, but this only works for single-line text. When `renderValue` returns long text without wrapping, the ellipsis doesn't apply and the text overflows the Select's bounds.

### CSS Grid auto-fit vs auto-fill
- `auto-fit`: Collapses empty tracks, fits content to available space
- `auto-fill`: Creates as many tracks as fit, even if empty

Current code uses `auto-fit` which is correct, but the `minmax(140px, 1fr)` can still cause overflow when container is narrow.

### Browser Scrollbar Behavior
When nested elements have `overflow: hidden` but content exceeds bounds, browsers may add scrollbar to the nearest ancestor with `overflow: auto` (in this case, `.page-scroll`). This creates page-level horizontal scroll instead of component-level scroll.

---

## Conclusion

**Primary Issue**: Measure Fields Select renderValue creates unbounded text  
**Secondary Issue**: Heatmap grid with many columns exceeds container width  
**Architectural Issue**: Multiple `overflowX: "hidden"` declarations hide overflow instead of fixing layout

**Recommended Priority**:
1. Fix 1 (Measure Fields renderValue) - HIGH - Quick fix, high impact
2. Fix 2 (Heatmap overflow) - MEDIUM - Moderate fix, medium impact
3. Fix 3 (Chart controls grid) - MEDIUM - Moderate fix, medium impact
4. Fix 4 & 5 (Container overflow) - LOW - Optional, improves architecture

**Estimated Effort**: 30-60 minutes for all fixes
