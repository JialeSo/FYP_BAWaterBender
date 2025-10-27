#!/usr/bin/env python3
"""
Comprehensive Cleanup - Remove Old/Unused Files
================================================

This script identifies and removes old files that are no longer used
by the updated pipeline.

Files to remove:
- Old implementations replaced by PySAL versions
- Duplicate/redundant files
- Python cache
"""

import shutil
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def cleanup_step04():
    """Clean up step_04_accessibility_analysis folder."""
    print("\n" + "="*80)
    print("CLEANING STEP 04 (Accessibility Analysis)")
    print("="*80 + "\n")

    step04_dir = SCRIPT_DIR / "step_04_accessibility_analysis"

    # Files to remove (old implementations)
    files_to_remove = {
        # Old compute engine (replaced by compute_pysal.py)
        "compute.py": "Old cKDTree-based computation → Replaced by compute_pysal.py",

        # Old grid (replaced by grid_optimized.py)
        "grid.py": "Old H3-only grid → Replaced by grid_optimized.py",

        # Old service (replaced by service_pysal.py)
        "service.py": "Old service API → Replaced by service_pysal.py",

        # Old analyzers (functionality integrated into service_pysal.py)
        "analyzers.py": "Old analyzers → Integrated into service_pysal.py",

        # Old plotting (integrated into service_pysal.py)
        "plotting.py": "Old plotting → Integrated into service_pysal.py",
    }

    # Files to keep
    files_to_keep = {
        "__init__.py",
        "__init___pysal.py",  # Will be merged into __init__.py
        "compute_pysal.py",   # NEW
        "grid_optimized.py",  # NEW
        "service_pysal.py",   # NEW
        "data.py",            # SHARED - still used
        "constants.py",       # SHARED - still used
        "README_PYSAL.md",    # DOCUMENTATION
    }

    print("Files to REMOVE (old implementations):")
    print("-"*80)
    for filename, reason in files_to_remove.items():
        filepath = step04_dir / filename
        if filepath.exists():
            size = filepath.stat().st_size / 1024
            print(f"  ✗ {filename:<30} ({size:>6.1f} KB) - {reason}")
        else:
            print(f"  - {filename:<30} (not found)")

    print("\nFiles to KEEP (new/shared):")
    print("-"*80)
    for filename in sorted(files_to_keep):
        filepath = step04_dir / filename
        if filepath.exists():
            size = filepath.stat().st_size / 1024
            print(f"  ✓ {filename:<30} ({size:>6.1f} KB)")

    print()

    # Actually remove files
    removed = []
    for filename in files_to_remove.keys():
        filepath = step04_dir / filename
        if filepath.exists():
            filepath.unlink()
            removed.append(filename)

    if removed:
        print(f"✓ Removed {len(removed)} old files from step_04_accessibility_analysis/")
    else:
        print("  No files to remove")

    print()


def merge_pysal_init():
    """Merge __init___pysal.py into __init__.py."""
    print("\n" + "="*80)
    print("UPDATING __init__.py TO USE PYSAL")
    print("="*80 + "\n")

    step04_dir = SCRIPT_DIR / "step_04_accessibility_analysis"
    init_file = step04_dir / "__init__.py"
    init_pysal = step04_dir / "__init___pysal.py"
    init_legacy_backup = step04_dir / "__init___legacy.py"

    if not init_pysal.exists():
        print("  __init___pysal.py not found, skipping")
        return

    # Backup old __init__.py
    if init_file.exists() and not init_legacy_backup.exists():
        shutil.copy(str(init_file), str(init_legacy_backup))
        print(f"✓ Backed up: __init__.py → __init___legacy.py")

    # Replace with PySAL version
    shutil.copy(str(init_pysal), str(init_file))
    print(f"✓ Updated: __init__.py (now uses PySAL by default)")

    # Remove the _pysal version
    init_pysal.unlink()
    print(f"✓ Removed: __init___pysal.py (merged)")

    print()


def cleanup_old_step04_folder():
    """Remove old step_04_accessibility folder."""
    print("\n" + "="*80)
    print("REMOVING OLD step_04_accessibility FOLDER")
    print("="*80 + "\n")

    old_step04 = SCRIPT_DIR / "step_04_accessibility"

    if old_step04.exists():
        print(f"Found old folder: {old_step04.name}")

        # Check what's inside
        files = list(old_step04.rglob("*"))
        total_size = sum(f.stat().st_size for f in files if f.is_file())

        print(f"  Files: {len([f for f in files if f.is_file()])}")
        print(f"  Size: {total_size / 1024:.1f} KB")

        # Remove it
        shutil.rmtree(old_step04)
        print(f"✓ Removed: {old_step04.name}/")
    else:
        print("  No old step_04_accessibility folder found")

    print()


