FROM python:3.11-slim

# System dependencies for WeasyPrint (cairo/pango stack) and fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpango-1.0-0 libpangoft2-1.0-0 libpangocairo-1.0-0 \
    libcairo2 libgdk-pixbuf-2.0-0 libglib2.0-0 libgobject-2.0-0 \
    libharfbuzz0b libffi8 libjpeg62-turbo zlib1g \
    fonts-dejavu-core fonts-liberation shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copy SpotAxis directory
COPY SpotAxis/requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir whitenoise==6.6.0

# Copy entire SpotAxis project
COPY SpotAxis /app

# Collect static (ignore errors if not configured), migrate, then start gunicorn
CMD ["bash", "-lc", "python manage.py collectstatic --noinput || true && python manage.py migrate && gunicorn TRM.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 3"]
