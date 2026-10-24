import { redirect } from "next/navigation";
import { getCtx } from "@/server/session";

export default async function Home() {
  redirect((await getCtx()) ? "/dashboard" : "/login");
}
