FROM python:3.12-slim

WORKDIR /app

# cache-bust: 2026-03-29-v1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Default: web service (Railway routes HTTP traffic to "web" processes)
CMD ["python", "-m", "bot", "web"]
