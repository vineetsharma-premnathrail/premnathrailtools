"""Exact numeric column types for Store valuation (foundation plan §4).

Same definitions as Accounts' `accounts/models/_types.py`: money is
NUMERIC(18,2), rates and quantities NUMERIC(18,4). asdecimal=False hands the
value back as a float so existing arithmetic keeps working; the valuation
engine rounds before writing, and the column then stores that value exactly.
Defined here (not imported from Accounts) so Store does not depend on another
module's internals."""
from sqlalchemy import Numeric

Money = Numeric(18, 2, asdecimal=False)
Quantity = Numeric(18, 4, asdecimal=False)
Rate = Numeric(18, 4, asdecimal=False)
