# GitHub Copilot & VS Code Instructions: UML-Architect

When generating UML diagrams or request execution flows from code:
1. Detect programming language and framework used in the current workspace.
2. Map flow from route definition through middlewares, controllers, services, database queries, and external APIs.
3. Use standard participant aliases: `Client`, `Ctrl`, `Svc`, `ExtAPI`, `DB`, `Queue`.
4. Include error handling branches in `alt` blocks with appropriate HTTP status codes.
5. Format output identically to UML-Architect canonical layout:
   - `# UML Diagram: <Target>`
   - `> *Dihasilkan secara otomatis oleh **UML-Architect Skill Agent** (v1.1.0)*`
   - `## Diagram Visual` (Mermaid block)
   - Collapsible PlantUML `<details><summary>` block
   - `### Penjelasan Alur Arsitektur` (A11y narrative walkthrough)
