import { handle } from "@/lib/api";
import { accuracyByYear } from "@/lib/forecasts/accuracy";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const GET = () => handle(() => accuracyByYear(), true);