def cleanup_step03():
    """Clean up step_03_network_mapping folder."""
    print("\n" + "="*80)
    print("CLEANING STEP 03 (Network Mapping)")
    print("="*80 + "\n")

    step03_dir = SCRIPT_DIR / "step_03_network_mapping"

    # Files to keep
    files_to_keep = {
        "__init__.py",
        "road_matcher_osmnx.py",  # NEW - using OSMnx
        "postal_road_linker.py",  # Utility - still used
        "road_aggregator.py",     # Utility - still used
    }

    # Files to potentially remove
    old_file = step03_dir / "road_matcher.py"  # Old centroid-based matcher

    print("Files to KEEP:")
    print("-"*80)
    for filename in sorted(files_to_keep):
        filepath = step03_dir / filename
        if filepath.exists():
            size = filepath.stat().st_size / 1024
            print(f"  ✓ {filename:<30} ({size:>6.1f} KB)")

    print("\nOld implementation:")
    print("-"*80)
    if old_file.exists():
        size = old_file.stat().st_size / 1024
        print(f"  ✗ road_matcher.py ({size:>6.1f} KB) - Old centroid-based matcher")
        print(f"    → Replaced by road_matcher_osmnx.py")

        # Move to archive instead of deleting (for reference)
        archive_dir = SCRIPT_DIR / "_archive" / "step_03_old"
        archive_dir.mkdir(parents=True, exist_ok=True)
        shutil.move(str(old_file), str(archive_dir / "road_matcher.py"))
        print(f"  ✓ Moved to: _archive/step_03_old/")
    else:
        print(f"  - road_matcher.py (not found)")

    print()


def cleanup_cache():
    """Remove Python cache files."""
    print("\n" + "="*80)
    print("CLEANING PYTHON CACHE")
    print("="*80 + "\n")

    cache_patterns = ["__pycache__", "*.pyc", "*.pyo"]
    removed = []

    for pattern in cache_patterns:
        for item in SCRIPT_DIR.rglob(pattern):
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()
            removed.append(item.relative_to(SCRIPT_DIR))

    if removed:
        print(f"✓ Removed {len(removed)} cache files/directories")
        for item in removed[:5]:  # Show first 5
            print(f"  - {item}")
        if len(removed) > 5:
            print(f"  ... and {len(removed) - 5} more")
    else:
        print("  No cache files found")

    print()


def organize_old_files():
    """Move old implementations to _archive."""
    print("\n" + "="*80)
    print("ORGANIZING OLD FILES")
    print("="*80 + "\n")

    archive_dir = SCRIPT_DIR / "_archive"
    archive_dir.mkdir(exist_ok=True)

    # Move _old folder if it exists
    old_dir = SCRIPT_DIR / "_old"
    if old_dir.exists():
        target = archive_dir / "old_implementations"
        if not target.exists():
            shutil.move(str(old_dir), str(target))
            print(f"✓ Moved: _old/ → _archive/old_implementations/")
    else:
        print("  No _old/ folder to move")

    print()


def main():
    print("\n" + "="*80)
    print("COMPREHENSIVE CLEANUP - REMOVE OLD/UNUSED FILES")
    print("="*80)
    print(f"Directory: {SCRIPT_DIR}")
    print("="*80)

    # Confirm before proceeding
    print("\nThis will:")
    print("  1. Remove old implementations in step_04_accessibility_analysis/")
    print("  2. Update __init__.py to use PySAL by default")
    print("  3. Remove old step_04_accessibility folder")
    print("  4. Archive old road_matcher.py from step_03/")
    print("  5. Clean Python cache files")
    print("  6. Organize old files into _archive/")
    print()

    response = input("Proceed? [y/N]: ").strip().lower()
    if response != 'y':
        print("\nAborted.")
        return

    # Execute cleanup steps
    cleanup_step04()
    merge_pysal_init()
    cleanup_old_step04_folder()
    cleanup_step03()
    cleanup_cache()
    organize_old_files()

    print("="*80)
    print("✓ COMPREHENSIVE CLEANUP COMPLETE")
    print("="*80)
    print()

    # Summary
    print("SUMMARY:")
    print("-"*80)
    print("✓ Removed old implementations from step_04_accessibility_analysis/")
    print("✓ Updated __init__.py to use PySAL by default")
    print("✓ Cleaned up old step_04_accessibility folder")
    print("✓ Archived old road_matcher.py")
    print("✓ Removed Python cache files")
    print()

    print("WHAT'S LEFT:")
    print("-"*80)
    print("STEP 03 (Network Mapping):")
    print("  ✓ road_matcher_osmnx.py (NEW - OSMnx-based)")
    print("  ✓ postal_road_linker.py")
    print("  ✓ road_aggregator.py")
    print()
    print("STEP 04 (Accessibility Analysis):")
    print("  ✓ compute_pysal.py (NEW - PySAL engine)")
    print("  ✓ grid_optimized.py (NEW - H3/Square/Adaptive grids)")
    print("  ✓ service_pysal.py (NEW - High-level API)")
    print("  ✓ data.py (SHARED - data loading)")
    print("  ✓ constants.py (SHARED - constants)")
    print("  ✓ __init__.py (UPDATED - exports PySAL components)")
    print("  ✓ README_PYSAL.md (DOCUMENTATION)")
    print()

    print("ARCHIVED:")
    print("-"*80)
    print("  _archive/old_implementations/ - Old ETL scripts")
    print("  _archive/step_03_old/road_matcher.py - Old centroid-based matcher")
    print("  step_04_accessibility_analysis/__init___legacy.py - Backup of old __init__.py")
    print()

    print("✅ Folder is now clean and organized!\n")


if __name__ == "__main__":
    main()
