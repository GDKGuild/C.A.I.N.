import json
import os
import sys
import yaml

SRC = sys.argv[1] if len(sys.argv) > 1 else r"D:\Jasper\Projects\GitHub Open Source\FixTweetBot\locales"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "src", "locales")
LOCALES = sys.argv[3:] or ["en-US", "fr"]

os.makedirs(OUT, exist_ok=True)


def flatten(obj, prefix=""):
    out = {}
    for key, value in obj.items():
        k = f"{prefix}.{key}" if prefix else key
        if k == "placeholder" and isinstance(value, int):
            continue
        if isinstance(value, dict):
            out.update(flatten(value, k))
        else:
            out[k] = value
    return out


for locale in LOCALES:
    with open(os.path.join(SRC, f"{locale}.yml"), encoding="utf-8") as f:
        data = yaml.safe_load(f)
    flat = flatten(data)
    with open(os.path.join(OUT, f"{locale}.json"), "w", encoding="utf-8") as f:
        json.dump(flat, f, ensure_ascii=False, indent=2)
    print(f"wrote {locale}.json ({len(flat)} keys)")