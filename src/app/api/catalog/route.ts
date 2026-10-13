import { NextResponse } from "next/server";
import { catalog, coverage, recipes } from "@/server/catalog";
import { getItems } from "@/server/market";
export async function GET() {
  const live = await getItems().catch(() => null);
  return NextResponse.json({
    items: live?.value ?? catalog,
    coverage,
    recipes,
    warnings: live
      ? []
      : ["Live item metadata unavailable. Using the pinned item dataset."],
  });
}
