"""Synthetic sandbox user generator — "Maya", international student.

Produces ~185 days of messy transactions with four seeded leak classes:
  1. subscription creep  (GymFlow — billed monthly, used ~never)
  2. duplicate charge    (StreamVibe — twin charge two days in a row)
  3. hidden fees         (State Bank maintenance fee + one late penalty)
  4. silent price hike   (Spotify — $9.99 -> $12.99 with no notice)

100% synthetic. Deterministic under a fixed seed. No network, no real PII.
Sign convention: amount < 0 = money out (debit); add() defaults to outflows.
"""

from __future__ import annotations

import random
from datetime import date, timedelta

from app.engine.models import SandboxBundle, Txn

_WINDOW_DAYS = 185
_START_BALANCE = 1000.0  # calibrated: balance_now ~$301, Doom Day lands ~day 33
                         # (two days before payday) and Action-Desk plays clear it


def generate_maya(
    seed: int = 42,
    window_days: int = _WINDOW_DAYS,
    anchor: date | None = None,
) -> SandboxBundle:
    """Build the deterministic Maya sandbox bundle.

    `anchor` pins "today" (defaults to the run date). The pinned default in
    settings keeps the demo narrative — doom day 2026-11-19, day offsets,
    evidence artifacts — byte-identical no matter when the app is judged.
    """
    rng = random.Random(seed)
    anchor = anchor or date.today()
    start_day = anchor - timedelta(days=window_days)

    raw: list[tuple[date, str, float]] = []

    def add(day: date, description: str, amount: float, *, out: bool = True) -> None:
        """Append a transaction; outflows are stored negative."""
        raw.append((day, description, -round(amount, 2) if out else round(amount, 2)))

    # ---------- income ----------
    # Biweekly payroll (barista)
    d = start_day + timedelta(days=3)
    while d < anchor:
        add(d, "PAYROLL - CAFE MOCHA BEAN", rng.uniform(408.0, 452.0), out=False)
        d += timedelta(days=14)
    # Monthly parental remittance
    d = start_day + timedelta(days=9)
    while d < anchor:
        add(d, "REMIT WORLDWIDE REMITTANCE", rng.uniform(180.0, 200.0), out=False)
        d += timedelta(days=30)

    # ---------- fixed essentials ----------
    # NOTE: keep the last offset of every monthly series <= 30 days so its next
    # due date lands inside the projection window exactly once (no day-0
    # double-hit, which would poison the Doom-Day calibration).
    for off in (183, 153, 123, 93, 63, 28):
        add(anchor - timedelta(days=off), "SUNSET ROOMS RENT CO", 520.0)
    for off in (176, 146, 116, 86, 56, 26):
        add(anchor - timedelta(days=off), "CITY POWER WATER UTIL", rng.uniform(46.0, 71.0))
    for off in (175, 145, 115, 85, 55, 25):
        add(anchor - timedelta(days=off), "NORTHMOBILE PHONE BILL", 19.0)
    for off in (172, 142, 112, 82, 52, 22):
        add(anchor - timedelta(days=off), "SKYNET CABLE INTERNET", 29.99)

    # ---------- subscriptions ----------
    for off in (180, 150, 120, 90, 60, 30):
        add(anchor - timedelta(days=off), rng.choice([
            "NETFLIX.COM 8555731", "NETFLIX .COM REBILL 8555731", "NETFLIXCOM REBILL 8555731",
        ]), 15.99)
    # Spotify: 4 bills at 9.99, then a silent hike to 12.99 for the last two
    for off in (181, 151, 121, 91):
        add(anchor - timedelta(days=off), rng.choice([
            "SPOTIFY SEATTLE WA", "SPFTR MUSIC REBILL 9923171",
        ]), 9.99)
    for off in (61, 28):
        add(anchor - timedelta(days=off), rng.choice([
            "SPOTIFY SEATTLE WA", "SPFTR MUSIC REBILL 9923171", "SPOTIFYU SA REBILL",
        ]), 12.99)
    # GymFlow: billed monthly, effectively unused (creep candidate)
    for off in (178, 148, 118, 88, 58, 28):
        add(anchor - timedelta(days=off), rng.choice([
            "GYMFLOW MEMBERSHIP ST12", "GYM FLOW BILLING CH12",
        ]), 29.0)
    # CloudDrive: healthy, used often
    for off in (179, 149, 119, 89, 59, 29):
        add(anchor - timedelta(days=off), "CLOUDDRIVE STORAGE PRO", 8.99)
    # PixelFlix: healthy small streamer
    for off in (177, 147, 117, 87, 57, 27):
        add(anchor - timedelta(days=off), "PIXELFLIX STREAM", 6.99)
    # StreamVibe: billed once — with a duplicate twin charge (one month only)
    add(anchor - timedelta(days=100), "STREAMVIBE SUBSCRIPTION", 13.49)
    add(anchor - timedelta(days=99), "STREAMVIBE SUBSCRIPTION", 13.49)

    # ---------- fees ----------
    for off in (175, 145, 115, 85, 55, 25):
        add(anchor - timedelta(days=off), "STATE BANK MONTHLY MAINT FEE", 4.95)
    add(anchor - timedelta(days=96), "CARD LATE PENALTY FEE", 15.0)

    # ---------- discretionary life ----------
    # Groceries ~weekly
    d = start_day + timedelta(days=2)
    while d < anchor:
        add(d, rng.choice(["FRESHMART GROCERY", "GREENGO PRODUCE"]), rng.uniform(38.0, 62.0))
        d += timedelta(days=7)
    # Dining ~2x/week
    for _ in range(52):
        add(
            start_day + timedelta(days=rng.randrange(1, window_days - 1)),
            rng.choice(["PHO HOUSE", "BURGER JUNCTION", "BREW CO ROASTERS", "KOPI KOPIAN"]),
            rng.uniform(8.0, 24.0),
        )
    # Transport top-ups ~every 9 days
    d = start_day + timedelta(days=5)
    while d < anchor:
        add(d, "CITYTRANS FARE CARD TOPUP", rng.uniform(12.0, 21.0))
        d += timedelta(days=9)
    # Shopping splurges
    for off, amount in [(160, 74.5), (110, 89.9), (70, 62.0), (25, 95.0)]:
        add(anchor - timedelta(days=off), rng.choice(["THREADVAULT APPAREL", "GEARHAUS SPORTS"]), amount)
    for off in (170, 130, 95, 55, 20):
        add(anchor - timedelta(days=off), "ARROWMARKET ORD", rng.uniform(30.0, 60.0))
    # Pharmacy
    for off in (120, 33):
        add(anchor - timedelta(days=off), "MEDIPLUS PHARMACY", rng.uniform(16.0, 35.0))

    # ---------- assemble bundle ----------
    raw.sort(key=lambda x: x[0])
    transactions: list[Txn] = []
    for i, (day, description, amount) in enumerate(raw, start=1):
        transactions.append(
            Txn(id=f"T{i:04d}", date=day, description=description, amount=amount)
        )

    bundle = SandboxBundle(
        profile_name="Maya",
        window_days=window_days,
        anchor=anchor,
        start_balance=_START_BALANCE,
        usage_90d={
            # uses logged in the last 90 days (sandbox usage feed)
            "GymFlow": 0,
            "Netflix": 9,
            "Spotify": 6,
            "PixelFlix": 3,
            "CloudDrive": 14,
            "StreamVibe": 2,
        },
        transactions=transactions,
    )
    bundle.balance_now = round(
        bundle.start_balance + sum(t.amount for t in transactions), 2
    )
    return bundle
