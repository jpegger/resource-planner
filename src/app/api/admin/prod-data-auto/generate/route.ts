import { spawn } from "node:child_process";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function run(cmd: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

export async function POST(): Promise<Response> {
  try {
    const repoRoot = process.cwd();

    const input =
      process.env["PROD_IMPORT_XLSX_PATH"] ??
      "/mnt/c/Users/jegger/Paradigm/CRPS_Customer Relation Product & Strategy-Budget - Documents/Budget/Paradigm_Financials_Budget_v2.2_16.11.20241.xlsx";
    const outDir = "scripts/datasets/prod-import";

    const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const scriptPath = path.join(repoRoot, "scripts", "xlsx-to-prod-data-auto.ts");

    const { stdout, stderr, code } = await run(tsxBin, [scriptPath, "--input", input, "--outDir", outDir], repoRoot);

    if (code !== 0) {
      return NextResponse.json(
        { error: "Generation failed", code, stdout, stderr },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, input, outDir, stdout, stderr },
      { status: 200 }
    );
  } catch (err) {
    console.error("[POST /api/admin/prod-data-auto/generate]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

