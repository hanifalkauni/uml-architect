import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { ManifestSniffer } from '../core/manifest_sniffer.js';
import { ProfileLoader } from '../core/profile_loader.js';
import { TracerEngine } from '../core/tracer.js';
import { SynthesizerEngine } from '../core/synthesizer.js';
import { ValidatorEngine } from '../core/validator.js';
import { UmlArchitect } from '../core/index.js';
import { McpServer } from '../core/mcp_server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
  }
}

console.log('\n🧪 Menjalankan Test Suite UML-Architect (v1.1.0)...\n');

// 1. Test ManifestSniffer
runTest('ManifestSniffer: Deteksi bahasa dari ekstensi file', () => {
  const sniffer = new ManifestSniffer(__dirname);
  assert.strictEqual(sniffer.detectLanguageFromPath('server.ts'), 'typescript');
  assert.strictEqual(sniffer.detectLanguageFromPath('app.py'), 'python');
  assert.strictEqual(sniffer.detectLanguageFromPath('main.go'), 'go');
  assert.strictEqual(sniffer.detectLanguageFromPath('Payment.java'), 'jvm');
  assert.strictEqual(sniffer.detectLanguageFromPath('lib.rs'), 'rust');
  assert.strictEqual(sniffer.detectLanguageFromPath('unknown.xyz'), 'generic');
});

// 2. Test ProfileLoader
runTest('ProfileLoader: Memuat profil modular dan fallback generic', () => {
  const loader = new ProfileLoader();
  const tsProfile = loader.getProfile('typescript');
  assert.strictEqual(tsProfile.language, 'typescript');
  assert.ok(tsProfile.extensions.includes('.ts'));

  const goProfile = loader.getProfile('go');
  assert.strictEqual(goProfile.language, 'go');

  const genericProfile = loader.getProfile('nonexistent_lang');
  assert.strictEqual(genericProfile.language, 'generic');

  const supported = loader.listSupportedProfiles();
  assert.ok(supported.length >= 8, `Harus mendukung minimal 8 profil, didapat: ${supported.length}`);
});

// 3. Test ValidatorEngine (Self-Healing)
runTest('ValidatorEngine: Memperbaiki unclosed alt block dan karakter ilegal', () => {
  const validator = new ValidatorEngine();
  const brokenMermaid = `
sequenceDiagram
    autonumber
    participant Client
    participant Ctrl
    Client->>Ctrl: GET /api/v1/checkout {id}
    alt Kondisi Error
        Ctrl-->>Client: 400 Bad Request
  `;

  const res = validator.validateAndRepair(brokenMermaid);
  assert.ok(res.fixedMermaid.includes('end'), 'Blok alt harus ditutup secara otomatis');
  assert.ok(res.fixedMermaid.includes('autonumber'));
});

// 4. Test TracerEngine pada TypeScript Express Fixture
await runAsyncTest('TracerEngine: Analisis alur Express TypeScript (sample_express.ts)', async () => {
  const tracer = new TracerEngine({ rootDir: path.resolve(__dirname, '..') });
  const fixturePath = path.join(fixturesDir, 'sample_express.ts');
  const trace = await tracer.traceEndpoint('POST /api/orders/checkout', {
    targetFile: fixturePath
  });

  assert.ok(trace.participants.some(p => p.id === 'Ctrl'));
  assert.ok(trace.participants.some(p => p.id === 'DB' || p.id === 'Queue'));
  assert.ok(trace.steps.length >= 5);
  assert.ok(trace.errorBranches.length > 0);
});

// 5. Test TracerEngine pada Python FastAPI Fixture
await runAsyncTest('TracerEngine: Analisis alur Python FastAPI (sample_fastapi.py)', async () => {
  const tracer = new TracerEngine({ rootDir: path.resolve(__dirname, '..') });
  const fixturePath = path.join(fixturesDir, 'sample_fastapi.py');
  const trace = await tracer.traceEndpoint('POST /items/1/buy', {
    targetFile: fixturePath
  });

  assert.ok(trace.participants.some(p => p.id === 'Ctrl'));
  assert.ok(trace.participants.some(p => p.id === 'DB'));
});

// 6. Test TracerEngine pada Go Gin Fixture
await runAsyncTest('TracerEngine: Analisis alur Go Gin (sample_gin.go)', async () => {
  const tracer = new TracerEngine({ rootDir: path.resolve(__dirname, '..') });
  const fixturePath = path.join(fixturesDir, 'sample_gin.go');
  const trace = await tracer.traceEndpoint('POST /auth/login', {
    targetFile: fixturePath
  });

  assert.ok(trace.participants.some(p => p.id === 'Ctrl'));
  assert.ok(trace.participants.some(p => p.id === 'Svc'));
});

