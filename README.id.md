<div align="center">

# 📐 UML-Architect

**Universal Autonomous Code-to-Diagram AI Skill Agent**  
*Pembangkit otomatis Sequence Diagram, Flowchart, dan Arsitektur UML yang 100% akurat, tervalidasi sintaksnya, untuk bahasa pemrograman apa pun dan di IDE Agent mana pun.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933?style=for-the-badge&logo=nodedotjs)](https://nodejs.org)
[![Mermaid.js](https://img.shields.io/badge/Render-Mermaid.js-ff3670?style=for-the-badge&logo=mermaid)](https://mermaid.js.org)
[![MCP Protocol](https://img.shields.io/badge/Protocol-MCP-8A2BE2?style=for-the-badge)](https://modelcontextprotocol.io)

[English](README.md) | [Bahasa Indonesia](README.id.md)

</div>

---

## 🌟 Ringkasan

**UML-Architect** adalah skill agent AI otonom yang memecahkan masalah dokumentasi arsitektur usang (*documentation rot*). Cukup dengan memberikan **endpoint API**, **nama fungsi**, atau **path file/folder**, UML-Architect secara deterministik menelusuri seluruh alur eksekusi—dari middleware, controller, service layer, hingga transaksi database dan third-party API—lalu menghasilkan diagram UML siap pakai dalam format **Mermaid.js** dan **PlantUML**.

### Fitur Utama:
* 🌐 **Kompatibilitas Lintas IDE**: Bekerja native di **Google Antigravity**, **Cursor**, **Claude Code**, **Windsurf**, **Kiro**, **GitHub Copilot**, **Roo Code / Cline**, **Continue.dev**, dan klien **MCP**.
* 🔠 **100% Polyglot & Bebas Compiler Lokal**: Arsitektur Tri-Layer mampu membaca TypeScript, Python, Go, Java, C#, Rust, PHP, Ruby, dan bahasa lainnya tanpa mengharuskan compiler bahasa tersebut terpasang di komputer lokal.
* 🛡️ **Penelusuran Anti-Halusinasi**: Seluruh partisipan, metode, dan cabang error terbukti bersumber dari kode sumber riil.
* 🔧 **Self-Healing Mermaid Validation**: Menjamin 0% kegagalan render sintaks di viewer Markdown GitHub ataupun IDE.

---

## 🚀 Panduan Cepat

### 1. Inisialisasi Adapter IDE Proyek
Pasang aturan dan adapter secara otomatis untuk IDE yang aktif di proyek:
```bash
npx uml-architect init
```

### 2. Membuat Diagram dari Endpoint API
```bash
npx uml-architect trace --endpoint "POST /api/v1/orders/checkout"
```

### 3. Membuat Diagram dari Fungsi/Method
```bash
npx uml-architect function --name "processPayment" --file "src/services/payment.ts"
```

### 4. Menjalankan Server MCP (Model Context Protocol)
Tambahkan ke konfigurasi MCP di IDE Anda (Cursor, Claude Desktop, Antigravity, Windsurf, Kiro, dll.) untuk dijalankan langsung dari GitHub tanpa clone:
```json
{
  "mcpServers": {
    "uml-architect": {
      "command": "npx",
      "args": ["-y", "github:hanifalkauni/uml-architect", "--mcp"]
    }
  }
}
```
*(Atau gunakan `node ./bin/uml-architect.js --mcp` jika dijalankan secara lokal)*

---

## 📜 Lisensi
MIT © [Hanif Al-Kauni](https://github.com/hanifalkauni)
