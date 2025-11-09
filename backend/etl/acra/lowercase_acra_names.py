from pathlib import Path
import pandas as pd


def lower_inplace(path: Path) -> None:
    if not path.exists():
        print(f"Skip: {path} not found")
        return
    df = pd.read_csv(path)
    for col in ("amenity_name", "street_name", "building_name"):
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().str.lower()
    df.to_csv(path, index=False)
    print(f"✓ Lowercased columns in {path}")


if __name__ == "__main__":
    base = Path(__file__).resolve().parents[1] / "data"
    lower_inplace(base / "acra_all.csv")

