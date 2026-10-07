import { hasDb, loadReference } from "@/lib/db";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const GET = () => handle(async () => ({ db: hasDb(), reference: await loadReference() }));
