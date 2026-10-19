import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { CurrentUser } from "@ktv/contracts";

export interface AccessTokenPayload {
  sub: string;
  username: string;
  role: CurrentUser["role"];
}

@Injectable()
export class TokenService {
  readonly accessTokenExpiresInSeconds = 15 * 60;
  readonly refreshTokenExpiresInDays = 30;
  private readonly issuer = "online-ktv-server";
  private readonly audience = "online-ktv-desktop";
  private readonly accessSecret: Uint8Array;

  constructor() {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) throw new Error("JWT_ACCESS_SECRET must contain at least 32 characters");
    this.accessSecret = new TextEncoder().encode(secret);
  }

  async issueAccessToken(user: CurrentUser): Promise<string> {
    return new SignJWT({ username: user.username, role: user.role })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user.id)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTokenExpiresInSeconds}s`)
      .sign(this.accessSecret);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const { payload } = await jwtVerify(token, this.accessSecret, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ["HS256"],
    });
    if (!payload.sub || typeof payload.username !== "string" || typeof payload.role !== "string") {
      throw new Error("Invalid access token payload");
    }
    return { sub: payload.sub, username: payload.username, role: payload.role as CurrentUser["role"] };
  }

  issueRefreshToken(): { token: string; hash: string; expiresAt: Date } {
    const token = randomBytes(48).toString("base64url");
    return {
      token,
      hash: this.hashOpaqueToken(token),
      expiresAt: new Date(Date.now() + this.refreshTokenExpiresInDays * 24 * 60 * 60 * 1000),
    };
  }

  hashOpaqueToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
