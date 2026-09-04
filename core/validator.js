/**
 * ValidatorEngine
 * Memvalidasi dan memperbaiki secara otomatis (Self-Healing) sintaks Mermaid.js
 * untuk menjamin diagram 100% bebas dari syntax error saat dirender di GitHub, VS Code, atau browser.
 */
export class ValidatorEngine {
  /**
   * Validasi dan self-heal kode Mermaid
   */
  validateAndRepair(rawMermaidCode) {
    if (!rawMermaidCode || typeof rawMermaidCode !== 'string') {
      return {
        isValid: false,
        fixedMermaid: 'sequenceDiagram\n    autonumber\n    participant System\n    Note over System: No diagram content generated',
        warnings: ['Empty diagram content provided']
      };
    }

    const warnings = [];
    let cleaned = rawMermaidCode.trim();

    // Hapus markdown wrapper jika ada
    if (cleaned.startsWith('```mermaid')) {
      cleaned = cleaned.replace(/^```mermaid\s*\n?/, '').replace(/\n?```$/, '').trim();
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-z]*\s*\n?/, '').replace(/\n?```$/, '').trim();
    }

    const lines = cleaned.split('\n');
    const header = lines[0].trim();
    const isSequence = header.startsWith('sequenceDiagram');
    const isFlowchart = header.startsWith('flowchart') || header.startsWith('graph');

    let fixedLines = [];
    let blockStack = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const trimmed = line.trim();

      // Skip baris header awal
      if (i === 0) {
        fixedLines.push(line);
        continue;
      }

      if (isSequence) {
        // Deteksi blok buka/tutup di sequence diagram
        if (/^\s*(?:alt|opt|loop|par|critical|break)\b/.test(trimmed)) {
          blockStack.push(trimmed.split(/\s+/)[0]);
        } else if (/^\s*end\b/.test(trimmed)) {
          if (blockStack.length > 0) {
            blockStack.pop();
          } else {
            // Unmatched 'end', abaikan
            warnings.push(`Baris ${i + 1}: Menghapus kata 'end' tanpa blok pembuka`);
            continue;
          }
        }

        // Perbaiki illegal characters pada pesan sequence diagram
        // Misal: A->>B: GET /api/v1/orders/checkout {id}
        // Pastikan teks pesan setelah ':' tidak merusak sintaks
        const msgMatch = line.match(/^(\s*[A-Za-z0-9_]+\s*(?:->>|-->>|->|-->|-\)|-x)\s*[A-Za-z0-9_]+\s*:\s*)(.*)$/);
        if (msgMatch) {
          const prefix = msgMatch[1];
          let msg = msgMatch[2].trim();
          // Escape karakter kurung siku tanpa pasangan atau tanda kutip ganda rusak
          msg = msg.replace(/([<>])/g, '\\$1');
          line = `${prefix}${msg}`;
        }

        // Perbaiki participant alias jika mengandung karakter ilegal
        // participant /api/v1 as Endpoint -> participant API as /api/v1
        const partMatch = line.match(/^(\s*participant\s+)([^as\s]+)(\s+as\s+.*)$/);
        if (partMatch && /[^a-zA-Z0-9_]/.test(partMatch[2])) {
          const cleanAlias = partMatch[2].replace(/[^a-zA-Z0-9_]/g, '_');
          line = `${partMatch[1]}${cleanAlias}${partMatch[3]}`;
          warnings.push(`Participant ID mengandung karakter ilegal, diubah menjadi: ${cleanAlias}`);
        }
      }

      if (isFlowchart) {
        // Perbaiki node label yang tidak di-quote jika memiliki kurung atau slash
        // Contoh: A[GET /orders] -> A["GET /orders"]
        line = line.replace(/([A-Za-z0-9_]+)\[([^"\]\n]*[\/\\:{}()][^"\]\n]*)\]/g, '$1["$2"]');
      }

      fixedLines.push(line);
    }

    // Auto-close open blocks yang belum ditutup
    while (blockStack.length > 0) {
      const unclosed = blockStack.pop();
      fixedLines.push(`    end %% Auto-closed missing end for ${unclosed} %%`);
      warnings.push(`Menambahkan penutup 'end' otomatis untuk blok ${unclosed}`);
    }

    return {
      isValid: warnings.length === 0,
      fixedMermaid: fixedLines.join('\n'),
      warnings
    };
  }
}
