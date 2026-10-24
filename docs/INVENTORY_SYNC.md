# Golden Auto inventory sync

Which cars are for sale comes from **DealerCenter** (status *In Inventory* on the Active Inventory report). Their
details and photos come from **mygoldenauto.net**, because DealerCenter changes take a few hours to reach the website
and the website blocks this server (Cloudflare). Both are read in Chrome (signed in to DealerCenter and the dashboard),
in one tab, with `tools/inventory-snapshot.js`:

1. **DealerCenter** → Reports → *Active Inventory*; status filter In Inventory + In Recon + Inbound, page size 50,
   press **Run** (the report can show old results until it is run). Run `step1DealerCenterList()`.
   It keeps the *In Inventory* cars only (In Recon and Inbound are not for sale yet) and lists the others.
2. Same tab → `https://www.mygoldenauto.net/` (the homepage lists every car; `/inventory/` redirects there — wait
   until it has loaded). Run `step2WebsiteDetails()`. Each In Inventory car gets
   its details from its website page: year, make, model, trim, drive, colour, mileage, both prices (the page's price
   with dealer fees and the cash price; the sync advertises the highest), description without the page's scripts,
   photos in the gallery's order (the order the photo key was made with, so unchanged photos are not re-imported) and
   the page address. A car the website does not show yet becomes `{ stock, vin, title, list_only: true }`.
3. Same tab → the **staging** dashboard (admin). Run `step3Import()`; the import runs in the background and its
   change log appears under *Inventory changes*. Check it, then sync **production** with the same file:
   `cd /srv/golden-auto && . ubuntu/node/nvm-env.sh && node node/src/cli/dealercenter-sync.js <staging data>/snapshots/<file>.json`
   (back up `private/data/agent.sqlite` first).

Each step returns a summary and a SHA-256 of what it stored, so the hand-over between sites can be checked. If a
script is refused with "Cannot access a chrome-extension:// URL", another browser extension has put a frame over
the page: reload the page (window.name survives a reload) and run the step again.

First run (2026-10-24): DealerCenter 22 cars, 15 In Inventory (7 In Recon / Inbound), all 15 on the website by
then; staging and production imports changed nothing (already current).

What the sync does with a `list_only` car: a saved car stays active with its details as they were (log: *kept as it
was*); a new one is **not** added, because it has no price or photos yet (log: *waiting for details*) — add it from
DealerCenter's vehicle page (Vehicle Info: trim, drive, mileage, All-in Price; Media: photo IDs; Description) or sync
again once the website shows it. A car is hidden only when it is no longer *In Inventory* in DealerCenter.

Never store DealerCenter credentials, and never put cost or valuation fields in the snapshot.
