// Search parameter checks shared by the routes: anything that does not look right is dropped.
export const iso = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
export const id = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;
export const text = (v: unknown) =>
  typeof v === "string" && v.length < 40 && /^[\w &/-]+$/.test(v) ? v : undefined;
export const month = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}$/.test(v) ? v : undefined;
/** Copy only the defined values (exactOptionalPropertyTypes). */
export const defined = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
