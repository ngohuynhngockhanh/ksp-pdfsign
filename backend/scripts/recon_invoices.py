import sys, json, urllib.request, urllib.parse
sys.path.insert(0, "backend")
from app.config import get_settings
from app.db import init_db, get_session
from app.email_sync import get_zoho_settings, get_access_token_from_refresh

settings = get_settings()
init_db()
db = next(get_session())
cfg = get_zoho_settings(db, settings)
db.close()

token = get_access_token_from_refresh(
    cfg["client_id"],
    cfg["client_secret"],
    cfg["refresh_token"],
    cfg["accounts_url"]
)
print("Access token obtained:", token[:15] + "...")

mail_api_url = cfg["mail_api_url"].rstrip("/")
acc_req = urllib.request.Request(f"{mail_api_url}/api/accounts")
acc_req.add_header("Authorization", f"Zoho-oauthtoken {token}")
with urllib.request.urlopen(acc_req) as resp:
    acc_data = json.loads(resp.read().decode())

accounts = acc_data.get("data", [])
print("Accounts:", [(a.get("accountId"), a.get("accountName")) for a in accounts])
account_id = str(accounts[0].get("accountId"))
targets = [
    ("Ahamove 17596", "entire:17596"),
    ("Ahamove 23520", "entire:23520"),
    ("Ahamove", "entire:Ahamove"),
    ("VNPAY 49325", "entire:49325"),
    ("VNPAY 49331", "entire:49331"),
    ("VNPAY", "entire:VNPAY"),
    ("Thời Đại 35593", "entire:35593"),
    ("Thời Đại MST", "entire:0319180565"),
    ("Thiên Long 1432347", "entire:1432347"),
    ("Thiên Long MST", "entire:0305341389"),
]
for desc, q in targets:
    test_url = f"{mail_api_url}/api/accounts/{account_id}/messages/search?searchKey={urllib.parse.quote(q)}"
    print(f"=== Target: {desc} ({q}) ===")
    print(f"Testing URL: {test_url}")
    req = urllib.request.Request(test_url)
    req.add_header("Authorization", f"Zoho-oauthtoken {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            res = json.loads(resp.read().decode())
            print(f"  Success! status={res.get('status')}, count={len(res.get('data', []))}")
            for item in res.get('data', [])[:3]:
                print(f"    Subject: {item.get('subject')}")
    except urllib.error.HTTPError as e:
        print(f"  HTTP Error {e.code}: {e.read().decode('utf-8', errors='replace')}")
    except Exception as e:
        print(f"  Failed: {e}")
