"""Load transactions, summarize by month, and flag unusual expenses."""

import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from statistics import median

from .categorize import INCOME, categorize

REQUIRED_COLUMNS = {"date", "description", "amount"}


@dataclass(frozen=True)
class Transaction:
    date: date
    description: str
    amount: float  # negative = expense, positive = income
    category: str


def load_transactions(path: str) -> list[Transaction]:
    """Read a CSV with columns date (YYYY-MM-DD), description, amount."""
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"missing columns: {', '.join(sorted(missing))}")
        transactions = []
        for line_number, row in enumerate(reader, start=2):
            try:
                when = date.fromisoformat(row["date"].strip())
                amount = float(row["amount"])
            except (ValueError, AttributeError) as error:
                raise ValueError(f"line {line_number}: invalid row ({error})") from error
            description = row["description"].strip()
            transactions.append(
                Transaction(when, description, amount, categorize(description, amount))
            )
    return transactions


def monthly_summary(transactions: list[Transaction]) -> dict[str, dict]:
    """Return {"YYYY-MM": {income, expenses, net, by_category}} sorted by month."""
    months: dict[str, dict] = defaultdict(
        lambda: {"income": 0.0, "expenses": 0.0, "by_category": defaultdict(float)}
    )
    for tx in transactions:
        month = months[tx.date.strftime("%Y-%m")]
        if tx.category == INCOME:
            month["income"] += tx.amount
        else:
            month["expenses"] += -tx.amount
            month["by_category"][tx.category] += -tx.amount
    result = {}
    for key in sorted(months):
        month = months[key]
        result[key] = {
            "income": round(month["income"], 2),
            "expenses": round(month["expenses"], 2),
            "net": round(month["income"] - month["expenses"], 2),
            "by_category": {k: round(v, 2) for k, v in sorted(month["by_category"].items())},
        }
    return result


def find_anomalies(
    transactions: list[Transaction], factor: float = 3.0, min_samples: int = 4
) -> list[Transaction]:
    """Flag expenses larger than `factor` times their category's median.

    Categories with fewer than `min_samples` expenses are skipped, because a
    median from a handful of points is not a reliable baseline.
    """
    by_category: dict[str, list[Transaction]] = defaultdict(list)
    for tx in transactions:
        if tx.category != INCOME:
            by_category[tx.category].append(tx)
    flagged = []
    for items in by_category.values():
        if len(items) < min_samples:
            continue
        baseline = median(-tx.amount for tx in items)
        flagged.extend(tx for tx in items if -tx.amount > factor * baseline)
    return sorted(flagged, key=lambda tx: tx.date)
