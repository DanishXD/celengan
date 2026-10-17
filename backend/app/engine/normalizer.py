"""Merchant normalization: rules database first, fuzzy matching fallback.

Deterministic by design. Categories drive detector routing downstream.
"""

from __future__ import annotations

import re

from rapidfuzz import fuzz, process

from .models import Txn

#: (canonical_merchant, category, regex_patterns applied to the cleaned text)
RULES: list[tuple[str, str, tuple[str, ...]]] = [
    ("Cafe Mocha Bean (Payroll)", "income", (r"PAYROLL", r"MOCHA\s*BEAN")),
    ("Worldwide Remittance", "income", (r"REMIT",)),
    ("Sunset Rooms (Rent)", "rent", (r"SUNSET\s*ROOMS", r"\bRENT\b")),
    ("City Power & Water", "utility", (r"POWER", r"WATER", r"UTIL")),
    ("NorthMobile", "phone", (r"NORTHMOBILE",)),
    ("Skynet Cable", "internet", (r"SKYNET", r"INTERNET")),
    ("Netflix", "subscription", (r"NETFLIX",)),
    ("Spotify", "subscription", (r"SPOTIF", r"SPFTR", r"SPTFY")),
    ("GymFlow", "gym", (r"GYM\s*FLOW",)),
    ("CloudDrive", "subscription", (r"CLOUDDRIVE",)),
    ("StreamVibe", "subscription", (r"STREAMVIBE",)),
    ("PixelFlix", "subscription", (r"PIXELFLIX",)),
    ("State Bank (Fees)", "fee", (r"STATE\s*BANK", r"\bMAINT\b")),
    ("Card Penalty (Fees)", "fee", (r"LATE\s*PENALTY", r"PENALTY\s*FEE")),
    ("Freshmart", "grocery", (r"FRESHMART",)),
    ("Greengo Market", "grocery", (r"GREENGO",)),
    ("Pho House", "dining", (r"PHO\s*HOUSE",)),
    ("Burger Junction", "dining", (r"BURGER\s*JUNC",)),
    ("Brew Co Roasters", "dining", (r"BREW\s*CO",)),
    ("Kopi Kopian", "dining", (r"KOPI\s*KOPIAN",)),
    ("CityTrans", "transport", (r"CITYTRANS",)),
    ("Threadvault Apparel", "shopping", (r"THREADVAULT",)),
    ("Gearhaus Sports", "shopping", (r"GEAR\s*HAUS",)),
    ("Arrowmarket", "shopping", (r"ARROW\s*MARKET", r"ARROWMKT")),
    ("MediPlus Pharmacy", "health", (r"MEDIPLUS",)),
]

_CANONICALS = [c for c, _, _ in RULES]
_CATEGORY_BY_CANONICAL = {c: cat for c, cat, _ in RULES}
_COMPILED: list[tuple[str, str, list[re.Pattern[str]]]] | None = None

_TOKEN_NOISE = {
    "REBILL", "CARD", "CHECKCARD", "POS", "PURCHASE", "SUBSCRIPTION",
    "AUTH", "ST", "CH", "HQ", "RECURRING", "BILL", "THE", "DE",
}


def clean_description(raw: str) -> str:
    """Normalize a raw bank description into tidy searchable text."""
    s = raw.upper()
    s = s.replace(".COM", " ")
    s = re.sub(r"\d{4,}", " ", s)          # strip long numeric references
    s = re.sub(r"\s+", " ", s).strip()
    tokens = [
        t for t in s.split(" ")
        if t and t not in _TOKEN_NOISE and (len(t) > 2 or t.upper() in {"PHO"})
    ]
    return " ".join(tokens).strip()


def _compiled() -> list[tuple[str, str, list[re.Pattern[str]]]]:
    global _COMPILED
    if _COMPILED is None:
        _COMPILED = [
            (canonical, category, [re.compile(p) for p in patterns])
            for canonical, category, patterns in RULES
        ]
    return _COMPILED


def resolve_merchant(cleaned: str) -> tuple[str | None, str | None]:
    """Return (merchant, category): exact rules first, then fuzzy fallback."""
    for canonical, category, patterns in _compiled():
        for pattern in patterns:
            if pattern.search(cleaned):
                return canonical, category

    match = process.extractOne(cleaned, _CANONICALS, scorer=fuzz.partial_ratio)
    if match is not None and float(match[1]) >= 87.0:
        canonical = str(match[0])
        return canonical, _CATEGORY_BY_CANONICAL[canonical]

    # Unknown merchant: keep a readable pseudo-name from the leading tokens.
    pseudo = " ".join(cleaned.split(" ")[:2]) or "UNKNOWN"
    return pseudo or "UNKNOWN", None


def normalize_txn(txn: Txn) -> Txn:
    """Attach merchant/category to a transaction (mutates in place)."""
    cleaned = clean_description(txn.description)
    txn.merchant, txn.category = resolve_merchant(cleaned)
    return txn


def normalize_all(txns: list[Txn]) -> list[Txn]:
    return [normalize_txn(t) for t in txns]
