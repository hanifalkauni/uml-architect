import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { ManifestSniffer } from '../core/manifest_sniffer.js';
import { ProfileLoader } from '../core/profile_loader.js';
import { PolyglotAstParser } from '../core/ast_parser.js';
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

console.log('\n🧪 Menjalankan Test Suite UML-Architect (Argon Engine)...\n');

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
runTest('ProfileLoader: Memuat 9 profil modular dan kompilasi aturan dinamis', () => {
  const loader = new ProfileLoader();
  const tsProfile = loader.getProfile('typescript');
  assert.strictEqual(tsProfile.language, 'typescript');
  assert.ok(tsProfile.extensions.includes('.ts'));

  const goProfile = loader.getProfile('go');
  assert.strictEqual(goProfile.language, 'go');

  const genericProfile = loader.getProfile('nonexistent_lang');
  assert.strictEqual(genericProfile.language, 'generic');

  const supported = loader.listSupportedProfiles();
  assert.strictEqual(supported.length, 9, `Harus mendukung tepat 9 profil, didapat: ${supported.length}`);

  const allLoaded = loader.loadAllProfiles();
  assert.strictEqual(allLoaded.size, 9);
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

  assert.strictEqual(trace.profileUsed, 'typescript');
  assert.ok(trace.participants.some(p => p.id === 'Ctrl'));
  assert.ok(trace.participants.some(p => p.id === 'DB' || p.id === 'Queue'));
  assert.ok(trace.steps.some(s => s.message && (s.message.includes('findById') || s.message.includes('createOrder'))));
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

  assert.strictEqual(trace.profileUsed, 'python');
  assert.ok(trace.participants.some(p => p.id === 'Ctrl'));
  assert.ok(trace.participants.some(p => p.id === 'DB'));
  assert.ok(trace.errorBranches.some(e => e.type === 'HTTPException' && e.status === 404));
});

// 6. Test TracerEngine pada Go Gin Fixture
await runAsyncTest('TracerEngine: Analisis alur Go Gin (sample_gin.go)', async () => {
  const tracer = new TracerEngine({ rootDir: path.resolve(__dirname, '..') });
  const fixturePath = path.join(fixturesDir, 'sample_gin.go');
  const trace = await tracer.traceEndpoint('POST /auth/login', {
    targetFile: fixturePath
  });

  assert.strictEqual(trace.profileUsed, 'go');
  assert.ok(trace.participants.some(p => p.id === 'Ctrl'));
  assert.ok(trace.participants.some(p => p.id === 'Svc'));
  assert.ok(trace.steps.some(s => s.message && s.message.includes('Authenticate')));
});

