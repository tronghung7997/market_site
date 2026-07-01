# FROM python:3.13-slim
FROM registry.k7:5000/python:3.13-slim
WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

COPY . .

# debug tool
RUN apt update && apt install -y curl nano vim
EXPOSE 8001
CMD ["tail","-f","/dev/null"]
#CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]