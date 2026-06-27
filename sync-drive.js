#!/usr/bin/env node
"use strict";

import "dotenv/config";
import fetch from "node-fetch";
import mysql from "mysql2/promise";

const API_URL = process.env.DRIVE_API_URL || "https://api-9drive.projektobi.my.id/uploads";
const API_KEY = process.env.DRIVE_API_KEY;
const FOLDER_ID = process.env.DRIVE_FOLDER_ID;

const DB_HOST = process.env.DB_HOST;
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;

if (!API_KEY || !FOLDER_ID) {
  console.error("Error: DRIVE_API_KEY dan DRIVE_FOLDER_ID harus diisi di .env");
  process.exit(1);
}

if (!DB_HOST || !DB_NAME || !DB_USER || DB_PASS === undefined) {
  console.error("Error: DB_HOST, DB_NAME, DB_USER, DB_PASS harus diisi di .env");
  process.exit(1);
}

const dbPool = mysql.createPool({
  host: DB_HOST,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASS,
  waitForConnections: true,
  connectionLimit: 4,
  namedPlaceholders: true,
  charset: "utf8mb4",
});

const BASE_API = API_URL.replace(/\/uploads$/, "");

async function fetchFilesFromDrive() {
  const url = `${BASE_API}/files?folderId=${FOLDER_ID}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "X-API-Key": API_KEY },
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return await res.json();
}

async function syncToDatabase(apiResponse) {
  const files = apiResponse.files || apiResponse.data || [];

  const conn = await dbPool.getConnection();
  try {
    const apiFileIds = files.map((f) => f.id).filter(Boolean);

    if (apiFileIds.length > 0) {
      let inserted = 0;
      let updated = 0;

      for (const file of files) {
        const fileId = file.id;
        const fileName = file.name;
        const fileSize = typeof file.sizeBytes === "string"
          ? parseInt(file.sizeBytes, 10) || 0
          : (file.size || file.sizeBytes || 0);

        const [existing] = await conn.execute(
          "SELECT id FROM drive_files WHERE file_id = ? AND folder_id = ?",
          [fileId, FOLDER_ID]
        );

        if (existing.length > 0) {
          await conn.execute(
            `UPDATE drive_files SET file_name = ?, file_size = ?, response_data = ? WHERE file_id = ? AND folder_id = ?`,
            [fileName, fileSize, JSON.stringify(apiResponse), fileId, FOLDER_ID]
          );
          updated++;
        } else {
          await conn.execute(
            `INSERT INTO drive_files (file_name, file_size, file_id, folder_id, upload_status, response_data) VALUES (?, ?, ?, ?, 'success', ?)`,
            [fileName, fileSize, fileId, FOLDER_ID, JSON.stringify(apiResponse)]
          );
          inserted++;
        }
      }

      const placeholders = apiFileIds.map(() => "?").join(",");
      const [deleteResult] = await conn.execute(
        `DELETE FROM drive_files WHERE folder_id = ? AND file_id NOT IN (${placeholders})`,
        [FOLDER_ID, ...apiFileIds]
      );
      const deleted = deleteResult.affectedRows;

      console.log(`   ${inserted} baru, ${updated} diperbarui, ${deleted} dihapus, ${files.length} di 9drive`);
    } else {
      const [deleteResult] = await conn.execute(
        "DELETE FROM drive_files WHERE folder_id = ?",
        [FOLDER_ID]
      );
      console.log(`   Folder kosong, ${deleteResult.affectedRows} record dihapus dari database`);
    }
  } catch (err) {
    console.error(`   Gagal sinkronisasi database: ${err.message}`);
  } finally {
    conn.release();
  }
}

async function runSync() {
  const now = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  console.log(`\n[${now}] Memulai sinkronisasi 9drive...`);
  try {
    const apiResponse = await fetchFilesFromDrive();
    const fileCount = (apiResponse.files || apiResponse.data || []).length;
    console.log(`   API berhasil direspons, ${fileCount} file ditemukan`);
    await syncToDatabase(apiResponse);
    console.log(`[SELESAI]`);
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
  }
}

console.log("Sinkronisasi 9drive aktif: setiap 5 menit");
runSync();
setInterval(runSync, 5 * 60 * 1000);
