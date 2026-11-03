-- Dealer details the video app's scripts use (city, phone), editable on the portal by eShield staff and the dealer's
-- owners and admins (2026-11-03). The video app reads them when staff open the dealer's orders.
ALTER TABLE dealers
  ADD COLUMN city VARCHAR(80) NULL AFTER website,
  ADD COLUMN state VARCHAR(40) NULL AFTER city,
  ADD COLUMN phone VARCHAR(40) NULL AFTER state;
