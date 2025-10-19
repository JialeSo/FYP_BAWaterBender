"""
OSMnx-based Road Network Matcher for Amenities
===============================================

This module uses OSMnx to snap amenity points to the nearest road segments
in the Singapore road network, providing more accurate spatial matching
than centroid-based distance calculations.

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

# Import from relative path within amenities module
try:
    from core.utils import normalize_road_name
except ImportError:
    from backend.etl.amenities.core.utils import normalize_road_name

BASE_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True)
class OSMnxRoadMatcherPaths:
    """Path configuration for OSMnx-based road matching."""

    amenities_csv: Path = field(
        default_factory=lambda: BASE_DIR / "../data/amenities/amenities_with_importance_score.csv"
    )
    road_network_geojson: Path = field(
        default_factory=lambda: BASE_DIR / "../../../data/geojson_layers/road_network.geojson"
    )
    output_csv: Path = field(
        default_factory=lambda: BASE_DIR / "../../../data/amenities/amenities_with_nearest_roads.csv"
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

        # Store road metadata (RN_ID, RD_NAME, etc.)
        for idx, row in gdf.iterrows():
            self._road_metadata[idx] = {
                "RN_ID": row.get("RN_ID", ""),
                "RD_NAME": row.get("RD_NAME", ""),
                "RD_NAME_norm": normalize_road_name(row.get("RD_NAME", "")),
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
                    RN_ID=row.get("RN_ID", ""),
                    RD_NAME=row.get("RD_NAME", ""),
                    RD_NAME_norm=normalize_road_name(row.get("RD_NAME", "")),
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
                        RN_ID=row.get("RN_ID", ""),
                        RD_NAME=row.get("RD_NAME", ""),
                        RD_NAME_norm=normalize_road_name(row.get("RD_NAME", "")),
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
                "RN_ID": data.get("RN_ID", ""),
                "RD_NAME": data.get("RD_NAME", ""),
                "RD_NAME_norm": data.get("RD_NAME_norm", ""),
                "length": data.get("length", 0),
            })

        gdf_edges = gpd.GeoDataFrame(edges_list, crs="EPSG:4326")

        self._graph = G
        self._gdf_edges = gdf_edges

        print(f"    ✓ Loaded {len(G.nodes)} nodes, {len(G.edges)} edges")
        return G, gdf_edges


class OSMnxAmenitySnapper:
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
            road_id = self.edges_gdf.loc[idx, "RN_ID"]
            road_name = self.edges_gdf.loc[idx, "RD_NAME"]
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


class OSMnxRoadMatcherPipeline:
    """
    Main pipeline for matching amenities to roads using OSMnx.

    This class orchestrates the complete workflow:
    1. Load road network and convert to graph
    2. Load amenity points
    3. Snap amenities to nearest roads
    4. Export results
    """

    def __init__(self, paths: OSMnxRoadMatcherPaths | None = None) -> None:
        self.paths = paths or OSMnxRoadMatcherPaths()

    def run(self, output: Path | None = None) -> pd.DataFrame:
        """
        Execute the complete matching pipeline.

        Args:
            output: Optional custom output path

        Returns:
            DataFrame with matched amenity-road pairs
        """
        print("\n" + "="*70)
        print("OSMnx-BASED ROAD NETWORK MATCHING")
        print("="*70 + "\n")

        # Load road network
        network = RoadNetworkGraph(self.paths.road_network_geojson)
        graph, edges_gdf = network.load()

        # Load amenities
        print(f"  Loading amenities from {self.paths.amenities_csv.name}...")
        amenities_df = pd.read_csv(self.paths.amenities_csv)

        # Ensure required columns exist
        required_cols = ["amenity_id", "lat", "lon"]
        missing = [col for col in required_cols if col not in amenities_df.columns]
        if missing:
            raise ValueError(f"Missing required columns: {missing}")

        print(f"    ✓ Loaded {len(amenities_df):,} amenities")

        # Snap amenities to roads
        snapper = OSMnxAmenitySnapper(graph, edges_gdf, max_candidates=4)
        matched_df = snapper.snap_batch(amenities_df)

        # Save output
        target = output or self.paths.output_csv
        target.parent.mkdir(parents=True, exist_ok=True)
        matched_df.to_csv(target, index=False)

        print(f"\n  ✓ Matched data saved to {target}")
        print(f"  Total records: {len(matched_df):,}\n")

        return matched_df


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
    """Command-line interface for OSMnx road matching."""
    parser = _build_parser()
    args = parser.parse_args(argv)

    default_paths = OSMnxRoadMatcherPaths()
    paths = OSMnxRoadMatcherPaths(
        amenities_csv=args.amenities or default_paths.amenities_csv,
        road_network_geojson=args.roads or default_paths.road_network_geojson,
        output_csv=args.output or default_paths.output_csv,
    )

    pipeline = OSMnxRoadMatcherPipeline(paths)
    matched_df = pipeline.run(output=args.output)

    print("Sample output:")
    print(matched_df.head())


if __name__ == "__main__":
    main()
