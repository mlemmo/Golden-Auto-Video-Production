-- LotSpotlight portal: the tables from docs/lotspotlight-architecture.md §4, plus sessions (sign-in) and
-- jobs.available_at (retry backoff). Times are UTC (the pool sets time_zone to +00:00).

CREATE TABLE dealers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  website VARCHAR(255) NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Los_Angeles',
  status ENUM('active','paused','closed') NOT NULL DEFAULT 'active',
  dms_type VARCHAR(40) NULL,
  dms_config_json JSON NULL,
  spokesperson_id VARCHAR(80) NULL,
  voice_id VARCHAR(80) NULL,
  brand_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  name VARCHAR(190) NOT NULL DEFAULT '',
  is_staff BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret VARCHAR(255) NULL,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE dealer_users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dealer_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('owner','admin','approver','viewer') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY dealer_user (dealer_id, user_id),
  KEY by_user (user_id),
  FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- One row per signed-in browser; id is the SHA-256 of the cookie value, so a database copy cannot be used to sign in.
CREATE TABLE sessions (
  id CHAR(64) PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  dealer_id BIGINT UNSIGNED NULL,
  csrf CHAR(48) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY by_expiry (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE meta_connections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dealer_id BIGINT UNSIGNED NOT NULL,
  business_id VARCHAR(40) NULL,
  page_id VARCHAR(40) NULL,
  ig_user_id VARCHAR(40) NULL,
  ad_account_id VARCHAR(40) NULL,
  catalog_id VARCHAR(40) NULL,
  pixel_id VARCHAR(40) NULL,
  token_encrypted TEXT NULL,
  token_type ENUM('system_user','user') NULL,
  token_expires_at DATETIME(3) NULL,
  scopes TEXT NULL,
  status ENUM('connected','disconnected','error') NOT NULL DEFAULT 'connected',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY by_dealer (dealer_id),
  FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE
);

CREATE TABLE vehicles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dealer_id BIGINT UNSIGNED NOT NULL,
  vin CHAR(17) NOT NULL,
  stock_no VARCHAR(40) NULL,
  year SMALLINT UNSIGNED NULL,
  make VARCHAR(60) NULL,
  model VARCHAR(80) NULL,
  trim VARCHAR(120) NULL,
  mileage INT UNSIGNED NULL,
  price INT UNSIGNED NULL,
  status ENUM('active','sold','removed') NOT NULL DEFAULT 'active',
  photos_json JSON NULL,
  features_json JSON NULL,
  source_hash CHAR(64) NULL,
  last_seen_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY dealer_vin (dealer_id, vin),
  FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE
);

CREATE TABLE videos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dealer_id BIGINT UNSIGNED NOT NULL,
  vehicle_id BIGINT UNSIGNED NULL,
  kind ENUM('vehicle','price_drop','roundup','brand') NOT NULL DEFAULT 'vehicle',
  script_text TEXT NULL,
  status ENUM('queued','rendering','rendered','verifying','needs_review','approved','rejected','published','failed') NOT NULL DEFAULT 'queued',
  storage_key VARCHAR(255) NULL,
  public_url VARCHAR(1024) NULL,
  duration_s DECIMAL(6,2) NULL,
  inventory_snapshot_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY by_dealer_status (dealer_id, status),
  FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
);

CREATE TABLE verifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  video_id BIGINT UNSIGNED NOT NULL,
  passed BOOLEAN NOT NULL,
  checks_json JSON NULL,
  reviewer_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY by_video (video_id),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 'ping' is the Milestone 1 test job (portal → worker → portal round trip).
CREATE TABLE jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dealer_id BIGINT UNSIGNED NOT NULL,
  type ENUM('render_video','verify_video','sync_inventory','rerender_price_drop','ping') NOT NULL,
  payload_json JSON NULL,
  status ENUM('queued','leased','done','failed') NOT NULL DEFAULT 'queued',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  leased_by VARCHAR(64) NULL,
  lease_expires_at DATETIME(3) NULL,
  result_json JSON NULL,
  error TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY queue (status, type, available_at),
  KEY by_dealer (dealer_id, created_at),
  FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE
);

CREATE TABLE publications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  video_id BIGINT UNSIGNED NOT NULL,
  channel ENUM('facebook','instagram') NOT NULL,
  external_id VARCHAR(64) NULL,
  permalink VARCHAR(1024) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  published_at DATETIME(3) NULL,
  error TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY by_video (video_id),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE TABLE ad_campaigns (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dealer_id BIGINT UNSIGNED NOT NULL,
  meta_campaign_id VARCHAR(40) NULL,
  kind ENUM('prospecting','retargeting','price_drop') NOT NULL,
  special_ad_category VARCHAR(60) NULL,
  daily_budget_cents INT UNSIGNED NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'paused',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY by_dealer (dealer_id),
  FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE
);

CREATE TABLE ads (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ad_campaign_id BIGINT UNSIGNED NOT NULL,
  video_id BIGINT UNSIGNED NULL,
  meta_ad_id VARCHAR(40) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'paused',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (ad_campaign_id) REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE SET NULL
);

CREATE TABLE audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dealer_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  target_type VARCHAR(40) NULL,
  target_id VARCHAR(64) NULL,
  details_json JSON NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY by_dealer (dealer_id, created_at)
);
