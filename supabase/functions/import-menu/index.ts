/* Supabase Edge Function: import-menu
 *
 * Hämtar lunchmenyn från bistrot.se, plockar ut fredagens rätter, veckans rätt
 * och den vegetariska, och sparar dem i tabellen lunch_menu.
 *
 * Deploy:
 *   supabase functions deploy import-menu --no-verify-jwt
 * Schemalägg måndag 10:00 (Europe/Stockholm) enligt README.md.
 * Kör manuellt: curl -X POST https://<projekt>.supabase.co/functions/v1/import-menu
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOURCE = "https://bistrot.se/";

const TAG_RULES: [RegExp, string][] = [
  [/lax|kolja|f(å|a)ngst|fisk|torsk|sej/i, "Fisk"],
  [/r(ä|a)k|musslor|hummer|skaldjur|krabb/i, "Skaldjur"],
  [/biff|h(ö|o)grev|pannbiff|schnitzel|kyckling|bacon|k(ö|o)tt|fl(ä|a)sk|lamm/i, "Kött"],
];

function tagsFor(text: string): string[] {
  const tags: string[] = [];
  for (const [re, tag] of TAG_RULES) if (re.test(text) && !tags.includes(tag)) tags.push(tag);
  return tags;
}

/** HTML → rader text, med <strong>-rader markerade som rubriker. */
function toLines(html: string) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(strong|b)>/gi, "\n@@")
    .replace(/<\/(strong|b)>/gi, "\n")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&#8212;/g, "–");
  return body.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function parse(html: string) {
  const lines = toLines(html);
  const week = Number(html.match(/vecka\s*(\d{1,2})/i)?.[1] ?? 0);

  const isHeading = (l: string) => l.startsWith("@@");
  const clean = (l: string) => l.replace(/^@@/, "").replace(/^[-–·\s]+|[-–·\s]+$/g, "").trim();

  type Item = { name: string; desc: string; tags: string[] };
  const friday: Item[] = [];
  const veg: Item[] = [];
  const salad: Item[] = [];
  const weekly: Item[] = [];

  // Hitta var fredagsblocket börjar respektive slutar
  const fridayStart = lines.findIndex((l) => /^@?@?fredag$/i.test(clean(l)) || /^fredag\b/i.test(clean(l)));

  const takeDishes = (from: number, to: number, into: Item[]) => {
    for (let i = from; i < to && i < lines.length; i++) {
      if (!isHeading(lines[i])) continue;
      const name = clean(lines[i]);
      if (!name || /^(m(å|a)ndag|tisdag|onsdag|torsdag|fredag|lunch|meny)/i.test(name)) continue;
      if (/dessert/i.test(name)) continue;
      const next = lines[i + 1];
      const desc = next && !isHeading(next) ? clean(next) : "";
      into.push({ name, desc, tags: tagsFor(name + " " + desc) });
    }
  };

  if (fridayStart >= 0) takeDishes(fridayStart + 1, lines.length, friday);

  lines.forEach((l, i) => {
    if (!isHeading(l)) return;
    const name = clean(l);
    const next = lines[i + 1];
    const desc = next && !isHeading(next) ? clean(next) : "";
    const item = () => ({
      name: name.replace(/^(veckans|vegetarisk[a-z]*)\s*[:–-]?\s*/i, "").trim(),
      desc,
      tags: tagsFor(name + " " + desc),
    });
    if (/^veckans/i.test(name)) weekly.push(item());
    else if (/^vegetarisk/i.test(name) && /fre/i.test(name)) {
      const it = item();
      it.tags = ["Vegetariskt"];
      veg.push(it);
    } else if (/caesar/i.test(name)) {
      // Caesarsalladen listas ofta som ett val: kyckling & bacon / räkor
      const variants = desc.split("/")[0] ? desc : "";
      salad.push({ name, desc: variants, tags: tagsFor(name + " " + desc) });
    }
  });

  const groups = [
    { title: "Fredagens rätter", items: friday },
    { title: "Veckans rätt", items: weekly },
    { title: "Vegetariskt", items: veg },
    { title: "Salad", items: salad },
  ].filter((g) => g.items.length > 0);

  return { week, groups, lines };
}

Deno.serve(async () => {
  const html = await (await fetch(SOURCE, { headers: { "User-Agent": "lunchval/1.0" } })).text();
  const { week, groups, lines } = parse(html);

  if (!week || groups.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "Kunde inte tolka menyn", week, groups }), {
      status: 422, headers: { "Content-Type": "application/json" },
    });
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/lunch_menu?on_conflict=week`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      week,
      groups,
      source: SOURCE,
      raw: lines.join("\n"),
      updated_at: new Date().toISOString(),
    }),
  });

  const saved = await res.text();
  return new Response(JSON.stringify({ ok: res.ok, week, dishes: groups.flatMap((g) => g.items.map((i) => i.name)), saved }), {
    status: res.ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});
