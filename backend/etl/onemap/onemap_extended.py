import requests
import os
from dotenv import load_dotenv
import pandas as pd
import time

# Load environment variables
load_dotenv()

# Step 1: Authenticate and get access token
auth_url = "https://www.onemap.gov.sg/api/auth/post/getToken"
payload = {
    "email": os.environ["ONE_MAP_USER"],
    "password": os.environ["ONE_MAP_PASS"]
}
auth_resp = requests.post(auth_url, json=payload)
auth_resp.raise_for_status()
token = auth_resp.json().get("access_token")
print("✅ Access token obtained:", token[:30] + "...")

# Step 2: Get all themes
themes_url = "https://www.onemap.gov.sg/api/public/themesvc/getAllThemesInfo?moreInfo=Y"
headers = {"Authorization": token}
themes_resp = requests.get(themes_url, headers=headers)
themes_resp.raise_for_status()
themes = themes_resp.json().get("Theme_Names", [])
print(f"📌 Found {len(themes)} themes.")

# Step 3: Loop through each theme and get records
all_records = []
for theme in themes:
    themename = theme.get("THEMENAME")
    queryname = theme.get("QUERYNAME")
    print(f"🔍 Fetching data for: {themename} ({queryname})")

    # Build endpoint
    theme_data_url = f"https://www.onemap.gov.sg/api/public/themesvc/retrieveTheme?queryName={queryname}"
    
    try:
        data_resp = requests.get(theme_data_url, headers=headers)
        data_resp.raise_for_status()
        data_items = data_resp.json().get("SrchResults", [])

        # Append theme metadata to each record
        for item in data_items:
            item["Theme Name"] = themename
            item["Query Name"] = queryname
            all_records.append(item)

    except Exception as e:
        print(f"⚠️ Failed to fetch {queryname}: {e}")

    # Be nice to API
    time.sleep(0.2)

# Step 4: Create final DataFrame
df = pd.DataFrame(all_records)

# Clean column names for consistency
df.columns = [col.strip().replace(" ", "_").lower() for col in df.columns]

#%%
print("\n📌 Column Names in df:")
print(df.columns.tolist())
df.head(3).T  # Transposed view: rows as columns for easier preview

# %%
