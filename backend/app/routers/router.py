# Create top-level API router
from fastapi import APIRouter

from .weather_alerts.weather_alerts_router import (
    router as weather_alerts_router,
)
from .health.health_check_router import (
    router as health_router,
)

from .floods_3layers.floods_3layers_router import router as flood3layers_router
from .amenity_3layers.amenity_3layers_router import router as amenity3layers_router

from .planning_area.planning_area_router import router as planning_area_router
from .road_network.road_network_router import router as road_network_router
from .subzone.subzone_router import router as subzone_router
from .acra.acra_router import router as acra_router
from .amenity_lookup.amenity_category_router import router as amenity_lookup_router
from .road_network_flood_scenarios.road_network_flood_scenarios_router import router as flood_scenarios_router


api_router = APIRouter(prefix="/api")

api_router.include_router(weather_alerts_router)


# Base map
api_router.include_router(planning_area_router)
api_router.include_router(road_network_router)
api_router.include_router(subzone_router)


api_router.include_router(health_router)
api_router.include_router(flood3layers_router)
api_router.include_router(amenity3layers_router)
api_router.include_router(acra_router)
api_router.include_router(amenity_lookup_router)
api_router.include_router(flood_scenarios_router)



