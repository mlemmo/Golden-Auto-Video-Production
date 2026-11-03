-- Only cars that have been ordered are kept (Sawyer, 2026-11-03). A dealer's website is read live when they open the
-- Cars page (lib/listing.js) and nothing is saved until they order; then the car and its photos are stored with the
-- order. Website pulls, "not on your website anymore" and kept customer edits go away with it.
DROP TABLE website_pulls;

DELETE FROM vehicles WHERE id NOT IN (SELECT vehicle_id FROM (SELECT DISTINCT vehicle_id FROM orders WHERE vehicle_id IS NOT NULL) AS ordered);

ALTER TABLE vehicles
  DROP COLUMN customer_edits_json,
  DROP COLUMN missing_since;

-- Photos uploaded while filling in an order belong to the dealer until the order is placed (vehicle_id NULL), then to
-- the ordered car. Unattached uploads older than a day are deleted.
ALTER TABLE vehicle_photos
  DROP FOREIGN KEY vehicle_photos_ibfk_1;
ALTER TABLE vehicle_photos
  MODIFY vehicle_id BIGINT UNSIGNED NULL,
  ADD COLUMN dealer_id BIGINT UNSIGNED NULL AFTER vehicle_id,
  ADD COLUMN uploaded_by BIGINT UNSIGNED NULL AFTER dealer_id,
  ADD KEY by_dealer_draft (dealer_id, vehicle_id, created_at),
  ADD CONSTRAINT vehicle_photos_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  ADD CONSTRAINT vehicle_photos_dealer FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE;
UPDATE vehicle_photos p JOIN vehicles v ON v.id = p.vehicle_id SET p.dealer_id = v.dealer_id;
