from pydantic import BaseModel


class LiquidityForecastBucket(BaseModel):
    bucket: str
    inflows: float
    outflows: float
    net: float
    projected_balance: float


class LiquidityForecastResponse(BaseModel):
    current_cash: float
    buckets: list[LiquidityForecastBucket]
