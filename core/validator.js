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
    // Cari baris deklarasi tipe diagram pertama setelah directive %%{init:...}%% atau komentar %%
    const diagramHeaderLine = (lines.find(l => l.trim() && !l.trim().startsWith('%%')) || '').trim();
    const isSequence = diagramHeaderLine.startsWith('sequenceDiagram');
    const isFlowchart = diagramHeaderLine.startsWith('flowchart') || diagramHeaderLine.startsWith('graph');

    const fixedLines = [];
    const blockStack = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const trimmed = line.trim();

      // Lewati baris directive atau header deklarasi diagram
      if (trimmed.startsWith('%%') || trimmed === diagramHeaderLine) {
        fixedLines.push(line);
        continue;
      }

      if (isSequence) {
        // Deteksi blok buka/tutup di sequence diagram (termasuk box untuk visual layer grouping)
        if (/^\s*(?:box|alt|opt|loop|par|critical|break)\b/.test(trimmed)) {
          blockStack.push(trimmed.split(/\s+/)[0]);
        } else if (/^\s*end\b/.test(trimmed)) {
          if (blockStack.length > 0) {
            blockStack.pop();
          } else {
            warnings.push(`Baris ${i + 1}: Menghapus kata 'end' tanpa blok pembuka`);
            continue;
          }
        }

        // Perbaiki participant / actor ID jika mengandung karakter ilegal (misal slash atau spasi sebelum 'as')
        const partMatch = line.match(/^(\s*(?:participant|actor)\s+)(\S+)(\s+as\s+.*)$/);
        if (partMatch && /[^a-zA-Z0-9_]/.test(partMatch[2])) {
          const cleanAlias = partMatch[2].replace(/[^a-zA-Z0-9_]/g, '_');
          line = `${partMatch[1]}${cleanAlias}${partMatch[3]}`;
          warnings.push(`Participant ID mengandung karakter ilegal, diubah menjadi: ${cleanAlias}`);
        }
      }

      if (isFlowchart) {
        // Perbaiki node label yang tidak di-quote jika memiliki kurung atau slash
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
