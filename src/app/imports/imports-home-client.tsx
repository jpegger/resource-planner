"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

type ImportRow = {
  id: string;
  fileName: string;
  year: number;
  rowCount: number;
  warnCount: number;
  createdAt: string;
};

type Config = { snImportMode: string; sfImportMode: string };

async function del(url: string) {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? res.statusText);
  }
}

function ImportTable({
  rows,
  onDelete,
}: {
  rows: ImportRow[];
  onDelete: (id: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          <TableHead>Year</TableHead>
          <TableHead>Rows</TableHead>
          <TableHead>Warnings</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-[70px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="max-w-[200px] truncate text-sm">{r.fileName}</TableCell>
            <TableCell>{r.year}</TableCell>
            <TableCell>{r.rowCount}</TableCell>
            <TableCell>{r.warnCount}</TableCell>
            <TableCell className="text-muted-foreground text-xs">
              {new Date(r.createdAt).toLocaleString()}
            </TableCell>
            <TableCell>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-600"
                onClick={() => onDelete(r.id)}
              >
                Delete
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ImportsHomeClient() {
  const [config, setConfig] = useState<Config | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ts, setTs] = useState<ImportRow[]>([]);
  const [ar, setAr] = useState<ImportRow[]>([]);
  const [inv, setInv] = useState<ImportRow[]>([]);
  const [rev, setRev] = useState<ImportRow[]>([]);

  const [ySn, setYSn] = useState(new Date().getFullYear());
  const [yAr, setYAr] = useState(new Date().getFullYear());
  const [yInv, setYInv] = useState(new Date().getFullYear());
  const [yRev, setYRev] = useState(new Date().getFullYear());

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [c, a, b, d, e] = await Promise.all([
        fetch("/api/imports/config").then((r) => r.json()),
        fetch("/api/imports/timesheets").then((r) => r.json()),
        fetch("/api/imports/ar").then((r) => r.json()),
        fetch("/api/imports/invoices").then((r) => r.json()),
        fetch("/api/imports/revenue").then((r) => r.json()),
      ]);
      setConfig(c as Config);
      setTs(a as ImportRow[]);
      setAr(b as ImportRow[]);
      setInv(d as ImportRow[]);
      setRev(e as ImportRow[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (url: string, file: File, year: number) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("year", String(year));
    const res = await fetch(url, { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as { error?: string }).error ?? res.statusText);
    return j;
  };

  const syncSn = async () => {
    const res = await fetch("/api/imports/timesheets/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: ySn }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as { error?: string }).error ?? res.statusText);
    return j;
  };

  const syncSf = async () => {
    const res = await fetch("/api/imports/ar/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: yAr }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as { error?: string }).error ?? res.statusText);
    return j;
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Données réalisées — imports</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          ServiceNow timesheets, Salesforce AR, SAP VIM, SAP client invoices. Mappings:{" "}
          <a className="text-primary underline" href="/imports/mappings">
            /imports/mappings
          </a>
          .
        </p>
      </div>
      {err ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm">{err}</div> : null}
      {config ? (
        <div className="text-muted-foreground text-xs">
          Modes — SN: <strong>{config.snImportMode}</strong> · SF: <strong>{config.sfImportMode}</strong>
        </div>
      ) : null}

      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader>
          <CardTitle>ServiceNow — timesheets</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Year</Label>
              <Input
                type="number"
                className="w-28"
                value={ySn}
                onChange={(e) => setYSn(Number.parseInt(e.target.value, 10) || ySn)}
              />
            </div>
            {config?.snImportMode === "csv" ? (
              <div className="space-y-1">
                <Label>CSV</Label>
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (ev) => {
                    const f = ev.target.files?.[0];
                    if (!f) return;
                    try {
                      await upload("/api/imports/timesheets", f, ySn);
                      await load();
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : "Upload failed");
                    }
                    ev.target.value = "";
                  }}
                />
              </div>
            ) : (
              <Button
                type="button"
                onClick={async () => {
                  try {
                    await syncSn();
                    await load();
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : "Sync failed");
                  }
                }}
              >
                Sync from ServiceNow
              </Button>
            )}
          </div>
          <ImportTable
            rows={ts}
            onDelete={async (id) => {
              if (!confirm("Delete this import and its rows?")) return;
              try {
                await del(`/api/imports/timesheets/${id}`);
                await load();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Delete failed");
              }
            }}
          />
        </CardContent>
      </Card>

      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader>
          <CardTitle>Salesforce — AR</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Year</Label>
              <Input
                type="number"
                className="w-28"
                value={yAr}
                onChange={(e) => setYAr(Number.parseInt(e.target.value, 10) || yAr)}
              />
            </div>
            {config?.sfImportMode === "csv" ? (
              <div className="space-y-1">
                <Label>CSV</Label>
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (ev) => {
                    const f = ev.target.files?.[0];
                    if (!f) return;
                    try {
                      await upload("/api/imports/ar", f, yAr);
                      await load();
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : "Upload failed");
                    }
                    ev.target.value = "";
                  }}
                />
              </div>
            ) : (
              <Button
                type="button"
                onClick={async () => {
                  try {
                    await syncSf();
                    await load();
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : "Sync failed");
                  }
                }}
              >
                Sync from Salesforce
              </Button>
            )}
          </div>
          <ImportTable
            rows={ar}
            onDelete={async (id) => {
              if (!confirm("Delete this import record? (AR lines are keyed by year+line; delete only removes rows tied to this import id where applicable)")) return;
              try {
                await del(`/api/imports/ar/${id}`);
                await load();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Delete failed");
              }
            }}
          />
        </CardContent>
      </Card>

      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader>
          <CardTitle>SAP — VIM supplier invoices</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Year (metadata)</Label>
              <Input
                type="number"
                className="w-28"
                value={yInv}
                onChange={(e) => setYInv(Number.parseInt(e.target.value, 10) || yInv)}
              />
            </div>
            <div className="space-y-1">
              <Label>CSV</Label>
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={async (ev) => {
                  const f = ev.target.files?.[0];
                  if (!f) return;
                  try {
                    await upload("/api/imports/invoices", f, yInv);
                    await load();
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : "Upload failed");
                  }
                  ev.target.value = "";
                }}
              />
            </div>
          </div>
          <ImportTable
            rows={inv}
            onDelete={async (id) => {
              if (!confirm("Delete this import and invoice lines?")) return;
              try {
                await del(`/api/imports/invoices/${id}`);
                await load();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Delete failed");
              }
            }}
          />
        </CardContent>
      </Card>

      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader>
          <CardTitle>SAP — Client invoices (realized revenue)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Filter year (rows must match)</Label>
              <Input
                type="number"
                className="w-28"
                value={yRev}
                onChange={(e) => setYRev(Number.parseInt(e.target.value, 10) || yRev)}
              />
            </div>
            <div className="space-y-1">
              <Label>CSV</Label>
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={async (ev) => {
                  const f = ev.target.files?.[0];
                  if (!f) return;
                  try {
                    await upload("/api/imports/revenue", f, yRev);
                    await load();
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : "Upload failed");
                  }
                  ev.target.value = "";
                }}
              />
            </div>
          </div>
          <ImportTable
            rows={rev}
            onDelete={async (id) => {
              if (!confirm("Delete this import and revenue lines?")) return;
              try {
                await del(`/api/imports/revenue/${id}`);
                await load();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Delete failed");
              }
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
