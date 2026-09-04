# Claude Code Guidelines: UML-Architect

When generating UML diagrams or architecture visualizations from code in this project:

## 1. Tracing Workflows (Zero-Hallucination)
- **API Endpoints**: Map from routing entrypoint through guards, controller, services, database operations, external APIs, and HTTP responses.
- **Functions/Methods**: Map call hierarchy, parameters, validation conditions, and returns.
- **Error Branches**: Capture error pathways in `alt` blocks (`400 Bad Request`, `401 Unauthorized`, `500 Server Error`).

## 2. Standard Participant Mapping
- `Client` (actor): `Client as Client / Frontend App`
- `Ctrl` (participant): `<ControllerName> (Controller)`
- `Svc` (participant): `<ServiceName>`
- `ExtAPI` (participant): `<ExternalGateway> (External API)`
- `DB` (participant): `Database (Storage / ORM)`
- `Queue` (participant): `Message Broker (Kafka / Queue)`

## 3. Canonical Output Contract
Output must strictly match this layout:
1. Title: `# UML Diagram: <Target / Endpoint Name>`
2. Attribution: `> *Dihasilkan secara otomatis oleh **UML-Architect Skill Agent** (v1.1.0)*`
3. Section `## Diagram Visual` with ` ```mermaid ` block including `autonumber` and theme directive.
4. Collapsible `<details><summary>Lihat Format Alternatif (PlantUML)</summary>...```puml...```</details>`.
5. Section `### Penjelasan Alur Arsitektur (<Target>)` with participant roles list, step-by-step numbered execution, and error pathways breakdown.
