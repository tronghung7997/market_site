# FROM python:3.13-slim
FROM registry.k7:5000/python:3.13-slim
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
# debug tool
RUN apt update && apt install -y curl nano vim
EXPOSE 8001
# CMD ["tail","-f","/dev/null"]
CMD ["sh", "-c", "alembic upgrade head && uvicorn src.main:app --host 0.0.0.0 --port 8001"]