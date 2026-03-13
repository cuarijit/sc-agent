from __future__ import annotations

import re
from collections import Counter

from sqlalchemy.orm import Session

from ..models import DocumentChunk


def retrieve_policy_context(db: Session, query: str, limit: int = 3) -> list[dict[str, str]]:
    terms = re.findall(r"[a-zA-Z]{4,}", query.lower())
    if not terms:
        chunks = db.query(DocumentChunk).order_by(DocumentChunk.id.asc()).limit(limit).all()
    else:
        scored = []
        for chunk in db.query(DocumentChunk).all():
            blob = chunk.keyword_blob.split()
            counts = Counter(blob)
            score = sum(counts.get(term, 0) for term in terms)
            if score:
                scored.append((score, chunk))
        scored.sort(key=lambda item: (-item[0], item[1].chunk_index))
        chunks = [chunk for _, chunk in scored[:limit]]
        if not chunks:
            chunks = db.query(DocumentChunk).order_by(DocumentChunk.id.asc()).limit(limit).all()
    return [
        {
            "title": chunk.document.title,
            "excerpt": chunk.content,
            "source_type": "policy",
        }
        for chunk in chunks
    ]

