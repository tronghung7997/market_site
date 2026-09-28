MAX_ORDER_QUANTITY = 5_000

# Whole text of one manual delivery (every unit of the order, one per line).
# Cookie-carrying accounts run 50-100 KB each, so this allows a few dozen of
# them; the deliver route gets the restock body cap to carry it.
MANUAL_DELIVERY_MAX_LENGTH = 5_000_000
