---
name: uml-architect
description: >-
  Universal expert software architecture & diagramming skill agent.
  Autonomously traces API endpoints, functions, or file paths across any programming language
  and generates 100% accurate, syntax-validated, and visually stunning UML diagrams (Mermaid.js & PlantUML)
  with WCAG 2.2 AA compliant narrative walkthroughs.
---

# UML-Architect Skill Instructions

Skill ini menginstruksikan agent untuk memetakan alur eksekusi kode (*request lifecycle*) secara deterministik tanpa halusinasi dari sebuah **endpoint API**, **function/method**, atau **path file/modul**.

## Langkah Eksekusi Alur Kerja (5-Stage Pipeline):

1. **Resolusi Target & Deteksi Bahasa (Discovery & Profile Ingestion)**:
   - Identifikasi target: Apakah input berupa endpoint (misal: `POST /api/orders`), nama fungsi (misal: `processPayment`), atau path file?
   - Sniff file manifest proyek (`package.json`, `go.mod`, `pom.xml`, `pyproject.toml`, `Cargo.toml`, dll.) untuk mendeteksi framework yang aktif.
   - Muat profil bahasa yang sesuai dari modul `profiles/` secara on-demand.

2. **Penelusuran Call-Graph End-to-End (Strict Code Tracing)**:
   - **Entrypoint**: Lacak router declaration dan middleware rantai awal (Auth guard, CORS, validation schema).
   - **Controller / Handler**: Ekstrak DTO input dan pemanggilan ke service layer.
   - **Service Layer**: Petakan logika bisnis utama, transformasi data, dan koordinasi antar-service.
   - **Database & I/O**: Identifikasi transaksi database (`INSERT`, `SELECT`, `UPDATE`, `COMMIT`), caching Redis, dan external HTTP API calls.
   - **Async Events**: Lacak pemancaran event ke message queue/broker (Kafka, RabbitMQ, SQS, Redis PubSub).
   - **Error & Edge Cases**: Petakan penanganan eksepsi (`try-catch`, `if err != nil`, `Result<T, E>`) ke dalam blok `alt` / `opt`.

3. **Verifikasi Anti-Halusinasi (Strict Proof Verification)**:
   - Dilarang mengarang partisipan atau nama fungsi yang tidak ada dalam kode riil.
   - Setiap panah pemanggilan antar-partisipan harus merefleksikan baris kode yang benar-benar ada.

4. **Visual Diagram Generation & Self-Healing Sintaks**:
   - Gunakan format **Mermaid.js** sebagai output visual standar di dalam blok ` ```mermaid `.
   - Wajib menyertakan `autonumber` pada `sequenceDiagram`.
   - Gunakan alias partisipan yang bersih (contoh: `participant Ctrl as OrderController`).
   - Sertakan opsi PlantUML di dalam tag `<details><summary>` sebagai alternatif format.
   - Pastikan seluruh karakter kurung siku, tanda kutip, dan slash di-escape dengan aman.

5. **Dokumentasi Naratif & Aksesibilitas (WCAG 2.2 AA Compliance)**:
   - Setiap diagram wajib disertai deskripsi teks naratif langkah per langkah (*A11y Walkthrough*) di bawah diagram.
   - Berikan tabel ringkasan partisipan dan daftar error code HTTP yang mungkin terjadi.
