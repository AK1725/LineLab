# Build from the repo root:  docker build -f apps/vision/Dockerfile .
FROM python:3.12-slim
RUN pip install --no-cache-dir uv==0.11.32
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /app
COPY apps/vision/pyproject.toml apps/vision/uv.lock ./
RUN uv sync --frozen --no-dev
# The knowledge-base embedding model (bge-small, ~65 MB), fetched at build time so the service
# runs without network access.
ENV FASTEMBED_CACHE_PATH=/opt/models
RUN /opt/venv/bin/python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/opt/models')" \
 && chmod -R a+rX /opt/models
ENV HF_HUB_OFFLINE=1
COPY apps/vision/app ./app
RUN useradd --create-home vision
USER vision
EXPOSE 8000
CMD ["/opt/venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
