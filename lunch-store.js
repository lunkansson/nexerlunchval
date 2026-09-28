/* Delad datakälla för lunchsidorna.
 *
 * 1) Fyll i SUPABASE_URL och SUPABASE_ANON_KEY nedan (anon-nyckeln är avsedd att
 *    ligga i klienten – skydda skrivningar med RLS enligt SQL:en i README.md).
 * 2) Utan konfiguration faller allt tillbaka på localStorage, så sidan fungerar
 *    lokalt/i förhandsvisning precis som förut – men delas då inte mellan personer.
 */

export const SUPABASE_URL = "https://izfgfzpftfekcxlcskjo.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_MKONnT3yhsWoafa8827y_Q_6S098boN";
const TABLE = "lunch_orders";
const MENU_TABLE = "lunch_menu";

/* Stopptid: torsdag 13:00 lokal tid för kommande fredagslunch. */
export const DEADLINE = { hour: 13, minute: 0 };

const LOCAL_KEY = "bistrot-lunch-orders-v1";
const configured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const isRemote = configured;

/* — stopptid — */

export function targetFriday(now = new Date()) {
  const d = new Date(now);
  const isFridayBeforeLunch = d.getDay() === 5 && d.getHours() < 14;
  if (!isFridayBeforeLunch) {
    do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 5);
  }
  d.setHours(12, 0, 0, 0);
  return d;
}

export function deadlineFor(now = new Date()) {
  const d = targetFriday(now);
  d.setDate(d.getDate() - 1);
  d.setHours(DEADLINE.hour, DEADLINE.minute, 0, 0);
  return d;
}

export function isLocked(now = new Date()) {
  return now.getTime() > deadlineFor(now).getTime();
}

export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

export function weekLabel(now = new Date()) {
  return "fredag, vecka " + isoWeek(targetFriday(now));
}

export function deadlineLabel(now = new Date()) {
  const d = deadlineFor(now);
  const pad = (n) => String(n).padStart(2, "0");
  return "Torsdag " + pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + " kl " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

/* — data — */

function headers(extra) {
  return Object.assign({
    apikey: SUPABASE_ANON_KEY,
    Authorization: "Bearer " + SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  }, extra || {});
}

function localRead() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; } catch (e) { return []; }
}
function localWrite(rows) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(rows)); } catch (e) {}
  return rows;
}

/* Alla beställningar för den fredag som gäller nu. */
export async function list(now = new Date()) {
  const week = isoWeek(targetFriday(now));
  if (!configured()) return localRead().filter(o => o.week == null || o.week === week);
  const url = SUPABASE_URL + "/rest/v1/" + TABLE +
    "?select=*&week=eq." + week + "&order=created_at.asc";
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error("Kunde inte hämta beställningar (" + res.status + ")");
  return res.json();
}

export async function add({ name, dish, allergies }, now = new Date()) {
  const row = {
    name, dish,
    allergies: allergies || "",
    week: isoWeek(targetFriday(now)),
  };
  if (!configured()) {
    const rows = localRead();
    rows.push(Object.assign({ id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), created_at: new Date().toISOString() }, row));
    localWrite(rows);
    return rows[rows.length - 1];
  }
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + TABLE, {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error("Kunde inte spara valet (" + res.status + ")");
  return (await res.json())[0];
}

export async function remove(id) {
  if (!configured()) return void localWrite(localRead().filter(o => String(o.id) !== String(id)));
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + TABLE + "?id=eq." + encodeURIComponent(id), {
    method: "DELETE", headers: headers(),
  });
  if (!res.ok) throw new Error("Kunde inte ta bort raden (" + res.status + ")");
}

export async function clear(now = new Date()) {
  if (!configured()) {
    const week = isoWeek(targetFriday(now));
    return void localWrite(localRead().filter(o => o.week != null && o.week !== week));
  }
  const week = isoWeek(targetFriday(now));
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + TABLE + "?week=eq." + week, {
    method: "DELETE", headers: headers(),
  });
  if (!res.ok) throw new Error("Kunde inte rensa listan (" + res.status + ")");
}

/* — menyn —
 * Menyn hämtas i tre steg: Supabase-tabellen lunch_menu för aktuell vecka
 * (fylls av edge-funktionen supabase/functions/import-menu varje måndag 10:00),
 * annars menu.json bredvid sidan, annars ingenting. Formen är
 * { week, groups:[{title, items:[{name,desc,tags}]}] }.
 */
export async function menu(now = new Date()) {
  const week = isoWeek(targetFriday(now));
  if (configured()) {
    try {
      const res = await fetch(SUPABASE_URL + "/rest/v1/" + MENU_TABLE +
        "?select=*&week=eq." + week + "&order=updated_at.desc&limit=1", { headers: headers() });
      if (res.ok) {
        const rows = await res.json();
        if (rows.length && rows[0].groups) {
          return { week: rows[0].week, groups: rows[0].groups, source: "supabase", updated: rows[0].updated_at };
        }
      }
    } catch (e) { /* faller igenom till menu.json */ }
  }
  const res = await fetch("menu.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Ingen meny hittades");
  return res.json();
}
