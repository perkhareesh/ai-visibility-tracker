export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.WORKER_INLINE === "true") {
    const { startWorkerLoop } = await import("./server/worker");
    startWorkerLoop();
  }
}
