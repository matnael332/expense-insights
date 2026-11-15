"""Command-line entry point."""

import argparse
import sys

from .analyze import load_transactions
from .report import render_report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="expense_insights", description=__doc__)
    parser.add_argument("csv_path", help="CSV with columns: date, description, amount")
    parser.add_argument("-o", "--output", help="write the report to this file instead of stdout")
    args = parser.parse_args(argv)

    try:
        transactions = load_transactions(args.csv_path)
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    report = render_report(transactions)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(report)
    else:
        print(report, end="")
    return 0
