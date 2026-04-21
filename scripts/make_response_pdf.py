#!/usr/bin/env python3
"""Render a response (markdown-ish text) to a PDF in responses/."""
import sys
import re
from datetime import datetime
from pathlib import Path

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "responses"
OUT_DIR.mkdir(exist_ok=True)

URL_RE = re.compile(r"(https?://[^\s)]+)")


def slugify(s: str, n: int = 40) -> str:
    s = re.sub(r"[^a-zA-Z0-9\s-]", "", s).strip().lower()
    s = re.sub(r"\s+", "-", s)
    return s[:n] or "response"


def linkify(text: str) -> str:
    return URL_RE.sub(r'<link href="\1" color="blue">\1</link>', text)


def render(text: str, slug: str) -> Path:
    ts = datetime.now().strftime("%Y-%m-%d_%H%M")
    path = OUT_DIR / f"{ts}_{slugify(slug)}.pdf"

    styles = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=styles["BodyText"], fontSize=11, leading=15)
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=14, spaceAfter=6)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12, spaceAfter=4)
    title = ParagraphStyle("title", parent=styles["Heading1"], fontSize=13, spaceAfter=10)

    story = [Paragraph(f"Claude Response — {ts}", title)]
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line:
            story.append(Spacer(1, 6))
            continue
        safe = linkify(line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
        # Restore link tags we just escaped
        safe = safe.replace("&lt;link ", "<link ").replace("&lt;/link&gt;", "</link>").replace('&quot;', '"')
        safe = re.sub(r"&gt;(?=[^<]*</link>)", ">", safe)
        if line.startswith("# "):
            story.append(Paragraph(line[2:], h1))
        elif line.startswith("## "):
            story.append(Paragraph(line[3:], h2))
        elif line.startswith("- "):
            story.append(Paragraph("• " + linkify(line[2:]), body))
        else:
            story.append(Paragraph(linkify(line), body))

    doc = SimpleDocTemplate(
        str(path), pagesize=LETTER,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
        topMargin=0.75 * inch, bottomMargin=0.75 * inch,
    )
    doc.build(story)
    return path


if __name__ == "__main__":
    slug = sys.argv[1] if len(sys.argv) > 1 else "response"
    text = sys.stdin.read()
    out = render(text, slug)
    print(out)
