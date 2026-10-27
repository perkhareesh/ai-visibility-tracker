export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.WORKER_INLINE === "true" && !process.env.VERCEL) {
    const { startWorkerLoop } = await import("./server/worker");
    startWorkerLoop();
  }
}
