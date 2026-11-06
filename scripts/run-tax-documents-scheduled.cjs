const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const argumentsSet = new Set(process.argv.slice(2));
const dryRun = argumentsSet.has('--dry-run');
const force = argumentsSet.has('--force');
const projectRoot = path.resolve(__dirname, '..');
const automationRoot = path.join(projectRoot, 'tmp', 'tax-document-automation');
const logDirectory = path.join(automationRoot, 'logs');
const stateFile = path.join(automationRoot, 'state.json');
const lockFile = path.join(automationRoot, 'run.lock');
const runTimestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
const logFile = path.join(logDirectory, `run-${runTimestamp}.log`);
const serverOutputFile = path.join(logDirectory, `next-${runTimestamp}.out.log`);
const serverErrorFile = path.join(logDirectory, `next-${runTimestamp}.err.log`);
const historicalSyncEndpoints = [
  ['/api/mercadolibre/orders?mode=returns&days=60', 'Mercado Libre'],
  ['/api/falabella/orders?mode=returns&days=60', 'Falabella'],
  ['/api/ripley/orders?mode=returns&days=60', 'Ripley'],
  ['/api/paris/orders?mode=returns&days=60', 'Paris'],
  ['/api/walmart/orders?mode=returns&days=60', 'Walmart'],
  ['/api/shopify/orders?mode=returns&days=60', 'Shopify'],
];

fs.mkdirSync(logDirectory, { recursive: true });

function localDate(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localTimestamp(value = new Date()) {
  return `${localDate(value)} ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:${String(value.getSeconds()).padStart(2, '0')}`;
}

function log(message) {
  const line = `[${localTimestamp()}] ${message}`;
  fs.appendFileSync(logFile, `${line}\n`, 'utf8');
  process.stdout.write(`${line}\n`);
}

function dotenvValue(name) {
  for (const fileName of ['.env.local', '.env']) {
    const envPath = path.join(projectRoot, fileName);
    if (!fs.existsSync(envPath)) continue;

    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=(.*)$`));
      if (!match) continue;

      let value = match[1].trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  }
  throw new Error(`Falta configurar ${name} en .env.local o .env.`);
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  if (fs.existsSync(lockFile)) {
    const existingPid = Number(fs.readFileSync(lockFile, 'utf8').trim());
    if (Number.isInteger(existingPid) && existingPid > 0 && processIsRunning(existingPid)) {
      return false;
    }
    fs.rmSync(lockFile, { force: true });
  }

  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch (error) {
    if (error && error.code === 'EEXIST') return false;
    throw error;
  }
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('No fue posible reservar un puerto local.'));
        else resolve(port);
      });
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer(baseUrl, serverProcess) {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`El servidor local terminó antes de estar disponible. Revisa ${serverErrorFile}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/login`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return;
    } catch {
      // Next.js todavía está iniciando o compilando la ruta.
    }
    await delay(2000);
  }
  throw new Error(`El servidor local no estuvo disponible dentro de tres minutos. Revisa ${serverErrorFile}.`);
}

function responseCookie(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}

async function request(baseUrl, cookie, name, method, requestPath) {
  log(`Iniciando: ${name}.`);
  const response = await new Promise((resolve, reject) => {
    const request = http.request(`${baseUrl}${requestPath}`, {
      method,
      headers: cookie ? { cookie } : undefined,
    }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.on('end', () => resolve({
        ok: incoming.statusCode >= 200 && incoming.statusCode < 300,
        status: incoming.statusCode,
        contentType: incoming.headers['content-type'] || '',
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.setTimeout(4 * 60 * 60 * 1000, () => {
      request.destroy(new Error(`${name} excedió el límite de cuatro horas.`));
    });
    request.on('error', reject);
    request.end();
  });
  const body = response.contentType.includes('application/json')
    ? JSON.parse(response.text)
    : response.text;
  if (!response.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`${name} respondió HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  log(`Completado: ${name}.`);
  return body;
}

function requireSuccessfulMarketplaceSync(name, payload) {
  if (payload?.success === true) return;

  const failures = Array.isArray(payload?.results)
    ? payload.results
      .filter((result) => result?.ok !== true)
      .map((result) => {
        const path = result?.path || 'marketplace desconocido';
        const status = result?.status ? ` HTTP ${result.status}` : '';
        const error = result?.error ? `: ${result.error}` : '';
        return `${path}${status}${error}`;
      })
    : [];
  const detail = failures.length > 0
    ? ` Fallaron: ${failures.join(', ')}.`
    : '';
  throw new Error(`${name} no terminó correctamente.${detail}`);
}

function requireSuccessfulMarketplacePayload(name, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`${name} no devolvió una respuesta válida.`);
  }

  const failedResults = Array.isArray(payload.results)
    ? payload.results.filter(
      (result) => result?.success === false || Boolean(result?.error),
    )
    : [];
  if (failedResults.length > 0) {
    throw new Error(`${name} informó ${failedResults.length} orden(es) con error.`);
  }

  const returnCheckStatus = payload.returnChecks?.status;
  if (
    returnCheckStatus &&
    !['completed', 'not_requested'].includes(returnCheckStatus)
  ) {
    throw new Error(
      `${name} dejó la revisión de devoluciones en estado ${returnCheckStatus}.`,
    );
  }
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });
}

