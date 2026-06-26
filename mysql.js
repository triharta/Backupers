#!/usr/bin/env node
"use strict";

import "dotenv/config";
import express from "express";
import mysql from "mysql2/promise";

const DB_HOST = process.env.DB_HOST;
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const API_KEY = process.env.API_KEY;
const API_PORT = Number(process.env.API_PORT) || 3000;

if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASS) {
  console.error("Error: DB_HOST, DB_NAME, DB_USER, DB_PASS harus diisi di .env");
  process.exit(1);
}

if (!API_KEY) {
  console.error("Error: API_KEY harus diisi di .env");
  process.exit(1);
}

const pool = mysql.createPool({
  host: DB_HOST,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASS,
  waitForConnections: true,
  connectionLimit: 8,
  namedPlaceholders: true,
  charset: "utf8mb4",
});

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const key = req.headers["x-api-key"];
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
  }
  next();
});

app.get("/api/tables", async (_req, res) => {
  try {
    const [rows] = await pool.execute("SHOW TABLES");
    const tables = rows.map((r) => Object.values(r)[0]);
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const TABLE_REGEX = /^[A-Za-z0-9_]+$/;

async function getTableMeta(table) {
  const [rows] = await pool.execute(`DESCRIBE \`${table}\``);
  const pk = rows.find((r) => r.Key === "PRI");
  return {
    columns: rows,
    primaryKey: pk ? pk.Field : null,
    autoIncrement: pk ? pk.Extra?.includes("auto_increment") : false,
  };
}

app.get("/api/:table", async (req, res) => {
  const { table } = req.params;
  if (!TABLE_REGEX.test(table)) return res.status(400).json({ error: "Invalid table name" });
  try {
    const [rows] = await pool.execute(`SELECT * FROM \`${table}\``);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/:table/:id", async (req, res) => {
  const { table, id } = req.params;
  if (!TABLE_REGEX.test(table)) return res.status(400).json({ error: "Invalid table name" });
  try {
    const meta = await getTableMeta(table);
    if (!meta.primaryKey) return res.status(400).json({ error: "Table has no primary key" });
    const [rows] = await pool.execute(
      `SELECT * FROM \`${table}\` WHERE \`${meta.primaryKey}\` = ?`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Record not found" });
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/:table", async (req, res) => {
  const { table } = req.params;
  if (!TABLE_REGEX.test(table)) return res.status(400).json({ error: "Invalid table name" });
  const body = req.body;
  if (!body || Object.keys(body).length === 0)
    return res.status(400).json({ error: "Request body is empty" });
  try {
    const meta = await getTableMeta(table);
    const cols = Object.keys(body).filter((k) =>
      meta.columns.some((c) => c.Field === k)
    );
    if (cols.length === 0) return res.status(400).json({ error: "No valid columns in body" });
    const placeholders = cols.map(() => "?").join(", ");
    const quotedCols = cols.map((c) => `\`${c}\``).join(", ");
    const values = cols.map((c) => body[c]);
    const [result] = await pool.execute(
      `INSERT INTO \`${table}\` (${quotedCols}) VALUES (${placeholders})`,
      values
    );
    res.status(201).json({ inserted: result.affectedRows, insertId: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/:table/:id", async (req, res) => {
  const { table, id } = req.params;
  if (!TABLE_REGEX.test(table)) return res.status(400).json({ error: "Invalid table name" });
  const body = req.body;
  if (!body || Object.keys(body).length === 0)
    return res.status(400).json({ error: "Request body is empty" });
  try {
    const meta = await getTableMeta(table);
    if (!meta.primaryKey) return res.status(400).json({ error: "Table has no primary key" });
    const cols = Object.keys(body).filter((k) =>
      meta.columns.some((c) => c.Field === k)
    );
    if (cols.length === 0) return res.status(400).json({ error: "No valid columns in body" });
    const setClause = cols.map((c) => `\`${c}\` = ?`).join(", ");
    const values = [...cols.map((c) => body[c]), id];
    const [result] = await pool.execute(
      `UPDATE \`${table}\` SET ${setClause} WHERE \`${meta.primaryKey}\` = ?`,
      values
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Record not found" });
    res.json({ updated: result.affectedRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/:table/:id", async (req, res) => {
  const { table, id } = req.params;
  if (!TABLE_REGEX.test(table)) return res.status(400).json({ error: "Invalid table name" });
  try {
    const meta = await getTableMeta(table);
    if (!meta.primaryKey) return res.status(400).json({ error: "Table has no primary key" });
    const [result] = await pool.execute(
      `DELETE FROM \`${table}\` WHERE \`${meta.primaryKey}\` = ?`,
      [id]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Record not found" });
    res.json({ deleted: result.affectedRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(API_PORT, () => {
  console.log(`API MySQL berjalan di http://localhost:${API_PORT}`);
  console.log(`Database: ${DB_NAME} @ ${DB_HOST}`);
});
