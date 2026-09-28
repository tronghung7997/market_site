# Override with --build-arg PYTHON_IMAGE=python:3.13-slim when registry.k7 isn't reachable (e.g. local dev)
ARG PYTHON_IMAGE=registry.k7:5000/python:3.13-slim
FROM ${PYTHON_IMAGE}
WORKDIR /app
# static page
COPY static /app/static/
#
COPY pyproject.toml .
RUN pip install --no-cache-dir -e .
COPY src/ ./src/
# alembic config + migrations — required so `alembic upgrade head` in CMD works
COPY alembic.ini ./
COPY alembic/ ./alembic/
# ops scripts (seed_topproxy, recover_topproxy_orders, ...) — chạy trong
# container prod qua `docker-compose exec marketplace-svc python scripts/...`
COPY scripts/ ./scripts/
# debug tool
RUN apt update && apt install -y curl nano vim
EXPOSE 8001
# CMD ["tail","-f","/dev/null"]
CMD ["sh", "-c", "alembic upgrade head && uvicorn src.main:app --host 0.0.0.0 --port 8001"]