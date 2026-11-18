const express = require("express");
const { PrismaClient } = require("@prisma/client");

const app = express();
const prisma = new PrismaClient();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

app.disable("x-powered-by");

app.use(
  "/assets",
  express.static("build/client/assets", {
    immutable: true,
    maxAge: "1y",
  })
);

app.use(
  express.static("build/client", {
    maxAge: "1h",
  })
);

async function ensureSessionTable() {
  console.log("[DATABASE] Checking Shopify Session table...");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Session" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "shop" TEXT NOT NULL,
      "state" TEXT NOT NULL,
      "isOnline" BOOLEAN NOT NULL DEFAULT false,
      "scope" TEXT,
      "expires" DATETIME,
      "accessToken" TEXT NOT NULL,
      "userId" BIGINT,
      "firstName" TEXT,
      "lastName" TEXT,
      "email" TEXT,
      "accountOwner" BOOLEAN NOT NULL DEFAULT false,
      "locale" TEXT,
      "collaborator" BOOLEAN DEFAULT false,
      "emailVerified" BOOLEAN DEFAULT false,
      "refreshToken" TEXT,
      "refreshTokenExpires" DATETIME
    );
  `);

  console.log("[DATABASE] Shopify Session table ready.");
}

async function startServer() {
  try {
    await ensureSessionTable();

    const { createRequestHandler } = await import(
      "@react-router/express"
    );

    const build = await import(
      "./build/server/index.js"
    );

    app.use(
      createRequestHandler({
        build,
        mode: process.env.NODE_ENV || "production",
      })
    );

    app.listen(PORT, HOST, () => {
      console.log(
        `Dalebrook Trade Registration listening on ${HOST}:${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "Failed to start Dalebrook app:",
      error
    );

    process.exit(1);
  }
}

startServer();

async function shutdown() {
  try {
    await prisma.$disconnect();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);