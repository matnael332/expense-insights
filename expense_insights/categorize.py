"""Keyword-based transaction categorization."""

RULES = {
    "Groceries": ["supermarket", "grocery", "market", "bakery"],
    "Dining": ["restaurant", "cafe", "coffee", "pizza", "burger"],
    "Transport": ["fuel", "gas station", "train", "bus", "taxi", "parking"],
    "Utilities": ["electric", "water", "internet", "phone", "utility"],
    "Housing": ["rent", "mortgage"],
    "Entertainment": ["cinema", "netflix", "spotify", "concert", "game"],
    "Health": ["pharmacy", "clinic", "doctor", "dentist"],
}

INCOME = "Income"
OTHER = "Other"


def categorize(description: str, amount: float) -> str:
    """Return a category for a transaction.

    Positive amounts are income. Negative amounts are matched against RULES by
    case-insensitive keyword; unmatched expenses fall into "Other".
    """
    if amount > 0:
        return INCOME
    text = description.lower()
    for category, keywords in RULES.items():
        if any(keyword in text for keyword in keywords):
            return category
    return OTHER
