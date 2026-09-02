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

1. **Automatiskt** — se "Automatisering (måndagar)" nedan.
2. **Manuellt** — redigera `menu.json` (eller en rad i `lunch_menu`) direkt.
   Formen är `{ week, groups: [{ title, items: [{ name, desc, tags }] }] }`.
   `name` sparas som beställningens värde, så byt namnet konsekvent på båda
   ställena om en rätt döps om efter att någon redan valt den.

## Automatisering (måndagar)

Två saker körs schemalagt varje måndag för det här projektet
(`izfgfzpftfekcxlcskjo`):

- **09:00** — gamla beställningar raderas ur `lunch_orders`. Det här är
  inget appen *behöver* — sidan visar redan bara innevarande veckas rader,
  så listan "börjar om" automatiskt varje fredag oavsett. Raderingen är
  ren datastäd (namn/allergier ligger inte kvar i onödan).
- **10:00** — `import-menu`-funktionen hämtar veckans fredagsmeny från
  bistrot.se och sparar den i `lunch_menu`.

Tiderna är Europe/Stockholm. `pg_cron` kör i UTC, så cron-uttrycken nedan
(`0 6 * * 1` / `0 7 * * 1`) motsvarar 08:00/09:00 svensk sommartid (UTC+2).
**När klockan ställs om till vintertid (sista söndagen i oktober) behöver
de här två jobben justeras en timme framåt** (`0 7 * * 1` / `0 8 * * 1`)
och tillbaka igen på våren — kör `select cron.alter_job(job_id, schedule
:= '...')` med `job_id` från `select * from cron.job;`, eller ta bort och
skapa om jobben.

### 1. Deploya edge-funktionen

Kräver [Supabase CLI](https://supabase.com/docs/guides/cli) inloggad mot
ert konto. Kör från repo-roten:

```
npm install -g supabase   # om du inte redan har CLI:t
supabase login
supabase link --project-ref izfgfzpftfekcxlcskjo
supabase functions deploy import-menu --no-verify-jwt
```

`SUPABASE_URL` och `SUPABASE_SERVICE_ROLE_KEY` finns redan tillgängliga för
funktionen automatiskt — Supabase sätter dem åt dig, inget att konfigurera.

Testa direkt: `curl -X POST https://izfgfzpftfekcxlcskjo.supabase.co/functions/v1/import-menu`
— svaret ska vara `{"ok":true,...}` med veckans rätter.

### 2. Schemalägg båda jobben

I Supabase Dashboard → **SQL Editor**, kör:

```sql
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- rensa förra veckans beställningar, måndag 09:00 (sommartid)
select cron.schedule(
  'lunchval-clear-orders',
  '0 7 * * 1',
  $$ delete from lunch_orders; $$
);

-- hämta veckans meny, måndag 10:00 (sommartid)
select cron.schedule(
  'lunchval-import-menu',
  '0 8 * * 1',
  $$
  select net.http_post(
    url := 'https://izfgfzpftfekcxlcskjo.supabase.co/functions/v1/import-menu',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <KLISTRA IN service_role-nyckeln HÄR>',
      'Content-Type', 'application/json'
    )
  );
  $$
);
```

Hämta `service_role`-nyckeln från **Project Settings → API** (raden under
`anon` `public`) och klistra in den direkt i SQL-editorn — dela den aldrig
någon annanstans (till skillnad från den publika/`anon`-nyckeln i
`lunch-store.js` ger den här full åtkomst förbi RLS).

Kontrollera att båda jobben kört: `select * from cron.job_run_details
order by start_time desc limit 10;` efter nästa måndag.

Vill du ändra tiden på endera jobbet senare:
`select cron.alter_job((select jobid from cron.job where jobname =
'lunchval-import-menu'), schedule := '<nytt uttryck>');`

Obs: skrapningen bygger på bistrot.se:s nuvarande sidstruktur. Ändrar de
layout ger funktionen 422 och den gamla menyn i `lunch_menu` ligger kvar —
kolla kolumnen `raw` i tabellen om något ser tomt eller fel ut. Deras
"Vegetarisk Fre"-rad varierar också i formulering, så stäm av veckans
vegetariska rätt de första gångerna.
