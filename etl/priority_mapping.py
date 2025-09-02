
import pandas as pd

##load data
df = pd.read_csv('arcgis/amenities.csv')
df.shape
df.head()

#check unique amenity types, these will be amenity subcategories
unique_amenity_types = df['amenity_type'].unique()
print(unique_amenity_types)
print(len(unique_amenity_types))
print(df['source_file'].count())
print(df.shape)

# map amenity_type as subcategories to categories
subcat_to_cat_mapping = {
    "emergency_services": ['fire_services'],
    "healthcare_facilities": [],
    "essential_services": [ 'childcare_clean', 'post_offices' , 'police' ],
    "residential": ['hdb_buildings'],
    "education_institutions": ['preschools', 'special_education' ,'moe_schools', 'higher_education', 'kindergartens' ],
    "transport_services": ['bus_depots','bus_interchanges_terminals','bus_stops', 'mrt_station_exits' ] ,
    "tourism": ['tourist_attractions', 'hotels', 'historic_sites' ],
    "community_spaces":['synagogues', 'sports_centres', 'stadiums' ,'swimming_complex' , 'churches', 'community_clubs', 'concert_halls', 'mosques', 'libraries', 'chinese_temples' , 'sikh_temples', 'indian_temples' , 'parkfacilities'],
    "government_services": ['courts'],
    "retail_services": ['hdb_points_shp'],
    "others": ['other_institutions']}

# decide on categories and (priority, weight)
# PRIORITY: lower number, more important --> based on importance to community 
## decided based on scale of 1 to 5, with 1 being critical to community and 5 being low impact on community if no access
# WEIGHT: higher number, more weight --> based on assumptinos made on usage/footfall 
## decided based on scale of 1 to 5, with 1 being low usage/footfall (used by avg person <1x a week) and 5 being high footfall (used by avg person 5-7x a week) with some manual override execptions (e.g. emergency services should always be available)
category_priority_weight = {
    "emergency_services": [1, 5],
    "healthcare_facilities": [1, 5],
    "essential_services": [1, 4],
    "residential": [1, 5],
    "education_institutions": [2, 4],
    "transport_services": [2, 4],
    "tourism": [5, 1],
    "community_spaces": [4, 2],
    "government_services": [3, 3],
    "financial_services": [3, 2],
    "retail_services": [4, 2],
    "recreation": [5, 2]
}

# given df with priority and weight, calculate importance score and add label
def amenity_importance(df, score_col="importance_score", score_label="importance_label", bins=[1, 2, 3, 5,8, 25], labels=["Negligible", "Low", "Moderate", "High", "Critical"]):
    # calculate importance score
    df[score_col] =  (df["amenity_weight"])**2/df["amenity_priority"]
    # add importance labels
    df[score_label] = pd.cut(df[score_col], bins=bins, labels=labels)

    return df

# create categoryDB
category_data = [(category, values[0], values[1]) for category, values in category_priority_weight.items()]
categoryDB = pd.DataFrame(category_data, columns=["amenity_category", "amenity_priority", "amenity_weight"])
print(categoryDB.head())

# create subcat_to_catDB
subcat_to_catDB = pd.DataFrame([(subcat, cat) for cat, subcats in subcat_to_cat_mapping.items() for subcat in subcats], columns=["amenity_type", "amenity_category"])
print(subcat_to_catDB.head())


# label ARCGIS data with category information
df = df.merge(subcat_to_catDB, on="amenity_type", how="left")

## add priority labels
df = df.merge(categoryDB, on="amenity_category", how="left")
print(df.head())

## calculate importance score and add label
df = amenity_importance(df)
print(df.head())