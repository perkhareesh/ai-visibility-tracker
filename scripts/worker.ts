import "dotenv/config";
import { log } from "../src/lib/log";
import { startWorkerLoop } from "../src/server/worker";

if (process.env.WORKER_INLINE === "true") log("warn", "WORKER_INLINE=true: the web server also runs a worker; both are safe to run together (SKIP LOCKED)");
startWorkerLoop();
