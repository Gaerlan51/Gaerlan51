# DTR. One process, one SQLite file on a mounted volume.
#
# The volume is the whole story: everything that must survive a redeploy —
# the database, the scan photos and the signing key that validates every
# printed poster — lives under /data. Run exactly one instance. SQLite is
# a file, not a server, so two machines on two volumes would each keep half
# the time records and neither would know.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DTR_DATA_DIR=/data \
    DTR_HOST=0.0.0.0 \
    PORT=8000

WORKDIR /app

COPY dtr/requirements.txt /app/dtr/requirements.txt
RUN pip install --no-cache-dir -r /app/dtr/requirements.txt

COPY dtr/ /app/dtr/
COPY config/ /app/config/

# Employment records and location traces: not owned by root, not world-readable.
RUN useradd --system --uid 10001 --home /app dtr \
    && mkdir -p /data \
    && chown -R dtr:dtr /app /data
USER dtr

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,os; \
urllib.request.urlopen(f\"http://127.0.0.1:{os.environ.get('PORT', 8000)}/api/health\").read()"

# init is idempotent (CREATE TABLE IF NOT EXISTS) and runs on every boot so a
# fresh volume comes up ready without a manual step.
CMD ["sh", "-c", "python -m dtr init && exec python -m dtr serve"]
