FROM python:3.12-slim
WORKDIR /workspace/backend
COPY backend/requirements-lock.txt ./requirements-lock.txt
RUN pip install --no-cache-dir -r requirements-lock.txt
COPY backend/app ./app
COPY shared /workspace/shared
RUN useradd --create-home mirror && mkdir -p data /data && chown -R mirror:mirror /workspace /data
USER mirror
ENV DATABASE_PATH=/workspace/backend/data/mirror.sqlite3 ALLOW_DEMO_ADMIN=false
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
