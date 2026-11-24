"""Text embeddings for LineLab's fix knowledge base (BLUEPRINT §5.9).

bge-small-en-v1.5 (384 dimensions) on ONNX Runtime via fastembed: no PyTorch. The model is loaded
once, lazily; Docker images download it at build time (FASTEMBED_CACHE_PATH) so the service needs
no network at runtime.
"""

import os
from functools import lru_cache
from typing import Literal

from fastembed import TextEmbedding

MODEL = "BAAI/bge-small-en-v1.5"
DIM = 384
MAX_TEXTS = 64
MAX_CHARS = 4000


@lru_cache(maxsize=1)
def model() -> TextEmbedding:
    return TextEmbedding(MODEL, cache_dir=os.environ.get("FASTEMBED_CACHE_PATH"))


def embed(texts: list[str], kind: Literal["query", "passage"]) -> list[list[float]]:
    """Unit-length vectors; queries get bge's retrieval instruction, passages don't."""
    clipped = [t[:MAX_CHARS] for t in texts]
    m = model()
    vectors = m.query_embed(clipped) if kind == "query" else m.passage_embed(clipped)
    return [[float(x) for x in v] for v in vectors]
