#!/usr/bin/env node
"use strict";

import "dotenv/config";
import net from "net";
import mysql from "mysql2/promise";
import { Client as FTPClient } from "basic-ftp";
import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";

const DEFAULT_TIMEOUT = Number(process.env.OLT_COMMAND_TIMEOUT_MS) || 15000;

const DB_HOST = process.env.DB_HOST;
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;

const FTP_HOST = process.env.FTP_HOST;
const FTP_PORT = Number(process.env.FTP_PORT);
const FTP_USER = process.env.FTP_USER;
const FTP_PASS = process.env.FTP_PASS;
const FTP_BACKUP_DIR = process.env.FTP_BACKUP_DIR;

const BACKUP_SCHEDULE_ENABLED = (process.env.BACKUP_SCHEDULE_ENABLED ?? "1") !== "0";
const BACKUP_DAILY_TIME = process.env.BACKUP_DAILY_TIME || "19:00";

const dbPool = mysql.createPool({
  host: DB_HOST,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASS,
  waitForConnections: true,
  connectionLimit: 8,
  namedPlaceholders: true,
  charset: "utf8mb4",
});

const LOGIN_PROMPTS = [/username[:\s]*$/im, /login[:\s]*$/im];
const PASSWORD_PROMPTS = [/password[:\s]*$/im];
const SHELL_PROMPTS = [/[\r\n][A-Za-z0-9_.-]+(?:\([^)]+\))?[>#]\s*$/m];

const detectPrompt = (buf, regexArr) => regexArr.some((r) => r.test(buf));
const cleanOutput = (raw, cmd) =>
  raw
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith(cmd))
    .join("\n")
    .replace(SHELL_PROMPTS[0], "")
    .trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function executeCommand(command, oltConfig, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: oltConfig.host, port: oltConfig.port });
    let buffer = "",
      output = "",
      state = "login_user";
    let done = false;

    const finish = (err, res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      err ? reject(err) : resolve(res);
    };

    const timer = setTimeout(() => finish(new Error("Timeout")), timeoutMs);

    socket.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (state !== "capture") buffer += text;

      switch (state) {
        case "login_user":
          if (detectPrompt(buffer, LOGIN_PROMPTS)) {
            socket.write(oltConfig.username + "\n");
            buffer = "";
            state = "login_pass";
          }
          break;
        case "login_pass":
          if (detectPrompt(buffer, PASSWORD_PROMPTS)) {
            socket.write(oltConfig.password + "\n");
            buffer = "";
            state = "set_term";
          }
          break;
        case "set_term":
          if (detectPrompt(buffer, SHELL_PROMPTS)) {
            socket.write("terminal length 0\n");
            buffer = "";
            state = "command";
          }
          break;
        case "command":
          if (detectPrompt(buffer, SHELL_PROMPTS)) {
            socket.write(command + "\n");
            buffer = "";
            state = "capture";
          }
          break;
        case "capture":
          output += text;
          if (detectPrompt(output, SHELL_PROMPTS)) {
            const cleaned = cleanOutput(output, command);
            finish(null, cleaned);
          }
          break;
      }
    });

    socket.on("error", finish);
    socket.on("timeout", () => finish(new Error("Connection timeout")));
    socket.on("close", () => finish());
  });
}

