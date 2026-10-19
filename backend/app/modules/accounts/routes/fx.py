"""Currencies, exchange rates by date (OB08) and the month-end revaluation
of open foreign-currency items (F.05)."""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access, require_tab_action, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.fx import Currency, ExchangeRate, FxRevaluation, BOOKS_CURRENCY
from app.modules.accounts.models.journal_entry import JournalEntry
from app.modules.accounts.schemas.fx import (
    CurrencyCreate, CurrencyUpdate, ExchangeRateCreate, FxRevaluationCreate, FxRevaluationCancelPayload,
    CurrencyResponse, ExchangeRateResponse, FxRevaluationResponse,
)
from app.modules.accounts.services import fx
from app.modules.accounts.routes._common import write_audit, who, service_errors, require_finance_manager, require_any_accounts_tab

router = APIRouter(prefix="/accounts/fx", tags=["Accounts"])


def _currency_response(c: Currency, db: Session) -> CurrencyResponse:
    r = (db.query(ExchangeRate).filter(ExchangeRate.currency == c.code, ExchangeRate.rate_type == "bank")
         .order_by(ExchangeRate.rate_date.desc()).first())
    return CurrencyResponse.model_validate(c).model_copy(update={"latest_rate": r.rate if r else None,
                                                                 "latest_rate_date": r.rate_date if r else None})


def _run_response(run: FxRevaluation, db: Session) -> FxRevaluationResponse:
    je = db.query(JournalEntry).filter(JournalEntry.id == run.journal_entry_id).first() if run.journal_entry_id else None
    return FxRevaluationResponse.model_validate(run).model_copy(update={"journal_entry_number": je.entry_number if je else None})


@router.get("/currencies", response_model=list[CurrencyResponse])
async def list_currencies(db: Session = Depends(get_db),
                          _user: User = Depends(require_any_accounts_tab("currencies", "purchase_invoices", "sales_invoices", "payments"))):
    return [_currency_response(c, db) for c in db.query(Currency).order_by(Currency.code.asc()).all()]


@router.post("/currencies", response_model=CurrencyResponse, status_code=201)
async def create_currency(payload: CurrencyCreate, db: Session = Depends(get_db),
                          user: User = Depends(require_tab_action("accounts", "currencies", "create"))):
    code = payload.code.strip().upper()
    if len(code) != 3 or not code.isalpha():
        raise HTTPException(status_code=400, detail=f"'{payload.code}' isn't an ISO currency code — use 3 letters, e.g. USD, EUR, JPY.")
    if code == BOOKS_CURRENCY:
        raise HTTPException(status_code=400, detail="INR is the books currency — it needs no entry here.")
    if db.query(Currency).filter(Currency.code == code).first():
        raise HTTPException(status_code=400, detail=f"Currency {code} is already in the master.")
    c = Currency(code=code, name=payload.name.strip(), symbol=payload.symbol, is_active=payload.is_active)
    db.add(c)
    db.flush()
    write_audit(db, "currency", c.id, "created", user, f"{who(user)} added currency {code}.")
    db.commit()
    return _currency_response(c, db)


@router.patch("/currencies/{currency_id}", response_model=CurrencyResponse)
async def update_currency(currency_id: int, payload: CurrencyUpdate, db: Session = Depends(get_db),
                          user: User = Depends(require_tab_action("accounts", "currencies", "edit"))):
    c = db.query(Currency).filter(Currency.id == currency_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Currency not found — reload the page.")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    write_audit(db, "currency", c.id, "updated", user, f"{who(user)} updated currency {c.code}.")
    db.commit()
    return _currency_response(c, db)


@router.get("/rates", response_model=list[ExchangeRateResponse])
async def list_rates(currency: str | None = Query(None), from_date: date | None = Query(None), to_date: date | None = Query(None),
                     db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "currencies"))):
    q = db.query(ExchangeRate)
    if currency:
        q = q.filter(ExchangeRate.currency == currency.upper())
    if from_date:
        q = q.filter(ExchangeRate.rate_date >= from_date)
    if to_date:
        q = q.filter(ExchangeRate.rate_date <= to_date)
    return q.order_by(ExchangeRate.rate_date.desc(), ExchangeRate.currency.asc()).limit(500).all()


