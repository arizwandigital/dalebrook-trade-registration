import express from "express";
import { createRequestHandler } from "@react-router/express";

const app = express();

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

const build = await import("./build/server/index.js");

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