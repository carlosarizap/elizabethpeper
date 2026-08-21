// src/lib/db.ts
import { Pool } from 'pg';
import { withoutPostgresSslQueryParameters } from './postgres-ssl';

const rawConnectionString = process.env.POSTGRES_URL;
const connectionString = rawConnectionString
  ? withoutPostgresSslQueryParameters(rawConnectionString)
  : undefined;

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
});

export default pool;
