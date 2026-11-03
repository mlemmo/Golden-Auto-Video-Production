-- The video studio's clients (its dealers), sent by the studio over the signed worker API (2026-11-03), so eShield staff
-- can add them to the portal with one click instead of typing them again. dealer_id: the portal dealer it is linked to
-- (set when staff add it, or when the names match); the studio learns the link from the answer and keeps it.
CREATE TABLE studio_clients (
  client_id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  website VARCHAR(255) NULL,
  city VARCHAR(80) NULL,
  state VARCHAR(40) NULL,
  phone VARCHAR(40) NULL,
  car_count INT UNSIGNED NULL,
  dealer_id BIGINT UNSIGNED NULL UNIQUE,
  gone_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE SET NULL
);
