#!/usr/bin/env node

import { UmlArchitect } from '../core/index.js';
import { McpServer } from '../core/mcp_server.js';
import { ProfileLoader } from '../core/profile_loader.js';

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
UML-Architect (v1.0.0) - Universal Autonomous Code-to-Diagram AI Skill Agent

Penggunaan:
  npx uml-architect <command> [options]

Commands:
  trace       Menelusuri alur eksekusi dari endpoint API dan membuat diagram
  function    Menelusuri hierarki panggilan fungsi/method
  path        Menelusuri modul/file direktori
  init        Memasang adapter rules (Antigravity, Cursor, Windsurf, Claude, Copilot, Cline)
  profiles    Melihat daftar profil bahasa yang didukung
  --mcp       Menjalankan Model Context Protocol (MCP) server via stdio

Options untuk 'trace':
  --endpoint, -e <string>   Endpoint API (contoh: "POST /api/v1/orders")
  --method, -m <string>     HTTP Method (GET, POST, PUT, DELETE, dll.)
  --file, -f <path>         Path file spesifik sumber endpoint
  --out, -o <path>          Simpan diagram ke file output Markdown (.md)
  --detail, -d <level>      Tingkat detail alur: L1, L2, L3 (default: L2)

Options untuk 'function':
  --name, -n <string>       Nama fungsi/method
  --file, -f <path>         Path file tempat fungsi berada
  --out, -o <path>          Simpan diagram ke file output Markdown (.md)

Contoh:
  npx uml-architect trace --endpoint "POST /api/orders/checkout"
  npx uml-architect function --name "processRefund" --file "src/services/pay.ts"
  npx uml-architect init
  npx uml-architect --mcp
`);
}

async function main() {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('uml-architect v1.0.0');
    process.exit(0);
  }

  if (args.includes('--mcp')) {
    const server = new McpServer();
    server.start();
    return;
  }

  const command = args[0];
  const architect = new UmlArchitect();

  function getArg(flags) {
    for (const flag of flags) {
      const idx = args.indexOf(flag);
      if (idx !== -1 && idx + 1 < args.length) {
        return args[idx + 1];
      }
    }
    return null;
  }

  if (command === 'init') {
    console.log('\n🚀 Menyiapkan adapter UML-Architect untuk seluruh AI Agent IDE...');
    const created = architect.initAdapters();
    for (const file of created) {
      console.log(`  ✓ Terpasang: ${file}`);
    }
    console.log('\n✨ Berhasil diinisialisasi! Anda sekarang dapat menggunakan @uml-architect di semua IDE.\n');
    process.exit(0);
  }

  if (command === 'profiles') {
    const loader = new ProfileLoader();
    const profiles = loader.listSupportedProfiles();
    console.log('\n📚 Profil Bahasa Modular yang Didukung UML-Architect:\n');
    for (const p of profiles) {
      console.log(`  • ${p.displayName} [${p.id}]: Ekstensi (${p.extensions.join(', ')})`);
    }
    console.log('');
    process.exit(0);
  }

  if (command === 'trace') {
    const endpoint = getArg(['--endpoint', '-e']);
    if (!endpoint) {
      console.error('Error: Argumen --endpoint (-e) wajib disertakan. Contoh: --endpoint "POST /orders"');
      process.exit(1);
    }

    const method = getArg(['--method', '-m']);
    const file = getArg(['--file', '-f']);
    const out = getArg(['--out', '-o']);
    const detail = getArg(['--detail', '-d']) || 'standard';

    console.log(`\n🔍 Menganalisis alur eksekusi untuk endpoint: ${endpoint}...`);
    const result = await architect.generateFromEndpoint(endpoint, {
      method,
      targetFile: file,
      detailLevel: detail,
      outputFile: out
    });

    console.log('\n' + result.markdown + '\n');
    if (out) {
      console.log(`✓ Diagram disimpan ke file: ${out}`);
    }
    process.exit(0);
  }

  if (command === 'function') {
    const fnName = getArg(['--name', '-n']);
    if (!fnName) {
      console.error('Error: Argumen --name (-n) wajib disertakan. Contoh: --name "processPayment"');
      process.exit(1);
    }

    const file = getArg(['--file', '-f']);
    const out = getArg(['--out', '-o']);

    console.log(`\n🔍 Menganalisis alur fungsi: ${fnName}...`);
    const result = await architect.generateFromFunction(fnName, {
      file,
      outputFile: out
    });

    console.log('\n' + result.markdown + '\n');
    if (out) {
      console.log(`✓ Diagram disimpan ke file: ${out}`);
    }
    process.exit(0);
  }

  if (command === 'path') {
    const targetPath = getArg(['--target', '-t']) || args[1];
    if (!targetPath) {
      console.error('Error: Path target wajib disertakan. Contoh: npx uml-architect path --target "src/auth"');
      process.exit(1);
    }

    const out = getArg(['--out', '-o']);
    console.log(`\n🔍 Menganalisis alur dari path: ${targetPath}...`);
    const result = await architect.generateFromPath(targetPath, {
      outputFile: out
    });

    console.log('\n' + result.markdown + '\n');
    if (out) {
      console.log(`✓ Diagram disimpan ke file: ${out}`);
    }
    process.exit(0);
  }

  console.error(`Command tidak dikenal: "${command}". Jalankan "npx uml-architect --help" untuk petunjuk.`);
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
