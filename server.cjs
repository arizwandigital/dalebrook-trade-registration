const express = require("express");

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

async function startServer() {
  try {
    const { createRequestHandler } = await import(
      "@react-router/express"
    );

    const build = await import(
      "./build/server/index.js"
    );

    app.use(
      createRequestHandler({
        build,
        mode:
          process.env.NODE_ENV ||
          "production",
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