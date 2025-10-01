"""
Batch enrichment with continuous saving and auto-resume
Processes amenities in small batches to prevent data loss
"""

import requests
import json
import time
from pathlib import Path
from typing import Dict, Optional
from datetime import datetime, timedelta

try:
    from pyproj import Transformer
    PYPROJ_AVAILABLE = True
except ImportError:
    PYPROJ_AVAILABLE = False
    print("❌ pyproj required: pip install pyproj")
    exit(1)

class RateLimiter:
    """Conservative rate limiter for OneMap API"""
    def __init__(self, max_calls_per_minute: int = 200):
        self.max_calls = max_calls_per_minute
        self.calls = []
        self.min_delay = 60.0 / max_calls_per_minute
        self.last_call = None
        
    def wait_if_needed(self):
        now = datetime.now()
        
        # Minimum delay between calls
        if self.last_call:
            time_since_last = (now - self.last_call).total_seconds()
            if time_since_last < self.min_delay:
                time.sleep(self.min_delay - time_since_last)
                now = datetime.now()
        
        # Rolling window check
        minute_ago = now - timedelta(minutes=1)
        self.calls = [t for t in self.calls if t > minute_ago]
        
        if len(self.calls) >= self.max_calls:
            oldest_call = min(self.calls)
            wait_until = oldest_call + timedelta(minutes=1, seconds=1)
            wait_seconds = (wait_until - now).total_seconds()
            
            if wait_seconds > 0:
                print(f"    ⏸️  Rate limit. Waiting {wait_seconds:.1f}s...")
                time.sleep(wait_seconds)
                now = datetime.now()
        
        self.calls.append(now)
        self.last_call = now

class OneMapEnricher:
    def __init__(self, api_token: str, rate_limiter: RateLimiter):
        self.api_token = api_token
        self.base_url = "https://www.onemap.gov.sg/api/public"
        self.rate_limiter = rate_limiter
        self.transformer = Transformer.from_crs("EPSG:4326", "EPSG:3414", always_xy=True)
    
    def convert_local(self, lat: float, lon: float) -> Optional[Dict]:
        """Convert WGS84 to SVY21 locally"""
        try:
            x, y = self.transformer.transform(lon, lat)
            return {'X': x, 'Y': y}
        except:
            return None
    
    def reverse_geocode(self, x: float, y: float, buffer: int = 40) -> Optional[Dict]:
        """Reverse geocode with retries"""
        url = f"{self.base_url}/revgeocodexy"
        params = {
            "location": f"{x},{y}",
            "buffer": buffer,
            "addressType": "All",
            "otherFeatures": "Y"
        }
        headers = {"Authorization": f"Bearer {self.api_token}"}
        
        max_retries = 3
        for attempt in range(max_retries):
            try:
                self.rate_limiter.wait_if_needed()
                response = requests.get(url, params=params, headers=headers, timeout=15)
                
                if response.status_code == 429:
                    # Rate limited - wait longer
                    wait_time = 60 if attempt == 0 else 120
                    print(f"    ⚠️  429 rate limit. Waiting {wait_time}s...")
                    time.sleep(wait_time)
                    continue
                
                response.raise_for_status()
                return response.json()
                
            except requests.exceptions.Timeout:
                if attempt < max_retries - 1:
                    print(f"    ⚠️  Timeout, retry {attempt + 1}/{max_retries}")
                    time.sleep(2)
                continue
            except Exception as e:
                if attempt == max_retries - 1:
                    print(f"    ⚠️  Error: {str(e)[:50]}")
                return None
        
        return None
    
    def enrich_amenity(self, amenity: Dict) -> Dict:
        """Enrich single amenity"""
        lat = amenity.get('lat')
        lon = amenity.get('lon')
        
        if not lat or not lon:
            amenity['enrichment_status'] = 'missing_coordinates'
            return amenity
        
        # Convert locally
        converted = self.convert_local(lat, lon)
        if not converted:
            amenity['enrichment_status'] = 'conversion_failed'
            return amenity
        
        x, y = converted['X'], converted['Y']
        
        # Geocode
        geocode_result = self.reverse_geocode(x, y)
        if not geocode_result:
            amenity['enrichment_status'] = 'geocode_failed'
            return amenity
        
        # Success - add data
        amenity['svy21_x'] = x
        amenity['svy21_y'] = y
        amenity['onemap_data'] = geocode_result
        amenity['enrichment_status'] = 'success'
        
        geo_info = geocode_result.get('GeocodeInfo', [])
        if geo_info:
            first = geo_info[0]
            amenity['address'] = first.get('BUILDINGNAME', '') or first.get('ROAD', '')
            amenity['postal_code'] = first.get('POSTALCODE', '')
            amenity['block'] = first.get('BLOCK', '')
            amenity['road'] = first.get('ROAD', '')
            amenity['building'] = first.get('BUILDINGNAME', '')
        
        return amenity

