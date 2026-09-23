-- Concurrency-safe order number generation. Postgres sequences hand out a
-- unique, monotonically increasing value per caller with no locking or
-- race conditions, unlike "SELECT MAX(...) + 1" — exactly what's needed
-- for two orders created in the same instant to never collide.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 10001;
