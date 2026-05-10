import { prisma } from "@/lib/prisma";
import { extractEotpRoot } from "@/lib/eotp-root";

export type RevenueResolution = {
  arEntryId: string | null;
  allocationEntityId: string | null;
  importWarning: string | null;
  step: 1 | 2 | 3 | 4;
};

/**
 * Resolve a SAP client invoice line to an `ar_entry` and/or `allocation_entity`,
 * following the 4-step priority from design §7.4 and §13.
 *
 *  1. ext_doc_ref + SAP designation match an `ar_entry` (counterpart_reference + sf_product_name)
 *     → set `arEntryId`, inherit `allocationEntityId` from the AR line — no warning
 *  2. ext_doc_ref present but step 1 misses → `sap_designation_mapping` by SAP `designation`.
 *     When `sf_product_name` is set on the mapping, retry AR as step 1 using that name
 *     (same query as step 1: counterpart_reference + sf_product_name). If an AR line
 *     exists → same outcome as step 1 (`arEntryId`, allocation from AR, no warning).
 *     Otherwise → `allocationEntityId` from mapping only (if any) — warning.
 *  3. ext_doc_ref empty → extract root EOTP from `eotp_full`
 *     → look up `eotp_definition.sap_eotp_code` → `allocation_entity` — no warning
 *  4. Nothing resolves → NULL + warning
 */
export async function resolveRevenueEntry(input: {
  extDocRef: string | null;
  designation: string | null;
  eotpFull: string | null;
}): Promise<RevenueResolution> {
  const extDocRef = input.extDocRef?.trim() || null;
  const designation = input.designation?.trim() || null;

  // STEP 1 — AR line item match (current contracts)
  if (extDocRef && designation) {
    const ar = await prisma.arEntry.findFirst({
      where: {
        counterpartReference: extDocRef,
        sfProductName: designation,
      },
      select: { id: true, allocationEntityId: true },
    });
    if (ar) {
      return {
        arEntryId: ar.id,
        allocationEntityId: ar.allocationEntityId ?? null,
        importWarning: null,
        step: 1,
      };
    }
  }

  // STEP 2 — Designation mapping fallback (only when ext_doc_ref is present)
  if (extDocRef) {
    if (designation) {
      const map = await prisma.sapDesignationMapping.findUnique({
        where: { sapDesignation: designation },
        select: { allocationEntityId: true, sfProductName: true },
      });
      if (map) {
        const mappedProductName = map.sfProductName?.trim() || null;
        if (mappedProductName) {
          const arViaMap = await prisma.arEntry.findFirst({
            where: {
              counterpartReference: extDocRef,
              sfProductName: mappedProductName,
            },
            select: { id: true, allocationEntityId: true },
          });
          if (arViaMap) {
            return {
              arEntryId: arViaMap.id,
              allocationEntityId: arViaMap.allocationEntityId ?? null,
              importWarning: null,
              step: 1,
            };
          }
        }
        return {
          arEntryId: null,
          allocationEntityId: map.allocationEntityId ?? null,
          importWarning: mappedProductName
            ? `STEP 2: Mapped designation "${designation}" → SF product "${mappedProductName}" but no AR line for ${extDocRef}`
            : map.allocationEntityId
              ? `STEP 2: AR not matched, allocation from designation map only: ${designation} → ${map.allocationEntityId}`
              : `STEP 2: AR not matched, designation mapped without SF product or allocation: ${designation}`,
          step: 2,
        };
      }
    }
    return {
      arEntryId: null,
      allocationEntityId: null,
      importWarning: `STEP 2: AR not matched, designation not mapped: ${designation ?? "(empty)"}`,
      step: 2,
    };
  }

  // STEP 3 — EOTP fallback (pre-SF contracts, expected — no warning)
  const root = extractEotpRoot(input.eotpFull);
  if (root) {
    const ed = await prisma.eotpDefinition.findFirst({
      where: { sapEotpCode: root },
      select: { id: true },
    });
    if (ed) {
      const ae =
        (await prisma.allocationEntity.findFirst({
          where: { eotpDefinitionId: ed.id },
          select: { id: true },
        })) ??
        (await prisma.allocationEntity.findFirst({
          where: { sapEotpCode: root },
          select: { id: true },
        }));
      if (ae) {
        return {
          arEntryId: null,
          allocationEntityId: ae.id,
          importWarning: null,
          step: 3,
        };
      }
    }
  }

  // STEP 4 — Unresolved
  return {
    arEntryId: null,
    allocationEntityId: null,
    importWarning: `Cannot resolve product: ext_doc_ref=${extDocRef ?? ""} designation=${designation ?? ""} eotp=${input.eotpFull ?? ""}`,
    step: 4,
  };
}
