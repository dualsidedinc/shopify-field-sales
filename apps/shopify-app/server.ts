import { createRequestHandler } from "@react-router/express";
import express from "express";

const app = express();

// Health check endpoint - responds before React Router
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Serve static assets
app.use(express.static("build/client"));

// React Router handler for all other routes
app.all(
  "*",
  createRequestHandler({
    build: () => import("./build/server/index.js"),
  })
);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