// 7. Test TracerEngine pada Java Spring Boot Fixture
await runAsyncTest('TracerEngine: Analisis alur Java Spring Boot (sample_spring.java)', async () => {
  const tracer = new TracerEngine({ rootDir: path.resolve(__dirname, '..') });
  const fixturePath = path.join(fixturesDir, 'sample_spring.java');
  const trace = await tracer.traceEndpoint('POST /api/v1/payments/charge', {
    targetFile: fixturePath
  });

  assert.ok(trace.participants.some(p => p.id === 'Ctrl'));
  assert.ok(trace.participants.some(p => p.id === 'Svc'));
});

// 8. Test SynthesizerEngine
runTest('SynthesizerEngine: Menghasilkan Mermaid, PlantUML, dan A11y Narrative', () => {
  const synth = new SynthesizerEngine();
  const mockTrace = {
    endpoint: 'POST /orders',
    participants: [
      { id: 'Client', label: 'Client', type: 'actor' },
      { id: 'Ctrl', label: 'OrderController', type: 'participant' }
    ],
    steps: [
      { from: 'Client', to: 'Ctrl', message: 'POST /orders', isAsync: false },
      { from: 'Ctrl', to: 'Client', message: '200 OK', isReturn: true }
    ],
    errorBranches: []
  };

  const md = synth.renderFullArtifact(mockTrace);
  assert.ok(md.includes('```mermaid'));
  assert.ok(md.includes('sequenceDiagram'));
  assert.ok(md.includes('autonumber'));
  assert.ok(md.includes('```puml'));
  assert.ok(md.includes('Penjelasan Alur Arsitektur'));
});

// 9. Test UmlArchitect Orchestrator Facade
await runAsyncTest('UmlArchitect: Integrasi End-to-End generateFromEndpoint', async () => {
  const architect = new UmlArchitect({ rootDir: path.resolve(__dirname, '..') });
  const res = await architect.generateFromEndpoint('POST /api/v1/test', {
    targetFile: path.join(fixturesDir, 'sample_express.ts')
  });

  assert.ok(res.markdown.includes('```mermaid'));
  assert.ok(res.diagram.includes('sequenceDiagram'));
});

// 10. Test McpServer Protocol
await runAsyncTest('McpServer: Respons JSON-RPC tools/list dan tools/call', async () => {
  const server = new McpServer();
  const listResp = await server.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {}
  });

  assert.strictEqual(listResp.id, 1);
  assert.ok(Array.isArray(listResp.result.tools));
  assert.ok(listResp.result.tools.some(t => t.name === 'trace_endpoint_flow'));
  assert.ok(listResp.result.tools.some(t => t.name === 'validate_mermaid_syntax'));

  const callResp = await server.handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'validate_mermaid_syntax',
      arguments: {
        mermaid_code: 'sequenceDiagram\nautonumber\nA->>B: Ping\nB-->>A: Pong'
      }
    }
  });

  assert.strictEqual(callResp.id, 2);
  assert.ok(callResp.result.content[0].text.includes('isValid'));
});

// 11. Test State & Component Diagram Generation (FR-3)
runTest('SynthesizerEngine: Menghasilkan State Diagram dan Component Diagram', () => {
  const synth = new SynthesizerEngine();
  const mockTrace = { targetName: 'OrderLifecycle', participants: [], steps: [] };
  const stateRes = synth.generateStateDiagram(mockTrace);
  assert.ok(stateRes.fixedMermaid.includes('stateDiagram-v2'));
  assert.ok(stateRes.fixedMermaid.includes('[*]'));

  const compRes = synth.generateComponentDiagram(mockTrace);
  assert.ok(compRes.fixedMermaid.includes('graph TD'));
  assert.ok(compRes.fixedMermaid.includes('PresentationLayer') || compRes.fixedMermaid.includes('PresentationTier'));
});

// 12. Test Natural Language Query Tracing (FR-1.4)
await runAsyncTest('TracerEngine: Analisis alur dari Natural Language Query', async () => {
  const tracer = new TracerEngine({ rootDir: path.resolve(__dirname, '..') });
  const trace = await tracer.traceNaturalLanguage('Gambarkan alur saat webhook Stripe checkout diterima');
  assert.ok(trace.participants.length >= 3);
  assert.ok(trace.steps.length >= 4);
});

// 13. Test MCP Tool: generate_uml_diagram
await runAsyncTest('McpServer: Eksekusi tool generate_uml_diagram', async () => {
  const server = new McpServer();
  const res = await server.handleRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'generate_uml_diagram',
      arguments: {
        target: 'POST /api/v1/orders/checkout',
        diagram_type: 'sequence'
      }
    }
  });

  assert.strictEqual(res.id, 3);
  assert.ok(res.result.content[0].text.includes('```mermaid'));
  assert.ok(res.result.content[0].text.includes('sequenceDiagram'));
});

console.log(`\n========================================`);
console.log(`📊 Hasil Pengujian: ${passedTests} / ${totalTests} lulus.`);
if (passedTests === totalTests) {
  console.log(`🎉 SEMUA TEST BERHASIL DENGAN SEMPURNA!\n`);
  process.exit(0);
} else {
  console.error(`❌ BEBERAPA TEST GAGAL.\n`);
  process.exit(1);
}

