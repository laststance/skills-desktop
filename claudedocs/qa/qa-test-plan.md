# QA Test Plan - Skills Desktop

## Platform

- **Type**: Electron desktop app (macOS)
- **Purpose**: Visualize Skills symlink status across 22 AI agents
- **Testing MCP**: `mcp__electron__take_screenshot`, `mcp__electron__send_command_to_electron`
- **Prerequisite**: `pnpm dev` running (debug port 9222)

---

## Test Areas

### 1. Visual Integrity (Task #2 - visual-tester)

| ID  | Test                 | Verify                                                        |
| --- | -------------------- | ------------------------------------------------------------- |
| V1  | Dark theme rendering | OKLCH colors, contrast, no clipping                           |
| V2  | Sidebar agent list   | 22 agents listed, icons/names visible, scroll                 |
| V3  | Skill grid layout    | Cards render correctly, status colors (cyan/amber/slate)      |
| V4  | Inspector panel      | Opens on skill select, detail content renders                 |
| V5  | Chat panel           | Message bubbles, markdown rendering, streaming skeleton       |
| V6  | Typography           | Inter for UI, JetBrains Mono for code/paths                   |
| V7  | Resizable panels     | Drag handles visible, panels resize correctly                 |
| V8  | Search box           | Renders in correct position, placeholder text                 |
| V9  | Status indicators    | Symlink badges: valid (cyan), broken (amber), missing (slate) |
| V10 | Window chrome        | Title bar, drag region, traffic lights position               |

### 2. Functional Correctness (Task #3 - functional-tester)

| ID  | Test                  | Verify                                              |
| --- | --------------------- | --------------------------------------------------- |
| F1  | Agent selection       | Click agent -> skills list updates                  |
| F2  | Skill selection       | Click skill -> Inspector shows detail               |
| F3  | Search filtering      | Type query -> skills filter in real-time            |
| F4  | Context menu - agent  | Right-click agent -> menu appears with options      |
| F5  | Context menu - skill  | Right-click skill -> menu with Unlink/Copy/Delete   |
| F6  | Add symlink modal     | Opens, shows agent list, creates symlink            |
| F7  | Copy to agents modal  | Opens, multi-select agents, copies skill            |
| F8  | Delete skill dialog   | Confirmation dialog, deletes on confirm             |
| F9  | Unlink dialog         | Confirmation, removes symlink                       |
| F10 | Chat panel            | Send message, receive response, markdown render     |
| F11 | Auto-update toast     | UpdateToast component renders when update available |
| F12 | Panel collapse/expand | Inspector and sidebar collapse/expand correctly     |

### 3. Apple HIG Compliance (Task #4 - hig-tester)

| ID  | Test                | Verify                                            |
| --- | ------------------- | ------------------------------------------------- |
| H1  | Tap targets         | All interactive elements >= 44x44px               |
| H2  | Keyboard navigation | Tab order logical, focus rings visible            |
| H3  | Color contrast      | WCAG 2.2 AA+ for text on backgrounds              |
| H4  | Spacing grid        | 4/8px grid alignment, 16/20/24px margins          |
| H5  | Corner radius       | Consistent 4/8/12/20px by hierarchy               |
| H6  | Motion              | Transitions meaningful, not gratuitous            |
| H7  | Window behavior     | Native macOS window controls, drag region         |
| H8  | Scrolling           | Native scroll physics, no custom scroll artifacts |
| H9  | Selection states    | Clear visual feedback on hover/active/selected    |
| H10 | Dialog patterns     | Modal dialogs follow HIG overlay pattern          |

### 4. Edge Cases (Task #5 - edge-case-tester, blocked by #3)

| ID  | Test                        | Verify                                     |
| --- | --------------------------- | ------------------------------------------ |
| E1  | Empty state - no skills     | Graceful empty state message               |
| E2  | Long skill names            | Text truncation, no layout break           |
| E3  | Rapid clicks                | No duplicate modals, no race conditions    |
| E4  | Search with no results      | Empty state for zero matches               |
| E5  | All agents selected         | Performance with full agent list           |
| E6  | Panel resize extremes       | Min/max constraints respected              |
| E7  | Broken symlinks             | Amber status, no crash on hover/click      |
| E8  | Special characters in names | Paths with spaces/unicode render correctly |

### 5. UX Sensibility (Task #6 - ux-tester, blocked by #2)

| ID  | Test                   | Verify                                               |
| --- | ---------------------- | ---------------------------------------------------- |
| U1  | Information hierarchy  | Most important info most prominent                   |
| U2  | Progressive disclosure | Detail only when needed (Inspector pattern)          |
| U3  | Status at a glance     | Symlink states readable in peripheral vision         |
| U4  | Cognitive load         | No unnecessary confirmation dialogs for safe actions |
| U5  | Consistency            | Similar actions behave similarly across the app      |
| U6  | Error communication    | Errors are clear, actionable, non-technical          |
| U7  | Navigation flow        | Sidebar -> Grid -> Inspector flow is intuitive       |

---

## Scoring (Task #8)

| Category               | Weight |
| ---------------------- | ------ |
| Visual Integrity       | 25%    |
| Functional Correctness | 30%    |
| Apple HIG Compliance   | 15%    |
| Edge Cases             | 15%    |
| UX Sensibility         | 15%    |

**Thresholds**: >= 85 PASS | 65-84 CONDITIONAL | < 65 FAIL

## Report Locations

- Individual: `claudedocs/qa/<category>-report.md`
- Summary: `claudedocs/qa/qa-summary.md`
