import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { getIntegrationCryptoEnv } from "@/lib/env";

function getEncryptionKey() {
  const env = getIntegrationCryptoEnv();
  return createHash("sha256").update(env.INTEGRATION_TOKEN_SECRET).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const key = getEncryptionKey();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string) {
  const [ivB64, authTagB64, encryptedB64] = payload.split(":");

  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error("Invalid encrypted secret payload.");
  }

  const key = getEncryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
