# build_requirements.py
import os, re

root_dir = "app"
imports = set()

for subdir, _, files in os.walk(root_dir):
    for f in files:
        if f.endswith(".py"):
            with open(os.path.join(subdir, f), encoding="utf-8") as file:
                for line in file:
                    match = re.match(r'^\s*(?:from|import)\s+([\w\d_\.]+)', line)
                    if match:
                        imports.add(match.group(1).split('.')[0])

print("Detected imports:")
for imp in sorted(imports):
    print("-", imp)

print("\nSuggested requirements.txt:")
base_map = {
    "fastapi": "fastapi",
    "uvicorn": "uvicorn[standard]",
    "sqlalchemy": "sqlalchemy",
    "pydantic": "pydantic",
    "dotenv": "python-dotenv",
    "passlib": "passlib[bcrypt]",
    "jose": "python-jose[cryptography]"
}
for imp in sorted(imports):
    if imp in base_map:
        print(base_map[imp])
