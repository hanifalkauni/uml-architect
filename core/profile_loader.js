import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ProfileLoader
 * Memuat profil modular bahasa secara on-demand berbasis bahasa yang terdeteksi
 * atau ekstensi file yang sedang dianalisis.
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
      // Fallback minimal jika file generic pun tidak ada
      profileData = {
        language: 'generic',
        displayName: 'Generic',
        manifestTriggers: [],
        extensions: ['.*'],
        frameworks: {},
        controlFlow: { errorHandling: [], asyncWorkflow: [] },
        database: { ormTriggers: [], queryMethods: [] }
      };
    }

    this.cache.set(language, profileData);
    return profileData;
  }

  /**
   * Menggabungkan beberapa profil untuk monorepo / polyglot repository
   */
  getMergedProfiles(languages = []) {
    if (languages.length === 0) {
      return this.getProfile('generic');
    }
    if (languages.length === 1) {
      return this.getProfile(languages[0]);
    }

    const merged = {
      language: 'polyglot',
      displayName: `Polyglot (${languages.join(', ')})`,
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
      externalCalls: []
    };

    for (const lang of languages) {
      const p = this.getProfile(lang);
      if (p.extensions) merged.extensions.push(...p.extensions);
      if (p.frameworks) Object.assign(merged.frameworks, p.frameworks);
      if (p.controlFlow?.errorHandling) merged.controlFlow.errorHandling.push(...p.controlFlow.errorHandling);
      if (p.controlFlow?.asyncWorkflow) merged.controlFlow.asyncWorkflow.push(...p.controlFlow.asyncWorkflow);
      if (p.database?.ormTriggers) merged.database.ormTriggers.push(...p.database.ormTriggers);
      if (p.database?.queryMethods) merged.database.queryMethods.push(...p.database.queryMethods);
      if (p.externalCalls) merged.externalCalls.push(...p.externalCalls);
    }

    return merged;
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
