FROM python:3.11-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Static docker CLI, used by /containers/anomaly (`docker stats` / `docker inspect`).
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Retrain both models so the pickles always match the scikit-learn version installed above.
RUN python -m traffic.models.train_scaler_model && python -m anomaly.train_model

RUN useradd --create-home --uid 1001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8001
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fs http://localhost:8001/health || exit 1

CMD ["uvicorn", "chatbot.main:app", "--host", "0.0.0.0", "--port", "8001"]