def batch_enrich(
    input_file: str = "amenities_singapore.json",
    output_file: str = "amenities_enriched.json",
    api_token: str = None,
    batch_size: int = 100,
    start_from: int = None
):
    """
    Process amenities in batches with continuous saving
    
    Args:
        input_file: Source amenities JSON
        output_file: Output enriched JSON
        api_token: OneMap API token
        batch_size: Items per batch (saves after each batch)
        start_from: Index to start from (for manual resume)
    """
    
    if not api_token:
        print("❌ API token required")
        return
    
    # Load source data
    input_path = Path(input_file)
    if not input_path.exists():
        print(f"❌ Input file not found: {input_file}")
        return
    
    with open(input_path, 'r') as f:
        all_amenities = json.load(f)
    
    print(f"📥 Loaded {len(all_amenities)} total amenities")
    
    # Load existing progress
    output_path = Path(output_file)
    enriched = []
    processed_count = 0
    
    if output_path.exists():
        with open(output_path, 'r') as f:
            enriched = json.load(f)
        processed_count = len(enriched)
        print(f"📂 Found existing progress: {processed_count} already processed")
    
    # Determine starting point
    if start_from is not None:
        start_idx = start_from
        print(f"⏩ Manual start from index {start_idx}")
    else:
        start_idx = processed_count
        print(f"⏩ Auto-resuming from index {start_idx}")
    
    remaining = all_amenities[start_idx:]
    total_to_process = len(remaining)
    
    if total_to_process == 0:
        print("✅ All amenities already processed!")
        return
    
    print(f"🎯 Will process {total_to_process} amenities in batches of {batch_size}")
    print(f"⏱️  Estimated time: ~{total_to_process / 200:.0f} minutes\n")
    
    # Setup enricher
    rate_limiter = RateLimiter(max_calls_per_minute=200)
    enricher = OneMapEnricher(api_token, rate_limiter)
    
    # Process in batches
    batch_num = 0
    success_count = 0
    failed_count = 0
    overall_start = time.time()
    
    for i in range(0, len(remaining), batch_size):
        batch = remaining[i:i + batch_size]
        batch_num += 1
        batch_start = time.time()
        
        print(f"📦 Batch {batch_num} ({len(batch)} items) - Index {start_idx + i} to {start_idx + i + len(batch) - 1}")
        
        batch_enriched = []
        for j, amenity in enumerate(batch, 1):
            enriched_amenity = enricher.enrich_amenity(amenity.copy())
            batch_enriched.append(enriched_amenity)
            
            if enriched_amenity.get('enrichment_status') == 'success':
                success_count += 1
            else:
                failed_count += 1
            
            # Mini progress within batch
            if j % 20 == 0:
                print(f"    {j}/{len(batch)} items in current batch...")
        
        # Add batch to results
        enriched.extend(batch_enriched)
        
        # Save after each batch
        with open(output_path, 'w') as f:
            json.dump(enriched, f, indent=2, ensure_ascii=False)
        
        # Batch summary
        batch_time = time.time() - batch_start
        total_processed = len(enriched)
        progress_pct = (total_processed / len(all_amenities)) * 100
        
        print(f"  ✅ Batch complete in {batch_time:.1f}s")
        print(f"  💾 Saved {total_processed}/{len(all_amenities)} ({progress_pct:.1f}%)")
        print(f"  Stats: ✅ {success_count} | ❌ {failed_count}")
        
        # ETA calculation
        elapsed = time.time() - overall_start
        rate = total_processed / elapsed * 60 if elapsed > 0 else 0
        remaining_items = len(all_amenities) - total_processed
        eta_min = remaining_items / rate if rate > 0 else 0
        
        print(f"  Rate: {rate:.1f} items/min | ETA: {eta_min:.0f} min\n")
        
        # Small break between batches
        if i + batch_size < len(remaining):
            time.sleep(2)
    
    total_time = time.time() - overall_start
    
    print("=" * 60)
    print("🎉 ENRICHMENT COMPLETE!")
    print(f"   Total processed: {len(enriched)}/{len(all_amenities)}")
    print(f"   Success: {success_count} ({success_count/len(enriched)*100:.1f}%)")
    print(f"   Failed: {failed_count} ({failed_count/len(enriched)*100:.1f}%)")
    print(f"   Total time: {total_time/60:.1f} minutes")
    print(f"   Output: {output_path.absolute()}")
    print("=" * 60)

if __name__ == "__main__":
    API_TOKEN = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjo4Mzk3LCJmb3JldmVyIjpmYWxzZSwiaXNzIjoiT25lTWFwIiwiaWF0IjoxNzU5MjQ0NTQ1LCJuYmYiOjE3NTkyNDQ1NDUsImV4cCI6MTc1OTUwMzc0NSwianRpIjoiNzBhNDAwZjItMmFiNi00NjAwLWIyZGItN2QyZGM1ODFjYjYyIn0.xTi7kYrKgxF9TaUObFqecgH_4eIVZcixQiEyLBfil-xsUaXr690e9A2s-TH5Sx-n56NunvC_fS_O8_0u4bTG_VZNGYX6e1EYZzHGOsBYlo1o-2jiC9Uai1S-yNmmCFTYDfXfyVVOM5BuVaTkUybWx-jT7uWusDA4opWbOePQJy8YlY28-VjkQ3S6cgrzYBfhP2ox7uS4rWlrelgKupDy-Y_gXZJMUph0BCYJ8JFLs1jMV4T3eB9R7D28CYuCW3ZQJKYOdbBdV7Y7T4riFa5benWjZr5EcKmLV7m-Y9rzrYlS3aPNiHEu8c6hLLtcIWTMCTvfaFjuj5ut0pc1a1s2dA"
    
    # Process everything in batches of 100
    batch_enrich(
        api_token=API_TOKEN,
        batch_size=100,  # Saves every 100 items
        # start_from=500  # Uncomment to manually start from a specific index
    )