-- Milestone 2 (cars and orders, approved plan 2026-11-03): customers keep their cars here, by form or pulled from their
-- website; photos stay as the website's links (only uploads are stored on the portal); an order freezes the car it is
-- for, and our server copies only that car when staff open the order.

-- Cars: the details the video app's scripts and ads use, where each car came from, and which fields the customer
-- changed by hand (a later website pull or DMS sync leaves those alone). missing_since: a website car the last pull
-- did not find ("not on your website anymore"); the customer keeps or removes it.
ALTER TABLE vehicles
  ADD COLUMN color VARCHAR(60) NULL AFTER trim,
  ADD COLUMN drivetrain VARCHAR(40) NULL AFTER color,
  ADD COLUMN description TEXT NULL AFTER price,
  ADD COLUMN page_url VARCHAR(500) NULL AFTER description,
  ADD COLUMN source ENUM('form','website','dms') NOT NULL DEFAULT 'dms' AFTER status,
  ADD COLUMN customer_edits_json JSON NULL AFTER source,
  ADD COLUMN missing_since DATETIME(3) NULL AFTER last_seen_at,
  DROP COLUMN photos_json;

-- Photos in order: a website photo is only its address (url); an upload is a file in UPLOAD_DIR (file_name) with a
-- small thumbnail (thumb_name). copied_at: our server has the full photo, so the full upload is deleted and the
-- thumbnail stays for the portal's pages.
CREATE TABLE vehicle_photos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vehicle_id BIGINT UNSIGNED NOT NULL,
  position SMALLINT UNSIGNED NOT NULL,
  url VARCHAR(1024) NULL,
  file_name CHAR(44) NULL,
  thumb_name CHAR(44) NULL,
  bytes INT UNSIGNED NULL,
  copied_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY by_vehicle (vehicle_id, position),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
);

-- One video order. vehicle_snapshot_json is the car (with its photo list) as ordered; the video is made from it even if
-- the car changes later. paid_via: 'staff' while staff release orders by hand (Milestone 2), later 'stripe' or
-- 'credits'. claimed_by / studio_ref: the worker that opened it in the video app and where (client and stock number).
CREATE TABLE orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dealer_id BIGINT UNSIGNED NOT NULL,
  vehicle_id BIGINT UNSIGNED NULL,
  product ENUM('ai_video','slideshow') NOT NULL,
  length_s SMALLINT UNSIGNED NOT NULL,
  notes TEXT NULL,
  status ENUM('awaiting_payment','paid','in_progress','ready_for_review','approved','rejected','cancelled') NOT NULL DEFAULT 'awaiting_payment',
  price_cents INT UNSIGNED NULL,
  vehicle_snapshot_json JSON NOT NULL,
  ordered_by BIGINT UNSIGNED NULL,
  paid_via VARCHAR(20) NULL,
  paid_at DATETIME(3) NULL,
  claimed_by VARCHAR(64) NULL,
  claimed_at DATETIME(3) NULL,
  studio_ref VARCHAR(190) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY by_dealer (dealer_id, created_at),
  KEY by_status (status, created_at),
  KEY by_vehicle (vehicle_id),
  FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
  FOREIGN KEY (ordered_by) REFERENCES users(id) ON DELETE SET NULL
);

-- A website pull, done a few pages per request (SiteGround stops long-running work). pages_json: the vehicle pages
-- to read; next_index: the first one not read yet; seen_json: VINs found so far. claimed_until: the request working on
-- the next batch, so two browser tabs never read the same pages at once.
CREATE TABLE website_pulls (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dealer_id BIGINT UNSIGNED NOT NULL,
  started_by BIGINT UNSIGNED NULL,
  website VARCHAR(255) NOT NULL,
  status ENUM('running','done','failed','blocked') NOT NULL DEFAULT 'running',
  message VARCHAR(500) NULL,
  pages_json JSON NULL,
  next_index INT UNSIGNED NOT NULL DEFAULT 0,
  seen_json JSON NULL,
  added INT UNSIGNED NOT NULL DEFAULT 0,
  changed INT UNSIGNED NOT NULL DEFAULT 0,
  gone INT UNSIGNED NOT NULL DEFAULT 0,
  errors_json JSON NULL,
  claimed_until DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY by_dealer (dealer_id, created_at),
  FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE,
  FOREIGN KEY (started_by) REFERENCES users(id) ON DELETE SET NULL
);
