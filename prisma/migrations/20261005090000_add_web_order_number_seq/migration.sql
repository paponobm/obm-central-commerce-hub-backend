-- Temporary numbers for storefront (web) orders before approval. The OBM
-- number is only assigned when the order is approved and moves to Pending.
CREATE SEQUENCE IF NOT EXISTS web_order_number_seq START WITH 1;
