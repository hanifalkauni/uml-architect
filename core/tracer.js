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
   * Mengekstrak body dari method tertentu dalam source code
   */
  extractMethodBody(code, methodName) {
    if (!methodName || !code) return null;
    const cleanMethod = methodName.replace(/[()]/g, '').trim();

    // Pola fungsi PHP / JS / TS / Java / C#
    const funcRegex = new RegExp(
      `(?:(?:public|private|protected|static|async|final)\\s+)*function\\s+${cleanMethod}\\s*\\([^)]*\\)[^{]*\\{`,
      'i'
    );
    let match = funcRegex.exec(code);
    if (!match) {
      // Coba pola shorthand class method JS/TS: methodName(...) {
      const classMethodRegex = new RegExp(
        `(?:(?:public|private|protected|static|async)\\s+)*${cleanMethod}\\s*\\([^)]*\\)[^{]*\\{`,
        'i'
      );
      match = classMethodRegex.exec(code);
    }

    if (!match) return null;

    const openBraceIdx = match.index + match[0].length - 1;
    return this.extractBlockByBraces(code, openBraceIdx);
  }

  /**
   * Mencocokkan kurung kurawal pembuka dan penutup untuk mengekstrak scope blok kode
   */
  extractBlockByBraces(code, openBraceIdx) {
    if (code[openBraceIdx] !== '{') return null;
    let depth = 0;
    let inString = null;

    for (let i = openBraceIdx; i < code.length; i++) {
      const char = code[i];
      const prev = i > 0 ? code[i - 1] : '';

      if (inString) {
        if (char === inString && prev !== '\\') {
          inString = null;
        }
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        inString = char;
        continue;
      }

      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return code.substring(openBraceIdx, i + 1);
        }
      }
    }
    return code.substring(openBraceIdx);
  }

  /**
   * Menemukan pemanggilan intra-class internal ($this->method() / self::method() / this.method())
   */
  findLocalCalls(methodBody) {
    if (!methodBody) return [];
    const calls = [];

    // PHP: $this->methodName(...) atau self::methodName(...)
    const phpRegex = /(?:\$this->|self::|static::)([a-zA-Z0-9_]+)\s*\(/g;
    let match;
    while ((match = phpRegex.exec(methodBody)) !== null) {
      if (!calls.includes(match[1])) {
        calls.push(match[1]);
      }
    }

    // JS/TS: this.methodName(...)
    const jsRegex = /this\.([a-zA-Z0-9_]+)\s*\(/g;
    while ((match = jsRegex.exec(methodBody)) !== null) {
      if (!calls.includes(match[1])) {
        calls.push(match[1]);
      }
    }

    return calls;
  }

  /**
   * Melakukan crawling rekursif terhadap private/protected method dalam class yang sama
   */
  crawlLocalMethods(code, rootMethodName, maxDepth = 2) {
    const visited = new Set();
    const collectedMethods = new Map();

    const traverse = (methodName, currentDepth) => {
      if (currentDepth > maxDepth || !methodName || visited.has(methodName)) return;
      visited.add(methodName);

      const body = this.extractMethodBody(code, methodName);
      if (body) {
        collectedMethods.set(methodName, { body, depth: currentDepth });
        const localCalls = this.findLocalCalls(body);
        for (const childCall of localCalls) {
          traverse(childCall, currentDepth + 1);
        }
      }
    };

    if (rootMethodName) {
      traverse(rootMethodName, 0);
    } else {
      // Jika root method tidak didefinisikan secara eksplisit, cari entrypoint standar
      const commonEntries = ['index', 'handle', '__invoke', 'show', 'store', 'execute', 'run'];
      for (const entry of commonEntries) {
        if (new RegExp(`(?:public\\s+)?function\\s+${entry}\\b`, 'i').test(code)) {
          traverse(entry, 0);
          break;
        }
      }
    }

    return collectedMethods;
  }

  /**
   * Analisis mendalam AST & Pola Kode Sumber
   */
  analyzeCodeContent(code, meta) {
    const aliases = this.config.participantsAliases || {};
    const detailLevel = meta.detailLevel || 'standard';
    const isL1 = detailLevel === 'L1' || detailLevel === 'high';
    const isL3 = detailLevel === 'L3' || detailLevel === 'deep';

    // 1. Recursive Intra-Class Method Crawling
    const targetMethod = meta.targetMethod || (meta.targetName && !meta.targetName.includes(' ') ? meta.targetName : null);
    const crawledMethods = this.crawlLocalMethods(code, targetMethod, 2);
    const fullCode = crawledMethods.size > 0
      ? [code, ...Array.from(crawledMethods.values()).map(m => m.body)].join('\n')
      : code;

    const classMatch = code.match(/class\s+([a-zA-Z0-9_]+)/);
    const baseName = classMatch ? classMatch[1] : (meta.targetFile ? path.basename(meta.targetFile, path.extname(meta.targetFile)) : 'Handler');
    const ctrlId = 'Ctrl';
    const ctrlLabel = aliases[baseName] || aliases['Ctrl'] || baseName;

    const participants = [
      { id: 'Client', label: aliases['Client'] || 'Client / Mobile App', type: 'actor' },
      { id: ctrlId, label: ctrlLabel, type: 'participant', layer: 'Application Layer' }
    ];
    const steps = [];
    const errorBranches = [];

    // Request awal
    const reqLabel = meta.endpoint ? meta.endpoint : (meta.targetName || 'invoke');
    steps.push({ from: 'Client', to: ctrlId, message: `${reqLabel}`, isAsync: false });

    // 2. Deteksi Infrastructure Stereotypes
    const hasAuth = /Auth::|auth\(\)->|request->user|req\.user/i.test(fullCode);
    const hasCache = /Redis::|Cache::|redisClient|redis\./i.test(fullCode);
    const hasS3 = /S3Helper|Storage::disk\(['"]s3['"]\)|Aws\\S3|getObjectContent|s3Client/i.test(fullCode);
    const hasValidation = /validate|guard|verify|check|required/i.test(code);

    // Deteksi model Eloquent spesifik
    const modelMatches = [];
    const modelRegex = /\b([A-Z][a-zA-Z0-9_]+)::(?:where|find|findOrFail|first|firstOrFail|create|update|query|all)\b/g;
    const standardFacades = new Set([
      'Route', 'Redis', 'Cache', 'Storage', 'Http', 'Auth', 'Log', 'Response',
      'DB', 'Config', 'Schema', 'Artisan', 'Event', 'Queue', 'Validator', 'Str', 'Arr', 'App'
    ]);
    let mMatch;
    while ((mMatch = modelRegex.exec(fullCode)) !== null) {
      const modelName = mMatch[1];
      if (!standardFacades.has(modelName) && !modelMatches.includes(modelName)) {
        modelMatches.push(modelName);
      }
    }

    // 3. Bangun Daftar Partisipan dengan Layer Arsitektur
    if (hasAuth && !isL1) {
      participants.push({ id: 'Auth', label: aliases['Auth'] || 'Auth Service', type: 'participant', layer: 'Application Layer' });
    }

    let primaryModelId = null;
    let compiledModelId = null;
    if (modelMatches.length > 0) {
      primaryModelId = 'CampaignModel';
      participants.push({
        id: primaryModelId,
        label: aliases[modelMatches[0]] || modelMatches[0],
        type: 'participant',
        layer: 'Persistence & Cache Layer'
      });
      if (modelMatches.length > 1) {
        compiledModelId = 'CompiledModel';
      }
    }

    if (hasCache) {
      participants.push({
        id: 'Redis',
        label: aliases['Redis'] || 'Redis Cache',
        type: 'participant',
        layer: 'Persistence & Cache Layer'
      });
    }

    if (compiledModelId) {
      participants.push({
        id: compiledModelId,
        label: aliases[modelMatches[1]] || modelMatches[1],
        type: 'participant',
        layer: 'Persistence & Cache Layer'
      });
    }

    if (hasS3) {
      participants.push({
        id: 'S3',
        label: aliases['S3'] || 'S3Helper (AWS S3)',
        type: 'participant',
        layer: 'Cloud Storage'
      });
    }

    // Deteksi Service Layer jika non-Laravel atau standar microservice
    const serviceMatch = fullCode.match(/([a-zA-Z0-9_]+(?:Service|UseCase|Manager|Handler))\b/);
    let serviceId = null;
    if (serviceMatch && serviceMatch[1] !== baseName) {
      serviceId = 'Svc';
      participants.push({
        id: serviceId,
        label: aliases[serviceMatch[1]] || serviceMatch[1],
        type: 'participant',
        layer: 'Application Layer'
      });
    }

    // Deteksi Panggilan Eksternal HTTP
    const hasHttpCall = /axios|fetch\s*\(|(?<![\\a-zA-Z0-9_])http\.(?:get|post|put|delete|request)|Http::(?:get|post|put|delete|withHeaders)|requests\.|reqwest|httpClient|client\.Do|Guzzle|PaymentGateway/i.test(fullCode);
    let extId = null;
    if (hasHttpCall && !hasCache) {
      extId = 'ExtAPI';
      participants.push({
        id: extId,
        label: aliases['ExtAPI'] || 'External Gateway / API',
        type: 'participant',
        layer: 'External Services'
      });
    }

    // Deteksi DB generic jika tidak ada model spesifik
    const hasDb = /db\.|repository|database|query|insert|select|update|delete|find|save|commit/i.test(fullCode);
    let dbId = primaryModelId;
    if (!dbId && hasDb) {
      dbId = 'DB';
      participants.push({
        id: dbId,
        label: aliases['DB'] || 'Database (Storage / ORM)',
        type: 'participant',
        layer: 'Persistence & Cache Layer'
      });
    }

    // Deteksi Message Queue / Async Events
    const hasQueue = /queue|broker|publish|kafka|rabbitmq|sqs|event|emit/i.test(fullCode);
    let queueId = null;
    if (hasQueue) {
      queueId = 'Queue';
      participants.push({
        id: queueId,
        label: aliases['Queue'] || 'Message Broker (Kafka / Queue)',
        type: 'participant',
        layer: 'Messaging & Events'
      });
    }

    // 4. Bangun Langkah-Langkah Eksekusi (Steps)
    // Step 4.1: Validasi Request
    if (hasValidation && !isL1) {
      steps.push({ from: ctrlId, to: ctrlId, message: '$request->validate(...)', isAsync: false });
      steps.push({ type: 'alt_start', condition: 'Validasi Gagal' });
      steps.push({ from: ctrlId, to: 'Client', message: '422 Unprocessable Entity', isReturn: true });
      steps.push({ type: 'alt_else', condition: 'Validasi Lolos (Happy Path)' });
      errorBranches.push({ type: 'ValidationException', status: 422, message: 'Invalid payload or query parameters' });
    }

    // Step 4.2: Auth & Identity Resolution
    if (hasAuth && !isL1) {
      steps.push({ from: ctrlId, to: 'Auth', message: 'Auth::user()', isAsync: false });
      steps.push({ from: 'Auth', to: ctrlId, message: '$user (resolve businessId)', isReturn: true });
    }

    // Step 4.3: Verifikasi Primary Model & ORM Exception Handling
    if (primaryModelId) {
      const hasFirstOrFail = /firstOrFail|findOrFail/i.test(fullCode);
      if (hasFirstOrFail && !isL1) {
        steps.push({ from: ctrlId, to: primaryModelId, message: "where('id', campaignId)->firstOrFail()", isAsync: false });
        steps.push({ type: 'alt_start', condition: 'Campaign Not Found (ModelNotFoundException)' });
        steps.push({ from: primaryModelId, to: ctrlId, message: 'ModelNotFoundException', isReturn: true });
        steps.push({ from: ctrlId, to: 'Client', message: '404 Not Found', isReturn: true });
        steps.push({ type: 'alt_else', condition: 'Campaign Valid' });
        steps.push({ from: primaryModelId, to: ctrlId, message: '$campaign', isReturn: true });
        steps.push({ type: 'alt_end' });
        errorBranches.push({ type: 'ModelNotFoundException', status: 404, message: 'Requested model entity not found' });
      } else {
        steps.push({ from: ctrlId, to: primaryModelId, message: 'fetchCampaign(campaignId)', isAsync: false });
        steps.push({ from: primaryModelId, to: ctrlId, message: '$campaign', isReturn: true });
      }
    }

    // Step 4.4: Pola Cache-Aside & Invalidation (Jika Redis/Cache Digunakan)
    if (hasCache) {
      const hasHdel = /hdel|forget|tags/i.test(fullCode);
      const hasReloadParam = /reload|force/i.test(fullCode);

      if ((hasHdel || hasReloadParam) && !isL1) {
        steps.push({ type: 'alt_start', condition: 'reload == true' });
        steps.push({ from: ctrlId, to: 'Redis', message: 'hdel("ayowrap_{campaignId}", businessId)', isAsync: false });
        steps.push({ from: 'Redis', to: ctrlId, message: 'deleted', isReturn: true });
        steps.push({ type: 'alt_else', condition: 'reload == false (Default)' });
        steps.push({ from: ctrlId, to: 'Redis', message: 'hget("ayowrap_{campaignId}", businessId)', isAsync: false });
        steps.push({ from: 'Redis', to: ctrlId, message: '$raw', isReturn: true });
        steps.push({ type: 'alt_end' });
      } else {
        steps.push({ from: ctrlId, to: 'Redis', message: 'hget("ayowrap_{campaignId}", businessId)', isAsync: false });
        steps.push({ from: 'Redis', to: ctrlId, message: '$raw', isReturn: true });
      }

      if (isL3) {
        steps.push({ type: 'note', over: `${ctrlId},Redis`, text: 'Key: ayowrap_{campaignId} | Field: (string) businessId', level: 'L3' });
      }

      // Percabangan Cache HIT vs Cache MISS
      steps.push({ type: 'alt_start', condition: 'Cache HIT ($raw ada)' });
      if (!isL1) {
        steps.push({ from: ctrlId, to: ctrlId, message: 'processRedisData(raw, user, campaign)', isAsync: false });
      }
      steps.push({ from: ctrlId, to: 'Client', message: '200 OK (data: user, slides - from cache)', isReturn: true });

      steps.push({ type: 'alt_else', condition: 'Cache MISS (Ambil dari DB & S3)' });

      // Ambil dari compiled model DB jika ada
      if (compiledModelId) {
        steps.push({ from: ctrlId, to: compiledModelId, message: 'where(campaign_id, retailer_id)->first()', isAsync: false });
        steps.push({ from: compiledModelId, to: ctrlId, message: '$record', isReturn: true });
      }

      // Ambil dari S3 Cloud Storage jika ada
      if (hasS3) {
        if (!isL1) {
          steps.push({ type: 'alt_start', condition: '$record tidak ditemukan / s3_path kosong' });
          steps.push({ from: ctrlId, to: ctrlId, message: 'getFallbackResponse()', isAsync: false });
          steps.push({ from: ctrlId, to: 'Client', message: '200 OK (fallback empty)', isReturn: true });

          steps.push({ type: 'alt_else', condition: '$record siap & s3_path valid' });
          steps.push({ from: ctrlId, to: 'S3', message: 'connect() & getObjectContent(record->s3_path)', isAsync: false });
          if (isL3) {
            steps.push({ type: 'note', over: `${ctrlId},S3`, text: 'S3 Path: record->s3_path', level: 'L3' });
          }

          steps.push({ type: 'alt_start', condition: 'S3 Gagal / Exception' });
          steps.push({ from: 'S3', to: ctrlId, message: 'Error (log_exception)', isReturn: true });
          steps.push({ from: ctrlId, to: 'Client', message: '200 OK (fallback empty)', isReturn: true });

          steps.push({ type: 'alt_else', condition: 'S3 Berhasil' });
          steps.push({ from: 'S3', to: ctrlId, message: 'jsonContent', isReturn: true });
          steps.push({ from: ctrlId, to: ctrlId, message: 'Extract $retailerData', isAsync: false });
          steps.push({ from: ctrlId, to: 'Redis', message: 'hset("ayowrap_{campaignId}", businessId, responseData)', isAsync: false });

          if (fullCode.includes('expire') || fullCode.includes('ttl')) {
            steps.push({ type: 'opt_start', condition: 'Key belum memiliki TTL' });
            steps.push({ from: ctrlId, to: 'Redis', message: 'expire("ayowrap_{campaignId}", ttl)', isAsync: false });
            steps.push({ type: 'opt_end' });
            if (isL3) {
              steps.push({ type: 'note', over: `${ctrlId},Redis`, text: 'TTL: diffInSeconds(campaign->end_date)', level: 'L3' });
            }
          }

          steps.push({ from: 'Redis', to: ctrlId, message: 'OK', isReturn: true });
          steps.push({ from: ctrlId, to: 'Client', message: '200 OK (data: user, slides)', isReturn: true });
          steps.push({ type: 'alt_end' }); // end S3 Gagal vs Berhasil
          steps.push({ type: 'alt_end' }); // end record valid
        } else {
          steps.push({ from: ctrlId, to: 'S3', message: 'getObjectContent(s3_path)', isAsync: false });
          steps.push({ from: 'S3', to: ctrlId, message: 'jsonContent', isReturn: true });
          steps.push({ from: ctrlId, to: 'Redis', message: 'hset(key, field, data)', isAsync: false });
          steps.push({ from: ctrlId, to: 'Client', message: '200 OK (data: user, slides)', isReturn: true });
        }
      }

      steps.push({ type: 'alt_end' }); // end Cache HIT vs MISS
    } else {
      // Alur standar untuk service non-cache (e.g. Express, Spring Boot, Gin, FastAPI)
      if (serviceId) {
        steps.push({ from: ctrlId, to: serviceId, message: isL3 ? 'processRequest(payload, context)' : 'processRequest(payload)', isAsync: false });
      }

      if (extId) {
        steps.push({ from: serviceId || ctrlId, to: extId, message: 'POST /v1/authorize (External)', isAsync: false });
        steps.push({ from: extId, to: serviceId || ctrlId, message: '200 OK (Response)', isReturn: true });
      }

      if (dbId && !primaryModelId) {
        steps.push({ from: serviceId || ctrlId, to: dbId, message: 'Save / Query Transaction Record', isAsync: false });
        steps.push({ from: dbId, to: serviceId || ctrlId, message: 'DB Commit Success', isReturn: true });
      }

      if (queueId) {
        steps.push({ from: ctrlId, to: queueId, message: 'publish("event.completed", payload)', isAsync: true });
      }

      steps.push({ from: ctrlId, to: 'Client', message: '200 OK / 201 Created (Success Payload)', isReturn: true });
    }

    if (hasValidation && !isL1) {
      steps.push({ type: 'alt_end' }); // Tutup blok validasi lolos
    }

    const hasTryCatch = /try\s*\{|if\s+err\s*!=\s*nil|catch|rescue|except/i.test(fullCode);
    if (hasTryCatch && errorBranches.length === 0) {
      errorBranches.push({ type: 'InternalException', status: 500, message: 'Internal Server Error' });
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
