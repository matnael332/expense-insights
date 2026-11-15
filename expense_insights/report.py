"""Render a Markdown report."""

from .analyze import Transaction, find_anomalies, monthly_summary


def render_report(transactions: list[Transaction]) -> str:
    lines = ["# Expense report", ""]
    summary = monthly_summary(transactions)
    if not summary:
        return "# Expense report\n\nNo transactions found.\n"

    lines += ["## Monthly summary", "", "| Month | Income | Expenses | Net |", "|---|---:|---:|---:|"]
    for month, data in summary.items():
        lines.append(f"| {month} | {data['income']:.2f} | {data['expenses']:.2f} | {data['net']:.2f} |")

    lines += ["", "## Spending by category (all months)", ""]
    totals: dict[str, float] = {}
    for data in summary.values():
        for category, value in data["by_category"].items():
            totals[category] = totals.get(category, 0.0) + value
    for category, value in sorted(totals.items(), key=lambda item: -item[1]):
        lines.append(f"- {category}: {value:.2f}")

    anomalies = find_anomalies(transactions)
    lines += ["", "## Unusual expenses", ""]
    if anomalies:
        for tx in anomalies:
            lines.append(f"- {tx.date} {tx.description} ({tx.category}): {-tx.amount:.2f}")
    else:
        lines.append("None found.")
    return "\n".join(lines) + "\n"
