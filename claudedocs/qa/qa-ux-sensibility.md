# QA Report: UX Sensibility Testing

**Date**: 2026-03-25
**App Version**: v0.6.0
**Tester**: UX Tester (PH Quality Gate Visual Axis)
**Platform**: macOS (Electron)

---

## PH Quality Gate: Visual Axis (V1-V5)

### V1: Visual Polish (/20)

| Check                   | Result | Notes                                                                                  |
| ----------------------- | ------ | -------------------------------------------------------------------------------------- |
| Professional appearance | PASS   | Terminal-inspired dark theme with native macOS polish, matches Warp/Linear aesthetic   |
| Information density     | PASS   | High density without clutter -- skill name, description, source, agent count per card  |
| Typography quality      | PASS   | Inter for UI text, JetBrains Mono for code/paths -- clean and legible                  |
| Card design             | PASS   | Consistent card styling with subtle borders, good use of whitespace                    |
| Sidebar polish          | PASS   | Clean agent list with stats (linked/local counts) aligned right                        |
| Chat panel polish       | PASS   | Well-rendered markdown with headings, bold, numbered lists, code blocks                |
| Footer link             | PASS   | "skills.sh" external link at bottom -- unobtrusive but accessible                      |
| Truncation handling     | MINOR  | "Explain brainstormi..." in chat header truncates long skill names (screenshot: ux_06) |

**Score: 18/20** -- Deduction for "Explain" button text truncation on long skill names. Overall visual polish is excellent.

### V2: Consistency (/20)

| Check                     | Result | Notes                                                                                   |
| ------------------------- | ------ | --------------------------------------------------------------------------------------- |
| Card sizing               | PASS   | All skill cards have consistent width and padding                                       |
| Badge styling             | PASS   | Cyan pill badges consistent across all cards                                            |
| Icon sizing               | PASS   | Link icons, external link icons proportionally sized                                    |
| Font weight               | PASS   | Bold for names, regular for descriptions throughout                                     |
| Spacing between cards     | PASS   | Consistent gaps                                                                         |
| Border radius             | PASS   | 8px used consistently on cards, inputs, badges                                          |
| Color semantics           | PASS   | Cyan = linked/active, amber = broken, slate = missing -- consistent throughout          |
| Agent selection indicator | PASS   | Left border + bold name + "Showing skills for X" banner -- consistent across all agents |
| Panel header alignment    | PASS   | Headers aligned consistently across sidebar, grid, chat panels                          |
| Action placement          | PASS   | "+ Add" button consistently positioned on all skill cards                               |

**Score: 20/20** -- No inconsistencies detected. Visual language is uniform across all views.

### V3: Dark Theme (/20)

| Check                      | Result | Notes                                                                              |
| -------------------------- | ------ | ---------------------------------------------------------------------------------- |
| Primary text vs background | PASS   | White/near-white text on dark background -- excellent contrast                     |
| Secondary text readability | PASS   | Muted gray descriptions still clearly readable                                     |
| Card borders vs background | PASS   | Subtle but visible, distinguishes cards from background                            |
| Sidebar text contrast      | PASS   | Agent names and stats clearly readable                                             |
| Not-installed agents       | MINOR  | Slate-colored text (AdaL, Amp, etc.) is intentionally dimmed -- borderline WCAG AA |
| Search input contrast      | PASS   | Input text visible, placeholder text appropriately muted                           |
| Tab switcher contrast      | PASS   | Active "Installed" tab distinguishable from inactive "Marketplace"                 |
| Badge text on badge bg     | PASS   | White numbers on cyan badges -- high contrast                                      |
| Chat bubble contrast       | PASS   | User message bubble distinct from assistant response area                          |
| Code block contrast        | PASS   | Code blocks have distinct background from surrounding text                         |

**Score: 19/20** -- Minor: not-installed agent names could be slightly brighter for accessibility. The intentional dimming communicates "unavailable" status but is borderline.

### V4: Feedback (/20)

| Interaction                | Feedback Present | Notes                                                                           |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| Skill card hover           | YES              | Background lightening + delete icon appears (screenshot: ux_04)                 |
| Agent name hover           | YES              | Tooltip shows skills directory path e.g. `~/.codex/skills/` (screenshot: ux_03) |
| Skill card selection       | YES              | Cyan dashed border on selected card (screenshot: ux_02)                         |
| Agent filter activation    | YES              | Left border + "Showing skills for **X**" banner with Clear/X buttons            |
| Search input focus         | YES              | Visual focus ring                                                               |
| Search filtering           | YES              | Real-time filtering as text is typed (screenshot: ux_05)                        |
| Search clear button        | YES              | "x" button appears when search has content                                      |
| Chat streaming             | YES              | Three-dot loading indicator during AI response (screenshot: ux_06)              |
| Chat response complete     | YES              | Full markdown response rendered with formatting (screenshot: ux_07)             |
| "Explain" button on select | YES              | Appears in chat header when skill is selected                                   |
| Sandbox/Clear actions      | YES              | Bottom bar buttons in chat panel                                                |

**Score: 18/20** -- Deduction: could not verify loading/skeleton states for initial cold start or sync operations. Chat streaming indicator (three dots) is well-implemented.

### V5: Information Hierarchy (/20)