@router.post("/rates", response_model=ExchangeRateResponse, status_code=201)
async def set_rate_route(payload: ExchangeRateCreate, db: Session = Depends(get_db),
                         user: User = Depends(require_feature_action("accounts", "currencies", "exchange_rates", "create"))):
    with service_errors(db):
        r = fx.set_rate(db, currency=payload.currency, rate_date=payload.rate_date, rate=payload.rate, rate_type=payload.rate_type,
                        source=payload.source, user_id=user.id)
    write_audit(db, "exchange_rate", r.id, "updated", user,
                f"{who(user)} set the {r.rate_type} rate of {r.currency} on {r.rate_date:%d-%b-%Y} to {r.rate:g}.")
    db.commit()
    return r


@router.get("/rate")
async def rate_lookup(currency: str = Query(...), on: date = Query(...), rate_type: str = Query("bank"), db: Session = Depends(get_db),
                      _user: User = Depends(require_any_accounts_tab("currencies", "purchase_invoices", "sales_invoices", "payments"))):
    """The rate in force on a date — the documents' 'fetch rate' helper."""
    with service_errors(db):
        code = fx.normalise_currency(db, currency)
        return {"currency": code, "on": on, "rate_type": rate_type, "rate": fx.rate_on(db, code, on, rate_type)}


@router.get("/revaluations/preview")
async def revaluation_preview_route(period: str = Query(...), db: Session = Depends(get_db),
                                    _user: User = Depends(require_feature_action("accounts", "currencies", "revaluation", "view"))):
    with service_errors(db):
        return fx.revaluation_preview(db, accounting_period=period)


@router.get("/revaluations", response_model=list[FxRevaluationResponse])
async def list_revaluations(db: Session = Depends(get_db), _user: User = Depends(require_feature_action("accounts", "currencies", "revaluation", "view"))):
    runs = db.query(FxRevaluation).order_by(FxRevaluation.accounting_period.desc(), FxRevaluation.id.desc()).all()
    return [_run_response(r, db) for r in runs]


@router.post("/revaluations", response_model=FxRevaluationResponse, status_code=201)
async def run_revaluation_route(payload: FxRevaluationCreate, db: Session = Depends(get_db),
                                user: User = Depends(require_feature_action("accounts", "currencies", "revaluation", "approve"))):
    require_finance_manager(user, "post the month-end foreign-currency revaluation")
    with service_errors(db):
        run = fx.run_revaluation(db, accounting_period=payload.accounting_period, rates=payload.rates, user_id=user.id)
    write_audit(db, "fx_revaluation", run.id, "posted", user,
                f"{who(user)} posted the FX revaluation for {run.accounting_period} (gain {run.total_gain:,.2f}, loss {run.total_loss:,.2f}).")
    db.commit()
    return _run_response(run, db)


@router.post("/revaluations/{revaluation_id}/cancel", response_model=FxRevaluationResponse)
async def cancel_revaluation_route(revaluation_id: int, payload: FxRevaluationCancelPayload, db: Session = Depends(get_db),
                                   user: User = Depends(require_feature_action("accounts", "currencies", "revaluation", "cancel"))):
    require_finance_manager(user, "cancel a foreign-currency revaluation")
    with service_errors(db):
        run = fx.cancel_revaluation(db, revaluation_id=revaluation_id, reason=payload.reason, user_id=user.id)
    write_audit(db, "fx_revaluation", run.id, "reversed", user, f"{who(user)} cancelled the FX revaluation for {run.accounting_period}: {payload.reason}")
    db.commit()
    return _run_response(run, db)
