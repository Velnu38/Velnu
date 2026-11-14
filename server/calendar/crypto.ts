import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Envelope } from "./types.js";
export const randomSecret = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
}
function key(kid: string): Buffer {
  const keys = JSON.parse(process.env.CALENDAR_TOKEN_KEYS || "{}") as Record<
    string,
    string
  >;
  const k = Buffer.from(keys[kid] || "", "base64");
  if (k.length !== 32) throw new Error("calendar_key_unavailable");
  return k;
}
export function encrypt(value: unknown, context: string): Envelope {
  const kid = process.env.CALENDAR_TOKEN_KEY_ID || "v1",
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(kid), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    kid,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  };
}
export function decrypt<T>(value: Envelope, context: string): T {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(value.kid),
    Buffer.from(value.iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(value.data, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  ) as T;
}
