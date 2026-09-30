import { timingSafeEqual } from "@std/crypto/timing-safe-equal";
import { encodeHex } from "@std/encoding/hex";

const COOKIE = "pm_session";
const encoder = new TextEncoder();

/**
 * The API can install and remove apps, so every request must prove it comes from our own page:
 * - Host header must be ours (defeats DNS rebinding),
 * - Origin, when sent, must be ours (defeats cross-site requests),
 * - a per-launch secret cookie (HttpOnly, SameSite=Strict) must be present.
 * The secret reaches the browser once through the /login URL printed and opened at startup.
 */
export class Security {
  readonly token = encodeHex(crypto.getRandomValues(new Uint8Array(32)));
  readonly #hosts: Set<string>;
  readonly #origins: Set<string>;

  constructor(port: number) {
    this.#hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    this.#origins = new Set([...this.#hosts].map((host) => `http://${host}`));
  }

  loginUrl(port: number): string {
    return `http://127.0.0.1:${port}/login?token=${this.token}`;
  }

  hostAllowed(request: Request): boolean {
    return this.#hosts.has(request.headers.get("host") ?? "");
  }

  originAllowed(request: Request): boolean {
    const origin = request.headers.get("origin");
    return origin === null || this.#origins.has(origin);
  }

  authenticated(request: Request): boolean {
    const cookie = request.headers.get("cookie") ?? "";
    const value = cookie.split(/;\s*/).find((part) => part.startsWith(`${COOKIE}=`))?.slice(
      COOKIE.length + 1,
    );
    return value !== undefined && this.#matches(value);
  }

  login(url: URL): Response {
    if (!this.#matches(url.searchParams.get("token") ?? "")) {
      return new Response("This link has expired. Use the address printed in the terminal.", { status: 403 });
    }
    return new Response(null, {
      status: 303,
      headers: { location: "/", "set-cookie": `${COOKIE}=${this.token}; HttpOnly; SameSite=Strict; Path=/` },
    });
  }

  #matches(candidate: string): boolean {
    const a = encoder.encode(candidate);
    const b = encoder.encode(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};
