# Graph Report - .  (2026-10-02)

## Corpus Check
- Corpus is ~4,929 words - fits in a single context window. You may not need a graph.

## Summary
- 29 nodes · 40 edges · 7 communities (5 shown, 2 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Question Storage & Routing|Question Storage & Routing]]
- [[_COMMUNITY_LLM Classification Stack|LLM Classification Stack]]
- [[_COMMUNITY_Curriculum Graph Pipeline|Curriculum Graph Pipeline]]
- [[_COMMUNITY_ASKKUP Product Scope|ASKKUP Product Scope]]
- [[_COMMUNITY_App Tech Stack|App Tech Stack]]
- [[_COMMUNITY_Mindmap vs Existing Services|Mindmap vs Existing Services]]
- [[_COMMUNITY_Question Refinement Motivation|Question Refinement Motivation]]

## God Nodes (most connected - your core abstractions)
1. `ASKKUP Implementation Plan` - 13 edges
2. `ASKKUP Hackathon Project Overview` - 8 edges
3. `Repository Guidelines (AGENTS.md)` - 5 edges
4. `Hybrid Concept Classification (embedding top-k + LLM)` - 4 edges
5. `classify_question_job` - 4 edges
6. `FastAPI Server` - 3 edges
7. `Three Stores: Curriculum Graph / student_questions / teacher_questions` - 3 edges
8. `LLM Role Split QUESTION/CURRICULUM/EMBEDDING` - 3 edges
9. `ASKKUP (질문, 잇다) App` - 2 edges
10. `Electron Desktop App (React+TS)` - 2 edges

## Surprising Connections (you probably didn't know these)
- `MindMap Component (depth-1 expand)` --semantically_similar_to--> `Existing Services (Echo360, ClassPoint, Slido, Mentimeter, Perusall, Top Hat)`  [INFERRED] [semantically similar]
  docs/PLAN.md → references/질문, 잇다 ASKKUP 해커톤 프로젝트 개요.pdf
- `ASKKUP (질문, 잇다) App` --conceptually_related_to--> `ASKKUP Hackathon Project Overview`  [INFERRED]
  AGENTS.md → references/질문, 잇다 ASKKUP 해커톤 프로젝트 개요.pdf
- `ASKKUP Implementation Plan` --references--> `Proactive Question Presentation (optional)`  [EXTRACTED]
  docs/PLAN.md → references/질문, 잇다 ASKKUP 해커톤 프로젝트 개요.pdf
- `ASKKUP Implementation Plan` --cites--> `ASKKUP Hackathon Project Overview`  [EXTRACTED]
  docs/PLAN.md → references/질문, 잇다 ASKKUP 해커톤 프로젝트 개요.pdf
- `Question Refinement with Confirmation Loop` --rationale_for--> `Reasons Students Don't Ask (psychological/cognitive/cultural)`  [INFERRED]
  docs/PLAN.md → references/질문, 잇다 ASKKUP 해커톤 프로젝트 개요.pdf

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Student question submission flow** — docs_plan_student_overlay, docs_plan_question_refinement, docs_plan_content_filtering, docs_plan_classify_question_job, docs_plan_live_session [EXTRACTED 1.00]

## Communities (7 total, 2 thin omitted)

### Community 0 - "Question Storage & Routing"
Cohesion: 0.29
Nodes (7): classify_question_job, Live Session (6-char code, WebSocket feed), Automatic Off-week Question Reassignment, Structural Anonymity (teacher_questions has no student id), Three Stores: Curriculum Graph / student_questions / teacher_questions, Anonymous Questioning Benefit, Linking Questions to Syllabus Weeks

### Community 1 - "LLM Classification Stack"
Cohesion: 0.40
Nodes (5): ChatModel, Embedder, Hybrid Concept Classification (embedding top-k + LLM), LLM Role Split QUESTION/CURRICULUM/EMBEDDING, Five Question Types (info_seeking ... reflective)

### Community 2 - "Curriculum Graph Pipeline"
Cohesion: 0.40
Nodes (5): Curriculum Graph Pipeline (syllabus parse, week generation), 인공지능개론 16-week Demo Syllabus, generate_week_job, ASKKUP Implementation Plan, Transparent Student Overlay (pen/eraser)

### Community 3 - "ASKKUP Product Scope"
Cohesion: 0.50
Nodes (4): ASKKUP (질문, 잇다) App, Inappropriate Expression Filter + Teacher Banned Words, Proactive Question Presentation (optional), ASKKUP Hackathon Project Overview

### Community 4 - "App Tech Stack"
Cohesion: 0.83
Nodes (4): Electron Desktop App (React+TS), FastAPI Server, Repository Guidelines (AGENTS.md), SQLite Database

## Knowledge Gaps
- **5 isolated node(s):** `Transparent Student Overlay (pen/eraser)`, `Five Question Types (info_seeking ... reflective)`, `ChatModel`, `generate_week_job`, `인공지능개론 16-week Demo Syllabus`
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ASKKUP Implementation Plan` connect `Curriculum Graph Pipeline` to `Question Storage & Routing`, `LLM Classification Stack`, `ASKKUP Product Scope`, `App Tech Stack`, `Mindmap vs Existing Services`, `Question Refinement Motivation`?**
  _High betweenness centrality (0.726) - this node is a cross-community bridge._
- **Why does `ASKKUP Hackathon Project Overview` connect `ASKKUP Product Scope` to `Question Storage & Routing`, `Curriculum Graph Pipeline`, `Mindmap vs Existing Services`, `Question Refinement Motivation`?**
  _High betweenness centrality (0.254) - this node is a cross-community bridge._
- **Why does `Repository Guidelines (AGENTS.md)` connect `App Tech Stack` to `Curriculum Graph Pipeline`, `ASKKUP Product Scope`?**
  _High betweenness centrality (0.219) - this node is a cross-community bridge._
- **What connects `Transparent Student Overlay (pen/eraser)`, `Five Question Types (info_seeking ... reflective)`, `ChatModel` to the rest of the system?**
  _5 weakly-connected nodes found - possible documentation gaps or missing edges._