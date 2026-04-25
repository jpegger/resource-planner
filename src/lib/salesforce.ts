import "dotenv/config";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import jsforce from "jsforce";
import type { Connection } from "jsforce";

let conn: Connection | null = null;

function sfDebugEnabled(): boolean {
  return process.env.SF_DEBUG === "1";
}

function maskEmailLike(v: string | undefined): string {
  if (!v) return "(missing)";
  const at = v.indexOf("@");
  if (at <= 1) return `${v[0] ?? "?"}***`;
  return `${v[0]}***${v.slice(at)}`;
}

function present(v: string | undefined): string {
  if (!v) return "MISSING";
  return `set (${v.length} chars)`;
}

function base64Url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function buildJwtAssertion(opts: {
  issuer: string;
  subject: string;
  audience: string;
  privateKeyPem: string;
  expiresInSeconds?: number;
}): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (opts.expiresInSeconds ?? 180);

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: opts.issuer,
    sub: opts.subject,
    aud: opts.audience,
    exp,
    iat,
  };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(payload)
  )}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(opts.privateKeyPem);
  return `${signingInput}.${base64Url(signature)}`;
}

async function loginWithRetry(connection: Connection): Promise<void> {
  const username = process.env.SF_USERNAME;
  const password = process.env.SF_PASSWORD;
  const token = process.env.SF_SECURITY_TOKEN;
  const loginUrl = connection.loginUrl;

  if (sfDebugEnabled()) {
    console.log("[salesforce] authMode=password+token");
    console.log(`[salesforce] loginUrl=${loginUrl}`);
    console.log(`[salesforce] SF_USERNAME=${maskEmailLike(username)}`);
    console.log(`[salesforce] SF_PASSWORD=${present(password)}`);
    console.log(`[salesforce] SF_SECURITY_TOKEN=${present(token)}`);
  }

  if (!username || !password || !token) {
    throw new Error(
      "Missing Salesforce env vars. Expected SF_USERNAME, SF_PASSWORD, SF_SECURITY_TOKEN."
    );
  }

  const passwordAndToken = password + token;

  try {
    await connection.login(username, passwordAndToken);
  } catch {
    // Sandbox orgs can sleep; first login may timeout. One retry is usually enough.
    await new Promise((r) => setTimeout(r, 1000));
    await connection.login(username, passwordAndToken);
  }
}

async function loginWithJwtBearerFlow(): Promise<Connection> {
  const loginUrl = process.env.SF_LOGIN_URL ?? "https://login.salesforce.com";
  const clientId = process.env.SF_CLIENT_ID;
  const username = process.env.SF_USERNAME;
  const privateKeyPath = process.env.SF_JWT_PRIVATE_KEY_PATH;

  if (sfDebugEnabled()) {
    console.log("[salesforce] authMode=jwt-bearer");
    console.log(`[salesforce] loginUrl=${loginUrl}`);
    console.log(`[salesforce] SF_CLIENT_ID=${present(clientId)}`);
    console.log(`[salesforce] SF_USERNAME=${maskEmailLike(username)}`);
    console.log(
      `[salesforce] SF_JWT_PRIVATE_KEY_PATH=${privateKeyPath ?? "(missing)"}`
    );
  }

  if (!clientId || !username || !privateKeyPath) {
    throw new Error(
      "Missing Salesforce env vars for JWT. Expected SF_CLIENT_ID, SF_USERNAME, SF_JWT_PRIVATE_KEY_PATH."
    );
  }

  const privateKeyPem = fs.readFileSync(privateKeyPath, { encoding: "utf8" });

  const assertion = buildJwtAssertion({
    issuer: clientId,
    subject: username,
    audience: loginUrl,
    privateKeyPem,
  });

  const oauth2 = new jsforce.OAuth2({ loginUrl, clientId });
  const tokenResponse = await oauth2.requestToken({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const accessToken = tokenResponse.access_token as string | undefined;
  const instanceUrl = tokenResponse.instance_url as string | undefined;
  if (!accessToken || !instanceUrl) {
    throw new Error("JWT login succeeded but access_token/instance_url missing.");
  }

  const connection = new jsforce.Connection({ oauth2, instanceUrl, accessToken, loginUrl });

  if (sfDebugEnabled()) {
    console.log(`[salesforce] instanceUrl=${connection.instanceUrl}`);
    if (connection.userInfo) {
      console.log(`[salesforce] userId=${connection.userInfo.id}`);
      console.log(`[salesforce] organizationId=${connection.userInfo.organizationId}`);
    }
  }

  return connection;
}

export async function getSalesforceConnection(): Promise<Connection> {
  if (conn) return conn;

  if (process.env.SF_JWT_PRIVATE_KEY_PATH) {
    conn = await loginWithJwtBearerFlow();
    return conn;
  }

  const loginUrl = process.env.SF_LOGIN_URL ?? "https://login.salesforce.com";
  conn = new jsforce.Connection({ loginUrl });

  await loginWithRetry(conn);
  return conn;
}

