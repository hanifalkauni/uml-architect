import fs from 'node:fs';
import path from 'node:path';

/**
 * ManifestSniffer
 * Memindai file manifest dan struktur direktori untuk mendeteksi bahasa pemrograman
 * dan framework yang aktif dalam repositori secara dinamis.
 */
export class ManifestSniffer {
  constructor(rootDir = process.cwd()) {
    this.rootDir = path.resolve(rootDir);
  }

  /**
   * Sniff seluruh repositori untuk mendeteksi bahasa & framework
   */
  sniff() {
    const detected = {
      languages: new Set(),
      frameworks: new Set(),
      manifests: [],
      primaryLanguage: 'generic'
    };

    const checks = [
      {
        manifest: 'package.json',
        language: 'typescript',
        checkFramework: (content) => {
          const pkg = JSON.parse(content);
          const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (allDeps['@nestjs/core']) detected.frameworks.add('nestjs');
          if (allDeps['express']) detected.frameworks.add('express');
          if (allDeps['fastify']) detected.frameworks.add('fastify');
          if (allDeps['next']) detected.frameworks.add('nextjs');
          if (allDeps['koa']) detected.frameworks.add('koa');
          if (allDeps['@prisma/client'] || allDeps['prisma']) detected.frameworks.add('prisma');
          if (allDeps['typeorm']) detected.frameworks.add('typeorm');
        }
      },
      {
        manifest: 'go.mod',
        language: 'go',
        checkFramework: (content) => {
          if (content.includes('github.com/gin-gonic/gin')) detected.frameworks.add('gin');
          if (content.includes('github.com/gofiber/fiber')) detected.frameworks.add('fiber');
          if (content.includes('github.com/labstack/echo')) detected.frameworks.add('echo');
          if (content.includes('github.com/go-chi/chi')) detected.frameworks.add('chi');
          if (content.includes('gorm.io/gorm')) detected.frameworks.add('gorm');
        }
      },
      {
        manifest: 'pyproject.toml',
        language: 'python',
        checkFramework: (content) => {
          if (content.includes('fastapi')) detected.frameworks.add('fastapi');
          if (content.includes('django')) detected.frameworks.add('django');
          if (content.includes('flask')) detected.frameworks.add('flask');
          if (content.includes('sqlalchemy')) detected.frameworks.add('sqlalchemy');
        }
      },
      {
        manifest: 'requirements.txt',
        language: 'python',
        checkFramework: (content) => {
          if (/fastapi/i.test(content)) detected.frameworks.add('fastapi');
          if (/django/i.test(content)) detected.frameworks.add('django');
          if (/flask/i.test(content)) detected.frameworks.add('flask');
          if (/sqlalchemy/i.test(content)) detected.frameworks.add('sqlalchemy');
        }
      },
      {
        manifest: 'pom.xml',
        language: 'jvm',
        checkFramework: (content) => {
          if (content.includes('spring-boot')) detected.frameworks.add('spring');
          if (content.includes('micronaut')) detected.frameworks.add('micronaut');
          if (content.includes('hibernate')) detected.frameworks.add('hibernate');
        }
      },
      {
        manifest: 'build.gradle',
        language: 'jvm',
        checkFramework: (content) => {
          if (content.includes('org.springframework.boot')) detected.frameworks.add('spring');
        }
      },
      {
        manifest: 'Cargo.toml',
        language: 'rust',
        checkFramework: (content) => {
          if (content.includes('axum')) detected.frameworks.add('axum');
          if (content.includes('actix-web')) detected.frameworks.add('actix');
          if (content.includes('tokio')) detected.frameworks.add('tokio');
          if (content.includes('diesel')) detected.frameworks.add('diesel');
        }
      },
      {
        manifest: 'composer.json',
        language: 'php',
        checkFramework: (content) => {
          if (content.includes('laravel/framework')) detected.frameworks.add('laravel');
          if (content.includes('symfony/framework-bundle')) detected.frameworks.add('symfony');
        }
      },
      {
        manifest: 'Gemfile',
        language: 'ruby',
        checkFramework: (content) => {
          if (content.includes('rails')) detected.frameworks.add('rails');
          if (content.includes('sinatra')) detected.frameworks.add('sinatra');
        }
      }
    ];

    for (const check of checks) {
      const fullPath = path.join(this.rootDir, check.manifest);
      if (fs.existsSync(fullPath)) {
        detected.manifests.push(check.manifest);
        detected.languages.add(check.language);
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (check.checkFramework) check.checkFramework(content);
        } catch {}
      }
    }

    // Check for C# *.csproj or *.sln files
    try {
      const files = fs.readdirSync(this.rootDir);
      for (const f of files) {
        if (f.endsWith('.csproj') || f.endsWith('.sln')) {
          detected.manifests.push(f);
          detected.languages.add('csharp');
          detected.frameworks.add('aspnet');
        }
      }
    } catch {}

    const langsArray = Array.from(detected.languages);
    detected.primaryLanguage = langsArray.length > 0 ? langsArray[0] : 'generic';
    detected.languages = langsArray;
    detected.frameworks = Array.from(detected.frameworks);

    return detected;
  }

  /**
   * Deteksi bahasa dari path file spesifik
   */
  detectLanguageFromPath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const extMap = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'typescript',
      '.jsx': 'typescript',
      '.mjs': 'typescript',
      '.cjs': 'typescript',
      '.py': 'python',
      '.go': 'go',
      '.java': 'jvm',
      '.kt': 'jvm',
      '.cs': 'csharp',
      '.rs': 'rust',
      '.php': 'php',
      '.rb': 'ruby',
      '.swift': 'generic',
      '.dart': 'generic',
      '.ex': 'generic',
      '.exs': 'generic',
      '.zig': 'generic',
      '.scala': 'jvm'
    };
    return extMap[ext] || 'generic';
  }
}
