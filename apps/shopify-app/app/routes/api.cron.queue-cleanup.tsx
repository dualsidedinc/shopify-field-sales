import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { pruneCompletedQueueJobs } from "../services/queue/cleanup.server";

const APP_SECRET = process.env.APP_SECRET;

/**
 * Daily QueueJob cleanup endpoint. Triggered by GitHub Actions.
 * Prunes COMPLETED rows older than 30 days, FAILED older than 90 days.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = request.headers.get("x-app-secret");
  if (APP_SECRET && secret !== APP_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const result = await pruneCompletedQueueJobs(now);

  console.log(
    `[QueueCleanup] Deleted ${result.completedDeleted} completed, ${result.failedDeleted} failed`
  );

  return Response.json({
    success: true,
    timestamp: now.toISOString(),
    ...result,
  });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  if (APP_SECRET && secret !== APP_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  return Response.json({
    message: "QueueJob cleanup endpoint. POST to prune completed/failed jobs.",
  });
};
