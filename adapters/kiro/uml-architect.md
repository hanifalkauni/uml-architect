---
inclusion: always
description: "Autonomous code-to-diagram rules for generating 100% accurate UML sequence diagrams, flowcharts, and architecture models"
---

# Kiro Steering: UML-Architect

When user asks to generate UML diagrams, sequence flows, or architecture documentation from code:

## 1. Discovery & Multi-Language Ingestion
- Automatically detect the target: API endpoint (`POST /api/...`), function/method name, or file path.
- Inspect project manifests (`package.json`, `go.mod`, `pom.xml`, `pyproject.toml`, `Cargo.toml`, etc.) to dynamically apply framework-specific routing and middleware rules.

## 2. Strict Call-Graph Tracing (Zero-Hallucination)
- **Lifecycle Mapping**: Map execution from route handler -> validation/guards -> controller -> domain services -> persistence/ORM -> external APIs -> message brokers.
- **Error Pathways**: Always identify `try/catch`, `if err != nil`, and error returns. Map them to `alt` / `opt` blocks.
- **Verification**: Only include classes, methods, and actors that actually exist in the source code.

## 3. Mermaid Syntax Standards
- Always output valid Mermaid.js inside standard fenced blocks: ` ```mermaid ... ``` `.
- For sequence diagrams, always include `sequenceDiagram`, `autonumber`, and explicit participant aliases (`participant Ctrl as OrderController`).
- Provide alternative PlantUML syntax inside `<details><summary>` tags.

## 4. Accessibility & Narrative Explanation
- Follow WCAG 2.2 AA standards by providing an accessible, step-by-step narrative explanation under every diagram.
- Summarize actors, input payloads, status responses, and error conditions.
