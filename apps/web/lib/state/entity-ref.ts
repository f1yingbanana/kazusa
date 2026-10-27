export const ENTITY_KINDS = ["character", "chat", "place"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface EntityRef {
  readonly kind: EntityKind;
  readonly id: string;
}

export function serializeEntityRef(ref: EntityRef) {
  return `${ref.kind}:${ref.id}`;
}

/** Splits on the FIRST colon: ids such as `user:you` or `group:club` contain colons. */
export function parseEntityRef(value: string | null | undefined): EntityRef | null {
  if (!value) return null;
  const index = value.indexOf(":");
  if (index <= 0 || index === value.length - 1) return null;
  const kind = value.slice(0, index);
  if (!(ENTITY_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as EntityKind, id: value.slice(index + 1) };
}

export function sameEntity(a: EntityRef | null, b: EntityRef | null) {
  return a?.kind === b?.kind && a?.id === b?.id;
}
