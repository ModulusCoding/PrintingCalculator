type StoredSnapshot = {
  schema_version?: unknown;
  source?: unknown;
  manual_input_references?: unknown;
};

export function isManualPricingSnapshot(snapshot: StoredSnapshot) {
  return String(snapshot.schema_version) === "3" && snapshot.source === "manual";
}

/** Historical labels come exclusively from the saved snapshot, never live sources. */
export function PricingSnapshotSources({ snapshot }: { snapshot: StoredSnapshot }) {
  if (!isManualPricingSnapshot(snapshot)) return null;
  const references = snapshot.manual_input_references;
  if (!references || typeof references !== "object") return null;
  const refs = references as Record<string, unknown>;
  const names = (value: unknown) => Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
  const spools = names(refs.spool_names);
  const packaging = names(refs.packaging_names);
  // Older V3 snapshots do not contain packaging_units; names remain usable.
  const units = Array.isArray(refs.packaging_units) ? refs.packaging_units : [];
  return <div className="text-sm">
    <p>Filamentos manuais: {spools.join(", ") || "nenhum"}</p>
    <p>Embalagens manuais: {packaging.map((name, index) => typeof units[index] === "string" ? `${name} (${units[index]})` : name).join(", ") || "nenhuma"}</p>
  </div>;
}
