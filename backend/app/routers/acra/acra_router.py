import logging
from fastapi import APIRouter, HTTPException, Query
from common.db import db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/acra", tags=["acra"])


@router.get("/companies/count")
async def get_acra_companies_count():
    """Return total row count for acra_companies.

    Uses PostgREST exact count; falls back gracefully if SDK response lacks count.
    """
    try:
        # Ask server for an exact count with minimal payload
        # Selecting a cheap column and limiting rows keeps payload small
        result = db.table("acra_companies").select("id", count="exact").limit(1).execute()

        total = getattr(result, "count", None)
        if total is None:
            # Fallback: use returned data length (will be 0/1 due to limit)
            total = len(result.data or [])
            logger.warning("Supabase result.count missing; falling back to len(data).")

        return {"count": total}
    except Exception as e:
        logger.error(f"Error fetching ACRA count: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/companies")
async def list_acra_companies(
    limit: int = Query(1000, ge=1, le=500_000, description="Max rows to return (<= 500k)"),
    offset: int = Query(0, ge=0, description="Zero-based row offset"),
):
    """Paginated fetch of acra_companies using range headers.

    - Intended frontend flow:
      1) Call /companies/count to get total.
      2) If total > 500k, loop calling /companies with limit<=500k and increasing offset.
    """
    try:
        # Ensure deterministic paging — order by primary key (id) if present
        start = offset
        end = offset + limit - 1

        query = db.table("acra_companies").select("*").order("id")

        # Supabase Python SDK uses PostgREST range via .range(start, end)
        # Not all wrappers expose range directly on our db; access underlying table builder
        # by calling range on the returned query object.
        query = query.range(start, end)

        result = query.execute()

        return {
            "data": result.data or [],
            "count": len(result.data or []),
            "limit": limit,
            "offset": offset,
        }
    except Exception as e:
        logger.error(f"Error fetching ACRA companies (limit={limit}, offset={offset}): {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

