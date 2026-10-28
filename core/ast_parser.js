import fs from 'node:fs';
import path from 'node:path';

/**
 * PolyglotAstParser
 * Token-aware, zero-compilation multi-file AST & Call-Graph analyzer.
 * Supports brace-scoped (TS/JS, PHP, Go, Java/Kotlin, Rust, C#),
 * indentation-scoped (Python), and keyword-scoped (Ruby) languages.
 */
export class PolyglotAstParser {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.cwd());
    this.astCache = new Map();
  }

  /**
   * Lexical tokenizer that separates strings, comments, identifiers, numbers, and punctuation
   * so braces/brackets/quotes inside comments or strings never corrupt block extraction.
   */
  tokenize(code, language = 'generic') {
    const tokens = [];
    let i = 0;
    const len = code.length;
    let line = 1;

    while (i < len) {
      const ch = code[i];
      const next = i + 1 < len ? code[i + 1] : '';

      if (ch === '\n') {
        tokens.push({ type: 'newline', value: '\n', index: i, line });
        line++;
        i++;
        continue;
      }
      if (ch === '\r') {
        i++;
        continue;
      }

      if (ch === ' ' || ch === '\t') {
        let start = i;
        while (i < len && (code[i] === ' ' || code[i] === '\t')) i++;
        if (tokens.length === 0 || tokens[tokens.length - 1].type === 'newline') {
          tokens.push({ type: 'indent', value: code.slice(start, i), index: start, line });
        }
        continue;
      }

      // Single-line comment: //
      if (ch === '/' && next === '/') {
        let start = i;
        while (i < len && code[i] !== '\n') i++;
        tokens.push({ type: 'comment', value: code.slice(start, i), index: start, line });
        continue;
      }

      // Multi-line comment: /* ... */
      if (ch === '/' && next === '*') {
        let start = i;
        i += 2;
        while (i < len && !(code[i] === '*' && code[i + 1] === '/')) {
          if (code[i] === '\n') line++;
          i++;
        }
        i += 2;
        tokens.push({ type: 'comment', value: code.slice(start, i), index: start, line });
        continue;
      }

      // Hash comment (#) in Python, Ruby, PHP (but NOT #[ attribute in Rust/PHP8)
      if (ch === '#' && next !== '[') {
        let start = i;
        while (i < len && code[i] !== '\n') i++;
        tokens.push({ type: 'comment', value: code.slice(start, i), index: start, line });
        continue;
      }

      // Triple-quoted strings in Python (""" or ''')
      if (
        (ch === '"' && next === '"' && code[i + 2] === '"') ||
        (ch === "'" && next === "'" && code[i + 2] === "'")
      ) {
        const quote = code.slice(i, i + 3);
        let start = i;
        i += 3;
        while (i < len && code.slice(i, i + 3) !== quote) {
          if (code[i] === '\n') line++;
          i++;
        }
        i += 3;
        tokens.push({ type: 'string', value: code.slice(start, i), index: start, line });
        continue;
      }

      // Standard strings: "...", '...', `...`
      if (ch === '"' || ch === "'" || ch === '`') {
        const quote = ch;
        let start = i;
        i++;
        while (i < len) {
          if (code[i] === '\\') {
            i += 2;
            continue;
          }
          if (code[i] === '\n') line++;
          if (code[i] === quote) {
            i++;
            break;
          }
          i++;
        }
        tokens.push({ type: 'string', value: code.slice(start, i), index: start, line });
        continue;
      }

      // Decorators / Attributes: @Decorator or #[Attribute]
      if (ch === '@' || (ch === '#' && next === '[')) {
        let start = i;
        if (ch === '#') {
          let depth = 0;
          while (i < len) {
            if (code[i] === '[') depth++;
            else if (code[i] === ']') {
              depth--;
              if (depth === 0) {
                i++;
                break;
              }
            }
            i++;
          }
        } else {
          i++;
          while (i < len && /[a-zA-Z0-9_.]/.test(code[i])) i++;
        }
        tokens.push({ type: 'decorator', value: code.slice(start, i), index: start, line });
        continue;
      }

      // Identifiers & Keywords (including PHP $var)
      if (/[a-zA-Z_$]/.test(ch)) {
        let start = i;
        i++;
        while (i < len && /[a-zA-Z0-9_$]/.test(code[i])) i++;
        tokens.push({ type: 'identifier', value: code.slice(start, i), index: start, line });
        continue;
      }

      // Numbers
      if (/[0-9]/.test(ch)) {
        let start = i;
        while (i < len && /[0-9._xXa-fA-F]/.test(code[i])) i++;
        tokens.push({ type: 'number', value: code.slice(start, i), index: start, line });
        continue;
      }

      // Multi-char operators: ->, =>, ::, !=, ==, <=, >=, <-
      const twoChar = code.slice(i, i + 2);
      if (['->', '=>', '::', '!=', '==', '<=', '>=', '<-', '&&', '||', '?.'].includes(twoChar)) {
        tokens.push({ type: 'operator', value: twoChar, index: i, line });
        i += 2;
        continue;
      }

      tokens.push({ type: 'punct', value: ch, index: i, line });
      i++;
    }

    return tokens;
  }

  /**
   * Token-aware scope extractor.
   * Handles brace scopes ({...}), Python indentation scopes, and Ruby def...end scopes.
   */
  extractScopeNode(code, startIndex, language = 'generic') {
    if (!code || startIndex < 0 || startIndex >= code.length) return null;

    if (language === 'python') {
      return this.extractPythonIndentedScope(code, startIndex);
    }

    if (language === 'ruby') {
      return this.extractRubyKeywordScope(code, startIndex);
    }

    const slice = code.slice(startIndex);
    const tokens = this.tokenize(slice, language);
    let depth = 0;
    let openToken = null;

    for (const tok of tokens) {
      if (tok.type === 'punct' && tok.value === '{') {
        if (depth === 0) openToken = tok;
        depth++;
      } else if (tok.type === 'punct' && tok.value === '}') {
        depth--;
        if (depth === 0 && openToken) {
          return {
            body: slice.slice(openToken.index, tok.index + 1),
            innerBody: slice.slice(openToken.index + 1, tok.index),
            startOffset: startIndex + openToken.index,
            endOffset: startIndex + tok.index + 1
          };
        }
      }
    }

    return openToken
      ? {
          body: slice.slice(openToken.index),
          innerBody: slice.slice(openToken.index + 1),
          startOffset: startIndex + openToken.index,
          endOffset: code.length
        }
      : null;
  }

  extractPythonIndentedScope(code, defStartIndex) {
    const lineStart = code.lastIndexOf('\n', defStartIndex) + 1;
    const indentMatch = code.slice(lineStart, defStartIndex).match(/^([ \t]*)/);
    const baseIndent = indentMatch ? indentMatch[1].length : 0;

    const tokens = this.tokenize(code.slice(defStartIndex), 'python');
    let parenDepth = 0;
    let colonOffset = -1;
    for (const tok of tokens) {
      if (tok.type === 'punct' && (tok.value === '(' || tok.value === '[')) parenDepth++;
      else if (tok.type === 'punct' && (tok.value === ')' || tok.value === ']')) parenDepth = Math.max(0, parenDepth - 1);
      else if (tok.type === 'punct' && tok.value === ':' && parenDepth === 0) {
        colonOffset = defStartIndex + tok.index + 1;
        break;
      }
    }
    if (colonOffset === -1) return null;

    const restLines = code.slice(colonOffset).split('\n');
    const collected = [restLines[0]];
    for (let i = 1; i < restLines.length; i++) {
      const line = restLines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        collected.push(line);
        continue;
      }
      const lineIndent = line.match(/^([ \t]*)/)[1].length;
      if (lineIndent <= baseIndent) break;
      collected.push(line);
    }

    const body = collected.join('\n');
    return {
      body,
      innerBody: body,
      startOffset: colonOffset,
      endOffset: colonOffset + body.length
    };
  }

  extractRubyKeywordScope(code, defStartIndex) {
    const slice = code.slice(defStartIndex);
    const tokens = this.tokenize(slice, 'ruby');
    let depth = 0;
    const openers = new Set(['def', 'class', 'module', 'do', 'if', 'unless', 'case', 'begin', 'while', 'until', 'for']);

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.type === 'identifier') {
        if (openers.has(tok.value)) {
          const prev = i > 0 ? tokens[i - 1] : null;
          if ((tok.value === 'if' || tok.value === 'unless') && prev && prev.type !== 'newline' && prev.type !== 'indent') {
            continue;
          }
          depth++;
        } else if (tok.value === 'end') {
          depth--;
          if (depth === 0) {
            return {
              body: slice.slice(0, tok.index + 3),
              innerBody: slice.slice(0, tok.index),
              startOffset: defStartIndex,
              endOffset: defStartIndex + tok.index + 3
            };
          }
        }
      }
    }
    return { body: slice, innerBody: slice, startOffset: defStartIndex, endOffset: code.length };
  }

  /**
   * Parse full file into an AST with imports, classes, functions/methods, and variable bindings.
   */
  parseFile(filePath, code = null, language = 'generic') {
    const resolvedPath = filePath ? path.resolve(filePath) : null;
    if (resolvedPath && this.astCache.has(resolvedPath) && !code) {
      return this.astCache.get(resolvedPath);
    }

    const source = code !== null ? code : (resolvedPath && fs.existsSync(resolvedPath) ? fs.readFileSync(resolvedPath, 'utf8') : '');
    const tokens = this.tokenize(source, language);

    const ast = {
      filePath: resolvedPath,
      language,
      source,
      tokens,
      imports: this.extractImports(source, language),
      classes: this.extractClasses(source, language),
      functions: this.extractFunctions(source, language),
      variables: this.extractVariables(source, language)
    };

    if (resolvedPath && code === null) {
      this.astCache.set(resolvedPath, ast);
    }
    return ast;
  }

  /**
   * Extract import statements across TS/JS, PHP, Python, Go, Java, Rust, C#, Ruby
   */
  extractImports(code, language) {
    const imports = [];
    let match;

    // 1. ES Module: import { A, B } from './path' or import X from './path'
    const esRegex = /import\s+(?:type\s+)?(?:(\*\s+as\s+\w+|\{[^}]+\}|\w+)\s+from\s+)?["']([^"']+)["']/g;
    while ((match = esRegex.exec(code)) !== null) {
      const rawSpec = (match[1] || '').trim();
      const modulePath = match[2].trim();
      const symbols = rawSpec.startsWith('{')
        ? rawSpec.slice(1, -1).split(',').map(s => s.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean)
        : (rawSpec ? [rawSpec.replace(/^\*\s+as\s+/, '').trim()] : []);
      imports.push({ symbols, modulePath, type: 'esm' });
    }

    // 2. CommonJS: const X = require('./path')
    const cjsRegex = /(?:const|let|var)\s+(\{[^}]+\}|\w+)\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/g;
    while ((match = cjsRegex.exec(code)) !== null) {
      const rawSpec = match[1].trim();
      const symbols = rawSpec.startsWith('{')
        ? rawSpec.slice(1, -1).split(',').map(s => s.trim().split(':').pop().trim()).filter(Boolean)
        : [rawSpec];
      imports.push({ symbols, modulePath: match[2].trim(), type: 'cjs' });
    }

    // 3. PHP: use Namespace\ClassName;
    const phpUseRegex = /^\s*use\s+([A-Za-z0-9_\\]+)(?:\s+as\s+([A-Za-z0-9_]+))?\s*;/gm;
    while ((match = phpUseRegex.exec(code)) !== null) {
      const fullNs = match[1];
      const alias = match[2] || fullNs.split('\\').pop();
      imports.push({ symbols: [alias], modulePath: fullNs, type: 'php_use' });
    }

    // 4. Python: from module.sub import A, B
    const pyFromRegex = /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+([^\n#]+)/gm;
    while ((match = pyFromRegex.exec(code)) !== null) {
      const mod = match[1].trim();
      const symbols = match[2].split(',').map(s => s.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean);
      imports.push({ symbols, modulePath: mod, type: 'python_from' });
    }

    // 5. Java / Kotlin: import com.example.service.PaymentService;
    const javaImportRegex = /^\s*import\s+(?:static\s+)?([A-Za-z0-9_.]+)\s*;/gm;
    while ((match = javaImportRegex.exec(code)) !== null) {
      const full = match[1];
      const sym = full.split('.').pop();
      imports.push({ symbols: [sym], modulePath: full, type: 'jvm_import' });
    }

    // 6. Go: import "..." or import ( ... )
    const goSingleRegex = /import\s+(?:([a-zA-Z0-9_]+)\s+)?["']([^"']+)["']/g;
    while ((match = goSingleRegex.exec(code)) !== null) {
      const pkgPath = match[2];
      const sym = match[1] || pkgPath.split('/').pop();
      imports.push({ symbols: [sym], modulePath: pkgPath, type: 'go_import' });
    }

    // 7. Rust: use crate::services::OrderService;
    const rustUseRegex = /^\s*use\s+([A-Za-z0-9_:{}*,\s]+)\s*;/gm;
    while ((match = rustUseRegex.exec(code)) !== null) {
      const raw = match[1].trim();
      const sym = raw.split('::').pop().replace(/[{}]/g, '').trim();
      imports.push({ symbols: [sym], modulePath: raw, type: 'rust_use' });
    }

    return imports;
  }

  /**
   * Extract class / struct / interface definitions and their fields & methods
   */
  extractClasses(code, language) {
    const classes = [];
    const classRegex = /(?:(?:public|private|protected|abstract|final|export|default)\s+)*(?:class|struct|interface)\s+([A-Za-z0-9_]+)(?:\s+(?:extends|implements|:)\s+([A-Za-z0-9_\\.,\s<>]+))?/g;
    let match;

    while ((match = classRegex.exec(code)) !== null) {
      const className = match[1];
      const inheritance = match[2] ? match[2].trim() : null;
      const scope = this.extractScopeNode(code, match.index, language);
      const classBody = scope ? scope.innerBody : '';

      const fields = this.extractClassFields(classBody, language);
      const methods = this.extractFunctions(classBody, language).map(m => m.name);

      classes.push({
        name: className,
        inherits: inheritance,
        fields,
        methods,
        body: classBody
      });
    }

    return classes;
  }

  extractClassFields(classBody, language) {
    const fields = [];
    if (!classBody) return fields;

    // Java / C# / TS / PHP typed properties
    const propRegex = /^\s*(?:@[A-Za-z0-9_]+\s+)*(?:(?:private|protected|public|readonly|final|static)\s+)+(?:([A-Za-z0-9_<>[\]?]+)\s+)?(\$?[a-zA-Z0-9_]+)\s*(?::\s*([A-Za-z0-9_<>[\]?]+))?\s*[;=]/gm;
    let match;
    while ((match = propRegex.exec(classBody)) !== null) {
      const name = match[2];
      const type = match[1] || match[3] || 'any';
      if (name && !['function', 'class', 'return', 'const', 'let', 'var'].includes(name) && !fields.some(f => f.name === name)) {
        fields.push({ name: name.replace(/^\$/, ''), type, rawName: name });
      }
    }

    // Constructor dependency injection: constructor(private readonly orderService: OrderService) or __construct(OrderService $orderService)
    const ctorRegex = /(?:constructor|__construct)\s*\(([^)]+)\)/g;
    while ((match = ctorRegex.exec(classBody)) !== null) {
      const params = match[1].split(',');
      for (const param of params) {
        const tsMatch = param.trim().match(/(?:(?:private|public|protected|readonly)\s+)*([a-zA-Z0-9_]+)\s*:\s*([A-Za-z0-9_<>]+)/);
        if (tsMatch && !fields.some(f => f.name === tsMatch[1])) {
          fields.push({ name: tsMatch[1], type: tsMatch[2], rawName: tsMatch[1] });
          continue;
        }
        const phpJavaMatch = param.trim().match(/([A-Z][a-zA-Z0-9_\\]+)\s+(\$?[a-zA-Z0-9_]+)/);
        if (phpJavaMatch && !fields.some(f => f.name === phpJavaMatch[2].replace(/^\$/, ''))) {
          fields.push({
            name: phpJavaMatch[2].replace(/^\$/, ''),
            type: phpJavaMatch[1].split('\\').pop(),
            rawName: phpJavaMatch[2]
          });
        }
      }
    }

    // Go / Rust struct fields
    const structFieldRegex = /^\s*([a-zA-Z0-9_]+)\s+(?:\*?[A-Za-z0-9_.[\]]+|:\s*[A-Za-z0-9_<>:]+)/gm;
    while ((match = structFieldRegex.exec(classBody)) !== null) {
      const name = match[1];
      if (!['func', 'fn', 'pub', 'return', 'if', 'for', 'type'].includes(name) && !fields.some(f => f.name === name)) {
        fields.push({ name, type: 'StructField', rawName: name });
      }
    }

    return fields;
  }

  /**
   * Extract functions and methods across all 9 languages
   */
  extractFunctions(code, language) {
    const functions = [];
    if (!code) return functions;

    const patterns = [
      // PHP / JS / TS: [async] function name(params)
      /(?:(?:public|private|protected|static|async|final|export|default)\s+)*function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g,
      // Python: [async] def name(params):
      /(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g,
      // Go: func [(receiver)] name(params)
      /func\s+(?:\([^)]+\)\s*)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g,
      // Rust: [pub] [async] fn name(params)
      /(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g,
      // Java / C# / TS class methods: [modifiers] [ReturnType] name(params) {
      /(?:(?:public|private|protected|static|async|override|virtual)\s+)+(?:[A-Za-z0-9_<>[\]?,.\s]+\s+)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?::\s*[A-Za-z0-9_<>[\]|?\s]+)?\s*\{/g
    ];

    const seen = new Set();
    const reserved = new Set(['if', 'for', 'while', 'switch', 'catch', 'match', 'return', 'new', 'typeof', 'delete']);

    for (const regex of patterns) {
      let match;
      while ((match = regex.exec(code)) !== null) {
        const fnName = match[1];
        if (!fnName || reserved.has(fnName) || seen.has(`${fnName}@${match.index}`)) continue;

        const scope = this.extractScopeNode(code, match.index, language);
        if (!scope) continue;

        seen.add(`${fnName}@${match.index}`);
        const prefixSlice = code.slice(Math.max(0, match.index - 300), match.index);
        const lastBlank = prefixSlice.lastIndexOf('\n\n');
        const headerDecorators = lastBlank !== -1 ? prefixSlice.slice(lastBlank) : prefixSlice;

        functions.push({
          name: fnName,
          params: (match[2] || '').trim(),
          decorators: headerDecorators.trim(),
          body: scope.body,
          innerBody: scope.innerBody,
          startIndex: match.index,
          endIndex: scope.endOffset
        });
      }
    }

    return functions;
  }

  /**
   * Extract variable assignments from source code so dynamic strings, keys, and models
   * are resolved directly from AST bindings without hallucination.
   */
  extractVariables(code, language) {
    const vars = new Map();
    if (!code) return vars;

    const assignRegex = /(?:const|let|var)?\s*(\$?[a-zA-Z0-9_]+)\s*:?=\s*([^\n;]+)/g;
    let match;
    while ((match = assignRegex.exec(code)) !== null) {
      const varName = match[1].trim();
      const rawVal = match[2].trim();
      const cleanName = varName.replace(/^\$/, '');
      if (!vars.has(cleanName)) {
        vars.set(cleanName, rawVal);
      }
      if (!vars.has(varName)) {
        vars.set(varName, rawVal);
      }
    }
    return vars;
  }

  /**
   * Extract a specific method/function AST node by name
   */
  findFunctionNode(code, methodName, language = 'generic') {
    if (!code) return null;
    const fns = this.extractFunctions(code, language);
    if (methodName) {
      const clean = methodName.replace(/[()]/g, '').trim();
      const exact = fns.find(f => f.name === clean);
      if (exact) return exact;
      const caseInsensitive = fns.find(f => f.name.toLowerCase() === clean.toLowerCase());
      if (caseInsensitive) return caseInsensitive;
    }
    return fns[0] || null;
  }

  /**
   * Resolve an import path or symbol to an actual file on disk within rootDir
   */
  resolveImportToFile(importEntry, currentFile, allProjectFiles = []) {
    if (!importEntry || !importEntry.modulePath) return null;
    const modPath = importEntry.modulePath;
    const currentDir = currentFile ? path.dirname(currentFile) : this.rootDir;

    // 1. Relative path (./ or ../)
    if (modPath.startsWith('.')) {
      const candidateBase = path.resolve(currentDir, modPath);
      const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.php', '.java', '.rs', '.cs', '.rb'];
      for (const ext of exts) {
        const p = candidateBase + ext;
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
      }
      for (const ext of ['.ts', '.js', '.py']) {
        const idx = path.join(candidateBase, `index${ext}`);
        if (fs.existsSync(idx)) return idx;
      }
    }

    // 2. Namespace / Module path resolution (PHP App\..., Python pkg.mod, Java com.example..., Rust crate::...)
    const segments = modPath.replace(/^(?:App\\|crate::|super::)/i, '').split(/[\\/.:]+/).filter(Boolean);
    const targetBasename = segments[segments.length - 1];
    if (!targetBasename) return null;

    for (const file of allProjectFiles) {
      const baseNoExt = path.basename(file, path.extname(file));
      if (baseNoExt.toLowerCase() === targetBasename.toLowerCase() && file !== currentFile) {
        return file;
      }
    }

    return null;
  }

  buildSymbolMapForAst(ast) {
    const map = new Map();
    for (const imp of ast.imports) {
      for (const sym of imp.symbols) {
        map.set(sym, { symbol: sym, importEntry: imp });
      }
    }
    for (const cls of ast.classes) {
      for (const field of cls.fields) {
        if (field.type && field.type !== 'any' && field.type !== 'StructField') {
          map.set(field.name, {
            symbol: field.type,
            importEntry: ast.imports.find(i => i.symbols.includes(field.type)) || {
              symbols: [field.type],
              modulePath: field.type
            }
          });
        }
      }
    }
    return map;
  }

  /**
   * Crawl intra-file and cross-file method calls recursively using AST extraction
   */
  crawlMultiFileCallGraph(entryFile, code, rootMethodName, options = {}) {
    const maxDepth = options.maxDepth ?? 3;
    const language = options.language || 'generic';
    const allFiles = options.allFiles || [];

    const visited = new Set();
    const collectedNodes = new Map();
    const resolvedExternalFiles = new Set();
    const externalFileAsts = new Map();

    const fileAst = this.parseFile(entryFile, code, language);
    const symbolToClassMap = this.buildSymbolMapForAst(fileAst);

    const traverse = (targetCode, targetFile, methodName, depth, activeAst = fileAst, activeSymbolMap = symbolToClassMap) => {
      if (depth > maxDepth || !methodName) return;
      const visitKey = `${targetFile || 'inline'}::${methodName}`;
      if (visited.has(visitKey)) return;
      visited.add(visitKey);

      const node = this.findFunctionNode(targetCode, methodName, activeAst.language || language);
      if (!node) return;

      const ownerClass = activeAst.classes[0]?.name || (targetFile ? path.basename(targetFile, path.extname(targetFile)) : 'Handler');
      collectedNodes.set(visitKey, {
        name: node.name,
        ownerClass,
        file: targetFile,
        body: node.body,
        innerBody: node.innerBody,
        params: node.params,
        depth
      });

      // Find intra-file calls ($this->m(), this.m(), self::m(), local helper calls)
      const localCalls = this.extractIntraClassCalls(node.body);
      for (const localMethod of localCalls) {
        traverse(targetCode, targetFile, localMethod, depth + 1, activeAst, activeSymbolMap);
      }

      // Find cross-file calls (Service.method(), this.service.method(), Helper::method())
      const externalCalls = this.extractExternalMemberCalls(node.body);
      for (const extCall of externalCalls) {
        const mapped = activeSymbolMap.get(extCall.object) || symbolToClassMap.get(extCall.object) || {
          symbol: extCall.object,
          importEntry: { symbols: [extCall.object], modulePath: extCall.object }
        };
        const extFile = this.resolveImportToFile(mapped.importEntry, targetFile, allFiles);
        if (extFile && fs.existsSync(extFile)) {
          resolvedExternalFiles.add(extFile);
          const extCode = fs.readFileSync(extFile, 'utf8');
          const extAst = this.parseFile(extFile, extCode, language);
          externalFileAsts.set(extFile, extAst);
          const extSymMap = this.buildSymbolMapForAst(extAst);
          for (const [k, v] of extSymMap.entries()) {
            if (!symbolToClassMap.has(k)) symbolToClassMap.set(k, v);
          }
          traverse(extCode, extFile, extCall.method, depth + 1, extAst, extSymMap);
        }
      }
    };

    if (rootMethodName) {
      traverse(code, entryFile, rootMethodName, 0, fileAst, symbolToClassMap);
    } else if (fileAst.functions.length > 0) {
      const commonEntries = ['index', 'handle', '__invoke', 'show', 'store', 'execute', 'run'];
      const matchedEntry = fileAst.functions.find(f => commonEntries.includes(f.name)) || fileAst.functions[0];
      traverse(code, entryFile, matchedEntry.name, 0, fileAst, symbolToClassMap);
    }

    return {
      fileAst,
      externalFileAsts,
      collectedNodes,
      resolvedExternalFiles: Array.from(resolvedExternalFiles),
      symbolToClassMap
    };
  }

  extractIntraClassCalls(body) {
    if (!body) return [];
    const calls = [];
    const regex = /(?:\$this->|self::|static::|this\.)([a-zA-Z0-9_]+)\s*\(/g;
    let match;
    while ((match = regex.exec(body)) !== null) {
      if (!calls.includes(match[1])) {
        calls.push(match[1]);
      }
    }
    return calls;
  }

  extractExternalMemberCalls(body) {
    if (!body) return [];
    const calls = [];
    const reservedObjs = new Set([
      'this', '$this', 'self', 'static', 'super', 'console', 'Math', 'JSON', 'Object', 'Array', 'Promise',
      'req', 'res', 'request', 'response', '$request', 'c', 'ctx'
    ]);
    const regex = /(?:this\.|\$this->)?([a-zA-Z0-9_]+)(?:\.|::|->)([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
    let match;
    while ((match = regex.exec(body)) !== null) {
      const obj = match[1];
      const method = match[2];
      const args = match[3].trim();
      if (reservedObjs.has(obj)) continue;
      calls.push({ object: obj, method, args, raw: match[0] });
    }
    return calls;
  }
}
