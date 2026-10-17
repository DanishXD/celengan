"""Normalizer tests: rules-first canonicalization with fuzzy fallback."""

from __future__ import annotations

import datetime as dt

from app.engine.models import Txn
from app.engine.normalizer import clean_description, normalize_txn


def _txn(desc: str) -> Txn:
    return Txn(id="X", date=dt.date(2026, 1, 1), description=desc, amount=-1.0)


def test_clean_description_strips_noise() -> None:
    assert clean_description("NETFLIX.COM 8555731") == "NETFLIX"
    cleaned = clean_description("SPFTR MUSIC REBILL 9923171")
    assert "REBILL" not in cleaned and "SPFTR" in cleaned


def test_rules_resolve_known_merchants() -> None:
    cases = {
        "NETFLIX .COM REBILL 8555731": "Netflix",
        "NETFLIXCOM REBILL 8555731": "Netflix",
        "SPFTR MUSIC REBILL 9923171": "Spotify",
        "STREAMVIBE SUBSCRIPTION": "StreamVibe",
        "STATE BANK MONTHLY MAINT FEE": "State Bank (Fees)",
        "CARD LATE PENALTY FEE": "Card Penalty (Fees)",
        "GYM FLOW BILLING CH12": "GymFlow",
        "PAYROLL - CAFE MOCHA BEAN": "Cafe Mocha Bean (Payroll)",
        "REMIT WORLDWIDE REMITTANCE": "Worldwide Remittance",
        "SUNSET ROOMS RENT CO": "Sunset Rooms (Rent)",
        "ARROWMARKET ORD": "Arrowmarket",
    }
    for raw, expected in cases.items():
        txn = _txn(raw)
        normalize_txn(txn)
        assert txn.merchant == expected, f"{raw!r} -> {txn.merchant}, want {expected}"


def test_fuzzy_fallback() -> None:
    txn = _txn("NETFLIX COM REBILL ZONE A9")
    normalize_txn(txn)
    assert txn.merchant == "Netflix"


def test_unknown_merchant_gets_pseudo_name() -> None:
    txn = _txn("ZWAKY ZUMBA SHOP 4412")
    normalize_txn(txn)
    assert txn.merchant is not None and txn.merchant != "Netflix"
