"""Lossless WOFF2 packaging; retain original Google TTF files locally.

Run after download-google-fonts.cjs: python scripts/compress-fonts.py
Requires fontTools and brotli in the build environment only.
"""
import json
from pathlib import Path
import shutil
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
fonts = root / 'interface/assets/fonts'
originals = root / 'artifacts/google-fonts-ttf'
catalog = json.loads((fonts / 'catalog.json').read_text(encoding='utf-8'))
before = after = 0
for family in catalog:
    for face in family['faces']:
        original_name = Path(face['file']).with_suffix('.ttf')
        source = fonts / original_name
        kept = originals / original_name
        kept.parent.mkdir(parents=True, exist_ok=True)
        if source.exists():
            assert source.resolve().is_relative_to(fonts.resolve())
            shutil.copy2(source, kept)
        if not kept.exists():
            raise FileNotFoundError(kept)
        target = fonts / original_name.with_suffix('.woff2')
        if not target.exists() or source.exists() or target.stat().st_mtime < kept.stat().st_mtime:
            font = TTFont(kept)
            font.flavor = 'woff2'
            font.save(target)
            font.close()
        before += kept.stat().st_size
        after += target.stat().st_size
        face['file'] = str(target.relative_to(fonts)).replace('\\', '/')
        face['format'] = 'woff2'
        if source.exists():
            source.unlink()
    shutil.copy2(fonts / family['id'] / 'LICENSE.txt', originals / family['id'] / 'LICENSE.txt')
(fonts / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
rules = []
for family in catalog:
    for face in family['faces']:
        style = 'italic' if face['italic'] else 'normal'
        rules.append(f'@font-face{{font-family:"{family["name"]}";src:url("./{face["file"]}") format("woff2");font-style:{style};font-weight:{face["weight"]};font-display:swap;}}')
(fonts / 'fonts.css').write_text('\n'.join(rules) + '\n', encoding='utf-8')
print(f'{sum(len(f["faces"]) for f in catalog)} files: {before:,} bytes TTF -> {after:,} bytes WOFF2. Originals: {originals}')
