import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ProfileLoader
 * Memuat profil modular bahasa secara on-demand berbasis bahasa yang terdeteksi
 * atau ekstensi file yang sedang dianalisis, serta mengompilasi aturan profil
 * untuk ditegakkan secara dinamis oleh TracerEngine.
 */
export class ProfileLoader {
  constructor(profilesDir = null) {
    this.profilesDir = profilesDir || path.resolve(__dirname, '..', 'profiles');
    this.cache = new Map();
  }

  /**
   * Mengambil profil berdasarkan nama bahasa
   */
  getProfile(language = 'generic') {
    if (this.cache.has(language)) {
      return this.cache.get(language);
    }

    const profilePath = path.join(this.profilesDir, `${language}.profile.json`);
    let profileData = null;

    if (fs.existsSync(profilePath)) {
      try {
        profileData = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      } catch (err) {
        console.error(`[uml-architect] Gagal memuat profil ${language}:`, err.message);
      }
    }

    // Fallback ke generic jika tidak ditemukan
    if (!profileData && language !== 'generic') {
      return this.getProfile('generic');
    }

    if (!profileData) {
      profileData = {
        language: 'generic',
        displayName: 'Generic',
        manifestTriggers: [],
        extensions: ['.*'],
        frameworks: {},
        controlFlow: { errorHandling: [], asyncWorkflow: [] },
        database: { ormTriggers: [], queryMethods: [] },
        externalCalls: [],
        infrastructureRecognition: {}
      };
    }

    this.cache.set(language, profileData);
    return profileData;
  }

  /**
   * Memuat seluruh 9 profil bahasa yang tersedia di direktori profiles/
   */
  loadAllProfiles() {
    const map = new Map();
    try {
      const files = fs.readdirSync(this.profilesDir).filter(f => f.endsWith('.profile.json'));
      for (const file of files) {
        const langId = file.replace('.profile.json', '');
        map.set(langId, this.getProfile(langId));
      }
    } catch {}
    return map;
  }

  /**
   * Menggabungkan beberapa profil untuk monorepo / polyglot repository
   */
  getMergedProfiles(languages = []) {
    const allProfiles = this.loadAllProfiles();
    const targetLangs = languages.length > 0 ? languages : Array.from(allProfiles.keys());

    if (targetLangs.length === 1) {
      return this.getProfile(targetLangs[0]);
    }

    const merged = {
      language: languages.length > 1 ? 'polyglot' : 'generic',
      displayName: languages.length > 1 ? `Polyglot (${languages.join(', ')})` : 'Generic Polyglot',
      manifestTriggers: [],
      extensions: [],
      frameworks: {},
      controlFlow: {
        errorHandling: [],
        asyncWorkflow: []
      },
      database: {
        ormTriggers: [],
        queryMethods: []
      },
      externalCalls: [],
      infrastructureRecognition: {}
    };

    for (const lang of targetLangs) {
      const p = this.getProfile(lang);
      if (p.manifestTriggers) merged.manifestTriggers.push(...p.manifestTriggers);
      if (p.extensions) merged.extensions.push(...p.extensions);
      if (p.frameworks) Object.assign(merged.frameworks, p.frameworks);
      if (p.controlFlow?.errorHandling) merged.controlFlow.errorHandling.push(...p.controlFlow.errorHandling);
      if (p.controlFlow?.asyncWorkflow) merged.controlFlow.asyncWorkflow.push(...p.controlFlow.asyncWorkflow);
      if (p.database?.ormTriggers) merged.database.ormTriggers.push(...p.database.ormTriggers);
      if (p.database?.queryMethods) merged.database.queryMethods.push(...p.database.queryMethods);
      if (p.externalCalls) merged.externalCalls.push(...p.externalCalls);
      if (p.infrastructureRecognition) {
        for (const [infraKey, infraVal] of Object.entries(p.infrastructureRecognition)) {
          if (!merged.infrastructureRecognition[infraKey]) {
            merged.infrastructureRecognition[infraKey] = {
              patterns: [...(infraVal.patterns || [])],
              participant: { ...infraVal.participant }
            };
          } else if (infraVal.patterns) {
            merged.infrastructureRecognition[infraKey].patterns.push(...infraVal.patterns);
          }
        }
      }
    }

    // Deduplicate arrays
    merged.extensions = Array.from(new Set(merged.extensions));
    merged.database.ormTriggers = Array.from(new Set(merged.database.ormTriggers));
    merged.database.queryMethods = Array.from(new Set(merged.database.queryMethods));
    merged.externalCalls = Array.from(new Set(merged.externalCalls));

    return merged;
  }

  /**
   * Mengompilasi aturan regex dari profil aktif (dan fallback seluruh 9 profil bila dibutuhkan)
   * agar TracerEngine dapat menegakkan aturan secara deterministik.
   */
  compileProfileRules(profile = null) {
    const active = profile || this.getMergedProfiles();
    const allMerged = this.getMergedProfiles();

    const safeRegexList = (patterns = [], flags = 'g') => {
      const list = [];
      for (const pat of patterns) {
        try {
          list.push(new RegExp(pat, flags));
        } catch {}
      }
      return list;
    };

    const routeRegexes = [];
    const middlewareRegexes = [];
    const responseRegexes = [];
    const handlerRegexes = [];

    const frameworks = { ...allMerged.frameworks, ...(active.frameworks || {}) };
    for (const fw of Object.values(frameworks)) {
      if (fw.routePatterns) routeRegexes.push(...safeRegexList(fw.routePatterns, 'gi'));
      if (fw.middlewarePatterns) middlewareRegexes.push(...safeRegexList(fw.middlewarePatterns, 'g'));
      if (fw.responsePatterns) responseRegexes.push(...safeRegexList(fw.responsePatterns, 'g'));
      if (fw.handlerSignature) handlerRegexes.push(...safeRegexList([fw.handlerSignature], 'g'));
    }

    const queryMethods = Array.from(
      new Set([...(active.database?.queryMethods || []), ...(allMerged.database?.queryMethods || [])])
    );
    const ormTriggers = Array.from(
      new Set([...(active.database?.ormTriggers || []), ...(allMerged.database?.ormTriggers || [])])
    );

    const errorRegexes = safeRegexList([
      ...(active.controlFlow?.errorHandling || []),
      ...(allMerged.controlFlow?.errorHandling || [])
    ], 'g');

    const asyncRegexes = safeRegexList([
      ...(active.controlFlow?.asyncWorkflow || []),
      ...(allMerged.controlFlow?.asyncWorkflow || [])
    ], 'g');

    const externalCallRegexes = safeRegexList([
      ...(active.externalCalls || []),
      ...(allMerged.externalCalls || [])
    ], 'g');

    const infrastructure = {
      ...(allMerged.infrastructureRecognition || {}),
      ...(active.infrastructureRecognition || {})
    };

    return {
      language: active.language || 'generic',
      routeRegexes,
      middlewareRegexes,
      responseRegexes,
      handlerRegexes,
      queryMethods,
      ormTriggers,
      errorRegexes,
      asyncRegexes,
      externalCallRegexes,
      infrastructure
    };
  }

  /**
   * Mendapatkan daftar seluruh profil yang didukung
   */
  listSupportedProfiles() {
    try {
      const files = fs.readdirSync(this.profilesDir);
      return files
        .filter(f => f.endsWith('.profile.json'))
        .map(f => {
          const content = JSON.parse(fs.readFileSync(path.join(this.profilesDir, f), 'utf8'));
          return {
            id: content.language,
            displayName: content.displayName,
            extensions: content.extensions
          };
        });
    } catch {
      return [];
    }
  }
}
