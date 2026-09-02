# Lunchval

Beställningsformulär för Business Unit-fredagsluncherna hos Bistrot Lindholmen.
Statisk sajt — HTML/CSS/vanilla JS, ingen byggkedja.

- **`index.html`** — formuläret: välj rätt, namn, allergier.
- **`orders.html`** — "Allas beställningar": antal per rätt, tabell över deltagare
  med allergier flaggade, kopiera/mejla-sammanställning till Bistrot, ta bort/rensa.
- **`lunch-store.js`** — delad datakälla för båda sidorna (se nedan).
- **`menu.json`** — reservmeny om Supabase inte är konfigurerat eller inte har
  data för aktuell vecka.
- **`styles.css`** — Nocturne-designsystemet (tokens + komponentklasser) hämtat
  från designexporten.
- **`supabase/functions/import-menu/`** — Edge Function som hämtar veckans
  fredagsmeny från bistrot.se och sparar den i Supabase, schemalagd måndagar.

Detta är produktionsimplementationen av `Lunchval.dc.html`/`Beställningar.dc.html`
från Claude Design-handoffen (se `chats/` i designbundlen för hela resonemanget
bakom valen).

## Komma igång lokalt

Sidan använder ES-moduler (`import`), så den måste köras via en lokal server —
att öppna `index.html` direkt som en fil (`file://`) fungerar inte.

```
npx serve .
# eller
python3 -m http.server 8080
```

Utan Supabase-konfiguration (se nedan) faller allt tillbaka på `localStorage`:
sidan fungerar direkt, men beställningarna delas inte mellan personer/enheter —
bra för att testa layouten, inte för skarpt bruk med flera deltagare.

## Koppla in Supabase (delad lista för hela BU:n)

1. Skapa ett projekt på [supabase.com](https://supabase.com).
2. Kör SQL:en nedan i SQL-editorn.
3. Fyll i `SUPABASE_URL` och `SUPABASE_ANON_KEY` högst upp i `lunch-store.js`
   (anon-nyckeln är avsedd att ligga i klienten — RLS-policyerna nedan är det
   som begränsar vad den får göra).
4. Committa och pusha — sidan är statisk, så vilken static host som helst
   (GitHub Pages, Netlify, Vercel, S3, …) fungerar.

```sql
create table lunch_orders (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  week        int  not null,
  name        text not null,
  dish        text not null,
  allergies   text default ''
);

alter table lunch_orders enable row level security;

-- alla i nätverket får läsa och lägga till, men bara innan stopptiden
create policy "läs" on lunch_orders for select using (true);
create policy "lägg till" on lunch_orders for insert with check (true);
create policy "ta bort" on lunch_orders for delete using (true);

-- vill du låsa borttagning till en admin: byt sista policyn mot
-- using (auth.role() = 'authenticated')

create table lunch_menu (
  week        int primary key,
  updated_at  timestamptz not null default now(),
  source      text default 'bistrot.se',
  groups      jsonb not null,
  raw         text
);

alter table lunch_menu enable row level security;
create policy "läs meny" on lunch_menu for select using (true);
-- skrivning sker från edge-funktionen med service_role-nyckeln (går förbi RLS)
```

### Stopptid

Anmälan stänger **torsdag kl 13:00** inför kommande fredagslunch — ändra i
`DEADLINE` i `lunch-store.js` om tiden ska flyttas. Veckonumret och listan
nollställs automatiskt varje ny fredag (räknas ut från dagens datum, ingen
manuell justering).

### Veckans meny

Menyn läses i denna ordning: Supabase-tabellen `lunch_menu` för aktuell
ISO-vecka → `menu.json` bredvid sidan. Två sätt att hålla den aktuell:

1. **Automatiskt** — deploya `supabase/functions/import-menu` och schemalägg
   den måndagar kl 10:00 (Europe/Stockholm), t.ex. via Supabase Dashboard →
   Edge Functions → Schedules, eller med `pg_cron`:

   ```sql
   select cron.schedule('import-menu', '0 10 * * 1', $$
     select net.http_post(
       url := 'https://<projekt>.supabase.co/functions/v1/import-menu',
       headers := '{"Authorization":"Bearer <service_role_key>"}'::jsonb
     );
   $$);
   ```

   Deploy: `supabase functions deploy import-menu --no-verify-jwt`

   Obs: skrapningen bygger på bistrot.se:s nuvarande sidstruktur. Ändrar de
   layout ger funktionen 422 och den gamla menyn i `lunch_menu` ligger kvar —
   kolla kolumnen `raw` i tabellen om något ser tomt eller fel ut. Deras
   "Vegetarisk Fre"-rad varierar också i formulering, så stäm av veckans
   vegetariska rätt de första gångerna.
2. **Manuellt** — redigera `menu.json` (eller en rad i `lunch_menu`) direkt.
   Formen är `{ week, groups: [{ title, items: [{ name, desc, tags }] }] }`.
   `name` sparas som beställningens värde, så byt namnet konsekvent på båda
   ställena om en rätt döps om efter att någon redan valt den.
