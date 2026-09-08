import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STANDALONE_ROOT = resolve(ROOT, ".next", "standalone");
const SERVER_PATH = resolve(STANDALONE_ROOT, "server.js");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_MARKER = "SOLO_OS_STANDALONE_DOCX_MARKER";
const SAFE_FAILURE_CODES = new Set(["docx_parse_failed", "docx_parser_unavailable", "extraction_failed"]);
const MAX_BUILD_MS = 15 * 60 * 1000;
const MAX_SERVER_START_MS = 30 * 1000;
const MAX_REQUEST_MS = 30 * 1000;

function boundedError(message) {
  return new Error(message);
}

function runCommand(command, args, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout?.resume();
    child.stderr?.resume();
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      rejectPromise(boundedError("standalone build timed out"));
    }, MAX_BUILD_MS);
    child.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectPromise(boundedError("standalone build could not start"));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else rejectPromise(boundedError("standalone build failed"));
    });
  });
}

async function availablePort() {
  const listener = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    listener.once("error", rejectPromise);
    listener.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = listener.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolvePromise, rejectPromise) => listener.close((error) => error ? rejectPromise(error) : resolvePromise()));
  if (!port) throw boundedError("standalone server port unavailable");
  return port;
}

function terminateChild(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimeout);
      resolvePromise();
    };
    const forceTimeout = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      finish();
    }, 5_000);
    child.once("close", finish);
    child.kill("SIGTERM");
  });
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDocxEntries(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const source = Buffer.from(entry.content, "utf8");
    const compressed = deflateRawSync(source);
    const checksum = crc32(source);
    const local = Buffer.alloc(30 + name.byteLength + compressed.byteLength);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.byteLength, 18);
    local.writeUInt32LE(source.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    compressed.copy(local, 30 + name.byteLength);
    localParts.push(local);

    const central = Buffer.alloc(46 + name.byteLength);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.byteLength, 20);
    central.writeUInt32LE(source.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.byteLength;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function minimalDocx() {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${DOCX_MARKER}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  return zipDocxEntries([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    { name: "word/document.xml", content: documentXml },
    {
      name: "word/_rels/document.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
    },
  ]);
}

async function jsonResponse(response, failureMessage) {
  try {
    return await response.json();
  } catch {
    throw boundedError(failureMessage);
  }
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + MAX_SERVER_START_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw boundedError("standalone server exited during startup");
    try {
      await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(1_000) });
      return;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
  throw boundedError("standalone server did not start");
}

async function postImport(baseUrl, bytes, filename) {
  const formData = new FormData();
  formData.append("flow", "intelligence");
  formData.append("files", new File([bytes], filename, { type: DOCX_MIME }));
  const response = await fetch(`${baseUrl}/api/imports/classify`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(MAX_REQUEST_MS),
  });
  return { response, payload: await jsonResponse(response, "standalone import returned invalid JSON") };
}

function assertSuccessfulImport(response, payload) {
  if (response.status !== 200 || !payload || typeof payload !== "object") throw boundedError("standalone DOCX route failed");
  const result = payload;
  if (result.mode !== "demo" || result.requiresReview !== true || !Array.isArray(result.sources)) throw boundedError("standalone DOCX route returned an unexpected state");
  const extracted = result.sources.some((source) => source && typeof source === "object" && typeof source.extractedText === "string" && source.extractedText.includes(DOCX_MARKER));
  if (!extracted) throw boundedError("standalone DOCX marker was not extracted");
}

function assertMalformedImport(response, payload) {
  if (response.status !== 422 || !payload || typeof payload !== "object" || payload.errorCode !== "no_sources_extracted" || !Array.isArray(payload.failures) || payload.failures.length !== 1) {
    throw boundedError("malformed DOCX route did not return the bounded failure");
  }
  const failure = payload.failures[0];
  if (!failure || typeof failure !== "object" || typeof failure.filename !== "string" || !SAFE_FAILURE_CODES.has(failure.code) || Object.keys(failure).some((key) => key !== "filename" && key !== "code")) {
    throw boundedError("malformed DOCX route returned an unsafe failure shape");
  }
  const serialized = JSON.stringify(payload);
  if (/node_modules|file:\/\/|[A-Za-z]:\\|\/Users\/|\/home\/|(?:Error|TypeError):|at\s+file:/i.test(serialized)) {
    throw boundedError("malformed DOCX route leaked loader detail");
  }
}

async function verifyMammothResolution() {
  const serverUrl = pathToFileURL(SERVER_PATH).href;
  const standaloneRequire = createRequire(serverUrl);
  let entry;
  try {
    entry = standaloneRequire.resolve("mammoth");
  } catch {
    throw boundedError("Mammoth is absent from the standalone artifact");
  }
  if (!entry.startsWith(join(STANDALONE_ROOT, "node_modules"))) throw boundedError("Mammoth resolved outside the standalone artifact");
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(resolve(dirname(entry), "../package.json"), "utf8"));
  } catch {
    throw boundedError("Mammoth package metadata is unavailable");
  }
  if (typeof packageJson.version !== "string" || !packageJson.version) throw boundedError("Mammoth package version is unavailable");
  return packageJson.version;
}

async function main() {
  let phase = "initialization";
  let server;
  try {
    phase = "build";
    console.log("standalone verify: build started");
    await runCommand(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      SOLO_OS_VERIFY_STANDALONE: "true",
    });
    console.log("standalone verify: build passed");

    phase = "artifact";
    const mammothVersion = await verifyMammothResolution();
    console.log(`standalone verify: Mammoth ${mammothVersion}`);

    phase = "server";
    const port = await availablePort();
    server = spawn(process.execPath, [SERVER_PATH], {
      cwd: STANDALONE_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "production",
        SOLO_OS_DEMO_MODE: "true",
        VERCEL_ENV: "preview",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    server.stdout?.resume();
    server.stderr?.resume();
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(baseUrl, server);
    console.log("standalone verify: server started");

    phase = "route";
    const docx = minimalDocx();
    const successful = await postImport(baseUrl, docx, "sealed-marker.docx");
    assertSuccessfulImport(successful.response, successful.payload);
    console.log("standalone verify: DOCX route passed");

    phase = "malformed route";
    const malformed = await postImport(baseUrl, Buffer.from([0x50, 0x4b, 0x03, 0x04]), "malformed.docx");
    assertMalformedImport(malformed.response, malformed.payload);
    console.log("standalone verify: malformed DOCX boundary passed");
    console.log("standalone verify: complete");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown verification failure";
    console.error(`standalone verify: failed (${phase}): ${reason}`);
    process.exitCode = 1;
  } finally {
    await terminateChild(server);
  }
}

await main();
