# -*- coding: utf-8 -*-
from pathlib import Path
import re
path = Path(r"frontend/src/components/pagecomponents/historicalMap/SingaporeHistoricalFloodMap.jsx")
text = path.read_text()
pattern_flood = r"checked=\{checked\}\s+onChange=\{\(e\) => \{\s+setEnabledFloodTypes\((?:.|\s)+?\}\s+\}\s+\}\s+\}\s+/>"
replacement_flood = "checked={checked}\n                          disabled={!onFloodTypesChange}\n                          onChange={(e) => handleFloodTypeToggle(t, e.target.checked)}\n                        />"
text_new = re.sub(pattern_flood, replacement_flood, text)
pattern_amenity = r"checked=\{checked\}\s+onChange=\{\(e\) => \{\s+setEnabledAmenityTypes\((?:.|\s)+?\}\s+\}\s+\}\s+\}\s+/>"
replacement_amenity = "checked={checked}\n                          disabled={!onAmenityTypesChange}\n                          onChange={(e) => handleAmenityTypeToggle(t, e.target.checked)}\n                        />"
text_new = re.sub(pattern_amenity, replacement_amenity, text_new)
if text_new == text:
    raise SystemExit('regex replacement did not apply')
path.write_text(text_new)
