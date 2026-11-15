# IGNIS-SI API.
#
# Build from the backend directory:   docker build -t ignis-si-api backend
# Run:                                docker run -p 8000:8000 -e GEMINI_API_KEY=... ignis-si-api
#
# The image trains the classifier and runs the comparison against the NASA
# flight tables while it is built, so a container starts serving in seconds.

FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY data ./data
COPY ml ./ml
COPY physics ./physics

# Generated artifacts are not kept in the repository; produce them here.
RUN python -m ml.train --regenerate > /dev/null \
    && python -m data.validation > /dev/null

RUN useradd --create-home --uid 10001 ignis && chown -R ignis:ignis /app
USER ignis

EXPOSE 8000

# Hosts such as Render, Railway and Cloud Run supply the port in $PORT.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --log-level warning"]
