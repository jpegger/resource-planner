import { useMemo, useState } from "react";

import { distinctSortedStrings } from "@/lib/utils";

import type { InvestmentsListRow } from "@/lib/investments-list";

function matchesDropdowns(
  p: InvestmentsListRow,
  family: string,
  division: string,
  team: string
): boolean {
  if (family && (p.productFamily ?? "") !== family) return false;
  if (division && (p.division ?? "").trim() !== division) return false;
  if (team && (p.team ?? "").trim() !== team) return false;
  return true;
}

function matchesSearch(p: InvestmentsListRow, q: string): boolean {
  if (!q) return true;
  const hay = [p.name, p.productFamily ?? "", p.division ?? "", p.team ?? ""]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function useInvestmentTableFilters(rows: InvestmentsListRow[]) {
  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");

  const filterOptions = useMemo(
    () => ({
      families: distinctSortedStrings(rows.map((r) => r.productFamily)),
      divisions: distinctSortedStrings(rows.map((r) => r.division)),
      teams: distinctSortedStrings(rows.map((r) => r.team)),
    }),
    [rows]
  );

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (p) =>
        matchesDropdowns(p, familyFilter, divisionFilter, teamFilter) &&
        matchesSearch(p, q)
    );
  }, [rows, search, familyFilter, divisionFilter, teamFilter]);

  return {
    search,
    setSearch,
    familyFilter,
    setFamilyFilter,
    divisionFilter,
    setDivisionFilter,
    teamFilter,
    setTeamFilter,
    filterOptions,
    visibleRows,
  };
}
