"""Download the small curated source set; retain provenance and byte hashes."""
import gzip
import hashlib
import html
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets' / 'source-materials'
ITEMS = [
    (350812, 'simple-rabbit-optimized-outline', '小兔子'),
    (16629, 'simple-flower', '小花朵'),
    (22517, 'poppy', '花朵观察'),
    (352670, 'simple-butterfly-outline', '蝴蝶翅膀'),
    (245257, 'fish-outline', '小鱼游泳'),
    (75883, 'cat-line-art', '好奇的小猫'),
    (284788, 'horse', '小马散步'),
    (312543, 'kawaii-kitty-line-art', '可爱的小猫'),
    (288786, 'simple-butterfly', '花园蝴蝶'),
    (27220, 'sleepy-calico-cat-line-drawing-only', '午睡的小猫'),
    (284790, 'butterfly', '对称的翅膀'),
    (194261, 'fish', '海里的朋友'),
]

def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'PaperJoy source preparation/1.0'})
    with urllib.request.urlopen(req, timeout=45) as response:
        body = response.read()
    return gzip.decompress(body) if body[:2] == b'\x1f\x8b' else body

def validate_svg(data):
    if b'<!ENTITY' in data.upper():
        raise ValueError('Entity definitions are not accepted')
    tree = ET.fromstring(data)
    if tree.tag.split('}')[-1] != 'svg':
        raise ValueError('Expected SVG document')
    for node in tree.iter():
        tag = node.tag.split('}')[-1]
        if tag in {'script', 'foreignObject'}:
            raise ValueError('Active SVG content is forbidden')
        for key, value in node.attrib.items():
            key = key.split('}')[-1]
            if key.lower().startswith('on'):
                raise ValueError('SVG event handler is forbidden')
            if tag in {'image', 'use'} and key == 'href' and not value.startswith('#'):
                raise ValueError('External SVG content is forbidden')
    return tree

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    items = []
    for ident, slug, chinese_title in ITEMS:
        page_url = f'https://openclipart.org/detail/{ident}/{slug}'
        page = fetch(page_url).decode('utf-8')
        visible = html.unescape(re.sub('<[^>]+>', ' ', re.sub(r'<script\b[^>]*>[\s\S]*?</script>', '', page)))
        if re.search(r'\b(pd_issue|need-review)\b', visible):
            raise ValueError(f'Unresolved provenance flag on {page_url}')
        authors = re.findall(r'href=[\"\']/artist/([^\"\'/]+)', page)
        author = html.unescape(authors[0]) if authors else ''
        if not author:
            raise ValueError(f'Missing author: {page_url}')
        path = OUT / f'{slug}.svg'
        if not path.exists():
            path.write_bytes(fetch(f'https://openclipart.org/download/{ident}'))
        data = path.read_bytes()
        validate_svg(data)
        items.append({'title': chinese_title, 'originalTitle': slug.replace('-', ' '), 'author': author,
                      'url': page_url, 'downloadUrl': f'https://openclipart.org/download/{ident}',
                      'license': 'CC0-1.0', 'licenseEvidence': 'https://openclipart.org/faq',
                      'checkedAt': '2026-11-06', 'sha256': hashlib.sha256(data).hexdigest(),
                      'path': path.relative_to(ROOT).as_posix(), 'status': 'pending_print_review'})
        print(f'Checked source {ident}: {chinese_title}')
    (OUT / 'print-pack-sources.json').write_text(json.dumps(items, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    font_dir = ROOT / '.local' / 'fonts'
    font_dir.mkdir(parents=True, exist_ok=True)
    font = font_dir / 'NotoSansSC-VF.ttf'
    if not font.exists():
        font.write_bytes(fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'))
    (font_dir / 'OFL.txt').write_bytes(fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt'))
    (OUT / 'font-source.json').write_text(json.dumps({
        'name': 'Noto Sans SC', 'source': 'https://github.com/google/fonts/tree/main/ofl/notosanssc',
        'license': 'SIL Open Font License 1.1', 'sha256': hashlib.sha256(font.read_bytes()).hexdigest(),
        'usage': 'Embedded subset in generated PDFs; download source and license with this script'
    }, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

if __name__ == '__main__':
    main()
