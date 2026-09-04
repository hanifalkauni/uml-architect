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

    const participants = traceData.participants || [
      { id: 'Client', label: 'Client / Frontend App', type: 'actor' },
      { id: 'Ctrl', label: 'Controller / Handler', type: 'participant' }
    ];

    const isL1 = detailLevel === 'L1' || detailLevel === 'high';
    const isL3 = detailLevel === 'L3' || detailLevel === 'deep';

    // 1. Filter partisipan pada L1 jika diperlukan
    let activeParticipants = participants;
    if (isL1) {
      // Pada L1 fokus pada komponen utama (Client, Controller, Storage/Cache/Ext)
      const primaryIds = new Set(['Client', 'Ctrl', 'Redis', 'S3', 'DB', 'ExtAPI']);
      const filtered = participants.filter(p => primaryIds.has(p.id) || p.type === 'actor');
      if (filtered.length >= 2) {
        activeParticipants = filtered;
      }
    }

    // 2. Deklarasi Partisipan dengan Mermaid `box` Grouping jika ada layer
    const hasLayers = activeParticipants.some(p => Boolean(p.layer));
    if (hasLayers) {
      const layerColors = {
        'Application Layer': '#1e293b',
        'Persistence & Cache Layer': '#0f172a',
        'Data & Cache Layer': '#0f172a',
        'Cloud Storage': '#1e1e2e',
        'Cloud Infrastructure': '#1e1e2e',
        'External Services': '#2d2036',
        'Messaging & Events': '#1a2634'
      };

      const unlayered = [];
      const layerMap = new Map();

      for (const p of activeParticipants) {
        if (p.layer) {
          if (!layerMap.has(p.layer)) {
            layerMap.set(p.layer, []);
          }
          layerMap.get(p.layer).push(p);
        } else {
          unlayered.push(p);
        }
      }

      // Render entitas di luar box terlebih dahulu (misal: external actor Client)
      for (const p of unlayered) {
        const type = p.type === 'actor' ? 'actor' : 'participant';
        lines.push(`    ${type} ${p.id} as ${p.label}`);
      }

      // Render setiap kelompok layer ke dalam Mermaid box
      for (const [layerName, groupParticipants] of layerMap.entries()) {
        const color = layerColors[layerName] || '#1e293b';
        lines.push(`    box "${layerName}" ${color}`);
        for (const p of groupParticipants) {
          const type = p.type === 'actor' ? 'actor' : 'participant';
          lines.push(`        ${type} ${p.id} as ${p.label}`);
        }
        lines.push('    end');
      }
    } else {
      for (const p of activeParticipants) {
        const type = p.type === 'actor' ? 'actor' : 'participant';
        lines.push(`    ${type} ${p.id} as ${p.label}`);
      }
    }

    lines.push('');

    // 3. Alur Pesan & Interaksi dengan Multi-level Indentation
    const steps = traceData.steps || [];
    let indentLevel = 1;

    for (const step of steps) {
      // Filter step berdasarkan detail level
      if (isL1) {
        if (step.type === 'note') continue;
        if (step.level === 'L3' || step.level === 'deep') continue;
        if (step.skipInL1) continue;
      }
      if (step.type === 'note' && !isL3 && step.level === 'L3') {
        continue;
      }

      if (step.type === 'alt_start') {
        lines.push(`${'    '.repeat(indentLevel)}alt ${step.condition || 'Condition Check'}`);
        indentLevel++;
        continue;
      }
      if (step.type === 'alt_else') {
        lines.push(`${'    '.repeat(Math.max(1, indentLevel - 1))}else ${step.condition || 'Fallback Path'}`);
        continue;
      }
      if (step.type === 'alt_end' || step.type === 'opt_end') {
        indentLevel = Math.max(1, indentLevel - 1);
        lines.push(`${'    '.repeat(indentLevel)}end`);
        continue;
      }
      if (step.type === 'opt_start') {
        lines.push(`${'    '.repeat(indentLevel)}opt ${step.condition || 'Optional Flow'}`);
        indentLevel++;
        continue;
      }
      if (step.type === 'note') {
        lines.push(`${'    '.repeat(indentLevel)}Note over ${step.over || 'Ctrl'}: ${step.text}`);
        continue;
      }

      // Jika di L1 partisipan tidak di-render, lewati step yang melibatkan mereka
      if (isL1 && (!activeParticipants.some(p => p.id === step.from) || !activeParticipants.some(p => p.id === step.to))) {
        continue;
      }

      const arrow = step.isAsync ? '-)' : (step.isReturn ? '-->>' : '->>');
      lines.push(`${'    '.repeat(indentLevel)}${step.from}${arrow}${step.to}: ${step.message}`);
    }

    while (indentLevel > 1) {
      indentLevel--;
      lines.push(`${'    '.repeat(indentLevel)}end`);
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

    const participants = traceData.participants || [];
    const hasLayers = participants.some(p => Boolean(p.layer));

    if (hasLayers) {
      const pumlColors = {
        'Application Layer': '#LightBlue',
        'Persistence & Cache Layer': '#LightYellow',
        'Data & Cache Layer': '#LightYellow',
        'Cloud Storage': '#LightCyan',
        'Cloud Infrastructure': '#LightCyan',
        'External Services': '#LavenderBlush',
        'Messaging & Events': '#MistyRose'
      };

      const unlayered = [];
      const layerMap = new Map();

      for (const p of participants) {
        if (p.layer) {
          if (!layerMap.has(p.layer)) {
            layerMap.set(p.layer, []);
          }
          layerMap.get(p.layer).push(p);
        } else {
          unlayered.push(p);
        }
      }

      for (const p of unlayered) {
        const type = p.type === 'actor' ? 'actor' : 'participant';
        lines.push(`${type} "${p.label}" as ${p.id}`);
      }

      for (const [layerName, group] of layerMap.entries()) {
        const color = pumlColors[layerName] || '#LightGray';
        lines.push(`box "${layerName}" ${color}`);
        for (const p of group) {
          const type = p.type === 'actor' ? 'actor' : 'participant';
          lines.push(`    ${type} "${p.label}" as ${p.id}`);
        }
        lines.push('end box');
      }
    } else {
      for (const p of participants) {
        const type = p.type === 'actor' ? 'actor' : 'participant';
        lines.push(`${type} "${p.label}" as ${p.id}`);
      }
    }

    for (const step of traceData.steps || []) {
      if (step.type === 'alt_start') lines.push(`alt ${step.condition}`);
      else if (step.type === 'alt_else') lines.push(`else ${step.condition}`);
      else if (step.type === 'alt_end' || step.type === 'opt_end') lines.push('end');
      else if (step.type === 'opt_start') lines.push(`opt ${step.condition}`);
      else if (step.type === 'note') lines.push(`note over ${step.over || 'Ctrl'}: ${step.text}`);
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
      const layerInfo = p.layer ? ` (${p.layer})` : '';
      lines.push(`* **${p.label}** (\`${p.id}\`)${layerInfo}: Berperan sebagai entitas ${p.type === 'actor' ? 'pengguna/pemanggil' : 'service pelaksana'}.`);
    }

    lines.push('');
    lines.push('#### Rincian Langkah Eksekusi:');

    let stepNum = 1;
    for (const step of traceData.steps || []) {
      if (!step.type || step.type === 'call') {
        const action = step.isReturn ? 'mengembalikan hasil ke' : (step.isAsync ? 'mengirim event asinkron ke' : 'memanggil');
        lines.push(`${stepNum++}. **${step.from}** ${action} **${step.to}**: \`${step.message}\`.`);
      } else if (step.type === 'alt_start') {
        lines.push(`   * *Pengecekan Kondisi*: Jika \`${step.condition}\`, aliran beralih ke jalur alternatif.`);
      } else if (step.type === 'alt_else') {
        lines.push(`   * *Jalur Alternatif / Default*: \`${step.condition}\`.`);
      } else if (step.type === 'note') {
        lines.push(`   * *Catatan Teknis*: ${step.text}`);
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