| Check                         | Result | Notes                                                                                 |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------- |
| 3-column layout hierarchy     | PASS   | Sidebar (navigation) > Grid (content) > Chat (assistance) -- clear left-to-right flow |
| Skill card hierarchy          | PASS   | Name (bold, large) > Description (muted) > Source (link) > Badge (count)              |
| Sidebar hierarchy             | PASS   | Source dir > Agents section heading > Agent list with stats                           |
| Agent count stats             | PASS   | Right-aligned "X linked, Y local" provides at-a-glance status                         |
| "Showing skills for X" banner | PASS   | Clear context indicator when filtering by agent                                       |
| Chat panel hierarchy          | PASS   | Header > Messages > Input area -- standard chat pattern                               |
| Version info placement        | PASS   | v0.6.0 under app title, v2.1.81 in chat header -- unobtrusive                         |
| Progressive disclosure        | PASS   | "15 not installed" collapsible section hides secondary info (screenshot: ux_04)       |
| Status at a glance            | PASS   | Cyan badges with agent counts visible on every card without interaction               |

**Score: 19/20** -- Minor: markdown table rendering issue in chat -- raw pipe syntax displayed instead of formatted table (screenshot: ux_08). This affects information hierarchy within the chat panel.

---

## Test Cases (U1-U7)

### U1: Information Hierarchy

**Result: PASS**
The 3-column layout creates a clear information hierarchy: sidebar for navigation/context, center grid for primary content (skills), right panel for contextual assistance (chat). Skill cards prioritize name > description > source > agent count. Agent sidebar shows key stats (linked/local counts) inline.

### U2: Progressive Disclosure

**Result: PASS**

- "15 not installed" section is collapsed by default, expandable on click
- Inspector/detail appears only when a skill is selected (via "Explain" button)
- Chat panel shows placeholder text until interaction
- Agent tooltip (directory path) appears only on hover

### U3: Status at a Glance

**Result: PASS**

- Cyan pill badges on every card show agent count without interaction
- Agent sidebar shows linked/local counts right-aligned for quick scanning
- "Showing skills for X" banner clearly indicates active filter
- Color-coded symlink icons on cards (cyan = linked, emerald = local) visible at card level

### U4: Cognitive Load

**Result: PASS**

- No unnecessary confirmation dialogs observed for safe actions (navigation, filtering, search)
- Agent filtering is a simple click with clear "Clear" button to reset
- Search is instant with no submit button needed
- "Explain" is one-click, not buried in menus

### U5: Consistency

**Result: PASS**

- Agent selection always produces the same pattern: left border + bold name + "Showing skills for X" + filtered grid
- All skill cards have identical layout and interaction model
- Chat panel maintains consistent layout regardless of content
- "+ Add" buttons positioned consistently across all cards

### U6: Error Communication

**Result: NOT FULLY TESTED**
Could not trigger error states during testing. The app does not show unnecessary error messages for normal operations. The chat panel has a well-structured empty state: "Ask about skills, get help managing them, or test them in a sandbox."

### U7: Navigation Flow

**Result: PASS**
The Sidebar -> Grid -> Chat flow is intuitive:

1. Select agent in sidebar -> grid filters to that agent's skills
2. Click skill card -> card highlights, "Explain" button appears in chat header
3. Click "Explain" -> chat sends query and displays AI response
4. "Clear" button in banner resets filter; search provides cross-cutting filter

The flow supports multiple workflows: browse all -> filter by agent -> examine specific skill, or search directly.

---

## Issues Found

### Minor Issues

1. **"Explain" button text truncation** (V1, V4)
   - Long skill names truncate in the chat header: "Explain brainstormi..."
   - Screenshot: `ux_06_chat_explain.png`
   - Recommendation: Use tooltip on hover, or truncate only the skill name portion

2. **Markdown table not rendering in chat** (V5)
   - Tables in chat responses display as raw pipe-delimited text instead of formatted tables
   - Screenshot: `ux_08_junie_agent.png` shows `| Principle | What It Means | |---|---|`
   - Recommendation: Add table rendering support to the markdown component

### Informational

3. **Not-installed agent contrast** (V3)
   - Agent names like AdaL, Amp, Cline use very low contrast slate text
   - Intentional design (communicates "unavailable") but borderline WCAG AA
   - No action required unless accessibility audit flags it

---

## Screenshots Reference

| File                         | Description                                                           |
| ---------------------------- | --------------------------------------------------------------------- |
| `ux_01_default_view.png`     | Default app state -- 3-column layout, all skills                      |
| `ux_02_skill_selected.png`   | Skill selected -- cyan dashed border, Explain button appears          |
| `ux_03_agent_selected.png`   | Cursor agent selected -- filtered grid, tooltip on Codex              |
| `ux_04_skill_hover.png`      | Hover state on skill card -- delete icon appears, disclosure expanded |
| `ux_05_search_filtering.png` | Search "browser" -- real-time filtering to 3 results                  |
| `ux_06_chat_explain.png`     | Chat streaming -- loading dots, user message bubble                   |
| `ux_07_chat_response.png`    | Chat response -- full markdown rendering                              |
| `ux_08_junie_agent.png`      | Junie agent -- markdown table rendering issue in chat                 |
| `ux_09_status_badges.png`    | Cursor agent view -- badge consistency, not-installed section         |

---

## Score Summary

| Axis                      | Score | Weight |
| ------------------------- | ----- | ------ |
| V1: Visual Polish         | 18/20 | 20%    |
| V2: Consistency           | 20/20 | 20%    |
| V3: Dark Theme            | 19/20 | 20%    |
| V4: Feedback              | 18/20 | 20%    |
| V5: Information Hierarchy | 19/20 | 20%    |

**Overall Score: 94/100**

---

## Verdict

**PASS** -- Skills Desktop v0.6.0 demonstrates excellent UX sensibility. The 3-column layout provides clear information hierarchy with intuitive Sidebar -> Grid -> Chat navigation flow. Progressive disclosure is well-implemented (collapsible sections, on-demand Inspector, hover tooltips). Visual consistency is flawless across all views. The two actionable issues are: (1) "Explain" button text truncation for long skill names, and (2) markdown tables rendering as raw text in chat responses. Neither blocks usability.
