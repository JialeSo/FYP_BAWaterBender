import pandas as pd

#  Load ARC GIS amenities dataset 
df = pd.read_csv('data/amenities.csv')
print(df.head())
print(df.shape)

# check unique amenity types 
unique_amenity_types = df['amenity_type'].unique()
print(unique_amenity_types)
print(len(unique_amenity_types))

## load unique amenities and give it index 
## added id just in case we want it
amenitiesDB = pd.DataFrame(unique_amenity_types, columns=['amenity_type'])
amenitiesDB["prioritisation_amenity_id"] = amenitiesDB.index+1

## decide on how to prioritise each amenity
### higher priority, lower number (i.e. 1 --> critical, 5 --> low priority)
### categorised based on importance to community (e.g. emergency services, essential services)

priority_mapping = {
    1: [
        "fire_services", "police", "courts",
        "mrt_station_exits", "bus_interchanges_terminals",
        "bus_depots", "bus_stops"
    ],
    2: [
        "moe_schools", "higher_education", "special_education",
        "childcare_clean", "kindergartens", "preschools",
        "community_clubs", "post_offices", "libraries",
        "hdb_buildings", "hdb_points_shp"
    ],
    3: [
        "mosques", "churches", "chinese_temples", "indian_temples",
        "sikh_temples", "synagogues", "concert_halls", "historic_sites"
    ],
    4: [
        "stadiums", "sports_centres", "swimming_complex",
        "parkfacilities", "tourist_attractions", "hotels"
    ]
}

priority_labels = {1: "Critical", 2: "High", 3: "Medium", 4: "Low"}

## map back to amenitiesDB 
amenitiesDB["priority"] = amenitiesDB["amenity_type"].map(
    {v: k for k, vs in priority_mapping.items() for v in vs}
)

## add priority labels
# amenitiesDB["priority_label"] = amenitiesDB["priority"].map(priority_labels)

## get new db with priority
amenities_prioritised = df.merge(amenitiesDB, on="amenity_type", how="left")
amenities_prioritised.shape
amenities_prioritised.head()