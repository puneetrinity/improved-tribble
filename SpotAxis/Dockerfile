FROM python:3.12-slim

# System deps for WeasyPrint (cairo/pango stack) + fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpango-1.0-0 libpangoft2-1.0-0 libpangocairo-1.0-0 \
    libcairo2 libgdk-pixbuf-2.0-0 libglib2.0-0 libgobject-2.0-0 \
    libharfbuzz0b libffi8 libjpeg62-turbo zlib1g \
    fonts-dejavu-core fonts-liberation shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

# Optional: CFFI speedups
ENV CFFI_DISABLE_EXT=0

# Workdir
WORKDIR /app

# Copy and install Python deps
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY . /app

# Runtime env
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Collect static, migrate DB, and run with waitress
CMD python manage.py collectstatic --noinput && \
    python manage.py migrate && \
    waitress-serve --host=0.0.0.0 --port=${PORT:-8000} --threads=4 TRM.wsgi:application
