import { ValidatorEngine } from './validator.js';

/**
 * SynthesizerEngine
 * Menghasilkan representasi UML (Mermaid & PlantUML) dan dokumentasi arsitektur
 * berstandar tinggi dari hasil trace call-graph.
 */
export class SynthesizerEngine {
  constructor(options = {}) {
    this.theme = options.theme || 'tokyo-night';
    this.validator = new ValidatorEngine();
  }

  /**
   * Theme configuration directive untuk Mermaid
   */
  getThemeDirective() {
    if (this.theme === 'tokyo-night') {
      return `%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#7aa2f7', 'primaryBorderColor': '#3d59a1', 'actorBkg': '#24283b', 'actorBorder': '#7aa2f7', 'lineColor': '#bb9af7', 'altBkg': '#1f2335' }}}%%`;
    }
    if (this.theme === 'catppuccin') {
      return `%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#cba6f7', 'primaryBorderColor': '#89b4fa', 'actorBkg': '#313244', 'actorBorder': '#cba6f7', 'lineColor': '#f38ba8' }}}%%`;
    }
    if (this.theme === 'nord') {
      return `%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#88c0d0', 'primaryBorderColor': '#81a1c1', 'actorBkg': '#2e3440', 'actorBorder': '#88c0d0', 'lineColor': '#ebcb8b' }}}%%`;
    }
    return '';
  }

  /**
   * Menghasilkan Sequence Diagram Mermaid
   */
  generateSequenceDiagram(traceData, detailLevel = 'standard') {
    const lines = [];
    const themeDirective = this.getThemeDirective();
    if (themeDirective) lines.push(themeDirective);

    lines.push('sequenceDiagram');
    lines.push('    autonumber');

    // 1. Deklarasi Partisipan
    const participants = traceData.participants || [
      { id: 'Client', label: 'Client / Frontend App', type: 'actor' },
      { id: 'Ctrl', label: 'Controller / Handler', type: 'participant' }
    ];

    for (const p of participants) {
      const type = p.type === 'actor' ? 'actor' : 'participant';
      lines.push(`    ${type} ${p.id} as ${p.label}`);
    }

    lines.push('');

    // 2. Alur Pesan & Interaksi
    const steps = traceData.steps || [];
    let insideAlt = false;

    for (const step of steps) {
      if (step.type === 'alt_start') {
        lines.push(`    alt ${step.condition || 'Condition Check'}`);
        insideAlt = true;
        continue;
      }
      if (step.type === 'alt_else') {
        lines.push(`    else ${step.condition || 'Fallback Path'}`);
        continue;
      }
      if (step.type === 'alt_end') {
        lines.push('    end');
        insideAlt = false;
        continue;
      }
      if (step.type === 'opt_start') {
        lines.push(`    opt ${step.condition || 'Optional Flow'}`);
        continue;
      }
      if (step.type === 'opt_end') {
        lines.push('    end');
        continue;
      }
      if (step.type === 'note') {
        lines.push(`    Note over ${step.over || 'Ctrl'}: ${step.text}`);
        continue;
      }

      const indent = insideAlt ? '        ' : '    ';
      const arrow = step.isAsync ? '-)' : (step.isReturn ? '-->>' : '->>');
      lines.push(`${indent}${step.from}${arrow}${step.to}: ${step.message}`);
    }

    if (insideAlt) {
      lines.push('    end');
    }

    const rawMermaid = lines.join('\n');
    return this.validator.validateAndRepair(rawMermaid);
  }

  /**
   * Menghasilkan Flowchart Diagram Mermaid (FR-3)
   */
  generateFlowchart(traceData) {
    const lines = [
      'flowchart TD',
      '    Start([Start Request]) --> Entry["Entrypoint / Route Match"]'
    ];

    const steps = traceData.steps || [];
    let prevNode = 'Entry';
    let nodeIdx = 1;

    for (const step of steps) {
      if (step.type === 'call') {
        const nodeId = `Step${nodeIdx++}`;
        lines.push(`    ${prevNode} --> ${nodeId}["${step.from} call ${step.to}<br/>(${step.message})"]`);
        prevNode = nodeId;
      } else if (step.type === 'alt_start') {
        const decisionId = `Dec${nodeIdx++}`;
        lines.push(`    ${prevNode} --> ${decisionId}{"${step.condition || 'Check Condition'}"}`);
        prevNode = decisionId;
      }
    }

    lines.push(`    ${prevNode} --> EndNode([Send Response])`);
    const raw = lines.join('\n');
    return this.validator.validateAndRepair(raw);
  }

  /**
   * Menghasilkan State Machine Diagram Mermaid (FR-3)
   */
  generateStateDiagram(traceData) {
    const entityName = traceData.targetName || 'Entity';
    const lines = [
      'stateDiagram-v2',
      '    [*] --> InitialState: Request Received',
      `    InitialState --> Validating: Validate Input Payload`,
      `    Validating --> Rejected: Validation Failed / 400`,
      `    Rejected --> [*]: Abort Execution`,
      `    Validating --> Processing: Validation Passed`,
      `    Processing --> Persisting: Execute Domain Service`,
      `    Persisting --> ErrorOccurred: DB or Network Exception`,
      `    ErrorOccurred --> [*]: Rollback & Return 500`,
      `    Persisting --> Completed: Commit & Emit Events`,
      `    Completed --> [*]: Return Success (200/201)`
    ];
    return this.validator.validateAndRepair(lines.join('\n'));
  }

