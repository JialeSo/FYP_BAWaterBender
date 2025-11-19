import pandas as pd
from pathlib import Path

# --- File paths ---
PUB_CSV = "PUB_weather_alerts_with_postal.csv"
SG_CSV = "SG_postal_codes_resolved.csv"
OUTPUT_CSV = "PUB_and_huiying_flood.csv"

def merge_pub_and_sg(pub_csv, sg_csv, output_csv):
    # Load PUB dataset, ensure postal codes are strings
    pub_df = pd.read_csv(pub_csv, dtype={"start_postal_code": str, "end_postal_code": str})

    # Convert PUB event_date_time to date only
    pub_df["event_date_time"] = pd.to_datetime(pub_df["event_date_time"], errors="coerce").dt.date

    # Load SG dataset, ensure Postal_Code is string
    sg_df = pd.read_csv(sg_csv, dtype={"Postal_Code": str})

    # Convert SG["Date"] to datetime.date
    sg_df["event_date_time"] = pd.to_datetime(sg_df["Date"], dayfirst=True, errors="coerce").dt.date

    # Create a dataframe with PUB's schema
    sg_to_pub = pd.DataFrame({
        "id": sg_df["id"],
        "created_at": None,
        "text": None,
        "event_date_time": sg_df["event_date_time"],
        "sender_id": None,
        "msg_id": None,
        "location": sg_df["Location"],
        "event": "flash_flood",
        "start_loc": None,
        "end_loc": None,
        "parent_road": None,
        "cleaned_location": None,
        "start_lat": sg_df["latitude"],
        "start_lng": sg_df["longitude"],
        "start_postal_code": sg_df["Postal_Code"],  # keep as string
        "end_lat": None,
        "end_lng": None,
        "end_postal_code": None,
    })

    # Combine PUB + SG
    merged = pd.concat([pub_df, sg_to_pub], ignore_index=True)

    # Sort by event_date_time
    merged = merged.sort_values("event_date_time", ascending=True).reset_index(drop=True)

    # Rename column
    merged.rename(columns={"event_date_time": "event_date"}, inplace=True)

    # Save result
    merged.to_csv(output_csv, index=False)
    print(f"Merged dataset saved to {output_csv}")
    return merged

df = merge_pub_and_sg(PUB_CSV, SG_CSV, OUTPUT_CSV)
print(df.head())   # earliest rows
print(df.tail())   # latest rows
