import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { logger } from '../logger.js';

let pool;

function quoteIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, '``')}\``;
}

async function createDatabaseIfNeeded() {
  const connection = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    multipleStatements: true
  });

  await connection.query(
    `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(config.mysql.database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.end();
}

export async function initDatabase() {
  await createDatabaseIfNeeded();

  pool = mysql.createPool({
    ...config.mysql,
    charset: 'utf8mb4',
    multipleStatements: true
  });

  const schema = await fs.readFile('database/schema.sql', 'utf8');
  await pool.query(schema);
  logger.info({ database: config.mysql.database }, 'MySQL connected and schema ready');
  return pool;
}

export function db() {
  if (!pool) {
    throw new Error('Database has not been initialized');
  }
  return pool;
}
