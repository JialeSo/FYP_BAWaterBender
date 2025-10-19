"""
Composite accessibility fusion logic (Step 05).

This module consumes the long-form accessibility outputs from Step 04 and
produces:
    • Normalised (0–100) scores for each model per category
    • A weighted composite accessibility index
    • Agreement diagnostics (spread, standard deviation, rank spread)
    • Narrative labels suitable for executive reporting

It also enriches the consolidated amenities dataset with the new fields so
downstream analytics can reuse the composite results.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, Mapping, Optional

import numpy as np
import pandas as pd


DEFAULT_WEIGHTS: Mapping[str, float] = {
    "2sfca": 0.5,
    "hansen": 0.3,
    "cumulative": 0.2,
}

BASE_AMENITY_COLUMNS: tuple[str, ...] = (
    "amenity_id",
    "amenity_type",
    "amenity_name",
    "amenity_category",
    "primary_road_id",
    "primary_road_name",
    "planning_area",
    "subzone",
    "road_name",
    "postal_code",
    "lat",
    "lon",
    "geom_type",
    "source_file",
    "osm_type",
    "osm_id",
    "enrichment_status",
    "road_distance",
    "category",
    "amenity_priority",
    "amenity_weight",
    "importance_score",
    "importance_label",
    "nearest_road_1_id",
    "nearest_road_1_name",
    "nearest_road_2_id",
    "nearest_road_2_name",
    "nearest_road_3_id",
    "nearest_road_3_name",
    "nearest_road_4_id",
    "nearest_road_4_name",
    "road_match_count",
    "road_official_name",
    "road_planning_area_id",
    "road_subzone_id",
)

PLANNING_FINAL_COLUMNS: tuple[str, ...] = (
    "planning_access_composite_score",
    "planning_access_composite_percentile",
    "planning_access_composite_rank",
    "planning_access_importance_label",
    "planning_access_confidence_label",
    "planning_access_model_spread",
)

SUBZONE_FINAL_COLUMNS: tuple[str, ...] = (
    "subzone_access_composite_score",
    "subzone_access_composite_percentile",
    "subzone_access_composite_rank",
    "subzone_access_importance_label",
    "subzone_access_confidence_label",
    "subzone_access_model_spread",
)


@dataclass(frozen=True)
class CompositeAccessibilityConfig:
    """Configuration for weighted accessibility fusion."""

    weights: Mapping[str, float] = field(default_factory=lambda: dict(DEFAULT_WEIGHTS))
    minmax_fallback: float = 50.0
    confidence_breaks: tuple[float, float] = (15.0, 30.0)  # spread thresholds (0–100)
    label_breaks: Dict[str, float] = field(
        default_factory=lambda: {
            "Well-served": 80.0,
            "Adequate": 60.0,
            "Needs improvement": 40.0,
            "Priority for action": -np.inf,
        }
    )

    def normalised_weights(self, available: Iterable[str]) -> Dict[str, float]:
        """Return weights restricted to available models and normalised to sum=1."""
        filtered = {k: v for k, v in self.weights.items() if k in available}
        total = sum(filtered.values())
        if total <= 0:
            return {k: 1.0 / len(list(available)) for k in available} if available else {}
        return {k: v / total for k, v in filtered.items()}


@dataclass(frozen=True)
class CompositeAccessibilityPaths:
    """Data sources and sinks for the fusion step."""

    planning_scores_csv: Path
    subzone_scores_csv: Optional[Path]
    planning_output_csv: Path
    subzone_output_csv: Optional[Path]
    amenities_input_csv: Path
    amenities_output_csv: Path
    amenities_final_csv: Optional[Path] = None


class AccessibilityFusionEngine:
    """Fuse multi-model accessibility outputs into composite indices."""

    def __init__(self, config: Optional[CompositeAccessibilityConfig] = None) -> None:
        self.config = config or CompositeAccessibilityConfig()

    # ------------------------------------------------------------------ #
    # Public entry points
    # ------------------------------------------------------------------ #
    def run(self, paths: CompositeAccessibilityPaths) -> Dict[str, pd.DataFrame]:
        """Execute fusion pipeline and return resulting dataframes."""
        results: Dict[str, pd.DataFrame] = {}

        if paths.planning_scores_csv.exists():
            planning_scores = pd.read_csv(paths.planning_scores_csv)
            planning_df = self._compute_level(
                planning_scores,
                entity_col="planning_area",
                output_entity_col="planning_area",
            )
            paths.planning_output_csv.parent.mkdir(parents=True, exist_ok=True)
            planning_df.to_csv(paths.planning_output_csv, index=False)
            results["planning"] = planning_df
        else:
            raise FileNotFoundError(f"Planning accessibility CSV not found: {paths.planning_scores_csv}")

        if paths.subzone_scores_csv and paths.subzone_scores_csv.exists():
            subzone_scores = pd.read_csv(paths.subzone_scores_csv)
            subzone_df = self._compute_level(
                subzone_scores,
                entity_col="subzone_name",
                output_entity_col="subzone",
                extra_meta_cols=["planning_area"],
            )
            paths.subzone_output_csv.parent.mkdir(parents=True, exist_ok=True)
            subzone_df.to_csv(paths.subzone_output_csv, index=False)
            results["subzone"] = subzone_df
        else:
            subzone_df = pd.DataFrame()
            results["subzone"] = subzone_df

        amenities = pd.read_csv(paths.amenities_input_csv, low_memory=False)
        enriched = self._enrich_amenities(
            amenities,
            planning_df=results.get("planning"),
            subzone_df=results.get("subzone"),
        )
        enriched.to_csv(paths.amenities_output_csv, index=False)
        if paths.amenities_final_csv:
            enriched.to_csv(paths.amenities_final_csv, index=False)
        results["amenities"] = enriched

        return results

    # ------------------------------------------------------------------ #
    # Core computations
    # ------------------------------------------------------------------ #
    def _compute_level(
        self,
        scores: pd.DataFrame,
        *,
        entity_col: str,
        output_entity_col: Optional[str] = None,
        extra_meta_cols: Optional[Iterable[str]] = None,
    ) -> pd.DataFrame:
        """Compute composite metrics for a geographic aggregation level."""
        required_cols = {entity_col, "category", "model", "score"}
        missing = required_cols.difference(scores.columns)
        if missing:
            missing_list = ", ".join(sorted(missing))
            raise KeyError(f"{entity_col} accessibility scores missing columns: {missing_list}")

        df = scores.copy()
        df = df.dropna(subset=[entity_col, "category", "model"])
        if df.empty:
            return pd.DataFrame(
                columns=[
                    output_entity_col or entity_col,
                    "category",
                    "category_norm",
                    "composite_score",
                ]
            )

        df["category_norm"] = self._normalize_category(df["category"])
        df["model_norm"] = df["model"].astype(str).str.lower().str.strip()

        base_group = ["category_norm", "model_norm"]
        df["score"] = pd.to_numeric(df["score"], errors="coerce")
        df = df.dropna(subset=["score"])

        df["score_norm"] = df.groupby(base_group)["score"].transform(
            lambda s: self._minmax_scale(s)
        )

        norm_pivot = (
            df.pivot_table(
                index=[entity_col, "category_norm"],
                columns="model_norm",
                values="score_norm",
                aggfunc="mean",
            )
            .rename_axis(None, axis=1)
            .reset_index()
        )

        raw_pivot = (
            df.pivot_table(
                index=[entity_col, "category_norm"],
                columns="model_norm",
                values="score",
                aggfunc="mean",
            )
            .rename_axis(None, axis=1)
            .reset_index()
        )

        merged = norm_pivot.merge(
            raw_pivot,
            on=[entity_col, "category_norm"],
            how="left",
            suffixes=("_norm", "_raw"),
        )

        available_models = [
            col.replace("_norm", "")
            for col in merged.columns
            if col.endswith("_norm") and col not in {entity_col, "category_norm"}
        ]

        weights = self.config.normalised_weights(available_models)
        weight_total = sum(weights.values())

        def _composite_row(row: pd.Series) -> float:
            if not weights or weight_total <= 0:
                return np.nan
            score_sum = 0.0
            for model, weight in weights.items():
                value = row.get(f"{model}_norm")
                if pd.notna(value):
                    score_sum += weight * value
            return score_sum

        merged["composite_score"] = merged.apply(_composite_row, axis=1)

        norm_cols = [f"{model}_norm" for model in available_models]
        merged["model_min_norm"] = merged[norm_cols].min(axis=1, numeric_only=True)
        merged["model_max_norm"] = merged[norm_cols].max(axis=1, numeric_only=True)
        merged["model_spread"] = merged["model_max_norm"] - merged["model_min_norm"]
        merged["model_std_norm"] = merged[norm_cols].std(axis=1, ddof=0, numeric_only=True)

        merged["dominant_model"] = merged[norm_cols].idxmax(axis=1, numeric_only=True)
        merged["laggard_model"] = merged[norm_cols].idxmin(axis=1, numeric_only=True)
        merged["dominant_model"] = (
            merged["dominant_model"]
            .fillna("")
            .astype(str)
            .str.replace("_norm", "", regex=False)
            .replace({"nan": "", "": np.nan})
        )
        merged["laggard_model"] = (
            merged["laggard_model"]
            .fillna("")
            .astype(str)
            .str.replace("_norm", "", regex=False)
            .replace({"nan": "", "": np.nan})
        )

        # Ranking diagnostics
        for model in available_models:
            merged[f"rank_{model}"] = merged.groupby("category_norm")[f"{model}_norm"].rank(
                method="min", ascending=False
            )

        rank_cols = [f"rank_{model}" for model in available_models]
        if rank_cols:
            merged["rank_median"] = merged[rank_cols].median(axis=1, numeric_only=True)
            merged["rank_mean"] = merged[rank_cols].mean(axis=1, numeric_only=True)
            merged["rank_spread"] = merged[rank_cols].max(axis=1, numeric_only=True) - merged[
                rank_cols
            ].min(axis=1, numeric_only=True)

        merged["composite_rank"] = merged.groupby("category_norm")["composite_score"].rank(
            method="min", ascending=False
        )
        merged["composite_percentile"] = (
            merged.groupby("category_norm")["composite_score"]
            .rank(method="average", pct=True)
            .mul(100.0)
        )

        merged["pareto_priority"] = (merged[norm_cols] <= 40.0).all(axis=1)

        merged["confidence_label"] = merged["model_spread"].apply(self._confidence_label)
        merged["importance_label"] = merged["composite_score"].apply(self._importance_label)

        identity_cols = {entity_col, "category_norm"}
        if extra_meta_cols:
            identity_cols.update(extra_meta_cols)
            meta = (
                scores[[entity_col] + list(extra_meta_cols)]
                .dropna(subset=[entity_col])
                .drop_duplicates(subset=[entity_col])
            )
            merged = merged.merge(meta, on=entity_col, how="left")

        merged["category"] = merged["category_norm"]

        output_col = output_entity_col or entity_col
        if output_col != entity_col:
            merged = merged.rename(columns={entity_col: output_col})
            identity_cols.discard(entity_col)
            identity_cols.add(output_col)

        ordered_columns = [output_col, "category", "category_norm", "composite_score"]
        for col in [
            "composite_percentile",
            "composite_rank",
            "importance_label",
            "confidence_label",
            "model_spread",
            "model_std_norm",
            "dominant_model",
            "laggard_model",
            "rank_median",
            "rank_mean",
            "rank_spread",
            "pareto_priority",
            "model_min_norm",
            "model_max_norm",
        ]:
            if col in merged.columns:
                ordered_columns.append(col)

        for model in available_models:
            norm_column = f"{model}_norm"
            raw_column = f"{model}_raw"
            if norm_column in merged.columns:
                ordered_columns.append(norm_column)
            if raw_column in merged.columns:
                ordered_columns.append(raw_column)
            rank_col = f"rank_{model}"
            if rank_col in merged.columns:
                ordered_columns.append(rank_col)

        for extra in extra_meta_cols or []:
            if extra in merged.columns and extra not in ordered_columns:
                ordered_columns.append(extra)

        return merged[ordered_columns].sort_values([output_col, "category_norm"]).reset_index(drop=True)

    # ------------------------------------------------------------------ #
    # Dataset enrichment
    # ------------------------------------------------------------------ #
    def _enrich_amenities(
        self,
        amenities: pd.DataFrame,
        *,
        planning_df: Optional[pd.DataFrame],
        subzone_df: Optional[pd.DataFrame],
    ) -> pd.DataFrame:
        """Attach composite accessibility columns to the amenity master table."""
        df = amenities.copy()

        # Drop stale accessibility columns before adding refreshed ones
        drop_prefixes = ("planning_access_", "subzone_access_")
        stale_cols = [col for col in df.columns if col.startswith(drop_prefixes)]
        if stale_cols:
            df = df.drop(columns=stale_cols, errors="ignore")

        df["_category_norm"] = self._normalize_category(
            df.get("amenity_category")
        )
        fallback = self._normalize_category(df.get("category"))
        df["_category_norm"] = df["_category_norm"].where(
            df["_category_norm"] != "",
            fallback,
        )

        if planning_df is not None and not planning_df.empty:
            prefixed_planning = self._apply_prefix(
                planning_df.copy(),
                prefix="planning_access",
                id_cols={"planning_area", "category_norm", "category"},
            )
        df = df.merge(
            prefixed_planning,
            left_on=["planning_area", "_category_norm"],
            right_on=["planning_area", "category_norm"],
            how="left",
        )
        df = df.drop(columns=["category_y", "category_norm"], errors="ignore")
        df = df.rename(columns={"category_x": "category"})

        # Fill defaults for planning-level fields so frontend does not receive NaNs
        df = self._fill_defaults(df, prefix="planning_access")

        if subzone_df is not None and not subzone_df.empty and "subzone" in df.columns:
            prefixed_subzone = self._apply_prefix(
                subzone_df.copy(),
                prefix="subzone_access",
                id_cols={"subzone", "category_norm", "category", "planning_area"},
            )
            df = df.merge(
                prefixed_subzone,
                left_on=["subzone", "_category_norm"],
                right_on=["subzone", "category_norm"],
                how="left",
                suffixes=("", "_subzone"),
            )
            df = df.drop(
                columns=["category_norm", "category_subzone", "planning_area_subzone"],
                errors="ignore",
            )

        # Ensure subzone defaults are populated after merge
        df = self._fill_defaults(df, prefix="subzone_access")

        df = df.drop(columns=["_category_norm"], errors="ignore")
        df = self._select_final_columns(df)
        return df

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _minmax_scale(self, series: pd.Series) -> pd.Series:
        """Apply min-max scaling to 0–100 with graceful fallback."""
        series = series.astype(float)
        valid = series.replace([np.inf, -np.inf], np.nan).dropna()
        if valid.empty:
            return pd.Series(self.config.minmax_fallback, index=series.index)

        min_val = valid.min()
        max_val = valid.max()
        span = max_val - min_val

        if span <= 0:
            return pd.Series(self.config.minmax_fallback, index=series.index)

        scaled = (series - min_val) / span * 100.0
        return scaled.clip(lower=0.0, upper=100.0)

    def _confidence_label(self, spread: float) -> str:
        """Categorise agreement based on spread between models."""
        if pd.isna(spread):
            return "Unknown"
        low, high = self.config.confidence_breaks
        if spread <= low:
            return "High agreement"
        if spread <= high:
            return "Moderate agreement"
        return "Low agreement"

    def _importance_label(self, score: float) -> str:
        """Map composite score to narrative label."""
        if pd.isna(score):
            return "Unclassified"

        for label, threshold in sorted(
            self.config.label_breaks.items(), key=lambda kv: kv[1], reverse=True
        ):
            if score >= threshold:
                return label
        return "Unclassified"

    @staticmethod
    def _normalize_category(series: Optional[pd.Series]) -> pd.Series:
        """Normalise category strings to snake_case."""
        if series is None:
            return pd.Series("", dtype=str)
        cleaned = (
            series.astype(str)
            .fillna("")
            .str.strip()
            .str.lower()
            .str.replace(r"\s+", "_", regex=True)
        )
        cleaned = cleaned.replace({"nan": "", "none": ""})
        return cleaned

    @staticmethod
    def _apply_prefix(
        df: pd.DataFrame,
        *,
        prefix: str,
        id_cols: Iterable[str],
    ) -> pd.DataFrame:
        """Prefix non-identity columns to avoid collisions during joins."""
        id_set = set(id_cols)
        rename_map = {
            col: f"{prefix}_{col}"
            for col in df.columns
            if col not in id_set
        }
        return df.rename(columns=rename_map)

    @staticmethod
    def _fill_defaults(df: pd.DataFrame, *, prefix: str) -> pd.DataFrame:
        """Fill default values for composite fields to keep downstream views tidy."""
        if df.empty:
            return df

        numeric_zero = [
            f"{prefix}_composite_score",
            f"{prefix}_composite_percentile",
            f"{prefix}_composite_rank",
            f"{prefix}_model_spread",
            f"{prefix}_model_std_norm",
            f"{prefix}_rank_median",
            f"{prefix}_rank_mean",
            f"{prefix}_rank_spread",
            f"{prefix}_model_min_norm",
            f"{prefix}_model_max_norm",
            f"{prefix}_2sfca_norm",
            f"{prefix}_2sfca_raw",
            f"{prefix}_rank_2sfca",
            f"{prefix}_cumulative_norm",
            f"{prefix}_cumulative_raw",
            f"{prefix}_rank_cumulative",
            f"{prefix}_hansen_norm",
            f"{prefix}_hansen_raw",
            f"{prefix}_rank_hansen",
        ]
        text_defaults = {
            f"{prefix}_importance_label": "Not evaluated",
            f"{prefix}_confidence_label": "Unknown",
            f"{prefix}_dominant_model": "not_available",
            f"{prefix}_laggard_model": "not_available",
        }
        bool_defaults = {f"{prefix}_pareto_priority": False}

        for col in numeric_zero:
            if col in df.columns:
                df[col] = df[col].fillna(0.0)

        for col, value in text_defaults.items():
            if col in df.columns:
                df[col] = df[col].astype("object").fillna(value)

        for col, value in bool_defaults.items():
            if col in df.columns:
                series = df[col]
                series = series.astype("boolean")
                df[col] = series.fillna(value)

        return df

    @staticmethod
    def _select_final_columns(df: pd.DataFrame) -> pd.DataFrame:
        """Retain only core amenity columns and final composite metrics."""
        columns_to_keep: list[str] = []
        for col in BASE_AMENITY_COLUMNS:
            if col in df.columns:
                columns_to_keep.append(col)

        planning_present = any(col in df.columns for col in PLANNING_FINAL_COLUMNS)
        subzone_present = any(col in df.columns for col in SUBZONE_FINAL_COLUMNS)

        if planning_present:
            for col in PLANNING_FINAL_COLUMNS:
                if col in df.columns:
                    columns_to_keep.append(col)

        if subzone_present:
            for col in SUBZONE_FINAL_COLUMNS:
                if col in df.columns:
                    columns_to_keep.append(col)

        # Ensure category retained even if missing in core list
        for mandatory in ("category", "planning_area", "subzone"):
            if mandatory in df.columns and mandatory not in columns_to_keep:
                columns_to_keep.append(mandatory)

        return df.loc[:, columns_to_keep]
