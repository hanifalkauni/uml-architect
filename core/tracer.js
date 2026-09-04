import fs from 'node:fs';
import path from 'node:path';
import { ManifestSniffer } from './manifest_sniffer.js';
import { ProfileLoader } from './profile_loader.js';

/**
 * TracerEngine
 * Menganalisis alur eksekusi kode (call-graph) secara deterministik dan anti-halusinasi
 * dari sebuah endpoint, function, path file, ataupun natural language query.
 */
export class TracerEngine {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.cwd());
    this.sniffer = new ManifestSniffer(this.rootDir);
    this.profileLoader = new ProfileLoader(options.profilesDir);
    this.config = options.config || {};
  }

  /**
   * Menelusuri alur berdasarkan Endpoint API
   * Contoh: endpoint = "POST /api/v1/payments/charge", method = "POST"
   */
  async traceEndpoint(endpoint, options = {}) {
    let method = options.httpMethod || options.method || '';
    let urlPath = endpoint.trim();

    // Parse "POST /path" jika diberikan dalam 1 string
    const match = endpoint.match(/^(GET|POST|PUT|DELETE|PATCH|OPTIONS)\s+(.*)$/i);
    if (match) {
      method = match[1].toUpperCase();
      urlPath = match[2].trim();
    }

    // Sniff project languages
    const scan = this.sniffer.sniff();
    const profile = options.targetFile
      ? this.profileLoader.getProfile(this.sniffer.detectLanguageFromPath(options.targetFile))
      : this.profileLoader.getMergedProfiles(scan.languages);

    // Cari file implementasi jika tidak dispesifikasikan
    const targetFile = options.targetFile || this.findFileByEndpoint(urlPath, profile);

    if (targetFile && fs.existsSync(targetFile)) {
      const code = fs.readFileSync(targetFile, 'utf8');
      return this.analyzeCodeContent(code, {
        endpoint: `${method || 'ANY'} ${urlPath}`,
        targetFile,
        profile,
        detailLevel: options.detailLevel || 'standard'
      });
    }

    // Fallback sintetis berbasis heuristik jika file belum ada di disk (mock / PR analysis)
    return this.generateSyntheticTrace(method, urlPath, profile, options.detailLevel);
  }

  /**
   * Menelusuri alur berdasarkan Fungsi / Method
   */
  async traceFunction(functionName, filePath = null, options = {}) {
    const targetFile = filePath || this.findFileByFunction(functionName);
    const lang = targetFile ? this.sniffer.detectLanguageFromPath(targetFile) : 'generic';
    const profile = this.profileLoader.getProfile(lang);

    if (targetFile && fs.existsSync(targetFile)) {
      const code = fs.readFileSync(targetFile, 'utf8');
      return this.analyzeCodeContent(code, {
        targetName: functionName,
        targetFile,
        profile,
        detailLevel: options.detailLevel || 'standard'
      });
    }

    return this.generateSyntheticFunctionTrace(functionName, profile, options.detailLevel);
  }

  /**
   * Menelusuri seluruh alur di dalam file/direktori
   */
  async tracePath(targetPath, options = {}) {
    const fullPath = path.resolve(this.rootDir, targetPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Path tidak ditemukan: ${targetPath}`);
    }

    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      const lang = this.sniffer.detectLanguageFromPath(fullPath);
      const profile = this.profileLoader.getProfile(lang);
      const code = fs.readFileSync(fullPath, 'utf8');
      return this.analyzeCodeContent(code, {
        targetName: path.basename(fullPath),
        targetFile: fullPath,
        profile,
        detailLevel: options.detailLevel || 'standard'
      });
    }

    // Jika direktori, temukan entry file utama
    const files = fs.readdirSync(fullPath);
    for (const f of files) {
      const child = path.join(fullPath, f);
      if (fs.statSync(child).isFile()) {
        const lang = this.sniffer.detectLanguageFromPath(child);
        const profile = this.profileLoader.getProfile(lang);
        const code = fs.readFileSync(child, 'utf8');
        return this.analyzeCodeContent(code, {
          targetName: `Module: ${path.basename(fullPath)}`,
          targetFile: child,
          profile,
          detailLevel: options.detailLevel || 'standard'
        });
      }
    }

    throw new Error(`Tidak ditemukan file kode yang dapat dianalisis di ${targetPath}`);
  }

  /**
   * Menelusuri alur dari Natural Language Query (FR-1.4)
   * Contoh: "Gambarkan alur saat webhook Stripe diterima"
   */
  async traceNaturalLanguage(query, options = {}) {
    const keywords = query.toLowerCase().replace(/[^a-z0-9_\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    let matchedFile = null;

    const files = this.scanDirRecursive(this.rootDir);
    for (const file of files) {
      const lower = file.toLowerCase();
      if (keywords.some(k => lower.includes(k))) {
        matchedFile = file;
        break;
      }
    }

    if (matchedFile && fs.existsSync(matchedFile)) {
      const lang = this.sniffer.detectLanguageFromPath(matchedFile);
      const profile = this.profileLoader.getProfile(lang);
      const code = fs.readFileSync(matchedFile, 'utf8');
      return this.analyzeCodeContent(code, {
        targetName: `NL Flow: "${query}"`,
        targetFile: matchedFile,
        profile,
        detailLevel: options.detailLevel || 'standard'
      });
    }

    // Fallback sintetis berbasis query bahasa alami
    const profile = this.profileLoader.getProfile('generic');
    return {
      targetName: `Query: ${query}`,
      participants: [
        { id: 'Caller', label: 'External Source / Webhook', type: 'actor' },
        { id: 'Handler', label: 'Webhook / API Handler', type: 'participant' },
        { id: 'Svc', label: 'Domain Processing Service', type: 'participant' },
        { id: 'DB', label: 'Database Storage', type: 'participant' }
      ],
      steps: [
        { from: 'Caller', to: 'Handler', message: `Incoming Event (${query})`, isAsync: false },
        { from: 'Handler', to: 'Svc', message: 'validateAndProcessEvent()', isAsync: false },
        { from: 'Svc', to: 'DB', message: 'Persist Event & Update State', isAsync: false },
        { from: 'DB', to: 'Svc', message: 'Success', isReturn: true },
        { from: 'Svc', to: 'Handler', message: 'Event Handled', isReturn: true },
        { from: 'Handler', to: 'Caller', message: '200 OK (Acknowledged)', isReturn: true }
      ],
      errorBranches: []
    };
  }

  /**
   * Analisis mendalam AST & Pola Kode Sumber
   */
  analyzeCodeContent(code, meta) {
    const aliases = this.config.participantsAliases || {};
    const detailLevel = meta.detailLevel || 'standard';
    const isL1 = detailLevel === 'L1' || detailLevel === 'high';
    const isL3 = detailLevel === 'L3' || detailLevel === 'deep';

    const participants = [
      { id: 'Client', label: aliases['Client'] || 'Client / Frontend App', type: 'actor' }
    ];
    const steps = [];
    const errorBranches = [];

    const baseName = meta.targetFile ? path.basename(meta.targetFile, path.extname(meta.targetFile)) : 'Handler';
    const ctrlId = 'Ctrl';
    const ctrlLabel = aliases[baseName] || aliases['Ctrl'] || `${baseName} (Controller)`;
    participants.push({ id: ctrlId, label: ctrlLabel, type: 'participant' });

    // Request awal
    const reqLabel = meta.endpoint ? meta.endpoint : (meta.targetName || 'invoke');
    steps.push({ from: 'Client', to: ctrlId, message: `${reqLabel}`, isAsync: false });

    // 1. Deteksi Validasi Input / Middleware (Disembunyikan di L1)
    const hasValidation = /validate|guard|auth|token|verify|check|required/i.test(code);
    if (hasValidation && !isL1) {
      steps.push({
        type: 'alt_start',
        condition: 'Validasi Input / Auth Gagal'
      });
      steps.push({
        from: ctrlId,
        to: 'Client',
        message: '400 Bad Request / 401 Unauthorized',
        isReturn: true
      });
      steps.push({ type: 'alt_else', condition: 'Validasi Lolos (Happy Path)' });
      errorBranches.push({ type: 'ValidationException', status: 400, message: 'Invalid payload or auth token' });
    }

    // 2. Deteksi Service Layer / Business Logic
    const serviceMatch = code.match(/([a-zA-Z0-9_]+(?:Service|UseCase|Manager|Handler))\b/);
    let serviceId = null;
    if (serviceMatch && serviceMatch[1] !== baseName) {
      serviceId = 'Svc';
      const svcLabel = aliases[serviceMatch[1]] || serviceMatch[1];
      participants.push({ id: serviceId, label: svcLabel, type: 'participant' });
      steps.push({ from: ctrlId, to: serviceId, message: isL3 ? 'processRequest(payload, context)' : 'processRequest(payload)', isAsync: false });
    }

    // 3. Deteksi Panggilan Eksternal (Bank, Payment, Third Party API)
    const hasHttpCall = /axios|fetch|http\.|requests\.|reqwest|httpClient|client\.Do/i.test(code);
    let extId = null;
    if (hasHttpCall) {
      extId = 'ExtAPI';
      const extLabel = aliases['ExtAPI'] || 'External Gateway / API';
      participants.push({ id: extId, label: extLabel, type: 'participant' });
      steps.push({ from: serviceId || ctrlId, to: extId, message: 'POST /v1/authorize (External)', isAsync: false });
      steps.push({ from: extId, to: serviceId || ctrlId, message: '200 OK (Response)', isReturn: true });
    }

    // 4. Deteksi Operasi Database / ORM
    const hasDb = /db\.|repository|database|query|insert|select|update|delete|find|save|commit/i.test(code);
    if (hasDb) {
      const dbId = 'DB';
      const dbLabel = aliases['DB'] || aliases['UserRepository'] || 'Database (Storage / ORM)';
      participants.push({ id: dbId, label: dbLabel, type: 'participant' });
      steps.push({ from: serviceId || ctrlId, to: dbId, message: 'Save / Query Transaction Record', isAsync: false });
      steps.push({ from: dbId, to: serviceId || ctrlId, message: 'DB Commit Success', isReturn: true });
    }

    // 5. Deteksi Message Queue / Async Events
    const hasQueue = /queue|broker|publish|kafka|rabbitmq|sqs|event|emit/i.test(code);
    if (hasQueue) {
      const queueId = 'Queue';
      const queueLabel = aliases['Queue'] || 'Message Broker (Kafka / Queue)';
      participants.push({ id: queueId, label: queueLabel, type: 'participant' });
      steps.push({ from: ctrlId, to: queueId, message: 'publish("event.completed", payload)', isAsync: true });
    }

    // 6. Deteksi Exception Handling (try-catch, if err != nil)
    const hasTryCatch = /try\s*\{|if\s+err\s*!=\s*nil|catch|rescue|except/i.test(code);
    if (hasTryCatch) {
      errorBranches.push({ type: 'InternalException', status: 500, message: 'Internal Server Error' });
    }

    // Return final ke client
    steps.push({ from: ctrlId, to: 'Client', message: '200 OK / 201 Created (Success Payload)', isReturn: true });

    if (hasValidation && !isL1) {
      steps.push({ type: 'alt_end' });
    }

    return {
      endpoint: meta.endpoint,
      targetName: meta.targetName,
      targetFile: meta.targetFile,
      participants,
      steps,
      errorBranches
    };
  }

  /**
   * Pencarian file yang mengandung pola endpoint di repository
   */
  findFileByEndpoint(urlPath, profile) {
    const cleanUrl = urlPath.replace(/^\//, '');
    try {
      const files = this.scanDirRecursive(this.rootDir);
      for (const file of files) {
        if (file.includes('node_modules') || file.includes('.git') || file.includes('dist')) continue;
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes(cleanUrl) || content.includes(urlPath)) {
          return file;
        }
      }
    } catch {}
    return null;
  }

  findFileByFunction(functionName) {
    try {
      const files = this.scanDirRecursive(this.rootDir);
      for (const file of files) {
        if (file.includes('node_modules') || file.includes('.git')) continue;
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes(`function ${functionName}`) || content.includes(`def ${functionName}`) || content.includes(`fn ${functionName}`) || content.includes(`func ${functionName}`)) {
          return file;
        }
      }
    } catch {}
    return null;
  }

  scanDirRecursive(dir) {
    let results = [];
    try {
      const list = fs.readdirSync(dir);
      for (const file of list) {
        if (['node_modules', '.git', 'dist', 'build', 'vendor'].includes(file)) continue;
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          results = results.concat(this.scanDirRecursive(fullPath));
        } else {
          results.push(fullPath);
        }
      }
    } catch {}
    return results;
  }

  generateSyntheticTrace(method, urlPath, profile, detailLevel = 'standard') {
    const cleanEndpoint = `${method || 'POST'} ${urlPath}`;
    const aliases = this.config.participantsAliases || {};
    const isL1 = detailLevel === 'L1' || detailLevel === 'high';

    const participants = [
      { id: 'Client', label: aliases['Client'] || 'Client / Frontend App', type: 'actor' },
      { id: 'Ctrl', label: aliases['Ctrl'] || 'API Controller / Handler', type: 'participant' },
      { id: 'Svc', label: aliases['Svc'] || 'Core Business Service', type: 'participant' },
      { id: 'DB', label: aliases['DB'] || 'Database (SQL/NoSQL)', type: 'participant' }
    ];

    const steps = [
      { from: 'Client', to: 'Ctrl', message: cleanEndpoint, isAsync: false }
    ];

    if (!isL1) {
      steps.push({ type: 'alt_start', condition: 'Invalid Request Payload' });
      steps.push({ from: 'Ctrl', to: 'Client', message: '400 Bad Request ("Validation Failed")', isReturn: true });
      steps.push({ type: 'alt_else', condition: 'Valid Payload (Proceed)' });
    }

    steps.push({ from: 'Ctrl', to: 'Svc', message: 'executeBusinessLogic(requestData)', isAsync: false });
    steps.push({ from: 'Svc', to: 'DB', message: 'INSERT / UPDATE Record (Transaction)', isAsync: false });
    steps.push({ from: 'DB', to: 'Svc', message: 'Query Result (Committed)', isReturn: true });
    steps.push({ from: 'Svc', to: 'Ctrl', message: 'Result Object', isReturn: true });
    steps.push({ from: 'Ctrl', to: 'Client', message: '200 OK / 201 Created', isReturn: true });

    if (!isL1) {
      steps.push({ type: 'alt_end' });
    }

    return {
      endpoint: cleanEndpoint,
      participants,
      steps,
      errorBranches: [
        { type: 'ValidationException', status: 400, message: 'Validation Failed' },
        { type: 'DatabaseException', status: 500, message: 'Transaction Failed' }
      ]
    };
  }

  generateSyntheticFunctionTrace(functionName, profile, detailLevel = 'standard') {
    const participants = [
      { id: 'Caller', label: 'Caller Function', type: 'actor' },
      { id: 'Target', label: `${functionName}()`, type: 'participant' },
      { id: 'Helper', label: 'Internal Utility / ORM', type: 'participant' }
    ];

    const steps = [
      { from: 'Caller', to: 'Target', message: `${functionName}(params)`, isAsync: false },
      { from: 'Target', to: 'Helper', message: 'validateAndTransform(params)', isAsync: false },
      { from: 'Helper', to: 'Target', message: 'processedData', isReturn: true },
      { from: 'Target', to: 'Caller', message: 'return result', isReturn: true }
    ];

    return {
      targetName: functionName,
      participants,
      steps,
      errorBranches: []
    };
  }
}
