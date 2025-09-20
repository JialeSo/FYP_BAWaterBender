from pathlib import Path
import os
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

if "MPLCONFIGDIR" not in os.environ:
    mpl_cache = Path(tempfile.gettempdir()) / "mplconfig"
    mpl_cache.mkdir(parents=True, exist_ok=True)
    os.environ["MPLCONFIGDIR"] = str(mpl_cache)

import matplotlib.pyplot as plt

from backend.etl.historical_floods.second_order_analysis import (
    SecondOrderAnalyzer,
    SecondOrderParameters,
)


def plot_function(df, title):
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.plot(df["radius_m"], df["observed"], label="Observed", color="black")
    ax.fill_between(df["radius_m"], df["lower"], df["upper"], color="steelblue", alpha=0.3, label="CSR envelope")
    ax.axhline(0 if df["function"].iat[0] == "L" else 1 if df["function"].iat[0] in {"G", "F"} else None, color="red", linestyle="--", linewidth=1)
    ax.set_xlabel("Radius (m)")
    ax.set_ylabel(df["function"].iat[0] + "(r)")
    ax.set_title(title)
    ax.legend()
    plt.tight_layout()
    plt.show()


def main() -> None:
    params = SecondOrderParameters(max_radius_m=2000.0, radius_steps=60, csr_simulations=99, csr_seed=42)
    analyzer = SecondOrderAnalyzer()

    g_df = analyzer.g_function(params)
    f_df = analyzer.f_function(params)
    k_df = analyzer.k_function(params)
    l_df = analyzer.l_function(params)

    plot_function(g_df, "G-function with CSR envelope")
    plot_function(f_df, "F-function with CSR envelope")
    plot_function(k_df, "K-function with CSR envelope")
    plot_function(l_df, "L-function with CSR envelope")

    print("G-function head:\n", g_df.head())
    print("\nF-function head:\n", f_df.head())
    print("\nK-function head:\n", k_df.head())
    print("\nL-function head:\n", l_df.head())


if __name__ == "__main__":
    main()
