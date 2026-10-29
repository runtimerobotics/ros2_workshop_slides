#!/usr/bin/env python3
"""
Check that every code block on the slides matches the workshop code repository.

A block marked <pre data-src="path/in/repo"> must be an excerpt of that file: every
line of the block appears in the file, in the same order. Leading spaces and blank
lines are ignored (slides de-indent fragments and use single blank lines); a line
that is just "..." (or "...,") stands for lines left out. data-src-lines="3-9" checks only those
lines of the block, for blocks that mix code with commands.

    python3 tools/check_code.py ../ros2_workshop_code
"""
import html
import re
import sys
from pathlib import Path


def norm(line):
    return line.strip()


def blocks(deck):
    for sec in re.finditer(r'<section class="slide[^"]*"[^>]*data-title="([^"]*)"(.*?)</section>', deck, re.S):
        number = deck.count('<section class="slide', 0, sec.start()) + 1
        for pre in re.finditer(r'<pre([^>]*)><code>(.*?)</code></pre>', sec.group(2), re.S):
            src = re.search(r'data-src="([^"]+)"', pre.group(1))
            if src:
                rng = re.search(r'data-src-lines="(\d+)-(\d+)"', pre.group(1))
                text = html.unescape(re.sub(r'<[^>]+>', '', pre.group(2))).split('\n')
                if rng:
                    text = text[int(rng.group(1)) - 1:int(rng.group(2))]
                yield number, sec.group(1), src.group(1), text


def check(lines, file_lines):
    """Return the first block line that is not found, in order, in the file (None if all are)."""
    want = [norm(line) for line in lines if norm(line) and norm(line).rstrip(',') != '...']
    have = [norm(line) for line in file_lines]
    i = 0
    for w in want:
        try:
            i = have.index(w, i) + 1
        except ValueError:
            return w
    return None


def main():
    repo = Path(sys.argv[1] if len(sys.argv) > 1 else '../ros2_workshop_code')
    deck = (Path(__file__).resolve().parents[1] / 'index.html').read_text()
    bad = 0
    for number, title, src, lines in blocks(deck):
        path = repo / src
        if not path.exists():
            print(f'✗ #{number} {title}: {src} does not exist'); bad += 1
            continue
        missing = check(lines, path.read_text().split('\n'))
        if missing:
            print(f'✗ #{number} {title}: not in {src} (or out of order):\n    {missing}'); bad += 1
        else:
            print(f'✓ #{number} {title}: {src}')
    print('all code blocks match the repository' if not bad else f'{bad} block(s) differ')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
