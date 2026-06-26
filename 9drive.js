#!/usr/bin/env node
"use strict";

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";

const API_URL = process.env.DRIVE_API_URL || "https://api-9drive.projektobi.my.id/uploads";
const API_KEY = process.env.DRIVE_API_KEY;
const FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const SOURCE_DIR = process.env.DRIVE_SOURCE_DIR;

const UPLOAD_SCHEDULE_ENABLED = (process.env.UPLOAD_SCHEDULE_ENABLED ?? "1") !== "0";
const UPLOAD_DAILY_TIME = process.env.UPLOAD_DAILY_TIME || "07:00";

if (!API_KEY || !FOLDER_ID || !SOURCE_DIR) {
  console.error("Error: DRIVE_API_KEY, DRIVE_FOLDER_ID, dan DRIVE_SOURCE_DIR harus diisi di .env");
  process.exit(1);
}

async function uploadFiles() {
  const dir = path.resolve(SOURCE_DIR);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    console.error(`Error membaca direktori ${dir}: ${err.message}`);
    process.exit(1);
  }

  const filePaths = files
    .filter((f) => f !== "." && f !== "..")
    .map((f) => path.join(dir, f));

  if (filePaths.length === 0) {
    console.log("Tidak ada file untuk diupload.");
    return;
  }

  console.log(`Ditemukan ${filePaths.length} file di ${dir}\n`);

  const formData = new FormData();
  formData.append("folderId", FOLDER_ID);

  const statsList = [];
  for (let i = 0; i < filePaths.length; i++) {
    const fp = filePaths[i];
    const stat = await fs.stat(fp);
    if (!stat.isFile()) continue;
    const content = await fs.readFile(fp);
    const fileName = path.basename(fp);
    const blob = new Blob([content]);
    formData.append(`file-${i}`, blob, fileName);
    statsList.push({ name: fileName, size: stat.size });
  }

  if (statsList.length === 0) {
    console.log("Tidak ada file reguler untuk diupload.");
    return;
  }

  console.log("Mengupload file...");
  for (const s of statsList) {
    console.log(`   ${s.name} (${(s.size / 1024).toFixed(1)} KB)`);
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
    body: formData,
  });

  const result = await res.json();
  if (!res.ok) {
    console.error(`\nUpload gagal (${res.status}):`, JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(`\nUpload berhasil! ${statsList.length} file terkirim.`);
  console.log(JSON.stringify(result, null, 2));
}

function scheduleDailyUpload() {
  const [hhStr, mmStr] = UPLOAD_DAILY_TIME.split(":");
  const targetHour = Math.max(0, Math.min(23, parseInt(hhStr, 10) || 7));
  const targetMin = Math.max(0, Math.min(59, parseInt(mmStr, 10) || 0));

  const now = new Date();
  const next = new Date(now);
  next.setHours(targetHour, targetMin, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  const delay = next.getTime() - now.getTime();

  console.log(
    `Scheduler aktif: upload harian jam ${String(targetHour).padStart(2, "0")}:${String(targetMin).padStart(2, "0")} (berikutnya: ${next.toString()})`
  );

  setTimeout(async () => {
    try {
      console.log(`\n[SCHEDULER] Menjalankan upload file (jadwal harian)`);
      await uploadFiles();
      console.log(`\n[SCHEDULER SELESAI]\n`);
    } catch (err) {
      console.error(`\n[SCHEDULER ERROR] ${err?.message || err}`);
    } finally {
      scheduleDailyUpload();
    }
  }, delay);
}

if (UPLOAD_SCHEDULE_ENABLED) {
  scheduleDailyUpload();
} else {
  uploadFiles().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
