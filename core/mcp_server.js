import readline from 'node:readline';
import { UmlArchitect } from './index.js';
import { ProfileLoader } from './profile_loader.js';
import { ManifestSniffer } from './manifest_sniffer.js';

/**
 * Universal Model Context Protocol (MCP) Server
 * Menyediakan antarmuka JSON-RPC standar via stdio untuk semua AI Agent IDE.
 */
export class McpServer {
  constructor() {
    this.architect = new UmlArchitect();
    this.profileLoader = new ProfileLoader();
    this.sniffer = new ManifestSniffer();

    this.tools = [
      {
        name: 'generate_uml_diagram',
        description: 'Universal UML Generator: Menghasilkan diagram UML (sequence, flowchart, class, state, component) dari endpoint, function, file path, atau natural language query.',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Target: Endpoint ("POST /orders"), Function ("processPayment"), File path ("src/auth.ts"), atau Query ("alur registrasi user")' },
            diagram_type: { type: 'string', enum: ['sequence', 'flowchart', 'class', 'state', 'component'], default: 'sequence' },
            theme: { type: 'string', enum: ['tokyo-night', 'catppuccin', 'nord', 'default'], default: 'tokyo-night' },
            detail_level: { type: 'string', enum: ['L1', 'L2', 'L3', 'standard', 'high', 'deep'], default: 'standard' }
          },
          required: ['target']
        }
      },
      {
        name: 'trace_endpoint_flow',
        description: 'Melacak alur eksekusi lengkap endpoint API (middleware, controller, service, DB/ORM, third-party API) dan menghasilkan Sequence Diagram Mermaid.',
        inputSchema: {
          type: 'object',
          properties: {
            endpoint: { type: 'string', description: 'Endpoint API (contoh: "POST /api/v1/orders/checkout" atau "/users/:id")' },
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], description: 'HTTP Method opsional' },
            file: { type: 'string', description: 'Path file spesifik yang berisi implementasi endpoint (opsional)' },
            detail_level: { type: 'string', enum: ['L1', 'L2', 'L3', 'standard', 'high', 'deep'], default: 'standard' }
          },
          required: ['endpoint']
        }
      },
      {
        name: 'trace_function_flow',
        description: 'Melacak hierarki pemanggilan dan percabangan logika dari sebuah function atau method dalam bahasa pemrograman apa pun.',
        inputSchema: {
          type: 'object',
          properties: {
            function_name: { type: 'string', description: 'Nama function atau method (contoh: "reconcileLedgerBalance")' },
            file_path: { type: 'string', description: 'Path ke file tempat function didefinisikan' },
            diagram_type: { type: 'string', enum: ['sequence', 'flowchart', 'state'], default: 'sequence' }
          },
          required: ['function_name']
        }
      },
      {
        name: 'trace_path_flow',
        description: 'Memetakan alur atau diagram arsitektur dari file modul atau seluruh direktori proyek.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relatif file atau folder (contoh: "src/modules/auth")' },
            diagram_type: { type: 'string', enum: ['sequence', 'flowchart', 'class', 'component'], default: 'sequence' }
          },
          required: ['path']
        }
      },
      {
        name: 'validate_mermaid_syntax',
        description: 'Memvalidasi dan memperbaiki otomatis (self-healing) sintaks Mermaid.js agar 100% bebas error saat dirender.',
        inputSchema: {
          type: 'object',
          properties: {
            mermaid_code: { type: 'string', description: 'String sintaks kode Mermaid yang akan divalidasi' }
          },
          required: ['mermaid_code']
        }
      },
      {
        name: 'list_supported_profiles',
        description: 'Melihat daftar bahasa dan framework yang didukung secara modular oleh UML-Architect.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'detect_project_language',
        description: 'Mendeteksi bahasa pemrograman dan framework yang aktif dalam repositori kerja saat ini.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Direktori root proyek (default: .)' }
          }
        }
      }
    ];
  }

  start() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.on('line', async (line) => {
      if (!line.trim()) return;
      try {
        const request = JSON.parse(line);
        const response = await this.handleRequest(request);
        if (response) {
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (err) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error: ' + err.message }
        }) + '\n');
      }
    });

    process.stderr.write('[uml-architect] MCP Server berjalan via stdio...\n');
  }

  async handleRequest(req) {
    const { id, method, params } = req;

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'uml-architect',
            version: '1.0.0'
          }
        }
      };
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: this.tools
        }
      };
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};

      try {
        let resultText = '';

        if (toolName === 'generate_uml_diagram') {
          const target = args.target || '';
          const diagType = args.diagram_type || 'sequence';
          const detail = args.detail_level || 'standard';

          let res;
          if (/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|\/)/i.test(target)) {
            res = await this.architect.generateFromEndpoint(target, {
              diagramType: diagType,
              detailLevel: detail
            });
          } else if (target.includes('/') || target.includes('\\')) {
            res = await this.architect.generateFromPath(target, {
              diagramType: diagType,
              detailLevel: detail
            });
          } else if (target.includes(' ') && target.length > 20) {
            res = await this.architect.generateFromQuery(target, {
              diagramType: diagType,
              detailLevel: detail
            });
          } else {
            res = await this.architect.generateFromFunction(target, {
              diagramType: diagType,
              detailLevel: detail
            });
          }
          resultText = res.markdown;
        } else if (toolName === 'trace_endpoint_flow') {
          const res = await this.architect.generateFromEndpoint(args.endpoint, {
            method: args.method,
            targetFile: args.file,
            detailLevel: args.detail_level
          });
          resultText = res.markdown;
        } else if (toolName === 'trace_function_flow') {
          const res = await this.architect.generateFromFunction(args.function_name, {
            file: args.file_path,
            diagramType: args.diagram_type
          });
          resultText = res.markdown;
        } else if (toolName === 'trace_path_flow') {
          const res = await this.architect.generateFromPath(args.path, {
            diagramType: args.diagram_type
          });
          resultText = res.markdown;
        } else if (toolName === 'validate_mermaid_syntax') {
          const res = this.architect.validateMermaid(args.mermaid_code);
          resultText = JSON.stringify(res, null, 2);
        } else if (toolName === 'list_supported_profiles') {
          const profiles = this.profileLoader.listSupportedProfiles();
          resultText = JSON.stringify(profiles, null, 2);
        } else if (toolName === 'detect_project_language') {
          const sniffer = args.path ? new ManifestSniffer(args.path) : this.sniffer;
          const scan = sniffer.sniff();
          resultText = JSON.stringify(scan, null, 2);
        } else {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Tool tidak ditemukan: ${toolName}` }
          };
        }

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: resultText
              }
            ]
          }
        };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Error mengeksekusi ${toolName}: ${err.message}`
              }
            ]
          }
        };
      }
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method tidak didukung: ${method}` }
    };
  }
}
