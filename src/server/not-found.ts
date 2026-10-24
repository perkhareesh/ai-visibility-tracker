import { notFound } from "next/navigation";
import { NotFoundError } from "./services/brands";

/** Map a missing or other-workspace resource to a real 404 page. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}
