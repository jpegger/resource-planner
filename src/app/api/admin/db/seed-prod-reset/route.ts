import { spawn } from "node:child_process";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: unknown) => (stdout += String(d)));
    child.stderr.on("data", (d: unknown) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code: number | null) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

export async function POST(): Promise<Response> {
  try {
    if (process.env["ALLOW_ADMIN_SEED"] !== "1") {
      return NextResponse.json(
        { error: "Seeding is disabled. Set ALLOW_ADMIN_SEED=1 to enable." },
        { status: 403 }
      );
    }

    const repoRoot = process.cwd();
    const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const seedScriptPath = path.join(repoRoot, "scripts", "seed-production.ts");
    const generateScriptPath = path.join(repoRoot, "scripts", "xlsx-to-prod-data-auto.ts");

    const env = {
      ...process.env,
      SEED_PROD_RESET: "1",
      SEED_STRICT_DATASET: "1",
    };

    const input = process.env["PROD_IMPORT_XLSX_PATH"];
    if (!input) {
      return NextResponse.json(
        {
          error:
            'Missing PROD_IMPORT_XLSX_PATH. Set it to the Excel workbook path on the server (e.g. "/data/budget.xlsx").',
        },
        { status: 400 }
      );
    }

    const outDir = "scripts/datasets/prod-import";

    const generate = await run(
      tsxBin,
      [generateScriptPath, "--input", input, "--outDir", outDir],
      repoRoot,
      env
    );
    if (generate.code !== 0) {
      return NextResponse.json(
        { error: "CSV generation failed", code: generate.code, stdout: generate.stdout, stderr: generate.stderr },
        { status: 500 }
      );
    }

    const seed = await run(tsxBin, [seedScriptPath], repoRoot, env);

    if (seed.code !== 0) {
      return NextResponse.json(
        {
          error: "Seed failed",
          code: seed.code,
          stdout: `--- generate ---\n${generate.stdout}\n\n--- seed ---\n${seed.stdout}`,
          stderr: `--- generate ---\n${generate.stderr}\n\n--- seed ---\n${seed.stderr}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        outDir,
        input,
        stdout: `--- generate ---\n${generate.stdout}\n\n--- seed ---\n${seed.stdout}`,
        stderr: `--- generate ---\n${generate.stderr}\n\n--- seed ---\n${seed.stderr}`,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[POST /api/admin/db/seed-prod-reset]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

