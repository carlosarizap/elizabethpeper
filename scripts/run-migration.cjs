const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

async function main() {
  const migrationName = process.argv[2];
  if (!migrationName) throw new Error('Indica el nombre de la migración.');

  const migrationDirectory = path.resolve(process.cwd(), 'migrations');
  const migrationPath = path.resolve(migrationDirectory, migrationName);
  if (path.dirname(migrationPath) !== migrationDirectory || path.extname(migrationPath) !== '.sql') {
    throw new Error('La migración debe ser un archivo .sql dentro de migrations.');
  }
  if (!process.env.POSTGRES_URL) throw new Error('Falta POSTGRES_URL.');

  const connectionUrl = new URL(process.env.POSTGRES_URL);
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
    connectionUrl.searchParams.delete(key);
  }

  const client = new Client({
    connectionString: connectionUrl.toString(),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    await client.query(await fs.readFile(migrationPath, 'utf8'));
    console.log(`Migración aplicada: ${migrationName}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
