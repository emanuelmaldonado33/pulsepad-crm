/**
 * Cliente Supabase falso para pruebas de servidor. Cada consulta termina en `respond`,
 * que recibe la tabla, la operación, el payload y los filtros, y devuelve { data, error }.
 */
export type FakeQuery = {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete" | "rpc";
  payload?: unknown;
  filters: [string, ...unknown[]][];
  order?: [string, unknown];
  limit?: number;
  single?: "single" | "maybeSingle";
};

export type FakeResult = { data?: unknown; error?: { message: string; code?: string } | null };

export function fakeSupabase(respond: (q: FakeQuery) => FakeResult | undefined) {
  const calls: FakeQuery[] = [];
  const run = (q: FakeQuery) => {
    calls.push(q);
    const r = respond(q) ?? {};
    return { data: r.data ?? null, error: r.error ?? null };
  };
  const builder = (table: string) => {
    const q: FakeQuery = { table, op: "select", filters: [] };
    const chain: Record<string, unknown> = {};
    const filter =
      (name: string) =>
      (...args: unknown[]) => {
        q.filters.push([name, ...args]);
        return chain;
      };
    for (const f of ["eq", "neq", "in", "is", "lt", "lte", "gt", "gte", "ilike", "or"]) {
      chain[f] = filter(f);
    }
    chain["select"] = () => chain;
    for (const op of ["insert", "update", "upsert"] as const) {
      chain[op] = (payload: unknown) => {
        q.op = op;
        q.payload = payload;
        return chain;
      };
    }
    chain["delete"] = () => {
      q.op = "delete";
      return chain;
    };
    chain["order"] = (column: string, opts: unknown) => {
      q.order = [column, opts];
      return chain;
    };
    chain["limit"] = (n: number) => {
      q.limit = n;
      return chain;
    };
    chain["single"] = () => {
      q.single = "single";
      return Promise.resolve(run(q));
    };
    chain["maybeSingle"] = () => {
      q.single = "maybeSingle";
      return Promise.resolve(run(q));
    };
    chain["then"] = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(run(q)).then(ok, ko);
    return chain;
  };
  const client = {
    from: builder,
    rpc: (name: string, args: unknown) =>
      Promise.resolve(run({ table: name, op: "rpc", payload: args, filters: [] })),
  };
  return { client, calls };
}
