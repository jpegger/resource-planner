"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function OwnershipNav({
  divisions,
  subDivisions,
  teams,
  owners,
  division,
  subdivision,
  team,
  owner,
  onChangeDivision,
  onChangeSubdivision,
  onChangeTeam,
  onChangeOwner,
}: {
  divisions: string[];
  subDivisions: string[];
  teams: string[];
  owners: string[];
  division: string;
  subdivision: string;
  team: string;
  owner: string;
  onChangeDivision: (v: string) => void;
  onChangeSubdivision: (v: string) => void;
  onChangeTeam: (v: string) => void;
  onChangeOwner: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
      <div className="md:col-span-3">
        <Label>Division</Label>
        <Select value={division} onValueChange={(v) => onChangeDivision(v ?? "")}>
        <SelectTrigger className="mt-1 w-full min-w-0">
          <SelectValue placeholder="All">
            {(v) => (v == null || v === "" ? "All" : String(v))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All</SelectItem>
          {divisions.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="md:col-span-3">
        <Label>Sub-division</Label>
        <Select value={subdivision} onValueChange={(v) => onChangeSubdivision(v ?? "")}>
        <SelectTrigger className="mt-1 w-full min-w-0">
          <SelectValue placeholder="All">
            {(v) => (v == null || v === "" ? "All" : String(v))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All</SelectItem>
          {subDivisions.map((sd) => (
              <SelectItem key={sd} value={sd}>
                {sd}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="md:col-span-3">
        <Label>Team</Label>
        <Select value={team} onValueChange={(v) => onChangeTeam(v ?? "")}>
        <SelectTrigger className="mt-1 w-full min-w-0">
          <SelectValue placeholder="All">
            {(v) => (v == null || v === "" ? "All" : String(v))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All</SelectItem>
          {teams.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="md:col-span-3">
        <Label>Owner</Label>
        <Select value={owner} onValueChange={(v) => onChangeOwner(v ?? "")}>
        <SelectTrigger className="mt-1 w-full min-w-0">
          <SelectValue placeholder="All">
            {(v) => (v == null || v === "" ? "All" : String(v))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All</SelectItem>
          {owners.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