async function backupOltConfig(oltConfig) {
  const filename = `${oltConfig.name}.cfg`;

  console.log(`\n[BACKUP] Memulai backup untuk OLT: ${oltConfig.name}`);
  console.log(`   Host: ${oltConfig.host}:${oltConfig.port}`);
  console.log(`   File: ${filename}`);

  console.log(`   Mengambil running-config dari OLT...`);
  const config = await executeCommand("sh running-config", oltConfig, { timeoutMs: 120000 });
  console.log(`   Config berhasil diambil (${config.length} bytes)`);

  const ftp = new FTPClient(20000);
  try {
    console.log(`   Menghubungkan ke FTP ${FTP_HOST}:${FTP_PORT}`);
    await ftp.access({
      host: FTP_HOST,
      port: FTP_PORT,
      user: FTP_USER,
      password: FTP_PASS,
      secure: false,
    });

    if (FTP_BACKUP_DIR) {
      console.log(`   Memastikan direktori FTP: ${FTP_BACKUP_DIR}`);
      await ftp.ensureDir(FTP_BACKUP_DIR);
    }

    console.log(`   Upload file ke FTP: ${filename}`);
    await ftp.uploadFrom(Readable.from([config]), filename);
    console.log(`   File berhasil diupload ke FTP`);

    const normalizedDir = FTP_BACKUP_DIR
      ? FTP_BACKUP_DIR.replace(/\\/g, "/").replace(/\/+$/g, "")
      : "";
    const remotePath = normalizedDir ? `${normalizedDir}/${filename}` : filename;

    console.log(`[BACKUP SELESAI] ${oltConfig.name} -> ftp://${FTP_HOST}:${FTP_PORT}/${remotePath}\n`);

    return {
      filename,
      size: config.length,
      ftp: { host: FTP_HOST, port: FTP_PORT, remotePath },
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`   [ERROR] Gagal backup ${oltConfig.name}: ${err.message}`);
    throw err;
  } finally {
    ftp.close();
  }
}

async function backupAllOlts() {
  const [rows] = await dbPool.query("SELECT * FROM OLT_ZTE");
  console.log(`   Ditemukan ${rows.length} OLT di database\n`);
  const results = [];

  for (const row of rows) {
    const cfg = {
      id: row.id,
      name: row.olt_name,
      host: row.olt_ip,
      port: Number(row.olt_port),
      username: row.olt_username?.trim?.() ?? row.olt_username,
      password: row.olt_password?.trim?.() ?? row.olt_password,
    };

    try {
      const backupInfo = await backupOltConfig(cfg);
      results.push({ olt: cfg.name, status: "success", ...backupInfo });
    } catch (err) {
      console.error(`[GAGAL] ${cfg.name}: ${err.message}\n`);
      results.push({ olt: cfg.name, status: "error", error: err.message });
    }
  }

  const successCount = results.filter((r) => r.status === "success").length;
  const failCount = results.filter((r) => r.status === "error").length;
  return { results, successCount, failCount };
}

function scheduleDailyBackup() {
  const [hhStr, mmStr] = BACKUP_DAILY_TIME.split(":");
  const targetHour = Math.max(0, Math.min(23, parseInt(hhStr, 10) || 3));
  const targetMin = Math.max(0, Math.min(59, parseInt(mmStr, 10) || 0));

  const now = new Date();
  const next = new Date(now);
  next.setHours(targetHour, targetMin, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  const delay = next.getTime() - now.getTime();

  console.log(
    `Scheduler aktif: backup harian jam ${String(targetHour).padStart(2, "0")}:${String(targetMin).padStart(2, "0")} (berikutnya: ${next.toString()})`
  );

  setTimeout(async () => {
    try {
      console.log(`\n[SCHEDULER] Menjalankan backup semua OLT (jadwal harian)`);
      const { results, successCount, failCount } = await backupAllOlts();
      console.log(`\n[SCHEDULER SELESAI]`);
      console.log(`   Berhasil: ${successCount} OLT`);
      console.log(`   Gagal: ${failCount} OLT`);
      console.log(`   Total: ${results.length} OLT\n`);
    } catch (err) {
      console.error(`\n[SCHEDULER ERROR] ${err?.message || err}`);
    } finally {
      scheduleDailyBackup();
    }
  }, delay);
}

if (BACKUP_SCHEDULE_ENABLED) {
  scheduleDailyBackup();
} else {
  console.log("Scheduler nonaktif (BACKUP_SCHEDULE_ENABLED=0)");
}
