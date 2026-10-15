/* Cotizador y parser de CSV: funciones puras. */

export interface Quote {
  price: number;
  downPct: number;
  downAmount: number;
  financed: number;
  months: number;
  annualRate: number;
  monthly: number;
}

export function computeQuote(price: number, downPct: number, months: number, annualRate = 0): Quote {
  const p = Math.max(0, price || 0);
  const pct = Math.min(100, Math.max(0, downPct || 0));
  const downAmount = Math.round((p * pct) / 100);
  const financed = p - downAmount;
  const n = Math.max(0, Math.round(months || 0));
  let monthly = 0;
  if (n > 0) {
    const r = (annualRate || 0) / 100 / 12;
    monthly = r > 0 ? (financed * r) / (1 - Math.pow(1 + r, -n)) : financed / n;
  }
  return { price: p, downPct: pct, downAmount, financed, months: n, annualRate: annualRate || 0, monthly: Math.round(monthly) };
}

const mx = (n: number) => "$" + n.toLocaleString("es-MX");

export function quoteText(q: Quote, opts: { leadName?: string; product?: string; brand?: string }) {
  const first = opts.leadName?.split(" ")[0];
  return [
    `${first ? `Hola ${first}, ` : ""}te comparto tu cotización${opts.product ? ` de ${opts.product}` : ""} 📋`,
    ``,
    `• Precio total: ${mx(q.price)}`,
    `• Enganche (${q.downPct}%): ${mx(q.downAmount)}`,
    `• Saldo a financiar: ${mx(q.financed)}`,
    q.months > 0 ? `• Plazo: ${q.months} meses${q.annualRate ? ` (tasa ${q.annualRate}% anual)` : " sin intereses"}` : `• Pago: de contado`,
    q.months > 0 ? `• Mensualidad estimada: *${mx(q.monthly)}*` : null,
    ``,
    `¿Te gustaría apartar tu lugar?${opts.brand ? ` — ${opts.brand}` : ""}`,
  ].filter((l) => l !== null).join("\n");
}

export interface ImportRow {
  name: string;
  phone: string;
  budget: number | null;
  tag: string | null;
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === sep && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseMoney(s: string): number | null {
  const t = s.toLowerCase().replace(/[$\s]/g, "");
  if (!t) return null;
  const m = t.match(/^([\d.,]+)(m|mdp|millones?|k|mil)?$/);
  if (!m) return null;
  let num = m[1]!;
  // "1.200.000" o "1,200,000" → miles; "1.2" con sufijo → decimal
  if (!m[2]) num = num.replace(/[.,](?=\d{3}(\D|$))/g, "");
  num = num.replace(/,/g, ".");
  const v = parseFloat(num);
  if (isNaN(v)) return null;
  const u = m[2] ?? "";
  if (u.startsWith("m") && u !== "mil") return Math.round(v * 1_000_000);
  if (u === "k" || u === "mil") return Math.round(v * 1_000);
  return Math.round(v);
}

const HEAD: Record<string, keyof ImportRow> = {
  nombre: "name", name: "name", cliente: "name", prospecto: "name",
  telefono: "phone", "teléfono": "phone", phone: "phone", celular: "phone", whatsapp: "phone",
  presupuesto: "budget", budget: "budget", monto: "budget",
  etiqueta: "tag", "etiqueta inicial": "tag", tag: "tag", etiquetas: "tag",
};

/** Acepta CSV (coma o punto y coma) o tabla pegada (tabuladores). Encabezado opcional. */
export function parseLeadsTable(text: string): { rows: ImportRow[]; errors: string[] } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lines.length) return { rows: [], errors: [] };
  const first = lines[0]!;
  const sep = first.includes("\t") ? "\t" : first.split(";").length > first.split(",").length ? ";" : ",";
  const headCells = splitLine(first, sep).map((c) => c.toLowerCase());
  const hasHeader = headCells.some((c) => HEAD[c]);
  const order: (keyof ImportRow | null)[] = hasHeader ? headCells.map((c) => HEAD[c] ?? null) : ["name", "phone", "budget", "tag"];
  const rows: ImportRow[] = [];
  const errors: string[] = [];
  lines.slice(hasHeader ? 1 : 0).forEach((line, i) => {
    const cells = splitLine(line, sep);
    const r: ImportRow = { name: "", phone: "", budget: null, tag: null };
    order.forEach((k, j) => {
      const v = cells[j] ?? "";
      if (!k) return;
      if (k === "budget") r.budget = parseMoney(v);
      else if (k === "tag") r.tag = v ? v.toLowerCase().replace(/^#/, "").replace(/\s+/g, "-") : null;
      else r[k] = v;
    });
    if (!r.name) errors.push(`Fila ${i + (hasHeader ? 2 : 1)}: falta el nombre`);
    else rows.push(r);
  });
  return { rows, errors };
}
