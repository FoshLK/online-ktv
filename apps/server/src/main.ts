import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { AppModule } from "./app.module.js";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configuredOrigins = (process.env.CLIENT_ORIGINS ?? "http://localhost:1420,http://localhost:1421")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origins = [...new Set([...configuredOrigins, "http://tauri.localhost", "tauri://localhost"])];

  app.setGlobalPrefix("api");
  app.enableCors({ origin: origins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.SERVER_HOST ?? "0.0.0.0";
  await app.listen(port, host);
  console.info(`[server] API listening on http://${host}:${port}/api`);
}

await bootstrap();
