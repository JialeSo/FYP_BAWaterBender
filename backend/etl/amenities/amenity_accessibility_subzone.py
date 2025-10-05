"""Subzone-based amenity accessibility utilities without hexagon grids."""
from __future__ import annotations

from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

import geopandas as gpd
import numpy as np
import pandas as pd

from backend.etl.amenities.amenity_accessibility import (
    AccessibilityCalculator,
    AccessibilityPlotter,
    AmenityDataRepository,
    DatasetPaths,
    DEFAULT_SUBZONE_CATEGORIES,
    _normalise_token,
)


class _SubzoneResolver:
    def __init__(self, repository: AmenityDataRepository) -> None:
        self._repository = repository

    def resolve(self, selector: str) -> gpd.GeoDataFrame:
        if not selector or not selector.strip():
            raise ValueError("subzone selector must be provided")

        subzones = self._repository.subzones()
        cleaned = selector.strip()
        normalised = _normalise_token(cleaned)

        def _norm(series: pd.Series) -> pd.Series:
            return series.fillna("").astype(str).map(_normalise_token)

        exact_mask = (
            subzones["SUBZONE_N"].fillna("").str.casefold().eq(cleaned.casefold())
            | subzones["PLN_AREA_N"].fillna("").str.casefold().eq(cleaned.casefold())
        )
        matches = subzones[exact_mask]

        if matches.empty and normalised:
            norm_mask = (
                _norm(subzones["SUBZONE_N"]) == normalised
                | _norm(subzones["PLN_AREA_N"]) == normalised
            )
            matches = subzones[norm_mask]

        if matches.empty:
            contains_mask = (
                subzones["SUBZONE_N"].fillna("").str.contains(cleaned, case=False)
                | subzones["PLN_AREA_N"].fillna("").str.contains(cleaned, case=False)
            )
            matches = subzones[contains_mask]

        if matches.empty:
            raise ValueError(f"No subzones found matching '{selector}'.")

        return matches.copy()


class SubzoneAmenityAccessibilityService:
    """Compute accessibility scores directly on subzone polygons."""

    def __init__(
        self,
        *,
        repository: Optional[AmenityDataRepository] = None,
        paths: Optional[DatasetPaths] = None,
        calculator: Optional[AccessibilityCalculator] = None,
        plotter: Optional[AccessibilityPlotter] = None,
    ) -> None:
        if repository is None:
            repository = AmenityDataRepository(paths or DatasetPaths())
        self.repository = repository
        self.calculator = calculator or AccessibilityCalculator()
        self.plotter = plotter or AccessibilityPlotter()
        self._resolver = _SubzoneResolver(self.repository)

    def analyze_subzones(
        self,
        selectors: Sequence[str],
        *,
        categories: Sequence[str] = DEFAULT_SUBZONE_CATEGORIES,
        metric: str = "hansen",
        plot: bool = False,
    ) -> List[Tuple[str, pd.DataFrame]]:
        outputs: List[Tuple[str, pd.DataFrame]] = []
        for selector in selectors:
            _, summary = self.analyze_single_subzone(
                selector,
                categories=categories,
                metric=metric,
                plot=plot,
            )
            outputs.append((selector, summary))
        return outputs

    def analyze_single_subzone(
        self,
        selector: str,
        *,
        categories: Sequence[str] = DEFAULT_SUBZONE_CATEGORIES,
        metric: str = "hansen",
        plot: bool = False,
    ) -> Tuple[List[Tuple[str, gpd.GeoDataFrame]], pd.DataFrame]:
        subzones = self._resolver.resolve(selector)
        amenities_repo = self.repository

        category_results: List[Tuple[str, gpd.GeoDataFrame]] = []
        summary_rows: List[dict] = []

        for category in categories:
            amenities = amenities_repo.amenities_by_category(category)
            result = self._compute_subzone_accessibility(subzones, amenities, metric)
            category_results.append((category, result))

            values = pd.Series(result["accessibility"]).replace([np.inf, -np.inf], np.nan).fillna(0)
            summary_rows.append(
                {
                    "Category": category,
                    "Min": float(values.min()) if len(values) else 0.0,
                    "Max": float(values.max()) if len(values) else 0.0,
                    "Mean": float(values.mean()) if len(values) else 0.0,
                }
            )

            if plot:
                title = f"Accessibility in {selector} ({category.replace('_', ' ').title()})"
                self.plotter.subzone_map(result, amenities, subzones, title)

        summary_df = pd.DataFrame(summary_rows)
        return category_results, summary_df

    def detect_subzone(self, selector: str) -> gpd.GeoDataFrame:
        return self._resolver.resolve(selector)

    def _compute_subzone_accessibility(
        self,
        subzones: gpd.GeoDataFrame,
        amenities: gpd.GeoDataFrame,
        metric: str,
    ) -> gpd.GeoDataFrame:
        subzones = subzones.copy()

        if subzones.empty:
            return subzones.assign(accessibility=np.nan)

        points = subzones.copy()
        points["geometry"] = points.geometry.representative_point()
        points["demand"] = 1.0

        dists_km, idxs = self.calculator.distance_matrix(points, amenities)

        if metric == "hansen":
            accessibility = self.calculator.hansen_accessibility(points, amenities, dists_km, idxs)
        elif metric == "distance":
            accessibility = self.calculator.mean_distance(dists_km)
        else:
            raise ValueError("metric must be 'hansen' or 'distance'")

        result = subzones.copy()
        result["accessibility"] = accessibility
        return result


__all__ = ["SubzoneAmenityAccessibilityService"]
