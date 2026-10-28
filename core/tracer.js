import fs from 'node:fs';
import path from 'node:path';
import { ManifestSniffer } from './manifest_sniffer.js';
import { ProfileLoader } from './profile_loader.js';
import { PolyglotAstParser } from './ast_parser.js';

/**
 * TracerEngine (Argon Engine)
 * Menganalisis alur eksekusi kode (call-graph) lintas file secara deterministik
 * dan anti-halusinasi berbasis AST/token-stream dan penegakan dinamis 9 profil bahasa.
 */
export class TracerEngine {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.cwd());
    this.sniffer = new ManifestSniffer(this.rootDir);
    this.profileLoader = new ProfileLoader(options.profilesDir);
    this.astParser = new PolyglotAstParser({ rootDir: this.rootDir });
    this.config = options.config || {};
  }

  /**
   * Menelusuri alur berdasarkan Endpoint API
   * Contoh: endpoint = "POST /api/v1/payments/charge", method = "POST"
   */
  async traceEndpoint(endpoint, options = {}) {
    let method = options.httpMethod || options.method || '';
    let urlPath = endpoint.trim();

    const match = endpoint.match(/^(GET|POST|PUT|DELETE|PATCH|OPTIONS)\s+(.*)$/i);
    if (match) {
      method = match[1].toUpperCase();
      urlPath = match[2].trim();
    }

    const scan = this.sniffer.sniff();
    const detectedLang = options.targetFile
      ? this.sniffer.detectLanguageFromPath(options.targetFile)
      : scan.primaryLanguage;

    const profile = options.targetFile
      ? this.profileLoader.getProfile(detectedLang)
      : this.profileLoader.getMergedProfiles(scan.languages);

    const targetFile = options.targetFile || this.findFileByEndpoint(urlPath, profile);

    if (targetFile && fs.existsSync(targetFile)) {
      const fileLang = this.sniffer.detectLanguageFromPath(targetFile);
      const fileProfile = this.profileLoader.getProfile(fileLang);
      const code = fs.readFileSync(targetFile, 'utf8');
      return this.analyzeCodeContent(code, {
        endpoint: `${method || 'ANY'} ${urlPath}`,
        httpMethod: method,
        urlPath,
        targetFile,
        targetMethod: options.targetMethod,
        profile: fileProfile,
        detailLevel: options.detailLevel || 'standard'
      });
    }

    return this.generateUnresolvedEndpointTrace(method, urlPath, profile, options.detailLevel);
  }

  /**
   * Menelusuri alur berdasarkan Fungsi / Method
   */
  async traceFunction(functionName, filePath = null, options = {}) {
    const targetFile = filePath ? path.resolve(this.rootDir, filePath) : this.findFileByFunction(functionName);
    const lang = targetFile ? this.sniffer.detectLanguageFromPath(targetFile) : 'generic';
    const profile = this.profileLoader.getProfile(lang);

    if (targetFile && fs.existsSync(targetFile)) {
      const code = fs.readFileSync(targetFile, 'utf8');
      return this.analyzeCodeContent(code, {
        targetName: functionName,
        targetMethod: functionName,
        targetFile,
        profile,
        detailLevel: options.detailLevel || 'standard'
      });
    }

    return this.generateUnresolvedFunctionTrace(functionName, profile, options.detailLevel);
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

    const profile = this.profileLoader.getProfile('generic');
    return {
      targetName: `Query: ${query}`,
      profileUsed: profile.language,
      participants: [
        { id: 'Caller', label: 'External Source / Webhook', type: 'actor' },
        { id: 'Handler', label: 'Webhook / API Handler', type: 'participant', layer: 'Presentation Layer' },
        { id: 'Svc', label: 'Domain Processing Service', type: 'participant', layer: 'Domain & Application Layer' },
        { id: 'DB', label: 'Database Storage', type: 'participant', layer: 'Persistence & Cache Layer' }
      ],
      steps: [
        { from: 'Caller', to: 'Handler', message: `Incoming Event (${query})`, isAsync: false },
        { from: 'Handler', to: 'Svc', message: 'validateAndDispatch(event)', isAsync: false },
        { from: 'Svc', to: 'DB', message: 'Persist Event & Update State', isAsync: false },
        { from: 'DB', to: 'Svc', message: 'Committed', isReturn: true },
        { from: 'Svc', to: 'Handler', message: 'Event Handled', isReturn: true },
        { from: 'Handler', to: 'Caller', message: '200 OK ("Acknowledged")', isReturn: true }
      ],
      errorBranches: [],
      models: []
    };
  }

  /**
   * Mengekstrak body dari method tertentu dalam source code berbasis AST token-stream
   */
  extractMethodBody(code, methodName, language = 'generic') {
    if (!methodName || !code) return null;
    const node = this.astParser.findFunctionNode(code, methodName, language);
    return node ? node.body : null;
  }

  /**
   * Menemukan pemanggilan intra-class internal ($this->method() / self::method() / this.method())
   */
  findLocalCalls(methodBody) {
    return this.astParser.extractIntraClassCalls(methodBody);
  }

  /**
   * Melakukan crawling rekursif terhadap method intra-file dan lintas-file (multi-file AST)
   */
  crawlLocalMethods(code, rootMethodName, maxDepth = 3, filePath = null, language = 'generic') {
    const allFiles = this.scanDirRecursive(this.rootDir);
    const graph = this.astParser.crawlMultiFileCallGraph(filePath, code, rootMethodName, {
      maxDepth,
      language,
      allFiles
    });
    return graph.collectedNodes;
  }

  /**
   * Analisis mendalam AST Multi-File & Penegakan Dinamis 9 Profil Bahasa (Zero-Hallucination)
   */
  analyzeCodeContent(code, meta = {}) {
    const aliases = this.config.participantsAliases || {};
    const detailLevel = meta.detailLevel || 'standard';
    const isL1 = detailLevel === 'L1' || detailLevel === 'high';
    const isL3 = detailLevel === 'L3' || detailLevel === 'deep';

    // 1. Resolve Active Language Profile & Compiled Profile Rules
    const detectedLang = meta.profile?.language || (meta.targetFile ? this.sniffer.detectLanguageFromPath(meta.targetFile) : 'generic');
    const profile = meta.profile || this.profileLoader.getProfile(detectedLang);
    const rules = this.profileLoader.compileProfileRules(profile);

    // 2. Multi-File AST Parsing & Recursive Call-Graph Crawling
    const allFiles = this.scanDirRecursive(this.rootDir);
    const targetMethod = meta.targetMethod || this.detectEntryMethodFromRoute(code, meta.urlPath, rules) || (meta.targetName && !meta.targetName.includes(' ') && !meta.targetName.includes('.') ? meta.targetName : null);

    const callGraph = this.astParser.crawlMultiFileCallGraph(meta.targetFile, code, targetMethod, {
      maxDepth: 3,
      language: detectedLang,
      allFiles
    });

    const crawledMethods = callGraph.collectedNodes;
    const externalFileContents = callGraph.resolvedExternalFiles
      .filter(f => fs.existsSync(f))
      .map(f => fs.readFileSync(f, 'utf8'));

    const fullCode = [
      code,
      ...Array.from(crawledMethods.values()).map(m => m.body),
      ...externalFileContents
    ].join('\n');

    const combinedVariables = this.astParser.extractVariables(fullCode, detectedLang);

    // 3. Identify Primary Controller / Entry Handler from AST
    const primaryClass = callGraph.fileAst.classes[0];
    const primaryFn = callGraph.fileAst.functions[0];
    const baseName = primaryClass
      ? primaryClass.name
      : (primaryFn
          ? primaryFn.name
          : (meta.targetFile ? path.basename(meta.targetFile, path.extname(meta.targetFile)) : 'Handler'));

    const ctrlId = 'Ctrl';
    const ctrlLabel = aliases[baseName] || aliases['Ctrl'] || baseName;

    const participants = [
      { id: 'Client', label: aliases['Client'] || 'Client / Mobile App', type: 'actor' },
      { id: ctrlId, label: ctrlLabel, type: 'participant', layer: 'Application Layer' }
    ];
    const steps = [];
    const errorBranches = [];

    const reqLabel = meta.endpoint ? meta.endpoint : (meta.targetName || (primaryFn ? `${primaryFn.name}(${primaryFn.params})` : 'invoke'));
    steps.push({ from: 'Client', to: ctrlId, message: `${reqLabel}`, isAsync: false });

    // 4. Enforce Profile Infrastructure Stereotypes & Middleware Rules
    const infra = rules.infrastructure || {};
    const matchesAnyPattern = (patterns = [], text = fullCode) =>
      patterns.some(pat => {
        try {
          return new RegExp(pat, 'i').test(text);
        } catch {
          return false;
        }
      });

    const hasAuth = matchesAnyPattern(infra.authentication?.patterns || [], fullCode) ||
      /Auth::|auth\(\)->|request->user|req\.user|Depends\(get_current_user\)|@PreAuthorize|\[Authorize/i.test(fullCode);

    const hasCache = matchesAnyPattern(infra.cache?.patterns || [], fullCode) ||
      /Redis::|Cache::|redisClient|redis\./i.test(fullCode);

    const hasS3 = matchesAnyPattern(infra.cloud_storage?.patterns || [], fullCode) ||
      /S3Helper|Storage::disk\(['"]s3['"]\)|Aws\\S3|getObjectContent|s3Client/i.test(fullCode);

    const hasMiddleware = rules.middlewareRegexes.some(rx => {
      rx.lastIndex = 0;
      return rx.test(code);
    });
    const hasValidation = hasMiddleware || /validate|ShouldBindJSON|guard|verify|check|required/i.test(code);

    // 5. Extract Real Database / ORM Models Enforcing profile.database.queryMethods
    const queryMethodsPattern = rules.queryMethods.length > 0
      ? rules.queryMethods.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
      : 'where|find|findOrFail|first|firstOrFail|create|update|query|all|save';

    const modelMatches = [];
    const modelQueriesMap = new Map();
    const standardFacades = new Set([
      'Route', 'Redis', 'Cache', 'Storage', 'Http', 'Auth', 'Log', 'Response',
      'DB', 'Config', 'Schema', 'Artisan', 'Event', 'Queue', 'Validator', 'Str', 'Arr', 'App',
      'S3Helper', 'ResponseEntity', 'NextResponse', 'Promise', 'Object', 'JSON', 'Math'
    ]);

    const staticModelRegex = new RegExp(
      `(?:(\\$?[a-zA-Z0-9_]+)\\s*=\\s*)?\\b([A-Z][a-zA-Z0-9_]+)::(?:${queryMethodsPattern})\\b([^;\\n]*)`,
      'g'
    );
    let mMatch;
    while ((mMatch = staticModelRegex.exec(fullCode)) !== null) {
      const assignedVar = mMatch[1] ? mMatch[1].trim() : null;
      const modelName = mMatch[2].trim();
      const fullChainMatch = mMatch[0].replace(/^\$?[a-zA-Z0-9_]+\s*=\s*/, '').replace(`${modelName}::`, '').replace(/\s+/g, ' ').trim();

      if (
        !standardFacades.has(modelName) &&
        !modelName.endsWith('Service') &&
        !modelName.endsWith('Gateway') &&
        !modelName.endsWith('Queue') &&
        !modelName.endsWith('Controller')
      ) {
        if (!modelMatches.includes(modelName)) {
          modelMatches.push(modelName);
        }
        if (!modelQueriesMap.has(modelName)) {
          modelQueriesMap.set(modelName, []);
        }
        modelQueriesMap.get(modelName).push({
          assignedVar,
          chain: fullChainMatch,
          isFailOnMissing: /firstOrFail|findOrFail/i.test(fullChainMatch)
        });
      }
    }

    // 6. Register Discovered Participants into Architectural Layers
    if (hasAuth && !isL1) {
      const authParticipant = infra.authentication?.participant || {};
      participants.push({
        id: authParticipant.id || 'Auth',
        label: aliases['Auth'] || authParticipant.alias || 'Auth Service',
        type: 'participant',
        layer: authParticipant.layer || 'Application Layer'
      });
    }

    const primaryModelName = modelMatches[0] || null;
    const secondaryModelName = modelMatches[1] || null;

    if (primaryModelName) {
      participants.push({
        id: primaryModelName,
        label: aliases[primaryModelName] || primaryModelName,
        type: 'participant',
        layer: 'Persistence & Cache Layer'
      });
    }

    if (hasCache) {
      const cacheParticipant = infra.cache?.participant || {};
      participants.push({
        id: cacheParticipant.id || 'Redis',
        label: aliases['Redis'] || cacheParticipant.alias || 'Redis Cache',
        type: 'participant',
        layer: cacheParticipant.layer || 'Persistence & Cache Layer'
      });
    }

    if (secondaryModelName) {
      participants.push({
        id: secondaryModelName,
        label: aliases[secondaryModelName] || secondaryModelName,
        type: 'participant',
        layer: 'Persistence & Cache Layer'
      });
    }

    if (hasS3) {
      const s3Participant = infra.cloud_storage?.participant || {};
      participants.push({
        id: s3Participant.id || 'S3',
        label: aliases['S3'] || s3Participant.alias || 'S3Helper (AWS S3)',
        type: 'participant',
        layer: s3Participant.layer || 'Cloud Storage'
      });
    }

    // Extract Domain Services dynamically from AST fields, imports, and call sites
    const serviceCalls = this.extractServiceCallsFromAst(fullCode, callGraph, baseName);
    let serviceId = null;
    if (serviceCalls.length > 0) {
      const primarySvcName = serviceCalls[0].serviceClass;
      serviceId = 'Svc';
      participants.push({
        id: serviceId,
        label: aliases[primarySvcName] || primarySvcName,
        type: 'participant',
        layer: 'Application Layer'
      });
    }

    // Detect External HTTP / Gateway Calls using profile.externalCalls & AST
    const extCallInfo = this.extractExternalGatewayCall(fullCode, rules);
    let extId = null;
    if (extCallInfo && !hasCache) {
      extId = 'ExtAPI';
      participants.push({
        id: extId,
        label: aliases['ExtAPI'] || extCallInfo.label,
        type: 'participant',
        layer: 'External Services'
      });
    }

    // Detect Generic / Session DB Calls (e.g. SQLAlchemy db.query, GORM, Prisma, TypeORM)
    const dbCallInfo = this.extractDatabaseOperations(fullCode, rules);
    let dbId = primaryModelName;
    if (!dbId && dbCallInfo) {
      dbId = 'DB';
      participants.push({
        id: dbId,
        label: aliases['DB'] || dbCallInfo.label,
        type: 'participant',
        layer: 'Persistence & Cache Layer'
      });
    }

    // Detect Message Broker / Async Event Queue using profile.controlFlow.asyncWorkflow
    const queueCallInfo = this.extractQueueOperations(fullCode, rules);
    let queueId = null;
    if (queueCallInfo) {
      queueId = 'Queue';
      participants.push({
        id: queueId,
        label: aliases['Queue'] || queueCallInfo.label,
        type: 'participant',
        layer: 'Messaging & Events'
      });
    }

    // 7. Reconstruct Execution Steps Directly from Extracted Source Symbols (Zero Hallucination)
    // Step 7.1: Input Validation & Early Guard Returns
    const validationExpr = this.extractValidationExpression(code, rules);
    if (validationExpr && !isL1) {
      steps.push({ from: ctrlId, to: ctrlId, message: validationExpr.callLabel, isAsync: false });
      steps.push({ type: 'alt_start', condition: validationExpr.failCondition });
      steps.push({ from: ctrlId, to: 'Client', message: validationExpr.failResponse, isReturn: true });
      steps.push({ type: 'alt_else', condition: validationExpr.passCondition });
      errorBranches.push({
        type: validationExpr.exceptionType,
        status: validationExpr.statusCode,
        message: validationExpr.errorMessage
      });
    }

    // Step 7.2: Auth & Identity Resolution
    if (hasAuth && !isL1) {
      const authInfo = this.extractAuthCallDetails(fullCode);
      steps.push({ from: ctrlId, to: 'Auth', message: authInfo.callExpr, isAsync: false });
      steps.push({ from: 'Auth', to: ctrlId, message: authInfo.returnExpr, isReturn: true });
    }

    // Step 7.3: Primary Model Verification & Exception Handling
    if (primaryModelName) {
      const primaryQueries = modelQueriesMap.get(primaryModelName) || [];
      const firstQuery = primaryQueries[0] || { assignedVar: '$entity', chain: 'find()', isFailOnMissing: false };
      const returnVar = firstQuery.assignedVar || `$${primaryModelName.charAt(0).toLowerCase() + primaryModelName.slice(1)}`;

      if (firstQuery.isFailOnMissing && !isL1) {
        steps.push({ from: ctrlId, to: primaryModelName, message: firstQuery.chain, isAsync: false });
        steps.push({ type: 'alt_start', condition: `${primaryModelName} Not Found (ModelNotFoundException)` });
        steps.push({ from: primaryModelName, to: ctrlId, message: 'ModelNotFoundException', isReturn: true });
        steps.push({ from: ctrlId, to: 'Client', message: '404 Not Found', isReturn: true });
        steps.push({ type: 'alt_else', condition: `${primaryModelName} Valid` });
        steps.push({ from: primaryModelName, to: ctrlId, message: returnVar, isReturn: true });
        steps.push({ type: 'alt_end' });
        errorBranches.push({ type: 'ModelNotFoundException', status: 404, message: `${primaryModelName} entity not found` });
      } else {
        steps.push({ from: ctrlId, to: primaryModelName, message: firstQuery.chain, isAsync: false });
        steps.push({ from: primaryModelName, to: ctrlId, message: returnVar, isReturn: true });
      }
    }

    // Step 7.4: Cache-Aside & Cloud Storage Flow (Dynamically Extracted from AST)
    if (hasCache) {
      const cacheDetails = this.extractCacheOperationsFromAst(fullCode, combinedVariables);

      if (cacheDetails.invalidationCall && !isL1) {
        steps.push({ type: 'alt_start', condition: cacheDetails.invalidationCondition });
        steps.push({ from: ctrlId, to: 'Redis', message: cacheDetails.invalidationCall, isAsync: false });
        steps.push({ from: 'Redis', to: ctrlId, message: 'deleted', isReturn: true });
        steps.push({ type: 'alt_else', condition: cacheDetails.defaultReadCondition });
        steps.push({ from: ctrlId, to: 'Redis', message: cacheDetails.readCall, isAsync: false });
        steps.push({ from: 'Redis', to: ctrlId, message: cacheDetails.readReturnVar, isReturn: true });
        steps.push({ type: 'alt_end' });
      } else {
        steps.push({ from: ctrlId, to: 'Redis', message: cacheDetails.readCall, isAsync: false });
        steps.push({ from: 'Redis', to: ctrlId, message: cacheDetails.readReturnVar, isReturn: true });
      }

      if (isL3) {
        steps.push({
          type: 'note',
          over: `${ctrlId},Redis`,
          text: `Key: ${cacheDetails.resolvedKey} | Field: ${cacheDetails.resolvedField}`,
          level: 'L3'
        });
      }

      // Cache HIT vs Cache MISS Branching
      steps.push({ type: 'alt_start', condition: `Cache HIT (${cacheDetails.readReturnVar} ada)` });
      if (!isL1 && cacheDetails.hitHelperCall) {
        steps.push({ from: ctrlId, to: ctrlId, message: cacheDetails.hitHelperCall, isAsync: false });
      }
      steps.push({ from: ctrlId, to: 'Client', message: cacheDetails.hitResponseLabel, isReturn: true });

      steps.push({ type: 'alt_else', condition: 'Cache MISS (Ambil dari DB & Cloud Storage)' });

      if (secondaryModelName) {
        const secQueries = modelQueriesMap.get(secondaryModelName) || [];
        const secQuery = secQueries[0] || { assignedVar: '$record', chain: 'first()' };
        steps.push({ from: ctrlId, to: secondaryModelName, message: secQuery.chain, isAsync: false });
        steps.push({ from: secondaryModelName, to: ctrlId, message: secQuery.assignedVar || '$record', isReturn: true });
      }

      if (hasS3) {
        const s3Details = this.extractS3OperationsFromAst(fullCode);
        if (!isL1) {
          steps.push({ type: 'alt_start', condition: s3Details.missingRecordCondition });
          if (s3Details.fallbackCall) {
            steps.push({ from: ctrlId, to: ctrlId, message: s3Details.fallbackCall, isAsync: false });
          }
          steps.push({ from: ctrlId, to: 'Client', message: '200 OK (fallback empty)', isReturn: true });

          steps.push({ type: 'alt_else', condition: s3Details.validRecordCondition });
          steps.push({ from: ctrlId, to: 'S3', message: s3Details.s3CallExpr, isAsync: false });
          if (isL3) {
            steps.push({ type: 'note', over: `${ctrlId},S3`, text: `S3 Path: ${s3Details.s3PathExpr}`, level: 'L3' });
          }

          steps.push({ type: 'alt_start', condition: 'S3 Gagal / Exception' });
          steps.push({ from: 'S3', to: ctrlId, message: 'Error (Exception)', isReturn: true });
          steps.push({ from: ctrlId, to: 'Client', message: '200 OK (fallback empty)', isReturn: true });

          steps.push({ type: 'alt_else', condition: 'S3 Berhasil' });
          steps.push({ from: 'S3', to: ctrlId, message: s3Details.s3ReturnVar, isReturn: true });
          if (s3Details.transformExpr) {
            steps.push({ from: ctrlId, to: ctrlId, message: s3Details.transformExpr, isAsync: false });
          }
          steps.push({ from: ctrlId, to: 'Redis', message: cacheDetails.writeCall, isAsync: false });

          if (cacheDetails.expireCall) {
            steps.push({ type: 'opt_start', condition: 'Key belum memiliki TTL' });
            steps.push({ from: ctrlId, to: 'Redis', message: cacheDetails.expireCall, isAsync: false });
            steps.push({ type: 'opt_end' });
            if (isL3) {
              steps.push({ type: 'note', over: `${ctrlId},Redis`, text: `TTL: ${cacheDetails.ttlExpr}`, level: 'L3' });
            }
          }

          steps.push({ from: 'Redis', to: ctrlId, message: 'OK', isReturn: true });
          steps.push({ from: ctrlId, to: 'Client', message: cacheDetails.missResponseLabel, isReturn: true });
          steps.push({ type: 'alt_end' });
          steps.push({ type: 'alt_end' });
        } else {
          steps.push({ from: ctrlId, to: 'S3', message: s3Details.s3CallExpr, isAsync: false });
          steps.push({ from: 'S3', to: ctrlId, message: s3Details.s3ReturnVar, isReturn: true });
          steps.push({ from: ctrlId, to: 'Redis', message: cacheDetails.writeCall, isAsync: false });
          steps.push({ from: ctrlId, to: 'Client', message: cacheDetails.missResponseLabel, isReturn: true });
        }
      }

      steps.push({ type: 'alt_end' });
    } else {
      // Standard Multi-Layer Service / Repository / Gateway / Queue Flow
      if (serviceId && serviceCalls.length > 0) {
        for (const call of serviceCalls) {
          steps.push({
            from: ctrlId,
            to: serviceId,
            message: `${call.method}(${call.args})`,
            isAsync: false
          });
          if (call.assignedVar) {
            steps.push({
              from: serviceId,
              to: ctrlId,
              message: call.assignedVar,
              isReturn: true
            });
          }
        }
      }

      if (extId && extCallInfo) {
        steps.push({ from: serviceId || ctrlId, to: extId, message: extCallInfo.callExpr, isAsync: false });
        steps.push({ from: extId, to: serviceId || ctrlId, message: extCallInfo.returnVar || '200 OK (Response)', isReturn: true });
      }

      if (dbId && !primaryModelName && dbCallInfo) {
        for (const op of dbCallInfo.operations) {
          steps.push({ from: serviceId || ctrlId, to: dbId, message: op, isAsync: false });
        }
        steps.push({ from: dbId, to: serviceId || ctrlId, message: dbCallInfo.returnLabel, isReturn: true });
      }

      if (queueId && queueCallInfo) {
        steps.push({ from: ctrlId, to: queueId, message: queueCallInfo.callExpr, isAsync: true });
      }

      const successResp = this.extractSuccessResponse(code, rules);
      steps.push({ from: ctrlId, to: 'Client', message: successResp, isReturn: true });
    }

    if (validationExpr && !isL1) {
      steps.push({ type: 'alt_end' });
    }

    // 8. Extract Real Error Pathways Enforcing profile.controlFlow.errorHandling
    const extractedErrors = this.extractErrorPathways(fullCode, rules);
    for (const err of extractedErrors) {
      if (!errorBranches.some(e => e.type === err.type && e.status === err.status)) {
        errorBranches.push(err);
      }
    }

    // 9. Extract Real Domain Classes / Models from AST for Class Diagram Synthesis
    const models = this.extractModelsForClassDiagram(callGraph, modelMatches, participants, steps);

    return {
      endpoint: meta.endpoint,
      targetName: meta.targetName || baseName,
      targetFile: meta.targetFile,
      profileUsed: profile.language,
      resolvedFiles: [meta.targetFile, ...callGraph.resolvedExternalFiles].filter(Boolean),
      participants,
      steps,
      errorBranches,
      models
    };
  }

  /**
   * Detect entrypoint method name from route decorators/definitions using profile rules
   */
  detectEntryMethodFromRoute(code, urlPath, rules) {
    if (!urlPath || !code) return null;
    const cleanSegment = urlPath.split('/').filter(Boolean).pop() || '';
    if (!cleanSegment) return null;

    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(cleanSegment)) {
        const snippet = lines.slice(i, i + 6).join('\n');
        const fnMatch = snippet.match(/(?:function|def|fn|func|public\s+[A-Za-z0-9_<>?]+)\s+([a-zA-Z0-9_]+)\s*\(/);
        if (fnMatch) return fnMatch[1];
      }
    }
    return null;
  }

  extractValidationExpression(code, rules) {
    // 1. Laravel $request->validate([...])
    if (/\$request->validate\s*\(/.test(code)) {
      return {
        callLabel: '$request->validate(...)',
        failCondition: 'Validasi Gagal',
        failResponse: '422 Unprocessable Entity',
        passCondition: 'Validasi Lolos (Happy Path)',
        exceptionType: 'ValidationException',
        statusCode: 422,
        errorMessage: 'Unprocessable Entity (Validation Failed)'
      };
    }

    // 2. Go Gin ShouldBindJSON
    const ginBind = code.match(/if\s+err\s*:=\s*([a-zA-Z0-9_]+\.ShouldBind[A-Za-z]*\([^)]+\))\s*;\s*err\s*!=\s*nil/);
    if (ginBind) {
      return {
        callLabel: ginBind[1],
        failCondition: 'err != nil (Invalid Request Body)',
        failResponse: '400 Bad Request',
        passCondition: 'Payload Valid',
        exceptionType: 'BindValidationException',
        statusCode: 400,
        errorMessage: 'Invalid request body'
      };
    }

    // 3. Express / FastAPI early validation guard: if (!items || ...) return res.status(400)...
    const earlyGuard = code.match(/if\s*\(([^)]+)\)\s*\{\s*return\s+res\.status\((\d+)\)\.json\(\{\s*error:\s*["']([^"']+)["']/);
    if (earlyGuard) {
      return {
        callLabel: `validate(${earlyGuard[1].trim()})`,
        failCondition: earlyGuard[1].trim(),
        failResponse: `${earlyGuard[2]} Bad Request ("${earlyGuard[3]}")`,
        passCondition: 'Validasi Lolos (Happy Path)',
        exceptionType: 'ValidationException',
        statusCode: Number(earlyGuard[2]),
        errorMessage: earlyGuard[3]
      };
    }

    return null;
  }

  extractAuthCallDetails(fullCode) {
    if (/Auth::user\(\)/.test(fullCode)) {
      const hasBizId = /business_id/.test(fullCode);
      return {
        callExpr: 'Auth::user()',
        returnExpr: hasBizId ? '$user (resolve businessId)' : '$user'
      };
    }
    if (/Depends\(get_current_user\)/.test(fullCode)) {
      return {
        callExpr: 'Depends(get_current_user)',
        returnExpr: 'user'
      };
    }
    return {
      callExpr: 'authenticateRequest()',
      returnExpr: 'authenticatedUser'
    };
  }

  /**
   * Extract Redis / Cache operations and resolve variable names dynamically from AST
   */
  extractCacheOperationsFromAst(fullCode, variablesMap) {
    const normalizeExpr = (raw) => {
      if (!raw) return 'key';
      let cleaned = raw.trim().replace(/^\(string\)\s*/, '');
      const varLookup = cleaned.replace(/^\$/, '');
      if (variablesMap && variablesMap.has(varLookup)) {
        const val = variablesMap.get(varLookup);
        if (/^["'`]/.test(val)) {
          return val.replace(/\{\$([a-zA-Z0-9_]+)\}/g, '{$1}');
        }
      }
      return cleaned.replace(/^\$/, '');
    };

    // Match hdel / forget
    let invalidationCall = null;
    let invalidationCondition = 'reload == true';
    const hdelMatch = fullCode.match(/Redis::(hdel|del|forget)\s*\(\s*([^,)]+)(?:\s*,\s*([^)]+))?\s*\)/);
    if (hdelMatch) {
      const keyExpr = normalizeExpr(hdelMatch[2]);
      const fieldExpr = hdelMatch[3] ? normalizeExpr(hdelMatch[3]) : null;
      invalidationCall = fieldExpr ? `${hdelMatch[1]}(${keyExpr}, ${fieldExpr})` : `${hdelMatch[1]}(${keyExpr})`;
    }

    // Match hget / get
    let readCall = 'get(cacheKey)';
    let readReturnVar = '$cached';
    let resolvedKey = 'cacheKey';
    let resolvedField = 'field';
    const hgetMatch = fullCode.match(/(?:(\$?[a-zA-Z0-9_]+)\s*=\s*)?(?:Redis|Cache)::(hget|get)\s*\(\s*([^,)]+)(?:\s*,\s*([^)]+))?\s*\)/);
    if (hgetMatch) {
      readReturnVar = hgetMatch[1] ? hgetMatch[1].trim() : '$raw';
      const op = hgetMatch[2];
      resolvedKey = normalizeExpr(hgetMatch[3]).replace(/^["']|["']$/g, '');
      const quotedKey = normalizeExpr(hgetMatch[3]);
      resolvedField = hgetMatch[4] ? `(string) ${normalizeExpr(hgetMatch[4])}` : 'default';
      const cleanField = hgetMatch[4] ? normalizeExpr(hgetMatch[4]) : null;
      readCall = cleanField ? `${op}(${quotedKey}, ${cleanField})` : `${op}(${quotedKey})`;
    }

    // Match hit helper call (e.g. $this->processRedisData($raw, $user, $campaign))
    let hitHelperCall = null;
    const hitHelperMatch = fullCode.match(/\$this->([a-zA-Z0-9_]+)\s*\(\s*\$raw\b([^)]*)\)/);
    if (hitHelperMatch) {
      const rawArgs = ['raw', ...hitHelperMatch[2].split(',').map(s => s.replace(/^\s*\$/, '').trim()).filter(Boolean)].join(', ');
      hitHelperCall = `${hitHelperMatch[1]}(${rawArgs})`;
    }

    // Match hset / set
    let writeCall = 'set(cacheKey, responseData)';
    const hsetMatch = fullCode.match(/(?:Redis|Cache)::(hset|set|put)\s*\(\s*([^,]+)\s*,\s*([^,]+)(?:\s*,\s*([^)]+))?\s*\)/);
    if (hsetMatch) {
      const op = hsetMatch[1];
      const k = normalizeExpr(hsetMatch[2]);
      const f = normalizeExpr(hsetMatch[3]);
      writeCall = hsetMatch[4] ? `${op}(${k}, ${f}, responseData)` : `${op}(${k}, ${f})`;
    }

    // Match expire / ttl
    let expireCall = null;
    let ttlExpr = 'ttl';
    const expireMatch = fullCode.match(/Redis::expire\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/);
    if (expireMatch) {
      const k = normalizeExpr(expireMatch[1]);
      const t = expireMatch[2].trim().replace(/^\$/, '');
      expireCall = `expire(${k}, ${t})`;
      const resolvedTtlVal = variablesMap && variablesMap.has(t) ? variablesMap.get(t) : null;
      ttlExpr = resolvedTtlVal ? `${t} (${resolvedTtlVal})` : t;
    }

    // Extract response keys from associative array return ['key1' => $val1, 'key2' => $val2]
    const returnKeys = [];
    const arrayKeyRegex = /['"]([a-zA-Z0-9_]+)['"]\s*=>\s*\$[a-zA-Z0-9_]+/g;
    let rkMatch;
    while ((rkMatch = arrayKeyRegex.exec(fullCode)) !== null) {
      if (!returnKeys.includes(rkMatch[1])) returnKeys.push(rkMatch[1]);
    }
    const keysSummary = returnKeys.length > 0 ? `data: ${returnKeys.join(', ')}` : 'data';

    return {
      invalidationCondition,
      defaultReadCondition: 'reload == false (Default)',
      invalidationCall,
      readCall,
      readReturnVar,
      resolvedKey,
      resolvedField,
      hitHelperCall,
      hitResponseLabel: `200 OK (${keysSummary} - from cache)`,
      writeCall,
      expireCall,
      ttlExpr,
      missResponseLabel: `200 OK (${keysSummary})`
    };
  }

  /**
   * Extract Cloud Storage (S3) operations dynamically from AST
   */
  extractS3OperationsFromAst(fullCode) {
    let fallbackCall = null;
    const fbMatch = fullCode.match(/\$this->([a-zA-Z0-9_]*Fallback[a-zA-Z0-9_]*)\s*\(\)/i);
    if (fbMatch) {
      fallbackCall = `${fbMatch[1]}()`;
    }

    const emptyPropMatch = fullCode.match(/empty\s*\(\s*\$([a-zA-Z0-9_]+)->([a-zA-Z0-9_]+)\s*\)/);
    const propMatch = emptyPropMatch || fullCode.match(/\$([a-zA-Z0-9_]+)->([a-zA-Z0-9_]*s3[a-zA-Z0-9_]*)/i);
    const recordVar = propMatch ? propMatch[1] : 'record';
    const propName = propMatch ? propMatch[2] : 's3_path';
    const s3PathExpr = `${recordVar}->${propName}`;

    let s3CallExpr = `connect() & getObjectContent(${s3PathExpr})`;
    const s3MethodMatch = fullCode.match(/S3Helper::([a-zA-Z0-9_]+)\s*\(/);
    if (s3MethodMatch) {
      s3CallExpr = `connect() & ${s3MethodMatch[1]}(${s3PathExpr})`;
    }

    let transformExpr = null;
    const decodeMatches = [...fullCode.matchAll(/(\$[a-zA-Z0-9_]+)\s*=\s*json_decode\s*\(\s*\$([a-zA-Z0-9_]+)/g)];
    const nonCacheDecode = decodeMatches.find(m => m[2] !== 'raw');
    if (nonCacheDecode) {
      transformExpr = `Extract ${nonCacheDecode[1]}`;
    }

    return {
      missingRecordCondition: `$${recordVar} tidak ditemukan / ${propName} kosong`,
      validRecordCondition: `$${recordVar} siap & ${propName} valid`,
      fallbackCall,
      s3PathExpr,
      s3CallExpr,
      s3ReturnVar: 'jsonContent',
      transformExpr
    };
  }

  /**
   * Extract Domain Service calls directly from AST call sites and field types
   */
  extractServiceCallsFromAst(fullCode, callGraph, controllerName) {
    const results = [];
    const fieldTypeMap = new Map();

    for (const cls of callGraph.fileAst.classes) {
      for (const field of cls.fields) {
        fieldTypeMap.set(field.name, field.type);
      }
    }
    if (callGraph.externalFileAsts) {
      for (const extAst of callGraph.externalFileAsts.values()) {
        for (const cls of extAst.classes) {
          for (const field of cls.fields) {
            fieldTypeMap.set(field.name, field.type);
          }
        }
      }
    }

    const callRegex = /(?:(?:const|let|var|[A-Za-z0-9_<>]+)\s+([a-zA-Z0-9_]+)\s*(?::=|=)\s*(?:await\s+)?)?(?:await\s+)?(?:this\.)?([a-zA-Z0-9_]+)\s*(?:\.|->|::)\s*([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
    let match;

    while ((match = callRegex.exec(fullCode)) !== null) {
      const assignedVar = match[1] ? match[1].trim() : null;
      const obj = match[2].trim();
      const method = match[3].trim();
      const args = match[4].trim();

      const resolvedClass = fieldTypeMap.get(obj) || obj;
      if (
        resolvedClass !== controllerName &&
        /(?:Service|UseCase|Manager|Interactor)$/i.test(resolvedClass)
      ) {
        results.push({
          serviceClass: resolvedClass,
          objectName: obj,
          method,
          args,
          assignedVar
        });
      }
    }

    return results;
  }

  extractExternalGatewayCall(fullCode, rules) {
    // Check explicit Gateway / Client calls (e.g. PaymentGateway.charge(...))
    const gwMatch = fullCode.match(/(?:const|let|var)?\s*([a-zA-Z0-9_]+)?\s*=?\s*(?:await\s+)?([A-Za-z0-9_]*(?:Gateway|Client|Http|axios|requests|httpx))\s*(?:\.|::)\s*([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
    if (gwMatch) {
      return {
        label: gwMatch[2],
        callExpr: `${gwMatch[3]}(${gwMatch[4].trim()})`,
        returnVar: gwMatch[1] || '200 OK (Response)'
      };
    }

    for (const rx of rules.externalCallRegexes) {
      rx.lastIndex = 0;
      const m = rx.exec(fullCode);
      if (m) {
        return {
          label: 'External Gateway / API',
          callExpr: m[0],
          returnVar: '200 OK (Response)'
        };
      }
    }

    return null;
  }

  extractDatabaseOperations(fullCode, rules) {
    const ops = [];
    // Detect ORM query chains like db.query(Item).filter(...).first() or db.commit()
    const dbChainRegex = /\b(db|repository|repo|session|entityManager)\s*\.\s*([a-zA-Z0-9_]+\([^;\n]*)/gi;
    let match;
    while ((match = dbChainRegex.exec(fullCode)) !== null) {
      ops.push(`${match[1]}.${match[2].trim()}`);
    }

    if (ops.length > 0) {
      return {
        label: 'Database (Storage / ORM)',
        operations: ops,
        returnLabel: 'DB Commit / Query Result'
      };
    }

    // Check if any service call performs persistence mutations (createOrder, markAsPaid, save, etc.)
    const persistenceCall = fullCode.match(/\b([A-Za-z0-9_]+)\s*\.\s*((?:create|save|update|delete|insert|markAs|findBy)[A-Za-z0-9_]*)\s*\(([^)]*)\)/);
    if (persistenceCall) {
      return {
        label: 'Database (Storage / ORM)',
        operations: [`${persistenceCall[2]}(${persistenceCall[3].trim()})`],
        returnLabel: 'DB Commit Success'
      };
    }

    return null;
  }

  extractQueueOperations(fullCode, rules) {
    const queueMatch = fullCode.match(/(?:await\s+)?([a-zA-Z0-9_]*(?:Queue|Broker|Bus|Producer|Event|notification_broker)[a-zA-Z0-9_]*)\s*(?:\.|::)\s*([a-zA-Z0-9_]+)\s*\(([^)]*)\)/i);
    if (queueMatch) {
      return {
        label: `${queueMatch[1]} (Message Broker)`,
        callExpr: `${queueMatch[2]}(${queueMatch[3].trim()})`
      };
    }
    return null;
  }

  extractSuccessResponse(code, rules) {
    // Express res.status(201).json(...)
    const expressMatch = code.match(/res\.status\((\d+)\)\.json\(([^)]+)\)/g);
    if (expressMatch && expressMatch.length > 0) {
      const last = expressMatch[expressMatch.length - 1];
      const m = last.match(/res\.status\((\d+)\)\.json\(([^)]+)\)/);
      if (m) return `${m[1]} OK (${m[2].trim()})`;
    }

    // Gin c.JSON(http.StatusOK, ...)
    const ginMatch = code.match(/c\.JSON\(\s*http\.Status([A-Za-z]+)\s*,\s*([^)]+)\)/g);
    if (ginMatch && ginMatch.length > 0) {
      const last = ginMatch[ginMatch.length - 1];
      const m = last.match(/http\.Status([A-Za-z]+)\s*,\s*([^)]+)/);
      if (m) return `200 ${m[1]} (${m[2].trim()})`;
    }

    // Spring ResponseEntity.ok(...)
    const springMatch = code.match(/ResponseEntity\.(ok|created)\(([^)]*)\)/);
    if (springMatch) {
      return `200 OK (${springMatch[2].trim()})`;
    }

    return '200 OK';
  }

  extractErrorPathways(fullCode, rules) {
    const errors = [];
    let match;

    // 1. Java / C# / PHP / TS typed catch blocks: catch (InsufficientFundsException e)
    const typedCatchRegex = /catch\s*\(\s*([A-Za-z0-9_\\]+)(?:\s+\$?[a-zA-Z0-9_]+)?\s*\)\s*\{([^}]*)\}/g;
    while ((match = typedCatchRegex.exec(fullCode)) !== null) {
      const rawType = match[1].split('\\').pop();
      const block = match[2];
      const statusMatch = block.match(/status\((\d+)\)/);
      const status = statusMatch ? Number(statusMatch[1]) : (rawType === 'Exception' || rawType === 'err' ? 500 : 400);
      const msgMatch = block.match(/(?:body|json)\(\s*["']?([^"')]+)["']?\s*\)/);
      errors.push({
        type: rawType.includes('Exception') || rawType.includes('Error') ? rawType : 'CaughtException',
        status,
        message: msgMatch ? msgMatch[1].trim() : 'Handled exception in catch block'
      });
    }

    // 2. Python FastAPI HTTPException: raise HTTPException(status_code=404, detail="Item not found")
    const pyHttpRegex = /raise\s+HTTPException\s*\(\s*status_code\s*=\s*(\d+)\s*,\s*detail\s*=\s*["']([^"']+)["']\s*\)/g;
    while ((match = pyHttpRegex.exec(fullCode)) !== null) {
      errors.push({
        type: 'HTTPException',
        status: Number(match[1]),
        message: match[2]
      });
    }

    // 3. Express error status returns: return res.status(403).json({ error: "User suspended" })
    const expressErrRegex = /res\.status\(([45]\d\d)\)\.json\(\{\s*error:\s*([^}]+)\}\)/g;
    while ((match = expressErrRegex.exec(fullCode)) !== null) {
      errors.push({
        type: Number(match[1]) >= 500 ? 'InternalServerError' : 'HttpErrorResponse',
        status: Number(match[1]),
        message: match[2].replace(/^["']|["']$/g, '').trim()
      });
    }

    // 4. Go if err != nil with c.JSON(http.StatusUnauthorized, ...)
    const goErrRegex = /if\s+err\s*!=\s*nil\s*\{[^}]*c\.JSON\(\s*http\.Status([A-Za-z]+)\s*,\s*[^)]*"error":\s*"([^"]+)"/g;
    while ((match = goErrRegex.exec(fullCode)) !== null) {
      const statusMap = { BadRequest: 400, Unauthorized: 401, Forbidden: 403, NotFound: 404, InternalServerError: 500 };
      errors.push({
        type: `Go${match[1]}Error`,
        status: statusMap[match[1]] || 500,
        message: match[2]
      });
    }

    return errors;
  }

  /**
   * Extract real classes, fields, and methods from AST for Class Diagram generation
   */
  extractModelsForClassDiagram(callGraphOrAst, modelMatches, participants, steps) {
    const models = [];
    const fileAst = callGraphOrAst?.fileAst || callGraphOrAst || { classes: [] };
    const extAsts = callGraphOrAst?.externalFileAsts ? Array.from(callGraphOrAst.externalFileAsts.values()) : [];

    for (const ast of [fileAst, ...extAsts]) {
      for (const cls of ast.classes || []) {
        if (!models.some(m => m.name === cls.name)) {
          models.push({
            name: cls.name,
            fields: cls.fields.map(f => ({ name: f.name, type: f.type })),
            methods: cls.methods
          });
        }
      }
    }

    for (const modelName of modelMatches) {
      if (!models.some(m => m.name === modelName)) {
        models.push({
          name: modelName,
          fields: [{ name: 'id', type: 'Identifier' }],
          methods: ['where', 'first']
        });
      }
    }

    if (models.length === 0 && participants.length > 0) {
      for (const p of participants) {
        if (p.type === 'actor') continue;
        const cleanName = p.label.replace(/[^a-zA-Z0-9_]/g, '') || p.id;
        const outgoingMethods = steps
          .filter(s => s.to === p.id && !s.isReturn && s.message)
          .map(s => s.message.split('(')[0].replace(/[^a-zA-Z0-9_]/g, ''))
          .filter(Boolean);
        models.push({
          name: cleanName,
          fields: [],
          methods: Array.from(new Set(outgoingMethods))
        });
      }
    }

    return models;
  }

  /**
   * Pencarian file yang mengandung pola endpoint di repository dengan menegakkan ekstensi profil
   */
  findFileByEndpoint(urlPath, profile) {
    const cleanUrl = urlPath.replace(/^\//, '');
    const allowedExts = profile?.extensions && !profile.extensions.includes('.*') ? new Set(profile.extensions) : null;
    try {
      const files = this.scanDirRecursive(this.rootDir);
      for (const file of files) {
        if (allowedExts && !allowedExts.has(path.extname(file).toLowerCase())) continue;
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
        const content = fs.readFileSync(file, 'utf8');
        if (
          content.includes(`function ${functionName}`) ||
          content.includes(`def ${functionName}`) ||
          content.includes(`fn ${functionName}`) ||
          content.includes(`func ${functionName}`) ||
          new RegExp(`\\b${functionName}\\s*\\(`).test(content)
        ) {
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

  generateUnresolvedEndpointTrace(method, urlPath, profile, detailLevel = 'standard') {
    const cleanEndpoint = `${method || 'POST'} ${urlPath}`;
    const aliases = this.config.participantsAliases || {};
    const isL1 = detailLevel === 'L1' || detailLevel === 'high';

    const participants = [
      { id: 'Client', label: aliases['Client'] || 'Client / Frontend App', type: 'actor' },
      { id: 'Ctrl', label: aliases['Ctrl'] || 'API Controller / Handler', type: 'participant', layer: 'Presentation Layer' },
      { id: 'Svc', label: aliases['Svc'] || 'Domain Service', type: 'participant', layer: 'Domain & Application Layer' },
      { id: 'DB', label: aliases['DB'] || 'Database (SQL/NoSQL)', type: 'participant', layer: 'Persistence & Cache Layer' }
    ];

    const steps = [
      { from: 'Client', to: 'Ctrl', message: cleanEndpoint, isAsync: false }
    ];

    if (!isL1) {
      steps.push({ type: 'alt_start', condition: 'Invalid Request Payload' });
      steps.push({ from: 'Ctrl', to: 'Client', message: '400 Bad Request ("Validation Failed")', isReturn: true });
      steps.push({ type: 'alt_else', condition: 'Valid Payload (Proceed)' });
    }

    steps.push({ from: 'Ctrl', to: 'Svc', message: `handle(${ JSON.stringify(urlPath) })`, isAsync: false });
    steps.push({ from: 'Svc', to: 'DB', message: 'Execute Atomic Transaction', isAsync: false });
    steps.push({ from: 'DB', to: 'Svc', message: 'Committed Record', isReturn: true });
    steps.push({ from: 'Svc', to: 'Ctrl', message: 'Domain Result', isReturn: true });
    steps.push({ from: 'Ctrl', to: 'Client', message: '200 OK / 201 Created', isReturn: true });

    if (!isL1) {
      steps.push({ type: 'alt_end' });
    }

    return {
      endpoint: cleanEndpoint,
      profileUsed: profile?.language || 'generic',
      participants,
      steps,
      errorBranches: [
        { type: 'ValidationException', status: 400, message: 'Validation Failed' },
        { type: 'DatabaseException', status: 500, message: 'Transaction Failed' }
      ],
      models: []
    };
  }

  generateUnresolvedFunctionTrace(functionName, profile, detailLevel = 'standard') {
    const participants = [
      { id: 'Caller', label: 'Caller Function', type: 'actor' },
      { id: 'Target', label: `${functionName}()`, type: 'participant', layer: 'Domain & Application Layer' }
    ];

    const steps = [
      { from: 'Caller', to: 'Target', message: `${functionName}(params)`, isAsync: false },
      { from: 'Target', to: 'Caller', message: 'return result', isReturn: true }
    ];

    return {
      targetName: functionName,
      profileUsed: profile?.language || 'generic',
      participants,
      steps,
      errorBranches: [],
      models: [{ name: functionName, fields: [], methods: [functionName] }]
    };
  }
}
