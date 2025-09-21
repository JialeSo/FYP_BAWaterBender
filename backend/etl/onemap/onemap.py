import requests
import os
from dotenv import load_dotenv
import pandas as pd
# load environment variables
load_dotenv()

# 1. authenticate (new endpoint)
auth_url = "https://www.onemap.gov.sg/api/auth/post/getToken"
payload = {
    "email": os.environ['ONE_MAP_USER'],
    "password": os.environ['ONE_MAP_PASS']
}
auth_resp = requests.post(auth_url, json=payload)
auth_resp.raise_for_status()
auth_data = auth_resp.json()
token = auth_data.get("access_token")

print("✅ got access token:", token[:30] + "...")

#%%
url = "https://www.onemap.gov.sg/api/public/themesvc/getAllThemesInfo?moreInfo=Y"
headers = {"Authorization": token}

# Fetch all themes
resp = requests.get(url, headers=headers)
resp.raise_for_status()
data = resp.json()

# Extract themes
themes = data.get("Theme_Names", [])
print(f"\n📌 Found {len(themes)} themes.\n")

# Convert to DataFrame
df = pd.DataFrame(themes)[["THEMENAME", "QUERYNAME", "CATEGORY", "THEME_OWNER", "PUBLISHED_DATE", "EXPIRY_DATE", "ICON"]]

# Rename columns for clarity
df.columns = ["Theme Name", "Query Name", "Category", "Theme Owner", "Published Date", "Expiry Date", "Icon"]

# Display first few rows
print(df.head())