  /**
   * Menghasilkan Component / Architecture Diagram Mermaid (FR-3)
   */
  generateComponentDiagram(traceData) {
    const lines = [
      'graph TD',
      '    subgraph PresentationTier ["1. Presentation Layer"]',
      '        Client["Client / User Agent"]',
      '        Ctrl["API Controller / Router"]',
      '    end',
      '    subgraph DomainTier ["2. Business Logic Layer"]',
      '        Svc["Domain Service"]',
      '        Validator["Validation & Guard Layer"]',
      '    end',
      '    subgraph DataTier ["3. Data & Infrastructure Layer"]',
      '        DB[("Database / ORM Storage")]',
      '        ExtAPI["External API Service"]',
      '        Queue[("Message Broker / Event Queue")]',
      '    end',
      '',
      '    Client -->|HTTP / RPC Request| Ctrl',
      '    Ctrl -->|Validate Input| Validator',
      '    Ctrl -->|Execute Operation| Svc',
      '    Svc -->|Read / Write Entities| DB',
      '    Svc -.->|Authorize / Callout| ExtAPI',
      '    Svc -.->|Publish Event| Queue',
      '    Ctrl -->|HTTP Response| Client'
    ];
    return this.validator.validateAndRepair(lines.join('\n'));
  }

  /**
   * Menghasilkan Class Diagram Mermaid
   */
  generateClassDiagram(models = []) {
    const lines = ['classDiagram'];
    if (models.length === 0) {
      lines.push('    class BaseEntity {');
      lines.push('        +String id');
      lines.push('        +DateTime createdAt');
      lines.push('        +DateTime updatedAt');
      lines.push('    }');
    } else {
      for (const m of models) {
        lines.push(`    class ${m.name} {`);
        for (const f of m.fields || []) {
          lines.push(`        +${f.type} ${f.name}`);
        }
        lines.push('    }');
      }
    }
    return this.validator.validateAndRepair(lines.join('\n'));
  }

  /**
   * Menghasilkan PlantUML format
   */
  generatePlantUML(traceData) {
    const lines = [
      '@startuml',
      'autonumber',
      'skinparam BoxPadding 10',
      'skinparam ParticipantPadding 10'
    ];

    for (const p of traceData.participants || []) {
      const type = p.type === 'actor' ? 'actor' : 'participant';
      lines.push(`${type} "${p.label}" as ${p.id}`);
    }

    for (const step of traceData.steps || []) {
      if (step.type === 'alt_start') lines.push(`alt ${step.condition}`);
      else if (step.type === 'alt_else') lines.push(`else ${step.condition}`);
      else if (step.type === 'alt_end') lines.push('end');
      else {
        const arrow = step.isReturn ? '-->' : '->';
        lines.push(`${step.from} ${arrow} ${step.to}: ${step.message}`);
      }
    }

    lines.push('@enduml');
    return lines.join('\n');
  }

  /**
   * Menghasilkan dokumentasi naratif ramah A11y (WCAG 2.2 AA)
   */
  generateNarrativeWalkthrough(traceData) {
    const endpoint = traceData.endpoint || 'Endpoint / Function Execution';
    const lines = [
      `### Penjelasan Alur Arsitektur (${endpoint})`,
      '',
      `Alur eksekusi ini melibatkan **${(traceData.participants || []).length} komponen utama**:`,
      ''
    ];

    for (const p of traceData.participants || []) {
      lines.push(`* **${p.label}** (\`${p.id}\`): Berperan sebagai entitas ${p.type === 'actor' ? 'pengguna/pemanggil' : 'service pelaksana'}.`);
    }

    lines.push('');
    lines.push('#### Rincian Langkah Eksekusi:');

    let stepNum = 1;
    for (const step of traceData.steps || []) {
      if (step.type === 'call') {
        lines.push(`${stepNum++}. **${step.from}** memanggil **${step.to}**: \`${step.message}\`.`);
      } else if (step.type === 'alt_start') {
        lines.push(`   * *Pengecekan Kondisi*: Jika \`${step.condition}\`, aliran beralih ke jalur alternatif.`);
      }
    }

    if (traceData.errorBranches && traceData.errorBranches.length > 0) {
      lines.push('');
      lines.push('#### Penanganan Error & Pengecualian (Error Pathways):');
      for (const err of traceData.errorBranches) {
        lines.push(`* **${err.type || 'Exception'}**: Menghasilkan respons HTTP \`${err.status || 500}\` dengan pesan "${err.message || 'Error occurred'}".`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Merender paket artefak lengkap dalam format Markdown
   */
  renderFullArtifact(traceData, diagramType = 'sequence') {
    let diagResult;
    if (diagramType === 'flowchart') {
      diagResult = this.generateFlowchart(traceData);
    } else if (diagramType === 'state') {
      diagResult = this.generateStateDiagram(traceData);
    } else if (diagramType === 'component') {
      diagResult = this.generateComponentDiagram(traceData);
    } else if (diagramType === 'class') {
      diagResult = this.generateClassDiagram([]);
    } else {
      diagResult = this.generateSequenceDiagram(traceData);
    }

    const narrative = this.generateNarrativeWalkthrough(traceData);
    const title = traceData.endpoint
      ? `UML Diagram: ${traceData.endpoint}`
      : `UML Diagram: ${traceData.targetName || 'Execution Flow'}`;

    return [
      `# ${title}`,
      '',
      `> *Dihasilkan secara otomatis oleh **UML-Architect Skill Agent** (v1.0.0)*`,
      '',
      '## Diagram Visual',
      '```mermaid',
      diagResult.fixedMermaid,
      '```',
      '',
      '<details>',
      '<summary>Lihat Format Alternatif (PlantUML)</summary>',
      '',
      '```puml',
      this.generatePlantUML(traceData),
      '```',
      '</details>',
      '',
      narrative
    ].join('\n');
  }
}
