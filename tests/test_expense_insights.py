from datetime import date

import pytest

from expense_insights.analyze import (
    Transaction,
    find_anomalies,
    load_transactions,
    monthly_summary,
)
from expense_insights.categorize import categorize
from expense_insights.cli import main
from expense_insights.report import render_report


def write_csv(tmp_path, body, header="date,description,amount\n"):
    path = tmp_path / "tx.csv"
    path.write_text(header + body, encoding="utf-8")
    return str(path)


def test_categorize_by_keyword_income_and_fallback():
    assert categorize("Supermarket Fresh", -100) == "Groceries"
    assert categorize("PIZZA house", -50) == "Dining"
    assert categorize("Salary", 9000) == "Income"
    assert categorize("Something unknown", -10) == "Other"


def test_load_transactions_parses_and_categorizes(tmp_path):
    path = write_csv(tmp_path, "2026-01-05,Rent apartment,-3800.00\n2026-01-01,Salary,9000\n")
    transactions = load_transactions(path)
    assert [t.category for t in transactions] == ["Housing", "Income"]
    assert transactions[0].date == date(2026, 1, 5)


def test_load_transactions_reports_bad_row_with_line_number(tmp_path):
    path = write_csv(tmp_path, "2026-01-05,Rent,-3800\nnot-a-date,Coffee,-10\n")
    with pytest.raises(ValueError, match="line 3"):
        load_transactions(path)


def test_load_transactions_requires_columns(tmp_path):
    path = write_csv(tmp_path, "2026-01-05,100\n", header="date,amount\n")
    with pytest.raises(ValueError, match="description"):
        load_transactions(path)


def test_monthly_summary_totals():
    txs = [
        Transaction(date(2026, 1, 1), "Salary", 1000.0, "Income"),
        Transaction(date(2026, 1, 3), "Cafe", -30.0, "Dining"),
        Transaction(date(2026, 1, 9), "Pizza", -20.0, "Dining"),
        Transaction(date(2026, 2, 1), "Rent", -400.0, "Housing"),
    ]
    summary = monthly_summary(txs)
    assert summary["2026-01"] == {
        "income": 1000.0,
        "expenses": 50.0,
        "net": 950.0,
        "by_category": {"Dining": 50.0},
    }
    assert summary["2026-02"]["net"] == -400.0


def test_find_anomalies_flags_outlier_only():
    base = [Transaction(date(2026, 1, d), "Cafe", -30.0, "Dining") for d in (1, 2, 3, 4)]
    outlier = Transaction(date(2026, 1, 9), "Gala dinner", -500.0, "Dining")
    assert find_anomalies(base + [outlier]) == [outlier]
    assert find_anomalies(base) == []


def test_find_anomalies_skips_small_categories():
    txs = [
        Transaction(date(2026, 1, 1), "Cafe", -30.0, "Dining"),
        Transaction(date(2026, 1, 2), "Gala", -500.0, "Dining"),
    ]
    assert find_anomalies(txs) == []


def test_render_report_empty_and_sections():
    assert "No transactions found" in render_report([])
    txs = [Transaction(date(2026, 1, 1), "Salary", 1000.0, "Income")]
    report = render_report(txs)
    assert "## Monthly summary" in report and "2026-01" in report


def test_cli_success_and_error(tmp_path, capsys):
    good = write_csv(tmp_path, "2026-01-01,Salary,1000\n")
    assert main([good]) == 0
    assert "Expense report" in capsys.readouterr().out
    assert main([str(tmp_path / "missing.csv")]) == 1
    assert "error:" in capsys.readouterr().err
