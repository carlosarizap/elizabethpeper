import pool from "@/app/lib/db";

const APP_ID = process.env.MERCADO_LIBRE_CLIENT_ID!;
const SECRET = process.env.MERCADO_LIBRE_CLIENT_SECRET!;

export async function getValidAccessToken(): Promise<string> {
  const client = await pool.connect();
  console.log("CLIENT_ID:", APP_ID);
  console.log("CLIENT_SECRET:", SECRET);
  try {
    const { rows } = await client.query(`
      SELECT * FROM mercadolibre_tokens
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    if (rows.length === 0) throw new Error("No hay token guardado en la base de datos");

    const tokenRow = rows[0];

    const expirado =
      Date.now() - new Date(tokenRow.updated_at).getTime() > 5.9 * 60 * 60 * 1000;

    if (!expirado) return tokenRow.access_token;

    // Renovar token
    const res = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: APP_ID,
        client_secret: SECRET,
        refresh_token: tokenRow.refresh_token,
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      console.error("Error renovando token:", result);
      throw new Error("No se pudo renovar el access token.");
    }

    const { access_token, refresh_token } = result;

    await client.query(
      `UPDATE mercadolibre_tokens
       SET access_token = $1,
           refresh_token = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [access_token, refresh_token, tokenRow.id]
    );

    return access_token;
  } finally {
    client.release();
  }
}
