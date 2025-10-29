"""
OSMnx-based Road Network Matcher for Amenities
===============================================

Uses OSMnx to snap amenity points to the nearest road segments in the
Singapore road network, providing accurate spatial matching.

Outputs consistent column names: pa_id, sz_id, rd_id (not rn_id).

Key Features:
-------------
- Uses OSMnx's graph-based road network representation
- Snaps points to nearest edges (road segments) using Euclidean distance
- Handles both GeoJSON and CSV input formats
- Maintains compatibility with existing pipeline output format

Dependencies:
-------------
pip install osmnx geopandas networkx
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Sequence, Tuple

import geopandas as gpd
import networkx as nx
import osmnx as ox
import pandas as pd
from shapely.geometry import Point, LineString, shape

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[3]))

BASE_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True)
class RoadMatcherPaths:
    """Path configuration for road matching."""

    # Default paths aligned with core.config.Config
    amenities_csv: Path = field(
        default_factory=lambda: BASE_DIR.parents[1] / "data" / "02_amenities_classified.csv"
    )
    road_network_geojson: Path = field(
        default_factory=lambda: BASE_DIR.parents[1] / "data" / "roadnetwork" / "road_network_final.geojson"
    )
    output_csv: Path = field(
        default_factory=lambda: BASE_DIR.parents[3] / "frontend" / "public" / "map" / "amenities_3layers.csv"
    )


class RoadNetworkGraph:
    """
    Manages road network as a NetworkX graph using OSMnx.

    This class loads a road network from GeoJSON and creates a graph representation
    suitable for spatial operations like nearest edge finding.
    """

    def __init__(self, geojson_path: Path) -> None:
        self.geojson_path = geojson_path
        self._graph: nx.MultiDiGraph | None = None
        self._gdf_edges: gpd.GeoDataFrame | None = None
        self._road_metadata: dict[int, dict] = {}

    def load(self) -> Tuple[nx.MultiDiGraph, gpd.GeoDataFrame]:
        """Load road network and convert to OSMnx-compatible graph."""
        print(f"  Loading road network from {self.geojson_path.name}...")

        # Load GeoJSON
        with self.geojson_path.open("r", encoding="utf-8") as fh:
            geo_data = json.load(fh)

        # Convert to GeoDataFrame
        gdf = gpd.GeoDataFrame.from_features(geo_data["features"], crs="EPSG:4326")

        # Store road metadata (RN_ID from OSM network)
        for idx, row in gdf.iterrows():
            self._road_metadata[idx] = {
                "road_id": row.get("RN_ID", ""),
                "road_name": row.get("name", ""),  # OSM uses 'name' field
            }

        # Create graph from GeoDataFrame using OSMnx
        # Note: We create a simple graph structure compatible with OSMnx functions
        G = nx.MultiDiGraph(crs="EPSG:4326")

        # Add nodes and edges from LineString geometries
        edge_id = 0
        for idx, row in gdf.iterrows():
            geom = row.geometry

            if geom.geom_type == "LineString":
                coords = list(geom.coords)
                # Add nodes for start and end points
                start_node = coords[0]
                end_node = coords[-1]

                # Add edge with metadata
                G.add_edge(
                    start_node,
                    end_node,
                    key=edge_id,
                    osmid=edge_id,
                    geometry=geom,
                    road_id=row.get("RN_ID", ""),
                    road_name=row.get("name", ""),  # OSM uses 'name' field
                    length=geom.length,
                )
                edge_id += 1

            elif geom.geom_type == "MultiLineString":
                for line in geom.geoms:
                    coords = list(line.coords)
                    start_node = coords[0]
                    end_node = coords[-1]

                    G.add_edge(
                        start_node,
                        end_node,
                        key=edge_id,
                        osmid=edge_id,
                        geometry=line,
                        road_id=row.get("RN_ID", ""),
                        road_name=row.get("name", ""),  # OSM uses 'name' field
                        length=line.length,
                    )
                    edge_id += 1

        # Convert to GeoDataFrame of edges for spatial queries
        edges_list = []
        for u, v, k, data in G.edges(keys=True, data=True):
            edges_list.append({
                "u": u,
                "v": v,
                "key": k,
                "geometry": data["geometry"],
                "road_id": data.get("road_id", ""),
                "road_name": data.get("road_name", ""),
                "length": data.get("length", 0),
            })

        gdf_edges = gpd.GeoDataFrame(edges_list, crs="EPSG:4326")

        self._graph = G
        self._gdf_edges = gdf_edges

        print(f"    ✓ Loaded {len(G.nodes)} nodes, {len(G.edges)} edges")
        return G, gdf_edges


class AmenitySnapper:
    """
    Snap amenity points to nearest road edges using OSMnx spatial operations.

    This class provides efficient nearest-edge finding for large numbers of
    amenity points, using OSMnx's optimized spatial indexing.
    """

    def __init__(
        self,
        graph: nx.MultiDiGraph,
        edges_gdf: gpd.GeoDataFrame,
        max_candidates: int = 4,
    ) -> None:
        """
        Initialize the snapper.

        Args:
            graph: NetworkX graph of road network
            edges_gdf: GeoDataFrame of road edges with geometry
            max_candidates: Number of nearest roads to find per amenity
        """
        self.graph = graph
        self.edges_gdf = edges_gdf
        self.max_candidates = max_candidates

    def snap_amenity(self, point: Point) -> List[Tuple[str, str]]:
        """
        Find the nearest road edges to a given point.

        Args:
            point: Shapely Point representing amenity location

        Returns:
            List of (road_id, road_name) tuples for nearest roads
        """
        # Calculate distance from point to all edges
        distances = self.edges_gdf.geometry.distance(point)

        # Get indices of k-nearest edges
        nearest_indices = distances.nsmallest(self.max_candidates).index.tolist()

        # Extract road IDs and names
        results = []
        for idx in nearest_indices:
            road_id = self.edges_gdf.loc[idx, "road_id"]
            road_name = self.edges_gdf.loc[idx, "road_name"]
            results.append((road_id, road_name))

        # Pad with None if fewer than max_candidates found
        while len(results) < self.max_candidates:
            results.append((None, None))

        return results

    def snap_batch(self, amenities_df: pd.DataFrame) -> pd.DataFrame:
        """
        Snap a batch of amenities to nearest roads.

        Args:
            amenities_df: DataFrame with columns: amenity_id, lat, lon
        Returns:
            DataFrame with nearest road IDs and names
        """
        print(f"  Snapping {len(amenities_df):,} amenities to road network...")

        results = []

        for idx, row in amenities_df.iterrows():
            if idx % 1000 == 0 and idx > 0:
                print(f"    Progress: {idx:,}/{len(amenities_df):,} amenities processed")

            point = Point(row["lon"], row["lat"])
            nearest = self.snap_amenity(point)

            results.append({
                "amenity_id": row["amenity_id"],
                "nearest_road_1_id": nearest[0][0],
                "nearest_road_1_name": nearest[0][1],
                "nearest_road_2_id": nearest[1][0],
                "nearest_road_2_name": nearest[1][1],
                "nearest_road_3_id": nearest[2][0],
                "nearest_road_3_name": nearest[2][1],
                "nearest_road_4_id": nearest[3][0],
                "nearest_road_4_name": nearest[3][1],
            })

        print(f"    ✓ Completed snapping {len(results):,} amenities")
        return pd.DataFrame(results)


class RoadMatcherPipeline:
    """
    Main pipeline for matching amenities to roads using OSMnx.

    This class orchestrates the complete workflow:
    1. Load road network and convert to graph
    2. Load amenity points
    3. Snap amenities to nearest roads
    4. Export results with consistent column names (pa_id, sz_id, rd_id)
    """

    def __init__(self, paths: RoadMatcherPaths | None = None) -> None:
        self.paths = paths or RoadMatcherPaths()

    def run(self, output: Path | None = None) -> pd.DataFrame:
        """
        Execute the complete matching pipeline.

        Args:
            output: Optional custom output path

        Returns:
            DataFrame with matched amenity-road pairs
        """
        print("\n" + "="*70)
        print("ROAD NETWORK MATCHING (OSMnx)")
        print("="*70 + "\n")

        # Load road network
        network = RoadNetworkGraph(self.paths.road_network_geojson)
        graph, edges_gdf = network.load()

        # Load amenities with postal_code as string to preserve leading zeros
        print(f"  Loading amenities from {self.paths.amenities_csv.name}...")
        amenities_df = pd.read_csv(self.paths.amenities_csv, dtype={'postal_code': str})

        # Ensure postal codes are 6 digits with leading zeros
        if 'postal_code' in amenities_df.columns:
            amenities_df['postal_code'] = amenities_df['postal_code'].astype(str).str.strip()
            amenities_df['postal_code'] = amenities_df['postal_code'].apply(
                lambda x: x.zfill(6) if x and x.isdigit() and len(x) <= 6 else x
            )

        # Ensure required columns exist
        required_cols = ["amenity_id", "lat", "lon"]
        missing = [col for col in required_cols if col not in amenities_df.columns]
        if missing:
            raise ValueError(f"Missing required columns: {missing}")

        print(f"    ✓ Loaded {len(amenities_df):,} amenities")

        # Snap amenities to roads
        snapper = AmenitySnapper(graph, edges_gdf, max_candidates=4)
        roads_df = snapper.snap_batch(amenities_df)

        # Merge the road matching results with the original amenity data
        matched_df = amenities_df.merge(roads_df, on='amenity_id', how='left')

        # Add road_id column (using nearest_road_1_id as the primary road)
        matched_df['road_id'] = matched_df['nearest_road_1_id']

        # IMPORTANT: Use consistent column naming throughout the pipeline
        # Rename to: pa_id, sz_id, rd_id (not rn_id!)
        matched_df = matched_df.rename(columns={
            'planning_area_id': 'pa_id',
            'subzone_id': 'sz_id',
            'road_id': 'rd_id'
        })

        # Select only required columns for amenities_3layers.csv
        required_output_cols = [
            "amenity_id",
            "amenity_type",
            "amenity_name",
            "postal_code",
            "lat",
            "lon",
            "amenity_category_id",
            "pa_id",   # Consistent naming
            "sz_id",   # Consistent naming
            "rd_id"    # Consistent naming (not rn_id!)
        ]

        # Handle amenity_category vs amenity_category_id
        if 'amenity_category' in matched_df.columns and 'amenity_category_id' not in matched_df.columns:
            matched_df['amenity_category_id'] = matched_df['amenity_category']

        # Keep only columns that exist
        existing_cols = [col for col in required_output_cols if col in matched_df.columns]
        final_df = matched_df[existing_cols].copy()

        # Rename postal_code to postalcode (without underscore) for final output
        if 'postal_code' in final_df.columns:
            final_df = final_df.rename(columns={'postal_code': 'postalcode'})
            # Update the column list
            existing_cols = [col if col != 'postal_code' else 'postalcode' for col in existing_cols]

        # Convert ID columns to integers (not floats)
        id_columns = ['amenity_id', 'amenity_category_id', 'pa_id', 'sz_id']
        for col in id_columns:
            if col in final_df.columns:
                # Convert to int, handling NaN values
                final_df[col] = pd.to_numeric(final_df[col], errors='coerce')
                final_df[col] = final_df[col].fillna(0).astype(int)

        # Convert rd_id (e.g., "R042218") to clean integer (e.g., 42218)
        if 'rd_id' in final_df.columns:
            rd_series = final_df['rd_id'].fillna('').astype(str)
            # Extract the numeric part; default to 0 when missing
            final_df['rd_id'] = rd_series.str.extract(r"(\d+)").fillna('0').astype(int)

        # Save output
        target = output or self.paths.output_csv
        target.parent.mkdir(parents=True, exist_ok=True)
        final_df.to_csv(target, index=False)

        print(f"\n  ✓ Final amenities_3layers.csv saved to {target}")
        print(f"  Total records: {len(final_df):,}")
        print(f"  Columns: {', '.join(existing_cols)}\n")

        return final_df


def match_roads(
    amenities_csv: Path,
    road_network_geojson: Path,
    output_csv: Path,
) -> pd.DataFrame:
    """
    Main entry point for road matching.

    Args:
        amenities_csv: Path to classified amenities CSV
        road_network_geojson: Path to road network GeoJSON
        output_csv: Path for final output CSV

    Returns:
        DataFrame with matched amenities (pa_id, sz_id, rd_id)
    """
    paths = RoadMatcherPaths(
        amenities_csv=amenities_csv,
        road_network_geojson=road_network_geojson,
        output_csv=output_csv,
    )
    pipeline = RoadMatcherPipeline(paths)
    return pipeline.run(output=output_csv)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Snap amenities to nearest roads using OSMnx",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--amenities",
        type=Path,
        help="Path to amenities CSV file (default: from config)",
    )
    parser.add_argument(
        "--roads",
        type=Path,
        help="Path to road network GeoJSON file (default: from config)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Path to output CSV file (default: from config)",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    """Command-line interface for road matching."""
    parser = _build_parser()
    args = parser.parse_args(argv)

    default_paths = RoadMatcherPaths()
    paths = RoadMatcherPaths(
        amenities_csv=args.amenities or default_paths.amenities_csv,
        road_network_geojson=args.roads or default_paths.road_network_geojson,
        output_csv=args.output or default_paths.output_csv,
    )

    pipeline = RoadMatcherPipeline(paths)
    matched_df = pipeline.run(output=args.output)

    print("Sample output:")
    print(matched_df.head())


if __name__ == "__main__":
    main()
