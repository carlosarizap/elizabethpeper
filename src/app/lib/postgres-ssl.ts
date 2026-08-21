const POSTGRES_SSL_QUERY_PARAMETERS = [
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert',
  'uselibpqcompat',
] as const;

/**
 * node-postgres lets SSL parameters in the connection string replace the
 * explicit `ssl` object supplied to Pool. Remove them so db.ts remains the
 * single source of truth for the PostgreSQL TLS configuration.
 */
export function withoutPostgresSslQueryParameters(
  connectionString: string,
): string {
  const url = new URL(connectionString);

  for (const parameter of POSTGRES_SSL_QUERY_PARAMETERS) {
    url.searchParams.delete(parameter);
  }

  return url.toString();
}
