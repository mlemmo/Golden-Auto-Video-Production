# Golden Auto inventory sync

**DealerCenter is the authority** (user, 2026-10-24). Which cars are for sale (status *In Inventory* on the Active
Inventory report) and every detail — year, make, model, trim, drive, exterior colour, mileage, price, description —
come from DealerCenter. Only two things come from **mygoldenauto.net**: each car's photo list (the website gallery
shows DealerCenter's own photos, in their order; DealerCenter's page has no list that can be read) and the car's page
address for ads. The website takes a few hours to show DealerCenter changes, so it is used for nothing else.

Everything is read in Chrome (signed in to DealerCenter and the dashboard), in one tab, with
`tools/inventory-snapshot.js`:

1. **DealerCenter** → Reports → *Active Inventory* (page size 50). Run `step1DealerCenterList()`: it presses **Run**,
   reads the report's own data and, per In Inventory car, its inventory record (drive and dealer fees), using the
   page's sign-in. The advertised price is the vehicle price plus the dealer fees (doc, smog…; added up when the
   record's total is blank), as on the website. Cost, valuation and flooring fields are never read.
2. Same tab → `https://www.mygoldenauto.net/` (wait until it has loaded). Run `step2WebsiteDetails()`: photos and
   page address for each car the website shows; a car it does not show yet is sent with `keep_photos: true`.
3. Same tab → the **staging** dashboard (admin). Run `step3Import()`; the import runs in the background and its change
   log appears under *Inventory changes*. Check it, then sync **production** with the same file:
   `cd /srv/golden-auto && . ubuntu/node/nvm-env.sh && node node/src/cli/dealercenter-sync.js <staging data>/snapshots/<file>.json`
   (back up `private/data/agent.sqlite` first).

Each step returns a summary and a SHA-256 of what it stored, so the hand-over between sites can be checked. If a
script is refused with "Cannot access a chrome-extension:// URL", another browser extension has put a frame over the
page: reload it (window.name survives a reload) and run the step again.

What the sync does with `keep_photos`: a saved car takes DealerCenter's details and keeps its photos; a new car is not
added until it has photos (log: *waiting for photos — not on the website yet*). (`list_only` entries — stock number
only — are still accepted: the car is kept as it was.) A car is hidden only when it is no longer *In Inventory* in
DealerCenter.

Never store DealerCenter credentials, and never put cost or valuation fields in the snapshot.
