"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

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

type AllocationEntity = { id: string; name: string; sapEotpCode: string | null };
type InitiativeRow = { id: string; summary: string; year: number };

type SnProgrammeRow = {
  id: string;
  snProgrammeName: string;
  snProgrammeEotp: string | null;
  allocationEntityId: string | null;
  notes: string | null;
  allocationEntity: { id: string; name: string; sapEotpCode: string | null } | null;
};

type SnProjectRow = {
  id: string;
  snProjectNr: string;
  snProjectName: string | null;
  initiativeId: string | null;
  year: number | null;
  notes: string | null;
  initiative: { id: string; summary: string } | null;
};

type SfProductRow = {
  id: string;
  sfMasterProductName: string;
  sfMasterProductKey: string | null;
  allocationEntityId: string | null;
  notes: string | null;
  allocationEntity: { id: string; name: string; sapEotpCode: string | null } | null;
};

type SapDesignationRow = {
  id: string;
  sapDesignation: string;
  sfProductName: string | null;
  allocationEntityId: string | null;
  notes: string | null;
  allocationEntity: { id: string; name: string; sapEotpCode: string | null } | null;
};

async function del(url: string) {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? res.statusText);
  }
}

export function ImportsMappingsClient() {
  const [entities, setEntities] = useState<AllocationEntity[]>([]);
  const [initiatives, setInitiatives] = useState<InitiativeRow[]>([]);
  const [snProg, setSnProg] = useState<SnProgrammeRow[]>([]);
  const [snProj, setSnProj] = useState<SnProjectRow[]>([]);
  const [sfProd, setSfProd] = useState<SfProductRow[]>([]);
  const [sapDesig, setSapDesig] = useState<SapDesignationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [e, i, p, pr, s, d] = await Promise.all([
        fetch("/api/allocation-entities").then((r) => r.json()),
        fetch("/api/initiatives?take=400").then((r) => r.json()),
        fetch("/api/mappings/sn-programmes").then((r) => r.json()),
        fetch("/api/mappings/sn-projects").then((r) => r.json()),
        fetch("/api/mappings/sf-products").then((r) => r.json()),
        fetch("/api/mappings/sap-designations").then((r) => r.json()),
      ]);
      setEntities(e as AllocationEntity[]);
      setInitiatives(i as InitiativeRow[]);
      setSnProg(p as SnProgrammeRow[]);
      setSnProj(pr as SnProjectRow[]);
      setSfProd(s as SfProductRow[]);
      setSapDesig(d as SapDesignationRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const [newProgName, setNewProgName] = useState("");
  const [newProgAe, setNewProgAe] = useState("");

  const [newProjNr, setNewProjNr] = useState("");
  const [newProjIni, setNewProjIni] = useState("");
  const [newProjYear, setNewProjYear] = useState("");

  const [newSfName, setNewSfName] = useState("");
  const [newSfAe, setNewSfAe] = useState("");

  const [newSapDesignation, setNewSapDesignation] = useState("");
  const [newSapSfProductName, setNewSapSfProductName] = useState("");
  const [newSapAe, setNewSapAe] = useState("");
  const [newSapNotes, setNewSapNotes] = useState("");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Données réalisées — mappings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Liaisons ServiceNow programmes / projets, Salesforce master products, et désignations SAP
          (revenus clients) vers le catalogue produits.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : (
        <>
          <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
            <CardHeader>
              <CardTitle>SN — Programme → produit</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="sn-prog-name">Programme (nom exact SN)</Label>
                  <Input
                    id="sn-prog-name"
                    value={newProgName}
                    onChange={(ev) => setNewProgName(ev.target.value)}
                    placeholder="ex. Production & Delivery Support"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label>Produit</Label>
                  <select
                    className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                    value={newProgAe}
                    onChange={(ev) => setNewProgAe(ev.target.value)}
                  >
                    <option value="">—</option>
                    {entities.map((ae) => (
                      <option key={ae.id} value={ae.id}>
                        {ae.name}
                        {ae.sapEotpCode ? ` (${ae.sapEotpCode})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch("/api/mappings/sn-programmes", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        snProgrammeName: newProgName.trim(),
                        allocationEntityId: newProgAe || null,
                      }),
                    });
                    if (!res.ok) {
                      const j = (await res.json().catch(() => null)) as { error?: string } | null;
                      throw new Error(j?.error ?? res.statusText);
                    }
                    setNewProgName("");
                    setNewProgAe("");
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Save failed");
                  }
                }}
              >
                Add mapping
              </Button>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Programme</TableHead>
                    <TableHead>EOTP (SN)</TableHead>
                    <TableHead>Produit</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snProg.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.snProgrammeName}</TableCell>
                      <TableCell>
                        {row.snProgrammeEotp ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900">
                            {row.snProgrammeEotp}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{row.allocationEntity?.name ?? "—"}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-red-600"
                          title="Delete"
                          onClick={async () => {
                            if (!confirm("Delete this mapping?")) return;
                            try {
                              await del(`/api/mappings/sn-programmes/${row.id}`);
                              await load();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Delete failed");
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
            <CardHeader>
              <CardTitle>SN — Projet → initiative</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="sn-pr-nr">N° projet SN</Label>
                  <Input
                    id="sn-pr-nr"
                    value={newProjNr}
                    onChange={(ev) => setNewProjNr(ev.target.value)}
                    placeholder="PRJ0010754"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label>Initiative</Label>
                  <select
                    className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                    value={newProjIni}
                    onChange={(ev) => setNewProjIni(ev.target.value)}
                  >
                    <option value="">—</option>
                    {initiatives.map((ini) => (
                      <option key={ini.id} value={ini.id}>
                        {ini.id} — {ini.summary.slice(0, 60)}
                        {ini.summary.length > 60 ? "…" : ""} ({ini.year})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sn-pr-y">Année (optionnel)</Label>
                  <Input
                    id="sn-pr-y"
                    value={newProjYear}
                    onChange={(ev) => setNewProjYear(ev.target.value)}
                    placeholder="2025"
                  />
                </div>
              </div>
              <Button
                type="button"
                onClick={async () => {
                  try {
                    const yearRaw = newProjYear.trim();
                    const year =
                      yearRaw === "" ? null : Number.parseInt(yearRaw, 10);
                    if (yearRaw !== "" && !Number.isFinite(year)) {
                      setError("Year must be numeric");
                      return;
                    }
                    const res = await fetch("/api/mappings/sn-projects", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        snProjectNr: newProjNr.trim(),
                        initiativeId: newProjIni || null,
                        year,
                      }),
                    });
                    if (!res.ok) {
                      const j = (await res.json().catch(() => null)) as { error?: string } | null;
                      throw new Error(j?.error ?? res.statusText);
                    }
                    setNewProjNr("");
                    setNewProjIni("");
                    setNewProjYear("");
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Save failed");
                  }
                }}
              >
                Add mapping
              </Button>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Projet</TableHead>
                    <TableHead>Initiative</TableHead>
                    <TableHead>Année</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snProj.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-sm">{row.snProjectNr}</TableCell>
                      <TableCell className="max-w-md truncate text-sm">
                        {row.initiative ? `${row.initiative.id} — ${row.initiative.summary}` : "—"}
                      </TableCell>
                      <TableCell>{row.year ?? "—"}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-red-600"
                          title="Delete"
                          onClick={async () => {
                            if (!confirm("Delete this mapping?")) return;
                            try {
                              await del(`/api/mappings/sn-projects/${row.id}`);
                              await load();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Delete failed");
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
            <CardHeader>
              <CardTitle>Salesforce — Master product → produit</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="sf-name">Master product name</Label>
                  <Input
                    id="sf-name"
                    value={newSfName}
                    onChange={(ev) => setNewSfName(ev.target.value)}
                    placeholder="_M-BackUp Online"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label>Produit</Label>
                  <select
                    className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                    value={newSfAe}
                    onChange={(ev) => setNewSfAe(ev.target.value)}
                  >
                    <option value="">—</option>
                    {entities.map((ae) => (
                      <option key={ae.id} value={ae.id}>
                        {ae.name}
                        {ae.sapEotpCode ? ` (${ae.sapEotpCode})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch("/api/mappings/sf-products", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        sfMasterProductName: newSfName.trim(),
                        allocationEntityId: newSfAe || null,
                      }),
                    });
                    if (!res.ok) {
                      const j = (await res.json().catch(() => null)) as { error?: string } | null;
                      throw new Error(j?.error ?? res.statusText);
                    }
                    setNewSfName("");
                    setNewSfAe("");
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Save failed");
                  }
                }}
              >
                Add mapping
              </Button>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Master product</TableHead>
                    <TableHead>Jira key (SF)</TableHead>
                    <TableHead>Produit</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sfProd.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.sfMasterProductName}</TableCell>
                      <TableCell>
                        {row.sfMasterProductKey ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900">
                            {row.sfMasterProductKey}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{row.allocationEntity?.name ?? "—"}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-red-600"
                          title="Delete"
                          onClick={async () => {
                            if (!confirm("Delete this mapping?")) return;
                            try {
                              await del(`/api/mappings/sf-products/${row.id}`);
                              await load();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Delete failed");
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
            <CardHeader>
              <CardTitle>SAP — Désignation poste → produit</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-muted-foreground text-sm">
                Utilisé quand l’import revenu SAP a un numéro externe (AR) mais la désignation ne
                correspond pas au nom de produit Salesforce. Collez la valeur exacte de la colonne
                « Désignation poste » du fichier ZCOMM_REPORT.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="sap-des">Désignation poste (SAP)</Label>
                  <Input
                    id="sap-des"
                    value={newSapDesignation}
                    onChange={(ev) => setNewSapDesignation(ev.target.value)}
                    placeholder="eSign Framework"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sap-sf-name">Nom produit SF (optionnel)</Label>
                  <Input
                    id="sap-sf-name"
                    value={newSapSfProductName}
                    onChange={(ev) => setNewSapSfProductName(ev.target.value)}
                    placeholder="Libellé AR si connu"
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label>Produit</Label>
                  <select
                    className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                    value={newSapAe}
                    onChange={(ev) => setNewSapAe(ev.target.value)}
                  >
                    <option value="">—</option>
                    {entities.map((ae) => (
                      <option key={ae.id} value={ae.id}>
                        {ae.name}
                        {ae.sapEotpCode ? ` (${ae.sapEotpCode})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="sap-notes">Notes (optionnel)</Label>
                  <Input
                    id="sap-notes"
                    value={newSapNotes}
                    onChange={(ev) => setNewSapNotes(ev.target.value)}
                    placeholder=""
                  />
                </div>
              </div>
              <Button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch("/api/mappings/sap-designations", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        sapDesignation: newSapDesignation.trim(),
                        sfProductName: newSapSfProductName.trim() || null,
                        allocationEntityId: newSapAe || null,
                        notes: newSapNotes.trim() || null,
                      }),
                    });
                    if (!res.ok) {
                      const j = (await res.json().catch(() => null)) as { error?: string } | null;
                      throw new Error(j?.error ?? res.statusText);
                    }
                    setNewSapDesignation("");
                    setNewSapSfProductName("");
                    setNewSapAe("");
                    setNewSapNotes("");
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Save failed");
                  }
                }}
              >
                Add mapping
              </Button>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Désignation SAP</TableHead>
                    <TableHead>Produit SF (réf.)</TableHead>
                    <TableHead>Produit</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sapDesig.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="max-w-[220px] font-medium break-words">
                        {row.sapDesignation}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[180px] break-words text-sm">
                        {row.sfProductName ?? "—"}
                      </TableCell>
                      <TableCell>{row.allocationEntity?.name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground max-w-[160px] break-words text-sm">
                        {row.notes ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-red-600"
                          title="Delete"
                          onClick={async () => {
                            if (!confirm("Delete this mapping?")) return;
                            try {
                              await del(`/api/mappings/sap-designations/${row.id}`);
                              await load();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Delete failed");
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