async function main() {
  const now = new Date();
  const today = localDate(now);
  const allowedDays = new Set([1, 2, 3, 4, 5]); // lunes a viernes

  if (!force && !dryRun && !allowedDays.has(now.getDay())) {
    log('Hoy no es un día hábil de lunes a viernes; no corresponde ejecutar.');
    return;
  }

  if (!force && !dryRun && fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (state.lastSuccessDate === today) {
        log('El proceso ya terminó correctamente hoy; no se repetirá.');
        return;
      }
    } catch {
      log('No fue posible leer el estado anterior; se continuará con las validaciones.');
    }
  }

  if (!acquireLock()) {
    log('Ya existe otra ejecución activa; esta instancia finalizará.');
    return;
  }

  let serverProcess;
  let outputHandle;
  let errorHandle;
  try {
    const nextCli = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
    if (!fs.existsSync(nextCli)) {
      throw new Error('No se encontró Next.js. Ejecuta npm install antes de usar la automatización.');
    }

    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    outputHandle = fs.openSync(serverOutputFile, 'a');
    errorHandle = fs.openSync(serverErrorFile, 'a');
    log(`Iniciando servidor local en el puerto ${port}.`);
    serverProcess = spawn(process.execPath, [
      nextCli,
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ], {
      cwd: projectRoot,
      windowsHide: true,
      env: { ...process.env, SII_KEEP_BROWSER_OPEN: 'false' },
      stdio: ['ignore', outputHandle, errorHandle],
    });

    await waitForServer(baseUrl, serverProcess);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: dotenvValue('APP_USERNAME'),
        password: dotenvValue('APP_PASSWORD'),
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!loginResponse.ok) {
      throw new Error(`No fue posible iniciar la sesión local (HTTP ${loginResponse.status}).`);
    }
    const cookie = responseCookie(loginResponse);
    if (!cookie) throw new Error('La sesión local no devolvió una cookie válida.');
    log('Sesión local iniciada correctamente.');

    if (dryRun) {
      const stats = await request(
        baseUrl,
        cookie,
        'validación de la cola tributaria',
        'GET',
        `/api/orders/stats?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
      );
      log(`Prueba terminada sin emitir documentos. Cola actual: ${stats.documents.documentos_pendientes} documentos y ${stats.documents.notas_credito_pendientes} notas de crédito.`);
      return;
    }

    const recentSync = await request(
      baseUrl,
      cookie,
      'sincronización de órdenes recientes',
      'GET',
      '/api/cron/orders',
    );
    requireSuccessfulMarketplaceSync(
      'La sincronización de órdenes recientes',
      recentSync,
    );

    const historicalSyncResults = await Promise.all(
      historicalSyncEndpoints.map(async ([endpoint, marketplace]) => {
        const name = `sincronización histórica de ${marketplace}`;
        const payload = await request(baseUrl, cookie, name, 'GET', endpoint);
        requireSuccessfulMarketplacePayload(name, payload);
        return payload;
      }),
    );
    log(
      `Sincronización histórica terminada para ${historicalSyncResults.length} marketplaces.`,
    );

    await request(
      baseUrl,
      cookie,
      'facturación, boletas y carga a marketplaces',
      'POST',
      '/api/invoices',
    );
    await request(
      baseUrl,
      cookie,
      'notas de crédito',
      'POST',
      '/api/credit-notes',
    );

    fs.writeFileSync(stateFile, JSON.stringify({
      lastSuccessDate: today,
      completedAt: new Date().toISOString(),
    }, null, 2));
    log('Proceso tributario programado terminado correctamente.');
  } finally {
    stopProcessTree(serverProcess);
    if (outputHandle !== undefined) fs.closeSync(outputHandle);
    if (errorHandle !== undefined) fs.closeSync(errorHandle);
    fs.rmSync(lockFile, { force: true });
    if (serverProcess) log('Servidor local detenido.');
  }
}

main().catch((error) => {
  log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
