# GitHub Copilot & VS Code Instructions: UML-Architect

When generating UML diagrams or request execution flows from code:
- Detect the programming language and framework used in the current workspace.
- Map the flow from the route definition through middlewares, controllers, services, database queries, and external APIs.
- Generate syntax-validated Mermaid.js sequence diagrams or flowcharts.
- Include error handling branches in `alt` blocks with appropriate HTTP status codes.
- Accompany every diagram with a step-by-step narrative explanation.
