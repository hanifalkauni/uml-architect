import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManifestSniffer } from './manifest_sniffer.js';
import { ProfileLoader } from './profile_loader.js';
import { TracerEngine } from './tracer.js';
import { SynthesizerEngine } from './synthesizer.js';
import { ValidatorEngine } from './validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * UmlArchitect
 * Universal Orchestrator untuk analisis alur kode dan pembuatan diagram UML
 * lintas bahasa pemrograman dan multi-platform AI Agent IDE.
 */
export class UmlArchitect {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.cwd());
    this.config = this.loadConfig();

    this.theme = options.theme || this.config.theme || 'tokyo-night';
    this.detailLevel = options.detailLevel || this.config.detailLevel || 'standard';
    this.lang = options.lang || options.language || this.config.language || 'en';

    this.sniffer = new ManifestSniffer(this.rootDir);
    this.profileLoader = new ProfileLoader();
    this.tracer = new TracerEngine({
      rootDir: this.rootDir,
      config: this.config
    });
    this.synthesizer = new SynthesizerEngine({ theme: this.theme, lang: this.lang });
    this.validator = new ValidatorEngine();
  }

  loadConfig() {
    try {
      const cfgPath = path.join(this.rootDir, 'uml-architect.config.json');
      if (fs.existsSync(cfgPath)) {
        return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      }
    } catch {}
    return {};
  }

  /**
   * Menghasilkan UML diagram dari Endpoint API
   */
  async generateFromEndpoint(endpoint, options = {}) {
    const traceData = await this.tracer.traceEndpoint(endpoint, {
      httpMethod: options.method || options.httpMethod,
      targetFile: options.targetFile || options.file,
      detailLevel: options.detailLevel || this.detailLevel
    });

    const diagramType = options.diagramType || this.config.defaultDiagramType || 'sequence';
    const markdown = this.synthesizer.renderFullArtifact(traceData, diagramType);

    if (options.outputFile) {
      this.saveToFile(options.outputFile, markdown);
    }

    return {
      traceData,
      markdown,
      diagram: this.synthesizer.generateSequenceDiagram(traceData).fixedMermaid
    };
  }

  /**
   * Menghasilkan UML diagram dari Function/Method
   */
  async generateFromFunction(functionName, options = {}) {
    const traceData = await this.tracer.traceFunction(functionName, options.file || options.filePath, {
      detailLevel: options.detailLevel || this.detailLevel
    });

    const diagramType = options.diagramType || 'sequence';
    const markdown = this.synthesizer.renderFullArtifact(traceData, diagramType);

    if (options.outputFile) {
      this.saveToFile(options.outputFile, markdown);
    }

    return {
      traceData,
      markdown,
      diagram: this.synthesizer.generateSequenceDiagram(traceData).fixedMermaid
    };
  }

  /**
   * Menghasilkan UML diagram dari File atau Modul Path
   */
  async generateFromPath(targetPath, options = {}) {
    const traceData = await this.tracer.tracePath(targetPath, {
      detailLevel: options.detailLevel || this.detailLevel
    });

    const diagramType = options.diagramType || 'sequence';
    const markdown = this.synthesizer.renderFullArtifact(traceData, diagramType);

    if (options.outputFile) {
      this.saveToFile(options.outputFile, markdown);
    }

    return {
      traceData,
      markdown,
      diagram: this.synthesizer.generateSequenceDiagram(traceData).fixedMermaid
    };
  }

  /**
   * Menghasilkan UML diagram dari Natural Language Query (FR-1.4)
   * Contoh: "Gambarkan alur saat webhook Stripe diterima"
   */
  async generateFromQuery(query, options = {}) {
    const traceData = await this.tracer.traceNaturalLanguage(query, {
      detailLevel: options.detailLevel || this.detailLevel
    });

    const diagramType = options.diagramType || 'sequence';
    const markdown = this.synthesizer.renderFullArtifact(traceData, diagramType);

    if (options.outputFile) {
      this.saveToFile(options.outputFile, markdown);
    }

    return {
      traceData,
      markdown,
      diagram: this.synthesizer.generateSequenceDiagram(traceData).fixedMermaid
    };
  }

  /**
   * Memvalidasi dan memperbaiki kode Mermaid
   */
  validateMermaid(mermaidCode) {
    return this.validator.validateAndRepair(mermaidCode);
  }

  /**
   * Menyiapkan adapter konfigurasi untuk berbagai IDE Agent
   */
  initAdapters(targetDir = null) {
    const dest = path.resolve(targetDir || this.rootDir);
    const adaptersSrc = path.resolve(__dirname, '..', 'adapters');
    const createdFiles = [];

    const copyMapping = [
      { src: 'antigravity/SKILL.md', dest: '.agents/skills/uml-architect/SKILL.md' },
      { src: 'cursor/uml-architect.mdc', dest: '.cursor/rules/uml-architect.mdc' },
      { src: 'claude/CLAUDE.md', dest: 'CLAUDE.md' },
      { src: 'windsurf/.windsurfrules', dest: '.windsurfrules' },
      { src: 'copilot/copilot-instructions.md', dest: '.github/copilot-instructions.md' },
      { src: 'cline/.clinerules', dest: '.clinerules' },
      { src: 'continue/config.json', dest: '.continue/config.json' },
      { src: 'continue/uml-architect.md', dest: '.continue/rules/uml-architect.md' },
      { src: 'kiro/uml-architect.md', dest: '.kiro/steering/uml-architect.md' },
      { src: 'kiro/config.json', dest: '.kiro/config.json' }
    ];

    for (const item of copyMapping) {
      const srcFile = path.join(adaptersSrc, item.src);
      const destFile = path.join(dest, item.dest);
      if (fs.existsSync(srcFile)) {
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        fs.copyFileSync(srcFile, destFile);
        createdFiles.push(item.dest);
      }
    }

    // Buat default config jika belum ada
    const cfgPath = path.join(dest, 'uml-architect.config.json');
    if (!fs.existsSync(cfgPath)) {
      const defaultCfg = path.resolve(__dirname, '..', 'uml-architect.config.json');
      if (fs.existsSync(defaultCfg)) {
        fs.copyFileSync(defaultCfg, cfgPath);
        createdFiles.push('uml-architect.config.json');
      }
    }

    return createdFiles;
  }

  saveToFile(filePath, content) {
    const fullPath = path.resolve(this.rootDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }
}
