import asyncio
import time
from collections import deque
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from backend.etl.common.pipeline_stage import PipelineStage
from backend.common.db import DatabaseConnection
from backend.etl.onemap.onemap_extended import OneMapClient
from backend.etl.common.spatial_geocoding import add_three_layer_geocoding, get_default_geojson_paths
from backend.etl.common.postal_code_utils import load_postal_codes_lookup


logger = logging.getLogger(__name__)


class GeocodePostalOneMapStage(PipelineStage):
    """
    Single geocoding stage for ACRA rows using OneMap.

    Logic per row:
    - If `postal_code` found in local onemap_postal_codes.csv, use its lat/lon
    - Else, query OneMap commonapi/search with the postal code to get lat/lon
    - Append latitude, longitude to each row

    Also writes the updated combined CSV to disk for traceability.
    """

    def __init__(
        self,
        out_dir: Path,
        out_csv: str = "acra_all.csv",
        postal_ref_csv: Optional[Path] = None,
        sleep_between_requests: float = 0.75,
    ) -> None:
        super().__init__("Geocode Postal (OneMap)")
        self.out_dir = out_dir
        self.out_csv = out_csv
        self.sleep_between_requests = max(0.0, sleep_between_requests)
        # Default postal reference file (repo: backend/etl/data/onemap/onemap_postal_codes.csv)
        self.postal_ref_csv = postal_ref_csv or (
            Path(__file__).resolve().parents[1] / "data" / "onemap" / "onemap_postal_codes.csv"
        )
        self.postal_lookup = load_postal_codes_lookup(self.postal_ref_csv)
        # Shared OneMap client (token caching + helpers)
        self.client = OneMapClient()
        self._db: Optional[DatabaseConnection] = None

    # Token management and headers handled by OneMapClient

    # Removed legacy local postal loader in favor of common utility

    def _onemap_search_postal(self, postal: str) -> Tuple[Optional[float], Optional[float]]:
        """Query OneMap (elastic preferred, fallback to public) for a postal code."""
        try:
            lat, lon = self.client.search_postal(postal)
            return (lat, lon)
        except Exception as e:
            logger.debug(f"OneMap search failed for {postal}: {e}")
            return None, None

    def _onemap_elastic_search_postal(self, postal: str) -> Tuple[Optional[float], Optional[float]]:
        """Query OneMap elastic search (token-only) to geocode a postal code.

        Endpoint: /api/common/elastic/search
        Requires Authorization header. No rate limiting or delays applied.
        """
        try:
            lat, lon = self.client.search_elastic_postal(postal)
            return lat, lon
        except Exception as e:
            logger.debug(f"OneMap elastic search failed for {postal}: {e}")
            return None, None

    async def process(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not isinstance(data, list) or not data:
            return data

        # Convert to DataFrame for vectorized CSV matching
        df_out = pd.DataFrame(data)
        if df_out.empty:
            return data

        # Normalize postal codes
        df_out["postal_code"] = (
            df_out.get("postal_code").astype(str).str.strip().str.replace(r"\D", "", regex=True).str.zfill(6)
        )

        # Pre-fill latitude/longitude when already present
        if "latitude" not in df_out.columns:
            df_out["latitude"] = pd.NA
        if "longitude" not in df_out.columns:
            df_out["longitude"] = pd.NA

        # Fast path: map using local postal lookup (no API)
        if self.postal_lookup:
            lat_map = {k: v[0] for k, v in self.postal_lookup.items()}
            lon_map = {k: v[1] for k, v in self.postal_lookup.items()}

            # Only fill where missing
            mask_lat_missing = df_out["latitude"].isna()
            mask_lon_missing = df_out["longitude"].isna()
            fill_mask = mask_lat_missing | mask_lon_missing
            df_out.loc[fill_mask, "_lat_fill"] = df_out.loc[fill_mask, "postal_code"].map(lat_map)
            df_out.loc[fill_mask, "_lon_fill"] = df_out.loc[fill_mask, "postal_code"].map(lon_map)
            # Assign where both are available
            both_avail = df_out["_lat_fill"].notna() & df_out["_lon_fill"].notna()
            df_out.loc[both_avail, "latitude"] = df_out.loc[both_avail, "_lat_fill"]
            df_out.loc[both_avail, "longitude"] = df_out.loc[both_avail, "_lon_fill"]
            # Cleanup temp columns
            df_out = df_out.drop(columns=[c for c in ["_lat_fill", "_lon_fill"] if c in df_out.columns])

        # Determine rows still unmatched for API lookup
        unmatched_mask = (df_out["latitude"].isna()) | (df_out["longitude"].isna())
        unmatched_mask &= df_out["postal_code"].str.fullmatch(r"\d{6}")
        unmatched_idx = df_out.index[unmatched_mask]

        csv_hits = (df_out.index.size - unmatched_idx.size)
        logger.info(
            f"Lookup filled {csv_hits:,} rows from postal CSV; unmatched for API: {len(unmatched_idx):,}"
        )

        # Optimize: query each unmatched postal only once, then map results back
        unmatched_postals = (
            df_out.loc[unmatched_idx, "postal_code"].astype(str).str.strip().unique().tolist()
        )
        results_cache: Dict[str, Tuple[Optional[float], Optional[float]]] = {}
        api_hits = 0
        misses = 0

        for i, postal in enumerate(unmatched_postals, start=1):
            latlon = self._onemap_elastic_search_postal(postal)
            results_cache[postal] = latlon
            if latlon and latlon[0] is not None and latlon[1] is not None:
                api_hits += 1
            else:
                misses += 1
            if i % 500 == 0:
                logger.info(
                    f"Geocode unique progress {i}/{len(unmatched_postals):,} | API hits: {api_hits:,} | Miss: {misses:,}"
                )

        # Map results back to all unmatched rows
        if results_cache:
            df_out.loc[unmatched_idx, "_lat_fill_api"] = df_out.loc[unmatched_idx, "postal_code"].map(
                lambda p: results_cache.get(p, (None, None))[0]
            )
            df_out.loc[unmatched_idx, "_lon_fill_api"] = df_out.loc[unmatched_idx, "postal_code"].map(
                lambda p: results_cache.get(p, (None, None))[1]
            )
            # Align mask to the full DataFrame; do not boolean-index unmatched_idx (length mismatch)
            have_both = df_out["_lat_fill_api"].notna() & df_out["_lon_fill_api"].notna()
            assign_mask = have_both & df_out.index.isin(unmatched_idx)
            df_out.loc[assign_mask, "latitude"] = df_out.loc[assign_mask, "_lat_fill_api"]
            df_out.loc[assign_mask, "longitude"] = df_out.loc[assign_mask, "_lon_fill_api"]
            df_out = df_out.drop(columns=[c for c in ["_lat_fill_api", "_lon_fill_api"] if c in df_out.columns])

            # Append new API-resolved postals into local CSV cache and upsert to Supabase
            try:
                newly_resolved = []
                for postal, latlon in results_cache.items():
                    lat, lon = (latlon or (None, None))
                    if lat is None or lon is None:
                        continue
                    p = str(postal).strip().zfill(6)
                    if p and p not in self.postal_lookup:
                        newly_resolved.append({
                            "postal": p,
                            "latitude": float(lat),
                            "longitude": float(lon),
                        })

                if newly_resolved:
                    # Update in-memory lookup for subsequent rows in same run
                    for item in newly_resolved:
                        self.postal_lookup[item["postal"]] = (item["latitude"], item["longitude"]) 

                    # Update local CSV (dedupe by postal, prefer latest)
                    try:
                        if self.postal_ref_csv.exists():
                            existing = pd.read_csv(self.postal_ref_csv, dtype=str)
                            existing.columns = [c.strip().lower() for c in existing.columns]
                        else:
                            existing = pd.DataFrame(columns=["postal","latitude","longitude"])
                        add_df = pd.DataFrame(newly_resolved)
                        add_df["postal"] = add_df["postal"].astype(str).str.strip().str.zfill(6)
                        add_df["latitude"] = add_df["latitude"].astype(str)
                        add_df["longitude"] = add_df["longitude"].astype(str)
                        merged = pd.concat([existing, add_df], ignore_index=True)
                        merged = merged.drop_duplicates(subset=["postal"], keep="last").sort_values("postal")
                        self.postal_ref_csv.parent.mkdir(parents=True, exist_ok=True)
                        merged.to_csv(self.postal_ref_csv, index=False)
                        logger.info(f"Postal cache updated with {len(newly_resolved)} new entries → {self.postal_ref_csv}")
                    except Exception as e:
                        logger.warning(f"Failed to append to postal cache CSV: {e}")

                    # Upsert to Supabase table 'onemap_postal_codes' if DB available
                    try:
                        if self._db is None:
                            self._db = DatabaseConnection()
                        self._db.upsert(
                            table="onemap_postal_codes",
                            data=newly_resolved,
                            on_conflict="postal",
                        )
                        logger.info("Upserted new postal entries to Supabase (onemap_postal_codes)")
                    except Exception as e:
                        logger.warning(f"Supabase upsert of postal cache failed: {e}")
            except Exception as e:
                logger.warning(f"Error while persisting new postal geocodes: {e}")

        # Persist unique postal misses for investigation
        try:
            unique_miss_postals = [
                p for p, latlon in results_cache.items() if not latlon or latlon[0] is None or latlon[1] is None
            ]
            if unique_miss_postals:
                miss_df = pd.DataFrame({"postal_code": sorted(set(unique_miss_postals))})
                self.out_dir.mkdir(parents=True, exist_ok=True)
                miss_path = self.out_dir / "acra_unmatched_unique_postal.csv"
                miss_df.to_csv(miss_path, index=False)
                logger.info(
                    f"Saved unique unmatched postal list → {miss_path} ({len(miss_df)} unique postals)"
                )
        except Exception as e:
            logger.warning(f"Failed to write acra_unmatched_unique_postal.csv: {e}")

        # Persist updated CSV
        try:
            ordered = [
                "uen",
                "amenity_name",
                "street_name",
                "building_name",
                "postal_code",
                "entity_status_description",
                "latitude",
                "longitude",
            ]
            cols = [c for c in ordered if c in df_out.columns] + [c for c in df_out.columns if c not in ordered]
            df_out = df_out[cols]
            self.out_dir.mkdir(parents=True, exist_ok=True)
            out_path = self.out_dir / self.out_csv
            df_out.to_csv(out_path, index=False)
            logger.info(f"Updated CSV with geocodes → {out_path}")

            # Only write to the ACRA data directory (no duplicate central copy)

            # Also persist unmatched rows for separate batch geocoding
            unmatched = df_out[(df_out["latitude"].isna()) | (df_out["longitude"].isna())].copy()
            unmatched = unmatched[unmatched["postal_code"].astype(str).str.fullmatch(r"\d{6}") == True]
            unmatched_path = self.out_dir / "acra_unmatched_postal.csv"
            unmatched.to_csv(unmatched_path, index=False)
            logger.info(f"Wrote unmatched postal rows → {unmatched_path} ({len(unmatched)} rows)")
        except Exception as e:
            logger.warning(f"Failed to write updated CSV: {e}")

        logger.info("OneMap geocoding summary: CSV=%s, API=%s, Miss=%s", csv_hits, api_hits, misses)

        # ===== Three-Layer Spatial Geocoding =====
        # Add pa_id, sz_id, rn_id using spatial joins
        logger.info("=" * 80)
        logger.info("Starting three-layer spatial geocoding (pa_id, sz_id, rn_id)...")
        logger.info("=" * 80)

        try:
            # Get default GeoJSON paths
            geojson_paths = get_default_geojson_paths()

            # Apply spatial geocoding to add pa_id, sz_id, rn_id
            df_out = add_three_layer_geocoding(
                df_out,
                lat_col="latitude",
                lon_col="longitude",
                planning_geojson=geojson_paths['planning_geojson'],
                subzone_geojson=geojson_paths['subzone_geojson'],
                road_network_geojson=geojson_paths['road_network_geojson'],
            )

            logger.info("=" * 80)
            logger.info("Three-layer geocoding complete!")
            logger.info(f"  • pa_id populated: {df_out['pa_id'].notna().sum():,} / {len(df_out):,}")
            logger.info(f"  • sz_id populated: {df_out['sz_id'].notna().sum():,} / {len(df_out):,}")
            logger.info(f"  • rn_id populated: {df_out['rn_id'].notna().sum():,} / {len(df_out):,}")
            logger.info("=" * 80)

            # Filter out excluded planning areas (24, 27, 31)
            excluded_pa_ids = [24, 27, 31]
            before_filter = len(df_out)
            df_out = df_out[~df_out['pa_id'].isin(excluded_pa_ids)]
            filtered_count = before_filter - len(df_out)

            if filtered_count > 0:
                logger.info(f"Filtered out {filtered_count:,} records with excluded pa_id (24, 27, 31)")
                logger.info(f"Remaining records: {len(df_out):,}")
            else:
                logger.info("No records matched excluded planning areas (24, 27, 31)")

            # Drop road_name if it exists (not in ACRA schema)
            if 'road_name' in df_out.columns:
                df_out = df_out.drop(columns=['road_name'])

            # Write updated CSV with three-layer data
            out_path = self.out_dir / self.out_csv
            df_out.to_csv(out_path, index=False)
            logger.info(f"Updated CSV with three-layer geocoding → {out_path}")

        except Exception as e:
            logger.error(f"Three-layer spatial geocoding failed: {e}", exc_info=True)
            logger.warning("Continuing without three-layer geocoding (pa_id, sz_id, rn_id will be null)")

        # Deduplicate by UEN (spatial joins can create multiple rows per company)
        logger.info("=" * 80)
        logger.info("Deduplicating records by UEN...")
        before_dedup = len(df_out)
        df_out = df_out.drop_duplicates(subset=['uen'], keep='first')
        after_dedup = len(df_out)
        duplicates_removed = before_dedup - after_dedup
        logger.info(f"Removed {duplicates_removed:,} duplicate UEN records")
        logger.info(f"Final record count: {after_dedup:,} unique companies")
        logger.info("=" * 80)

        # Lowercase all text fields for consistency
        text_columns = ['amenity_name', 'street_name', 'building_name', 'planning_area', 'subzone']
        for col in text_columns:
            if col in df_out.columns:
                df_out[col] = df_out[col].astype(str).str.lower().str.strip()
                # Replace 'nan' string with empty string
                df_out[col] = df_out[col].replace('nan', '')
        logger.info("Lowercased all text fields")

        # Drop road_name if it exists (not in ACRA schema)
        if 'road_name' in df_out.columns:
            df_out = df_out.drop(columns=['road_name'])

        # Define final column order matching database schema
        ordered = [
            "id",
            "uen",
            "amenity_name",
            "street_name",
            "building_name",
            "postal_code",
            "latitude",
            "longitude",
            "pa_id",
            "sz_id",
            "rn_id",
            "planning_area",
            "subzone",
        ]

        # Don't include ID column - let database auto-generate
        # UEN will be used for upsert conflict resolution
        ordered_without_id = [col for col in ordered if col != 'id']
        df_out = df_out[ordered_without_id]
        logger.info(f"Prepared {len(df_out):,} records for database upsert (ID will be auto-generated)")

        # Update CSV with deduplicated data
        try:
            out_path = self.out_dir / self.out_csv
            df_out.to_csv(out_path, index=False)
            logger.info(f"Updated CSV with deduplicated data → {out_path}")
        except Exception as e:
            logger.warning(f"Failed to write deduplicated CSV: {e}")

        # Return as list of dicts to the next stage
        return df_out.to_dict("records")
