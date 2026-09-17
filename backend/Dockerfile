FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/pyproject.toml ./
COPY backend/app ./app

RUN python -m pip install --no-cache-dir .

CMD ["python", "-c", "import app; print('Outpost backend foundation ready')"]
