import json
import os
from datetime import datetime, timezone
from urllib.parse import unquote

import requests

BASE = "https://stg-risk.mcwchat.com"

DEPOSIT_PAGE = f"{BASE}/admin/dashboard-summary-deposit"
WITHDRAWAL_PAGE = f"{BASE}/admin/dashboard-summary-withdrawal"

DEPOSIT_API = f"{DEPOSIT_PAGE}/filter"
WITHDRAWAL_API = f"{WITHDRAWAL_PAGE}/filter"

MCW_CODES = ["M1", "B1", "K1", "M2", "B2", "B4", "B3", "TK", "B5", "JY"]
CX_CODES = ["CX", "MB", "MP", "JBG", "DZP", "SB", "SLB", "JWAY", "BJD", "KVP", "HBJ"]
ALL_CODES = MCW_CODES + CX_CODES

PAYLOAD = {
    "currency": "BDT",
    "mainBrand": None,
    "brand": None
}


def to_number(value):
    try:
        return float(str(value).replace(",", "").strip())
    except Exception:
        return 0


def fetch_api(page_url, api_url):
    session = requests.Session()

    session.headers.update({
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": BASE,
        "Referer": page_url,
        "User-Agent": "Mozilla/5.0"
    })

    page_res = session.get(page_url, timeout=30)
    page_res.raise_for_status()

    xsrf_token = session.cookies.get("XSRF-TOKEN")
    if xsrf_token:
        session.headers.update({
            "X-XSRF-TOKEN": unquote(xsrf_token)
        })

    api_res = session.post(api_url, json=PAYLOAD, timeout=30)

    print(api_url, api_res.status_code)

    if api_res.status_code != 200:
        print("Response text:", api_res.text[:1000])

    api_res.raise_for_status()

    json_data = api_res.json()
    return json_data.get("data", {})


def latest_non_zero_point(date_hour_data, prefix):
    best = None

    for date, hours in date_hour_data.items():
        for hour, values in hours.items():
            amount = to_number(values.get(f"{prefix}_amount"))
            count = to_number(values.get(f"{prefix}_count"))
            difference = to_number(values.get(f"{prefix}_difference"))

            if amount <= 0 and count <= 0:
                continue

            key = f"{date} {hour}"

            if best is None or key > best["key"]:
                best = {
                    "key": key,
                    "date": date,
                    "hour": hour,
                    "count": count,
                    "amount": amount,
                    "difference": difference
                }

    return {
        "count": best["count"] if best else 0,
        "amount": best["amount"] if best else 0,
        "difference": best["difference"] if best else 0,
        "date": best["date"] if best else None,
        "hour": best["hour"] if best else None
    }


def build_latest():
    deposit_data = fetch_api(DEPOSIT_PAGE, DEPOSIT_API)
    withdrawal_data = fetch_api(WITHDRAWAL_PAGE, WITHDRAWAL_API)

    brands = {}

    for code in ALL_CODES:
        group = "MCW" if code in MCW_CODES else "CX"

        deposit_point = latest_non_zero_point(deposit_data.get(code, {}), "deposit")
        withdrawal_point = latest_non_zero_point(withdrawal_data.get(code, {}), "withdrawal")

        deposit_amount = deposit_point["amount"]
        withdrawal_amount = withdrawal_point["amount"]

        brands[code] = {
            "group": group,

            "deposit_count": deposit_point["count"],
            "deposit_amount": deposit_amount,
            "deposit_difference": deposit_point["difference"],
            "deposit_date": deposit_point["date"],
            "deposit_time": deposit_point["hour"],

            "withdrawal_count": withdrawal_point["count"],
            "withdrawal_amount": withdrawal_amount,
            "withdrawal_difference": withdrawal_point["difference"],
            "withdrawal_date": withdrawal_point["date"],
            "withdrawal_time": withdrawal_point["hour"],

            "net_flow": deposit_amount - withdrawal_amount,
            "withdrawal_pressure": (withdrawal_amount / deposit_amount * 100) if deposit_amount else 0
        }

    group_totals = {}

    for group in ["MCW", "CX"]:
        group_rows = [row for row in brands.values() if row["group"] == group]

        deposit_amount = sum(row["deposit_amount"] for row in group_rows)
        withdrawal_amount = sum(row["withdrawal_amount"] for row in group_rows)

        group_totals[group] = {
            "deposit_count": sum(row["deposit_count"] for row in group_rows),
            "deposit_amount": deposit_amount,
            "deposit_difference": sum(row["deposit_difference"] for row in group_rows),

            "withdrawal_count": sum(row["withdrawal_count"] for row in group_rows),
            "withdrawal_amount": withdrawal_amount,
            "withdrawal_difference": sum(row["withdrawal_difference"] for row in group_rows),

            "net_flow": deposit_amount - withdrawal_amount,
            "withdrawal_pressure": (withdrawal_amount / deposit_amount * 100) if deposit_amount else 0
        }

    latest = {
        "updated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": {
            "deposit_url": DEPOSIT_API,
            "withdrawal_url": WITHDRAWAL_API
        },
        "brands": brands,
        "group_totals": group_totals,
        "comparison": {
            "m1_vs_cx": {
                "M1": brands.get("M1", {}),
                "CX": brands.get("CX", {})
            },
            "mcw_vs_cx_total": {
                "MCW": group_totals.get("MCW", {}),
                "CX": group_totals.get("CX", {})
            }
        }
    }

    return latest


def main():
    os.makedirs("data", exist_ok=True)

    latest = build_latest()

    with open("data/latest.json", "w", encoding="utf-8") as file:
        json.dump(latest, file, ensure_ascii=False, indent=2)

    history_path = "data/history.json"

    try:
        with open(history_path, "r", encoding="utf-8") as file:
            history = json.load(file)
            if not isinstance(history, list):
                history = []
    except Exception:
        history = []

    history.append(latest)
    history = history[-200:]

    with open(history_path, "w", encoding="utf-8") as file:
        json.dump(history, file, ensure_ascii=False, indent=2)

    print("Data updated successfully")
    print("M1:", latest["brands"]["M1"])
    print("CX:", latest["brands"]["CX"])
    print("Group totals:", latest["group_totals"])


if __name__ == "__main__":
    main()
