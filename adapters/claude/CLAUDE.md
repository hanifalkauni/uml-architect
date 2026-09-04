# Claude Code Guidelines: UML-Architect

When generating UML diagrams or architecture visualizations from code in this project:

## Tracing Workflows
- **API Endpoints**: Map from routing entrypoint through guards, controller, services, database operations, and HTTP responses.
- **Functions/Methods**: Map call hierarchy, parameters, validation conditions, and returns.
- **Polyglot Parsing**: Look for standard language patterns in TypeScript, Python, Go, Java, C#, Rust, PHP, or Ruby.

## Diagram Rules
- Always generate standard **Mermaid.js** syntax.
- Ensure `sequenceDiagram` includes `autonumber` and participant aliases.
- Capture error pathways in `alt` blocks (`400 Bad Request`, `401 Unauthorized`, `500 Server Error`).
- Include narrative breakdown and accessible text description below each diagram.

## MCP Tools Available
If running with the UML-Architect MCP server:
- `trace_endpoint_flow`: Traces an endpoint and returns complete Mermaid diagram.
- `trace_function_flow`: Traces a function/method and returns execution diagram.
- `validate_mermaid_syntax`: Validates and auto-repairs Mermaid syntax.