// 7. Test TracerEngine pada Java Spring Boot Fixture
await runAsyncTest('TracerEngine: Analisis alur Java Spring Boot (sample_spring.java)', async () => {
  const tracer = new TracerEngine({ rootDir: path.resolve(__dirname, '..') });
  const fixturePath = path.join(fixturesDir, 'sample_spring.java');
  const trace = await tracer.traceEndpoint('POST /api/v1/payments/charge', {
    targetFile: fixturePath
  });

  assert.strictEqual(trace.profileUsed, 'jvm');
  assert.ok(trace.participants.some(p => p.id === 'Ctrl'));
  assert.ok(trace.participants.some(p => p.id === 'Svc'));
  assert.ok(trace.steps.some(s => s.message && s.message.includes('processCharge')));
  assert.ok(trace.errorBranches.some(e => e.type === 'InsufficientFundsException' && e.status === 402));
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
  assert.ok(md.includes('Architecture Execution Walkthrough'));
  assert.ok(md.includes('Automatically generated by'));

  // Uji lokalisasi Bahasa Indonesia
  const synthId = new SynthesizerEngine({ lang: 'id' });
  const mdId = synthId.renderFullArtifact(mockTrace);
  assert.ok(mdId.includes('Penjelasan Alur Arsitektur'));
  assert.ok(mdId.includes('Dihasilkan secara otomatis'));
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

// 11. Test State, Component & Class Diagram Generation (FR-3)
runTest('SynthesizerEngine: Menghasilkan State, Component, dan Class Diagram dari AST riil', () => {
  const synth = new SynthesizerEngine();
  const mockTrace = {
    targetName: 'OrderLifecycle',
    participants: [{ id: 'Ctrl', label: 'OrderController', type: 'participant' }],
    steps: [{ from: 'Client', to: 'Ctrl', message: 'createOrder(dto)' }],
    models: [{ name: 'OrderController', fields: [{ name: 'orderService', type: 'OrderService' }], methods: ['createOrder'] }]
  };
  const stateRes = synth.generateStateDiagram(mockTrace);
  assert.ok(stateRes.fixedMermaid.includes('stateDiagram-v2'));
  assert.ok(stateRes.fixedMermaid.includes('[*]'));

  const compRes = synth.generateComponentDiagram(mockTrace);
  assert.ok(compRes.fixedMermaid.includes('graph TD'));
  assert.ok(compRes.fixedMermaid.includes('PresentationTier'));

  const classRes = synth.generateClassDiagram(mockTrace);
  assert.ok(classRes.fixedMermaid.includes('class OrderController'));
  assert.ok(!classRes.fixedMermaid.includes('BaseEntity'), 'Class diagram tidak boleh menggunakan dummy BaseEntity');
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

// 14. Test TracerEngine: Analisis Multi-Tier Laravel Controller (sample_laravel_cache_s3.php)
await runAsyncTest('TracerEngine: Analisis Multi-Tier Laravel Controller & AST Method Crawling (sample_laravel_cache_s3.php)', async () => {
  const tracer = new TracerEngine({ rootDir: path.resolve(__dirname, '..') });
  const fixturePath = path.join(fixturesDir, 'sample_laravel_cache_s3.php');
  const trace = await tracer.traceEndpoint('GET /retailer-wrapped/campaign', {
    targetFile: fixturePath,
    targetMethod: 'index'
  });

  // Verifikasi partisipan multi-tier dengan nama simbol riil dari AST (Zero-Hallucination)
  assert.ok(trace.participants.some(p => p.id === 'Ctrl' && p.layer === 'Application Layer'), 'Ctrl harus berada di Application Layer');
  assert.ok(trace.participants.some(p => p.id === 'Auth' && p.layer === 'Application Layer'), 'Auth harus berada di Application Layer');
  assert.ok(trace.participants.some(p => p.id === 'RetailerWrappedCampaign' && p.layer === 'Persistence & Cache Layer'), 'RetailerWrappedCampaign harus diekstrak secara riil di Persistence & Cache Layer');
  assert.ok(trace.participants.some(p => p.id === 'Redis' && p.layer === 'Persistence & Cache Layer'), 'Redis harus di Persistence & Cache Layer');
  assert.ok(trace.participants.some(p => p.id === 'RetailerWrappedCampaignAudienceCompiled' && p.layer === 'Persistence & Cache Layer'), 'RetailerWrappedCampaignAudienceCompiled harus diekstrak secara riil di Persistence & Cache Layer');
  assert.ok(trace.participants.some(p => p.id === 'S3' && p.layer === 'Cloud Storage'), 'S3Helper harus di Cloud Storage');

  // Verifikasi pola Cache-Aside dan ekstraksi variabel dinamis dari file sumber
  assert.ok(trace.steps.some(s => s.type === 'alt_start' && s.condition.includes('reload == true')), 'Harus mendeteksi invalidasi reload/hdel');
  assert.ok(trace.steps.some(s => s.type === 'alt_start' && s.condition.includes('Cache HIT')), 'Harus mendeteksi Cache HIT');
  assert.ok(trace.steps.some(s => s.type === 'alt_else' && s.condition.includes('Cache MISS')), 'Harus mendeteksi Cache MISS');
  assert.ok(trace.steps.some(s => s.from === 'Ctrl' && s.to === 'S3'), 'Harus terdapat interaksi dari Ctrl ke S3 hasil crawling');
  assert.ok(trace.steps.some(s => s.from === 'Ctrl' && s.to === 'Redis' && s.message.includes('hset("ayowrap_{campaignId}"')), 'Harus mengekstrak key Redis secara dinamis dari AST variabel $cacheKey');

  // Verifikasi ORM Exception
  assert.ok(trace.errorBranches.some(e => e.type === 'ModelNotFoundException' && e.status === 404), 'Harus mendeteksi ModelNotFoundException (404)');
});

// 15. Test SynthesizerEngine: Render Mermaid Sequence Diagram dengan Box Layer Grouping
await runAsyncTest('SynthesizerEngine: Render Mermaid Diagram dengan Box Layer Grouping & Validasi', async () => {
  const tracer = new TracerEngine({ rootDir: path.resolve(__dirname, '..') });
  const synth = new SynthesizerEngine();
  const fixturePath = path.join(fixturesDir, 'sample_laravel_cache_s3.php');
  const trace = await tracer.traceEndpoint('GET /retailer-wrapped/campaign', {
    targetFile: fixturePath,
    targetMethod: 'index'
  });

  const res = synth.generateSequenceDiagram(trace, 'standard');
  assert.ok(res.isValid, 'Diagram Mermaid yang dihasilkan harus valid 100%');
  assert.ok(res.fixedMermaid.includes('box "Application Layer" #1e293b'), 'Harus menyertakan box Application Layer');
  assert.ok(res.fixedMermaid.includes('box "Persistence & Cache Layer" #0f172a'), 'Harus menyertakan box Persistence & Cache Layer');
  assert.ok(res.fixedMermaid.includes('box "Cloud Storage" #1e1e2e'), 'Harus menyertakan box Cloud Storage');
  assert.ok(res.fixedMermaid.includes('alt Cache HIT'), 'Harus menyertakan percabangan alt Cache HIT');
  assert.ok(res.fixedMermaid.includes('else Cache MISS'), 'Harus menyertakan percabangan else Cache MISS');
});

// 16. Test SynthesizerEngine: Render PlantUML dengan Box Layer Grouping
await runAsyncTest('SynthesizerEngine: Render PlantUML dengan Box Layer Grouping', async () => {
  const tracer = new TracerEngine({ rootDir: path.resolve(__dirname, '..') });
  const synth = new SynthesizerEngine();
  const fixturePath = path.join(fixturesDir, 'sample_laravel_cache_s3.php');
  const trace = await tracer.traceEndpoint('GET /retailer-wrapped/campaign', {
    targetFile: fixturePath,
    targetMethod: 'index'
  });

  const puml = synth.generatePlantUML(trace);
  assert.ok(puml.includes('@startuml'));
  assert.ok(puml.includes('box "Application Layer" #LightBlue'));
  assert.ok(puml.includes('box "Persistence & Cache Layer" #LightYellow'));
  assert.ok(puml.includes('box "Cloud Storage" #LightCyan'));
  assert.ok(puml.includes('end box'));
  assert.ok(puml.includes('@enduml'));
});

// 17. Test Granularitas Detail Level (L1, L2, L3)
await runAsyncTest('Detail Level Granularity: Perbedaan Output L1, L2, dan L3', async () => {
  const tracer = new TracerEngine({ rootDir: path.resolve(__dirname, '..') });
  const synth = new SynthesizerEngine();
  const fixturePath = path.join(fixturesDir, 'sample_laravel_cache_s3.php');

  const traceL1 = await tracer.traceEndpoint('GET /retailer-wrapped/campaign', {
    targetFile: fixturePath,
    detailLevel: 'L1'
  });
  const resL1 = synth.generateSequenceDiagram(traceL1, 'L1');
  assert.ok(resL1.isValid);
  assert.ok(!resL1.fixedMermaid.includes('Validasi Gagal'), 'L1 tidak boleh menyertakan blok alt validasi');

  const traceL3 = await tracer.traceEndpoint('GET /retailer-wrapped/campaign', {
    targetFile: fixturePath,
    detailLevel: 'L3'
  });
  const resL3 = synth.generateSequenceDiagram(traceL3, 'L3');
  assert.ok(resL3.isValid);
  assert.ok(resL3.fixedMermaid.includes('Note over Ctrl,Redis'), 'L3 harus menyertakan Note over Redis untuk Key dan TTL');
  assert.ok(resL3.fixedMermaid.includes('Note over Ctrl,S3'), 'L3 harus menyertakan Note over S3');
});

// 18. Test Zero-Hallucination Source Code Audit (Tidak boleh ada hardcoded dummy di core/)
runTest('Zero-Hallucination Audit: Bebas dari hardcoded ayowrap, CampaignModel, BaseEntity, processRequest, dan extractBlockByBraces', () => {
  const tracerSource = fs.readFileSync(path.resolve(__dirname, '../core/tracer.js'), 'utf8');
  const synthSource = fs.readFileSync(path.resolve(__dirname, '../core/synthesizer.js'), 'utf8');
  const astSource = fs.readFileSync(path.resolve(__dirname, '../core/ast_parser.js'), 'utf8');

  assert.ok(!tracerSource.includes('ayowrap'), 'core/tracer.js tidak boleh mengandung hardcoded "ayowrap"');
  assert.ok(!astSource.includes('ayowrap'), 'core/ast_parser.js tidak boleh mengandung hardcoded "ayowrap"');
  assert.ok(!tracerSource.includes('CampaignModel'), 'core/tracer.js tidak boleh mengandung hardcoded "CampaignModel"');
  assert.ok(!tracerSource.includes('processRequest'), 'core/tracer.js tidak boleh mengandung placeholder "processRequest"');
  assert.ok(!tracerSource.includes('extractBlockByBraces'), 'core/tracer.js harus mengganti extractBlockByBraces dengan AST parser');
  assert.ok(!synthSource.includes('BaseEntity'), 'core/synthesizer.js tidak boleh mengandung static "BaseEntity"');
});

// 19. Test PolyglotAstParser: Token-Aware Parsing & Multi-File Resolution
runTest('PolyglotAstParser: Token-aware block extraction kebal terhadap kurung kurawal di dalam komentar/string', () => {
  const parser = new PolyglotAstParser({ rootDir: path.resolve(__dirname, '..') });
  const trickyCode = `
    export class OrderService {
      // Komentar dengan kurung kurawal palsu { { {
      async executeOrder(orderId) {
        const msg = "String dengan kurung penutup palsu } } }";
        return Database.save(orderId, msg);
      }
    }
  `;
  const node = parser.findFunctionNode(trickyCode, 'executeOrder', 'typescript');
  assert.ok(node, 'Harus berhasil mengekstrak method executeOrder');
  assert.ok(node.body.includes('Database.save(orderId, msg)'), 'Body method tidak boleh terpotong oleh "}" di dalam string');
});

// 20. Test ValidatorEngine dengan Theme Directive %%{init:...}%% dan Operator Panah
await runAsyncTest('ValidatorEngine: Self-healing dengan %%{init}%% directive & preservasi operator "->"', async () => {
  const validator = new ValidatorEngine();
  const mermaidWithDirective = [
    `%%{init: {'theme': 'dark'}}%%`,
    `sequenceDiagram`,
    `    autonumber`,
    `    participant Ctrl`,
    `    participant S3`,
    `    alt Kondisi S3`,
    `        Ctrl->>S3: getObjectContent(record->s3_path)`
  ].join('\n');

  const valRes = validator.validateAndRepair(mermaidWithDirective);
  assert.ok(valRes.fixedMermaid.includes('end'), 'Validator harus tetap menutup blok alt meskipun ada directive %%{init}%% di baris pertama');
  assert.ok(valRes.fixedMermaid.includes('record->s3_path'), 'Validator tidak boleh merusak operator panah "->" di dalam teks pesan');
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
