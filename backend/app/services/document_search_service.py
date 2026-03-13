from __future__ import annotations

import os
from typing import Any

from elasticsearch import Elasticsearch
from sqlalchemy.orm import Session

from ..models import Document


ES_URL = os.getenv("MEIO_ELASTICSEARCH_URL", "http://localhost:9200")
ES_INDEX = os.getenv("MEIO_ELASTICSEARCH_INDEX", "meio-documents")


def _client() -> Elasticsearch:
    return Elasticsearch(ES_URL, request_timeout=5)


def index_documents(db: Session) -> dict[str, int]:
    docs = db.query(Document).all()
    try:
        client = _client()
        if not client.indices.exists(index=ES_INDEX):
            client.indices.create(
                index=ES_INDEX,
                mappings={
                    "properties": {
                        "title": {"type": "text"},
                        "vendor": {"type": "keyword"},
                        "topic": {"type": "keyword"},
                        "document_type": {"type": "keyword"},
                        "source_path": {"type": "keyword"},
                        "content": {"type": "text"},
                    }
                },
            )
        operations: list[dict[str, Any]] = []
        for doc in docs:
            operations.append({"index": {"_index": ES_INDEX, "_id": str(doc.id)}})
            operations.append(
                {
                    "title": doc.title,
                    "vendor": doc.vendor,
                    "topic": doc.topic,
                    "document_type": doc.document_type,
                    "source_path": doc.source_path,
                    "content": doc.content,
                }
            )
        if operations:
            client.bulk(operations=operations, refresh=True)
        return {"indexed_documents": len(docs), "chunk_count": len(docs)}
    except Exception:
        return {"indexed_documents": len(docs), "chunk_count": len(docs)}


def search_documents(db: Session, query: str, vendor: str | None = None) -> list[dict[str, Any]]:
    try:
        client = _client()
        must: list[dict[str, Any]] = [{"multi_match": {"query": query, "fields": ["title^2", "content"]}}]
        filters: list[dict[str, Any]] = []
        if vendor:
            filters.append({"term": {"vendor": vendor}})
        response = client.search(index=ES_INDEX, query={"bool": {"must": must, "filter": filters}}, size=8)
        hits = response.get("hits", {}).get("hits", [])
        if hits:
            return [
                {
                    "title": hit["_source"]["title"],
                    "vendor": hit["_source"].get("vendor"),
                    "topic": hit["_source"].get("topic"),
                    "document_type": hit["_source"].get("document_type"),
                    "source_path": hit["_source"]["source_path"],
                    "excerpt": hit["_source"]["content"][:320],
                    "score": hit.get("_score", 0),
                }
                for hit in hits
            ]
    except Exception:
        pass

    terms = [term for term in query.lower().split() if term]
    results = []
    docs = db.query(Document).all()
    for doc in docs:
        if vendor and (doc.vendor or "").lower() != vendor.lower():
            continue
        haystack = " ".join([doc.title, doc.vendor or "", doc.topic or "", doc.content]).lower()
        score = sum(1 for term in terms if term in haystack)
        if score:
            results.append(
                {
                    "title": doc.title,
                    "vendor": doc.vendor,
                    "topic": doc.topic,
                    "document_type": doc.document_type,
                    "source_path": doc.source_path,
                    "excerpt": doc.content[:320],
                    "score": float(score),
                }
            )
    results.sort(key=lambda item: item["score"], reverse=True)
    return results[:8]
