"""Column types shared by every Accounts model.

Money is stored as exact NUMERIC(18,2) — a ledger must never drift by a
paisa the way binary Float does (0.1 + 0.2 != 0.3). asdecimal=False hands the
value back to Python as a float so existing arithmetic keeps working; every
service function rounds to 2 places before writing, and the database column
then stores that rounded value exactly."""
from sqlalchemy import Numeric

Money = Numeric(18, 2, asdecimal=False)
Quantity = Numeric(18, 4, asdecimal=False)
Rate = Numeric(18, 4, asdecimal=False)
Percent = Numeric(7, 3, asdecimal=False)
